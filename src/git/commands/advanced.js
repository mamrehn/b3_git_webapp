// git stash, cherry-pick, revert, rebase (incl. -i)

import { git } from '../../lib.js';
import { GitError, fatal } from '../errors.js';
import { resolveCommit } from '../revparse.js';
import { readReflog, appendReflog } from '../reflog.js';
import { computeStatus, isAncestor } from '../status.js';
import { mergeTrees, applyMerge, findBlockers, checkoutPaths, writeWorkFile, removeWorkFile } from '../merge.js';
import { walk, topoOrder } from '../history.js';
import { usage, requireIdentity, writeCommit, writeRawCommit, printCommitSummary, treeChanges, statsFor, updateWorkTree } from './common.js';
import { printLongStatus, editMessage, cleanupMessage } from './basic.js';
import { resetIndexTo } from './branching.js';
import { formatStat, formatFileDiff } from '../diffutil.js';
import { signature } from '../clock.js';
import { getopt } from '../../shell/registry.js';
import { shortOid, firstLine, joinPath } from '../../core/util.js';
import { rmrf } from '../../vfs/fsutil.js';

const D = (de, en) => ({ de, en });

function badOpt(unknown, cmd) {
    const u = unknown[0];
    return usage(`error: unknown ${u.option.startsWith('--') ? 'option' : 'switch'} \`${u.option.replace(/^-+/, '')}'\nusage: git ${cmd} [<options>]`);
}

// ---- shared: apply one commit (or its inverse) onto HEAD ---------------------------------------

async function applyCommit(g, repo, commitOid, { revert = false, verb = 'cherry-pick' } = {}) {
    const c = await repo.readCommit(commitOid);
    if (c.parents.length > 1) {
        throw new GitError(`error: commit ${commitOid} is a merge but no -m option was given.\nfatal: ${verb} failed`, { status: 128, kind: 'merge-commit-pick' });
    }
    const head = await repo.head();
    const ours = head.oid ? await repo.flatTree((await repo.readCommit(head.oid)).tree) : new Map();
    const commitFlat = await repo.flatTree(c.tree);
    const parentFlat = c.parents[0] ? await repo.flatTree((await repo.readCommit(c.parents[0])).tree) : new Map();
    const subject = firstLine(c.message);
    const labels = { ours: 'HEAD', theirs: revert ? `parent of ${shortOid(commitOid)} (${subject})` : `${shortOid(commitOid)} (${subject})` };
    const merged = await mergeTrees(repo, { base: revert ? commitFlat : parentFlat, ours, theirs: revert ? parentFlat : commitFlat, labels });
    const blockers = await findBlockers(repo, merged.touched, ours);
    if (blockers.local.length || blockers.untracked.length) {
        throw new GitError(`error: Your local changes would be overwritten by ${verb}.\nhint: commit your changes or stash them to proceed.\nfatal: ${verb} failed`, { status: 128, kind: 'local-changes', data: { files: [...blockers.local, ...blockers.untracked] } });
    }
    await applyMerge(repo, merged);
    const lines = [];
    for (const p of merged.touched) {
        const conflict = merged.conflicts.find(x => x.path === p);
        const both = ours.has(p) && (revert ? parentFlat : commitFlat).has(p) && (revert ? commitFlat : parentFlat).get(p)?.oid !== ours.get(p)?.oid;
        if (both && (!conflict || conflict.kind === 'content' || conflict.kind === 'add/add')) lines.push(`Auto-merging ${p}`);
        if (!conflict) continue;
        if (conflict.kind === 'content' || conflict.kind === 'binary') lines.push(`CONFLICT (content): Merge conflict in ${p}`);
        else if (conflict.kind === 'add/add') lines.push(`CONFLICT (add/add): Merge conflict in ${p}`);
        else if (conflict.kind === 'modify/delete') lines.push(`CONFLICT (modify/delete): ${p} deleted in HEAD and modified in ${labels.theirs}.  Version ${labels.theirs} of ${p} left in tree.`);
        else lines.push(`CONFLICT (modify/delete): ${p} deleted in ${labels.theirs} and modified in HEAD.  Version HEAD of ${p} left in tree.`);
    }
    if (lines.length) g.out(lines.join('\n') + '\n');
    const empty = !merged.conflicts.length && [...merged.result].every(([p, e]) => ours.get(p)?.oid === e.oid) && merged.result.size === ours.size;
    return { commit: c, subject, merged, conflicts: merged.conflicts, empty, labels };
}

async function commitFromIndex(repo, { message, author, parents = null }) {
    const identity = await requireIdentity(repo);
    const head = await repo.head();
    const tree = await repo.writeFlatTree(await repo.indexFlat());
    const oid = await writeCommit(repo, { tree, parents: parents || (head.oid ? [head.oid] : []), message, author: author || signature(identity), committer: signature(identity) });
    await repo.moveHead(oid);
    repo.invalidate();
    return oid;
}

// ---- cherry-pick / revert (sequencer) -------------------------------------------------------------

const SEQ = 'WERKSTATT_SEQUENCER.json';

async function readSeq(repo) {
    try { return JSON.parse((await repo.readGitFile(SEQ)) || 'null'); } catch { return null; }
}

async function pickLoop(g, repo, state) {
    const verb = state.kind;
    while (state.todo.length) {
        const oid = state.todo[0];
        let res;
        try {
            res = await applyCommit(g, repo, oid, { revert: verb === 'revert', verb });
        } catch (e) {
            await repo.removeGitFile(SEQ);
            throw e;
        }
        const c = res.commit;
        const message = verb === 'revert'
            ? `Revert "${res.subject}"\n\nThis reverts commit ${oid}.\n`
            : c.message + (state.x ? `\n(cherry picked from commit ${oid})\n` : '');
        if (res.conflicts.length) {
            g.ctx.stdout.flush?.();
            state.touched = res.merged.touched;
            await repo.writeSpecial(verb === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD', oid);
            await repo.writeGitFile('MERGE_MSG', `${message.replace(/\n+$/, '')}\n\n# Conflicts:\n${res.conflicts.map(x => `#\t${x.path}`).join('\n')}\n`);
            await repo.writeGitFile(SEQ, JSON.stringify(state));
            g.err(`error: could not ${verb === 'revert' ? 'revert' : 'apply'} ${shortOid(oid)}... ${res.subject}\n` +
                'hint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\n' +
                `hint: "git ${verb} --continue".\nhint: You can instead skip this commit with "git ${verb} --skip".\n` +
                `hint: To abort and get back to the state before "git ${verb}",\nhint: run "git ${verb} --abort".\n` +
                'hint: Disable this message with "git config set advice.mergeConflict false"\n');
            g.info[verb] = { conflict: true, oid, files: res.conflicts.map(x => x.path) };
            return 1;
        }
        if (res.empty) {
            await repo.writeSpecial(verb === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD', oid);
            await repo.writeGitFile(SEQ, JSON.stringify(state));
            await printLongStatus(g, repo);
            g.err(`The previous ${verb} is now empty, possibly due to conflict resolution.\nIf you wish to commit it anyway, use:\n\n    git commit --allow-empty\n\nOtherwise, please use 'git ${verb} --skip'\n`);
            g.info[verb] = { empty: true, oid };
            return 1;
        }
        if (state.noCommit) {
            state.todo.shift();
            continue;
        }
        let finalMessage = message;
        if (verb === 'revert' && state.edit) {
            const text = await editMessage(g, repo, message + "\n# Please enter the commit message for your changes. Lines starting\n# with '#' will be ignored, and an empty message aborts the commit.\n", { kind: 'revert' });
            if (text !== null) finalMessage = cleanupMessage(text, { stripComments: true }) || message;
        }
        const identity = await requireIdentity(repo);
        const author = verb === 'revert' ? signature(identity) : c.author;
        const before = (await repo.head()).oid;
        const newOid = await commitFromIndex(repo, { message: finalMessage, author });
        await appendReflog(repo, 'HEAD', before, newOid, `${verb}: ${firstLine(finalMessage)}`);
        const head = await repo.head();
        if (head.branch) await appendReflog(repo, `refs/heads/${head.branch}`, before, newOid, `${verb}: ${firstLine(finalMessage)}`);
        await printCommitSummary(g, repo, newOid, { showDate: true });
        (g.info[verb] ||= { commits: [] }).commits?.push(newOid);
        state.todo.shift();
    }
    await repo.removeGitFile(SEQ);
    return 0;
}

async function sequencerCommand(g, verb) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['continue', 'abort', 'skip', 'quit', 'n', 'no-commit', 'x', 'e', 'edit', 'no-edit'],
        value: ['m', 'mainline'],
        alias: { 'no-commit': 'n', edit: 'e', mainline: 'm' },
    });
    if (unknown.length) throw badOpt(unknown, verb);
    const repo = g.repo;
    g.reflogHandled = true;
    const headFile = verb === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD';
    const inProgress = await repo.readSpecial(headFile);
    if (opts.abort || opts.quit) {
        const seq = await readSeq(repo);
        if (!inProgress && !seq) throw new GitError(`error: no cherry-pick or revert in progress\nfatal: ${verb} failed`, { status: 128, kind: 'nothing-in-progress' });
        if (opts.abort && seq?.orig) {
            const before = (await repo.head()).oid;
            if (before !== seq.orig) await updateWorkTree(repo, seq.orig, { force: true });
            const origFlat = await repo.flatTree((await repo.readCommit(seq.orig)).tree);
            await checkoutPaths(repo, origFlat, [...new Set([...(seq.touched || []), ...Object.keys(await repo.conflicts())])]);
            await repo.moveHead(seq.orig);
            if (before !== seq.orig) await appendReflog(repo, 'HEAD', before, seq.orig, `${verb}: abort`);
        }
        await repo.setConflicts({});
        for (const f of [headFile, 'MERGE_MSG', SEQ]) await repo.removeGitFile(f);
        return 0;
    }
    if (opts.skip || opts.continue) {
        const seq = await readSeq(repo);
        if (!inProgress && !seq) throw new GitError(`error: no cherry-pick or revert in progress\nfatal: ${verb} failed`, { status: 128, kind: 'nothing-in-progress' });
        if (opts.continue) {
            const conflicts = Object.keys(await repo.conflicts());
            if (conflicts.length) {
                g.err(`${conflicts.map(p => `${p}: needs merge`).join('\n')}\nYou must edit all merge conflicts and then\nmark them as resolved using git add\n`);
                return 1;
            }
            const st = await computeStatus(repo);
            if (st.staged.length && inProgress) {
                const c = await repo.readCommit(inProgress);
                const msg = cleanupMessage((await repo.readGitFile('MERGE_MSG')) || c.message, { stripComments: true });
                const identity = await requireIdentity(repo);
                const before = (await repo.head()).oid;
                const newOid = await commitFromIndex(repo, { message: msg, author: verb === 'revert' ? signature(identity) : c.author });
                await appendReflog(repo, 'HEAD', before, newOid, `${verb}: ${firstLine(msg)}`);
                const head = await repo.head();
                if (head.branch) await appendReflog(repo, `refs/heads/${head.branch}`, before, newOid, `${verb}: ${firstLine(msg)}`);
                await printCommitSummary(g, repo, newOid, { showDate: true });
            }
        } else {
            const head = await repo.head();
            const flat = await repo.flatTree((await repo.readCommit(head.oid)).tree);
            await checkoutPaths(repo, flat, [...new Set([...(seq?.touched || []), ...Object.keys(await repo.conflicts())])]);
            await repo.setConflicts({});
        }
        for (const f of [headFile, 'MERGE_MSG']) await repo.removeGitFile(f);
        if (!seq) return 0;
        seq.todo.shift();
        return pickLoop(g, repo, seq);
    }
    if (inProgress) {
        throw new GitError(`error: ${verb === 'revert' ? 'revert' : 'cherry-pick'} is already in progress\nhint: try "git ${verb} (--continue | --abort | --quit)"\nfatal: ${verb} failed`, { status: 128, kind: 'operation-in-progress' });
    }
    if (!rest.length) throw usage(`usage: git ${verb} [--[no-]edit] [-n] [-m <parent-number>] [-s] [-x] [--[no-]ff]\n                   [-S[<keyid>]] <commit>...`);
    const oids = [];
    for (const spec of rest) {
        if (spec.includes('..')) {
            const [a, b] = spec.split('..');
            const commits = topoOrder(await walk(repo, { include: [await resolveCommit(repo, b || 'HEAD')], exclude: [await resolveCommit(repo, a)] })).reverse();
            oids.push(...commits.map(c => c.oid));
            continue;
        }
        const oid = await resolveCommit(repo, spec);
        if (!oid) throw fatal(`bad revision '${spec}'`, { kind: 'bad-revision', data: { rev: spec } });
        oids.push(oid);
    }
    const head = await repo.head();
    if (!head.oid && verb === 'revert') throw fatal('your current branch appears to be broken');
    const state = { kind: verb, todo: oids, orig: head.oid, x: Boolean(opts.x), noCommit: Boolean(opts.n), edit: verb === 'revert' ? !opts['no-edit'] && (opts.e || (g.ctx.isTTY && Boolean(g.ui?.edit))) : Boolean(opts.e) };
    if (head.oid) await repo.writeSpecial('ORIG_HEAD', head.oid);
    return pickLoop(g, repo, state);
}

// ---- rebase ---------------------------------------------------------------------------------------

const RB = 'rebase-merge';

async function readRebase(repo) {
    if (!(await repo.hasGitFile(RB))) return null;
    const read = async f => ((await repo.readGitFile(`${RB}/${f}`)) || '').trim();
    let todo = [];
    try { todo = JSON.parse((await repo.readGitFile(`${RB}/werkstatt-todo.json`)) || '[]'); } catch { /* ignore */ }
    return {
        headName: await read('head-name'),
        onto: await read('onto'),
        orig: await read('orig-head'),
        upstreamSpec: await read('werkstatt-upstream'),
        prefix: (await read('werkstatt-prefix')) || 'rebase',
        interactive: await repo.hasGitFile(`${RB}/interactive`),
        current: (await read('stopped-sha')) || null,
        currentAction: (await read('werkstatt-current-action')) || 'pick',
        squashBase: (await read('werkstatt-squash')) || null,
        done: Number(await read('msgnum')) || 0,
        doneItems: JSON.parse((await repo.readGitFile(`${RB}/werkstatt-done.json`)) || '[]'),
        total: Number(await read('end')) || 0,
        todo,
    };
}

async function writeRebase(repo, st) {
    await repo.writeGitFile(`${RB}/head-name`, st.headName + '\n');
    await repo.writeGitFile(`${RB}/onto`, st.onto + '\n');
    await repo.writeGitFile(`${RB}/orig-head`, st.orig + '\n');
    await repo.writeGitFile(`${RB}/werkstatt-upstream`, (st.upstreamSpec || '') + '\n');
    await repo.writeGitFile(`${RB}/werkstatt-prefix`, st.prefix + '\n');
    await repo.writeGitFile(`${RB}/werkstatt-todo.json`, JSON.stringify(st.todo));
    await repo.writeGitFile(`${RB}/msgnum`, `${st.done || 0}\n`);
    await repo.writeGitFile(`${RB}/werkstatt-done.json`, JSON.stringify(st.doneItems || []));
    await repo.writeGitFile(`${RB}/end`, `${st.total || 0}\n`);
    if (st.interactive) await repo.writeGitFile(`${RB}/interactive`, '');
    if (st.current) await repo.writeGitFile(`${RB}/stopped-sha`, st.current + '\n');
    else await repo.removeGitFile(`${RB}/stopped-sha`);
    await repo.writeGitFile(`${RB}/werkstatt-current-action`, (st.currentAction || 'pick') + '\n');
    if (st.squashBase) await repo.writeGitFile(`${RB}/werkstatt-squash`, st.squashBase + '\n');
    else await repo.removeGitFile(`${RB}/werkstatt-squash`);
}

const TODO_HELP = `
# Commands:
# p, pick <commit> = use commit
# r, reword <commit> = use commit, but edit the commit message
# e, edit <commit> = use commit, but stop for amending
# s, squash <commit> = use commit, but meld into previous commit
# f, fixup <commit> = like "squash" but keep only the previous
#                    commit's log message
# x, exec <command> = run command (the rest of the line) using shell
# b, break = stop here (continue rebase later with 'git rebase --continue')
# d, drop <commit> = remove commit
#
# These lines can be re-ordered; they are executed from top to bottom.
#
# If you remove a line here THAT COMMIT WILL BE LOST.
#
# However, if you remove everything, the rebase will be aborted.
#
`;

const ACTIONS = { p: 'pick', pick: 'pick', r: 'reword', reword: 'reword', e: 'edit', edit: 'edit', s: 'squash', squash: 'squash', f: 'fixup', fixup: 'fixup', d: 'drop', drop: 'drop', x: 'exec', exec: 'exec', b: 'break', break: 'break' };

async function parseTodo(repo, text) {
    const items = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^(\S+)(?:\s+(.*))?$/);
        const action = ACTIONS[m[1]];
        if (!action) throw new GitError(`error: invalid command '${m[1]}'\nerror: invalid line ${i + 1}: ${line}\nYou can fix this with 'git rebase --edit-todo' and then run 'git rebase --continue'.\nOr you can abort the rebase with 'git rebase --abort'.`, { status: 1, kind: 'bad-todo' });
        if (action === 'exec') { items.push({ action, command: m[2] || '' }); continue; }
        if (action === 'break') { items.push({ action }); continue; }
        const [spec] = (m[2] || '').split(/\s+/);
        const oid = await resolveCommit(repo, spec);
        if (!oid) throw new GitError(`error: invalid line ${i + 1}: ${line}`, { status: 1, kind: 'bad-todo' });
        items.push({ action, oid, subject: firstLine((await repo.readCommit(oid)).message) });
    }
    if (items.length && (items[0].action === 'squash' || items[0].action === 'fixup')) {
        throw new GitError(`error: cannot '${items[0].action}' without a previous commit`, { status: 1, kind: 'bad-todo' });
    }
    return items;
}

async function finishRebase(g, repo, st) {
    const head = await repo.head();
    const branch = st.headName.replace(/^refs\/heads\//, '');
    if (st.headName.startsWith('refs/heads/')) {
        const old = await repo.readRef(st.headName);
        await repo.writeRef(st.headName, head.oid);
        await repo.setHeadToBranch(branch);
        await appendReflog(repo, st.headName, old, head.oid, `${st.prefix} (finish): ${st.headName} onto ${st.onto}`);
        await appendReflog(repo, 'HEAD', head.oid, head.oid, `${st.prefix} (finish): returning to ${st.headName}`);
    }
    await rmrf(repo.pfs, joinPath(repo.gitdir, RB));
    await repo.removeGitFile('MERGE_MSG');
    repo.invalidate();
    g.ctx.stdout.flush?.();
    g.err(`Successfully rebased and updated ${st.headName}.\n`);
    g.info.rebase = { ...(g.info.rebase || {}), done: true, branch };
    return 0;
}

async function stopForConflict(g, repo, st, item, res) {
    g.ctx.stdout.flush?.();
    st.current = item.oid;
    st.currentAction = item.action;
    await writeRebase(repo, st);
    await repo.writeGitFile('MERGE_MSG', `${res.commit.message.replace(/\n+$/, '')}\n\n# Conflicts:\n${res.conflicts.map(x => `#\t${x.path}`).join('\n')}\n`);
    g.err(`error: could not apply ${shortOid(item.oid)}... ${item.subject}\n` +
        'hint: Resolve all conflicts manually, mark them as resolved with\n' +
        'hint: "git add/rm <conflicted_files>", then run "git rebase --continue".\n' +
        'hint: You can instead skip this commit: run "git rebase --skip".\n' +
        'hint: To abort and get back to the state before "git rebase", run "git rebase --abort".\n' +
        'hint: Disable this message with "git config set advice.mergeConflict false"\n' +
        `Could not apply ${shortOid(item.oid)}... # ${item.subject}\n`);
    g.info.rebase = { conflict: true, oid: item.oid, files: res.conflicts.map(x => x.path) };
    return 1;
}

async function commitPick(g, repo, st, item, commit, { amendSquash = false } = {}) {
    const before = (await repo.head()).oid;
    let message = commit.message;
    let newOid;
    if (amendSquash) {
        // meld into previous commit
        const prev = await repo.readCommit(before);
        if (item.action === 'squash') {
            const combined = `# This is a combination of 2 commits.\n# This is the 1st commit message:\n\n${prev.message.replace(/\n+$/, '')}\n\n# This is the commit message #2:\n\n${commit.message.replace(/\n+$/, '')}\n`;
            const text = await editMessage(g, repo, combined + "\n# Please enter the commit message for your changes. Lines starting\n# with '#' will be ignored, and an empty message aborts the commit.\n", { kind: 'squash' });
            message = text === null ? cleanupMessage(combined, { stripComments: true }) : (cleanupMessage(text, { stripComments: true }) || prev.message);
        } else {
            message = prev.message;
        }
        const identity = await requireIdentity(repo);
        const tree = await repo.writeFlatTree(await repo.indexFlat());
        newOid = await writeCommit(repo, { tree, parents: prev.parents, message, author: prev.author, committer: signature(identity) });
        await repo.moveHead(newOid);
    } else {
        if (item.action === 'reword') {
            const text = await editMessage(g, repo, commit.message + "\n# Please enter the commit message for your changes. Lines starting\n# with '#' will be ignored, and an empty message aborts the commit.\n", { kind: 'reword' });
            if (text !== null) message = cleanupMessage(text, { stripComments: true }) || commit.message;
        }
        newOid = await commitFromIndex(repo, { message, author: commit.author });
    }
    repo.invalidate();
    const label = item.action === 'pick' ? 'pick' : item.action;
    await appendReflog(repo, 'HEAD', before, newOid, `${st.prefix} (${label}): ${firstLine(message)}`);
    return newOid;
}

async function runTodo(g, repo, st) {
    while (st.todo.length) {
        const item = st.todo.shift();
        (st.doneItems ||= []).push(item);
        st.done = (st.done || 0) + 1;
        if (!g.quiet) g.err(`Rebasing (${st.done}/${st.total || st.done + st.todo.length})\r`);
        if (item.action === 'drop') continue;
        if (item.action === 'break') {
            st.current = null;
            await writeRebase(repo, st);
            g.err('Stopped at HEAD\n');
            return 0;
        }
        if (item.action === 'exec') {
            g.err(`Executing: ${item.command}\n`);
            const r = await g.ctx.shell.capture(item.command);
            g.out(r.stdout);
            if (r.stderr) g.err(r.stderr);
            if (r.status) {
                st.current = null;
                await writeRebase(repo, st);
                g.err(`warning: execution failed: ${item.command}\nYou can fix the problem, and then run\n\n  git rebase --continue\n\n`);
                return 1;
            }
            continue;
        }
        const res = await applyCommit(g, repo, item.oid, { verb: 'rebase' });
        if (res.conflicts.length) return stopForConflict(g, repo, st, item, res);
        if (res.empty && item.action !== 'squash' && item.action !== 'fixup') {
            g.err(`dropping ${item.oid} ${item.subject} -- patch contents already upstream\n`);
            continue;
        }
        const squash = item.action === 'squash' || item.action === 'fixup';
        await commitPick(g, repo, st, item, res.commit, { amendSquash: squash });
        if (item.action === 'edit') {
            st.current = item.oid;
            st.currentAction = 'edit-stop';
            await writeRebase(repo, st);
            g.err(`Stopped at ${shortOid(item.oid)}...  ${item.subject}\nYou can amend the commit now, with\n\n  git commit --amend \n\nOnce you are satisfied with your changes, run\n\n  git rebase --continue\n`);
            g.info.rebase = { stopped: true, oid: item.oid };
            return 0;
        }
    }
    return finishRebase(g, repo, st);
}

export async function runRebase(g, { upstreamSpec, ontoOid = null, ontoSpec = null, interactive = false, reflogPrefix = 'rebase', branchArg = null }) {
    const repo = g.repo;
    g.reflogHandled = true;
    if (await repo.hasGitFile(RB)) {
        throw new GitError(`fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.  If that is the\ncase, please try\n\tgit rebase (--continue | --abort | --skip)\nIf that is not the case, please\n\trm -fr "${repo.gitdir}/rebase-merge"\nand run me again.  I am stopping in case you still have something\nvaluable there.`, { status: 128, kind: 'rebase-in-progress' });
    }
    const op = await repo.operation();
    if (op) throw fatal(`You are in the middle of a ${op.kind}. Finish it first.`, { kind: 'operation-in-progress' });
    if (branchArg) {
        const { gitSpec } = await import('../gitcmd.js');
        const status = await gitSpec('switch').run({ ...g, args: ['-q', branchArg] });
        if (status) return status;
    }
    const st0 = await computeStatus(repo);
    if (st0.unstaged.length || st0.staged.length) {
        throw new GitError(st0.staged.length
            ? 'error: cannot rebase: Your index contains uncommitted changes.\nerror: Please commit or stash them.'
            : 'error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.', { status: 1, kind: 'rebase-dirty' });
    }
    const head = await repo.head();
    const upstreamOid = await resolveCommit(repo, upstreamSpec);
    if (!upstreamOid) throw fatal(`invalid upstream '${upstreamSpec}'`, { kind: 'bad-upstream', data: { upstream: upstreamSpec } });
    const onto = ontoOid || upstreamOid;
    const commits = topoOrder(await walk(repo, { include: [head.oid], exclude: [upstreamOid] })).reverse().filter(c => c.parents.length <= 1);
    const headName = head.branch ? `refs/heads/${head.branch}` : 'detached HEAD';
    if (!interactive && await isAncestor(repo, onto, head.oid)) {
        g.out(`Current branch ${head.branch || 'HEAD'} is up to date.\n`);
        g.info.rebase = { upToDate: true };
        return 0;
    }
    if (!commits.length && !interactive) {
        // fast-forward
        await updateWorkTree(repo, onto);
        await appendReflog(repo, 'HEAD', head.oid, onto, `${reflogPrefix} (start): checkout ${ontoSpec || upstreamSpec}`);
        if (head.branch) {
            await repo.writeRef(headName, onto);
            await appendReflog(repo, headName, head.oid, onto, `${reflogPrefix} (finish): ${headName} onto ${onto}`);
            await appendReflog(repo, 'HEAD', onto, onto, `${reflogPrefix} (finish): returning to ${headName}`);
        } else {
            await repo.setHeadDetached(onto);
        }
        repo.invalidate();
        g.err(`Successfully rebased and updated ${headName}.\n`);
        g.info.rebase = { done: true, fastForward: true };
        return 0;
    }
    let todo = commits.map(c => ({ action: 'pick', oid: c.oid, subject: firstLine(c.message) }));
    if (interactive) {
        const text = todo.map(t => `pick ${shortOid(t.oid)} ${t.subject}`).join('\n') +
            `\n\n# Rebase ${shortOid(upstreamOid)}..${shortOid(head.oid)} onto ${shortOid(onto)} (${todo.length} command${todo.length === 1 ? '' : 's'})` + TODO_HELP;
        await repo.writeGitFile(`${RB}-todo-draft`, text);
        const edited = await editMessage(g, repo, text, { kind: 'rebase-todo' });
        await repo.removeGitFile(`${RB}-todo-draft`);
        if (edited === null) throw new GitError('error: no editor available for an interactive rebase', { status: 1 });
        todo = await parseTodo(repo, edited);
        if (!todo.length) {
            g.err('Nothing to do\n');
            return 1;
        }
    }
    await repo.writeSpecial('ORIG_HEAD', head.oid);
    const st = { headName, onto, orig: head.oid, upstreamSpec: ontoSpec || upstreamSpec, prefix: reflogPrefix, interactive, todo, current: null, done: 0, total: todo.length };
    await writeRebase(repo, st);
    await updateWorkTree(repo, onto);
    await repo.setHeadDetached(onto);
    repo.invalidate();
    await appendReflog(repo, 'HEAD', head.oid, onto, `${reflogPrefix} (start): checkout ${ontoSpec || upstreamSpec}`);
    g.info.rebase = { started: true, onto, commits: todo.length, interactive };
    return runTodo(g, repo, st);
}

async function rebase(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['continue', 'abort', 'skip', 'quit', 'i', 'interactive', 'edit-todo', 'q', 'quiet', 'v', 'autosquash', 'no-autosquash', 'root'],
        value: ['onto'],
        alias: { interactive: 'i', quiet: 'q' },
    });
    if (unknown.length) throw badOpt(unknown, 'rebase');
    const repo = g.repo;
    g.reflogHandled = true;
    const st = await readRebase(repo);
    if (opts.abort || opts.quit) {
        if (!st) throw fatal('No rebase in progress?', { kind: 'no-rebase' });
        if (opts.abort) {
            const before = (await repo.head()).oid;
            await updateWorkTree(repo, st.orig, { force: true });
            await resetIndexTo(repo, await repo.flatTree((await repo.readCommit(st.orig)).tree));
            if (st.headName.startsWith('refs/heads/')) await repo.setHeadToBranch(st.headName.replace('refs/heads/', ''));
            else await repo.setHeadDetached(st.orig);
            await appendReflog(repo, 'HEAD', before, st.orig, `${st.prefix} (abort): returning to ${st.headName}`);
        }
        await repo.setConflicts({});
        await rmrf(repo.pfs, joinPath(repo.gitdir, RB));
        await repo.removeGitFile('MERGE_MSG');
        g.info.rebase = { aborted: true };
        return 0;
    }
    if (opts.continue || opts.skip || opts['edit-todo']) {
        if (!st) throw fatal('No rebase in progress?', { kind: 'no-rebase' });
        if (opts['edit-todo']) {
            const text = st.todo.map(t => (t.action === 'exec' ? `exec ${t.command}` : t.action === 'break' ? 'break' : `${t.action} ${shortOid(t.oid)} ${t.subject}`)).join('\n') + '\n' + TODO_HELP;
            const edited = await editMessage(g, repo, text, { kind: 'rebase-todo' });
            if (edited !== null) st.todo = await parseTodo(repo, edited);
            await writeRebase(repo, st);
            return 0;
        }
        if (opts.skip) {
            const head = await repo.head();
            const flat = await repo.flatTree((await repo.readCommit(head.oid)).tree);
            const s = await computeStatus(repo);
            await checkoutPaths(repo, flat, [...new Set([...s.staged.map(x => x.path), ...s.unstaged.map(x => x.path), ...Object.keys(await repo.conflicts())])]);
            await repo.setConflicts({});
            st.current = null;
            return runTodo(g, repo, st);
        }
        const conflicts = Object.keys(await repo.conflicts());
        if (conflicts.length) {
            g.err(`${conflicts.map(p => `${p}: needs merge`).join('\n')}\nYou must edit all merge conflicts and then\nmark them as resolved using git add\n`);
            return 1;
        }
        if (st.current && st.currentAction !== 'edit-stop') {
            const s = await computeStatus(repo);
            if (s.unstaged.length) {
                g.err(`${s.unstaged.map(x => x.path).join(': needs update\n')}: needs update\nYou must edit all merge conflicts and then\nmark them as resolved using git add\n`);
                return 1;
            }
            const commit = await repo.readCommit(st.current);
            const item = { action: st.currentAction, oid: st.current, subject: firstLine(commit.message) };
            if (s.staged.length) {
                const newOid = await commitPick(g, repo, st, item, commit, { amendSquash: item.action === 'squash' || item.action === 'fixup' });
                await printCommitSummary(g, repo, newOid, { branchLabel: 'detached HEAD' });
            }
        }
        st.current = null;
        await repo.removeGitFile('MERGE_MSG');
        return runTodo(g, repo, st);
    }
    if (st) {
        throw new GitError(`fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.  If that is the\ncase, please try\n\tgit rebase (--continue | --abort | --skip)\nIf that is not the case, please\n\trm -fr "${repo.gitdir}/rebase-merge"\nand run me again.  I am stopping in case you still have something\nvaluable there.`, { status: 128, kind: 'rebase-in-progress' });
    }
    let upstream = rest[0];
    if (!upstream) {
        const head = await repo.head();
        const up = head.branch ? await repo.upstreamOf(head.branch) : null;
        if (!up) {
            throw new GitError(`There is no tracking information for the current branch.\nPlease specify which branch you want to rebase against.\nSee git-rebase(1) for details.\n\n    git rebase '<branch>'\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=<remote>/<branch> ${head.branch || 'main'}\n`, { status: 1, kind: 'no-upstream' });
        }
        upstream = up.display;
    }
    let ontoOid = null;
    if (opts.onto) {
        ontoOid = await resolveCommit(repo, opts.onto);
        if (!ontoOid) throw fatal(`Does not point to a valid commit '${opts.onto}'`);
    }
    return runRebase(g, { upstreamSpec: upstream, ontoOid, ontoSpec: opts.onto || null, interactive: Boolean(opts.i), branchArg: rest[1] || null });
}

// ---- stash ------------------------------------------------------------------------------------------

async function stashEntries(repo) {
    return readReflog(repo, 'refs/stash');
}

async function stashRef(repo, spec) {
    const entries = await stashEntries(repo);
    let idx = 0;
    if (spec) {
        const m = spec.match(/^(?:stash@\{)?(\d+)\}?$/);
        if (!m) return { error: `error: ${spec} is not a valid reference` };
        idx = Number(m[1]);
    }
    if (!entries.length) return { error: 'No stash entries found.', none: true };
    if (idx >= entries.length) return { error: `error: stash@{${idx}} is not a valid reference` };
    return { idx, oid: entries[idx].new, message: entries[idx].message, entries };
}

async function writeStashLog(repo, entries) {
    // entries newest first → file oldest first, chained old→new
    const path = joinPath(repo.gitdir, 'logs', 'refs', 'stash');
    if (!entries.length) {
        await rmrf(repo.pfs, path);
        await repo.deleteRef('refs/stash');
        return;
    }
    const lines = entries.slice().reverse().map((e, i, arr) => `${i === 0 ? '0'.repeat(40) : arr[i - 1].new} ${e.new} ${e.name} <${e.email}> ${e.time} ${e.tz}\t${e.message}`);
    await repo.pfs.writeFile(path, lines.join('\n') + '\n', 'utf8');
    await repo.writeRef('refs/stash', entries[0].new);
}

async function stashPush(g, repo, { message, includeUntracked, keepIndex, quiet }) {
    const head = await repo.head();
    if (!head.oid) {
        g.err('You do not have the initial commit yet\n');
        return 1;
    }
    const st = await computeStatus(repo);
    const untracked = includeUntracked ? st.untrackedFiles : [];
    if (!st.staged.length && !st.unstaged.length && !untracked.length && !Object.keys(await repo.conflicts()).length) {
        g.out('No local changes to save\n');
        g.info.stash = { nothing: true };
        return 0;
    }
    if (Object.keys(await repo.conflicts()).length) {
        g.err('error: could not save current state; you need to resolve your current index first\n');
        for (const p of Object.keys(await repo.conflicts())) g.err(`${p}: needs merge\n`);
        return 1;
    }
    const identity = await requireIdentity(repo);
    const sig = signature(identity);
    const headCommit = await repo.readCommit(head.oid);
    const subject = firstLine(headCommit.message);
    const where = head.branch || '(no branch)';
    const indexFlat = await repo.indexFlat();
    const indexTree = await repo.writeFlatTree(indexFlat);
    const iOid = await writeCommit(repo, { tree: indexTree, parents: [head.oid], message: `index on ${where}: ${shortOid(head.oid)} ${subject}\n`, author: sig, committer: sig });
    // work tree state of tracked files
    const workFlat = new Map(indexFlat);
    for (const u of st.unstaged) {
        if (u.kind === 'deleted') workFlat.delete(u.path);
        else {
            const bytes = await repo.workBytes(u.path);
            const oid = await git.writeBlob({ fs: repo.fs, gitdir: repo.gitdir, blob: bytes });
            workFlat.set(u.path, { oid, mode: workFlat.get(u.path)?.mode || '100644' });
        }
    }
    const parents = [head.oid, iOid];
    if (untracked.length) {
        const uFlat = new Map();
        for (const p of untracked) {
            const oid = await git.writeBlob({ fs: repo.fs, gitdir: repo.gitdir, blob: await repo.workBytes(p) });
            uFlat.set(p, { oid, mode: '100644' });
        }
        const uOid = await writeCommit(repo, { tree: await repo.writeFlatTree(uFlat), parents: [], message: `untracked files on ${where}: ${shortOid(head.oid)} ${subject}\n`, author: sig, committer: sig });
        parents.push(uOid);
    }
    const msg = message ? `On ${where}: ${message}` : `WIP on ${where}: ${shortOid(head.oid)} ${subject}`;
    const wOid = await writeRawCommit(repo, { tree: await repo.writeFlatTree(workFlat), parents, message: msg, author: sig, committer: sig });
    const old = await repo.readRef('refs/stash');
    await repo.writeRef('refs/stash', wOid);
    await appendReflog(repo, 'refs/stash', old, wOid, msg);
    // clean the work tree (back to HEAD), optionally keeping the index
    const headFlat = await repo.flatTree(headCommit.tree);
    const target = keepIndex ? indexFlat : headFlat;
    const touched = [...new Set([...st.staged.map(s => s.path), ...st.unstaged.map(s => s.path), ...st.staged.filter(s => s.from).map(s => s.from)])];
    await checkoutPaths(repo, target, touched);
    if (keepIndex) await resetIndexTo(repo, indexFlat);
    else await resetIndexTo(repo, headFlat);
    for (const p of untracked) await removeWorkFile(repo, p);
    if (!quiet) g.out(`Saved working directory and index state ${msg}\n`);
    g.info.stash = { pushed: wOid, message: msg, files: [...touched, ...untracked] };
    return 0;
}

async function stashApply(g, repo, ref, { pop, restoreIndex, quiet }) {
    const w = await repo.readCommit(ref.oid);
    const base = await repo.flatTree((await repo.readCommit(w.parents[0])).tree);
    const theirs = await repo.flatTree(w.tree);
    const head = await repo.head();
    const ours = await repo.flatTree((await repo.readCommit(head.oid)).tree);
    const st = await computeStatus(repo);
    if (Object.keys(await repo.conflicts()).length) {
        throw new GitError(`error: you need to resolve your current index first`, { status: 1, kind: 'unresolved-conflicts' });
    }
    const merged = await mergeTrees(repo, { base, ours, theirs, labels: { ours: 'Updated upstream', theirs: 'Stashed changes' } });
    const blockers = await findBlockers(repo, merged.touched, ours);
    const dirtyStaged = st.staged.filter(s => merged.touched.includes(s.path));
    if (blockers.local.length || dirtyStaged.length) {
        const files = [...new Set([...blockers.local, ...dirtyStaged.map(s => s.path)])];
        throw new GitError(`error: Your local changes to the following files would be overwritten by merge:\n${files.map(p => `\t${p}`).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting\nThe stash entry is kept in case you need it again.`, { status: 1, kind: 'local-changes', data: { files } });
    }
    // untracked files stored in the third parent
    const untrackedFlat = w.parents[2] ? await repo.flatTree((await repo.readCommit(w.parents[2])).tree) : new Map();
    for (const p of untrackedFlat.keys()) {
        if ((await repo.workBytes(p)) !== null) {
            throw new GitError(`${p} already exists, no checkout\nerror: could not restore untracked files from stash\nThe stash entry is kept in case you need it again.`, { status: 1, kind: 'stash-untracked-exists' });
        }
    }
    await applyMerge(repo, merged);
    for (const [p, e] of untrackedFlat) await writeWorkFile(repo, p, await repo.readBlob(e.oid), e.mode);
    // like git: changes come back unstaged (new files stay staged) unless --index
    const indexStash = restoreIndex ? await repo.flatTree((await repo.readCommit(w.parents[1])).tree) : null;
    const resetPaths = merged.touched.filter(p => !merged.conflicts.some(c => c.path === p));
    if (indexStash) {
        await resetIndexTo(repo, indexStash, resetPaths);
    } else {
        await resetIndexTo(repo, ours, resetPaths.filter(p => ours.has(p) || !merged.result.has(p)));
    }
    const lines = [];
    for (const c of merged.conflicts) {
        lines.push(`Auto-merging ${c.path}`);
        lines.push(`CONFLICT (content): Merge conflict in ${c.path}`);
    }
    if (lines.length) g.out(lines.join('\n') + '\n');
    if (merged.conflicts.length) {
        // git keeps conflicts in the index; the stash stays
        await printLongStatus(g, repo);
        g.out('The stash entry is kept in case you need it again.\n');
        g.info.stash = { conflict: true, files: merged.conflicts.map(c => c.path) };
        return 1;
    }
    if (!quiet) await printLongStatus(g, repo);
    if (pop) {
        const entries = ref.entries.filter((_, i) => i !== ref.idx);
        await writeStashLog(repo, entries);
        if (!quiet) g.out(`Dropped refs/stash@{${ref.idx}} (${ref.oid})\n`);
    }
    g.info.stash = { applied: ref.oid, popped: pop, files: merged.touched };
    return 0;
}

async function stash(g) {
    const repo = g.repo;
    g.reflogHandled = true;
    const sub = ['push', 'save', 'list', 'show', 'apply', 'pop', 'drop', 'clear', 'branch'].includes(g.args[0]) ? g.args[0] : null;
    const args = sub ? g.args.slice(1) : g.args;
    if (!sub || sub === 'push' || sub === 'save') {
        const { opts, rest, unknown } = getopt(args, { bool: ['u', 'include-untracked', 'k', 'keep-index', 'q', 'quiet', 'p', 'patch', 'a', 'all'], value: ['m', 'message'], alias: { 'include-untracked': 'u', 'keep-index': 'k', quiet: 'q', message: 'm', all: 'a' } });
        if (unknown.length) throw badOpt(unknown, 'stash');
        const message = opts.m || (sub === 'save' && rest.length ? rest.join(' ') : null);
        return stashPush(g, repo, { message, includeUntracked: Boolean(opts.u || opts.a), keepIndex: Boolean(opts.k), quiet: Boolean(opts.q) });
    }
    if (sub === 'list') {
        const entries = await stashEntries(repo);
        if (entries.length) g.out(entries.map((e, i) => `stash@{${i}}: ${e.message}`).join('\n') + '\n');
        g.info.stashList = entries.length;
        return 0;
    }
    if (sub === 'clear') {
        await writeStashLog(repo, []);
        return 0;
    }
    const { opts, rest } = getopt(args, { bool: ['p', 'patch', 'index', 'q', 'quiet', 'stat'], alias: { patch: 'p', quiet: 'q' } });
    const ref = await stashRef(repo, rest[0]);
    if (ref.error) {
        g.err(ref.error + '\n');
        return 1;
    }
    if (sub === 'show') {
        const w = await repo.readCommit(ref.oid);
        const parentTree = (await repo.readCommit(w.parents[0])).tree;
        const changes = await treeChanges(repo, parentTree, w.tree);
        if (opts.p) {
            let text = '';
            for (const ch of changes) {
                const a = ch.a ? { ...ch.a, bytes: await repo.readBlob(ch.a.oid) } : null;
                const b = ch.b ? { ...ch.b, bytes: await repo.readBlob(ch.b.oid) } : null;
                text += formatFileDiff(ch.path, a, b, { color: g.color });
            }
            g.out(text);
        } else {
            g.out(formatStat(await statsFor(repo, changes), { color: g.color, width: g.columns }));
        }
        return 0;
    }
    if (sub === 'drop') {
        const entries = ref.entries.filter((_, i) => i !== ref.idx);
        await writeStashLog(repo, entries);
        g.out(`Dropped refs/stash@{${ref.idx}} (${ref.oid})\n`);
        g.info.stash = { dropped: ref.oid };
        return 0;
    }
    if (sub === 'apply' || sub === 'pop') {
        return stashApply(g, repo, ref, { pop: sub === 'pop', restoreIndex: Boolean(opts.index), quiet: Boolean(opts.q) });
    }
    if (sub === 'branch') {
        throw new GitError(g.lang === 'de' ? 'git stash branch ist hier nicht verfügbar – nutze git switch -c <name> und dann git stash pop.' : 'git stash branch is not available here – use git switch -c <name>, then git stash pop.', { status: 1, kind: 'unsupported' });
    }
    return 0;
}

export function registerAdvanced(define) {
    define({
        name: 'stash', run: stash, usage: 'git stash [push -m <text>] | list | pop | apply | drop | show',
        summary: D('Legt unfertige Änderungen beiseite (Zwischenablage) und holt sie später zurück.', 'Shelves unfinished changes and brings them back later.'),
        options: [
            { flags: ['(ohne)', 'push'], desc: D('Änderungen beiseitelegen, Arbeitsverzeichnis wird sauber', 'shelve changes, the working tree becomes clean') },
            { flags: ['pop'], desc: D('zuletzt beiseitegelegte Änderungen zurückholen und entfernen', 'bring back the latest stash and remove it') },
            { flags: ['list'], desc: D('alle Einträge anzeigen', 'list all entries') },
            { flags: ['-u'], desc: D('auch neue (unversionierte) Dateien', 'include untracked files') },
        ],
    });
    define({
        name: 'cherry-pick', run: g => sequencerCommand(g, 'cherry-pick'), usage: 'git cherry-pick <commit>…',
        summary: D('Übernimmt die Änderungen einzelner Commits in den aktuellen Branch (als neue Commits).', 'Copies the changes of single commits onto the current branch (as new commits).'),
        options: [{ flags: ['--continue'], desc: D('nach Konfliktlösung weitermachen', 'continue after resolving conflicts') }, { flags: ['--abort'], desc: D('abbrechen', 'abort') }, { flags: ['-x'], desc: D('Herkunft in der Nachricht vermerken', 'record the origin in the message') }],
    });
    define({
        name: 'revert', run: g => sequencerCommand(g, 'revert'), usage: 'git revert <commit>',
        summary: D('Macht einen Commit rückgängig – durch einen NEUEN Commit (Geschichte bleibt erhalten).', 'Undoes a commit – by adding a NEW commit (history is kept).'),
        options: [{ flags: ['--no-edit'], desc: D('Standardnachricht ohne Editor übernehmen', 'use the default message without the editor') }, { flags: ['--continue'], desc: D('nach Konfliktlösung weitermachen', 'continue after resolving conflicts') }, { flags: ['--abort'], desc: D('abbrechen', 'abort') }],
    });
    define({
        name: 'rebase', run: rebase, usage: 'git rebase <basis> | -i <basis> | --continue | --abort',
        summary: D('Setzt deine Commits auf eine neue Basis (schreibt Geschichte um).', 'Replays your commits on a new base (rewrites history).'),
        options: [
            { flags: ['-i'], desc: D('interaktiv: Commits umordnen, zusammenfassen, umbenennen', 'interactive: reorder, squash, reword commits') },
            { flags: ['--continue'], desc: D('nach Konfliktlösung weitermachen', 'continue after resolving conflicts') },
            { flags: ['--abort'], desc: D('alles zurück wie vor dem Rebase', 'go back to before the rebase') },
            { flags: ['--onto'], arg: 'BASIS', desc: D('auf eine andere Basis setzen', 'replay onto another base') },
        ],
        danger: true,
    });
}
