// Compare two state snapshots and describe what changed as a list of events.
// Working from the *result* (not the command text) means every valid way of doing
// something is explained correctly – `git switch -c x` and `git checkout -b x` alike.

function names(list) {
    return new Set(list.map(x => x.path || x));
}

function branchMap(repo) {
    return new Map((repo?.branches || []).map(b => [b.name, b.oid]));
}

function reachable(commits, tips) {
    const seen = new Set();
    const stack = [...tips];
    while (stack.length) {
        const oid = stack.pop();
        if (!oid || seen.has(oid)) continue;
        seen.add(oid);
        const c = commits.get(oid);
        if (c) stack.push(...c.parents);
    }
    return seen;
}

function isAncestorIn(commits, ancestor, descendant) {
    return reachable(commits, [descendant]).has(ancestor);
}

export function diffStates(prev, next, run = {}) {
    const ev = [];
    const p = prev?.repo || null;
    const n = next?.repo || null;

    if (prev && next && prev.cwd !== next.cwd) {
        ev.push({
            type: 'cwd',
            from: prev.cwdDisplay,
            to: next.cwdDisplay,
            enteredRepo: n && (!p || p.dir !== n.dir) ? n.name : null,
            leftRepo: p && (!n || p.dir !== n.dir) ? p.name : null,
        });
    }
    if (!n) return ev;
    if (!p || p.dir !== n.dir) {
        if (!p && run.gitSub === 'init') ev.push({ type: 'repo-created', name: n.name });
        if (run.gitSub === 'clone') ev.push({ type: 'cloned', name: n.name });
        return ev; // a different repository: no meaningful diff
    }

    // ---- files ---------------------------------------------------------------------------------
    const ps = p.status;
    const ns = n.status;
    const pUntracked = names(ps.untrackedFiles);
    const nUntracked = names(ns.untrackedFiles);
    const pUnstaged = new Map(ps.unstaged.map(u => [u.path, u.kind]));
    const nUnstaged = new Map(ns.unstaged.map(u => [u.path, u.kind]));
    const pStaged = new Map(ps.staged.map(s => [s.path, s.kind]));
    const nStaged = new Map(ns.staged.map(s => [s.path, s.kind]));
    const pConf = names(ps.conflicts);
    const nConf = names(ns.conflicts);

    const created = [...nUntracked].filter(f => !pUntracked.has(f) && !pStaged.has(f));
    const modified = [...nUnstaged].filter(([f, k]) => k === 'modified' && pUnstaged.get(f) !== 'modified').map(([f]) => f);
    const deleted = [...nUnstaged].filter(([f, k]) => k === 'deleted' && pUnstaged.get(f) !== 'deleted').map(([f]) => f);
    if (created.length) ev.push({ type: 'files-created', files: created });
    if (modified.length) ev.push({ type: 'files-modified', files: modified });
    if (deleted.length) ev.push({ type: 'files-deleted', files: deleted });

    const newCommits = [...n.commits.values()].filter(c => !c.ghost && !p.commits.has(c.oid));
    const headMoved = p.head.oid !== n.head.oid;

    const staged = [...nStaged].filter(([f, k]) => pStaged.get(f) !== k && !(headMoved && newCommits.length)).map(([f, k]) => ({ path: f, kind: k }));
    if (staged.length && !newCommits.length) ev.push({ type: 'staged', files: staged });
    const unstaged = [...pStaged.keys()].filter(f => !nStaged.has(f) && !newCommits.length && (nUnstaged.has(f) || nUntracked.has(f)));
    if (unstaged.length && !headMoved) ev.push({ type: 'unstaged', files: unstaged });

    // Uncommitted work that a *discarding* git command threw away (restore, reset --hard …).
    // Editing a file back by hand is not data loss, so only these commands count.
    const DISCARDING = ['restore', 'checkout', 'reset', 'switch', 'clean', 'rm'];
    if (DISCARDING.includes(run.gitSub) && n.stash.length <= p.stash.length) {
        const lost = new Set();
        for (const [f] of pUnstaged) if (!nUnstaged.has(f) && !nStaged.has(f) && !nConf.has(f)) lost.add(f);
        for (const [f] of pStaged) if (!nStaged.has(f) && !nUnstaged.has(f) && !nUntracked.has(f)) lost.add(f);
        if (lost.size) ev.push({ type: 'changes-discarded', files: [...lost] });
    }
    // untracked files that disappeared (rm, git clean): gone for good, git never had them
    const removedUntracked = [...pUntracked].filter(f => !nUntracked.has(f) && !nStaged.has(f) && !nUnstaged.has(f) && !n.trackedFiles.includes(f));
    if (removedUntracked.length && run.gitSub !== 'add' && run.gitSub !== 'stash') ev.push({ type: 'untracked-removed', files: removedUntracked });

    // ---- conflicts / operations -------------------------------------------------------------------
    const newConflicts = [...nConf].filter(f => !pConf.has(f));
    const resolved = [...pConf].filter(f => !nConf.has(f));
    if (newConflicts.length) ev.push({ type: 'conflict', files: newConflicts, op: n.op?.kind || run.gitSub });
    // resolved = marked with git add/rm, or gone while the operation goes on (not: aborted, reset --merge)
    if (resolved.length && (n.op || run.gitSub === 'add' || run.gitSub === 'rm')) ev.push({ type: 'conflict-resolved', files: resolved, remaining: [...nConf] });
    if (p.op && !n.op) ev.push({ type: 'operation-finished', op: p.op.kind, aborted: run.args?.includes('--abort') || false });

    // ---- commits and refs ----------------------------------------------------------------------------
    const pb = branchMap(p);
    const nb = branchMap(n);
    for (const [name, oid] of nb) {
        if (!pb.has(name)) ev.push({ type: 'branch-created', name, oid });
    }
    for (const [name, oid] of pb) {
        if (!nb.has(name)) ev.push({ type: 'branch-deleted', name, oid });
    }
    const allCommits = new Map([...p.commits, ...n.commits]);
    for (const [name, oid] of nb) {
        const old = pb.get(name);
        if (!old || old === oid) continue;
        const forward = isAncestorIn(allCommits, old, oid);
        const backward = !forward && isAncestorIn(allCommits, oid, old);
        ev.push({ type: 'branch-moved', name, from: old, to: oid, direction: forward ? 'forward' : backward ? 'backward' : 'rewrite' });
    }

    if (newCommits.length) {
        const ordered = newCommits.slice().sort((a, b) => a.time - b.time);
        ev.push({ type: 'commits', commits: ordered.map(c => ({ oid: c.oid, subject: c.subject, parents: c.parents, author: c.author })), onBranch: n.head.branch });
    }

    if (p.head.branch !== n.head.branch || p.head.detached !== n.head.detached) {
        if (n.head.detached) ev.push({ type: 'detached', oid: n.head.oid, from: p.head.branch });
        else if (p.head.detached) ev.push({ type: 'reattached', to: n.head.branch });
        else ev.push({ type: 'switched', from: p.head.branch, to: n.head.branch });
    } else if (n.head.detached && headMoved && !newCommits.length) {
        ev.push({ type: 'detached', oid: n.head.oid, from: null });
    }

    // commits that are no longer reachable from any ref
    const pLive = [...p.commits.values()].filter(c => !c.ghost).map(c => c.oid);
    const nLive = new Set([...n.commits.values()].filter(c => !c.ghost).map(c => c.oid));
    const orphaned = pLive.filter(oid => !nLive.has(oid));
    if (orphaned.length) ev.push({ type: 'orphaned', oids: orphaned, subjects: orphaned.map(o => p.commits.get(o)?.subject) });

    // ---- tags, stash, remotes ------------------------------------------------------------------------
    const pt = new Set(p.tags.map(t => t.name));
    const nt = new Set(n.tags.map(t => t.name));
    for (const t of n.tags) if (!pt.has(t.name)) ev.push({ type: 'tag-created', name: t.name, oid: t.commit, annotated: t.annotated });
    for (const t of p.tags) if (!nt.has(t.name)) ev.push({ type: 'tag-deleted', name: t.name });

    if (n.stash.length > p.stash.length) ev.push({ type: 'stash-pushed', message: n.stash[0]?.message });
    else if (n.stash.length < p.stash.length) ev.push({ type: 'stash-removed', count: p.stash.length - n.stash.length, applied: run.args?.[0] === 'pop' });

    const pr = new Set(p.remotes.map(r => r.name));
    const nr = new Set(n.remotes.map(r => r.name));
    for (const r of n.remotes) if (!pr.has(r.name)) ev.push({ type: 'remote-added', name: r.name, url: r.url, kind: r.kind });
    for (const r of p.remotes) if (!nr.has(r.name)) ev.push({ type: 'remote-removed', name: r.name });

    const prb = new Map(p.remoteBranches.map(r => [r.name, r.oid]));
    const updatedRemote = [];
    for (const r of n.remoteBranches) {
        const old = prb.get(r.name);
        if (old !== r.oid) {
            const count = old ? [...reachable(allCommits, [r.oid])].filter(o => !reachable(allCommits, [old]).has(o)).length : null;
            updatedRemote.push({ name: r.name, from: old || null, to: r.oid, newCommits: count });
        }
    }
    if (updatedRemote.length) ev.push({ type: 'remote-tracking-updated', branches: updatedRemote });

    // upstream relationship of the current branch
    const pu = p.head.branch ? p.upstreams[p.head.branch] : null;
    const nu = n.head.branch ? n.upstreams[n.head.branch] : null;
    if (nu && (!pu || pu.ahead !== nu.ahead || pu.behind !== nu.behind) && (pu || run.gitSub === 'push' || run.gitSub === 'branch')) {
        ev.push({ type: 'tracking', branch: n.head.branch, upstream: nu.display, ahead: nu.ahead, behind: nu.behind });
    }
    if (nu && !pu) ev.push({ type: 'upstream-set', branch: n.head.branch, upstream: nu.display });

    if (!p.identity && n.identity) ev.push({ type: 'identity-set', name: n.identity.name });
    return ev;
}

export { reachable, isAncestorIn };
