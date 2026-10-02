// Missions: guided tasks in their own world with a simulated server and team.
//
// A mission is data (see content/): a story, a setup that builds the world,
// objectives checked against the real state after every command, progressive
// hints and a debrief. Nothing is scored – the goal is understanding.

import { MISSIONS, LINES, missionById, nextMission } from './content/index.js';
import { val, TEAM } from './content/common.js';
import { TEAM_ROOT } from '../git/simserver.js';
import { mkdirp } from '../vfs/fsutil.js';
import { Kit } from './kit.js';
import { makeCheckContext, homePath } from './checks.js';
import { MissionView } from './view.js';
import { L } from '../core/i18n.js';

const PROGRESS_KEY = 'gw.missions';
// written at the end of a setup: proves the mission's files really exist
const MARKER = `${TEAM_ROOT}/.mission`;

// A fingerprint of a mission's objectives. Saved progress only fits the version of the
// mission it was made with; after an update that changed the objectives it starts over.
function shapeOf(m) {
    const text = m.objectives.map(o => (typeof o.text === 'function' ? o.text({}) : o.text).de).join('|');
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.codePointAt(0)) | 0;
    return (h >>> 0).toString(36);
}

const IDENTITY_KEY = 'gw.identity';
const MAX_LOG = 300;

function loadProgress() {
    try {
        const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
        return { current: null, setupFor: null, done: {}, runs: {}, ...p };
    } catch {
        return { current: null, setupFor: null, done: {}, runs: {} };
    }
}

export class Missions {
    constructor(app) {
        this.app = app;
        this.progress = loadProgress();
        this.view = new MissionView(this);
        this.preparing = false;
    }

    save() {
        try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress)); } catch { /* ignore */ }
    }

    get world() {
        return this.app.worlds.mission;
    }

    get current() {
        return this.progress.current ? missionById(this.progress.current) : null;
    }

    // the per-run state of the current mission
    get run() {
        const id = this.progress.current;
        if (!id) return null;
        if (!this.progress.runs[id]) this.progress.runs[id] = { index: 0, since: 0, step: 0, log: [], hints: {}, data: {}, pitfalls: {}, finished: false };
        const run = this.progress.runs[id];
        run.pitfalls ||= {};
        return run;
    }

    lines() {
        return LINES;
    }

    missions() {
        return MISSIONS;
    }

    isDone(id) {
        return Boolean(this.progress.done[id]);
    }

    // ---- entering / starting ------------------------------------------------------------------

    // Called by the app whenever the mission world becomes active.
    async enter({ quiet = false } = {}) {
        const m = this.current;
        if (!m) {
            this.view.render();
            if (!quiet) this.showMap();
            return;
        }
        if (this.progress.setupFor === m.id) {
            const run = this.progress.runs[m.id];
            const marker = await this.world.pfs.readFile(MARKER, 'utf8').catch(() => null);
            const outdated = run?.shape !== shapeOf(m);
            if (outdated || marker !== m.id) {
                delete this.progress.runs[m.id];
                this.progress.setupFor = null;
                if (outdated && run) this.app.terminal.write(`\x1b[38;2;160;154;142m${L({ de: 'Diese Mission wurde inzwischen überarbeitet und startet deshalb von vorn.', en: 'This mission has been revised in the meantime, so it starts from the beginning.' })}\x1b[0m\n`);
            }
        }
        if (this.progress.setupFor !== m.id) await this.setup(m);
        this.view.render();
        this.announce(m);
    }

    announce(m) {
        const t = this.app.terminal;
        t.write(`\x1b[48;2;105;65;198m\x1b[38;2;255;255;255m\x1b[1m ${L({ de: 'MISSION', en: 'MISSION' })} ${m.code} \x1b[0m \x1b[1m${L(m.title)}\x1b[0m\n`);
        t.write(`\x1b[38;2;160;154;142m${L({ de: 'Server und Team in dieser Mission sind simuliert – alles bleibt in deinem Browser.', en: 'Server and team in this mission are simulated – everything stays in your browser.' })}\x1b[0m\n\n`);
    }

    async start(id) {
        const m = missionById(id);
        if (!m || this.app.busy) return;
        this.view.closeOverlays();
        this.progress.current = id;
        this.progress.setupFor = null;
        delete this.progress.runs[id];
        this.save();
        if (this.app.world?.id === 'mission') await this.app.enterWorld('mission');
        else await this.app.switchWorld('mission');
    }

    async restart() {
        if (this.current) await this.start(this.current.id);
    }

    async leave() {
        this.progress.current = null;
        this.save();
        this.view.render();
        this.renderCrumb();
    }

    // Builds the world of a mission from scratch
    async setup(m) {
        const app = this.app;
        const world = this.world;
        this.preparing = true;
        this.view.render();
        app.busy = true;
        try {
            await world.open({ wipe: true });
            const kit = new Kit({ registry: app.registry, world, known: TEAM });
            // the student's identity is reused across missions (unless a mission teaches it)
            if (m.identity !== false) {
                const id = this.identity();
                await kit.write('~/.gitconfig', `[user]\n\tname = ${id.name}\n\temail = ${id.email}\n[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n`);
            } else {
                await kit.write('~/.gitconfig', '[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n');
            }
            try {
                await m.setup?.(kit);
            } finally {
                kit.finish();
            }
            world.cwd = homePath(m.start || '~');
            world.oldpwd = null;
            world.history = [];
            this.run.data = { ...kit.data };
            this.run.shape = shapeOf(m);
            await mkdirp(world.pfs, TEAM_ROOT);
            await world.pfs.writeFile(MARKER, m.id, 'utf8');
            this.progress.setupFor = m.id;
            this.save();
        } catch (e) {
            console.error(e);
            app.terminal.write(`\x1b[31m${L({ de: 'Die Mission konnte nicht vorbereitet werden:', en: 'The mission could not be prepared:' })} ${e.message}\x1b[0m\n`);
        } finally {
            app.busy = false;
            this.preparing = false;
        }
    }

    identity() {
        try {
            const id = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null');
            if (id?.name && id?.email) return id;
        } catch { /* ignore */ }
        return { name: 'Student', email: 'student@example.com' };
    }

    // ---- after every command -----------------------------------------------------------------------

    async afterStep({ line, result, prev, next, coach }) {
        const app = this.app;
        if (app.world?.id !== 'mission') return null;
        // remember an identity the student configured themselves
        if (next.repo?.identity && coach.events?.some(e => e.type === 'identity-set')) {
            try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(next.repo.identity)); } catch { /* ignore */ }
        }
        const m = this.current;
        const run = this.run;
        if (!m || !run || run.finished || this.progress.setupFor !== m.id) return null;
        run.step += 1;
        for (const c of result.commands || []) {
            run.log.push({ step: run.step, cmd: [c.name, ...c.args].join(' '), name: c.name, args: c.args, status: c.status });
        }
        if (run.log.length > MAX_LOG) run.log.splice(0, run.log.length - MAX_LOG);

        const completed = [];
        let worldChanged = false;
        const context = () => makeCheckContext({ world: this.world, state: next, prev, log: run.log, since: run.since, data: run.data, step: { line, commands: result.commands || [] } });
        const notes = [];

        // known traps of this mission: a specific way out, shown once per run
        for (const p of m.pitfalls || []) {
            if (run.pitfalls[p.id]) continue;
            let hit = false;
            try { hit = await p.check(context()); } catch (e) { console.warn('pitfall check failed', e); }
            if (!hit) continue;
            run.pitfalls[p.id] = true;
            notes.push({ tone: 'warn', text: val(p.note, run.data), mission: true });
        }

        while (run.index < m.objectives.length) {
            const obj = m.objectives[run.index];
            const ctx = context();
            let ok = false;
            try { ok = await obj.check(ctx); } catch (e) { console.warn('objective check failed', e); }
            if (!ok) break;
            completed.push(obj);
            run.index += 1;
            run.since = run.step; // the next objective may already be reached by this same step
            if (obj.after) {
                await this.live(kit => obj.after(kit, ctx));
                worldChanged = true;
                break; // the world changed: check the next objective against the new state after the next step
            }
        }
        // the coach had nothing to say about this command, but the mission has
        if (!coach.entry && (notes.length || completed.length || run.index >= m.objectives.length)) {
            coach.entry = { line, time: Date.now(), key: 'mission-note', tone: 'info', title: { de: `Mission ${m.code}`, en: `Mission ${m.code}` }, body: null, notes: [], compact: true };
        }
        if (coach.entry && notes.length) coach.entry.notes = [...(coach.entry.notes || []), ...notes];
        if (completed.length && coach.entry) {
            coach.entry.notes = coach.entry.notes || [];
            for (const obj of completed) {
                const text = val(obj.text, run.data);
                coach.entry.notes.push({ tone: 'success', text: { de: `✓ Ziel erreicht: ${text.de}`, en: `✓ Goal reached: ${text.en}` }, mission: true });
            }
        }
        if (run.index >= m.objectives.length && !run.finished) {
            run.finished = true;
            this.progress.done[m.id] = { at: Date.now() };
            if (coach.entry) {
                coach.entry.notes = coach.entry.notes || [];
                coach.entry.notes.push({ tone: 'success', text: { de: `**Mission ${m.code} geschafft!** Die Auswertung steht oben im Missionskärtchen.`, en: `**Mission ${m.code} complete!** The debrief is in the mission card above.` }, mission: true });
            }
        }
        this.save();
        this.view.render({ justCompleted: completed.length > 0 });
        this.renderCrumb();
        return { worldChanged };
    }

    // Something the student looked at without a command (e.g. the History view). It is logged
    // like a command named "#view" so objectives can accept it.
    async observe(view) {
        const m = this.current;
        const run = this.run;
        const state = this.app.state;
        if (!m || !run || run.finished || !state || this.progress.setupFor !== m.id) return;
        const result = { commands: [{ name: '#view', args: [view], status: 0, info: {} }], status: 0, stdout: '', stderr: '' };
        const coach = { entry: null };
        await this.afterStep({ line: null, result, prev: state, next: state, coach });
        if (coach.entry) await this.app.refresh({ entry: coach.entry });
    }

    // Teammates acting while the student works (a push, a merged pull request …)
    async live(fn) {
        const kit = new Kit({
            registry: this.app.registry,
            world: this.world,
            known: TEAM,
            onTeam: ev => this.app.terminal.interject(() => this.app.terminal.annotate({ type: 'team', ...ev })),
        });
        try {
            await fn(kit);
        } catch (e) {
            console.error('teammate action failed', e);
        } finally {
            kit.finish();
            Object.assign(this.run.data, kit.data);
        }
    }

    // ---- hints ------------------------------------------------------------------------------------------

    hintsShown(index) {
        return this.run?.hints[index] || 0;
    }

    showHint(index) {
        const run = this.run;
        const obj = this.current?.objectives[index];
        if (!run || !obj) return;
        run.hints[index] = Math.min((run.hints[index] || 0) + 1, (obj.hints || []).length);
        this.save();
        this.view.render();
    }

    // ---- UI hooks --------------------------------------------------------------------------------------

    showMap() {
        this.view.showMap();
    }

    showWelcome() {
        this.view.showWelcome();
    }

    renderCrumb() {
        this.view.renderCrumb();
    }

    relabel() {
        this.view.render();
        this.view.renderCrumb();
    }

    // The recommendation: the next unfinished mission after the current one. Without a
    // current mission, the first unfinished one outside the optional shell line.
    next() {
        const m = this.current;
        if (m) {
            const after = MISSIONS.slice(MISSIONS.indexOf(m) + 1);
            return after.find(x => !this.isDone(x.id)) || nextMission(m.id);
        }
        return MISSIONS.find(x => x.line !== 'shell' && !this.isDone(x.id)) || null;
    }

    // (re-)entering the sandbox also fetches its practice project on the first visit
    async goSandbox() {
        this.view.closeOverlays();
        if (this.app.busy) return;
        if (this.app.world?.id === 'sandbox') await this.app.enterWorld('sandbox');
        else await this.app.switchWorld('sandbox');
        this.app.terminal.focus();
    }
}
