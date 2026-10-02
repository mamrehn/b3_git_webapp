import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, realGit, runBoth } from './harness.mjs';

// real git stamps uncommitted blame lines with the wall-clock time
const NORMALIZE = s => s.replace(/(Not Committed Yet) \d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4}/g, '$1 <now>');
// Compared exactly, command by command – blank lines included.
async function compare(script, { setup } = {}) {
    const lines = Array.isArray(script) ? script.join('\n') : script;
    const { env, steps } = await runBoth(lines, { setup, normalize: NORMALIZE });
    const show = key => steps.map(s => `$ ${s.cmd}\n${s[key]}`).join('');
    return { ours: show('ours'), real: show('real'), env, steps };
}

const setup = [
    'git init -q p && cd p',
    'printf "a\\nb\\nc\\n" > f.txt && git add f.txt && git commit -q -m "Erster Commit" -m "Mit einem zweiten Absatz."',
    'printf "a\\nB\\nc\\nd\\n" > f.txt && git commit -qam "Zweiter"',
    'git switch -qc feature && echo neu > n.txt && git add n.txt && git commit -qm "Feature"',
    'git switch -q main && echo x >> f.txt && git commit -qam "Dritter"',
    'git merge -q --no-edit feature',
];

test('log formats and graph match real git', async () => {
    const { ours, real } = await compare([
        ...setup,
        'git log',
        'git log --oneline',
        'git log --oneline --graph',
        'git log --graph',
        'git log --pretty=oneline -n 2',
        'git log --format="%h %an %s" main~1..feature',
        'git log --stat -n 2',
        'git log --oneline -- n.txt',
    ].join('\n'));
    assert.equal(ours, real);
});

test('show, diff, blame match real git', async () => {
    const { ours, real } = await compare([
        ...setup,
        'git show HEAD~1',
        'git show HEAD~1 --stat',
        'git show HEAD~2:f.txt',
        'printf "a\\nB\\nc\\nd\\nx\\nmehr\\n" > f.txt',
        'git diff',
        'git add f.txt && echo noch >> f.txt',
        'git diff',
        'git diff --staged',
        'git diff --stat HEAD~3 HEAD',
        'git diff HEAD~3 HEAD -- f.txt',
        'git blame f.txt',
        'git log -p -n 1 --format=%s',
    ].join('\n'));
    assert.equal(ours, real);
});
