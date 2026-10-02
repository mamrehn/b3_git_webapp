// 3-way merge engine used by merge, pull, cherry-pick, revert, rebase and stash.
// node-diff3 produces the same hunks as git (adjacent edits conflict, see tests).

import { git } from '../lib.js';
import { diff3Merge } from '../../vendor/node-diff3-3.2.1.mjs';
import { isBinary, toText, toBytes, joinPath, dirname } from '../core/util.js';
import { mkdirp, statOrNull } from '../vfs/fsutil.js';

function splitKeepEnds(text) {
    if (!text) return [];
    return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

function ensureNewline(lines) {
    if (lines.length && !lines[lines.length - 1].endsWith('\n')) {
        return [...lines.slice(0, -1), lines[lines.length - 1] + '\n'];
    }
    return lines;
}

export function mergeText(baseText, oursText, theirsText, { ours = 'HEAD', theirs = 'theirs' } = {}) {
    const result = diff3Merge(splitKeepEnds(oursText), splitKeepEnds(baseText), splitKeepEnds(theirsText), { excludeFalseConflicts: true });
    let text = '';
    let conflicts = 0;
    for (const item of result) {
        if (item.ok) {
            text += item.ok.join('');
        } else if (item.conflict) {
            conflicts++;
            if (text && !text.endsWith('\n')) text += '\n';
            text += `<<<<<<< ${ours}\n`;
            text += ensureNewline(item.conflict.a).join('');
            text += '=======\n';
            text += ensureNewline(item.conflict.b).join('');
            text += `>>>>>>> ${theirs}\n`;
        }
    }
    return { text, clean: conflicts === 0, conflicts };
}

function same(x, y) {
    if (!x && !y) return true;
    return Boolean(x && y && x.oid === y.oid && x.mode === y.mode);
}

// base/ours/theirs: Map<path, {oid, mode}>
export async function mergeTrees(repo, { base, ours, theirs, labels }) {
    const result = new Map(ours);
    const conflicts = [];
    const touched = [];
    const paths = new Set([...base.keys(), ...ours.keys(), ...theirs.keys()]);
    for (const path of [...paths].sort()) {
        const b = base.get(path);
        const o = ours.get(path);
        const t = theirs.get(path);
        if (same(o, t) || same(b, t)) continue; // nothing to take from theirs
        if (same(b, o)) {
            // only theirs changed this path
            if (t) result.set(path, t);
            else result.delete(path);
            touched.push(path);
            continue;
        }
        // both sides changed it differently
        touched.push(path);
        if (o && t) {
            if (o.oid === t.oid) {
                result.set(path, { oid: o.oid, mode: b && o.mode === b.mode ? t.mode : o.mode });
                continue;
            }
            const [ob, tb, bb] = await Promise.all([repo.readBlob(o.oid), repo.readBlob(t.oid), b ? repo.readBlob(b.oid) : new Uint8Array()]);
            if (isBinary(ob) || isBinary(tb) || isBinary(bb)) {
                conflicts.push({ path, kind: 'binary', base: b?.oid || null, ours: o.oid, theirs: t.oid, mode: o.mode, text: null });
                continue;
            }
            const merged = mergeText(toText(bb), toText(ob), toText(tb), labels);
            const mode = b && o.mode === b.mode ? t.mode : o.mode;
            if (merged.clean) {
                const oid = await git.writeBlob({ fs: repo.fs, gitdir: repo.gitdir, blob: toBytes(merged.text) });
                result.set(path, { oid, mode });
            } else {
                conflicts.push({ path, kind: b ? 'content' : 'add/add', base: b?.oid || null, ours: o.oid, theirs: t.oid, mode, text: merged.text });
            }
        } else if (!o && t) {
            conflicts.push({ path, kind: 'modify/delete', base: b?.oid || null, ours: null, theirs: t.oid, mode: t.mode, text: null });
        } else if (o && !t) {
            conflicts.push({ path, kind: 'delete/modify', base: b?.oid || null, ours: o.oid, theirs: null, mode: o.mode, text: null });
        }
    }
    return { result, conflicts, touched };
}

// Which touched paths would lose uncommitted work? (git refuses to merge then)
export async function findBlockers(repo, touched, oursFlat) {
    const local = [];
    const untracked = [];
    if (!touched.length) return { local, untracked };
    const rows = await repo.statusMatrix(touched);
    const byPath = new Map(rows.map(r => [r[0], r]));
    for (const path of touched) {
        const row = byPath.get(path);
        if (oursFlat.has(path)) {
            // tracked in HEAD: index and work tree must still equal HEAD
            if (!row || row[1] !== 1 || row[2] !== 1 || row[3] !== 1) local.push(path);
        } else if (row) {
            if (row[3] !== 0) local.push(path); // staged new file
            else if (row[2] !== 0) untracked.push(path);
        }
    }
    return { local, untracked };
}

async function writeWorkFile(repo, path, bytes, mode) {
    const full = joinPath(repo.dir, path);
    await mkdirp(repo.pfs, dirname(full));
    const st = await statOrNull(repo.pfs, full);
    if (st && st.isDirectory()) return;
    await repo.pfs.writeFile(full, bytes, { mode: mode === '100755' ? 0o755 : 0o644 });
}

async function removeWorkFile(repo, path) {
    const full = joinPath(repo.dir, path);
    try {
        await repo.pfs.unlink(full);
    } catch { /* already gone */ }
    // remove now-empty parent directories (like git does)
    let dir = dirname(full);
    while (dir.startsWith(repo.dir + '/')) {
        try {
            if ((await repo.pfs.readdir(dir)).length) break;
            await repo.pfs.rmdir(dir);
        } catch {
            break;
        }
        dir = dirname(dir);
    }
}

// Write a merge result into work tree + index. Conflicted files get markers and are recorded.
export async function applyMerge(repo, { result, conflicts, touched }, { record = true } = {}) {
    const conflictPaths = new Set(conflicts.map(c => c.path));
    for (const path of touched) {
        if (conflictPaths.has(path)) continue;
        const entry = result.get(path);
        if (entry) {
            await writeWorkFile(repo, path, await repo.readBlob(entry.oid), entry.mode);
            await git.add({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
        } else {
            await removeWorkFile(repo, path);
            await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache }).catch(() => {});
        }
    }
    const meta = record ? await repo.conflicts() : {};
    for (const c of conflicts) {
        if (c.text !== null) {
            await writeWorkFile(repo, c.path, toBytes(c.text), c.mode);
        } else if (c.kind === 'modify/delete') {
            await writeWorkFile(repo, c.path, await repo.readBlob(c.theirs), c.mode);
        }
        // delete/modify and binary keep our version in the work tree; the index keeps ours too
        if (record) meta[c.path] = { kind: c.kind, base: c.base, ours: c.ours, theirs: c.theirs };
    }
    if (record) await repo.setConflicts(meta);
    repo.invalidate();
}

// Make work tree + index match `targetFlat` for the given paths (used by reset --hard, abort, …)
export async function checkoutPaths(repo, targetFlat, paths) {
    for (const path of paths) {
        const entry = targetFlat.get(path);
        if (entry) {
            await writeWorkFile(repo, path, await repo.readBlob(entry.oid), entry.mode);
            await git.add({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
        } else {
            await removeWorkFile(repo, path);
            await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache }).catch(() => {});
        }
    }
    repo.invalidate();
}

export { writeWorkFile, removeWorkFile };
