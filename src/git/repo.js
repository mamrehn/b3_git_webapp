// Repository access shared by all git subcommands.
//
// isomorphic-git does the object/index work. This layer adds what it lacks:
// layered config (.git/config → ~/.gitconfig), merge/rebase state files,
// our conflict bookkeeping and a few convenience readers.

import { git } from '../lib.js';
import { ConfigFile } from './config.js';
import { statOrNull, mkdirp, rmrf } from '../vfs/fsutil.js';
import { joinPath, dirname, toText, fromPrefix } from '../core/util.js';
import { fatal } from './errors.js';

export const ZERO_OID = '0000000000000000000000000000000000000000';
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const CONFLICTS_FILE = 'WERKSTATT_CONFLICTS.json';

export async function findRepoRoot(pfs, start) {
    let dir = start;
    for (;;) {
        const st = await statOrNull(pfs, joinPath(dir, '.git'));
        if (st && st.isDirectory()) return dir;
        if (dir === '/' || !dir) return null;
        dir = dirname(dir);
    }
}

export class Repo {
    constructor(world, dir) {
        this.world = world;
        this.dir = dir;
        this.gitdir = joinPath(dir, '.git');
        this.cache = {};
    }

    static async open(world, start = world.cwd) {
        const root = await findRepoRoot(world.pfs, start);
        return root ? new Repo(world, root) : null;
    }

    static async require(world, start = world.cwd) {
        const repo = await Repo.open(world, start);
        if (!repo) throw fatal('not a git repository (or any of the parent directories): .git', { kind: 'not-a-repo' });
        return repo;
    }

    get fs() { return this.world.fs; }
    get pfs() { return this.world.pfs; }

    o(extra = {}) {
        return { fs: this.fs, dir: this.dir, gitdir: this.gitdir, cache: this.cache, ...extra };
    }

    invalidate() {
        this.cache = {};
    }

    // Path of the current directory relative to the repository root ('' at the root)
    prefix() {
        const cwd = this.world.cwd;
        if (cwd === this.dir) return '';
        if (cwd.startsWith(this.dir + '/')) return cwd.slice(this.dir.length + 1);
        return '';
    }

    // Convert a user-supplied path (relative to cwd) to a repo-relative path. null if outside.
    toRepoPath(userPath) {
        const abs = this.world.resolve(userPath);
        if (abs === this.dir) return '';
        if (abs.startsWith(this.dir + '/')) return abs.slice(this.dir.length + 1);
        return null;
    }

    // Repo-relative path → path as shown relative to cwd (like git status does)
    displayPath(repoPath) {
        return fromPrefix(this.prefix(), repoPath);
    }

    // ---- files inside .git ------------------------------------------------------------

    async readGitFile(name) {
        try {
            return await this.pfs.readFile(joinPath(this.gitdir, name), 'utf8');
        } catch {
            return null;
        }
    }

    async writeGitFile(name, text) {
        const path = joinPath(this.gitdir, name);
        await mkdirp(this.pfs, dirname(path));
        await this.pfs.writeFile(path, text, 'utf8');
    }

    async removeGitFile(name) {
        await rmrf(this.pfs, joinPath(this.gitdir, name));
    }

    async hasGitFile(name) {
        return (await statOrNull(this.pfs, joinPath(this.gitdir, name))) !== null;
    }

    // ORIG_HEAD, MERGE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, FETCH_HEAD
    async readSpecial(name) {
        const text = await this.readGitFile(name);
        const m = text && text.match(/^([0-9a-f]{40})/);
        return m ? m[1] : null;
    }

    async writeSpecial(name, oid) {
        await this.writeGitFile(name, oid + '\n');
    }

    // ---- HEAD and refs ------------------------------------------------------------------

    async head() {
        const raw = ((await this.readGitFile('HEAD')) || '').trim();
        let ref = null;
        let oid = null;
        if (raw.startsWith('ref: ')) {
            ref = raw.slice(5).trim();
            oid = await this.readRef(ref);
        } else if (/^[0-9a-f]{40}$/.test(raw)) {
            oid = raw;
        }
        const branch = ref && ref.startsWith('refs/heads/') ? ref.slice(11) : null;
        return { ref, branch, oid, detached: !ref, unborn: Boolean(ref) && !oid };
    }

    async headOid() {
        return (await this.head()).oid;
    }

    async readRef(ref) {
        try {
            return await git.resolveRef({ fs: this.fs, gitdir: this.gitdir, ref });
        } catch {
            return null;
        }
    }

    async writeRef(ref, oid) {
        await git.writeRef({ fs: this.fs, gitdir: this.gitdir, ref, value: oid, force: true });
    }

    async deleteRef(ref) {
        try {
            await git.deleteRef({ fs: this.fs, gitdir: this.gitdir, ref });
        } catch { /* already gone */ }
    }

    async setHeadToBranch(branch) {
        await this.writeGitFile('HEAD', `ref: refs/heads/${branch}\n`);
    }

    async setHeadDetached(oid) {
        await this.writeGitFile('HEAD', `${oid}\n`);
    }

    // Moves whatever HEAD points at (branch or detached HEAD) to `oid`.
    async moveHead(oid) {
        const head = await this.head();
        if (head.ref) await this.writeRef(head.ref, oid);
        else await this.setHeadDetached(oid);
    }

    async branches() {
        const names = await git.listBranches({ fs: this.fs, gitdir: this.gitdir }).catch(() => []);
        const out = [];
        for (const name of names.sort()) {
            const oid = await this.readRef(`refs/heads/${name}`);
            if (oid) out.push({ name, oid });
        }
        return out;
    }

    async remotes() {
        const list = await git.listRemotes({ fs: this.fs, gitdir: this.gitdir }).catch(() => []);
        return list.map(r => ({ name: r.remote, url: r.url }));
    }

    async remoteBranches() {
        const out = [];
        for (const { name: remote } of await this.remotes()) {
            const names = await git.listBranches({ fs: this.fs, gitdir: this.gitdir, remote }).catch(() => []);
            for (const branch of names.sort()) {
                if (branch === 'HEAD') continue;
                const oid = await this.readRef(`refs/remotes/${remote}/${branch}`);
                if (oid) out.push({ remote, branch, name: `${remote}/${branch}`, oid });
            }
        }
        return out;
    }

    async remoteHead(remote) {
        const raw = (await this.readGitFile(`refs/remotes/${remote}/HEAD`)) || '';
        const m = raw.match(/^ref: refs\/remotes\/[^/]+\/(.+)$/m);
        return m ? m[1].trim() : null;
    }

    async tags() {
        const names = await git.listTags({ fs: this.fs, gitdir: this.gitdir }).catch(() => []);
        const out = [];
        for (const name of names.sort()) {
            const oid = await this.readRef(`refs/tags/${name}`);
            if (!oid) continue;
            let commit = oid;
            let annotated = null;
            try {
                const obj = await git.readObject({ fs: this.fs, gitdir: this.gitdir, oid, cache: this.cache });
                if (obj.type === 'tag') {
                    annotated = obj.object;
                    commit = obj.object.object;
                }
            } catch { /* missing object */ }
            out.push({ name, oid, commit, annotated });
        }
        return out;
    }

    // ---- config ------------------------------------------------------------------------------

    repoConfig() {
        return new ConfigFile(this.pfs, joinPath(this.gitdir, 'config'));
    }

    globalConfig() {
        return globalConfigFile(this.world);
    }

    async config(path) {
        const local = await this.repoConfig().get(path);
        if (local !== undefined) return local;
        return this.globalConfig().get(path);
    }

    async configBool(path, fallback = false) {
        const v = await this.config(path);
        if (v === undefined) return fallback;
        return /^(true|yes|on|1)$/i.test(v);
    }

    // GIT_AUTHOR_NAME/EMAIL (e.g. `GIT_AUTHOR_NAME=Alex git commit …`) win over the config
    async identity() {
        const env = this.world.env || {};
        const name = env.GIT_AUTHOR_NAME || env.GIT_COMMITTER_NAME || await this.config('user.name');
        const email = env.GIT_AUTHOR_EMAIL || env.GIT_COMMITTER_EMAIL || await this.config('user.email');
        if (!name || !email) return null;
        return { name, email };
    }

    async upstreamOf(branch) {
        const remote = await this.config(`branch.${branch}.remote`);
        const merge = await this.config(`branch.${branch}.merge`);
        if (!remote || !merge) return null;
        const name = merge.replace(/^refs\/heads\//, '');
        if (remote === '.') return { remote, branch: name, ref: `refs/heads/${name}`, display: name };
        return { remote, branch: name, ref: `refs/remotes/${remote}/${name}`, display: `${remote}/${name}` };
    }

    async setUpstream(branch, remote, remoteBranch) {
        const cfg = this.repoConfig();
        await cfg.set(`branch.${branch}.remote`, remote);
        await cfg.set(`branch.${branch}.merge`, `refs/heads/${remoteBranch}`);
    }

    // ---- objects ---------------------------------------------------------------------------------

    async readCommit(oid) {
        const { commit } = await git.readCommit({ fs: this.fs, gitdir: this.gitdir, oid, cache: this.cache });
        return {
            oid,
            tree: commit.tree,
            parents: commit.parent || [],
            message: commit.message,
            author: commit.author,
            committer: commit.committer,
        };
    }

    async hasObject(oid) {
        try {
            await git.readObject({ fs: this.fs, gitdir: this.gitdir, oid, format: 'deflated', cache: this.cache });
            return true;
        } catch {
            return false;
        }
    }

    async objectType(oid) {
        try {
            const obj = await git.readObject({ fs: this.fs, gitdir: this.gitdir, oid, cache: this.cache });
            return obj.type;
        } catch {
            return null;
        }
    }

    async readBlob(oid) {
        const { blob } = await git.readBlob({ fs: this.fs, gitdir: this.gitdir, oid, cache: this.cache });
        return blob;
    }

    async blobText(oid) {
        return oid ? toText(await this.readBlob(oid)) : '';
    }

    // Flatten a tree (or commit) into Map<path, {oid, mode}>
    async flatTree(treeish) {
        const out = new Map();
        if (!treeish) return out;
        const visit = async (oid, prefix) => {
            const { tree } = await git.readTree({ fs: this.fs, gitdir: this.gitdir, oid, cache: this.cache });
            for (const e of tree) {
                const path = prefix ? `${prefix}/${e.path}` : e.path;
                if (e.type === 'tree') await visit(e.oid, path);
                else if (e.type === 'blob') out.set(path, { oid: e.oid, mode: e.mode });
            }
        };
        await visit(treeish, '');
        return out;
    }

    // Build (nested) tree objects from a flat Map<path, {oid, mode}>, return the root tree oid
    async writeFlatTree(flat) {
        const root = { files: new Map(), dirs: new Map() };
        for (const [path, entry] of flat) {
            const parts = path.split('/');
            let node = root;
            for (const part of parts.slice(0, -1)) {
                if (!node.dirs.has(part)) node.dirs.set(part, { files: new Map(), dirs: new Map() });
                node = node.dirs.get(part);
            }
            node.files.set(parts[parts.length - 1], entry);
        }
        const write = async node => {
            const tree = [];
            for (const [name, child] of node.dirs) {
                tree.push({ mode: '040000', path: name, oid: await write(child), type: 'tree' });
            }
            for (const [name, e] of node.files) {
                tree.push({ mode: e.mode || '100644', path: name, oid: e.oid, type: 'blob' });
            }
            return git.writeTree({ fs: this.fs, gitdir: this.gitdir, tree });
        };
        return write(root);
    }

    // Index entries (stage 0) as Map<path, {oid, mode}>
    async indexFlat() {
        const out = new Map();
        try {
            await git.walk({
                fs: this.fs, dir: this.dir, gitdir: this.gitdir, cache: this.cache,
                trees: [git.STAGE()],
                map: async (filepath, [entry]) => {
                    if (filepath === '.' || !entry) return;
                    if ((await entry.type()) === 'blob') {
                        out.set(filepath, { oid: await entry.oid(), mode: (await entry.mode()).toString(8).padStart(6, '0') });
                    }
                },
            });
        } catch { /* empty index */ }
        return out;
    }

    async indexFiles() {
        return git.listFiles({ fs: this.fs, dir: this.dir, gitdir: this.gitdir, cache: this.cache }).catch(() => []);
    }

    async statusMatrix(filepaths) {
        const rows = await git.statusMatrix({ fs: this.fs, dir: this.dir, gitdir: this.gitdir, cache: this.cache, filepaths });
        return this.fixRacilyClean(rows);
    }

    // isomorphic-git trusts its stat cache with 1-second mtime resolution and has no
    // "racy git" protection: a same-size edit within the second after `git add` looks
    // unchanged. Like real git, re-hash entries whose mtime is not older than the index.
    async fixRacilyClean(rows) {
        const indexStat = await statOrNull(this.pfs, joinPath(this.gitdir, 'index'));
        if (!indexStat) return rows;
        const indexSecond = Math.floor((indexStat.mtimeMs || 0) / 1000);
        let indexFlat = null;
        let headFlat = null;
        for (const row of rows) {
            const [path, , W, S] = row;
            if (W === 0 || S === 0) continue;
            const st = await statOrNull(this.pfs, joinPath(this.dir, path));
            if (!st || !st.isFile() || Math.floor((st.mtimeMs || 0) / 1000) < indexSecond) continue;
            const workOid = await workTreeOid(this, path, st);
            if (indexFlat === null) {
                indexFlat = await this.indexFlat();
                const head = await this.head();
                headFlat = head.oid ? await this.flatTree((await this.readCommit(head.oid)).tree) : new Map();
            }
            const indexOid = indexFlat.get(path)?.oid;
            const headOid = headFlat.get(path)?.oid;
            row[2] = workOid === headOid ? 1 : 2;
            row[3] = !indexOid ? 0 : indexOid === headOid ? 1 : indexOid === workOid ? 2 : 3;
        }
        return rows;
    }

    async workText(path) {
        try {
            return await this.pfs.readFile(joinPath(this.dir, path), 'utf8');
        } catch {
            return null;
        }
    }

    async workBytes(path) {
        try {
            return await this.pfs.readFile(joinPath(this.dir, path));
        } catch {
            return null;
        }
    }

    async isIgnored(path) {
        try {
            return await git.isIgnored({ fs: this.fs, dir: this.dir, gitdir: this.gitdir, filepath: path });
        } catch {
            return false;
        }
    }

    // ---- conflict bookkeeping (stage 1–3 are not representable via isomorphic-git) --------------

    async conflicts() {
        const text = await this.readGitFile(CONFLICTS_FILE);
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch {
            return {};
        }
    }

    async setConflicts(map) {
        if (!Object.keys(map).length) await this.removeGitFile(CONFLICTS_FILE);
        else await this.writeGitFile(CONFLICTS_FILE, JSON.stringify(map, null, 2));
    }

    async resolveConflict(path) {
        const map = await this.conflicts();
        if (map[path]) {
            delete map[path];
            await this.setConflicts(map);
            return true;
        }
        return false;
    }

    // What multi-step operation is in progress?
    async operation() {
        if (await this.hasGitFile('rebase-merge')) {
            const headName = ((await this.readGitFile('rebase-merge/head-name')) || '').trim();
            const onto = ((await this.readGitFile('rebase-merge/onto')) || '').trim();
            return { kind: 'rebase', branch: headName.replace(/^refs\/heads\//, ''), onto };
        }
        const merge = await this.readSpecial('MERGE_HEAD');
        if (merge) return { kind: 'merge', oid: merge };
        const pick = await this.readSpecial('CHERRY_PICK_HEAD');
        if (pick) return { kind: 'cherry-pick', oid: pick };
        const revert = await this.readSpecial('REVERT_HEAD');
        if (revert) return { kind: 'revert', oid: revert };
        return null;
    }
}

// content hash of a work tree file, cached by its stat data
const workOidCache = new Map();

async function workTreeOid(repo, path, st) {
    const key = `${repo.dir}/${path}`;
    const stamp = `${st.mtimeMs}:${st.size}:${st.ino}`;
    const hit = workOidCache.get(key);
    if (hit && hit.stamp === stamp) return hit.oid;
    const bytes = await repo.pfs.readFile(joinPath(repo.dir, path));
    const { oid } = await git.hashBlob({ object: bytes });
    workOidCache.set(key, { stamp, oid });
    if (workOidCache.size > 5000) workOidCache.delete(workOidCache.keys().next().value);
    return oid;
}

export function globalConfigFile(world) {
    return new ConfigFile(world.pfs, joinPath(world.env.HOME || '/home/student', '.gitconfig'));
}
