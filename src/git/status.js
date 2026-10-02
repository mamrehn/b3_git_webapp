// Working tree status: the model behind `git status`, the coach and the visualisation.

import { git } from '../lib.js';

const CONFLICT_LABELS = {
    content: { label: 'both modified', code: 'UU' },
    'add/add': { label: 'both added', code: 'AA' },
    'modify/delete': { label: 'deleted by us', code: 'DU' },
    'delete/modify': { label: 'deleted by them', code: 'UD' },
    binary: { label: 'both modified', code: 'UU' },
};

export async function computeStatus(repo, { untracked = 'normal', filter = null } = {}) {
    let rows = [];
    try {
        rows = await repo.statusMatrix();
    } catch {
        rows = [];
    }
    if (filter) rows = rows.filter(r => filter(r[0]));
    const conflictMap = { ...(await repo.conflicts()) };
    if (filter) for (const p of Object.keys(conflictMap)) if (!filter(p)) delete conflictMap[p];
    const staged = [];
    const unstaged = [];
    const untrackedFiles = [];
    const conflicts = [];
    const entries = [];
    const tracked = new Set();

    for (const [path, H, W, S] of rows) {
        if (H || S) tracked.add(path);
    }

    for (const [path, H, W, S] of rows) {
        if (conflictMap[path]) continue;
        let x = ' ';
        let y = ' ';
        if (H === 0 && S === 0) {
            if (W) { x = '?'; y = '?'; }
        } else {
            if (H === 0) x = 'A';
            else if (S === 0) x = 'D';
            else if (S === 1) x = ' ';
            else x = 'M';
            if (S === 0) y = ' ';
            else if (W === 0) y = 'D';
            else if (S === 2) y = ' ';
            else if (S === 1) y = W === 2 ? 'M' : ' ';
            else y = 'M';
        }
        if (x === ' ' && y === ' ') continue;
        entries.push({ path, x, y });
        if (x === '?') {
            untrackedFiles.push(path);
            continue;
        }
        if (x !== ' ') staged.push({ path, kind: x === 'A' ? 'new file' : x === 'D' ? 'deleted' : 'modified' });
        if (y === 'M') unstaged.push({ path, kind: 'modified' });
        if (y === 'D') unstaged.push({ path, kind: 'deleted' });
        // staged deletion while the file is still on disk (git rm --cached): also untracked
        if (x === 'D' && W > 0) {
            untrackedFiles.push(path);
            entries.push({ path, x: '?', y: '?' });
        }
    }

    for (const [path, c] of Object.entries(conflictMap)) {
        const info = CONFLICT_LABELS[c.kind] || CONFLICT_LABELS.content;
        conflicts.push({ path, kind: c.kind, label: info.label });
        entries.push({ path, x: info.code[0], y: info.code[1], conflict: true });
    }

    // Collapse untracked files into their top-most fully untracked directory ("dir/")
    let untrackedShown = untrackedFiles;
    if (untracked === 'normal') {
        const trackedDirs = new Set();
        for (const p of tracked) {
            const parts = p.split('/');
            for (let i = 1; i < parts.length; i++) trackedDirs.add(parts.slice(0, i).join('/'));
        }
        const shown = new Set();
        for (const p of untrackedFiles) {
            const parts = p.split('/');
            let display = p;
            for (let i = 1; i < parts.length; i++) {
                const dir = parts.slice(0, i).join('/');
                if (!trackedDirs.has(dir)) { display = dir + '/'; break; }
            }
            shown.add(display);
        }
        untrackedShown = [...shown];
    }
    // rename detection for staged changes (git's status.renames default)
    const deletedStaged = staged.filter(s => s.kind === 'deleted');
    const addedStaged = staged.filter(s => s.kind === 'new file');
    if (deletedStaged.length && addedStaged.length) {
        const head = await repo.head();
        const headFlat = head.oid ? await repo.flatTree((await repo.readCommit(head.oid)).tree) : new Map();
        const indexFlat = await repo.indexFlat();
        const pairs = await detectRenames(repo,
            deletedStaged.map(s => ({ path: s.path, oid: headFlat.get(s.path)?.oid })),
            addedStaged.map(s => ({ path: s.path, oid: indexFlat.get(s.path)?.oid })));
        for (const { from, to, score } of pairs) {
            const del = staged.findIndex(s => s.path === from && s.kind === 'deleted');
            staged.splice(del, 1);
            const add = staged.find(s => s.path === to && s.kind === 'new file');
            add.kind = 'renamed';
            add.from = from;
            add.score = score;
            const e = entries.find(x => x.path === to);
            if (e) { e.x = 'R'; e.from = from; }
            const d = entries.findIndex(x => x.path === from && x.x === 'D');
            if (d !== -1) entries.splice(d, 1);
        }
    }
    const byPath = (a, b) => (a.path || a).localeCompare(b.path || b, 'en');
    staged.sort(byPath);
    unstaged.sort(byPath);
    conflicts.sort(byPath);
    untrackedShown.sort(byPath);
    untrackedFiles.sort(byPath);
    entries.sort(byPath);
    return {
        staged,
        unstaged,
        untracked: untrackedShown,
        untrackedFiles,
        conflicts,
        entries,
        clean: !staged.length && !unstaged.length && !untrackedFiles.length && !conflicts.length,
        trackedCount: tracked.size,
    };
}

function similarity(a, b) {
    // share of lines (weighted by length) that both texts have in common
    const count = text => {
        const m = new Map();
        const lines = text.split('\n');
        if (lines[lines.length - 1] === '') lines.pop(); // the final newline is not a line
        for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
        return m;
    };
    const ca = count(a);
    const cb = count(b);
    let common = 0;
    for (const [line, n] of ca) common += Math.min(n, cb.get(line) || 0) * (line.length + 1);
    const max = Math.max(a.length, b.length, 1);
    return Math.min(1, common / max);
}

// Pair deleted and added files that are (mostly) the same content, like git's rename detection.
export async function detectRenames(repo, deleted, added, threshold = 0.5) {
    const pairs = [];
    const freeDel = deleted.filter(d => d.oid);
    const freeAdd = added.filter(a => a.oid);
    // exact renames first
    for (const a of [...freeAdd]) {
        const i = freeDel.findIndex(d => d.oid === a.oid);
        if (i === -1) continue;
        pairs.push({ from: freeDel[i].path, to: a.path, score: 100 });
        freeDel.splice(i, 1);
        freeAdd.splice(freeAdd.indexOf(a), 1);
    }
    if (freeDel.length && freeAdd.length && freeDel.length * freeAdd.length <= 400) {
        const texts = new Map();
        const text = async oid => {
            if (!texts.has(oid)) {
                const bytes = await repo.readBlob(oid);
                texts.set(oid, bytes.includes(0) ? null : new TextDecoder().decode(bytes));
            }
            return texts.get(oid);
        };
        const candidates = [];
        for (const d of freeDel) {
            for (const a of freeAdd) {
                const [td, ta] = [await text(d.oid), await text(a.oid)];
                if (td === null || ta === null || !td.length || !ta.length) continue;
                const s = similarity(td, ta);
                if (s >= threshold) candidates.push({ d, a, s });
            }
        }
        candidates.sort((x, y) => y.s - x.s);
        const usedD = new Set();
        const usedA = new Set();
        for (const c of candidates) {
            if (usedD.has(c.d.path) || usedA.has(c.a.path)) continue;
            usedD.add(c.d.path);
            usedA.add(c.a.path);
            pairs.push({ from: c.d.path, to: c.a.path, score: Math.floor(c.s * 100) });
        }
    }
    return pairs;
}

// Commits reachable from `a` but not from `b`, and vice versa.
export async function aheadBehind(repo, a, b) {
    if (!a || !b) return { ahead: 0, behind: 0 };
    if (a === b) return { ahead: 0, behind: 0 };
    const reach = async start => {
        const seen = new Set();
        const stack = [start];
        while (stack.length) {
            const oid = stack.pop();
            if (seen.has(oid)) continue;
            seen.add(oid);
            try {
                const c = await repo.readCommit(oid);
                stack.push(...c.parents);
            } catch { /* shallow history */ }
        }
        return seen;
    };
    const ra = await reach(a);
    const rb = await reach(b);
    let ahead = 0;
    let behind = 0;
    for (const oid of ra) if (!rb.has(oid)) ahead++;
    for (const oid of rb) if (!ra.has(oid)) behind++;
    return { ahead, behind };
}

export async function isAncestor(repo, ancestor, descendant) {
    if (!ancestor || !descendant) return false;
    if (ancestor === descendant) return true;
    try {
        return await git.isDescendent({ fs: repo.fs, gitdir: repo.gitdir, oid: descendant, ancestor, depth: -1, cache: repo.cache });
    } catch {
        return false;
    }
}

export async function mergeBase(repo, a, b) {
    try {
        const bases = await git.findMergeBase({ fs: repo.fs, gitdir: repo.gitdir, oids: [a, b], cache: repo.cache });
        return bases[0] || null;
    } catch {
        return null;
    }
}
