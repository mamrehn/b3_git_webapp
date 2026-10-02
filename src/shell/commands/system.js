// Shell built-ins and system commands: clear, history, env, export, unset, alias,
// which, type, whoami, hostname, uname, id, date, sleep, true/false, exit,
// source/bash (scripts), help, man and the editor commands.

import { getopt } from '../registry.js';
import { statOrNull } from '../../vfs/fsutil.js';
import { L, lang } from '../../core/i18n.js';
import { sleep as wait } from '../../core/util.js';

const D = (de, en) => ({ de, en });

async function clear(ctx) {
    ctx.ui.clear?.();
    return 0;
}

async function history(ctx) {
    const h = ctx.world.history;
    const { opts, rest } = getopt(ctx.args, { bool: ['c'], value: ['d'] });
    if (opts.c) {
        h.length = 0;
        return 0;
    }
    if (opts.d) {
        const i = Number(opts.d) - 1;
        if (!(i >= 0 && i < h.length)) {
            ctx.errln(`bash: history: ${opts.d}: history position out of range`);
            return 1;
        }
        h.splice(i, 1);
        return 0;
    }
    const n = rest[0] ? Number(rest[0]) : h.length;
    const start = Math.max(0, h.length - n);
    for (let i = start; i < h.length; i++) ctx.outln(`${String(i + 1).padStart(5)}  ${h[i]}`);
    return 0;
}

async function env(ctx) {
    if (ctx.args.length && !ctx.args[0].includes('=')) {
        // env VAR=x cmd … – run a command with a modified environment
        return ctx.shell.capture(ctx.args.join(' ')).then(r => { ctx.out(r.stdout); ctx.err(r.stderr); return r.status; });
    }
    for (const [k, v] of Object.entries(ctx.env).sort()) ctx.outln(`${k}=${v}`);
    ctx.outln(`PWD=${ctx.cwd}`);
    return 0;
}

async function printenv(ctx) {
    if (!ctx.args.length) return env(ctx);
    let status = 0;
    for (const name of ctx.args) {
        const v = name === 'PWD' ? ctx.cwd : ctx.env[name];
        if (v === undefined) status = 1;
        else ctx.outln(v);
    }
    return status;
}

async function exportCmd(ctx) {
    if (!ctx.args.length || ctx.args[0] === '-p') {
        for (const [k, v] of Object.entries(ctx.env).sort()) ctx.outln(`declare -x ${k}="${v}"`);
        return 0;
    }
    for (const a of ctx.args) {
        const eq = a.indexOf('=');
        const name = eq === -1 ? a : a.slice(0, eq);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            ctx.errln(`bash: export: \`${a}': not a valid identifier`);
            return 1;
        }
        if (eq !== -1) ctx.env[name] = a.slice(eq + 1);
        else ctx.env[name] ??= '';
    }
    return 0;
}

async function unset(ctx) {
    for (const name of ctx.args) delete ctx.env[name];
    return 0;
}

async function alias(ctx) {
    const aliases = ctx.world.aliases;
    if (!ctx.args.length) {
        for (const [k, v] of Object.entries(aliases).sort()) ctx.outln(`alias ${k}='${v}'`);
        return 0;
    }
    let status = 0;
    for (const a of ctx.args) {
        const eq = a.indexOf('=');
        if (eq === -1) {
            if (aliases[a] === undefined) { ctx.errln(`bash: alias: ${a}: not found`); status = 1; }
            else ctx.outln(`alias ${a}='${aliases[a]}'`);
            continue;
        }
        aliases[a.slice(0, eq)] = a.slice(eq + 1);
    }
    return status;
}

async function unalias(ctx) {
    let status = 0;
    for (const a of ctx.args) {
        if (a === '-a') { ctx.world.aliases = {}; continue; }
        if (ctx.world.aliases[a] === undefined) { ctx.errln(`bash: unalias: ${a}: not found`); status = 1; }
        delete ctx.world.aliases[a];
    }
    return status;
}

async function which(ctx) {
    let status = 0;
    for (const name of ctx.args.filter(a => !a.startsWith('-'))) {
        const spec = ctx.shell.registry.get(name);
        if (spec && !spec.builtin) ctx.outln(`/usr/bin/${name}`);
        else status = 1;
    }
    return status;
}

async function type(ctx) {
    let status = 0;
    for (const name of ctx.args.filter(a => !a.startsWith('-'))) {
        const alias = ctx.world.aliases[name];
        const spec = ctx.shell.registry.get(name);
        if (alias) ctx.outln(`${name} is aliased to \`${alias}'`);
        else if (spec?.builtin) ctx.outln(`${name} is a shell builtin`);
        else if (spec) ctx.outln(`${name} is /usr/bin/${name}`);
        else { ctx.errln(`bash: type: ${name}: not found`); status = 1; }
    }
    return status;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function tzAbbrev(d) {
    try {
        return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')?.value || 'UTC';
    } catch {
        return 'UTC';
    }
}

async function date(ctx) {
    const d = new Date();
    const p = (n, w = 2) => String(n).padStart(w, '0');
    const fmt = ctx.args.find(a => a.startsWith('+'));
    if (fmt) {
        const map = {
            Y: d.getFullYear(), m: p(d.getMonth() + 1), d: p(d.getDate()), e: String(d.getDate()).padStart(2), H: p(d.getHours()),
            M: p(d.getMinutes()), S: p(d.getSeconds()), a: DAYS[d.getDay()], A: DAYS_LONG[d.getDay()], b: MONTHS[d.getMonth()],
            B: MONTHS_LONG[d.getMonth()], y: p(d.getFullYear() % 100), j: p(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5), 3),
            s: Math.floor(d / 1000), Z: tzAbbrev(d), F: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
            T: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`, n: '\n', t: '\t', '%': '%',
        };
        ctx.outln(fmt.slice(1).replace(/%(.)/g, (m, c) => (c in map ? String(map[c]) : m)));
        return 0;
    }
    ctx.outln(`${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${tzAbbrev(d)} ${d.getFullYear()}`);
    return 0;
}

async function sleepCmd(ctx) {
    const secs = Number(String(ctx.args[0] || '').replace(/s$/, ''));
    if (!ctx.args.length || Number.isNaN(secs)) {
        ctx.errln(ctx.args.length ? `sleep: invalid time interval '${ctx.args[0]}'` : 'sleep: missing operand');
        ctx.errln("Try 'sleep --help' for more information.");
        return 1;
    }
    const end = Date.now() + Math.min(secs, 60) * 1000;
    while (Date.now() < end) {
        if (ctx.signal?.aborted) return 130;
        await wait(Math.min(100, end - Date.now()));
    }
    return 0;
}

async function exit(ctx) {
    ctx.outln('exit');
    ctx.info.exit = true;
    return Number(ctx.args[0]) || 0;
}

async function runFile(ctx, name, args) {
    const path = ctx.resolve(name);
    const st = await statOrNull(ctx.pfs, path);
    if (!st) {
        ctx.errln(`bash: ${name}: No such file or directory`);
        return 127;
    }
    if (st.isDirectory()) {
        ctx.errln(`bash: ${name}: Is a directory`);
        return 126;
    }
    const text = await ctx.pfs.readFile(path, 'utf8');
    return ctx.shell.runScript(text.replace(/^#!.*\n/, ''), args, { stdout: ctx.stdout, stderr: ctx.stderr });
}

async function source(ctx) {
    if (!ctx.args.length) {
        ctx.errln(`bash: ${ctx.name}: filename argument required`);
        return 2;
    }
    return runFile(ctx, ctx.args[0], ctx.args.slice(1));
}

async function bash(ctx) {
    const { opts, rest } = getopt(ctx.args, { value: ['c'], bool: ['x', 'e'], stopAtFirstOperand: true });
    if (opts.c !== undefined) return ctx.shell.runScript(opts.c, rest, { stdout: ctx.stdout, stderr: ctx.stderr });
    if (!rest.length) {
        ctx.info.note = 'nested-shell';
        return 0;
    }
    return runFile(ctx, rest[0], rest.slice(1));
}

async function scriptByPath(ctx) {
    const path = ctx.resolve(ctx.name);
    const st = await statOrNull(ctx.pfs, path);
    if (st && st.isFile() && !(st.mode & 0o111)) {
        ctx.errln(`bash: ${ctx.name}: Permission denied`);
        ctx.info.needsChmod = true;
        return 126;
    }
    return runFile(ctx, ctx.name, ctx.args);
}

function simple(output) {
    return async ctx => {
        ctx.outln(typeof output === 'function' ? output(ctx) : output);
        return 0;
    };
}

// ---- help / man ----------------------------------------------------------------------------------

function helpText(spec, { full = false } = {}) {
    const lines = [];
    lines.push(`${spec.name} – ${L(spec.summary)}`);
    if (spec.usage) lines.push('', `${L(D('Aufruf', 'Usage'))}: ${spec.usage}`);
    if (spec.options?.length) {
        lines.push('', L(D('Optionen', 'Options')) + ':');
        const width = Math.max(...spec.options.map(o => (o.flags.join(', ') + (o.arg ? ' ' + o.arg : '')).length));
        for (const o of spec.options) {
            const left = o.flags.join(', ') + (o.arg ? ' ' + o.arg : '');
            lines.push(`  ${left.padEnd(width)}  ${L(o.desc)}`);
        }
    }
    if (full && spec.examples?.length) {
        lines.push('', L(D('Beispiele', 'Examples')) + ':');
        for (const ex of spec.examples) lines.push(`  ${ex.cmd}`, `      ${L(ex.desc)}`);
    }
    return lines.join('\n') + '\n';
}

export function printHelpFor(ctx, spec) {
    ctx.out(helpText(spec));
}

async function help(ctx) {
    const reg = ctx.shell.registry;
    if (ctx.args.length) {
        const spec = reg.get(ctx.args[0]);
        if (!spec) {
            ctx.errln(`bash: help: no help topics match \`${ctx.args[0]}'.  Try \`help help' or \`man -k ${ctx.args[0]}' or \`info ${ctx.args[0]}'.`);
            return 1;
        }
        ctx.out(helpText(spec, { full: true }));
        return 0;
    }
    const groups = [
        ['files', D('Dateien & Ordner', 'Files & folders')],
        ['text', D('Texte anzeigen & bearbeiten', 'Viewing & processing text')],
        ['editor', D('Editor', 'Editor')],
        ['git', D('Versionsverwaltung', 'Version control')],
        ['system', D('Shell & System', 'Shell & system')],
    ];
    const bold = s => (ctx.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
    ctx.outln(bold(L(D('Befehle in der Git-Werkstatt', 'Commands in Git-Werkstatt'))));
    for (const [cat, title] of groups) {
        const specs = reg.specs().filter(s => s.category === cat).sort((a, b) => a.name.localeCompare(b.name));
        if (!specs.length) continue;
        ctx.outln('');
        ctx.outln(bold(L(title)));
        const width = Math.max(...specs.map(s => s.name.length));
        for (const s of specs) ctx.outln(`  ${s.name.padEnd(width)}  ${L(s.summary)}`);
    }
    ctx.outln('');
    ctx.outln(L(D(
        'Mehr zu einem Befehl: man <befehl>  ·  <befehl> --help  ·  git help <befehl>',
        'More about a command: man <command>  ·  <command> --help  ·  git help <command>',
    )));
    return 0;
}

async function man(ctx) {
    const name = ctx.args.filter(a => !a.startsWith('-'))[0];
    if (!name) {
        ctx.errln('What manual page do you want?');
        ctx.errln("For example, try 'man man'.");
        return 1;
    }
    if (name === 'git' && ctx.args[1]) return man({ ...ctx, args: [`git-${ctx.args[1]}`] });
    const reg = ctx.shell.registry;
    let spec = reg.get(name);
    if (!spec && name.startsWith('git-')) spec = reg.gitSpec?.(name.slice(4));
    if (!spec) {
        ctx.errln(`No manual entry for ${name}`);
        return 16;
    }
    const text = helpText(spec, { full: true });
    if (ctx.isTTY && ctx.ui.page) await ctx.ui.page(text, { title: `man ${name}` });
    else ctx.out(text);
    return 0;
}

async function editor(ctx) {
    const names = ctx.args.filter(a => !a.startsWith('-') && !a.startsWith('+'));
    if (!names.length) {
        ctx.errln(lang() === 'de'
            ? `${ctx.name}: Bitte gib eine Datei an, z. B. ${ctx.name} notizen.txt`
            : `${ctx.name}: please name a file, e.g. ${ctx.name} notes.txt`);
        return 1;
    }
    const path = ctx.resolve(names[0]);
    const st = await statOrNull(ctx.pfs, path);
    if (st && st.isDirectory()) {
        ctx.errln(`${ctx.name}: ${names[0]}: Is a directory`);
        return 1;
    }
    if (!ctx.world.canWrite(path) && !st) {
        ctx.errln(`${ctx.name}: ${names[0]}: Permission denied`);
        return 1;
    }
    const parent = await statOrNull(ctx.pfs, path.slice(0, path.lastIndexOf('/')) || '/');
    if (!parent) {
        ctx.errln(`${ctx.name}: ${names[0]}: No such file or directory`);
        return 1;
    }
    ctx.info.edited = path;
    if (!ctx.ui.edit) return 0;
    const result = await ctx.ui.edit(path, { blocking: true, command: ctx.name });
    ctx.info.saved = Boolean(result?.saved);
    return 0;
}

async function hints(ctx) {
    const level = ctx.args[0];
    const valid = ['on', 'off', 'full', 'short'];
    if (level && !valid.includes(level)) {
        ctx.errln('Usage: hints [on|off|full|short]');
        return 2;
    }
    ctx.ui.setCoachLevel?.(level || 'toggle');
    ctx.info.coachLevel = level || 'toggle';
    return 0;
}

export function registerSystemCommands(reg) {
    reg.register({ name: 'clear', aliases: ['reset'], category: 'system', run: clear, usage: 'clear', summary: D('Leert den Bildschirm (Strg+L geht auch).', 'Clears the screen (Ctrl+L works too).') });
    reg.register({ name: 'history', category: 'system', run: history, builtin: true, usage: 'history [N]', summary: D('Zeigt die zuletzt eingegebenen Befehle. !N führt Befehl N erneut aus.', 'Shows previously entered commands. !N runs command N again.'), options: [{ flags: ['-c'], desc: D('Verlauf löschen', 'clear history') }] });
    reg.register({ name: 'env', category: 'system', run: env, usage: 'env', summary: D('Zeigt alle Umgebungsvariablen.', 'Prints all environment variables.') });
    reg.register({ name: 'printenv', category: 'system', run: printenv, usage: 'printenv [NAME]', summary: D('Zeigt Umgebungsvariablen.', 'Prints environment variables.') });
    reg.register({ name: 'export', category: 'system', run: exportCmd, builtin: true, usage: 'export NAME=wert', summary: D('Setzt eine Umgebungsvariable.', 'Sets an environment variable.') });
    reg.register({ name: 'unset', category: 'system', run: unset, builtin: true, usage: 'unset NAME', summary: D('Entfernt eine Variable.', 'Removes a variable.') });
    reg.register({ name: 'alias', category: 'system', run: alias, builtin: true, usage: "alias name='befehl'", summary: D('Legt Abkürzungen für Befehle an.', 'Defines shortcuts for commands.') });
    reg.register({ name: 'unalias', category: 'system', run: unalias, builtin: true, usage: 'unalias name', summary: D('Entfernt eine Abkürzung.', 'Removes an alias.') });
    reg.register({ name: 'which', category: 'system', operands: 'command', run: which, usage: 'which befehl', summary: D('Zeigt, wo ein Programm liegt.', 'Shows where a program is located.') });
    reg.register({ name: 'type', category: 'system', operands: 'command', run: type, builtin: true, usage: 'type befehl', summary: D('Zeigt, was ein Befehlsname bedeutet (Programm, Builtin, Alias).', 'Shows what a command name means (program, builtin, alias).') });
    reg.register({ name: 'whoami', category: 'system', run: simple('student'), usage: 'whoami', summary: D('Zeigt deinen Benutzernamen.', 'Prints your user name.') });
    reg.register({ name: 'hostname', category: 'system', run: simple('werkstatt'), usage: 'hostname', summary: D('Zeigt den Namen des Rechners.', 'Prints the computer name.') });
    reg.register({ name: 'uname', category: 'system', run: simple(ctx => (ctx.args.includes('-a') ? 'Linux werkstatt 6.8.0-werkstatt #1 SMP x86_64 GNU/Linux' : 'Linux')), usage: 'uname [-a]', summary: D('Zeigt das Betriebssystem.', 'Prints the operating system.') });
    reg.register({ name: 'id', category: 'system', run: simple('uid=1000(student) gid=1000(student) groups=1000(student)'), usage: 'id', summary: D('Zeigt Benutzer- und Gruppen-IDs.', 'Prints user and group ids.') });
    reg.register({ name: 'date', category: 'system', run: date, usage: 'date [+FORMAT]', summary: D('Zeigt Datum und Uhrzeit.', 'Prints date and time.') });
    reg.register({ name: 'sleep', category: 'system', run: sleepCmd, usage: 'sleep SEKUNDEN', summary: D('Wartet einige Sekunden.', 'Waits a few seconds.') });
    reg.register({ name: 'true', category: 'system', run: async () => 0, builtin: true, usage: 'true', summary: D('Tut nichts, erfolgreich (Status 0).', 'Does nothing, successfully (status 0).') });
    reg.register({ name: 'false', category: 'system', run: async () => 1, builtin: true, usage: 'false', summary: D('Tut nichts, mit Fehlerstatus 1.', 'Does nothing, with error status 1.') });
    reg.register({ name: 'exit', aliases: ['logout'], category: 'system', run: exit, builtin: true, usage: 'exit', summary: D('Beendet die Shell (hier bleibt das Terminal offen).', 'Exits the shell (the terminal stays open here).') });
    reg.register({ name: 'source', aliases: ['.'], category: 'system', operands: 'file', run: source, builtin: true, usage: 'source datei', summary: D('Führt Befehle aus einer Datei in dieser Shell aus.', 'Runs commands from a file in this shell.') });
    reg.register({ name: 'bash', aliases: ['sh'], category: 'system', operands: 'file', run: bash, usage: 'bash skript.sh', summary: D('Führt ein Shell-Skript aus.', 'Runs a shell script.') });
    reg.register({ name: '__script__', hidden: true, run: scriptByPath });
    reg.register({ name: 'help', category: 'system', operands: 'command', run: help, builtin: true, usage: 'help [befehl]', summary: D('Übersicht aller Befehle.', 'Overview of all commands.') });
    reg.register({ name: 'man', category: 'system', operands: 'command', run: man, usage: 'man befehl', summary: D('Zeigt die Anleitung zu einem Befehl.', 'Shows the manual for a command.') });
    reg.register({ name: 'hints', hidden: true, run: hints, usage: 'hints [on|off]', summary: D('Coach-Erklärungen ein-/ausschalten.', 'Turns coach explanations on/off.') });
    reg.register({
        name: 'nano', aliases: ['vi', 'vim', 'edit', 'code', 'gedit'], category: 'editor', operands: 'file', run: editor,
        usage: 'nano datei',
        summary: D('Öffnet eine Datei im Editor. Speichern: Strg+S, Schließen: Esc.', 'Opens a file in the editor. Save: Ctrl+S, close: Esc.'),
    });
}

export { helpText };
