// A git "smart HTTP" server that lives inside the browser.
// It serves bare repositories stored in the same virtual file system, so
// isomorphic-git's clone/fetch/pull/push work unchanged for simulated remotes.
//   https://git.sim/team/website.git  →  /srv/git.sim/team/website.git

import { git } from '../lib.js';
import { statOrNull, mkdirp } from '../vfs/fsutil.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
export const SIM_ROOT = '/srv/git.sim';
// Where simulated teammates keep their clones: outside the student's home.
export const TEAM_ROOT = '/var/team';

function concat(chunks) {
    let n = 0;
    for (const c of chunks) n += c.byteLength;
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    return out;
}

function pkt(data) {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    const len = (bytes.byteLength + 4).toString(16).padStart(4, '0');
    return concat([enc.encode(len), bytes]);
}

const FLUSH = enc.encode('0000');

function parsePkts(buf) {
    const lines = [];
    let i = 0;
    while (i + 4 <= buf.byteLength) {
        const len = parseInt(dec.decode(buf.subarray(i, i + 4)), 16);
        if (Number.isNaN(len)) break;
        if (len === 0) { lines.push(null); i += 4; continue; }
        lines.push(buf.subarray(i + 4, i + len));
        i += len;
    }
    return { lines, end: i };
}

function sideband(band, data) {
    const out = [];
    for (let i = 0; i < data.byteLength; i += 65515) {
        out.push(pkt(concat([new Uint8Array([band]), data.subarray(i, i + 65515)])));
    }
    return out;
}

async function* once(value) { yield value; }

async function collect(body) {
    if (!body) return new Uint8Array(0);
    const chunks = [];
    for await (const c of body) chunks.push(c instanceof Uint8Array ? c : new Uint8Array(c));
    return concat(chunks);
}

export function simRepoPath(url) {
    try {
        const u = new URL(url);
        return SIM_ROOT + u.pathname.replace(/\/+$/, '');
    } catch {
        return null;
    }
}

export function createSimServer(world, { onEvent = () => {} } = {}) {
    const fs = () => world.fs;
    const pfs = () => world.pfs;

    async function listRefs(gitdir) {
        const refs = [];
        for (const kind of ['heads', 'tags']) {
            const names = await git.listRefs({ fs: fs(), gitdir, filepath: `refs/${kind}` }).catch(() => []);
            for (const name of names.sort()) {
                const ref = `refs/${kind}/${name}`;
                refs.push([ref, await git.resolveRef({ fs: fs(), gitdir, ref })]);
            }
        }
        return refs;
    }

    async function advertise(gitdir, service) {
        const refs = await listRefs(gitdir);
        const caps = service === 'git-upload-pack'
            ? ['side-band-64k', 'ofs-delta', 'no-thin', 'agent=git-werkstatt-sim/1']
            : ['report-status', 'side-band-64k', 'delete-refs', 'no-thin', 'agent=git-werkstatt-sim/1'];
        let headTarget = null;
        try {
            const head = (await pfs().readFile(`${gitdir}/HEAD`, 'utf8')).trim();
            if (head.startsWith('ref: ')) headTarget = head.slice(5);
        } catch { /* no HEAD */ }
        const parts = [pkt(`# service=${service}\n`), FLUSH];
        if (!refs.length) {
            parts.push(pkt(`${'0'.repeat(40)} capabilities^{}\0${caps.join(' ')}\n`));
        } else {
            const lines = [];
            const hit = headTarget && refs.find(([r]) => r === headTarget);
            if (hit) {
                caps.push(`symref=HEAD:${headTarget}`);
                lines.push(['HEAD', hit[1]]);
            }
            lines.push(...refs);
            lines.forEach(([ref, oid], i) => parts.push(pkt(i === 0 ? `${oid} ${ref}\0${caps.join(' ')}\n` : `${oid} ${ref}\n`)));
        }
        parts.push(FLUSH);
        return concat(parts);
    }

    async function hasObject(gitdir, oid) {
        try {
            await git.readObject({ fs: fs(), gitdir, oid, format: 'deflated' });
            return true;
        } catch {
            return false;
        }
    }

    async function reachable(gitdir, tips, skip = new Set()) {
        const out = new Set();
        const stack = [...tips];
        while (stack.length) {
            const oid = stack.pop();
            if (out.has(oid) || skip.has(oid)) continue;
            let obj;
            try { obj = await git.readObject({ fs: fs(), gitdir, oid }); } catch { continue; }
            out.add(oid);
            if (obj.type === 'commit') stack.push(obj.object.tree, ...obj.object.parent);
            else if (obj.type === 'tree') for (const e of obj.object) { if (e.type !== 'commit') stack.push(e.oid); }
            else if (obj.type === 'tag') stack.push(obj.object.object);
        }
        return out;
    }

    async function uploadPack(gitdir, body) {
        const { lines } = parsePkts(body);
        const wants = [];
        const haves = [];
        for (const l of lines) {
            if (!l) continue;
            const s = dec.decode(l).trim();
            if (s.startsWith('want ')) wants.push(s.slice(5, 45));
            else if (s.startsWith('have ')) haves.push(s.slice(5, 45));
        }
        const common = [];
        for (const h of haves) if (await hasObject(gitdir, h)) common.push(h);
        const send = await reachable(gitdir, wants, await reachable(gitdir, common));
        const { packfile } = await git.packObjects({ fs: fs(), gitdir, oids: [...send] });
        const n = send.size;
        const progress = enc.encode(`Enumerating objects: ${n}, done.\nCounting objects: 100% (${n}/${n}), done.\nTotal ${n} (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)\n`);
        onEvent({ type: 'upload', gitdir, objects: n });
        return concat([pkt('NAK\n'), ...sideband(2, progress), ...sideband(1, packfile), FLUSH]);
    }

    async function receivePack(gitdir, body) {
        const { lines, end } = parsePkts(body);
        const commands = [];
        for (const l of lines) {
            if (l === null) break;
            const [oldoid, newoid, ref] = dec.decode(l).split('\0')[0].trim().split(' ');
            commands.push({ oldoid, newoid, ref });
        }
        const pack = body.subarray(end);
        let unpack = 'unpack ok\n';
        let objects = 0;
        if (pack.byteLength > 32) {
            try {
                objects = new DataView(pack.buffer, pack.byteOffset + 8, 4).getUint32(0);
                const sum = [...pack.subarray(pack.byteLength - 20)].map(b => b.toString(16).padStart(2, '0')).join('');
                const rel = `objects/pack/pack-${sum}.pack`;
                await mkdirp(pfs(), `${gitdir}/objects/pack`);
                await pfs().writeFile(`${gitdir}/${rel}`, pack);
                await git.indexPack({ fs: fs(), dir: gitdir, gitdir, filepath: rel });
            } catch (e) {
                unpack = `unpack ${e.message}\n`;
            }
        }
        const report = [pkt(unpack)];
        for (const c of commands) {
            let current = '0'.repeat(40);
            try { current = await git.resolveRef({ fs: fs(), gitdir, ref: c.ref }); } catch { /* new ref */ }
            if (current !== c.oldoid) {
                report.push(pkt(`ng ${c.ref} stale info\n`));
                continue;
            }
            if (/^0+$/.test(c.newoid)) await git.deleteRef({ fs: fs(), gitdir, ref: c.ref });
            else await git.writeRef({ fs: fs(), gitdir, ref: c.ref, value: c.newoid, force: true });
            report.push(pkt(`ok ${c.ref}\n`));
            onEvent({ type: 'push', gitdir, ref: c.ref, oldoid: c.oldoid, newoid: c.newoid, objects });
        }
        report.push(FLUSH);
        return concat([...sideband(1, concat(report)), FLUSH]);
    }

    return {
        async request({ url, method = 'GET', body }) {
            const u = new URL(url);
            const m = u.pathname.match(/^(.*?)(\/info\/refs|\/git-upload-pack|\/git-receive-pack)$/);
            const gitdir = m ? SIM_ROOT + m[1] : null;
            const respond = (statusCode, data, contentType = 'text/plain') => ({
                url,
                method,
                statusCode,
                statusMessage: statusCode === 200 ? 'OK' : 'Not Found',
                headers: { 'content-type': contentType },
                body: once(data),
            });
            const exists = gitdir && (await statOrNull(pfs(), `${gitdir}/HEAD`));
            if (!exists) return respond(404, enc.encode('Repository not found.'));
            if (m[2] === '/info/refs') {
                const service = u.searchParams.get('service');
                return respond(200, await advertise(gitdir, service), `application/x-${service}-advertisement`);
            }
            const reqBody = await collect(body);
            if (m[2] === '/git-upload-pack') return respond(200, await uploadPack(gitdir, reqBody), 'application/x-git-upload-pack-result');
            return respond(200, await receivePack(gitdir, reqBody), 'application/x-git-receive-pack-result');
        },
    };
}
