// File explorer: the home directory as a tree, with git status badges that use
// the same two-letter codes as `git status -s`.

import { h, icon, clear } from './dom.js';
import { L } from '../core/i18n.js';
import { joinPath, isInside } from '../core/util.js';
import { HOME } from '../vfs/world.js';

const CODE_TEXT = {
    '??': { de: 'neu – Git kennt die Datei noch nicht (unversioniert)', en: 'new – git does not know this file yet (untracked)' },
    ' M': { de: 'geändert, aber nicht vorgemerkt', en: 'changed, not staged' },
    'M ': { de: 'Änderung vorgemerkt (Staging-Area)', en: 'change staged' },
    MM: { de: 'vorgemerkt – und danach noch einmal geändert', en: 'staged – and changed again afterwards' },
    'A ': { de: 'neue Datei, vorgemerkt', en: 'new file, staged' },
    AM: { de: 'neue Datei, vorgemerkt und danach geändert', en: 'new file, staged and changed again' },
    'R ': { de: 'umbenannt, vorgemerkt', en: 'renamed, staged' },
    UU: { de: 'Konflikt – muss gelöst werden', en: 'conflict – needs resolving' },
    AA: { de: 'Konflikt (beide neu angelegt)', en: 'conflict (both added)' },
    DU: { de: 'Konflikt (bei dir gelöscht)', en: 'conflict (deleted by you)' },
    UD: { de: 'Konflikt (bei den anderen gelöscht)', en: 'conflict (deleted by them)' },
};

function badgeTone(code) {
    if (/U|AA|DD/.test(code)) return 'conflict';
    if (code[0] !== ' ' && code[0] !== '?' && code[1] !== ' ') return 'both';
    if (code[0] !== ' ' && code[0] !== '?') return 'staged';
    return 'wd';
}

export class Explorer {
    constructor(root, { onOpenFile, onCd }) {
        this.root = root;
        this.onOpenFile = onOpenFile;
        this.onCd = onCd;
        this.expanded = new Set([HOME]);
        this.showHidden = false;
        this.world = null;
        this.state = null;
        this.build();
    }

    build() {
        this.hiddenBtn = h('button', {
            class: 'btn quiet icon-btn', type: 'button', 'aria-pressed': 'false',
            onclick: () => { this.showHidden = !this.showHidden; this.hiddenBtn.setAttribute('aria-pressed', String(this.showHidden)); this.render(); },
        }, h('span', { class: 'dotfile', 'aria-hidden': 'true' }, '.*'));
        this.head = h('div', { class: 'pane-head' },
            h('h2', { class: 'label' }, h('span', { class: 'num' }, '01'), h('span', { class: 'lbl-files' })),
            this.hiddenBtn);
        this.tree = h('div', { class: 'tree', role: 'tree' });
        // one Tab stop for the whole tree; the arrow keys move inside it (roving tabindex)
        this.tree.addEventListener('keydown', ev => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key)) return;
            const rows = [...this.tree.querySelectorAll('[role="treeitem"]')];
            if (!rows.length) return;
            const i = rows.indexOf(document.activeElement);
            const j = ev.key === 'Home' ? 0 : ev.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)));
            ev.preventDefault();
            this.focusRow(rows[j]);
        });
        this.tree.addEventListener('focusin', ev => {
            if (ev.target.dataset?.path) this.focusedPath = ev.target.dataset.path;
        });
        this.cwdLine = h('div', { class: 'cwd-line mono' });
        this.root.append(this.head, h('div', { class: 'pane-body' }, this.cwdLine, this.tree));
        this.relabel();
    }

    relabel() {
        this.head.querySelector('.lbl-files').textContent = L({ de: 'Dateien', en: 'Files' });
        this.hiddenBtn.title = L({ de: 'Versteckte Dateien (.gitignore, .git …) zeigen', en: 'Show hidden files (.gitignore, .git …)' });
    }

    statusMap() {
        const map = new Map();
        const repo = this.state?.repo;
        if (!repo || repo.broken) return map;
        for (const e of repo.status.entries) {
            const code = `${e.x}${e.y}`;
            map.set(joinPath(repo.dir, e.path), code === '??' ? '??' : code);
        }
        return map;
    }

    async update(world, state) {
        this.world = world;
        this.state = state;
        // keep the path to the current directory open
        let p = world.cwd;
        while (isInside(p, HOME)) {
            this.expanded.add(p);
            if (p === HOME) break;
            p = p.slice(0, p.lastIndexOf('/')) || '/';
        }
        await this.render();
    }

    async render() {
        if (!this.world) return;
        const statuses = this.statusMap();
        const dirtyDirs = new Map();
        for (const [path, code] of statuses) {
            let d = path.slice(0, path.lastIndexOf('/'));
            while (d.length >= HOME.length) {
                const prev = dirtyDirs.get(d);
                const tone = badgeTone(code);
                if (!prev || tone === 'conflict') dirtyDirs.set(d, tone);
                d = d.slice(0, d.lastIndexOf('/'));
            }
        }
        this.cwdLine.textContent = this.world.displayPath();
        this.cwdLine.title = L({ de: 'Aktueller Ordner (pwd)', en: 'Current folder (pwd)' });
        const frag = document.createDocumentFragment();
        frag.appendChild(await this.node(HOME, '~', 0, statuses, dirtyDirs, true));
        const hadFocus = this.tree.contains(document.activeElement);
        clear(this.tree).appendChild(frag);
        // the Tab stop: the row focused last, else the current folder
        const rows = [...this.tree.querySelectorAll('[role="treeitem"]')];
        for (const r of rows) r.tabIndex = -1;
        const target = rows.find(r => r.dataset.path === this.focusedPath) || rows.find(r => r.dataset.path === this.world.cwd) || rows[0];
        if (target) {
            target.tabIndex = 0;
            if (hadFocus) target.focus();
        }
    }

    async node(path, name, depth, statuses, dirtyDirs, isDir) {
        const pfs = this.world.pfs;
        const isCwd = path === this.world.cwd;
        if (!isDir) {
            const code = statuses.get(path);
            const row = h('div', {
                class: `row file${code ? ' st-' + badgeTone(code) : ''}`,
                role: 'treeitem', tabindex: '-1', 'data-path': path, style: { '--depth': depth },
                title: path.replace(HOME, '~'),
                onclick: () => this.onOpenFile(path),
                onkeydown: ev => { if (ev.key === 'Enter') this.onOpenFile(path); },
            }, icon('file'), h('span', { class: 'name' }, name),
            code ? h('span', { class: `badge ${badgeTone(code)}`, title: L(CODE_TEXT[code] || { de: code, en: code }) }, code.replace(' ', '·')) : null);
            return row;
        }
        const open = this.expanded.has(path);
        const isGit = name === '.git';
        const dirTone = dirtyDirs.get(path);
        const row = h('div', {
            class: `row dir${isCwd ? ' cwd' : ''}${isGit ? ' gitdir' : ''}${dirTone ? ' has-' + dirTone : ''}`,
            role: 'treeitem', tabindex: '-1', 'data-path': path, 'aria-expanded': String(open), style: { '--depth': depth },
            title: isCwd ? L({ de: 'Hier bist du (aktueller Ordner)', en: 'You are here (current folder)' }) : L({ de: 'Klick: hineinwechseln (cd) · Pfeil: auf-/zuklappen', en: 'Click: change into it (cd) · arrow: expand/collapse' }),
        },
        h('button', {
            // keyboard users fold with ←/→ on the row, so this button is not a Tab stop
            class: 'twisty', type: 'button', tabindex: '-1', 'aria-label': open ? L({ de: 'zuklappen', en: 'collapse' }) : L({ de: 'aufklappen', en: 'expand' }),
            onclick: ev => { ev.stopPropagation(); this.toggle(path); },
        }, open ? '▾' : '▸'),
        icon(open ? 'folderOpen' : 'folder'),
        h('span', { class: 'name' }, name),
        isCwd ? h('span', { class: 'here', 'aria-hidden': 'true' }, L({ de: 'hier', en: 'here' })) : null);
        row.addEventListener('click', () => { if (!isGit) this.onCd(path); else this.toggle(path); });
        row.addEventListener('keydown', ev => {
            if (ev.key === 'Enter') this.onCd(path);
            if (ev.key === 'ArrowRight' && !open) this.toggle(path);
            if (ev.key === 'ArrowLeft' && open) this.toggle(path);
        });
        const wrap = h('div', { class: 'node' }, row);
        if (open) {
            let names = [];
            try { names = await pfs.readdir(path); } catch { /* gone */ }
            const entries = [];
            for (const n of names) {
                if (!this.showHidden && n.startsWith('.')) continue;
                try {
                    const st = await pfs.stat(joinPath(path, n));
                    entries.push({ n, dir: st.isDirectory() });
                } catch { /* broken */ }
            }
            entries.sort((a, b) => (a.dir === b.dir ? a.n.localeCompare(b.n, 'en') : a.dir ? -1 : 1));
            const kids = h('div', { class: 'kids', role: 'group' });
            for (const e of entries) kids.appendChild(await this.node(joinPath(path, e.n), e.n, depth + 1, statuses, dirtyDirs, e.dir));
            if (!entries.length) kids.appendChild(h('div', { class: 'row empty', style: { '--depth': depth + 1 } }, L({ de: '(leer)', en: '(empty)' })));
            wrap.appendChild(kids);
        }
        return wrap;
    }

    focusRow(row) {
        for (const r of this.tree.querySelectorAll('[role="treeitem"]')) r.tabIndex = -1;
        row.tabIndex = 0;
        row.focus();
    }

    toggle(path) {
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
        this.render();
    }
}
