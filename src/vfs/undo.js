// "Undo the last command" for the whole virtual computer (files AND .git).
// Snapshots share unchanged file contents, so keeping a stack of them is cheap.
// This safety net exists only in the Werkstatt – the coach says so every time.

import { joinPath } from '../core/util.js';

const MAX_STEPS = 25;
const MAX_BYTES = 40 * 1024 * 1024;

function stampOf(st) {
    return `${st.isDirectory() ? 'd' : st.isSymbolicLink?.() ? 'l' : 'f'}:${st.mtimeMs}:${st.size}:${st.ino}:${st.mode}`;
}

export class UndoStack {
    // exclude: folders that are "the outside world" (simulated server, teammates).
    // Undo rewinds only the student's own computer – a push cannot be taken back either.
    constructor(world, { exclude = [] } = {}) {
        this.world = world;
        this.exclude = exclude;
        this.current = null; // Map path → { stamp, kind, data }
        this.stack = [];
        this.disabled = false;
        this.reason = null;
    }

    async scan(previous) {
        const pfs = this.world.pfs;
        const map = new Map();
        let bytes = 0;
        const visit = async dir => {
            let names;
            try { names = await pfs.readdir(dir); } catch { return; }
            for (const name of names) {
                const path = joinPath(dir, name);
                if (this.exclude.some(root => path === root || path.startsWith(root + '/'))) continue;
                let st;
                try { st = await pfs.lstat(path); } catch { continue; }
                const stamp = stampOf(st);
                const old = previous?.get(path);
                if (st.isDirectory()) {
                    map.set(path, { stamp, kind: 'dir' });
                    await visit(path);
                    continue;
                }
                if (old && old.stamp === stamp) {
                    map.set(path, old);
                } else if (st.isSymbolicLink?.()) {
                    map.set(path, { stamp, kind: 'link', data: await pfs.readlink(path) });
                } else {
                    map.set(path, { stamp, kind: 'file', mode: st.mode, data: await pfs.readFile(path) });
                }
                bytes += st.size || 0;
            }
        };
        await visit('/');
        return { map, bytes };
    }

    async init() {
        try {
            const { map, bytes } = await this.scan(null);
            if (bytes > MAX_BYTES) return this.disable('size');
            this.current = map;
        } catch (e) {
            this.disable(e.message);
        }
    }

    disable(reason) {
        this.disabled = true;
        this.reason = reason;
        this.stack = [];
        this.current = null;
    }

    // Call after every command: records the state *before* it if anything changed.
    async afterCommand(label) {
        if (this.disabled || !this.current) return false;
        const { map, bytes } = await this.scan(this.current);
        if (bytes > MAX_BYTES) {
            this.disable('size');
            return false;
        }
        let changed = map.size !== this.current.size;
        if (!changed) {
            for (const [path, entry] of map) {
                const old = this.current.get(path);
                if (!old || old.stamp !== entry.stamp) { changed = true; break; }
            }
        }
        if (changed) {
            this.stack.push({ label, snapshot: this.current, at: Date.now() });
            if (this.stack.length > MAX_STEPS) this.stack.shift();
        }
        this.current = map;
        return changed;
    }

    canUndo() {
        return !this.disabled && this.stack.length > 0;
    }

    peek() {
        return this.stack[this.stack.length - 1] || null;
    }

    async undo() {
        const step = this.stack.pop();
        if (!step) return null;
        const pfs = this.world.pfs;
        const target = step.snapshot;
        // remove what did not exist back then (deepest paths first)
        const now = await this.scan(this.current);
        const extra = [...now.map.keys()].filter(p => !target.has(p)).sort((a, b) => b.length - a.length);
        for (const p of extra) {
            const e = now.map.get(p);
            try {
                if (e.kind === 'dir') await pfs.rmdir(p);
                else await pfs.unlink(p);
            } catch { /* already gone */ }
        }
        // recreate directories, then files that differ
        const paths = [...target.keys()].sort((a, b) => a.length - b.length);
        for (const p of paths) {
            const e = target.get(p);
            const cur = now.map.get(p);
            if (e.kind === 'dir') {
                if (!cur) await pfs.mkdir(p).catch(() => {});
                continue;
            }
            if (cur && cur.stamp === e.stamp) continue;
            if (cur && cur.kind === 'dir') continue;
            if (e.kind === 'link') {
                await pfs.unlink(p).catch(() => {});
                await pfs.symlink(e.data, p);
            } else {
                await pfs.writeFile(p, e.data, { mode: e.mode });
            }
        }
        this.current = (await this.scan(null)).map;
        return step;
    }
}
