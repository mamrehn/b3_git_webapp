// History as a metro map: branches are lines, commits are stations, HEAD is
// "you are here". Oldest on the left, newest on the right.

import { h, s, clear, md } from './dom.js';
import { L } from '../core/i18n.js';
import { shortOid, relativeDate } from '../core/util.js';

const COL = 66;
const LANE = 48;
const PAD_X = 40;
const PAD_TOP = 64;
const PAD_BOTTOM = 56;
const R = 8;

function topoOldestFirst(commits) {
    const list = [...commits.values()];
    const byOid = new Map(list.map(c => [c.oid, c]));
    const indeg = new Map(list.map(c => [c.oid, 0]));
    for (const c of list) for (const p of c.parents) if (byOid.has(p)) indeg.set(c.oid, indeg.get(c.oid) + 1);
    // Kahn's algorithm, preferring older commits
    const ready = list.filter(c => indeg.get(c.oid) === 0).sort((a, b) => a.time - b.time);
    const children = new Map();
    for (const c of list) for (const p of c.parents) if (byOid.has(p)) (children.get(p) || children.set(p, []).get(p)).push(c);
    const out = [];
    while (ready.length) {
        const c = ready.shift();
        out.push(c);
        for (const ch of children.get(c.oid) || []) {
            indeg.set(ch.oid, indeg.get(ch.oid) - 1);
            if (indeg.get(ch.oid) === 0) {
                // insert keeping time order
                let i = ready.findIndex(r => r.time > ch.time);
                if (i === -1) i = ready.length;
                ready.splice(i, 0, ch);
            }
        }
    }
    return out;
}

export class GraphView {
    constructor(root, { onCommand }) {
        this.root = root;
        this.onCommand = onCommand;
        this.state = null;
        this.popover = null;
    }

    update(state, highlight = null) {
        this.state = state;
        this.fresh = new Set(highlight?.commits || []);
        this.render();
    }

    lanesFor(repo, ordered) {
        const lane = new Map();
        const laneInfo = [];
        const assignChain = (tipOid, info) => {
            let cur = tipOid;
            const idx = laneInfo.length;
            let used = false;
            while (cur && repo.commits.has(cur) && !lane.has(cur)) {
                lane.set(cur, idx);
                used = true;
                cur = repo.commits.get(cur).parents[0];
            }
            if (used) laneInfo.push(info);
        };
        const head = repo.head;
        const mainName = repo.branches.find(b => b.name === 'main' || b.name === 'master')?.name;
        const order = [];
        if (mainName) order.push(repo.branches.find(b => b.name === mainName));
        if (head.branch && head.branch !== mainName) order.push(repo.branches.find(b => b.name === head.branch));
        for (const b of repo.branches) if (!order.includes(b)) order.push(b);
        for (const b of order.filter(Boolean)) assignChain(b.oid, { name: b.name, kind: 'branch' });
        if (head.detached && head.oid) assignChain(head.oid, { name: 'HEAD', kind: 'detached' });
        for (const r of repo.remoteBranches) assignChain(r.oid, { name: r.name, kind: 'remote' });
        for (const t of repo.tags) assignChain(t.commit, { name: t.name, kind: 'tag' });
        // commits only reachable through merges, newest first
        for (const c of [...ordered].reverse()) {
            if (!lane.has(c.oid) && !c.ghost) assignChain(c.oid, { name: null, kind: 'merged' });
        }
        for (const c of [...ordered].reverse()) {
            if (!lane.has(c.oid)) assignChain(c.oid, { name: null, kind: 'ghost' });
        }
        return { lane, laneInfo };
    }

    render() {
        const root = clear(this.root);
        this.closePopover();
        const repo = this.state?.repo;
        if (!repo || repo.broken) {
            root.appendChild(h('div', { class: 'stage-empty' }, md(L({ de: 'Hier erscheint die Geschichte deines Repositories als Liniennetz, sobald du in einem Repository bist.', en: 'Your repository\'s history appears here as a metro map once you are in a repository.' }))));
            return;
        }
        if (!repo.commits.size) {
            root.appendChild(h('div', { class: 'stage-empty' }, md(L({ de: 'Noch keine Commits. Dein erster Commit wird hier die erste Station.', en: 'No commits yet. Your first commit will be the first station here.' }))));
            return;
        }
        const ordered = topoOldestFirst(repo.commits);
        const x = new Map(ordered.map((c, i) => [c.oid, PAD_X + i * COL]));
        const { lane, laneInfo } = this.lanesFor(repo, ordered);
        const y = oid => PAD_TOP + (lane.get(oid) ?? 0) * LANE;
        const color = idx => (laneInfo[idx]?.kind === 'ghost' ? 'var(--ink-3)' : `var(--line-${idx % 6})`);
        const width = PAD_X * 2 + (ordered.length - 1) * COL + 200; // room for terminus labels
        const height = PAD_TOP + Math.max(1, laneInfo.length) * LANE + PAD_BOTTOM;
        const svg = s('svg', { class: 'metro', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': L({ de: 'Commit-Geschichte als Liniennetz', en: 'Commit history as a metro map' }) });

        // edges (draw first so stations sit on top)
        const edges = s('g', { class: 'edges' });
        for (const c of ordered) {
            c.parents.forEach((p, i) => {
                if (!repo.commits.has(p)) return;
                const x1 = x.get(p);
                const y1 = y(p);
                const x2 = x.get(c.oid);
                const y2 = y(c.oid);
                const sameLane = lane.get(p) === lane.get(c.oid);
                const ghost = c.ghost || repo.commits.get(p).ghost;
                let d;
                if (sameLane) {
                    d = `M${x1} ${y1} H${x2}`;
                } else {
                    const dy = Math.abs(y2 - y1);
                    const dx = Math.min(dy, Math.max(0, x2 - x1 - 8));
                    if (i === 0) {
                        // branching off: leave the parent's line diagonally, then run along the new line
                        d = `M${x1} ${y1} L${x1 + dx} ${y2} H${x2}`;
                    } else {
                        // merging in: run along the parent's line, then join diagonally
                        d = `M${x1} ${y1} H${x2 - dx} L${x2} ${y2}`;
                    }
                }
                const laneIdx = i === 0 && !sameLane ? lane.get(c.oid) : lane.get(i === 0 ? c.oid : p);
                edges.appendChild(s('path', { d, class: `edge${ghost ? ' ghost' : ''}`, stroke: color(laneIdx) }));
            });
        }
        svg.appendChild(edges);

        // labels per commit
        const labels = new Map();
        const addLabel = (oid, label) => {
            if (!repo.commits.has(oid)) return;
            if (!labels.has(oid)) labels.set(oid, []);
            labels.get(oid).push(label);
        };
        const head = repo.head;
        for (const b of repo.branches) addLabel(b.oid, { kind: 'branch', text: b.name, head: head.branch === b.name, lane: lane.get(b.oid) });
        if (head.detached && head.oid) addLabel(head.oid, { kind: 'head-detached', text: 'HEAD' });
        for (const r of repo.remoteBranches) addLabel(r.oid, { kind: 'remote', text: r.name, sim: repo.remotes.find(x => x.name === r.remote)?.kind === 'simulated' });
        for (const t of repo.tags) addLabel(t.commit, { kind: 'tag', text: t.name });
        for (const st of repo.stash) if (st.base) addLabel(st.base, { kind: 'stash', text: `stash@{${st.index}}` });
        const serverOnly = [];
        for (const [remote, server] of Object.entries(repo.servers || {})) {
            if (!server) continue;
            for (const [b, oid] of Object.entries(server.branches)) {
                const tracking = repo.remoteBranches.find(r => r.remote === remote && r.branch === b);
                if (tracking && tracking.oid === oid) continue;
                if (repo.commits.has(oid)) addLabel(oid, { kind: 'server', text: `${remote}: ${b}` });
                else serverOnly.push(`${remote}/${b}`);
            }
        }
        // ghost chain tips
        for (const oid of repo.ghosts || []) {
            const c = repo.commits.get(oid);
            const hasGhostChild = [...repo.commits.values()].some(o => o.ghost && o.parents.includes(oid));
            if (c && !hasGhostChild) addLabel(oid, { kind: 'ghost', text: L({ de: 'nur im Reflog', en: 'reflog only' }) });
        }

        // stations
        const stations = s('g', { class: 'stations' });
        for (const c of ordered) {
            const cx = x.get(c.oid);
            const cy = y(c.oid);
            const isMerge = c.parents.length > 1;
            const isHead = head.oid === c.oid;
            const g = s('g', {
                class: `station${c.ghost ? ' ghost' : ''}${isMerge ? ' merge' : ''}${isHead ? ' is-head' : ''}${this.fresh.has(c.oid) ? ' is-new' : ''}`,
                transform: `translate(${cx} ${cy})`, tabindex: '0', role: 'button',
                'aria-label': `${shortOid(c.oid)} ${c.subject}`,
                onclick: ev => this.openPopover(c, ev.currentTarget),
                onkeydown: ev => { if (ev.key === 'Enter') this.openPopover(c, ev.currentTarget); },
            });
            g.appendChild(s('title', {}, `${shortOid(c.oid)} — ${c.subject}\n${c.author}, ${relativeDate(c.time)}`));
            if (isMerge) g.appendChild(s('rect', { x: -11, y: -11, width: 22, height: 22, rx: 11, class: 'dot-merge', stroke: color(lane.get(c.oid)) }));
            else g.appendChild(s('circle', { r: R, class: 'dot', stroke: color(lane.get(c.oid)) }));
            if (isHead) g.appendChild(s('circle', { r: 3.5, class: 'dot-core' }));
            g.appendChild(s('text', { class: 'oid', y: R + 16, 'text-anchor': 'middle' }, shortOid(c.oid, 5)));
            stations.appendChild(g);
        }
        svg.appendChild(stations);

        // labels: branch/HEAD names sit at the end of their line like a metro terminus (right of
        // the tip). Where the line continues (the tip has children), they go above instead, so
        // they never cover an edge. Everything else goes below.
        const hasChildren = new Set();
        for (const c of ordered) for (const p of c.parents) hasChildren.add(p);
        const lbl = s('g', { class: 'labels' });
        for (const [oid, list] of labels) {
            const cx = x.get(oid);
            const cy = y(oid);
            const terminus = !hasChildren.has(oid);
            let named = 0;
            let below = 0;
            const sorted = list.sort((a, b) => (b.head ? 1 : 0) - (a.head ? 1 : 0));
            for (const l of sorted) {
                const isName = l.kind === 'branch' || l.kind === 'head-detached';
                const fill = color(l.lane ?? lane.get(oid));
                if (isName && terminus) {
                    lbl.appendChild(this.pill(l, cx + R + 8, cy + [0, 22, -22, 44, -44][named % 5], fill, { anchor: 'left' }));
                    named++;
                } else if (isName) {
                    lbl.appendChild(this.pill(l, cx, cy - (R + 12 + named * 22), fill));
                    named++;
                } else {
                    lbl.appendChild(this.pill(l, cx, cy + R + 36 + below * 20, fill));
                    below++;
                }
            }
        }
        svg.appendChild(lbl);

        const scroller = h('div', { class: 'metro-scroll' }, svg);
        root.appendChild(scroller);
        if (serverOnly.length) {
            root.appendChild(h('p', { class: 'metro-note sim' }, L({ de: `Der simulierte Server hat neue Commits auf ${serverOnly.join(', ')}, die du noch nicht kennst – \`git fetch\` holt sie.`, en: `The simulated server has new commits on ${serverOnly.join(', ')} that you don't know yet – \`git fetch\` gets them.` })));
        }
        requestAnimationFrame(() => {
            const hx = x.get(head.oid) ?? width;
            scroller.scrollLeft = Math.max(0, hx - scroller.clientWidth + 160);
        });
    }

    // anchor 'left': cx is the pill's left edge instead of its centre
    pill(l, cx, cy, laneColor, { anchor = 'center' } = {}) {
        const text = l.text.length > 18 ? l.text.slice(0, 17) + '…' : l.text;
        const w = text.length * 7.4 + (l.head ? 52 : 18);
        const px = anchor === 'left' ? cx + w / 2 : cx;
        const g = s('g', { class: `pill pill-${l.kind}${l.sim ? ' sim' : ''}`, transform: `translate(${px} ${cy})` });
        g.appendChild(s('title', {}, l.text));
        if (l.head) {
            // "HEAD → main": ink part + line-coloured part
            g.appendChild(s('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: 4, class: 'pill-bg', fill: laneColor }));
            g.appendChild(s('rect', { x: -w / 2, y: -10, width: 44, height: 20, rx: 4, class: 'pill-head' }));
            g.appendChild(s('text', { x: -w / 2 + 22, y: 4, 'text-anchor': 'middle', class: 'pill-head-text' }, 'HEAD'));
            g.appendChild(s('text', { x: -w / 2 + 44 + (w - 44) / 2, y: 4, 'text-anchor': 'middle', class: 'pill-text' }, text));
            // the pin points at the station: down from above, left from the side
            g.appendChild(s('path', { d: anchor === 'left' ? `M${-w / 2} -4 L${-w / 2 - 6} 0 L${-w / 2} 4 Z` : 'M-4 10 L0 16 L4 10 Z', class: 'pill-pin' }));
            return g;
        }
        const fill = l.kind === 'branch' ? laneColor : 'none';
        g.appendChild(s('rect', { x: -w / 2, y: -10, width: w, height: 20, rx: l.kind === 'tag' ? 2 : 10, class: 'pill-bg', fill, stroke: l.kind === 'remote' ? laneColor : null }));
        g.appendChild(s('text', { y: 4, 'text-anchor': 'middle', class: 'pill-text' }, text));
        return g;
    }

    openPopover(c, anchor) {
        this.closePopover();
        const repo = this.state.repo;
        const short = shortOid(c.oid);
        const refs = [];
        for (const b of repo.branches) if (b.oid === c.oid) refs.push(b.name);
        const action = (label, cmd) => h('button', { type: 'button', class: 'pop-action', onclick: () => { this.onCommand(cmd); this.closePopover(); } }, h('span', {}, L(label)), h('code', {}, cmd));
        const pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': `${short} ${c.subject}` },
            h('div', { class: 'pop-head' }, h('code', { class: 'pop-oid' }, short), h('strong', {}, c.subject)),
            h('p', { class: 'pop-meta' }, `${c.author} · ${relativeDate(c.time)}${c.parents.length > 1 ? L({ de: ' · Merge-Commit', en: ' · merge commit' }) : ''}${c.ghost ? L({ de: ' · nur noch im Reflog', en: ' · only in the reflog' }) : ''}`),
            h('div', { class: 'pop-actions' },
                action({ de: 'Anzeigen', en: 'Show' }, `git show ${short}`),
                c.ghost ? action({ de: 'Retten (Branch)', en: 'Rescue (branch)' }, `git branch rettung ${short}`) : action({ de: 'Branch hier anlegen', en: 'Create branch here' }, `git switch -c neu ${short}`),
                action({ de: 'Hierhin wechseln', en: 'Go here' }, refs[0] ? `git switch ${refs[0]}` : `git switch --detach ${short}`),
                !c.ghost && repo.head.oid !== c.oid ? action({ de: 'Unterschied zu jetzt', en: 'Diff to now' }, `git diff ${short} HEAD`) : null),
            h('button', { type: 'button', class: 'pop-close', 'aria-label': 'close', onclick: () => this.closePopover() }, '×'));
        document.body.appendChild(pop);
        const r = anchor.getBoundingClientRect();
        const pw = 300;
        pop.style.left = `${Math.min(window.innerWidth - pw - 12, Math.max(12, r.left + r.width / 2 - pw / 2))}px`;
        pop.style.top = `${r.bottom + 10}px`;
        this.popover = pop;
        setTimeout(() => {
            this.outside = ev => { if (!pop.contains(ev.target)) this.closePopover(); };
            document.addEventListener('pointerdown', this.outside);
        });
        pop.querySelector('.pop-action')?.focus();
    }

    closePopover() {
        if (this.popover) this.popover.remove();
        this.popover = null;
        if (this.outside) document.removeEventListener('pointerdown', this.outside);
        this.outside = null;
    }
}
