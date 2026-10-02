import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './harness.mjs';

const { captureState } = await import('../src/learn/state.js');
const { coachFor } = await import('../src/learn/coach.js');
const { explainInput } = await import('../src/learn/explain.js');

async function session() {
    const env = await makeEnv();
    let state = await captureState(env.world);
    const step = async line => {
        const result = await env.shell.runLine(line, { tty: false });
        const next = await captureState(env.world);
        const c = coachFor({ prev: state, next, result, line });
        state = next;
        return c;
    };
    return { env, step, get state() { return state; } };
}

test('coach explains the basic workflow and suggests next steps', async () => {
    const s = await session();
    let c = await s.step('git status');
    assert.equal(c.entry.key, 'error:git-not-a-repo');
    assert.ok(c.suggestions.some(x => x.cmd.startsWith('mkdir') || x.cmd === 'git init'));

    c = await s.step('mkdir web && cd web');
    assert.equal(c.entry.key, 'cd');
    c = await s.step('git init');
    assert.equal(c.entry.key, 'init');
    c = await s.step('echo "<h1>Hallo</h1>" > index.html');
    assert.equal(c.entry.key, 'shell-files:echo');
    assert.ok(c.suggestions.some(x => x.cmd === 'git add index.html'), JSON.stringify(c.suggestions));

    c = await s.step('git commit -m test');
    assert.equal(c.entry.key, 'error:nothing-to-commit');

    c = await s.step('git add index.html');
    assert.equal(c.entry.key, 'add');
    assert.equal(c.entry.title.de, '`index.html` ist vorgemerkt');
    assert.ok(c.suggestions[0].cmd.startsWith('git commit -m'));

    c = await s.step('git commit -m "Startseite"');
    assert.equal(c.entry.key, 'commit');
    assert.match(c.entry.body.de, /erste Commit/);

    c = await s.step('echo mehr >> index.html');
    c = await s.step('git restore index.html');
    assert.equal(c.entry.key, 'restore');
    assert.equal(c.entry.tone, 'danger');
});

test('coach explains branches, conflicts and the reflog rescue', async () => {
    const s = await session();
    await s.step('git init -q p && cd p && printf "a\\nb\\n" > f.txt && git add . && git commit -qm base');
    let c = await s.step('git branch idee');
    assert.equal(c.entry.key, 'branch-create');
    c = await s.step('git switch idee');
    assert.equal(c.entry.key, 'switch');
    await s.step('sed -i "1s/.*/A/" f.txt && git commit -qam "A"');
    await s.step('git switch -q main && sed -i "1s/.*/Z/" f.txt && git commit -qam "Z"');
    c = await s.step('git merge idee');
    assert.equal(c.entry.key, 'conflict-merge');
    assert.equal(c.entry.tone, 'danger');
    assert.equal(c.suggestions[0].cmd, 'nano f.txt');
    assert.equal(c.situation.find(f => f.key === 'op')?.value.en, 'Merge');
    c = await s.step('git merge --abort');
    assert.equal(c.entry.key, 'merge-abort');
    c = await s.step('git reset --hard HEAD~1');
    assert.equal(c.entry.key, 'reset-hard');
    assert.match(c.entry.body.de, /reflog/);
    c = await s.step('git reflog');
    assert.equal(c.entry.key, 'reflog');
    c = await s.step('git checkout HEAD~0');
    assert.equal(c.entry.key, 'detached');
});

test('explain bar describes options and warns before destructive commands', async () => {
    const s = await session();
    await s.step('git init -q p && cd p && echo a > a.txt && git add . && git commit -qm base && echo b >> a.txt');
    const reg = s.env.shell.registry;
    let ex = explainInput('git commit -am "x"', reg, s.state);
    assert.deepEqual(ex.parts.map(p => p.text), ['git', 'commit', '-a', '-m']);
    ex = explainInput('git reset --hard', reg, s.state);
    assert.equal(ex.warning.level, 'danger');
    assert.match(ex.warning.text.de, /a\.txt/);
    ex = explainInput('git restore a.txt', reg, s.state);
    assert.equal(ex.warning.level, 'danger');
    ex = explainInput('git restore --staged a.txt', reg, s.state);
    assert.equal(ex.warning, null);
    ex = explainInput('git commit -m "offen', reg, s.state);
    assert.ok(ex.pending);
    ex = explainInput('rm -rf ordner', reg, s.state);
    assert.equal(ex.warning.level, 'danger');
});

test('suggestions use paths relative to the current folder', async () => {
    const s = await session();
    await s.step('mkdir -p web/css && cd web && git init -q');
    await s.step('echo a > index.html && echo b > css/style.css && git add . && git commit -qm start');
    await s.step('cd css && echo c >> style.css');
    const { suggest } = await import('../src/learn/suggest.js');
    let cmds = suggest(s.state).map(x => x.cmd);
    assert.ok(cmds.includes('git add style.css'), cmds.join(' | '));
    assert.ok(cmds.includes('git restore style.css'), cmds.join(' | '));
    await s.step('echo d >> ../index.html');
    cmds = suggest(s.state).map(x => x.cmd);
    assert.ok(cmds.includes('git add -A'), 'in a subfolder `git add .` would miss ../index.html: ' + cmds.join(' | '));
    // and the suggested command really works from here
    const r = await s.env.shell.runLine('git add -A && git status --short', { tty: false });
    assert.equal(r.stdout, 'M  style.css\nM  ../index.html\n'); // real git sorts by repository path
});

test('a conflicting stash pop: no commit, keep the entry, reset --merge to go back', async () => {
    const s = await session();
    await s.step('mkdir r && cd r && git init -q && echo a > f && git add f && git commit -qm 1');
    await s.step('echo b > f && git stash -q && echo c > f && git commit -qam 2');
    const c = await s.step('git stash pop');
    assert.equal(c.entry.key, 'conflict-stash');
    assert.match(c.entry.body.de, /git stash drop/);
    assert.match(c.entry.body.de, /git reset --merge/);
    assert.doesNotMatch(c.entry.body.de, /git commit|checkout --/);
    const cmds = c.suggestions.map(x => x.cmd);
    assert.deepEqual(cmds.slice(0, 2), ['nano f', 'git add f'], cmds.join(' | '));
    assert.ok(cmds.includes('git reset --merge'), cmds.join(' | '));
    assert.ok(!cmds.some(x => x.startsWith('git commit')), cmds.join(' | '));
    // after resolving: the entry is still there and should be dropped
    await s.step('echo ok > f');
    const after = await s.step('git add f');
    assert.ok(after.suggestions.some(x => x.cmd === 'git stash drop'), after.suggestions.map(x => x.cmd).join(' | '));
});
