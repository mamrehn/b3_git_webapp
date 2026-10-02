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
    'printf "eins\\nzwei\\ndrei\\n" > z.txt && git add . && git commit -qm start',
];

test('stash push / list / show / pop / drop', async () => {
    const { ours, real } = await compare([
        ...base,
        'git stash',
        'echo vier >> z.txt && echo neu > n.txt && git add n.txt',
        'git stash',
        'git status -s',
        'git stash list',
        'git stash show',
        'echo x > other.txt',
        'git stash pop',
        'git stash list',
        'git stash -m "zweiter Versuch"',
        'git stash list',
        'git stash drop',
        'git stash pop',
    ]);
    assert.equal(ours, real);
});

test('cherry-pick and revert, with and without conflicts', async () => {
    const { ours, real } = await compare([
        ...base,
        'git switch -q -c f && echo f1 > f1.txt && git add f1.txt && git commit -qm "f1"',
        'sed -i "2s/.*/ZWEI/" z.txt && git commit -qam "f2"',
        'git switch -q main',
        'git cherry-pick f~1',
        'git log --oneline',
        'sed -i "2s/.*/Zwei!/" z.txt && git commit -qam "main2"',
        'git cherry-pick f',
        'git status',
        'git cherry-pick --abort',
        'git status -s',
        'git revert --no-edit HEAD~1',
        'git log --oneline -2',
        'git revert --no-edit HEAD~1',
        'git cherry-pick --continue',
        'git revert --abort',
        'git log --oneline -1',
    ]);
    assert.equal(ours, real);
});

test('rebase: clean, conflict + continue, abort', async () => {
    const { ours, real } = await compare([
        ...base,
        'git switch -q -c topic && echo t1 > t1.txt && git add t1.txt && git commit -qm "t1"',
        'echo t2 > t2.txt && git add t2.txt && git commit -qm "t2"',
        'git switch -q main && echo m >> z.txt && git commit -qam "m1"',
        'git switch -q topic',
        'git rebase main',
        'git log --oneline --graph --all',
        'git switch -q main && sed -i "1s/.*/EINS/" z.txt && git commit -qam "m2"',
        'git switch -q topic && sed -i "1s/.*/Eins!/" z.txt && git commit -qam "t3"',
        'git rebase main',
        'git status',
        'printf "EINS!\\nzwei\\ndrei\\nm\\n" > z.txt && git add z.txt',
        'git rebase --continue',
        'git log --oneline',
        'git rebase HEAD~2',
        'git switch -q -c x HEAD~1 && echo y > y.txt && git add y.txt && git commit -qm y',
        'git rebase topic',
        'git reflog -n 6',
    ]);
    assert.equal(ours, real);
});

test('simulated remote: clone, push, rejected push, pull, upstream', async () => {
    const env = await makeEnv();
    const { run, world } = env;
    const git = globalThis.git;
    // a bare repo on the simulated server, filled by a teammate
    await run('mkdir -p /tmp/seed && cd /tmp/seed && git init -q && echo "# Bäckerei" > README.md && git add . && git commit -qm "Start"');
    const server = '/srv/git.sim/team/web.git';
    await world.pfs.mkdir('/srv').catch(() => {});
    await world.pfs.mkdir('/srv/git.sim').catch(() => {});
    await world.pfs.mkdir('/srv/git.sim/team').catch(() => {});
    await git.init({ fs: world.fs, gitdir: server, bare: true, defaultBranch: 'main' });
    let r = await run('cd /tmp/seed && git remote add origin https://git.sim/team/web.git && git push -u origin main');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /To https:\/\/git\.sim\/team\/web\.git\n \* \[new branch\]      main -> main/);
    assert.match(r.out, /branch 'main' set up to track 'origin\/main'\./);

    r = await run('cd ~ && git clone https://git.sim/team/web.git');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /^Cloning into 'web'\.\.\./);
    r = await run('cd ~/web && git status');
    assert.match(r.out, /Your branch is up to date with 'origin\/main'\./);

    // teammate pushes, then our push is rejected
    await run("cd /tmp/seed && echo 'Brot' > menu.txt && git add menu.txt && git commit -qm 'Menü' && git push -q");
    await run("cd ~/web && echo 'Kontakt' > kontakt.txt && git add kontakt.txt && git commit -qm 'Kontakt'");
    r = await run('git push');
    assert.equal(r.status, 1);
    assert.match(r.out, / ! \[rejected\]        main -> main \(fetch first\)/);
    assert.match(r.out, /hint: 'git pull' before pushing again\./);

    r = await run('git pull --no-edit');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /From https:\/\/git\.sim\/team\/web\n   [0-9a-f]{7}\.\.[0-9a-f]{7}  main       -> origin\/main/);
    assert.match(r.out, /Merge made by the 'ort' strategy\./);
    r = await run('git status');
    assert.match(r.out, /Your branch is ahead of 'origin\/main' by 2 commits\./);
    r = await run('git push');
    assert.equal(r.status, 0, r.out);
    r = await run('git status');
    assert.match(r.out, /up to date with 'origin\/main'/);
    r = await run('git log --oneline --graph');
    assert.match(r.out, /^\*   [0-9a-f]{7} \(HEAD -> main, origin\/main, origin\/HEAD\) Merge branch 'main' of https:\/\/git\.sim\/team\/web\n\|\\  \n\| \* [0-9a-f]{7} Menü\n\* \| [0-9a-f]{7} Kontakt\n\|\/  \n\* [0-9a-f]{7} Start\n$/);

    // new branch without upstream
    await run('git switch -q -c feature && echo x > x.txt && git add x.txt && git commit -qm x');
    r = await run('git push');
    assert.equal(r.status, 128);
    assert.match(r.out, /git push --set-upstream origin feature/);
    r = await run('git push -u origin feature');
    assert.match(r.out, / \* \[new branch\]      feature -> feature/);
    r = await run('git branch -vv');
    assert.match(r.out, /\* feature [0-9a-f]{7} \[origin\/feature\] x/);
    r = await run('git push');
    assert.equal(r.out, 'Everything up-to-date\n');
});
