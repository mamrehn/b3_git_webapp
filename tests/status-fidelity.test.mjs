// `git status` must look exactly like real git's in every situation a student meets
// (compared byte for byte; stdout only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, realGit } from './harness.mjs';

const base = 'mkdir r && cd r && git init -q && echo a > f && git add f && git commit -qm 1';
const CASES = {
    'modified, no upstream': `${base} && echo b > f && git status`,
    'staged + untracked': `${base} && echo b > f && git add f && echo n > n && git status`,
    'clean, no upstream': `${base} && git status`,
    'empty repository': 'mkdir r && cd r && git init -q && git status',
    'empty repository with a file': 'mkdir r && cd r && git init -q && echo a > f && git status',
    'first file staged': 'mkdir r && cd r && git init -q && echo a > f && git add f && git status',
    'detached, clean': `${base} && echo b > f && git commit -qam 2 && git switch -q --detach HEAD~1 && git status`,
    'detached, modified': `${base} && echo b > f && git commit -qam 2 && git switch -q --detach HEAD~1 && echo c > f && git status`,
    'merge conflict': `${base} && git switch -qc x && echo x > f && git commit -qam x && git switch -q main && echo m > f && git commit -qam m && git merge x; git status`,
    'merge, conflicts resolved': `${base} && git switch -qc x && echo x > f && git commit -qam x && git switch -q main && echo m > f && git commit -qam m && git merge x; echo ok > f && git add f && git status`,
    'stash pop conflict': `${base} && echo b > f && git stash -q && echo c > f && git commit -qam 2 && echo z > h && git stash pop; git status`,
    'cherry-pick conflict': `${base} && git switch -qc x && echo x > f && git commit -qam x && git switch -q main && echo m > f && git commit -qam m && git cherry-pick x; git status`,
    'revert conflict': `${base} && echo b > f && git commit -qam 2 && echo c > f && git commit -qam 3 && git revert --no-edit HEAD~1; git status`,
};

for (const [name, script] of Object.entries(CASES)) {
    test(`git status: ${name}`, async () => {
        const real = realGit(script + '; true');
        const env = await makeEnv();
        const r = await env.run(script, { tty: false });
        assert.equal(r.stdout, real);
    });
}
