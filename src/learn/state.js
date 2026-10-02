// A snapshot of everything the coach and the visualisation need to know.
// Taken after every command; two snapshots are compared to explain what happened.

import { git } from '../lib.js';
import { Repo } from '../git/repo.js';
import { computeStatus, aheadBehind } from '../git/status.js';
import { readReflog } from '../git/reflog.js';
import { walk } from '../git/history.js';
import { parseRemoteUrl } from '../git/transport.js';
import { simRepoPath } from '../git/simserver.js';
import { statOrNull, readdirSorted } from '../vfs/fsutil.js';
import { HOME } from '../vfs/world.js';
import { joinPath, basename, firstLine } from '../core/util.js';

const MAX_COMMITS = 250;

async function serverView(world, url) {
    const gitdir = simRepoPath(url);
    if (!gitdir || !(await statOrNull(world.pfs, joinPath(gitdir, 'HEAD')))) return null;
    const names = await git.listBranches({ fs: world.fs, gitdir }).catch(() => []);
    const branches = {};
    for (const n of names) {
        try { branches[n] = await git.resolveRef({ fs: world.fs, gitdir, ref: `refs/heads/${n}` }); } catch { /* skip */ }
    }
    // commits the server has (for the "server" lane of the map)
    const commits = [];
    const seen = new Set();
    const stack = Object.values(branches);
    while (stack.length && commits.length < MAX_COMMITS) {
        const oid = stack.pop();
        if (seen.has(oid)) continue;
        seen.add(oid);
        try {
            const { commit } = await git.readCommit({ fs: world.fs, gitdir, oid });
            commits.push({ oid, parents: commit.parent, subject: firstLine(commit.message), author: commit.author.name, time: commit.committer.timestamp });
            stack.push(...commit.parent);
        } catch { /* missing */ }
    }
    return { gitdir, branches, commits };
}

async function reposInHome(world) {
    const out = [];
    try {
        for (const name of await readdirSorted(world.pfs, HOME)) {
            if (name.startsWith('.')) continue;
            const st = await statOrNull(world.pfs, joinPath(HOME, name, '.git'));
            if (st && st.isDirectory()) out.push(name);
        }
    } catch { /* no home */ }
    return out;
}

// visible folders in the current folder (for "cd …" suggestions)
async function subdirsOf(world, dir) {
    const out = [];
    try {
        for (const name of await readdirSorted(world.pfs, dir)) {
            if (name.startsWith('.')) continue;
            const st = await statOrNull(world.pfs, joinPath(dir, name));
            if (st && st.isDirectory()) out.push(name);
            if (out.length >= 6) break;
        }
    } catch { /* gone */ }
    return out;
}

export async function captureState(world) {
    const state = {
        world: world.id,
        kind: world.kind,
        cwd: world.cwd,
        cwdDisplay: world.displayPath(),
        homeRepos: await reposInHome(world),
        subdirs: await subdirsOf(world, world.cwd),
        repo: null,
        at: Date.now(),
    };
    let repo;
    try {
        repo = await Repo.open(world);
    } catch {
        repo = null;
    }
    if (!repo) return state;
    try {
        state.repo = await captureRepo(world, repo);
    } catch (e) {
        console.error('state capture failed', e);
        state.repo = { dir: repo.dir, name: basename(repo.dir), broken: true, error: e.message };
    }
    return state;
}

async function captureRepo(world, repo) {
    const head = await repo.head();
    const branches = await repo.branches();
    const remotes = (await repo.remotes()).map(r => {
        const info = parseRemoteUrl(r.url);
        return { ...r, kind: info.kind, host: info.host || null };
    });
    const remoteBranches = await repo.remoteBranches();
    const tags = await repo.tags();
    const status = await computeStatus(repo);
    const op = await repo.operation();
    const identity = await repo.identity();

    const upstreams = {};
    for (const b of branches) {
        const up = await repo.upstreamOf(b.name);
        if (!up) continue;
        const upOid = await repo.readRef(up.ref);
        const ab = upOid ? await aheadBehind(repo, b.oid, upOid) : { ahead: 0, behind: 0 };
        upstreams[b.name] = { display: up.display, remote: up.remote, branch: up.branch, gone: !upOid, ...ab };
    }

    const stashEntries = await readReflog(repo, 'refs/stash');
    const stash = [];
    for (const [i, e] of stashEntries.entries()) {
        const base = (await repo.readCommit(e.new).catch(() => null))?.parents?.[0] || null;
        stash.push({ index: i, oid: e.new, message: e.message, base });
    }
    const reflog = (await readReflog(repo, 'HEAD')).slice(0, 30);

    // commits reachable from all refs
    const tips = [head.oid, ...branches.map(b => b.oid), ...remoteBranches.map(r => r.oid), ...tags.map(t => t.commit)].filter(Boolean);
    const walked = tips.length ? await walk(repo, { include: [...new Set(tips)], limit: MAX_COMMITS }) : [];
    const commits = new Map();
    for (const c of walked) {
        commits.set(c.oid, { oid: c.oid, parents: c.parents, subject: firstLine(c.message), message: c.message, author: c.author.name, email: c.author.email, time: c.committer.timestamp });
    }
    // "ghost" commits: recently left behind, only reachable through the reflog
    const orphans = [];
    for (const e of reflog) {
        for (const oid of [e.new, e.old]) {
            if (!oid || /^0+$/.test(oid) || commits.has(oid) || orphans.includes(oid)) continue;
            orphans.push(oid);
        }
    }
    const ghostSet = new Set();
    for (const oid of orphans.slice(0, 12)) {
        let cur = oid;
        for (let i = 0; i < 6 && cur && !commits.has(cur) && !ghostSet.has(cur); i++) {
            const c = await repo.readCommit(cur).catch(() => null);
            if (!c) break;
            ghostSet.add(cur);
            commits.set(cur, { oid: cur, parents: c.parents, subject: firstLine(c.message), message: c.message, author: c.author.name, email: c.author.email, time: c.committer.timestamp, ghost: true });
            cur = c.parents[0];
        }
    }

    const servers = {};
    for (const r of remotes) {
        if (r.kind === 'simulated') servers[r.name] = await serverView(world, r.url);
    }

    let trackedFiles = [];
    try { trackedFiles = await repo.indexFiles(); } catch { /* empty */ }

    return {
        dir: repo.dir,
        name: basename(repo.dir),
        prefix: repo.prefix(),
        head,
        branches,
        upstreams,
        remotes,
        remoteBranches,
        tags: tags.map(t => ({ name: t.name, commit: t.commit, annotated: Boolean(t.annotated) })),
        status,
        op,
        identity,
        stash,
        reflog,
        commits,
        ghosts: [...ghostSet],
        servers,
        trackedFiles,
        conflicts: status.conflicts,
    };
}

// Which commits are reachable from refs (not ghosts)?
export function liveCommits(repoState) {
    return [...repoState.commits.values()].filter(c => !c.ghost);
}
