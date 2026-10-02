// The application: layout, the command pipeline and the two worlds.

import { h, icon, logo, clear, md } from './ui/dom.js';
import { modal } from './ui/modal.js';
import { screenReaderToggle } from './ui/a11y.js';
import { TerminalView } from './ui/terminal.js';
import { Explorer } from './ui/explorer.js';
import { AreasView } from './ui/areas.js';
import { GraphView } from './ui/graph.js';
import { EditorPane } from './ui/editor.js';
import { Coach } from './ui/coach.js';
import { World, HOME } from './vfs/world.js';
import { UndoStack } from './vfs/undo.js';
import { statOrNull, mkdirp } from './vfs/fsutil.js';
import { Shell } from './shell/exec.js';
import { buildRegistry } from './shell/commands/index.js';
import { complete } from './shell/complete.js';
import { registerGit } from './git/gitcmd.js';
import { captureState } from './learn/state.js';
import { coachFor } from './learn/coach.js';
import { situation as situationOf } from './learn/situation.js';
import { suggest } from './learn/suggest.js';
import { explainInput } from './learn/explain.js';
import { L, lang, setLang, onLangChange } from './core/i18n.js';
import { debounce, joinPath, normalizePath } from './core/util.js';
import { CONFIG } from './config.js';
import { SIM_ROOT, TEAM_ROOT } from './git/simserver.js';
import { on } from './core/events.js';

const THEME_KEY = 'gw.theme';
const SR_KEY = 'gw.screenreader';
const WORLD_KEY = 'gw.world';
const WELCOME_KEY = 'gw.welcomed';

export class App {
    constructor(root) {
        this.root = root;
        this.worlds = {
            sandbox: new World({ id: 'sandbox', dbName: 'gitlearning', kind: 'sandbox' }),
            mission: new World({ id: 'mission', dbName: 'gw-mission', kind: 'mission' }),
        };
        this.world = null;
        this.state = null;
        this.undo = null;
        this.missions = null;
        this.busy = false;
    }

    // ---- layout -----------------------------------------------------------------------------

    buildLayout() {
        const root = clear(this.root);
        this.worldBtns = {
            sandbox: h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.switchWorld('sandbox') }, icon('flask'), h('span', { class: 'w-name' }), h('span', { class: 'net real' })),
            mission: h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.switchWorld('mission') }, icon('flag'), h('span', { class: 'w-name' }), h('span', { class: 'net sim' })),
        };
        this.crumb = h('div', { class: 'mission-crumb' });
        this.undoBtn = h('button', { class: 'btn quiet', type: 'button', onclick: () => this.doUndo(), disabled: true }, icon('undo'), h('span', { class: 'undo-label' }));
        this.resetBtn = h('button', { class: 'btn quiet icon-btn reset-btn', type: 'button', onclick: () => this.confirmReset() }, icon('reset'));
        // phones: language, theme and reset move into a settings dialog
        this.moreBtn = h('button', { class: 'btn quiet icon-btn more-btn', type: 'button', onclick: () => this.showSettings() }, icon('menu'));
        this.langBtns = {
            de: h('button', { type: 'button', onclick: () => setLang('de') }, 'DE'),
            en: h('button', { type: 'button', onclick: () => setLang('en') }, 'EN'),
        };
        this.themeBtn = h('button', { class: 'btn quiet icon-btn theme-btn', type: 'button', onclick: () => this.toggleTheme() });
        this.helpBtn = h('button', { class: 'btn quiet icon-btn', type: 'button', onclick: () => this.showHelp() }, icon('help'));
        this.filesToggle = h('button', { class: 'btn quiet icon-btn files-toggle', type: 'button', onclick: () => this.root.querySelector('.app').classList.toggle('files-open') }, icon('sidebar'));
        const topbar = h('header', { class: 'topbar' },
            this.filesToggle,
            h('h1', { class: 'wordmark' }, logo(), h('span', {}, 'Git-Werkstatt')),
            h('nav', { class: 'worlds', 'aria-label': 'world' }, this.worldBtns.sandbox, this.worldBtns.mission),
            this.crumb,
            h('div', { class: 'spacer' }),
            h('div', { class: 'topbar-actions' }, this.undoBtn, this.resetBtn, h('div', { class: 'lang-switch', role: 'group' }, this.langBtns.de, this.langBtns.en), this.themeBtn, this.moreBtn, this.helpBtn));

        this.filesPane = h('aside', { class: 'pane pane-files' });
        this.stageTabs = h('div', { class: 'stage-tabs', role: 'tablist' });
        this.stageBody = h('div', { class: 'stage-body' });
        this.areasEl = h('div', { class: 'view view-areas' });
        this.graphEl = h('div', { class: 'view view-graph', hidden: true });
        this.editorEl = h('div', { class: 'view view-editor', hidden: true });
        this.stageBody.append(this.areasEl, this.graphEl, this.editorEl);
        const stage = h('section', { class: 'stage' }, h('div', { class: 'stage-head' }, h('h2', { class: 'label' }, h('span', { class: 'num' }, '02'), h('span', { class: 'lbl-stage' })), this.stageTabs), this.stageBody);
        this.splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0' });
        this.termTitle = h('div', { class: 'term-title mono' });
        this.termMaxBtn = h('button', { class: 'btn quiet icon-btn on-dark', type: 'button', onclick: () => this.toggleTermMax() }, icon('expand'));
        this.termHost = h('div', { class: 'term-host' });
        // not a live region: it changes with every keystroke, which a screen reader would read out
        this.explainBar = h('div', { class: 'explain' });
        // with screen-reader support on, the coach's one-line summary is announced after each command
        this.announcer = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
        // touch screens have no Tab, arrow or Ctrl keys: a row of them under the terminal.
        // pointerdown is cancelled so the terminal keeps the focus (and the keyboard stays open).
        const key = (label, seq, title) => h('button', { type: 'button', title, 'aria-label': title, onpointerdown: ev => ev.preventDefault(), onclick: () => this.terminal.sendKeys(seq) }, label);
        this.keyBar = h('div', { class: 'keybar', role: 'toolbar' },
            key('Tab', '\t', 'Tab'), key('↑', '\x1b[A', 'Up'), key('↓', '\x1b[B', 'Down'), key('←', '\x1b[D', 'Left'), key('→', '\x1b[C', 'Right'),
            key('^C', '\x03', 'Ctrl+C'), key('~', '~', '~'), key('/', '/', '/'), key('-', '-', '-'), key('|', '|', '|'));
        const termPane = h('section', { class: 'term-pane' },
            h('div', { class: 'term-head' }, h('h2', { class: 'label on-dark' }, h('span', { class: 'num' }, '03'), h('span', { class: 'lbl-term' })), this.termTitle, this.termMaxBtn),
            this.termHost, this.keyBar, this.explainBar, this.announcer);
        this.center = h('section', { class: 'pane-center' }, stage, this.splitter, termPane);
        this.coachPane = h('aside', { class: 'pane pane-coach' });
        this.mobileTabs = h('nav', { class: 'mobile-tabs' },
            h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => this.mobileTab('work') }),
            h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => this.mobileTab('coach') }, 'Coach'));
        const app = h('div', { class: 'app', 'data-mobile-tab': 'work' }, topbar, h('main', { class: 'workspace' }, this.filesPane, this.center, this.coachPane, this.mobileTabs));
        root.appendChild(app);
        this.app = app;
        this.initSplitter();
    }

    relabel() {
        document.documentElement.lang = lang();
        this.worldBtns.sandbox.querySelector('.w-name').textContent = 'Sandbox';
        this.worldBtns.sandbox.querySelector('.net').textContent = L({ de: 'echtes Netz', en: 'real network' });
        this.worldBtns.sandbox.title = L({ de: 'Freies Experimentieren – Remotes sind echte Server (z. B. GitHub)', en: 'Free play – remotes are real servers (e.g. GitHub)' });
        this.worldBtns.mission.querySelector('.w-name').textContent = L({ de: 'Missionen', en: 'Missions' });
        this.worldBtns.mission.querySelector('.net').textContent = L({ de: 'simuliert', en: 'simulated' });
        this.worldBtns.mission.title = L({ de: 'Geführte Aufgaben – mit simuliertem Server und Team', en: 'Guided tasks – with a simulated server and team' });
        this.resetBtn.title = this.world?.id === 'mission' ? L({ de: 'Mission neu starten', en: 'Restart mission' }) : L({ de: 'Sandbox zurücksetzen', en: 'Reset sandbox' });
        this.helpBtn.title = L({ de: 'Hilfe & Begriffe', en: 'Help & terms' });
        this.filesToggle.title = L({ de: 'Dateien ein-/ausblenden', en: 'Show/hide files' });
        this.termMaxBtn.title = L({ de: 'Terminal vergrößern', en: 'Maximise terminal' });
        this.moreBtn.title = L({ de: 'Einstellungen', en: 'Settings' });
        this.mobileTabs.firstChild.textContent = L({ de: 'Arbeiten', en: 'Work' });
        this.keyBar.setAttribute('aria-label', L({ de: 'Sondertasten', en: 'Special keys' }));
        // icon-only buttons: the title doubles as the accessible name
        for (const b of [this.resetBtn, this.helpBtn, this.filesToggle, this.termMaxBtn, this.moreBtn]) b.setAttribute('aria-label', b.title);
        this.langBtns.de.setAttribute('aria-pressed', String(lang() === 'de'));
        this.langBtns.en.setAttribute('aria-pressed', String(lang() === 'en'));
        this.root.querySelector('.lbl-stage').textContent = L({ de: 'Repository', en: 'Repository' });
        this.root.querySelector('.lbl-term').textContent = 'Terminal';
        this.renderTabs();
        this.renderUndo();
        this.renderThemeBtn();
        this.explorer?.relabel();
        this.coach?.relabel();
        this.missions?.relabel?.();
    }

    initSplitter() {
        const split = this.splitter;
        let startY = 0;
        let startH = 0;
        const move = ev => {
            const total = this.center.getBoundingClientRect().height;
            const hNew = Math.min(total - 170, Math.max(120, startH + ev.clientY - startY));
            this.center.style.setProperty('--stage-h', `${hNew}px`);
            this.terminal?.fitSoon();
        };
        const up = () => {
            split.classList.remove('dragging');
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };
        split.addEventListener('pointerdown', ev => {
            startY = ev.clientY;
            startH = this.center.querySelector('.stage').getBoundingClientRect().height;
            split.classList.add('dragging');
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
        split.addEventListener('keydown', ev => {
            const cur = this.center.querySelector('.stage').getBoundingClientRect().height;
            if (ev.key === 'ArrowUp') this.center.style.setProperty('--stage-h', `${Math.max(120, cur - 30)}px`);
            if (ev.key === 'ArrowDown') this.center.style.setProperty('--stage-h', `${cur + 30}px`);
            this.terminal?.fitSoon();
        });
    }

    mobileTab(tab) {
        this.app.dataset.mobileTab = tab;
        this.mobileTabs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (tab === 'work'))));
        if (tab === 'work') this.terminal?.fitSoon();
    }

    toggleTermMax() {
        this.center.classList.toggle('term-max');
        this.terminal?.fitSoon();
    }

    // ---- theme ----------------------------------------------------------------------------------

    theme() {
        return document.documentElement.dataset.theme || 'light';
    }

    toggleTheme() {
        const next = this.theme() === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
        this.terminal?.setTheme(next);
        this.renderThemeBtn();
    }

    renderThemeBtn() {
        clear(this.themeBtn).appendChild(icon(this.theme() === 'dark' ? 'sun' : 'moon'));
        this.themeBtn.title = this.theme() === 'dark' ? L({ de: 'Helles Design', en: 'Light theme' }) : L({ de: 'Dunkles Design', en: 'Dark theme' });
        this.themeBtn.setAttribute('aria-label', this.themeBtn.title);
    }

    // ---- stage tabs ---------------------------------------------------------------------------------

    renderTabs() {
        const tabs = [
            ['areas', { de: 'Bereiche', en: 'Areas' }],
            ['graph', { de: 'Verlauf', en: 'History' }],
        ];
        if (this.editor?.isOpen) {
            const s = this.editor.session;
            const name = s.display.split('/').pop();
            // git's message files (COMMIT_EDITMSG …) get a name that says what they are for
            tabs.push(['editor', s.kind === 'file' ? { de: name, en: name } : { de: 'Nachricht', en: 'Message' }]);
        }
        clear(this.stageTabs);
        for (const [id, label] of tabs) {
            const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.view === id), onclick: () => this.showView(id) }, L(label));
            if (id === 'editor' && this.editor.dirty) b.appendChild(h('span', { class: 'tab-dot', title: L({ de: 'nicht gespeichert', en: 'unsaved' }) }));
            this.stageTabs.appendChild(b);
        }
    }

    showView(id) {
        this.view = id;
        this.areasEl.hidden = id !== 'areas';
        this.graphEl.hidden = id !== 'graph';
        this.editorEl.hidden = id !== 'editor';
        try { localStorage.setItem('gw.view', id === 'editor' ? (this.lastView || 'areas') : id); } catch { /* ignore */ }
        if (id !== 'editor') this.lastView = id;
        if (id === 'editor') this.editor.focus();
        this.renderTabs();
        // looking at the history counts for mission goals like "see how the branches diverged"
        if (id === 'graph' && this.world?.id === 'mission' && !this.busy) this.missions?.observe('graph');
    }

    // ---- start ---------------------------------------------------------------------------------------

    async start() {
        registerGit();
        this.registry = buildRegistry();
        this.buildLayout();
        const ui = {
            write: s => this.terminal.write(s),
            columns: () => this.terminal.columns(),
            clear: () => this.terminal.clear(),
            page: (text, opts) => this.terminal.page(text, opts),
            prompt: opts => this.terminal.prompt(opts),
            readInteractive: opts => this.terminal.readInteractive(opts),
            annotate: note => this.terminal.annotate(note),
            edit: (path, opts) => this.openEditor(path, opts),
            setCoachLevel: level => this.coach.cycleLevel({ on: 'auto', full: 'full', short: 'short', off: 'short' }[level]),
        };
        this.shell = new Shell({ registry: this.registry, ui });
        this.terminal = new TerminalView(this.termHost, {
            theme: this.theme(),
            getPrompt: () => this.promptText(),
            getHistory: () => this.world?.history || [],
            onLine: line => this.execute(line),
            onInput: debounce((text) => this.renderExplain(text), 80),
            complete: (line, cursor) => complete(this.shell, line, cursor),
            onInterrupt: () => this.shell.abort?.abort(),
        });
        if (this.screenReader()) this.terminal.setScreenReader(true);
        this.explorer = new Explorer(this.filesPane, {
            onOpenFile: path => this.openEditor(path, { blocking: false }),
            onCd: path => this.runVisible(`cd ${this.world.displayPath(path).replace(/ /g, '\\ ')}`),
        });
        this.areas = new AreasView(this.areasEl, { onCommand: (cmd, opts) => this.insert(cmd, opts), onOpenFile: path => this.openEditor(path, { blocking: false }) });
        this.graph = new GraphView(this.graphEl, { onCommand: cmd => this.insert(cmd) });
        this.editor = new EditorPane(this.editorEl, {
            read: path => this.world.pfs.readFile(path, 'utf8'),
            write: async (path, text) => {
                if (!this.world.canWrite(path)) throw new Error(L({ de: 'Keine Schreibrechte für diesen Ort', en: 'Permission denied' }));
                await this.world.pfs.writeFile(path, text, 'utf8');
            },
            onSaved: path => this.afterExternalChange(path),
            onClose: () => this.showView(this.lastView || 'areas'),
            onStateChange: () => this.renderTabs(),
        });
        this.coach = new Coach(this.coachPane, { onCommand: (cmd, opts) => this.insert(cmd, opts) });
        this.view = (() => { try { return localStorage.getItem('gw.view') || 'areas'; } catch { return 'areas'; } })();
        if (this.view === 'editor') this.view = 'areas';
        this.showView(this.view);
        onLangChange(() => { this.relabel(); this.renderAll(); });
        on('sim:server', () => this.refreshSoon());
        this.relabel();

        const { Missions } = await import('./missions/engine.js');
        this.missions = new Missions(this);
        let first = true;
        let worldId = 'sandbox';
        try {
            first = !localStorage.getItem(WELCOME_KEY);
            worldId = localStorage.getItem(WORLD_KEY) === 'mission' ? 'mission' : 'sandbox';
        } catch { /* storage unavailable: behave like a first visit */ }
        if (first) {
            // the welcome comes first; the sandbox fetches its project only once it is chosen
            await this.enterWorld('sandbox', { quiet: true });
            this.missions.showWelcome();
            return;
        }
        await this.enterWorld(worldId);
        this.terminal.focus();
    }

    promptText() {
        const host = this.world?.id === 'mission' ? 'mission' : 'werkstatt';
        const dir = this.world ? this.world.displayPath() : '~';
        const head = this.state?.repo?.head;
        let branch = '';
        if (head && !this.state.repo.broken) {
            const op = this.state.repo.op;
            const label = head.detached ? `(${head.oid.slice(0, 7)}...)` : head.branch;
            const opLabel = op ? `|${op.kind === 'cherry-pick' ? 'CHERRY-PICKING' : op.kind === 'revert' ? 'REVERTING' : op.kind.toUpperCase()}` : '';
            branch = ` \x1b[33m(${label}${opLabel})\x1b[0m`;
        }
        return `\x1b[1;32mstudent@${host}\x1b[0m:\x1b[1;34m${dir}\x1b[0m${branch}$ `;
    }

    // ---- worlds ---------------------------------------------------------------------------------------

    async enterWorld(id, { quiet = false } = {}) {
        this.terminal.mode = 'busy'; // keys typed meanwhile are replayed at the next prompt
        const world = this.worlds[id];
        if (!world.pfs) await world.open();
        this.world = world;
        this.shell.setWorld(world);
        try { localStorage.setItem(WORLD_KEY, id); } catch { /* ignore */ }
        for (const [k, b] of Object.entries(this.worldBtns)) b.setAttribute('aria-pressed', String(k === id));
        this.app.dataset.world = id;
        if (!(await statOrNull(world.pfs, world.cwd))) world.cwd = HOME;
        this.terminal.clear();
        if (id === 'sandbox') await this.bootstrapSandbox({ quiet });
        else await this.missions.enter({ quiet });
        this.undo = new UndoStack(world, { exclude: [SIM_ROOT, TEAM_ROOT] });
        await this.undo.init();
        await this.refresh({ entry: null });
        this.relabel();
        this.terminal.showPrompt();
    }

    async switchWorld(id) {
        if (this.busy || this.world?.id === id) {
            if (id === 'mission' && this.world?.id === 'mission') this.missions.showMap();
            return;
        }
        if (this.editor.isOpen) {
            await this.editor.close();
            if (this.editor.isOpen) return; // unsaved changes: the student chose to keep editing
        }
        this.world.saveSession();
        await this.enterWorld(id);
    }

    async bootstrapSandbox({ quiet }) {
        const w = this.worlds.sandbox;
        const cfg = joinPath(HOME, '.gitconfig');
        if (!(await statOrNull(w.pfs, cfg))) {
            await w.pfs.writeFile(cfg, '[user]\n\tname = Student\n\temail = student@example.com\n[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n', 'utf8');
        }
        if (quiet) return;
        const banner = L({ de: 'Sandbox – hier kannst du alles ausprobieren. Remotes sind hier echte Server im Internet.', en: 'Sandbox – try anything here. Remotes here are real servers on the internet.' });
        this.terminal.annotate({ type: 'system', text: banner });
        if (!(await statOrNull(w.pfs, joinPath(HOME, 'project2')))) await mkdirp(w.pfs, joinPath(HOME, 'project2'));
        if (await statOrNull(w.pfs, joinPath(HOME, 'project1', '.git'))) return;
        // first visit: a real clone, visible in the terminal
        const saved = w.cwd;
        w.cwd = HOME;
        this.terminal.annotate({ type: 'system', text: L({ de: 'Erster Start: Ich klone das Übungsprojekt von GitHub …', en: 'First start: cloning the practice project from GitHub …' }) });
        const line = `git clone ${CONFIG.sandboxRepo} project1`;
        this.terminal.write(this.promptText() + line + '\n');
        const result = await this.shell.runLine(line);
        if (result.status !== 0) {
            await this.createFallbackProject(w);
            this.terminal.annotate({ type: 'system', text: L({ de: 'GitHub war nicht erreichbar. Ich habe ~/project1 stattdessen lokal angelegt (offline, ohne Remote).', en: 'GitHub was not reachable. I created ~/project1 locally instead (offline, without a remote).' }) });
        }
        w.cwd = saved;
    }

    async createFallbackProject(w) {
        const dir = joinPath(HOME, 'project1');
        const run = line => this.shell.capture(line);
        await mkdirp(w.pfs, dir);
        const savedCwd = w.cwd;
        w.cwd = dir;
        await run('git init -q');
        await w.pfs.writeFile(joinPath(dir, 'index.html'), '<!DOCTYPE html>\n<html lang="de">\n<head>\n    <meta charset="UTF-8">\n    <title>Mein Projekt</title>\n    <link rel="stylesheet" href="style.css">\n</head>\n<body>\n    <h1>Hallo Welt!</h1>\n    <p>Das ist mein erstes Projekt.</p>\n</body>\n</html>\n', 'utf8');
        await run('git add index.html && git commit -q -m "Startseite anlegen"');
        await w.pfs.writeFile(joinPath(dir, 'style.css'), 'body {\n    font-family: sans-serif;\n    background: #f4f1ea;\n}\n\nh1 {\n    color: #2448a8;\n}\n', 'utf8');
        await run('git add style.css && git commit -q -m "Grundlegendes Styling"');
        await w.pfs.writeFile(joinPath(dir, '.gitignore'), '*.log\n*.tmp\nnode_modules/\n', 'utf8');
        await run('git add .gitignore && git commit -q -m ".gitignore hinzufügen"');
        w.cwd = savedCwd;
    }

    // ---- the command pipeline --------------------------------------------------------------------

    async execute(line, { record = true } = {}) {
        const w = this.world;
        if (record && line.trim() && w.history[w.history.length - 1] !== line) w.history.push(line);
        if (!line.trim()) return;
        this.busy = true;
        const prev = this.state;
        let result;
        try {
            result = await this.shell.runLine(line);
        } finally {
            this.busy = false;
        }
        // the folder we were in may have been deleted (rm -r, git clean, undo …)
        if (!(await statOrNull(w.pfs, w.cwd))) {
            let p = w.cwd;
            while (p !== '/' && !(await statOrNull(w.pfs, p))) p = normalizePath(p + '/..');
            w.cwd = p.startsWith(HOME) ? p : HOME;
            this.terminal.annotate({ type: 'system', text: L({ de: `Der Ordner, in dem du warst, existiert nicht mehr – du bist jetzt in ${w.displayPath()}.`, en: `The folder you were in no longer exists – you are now in ${w.displayPath()}.` }) });
        }
        w.saveSession();
        const next = await captureState(w);
        await this.undo?.afterCommand(line);
        const coach = coachFor({ prev, next, result, line });
        this.state = next;
        const mission = this.missions ? await this.missions.afterStep({ line, result, prev, next, coach }) : null;
        if (mission?.worldChanged) {
            // a teammate reacted (pushed …): show the world as it is now
            this.state = await captureState(w);
            coach.situation = situationOf(this.state);
            coach.suggestions = suggest(this.state, { run: result });
        }
        this.render({ coach, highlight: coach.entry?.highlight });
        if (this.editor.isOpen && this.editor.session.kind === 'file' && !this.editor.dirty) {
            // the file may have changed on disk (git restore, checkout …): reload it
            this.reloadEditorFromDisk();
        }
    }

    // Commands triggered by the UI are shown in the terminal as if typed
    async runVisible(line) {
        if (this.busy || this.terminal.mode !== 'idle') return;
        this.terminal.mode = 'busy';
        this.terminal.write('\r\x1b[K' + this.promptText() + line + '\n');
        await this.execute(line);
        this.terminal.showPrompt();
    }

    insert(cmd, { cursorBack = 0 } = {}) {
        if (this.terminal.mode !== 'idle') return;
        this.terminal.setInput(cmd, cmd.length - cursorBack);
        if (window.matchMedia('(max-width: 860px)').matches) this.mobileTab('work');
    }

    async refresh({ entry = null } = {}) {
        this.state = await captureState(this.world);
        const sit = situationOf(this.state);
        const sug = suggest(this.state);
        if (entry) this.coach.push(entry, { situation: sit, suggestions: sug });
        else this.coach.setState({ situation: sit, suggestions: sug });
        this.renderViews();
    }

    refreshSoon = debounce(() => { if (!this.busy) this.refresh(); }, 120);

    render({ coach, highlight }) {
        this.coach.push(coach.entry, { situation: coach.situation, suggestions: coach.suggestions });
        this.renderViews(highlight);
        if (this.screenReader() && coach.entry?.title) {
            // plain words: markdown marks would be read out literally
            this.announcer.textContent = L(coach.entry.title).replace(/[`*]/g, '');
        }
    }

    // ---- screen readers ---------------------------------------------------------------------------

    screenReader() {
        try { return localStorage.getItem(SR_KEY) === '1'; } catch { return false; }
    }

    setScreenReader(on) {
        try { localStorage.setItem(SR_KEY, on ? '1' : '0'); } catch { /* ignore */ }
        this.terminal.setScreenReader(on);
    }

    renderViews(highlight = null) {
        this.explorer.update(this.world, this.state);
        this.areas.update(this.state, highlight);
        this.graph.update(this.state, highlight);
        this.renderTermTitle();
        this.renderUndo();
        this.missions?.renderCrumb?.();
    }

    renderAll() {
        this.renderViews();
        this.coach.render();
    }

    renderTermTitle() {
        const repo = this.state?.repo;
        const parts = [h('span', {}, this.world.displayPath())];
        if (repo && !repo.broken) {
            parts.push(h('span', { class: 'tt-branch' }, icon('branch'), repo.head.detached ? `HEAD ${repo.head.oid?.slice(0, 7)}` : repo.head.branch));
            for (const r of repo.remotes.slice(0, 2)) {
                parts.push(h('span', { class: `net ${r.kind === 'simulated' ? 'sim' : 'real'}`, title: r.url }, `${r.name}: ${r.kind === 'simulated' ? L({ de: 'simuliert', en: 'simulated' }) : L({ de: 'echt', en: 'real' })}`));
            }
        }
        clear(this.termTitle).append(...parts);
    }

    renderExplain(text) {
        const bar = clear(this.explainBar);
        if (!text || !text.trim()) {
            bar.classList.remove('has-warning', 'has-content');
            bar.appendChild(h('span', { class: 'explain-idle' }, L({ de: 'Tab vervollständigt · ↑ voriger Befehl · Strg+R sucht · Strg+C bricht ab', en: 'Tab completes · ↑ previous command · Ctrl+R searches · Ctrl+C cancels' })));
            return;
        }
        const ex = explainInput(text, this.registry, this.state);
        bar.classList.add('has-content');
        bar.classList.toggle('has-warning', Boolean(ex.warning));
        bar.classList.toggle('is-danger', ex.warning?.level === 'danger');
        const parts = h('div', { class: 'explain-parts' });
        for (const p of ex.parts) {
            parts.appendChild(h('span', { class: `xp${p.option ? ' opt' : ''}${p.unknown ? ' unknown' : ''}` }, h('code', {}, p.text), h('span', {}, L(p.desc))));
        }
        bar.appendChild(parts);
        if (ex.pending) bar.appendChild(h('div', { class: 'explain-pending' }, md(L(ex.pending))));
        if (ex.warning) bar.appendChild(h('div', { class: `explain-warning ${ex.warning.level}` }, icon('warn'), h('span', {}, md(L(ex.warning.text)))));
    }

    // ---- editor -------------------------------------------------------------------------------------

    async openEditor(path, { blocking = false, kind = 'file', command } = {}) {
        const display = this.world.displayPath(path);
        if (kind === 'file' && !blocking && (await statOrNull(this.world.pfs, path))?.isDirectory()) return { saved: false };
        const promise = this.editor.open(path, { kind, blocking, display });
        this.showView('editor');
        if (blocking && kind === 'file') {
            this.terminal.annotate({ type: 'system', text: L({ de: `${command || 'nano'}: ${display} ist im Editor geöffnet – speichern mit Strg+S, schließen mit Esc.`, en: `${command || 'nano'}: ${display} is open in the editor – save with Ctrl+S, close with Esc.` }) });
        }
        const res = await promise;
        if (blocking) this.terminal.focus();
        return res;
    }

    async reloadEditorFromDisk() {
        const sess = this.editor.session;
        if (!sess) return;
        let text = null;
        try { text = await this.world.pfs.readFile(sess.path, 'utf8'); } catch { /* deleted */ }
        if (text === null || text === sess.saved || !this.editor.view) return;
        this.editor.view.dispatch({ changes: { from: 0, to: this.editor.view.state.doc.length, insert: text } });
        sess.saved = text;
        this.editor.refreshDirty();
    }

    async afterExternalChange(path) {
        // saved from a running `nano`: the command pipeline explains it when nano exits
        if (this.busy) return;
        const prev = this.state;
        const next = await captureState(this.world);
        await this.undo?.afterCommand(`nano ${this.world.displayPath(path)}`);
        const result = { commands: [{ name: 'nano', args: [path], status: 0, info: {} }], status: 0, stderr: '', stdout: '' };
        const coach = coachFor({ prev, next, result, line: null });
        if (coach.entry) {
            coach.entry.title = { de: `${this.world.displayPath(path).split('/').pop()} gespeichert`, en: `${this.world.displayPath(path).split('/').pop()} saved` };
        }
        this.state = next;
        if (this.missions) await this.missions.afterStep({ line: `# save ${path}`, result, prev, next, coach });
        this.render({ coach, highlight: coach.entry?.highlight });
    }

    // ---- undo / reset ---------------------------------------------------------------------------------

    renderUndo() {
        const step = this.undo?.peek();
        const label = this.undoBtn.querySelector('.undo-label');
        label.textContent = L({ de: 'Rückgängig', en: 'Undo' });
        this.undoBtn.disabled = !step || this.busy;
        this.undoBtn.title = step
            ? L({ de: `Zustand vor „${step.label}“ wiederherstellen (nur in der Werkstatt)`, en: `Restore the state before "${step.label}" (Werkstatt only)` })
            : this.undo?.disabled ? L({ de: 'Rückgängig ist für sehr große Repositories abgeschaltet.', en: 'Undo is switched off for very large repositories.' }) : L({ de: 'Noch nichts rückgängig zu machen', en: 'Nothing to undo yet' });
    }

    async doUndo() {
        if (!this.undo?.canUndo() || this.busy || this.terminal.mode !== 'idle') return;
        this.busy = true;
        const step = await this.undo.undo();
        this.busy = false;
        if (!(await statOrNull(this.world.pfs, this.world.cwd))) this.world.cwd = HOME;
        this.terminal.write('\r\x1b[K');
        this.terminal.annotate({ type: 'system', text: L({ de: `↶ Rückgängig: „${step.label}“`, en: `↶ Undone: "${step.label}"` }) });
        await this.refresh({
            entry: {
                line: null, tone: 'info', key: 'undo', time: Date.now(),
                title: { de: `Zurückgespult: vor „${step.label}“`, en: `Rewound to before "${step.label}"` },
                body: { de: 'Dateien **und** Git-Daten auf deinem Rechner sind wieder wie vor diesem Befehl. Was schon auf dem Server liegt, bleibt dort – ein Push lässt sich nicht zurückspulen, und die Arbeit des Teams auch nicht.\n\nAchtung: Diesen Knopf gibt es nur hier in der Werkstatt. Im echten Git helfen `git reflog`, `git restore` und `git revert` – oder vorher committen.', en: 'Files **and** git data on your computer are back to before that command. Whatever is already on the server stays there – a push cannot be rewound, and neither can your team\'s work.\n\nNote: this button only exists here in the Werkstatt. In real git, `git reflog`, `git restore` and `git revert` help – or commit before experimenting.' },
                notes: [],
            },
        });
        this.terminal.showPrompt();
    }

    confirmReset() {
        const mission = this.world.id === 'mission';
        this.dialog({
            title: mission ? L({ de: 'Mission neu starten?', en: 'Restart the mission?' }) : L({ de: 'Sandbox zurücksetzen?', en: 'Reset the sandbox?' }),
            body: mission
                ? L({ de: 'Alle Dateien dieser Mission werden auf den Anfang zurückgesetzt.', en: 'All files of this mission are reset to the beginning.' })
                : L({ de: 'Alle Dateien und Repositories in der Sandbox werden gelöscht. project1 wird danach neu von GitHub geklont.', en: 'All files and repositories in the sandbox are deleted. project1 is then cloned again from GitHub.' }),
            confirm: mission ? L({ de: 'Neu starten', en: 'Restart' }) : L({ de: 'Alles löschen', en: 'Delete everything' }),
            danger: !mission,
            onConfirm: async () => {
                if (mission) return this.missions.restart();
                await this.worlds.sandbox.wipe();
                await this.enterWorld('sandbox');
            },
        });
    }

    dialog({ title, body, confirm, cancel, danger = false, onConfirm }) {
        const cancelBtn = h('button', { class: 'btn quiet', type: 'button', onclick: () => m.close() }, cancel || L({ de: 'Abbrechen', en: 'Cancel' }));
        const panel = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' },
            h('h2', { id: 'dialog-title' }, title),
            h('p', {}, body),
            h('div', { class: 'dialog-actions' },
                cancelBtn,
                h('button', { class: `btn ${danger ? 'danger-solid' : 'primary'}`, type: 'button', onclick: async () => { m.close(); await onConfirm(); } }, confirm)));
        // the safe choice has the focus
        const m = modal(panel, { focus: cancelBtn, restoreFocus: () => this.terminal.focus() });
    }

    showSettings() {
        const row = (label, ...controls) => h('div', { class: 'settings-row' }, h('span', {}, label), h('div', {}, ...controls));
        const langBtn = code => h('button', { type: 'button', 'aria-pressed': String(lang() === code), onclick: () => { setLang(code); m.close(); this.showSettings(); } }, code.toUpperCase());
        const panel = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
            h('h2', { id: 'settings-title' }, L({ de: 'Einstellungen', en: 'Settings' })),
            row(L({ de: 'Sprache', en: 'Language' }), h('div', { class: 'lang-switch', role: 'group' }, langBtn('de'), langBtn('en'))),
            row(L({ de: 'Design', en: 'Theme' }), h('button', { class: 'btn', type: 'button', onclick: () => { this.toggleTheme(); m.close(); } }, icon(this.theme() === 'dark' ? 'sun' : 'moon'), this.theme() === 'dark' ? L({ de: 'Hell', en: 'Light' }) : L({ de: 'Dunkel', en: 'Dark' }))),
            row(L({ de: 'Bildschirmleser', en: 'Screen reader' }), screenReaderToggle(this)),
            row(this.world?.id === 'mission' ? L({ de: 'Mission', en: 'Mission' }) : 'Sandbox', h('button', { class: 'btn', type: 'button', onclick: () => { m.close(); this.confirmReset(); } }, icon('reset'), this.world?.id === 'mission' ? L({ de: 'Neu starten', en: 'Restart' }) : L({ de: 'Zurücksetzen', en: 'Reset' }))),
            h('div', { class: 'dialog-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => m.close() }, L({ de: 'Fertig', en: 'Done' }))));
        const m = modal(panel, { restoreFocus: () => this.terminal.focus() });
    }

    showHelp() {
        import('./ui/help.js').then(m => m.showHelp(this));
    }
}
