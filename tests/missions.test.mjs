// Every mission is played through with a reference solution: the setup must work,
// and the objectives must be reached one after another.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './harness.mjs';

const { Missions } = await import('../src/missions/engine.js');
const { MISSIONS } = await import('../src/missions/content/index.js');
const { captureState } = await import('../src/learn/state.js');
const { coachFor } = await import('../src/learn/coach.js');
const { setLang } = await import('../src/core/i18n.js');

// keep "ours" in every conflict block
function keepOurs(text) {
    return text.replace(/^<{7}[^\n]*\n([\s\S]*?)^={7}\n[\s\S]*?^>{7}[^\n]*\n/gm, '$1');
}

const edit = (path, fn) => ({ edit: path, fn });

async function play(id, steps, { lang = 'de', finish = true } = {}) {
    setLang(lang);
    const env = await makeEnv({ id: 'mission', kind: 'mission', fixedClock: false });
    let terminal = '';
    const app = {
        registry: env.shell.registry,
        worlds: { mission: env.world },
        world: env.world,
        busy: false,
        terminal: { interject: fn => fn(), annotate: n => { terminal += `[${n.type}] `; }, write: s => { terminal += s; } },
    };
    const missions = new Missions(app);
    missions.progress = { current: id, setupFor: null, done: {}, runs: {} };
    await missions.enter({ quiet: true });
    assert.equal(missions.progress.setupFor, id, `setup of ${id} failed: ${terminal}`);
    let prev = await captureState(env.world);
    const trail = [];
    const notes = [];
    let lastCoach = null;
    for (const step of steps) {
        let result = { commands: [], status: 0, stdout: '', stderr: '' };
        let line = null;
        if (step.edit) {
            const path = env.world.resolve(step.edit);
            const text = await env.pfs.readFile(path, 'utf8');
            await env.pfs.writeFile(path, step.fn(text, missions.run.data), 'utf8');
        } else {
            const s = typeof step === 'string' ? { line: step } : step;
            line = typeof s.line === 'function' ? s.line(missions.run.data) : s.line;
            if (s.editor) env.ui.editResponses.push(s.editor);
            result = await env.shell.runLine(line, { tty: true });
        }
        const next = await captureState(env.world);
        const coach = coachFor({ prev, next, result, line });
        await missions.afterStep({ line, result, prev, next, coach });
        lastCoach = coach;
        for (const n of coach.entry?.notes || []) if (n.mission && n.tone === 'warn') notes.push(n.text.de);
        prev = next;
        trail.push(`${line ?? 'edit ' + step.edit} → objective ${missions.run.index} (status ${result.status}) ${result.stderr.trim().split('\n')[0] || ''}`);
    }
    const m = missions.current;
    if (finish) assert.ok(missions.run.finished, `${id} not finished, stuck at objective ${missions.run.index + 1}: ${JSON.stringify(m.objectives[missions.run.index]?.text)}\n${trail.join('\n')}`);
    return { missions, env, notes, trail, lastCoach };
}

const accept = text => text;

const SOLUTIONS = {
    s1: ['pwd', 'ls', 'cd praktikum', 'cat aufgaben.txt', 'cd ..'],
    s2: ['mkdir website', 'touch website/index.html', 'cp entwurf.txt website/', 'mv old.css website/style.css', 'rm muell.tmp', 'echo "<h1>Bäckerei Krume</h1>" > website/index.html'],
    g1: ['git config --global user.name "Test Person"', 'git config --global user.email "test@example.com"', 'cd website', 'git init', 'git status'],
    g2: ['git add index.html', 'git status', 'git commit -m "Startseite anlegen"', 'git add style.css', 'git commit -m "Farben"', 'git log'],
    g3: [edit('index.html', t => t.replace('Sa 7–13 Uhr', 'Sa 7–14 Uhr')), 'git diff', 'git add index.html', 'git diff --staged', 'git commit -m "Samstag bis 14 Uhr"', 'git show'],
    g4: ['git log --oneline', { line: d => `git show ${d.badCommit.slice(0, 7)}` }, 'git blame menu.html', edit('menu.html', t => t.replace('8,00', '0,80')), 'git commit -am "Brezelpreis korrigiert"'],
    g5: ['git restore style.css', 'git restore --staged zugangsdaten.txt', 'echo zugangsdaten.txt >> .gitignore', 'git commit --amend -m "Öffnungszeiten aktualisiert"', 'git add .gitignore', 'git commit -m "Zugangsdaten ignorieren"'],
    g6: ['git log --oneline', { line: d => `git revert ${d.badCommit.slice(0, 7)}`, editor: accept }, 'git log --oneline'],
    b1: ['git branch', 'git switch -c torten', 'echo "<h1>Torten</h1>" > torten.html', 'git add torten.html', 'git commit -m "Tortenseite"', 'git switch main', 'ls', 'git log --oneline --graph --all'],
    b2: ['git log --oneline --graph --all', 'git switch main', { line: 'git merge torten', editor: accept }, 'git branch -d torten'],
    b3: ['git merge slogan', edit('index.html', keepOurs), 'git add index.html', { line: 'git commit', editor: accept }],
    b4: ['git reflog', { line: d => `git branch rezepte ${d.lostTip.slice(0, 7)}` }, 'git log --oneline rezepte'],
    t1: ['git clone https://git.sim/baeckerei/website.git', 'cd website', 'git remote -v', 'git branch -a', 'git shortlog -sn'],
    t2: [edit('index.html', t => t.replace('<footer>', '<footer><a href="impressum.html">Impressum</a> · ')), 'git commit -am "Link zum Impressum"', 'git status', 'git push'],
    t3: [edit('contact.html', t => t.replace(/0911 \d+/, '0911 246810')), 'git commit -am "Neue Telefonnummer"', 'git push', { line: 'git pull', editor: accept }, 'git push'],
    t4: ['git switch -c angebot-der-woche', 'echo "<h2>Angebot der Woche</h2>" > angebot.html', 'git add angebot.html', 'git commit -m "Angebot der Woche"', 'git push -u origin angebot-der-woche', 'git switch main', 'git pull', 'git branch -d angebot-der-woche'],
    p1: ['git stash', 'git switch main', edit('index.html', t => t.replace('Krüme', 'Krume')), 'git commit -am "Tippfehler"', 'git switch design', 'git stash pop'],
    p2: ['git log --oneline --graph --all', 'git rebase main', 'git log --oneline --graph --all', 'git switch main', 'git merge galerie'],
    p3: ['git log --oneline test', { line: d => `git cherry-pick ${d.fixCommit.slice(0, 7)}` }, 'git log --oneline --all'],
    p4: ['git tag -a v1.0 -m "Erste Version online"', 'git show v1.0', 'git push origin v1.0'],
};

test('every mission has a reference solution', () => {
    assert.deepEqual(MISSIONS.map(m => m.id).filter(id => !SOLUTIONS[id]), []);
});

for (const m of MISSIONS) {
    test(`mission ${m.code} can be completed`, async () => {
        await play(m.id, SOLUTIONS[m.id] || []);
    });
}

test('missions work in English too (file names follow the language)', async () => {
    await play('s1', ['pwd', 'ls', 'cd internship', 'cat tasks.txt', 'cd'], { lang: 'en' });
    await play('b4', ['git reflog', { line: d => `git branch recipes ${d.lostTip}` }, 'git switch recipes'], { lang: 'en' });
    setLang('de');
});

test('objectives are not completed by unrelated commands', async () => {
    const env = await makeEnv({ id: 'mission', kind: 'mission', fixedClock: false });
    const app = { registry: env.shell.registry, worlds: { mission: env.world }, world: env.world, busy: false, terminal: { interject: f => f(), annotate() {}, write() {} } };
    const missions = new Missions(app);
    missions.progress = { current: 'g2', setupFor: null, done: {}, runs: {} };
    await missions.enter({ quiet: true });
    let prev = await captureState(env.world);
    for (const line of ['ls', 'git status', 'git add style.css']) {
        const result = await env.shell.runLine(line, { tty: true });
        const next = await captureState(env.world);
        await missions.afterStep({ line, result, prev, next, coach: coachFor({ prev, next, result, line }) });
        prev = next;
    }
    assert.equal(missions.run.index, 0, 'staging style.css must not count as staging index.html');
});

// ---- other valid solutions and known traps -----------------------------------------------------

test('alternative solutions count', async () => {
    // G4: a dot instead of a comma
    await play('g4', [{ line: d => `git show ${d.badCommit}` }, 'git log --oneline', { line: d => `git show ${d.badCommit}` }, 'git blame menu.html', edit('menu.html', t => t.replace('8,00', '0.80')), 'git commit -am "Preis"']);
    // G5: any message without the typo
    await play('g5', ['git restore style.css', 'git restore --staged zugangsdaten.txt', 'echo zugangsdaten.txt >> .gitignore', 'git commit --amend -m "Öffnungszeiten für Samstag geändert"', 'git add .gitignore', 'git commit -m "Ignorieren"']);
    // T1: another folder name
    await play('t1', ['git clone https://git.sim/baeckerei/website.git baeckerei', 'cd baeckerei', 'git remote -v', 'git branch -a', 'git log']);
    // P1: apply instead of pop
    const p1 = await play('p1', ['git stash', 'git switch main', edit('index.html', t => t.replace('Krüme', 'Krume')), 'git commit -am "Tippfehler"', 'git switch design', 'git stash apply']);
    assert.ok(p1.notes.some(n => n.includes('git stash drop')), p1.notes.join('\n'));
});

test('G2: staging the private notes is caught and explained', async () => {
    const { notes, missions } = await play('g2', ['git add index.html', 'git status', 'git commit -m "Start"', 'git add .', 'git commit -m "Rest"', 'git log']);
    assert.ok(notes.some(n => n.includes('git restore --staged notizen.txt')), notes.join('\n'));
    assert.ok(notes.some(n => n.includes('git rm --cached notizen.txt')), notes.join('\n'));
    assert.equal(missions.run.data.notesCommitted, true);
});

test('G6: reset instead of revert is explained, and the way back works', async () => {
    const { notes } = await play('g6', ['git log --oneline', 'git reset --hard HEAD~2', 'git reset --hard ORIG_HEAD', { line: d => `git revert ${d.badCommit}`, editor: accept }, 'git log --oneline']);
    assert.ok(notes.some(n => n.includes('Mias Commit')), notes.join('\n'));
});

test('B3: conflict markers in the commit do not complete the mission', async () => {
    const r = await play('b3', ['git merge slogan', 'git add index.html', { line: 'git commit', editor: accept }], { finish: false });
    assert.equal(r.missions.run.finished, false);
    assert.ok(r.notes.some(n => n.includes('Konfliktmarker')), r.notes.join('\n'));
});

test('P2: a merge is not a straight line', async () => {
    const r = await play('p2', ['git log --oneline --graph --all', { line: 'git merge main', editor: accept }], { finish: false });
    assert.equal(r.missions.run.index, 1, r.trail.join('\n'));
    assert.ok(r.notes.some(n => n.includes('Merge')), r.notes.join('\n'));
});

test('S2: moving instead of copying is caught', async () => {
    const r = await play('s2', ['mkdir website', 'touch website/index.html', 'mv entwurf.txt website/'], { finish: false });
    assert.ok(r.notes.some(n => n.includes('verschoben statt kopiert')), r.notes.join('\n'));
});

test('undo rewinds the student, not the server or the team', async () => {
    const { UndoStack } = await import('../src/vfs/undo.js');
    const { SIM_ROOT, TEAM_ROOT } = await import('../src/git/simserver.js');
    const r = await play('t3', [edit('contact.html', t => t.replace(/0911 \d+/, '0911 246810')), 'git commit -am "Neue Telefonnummer"'], { finish: false });
    const undo = new UndoStack(r.env.world, { exclude: [SIM_ROOT, TEAM_ROOT] });
    await undo.init();
    const before = await r.env.run('git ls-remote origin main');
    // the student's push is rejected; a teammate pushes meanwhile; then the student undoes their last step
    await r.env.run('echo x >> contact.html && git commit -qam x');
    await undo.afterCommand('commit');
    await r.env.pfs.writeFile(`${TEAM_ROOT}/marker`, 'team', 'utf8');
    await undo.undo();
    assert.equal((await r.env.run('git ls-remote origin main')).out, before.out, 'the server is untouched');
    assert.equal(await r.env.pfs.readFile(`${TEAM_ROOT}/marker`, 'utf8'), 'team', 'the team folder is untouched');
    assert.equal((await r.env.run('git log -1 --format=%s')).out.trim(), 'Neue Telefonnummer', 'the student commit was undone');
});

test('after a rejected push the coach suggests pull, not push again', async () => {
    const r = await play('t3', [edit('contact.html', t => t.replace(/0911 \d+/, '0911 246810')), 'git commit -am "Neue Telefonnummer"', 'git push'], { finish: false });
    const cmds = r.lastCoach.suggestions.map(s => s.cmd);
    assert.equal(cmds[0], 'git pull', cmds.join(' | '));
    assert.ok(!cmds.includes('git push'), cmds.join(' | '));
});

test('looking at the History view counts where the hint offers it', async () => {
    const env = await makeEnv({ id: 'mission', kind: 'mission', fixedClock: false });
    const app = { registry: env.shell.registry, worlds: { mission: env.world }, world: env.world, busy: false, terminal: { interject: f => f(), annotate() {}, write() {} }, refresh: async () => {} };
    const missions = new Missions(app);
    missions.progress = { current: 'b2', setupFor: null, done: {}, runs: {} };
    await missions.enter({ quiet: true });
    app.state = await captureState(env.world);
    await missions.observe('graph');
    assert.equal(missions.run.index, 1);
});

test('saved progress is dropped when the mission changed or its files are gone', async () => {
    const env = await makeEnv({ id: 'mission', kind: 'mission', fixedClock: false });
    let out = '';
    const app = { registry: env.shell.registry, worlds: { mission: env.world }, world: env.world, busy: false, terminal: { interject: f => f(), annotate() {}, write: s => { out += s; } }, refresh: async () => {} };
    const missions = new Missions(app);
    missions.progress = { current: 'g1', setupFor: null, done: {}, runs: {} };
    await missions.enter({ quiet: true });
    assert.ok(await env.world.pfs.readFile('/home/student/website/index.html', 'utf8'));
    // an old run from before an update
    missions.run.index = 3;
    missions.run.shape = 'old';
    await missions.enter({ quiet: true });
    assert.equal(missions.run.index, 0);
    assert.match(out, /überarbeitet/);
    // the files vanished (storage evicted) but progress says "set up"
    missions.run.index = 2;
    await env.pfs.unlink('/var/team/.mission');
    await missions.enter({ quiet: true });
    assert.equal(missions.run.index, 0);
    assert.ok(await env.world.pfs.readFile('/home/student/website/index.html', 'utf8'));
});
