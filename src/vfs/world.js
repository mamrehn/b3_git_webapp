// A "world" is one isolated computer the student works on: its own file system,
// working directory, environment and command history.
//
//   sandbox – free play, real network access (GitHub via the CORS proxy)
//   mission – rebuilt for each mission, uses simulated remotes only
//
// The sandbox keeps the IndexedDB name of the previous app version ("gitlearning")
// so students do not lose files they created before the redesign.

import { normalizePath, isInside } from '../core/util.js';
import { mkdirp } from './fsutil.js';

export const HOME = '/home/student';
export const USER = 'student';
export const HOSTNAME = 'werkstatt';

const DEFAULT_ENV = {
    HOME,
    USER,
    LOGNAME: USER,
    SHELL: '/bin/bash',
    TERM: 'xterm-256color',
    LANG: 'en_US.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOSTNAME,
    EDITOR: 'nano',
};

export class World {
    constructor({ id, dbName, kind, fs = null }) {
        this.id = id;
        this.dbName = dbName;
        this.kind = kind;
        this.fs = fs;
        this.pfs = fs ? fs.promises : null;
        this.cwd = HOME;
        this.oldpwd = null;
        this.env = { ...DEFAULT_ENV };
        this.aliases = { ll: 'ls -la', la: 'ls -A' };
        this.history = [];
        this.lastStatus = 0;
        this.writableRoots = [HOME, '/tmp'];
        this.meta = {};
    }

    async open({ wipe = false } = {}) {
        if (!this.fs) {
            const LightningFS = globalThis.LightningFS;
            this.fs = new LightningFS(this.dbName, { wipe });
            this.pfs = this.fs.promises;
        } else if (wipe) {
            await this.wipe();
        }
        await mkdirp(this.pfs, HOME);
        await mkdirp(this.pfs, '/tmp');
        if (!wipe) this.loadSession();
        return this;
    }

    async wipe() {
        if (this.fs && typeof this.fs.init === 'function' && this.dbName) {
            this.fs.init(this.dbName, { wipe: true });
            this.pfs = this.fs.promises;
        } else if (this.pfs) {
            const { rmrf } = await import('./fsutil.js');
            for (const name of await this.pfs.readdir('/')) await rmrf(this.pfs, '/' + name);
        }
        this.cwd = HOME;
        this.oldpwd = null;
        this.history = [];
        this.lastStatus = 0;
        this.env = { ...DEFAULT_ENV };
        this.clearSession();
    }

    resolve(path) {
        if (path === '~' || path.startsWith('~/')) path = HOME + path.slice(1);
        return normalizePath(path.startsWith('/') ? path : `${this.cwd}/${path}`);
    }

    canWrite(path) {
        const p = normalizePath(path);
        return this.writableRoots.some(root => isInside(p, root));
    }

    displayPath(path = this.cwd) {
        if (path === HOME) return '~';
        if (path.startsWith(HOME + '/')) return '~' + path.slice(HOME.length);
        return path;
    }

    // ---- session persistence (cwd, history, env) --------------------------------

    sessionKey() {
        return `gw.session.${this.id}`;
    }

    saveSession() {
        try {
            const custom = {};
            for (const [k, v] of Object.entries(this.env)) {
                if (DEFAULT_ENV[k] !== v) custom[k] = v;
            }
            localStorage.setItem(this.sessionKey(), JSON.stringify({
                cwd: this.cwd,
                oldpwd: this.oldpwd,
                env: custom,
                aliases: this.aliases,
                history: this.history.slice(-500),
            }));
        } catch { /* storage unavailable */ }
    }

    loadSession() {
        try {
            const raw = localStorage.getItem(this.sessionKey());
            if (!raw) return;
            const s = JSON.parse(raw);
            if (typeof s.cwd === 'string') this.cwd = s.cwd;
            this.oldpwd = s.oldpwd || null;
            Object.assign(this.env, s.env || {});
            if (s.aliases) this.aliases = s.aliases;
            if (Array.isArray(s.history)) this.history = s.history;
        } catch { /* ignore broken session data */ }
    }

    clearSession() {
        try { localStorage.removeItem(this.sessionKey()); } catch { /* ignore */ }
    }
}
