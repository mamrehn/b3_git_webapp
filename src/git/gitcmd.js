// The `git` command: global options, subcommand dispatch, help, aliases and
// automatic reflog recording around every subcommand.

import { Repo, globalConfigFile } from './repo.js';
import { GitError } from './errors.js';
import { snapshotRefs, recordRefChanges } from './reflog.js';
import { addRegistrar } from '../shell/commands/index.js';
import { helpText } from '../shell/commands/system.js';
import { closest } from '../core/util.js';
import { lang } from '../core/i18n.js';
import { registerBasic } from './commands/basic.js';
import { registerInspect } from './commands/inspect.js';
import { registerBranching } from './commands/branching.js';
import { registerRemote } from './commands/remote.js';
import { registerAdvanced } from './commands/advanced.js';

const subcommands = new Map();
const extraModules = [];

export function defineGit(spec) {
    subcommands.set(spec.name, spec);
    for (const alias of spec.aliases || []) subcommands.set(alias, { ...spec, aliasOf: spec.name });
}

export function addGitModule(register) {
    extraModules.push(register);
}

export function gitSubcommands() {
    return [...subcommands.values()].filter(s => !s.aliasOf && !s.hidden);
}

export function gitSpec(name) {
    return subcommands.get(name) || null;
}

export const GIT_VERSION = '2.53.0';

const COMMON = [
    ['start a working area (see also: git help tutorial)', [['clone', 'Clone a repository into a new directory'], ['init', 'Create an empty Git repository or reinitialize an existing one']]],
    ['work on the current change (see also: git help everyday)', [['add', 'Add file contents to the index'], ['mv', 'Move or rename a file, a directory, or a symlink'], ['restore', 'Restore working tree files'], ['rm', 'Remove files from the working tree and from the index']]],
    ['examine the history and state (see also: git help revisions)', [['diff', 'Show changes between commits, commit and working tree, etc'], ['log', 'Show commit logs'], ['show', 'Show various types of objects'], ['status', 'Show the working tree status']]],
    ['grow, mark and tweak your common history', [['branch', 'List, create, or delete branches'], ['commit', 'Record changes to the repository'], ['merge', 'Join two or more development histories together'], ['rebase', 'Reapply commits on top of another base tip'], ['reset', 'Reset current HEAD to the specified state'], ['switch', 'Switch branches'], ['tag', 'Create, list, delete or verify a tag object signed with GPG']]],
    ['collaborate (see also: git help workflows)', [['fetch', 'Download objects and refs from another repository'], ['pull', 'Fetch from and integrate with another repository or a local branch'], ['push', 'Update remote refs along with associated objects']]],
];

function usageText() {
    let s = 'usage: git [-v | --version] [-h | --help] [-C <path>] [-c <name>=<value>]\n' +
        '           [--exec-path[=<path>]] [--html-path] [--man-path] [--info-path]\n' +
        '           [-p | --paginate | -P | --no-pager] [--no-replace-objects] [--no-lazy-fetch]\n' +
        '           [--no-optional-locks] [--no-advice] [--bare] [--git-dir=<path>]\n' +
        '           [--work-tree=<path>] [--namespace=<name>] [--config-env=<name>=<envvar>]\n' +
        '           <command> [<args>]\n\n' +
        'These are common Git commands used in various situations:\n';
    for (const [title, cmds] of COMMON) {
        s += `\n${title}\n`;
        for (const [name, desc] of cmds) s += `   ${name.padEnd(11)}${desc}\n`;
    }
    s += "\n'git help -a' and 'git help -g' list available subcommands and some\n" +
        "concept guides. See 'git help <command>' or 'git help <concept>'\n" +
        'to read about a specific subcommand or concept.\n' +
        "See 'git help git' for an overview of the system.\n";
    return s;
}

function makeG(ctx, repo, name, args) {
    return {
        ctx,
        repo,
        name,
        args,
        world: ctx.world,
        ui: ctx.ui,
        color: ctx.isTTY,
        columns: ctx.columns,
        lang: lang(),
        info: ctx.info,
        out: s => ctx.out(s),
        err: s => ctx.err(s),
        reflogMessage: null,
        reflogCreated: undefined,
        reflogHandled: false,
    };
}

async function runSubcommand(ctx, name, args, cwdOverride) {
    const spec = subcommands.get(name);
    if (spec.repo === false) {
        const g = makeG(ctx, null, name, args);
        return spec.run(g);
    }
    const start = cwdOverride || ctx.world.cwd;
    const repo = await Repo.open(ctx.world, start);
    if (!repo && spec.repo !== 'optional') {
        throw new GitError('fatal: not a git repository (or any of the parent directories): .git', { status: 128, kind: 'not-a-repo' });
    }
    const g = makeG(ctx, repo, name, args);
    const before = repo ? await snapshotRefs(repo).catch(() => null) : null;
    try {
        return await spec.run(g);
    } finally {
        if (repo && before && !g.reflogHandled) {
            repo.invalidate();
            const after = await snapshotRefs(repo).catch(() => null);
            if (after) await recordRefChanges(repo, before, after, g.reflogMessage || name, g.reflogCreated ? { created: g.reflogCreated } : {});
        }
    }
}

async function gitMain(ctx) {
    let args = [...ctx.args];
    let cwdOverride = null;
    while (args.length && args[0].startsWith('-')) {
        const a = args.shift();
        if (a === '--version' || a === '-v') {
            ctx.out(`git version ${GIT_VERSION}\n`);
            return 0;
        }
        if (a === '--help' || a === '-h') {
            ctx.out(usageText());
            return 0;
        }
        if (a === '-C') {
            const p = args.shift();
            if (!p) { ctx.err('error: no directory given for \'-C\' option\n\n' + usageText()); return 129; }
            cwdOverride = ctx.world.resolve(p);
            continue;
        }
        if (['--no-pager', '-P', '-p', '--paginate', '--no-advice', '--no-optional-locks'].includes(a)) continue;
        if (a === '-c') { args.shift(); continue; }
        ctx.err(`unknown option: ${a}\n${usageText()}`);
        return 129;
    }
    if (!args.length) {
        ctx.out(usageText());
        return 1;
    }
    let name = args.shift();
    ctx.info.git = { sub: name, args };
    if (!subcommands.has(name)) {
        // user-defined alias (git config --global alias.st status)
        const repo = await Repo.open(ctx.world);
        const aliasValue = (repo ? await repo.repoConfig().get(`alias.${name}`) : undefined)
            ?? await globalConfigFile(ctx.world).get(`alias.${name}`);
        if (aliasValue) {
            const expanded = aliasValue.trim().split(/\s+/);
            name = expanded[0];
            args = [...expanded.slice(1), ...args];
            ctx.info.git = { sub: name, args, alias: true };
        }
    }
    if (!subcommands.has(name)) {
        let msg = `git: '${name}' is not a git command. See 'git --help'.\n`;
        const similar = closest(name, [...subcommands.keys()].filter(n => !subcommands.get(n).hidden), 2);
        if (similar.length) {
            msg += `\nThe most similar command${similar.length > 1 ? 's are' : ' is'}\n` + similar.slice(0, 4).map(s => `\t${s}\n`).join('');
        }
        ctx.err(msg);
        ctx.info.git.unknown = name;
        ctx.info.git.similar = similar;
        return 1;
    }
    const spec = subcommands.get(name);
    if (args.includes('--help') || (args.length === 1 && args[0] === '-h')) {
        const text = helpText({ ...spec, name: `git ${spec.aliasOf || spec.name}` }, { full: args.includes('--help') });
        if (args.includes('--help') && ctx.isTTY && ctx.ui.page) await ctx.ui.page(text, { title: `git ${name}` });
        else ctx.out(text);
        return args.includes('-h') ? 129 : 0;
    }
    try {
        const status = await runSubcommand(ctx, name, args, cwdOverride);
        return typeof status === 'number' ? status : 0;
    } catch (e) {
        if (e instanceof GitError) {
            ctx.err(e.message.endsWith('\n') ? e.message : e.message + '\n');
            ctx.info.git.error = { kind: e.kind, message: e.message, data: e.data };
            return e.status;
        }
        throw e;
    }
}

async function gitHelp(g) {
    const topic = g.args.filter(a => !a.startsWith('-'))[0];
    if (!topic || g.args.includes('-a')) {
        g.out(usageText());
        return 0;
    }
    const spec = subcommands.get(topic);
    if (!spec) {
        g.err(`No manual entry for git${topic === 'git' ? '' : '-' + topic}\n`);
        return 1;
    }
    const text = helpText({ ...spec, name: `git ${spec.aliasOf || spec.name}` }, { full: true });
    if (g.ctx.isTTY && g.ui.page) await g.ui.page(text, { title: `git ${topic}` });
    else g.out(text);
    return 0;
}

let registered = false;

export function registerGit() {
    if (registered) return;
    registered = true;
    registerBasic(defineGit);
    registerInspect(defineGit);
    registerBranching(defineGit);
    registerRemote(defineGit);
    registerAdvanced(defineGit);
    for (const register of extraModules) register(defineGit);
    defineGit({ name: 'help', repo: false, run: gitHelp, usage: 'git help <befehl>', summary: { de: 'Zeigt die Anleitung zu einem Git-Befehl.', en: 'Shows the manual for a git command.' } });
    defineGit({ name: 'version', repo: false, run: async g => { g.out(`git version ${GIT_VERSION}\n`); return 0; }, usage: 'git version', summary: { de: 'Zeigt die Git-Version.', en: 'Shows the git version.' } });
    addRegistrar(reg => {
        reg.register({
            name: 'git',
            category: 'git',
            operands: 'git',
            run: gitMain,
            usage: 'git <befehl> [<optionen>]',
            summary: { de: 'Versionsverwaltung: Änderungen speichern, Branches, Zusammenarbeit.', en: 'Version control: record changes, branches, collaboration.' },
        });
        reg.gitSpec = gitSpec;
    });
}
