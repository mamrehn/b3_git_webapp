// Commit traversal (git log / rev-list), topological order, the ASCII graph of
// `git log --graph`, and ref decorations — modelled on git's revision.c/graph.c.

function padVisible(s, width) {
    const visible = s.replace(/\x1b\[[0-9;]*m/g, '').length;
    return visible < width ? s + ' '.repeat(width - visible) : s;
}

const GRAPH_COLORS = ['\x1b[31m', '\x1b[32m', '\x1b[33m', '\x1b[34m', '\x1b[35m', '\x1b[36m', '\x1b[1;31m', '\x1b[1;32m', '\x1b[1;33m', '\x1b[1;34m', '\x1b[1;35m', '\x1b[1;36m'];

async function readSafe(repo, oid) {
    try {
        return await repo.readCommit(oid);
    } catch {
        return null; // shallow clone boundary
    }
}

async function reachableSet(repo, tips) {
    const seen = new Set();
    const stack = [...tips];
    while (stack.length) {
        const oid = stack.pop();
        if (!oid || seen.has(oid)) continue;
        seen.add(oid);
        const c = await readSafe(repo, oid);
        if (c) stack.push(...c.parents);
    }
    return seen;
}

// Date-ordered walk from `include`, excluding everything reachable from `exclude`.
export async function walk(repo, { include, exclude = [], firstParent = false, limit = Infinity }) {
    const excluded = exclude.length ? await reachableSet(repo, exclude) : new Set();
    const queue = [];
    const seen = new Set();
    let order = 0;
    const push = async oid => {
        if (!oid || seen.has(oid) || excluded.has(oid)) return;
        seen.add(oid);
        const c = await readSafe(repo, oid);
        if (c) queue.push({ c, t: c.committer?.timestamp ?? 0, n: order++ });
    };
    for (const oid of include) await push(oid);
    const out = [];
    while (queue.length && out.length < limit) {
        let best = 0;
        for (let i = 1; i < queue.length; i++) {
            const a = queue[i];
            const b = queue[best];
            if (a.t > b.t || (a.t === b.t && a.n < b.n)) best = i;
        }
        const { c } = queue.splice(best, 1)[0];
        out.push(c);
        const parents = firstParent ? c.parents.slice(0, 1) : c.parents;
        for (const p of parents) await push(p);
    }
    return out;
}

// git's REV_SORT_IN_GRAPH_ORDER: children before parents, branch lines kept together.
export function topoOrder(commits, { firstParent = false } = {}) {
    const byOid = new Map(commits.map(c => [c.oid, c]));
    const indegree = new Map(commits.map(c => [c.oid, 0]));
    const parentsOf = c => (firstParent ? c.parents.slice(0, 1) : c.parents).filter(p => byOid.has(p));
    for (const c of commits) for (const p of parentsOf(c)) indegree.set(p, indegree.get(p) + 1);
    const stack = commits.filter(c => indegree.get(c.oid) === 0).reverse();
    const out = [];
    while (stack.length) {
        const c = stack.pop();
        out.push(c);
        for (const p of parentsOf(c)) {
            const n = indegree.get(p) - 1;
            indegree.set(p, n);
            if (n === 0) stack.push(byOid.get(p));
        }
    }
    return out;
}

// For each commit (in display order): { head, transitions[], pad } graph prefixes.
export function graphRows(commits, { color = false, firstParent = false } = {}) {
    const inSet = new Set(commits.map(c => c.oid));
    const paint = (s, col) => (color && s.trim() ? `${GRAPH_COLORS[col % GRAPH_COLORS.length]}${s}\x1b[m` : s);
    let cols = [];
    const rows = [];
    for (const c of commits) {
        let i = cols.indexOf(c.oid);
        if (i === -1) {
            cols.push(c.oid);
            i = cols.length - 1;
        }
        const parents = (firstParent ? c.parents.slice(0, 1) : c.parents).filter(p => inSet.has(p));
        const next = cols.slice();
        const newCols = [];
        if (!parents.length) {
            next.splice(i, 1);
        } else {
            next[i] = parents[0];
            let at = i + 1;
            for (const p of parents.slice(1)) {
                if (next.includes(p)) continue;
                next.splice(at, 0, p);
                newCols.push(at);
                at++;
            }
        }
        // commit line
        const width = Math.max(cols.length, next.length);
        let head = '';
        for (let j = 0; j < cols.length; j++) head += (j === i ? '*' : paint('|', j)) + ' ';
        if (newCols.length) head = padVisible(head, width * 2);
        const transitions = [];
        if (newCols.length) {
            // "|\" – the new parent column branches off to the right of the commit
            let line = '';
            for (let j = 0; j < cols.length; j++) {
                if (j === i) line += paint('|', j) + paint('\\', newCols[0]) + (newCols.length > 1 ? paint('\\', newCols[1]) : ' ');
                else if (j < i) line += paint('|', j) + ' ';
                else line += paint('\\', j + newCols.length) + ' ';
            }
            transitions.push(padVisible(line, width * 2));
        }
        // collapse columns that now wait for the same commit ("|/")
        let collapsed = true;
        while (collapsed) {
            collapsed = false;
            for (let a = 0; a < next.length && !collapsed; a++) {
                for (let b = a + 1; b < next.length; b++) {
                    if (next[a] === next[b]) {
                        // "|/": the merging column's slash sits directly next to the column it joins
                        let line = '';
                        for (let j = 0; j < next.length; j++) {
                            if (j >= b) line += paint('/', j) + ' ';
                            else line += paint('|', j) + (j === b - 1 ? '' : ' ');
                        }
                        transitions.push(padVisible(line, Math.max(cols.length, next.length) * 2));
                        next.splice(b, 1);
                        collapsed = true;
                        break;
                    }
                }
            }
        }
        cols = next;
        let pad = '';
        for (let j = 0; j < cols.length; j++) pad += paint('|', j) + ' ';
        // text lines of this commit are padded to the commit line's width; the blank
        // separator before the next commit uses the narrower, settled width (as git does)
        rows.push({ head, transitions, pad: padVisible(pad, width * 2), sep: pad, width: width * 2 });
    }
    return rows;
}

// ---- decorations -----------------------------------------------------------------------

export async function decorationMap(repo) {
    const refs = [];
    for (const b of await repo.branches()) refs.push({ full: `refs/heads/${b.name}`, name: b.name, kind: 'branch', oid: b.oid });
    for (const r of await repo.remoteBranches()) refs.push({ full: `refs/remotes/${r.name}`, name: r.name, kind: 'remote', oid: r.oid });
    for (const { name: remote } of await repo.remotes()) {
        const target = await repo.remoteHead(remote);
        if (target) {
            const oid = await repo.readRef(`refs/remotes/${remote}/${target}`);
            if (oid) refs.push({ full: `refs/remotes/${remote}/HEAD`, name: `${remote}/HEAD`, kind: 'remote', oid });
        }
    }
    for (const t of await repo.tags()) refs.push({ full: `refs/tags/${t.name}`, name: t.name, kind: 'tag', oid: t.commit });
    const stash = await repo.readRef('refs/stash');
    if (stash) refs.push({ full: 'refs/stash', name: 'refs/stash', kind: 'stash', oid: stash });
    refs.sort((a, b) => (a.full < b.full ? -1 : a.full > b.full ? 1 : 0)).reverse();
    const head = await repo.head();
    const map = new Map();
    for (const r of refs) {
        if (!map.has(r.oid)) map.set(r.oid, []);
        map.get(r.oid).push(r);
    }
    return { map, head };
}

export function formatDecoration(oid, { map, head }, { color = false } = {}) {
    const list = (map.get(oid) || []).slice();
    const Y = color ? '\x1b[33m' : '';
    const R = color ? '\x1b[m' : '';
    const C = { head: '\x1b[1;36m', branch: '\x1b[1;32m', remote: '\x1b[1;31m', tag: '\x1b[1;33m', stash: '\x1b[1;35m' };
    const part = (kind, text) => (color ? `${C[kind]}${text}${R}` : text);
    const items = [];
    if (head.oid === oid) {
        if (head.branch) {
            const idx = list.findIndex(r => r.kind === 'branch' && r.name === head.branch);
            if (idx !== -1) list.splice(idx, 1);
            items.push(`${part('head', 'HEAD')}${Y} -> ${R}${part('branch', head.branch)}`);
        } else {
            items.push(part('head', 'HEAD'));
        }
    }
    for (const r of list) {
        if (r.kind === 'tag') items.push(color ? `${C.tag}tag: ${R}${C.tag}${r.name}${R}` : `tag: ${r.name}`);
        else items.push(part(r.kind, r.name));
    }
    if (!items.length) return '';
    return `${Y} (${R}${items.join(`${Y}, ${R}`)}${Y})${R}`;
}

export { reachableSet };
