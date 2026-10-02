// git init, status, add, rm, mv, restore, commit, config, clean

import { git } from '../../lib.js';
import { findRepoRoot } from '../repo.js';
import { GitError, fatal } from '../errors.js';
import { computeStatus } from '../status.js';
import { readReflog } from '../reflog.js';
import { compilePathspecs, matchPathspecs } from './pathspec.js';
import { C, paint, requireIdentity, printCommitSummary, trackingInfo, usage } from './common.js';
import { removeWorkFile, writeWorkFile } from '../merge.js';
import { statOrNull, mkdirp, walk as walkFs } from '../../vfs/fsutil.js';
import { getopt } from '../../shell/registry.js';
import { joinPath, shortOid, dirname } from '../../core/util.js';
import { signature } from '../clock.js';
import { globalConfigFile } from '../repo.js';
import { isValidKey } from '../config.js';

const D = (de, en) => ({ de, en });

function badOpt(unknown, cmd) {
    const u = unknown[0];
    const name = u.option.replace(/^-+/, '');
    return usage(`error: unknown ${u.option.startsWith('--') ? 'option' : 'switch'} \`${name}'\nusage: git ${cmd} [<options>]`);
}

// ---- init ----------------------------------------------------------------------------------

async function init(g) {
    const { opts, rest, unknown } = getopt(g.args, { bool: ['bare', 'q', 'quiet'], value: ['b', 'initial-branch'], alias: { 'initial-branch': 'b', quiet: 'q' } });
    if (unknown.length) throw badOpt(unknown, 'init');
    const world = g.world;
    const dir = rest[0] ? world.resolve(rest[0]) : world.cwd;
    if (!world.canWrite(dir)) throw fatal(`cannot mkdir ${rest[0] || dir}: Permission denied`);
    await mkdirp(world.pfs, dir);
    const gitdir = opts.bare ? dir : joinPath(dir, '.git');
    const existed = Boolean(await statOrNull(world.pfs, opts.bare ? joinPath(dir, 'HEAD') : gitdir));
    const parentRepo = existed ? null : await findRepoRoot(world.pfs, dirname(dir));
    let branch = opts.b;
    const cfgBranch = await globalConfigFile(world).get('init.defaultBranch');
    if (!branch) branch = cfgBranch || 'master';
    if (!existed) {
        if (!opts.b && !cfgBranch && !opts.q) {
            g.err(
                "hint: Using 'master' as the name for the initial branch. This default branch name\n" +
                'hint: is subject to change. To configure the initial branch name to use in all\n' +
                'hint: of your new repositories, which will suppress this warning, call:\n' +
                'hint:\n' +
                'hint: \tgit config --global init.defaultBranch <name>\n' +
                'hint:\n' +
                "hint: Names commonly chosen instead of 'master' are 'main', 'trunk' and\n" +
                "hint: 'development'. The just-created branch can be renamed via this command:\n" +
                'hint:\n' +
                'hint: \tgit branch -m <name>\n',
            );
        }
        await git.init({ fs: world.fs, dir, gitdir, bare: Boolean(opts.bare), defaultBranch: branch });
    }
    if (!opts.q) g.out(`${existed ? 'Reinitialized existing' : 'Initialized empty'} Git repository in ${gitdir}/\n`);
    g.info.init = { dir, existed, nestedIn: parentRepo, branch, inHome: dir === world.env.HOME };
    return 0;
}

// ---- status ----------------------------------------------------------------------------------

// "HEAD detached at v1.0" if the checkout target was a ref name, else the short hash
export async function detachedLabel(repo, headOid) {
    const { resolveRefName } = await import('../revparse.js');
    const entries = await readReflog(repo, 'HEAD');
    for (const e of entries) {
        const m = e.message.match(/^checkout: moving from .+ to (.+)$/);
        if (!m) continue;
        const r = await resolveRefName(repo, m[1]);
        const isRefName = r && r.ref !== 'HEAD' && /^refs\/(heads|tags|remotes)\//.test(r.ref);
        const name = isRefName ? m[1] : shortOid(e.new);
        return e.new === headOid ? `HEAD detached at ${name}` : `HEAD detached from ${name}`;
    }
    return `HEAD detached at ${shortOid(headOid)}`;
}

export async function printLongStatus(g, repo, { advice = true, filter = null } = {}) {
    const head = await repo.head();
    const st = await computeStatus(repo, { filter });
    const op = await repo.operation();
    const out = [];
    const green = s => paint(g, C.green, s);
    const red = s => paint(g, C.red, s);
    if (op?.kind === 'rebase') {
        // git ≥ 2.26 always uses the interactive machinery
        out.push(`interactive rebase in progress; onto ${shortOid(op.onto)}`);
        let done = [];
        let todo = [];
        try { done = JSON.parse((await repo.readGitFile('rebase-merge/werkstatt-done.json')) || '[]'); } catch { /* none */ }
        try { todo = JSON.parse((await repo.readGitFile('rebase-merge/werkstatt-todo.json')) || '[]'); } catch { /* none */ }
        const fmt = t => (t.action === 'exec' ? `   exec ${t.command}` : t.action === 'break' ? '   break' : `   ${t.action} ${shortOid(t.oid)} # ${t.subject}`);
        if (done.length) {
            out.push(`Last command${done.length === 1 ? '' : 's'} done (${done.length} command${done.length === 1 ? '' : 's'} done):`);
            out.push(...done.slice(-2).map(fmt));
            if (done.length > 2) out.push('  (see more in file .git/rebase-merge/done)');
        }
        if (todo.length) {
            out.push(`Next command${todo.length === 1 ? '' : 's'} to do (${todo.length} remaining command${todo.length === 1 ? '' : 's'}):`);
            out.push(...todo.slice(0, 2).map(fmt));
            out.push('  (use "git rebase --edit-todo" to view and edit)');
        } else {
            out.push('No commands remaining.');
        }
    } else if (head.branch) {
        out.push(`On branch ${head.branch}`);
    } else {
        out.push(paint(g, C.red, await detachedLabel(repo, head.oid)));
    }
    if (head.branch && !op) {
        const tr = await trackingInfo(repo, head.branch, { advice });
        if (tr) out.push(tr.text.replace(/\n$/, ''));
    }
    if (head.unborn) out.push('', 'No commits yet');
    if (op?.kind === 'merge') {
        if (st.conflicts.length) {
            out.push('You have unmerged paths.');
            if (advice) out.push('  (fix conflicts and run "git commit")', '  (use "git merge --abort" to abort the merge)');
        } else {
            out.push('All conflicts fixed but you are still merging.');
            if (advice) out.push('  (use "git commit" to conclude merge)');
        }
    } else if (op?.kind === 'cherry-pick' || op?.kind === 'revert') {
        const verb = op.kind === 'cherry-pick' ? 'cherry-picking' : 'reverting';
        out.push(`You are currently ${verb} commit ${shortOid(op.oid)}.`);
        if (advice) {
            if (st.conflicts.length) out.push(`  (fix conflicts and run "git ${op.kind} --continue")`);
            else out.push(`  (all conflicts fixed: run "git ${op.kind} --continue")`);
            out.push(`  (use "git ${op.kind} --skip" to skip this patch)`, `  (use "git ${op.kind} --abort" to cancel the ${op.kind} operation)`);
        }
    } else if (op?.kind === 'rebase') {
        out.push(`You are currently rebasing branch '${op.branch}' on '${shortOid(op.onto)}'.`);
        if (advice) {
            if (st.conflicts.length) out.push('  (fix conflicts and then run "git rebase --continue")');
            else out.push('  (all conflicts fixed: run "git rebase --continue")');
            out.push('  (use "git rebase --skip" to skip this patch)', '  (use "git rebase --abort" to check out the original branch)');
        }
    }
    // Like git's wt_status.c: tracking info, the state block and "No commits yet" are followed
    // by a blank line, and so is every section – but nothing separates "On branch …" from a
    // section that follows it directly.
    // git shows no "to unstage" hints while a merge or cherry-pick is in progress (whence != FROM_COMMIT)
    const canUnstage = op?.kind !== 'merge' && op?.kind !== 'cherry-pick';
    const section = title => {
        if (out.length > 1) out.push('');
        out.push(title);
    };
    if (st.staged.length) {
        section('Changes to be committed:');
        if (advice && canUnstage) out.push(head.unborn ? '  (use "git rm --cached <file>..." to unstage)' : '  (use "git restore --staged <file>..." to unstage)');
        for (const s of st.staged) out.push(green(`\t${(s.kind + ':').padEnd(12)}${s.from ? repo.displayPath(s.from) + ' -> ' : ''}${repo.displayPath(s.path)}`));
    }
    if (st.conflicts.length) {
        section('Unmerged paths:');
        const needsRm = st.conflicts.some(c => c.kind === 'modify/delete' || c.kind === 'delete/modify');
        if (advice && canUnstage) out.push(head.unborn ? '  (use "git rm --cached <file>..." to unstage)' : '  (use "git restore --staged <file>..." to unstage)');
        if (advice) out.push(needsRm ? '  (use "git add/rm <file>..." as appropriate to mark resolution)' : '  (use "git add <file>..." to mark resolution)');
        for (const c of st.conflicts) out.push(red(`\t${(c.label + ':').padEnd(17)}${repo.displayPath(c.path)}`));
    }
    if (st.unstaged.length) {
        section('Changes not staged for commit:');
        if (advice) {
            const hasDel = st.unstaged.some(u => u.kind === 'deleted');
            out.push(hasDel ? '  (use "git add/rm <file>..." to update what will be committed)' : '  (use "git add <file>..." to update what will be committed)');
            out.push('  (use "git restore <file>..." to discard changes in working directory)');
        }
        for (const u of st.unstaged) out.push(red(`\t${(u.kind + ':').padEnd(12)}${repo.displayPath(u.path)}`));
    }
    if (st.untracked.length) {
        section('Untracked files:');
        if (advice) out.push('  (use "git add <file>..." to include in what will be committed)');
        for (const u of st.untracked) out.push(red(`\t${repo.displayPath(u.replace(/\/$/, '')) + (u.endsWith('/') ? '/' : '')}`));
    }
    if (out.length > 1) out.push('');
    if (!st.staged.length) {
        if (st.unstaged.length || st.conflicts.length) out.push('no changes added to commit (use "git add" and/or "git commit -a")');
        else if (st.untracked.length) out.push('nothing added to commit but untracked files present (use "git add" to track)');
        else if (!st.conflicts.length && op?.kind !== 'merge') out.push(head.unborn ? 'nothing to commit (create/copy files and use "git add" to track)' : 'nothing to commit, working tree clean');
    }
    // without a closing message (something is staged) git's output ends with the section's blank line
    g.out(out.join('\n') + '\n');
    return st;
}

async function status(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['s', 'short', 'b', 'branch', 'porcelain', 'long', 'v'],
        value: ['u', 'untracked-files'],
        alias: { short: 's', branch: 'b', 'untracked-files': 'u' },
    });
    if (unknown.length) throw badOpt(unknown, 'status');
    const repo = g.repo;
    const specs = rest.length ? compilePathspecs(repo, rest) : null;
    const filter = specs ? p => specs.some(s => s.test(p)) : null;
    if (opts.s || opts.porcelain) {
        const head = await repo.head();
        const st = await computeStatus(repo, { filter });
        const lines = [];
        if (opts.b) {
            let line = '## ';
            if (head.unborn) line += `No commits yet on ${head.branch}`;
            else if (!head.branch) line += 'HEAD (no branch)';
            else {
                line += paint(g, C.green, head.branch);
                const tr = await trackingInfo(repo, head.branch, { advice: false });
                if (tr && !tr.gone) {
                    line += '...' + paint(g, C.red, tr.up.display);
                    const parts = [];
                    if (tr.ahead) parts.push(`ahead ${paint(g, C.green, String(tr.ahead))}`);
                    if (tr.behind) parts.push(`behind ${paint(g, C.red, String(tr.behind))}`);
                    if (parts.length) line += ` [${parts.join(', ')}]`;
                } else if (tr?.gone) {
                    line += '...' + paint(g, C.red, tr.up.display) + ' [gone]';
                }
            }
            lines.push(line);
        }
        const shown = new Set();
        for (const e of st.entries) {
            if (e.x === '?') continue;
            const x = e.conflict ? paint(g, C.red, e.x) : paint(g, C.green, e.x);
            const y = paint(g, C.red, e.y);
            lines.push(`${e.x === ' ' ? ' ' : x}${e.y === ' ' ? ' ' : y} ${e.from ? repo.displayPath(e.from) + ' -> ' : ''}${repo.displayPath(e.path)}`);
            shown.add(e.path);
        }
        for (const u of st.untracked) lines.push(`${paint(g, C.red, '??')} ${repo.displayPath(u.replace(/\/$/, '')) + (u.endsWith('/') ? '/' : '')}`);
        if (lines.length) g.out(lines.join('\n') + '\n');
        return 0;
    }
    const st = await printLongStatus(g, repo, { filter });
    g.info.status = { clean: st.clean };
    return 0;
}

// ---- add / rm / mv ----------------------------------------------------------------------------

async function add(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['A', 'all', 'u', 'update', 'f', 'force', 'n', 'dry-run', 'v', 'verbose', 'p', 'patch', 'i', 'interactive', 'N', 'intent-to-add'],
        alias: { all: 'A', update: 'u', force: 'f', 'dry-run': 'n', verbose: 'v', patch: 'p', interactive: 'i', 'intent-to-add': 'N' },
    });
    if (unknown.length) throw badOpt(unknown, 'add');
    if (opts.p || opts.i) {
        throw new GitError(g.lang === 'de'
            ? 'git add -p (Teile einer Datei vormerken) gibt es in der Werkstatt nicht.\nTipp: Teile die Änderung auf mehrere Commits auf, indem du die Datei schrittweise bearbeitest.'
            : 'git add -p (staging parts of a file) is not available in the Werkstatt.\nTip: split the change into several commits by editing the file step by step.', { status: 1, kind: 'unsupported' });
    }
    const repo = g.repo;
    let specs = rest;
    if (!specs.length && !opts.A && !opts.u) {
        g.err("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\nhint: Disable this message with \"git config set advice.addEmptyPathspec false\"\n");
        g.info.nothingSpecified = true;
        return 0;
    }
    if (!specs.length) specs = [repo.dir];
    const compiled = compilePathspecs(repo, specs);
    const rows = await repo.statusMatrix();
    const conflicts = await repo.conflicts();
    const candidates = rows.map(r => r[0]);
    // ignored files only show up when named explicitly
    const ignoredHits = [];
    for (const c of compiled) {
        if (c.all) continue;
        const abs = joinPath(repo.dir, c.rel);
        const st = await statOrNull(repo.pfs, abs);
        const knownBelow = candidates.some(p => p === c.rel || p.startsWith(c.rel + '/'));
        if (st && !knownBelow && await repo.isIgnored(c.rel)) ignoredHits.push(c);
    }
    const { matched, unmatched } = matchPathspecs(compiled, [...candidates, ...Object.keys(conflicts)]);
    const realUnmatched = unmatched.filter(s => !ignoredHits.some(c => c.spec === s));
    if (realUnmatched.length) {
        throw new GitError(`fatal: pathspec '${realUnmatched[0]}' did not match any files`, { status: 128, kind: 'pathspec' });
    }
    if (ignoredHits.length && !opts.f) {
        g.err('The following paths are ignored by one of your .gitignore files:\n' +
            ignoredHits.map(c => c.rel).join('\n') +
            '\nhint: Use -f if you really want to add them.\nhint: Disable this message with "git config set advice.addIgnoredFile false"\n');
        g.info.ignored = ignoredHits.map(c => c.rel);
        if (!matched.size) return 1;
    }
    const byPath = new Map(rows.map(r => [r[0], r]));
    const added = [];
    const removed = [];
    for (const path of [...matched].sort()) {
        const row = byPath.get(path);
        const [, H, W, S] = row || [path, 0, 2, 0];
        if (opts.u && H === 0 && S === 0) continue; // -u: tracked files only
        if (W === 0) {
            if (S !== 0) removed.push(path);
            continue;
        }
        const isConflict = Boolean(conflicts[path]);
        if (!isConflict && ((H === 1 && W === 1 && S === 1) || S === 2)) continue; // nothing new to stage
        added.push(path);
    }
    if (opts.f) for (const c of ignoredHits) added.push(c.rel);
    for (const path of added) {
        if (opts.n || opts.v) g.out(`add '${path}'\n`);
        if (!opts.n) await git.add({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, force: Boolean(opts.f), cache: repo.cache });
    }
    for (const path of removed) {
        if (opts.n || opts.v) g.out(`remove '${path}'\n`);
        if (!opts.n) await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
    }
    if (!opts.n) {
        let changed = false;
        for (const path of [...added, ...removed]) {
            if (conflicts[path]) {
                delete conflicts[path];
                changed = true;
                const text = await repo.workText(path);
                if (text && /^(<<<<<<<|=======|>>>>>>>)( |$)/m.test(text)) (g.info.markersLeft ||= []).push(path);
            }
        }
        if (changed) await repo.setConflicts(conflicts);
    }
    g.info.added = added;
    g.info.removed = removed;
    return 0;
}

async function rm(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['r', 'f', 'force', 'n', 'dry-run', 'q', 'quiet', 'cached'],
        alias: { force: 'f', 'dry-run': 'n', quiet: 'q' },
    });
    if (unknown.length) throw badOpt(unknown, 'rm');
    if (!rest.length) throw usage('usage: git rm [-f | --force] [-n] [-r] [--cached] [--ignore-unmatch]\n              [--quiet] [--pathspec-from-file=<file> [--pathspec-file-nul]]\n              [--] [<pathspec>...]');
    const repo = g.repo;
    const compiled = compilePathspecs(repo, rest);
    const indexFiles = await repo.indexFiles();
    const conflicts = await repo.conflicts();
    const tracked = [...new Set([...indexFiles, ...Object.keys(conflicts)])];
    const { matched, unmatched } = matchPathspecs(compiled, tracked);
    if (unmatched.length) throw new GitError(`fatal: pathspec '${unmatched[0]}' did not match any files`, { status: 128, kind: 'pathspec' });
    const paths = [...matched].sort();
    if (!opts.r) {
        for (const c of compiled) {
            const isDirSpec = c.all || (!paths.includes(c.rel) && paths.some(p => p.startsWith(c.rel + '/')));
            if (isDirSpec) throw fatal(`not removing '${c.all ? '.' : c.rel}' recursively without -r`);
        }
    }
    if (!opts.f) {
        const rows = new Map((await repo.statusMatrix(paths)).map(r => [r[0], r]));
        const both = [];
        const staged = [];
        const modified = [];
        for (const p of paths) {
            const r = rows.get(p);
            if (!r || conflicts[p]) continue;
            const [, H, W, S] = r;
            const indexDiffersFromHead = H === 0 ? S !== 0 : S !== 1;
            const workDiffersFromIndex = W !== 0 && (S === 3 || (S === 1 && W === 2));
            if (S === 3) both.push(p);
            else if (!opts.cached && indexDiffersFromHead) staged.push(p);
            else if (!opts.cached && workDiffersFromIndex) modified.push(p);
        }
        const fail = (what, list, hint) => {
            const many = list.length > 1;
            throw new GitError(
                `error: the following file${many ? 's have' : ' has'} ${what}:\n` + list.map(p => `    ${p}`).join('\n') + `\n${hint}`,
                { status: 1, kind: 'rm-local-changes', data: { files: list } },
            );
        };
        if (both.length) fail('staged content different from both the\nfile and the HEAD', both, '(use -f to force removal)');
        if (staged.length) fail('changes staged in the index', staged, '(use --cached to keep the file, or -f to force removal)');
        if (modified.length) fail('local modifications', modified, '(use --cached to keep the file, or -f to force removal)');
    }
    for (const p of paths) {
        if (!opts.q) g.out(`rm '${p}'\n`);
        if (opts.n) continue;
        await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: p, cache: repo.cache });
        if (conflicts[p]) await repo.resolveConflict(p);
        if (!opts.cached) await removeWorkFile(repo, p);
    }
    g.info.removed = paths;
    g.info.cached = Boolean(opts.cached);
    return 0;
}

async function mv(g) {
    const { opts, rest, unknown } = getopt(g.args, { bool: ['f', 'force', 'n', 'dry-run', 'k', 'v', 'verbose'], alias: { force: 'f', 'dry-run': 'n', verbose: 'v' } });
    if (unknown.length) throw badOpt(unknown, 'mv');
    if (rest.length < 2) throw usage('usage: git mv [<options>] <source>... <destination>');
    const repo = g.repo;
    const sources = rest.slice(0, -1);
    const destSpec = rest[rest.length - 1];
    const destRel = repo.toRepoPath(destSpec);
    if (destRel === null) throw fatal(`'${destSpec}' is outside repository at '${repo.dir}'`);
    const destAbs = joinPath(repo.dir, destRel);
    const destStat = await statOrNull(repo.pfs, destAbs);
    const destIsDir = Boolean(destStat && destStat.isDirectory());
    if (sources.length > 1 && !destIsDir) throw fatal(`destination '${destSpec}' is not a directory`);
    const indexFiles = new Set(await repo.indexFiles());
    const moves = [];
    for (const src of sources) {
        const srcRel = repo.toRepoPath(src);
        if (srcRel === null) throw fatal(`'${src}' is outside repository at '${repo.dir}'`);
        const srcStat = await statOrNull(repo.pfs, joinPath(repo.dir, srcRel));
        const target = destIsDir ? (destRel ? `${destRel}/${srcRel.split('/').pop()}` : srcRel.split('/').pop()) : destRel;
        if (!srcStat) throw fatal(`bad source, source=${src}, destination=${destSpec}`);
        if (srcStat.isDirectory()) {
            const files = [...indexFiles].filter(f => f.startsWith(srcRel + '/'));
            if (!files.length) throw fatal(`source directory is empty, source=${src}, destination=${destSpec}`);
            for (const f of files) moves.push([f, target + f.slice(srcRel.length)]);
            continue;
        }
        if (!indexFiles.has(srcRel)) throw fatal(`not under version control, source=${src}, destination=${destSpec}`);
        if (!destIsDir && destStat && !opts.f) throw fatal(`destination exists, source=${src}, destination=${destSpec}`);
        moves.push([srcRel, target]);
    }
    for (const [from, to] of moves) {
        if (opts.v || opts.n) g.out(`Renaming ${from} to ${to}\n`);
        if (opts.n) continue;
        const bytes = await repo.pfs.readFile(joinPath(repo.dir, from));
        const st = await statOrNull(repo.pfs, joinPath(repo.dir, from));
        await writeWorkFile(repo, to, bytes, st && (st.mode & 0o111) ? '100755' : '100644');
        await removeWorkFile(repo, from);
        await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: from, cache: repo.cache });
        await git.add({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: to, cache: repo.cache });
    }
    g.info.moved = moves;
    return 0;
}

// ---- restore ----------------------------------------------------------------------------------

async function restore(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['S', 'staged', 'W', 'worktree', 'ours', 'theirs', 'q', 'quiet', 'p', 'patch'],
        value: ['s', 'source'],
        alias: { staged: 'S', worktree: 'W', source: 's', quiet: 'q', patch: 'p' },
    });
    if (unknown.length) throw badOpt(unknown, 'restore');
    if (!rest.length) throw fatal('you must specify path(s) to restore');
    const repo = g.repo;
    const staged = Boolean(opts.S);
    const worktree = Boolean(opts.W) || !staged;
    const head = await repo.head();
    const { resolveCommit } = await import('../revparse.js');
    let sourceOid = null;
    if (opts.s) {
        sourceOid = await resolveCommit(repo, opts.s);
        if (!sourceOid) throw fatal(`could not resolve ${opts.s}`);
    }
    const compiled = compilePathspecs(repo, rest);
    const headFlat = head.oid ? await repo.flatTree((await repo.readCommit(head.oid)).tree) : new Map();
    const sourceFlat = sourceOid ? await repo.flatTree((await repo.readCommit(sourceOid)).tree) : null;
    const indexFlat = await repo.indexFlat();
    const conflicts = await repo.conflicts();
    // the default source of `git restore <file>` is the index; --staged / --source look at a commit
    const candidates = new Set([...indexFlat.keys(), ...Object.keys(conflicts)]);
    if (staged || sourceFlat) for (const p of [...headFlat.keys(), ...(sourceFlat ? sourceFlat.keys() : [])]) candidates.add(p);
    const { matched, unmatched } = matchPathspecs(compiled, [...candidates]);
    let status = 0;
    for (const s of unmatched) {
        g.err(`error: pathspec '${s}' did not match any file(s) known to git\n`);
        status = 1;
    }
    if (status) return status;
    const restored = [];
    for (const path of [...matched].sort()) {
        if (worktree && conflicts[path] && !opts.ours && !opts.theirs && !staged) {
            g.err(`error: path '${path}' is unmerged\n`);
            status = 1;
            continue;
        }
        if (staged) {
            const src = sourceFlat || headFlat;
            const entry = src.get(path);
            if (entry) {
                await git.updateIndex({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, oid: entry.oid, mode: parseInt(entry.mode, 8), add: true, cache: repo.cache });
            } else {
                await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
            }
            if (conflicts[path]) await repo.resolveConflict(path);
        }
        if (worktree) {
            let entry;
            if (opts.ours || opts.theirs) {
                const c = conflicts[path];
                const oid = c ? (opts.ours ? c.ours : c.theirs) : null;
                if (c && !oid) { g.err(`error: path '${path}' does not have ${opts.ours ? 'our' : 'their'} version\n`); status = 1; continue; }
                entry = oid ? { oid, mode: '100644' } : indexFlat.get(path);
            } else if (sourceFlat || staged) {
                entry = (sourceFlat || headFlat).get(path);
            } else {
                entry = indexFlat.get(path);
            }
            if (entry) await writeWorkFile(repo, path, await repo.readBlob(entry.oid), entry.mode);
            else await removeWorkFile(repo, path);
        }
        restored.push(path);
    }
    repo.invalidate();
    g.info.restored = restored;
    g.info.mode = { staged, worktree, source: opts.s || null };
    return status;
}

// ---- commit -----------------------------------------------------------------------------------

function cleanupMessage(text, { stripComments }) {
    let lines = text.replace(/\r/g, '').split('\n');
    if (stripComments) {
        const cut = lines.findIndex(l => /^# -+ >8 -+$/.test(l));
        if (cut !== -1) lines = lines.slice(0, cut);
        lines = lines.filter(l => !l.startsWith('#'));
    }
    lines = lines.map(l => l.replace(/\s+$/, ''));
    const out = [];
    for (const l of lines) {
        if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
        out.push(l);
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.length ? out.join('\n') + '\n' : '';
}

async function commitTemplate(repo, { initial = '', amend = false } = {}) {
    const head = await repo.head();
    const st = await computeStatus(repo);
    const lines = [];
    lines.push(initial.replace(/\n+$/, ''), '');
    const op = await repo.operation();
    if (op?.kind === 'merge') {
        lines.push('# It looks like you may be committing a merge.', '# If this is not correct, please run', '#\tgit update-ref -d MERGE_HEAD', '# and try again.', '', '');
    }
    lines.push(
        '# Please enter the commit message for your changes. Lines starting',
        "# with '#' will be ignored, and an empty message aborts the commit.",
        '#',
    );
    if (amend) {
        const c = await repo.readCommit(head.oid);
        const { formatGitDate } = await import('../../core/util.js');
        lines.push(`# Date:      ${formatGitDate(c.author.timestamp, c.author.timezoneOffset)}`, '#');
    }
    lines.push(head.branch ? `# On branch ${head.branch}` : `# HEAD detached at ${shortOid(head.oid)}`);
    if (head.unborn) lines.push('#', '# Initial commit');
    if (st.staged.length) {
        lines.push('#', '# Changes to be committed:');
        for (const s of st.staged) lines.push(`#\t${(s.kind + ':').padEnd(12)}${s.from ? s.from + ' -> ' : ''}${s.path}`);
    }
    if (st.unstaged.length) {
        lines.push('#', '# Changes not staged for commit:');
        for (const s of st.unstaged) lines.push(`#\t${(s.kind + ':').padEnd(12)}${s.path}`);
    }
    if (st.untracked.length) {
        lines.push('#', '# Untracked files:');
        for (const u of st.untracked) lines.push(`#\t${u}`);
    }
    lines.push('#');
    return lines.join('\n') + '\n';
}

export async function editMessage(g, repo, template, { kind = 'commit' } = {}) {
    await repo.writeGitFile('COMMIT_EDITMSG', template);
    if (!g.ui?.edit || g.ctx.inPipe) {
        return null;
    }
    g.err('hint: Waiting for your editor to close the file... ');
    const res = await g.ui.edit(joinPath(repo.gitdir, 'COMMIT_EDITMSG'), { blocking: true, kind });
    g.err('\n');
    if (!res || !res.saved) {
        // closing without saving keeps the template → still a valid message if one was prefilled
        const text = await repo.readGitFile('COMMIT_EDITMSG');
        return text;
    }
    return res.content ?? (await repo.readGitFile('COMMIT_EDITMSG'));
}

export async function createCommit(g, repo, { message, amend = false, extraParents = [], quiet = false, tree = null, reflog = null, showDate = false }) {
    const identity = await requireIdentity(repo);
    const head = await repo.head();
    let parents;
    let author = signature(identity);
    if (amend) {
        const old = await repo.readCommit(head.oid);
        parents = old.parents;
        author = old.author;
    } else {
        parents = head.oid ? [head.oid, ...extraParents] : [...extraParents];
    }
    const committer = signature(identity);
    const oid = await git.commit({
        fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, cache: repo.cache,
        message, author, committer, parent: parents, noUpdateBranch: true,
        ...(tree ? { tree } : {}),
    });
    if (head.unborn) await git.writeRef({ fs: repo.fs, gitdir: repo.gitdir, ref: head.ref, value: oid, force: true });
    else await repo.moveHead(oid);
    repo.invalidate();
    const subject = message.split('\n')[0];
    g.reflogMessage = reflog || (head.unborn ? `commit (initial): ${subject}` : amend ? `commit (amend): ${subject}` : extraParents.length ? `commit (merge): ${subject}` : `commit: ${subject}`);
    if (!quiet) await printCommitSummary(g, repo, oid, { root: !parents.length, showDate: amend || showDate });
    return oid;
}

async function commit(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['a', 'all', 'amend', 'no-edit', 'allow-empty', 'allow-empty-message', 'q', 'quiet', 'v', 'verbose', 'n', 'no-verify', 'e', 'edit', 'only', 'include'],
        value: ['m', 'message', 'F', 'file', 'C', 'reuse-message', 'author', 'date'],
        alias: { all: 'a', message: 'm', file: 'F', quiet: 'q', verbose: 'v', edit: 'e', 'reuse-message': 'C' },
        multi: ['m'],
    });
    if (unknown.length) throw badOpt(unknown, 'commit');
    const repo = g.repo;
    const conflicts = await repo.conflicts();
    if (Object.keys(conflicts).length) {
        // git's index refresh lists unmerged paths first (on stdout)
        g.out(Object.keys(conflicts).sort().map(p => `U\t${repo.displayPath(p)}`).join('\n') + '\n');
        throw new GitError(
            'error: Committing is not possible because you have unmerged files.\n' +
            "hint: Fix them up in the work tree, and then use 'git add/rm <file>'\n" +
            'hint: as appropriate to mark resolution and make a commit.\n' +
            'fatal: Exiting because of an unresolved conflict.',
            { status: 128, kind: 'unresolved-conflicts', data: { files: Object.keys(conflicts) } },
        );
    }
    await requireIdentity(repo);
    const head = await repo.head();
    if (opts.amend && head.unborn) throw fatal('You have nothing to amend.');
    const op = await repo.operation();
    if (op?.kind === 'rebase' || op?.kind === 'cherry-pick' || op?.kind === 'revert') {
        g.info.duringOperation = op.kind;
    }
    if (opts.a && rest.length) throw fatal('paths with -a does not make sense.');

    // -a: stage tracked modifications and deletions
    if (opts.a) {
        for (const [path, H, W, S] of await repo.statusMatrix()) {
            if (H === 0 && S === 0) continue;
            if (W === 0) await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
            else if (W === 2 && S !== 2) await git.add({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
        }
        repo.invalidate();
    }

    // commit only the named paths (git's default --only behaviour)
    let tree = null;
    if (rest.length) {
        const compiled = compilePathspecs(repo, rest);
        const rows = await repo.statusMatrix();
        const tracked = rows.filter(r => r[1] || r[3]).map(r => r[0]);
        const { matched, unmatched } = matchPathspecs(compiled, tracked);
        if (unmatched.length) throw new GitError(`error: pathspec '${unmatched[0]}' did not match any file(s) known to git`, { status: 1, kind: 'pathspec' });
        const base = head.oid ? await repo.flatTree((await repo.readCommit(head.oid)).tree) : new Map();
        for (const path of matched) {
            const bytes = await repo.workBytes(path);
            if (bytes === null) {
                base.delete(path);
                await git.remove({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
            } else {
                await git.add({ fs: repo.fs, dir: repo.dir, gitdir: repo.gitdir, filepath: path, cache: repo.cache });
                const entry = (await repo.indexFlat()).get(path);
                base.set(path, entry);
            }
        }
        tree = await repo.writeFlatTree(base);
    }

    // anything to commit?
    const mergeHead = op?.kind === 'merge' ? op.oid : null;
    if (!opts.amend && !mergeHead && !opts['allow-empty']) {
        let empty;
        if (tree) {
            empty = head.oid && (await repo.readCommit(head.oid)).tree === tree;
        } else {
            const st = await computeStatus(repo);
            empty = st.staged.length === 0;
        }
        if (empty) {
            await printLongStatus(g, repo);
            g.info.nothingToCommit = true;
            return 1;
        }
    }

    // message
    let message;
    const editorWanted = !opts.m && !opts.F && !opts.C && !(opts['no-edit'] && (opts.amend || mergeHead));
    if (opts.m) message = cleanupMessage(opts.m.join('\n\n'), { stripComments: false });
    else if (opts.F) {
        const text = await g.world.pfs.readFile(g.world.resolve(opts.F), 'utf8').catch(() => null);
        if (text === null) throw fatal(`could not read log file '${opts.F}': No such file or directory`);
        message = cleanupMessage(text, { stripComments: false });
    } else if (opts.C) {
        const { resolveCommit } = await import('../revparse.js');
        const oid = await resolveCommit(repo, opts.C);
        if (!oid) throw fatal(`could not lookup commit '${opts.C}'`);
        message = (await repo.readCommit(oid)).message;
    } else if (!editorWanted) {
        // without an editor git only cleans up whitespace – "# Conflicts:" lines stay in the message
        message = opts.amend ? (await repo.readCommit(head.oid)).message : ((await repo.readGitFile('MERGE_MSG')) || `Merge commit '${shortOid(mergeHead)}'\n`);
        message = cleanupMessage(message, { stripComments: false });
    } else {
        const initial = opts.amend ? (await repo.readCommit(head.oid)).message
            : mergeHead ? ((await repo.readGitFile('MERGE_MSG')) || '')
                : op?.kind === 'cherry-pick' || op?.kind === 'revert' ? ((await repo.readGitFile('MERGE_MSG')) || '') : '';
        const text = await editMessage(g, repo, await commitTemplate(repo, { initial, amend: opts.amend }));
        if (text === null) {
            throw new GitError(g.lang === 'de'
                ? 'error: Kein Editor verfügbar. Nutze git commit -m "Nachricht".'
                : 'error: no editor available here. Use git commit -m "message".', { status: 1, kind: 'no-editor' });
        }
        message = cleanupMessage(text, { stripComments: true });
        g.info.usedEditor = true;
    }
    if (!message && !opts['allow-empty-message']) {
        g.err('Aborting commit due to empty commit message.\n');
        g.info.emptyMessage = true;
        return 1;
    }
    await repo.writeGitFile('COMMIT_EDITMSG', message);
    const oid = await createCommit(g, repo, {
        message,
        amend: Boolean(opts.amend),
        extraParents: mergeHead ? [mergeHead] : [],
        quiet: Boolean(opts.q),
        tree,
        showDate: Boolean(opts.C),
    });
    if (mergeHead) {
        for (const f of ['MERGE_HEAD', 'MERGE_MSG', 'MERGE_MODE']) await repo.removeGitFile(f);
    }
    if (op?.kind === 'cherry-pick') await repo.removeGitFile('CHERRY_PICK_HEAD');
    if (op?.kind === 'revert') await repo.removeGitFile('REVERT_HEAD');
    g.info.commit = { oid, amend: Boolean(opts.amend), merge: Boolean(mergeHead), message };
    return 0;
}

// ---- config -----------------------------------------------------------------------------------

async function config(g) {
    let args = [...g.args];
    // modern syntax: git config get|set|unset|list …
    const verb = ['get', 'set', 'unset', 'list'].includes(args[0]) ? args.shift() : null;
    const { opts, rest, unknown } = getopt(args, {
        bool: ['global', 'local', 'system', 'l', 'list', 'unset', 'unset-all', 'get', 'get-all', 'add', 'show-origin', 'e', 'edit', 'replace-all'],
        alias: { list: 'l', edit: 'e' },
    });
    if (unknown.length) throw badOpt(unknown, 'config');
    if (opts.system) throw new GitError('error: could not lock config file /etc/gitconfig: Permission denied', { status: 255 });
    if (opts.e) throw new GitError(g.lang === 'de' ? 'Tipp: Öffne die Datei direkt, z. B. mit: nano ~/.gitconfig' : 'Tip: open the file directly, e.g. with: nano ~/.gitconfig', { status: 1, kind: 'unsupported' });
    const repo = g.repo;
    const globalCfg = globalConfigFile(g.world);
    const localCfg = repo ? repo.repoConfig() : null;
    const target = opts.global ? globalCfg : localCfg;
    const listMode = opts.l || verb === 'list';
    if (listMode) {
        const show = async (cfg, origin) => {
            for (const e of await cfg.entries()) g.out(`${opts['show-origin'] ? `file:${origin}\t` : ''}${e.section}.${e.key}=${e.value}\n`);
        };
        if (!opts.local) await show(globalCfg, '/home/student/.gitconfig');
        if (!opts.global && localCfg) await show(localCfg, '.git/config');
        if (opts.local && !localCfg) throw fatal('--local can only be used inside a git repository');
        return 0;
    }
    const key = rest[0];
    if (!key) throw usage('usage: git config [<options>]\n\nConfig file location\n    --[no-]global         use global config file\n    --[no-]local          use repository config file');
    if (!key.includes('.')) {
        g.err(`error: key does not contain a section: ${key}\n`);
        return 2;
    }
    if (!isValidKey(key)) {
        g.err(`error: invalid key: ${key}\n`);
        return 1;
    }
    const isSet = verb === 'set' || (!verb && rest.length >= 2 && !opts.get && !opts.unset && !opts['unset-all']);
    if (opts.unset || opts['unset-all'] || verb === 'unset') {
        const cfg = target || globalCfg;
        if (!target && !opts.global) throw fatal('not in a git directory');
        const existed = await cfg.set(key, undefined);
        g.info.config = { key, value: null, global: Boolean(opts.global) };
        return existed ? 0 : 5;
    }
    if (isSet) {
        if (!target) throw fatal('not in a git directory');
        const value = rest.slice(1).join(' ');
        await target.set(key, value);
        g.info.config = { key, value, global: Boolean(opts.global) };
        return 0;
    }
    // get
    let value;
    if (opts.global) value = await globalCfg.get(key);
    else if (opts.local) value = localCfg ? await localCfg.get(key) : undefined;
    else value = (localCfg && await localCfg.get(key)) ?? await globalCfg.get(key);
    if (value === undefined) return 1;
    g.out(value + '\n');
    return 0;
}

// ---- clean -----------------------------------------------------------------------------------

async function clean(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['d', 'f', 'force', 'n', 'dry-run', 'x', 'X', 'q', 'quiet', 'i', 'interactive'],
        alias: { force: 'f', 'dry-run': 'n', quiet: 'q', interactive: 'i' },
    });
    if (unknown.length) throw badOpt(unknown, 'clean');
    if (!opts.f && !opts.n) {
        throw fatal('clean.requireForce is true and -f not given: refusing to clean', { kind: 'clean-require-force' });
    }
    const repo = g.repo;
    const compiled = rest.length ? compilePathspecs(repo, rest) : null;
    const rows = await repo.statusMatrix();
    const tracked = new Set(rows.filter(r => r[1] || r[3]).map(r => r[0]));
    const untracked = rows.filter(r => !r[1] && !r[3] && r[2]).map(r => r[0]);
    const ignored = [];
    if (opts.x || opts.X) {
        const all = await walkFs(repo.pfs, repo.dir, { skip: name => name === '.git' });
        for (const f of all) {
            if (tracked.has(f.rel) || untracked.includes(f.rel)) continue;
            if (await repo.isIgnored(f.rel)) ignored.push(f.rel);
        }
    }
    let candidates = opts.X ? ignored : opts.x ? [...untracked, ...ignored] : untracked;
    if (compiled) candidates = candidates.filter(p => compiled.some(c => c.test(p)));
    const trackedDirs = new Set();
    for (const p of tracked) {
        const parts = p.split('/');
        for (let i = 1; i < parts.length; i++) trackedDirs.add(parts.slice(0, i).join('/'));
    }
    const items = new Set();
    for (const p of candidates) {
        const parts = p.split('/');
        let item = p;
        for (let i = 1; i < parts.length; i++) {
            const dir = parts.slice(0, i).join('/');
            if (!trackedDirs.has(dir)) { item = dir + '/'; break; }
        }
        if (item.endsWith('/') && !opts.d) continue;
        items.add(item);
    }
    const sorted = [...items].sort();
    for (const item of sorted) {
        const shown = repo.displayPath(item.replace(/\/$/, '')) + (item.endsWith('/') ? '/' : '');
        if (opts.n) { g.out(`Would remove ${shown}\n`); continue; }
        if (!opts.q) g.out(`Removing ${shown}\n`);
        const { rmrf } = await import('../../vfs/fsutil.js');
        await rmrf(repo.pfs, joinPath(repo.dir, item.replace(/\/$/, '')));
    }
    g.info.cleaned = opts.n ? [] : sorted;
    g.info.dryRun = Boolean(opts.n);
    return 0;
}

export function registerBasic(define) {
    define({
        name: 'init', repo: false, run: init, usage: 'git init [-b <branch>] [<directory>]',
        summary: D('Legt ein neues, leeres Repository an (Ordner .git).', 'Creates a new, empty repository (.git folder).'),
        options: [{ flags: ['-b'], arg: 'NAME', desc: D('Name des ersten Branches', 'name of the initial branch') }, { flags: ['--bare'], desc: D('Repository ohne Arbeitsverzeichnis (wie auf einem Server)', 'repository without a working tree (like on a server)') }],
    });
    define({
        name: 'status', run: status, usage: 'git status [-s] [-b]',
        summary: D('Zeigt, was sich geändert hat und was vorgemerkt ist.', 'Shows what changed and what is staged.'),
        options: [{ flags: ['-s', '--short'], desc: D('Kurzformat: zwei Buchstaben pro Datei', 'short format: two letters per file') }, { flags: ['-b'], desc: D('mit Branch-Zeile (im Kurzformat)', 'with branch line (short format)') }],
    });
    define({
        name: 'add', run: add, mutates: true, usage: 'git add <datei>…  |  git add .  |  git add -A',
        summary: D('Merkt Änderungen für den nächsten Commit vor (Staging).', 'Stages changes for the next commit.'),
        options: [{ flags: ['.'], desc: D('alles im aktuellen Ordner (und darunter)', 'everything in the current folder (and below)') }, { flags: ['-A', '--all'], desc: D('alle Änderungen im ganzen Repository', 'all changes in the whole repository') }, { flags: ['-u'], desc: D('nur schon versionierte Dateien', 'only already tracked files') }, { flags: ['-n'], desc: D('nur anzeigen, was passieren würde', 'only show what would happen') }],
    });
    define({
        name: 'rm', run: rm, mutates: true, usage: 'git rm [--cached] [-r] <datei>…',
        summary: D('Löscht Dateien und merkt das Löschen vor.', 'Deletes files and stages the deletion.'),
        options: [{ flags: ['--cached'], desc: D('nur aus Git entfernen, Datei auf der Platte behalten', 'only stop tracking, keep the file on disk') }, { flags: ['-r'], desc: D('Ordner rekursiv', 'directories recursively') }, { flags: ['-f'], desc: D('auch mit lokalen Änderungen löschen', 'delete even with local changes') }],
    });
    define({ name: 'mv', run: mv, mutates: true, usage: 'git mv <alt> <neu>', summary: D('Verschiebt/benennt eine Datei um und merkt das vor.', 'Moves/renames a file and stages it.') });
    define({
        name: 'restore', run: restore, mutates: true, usage: 'git restore [--staged] [--source=<commit>] <datei>…',
        summary: D('Stellt Dateien wieder her: verwirft Änderungen oder nimmt sie aus der Staging-Area.', 'Restores files: discards changes or unstages them.'),
        options: [
            { flags: ['--staged'], desc: D('Vormerkung aufheben (Datei bleibt geändert)', 'unstage (the file keeps its changes)') },
            { flags: ['--worktree'], desc: D('Änderungen im Arbeitsverzeichnis verwerfen (Standard)', 'discard changes in the working tree (default)') },
            { flags: ['--source'], arg: 'COMMIT', desc: D('Version aus diesem Commit holen', 'take the version from this commit') },
        ],
        danger: true,
    });
    define({
        name: 'commit', run: commit, mutates: true, usage: 'git commit -m "<Nachricht>"',
        summary: D('Speichert alle vorgemerkten Änderungen als neuen Commit (Schnappschuss).', 'Records all staged changes as a new commit (snapshot).'),
        options: [
            { flags: ['-m'], arg: 'NACHRICHT', desc: D('Commit-Nachricht direkt angeben', 'give the commit message directly') },
            { flags: ['-a'], desc: D('geänderte, bereits versionierte Dateien automatisch vormerken', 'automatically stage modified tracked files') },
            { flags: ['--amend'], desc: D('letzten Commit ersetzen (z. B. Nachricht korrigieren)', 'replace the last commit (e.g. fix its message)') },
            { flags: ['--no-edit'], desc: D('mit --amend: Nachricht beibehalten', 'with --amend: keep the message') },
        ],
    });
    define({
        name: 'config', repo: 'optional', run: config, usage: 'git config [--global] <schlüssel> [<wert>]',
        summary: D('Liest oder setzt Einstellungen, z. B. deinen Namen.', 'Reads or sets settings, e.g. your name.'),
        options: [{ flags: ['--global'], desc: D('für alle Repositories (~/.gitconfig)', 'for all repositories (~/.gitconfig)') }, { flags: ['--list'], desc: D('alle Einstellungen anzeigen', 'show all settings') }, { flags: ['--unset'], desc: D('Einstellung entfernen', 'remove a setting') }],
        examples: [{ cmd: 'git config --global user.name "Ada Lovelace"', desc: D('Namen für alle Commits festlegen', 'set your name for all commits') }],
    });
    define({
        name: 'clean', run: clean, mutates: true, usage: 'git clean -n | -f [-d]',
        summary: D('Löscht unversionierte Dateien – endgültig.', 'Deletes untracked files – permanently.'),
        options: [{ flags: ['-n'], desc: D('nur anzeigen, was gelöscht würde', 'only show what would be deleted') }, { flags: ['-f'], desc: D('wirklich löschen', 'really delete') }, { flags: ['-d'], desc: D('auch Ordner', 'directories too') }, { flags: ['-x'], desc: D('auch ignorierte Dateien', 'ignored files too') }],
        danger: true,
    });
}

export { cleanupMessage, commitTemplate };
