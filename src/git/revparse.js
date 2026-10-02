// Revision syntax: HEAD, @, branch, tag, origin/main, abc1234, HEAD~2, HEAD^2,
// main@{1}, HEAD@{3}, @{u}, ORIG_HEAD, v1.0^{commit} …
// resolve() returns { oid, type } or null; callers word the error like real git does.

import { git } from '../lib.js';
import { readReflog } from './reflog.js';

const SPECIAL = ['HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'FETCH_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'];

function splitSpec(spec) {
    // base may contain @{…}; suffix is a sequence of ~N, ^N, ^{type}
    let depth = 0;
    for (let i = 0; i < spec.length; i++) {
        const c = spec[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (depth === 0 && (c === '~' || c === '^')) return [spec.slice(0, i), spec.slice(i)];
    }
    return [spec, ''];
}

export async function resolveRefName(repo, name) {
    // returns { ref, oid } for a symbolic name following git's lookup order
    if (SPECIAL.includes(name)) {
        if (name === 'HEAD') {
            const head = await repo.head();
            return head.oid ? { ref: 'HEAD', oid: head.oid } : null;
        }
        const oid = await repo.readSpecial(name);
        return oid ? { ref: name, oid } : null;
    }
    const candidates = name.startsWith('refs/')
        ? [name]
        : [`refs/${name}`, `refs/tags/${name}`, `refs/heads/${name}`, `refs/remotes/${name}`, `refs/remotes/${name}/HEAD`];
    for (const ref of candidates) {
        const oid = await repo.readRef(ref);
        if (oid) return { ref, oid };
    }
    return null;
}

async function resolveBase(repo, base) {
    if (base === '' || base === '@') base = 'HEAD';
    const at = base.match(/^(.*)@\{(.+)\}$/);
    if (at) {
        const [, refPart, selector] = at;
        let branch = refPart;
        if (refPart === '' || refPart === 'HEAD') branch = null;
        if (/^(u|upstream|push)$/i.test(selector)) {
            const head = await repo.head();
            const b = branch || head.branch;
            if (!b) return { error: 'HEAD does not point to a branch' };
            const up = await repo.upstreamOf(b);
            if (!up) return { error: `no upstream configured for branch '${b}'` };
            const oid = await repo.readRef(up.ref);
            return oid ? { oid } : null;
        }
        if (/^-?\d+$/.test(selector)) {
            const n = Number(selector);
            if (n < 0) return null;
            const ref = branch ? (branch.startsWith('refs/') ? branch : `refs/heads/${branch}`) : 'HEAD';
            const entries = await readReflog(repo, ref);
            if (n === 0 && !entries.length) {
                const r = await resolveRefName(repo, branch || 'HEAD');
                return r ? { oid: r.oid } : null;
            }
            if (n >= entries.length) return { error: `log for '${branch || 'HEAD'}' only has ${entries.length} entries` };
            return { oid: entries[n].new };
        }
        return null;
    }
    const named = await resolveRefName(repo, base);
    if (named) return { oid: named.oid, ref: named.ref };
    if (/^[0-9a-f]{4,40}$/i.test(base)) {
        try {
            const oid = await git.expandOid({ fs: repo.fs, gitdir: repo.gitdir, oid: base.toLowerCase(), cache: repo.cache });
            return { oid };
        } catch (e) {
            if (/ambiguous/i.test(e.message)) return { error: `short object ID ${base} is ambiguous` };
            return null;
        }
    }
    return null;
}

async function peel(repo, oid, want) {
    let cur = oid;
    for (let i = 0; i < 10; i++) {
        const type = await repo.objectType(cur);
        if (!type) return null;
        if (want === 'any' || type === want) return { oid: cur, type };
        if (type === 'tag') {
            const { tag } = await git.readTag({ fs: repo.fs, gitdir: repo.gitdir, oid: cur, cache: repo.cache });
            cur = tag.object;
            continue;
        }
        if (type === 'commit' && want === 'tree') {
            return { oid: (await repo.readCommit(cur)).tree, type: 'tree' };
        }
        return null;
    }
    return null;
}

// Resolve to an object; by default peeled to a commit.
export async function resolve(repo, spec, { want = 'commit' } = {}) {
    if (!spec) return null;
    const [base, suffix] = splitSpec(spec);
    const res = await resolveBase(repo, base);
    if (!res || res.error) return res;
    let oid = res.oid;
    const ops = suffix.match(/~\d*|\^\{[a-z]*\}|\^\d*/g) || [];
    if (ops.join('') !== suffix) return null;
    for (const op of ops) {
        if (op.startsWith('^{')) {
            const t = op.slice(2, -1) || 'any';
            const peeled = await peel(repo, oid, t === 'any' ? 'commit' : t);
            if (!peeled) return null;
            oid = peeled.oid;
            continue;
        }
        const peeled = await peel(repo, oid, 'commit');
        if (!peeled) return null;
        oid = peeled.oid;
        if (op.startsWith('~')) {
            const n = op.length > 1 ? Number(op.slice(1)) : 1;
            for (let i = 0; i < n; i++) {
                const c = await repo.readCommit(oid);
                if (!c.parents.length) return null;
                oid = c.parents[0];
            }
        } else {
            const n = op.length > 1 ? Number(op.slice(1)) : 1;
            if (n === 0) continue;
            const c = await repo.readCommit(oid);
            if (!c.parents[n - 1]) return null;
            oid = c.parents[n - 1];
        }
    }
    if (want === 'any') return { oid, type: await repo.objectType(oid), ref: res.ref };
    const peeled = await peel(repo, oid, want);
    return peeled ? { ...peeled, ref: ops.length ? undefined : res.ref } : null;
}

export async function resolveCommit(repo, spec) {
    const r = await resolve(repo, spec);
    return r && !r.error ? r.oid : null;
}

export function unknownRevision(spec) {
    return `fatal: ambiguous argument '${spec}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`;
}

// "<rev>:<path>" → blob oid
export async function resolveBlobSpec(repo, spec) {
    const idx = spec.indexOf(':');
    if (idx === -1) return null;
    const rev = spec.slice(0, idx);
    let path = spec.slice(idx + 1).replace(/^\.\//, '');
    if (spec.slice(idx + 1).startsWith('./')) path = [repo.prefix(), path].filter(Boolean).join('/');
    if (rev === '') {
        const index = await repo.indexFlat();
        const e = index.get(path);
        return e ? { oid: e.oid, path } : { error: `path '${path}' does not exist (neither on disk nor in the index)` };
    }
    const commit = await resolveCommit(repo, rev);
    if (!commit) return { error: `invalid object name '${rev}'.` };
    const flat = await repo.flatTree((await repo.readCommit(commit)).tree);
    const e = flat.get(path);
    if (!e) return { error: `path '${path}' does not exist in '${rev}'` };
    return { oid: e.oid, path };
}
