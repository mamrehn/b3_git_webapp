// Helpers shared by git subcommands.

import { git } from '../../lib.js';
import { GitError, fatal } from '../errors.js';
import { signature } from '../clock.js';
import { countChanges, formatStat, summaryLine } from '../diffutil.js';
import { findBlockers, checkoutPaths } from '../merge.js';
import { shortOid, firstLine } from '../../core/util.js';
import { aheadBehind } from '../status.js';

export const C = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    reset: '\x1b[m',
};

export function paint(g, color, text) {
    return g.color ? `${color}${text}${C.reset}` : text;
}

export async function requireIdentity(repo) {
    const id = await repo.identity();
    if (id) return id;
    throw new GitError(
        'Author identity unknown\n\n' +
        '*** Please tell me who you are.\n\n' +
        'Run\n\n' +
        '  git config --global user.email "you@example.com"\n' +
        '  git config --global user.name "Your Name"\n\n' +
        "to set your account's default identity.\n" +
        'Omit --global to set the identity only in this repository.\n\n' +
        "fatal: unable to auto-detect email address (got 'student@werkstatt.(none)')",
        { status: 128, kind: 'identity' },
    );
}

export async function writeCommit(repo, { tree, parents, message, author, committer }) {
    return git.commit({
        fs: repo.fs,
        dir: repo.dir,
        gitdir: repo.gitdir,
        tree,
        parent: parents,
        message,
        author,
        committer: committer || author,
        noUpdateBranch: true,
        cache: repo.cache,
    });
}

function sigLine(s) {
    const east = -(s.timezoneOffset || 0);
    const tz = `${east >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(east) / 60)).padStart(2, '0')}${String(Math.abs(east) % 60).padStart(2, '0')}`;
    return `${s.name} <${s.email}> ${s.timestamp} ${tz}`;
}

// Writes a commit object byte-for-byte (isomorphic-git always appends a newline to messages)
export async function writeRawCommit(repo, { tree, parents, author, committer, message }) {
    const text = `tree ${tree}\n${parents.map(p => `parent ${p}\n`).join('')}author ${sigLine(author)}\ncommitter ${sigLine(committer || author)}\n\n${message}`;
    return git.writeObject({ fs: repo.fs, gitdir: repo.gitdir, type: 'commit', format: 'content', object: new TextEncoder().encode(text) });
}

export async function newSignature(repo) {
    return signature(await requireIdentity(repo));
}

// Changes between two trees: [{ path, status: 'A'|'M'|'D', a, b }]
export async function treeChanges(repo, oldTree, newTree, { pathFilter = null } = {}) {
    const a = oldTree ? await repo.flatTree(oldTree) : new Map();
    const b = newTree ? await repo.flatTree(newTree) : new Map();
    const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
    const out = [];
    for (const path of paths) {
        if (pathFilter && !pathFilter(path)) continue;
        const x = a.get(path);
        const y = b.get(path);
        if (x && y && x.oid === y.oid && x.mode === y.mode) continue;
        out.push({ path, status: !x ? 'A' : !y ? 'D' : 'M', a: x || null, b: y || null });
    }
    return out;
}

export async function statsFor(repo, changes) {
    const stats = [];
    for (const ch of changes) {
        const aBytes = ch.a ? await repo.readBlob(ch.a.oid) : null;
        const bBytes = ch.b ? await repo.readBlob(ch.b.oid) : null;
        stats.push({ path: ch.path, ...countChanges(aBytes, bBytes) });
    }
    return stats;
}

// "[main abc1234] Message" + " 1 file changed, …" + " create mode 100644 x"
export async function printCommitSummary(g, repo, oid, { root = false, branchLabel = null, showDate = false } = {}) {
    const commit = await repo.readCommit(oid);
    const head = await repo.head();
    const label = branchLabel || (head.branch ? head.branch : 'detached HEAD');
    g.out(`[${label}${root ? ' (root-commit)' : ''} ${shortOid(oid)}] ${firstLine(commit.message)}\n`);
    // git prints the author date for amend/-C commits and always for cherry-pick/revert
    if (showDate) {
        const { formatGitDate } = await import('../../core/util.js');
        g.out(` Date: ${formatGitDate(commit.author.timestamp, commit.author.timezoneOffset)}\n`);
    }
    if (commit.parents.length > 1) return { changes: [], insertions: 0, deletions: 0 }; // git shows no stat for merges
    const parentTree = commit.parents.length ? (await repo.readCommit(commit.parents[0])).tree : null;
    const changes = await treeChanges(repo, parentTree, commit.tree);
    const stats = await statsFor(repo, changes);
    const ins = stats.reduce((s, x) => s + x.insertions, 0);
    const del = stats.reduce((s, x) => s + x.deletions, 0);
    g.out(summaryLine(changes.length, ins, del) + '\n');
    for (const ch of changes) {
        if (ch.status === 'A') g.out(` create mode ${ch.b.mode} ${ch.path}\n`);
        else if (ch.status === 'D') g.out(` delete mode ${ch.a.mode} ${ch.path}\n`);
        else if (ch.a.mode !== ch.b.mode) g.out(` mode change ${ch.a.mode} => ${ch.b.mode} ${ch.path}\n`);
    }
    return { changes, insertions: ins, deletions: del };
}

export async function printDiffStat(g, repo, oldTree, newTree) {
    const changes = await treeChanges(repo, oldTree, newTree);
    if (!changes.length) return;
    g.out(formatStat(await statsFor(repo, changes), { color: g.color, width: g.columns }));
    for (const ch of changes) {
        if (ch.status === 'A') g.out(` create mode ${ch.b.mode} ${ch.path}\n`);
        else if (ch.status === 'D') g.out(` delete mode ${ch.a.mode} ${ch.path}\n`);
    }
}

// Move work tree + index from the current HEAD tree to `targetOid`'s tree, keeping
// unrelated local changes (like `git switch`/`git checkout`). Throws git's error
// when local changes would be overwritten.
export async function updateWorkTree(repo, targetOid, { force = false, action = 'checkout' } = {}) {
    const head = await repo.head();
    const ours = head.oid ? await repo.flatTree((await repo.readCommit(head.oid)).tree) : new Map();
    const target = targetOid ? await repo.flatTree((await repo.readCommit(targetOid)).tree) : new Map();
    const touched = [];
    for (const path of new Set([...ours.keys(), ...target.keys()])) {
        const a = ours.get(path);
        const b = target.get(path);
        if (!(a && b && a.oid === b.oid && a.mode === b.mode) && (a || b)) touched.push(path);
    }
    touched.sort();
    if (!force) {
        const { local, untracked } = await findBlockers(repo, touched, ours);
        const conflicts = await repo.conflicts();
        if (Object.keys(conflicts).length) {
            throw new GitError(
                'error: you need to resolve your current index first\n' +
                Object.keys(conflicts).map(p => `${p}: needs merge`).join('\n'),
                { status: 1, kind: 'unresolved-conflicts' },
            );
        }
        if (local.length) {
            const verb = action === 'merge' ? 'merge' : 'checkout';
            const hint = action === 'merge'
                ? 'Please commit your changes or stash them before you merge.'
                : 'Please commit your changes or stash them before you switch branches.';
            throw new GitError(
                `error: Your local changes to the following files would be overwritten by ${verb}:\n` +
                local.map(p => `\t${p}`).join('\n') + `\n${hint}\nAborting`,
                { status: 1, kind: 'local-changes', data: { files: local } },
            );
        }
        if (untracked.length) {
            const verb = action === 'merge' ? 'merge' : 'checkout';
            throw new GitError(
                `error: The following untracked working tree files would be overwritten by ${verb}:\n` +
                untracked.map(p => `\t${p}`).join('\n') +
                `\nPlease move or remove them before you ${action === 'merge' ? 'merge' : 'switch branches'}.\nAborting`,
                { status: 1, kind: 'untracked-overwrite', data: { files: untracked } },
            );
        }
    }
    await checkoutPaths(repo, target, touched);
    return touched;
}

// Lines like "M\tindex.html" that git prints after switching with local changes
export async function localChangeLines(repo) {
    const { computeStatus } = await import('../status.js');
    const st = await computeStatus(repo);
    const lines = [];
    const seen = new Set();
    for (const e of st.entries) {
        if (e.x === '?' || seen.has(e.path)) continue;
        seen.add(e.path);
        const code = e.y !== ' ' ? e.y : e.x;
        lines.push(`${code === 'A' ? 'A' : code}\t${repo.displayPath(e.path)}`);
    }
    return lines;
}

// "Your branch is ahead of 'origin/main' by 1 commit." and friends
export async function trackingInfo(repo, branch, { advice = true } = {}) {
    const up = await repo.upstreamOf(branch);
    if (!up) return null;
    const local = await repo.readRef(`refs/heads/${branch}`);
    const remote = await repo.readRef(up.ref);
    if (!remote) {
        return { up, gone: true, text: `Your branch is based on '${up.display}', but the upstream is gone.\n` + (advice ? '  (use "git branch --unset-upstream" to fixup)\n' : '') };
    }
    const { ahead, behind } = await aheadBehind(repo, local, remote);
    const commits = n => `${n} commit${n === 1 ? '' : 's'}`;
    let text;
    if (!ahead && !behind) text = `Your branch is up to date with '${up.display}'.\n`;
    else if (ahead && !behind) text = `Your branch is ahead of '${up.display}' by ${commits(ahead)}.\n` + (advice ? '  (use "git push" to publish your local commits)\n' : '');
    else if (!ahead && behind) text = `Your branch is behind '${up.display}' by ${commits(behind)}, and can be fast-forwarded.\n` + (advice ? '  (use "git pull" to update your local branch)\n' : '');
    else text = `Your branch and '${up.display}' have diverged,\nand have ${ahead} and ${behind} different commits each, respectively.\n` + (advice ? '  (use "git pull" if you want to integrate the remote branch with yours)\n' : '');
    return { up, ahead, behind, text };
}

export function usage(text) {
    return new GitError(text, { status: 129, kind: 'usage' });
}

export { fatal, GitError };
