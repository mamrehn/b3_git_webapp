// What mission objectives can ask about the world. Checks are async functions
// that receive this context and return true once the goal is reached.

import { Repo } from '../git/repo.js';
import { walk } from '../git/history.js';
import { isAncestor } from '../git/status.js';
import { resolveCommit } from '../git/revparse.js';
import { git } from '../lib.js';
import { HOME } from '../vfs/world.js';
import { statOrNull } from '../vfs/fsutil.js';
import { joinPath, normalizePath } from '../core/util.js';
import { SIM_ROOT } from '../git/simserver.js';

export function homePath(p) {
    if (!p || p === '~') return HOME;
    if (p.startsWith('/')) return normalizePath(p);
    if (p.startsWith('~/')) return normalizePath(HOME + p.slice(1));
    return normalizePath(joinPath(HOME, p));
}

function cmdText(c) {
    return [c.name, ...c.args].join(' ');
}

export function makeCheckContext({ world, state, prev, log, since, data, step }) {
    const repos = new Map();
    const openRepo = async (dir) => {
        const abs = homePath(dir);
        if (repos.has(abs)) return repos.get(abs);
        const st = await statOrNull(world.pfs, joinPath(abs, '.git'));
        const repo = st ? new Repo(world, abs) : null;
        repos.set(abs, repo);
        return repo;
    };
    const matches = (test, entry) => (typeof test === 'function' ? test(entry) : test.test(entry.cmd));

    return {
        world,
        state,
        prev,
        data,
        step,
        get repo() { return state.repo; },

        // Did the student run a matching command since this objective became active?
        ran(test, { ok = false } = {}) {
            return log.some(e => e.step >= since && (!ok || e.status === 0) && matches(test, e));
        },
        ranEver(test, { ok = false } = {}) {
            return log.some(e => (!ok || e.status === 0) && matches(test, e));
        },
        // commands of the current step only
        ranNow(test, { ok = false } = {}) {
            return (step.commands || []).some(c => (!ok || c.status === 0) && matches(test, { cmd: cmdText(c), status: c.status, args: c.args, name: c.name }));
        },
        commandsSince() {
            return log.filter(e => e.step >= since);
        },

        cwdIs(p) {
            return state.cwd === homePath(p);
        },
        async exists(p) {
            return Boolean(await statOrNull(world.pfs, homePath(p)));
        },
        async isDir(p) {
            const st = await statOrNull(world.pfs, homePath(p));
            return Boolean(st && st.isDirectory());
        },
        async file(p) {
            try { return await world.pfs.readFile(homePath(p), 'utf8'); } catch { return null; }
        },

        openRepo,
        // repositories below a folder (the student may clone wherever they like)
        async findRepos(root = '~', depth = 3) {
            const found = [];
            const visit = async (dir, left) => {
                if (await statOrNull(world.pfs, joinPath(dir, '.git'))) {
                    found.push(dir);
                    return;
                }
                if (!left) return;
                let names = [];
                try { names = await world.pfs.readdir(dir); } catch { return; }
                for (const name of names) {
                    if (name.startsWith('.')) continue;
                    const p = joinPath(dir, name);
                    if ((await statOrNull(world.pfs, p))?.isDirectory()) await visit(p, left - 1);
                }
            };
            await visit(homePath(root), depth);
            return found;
        },
        async isRepo(dir) {
            return Boolean(await openRepo(dir));
        },
        async refOid(dir, ref) {
            const repo = await openRepo(dir);
            if (!repo) return null;
            try { return await resolveCommit(repo, ref); } catch { return null; }
        },
        async branchExists(dir, name) {
            const repo = await openRepo(dir);
            return Boolean(repo && (await repo.readRef(`refs/heads/${name}`)));
        },
        async currentBranch(dir) {
            const repo = await openRepo(dir);
            if (!repo) return null;
            const h = await repo.head();
            return h.detached ? null : h.branch;
        },
        // files in the index (staged or committed)
        async tracked(dir, path) {
            const repo = await openRepo(dir);
            if (!repo) return false;
            try { return (await repo.indexFiles()).includes(path); } catch { return false; }
        },
        // file content in a commit (HEAD by default); null if missing
        async committedText(dir, path, ref = 'HEAD') {
            const repo = await openRepo(dir);
            if (!repo) return null;
            try {
                const oid = await resolveCommit(repo, ref);
                if (!oid) return null;
                const commit = await repo.readCommit(oid);
                const entry = (await repo.flatTree(commit.tree)).get(path);
                return entry ? await repo.blobText(entry.oid) : null;
            } catch {
                return null;
            }
        },
        async operation(dir) {
            const repo = await openRepo(dir);
            return repo ? repo.operation() : null;
        },
        async conflicts(dir) {
            const repo = await openRepo(dir);
            return repo ? Object.keys(await repo.conflicts()) : [];
        },
        async branches(dir) {
            const repo = await openRepo(dir);
            return repo ? repo.branches() : [];
        },
        async status(dir) {
            if (state.repo && state.repo.dir === homePath(dir)) return state.repo.status;
            const { computeStatus } = await import('../git/status.js');
            const repo = await openRepo(dir);
            return repo ? computeStatus(repo) : null;
        },
        // all commits reachable from ref, newest first
        async commits(dir, ref = 'HEAD', limit = 200) {
            const repo = await openRepo(dir);
            if (!repo) return [];
            let oid = null;
            try { oid = await resolveCommit(repo, ref); } catch { /* unknown */ }
            if (!oid) return [];
            const list = await walk(repo, { include: [oid], limit });
            return list.map(c => ({ oid: c.oid, parents: c.parents, message: c.message, author: c.author.name }));
        },
        async isAncestor(dir, a, b) {
            const repo = await openRepo(dir);
            if (!repo || !a || !b) return false;
            return isAncestor(repo, a, b);
        },
        async config(dir, key) {
            const repo = dir ? await openRepo(dir) : null;
            if (repo) return repo.config(key);
            const { globalConfigFile } = await import('../git/repo.js');
            return globalConfigFile(world).get(key);
        },

        // the simulated server
        async serverRef(path, branch) {
            const gitdir = `${SIM_ROOT}/${path}.git`;
            try { return await git.resolveRef({ fs: world.fs, gitdir, ref: `refs/heads/${branch}` }); } catch { return null; }
        },
        async serverTag(path, tag) {
            const gitdir = `${SIM_ROOT}/${path}.git`;
            try { return await git.resolveRef({ fs: world.fs, gitdir, ref: `refs/tags/${tag}` }); } catch { return null; }
        },
        async serverBranches(path) {
            const gitdir = `${SIM_ROOT}/${path}.git`;
            return git.listBranches({ fs: world.fs, gitdir }).catch(() => []);
        },
        async serverHas(path, oid) {
            const gitdir = `${SIM_ROOT}/${path}.git`;
            try { await git.readObject({ fs: world.fs, gitdir, oid, format: 'deflated' }); return true; } catch { return false; }
        },
    };
}
