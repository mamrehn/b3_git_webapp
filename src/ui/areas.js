// The four areas of git, left to right, with the commands that move work between them:
// working directory → (git add) → staging area → (git commit) → repository → (git push) → remote

import { h, icon, clear, md } from './dom.js';
import { L } from '../core/i18n.js';
import { shortOid, fromPrefix } from '../core/util.js';
import { quoteArg } from '../learn/suggest.js';

const T = {
    wd: { de: 'Arbeitsverzeichnis', en: 'Working directory' },
    wdSub: { de: 'deine Dateien', en: 'your files' },
    stage: { de: 'Staging-Area', en: 'Staging area' },
    stageSub: { de: 'der nächste Commit', en: 'the next commit' },
    repo: { de: 'Repository', en: 'Repository' },
    repoSub: { de: 'gespeicherte Commits', en: 'saved commits' },
    remote: { de: 'Remote', en: 'Remote' },
    clean: { de: 'Keine Änderungen – alles wie im letzten Commit.', en: 'No changes – everything as in the last commit.' },
    stageEmpty: { de: 'Leer. `git add` legt Dateien hierher.', en: 'Empty. `git add` puts files here.' },
    noCommits: { de: 'Noch keine Commits.', en: 'No commits yet.' },
    unchanged: { de: '{n} unveränderte Dateien', en: '{n} unchanged files' },
    noRepo: { de: 'Du bist in keinem Git-Repository. Die Bereiche erscheinen, sobald du in ein Repository wechselst (`cd`) oder eins anlegst (`git init`).', en: 'You are not in a git repository. The areas appear once you change into one (`cd`) or create one (`git init`).' },
};

const KIND = {
    'new file': { de: 'neu', en: 'new' },
    modified: { de: 'geändert', en: 'changed' },
    deleted: { de: 'gelöscht', en: 'deleted' },
    renamed: { de: 'umbenannt', en: 'renamed' },
    untracked: { de: 'neu · unversioniert', en: 'new · untracked' },
    conflict: { de: 'Konflikt', en: 'conflict' },
};

export class AreasView {
    constructor(root, { onCommand, onOpenFile }) {
        this.root = root;
        this.onCommand = onCommand;
        this.onOpenFile = onOpenFile;
        this.state = null;
        this.flash = new Set();
    }

    update(state, highlight = null) {
        this.state = state;
        this.flash = new Set(highlight?.files || []);
        this.render();
    }

    // A command that moves work out of an area. "idle" when it would do nothing right now:
    // still shown (it teaches where things go), but muted and explained in the tooltip.
    move(text, dir, { idle = null, cursorBack = 0 } = {}) {
        const title = idle ? L(idle) : L({ de: 'In die Eingabe übernehmen', en: 'Put into the prompt' });
        return h('button', { class: `flow-cmd ${dir}${idle ? ' idle' : ''}`, type: 'button', title, onclick: () => this.onCommand(text, { cursorBack }) },
            dir === 'left' ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '←') : null,
            h('code', {}, text),
            dir === 'right' ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→') : null);
    }

    fileRow(path, kindKey, tone, repo) {
        const shown = fromPrefix(repo.prefix, path);
        return h('li', { class: `area-file ${tone}${this.flash.has(path) ? ' flash' : ''}` },
            h('button', { type: 'button', class: 'area-file-btn', onclick: () => this.onOpenFile(`${repo.dir}/${path}`), title: path },
                icon('file'), h('span', { class: 'fname' }, shown)),
            h('span', { class: 'fkind' }, L(KIND[kindKey] || { de: kindKey, en: kindKey })));
    }

    column(cls, title, sub, body, { badge = null, moves = [] } = {}) {
        const moveList = moves.filter(Boolean);
        return h('section', { class: `area ${cls}` },
            h('header', { class: 'area-head' },
                h('h3', {}, L(title)),
                badge,
                h('p', { class: 'area-sub' }, L(sub))),
            h('div', { class: 'area-body' }, body),
            moveList.length ? h('footer', { class: 'area-moves' }, moveList) : null);
    }

    render() {
        const root = clear(this.root);
        const repo = this.state?.repo;
        if (!repo || repo.broken) {
            root.appendChild(h('div', { class: 'stage-empty' }, md(L(T.noRepo), { onCode: c => this.onCommand(c) })));
            return;
        }
        const st = repo.status;
        // working directory
        const wdItems = [];
        for (const c of st.conflicts) wdItems.push(this.fileRow(c.path, 'conflict', 'conflict', repo));
        for (const u of st.unstaged) wdItems.push(this.fileRow(u.path, u.kind, 'wd', repo));
        for (const u of st.untrackedFiles) wdItems.push(this.fileRow(u, 'untracked', 'wd untracked', repo));
        const changedCount = new Set([...st.unstaged.map(u => u.path), ...st.staged.map(s => s.path)]).size;
        const unchanged = Math.max(0, repo.trackedFiles.length - changedCount);
        const wdBody = h('div', {},
            wdItems.length ? h('ul', { class: 'area-files' }, wdItems) : h('p', { class: 'area-note' }, L(T.clean)),
            unchanged ? h('p', { class: 'area-count' }, L(T.unchanged, { n: unchanged })) : null);

        // staging area
        const stItems = st.staged.map(s => {
            const row = this.fileRow(s.path, s.kind, 'staged', repo);
            if (s.from) row.querySelector('.fname').textContent = `${s.from} → ${s.path}`;
            return row;
        });
        const stageBody = stItems.length ? h('ul', { class: 'area-files' }, stItems) : h('p', { class: 'area-note' }, md(L(T.stageEmpty)));

        // repository: branch + recent commits on it
        const head = repo.head;
        const commitsOnHead = [];
        let cur = head.oid;
        while (cur && commitsOnHead.length < 6) {
            const c = repo.commits.get(cur);
            if (!c) break;
            commitsOnHead.push(c);
            cur = c.parents[0];
        }
        const branchLabel = head.detached ? `HEAD · ${shortOid(head.oid)}` : head.branch;
        const repoBody = h('div', {},
            h('div', { class: `branch-chip${head.detached ? ' detached' : ''}` }, icon('branch'), h('span', {}, branchLabel)),
            commitsOnHead.length
                ? h('ol', { class: 'mini-log' }, commitsOnHead.map((c, i) => h('li', { class: i === 0 ? 'tip' : '' },
                    h('button', { type: 'button', onclick: () => this.onCommand(`git show ${shortOid(c.oid)}`), title: c.message },
                        h('code', {}, shortOid(c.oid)), h('span', {}, c.subject)))))
                : h('p', { class: 'area-note' }, L(T.noCommits)),
            repo.branches.length > 1 ? h('p', { class: 'area-count' }, L({ de: `+ ${repo.branches.length - 1} weitere Branches`, en: `+ ${repo.branches.length - 1} more branches` })) : null);

        const arg = path => quoteArg(fromPrefix(repo.prefix, path));
        const addAll = repo.prefix ? 'git add -A' : 'git add .';
        const changed = [...st.unstaged.map(u => u.path), ...st.untrackedFiles];
        const addCmd = changed.length === 1 ? `git add ${arg(changed[0])}` : addAll;
        const up = head.branch ? repo.upstreams[head.branch] : null;

        const cols = [];
        cols.push(this.column('wd', T.wd, T.wdSub, wdBody, {
            moves: [this.move(addCmd, 'right', { idle: changed.length ? null : { de: 'Nichts zu tun: keine Änderungen im Arbeitsverzeichnis.', en: 'Nothing to do: no changes in the working directory.' } })],
        }));
        cols.push(this.gutter());
        cols.push(this.column('stage', T.stage, T.stageSub, stageBody, {
            moves: [
                st.staged.length ? this.move(`git restore --staged ${arg(st.staged[0].path)}`, 'left') : null,
                this.move('git commit -m ""', 'right', { cursorBack: 1, idle: st.staged.length ? null : { de: 'Nichts zu tun: Die Staging-Area ist leer. Erst mit git add etwas vormerken.', en: 'Nothing to do: the staging area is empty. Stage something with git add first.' } }),
            ],
        }));
        cols.push(this.gutter());
        const repoMoves = [];
        if (repo.remotes.length) {
            const pushIdle = !head.branch ? { de: 'Kein Branch ausgecheckt.', en: 'No branch checked out.' }
                : up && !up.gone && !up.ahead ? { de: 'Nichts zu tun: Der Server hat schon alle deine Commits.', en: 'Nothing to do: the server already has all your commits.' } : null;
            const pushCmd = head.branch && (!up || up.gone) ? `git push -u ${repo.remotes[0].name} ${head.branch}` : 'git push';
            repoMoves.push(this.move(pushCmd, 'right', { idle: pushIdle }));
        }
        cols.push(this.column('repo', T.repo, T.repoSub, repoBody, { moves: repoMoves }));

        if (repo.remotes.length) {
            const r = repo.remotes[0];
            const server = repo.servers[r.name];
            const tracked = repo.remoteBranches.filter(b => b.remote === r.name);
            const rows = tracked.map(b => {
                const live = server?.branches?.[b.branch];
                const stale = live && live !== b.oid;
                return h('li', { class: `remote-branch${stale ? ' stale' : ''}` },
                    h('code', { class: 'rb-name' }, b.name), h('code', { class: 'rb-oid' }, shortOid(b.oid)),
                    stale ? h('span', { class: 'rb-live', title: L({ de: 'So steht der Branch gerade wirklich auf dem simulierten Server. Dein origin/… zeigt den Stand vom letzten fetch/pull/push.', en: 'This is where the branch really is on the simulated server right now. Your origin/… shows the state of your last fetch/pull/push.' }) },
                        L({ de: 'Server jetzt:', en: 'server now:' }), ' ', h('code', {}, shortOid(live))) : null);
            });
            if (server) {
                for (const [name, oid] of Object.entries(server.branches)) {
                    if (tracked.some(b => b.branch === name)) continue;
                    rows.push(h('li', { class: 'remote-branch stale' }, h('code', { class: 'rb-name' }, `${r.name}/${name}`), h('span', { class: 'rb-live' }, L({ de: 'nur auf dem Server:', en: 'only on server:' }), ' ', h('code', {}, shortOid(oid)))));
                }
            }
            const sim = r.kind === 'simulated';
            const kindBadge = h('span', { class: `net ${sim ? 'sim' : 'real'}`, title: r.url }, sim ? L({ de: 'simuliert', en: 'simulated' }) : L({ de: 'echt', en: 'real' }));
            const syncNote = up && !up.gone ? h('p', { class: 'area-count' }, (!up.ahead && !up.behind) ? L({ de: `${head.branch} ist synchron`, en: `${head.branch} is in sync` }) : L({ de: `${head.branch}: ${up.ahead} voraus · ${up.behind} zurück`, en: `${head.branch}: ${up.ahead} ahead · ${up.behind} behind` })) : null;
            const remoteBody = h('div', {},
                h('p', { class: 'remote-url mono', title: r.url }, `${r.name} · ${r.host || r.url}`),
                rows.length ? h('ul', { class: 'remote-branches' }, rows) : h('p', { class: 'area-note' }, L({ de: 'Noch nichts geholt oder gepusht.', en: 'Nothing fetched or pushed yet.' })),
                syncNote);
            cols.push(this.gutter());
            cols.push(this.column(`remote ${sim ? 'is-sim' : 'is-real'}`, T.remote, { de: sim ? 'simulierter Server' : 'Server im Internet', en: sim ? 'simulated server' : 'server on the internet' }, remoteBody, {
                badge: kindBadge,
                moves: [this.move('git pull', 'left'), this.move('git fetch', 'left')],
            }));
        }
        if (repo.stash.length) {
            cols[0].querySelector('.area-body').appendChild(h('div', { class: 'stash-shelf' }, icon('stash'), h('span', {}, L({ de: `Stash: ${repo.stash.length} beiseitegelegt`, en: `Stash: ${repo.stash.length} shelved` }))));
        }
        root.appendChild(h('div', { class: `areas cols-${repo.remotes.length ? 4 : 3}` }, cols));
    }

    gutter() {
        return h('div', { class: 'area-gutter', 'aria-hidden': 'true' }, '→');
    }
}
