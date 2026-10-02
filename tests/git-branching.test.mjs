import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, realGit, runBoth } from './harness.mjs';

const NORMALIZE = s => s;
// Compared exactly, command by command – blank lines included.
async function compare(script, { setup } = {}) {
    const lines = Array.isArray(script) ? script.join('\n') : script;
    const { env, steps } = await runBoth(lines, { setup, normalize: NORMALIZE });
    const show = key => steps.map(s => `$ ${s.cmd}\n${s[key]}`).join('');
    return { ours: show('ours'), real: show('real'), env, steps };
}

const base = [
    'git init -q p && cd p',
    'printf "Brot\\nButter\\nKäse\\n" > liste.txt && git add . && git commit -qm "Einkaufsliste"',
];

test('branches, switch, checkout, detached HEAD', async () => {
    const { ours, real } = await compare([
        ...base,
        'git branch feature',
        'git branch',
        'git switch feature',
        'echo Milch >> liste.txt && git commit -qam "Milch"',
        'git branch -v',
        'git switch -',
        'git branch -d feature',
        'git checkout -b neu',
        'git switch neu',
        'git checkout HEAD~0',
        'git status',
        'echo Tee >> liste.txt && git commit -qam "Tee"',
        'git switch main',
        'git branch -m haupt',
        'git branch',
        'git switch nope',
        'git switch HEAD~0',
        'git branch "bad name"',
        'git branch -D feature',
    ]);
    assert.equal(ours, real);
});

test('fast-forward, 3-way merge, conflict and resolution', async () => {
    const { ours, real } = await compare([
        ...base,
        'git switch -q -c ff && echo Eier >> liste.txt && git commit -qam "Eier" && git switch -q main',
        'git merge ff',
        'git switch -q -c links && sed -i "1s/.*/Vollkornbrot/" liste.txt && git commit -qam "Vollkorn"',
        'git switch -q main && echo Wurst >> liste.txt && git commit -qam "Wurst"',
        'git merge --no-edit links',
        'git log --oneline --graph',
        'git switch -q -c streit && sed -i "2s/.*/Margarine/" liste.txt && git commit -qam "Margarine"',
        'git switch -q main && sed -i "2s/.*/Bio-Butter/" liste.txt && git commit -qam "Bio-Butter"',
        'git merge streit',
        'cat liste.txt',
        'git status',
        'git status -s',
        'git commit -m test',
        'printf "Vollkornbrot\\nBio-Butter\\nKäse\\nEier\\nWurst\\n" > liste.txt',
        'git add liste.txt',
        'git status',
        'git commit --no-edit',
        'git log --oneline -3',
        'git reflog',
    ]);
    assert.equal(ours, real);
});

test('merge --abort, add/add conflict, local changes block merge', async () => {
    const { ours, real } = await compare([
        ...base,
        'git switch -q -c a && echo A > neu.txt && git add neu.txt && git commit -qm "neu A"',
        'git switch -q main && echo B > neu.txt && git add neu.txt && git commit -qm "neu B"',
        'git merge a',
        'cat neu.txt',
        'git merge --abort',
        'git status',
        'echo lokal >> liste.txt',
        'git switch -q -c c && git commit -qam "lokal auf c" && git switch -q main',
        'echo anders >> liste.txt',
        'git merge c',
        'git merge nope',
    ]);
    assert.equal(ours, real);
});

test('reset modes, reflog recovery, tags', async () => {
    const { ours, real } = await compare([
        ...base,
        'echo 1 >> liste.txt && git commit -qam eins',
        'echo 2 >> liste.txt && git commit -qam zwei',
        'git reset --soft HEAD~1',
        'git status -s',
        'git reset HEAD~1',
        'git status -s',
        'git commit -qam wieder',
        'git reset --hard HEAD~1',
        'git log --oneline',
        'git reflog',
        'git reset --hard HEAD@{1}',
        'git log --oneline',
        'git tag v1.0',
        'git tag -a v1.1 -m "Version 1.1" HEAD~1',
        'git tag',
        'git tag -n',
        'git show v1.1 --stat',
        'git tag -d v1.0',
        'git log --oneline --decorate',
        'echo x > liste.txt && git add liste.txt && git reset liste.txt',
    ]);
    assert.equal(ours, real);
});
