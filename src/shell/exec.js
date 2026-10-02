// The shell executor: expansions, pipelines, redirections and exit codes.

import { parse, ParseError } from './parse.js';
import { stripAnsi, normalizePath, globToRegExp, joinPath } from '../core/util.js';
import { statOrNull, readdirSorted } from '../vfs/fsutil.js';

export class ShellError extends Error {
    constructor(message, status = 1) {
        super(message);
        this.status = status;
    }
}

// ---- output sinks ---------------------------------------------------------------

export class BufferSink {
    constructor() { this.text = ''; this.isTTY = false; }
    write(s) { this.text += stripAnsi(s); }
}

class FileSink extends BufferSink {
    constructor(path, append) { super(); this.path = path; this.append = append; }
}

class TerminalSink {
    // When the shell is not attached to a terminal (tests, scripted runs) stdout is
    // block-buffered like a real pipe: it is flushed when the command ends, while
    // stderr is written immediately.
    constructor(shell, kind) {
        this.shell = shell;
        this.kind = kind;
        this.isTTY = shell.tty;
        this.pending = '';
    }

    write(s) {
        if (!s) return;
        if (this.kind === 'err') this.shell.lastStderr += stripAnsi(s);
        else this.shell.lastStdout += s;
        if (!this.isTTY && this.kind === 'out') {
            this.pending += stripAnsi(s);
            return;
        }
        this.shell.ui.write(this.isTTY ? s : stripAnsi(s));
    }

    flush() {
        if (this.pending) this.shell.ui.write(this.pending);
        this.pending = '';
    }
}

// ---- brace expansion ------------------------------------------------------------

function braceExpand(text) {
    // finds the first top-level {a,b} or {1..3} and expands it recursively
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (c === '}' && depth > 0) {
            depth--;
            if (depth === 0 && start !== -1) {
                const inner = text.slice(start + 1, i);
                const pre = text.slice(0, start);
                const post = text.slice(i + 1);
                let options = null;
                const range = inner.match(/^(-?\d+)\.\.(-?\d+)$/) || inner.match(/^([a-zA-Z])\.\.([a-zA-Z])$/);
                if (range) {
                    const numeric = /\d/.test(range[1]);
                    const a = numeric ? Number(range[1]) : range[1].charCodeAt(0);
                    const b = numeric ? Number(range[2]) : range[2].charCodeAt(0);
                    const step = a <= b ? 1 : -1;
                    options = [];
                    for (let v = a; step > 0 ? v <= b : v >= b; v += step) {
                        options.push(numeric ? String(v) : String.fromCharCode(v));
                        if (options.length > 1000) break;
                    }
                } else {
                    const parts = [];
                    let d = 0, last = 0;
                    for (let j = 0; j < inner.length; j++) {
                        if (inner[j] === '{') d++;
                        else if (inner[j] === '}') d--;
                        else if (inner[j] === ',' && d === 0) { parts.push(inner.slice(last, j)); last = j + 1; }
                    }
                    parts.push(inner.slice(last));
                    if (parts.length > 1) options = parts;
                }
                if (!options) continue;
                return options.flatMap(opt => braceExpand(pre + opt + post));
            }
        }
    }
    return [text];
}

// ---- the shell ------------------------------------------------------------------

export class Shell {
    constructor({ registry, ui }) {
        this.registry = registry;
        this.ui = ui;
        this.world = null;
        this.lastStderr = '';
        this.lastStdout = '';
        this.positional = [];
        this.abort = null;
        this.depth = 0;
        this.tty = true;
    }

    setWorld(world) {
        this.world = world;
    }

    get env() {
        return this.world.env;
    }

    // Interactive entry point: one line typed by the student (history expansion already applied).
    async runLine(line, { record, tty = true } = {}) {
        this.tty = tty;
        this.lastStderr = '';
        this.lastStdout = '';
        this.abort = new AbortController();
        const commands = [];
        let status = 0;
        try {
            const list = parse(line);
            status = await this.runList(list, { commands, record });
        } catch (e) {
            if (e instanceof ParseError) {
                this.ui.write(`bash: ${e.message}\n`);
                this.lastStderr += `bash: ${e.message}\n`;
                status = 2;
            } else {
                throw e;
            }
        }
        this.world.lastStatus = status;
        return { status, commands, stderr: this.lastStderr, stdout: stripAnsi(this.lastStdout) };
    }

    // Run source text and capture its output (used for $(...) and by the coach).
    async capture(src) {
        const out = new BufferSink();
        const err = new BufferSink();
        let status = 0;
        try {
            status = await this.runList(parse(src), { stdout: out, stderr: err, commands: [] });
        } catch (e) {
            err.write(`bash: ${e.message}\n`);
            status = 2;
        }
        return { stdout: out.text, stderr: err.text, status };
    }

    async runScript(text, args = [], io = {}) {
        const saved = this.positional;
        this.positional = args;
        this.depth++;
        try {
            if (this.depth > 20) throw new ShellError('bash: maximum script nesting exceeded', 2);
            return await this.runList(parse(text), { commands: [], ...io });
        } finally {
            this.depth--;
            this.positional = saved;
        }
    }

    async runList(list, opts) {
        let status = 0;
        let skipUntilSep = null;
        for (const { pipeline, op } of list) {
            if (skipUntilSep === null) {
                status = await this.runPipeline(pipeline, opts);
                this.world.lastStatus = status;
            }
            if (this.abort?.signal.aborted) return 130;
            if (op === '&&') skipUntilSep = status === 0 ? null : '&&';
            else if (op === '||') skipUntilSep = status !== 0 ? null : '||';
            else skipUntilSep = null;
        }
        return status;
    }

    async runPipeline(pipeline, opts) {
        const n = pipeline.cmds.length;
        let input = null;
        let status = 0;
        for (let i = 0; i < n; i++) {
            const last = i === n - 1;
            const stdout = last ? (opts.stdout || new TerminalSink(this, 'out')) : new BufferSink();
            status = await this.runCommand(pipeline.cmds[i], {
                stdin: input,
                stdout,
                stderr: opts.stderr || new TerminalSink(this, 'err'),
                commands: opts.commands,
                inPipe: n > 1,
            });
            if (stdout.flush) stdout.flush();
            input = last ? null : stdout.text;
            if (this.abort?.signal.aborted) return 130;
        }
        return pipeline.negate ? (status === 0 ? 1 : 0) : status;
    }

    // ---- expansion ----------------------------------------------------------------

    lookupVar(name) {
        const w = this.world;
        if (name === '?') return String(w.lastStatus);
        if (name === '$') return '4242';
        if (name === '#') return String(this.positional.length);
        if (name === '0') return 'bash';
        if (name === '@' || name === '*') return this.positional.join(' ');
        if (/^\d$/.test(name)) return this.positional[Number(name) - 1] ?? '';
        if (name === 'PWD') return w.cwd;
        if (name === 'OLDPWD') return w.oldpwd ?? '';
        if (name === 'RANDOM') return String(Math.floor(Math.random() * 32768));
        return w.env[name] ?? '';
    }

    // Returns fields: arrays of {c: char, g: globActive}
    async expandWord(word, { split = true } = {}) {
        // brace expansion only for words made of plain unquoted text
        if (word.segs.length === 1 && word.segs[0].t === 'lit' && !word.segs[0].q && /\{.*[,.].*\}/.test(word.segs[0].v)) {
            const variants = braceExpand(word.segs[0].v);
            if (variants.length > 1) {
                const out = [];
                for (const v of variants) out.push(...await this.expandWord({ segs: [{ t: 'lit', v, q: false }] }, { split }));
                return out;
            }
        }
        const fields = [];
        let cur = null; // current field (array of chars) or null if nothing yet
        const push = (text, quoted) => {
            cur ??= [];
            for (const c of text) cur.push({ c, g: !quoted });
        };
        const end = () => {
            if (cur !== null) fields.push(cur);
            cur = null;
        };
        for (let si = 0; si < word.segs.length; si++) {
            const seg = word.segs[si];
            if (seg.t === 'lit') {
                let text = seg.v;
                if (si === 0 && !seg.q && (text === '~' || text.startsWith('~/'))) {
                    push(this.world.env.HOME || '/home/student', true);
                    text = text.slice(1);
                }
                push(text, Boolean(seg.q));
                if (seg.q && text === '') cur ??= [];
                continue;
            }
            let value;
            if (seg.t === 'var') {
                if (seg.name === '@' && seg.q) {
                    // "$@" keeps each positional parameter as its own field
                    this.positional.forEach((p, idx) => {
                        if (idx > 0) end();
                        push(p, true);
                    });
                    continue;
                }
                value = this.lookupVar(seg.name);
            } else {
                const res = await this.capture(seg.src);
                value = res.stdout.replace(/\n+$/, '');
                if (res.stderr) this.ui.write(res.stderr);
            }
            if (seg.q || !split) {
                push(value, true);
                if (seg.q) cur ??= [];
            } else {
                // unquoted expansion: split on whitespace
                const parts = value.split(/[ \t\n]+/);
                parts.forEach((part, idx) => {
                    if (idx > 0) end();
                    if (part) push(part, true);
                });
            }
        }
        end();
        return fields;
    }

    async expandWords(words) {
        const out = [];
        for (const word of words) {
            for (const field of await this.expandWord(word)) {
                const text = field.map(x => x.c).join('');
                if (field.some(x => x.g && '*?['.includes(x.c))) {
                    const matches = await this.glob(field);
                    if (matches.length) {
                        out.push(...matches);
                        continue;
                    }
                }
                out.push(text);
            }
        }
        return out;
    }

    async glob(field) {
        // split the pattern into path segments, escaping quoted characters
        const text = field.map(x => x.c).join('');
        const absolute = text.startsWith('/');
        const segments = [];
        let seg = [];
        for (const ch of field) {
            if (ch.c === '/') {
                if (seg.length) segments.push(seg);
                seg = [];
            } else {
                seg.push(ch);
            }
        }
        if (seg.length) segments.push(seg);
        const pfs = this.world.pfs;
        let candidates = [{ path: absolute ? '/' : this.world.cwd, shown: absolute ? '/' : '' }];
        for (const s of segments) {
            const isPattern = s.some(x => x.g && '*?['.includes(x.c));
            const literal = s.map(x => x.c).join('');
            const next = [];
            for (const cand of candidates) {
                if (!isPattern) {
                    const full = joinPath(cand.path, literal);
                    if (await statOrNull(pfs, full)) next.push({ path: full, shown: cand.shown + (cand.shown && !cand.shown.endsWith('/') ? '/' : '') + literal });
                    continue;
                }
                const src = s.map(x => (x.g ? x.c : x.c.replace(/[*?[\]]/g, '\\$&'))).join('');
                let re;
                try {
                    re = globToRegExp(src.replace(/\\([*?[\]])/g, '[$1]'));
                } catch {
                    continue;
                }
                let names;
                try {
                    names = await readdirSorted(pfs, cand.path);
                } catch {
                    continue;
                }
                for (const name of names) {
                    if (name.startsWith('.') && !literal.startsWith('.')) continue;
                    if (!re.test(name)) continue;
                    next.push({ path: joinPath(cand.path, name), shown: cand.shown + (cand.shown && !cand.shown.endsWith('/') ? '/' : '') + name });
                }
            }
            candidates = next;
            if (!candidates.length) break;
        }
        return candidates.map(c => c.shown).filter(Boolean);
    }

    // ---- simple command -------------------------------------------------------------

    async runCommand(cmd, io) {
        const world = this.world;
        let argv;
        let assigns;
        try {
            assigns = [];
            for (const a of cmd.assigns) {
                const fields = await this.expandWord(a.value, { split: false });
                assigns.push([a.name, fields.map(f => f.map(x => x.c).join('')).join(' ')]);
            }
            argv = await this.expandWords(cmd.words);
        } catch (e) {
            io.stderr.write(`bash: ${e.message}\n`);
            return 1;
        }

        // aliases (first word only, not quoted)
        const firstWord = cmd.words[0];
        if (argv.length && firstWord && firstWord.segs.length === 1 && firstWord.segs[0].t === 'lit' && !firstWord.segs[0].q) {
            const alias = world.aliases[argv[0]];
            if (alias) argv = [...alias.split(/\s+/).filter(Boolean), ...argv.slice(1)];
        }

        // redirections
        const fds = { 1: io.stdout, 2: io.stderr };
        let stdinText = io.stdin;
        const fileSinks = [];
        for (const r of cmd.redirects) {
            if (r.dup !== undefined) {
                if (r.dup === '-') continue;
                const target = fds[Number(r.dup)];
                if (target) fds[r.fd ?? 1] = target;
                continue;
            }
            const targetFields = await this.expandWords([r.target]);
            if (targetFields.length !== 1) {
                io.stderr.write(`bash: ${r.target.raw}: ambiguous redirect\n`);
                return 1;
            }
            const path = world.resolve(targetFields[0]);
            // the bit bucket: output disappears, input is empty
            if (path === '/dev/null') {
                if (r.op === '<') stdinText = '';
                else if (r.op === '&>') { fds[1] = new BufferSink(); fds[2] = fds[1]; }
                else fds[r.fd ?? 1] = new BufferSink();
                continue;
            }
            if (r.op === '<') {
                try {
                    stdinText = await world.pfs.readFile(path, 'utf8');
                } catch {
                    io.stderr.write(`bash: ${targetFields[0]}: No such file or directory\n`);
                    return 1;
                }
                continue;
            }
            const parent = normalizePath(path + '/..');
            const parentStat = await statOrNull(world.pfs, parent);
            if (!parentStat || !parentStat.isDirectory()) {
                io.stderr.write(`bash: ${targetFields[0]}: No such file or directory\n`);
                return 1;
            }
            const st = await statOrNull(world.pfs, path);
            if (st && st.isDirectory()) {
                io.stderr.write(`bash: ${targetFields[0]}: Is a directory\n`);
                return 1;
            }
            if (!world.canWrite(path)) {
                io.stderr.write(`bash: ${targetFields[0]}: Permission denied\n`);
                return 1;
            }
            const sink = new FileSink(path, r.op === '>>');
            fileSinks.push(sink);
            if (r.op === '&>') {
                fds[1] = sink;
                fds[2] = sink;
            } else {
                fds[r.fd ?? 1] = sink;
            }
            // create/truncate immediately, like bash does
            if (r.op !== '>>' || !st) await world.pfs.writeFile(path, '', 'utf8');
        }

        let status = 0;
        if (!argv.length) {
            for (const [k, v] of assigns) world.env[k] = v;
        } else {
            status = await this.invoke(argv, { fds, stdinText, assigns, io });
        }

        for (const sink of fileSinks) {
            let content = sink.text;
            if (sink.append) {
                let existing = '';
                try { existing = await world.pfs.readFile(sink.path, 'utf8'); } catch { /* new file */ }
                content = existing + content;
            }
            await world.pfs.writeFile(sink.path, content, 'utf8');
        }
        return status;
    }

    async invoke(argv, { fds, stdinText, assigns, io }) {
        const world = this.world;
        const [name, ...args] = argv;
        const savedEnv = {};
        for (const [k, v] of assigns) {
            savedEnv[k] = world.env[k];
            world.env[k] = v;
        }
        const spec = this.registry.get(name) || (name.includes('/') ? this.registry.get('__script__') : null);
        const record = { name, args, status: 0, info: {} };
        io.commands?.push(record);
        try {
            if (!spec) {
                fds[2].write(`${name}: command not found\n`);
                record.status = 127;
                record.notFound = true;
                return 127;
            }
            const ctx = this.makeContext(spec, name, args, argv, fds, stdinText, record, io);
            let status = await spec.run(ctx);
            if (typeof status !== 'number') status = 0;
            record.status = status;
            return status;
        } catch (e) {
            if (e instanceof ShellError) {
                if (e.message) fds[2].write(e.message.endsWith('\n') ? e.message : e.message + '\n');
                record.status = e.status;
                return e.status;
            }
            console.error(e);
            fds[2].write(`${name}: internal error: ${e.message}\n`);
            record.status = 1;
            record.internalError = e;
            return 1;
        } finally {
            for (const [k, v] of Object.entries(savedEnv)) {
                if (v === undefined) delete world.env[k];
                else world.env[k] = v;
            }
        }
    }

    makeContext(spec, name, args, argv, fds, stdinText, record, io) {
        const shell = this;
        const world = this.world;
        const stdout = fds[1];
        const stderr = fds[2];
        return {
            shell,
            world,
            name,
            args,
            argv,
            record,
            info: record.info,
            ui: this.ui,
            signal: this.abort?.signal,
            inPipe: io.inPipe,
            get cwd() { return world.cwd; },
            get pfs() { return world.pfs; },
            get fs() { return world.fs; },
            env: world.env,
            stdout,
            stderr,
            isTTY: stdout.isTTY,
            columns: stdout.isTTY ? (this.ui.columns?.() || 80) : 80,
            hasStdin: stdinText !== null && stdinText !== undefined,
            out(s) { stdout.write(s); },
            outln(s = '') { stdout.write(s + '\n'); },
            err(s) { stderr.write(s); },
            errln(s = '') { stderr.write(s + '\n'); },
            resolve(p) { return world.resolve(p); },
            async readStdin() {
                if (stdinText !== null && stdinText !== undefined) return stdinText;
                // interactive: read lines from the keyboard until Ctrl+D
                if (shell.ui.readInteractive) return shell.ui.readInteractive({ signal: shell.abort?.signal });
                return '';
            },
            fail(message, status = 1) { throw new ShellError(message, status); },
        };
    }
}
