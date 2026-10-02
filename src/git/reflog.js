// Reflog support. isomorphic-git does not write reflogs, so every git command is
// wrapped: refs are snapshotted before and after, and the differences are appended
// to .git/logs/HEAD and .git/logs/refs/heads/<branch> in git's own format.

import { ZERO_OID } from './repo.js';
import { now, tzOffset } from './clock.js';
import { joinPath, dirname } from '../core/util.js';
import { mkdirp, rmrf } from '../vfs/fsutil.js';

function tz(offsetMinutes) {
    const east = -offsetMinutes;
    const sign = east >= 0 ? '+' : '-';
    const abs = Math.abs(east);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

export async function snapshotRefs(repo) {
    const head = await repo.head();
    const branches = new Map();
    for (const b of await repo.branches()) branches.set(b.name, b.oid);
    return { head, branches };
}

async function appendLog(repo, ref, oldOid, newOid, message) {
    const ident = (await repo.identity()) || { name: 'student', email: 'student@werkstatt' };
    const line = `${oldOid || ZERO_OID} ${newOid || ZERO_OID} ${ident.name} <${ident.email}> ${now()} ${tz(tzOffset())}\t${message}\n`;
    const path = joinPath(repo.gitdir, 'logs', ref);
    await mkdirp(repo.pfs, dirname(path));
    let existing = '';
    try { existing = await repo.pfs.readFile(path, 'utf8'); } catch { /* new log */ }
    await repo.pfs.writeFile(path, existing + line, 'utf8');
}

export async function recordRefChanges(repo, before, after, message, { created = 'branch: Created from HEAD' } = {}) {
    const msg = message || 'update';
    // branch logs
    for (const [name, oid] of after.branches) {
        const old = before.branches.get(name);
        if (old === oid) continue;
        const isNew = !before.branches.has(name);
        await appendLog(repo, `refs/heads/${name}`, old, oid, isNew && !msg.startsWith('commit') ? created : msg);
    }
    for (const name of before.branches.keys()) {
        if (!after.branches.has(name)) await rmrf(repo.pfs, joinPath(repo.gitdir, 'logs', 'refs', 'heads', name));
    }
    // HEAD log: oid changed, or switched branch while staying on the same commit
    const h0 = before.head;
    const h1 = after.head;
    if (h1.oid && (h0.oid !== h1.oid || h0.ref !== h1.ref)) {
        await appendLog(repo, 'HEAD', h0.oid, h1.oid, msg);
    }
}

export async function appendReflog(repo, ref, oldOid, newOid, message) {
    await appendLog(repo, ref, oldOid, newOid, message);
}

export async function readReflog(repo, ref = 'HEAD') {
    const path = joinPath(repo.gitdir, 'logs', ref);
    let text = '';
    try { text = await repo.pfs.readFile(path, 'utf8'); } catch { return []; }
    const entries = [];
    for (const line of text.split('\n')) {
        const m = line.match(/^([0-9a-f]{40}) ([0-9a-f]{40}) (.*?) <(.*?)> (\d+) ([+-]\d{4})\t(.*)$/);
        if (!m) continue;
        entries.push({ old: m[1], new: m[2], name: m[3], email: m[4], time: Number(m[5]), tz: m[6], message: m[7] });
    }
    return entries.reverse(); // newest first, like `git reflog`
}

export async function renameReflog(repo, from, to) {
    const src = joinPath(repo.gitdir, 'logs', 'refs', 'heads', from);
    const dest = joinPath(repo.gitdir, 'logs', 'refs', 'heads', to);
    try {
        const text = await repo.pfs.readFile(src, 'utf8');
        await mkdirp(repo.pfs, dirname(dest));
        await repo.pfs.writeFile(dest, text, 'utf8');
        await rmrf(repo.pfs, src);
    } catch { /* no log */ }
}
