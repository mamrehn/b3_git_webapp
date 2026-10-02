// Tab completion: commands, paths, git subcommands, branches, remotes, tags, options.

import { looseWords } from './parse.js';
import { Repo } from '../git/repo.js';
import { computeStatus } from '../git/status.js';
import { gitSubcommands, gitSpec } from '../git/gitcmd.js';
import { joinPath } from '../core/util.js';
import { readReflog } from '../git/reflog.js';

function escapeWord(s) {
    return s.replace(/([ \t'"\\$`!*?&;|<>()])/g, '\\$1');
}

async function pathCandidates(world, word, { dirsOnly = false } = {}) {
    const slash = word.lastIndexOf('/');
    const dirPart = slash === -1 ? '' : word.slice(0, slash + 1);
    const prefix = slash === -1 ? word : word.slice(slash + 1);
    const base = dirPart ? world.resolve(dirPart.replace(/^~(?=\/|$)/, world.env.HOME)) : world.cwd;
    let names;
    try {
        names = await world.pfs.readdir(base);
    } catch {
        return [];
    }
    const out = [];
    for (const name of names.sort((a, b) => a.localeCompare(b, 'en'))) {
        if (!name.startsWith(prefix)) continue;
        if (name.startsWith('.') && !prefix.startsWith('.')) continue;
        let isDir = false;
        try { isDir = (await world.pfs.stat(joinPath(base, name))).isDirectory(); } catch { /* ignore */ }
        if (dirsOnly && !isDir) continue;
        out.push({ value: dirPart + escapeWord(name), display: name + (isDir ? '/' : ''), suffix: isDir ? '/' : ' ' });
    }
    if (!prefix && !dirsOnly && dirPart === '' && out.length === 0) return [];
    return out;
}

function optionCandidates(spec, word) {
    const flags = [];
    for (const o of spec?.options || []) for (const f of o.flags) if (f.startsWith('-') && f.startsWith(word)) flags.push(f);
    return [...new Set(flags)].sort().map(f => ({ value: f }));
}

async function gitArgCandidates(world, sub, args, word) {
    const repo = await Repo.open(world);
    if (!repo) return [];
    const branches = async () => (await repo.branches()).map(b => b.name);
    const remoteBranches = async () => (await repo.remoteBranches()).map(b => b.name);
    const remotes = async () => (await repo.remotes()).map(r => r.name);
    const tags = async () => (await repo.tags()).map(t => t.name);
    const pick = list => list.filter(x => x.startsWith(word)).map(value => ({ value }));
    const positional = args.filter(a => !a.startsWith('-'));
    switch (sub) {
        case 'switch':
        case 'checkout': {
            const local = await branches();
            const remote = (await repoRemoteOnly(repo, local));
            const files = sub === 'checkout' && args.includes('--') ? await changedPaths(repo) : [];
            return pick([...local, ...remote, ...files]);
        }
        case 'merge':
        case 'rebase':
        case 'cherry-pick':
        case 'log':
        case 'show':
        case 'reset':
        case 'revert':
        case 'diff':
            if (sub === 'diff' && positional.length === 0) {
                return pick([...(await changedPaths(repo)), ...(await branches()), 'HEAD']);
            }
            if (sub === 'reset' && args.some(a => a === 'HEAD')) return pick(await changedPaths(repo, { staged: true }));
            return pick([...(await branches()), ...(await remoteBranches()), ...(await tags()), 'HEAD', 'HEAD~1', 'ORIG_HEAD']);
        case 'branch':
            return pick([...(await branches()), ...(await remoteBranches())]);
        case 'push':
        case 'pull':
        case 'fetch':
            return positional.length === 0 ? pick(await remotes()) : pick([...(await branches()), ...(await tags())]);
        case 'remote':
            return positional.length === 0 ? pick(['add', 'remove', 'rename', 'set-url', 'get-url', 'show', '-v']) : pick(await remotes());
        case 'tag':
            return pick(await tags());
        case 'stash':
            if (positional.length === 0) return pick(['push', 'pop', 'apply', 'list', 'show', 'drop', 'clear']);
            return pick((await readReflog(repo, 'refs/stash')).map((_, i) => `stash@{${i}}`));
        case 'add':
            return pickPaths(await changedPaths(repo, { untracked: true }), word);
        case 'restore':
            return pickPaths(await changedPaths(repo, { staged: args.includes('--staged') || args.includes('-S') }), word);
        case 'rm':
        case 'mv':
        case 'blame':
            return pickPaths(await repo.indexFiles(), word, repo);
        case 'config':
            return pick(['user.name', 'user.email', 'init.defaultBranch', 'pull.rebase', 'core.editor', 'alias.', '--global', '--list']);
        case 'help':
            return pick(gitSubcommands().map(s => s.name));
        default:
            return null;
    }
}

async function repoRemoteOnly(repo, local) {
    // remote branches without a local counterpart can be checked out by name (DWIM)
    return (await repo.remoteBranches()).map(r => r.branch).filter(b => !local.includes(b));
}

async function changedPaths(repo, { untracked = false, staged = false } = {}) {
    const st = await computeStatus(repo);
    const list = staged ? st.staged.map(s => s.path) : [...st.unstaged.map(s => s.path), ...st.conflicts.map(c => c.path)];
    if (untracked) list.push(...st.untrackedFiles);
    return [...new Set(list)].map(p => repo.displayPath(p));
}

function pickPaths(paths, word) {
    return paths.filter(p => p.startsWith(word)).map(p => ({ value: escapeWord(p), display: p }));
}

export async function complete(shell, line, cursor) {
    const before = line.slice(0, cursor);
    const words = looseWords(before);
    const endsWithSpace = /\s$/.test(before);
    const last = words[words.length - 1];
    const current = endsWithSpace || !last || last.op ? { text: '', start: cursor } : last;
    // words of the current simple command
    const segment = [];
    for (const w of words) {
        if (w.op) segment.length = 0;
        else segment.push(w);
    }
    if (!endsWithSpace && segment.length) segment.pop();
    const word = current.text ?? '';
    const from = current.start ?? cursor;
    const world = shell.world;
    let candidates = [];
    if (!segment.length) {
        const names = new Set([...shell.registry.names(), ...Object.keys(world.aliases)]);
        candidates = [...names].filter(n => n.startsWith(word) && !n.startsWith('__')).sort().map(value => ({ value }));
        if (word.includes('/')) candidates = await pathCandidates(world, word);
        return { from, candidates };
    }
    const cmd = segment[0].text;
    const args = segment.slice(1).map(w => w.text);
    const spec = shell.registry.get(cmd);
    if (cmd === 'git') {
        if (!args.length) {
            candidates = gitSubcommands().map(s => s.name).filter(n => n.startsWith(word)).sort().map(value => ({ value }));
            return { from, candidates };
        }
        const sub = args[0];
        if (word.startsWith('-')) return { from, candidates: optionCandidates(gitSpec(sub), word) };
        const res = await gitArgCandidates(world, sub, args.slice(1), word);
        if (res) {
            // also offer paths when nothing git-specific matches
            candidates = res.length ? res : await pathCandidates(world, word);
            return { from, candidates };
        }
        return { from, candidates: await pathCandidates(world, word) };
    }
    if (word.startsWith('-') && spec) return { from, candidates: optionCandidates(spec, word) };
    if (spec?.operands === 'command') {
        return { from, candidates: shell.registry.names().filter(n => n.startsWith(word)).map(value => ({ value })) };
    }
    return { from, candidates: await pathCandidates(world, word, { dirsOnly: spec?.operands === 'dir' }) };
}
