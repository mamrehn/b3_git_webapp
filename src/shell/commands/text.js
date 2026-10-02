// Text commands: cat, echo, printf, head, tail, wc, grep, sort, uniq, cut, tr, tac,
// rev, nl, diff, tee, xargs, less/more, seq.

import { getopt } from '../registry.js';
import { statOrNull } from '../../vfs/fsutil.js';
import { splitLines } from '../../core/util.js';
import { Diff } from '../../lib.js';

function missing(ctx, cmd, what = 'missing file operand') {
    ctx.errln(`${cmd}: ${what}`);
    ctx.errln(`Try '${cmd} --help' for more information.`);
    return 1;
}

function badOption(ctx, cmd, unknown, status = 1) {
    const u = unknown[0];
    if (u.missingValue) ctx.errln(`${cmd}: option requires an argument -- '${u.option.replace(/^-+/, '')}'`);
    else if (u.option.startsWith('--')) ctx.errln(`${cmd}: unrecognized option '${u.option}'`);
    else ctx.errln(`${cmd}: invalid option -- '${u.option.slice(1)}'`);
    ctx.errln(`Try '${cmd} --help' for more information.`);
    return status;
}

// Read the named files (or stdin when none / "-"). Reports errors GNU-style.
async function readInputs(ctx, cmd, names, { openStyle = false } = {}) {
    const inputs = [];
    let status = 0;
    if (!names.length) {
        inputs.push({ name: '-', text: await ctx.readStdin() });
        return { inputs, status };
    }
    for (const name of names) {
        if (name === '-') {
            inputs.push({ name, text: await ctx.readStdin() });
            continue;
        }
        const path = ctx.resolve(name);
        const st = await statOrNull(ctx.pfs, path);
        if (!st) {
            ctx.errln(openStyle ? `${cmd}: cannot open '${name}' for reading: No such file or directory` : `${cmd}: ${name}: No such file or directory`);
            status = 1;
            continue;
        }
        if (st.isDirectory()) {
            ctx.errln(openStyle ? `${cmd}: error reading '${name}': Is a directory` : `${cmd}: ${name}: Is a directory`);
            status = 1;
            continue;
        }
        inputs.push({ name, text: await ctx.pfs.readFile(path, 'utf8') });
    }
    return { inputs, status };
}

function lines(text) {
    return splitLines(text);
}

function joinLines(list, trailing = true) {
    return list.length ? list.join('\n') + (trailing ? '\n' : '') : '';
}

// ---- cat / tac / rev / nl ------------------------------------------------------------------

async function cat(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['n', 'b', 'A', 'E', 's', 'number', 'show-ends'], alias: { number: 'n', 'show-ends': 'E' } });
    if (unknown.length) return badOption(ctx, 'cat', unknown);
    const { inputs, status } = await readInputs(ctx, 'cat', rest);
    let n = 0;
    for (const { text } of inputs) {
        if (!opts.n && !opts.b && !opts.E && !opts.A && !opts.s) {
            ctx.out(text);
            continue;
        }
        let ls = text.split('\n');
        const hadTrailing = text.endsWith('\n');
        if (hadTrailing) ls.pop();
        if (opts.s) ls = ls.filter((l, i) => !(l === '' && ls[i - 1] === ''));
        const outLines = ls.map(l => {
            const shown = (opts.E || opts.A) ? l + '$' : l;
            if (opts.b && l === '') return shown;
            if (opts.n || opts.b) return `${String(++n).padStart(6)}\t${shown}`;
            return shown;
        });
        ctx.out(outLines.join('\n') + (hadTrailing ? '\n' : ''));
    }
    return status;
}

async function tac(ctx) {
    const { inputs, status } = await readInputs(ctx, 'tac', ctx.args.filter(a => !a.startsWith('-') || a === '-'));
    for (const { text } of inputs) ctx.out(joinLines(lines(text).reverse()));
    return status;
}

async function rev(ctx) {
    const { inputs, status } = await readInputs(ctx, 'rev', ctx.args);
    for (const { text } of inputs) ctx.out(joinLines(lines(text).map(l => [...l].reverse().join(''))));
    return status;
}

async function nl(ctx) {
    const { opts, rest } = getopt(ctx.args, { value: ['b'] });
    const { inputs, status } = await readInputs(ctx, 'nl', rest);
    let n = 0;
    for (const { text } of inputs) {
        ctx.out(joinLines(lines(text).map(l => (l === '' && opts.b !== 'a' ? '' : `${String(++n).padStart(6)}\t${l}`))));
    }
    return status;
}

// ---- echo / printf ------------------------------------------------------------------------

function unescapeEcho(s) {
    let stop = false;
    const out = s.replace(/\\(0[0-7]{0,3}|x[0-9a-fA-F]{1,2}|[abcefnrtv\\])/g, (m, e) => {
        if (stop) return '';
        switch (e[0]) {
            case 'n': return '\n';
            case 't': return '\t';
            case 'r': return '\r';
            case 'a': return '\x07';
            case 'b': return '\b';
            case 'e': return '\x1b';
            case 'f': return '\f';
            case 'v': return '\v';
            case '\\': return '\\';
            case 'c': stop = true; return '';
            case '0': return String.fromCharCode(parseInt(e.slice(1) || '0', 8));
            case 'x': return String.fromCharCode(parseInt(e.slice(1), 16));
            default: return m;
        }
    });
    return { text: out, stop };
}

async function echo(ctx) {
    let args = ctx.args;
    let newline = true;
    let escapes = false;
    while (args.length && /^-[neE]+$/.test(args[0])) {
        if (args[0].includes('n')) newline = false;
        if (args[0].includes('e')) escapes = true;
        if (args[0].includes('E')) escapes = false;
        args = args.slice(1);
    }
    let text = args.join(' ');
    if (escapes) {
        const r = unescapeEcho(text);
        text = r.text;
        if (r.stop) newline = false;
    }
    ctx.out(text + (newline ? '\n' : ''));
    return 0;
}

async function printf(ctx) {
    if (!ctx.args.length) {
        ctx.errln('printf: usage: printf [-v var] format [arguments]');
        return 2;
    }
    const [format, ...values] = ctx.args;
    let out = '';
    let vi = 0;
    do {
        out += format.replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?([sdifxXoc%b])|\\(.)/g, (m, flags, width, prec, conv, esc) => {
            if (esc !== undefined) return unescapeEcho('\\' + esc).text;
            if (conv === '%') return '%';
            const raw = values[vi++] ?? '';
            let s;
            switch (conv) {
                case 'd': case 'i': s = String(Math.trunc(Number(raw) || 0)); break;
                case 'f': s = (Number(raw) || 0).toFixed(prec === undefined ? 6 : Number(prec)); break;
                case 'x': s = (Number(raw) || 0).toString(16); break;
                case 'X': s = (Number(raw) || 0).toString(16).toUpperCase(); break;
                case 'o': s = (Number(raw) || 0).toString(8); break;
                case 'c': s = String(raw).charAt(0); break;
                case 'b': s = unescapeEcho(String(raw)).text; break;
                default: s = prec !== undefined ? String(raw).slice(0, Number(prec)) : String(raw);
            }
            if (width) {
                const w = Number(width);
                if (flags.includes('-')) s = s.padEnd(w);
                else s = s.padStart(w, flags.includes('0') && conv !== 's' ? '0' : ' ');
            }
            return s;
        });
    } while (vi < values.length && /%[^%]/.test(format));
    ctx.out(out);
    return 0;
}

// ---- head / tail ----------------------------------------------------------------------------

function countArg(args) {
    // supports -5, -n 5, -n5, --lines=5, -n +3 (tail)
    const out = [];
    let n = null;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        const m = a.match(/^-(\d+)$/);
        if (m) { n = m[1]; continue; }
        if (a === '-n' || a === '--lines') { n = args[++i]; continue; }
        if (a.startsWith('-n')) { n = a.slice(2); continue; }
        if (a.startsWith('--lines=')) { n = a.slice(8); continue; }
        out.push(a);
    }
    return { n, files: out };
}

async function head(ctx) {
    const { n, files } = countArg(ctx.args);
    const count = n === null ? 10 : Number(n);
    if (Number.isNaN(count)) { ctx.errln(`head: invalid number of lines: '${n}'`); return 1; }
    const { inputs, status } = await readInputs(ctx, 'head', files, { openStyle: true });
    inputs.forEach((inp, i) => {
        if (inputs.length > 1) ctx.out(`${i ? '\n' : ''}==> ${inp.name} <==\n`);
        const ls = lines(inp.text);
        ctx.out(joinLines(count < 0 ? ls.slice(0, count) : ls.slice(0, count)));
    });
    return status;
}

async function tail(ctx) {
    const { n, files } = countArg(ctx.args.filter(a => a !== '-f'));
    const fromStart = typeof n === 'string' && n.startsWith('+');
    const count = n === null ? 10 : Math.abs(Number(n));
    if (Number.isNaN(count)) { ctx.errln(`tail: invalid number of lines: '${n}'`); return 1; }
    const { inputs, status } = await readInputs(ctx, 'tail', files, { openStyle: true });
    inputs.forEach((inp, i) => {
        if (inputs.length > 1) ctx.out(`${i ? '\n' : ''}==> ${inp.name} <==\n`);
        const ls = lines(inp.text);
        ctx.out(joinLines(fromStart ? ls.slice(Math.max(0, count - 1)) : (count === 0 ? [] : ls.slice(-count))));
    });
    return status;
}

// ---- wc ---------------------------------------------------------------------------------------

async function wc(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['l', 'w', 'c', 'm', 'lines', 'words', 'bytes', 'chars'], alias: { lines: 'l', words: 'w', bytes: 'c', chars: 'm' } });
    if (unknown.length) return badOption(ctx, 'wc', unknown);
    const all = !opts.l && !opts.w && !opts.c && !opts.m;
    const { inputs, status } = await readInputs(ctx, 'wc', rest);
    const rows = inputs.map(({ name, text }) => ({
        name: name === '-' && !rest.length ? '' : name,
        l: (text.match(/\n/g) || []).length,
        w: text.split(/\s+/).filter(Boolean).length,
        c: new TextEncoder().encode(text).length,
        m: [...text].length,
    }));
    if (rows.length > 1) rows.push(rows.reduce((t, r) => ({ name: 'total', l: t.l + r.l, w: t.w + r.w, c: t.c + r.c, m: t.m + r.m }), { name: 'total', l: 0, w: 0, c: 0, m: 0 }));
    const cols = all ? ['l', 'w', 'c'] : ['l', 'w', 'm', 'c'].filter(k => opts[k]);
    const single = cols.length === 1 && rows.length === 1;
    const fromStdin = !rest.length || rest.includes('-');
    const width = single ? 0 : fromStdin ? 7 : Math.max(...rows.flatMap(r => cols.map(k => String(r[k]).length)), 1);
    for (const r of rows) {
        const nums = cols.map(k => String(r[k]).padStart(width)).join(' ');
        ctx.outln(r.name ? `${nums} ${r.name}` : nums);
    }
    return status;
}

// ---- grep ---------------------------------------------------------------------------------

// Convert a POSIX basic regular expression (grep default) into a JS RegExp source.
function breToJs(pattern) {
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === '\\' && i + 1 < pattern.length) {
            const n = pattern[++i];
            if ('+?|(){}'.includes(n)) out += n; // \+ \? \| \( \) \{ \} are operators in GNU BRE
            else out += '\\' + n;
            continue;
        }
        if ('+?|(){}'.includes(c)) out += '\\' + c; // literal in BRE
        else out += c;
    }
    return out;
}

async function grep(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, {
        bool: ['i', 'v', 'n', 'c', 'r', 'R', 'l', 'L', 'w', 'x', 'E', 'F', 'o', 'h', 'H', 'q', 's', 'ignore-case', 'invert-match', 'line-number', 'count', 'recursive', 'files-with-matches', 'word-regexp', 'extended-regexp', 'fixed-strings', 'only-matching', 'quiet', 'color'],
        value: ['e', 'm', 'A', 'B', 'C', 'include', 'exclude', 'color'],
        alias: { 'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', recursive: 'r', 'files-with-matches': 'l', 'word-regexp': 'w', 'extended-regexp': 'E', 'fixed-strings': 'F', 'only-matching': 'o', quiet: 'q' },
        multi: ['e'],
    });
    if (unknown.length) return badOption(ctx, 'grep', unknown, 2);
    const patterns = opts.e ? opts.e : rest.length ? [rest.shift()] : null;
    if (!patterns) {
        ctx.errln('Usage: grep [OPTION]... PATTERNS [FILE]...');
        ctx.errln("Try 'grep --help' for more information.");
        return 2;
    }
    const recursive = opts.r || opts.R;
    let regex;
    try {
        const sources = patterns.map(p => {
            let src = opts.F ? p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : opts.E ? p : breToJs(p);
            if (opts.w) src = `\\b(?:${src})\\b`;
            if (opts.x) src = `^(?:${src})$`;
            return src;
        });
        regex = new RegExp(sources.join('|'), opts.i ? 'gi' : 'g');
    } catch {
        ctx.errln('grep: Unmatched ( or \\(');
        return 2;
    }
    const files = [];
    let errors = false;
    const targets = rest.length ? rest : (recursive ? ['.'] : []);
    const includeRe = opts.include ? new RegExp('^' + opts.include.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null;
    const collect = async (name, path) => {
        const st = await statOrNull(ctx.pfs, path);
        if (!st) {
            if (!opts.s) ctx.errln(`grep: ${name}: No such file or directory`);
            errors = true;
            return;
        }
        if (st.isDirectory()) {
            if (!recursive) {
                if (!opts.s) ctx.errln(`grep: ${name}: Is a directory`);
                return;
            }
            const names = (await ctx.pfs.readdir(path)).sort();
            for (const n of names) {
                if (n === '.git') continue;
                await collect(name === '.' ? n : `${name.replace(/\/$/, '')}/${n}`, `${path}/${n}`);
            }
            return;
        }
        if (includeRe && !includeRe.test(name.split('/').pop())) return;
        files.push({ name, path });
    };
    for (const t of targets) await collect(t, ctx.resolve(t));
    const inputs = [];
    if (!targets.length) inputs.push({ name: '(standard input)', text: await ctx.readStdin() });
    for (const f of files) {
        const data = await ctx.pfs.readFile(f.path);
        if (data.includes(0)) { inputs.push({ name: f.name, binary: true, text: new TextDecoder().decode(data) }); continue; }
        inputs.push({ name: f.name, text: new TextDecoder().decode(data) });
    }
    const showNames = opts.H || (!opts.h && (inputs.length > 1 || recursive));
    const color = ctx.isTTY;
    const hl = s => (color ? `\x1b[01;31m\x1b[K${s}\x1b[m\x1b[K` : s);
    const nameFmt = s => (color ? `\x1b[35m\x1b[K${s}\x1b[m\x1b[K\x1b[36m\x1b[K:\x1b[m\x1b[K` : `${s}:`);
    const numFmt = n => (color ? `\x1b[32m\x1b[K${n}\x1b[m\x1b[K\x1b[36m\x1b[K:\x1b[m\x1b[K` : `${n}:`);
    const max = opts.m ? Number(opts.m) : Infinity;
    let matched = false;
    for (const inp of inputs) {
        const ls = lines(inp.text);
        let count = 0;
        for (let i = 0; i < ls.length && count < max; i++) {
            regex.lastIndex = 0;
            const match = regex.test(ls[i]);
            if (match === Boolean(opts.v)) continue;
            count++;
            if (opts.q) return 0;
            if (opts.l || opts.L || opts.c) continue;
            if (inp.binary) { ctx.outln(`Binary file ${inp.name} matches`); break; }
            const prefix = (showNames ? nameFmt(inp.name) : '') + (opts.n ? numFmt(i + 1) : '');
            if (opts.o && !opts.v) {
                regex.lastIndex = 0;
                for (const m of ls[i].matchAll(regex)) if (m[0]) ctx.outln(prefix + hl(m[0]));
            } else {
                regex.lastIndex = 0;
                const text = opts.v ? ls[i] : ls[i].replace(regex, m => (m ? hl(m) : m));
                ctx.outln(prefix + text);
            }
        }
        if (opts.c) ctx.outln((showNames ? `${inp.name}:` : '') + count);
        if (opts.l && count) ctx.outln(inp.name);
        if (opts.L && !count) ctx.outln(inp.name);
        if (count) matched = true;
    }
    // GNU: 0 = a line was selected, 1 = none, 2 = error (even with matches, unless -q matched)
    if (errors) return 2;
    return matched ? 0 : 1;
}

// ---- sort / uniq / cut / tr ---------------------------------------------------------------------

async function sort(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, {
        bool: ['r', 'n', 'u', 'f', 'h', 'reverse', 'numeric-sort', 'unique', 'ignore-case'],
        value: ['k', 't', 'o'],
        alias: { reverse: 'r', 'numeric-sort': 'n', unique: 'u', 'ignore-case': 'f' },
    });
    if (unknown.length) return badOption(ctx, 'sort', unknown, 2);
    const { inputs, status } = await readInputs(ctx, 'sort', rest);
    let all = inputs.flatMap(i => lines(i.text));
    const keyOf = line => {
        if (!opts.k) return line;
        const field = Number(String(opts.k).split(',')[0]);
        const parts = opts.t ? line.split(opts.t) : line.trim().split(/\s+/);
        return parts.slice(field - 1).join(opts.t || ' ');
    };
    const cmp = (a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (opts.n || opts.h) {
            const d = (parseFloat(ka) || 0) - (parseFloat(kb) || 0);
            if (d) return d;
        }
        const x = opts.f ? ka.toLowerCase() : ka;
        const y = opts.f ? kb.toLowerCase() : kb;
        return x.localeCompare(y, 'en') || (a < b ? -1 : a > b ? 1 : 0);
    };
    all.sort(cmp);
    if (opts.r) all.reverse();
    if (opts.u) all = all.filter((l, i) => i === 0 || cmp(l, all[i - 1]) !== 0);
    const text = joinLines(all);
    if (opts.o) await ctx.pfs.writeFile(ctx.resolve(opts.o), text, 'utf8');
    else ctx.out(text);
    return status;
}

async function uniq(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['c', 'd', 'u', 'i', 'count', 'repeated', 'unique', 'ignore-case'], alias: { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i' } });
    if (unknown.length) return badOption(ctx, 'uniq', unknown);
    const { inputs, status } = await readInputs(ctx, 'uniq', rest.slice(0, 1));
    const ls = inputs.flatMap(i => lines(i.text));
    const groups = [];
    for (const l of ls) {
        const last = groups[groups.length - 1];
        const same = last && (opts.i ? last.line.toLowerCase() === l.toLowerCase() : last.line === l);
        if (same) last.n++;
        else groups.push({ line: l, n: 1 });
    }
    const out = groups
        .filter(g => (opts.d ? g.n > 1 : opts.u ? g.n === 1 : true))
        .map(g => (opts.c ? `${String(g.n).padStart(7)} ${g.line}` : g.line));
    const text = joinLines(out);
    if (rest[1]) await ctx.pfs.writeFile(ctx.resolve(rest[1]), text, 'utf8');
    else ctx.out(text);
    return status;
}

function parseRanges(spec) {
    return spec.split(',').map(part => {
        const m = part.match(/^(\d*)(-?)(\d*)$/);
        if (!m) return null;
        const a = m[1] ? Number(m[1]) : 1;
        const b = m[2] ? (m[3] ? Number(m[3]) : Infinity) : a;
        return [a, b];
    });
}

async function cut(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { value: ['d', 'f', 'c', 'b'], bool: ['s'] });
    if (unknown.length) return badOption(ctx, 'cut', unknown);
    if (!opts.f && !opts.c && !opts.b) {
        ctx.errln('cut: you must specify a list of bytes, characters, or fields');
        ctx.errln("Try 'cut --help' for more information.");
        return 1;
    }
    const ranges = parseRanges(opts.f || opts.c || opts.b);
    if (ranges.includes(null)) { ctx.errln(`cut: invalid field value '${opts.f || opts.c}'`); return 1; }
    const inRange = i => ranges.some(([a, b]) => i >= a && i <= b);
    const { inputs, status } = await readInputs(ctx, 'cut', rest);
    const delim = opts.d ?? '\t';
    for (const { text } of inputs) {
        const out = [];
        for (const l of lines(text)) {
            if (opts.f) {
                if (!l.includes(delim)) { if (!opts.s) out.push(l); continue; }
                out.push(l.split(delim).filter((_, i) => inRange(i + 1)).join(delim));
            } else {
                out.push([...l].filter((_, i) => inRange(i + 1)).join(''));
            }
        }
        ctx.out(joinLines(out));
    }
    return status;
}

function expandSet(set) {
    const classes = { '[:lower:]': 'a-z', '[:upper:]': 'A-Z', '[:digit:]': '0-9', '[:alpha:]': 'a-zA-Z', '[:alnum:]': 'a-zA-Z0-9', '[:space:]': ' \t\n\r\f\v', '[:punct:]': '!-/:-@[-`{-~' };
    let s = set;
    for (const [k, v] of Object.entries(classes)) s = s.split(k).join(v);
    s = unescapeEcho(s).text;
    let out = '';
    for (let i = 0; i < s.length; i++) {
        if (i + 2 < s.length && s[i + 1] === '-') {
            for (let c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) out += String.fromCharCode(c);
            i += 2;
        } else {
            out += s[i];
        }
    }
    return out;
}

async function tr(ctx) {
    const { opts, rest } = getopt(ctx.args, { bool: ['d', 's', 'c'] });
    if (!rest.length || (!opts.d && !opts.s && rest.length < 2)) {
        ctx.errln(rest.length ? `tr: missing operand after '${rest[0]}'` : 'tr: missing operand');
        ctx.errln("Try 'tr --help' for more information.");
        return 1;
    }
    const set1 = expandSet(rest[0]);
    const set2 = rest[1] !== undefined ? expandSet(rest[1]) : '';
    const text = await ctx.readStdin();
    let out = '';
    let lastChar = null;
    for (const ch of text) {
        const idx = set1.indexOf(ch);
        let res = ch;
        if (idx !== -1) {
            if (opts.d) continue;
            if (set2) res = set2[Math.min(idx, set2.length - 1)];
        }
        if (opts.s && res === lastChar && (set2 ? set2.includes(res) : set1.includes(res))) continue;
        out += res;
        lastChar = res;
    }
    ctx.out(out);
    return 0;
}

// ---- diff (files) -------------------------------------------------------------------------------

async function diff(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['u', 'q', 'y', 'w', 'i', 'unified', 'brief', 'color'], value: ['U'], alias: { unified: 'u', brief: 'q' } });
    if (unknown.length) return badOption(ctx, 'diff', unknown, 2);
    if (rest.length !== 2) {
        ctx.errln(rest.length < 2 ? `diff: missing operand after '${rest[0] ?? 'diff'}'` : `diff: extra operand '${rest[2]}'`);
        ctx.errln("diff: Try 'diff --help' for more information.");
        return 2;
    }
    const texts = [];
    for (const name of rest) {
        const st = await statOrNull(ctx.pfs, ctx.resolve(name));
        if (!st) { ctx.errln(`diff: ${name}: No such file or directory`); return 2; }
        if (st.isDirectory()) { ctx.errln(`diff: ${name}: Is a directory`); return 2; }
        texts.push(await ctx.pfs.readFile(ctx.resolve(name), 'utf8'));
    }
    let [a, b] = texts;
    if (opts.w) { a = a.replace(/[ \t]+/g, ''); b = b.replace(/[ \t]+/g, ''); }
    if (opts.i) { a = a.toLowerCase(); b = b.toLowerCase(); }
    if (a === b) return 0;
    if (opts.q) { ctx.outln(`Files ${rest[0]} and ${rest[1]} differ`); return 1; }
    const [ta, tb] = texts;
    if (opts.u || opts.U) {
        const patch = Diff.structuredPatch(rest[0], rest[1], ta, tb, '', '', { context: opts.U ? Number(opts.U) : 3 });
        ctx.outln(`--- ${rest[0]}`);
        ctx.outln(`+++ ${rest[1]}`);
        for (const h of patch.hunks) {
            ctx.outln(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
            for (const l of h.lines) if (!l.startsWith('\\')) ctx.outln(l);
        }
        return 1;
    }
    // normal format: 2c2 / < old / --- / > new
    const parts = Diff.diffLines(ta, tb);
    let la = 1;
    let lb = 1;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const n = p.count || 0;
        if (!p.added && !p.removed) { la += n; lb += n; continue; }
        const removed = p.removed ? p : null;
        const added = p.removed && parts[i + 1]?.added ? parts[++i] : p.added ? p : null;
        const rl = removed ? removed.count : 0;
        const al = added ? added.count : 0;
        const range = (start, len) => (len <= 1 ? String(start) : `${start},${start + len - 1}`);
        if (removed && added) ctx.outln(`${range(la, rl)}c${range(lb, al)}`);
        else if (removed) ctx.outln(`${range(la, rl)}d${lb - 1}`);
        else ctx.outln(`${la - 1}a${range(lb, al)}`);
        if (removed) lines(removed.value).forEach(l => ctx.outln(`< ${l}`));
        if (removed && added) ctx.outln('---');
        if (added) lines(added.value).forEach(l => ctx.outln(`> ${l}`));
        la += rl;
        lb += al;
    }
    return 1;
}

// ---- sed ----------------------------------------------------------------------------------------

function parseSedScript(script, extended) {
    const cmds = [];
    let i = 0;
    const skipWs = () => { while (i < script.length && /[ \t;\n]/.test(script[i])) i++; };
    const toRe = (src, flags = '') => new RegExp(extended ? src : breToJs(src), flags);
    const readDelimited = delim => {
        let out = '';
        while (i < script.length && script[i] !== delim) {
            if (script[i] === '\\' && i + 1 < script.length) {
                if (script[i + 1] === delim) { out += delim; i += 2; continue; }
                out += script[i] + script[i + 1];
                i += 2;
                continue;
            }
            out += script[i++];
        }
        if (script[i] !== delim) throw new Error(`unterminated address regex`);
        i++;
        return out;
    };
    const readAddr = () => {
        if (script[i] === '$') { i++; return { last: true }; }
        if (/\d/.test(script[i] || '')) {
            let n = '';
            while (/\d/.test(script[i] || '')) n += script[i++];
            return { line: Number(n) };
        }
        if (script[i] === '/' || script[i] === '\\') {
            const delim = script[i] === '\\' ? script[++i] : '/';
            i++;
            return { re: toRe(readDelimited(delim)) };
        }
        return null;
    };
    while (i < script.length) {
        skipWs();
        if (i >= script.length) break;
        const cmd = { a1: readAddr(), a2: null, neg: false };
        if (cmd.a1 && script[i] === ',') { i++; cmd.a2 = readAddr(); }
        while (script[i] === ' ') i++;
        if (script[i] === '!') { cmd.neg = true; i++; }
        while (script[i] === ' ') i++;
        const c = script[i++];
        cmd.c = c;
        if (c === 's') {
            const delim = script[i++];
            const pat = readDelimited(delim);
            const rep = readDelimited(delim);
            let flags = '';
            while (i < script.length && /[gipI0-9]/.test(script[i])) flags += script[i++];
            const nth = Number((flags.match(/\d+/) || [0])[0]);
            cmd.re = toRe(pat, (flags.includes('g') && !nth ? 'g' : '') + (/[iI]/.test(flags) ? 'i' : ''));
            cmd.rep = rep;
            cmd.print = flags.includes('p');
            cmd.nth = nth;
            cmd.global = flags.includes('g');
        } else if (c === 'y') {
            const delim = script[i++];
            cmd.from = readDelimited(delim);
            cmd.to = readDelimited(delim);
        } else if (c === 'a' || c === 'i' || c === 'c') {
            if (script[i] === '\\') i++;
            while (script[i] === ' ' || script[i] === '\n') i++;
            let text = '';
            while (i < script.length && script[i] !== '\n') text += script[i++];
            cmd.text = text;
        } else if (!'dpq=n'.includes(c || '')) {
            throw new Error(`unknown command: \`${c}'`);
        }
        cmds.push(cmd);
    }
    return cmds;
}

function sedReplace(text, cmd) {
    const expand = (m, groups) => cmd.rep.replace(/\\(\d)|\\n|\\&|&|\\\\/g, tok => {
        if (tok === '&') return m;
        if (tok === '\\&') return '&';
        if (tok === '\\n') return '\n';
        if (tok === '\\\\') return '\\';
        return groups[Number(tok[1]) - 1] ?? '';
    });
    if (cmd.nth) {
        let count = 0;
        const re = new RegExp(cmd.re.source, cmd.re.flags.includes('g') ? cmd.re.flags : cmd.re.flags + 'g');
        let hit = false;
        const out = text.replace(re, (m, ...rest) => {
            count++;
            if (count === cmd.nth || (cmd.global && count >= cmd.nth)) { hit = true; return expand(m, rest.slice(0, -2)); }
            return m;
        });
        return { text: out, hit };
    }
    let hit = false;
    const out = text.replace(cmd.re, (m, ...rest) => { hit = true; return expand(m, rest.slice(0, -2)); });
    return { text: out, hit };
}

function runSed(cmds, lines, quiet) {
    const out = [];
    const ranges = new Map();
    const matches = (addr, line, n, last) => {
        if (!addr) return true;
        if (addr.last) return last;
        if (addr.line !== undefined) return n === addr.line;
        addr.re.lastIndex = 0;
        return addr.re.test(line);
    };
    for (let idx = 0; idx < lines.length; idx++) {
        let ps = lines[idx];
        const n = idx + 1;
        const last = idx === lines.length - 1;
        let deleted = false;
        let quit = false;
        const before = [];
        const after = [];
        for (let k = 0; k < cmds.length && !deleted; k++) {
            const cmd = cmds[k];
            let sel;
            if (!cmd.a2) {
                sel = matches(cmd.a1, ps, n, last);
            } else {
                const active = ranges.get(k);
                if (active) {
                    sel = true;
                    const endHit = cmd.a2.line !== undefined ? n >= cmd.a2.line : matches(cmd.a2, ps, n, last);
                    if (endHit) ranges.set(k, false);
                } else if (matches(cmd.a1, ps, n, last)) {
                    sel = true;
                    const immediateEnd = cmd.a2.line !== undefined ? cmd.a2.line <= n : false;
                    ranges.set(k, !immediateEnd);
                } else sel = false;
            }
            if (cmd.neg) sel = !sel;
            if (!sel) continue;
            switch (cmd.c) {
                case 's': {
                    const r = sedReplace(ps, cmd);
                    ps = r.text;
                    if (r.hit && cmd.print) out.push(ps);
                    break;
                }
                case 'y':
                    ps = [...ps].map(ch => { const j = cmd.from.indexOf(ch); return j === -1 ? ch : cmd.to[j] ?? ch; }).join('');
                    break;
                case 'd': deleted = true; break;
                case 'p': out.push(ps); break;
                case '=': out.push(String(n)); break;
                case 'q': quit = true; break;
                case 'a': after.push(cmd.text); break;
                case 'i': before.push(cmd.text); break;
                case 'c': deleted = true; after.push(cmd.text); break;
                default: break;
            }
            if (quit) break;
        }
        out.push(...before);
        if (!deleted && !quiet) out.push(ps);
        out.push(...after);
        if (quit) break;
    }
    return out;
}

async function sed(ctx) {
    const args = [...ctx.args];
    const scripts = [];
    let quiet = false;
    let inPlace = null;
    let extended = false;
    const files = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-n' || a === '--quiet' || a === '--silent') quiet = true;
        else if (a === '-E' || a === '-r' || a === '--regexp-extended') extended = true;
        else if (a === '-e') scripts.push(args[++i] ?? '');
        else if (a === '-i' || a === '--in-place') inPlace = '';
        else if (a.startsWith('-i')) inPlace = a.slice(2);
        else if (a.startsWith('--in-place=')) inPlace = a.slice(11);
        else if (/^-[nEr]+$/.test(a)) { if (a.includes('n')) quiet = true; if (/[Er]/.test(a)) extended = true; }
        else if (!scripts.length && !a.startsWith('-')) scripts.push(a);
        else files.push(a);
    }
    if (!scripts.length) {
        ctx.errln('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...');
        return 1;
    }
    let cmds;
    try {
        cmds = parseSedScript(scripts.join('\n'), extended);
    } catch (e) {
        ctx.errln(`sed: -e expression #1, char 0: ${e.message}`);
        return 1;
    }
    if (inPlace !== null) {
        if (!files.length) { ctx.errln('sed: no input files'); return 1; }
        let status = 0;
        for (const f of files) {
            const path = ctx.resolve(f);
            const st = await statOrNull(ctx.pfs, path);
            if (!st || st.isDirectory()) { ctx.errln(`sed: can't read ${f}: ${st ? 'Is a directory' : 'No such file or directory'}`); status = 2; continue; }
            if (!ctx.world.canWrite(path)) { ctx.errln(`sed: couldn't open temporary file ${f}: Permission denied`); status = 4; continue; }
            const text = await ctx.pfs.readFile(path, 'utf8');
            if (inPlace) await ctx.pfs.writeFile(path + inPlace, text, 'utf8');
            const result = runSed(cmds, lines(text), quiet);
            await ctx.pfs.writeFile(path, joinLines(result, text.endsWith('\n') || !text), 'utf8');
        }
        return status;
    }
    const { inputs, status } = await readInputs(ctx, 'sed', files);
    const all = inputs.map(x => x.text).join('');
    ctx.out(joinLines(runSed(cmds, lines(all), quiet)));
    return status;
}

// ---- tee / xargs / seq / less ------------------------------------------------------------------------

async function tee(ctx) {
    const { opts, rest } = getopt(ctx.args, { bool: ['a', 'append'], alias: { append: 'a' } });
    const text = await ctx.readStdin();
    let status = 0;
    for (const name of rest) {
        const path = ctx.resolve(name);
        if (!ctx.world.canWrite(path)) { ctx.errln(`tee: ${name}: Permission denied`); status = 1; continue; }
        try {
            let content = text;
            if (opts.a) content = ((await ctx.pfs.readFile(path, 'utf8').catch(() => '')) || '') + text;
            await ctx.pfs.writeFile(path, content, 'utf8');
        } catch {
            ctx.errln(`tee: ${name}: No such file or directory`);
            status = 1;
        }
    }
    ctx.out(text);
    return status;
}

function quoteArg(a) {
    return /^[\w./=:@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

async function xargs(ctx) {
    const { opts, rest } = getopt(ctx.args, { value: ['n', 'I', 'd'], bool: ['0', 'r', 't'], stopAtFirstOperand: true });
    const input = await ctx.readStdin();
    const items = opts.d !== undefined
        ? input.split(opts.d).filter(Boolean)
        : opts['0'] ? input.split('\0').filter(Boolean)
            : opts.I ? lines(input) : (input.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(s => s.replace(/^["']|["']$/g, ''));
    const command = rest.length ? rest : ['echo'];
    if (!items.length && opts.r) return 0;
    const batches = [];
    if (opts.I) for (const it of items) batches.push(command.map(c => c.split(opts.I).join(it)));
    else if (opts.n) for (let i = 0; i < items.length; i += Number(opts.n)) batches.push([...command, ...items.slice(i, i + Number(opts.n))]);
    else batches.push([...command, ...items]);
    let status = 0;
    for (const argv of batches) {
        const line = argv.map(quoteArg).join(' ');
        if (opts.t) ctx.errln(line);
        const res = await ctx.shell.capture(line);
        ctx.out(res.stdout);
        if (res.stderr) ctx.err(res.stderr);
        if (res.status) status = 123;
    }
    return status;
}

async function seq(ctx) {
    const nums = ctx.args.filter(a => !/^-[sw]/.test(a)).map(Number);
    if (!nums.length || nums.some(Number.isNaN)) {
        ctx.errln(nums.length ? `seq: invalid floating point argument: '${ctx.args.find(a => Number.isNaN(Number(a)))}'` : 'seq: missing operand');
        ctx.errln("Try 'seq --help' for more information.");
        return 1;
    }
    let [first, step, last] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
    if (step === 0) { ctx.errln("seq: invalid Zero increment value: '0'"); return 1; }
    const out = [];
    for (let v = first; step > 0 ? v <= last : v >= last; v += step) {
        out.push(String(v));
        if (out.length > 100000) break;
    }
    ctx.out(joinLines(out));
    return 0;
}

async function less(ctx) {
    const names = ctx.args.filter(a => !a.startsWith('-'));
    let text;
    let title = names[0] || '';
    if (names.length) {
        const path = ctx.resolve(names[0]);
        const st = await statOrNull(ctx.pfs, path);
        if (!st) { ctx.errln(`${ctx.name}: ${names[0]}: No such file or directory`); return 1; }
        if (st.isDirectory()) { ctx.errln(`${names[0]} is a directory`); return 1; }
        text = await ctx.pfs.readFile(path, 'utf8');
    } else if (ctx.hasStdin) {
        text = await ctx.readStdin();
        title = '';
    } else {
        ctx.errln('Missing filename ("less --help" for help)');
        return 1;
    }
    if (!ctx.isTTY || !ctx.ui.page) {
        ctx.out(text);
        return 0;
    }
    await ctx.ui.page(text, { title });
    return 0;
}

export function registerTextCommands(reg) {
    const D = (de, en) => ({ de, en });
    reg.register({
        name: 'cat', category: 'text', operands: 'file', run: cat, usage: 'cat datei…',
        summary: D('Gibt den Inhalt von Dateien aus.', 'Prints the contents of files.'),
        options: [{ flags: ['-n'], desc: D('Zeilen nummerieren', 'number all lines') }],
    });
    reg.register({ name: 'tac', category: 'text', operands: 'file', run: tac, usage: 'tac datei', summary: D('Gibt Zeilen in umgekehrter Reihenfolge aus.', 'Prints lines in reverse order.') });
    reg.register({ name: 'rev', category: 'text', operands: 'file', run: rev, usage: 'rev datei', summary: D('Dreht jede Zeile zeichenweise um.', 'Reverses each line character by character.') });
    reg.register({ name: 'nl', category: 'text', operands: 'file', run: nl, usage: 'nl datei', summary: D('Nummeriert Zeilen.', 'Numbers lines.') });
    reg.register({
        name: 'echo', category: 'text', run: echo, builtin: true, usage: 'echo [-n] text…',
        summary: D('Gibt Text aus. Mit > in eine Datei schreiben, mit >> anhängen.', 'Prints text. Use > to write to a file, >> to append.'),
        options: [{ flags: ['-n'], desc: D('ohne Zeilenumbruch am Ende', 'no trailing newline') }, { flags: ['-e'], desc: D('\\n, \\t … auswerten', 'interpret \\n, \\t …') }],
    });
    reg.register({ name: 'printf', category: 'text', run: printf, builtin: true, usage: "printf 'format' werte…", summary: D('Formatierte Ausgabe (wie in C).', 'Formatted output (like in C).') });
    reg.register({ name: 'head', category: 'text', operands: 'file', run: head, usage: 'head [-n N] datei', summary: D('Zeigt die ersten Zeilen (Standard: 10).', 'Shows the first lines (default 10).'), options: [{ flags: ['-n'], arg: 'N', desc: D('die ersten N Zeilen', 'the first N lines') }] });
    reg.register({ name: 'tail', category: 'text', operands: 'file', run: tail, usage: 'tail [-n N] datei', summary: D('Zeigt die letzten Zeilen (Standard: 10).', 'Shows the last lines (default 10).'), options: [{ flags: ['-n'], arg: 'N', desc: D('die letzten N Zeilen (+N: ab Zeile N)', 'the last N lines (+N: from line N)') }] });
    reg.register({ name: 'wc', category: 'text', operands: 'file', run: wc, usage: 'wc [-lwc] datei', summary: D('Zählt Zeilen, Wörter und Bytes.', 'Counts lines, words and bytes.'), options: [{ flags: ['-l'], desc: D('nur Zeilen', 'lines only') }, { flags: ['-w'], desc: D('nur Wörter', 'words only') }, { flags: ['-c'], desc: D('nur Bytes', 'bytes only') }] });
    reg.register({
        name: 'grep', category: 'text', operands: 'file', run: grep, usage: "grep [-inrv] 'muster' datei…",
        summary: D('Sucht Zeilen, die ein Muster enthalten.', 'Finds lines that match a pattern.'),
        options: [
            { flags: ['-i'], desc: D('Groß-/Kleinschreibung ignorieren', 'ignore case') },
            { flags: ['-n'], desc: D('Zeilennummern anzeigen', 'show line numbers') },
            { flags: ['-r'], desc: D('rekursiv in Ordnern suchen', 'search directories recursively') },
            { flags: ['-v'], desc: D('nur Zeilen OHNE Treffer', 'only lines that do NOT match') },
            { flags: ['-c'], desc: D('nur Anzahl der Treffer', 'count matching lines') },
            { flags: ['-E'], desc: D('erweiterte Muster: | + ? ( ) ohne \\', 'extended patterns: | + ? ( ) without \\') },
            { flags: ['-l'], desc: D('nur Dateinamen mit Treffern', 'only names of matching files') },
        ],
    });
    reg.register({ name: 'sort', category: 'text', operands: 'file', run: sort, usage: 'sort [-rnu] datei', summary: D('Sortiert Zeilen.', 'Sorts lines.'), options: [{ flags: ['-r'], desc: D('absteigend', 'reverse') }, { flags: ['-n'], desc: D('numerisch', 'numeric') }, { flags: ['-u'], desc: D('Duplikate entfernen', 'remove duplicates') }] });
    reg.register({ name: 'uniq', category: 'text', operands: 'file', run: uniq, usage: 'uniq [-c] datei', summary: D('Entfernt direkt aufeinanderfolgende doppelte Zeilen (vorher sortieren!).', 'Removes adjacent duplicate lines (sort first!).'), options: [{ flags: ['-c'], desc: D('Anzahl voranstellen', 'prefix counts') }, { flags: ['-d'], desc: D('nur doppelte Zeilen', 'only duplicated lines') }] });
    reg.register({ name: 'cut', category: 'text', operands: 'file', run: cut, usage: "cut -d ',' -f 1 datei", summary: D('Schneidet Spalten aus Zeilen aus.', 'Extracts columns from lines.'), options: [{ flags: ['-d'], arg: 'Z', desc: D('Trennzeichen', 'delimiter') }, { flags: ['-f'], arg: 'N', desc: D('Felder, z. B. 1,3 oder 2-4', 'fields, e.g. 1,3 or 2-4') }, { flags: ['-c'], arg: 'N', desc: D('Zeichenpositionen', 'character positions') }] });
    reg.register({ name: 'tr', category: 'text', run: tr, usage: "tr 'a-z' 'A-Z'", summary: D('Ersetzt oder löscht Zeichen (liest von der Eingabe/Pipe).', 'Translates or deletes characters (reads stdin/pipe).'), options: [{ flags: ['-d'], desc: D('Zeichen löschen', 'delete characters') }] });
    reg.register({ name: 'diff', category: 'text', operands: 'file', run: diff, usage: 'diff [-u] datei1 datei2', summary: D('Vergleicht zwei Dateien zeilenweise.', 'Compares two files line by line.'), options: [{ flags: ['-u'], desc: D('Unified-Format (wie git diff)', 'unified format (like git diff)') }, { flags: ['-q'], desc: D('nur melden, ob sie sich unterscheiden', 'only report whether they differ') }] });
    reg.register({
        name: 'sed', category: 'text', operands: 'file', run: sed, usage: "sed 's/alt/neu/g' datei",
        summary: D('Bearbeitet Text zeilenweise, z. B. Suchen und Ersetzen.', 'Edits text line by line, e.g. search and replace.'),
        options: [
            { flags: ["'s/a/b/'"], desc: D('ersetzt das erste „a“ jeder Zeile durch „b“ (mit g: alle)', "replaces the first 'a' of each line with 'b' (with g: all)") },
            { flags: ['-i'], desc: D('Datei direkt ändern', 'edit the file in place') },
            { flags: ['-n'], desc: D('nur ausgeben, was mit p verlangt wird', 'only print what p asks for') },
            { flags: ['-E'], desc: D('erweiterte reguläre Ausdrücke', 'extended regular expressions') },
        ],
    });
    reg.register({ name: 'tee', category: 'text', operands: 'file', run: tee, usage: 'befehl | tee datei', summary: D('Schreibt die Eingabe in eine Datei UND auf den Bildschirm.', 'Writes stdin to a file AND to the screen.'), options: [{ flags: ['-a'], desc: D('anhängen statt überschreiben', 'append instead of overwrite') }] });
    reg.register({ name: 'xargs', category: 'text', operands: 'command', run: xargs, usage: 'befehl | xargs befehl2', summary: D('Macht aus Eingabezeilen Argumente für einen Befehl.', 'Turns input lines into arguments for a command.') });
    reg.register({ name: 'seq', category: 'text', run: seq, usage: 'seq [start [schritt]] ende', summary: D('Gibt eine Zahlenfolge aus.', 'Prints a sequence of numbers.') });
    reg.register({ name: 'less', aliases: ['more'], category: 'text', operands: 'file', run: less, usage: 'less datei', summary: D('Zeigt lange Texte seitenweise (Leertaste: weiter, q: beenden).', 'Pages through long text (space: next, q: quit).') });
}
