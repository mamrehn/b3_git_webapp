// git branch, switch, checkout, merge, tag, reset

import { git } from '../../lib.js';
import { GitError, fatal } from '../errors.js';
import { resolve, resolveCommit, resolveRefName, unknownRevision } from '../revparse.js';
import { readReflog, renameReflog } from '../reflog.js';
import { isAncestor, mergeBase, aheadBehind } from '../status.js';
import { mergeTrees, applyMerge, findBlockers, checkoutPaths } from '../merge.js';
import { compilePathspecs, matchPathspecs } from './pathspec.js';
import { C, paint, usage, updateWorkTree, localChangeLines, trackingInfo, printDiffStat, requireIdentity, writeCommit } from './common.js';
import { editMessage, cleanupMessage } from './basic.js';
import { writeWorkFile, removeWorkFile } from '../merge.js';
import { signature } from '../clock.js';
import { getopt } from '../../shell/registry.js';
import { shortOid, firstLine } from '../../core/util.js';
import { reachableSet } from '../history.js';

const D = (de, en) => ({ de, en });

function badOpt(unknown, cmd) {
    const u = unknown[0];
    return usage(`error: unknown ${u.option.startsWith('--') ? 'option' : 'switch'} \`${u.option.replace(/^-+/, '')}'\nusage: git ${cmd} [<options>]`);
}

export function validRefName(name) {
    if (!name || name === '@' || name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
    if (name.endsWith('.lock') || name.includes('..') || name.includes('@{') || name.includes('//')) return false;
    if (/[\x00-\x20~^:?*[\\\x7f]/.test(name)) return false;
    return !name.split('/').some(part => part.startsWith('.'));
}

function invalidBranchName(name) {
    return new GitError(`fatal: '${name}' is not a valid branch name\nhint: See 'git help check-ref-format'\nhint: Disable this message with "git config set advice.refSyntax false"`, { status: 128, kind: 'invalid-branch-name' });
}

async function subjectOf(repo, oid) {
    return firstLine((await repo.readCommit(oid)).message);
}

// ---- branch ---------------------------------------------------------------------------------

async function branch(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['a', 'all', 'r', 'remotes', 'v', 'vv', 'verbose', 'd', 'D', 'delete', 'f', 'force', 'm', 'M', 'move', 'l', 'list', 'show-current', 'unset-upstream', 'merged', 'no-merged', 'q', 'quiet', 'c', 'copy'],
        value: ['u', 'set-upstream-to', 'contains'],
        alias: { all: 'a', remotes: 'r', delete: 'd', force: 'f', move: 'm', list: 'l', 'set-upstream-to': 'u', quiet: 'q', copy: 'c' },
    });
    if (unknown.length) throw badOpt(unknown, 'branch');
    const repo = g.repo;
    const head = await repo.head();
    // -v, -vv, -v -v and --verbose all count
    let verbose = 0;
    for (const a of g.args) {
        if (a === '--verbose') verbose++;
        else if (/^-[A-Za-z]+$/.test(a)) verbose += (a.match(/v/g) || []).length;
    }

    if (opts['show-current']) {
        if (head.branch) g.out(head.branch + '\n');
        return 0;
    }
    if (opts['unset-upstream']) {
        const b = rest[0] || head.branch;
        const cfg = repo.repoConfig();
        if (!(await repo.upstreamOf(b))) throw fatal(`branch '${b}' has no upstream information`);
        await cfg.set(`branch.${b}.remote`, undefined);
        await cfg.set(`branch.${b}.merge`, undefined);
        return 0;
    }
    if (opts.u) {
        const b = rest[0] || head.branch;
        const up = opts.u;
        const r = await resolveRefName(repo, up);
        if (!r || !r.ref.startsWith('refs/remotes/') && !r.ref.startsWith('refs/heads/')) throw fatal(`the requested upstream branch '${up}' does not exist`);
        if (r.ref.startsWith('refs/remotes/')) {
            const parts = r.ref.replace('refs/remotes/', '').split('/');
            await repo.setUpstream(b, parts[0], parts.slice(1).join('/'));
            g.out(`branch '${b}' set up to track '${up}'.\n`);
        } else {
            await repo.setUpstream(b, '.', up);
            g.out(`branch '${b}' set up to track local branch '${up}'.\n`);
        }
        return 0;
    }
    if (opts.d || opts.D) {
        if (!rest.length) throw fatal('branch name required');
        let status = 0;
        for (const name of rest) {
            const oid = await repo.readRef(`refs/heads/${name}`);
            if (!oid) {
                g.err(`error: branch '${name}' not found\n`);
                status = 1;
                continue;
            }
            if (name === head.branch) {
                g.err(`error: cannot delete branch '${name}' used by worktree at '${repo.dir}'\n`);
                status = 1;
                continue;
            }
            if (opts.d && !opts.f && !opts.D) {
                const up = await repo.upstreamOf(name);
                const upOid = up ? await repo.readRef(up.ref) : null;
                const merged = (head.oid && await isAncestor(repo, oid, head.oid)) || (upOid && await isAncestor(repo, oid, upOid));
                if (!merged) {
                    g.err(`error: the branch '${name}' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D ${name}'\nhint: Disable this message with "git config set advice.forceDeleteBranch false"\n`);
                    g.info.notMerged = name;
                    status = 1;
                    continue;
                }
            }
            await git.deleteBranch({ fs: repo.fs, gitdir: repo.gitdir, ref: name });
            const cfg = repo.repoConfig();
            await cfg.removeSection(`branch.${name}`);
            g.out(`Deleted branch ${name} (was ${shortOid(oid)}).\n`);
            (g.info.deleted ||= []).push(name);
        }
        return status;
    }
    if (opts.m || opts.M || opts.c) {
        if (!rest.length) throw fatal('branch name required');
        const [from, to] = rest.length === 1 ? [head.branch, rest[0]] : rest;
        if (!from) throw fatal('cannot rename the current branch while not on any');
        if (!validRefName(to)) throw invalidBranchName(to);
        const oid = await repo.readRef(`refs/heads/${from}`);
        if (!oid && !(from === head.branch && head.unborn)) throw fatal(`no branch named '${from}'`);
        if (await repo.readRef(`refs/heads/${to}`) && !opts.M && from !== to) throw fatal(`a branch named '${to}' already exists`);
        if (head.unborn && from === head.branch) {
            await repo.setHeadToBranch(to);
            return 0;
        }
        await repo.writeRef(`refs/heads/${to}`, oid);
        if (!opts.c) {
            if (from !== to) await repo.deleteRef(`refs/heads/${from}`);
            await renameReflog(repo, from, to);
            const cfg = repo.repoConfig();
            await cfg.renameSection(`branch.${from}`, `branch.${to}`);
            if (head.branch === from) await repo.setHeadToBranch(to);
        }
        g.reflogMessage = `Branch: renamed refs/heads/${from} to refs/heads/${to}`;
        g.reflogHandled = true;
        g.info.renamed = { from, to };
        return 0;
    }
    // create
    if (rest.length && !opts.l && !opts.a && !opts.r && !verbose && !opts.merged && !opts['no-merged'] && !opts.contains) {
        const [name, start] = rest;
        if (!validRefName(name)) throw invalidBranchName(name);
        if (await repo.readRef(`refs/heads/${name}`) && !opts.f) throw fatal(`a branch named '${name}' already exists`);
        const startSpec = start || 'HEAD';
        const oid = await resolveCommit(repo, startSpec);
        if (!oid) throw fatal(`not a valid object name: '${start || head.branch || 'HEAD'}'`, { kind: 'invalid-start' });
        await repo.writeRef(`refs/heads/${name}`, oid);
        if (start) {
            const r = await resolveRefName(repo, start);
            if (r?.ref.startsWith('refs/remotes/')) {
                const parts = r.ref.replace('refs/remotes/', '').split('/');
                await repo.setUpstream(name, parts[0], parts.slice(1).join('/'));
                g.out(`branch '${name}' set up to track '${start}'.\n`);
            }
        }
        g.reflogCreated = `branch: Created from ${startSpec}`;
        g.info.created = { name, oid };
        return 0;
    }
    // list
    const color = g.color;
    const lines = [];
    const showLocal = !opts.r;
    const showRemote = opts.r || opts.a;
    let filter = null;
    if (rest.length) {
        const re = new RegExp('^' + rest[0].replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        filter = n => re.test(n);
    }
    const mergedTarget = opts.merged ? (typeof opts.merged === 'string' ? await resolveCommit(repo, opts.merged) : head.oid) : null;
    const containsOid = opts.contains ? await resolveCommit(repo, opts.contains) : null;
    const branches = await repo.branches();
    const nameWidth = Math.max(...branches.map(b => b.name.length), head.detached ? 0 : 0, 1);
    const fmtVerbose = async (name, oid, isRemote = false) => {
        let extra = '';
        if (verbose && !isRemote) {
            const up = await repo.upstreamOf(name);
            if (up && verbose >= 1) {
                const upOid = await repo.readRef(up.ref);
                let track = '';
                if (!upOid) track = ': gone';
                else {
                    const { ahead, behind } = await aheadBehind(repo, oid, upOid);
                    const parts = [];
                    if (ahead) parts.push(`ahead ${ahead}`);
                    if (behind) parts.push(`behind ${behind}`);
                    if (parts.length) track = `: ${parts.join(', ')}`;
                }
                if (verbose >= 2) extra = `[${paint(g, '\x1b[34m', up.display)}${track}] `;
                else if (track) extra = `[${track.slice(2)}] `;
            }
        }
        return `${paint(g, C.yellow, shortOid(oid))} ${extra}${await subjectOf(repo, oid)}`;
    };
    if (showLocal) {
        if (head.detached && head.oid) {
            const label = `(HEAD detached at ${shortOid(head.oid)})`;
            const { detachedLabel } = await import('./basic.js');
            const text = `(${await detachedLabel(repo, head.oid)})`;
            lines.push(`* ${paint(g, C.green, text || label)}${verbose ? ' ' + await fmtVerbose('HEAD', head.oid) : ''}`);
        }
        for (const b of branches) {
            if (filter && !filter(b.name)) continue;
            if (mergedTarget && !(await isAncestor(repo, b.oid, mergedTarget))) continue;
            if (opts['no-merged'] && head.oid && await isAncestor(repo, b.oid, head.oid)) continue;
            if (containsOid && !(await isAncestor(repo, containsOid, b.oid))) continue;
            const current = b.name === head.branch;
            const name = verbose ? b.name.padEnd(nameWidth) : b.name;
            const shown = current ? paint(g, C.green, name) : name;
            lines.push(`${current ? '* ' : '  '}${shown}${verbose ? ' ' + await fmtVerbose(b.name, b.oid) : ''}`);
        }
    }
    if (showRemote) {
        for (const { name: remote } of await repo.remotes()) {
            const target = await repo.remoteHead(remote);
            const prefix = opts.a ? 'remotes/' : '';
            if (target) lines.push(`  ${paint(g, C.red, `${prefix}${remote}/HEAD`)} -> ${remote}/${target}`);
        }
        for (const r of await repo.remoteBranches()) {
            if (filter && !filter(r.name)) continue;
            const prefix = opts.a ? 'remotes/' : '';
            lines.push(`  ${paint(g, C.red, prefix + r.name)}${verbose ? ' ' + await fmtVerbose(r.name, r.oid, true) : ''}`);
        }
    }
    if (lines.length) g.out(lines.join('\n') + '\n');
    g.info.list = true;
    return 0;
}

// ---- switching ----------------------------------------------------------------------------------

async function previousBranch(repo) {
    for (const e of await readReflog(repo, 'HEAD')) {
        const m = e.message.match(/^checkout: moving from (.+) to .+$/);
        if (m) return m[1];
    }
    return null;
}

// Commits that would become unreachable when HEAD leaves a detached commit
async function orphanedCommits(repo, headOid, targetOid) {
    const tips = [targetOid];
    for (const b of await repo.branches()) tips.push(b.oid);
    for (const r of await repo.remoteBranches()) tips.push(r.oid);
    for (const t of await repo.tags()) tips.push(t.commit);
    const reachable = await reachableSet(repo, tips.filter(Boolean));
    const out = [];
    let cur = headOid;
    while (cur && !reachable.has(cur) && out.length < 50) {
        const c = await repo.readCommit(cur).catch(() => null);
        if (!c) break;
        out.push(c);
        cur = c.parents[0];
    }
    return out;
}

async function doSwitch(g, { branch: branchName, oid, create = false, detach = false, force = false, label, track = null, startSpec = 'HEAD', quiet = false }) {
    const repo = g.repo;
    const head = await repo.head();
    const targetOid = oid;
    if (!create && !detach && head.branch === branchName) {
        g.err(`Already on '${branchName}'\n`);
        const tr = await trackingInfo(repo, branchName);
        if (tr) g.out(tr.text);
        g.info.alreadyOn = branchName;
        return 0;
    }
    if (head.detached && head.oid && targetOid !== head.oid) {
        const orphans = await orphanedCommits(repo, head.oid, targetOid);
        if (orphans.length) {
            const list = orphans.slice(0, 4).map(c => `  ${shortOid(c.oid)} ${firstLine(c.message)}`).join('\n') + (orphans.length > 4 ? `\n ... and ${orphans.length - 4} more.` : '');
            g.err(`Warning: you are leaving ${orphans.length} commit${orphans.length === 1 ? '' : 's'} behind, not connected to\nany of your branches:\n\n${list}\n\n` +
                `If you want to keep ${orphans.length === 1 ? 'it' : 'them'} by creating a new branch, this may be a good time\nto do so with:\n\n git branch <new-branch-name> ${shortOid(orphans[0].oid)}\n\n`);
            g.info.orphaned = orphans.map(c => c.oid);
        } else {
            g.err(`Previous HEAD position was ${shortOid(head.oid)} ${await subjectOf(repo, head.oid)}\n`);
        }
    }
    if (targetOid && targetOid !== head.oid) await updateWorkTree(repo, targetOid, { force });
    const fromName = head.branch || (head.oid ? shortOid(head.oid) : 'HEAD');
    if (create) {
        await repo.writeRef(`refs/heads/${branchName}`, targetOid);
        g.reflogCreated = `branch: Created from ${startSpec}`;
        if (track) await repo.setUpstream(branchName, track.remote, track.branch);
    }
    if (detach) await repo.setHeadDetached(targetOid);
    else await repo.setHeadToBranch(branchName);
    repo.invalidate();
    g.reflogMessage = `checkout: moving from ${fromName} to ${label || branchName}`;
    // local changes that were carried over
    const carried = quiet ? [] : await localChangeLines(repo);
    if (carried.length) g.out(carried.join('\n') + '\n');
    if (track && !quiet) g.out(`branch '${branchName}' set up to track '${track.remote}/${track.branch}'.\n`);
    if (detach) return 0;
    if (!quiet) {
        g.err(create ? `Switched to a new branch '${branchName}'\n` : `Switched to branch '${branchName}'\n`);
        const tr = await trackingInfo(repo, branchName);
        if (tr) g.out(tr.text);
    }
    g.info.switched = { from: fromName, to: branchName, created: create };
    return 0;
}

const DETACHED_ADVICE = (name) => `Note: switching to '${name}'.

You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -

Turn off this advice by setting config variable advice.detachedHead to false

`;

async function detachTo(g, spec, oid, { advice = true, quiet = false } = {}) {
    const repo = g.repo;
    const head = await repo.head();
    const res = await doSwitch(g, { oid, detach: true, label: spec });
    if (advice && !head.detached && !quiet) g.err(DETACHED_ADVICE(spec));
    if (!quiet) g.err(`HEAD is now at ${shortOid(oid)} ${await subjectOf(repo, oid)}\n`);
    g.info.detached = { at: oid, spec };
    return res;
}

async function remoteDwim(repo, name) {
    const hits = (await repo.remoteBranches()).filter(r => r.branch === name);
    return hits.length === 1 ? hits[0] : null;
}

async function switchCmd(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['d', 'detach', 'f', 'force', 'discard-changes', 'q', 'quiet', 't', 'track', 'no-track', 'guess', 'no-guess', 'orphan'],
        value: ['c', 'create', 'C', 'force-create'],
        alias: { create: 'c', 'force-create': 'C', detach: 'd', force: 'f', quiet: 'q', track: 't', 'discard-changes': 'f' },
    });
    if (unknown.length) throw badOpt(unknown, 'switch');
    const repo = g.repo;
    const head = await repo.head();
    await assertNoOperationBlocking(repo);
    const newName = opts.c || opts.C;
    if (newName) {
        if (!validRefName(newName)) throw invalidBranchName(newName);
        if (await repo.readRef(`refs/heads/${newName}`) && !opts.C) throw fatal(`a branch named '${newName}' already exists`);
        const startSpec = rest[0] || 'HEAD';
        const oid = rest[0] ? await resolveCommit(repo, rest[0]) : head.oid;
        if (rest[0] && !oid) throw fatal(`invalid reference: ${rest[0]}`);
        if (!oid) {
            // unborn: just point HEAD at the new name
            await repo.setHeadToBranch(newName);
            if (!opts.q) g.err(`Switched to a new branch '${newName}'\n`);
            return 0;
        }
        let track = null;
        if (rest[0] && !opts['no-track']) {
            const r = await resolveRefName(repo, rest[0]);
            if (r?.ref.startsWith('refs/remotes/')) {
                const parts = r.ref.replace('refs/remotes/', '').split('/');
                track = { remote: parts[0], branch: parts.slice(1).join('/') };
            }
        }
        return doSwitch(g, { branch: newName, oid, create: true, force: Boolean(opts.f), track, startSpec, quiet: Boolean(opts.q) });
    }
    if (!rest.length) throw fatal('missing branch or commit argument');
    let target = rest[0];
    if (target === '-') {
        const prev = await previousBranch(repo);
        if (!prev) throw fatal('invalid reference: @{-1}');
        target = prev;
    }
    if (opts.d) {
        const oid = await resolveCommit(repo, target);
        if (!oid) throw fatal(`invalid reference: ${target}`);
        return detachTo(g, target, oid, { advice: false, quiet: Boolean(opts.q || opts.quiet) });
    }
    const local = await repo.readRef(`refs/heads/${target}`);
    if (local) return doSwitch(g, { branch: target, oid: local, force: Boolean(opts.f), quiet: Boolean(opts.q) });
    const remote = !opts['no-guess'] ? await remoteDwim(repo, target) : null;
    if (remote) return doSwitch(g, { branch: target, oid: remote.oid, create: true, force: Boolean(opts.f), track: { remote: remote.remote, branch: remote.branch }, startSpec: remote.name, quiet: Boolean(opts.q) });
    const r = await resolveRefName(repo, target);
    const oid = await resolveCommit(repo, target);
    if (oid) {
        const kind = r?.ref.startsWith('refs/tags/') ? 'tag' : r?.ref.startsWith('refs/remotes/') ? 'remote branch' : 'commit';
        throw new GitError(`fatal: a branch is expected, got ${kind} '${target}'\nhint: If you want to detach HEAD at the commit, try again with the --detach option.`, { status: 128, kind: 'branch-expected', data: { target, kind } });
    }
    throw fatal(`invalid reference: ${target}`, { kind: 'invalid-reference', data: { target } });
}

async function assertNoOperationBlocking(repo) {
    const conflicts = await repo.conflicts();
    if (Object.keys(conflicts).length) {
        throw new GitError(`error: you need to resolve your current index first\n${Object.keys(conflicts).map(p => `${p}: needs merge`).join('\n')}`, { status: 1, kind: 'unresolved-conflicts' });
    }
}

async function checkout(g) {
    const args = [...g.args];
    const dd = args.indexOf('--');
    const before = dd === -1 ? args : args.slice(0, dd);
    const after = dd === -1 ? [] : args.slice(dd + 1);
    const { opts, rest, unknown } = getopt(before, {
        bool: ['f', 'force', 'q', 'quiet', 'detach', 'ours', 'theirs', 't', 'track', 'm', 'merge', 'p', 'patch'],
        value: ['b', 'B'],
        alias: { force: 'f', quiet: 'q', track: 't', merge: 'm', patch: 'p' },
    });
    if (unknown.length) throw badOpt(unknown, 'checkout');
    const repo = g.repo;
    const head = await repo.head();

    // file mode: checkout [<tree-ish>] -- <paths>  |  checkout --ours/--theirs <paths>
    // git only reports "Updated N paths" when no explicit `--` was given
    const restoreFiles = async (sourceSpec, paths, { report = true } = {}) => {
        const compiled = compilePathspecs(repo, paths);
        const conflicts = await repo.conflicts();
        let source;
        let label = 'the index';
        if (sourceSpec) {
            const oid = await resolveCommit(repo, sourceSpec);
            if (!oid) throw new GitError(unknownRevision(sourceSpec), { status: 128 });
            source = await repo.flatTree((await repo.readCommit(oid)).tree);
            label = shortOid(oid);
        } else {
            source = await repo.indexFlat();
            for (const [p, c] of Object.entries(conflicts)) {
                const oid = opts.ours ? c.ours : opts.theirs ? c.theirs : null;
                if (oid) source.set(p, { oid, mode: '100644' });
            }
        }
        const { matched, unmatched } = matchPathspecs(compiled, [...source.keys(), ...Object.keys(conflicts)]);
        if (unmatched.length) {
            for (const s of unmatched) g.err(`error: pathspec '${s}' did not match any file(s) known to git\n`);
            return 1;
        }
        let count = 0;
        for (const path of [...matched].sort()) {
            if (conflicts[path] && !sourceSpec && !opts.ours && !opts.theirs) {
                g.err(`error: path '${path}' is unmerged\n`);
                return 1;
            }
            const entry = source.get(path);
            if (!entry) continue;
            await writeWorkFile(repo, path, await repo.readBlob(entry.oid), entry.mode);
            if (sourceSpec) await git.add({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
            count++;
        }
        repo.invalidate();
        if (report && !opts.q) g.err(`Updated ${count} path${count === 1 ? '' : 's'} from ${label}\n`);
        g.info.restoredFiles = [...matched];
        return 0;
    };

    if (after.length) return restoreFiles(rest[0] || null, after, { report: false });
    if (opts.ours || opts.theirs) return restoreFiles(null, rest);

    const newName = opts.b || opts.B;
    if (newName) {
        await assertNoOperationBlocking(repo);
        if (!validRefName(newName)) throw invalidBranchName(newName);
        if (await repo.readRef(`refs/heads/${newName}`) && !opts.B) throw fatal(`a branch named '${newName}' already exists`);
        const startSpec = rest[0] || 'HEAD';
        const oid = rest[0] ? await resolveCommit(repo, rest[0]) : head.oid;
        if (rest[0] && !oid) throw fatal(`'${rest[0]}' is not a commit and a branch '${newName}' cannot be created from it`);
        if (!oid) {
            await repo.setHeadToBranch(newName);
            if (!opts.q) g.err(`Switched to a new branch '${newName}'\n`);
            return 0;
        }
        let track = null;
        const r = rest[0] ? await resolveRefName(repo, rest[0]) : null;
        if (r?.ref.startsWith('refs/remotes/')) {
            const parts = r.ref.replace('refs/remotes/', '').split('/');
            track = { remote: parts[0], branch: parts.slice(1).join('/') };
        }
        return doSwitch(g, { branch: newName, oid, create: true, force: Boolean(opts.f), track, startSpec, quiet: Boolean(opts.q) });
    }
    if (!rest.length) {
        // `git checkout` alone just reports tracking info
        if (head.branch) {
            const tr = await trackingInfo(repo, head.branch);
            if (tr) g.out(tr.text);
        }
        return 0;
    }
    let target = rest[0];
    if (target === '-') {
        const prev = await previousBranch(repo);
        if (!prev) throw fatal('invalid reference: @{-1}');
        target = prev;
    }
    const local = await repo.readRef(`refs/heads/${target}`);
    if (local && !opts.detach) {
        await assertNoOperationBlocking(repo);
        return doSwitch(g, { branch: target, oid: local, force: Boolean(opts.f), quiet: Boolean(opts.q) });
    }
    const oid = await resolveCommit(repo, target);
    if (oid && (opts.detach || !(await remoteDwim(repo, target)))) {
        await assertNoOperationBlocking(repo);
        return detachTo(g, target, oid, { quiet: Boolean(opts.q || opts.quiet) });
    }
    const remote = await remoteDwim(repo, target);
    if (remote) {
        await assertNoOperationBlocking(repo);
        return doSwitch(g, { branch: target, oid: remote.oid, create: true, force: Boolean(opts.f), track: { remote: remote.remote, branch: remote.branch }, startSpec: remote.name, quiet: Boolean(opts.q) });
    }
    // maybe it is a path
    return restoreFiles(null, rest);
}

// ---- merge ---------------------------------------------------------------------------------------

async function mergeLabelFor(repo, spec) {
    const r = await resolveRefName(repo, spec);
    if (r?.ref.startsWith('refs/heads/')) return `branch '${spec}'`;
    if (r?.ref.startsWith('refs/remotes/')) return `remote-tracking branch '${spec}'`;
    if (r?.ref.startsWith('refs/tags/')) return `tag '${spec}'`;
    return `commit '${spec}'`;
}

export async function runMerge(g, { theirSpec, theirOid, noFf = false, ffOnly = false, message = null, edit = null, squash = false, reflogPrefix = null, quiet = false }) {
    const repo = g.repo;
    const head = await repo.head();
    const ours = head.oid;
    reflogPrefix ||= `merge ${theirSpec}`;
    if (!ours) {
        // merging into an unborn branch: just take theirs
        await updateWorkTree(repo, theirOid, { action: 'merge' });
        await repo.writeRef(head.ref, theirOid);
        g.reflogMessage = `${reflogPrefix}: Fast-forward`;
        return 0;
    }
    const base = await mergeBase(repo, ours, theirOid);
    if (base === theirOid || ours === theirOid) {
        g.out('Already up to date.\n');
        g.info.merge = { result: 'up-to-date' };
        return 0;
    }
    if (base === ours && !noFf && !squash) {
        if (!quiet) g.out(`Updating ${shortOid(ours)}..${shortOid(theirOid)}\n`);
        await updateWorkTree(repo, theirOid, { action: 'merge' });
        await repo.writeSpecial('ORIG_HEAD', ours);
        await repo.moveHead(theirOid);
        repo.invalidate();
        if (!quiet) {
            g.out('Fast-forward\n');
            await printDiffStat(g, repo, (await repo.readCommit(ours)).tree, (await repo.readCommit(theirOid)).tree);
        }
        g.reflogMessage = `${reflogPrefix}: Fast-forward`;
        g.info.merge = { result: 'fast-forward', from: ours, to: theirOid };
        return 0;
    }
    if (ffOnly) {
        throw new GitError('hint: Diverging branches can\'t be fast-forwarded, you need to either:\nhint:\nhint: \tgit merge --no-ff\nhint:\nhint: or:\nhint:\nhint: \tgit rebase\nhint:\nhint: Disable this message with "git config set advice.diverging false"\nfatal: Not possible to fast-forward, aborting.', { status: 128, kind: 'not-fast-forward' });
    }
    const identity = await requireIdentity(repo);
    const baseFlat = base ? await repo.flatTree((await repo.readCommit(base)).tree) : new Map();
    const oursFlat = await repo.flatTree((await repo.readCommit(ours)).tree);
    const theirsFlat = await repo.flatTree((await repo.readCommit(theirOid)).tree);
    const merged = await mergeTrees(repo, { base: baseFlat, ours: oursFlat, theirs: theirsFlat, labels: { ours: 'HEAD', theirs: theirSpec } });
    const blockers = await findBlockers(repo, merged.touched, oursFlat);
    if (blockers.local.length) {
        throw new GitError(`error: Your local changes to the following files would be overwritten by merge:\n${blockers.local.map(p => `\t${p}`).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`, { status: 1, kind: 'local-changes', data: { files: blockers.local } });
    }
    if (blockers.untracked.length) {
        throw new GitError(`error: The following untracked working tree files would be overwritten by merge:\n${blockers.untracked.map(p => `\t${p}`).join('\n')}\nPlease move or remove them before you merge.\nAborting`, { status: 1, kind: 'untracked-overwrite', data: { files: blockers.untracked } });
    }
    await repo.writeSpecial('ORIG_HEAD', ours);
    await applyMerge(repo, merged);
    // messages, in path order like git
    const bothChanged = merged.touched.filter(p => baseFlat.get(p)?.oid !== oursFlat.get(p)?.oid && oursFlat.has(p) && theirsFlat.has(p));
    const lines = [];
    for (const p of merged.touched) {
        const c = merged.conflicts.find(x => x.path === p);
        if (bothChanged.includes(p) && (!c || c.kind === 'content' || c.kind === 'add/add')) lines.push(`Auto-merging ${p}`);
        if (!c) continue;
        if (c.kind === 'content' || c.kind === 'binary') lines.push(`CONFLICT (content): Merge conflict in ${p}`);
        else if (c.kind === 'add/add') lines.push(`CONFLICT (add/add): Merge conflict in ${p}`);
        else if (c.kind === 'modify/delete') lines.push(`CONFLICT (modify/delete): ${p} deleted in HEAD and modified in ${theirSpec}.  Version ${theirSpec} of ${p} left in tree.`);
        else if (c.kind === 'delete/modify') lines.push(`CONFLICT (modify/delete): ${p} deleted in ${theirSpec} and modified in HEAD.  Version HEAD of ${p} left in tree.`);
    }
    if (lines.length && !quiet) g.out(lines.join('\n') + '\n');
    const into = head.branch && !['main', 'master'].includes(head.branch) ? ` into ${head.branch}` : '';
    const defaultMsg = `Merge ${await mergeLabelFor(repo, theirSpec)}${into}`;
    if (squash) {
        await repo.writeGitFile('SQUASH_MSG', `Squashed commit of the following:\n`);
        g.out(merged.conflicts.length ? 'Squash commit -- not updating HEAD\nAutomatic merge failed; fix conflicts and then commit the result.\n' : 'Squash commit -- not updating HEAD\nAutomatic merge went well; stopped before committing as requested\n');
        return merged.conflicts.length ? 1 : 0;
    }
    if (merged.conflicts.length) {
        await repo.writeSpecial('MERGE_HEAD', theirOid);
        await repo.writeGitFile('MERGE_MSG', `${message || defaultMsg}\n\n# Conflicts:\n${merged.conflicts.map(c => `#\t${c.path}`).join('\n')}\n`);
        await repo.writeGitFile('MERGE_MODE', noFf ? 'no-ff' : '');
        await repo.writeGitFile('WERKSTATT_MERGE.json', JSON.stringify({ touched: merged.touched }));
        g.out('Automatic merge failed; fix conflicts and then commit the result.\n');
        g.reflogMessage = null;
        g.info.merge = { result: 'conflict', conflicts: merged.conflicts.map(c => ({ path: c.path, kind: c.kind })), theirs: theirSpec };
        return 1;
    }
    // clean merge → commit
    let msg = message || defaultMsg;
    const wantEditor = edit === true || (edit === null && !message && g.ctx.isTTY && g.ui?.edit && !g.ctx.inPipe);
    if (wantEditor) {
        const template = `${msg}\n# Please enter a commit message to explain why this merge is necessary,\n# especially if it merges an updated upstream into a topic branch.\n#\n# Lines starting with '#' will be ignored, and an empty message aborts\n# the commit.\n`;
        const text = await editMessage(g, repo, template, { kind: 'merge' });
        const cleaned = text === null ? msg + '\n' : cleanupMessage(text, { stripComments: true });
        if (!cleaned) {
            await repo.writeSpecial('MERGE_HEAD', theirOid);
            await repo.writeGitFile('MERGE_MSG', msg + '\n');
            await repo.writeGitFile('WERKSTATT_MERGE.json', JSON.stringify({ touched: merged.touched }));
            g.err("Not committing merge; use 'git commit' to complete the merge.\n");
            g.info.merge = { result: 'stopped' };
            return 1;
        }
        msg = cleaned.replace(/\n$/, '');
    }
    const tree = await repo.writeFlatTree(merged.result);
    const sig = signature(identity);
    const oid = await writeCommit(repo, { tree, parents: [ours, theirOid], message: msg.endsWith('\n') ? msg : msg + '\n', author: sig, committer: sig });
    await repo.moveHead(oid);
    repo.invalidate();
    if (!quiet) {
        g.out("Merge made by the 'ort' strategy.\n");
        await printDiffStat(g, repo, (await repo.readCommit(ours)).tree, tree);
    }
    g.reflogMessage = `${reflogPrefix}: Merge made by the 'ort' strategy.`;
    g.info.merge = { result: 'merge-commit', oid, theirs: theirSpec };
    return 0;
}

async function abortMerge(g) {
    const repo = g.repo;
    const mergeHead = await repo.readSpecial('MERGE_HEAD');
    if (!mergeHead) throw fatal('There is no merge to abort (MERGE_HEAD missing).', { kind: 'no-merge' });
    const head = await repo.head();
    const headFlat = await repo.flatTree((await repo.readCommit(head.oid)).tree);
    let touched = [];
    try {
        touched = JSON.parse((await repo.readGitFile('WERKSTATT_MERGE.json')) || '{}').touched || [];
    } catch { /* ignore */ }
    const conflicts = Object.keys(await repo.conflicts());
    const paths = [...new Set([...touched, ...conflicts])];
    await checkoutPaths(repo, headFlat, paths);
    for (const f of ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE', 'WERKSTATT_MERGE.json']) await repo.removeGitFile(f);
    await repo.setConflicts({});
    g.info.mergeAborted = true;
    return 0;
}

async function merge(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['no-ff', 'ff', 'ff-only', 'squash', 'no-edit', 'edit', 'e', 'abort', 'continue', 'q', 'quiet', 'no-commit', 'allow-unrelated-histories', 'stat', 'no-stat', 'v', 'verbose'],
        value: ['m', 'message', 's', 'strategy', 'X'],
        alias: { message: 'm', quiet: 'q', e: 'edit' },
    });
    if (unknown.length) throw badOpt(unknown, 'merge');
    const repo = g.repo;
    if (opts.abort) return abortMerge(g);
    const op = await repo.operation();
    if (opts.continue) {
        if (op?.kind !== 'merge') throw fatal('There is no merge in progress (MERGE_HEAD missing).');
        const { gitSpec } = await import('../gitcmd.js');
        return gitSpec('commit').run({ ...g, args: ['--no-edit'] });
    }
    if (op?.kind === 'merge') {
        if (Object.keys(await repo.conflicts()).length) {
            throw new GitError("error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.", { status: 128, kind: 'unresolved-conflicts' });
        }
        throw new GitError('fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.', { status: 128, kind: 'merge-in-progress' });
    }
    if (op) throw fatal(`You are in the middle of a ${op.kind}. Finish it first.`, { kind: 'operation-in-progress' });
    if (!rest.length) {
        const head = await repo.head();
        const up = head.branch ? await repo.upstreamOf(head.branch) : null;
        if (!up) throw fatal('No remote for the current branch.', { kind: 'no-merge-target' });
        rest.push(up.display);
    }
    const spec = rest[0];
    const theirOid = await resolveCommit(repo, spec);
    if (!theirOid) {
        g.err(`merge: ${spec} - not something we can merge\n`);
        g.info.notMergeable = spec;
        return 1;
    }
    const headOid = (await repo.head()).oid;
    if (headOid && !opts['allow-unrelated-histories'] && !(await mergeBase(repo, headOid, theirOid))) {
        throw fatal('refusing to merge unrelated histories', { kind: 'unrelated-histories' });
    }
    return runMerge(g, {
        theirSpec: spec,
        theirOid,
        noFf: Boolean(opts['no-ff']),
        ffOnly: Boolean(opts['ff-only']),
        message: opts.m || null,
        edit: opts['no-edit'] ? false : opts.edit ? true : null,
        squash: Boolean(opts.squash),
        quiet: Boolean(opts.q),
    });
}

// ---- tag -------------------------------------------------------------------------------------------

async function tag(g) {
    // -n takes an optional, attached number: -n or -n5
    const args = g.args.map(a => (a === '-n' ? '--lines=1' : /^-n\d+$/.test(a) ? `--lines=${a.slice(2)}` : a));
    const { opts, rest, unknown } = getopt(args, {
        bool: ['a', 'annotate', 'd', 'delete', 'l', 'list', 'f', 'force'],
        value: ['m', 'message', 'lines'],
        alias: { annotate: 'a', delete: 'd', list: 'l', force: 'f', message: 'm', lines: 'n' },
    });
    if (unknown.length) throw badOpt(unknown, 'tag');
    const repo = g.repo;
    if (opts.d) {
        let status = 0;
        for (const name of rest) {
            const oid = await repo.readRef(`refs/tags/${name}`);
            if (!oid) { g.err(`error: tag '${name}' not found.\n`); status = 1; continue; }
            await git.deleteTag({ fs: repo.fs, gitdir: repo.gitdir, ref: name });
            g.out(`Deleted tag '${name}' (was ${shortOid(oid)})\n`);
        }
        return status;
    }
    const listing = opts.l || !rest.length || opts.n !== undefined && !rest.length;
    if (listing) {
        let tags = await repo.tags();
        if (rest[0]) {
            const re = new RegExp('^' + rest[0].replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
            tags = tags.filter(t => re.test(t.name));
        }
        const lines = [];
        for (const t of tags) {
            if (opts.n !== undefined) {
                const text = t.annotated ? t.annotated.message : (await repo.readCommit(t.commit)).message;
                lines.push(`${t.name.padEnd(15)} ${firstLine(text)}`);
            } else lines.push(t.name);
        }
        if (lines.length) g.out(lines.join('\n') + '\n');
        return 0;
    }
    const [name, target = 'HEAD'] = rest;
    if (!validRefName(name)) throw fatal(`'${name}' is not a valid tag name.`);
    if (await repo.readRef(`refs/tags/${name}`) && !opts.f) throw fatal(`tag '${name}' already exists`, { kind: 'tag-exists' });
    const oid = await resolveCommit(repo, target);
    if (!oid) throw fatal(`Failed to resolve '${target}' as a valid ref.`);
    if (opts.a || opts.m) {
        let message = opts.m;
        if (!message) {
            const text = await editMessage(g, repo, `\n#\n# Write a message for tag:\n#   ${name}\n# Lines starting with '#' will be ignored.\n`, { kind: 'tag' });
            message = text === null ? '' : cleanupMessage(text, { stripComments: true }).replace(/\n$/, '');
            if (!message) throw fatal('no tag message?');
        }
        const identity = await requireIdentity(repo);
        await git.annotatedTag({ fs: repo.fs, gitdir: repo.gitdir, ref: name, object: oid, message: message + '\n', tagger: signature(identity), force: Boolean(opts.f) });
    } else {
        await git.tag({ fs: repo.fs, gitdir: repo.gitdir, ref: name, object: oid, force: Boolean(opts.f) });
    }
    g.info.tag = { name, oid, annotated: Boolean(opts.a || opts.m) };
    return 0;
}

// ---- reset ------------------------------------------------------------------------------------------

async function unstagedLines(repo) {
    const { computeStatus } = await import('../status.js');
    const st = await computeStatus(repo);
    return st.unstaged.map(u => `${u.kind === 'deleted' ? 'D' : 'M'}\t${repo.displayPath(u.path)}`);
}

async function resetIndexTo(repo, flat, onlyPaths = null) {
    const index = await repo.indexFlat();
    const paths = onlyPaths || [...new Set([...index.keys(), ...flat.keys()])];
    for (const p of paths) {
        const e = flat.get(p);
        const cur = index.get(p);
        if (e) {
            if (!cur || cur.oid !== e.oid || cur.mode !== e.mode) {
                await git.updateIndex({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: p, oid: e.oid, mode: parseInt(e.mode, 8), add: true, cache: repo.cache });
            }
        } else if (cur) {
            await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: p, cache: repo.cache });
        }
    }
    repo.invalidate();
}

async function clearOperationState(repo) {
    for (const f of ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'WERKSTATT_MERGE.json', 'SQUASH_MSG']) await repo.removeGitFile(f);
    await repo.setConflicts({});
}

async function reset(g) {
    const args = [...g.args];
    const dd = args.indexOf('--');
    const before = dd === -1 ? args : args.slice(0, dd);
    const afterPaths = dd === -1 ? [] : args.slice(dd + 1);
    const { opts, rest, unknown } = getopt(before, { bool: ['soft', 'mixed', 'hard', 'merge', 'keep', 'q', 'quiet', 'N'], alias: { quiet: 'q' } });
    if (unknown.length) throw badOpt(unknown, 'reset');
    const repo = g.repo;
    const head = await repo.head();
    // decide: first arg a commit, or paths?
    let commitSpec = null;
    let paths = afterPaths;
    if (rest.length) {
        if (await resolveCommit(repo, rest[0])) {
            commitSpec = rest[0];
            paths = [...rest.slice(1), ...afterPaths];
        } else {
            paths = [...rest, ...afterPaths];
        }
    }
    const mode = opts.soft ? 'soft' : opts.hard ? 'hard' : opts.merge ? 'merge' : opts.keep ? 'keep' : 'mixed';
    if (paths.length) {
        if (opts.soft || opts.hard || opts.merge || opts.keep) throw fatal(`Cannot do ${mode} reset with paths.`);
        const oid = commitSpec ? await resolveCommit(repo, commitSpec) : head.oid;
        const flat = oid ? await repo.flatTree((await repo.readCommit(oid)).tree) : new Map();
        const compiled = compilePathspecs(repo, paths);
        const index = await repo.indexFlat();
        const { matched, unmatched } = matchPathspecs(compiled, [...new Set([...index.keys(), ...flat.keys()])]);
        if (unmatched.length && !matched.size) {
            throw new GitError(unknownRevision(unmatched[0]), { status: 128, kind: 'unknown-revision' });
        }
        await resetIndexTo(repo, flat, [...matched]);
        for (const p of matched) await repo.resolveConflict(p);
        const lines = await unstagedLines(repo);
        if (lines.length && !opts.q) g.out('Unstaged changes after reset:\n' + lines.join('\n') + '\n');
        g.info.reset = { mode: 'paths', paths: [...matched] };
        return 0;
    }
    const spec = commitSpec || 'HEAD';
    const target = await resolveCommit(repo, spec);
    if (!target) {
        if (head.unborn && spec === 'HEAD') {
            // reset in an empty repository unstages everything
            await resetIndexTo(repo, new Map());
            return 0;
        }
        throw new GitError(unknownRevision(spec), { status: 128, kind: 'unknown-revision', data: { rev: spec } });
    }
    const targetFlat = await repo.flatTree((await repo.readCommit(target)).tree);
    if (mode === 'keep') {
        const { local } = await findBlockers(repo, [...new Set([...targetFlat.keys(), ...(await repo.indexFlat()).keys()])].filter(Boolean), head.oid ? await repo.flatTree((await repo.readCommit(head.oid)).tree) : new Map());
        if (local.length) throw new GitError(`error: Entry '${local[0]}' not uptodate. Cannot merge.\nfatal: Could not reset index file to revision '${spec}'.`, { status: 128 });
    }
    if (head.oid) await repo.writeSpecial('ORIG_HEAD', head.oid);
    if (mode === 'hard' || mode === 'merge' || mode === 'keep') {
        // work tree + index = target (tracked files only)
        const index = await repo.indexFlat();
        const headFlat = head.oid ? await repo.flatTree((await repo.readCommit(head.oid)).tree) : new Map();
        const conflicts = Object.keys(await repo.conflicts());
        const paths2 = [...new Set([...index.keys(), ...headFlat.keys(), ...targetFlat.keys(), ...conflicts])];
        // capture what will be lost for the coach
        const st = await (await import('../status.js')).computeStatus(repo);
        g.info.discarded = [...st.staged.map(s => s.path), ...st.unstaged.map(s => s.path)];
        await checkoutPaths(repo, targetFlat, paths2);
        await resetIndexTo(repo, targetFlat);
    }
    await repo.moveHead(target);
    // commits only reachable from the old position are now "lost" (still in the reflog)
    const lostCommits = head.oid && !(await isAncestor(repo, head.oid, target)) ? await orphanedCommits(repo, head.oid, target) : [];
    if (mode === 'mixed') await resetIndexTo(repo, targetFlat);
    await clearOperationState(repo);
    repo.invalidate();
    g.reflogMessage = `reset: moving to ${spec}`;
    g.info.reset = { mode, from: head.oid, to: target, lostCommits: lostCommits.map(c => c.oid), discarded: g.info.discarded || [] };
    if (mode === 'hard') {
        // only --hard announces the new HEAD (git's builtin/reset.c); --merge and --keep are silent
        if (!opts.q) g.out(`HEAD is now at ${shortOid(target)} ${await subjectOf(repo, target)}\n`);
    } else if (mode === 'mixed' && !opts.q) {
        const lines = await unstagedLines(repo);
        if (lines.length) g.out('Unstaged changes after reset:\n' + lines.join('\n') + '\n');
    }
    return 0;
}

export function registerBranching(define) {
    define({
        name: 'branch', run: branch, usage: 'git branch [<name> [<start>]] | -d <name> | -m <neu>',
        summary: D('Listet, erstellt, löscht oder benennt Branches um.', 'Lists, creates, deletes or renames branches.'),
        options: [
            { flags: ['(ohne)'], desc: D('alle lokalen Branches anzeigen, * = aktueller', 'list local branches, * = current') },
            { flags: ['-a'], desc: D('auch Remote-Branches', 'include remote branches') },
            { flags: ['-v', '-vv'], desc: D('mit letztem Commit (und Upstream)', 'with last commit (and upstream)') },
            { flags: ['-d'], desc: D('gemergten Branch löschen', 'delete a merged branch') },
            { flags: ['-D'], desc: D('Branch löschen, auch wenn nicht gemergt', 'delete even if not merged') },
            { flags: ['-m'], desc: D('Branch umbenennen', 'rename a branch') },
        ],
    });
    define({
        name: 'switch', run: switchCmd, usage: 'git switch <branch> | git switch -c <neuer-branch>',
        summary: D('Wechselt auf einen anderen Branch.', 'Switches to another branch.'),
        options: [
            { flags: ['-c'], arg: 'NAME', desc: D('neuen Branch anlegen und wechseln', 'create a new branch and switch to it') },
            { flags: ['-'], desc: D('zurück zum vorherigen Branch', 'back to the previous branch') },
            { flags: ['--detach'], desc: D('auf einen Commit wechseln (detached HEAD)', 'switch to a commit (detached HEAD)') },
        ],
    });
    define({
        name: 'checkout', run: checkout, usage: 'git checkout <branch> | -b <neu> | <commit> | -- <datei>',
        summary: D('Älterer Allzweck-Befehl: Branch wechseln ODER Dateien zurückholen.', 'Older all-rounder: switch branches OR restore files.'),
        options: [
            { flags: ['-b'], arg: 'NAME', desc: D('neuen Branch anlegen und wechseln', 'create and switch to a new branch') },
            { flags: ['--'], desc: D('danach folgen Dateien: Änderungen verwerfen', 'files follow: discard their changes') },
        ],
        danger: true,
    });
    define({
        name: 'merge', run: merge, usage: 'git merge <branch> | --abort',
        summary: D('Führt einen anderen Branch in den aktuellen zusammen.', 'Merges another branch into the current one.'),
        options: [
            { flags: ['--abort'], desc: D('Merge mit Konflikten abbrechen', 'abort a merge with conflicts') },
            { flags: ['--no-ff'], desc: D('immer einen Merge-Commit erzeugen', 'always create a merge commit') },
            { flags: ['--ff-only'], desc: D('nur wenn ein Fast-Forward möglich ist', 'only if a fast-forward is possible') },
            { flags: ['-m'], arg: 'NACHRICHT', desc: D('Nachricht für den Merge-Commit', 'message for the merge commit') },
        ],
    });
    define({
        name: 'tag', run: tag, usage: 'git tag [<name> [<commit>]] | -a <name> -m <text> | -d <name>',
        summary: D('Setzt Markierungen (z. B. Versionsnummern) an Commits.', 'Marks commits (e.g. with version numbers).'),
        options: [{ flags: ['-a'], desc: D('annotierter Tag mit Nachricht', 'annotated tag with a message') }, { flags: ['-d'], desc: D('Tag löschen', 'delete a tag') }, { flags: ['-l'], desc: D('Tags auflisten', 'list tags') }],
    });
    define({
        name: 'reset', run: reset, usage: 'git reset [--soft|--mixed|--hard] [<commit>] | git reset <datei>',
        summary: D('Setzt den Branch auf einen anderen Commit zurück (oder nimmt Dateien aus der Staging-Area).', 'Moves the branch to another commit (or unstages files).'),
        options: [
            { flags: ['--soft'], desc: D('nur den Branch verschieben – Änderungen bleiben vorgemerkt', 'only move the branch – changes stay staged') },
            { flags: ['--mixed'], desc: D('Standard: Branch + Staging-Area zurücksetzen, Dateien bleiben', 'default: reset branch + staging area, files stay') },
            { flags: ['--hard'], desc: D('ALLES zurücksetzen – nicht committete Änderungen sind weg!', 'reset EVERYTHING – uncommitted changes are lost!') },
        ],
        danger: true,
    });
}

export { orphanedCommits, clearOperationState, resetIndexTo, doSwitch };
