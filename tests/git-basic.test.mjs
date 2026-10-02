import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, realGit, runBoth } from './harness.mjs';

// Each scenario runs in the Werkstatt and in real git; outputs must match.
const NORMALIZE = s => s;
// Compared exactly, command by command – blank lines included.
async function compare(script, { setup } = {}) {
    const lines = Array.isArray(script) ? script.join('\n') : script;
    const { env, steps } = await runBoth(lines, { setup, normalize: NORMALIZE });
    const show = key => steps.map(s => `$ ${s.cmd}\n${s[key]}`).join('');
    return { ours: show('ours'), real: show('real'), env, steps };
}

test('init, status, add, commit – identical to real git', async () => {
    const script = [
        'git init proj',
        'cd proj',
        'git status',
        'echo hallo > a.txt',
        'mkdir src && echo x > src/app.js',
        'git status',
        'git add a.txt',
        'git status',
        'git status -s',
        'git commit -m "Erster Commit"',
        'git add .',
        'git commit -m "App hinzu"',
        'echo welt >> a.txt',
        'git status',
        'git commit -m nichts',
        'git commit -am "Mehr Text"',
        'git status',
        'git log --oneline',
    ].join('\n');
    const { ours, real } = await compare(script);
    assert.equal(ours.replace(/\/tmp\/realgit-\w+/g, '/home/student'), real.replace(/\/tmp\/realgit-\w+/g, '/home/student'));
});

test('rm, mv, restore, status in subdirectory', async () => {
    const script = [
        'git init -q p && cd p',
        'mkdir -p docs && echo a > docs/a.md && echo b > b.txt && echo c > c.txt',
        'git add . && git commit -qm base',
        'git mv b.txt docs/b.txt',
        'git rm c.txt',
        'echo changed > docs/a.md',
        'cd docs && git status && cd ..',
        'git restore docs/a.md',
        'git restore --staged docs/b.txt',
        'git status --short',
        'echo z > z.txt && git add z.txt && echo zz >> z.txt',
        'git rm z.txt',
        'git rm --cached z.txt',
        'git status -s',
    ].join('\n');
    const { ours, real } = await compare(script);
    assert.equal(ours, real);
});

test('errors: not a repo, bad pathspec, unknown command, identity', async () => {
    const env = await makeEnv({ identity: false });
    let r = await env.run('git status');
    assert.equal(r.out, 'fatal: not a git repository (or any of the parent directories): .git\n');
    assert.equal(r.status, 128);
    await env.run('git init -q p && cd p');
    r = await env.run('git add nope.txt');
    assert.equal(r.out, "fatal: pathspec 'nope.txt' did not match any files\n");
    r = await env.run('git comit');
    assert.equal(r.out, "git: 'comit' is not a git command. See 'git --help'.\n\nThe most similar command is\n\tcommit\n");
    await env.run('echo a > a && git add a');
    r = await env.run('git commit -m x');
    assert.match(r.out, /Author identity unknown/);
    assert.equal(r.status, 128);
    await env.run('git config --global user.name "Ada"');
    await env.run('git config --global user.email ada@example.com');
    r = await env.run('git commit -m x');
    assert.match(r.out, /^\[main \(root-commit\) [0-9a-f]{7}\] x\n 1 file changed, 1 insertion\(\+\)\n create mode 100644 a\n$/);
    r = await env.run('git config user.name');
    assert.equal(r.out, 'Ada\n');
});

test('commit opens the editor without -m and strips comments', async () => {
    const env = await makeEnv();
    await env.run('git init -q p && cd p && echo a > a && git add a');
    env.ui.editResponses.push(text => `Mein Commit\n\nDetails hier\n${text}`);
    const r = await env.run('git commit');
    assert.match(r.out, /\[main \(root-commit\) [0-9a-f]{7}\] Mein Commit/);
    const log = await env.run('git log -1 --format=%B');
    assert.equal(log.out, 'Mein Commit\n\nDetails hier\n\n');
    // empty message aborts
    await env.run('echo b >> a && git add a');
    env.ui.editResponses.push(text => text);
    const r2 = await env.run('git commit');
    assert.match(r2.out, /Aborting commit due to empty commit message\./);
    assert.equal(r2.status, 1);
});
