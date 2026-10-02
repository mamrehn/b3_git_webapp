// The toolkit missions use to build their world: files, repositories with a
// believable history, the simulated server and teammates who push to it.
//
// Everything is done with the same shell and git the student uses, just with a
// silent terminal, so the result is indistinguishable from "real" work.

import { Shell } from '../shell/exec.js';
import { setClock } from '../git/clock.js';
import { HOME } from '../vfs/world.js';
import { mkdirp } from '../vfs/fsutil.js';
import { joinPath, dirname } from '../core/util.js';
import { CONFIG } from '../config.js';
import { SIM_ROOT, TEAM_ROOT } from '../git/simserver.js';

const QUIET_UI = {
    write() {},
    columns: () => 80,
    clear() {},
    page: async () => {},
    prompt: async () => null,
    readInteractive: async () => '',
    annotate() {},
    edit: async () => ({ saved: false }),
};

// Quote a value for the shell
export function q(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function simUrl(path) {
    return `https://${CONFIG.simulatedHost}/${path}.git`;
}

export class Kit {
    // known: people that can be used without registering them first ({ id: { name, email } })
    constructor({ registry, world, onTeam = () => {}, known = {} }) {
        this.world = world;
        this.shell = new Shell({ registry, ui: QUIET_UI });
        this.shell.setWorld(world);
        this.onTeam = onTeam;
        this.data = {};
        this.people = {};
        this.known = known;
        this.clock = null;
        this.savedRoots = world.writableRoots;
        world.writableRoots = ['/'];
    }

    // ---- paths and files ----------------------------------------------------------------------

    path(p) {
        if (p.startsWith('/')) return p;
        if (p === '~') return HOME;
        if (p.startsWith('~/')) return HOME + p.slice(1);
        return joinPath(HOME, p);
    }

    async write(path, text) {
        const abs = this.path(path);
        await mkdirp(this.world.pfs, dirname(abs));
        await this.world.pfs.writeFile(abs, text, 'utf8');
    }

    // files('website', { 'index.html': '…', 'css/style.css': '…' })
    async files(dir, map) {
        for (const [rel, text] of Object.entries(map)) {
            if (text === null) await this.world.pfs.unlink(joinPath(this.path(dir), rel)).catch(() => {});
            else await this.write(joinPath(this.path(dir), rel), text);
        }
    }

    async mkdir(dir) {
        await mkdirp(this.world.pfs, this.path(dir));
    }

    async read(path) {
        return this.world.pfs.readFile(this.path(path), 'utf8');
    }

    // ---- commands -------------------------------------------------------------------------------

    // Runs shell lines in a directory; any failure aborts the mission setup loudly.
    async sh(dir, lines) {
        const world = this.world;
        const saved = world.cwd;
        world.cwd = this.path(dir);
        await mkdirp(world.pfs, world.cwd);
        try {
            let out = '';
            for (const line of [].concat(lines)) {
                if (this.clock) this.tick();
                const res = await this.shell.capture(line);
                if (res.status !== 0) throw new Error(`mission setup: "${line}" failed in ${world.cwd}:\n${res.stderr || res.stdout}`);
                out += res.stdout;
            }
            return out;
        } finally {
            world.cwd = saved;
        }
    }

    // ---- time: setups happen "in the past" so `git log` looks like real work ----------------------

    // at(3, '09:12') → three days ago at 09:12 local time
    at(daysAgo, time = '10:00') {
        const [hh, mm] = time.split(':').map(Number);
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        d.setHours(hh, mm, 0, 0);
        this.clock = Math.floor(d.getTime() / 1000);
        setClock(() => this.clock, { localTz: true });
    }

    // a few minutes pass between two commands
    tick(minutes = 3) {
        if (this.clock === null) return;
        this.clock += minutes * 60 + Math.floor(Math.random() * 50);
        if (this.clock > Date.now() / 1000 - 60) this.clock = Math.floor(Date.now() / 1000) - 60;
    }

    later(minutes) {
        this.tick(minutes);
    }

    now() {
        this.clock = null;
        setClock(null);
    }

    // ---- people ---------------------------------------------------------------------------------------

    person(id, { name, email }) {
        this.people[id] = { id, name, email, home: joinPath(TEAM_ROOT, id) };
        return this.people[id];
    }

    who(id) {
        if (this.people[id]) return this.people[id];
        if (this.known[id]) return this.person(id, this.known[id]);
        throw new Error(`mission setup: unknown person "${id}"`);
    }

    // Commit as somebody else in a repository of the student (sets the identity only for this commit)
    async commitAs(id, dir, { files = {}, message, add = '-A' }) {
        const p = this.who(id);
        await this.files(dir, files);
        const repo = this.path(dir);
        await this.sh(repo, [`git add ${add}`]);
        const env = `GIT_AUTHOR_NAME=${q(p.name)} GIT_AUTHOR_EMAIL=${q(p.email)} GIT_COMMITTER_NAME=${q(p.name)} GIT_COMMITTER_EMAIL=${q(p.email)}`;
        await this.sh(repo, [`${env} git commit -q -m ${q(message)}`]);
        return this.headOf(repo);
    }

    async commit(dir, { files = {}, message, add = '-A' }) {
        await this.files(dir, files);
        await this.sh(dir, [`git add ${add}`, `git commit -q -m ${q(message)}`]);
        return this.headOf(dir);
    }

    async headOf(dir, ref = 'HEAD') {
        return (await this.sh(dir, [`git rev-parse ${ref}`])).trim();
    }

    // ---- the simulated server --------------------------------------------------------------------------

    // Creates an empty repository on git.sim (like "New repository" on GitHub)
    async server(path, { branch = 'main' } = {}) {
        const gitdir = `${SIM_ROOT}/${path}.git`;
        await mkdirp(this.world.pfs, gitdir);
        await this.sh('/', [`git init -q --bare -b ${branch} ${q(gitdir)}`]);
        return simUrl(path);
    }

    // A teammate's own clone of a server repository
    async teammateClone(id, path) {
        const p = this.who(id);
        const dir = joinPath(p.home, path.split('/').pop());
        await mkdirp(this.world.pfs, p.home);
        await this.sh(p.home, [`git clone -q ${simUrl(path)}`]);
        await this.sh(dir, [`git config user.name ${q(p.name)}`, `git config user.email ${q(p.email)}`]);
        return dir;
    }

    teammateDir(id, path) {
        return joinPath(this.who(id).home, path.split('/').pop());
    }

    // A teammate commits in their clone (and optionally pushes)
    async teammate(id, path, { files = {}, message, push = true, branch = null }) {
        const dir = this.teammateDir(id, path);
        if (branch) await this.sh(dir, [`git switch -q ${branch} 2>/dev/null || git switch -q -c ${branch}`]);
        await this.files(dir, files);
        await this.sh(dir, ['git add -A', `git commit -q -m ${q(message)}`]);
        if (push) await this.teammatePush(id, path, { branch });
        return this.headOf(dir);
    }

    async teammatePush(id, path, { branch = null } = {}) {
        const dir = this.teammateDir(id, path);
        const b = branch || (await this.sh(dir, ['git branch --show-current'])).trim();
        await this.sh(dir, [`git pull -q --no-rebase origin ${b} 2>/dev/null || true`, `git push -q -u origin ${b}`]);
        this.onTeam({ person: this.who(id), path, branch: b, action: 'push' });
    }

    // Remember values (commit ids …) for the objective checks
    remember(key, value) {
        this.data[key] = value;
        return value;
    }

    finish() {
        this.now();
        this.world.writableRoots = this.savedRoots;
    }
}
