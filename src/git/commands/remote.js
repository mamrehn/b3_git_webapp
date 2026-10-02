// git remote, clone, fetch, pull, push

import { git } from '../../lib.js';
import { Repo } from '../repo.js';
import { GitError, fatal } from '../errors.js';
import { transportFor, announce, parseRemoteUrl } from '../transport.js';
import { appendReflog } from '../reflog.js';
import { isAncestor, mergeBase } from '../status.js';
import { runMerge } from './branching.js';
import { usage } from './common.js';
import { getopt } from '../../shell/registry.js';
import { statOrNull, mkdirp, rmrf } from '../../vfs/fsutil.js';
import { shortOid, basename, joinPath } from '../../core/util.js';
import { CONFIG } from '../../config.js';

const D = (de, en) => ({ de, en });

function badOpt(unknown, cmd) {
    const u = unknown[0];
    return usage(`error: unknown ${u.option.startsWith('--') ? 'option' : 'switch'} \`${u.option.replace(/^-+/, '')}'\nusage: git ${cmd} [<options>]`);
}

function displayUrl(url) {
    // git prints remote URLs in "From"/"To" lines without a trailing ".git" in "From"
    return url.replace(/\/+$/, '');
}

function fromUrl(url) {
    return displayUrl(url).replace(/\.git$/, '');
}

// ---- credentials for real servers (like git's username/password prompt) ------------------

const credentialCache = new Map();

function authCallbacks(g, url) {
    const host = parseRemoteUrl(url).host;
    let attempts = 0;
    return {
        onAuth: async () => {
            if (credentialCache.has(host) && attempts === 0) {
                attempts++;
                return credentialCache.get(host);
            }
            attempts++;
            if (!g.ui?.prompt || attempts > 2) return { cancel: true };
            g.ui.annotate?.({ type: 'credentials', host });
            const username = await g.ui.prompt({ text: `Username for 'https://${host}': ` });
            if (username === null) return { cancel: true };
            const password = await g.ui.prompt({ text: `Password for 'https://${username}@${host}': `, secret: true });
            if (password === null) return { cancel: true };
            const cred = { username, password };
            credentialCache.set(host, cred);
            return cred;
        },
        onAuthFailure: () => {
            credentialCache.delete(host);
            return { cancel: true };
        },
    };
}

function networkError(e, url, verb = 'access') {
    const msg = String(e?.message || e);
    if (e?.code === 'HttpError' || /HTTP Error: 404|404/.test(msg)) {
        return new GitError(`remote: Repository not found.\nfatal: repository '${url}/' not found`, { status: 128, kind: 'repo-not-found', data: { url } });
    }
    if (/401|403|auth/i.test(msg) || e?.code === 'UserCanceledError') {
        return new GitError(`remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for '${url}/'`, { status: 128, kind: 'auth-failed', data: { url } });
    }
    return new GitError(`fatal: unable to ${verb} '${url}/': ${/fetch|network|Failed/i.test(msg) ? 'Could not connect to server' : msg}`, { status: 128, kind: 'network', data: { url, message: msg } });
}

// ---- git remote ----------------------------------------------------------------------------

async function remote(g) {
    const repo = g.repo;
    const [sub, ...rest] = g.args;
    const remotes = await repo.remotes();
    const find = name => remotes.find(r => r.name === name);
    if (!sub || sub === '-v' || sub === '--verbose') {
        const lines = [];
        for (const r of remotes) {
            if (sub) lines.push(`${r.name}\t${r.url} (fetch)`, `${r.name}\t${r.url} (push)`);
            else lines.push(r.name);
        }
        if (lines.length) g.out(lines.join('\n') + '\n');
        g.info.remotes = remotes;
        return 0;
    }
    if (sub === 'add') {
        const { rest: args } = getopt(rest, { bool: ['f', 'fetch'], value: ['t', 'm'] });
        if (args.length !== 2) throw usage('usage: git remote add [<options>] <name> <url>');
        const [name, url] = args;
        if (find(name)) {
            g.err(`error: remote ${name} already exists.\n`);
            return 3;
        }
        if (!/^[A-Za-z0-9._-]+$/.test(name)) throw fatal(`'${name}' is not a valid remote name`);
        await git.addRemote({ fs: repo.fs, gitdir: repo.gitdir, remote: name, url });
        g.info.remoteAdded = { name, url, kind: parseRemoteUrl(url).kind };
        return 0;
    }
    if (sub === 'remove' || sub === 'rm') {
        const [name] = rest;
        if (!find(name)) { g.err(`error: No such remote: '${name}'\n`); return 2; }
        await git.deleteRemote({ fs: repo.fs, gitdir: repo.gitdir, remote: name });
        for (const r of await repo.remoteBranches()) if (r.remote === name) await repo.deleteRef(`refs/remotes/${r.name}`);
        await rmrf(repo.pfs, joinPath(repo.gitdir, 'refs', 'remotes', name));
        const cfg = repo.repoConfig();
        for (const b of await repo.branches()) if (await cfg.get(`branch.${b.name}.remote`) === name) {
            await cfg.set(`branch.${b.name}.remote`, undefined);
            await cfg.set(`branch.${b.name}.merge`, undefined);
        }
        g.info.remoteRemoved = name;
        return 0;
    }
    if (sub === 'rename') {
        const [from, to] = rest;
        const r = find(from);
        if (!r) { g.err(`error: No such remote: '${from}'\n`); return 2; }
        if (find(to)) { g.err(`error: remote ${to} already exists.\n`); return 3; }
        await git.addRemote({ fs: repo.fs, gitdir: repo.gitdir, remote: to, url: r.url });
        for (const rb of await repo.remoteBranches()) {
            if (rb.remote !== from) continue;
            await repo.writeRef(`refs/remotes/${to}/${rb.branch}`, rb.oid);
        }
        await rmrf(repo.pfs, joinPath(repo.gitdir, 'refs', 'remotes', from));
        await git.deleteRemote({ fs: repo.fs, gitdir: repo.gitdir, remote: from });
        const cfg = repo.repoConfig();
        for (const b of await repo.branches()) if (await cfg.get(`branch.${b.name}.remote`) === from) await cfg.set(`branch.${b.name}.remote`, to);
        return 0;
    }
    if (sub === 'set-url') {
        const args = rest.filter(a => !a.startsWith('--'));
        const [name, url] = args;
        if (!find(name)) { g.err(`error: No such remote '${name}'\n`); return 2; }
        await repo.repoConfig().set(`remote.${name}.url`, url);
        return 0;
    }
    if (sub === 'get-url') {
        const r = find(rest[0]);
        if (!r) { g.err(`error: No such remote '${rest[0]}'\n`); return 2; }
        g.out(r.url + '\n');
        return 0;
    }
    if (sub === 'show') {
        const r = find(rest[0]);
        if (!r) {
            if (!rest[0]) { g.out(remotes.map(x => x.name).join('\n') + (remotes.length ? '\n' : '')); return 0; }
            throw fatal(`'${rest[0]}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`);
        }
        const branches = (await repo.remoteBranches()).filter(b => b.remote === r.name);
        const head = await repo.remoteHead(r.name);
        const lines = [`* remote ${r.name}`, `  Fetch URL: ${r.url}`, `  Push  URL: ${r.url}`, `  HEAD branch: ${head || '(unknown)'}`];
        if (branches.length) {
            lines.push(`  Remote branch${branches.length > 1 ? 'es' : ''}:`);
            for (const b of branches) lines.push(`    ${b.branch} tracked`);
        }
        const local = [];
        for (const b of await repo.branches()) {
            const up = await repo.upstreamOf(b.name);
            if (up && up.remote === r.name) local.push([b, up]);
        }
        if (local.length) {
            lines.push(`  Local branch${local.length > 1 ? 'es' : ''} configured for 'git pull':`);
            for (const [b, up] of local) lines.push(`    ${b.name} merges with remote ${up.branch}`);
            lines.push(`  Local ref${local.length > 1 ? 's' : ''} configured for 'git push':`);
            for (const [b, up] of local) {
                const remoteOid = await repo.readRef(up.ref);
                const state = remoteOid === b.oid ? 'up to date' : await isAncestor(repo, remoteOid, b.oid) ? 'fast-forwardable' : 'local out of date';
                lines.push(`    ${b.name} pushes to ${up.branch} (${state})`);
            }
        }
        g.out(lines.join('\n') + '\n');
        return 0;
    }
    throw usage(`error: Unknown subcommand: ${sub}\nusage: git remote [-v | --verbose]\n   or: git remote add [-t <branch>] [-m <master>] [-f] [--[no-]tags] [--mirror=<fetch|push>] <name> <url>\n   or: git remote rename [--[no-]progress] <old> <new>\n   or: git remote remove <name>\n   or: git remote set-url [--push] <name> <newurl> [<oldurl>]`);
}

// ---- clone ---------------------------------------------------------------------------------------

async function clone(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['q', 'quiet', 'bare', 'single-branch', 'no-checkout', 'n', 'v', 'progress'],
        value: ['depth', 'b', 'branch', 'o', 'origin'],
        alias: { quiet: 'q', branch: 'b', origin: 'o', n: 'no-checkout' },
    });
    if (unknown.length) throw badOpt(unknown, 'clone');
    if (!rest.length) throw usage('fatal: You must specify a repository to clone.\n\nusage: git clone [<options>] [--] <repo> [<dir>]');
    const url = rest[0];
    const world = g.world;
    let name = rest[1] || basename(url.replace(/\/+$/, '')).replace(/\.git$/, '');
    if (!name) throw fatal('could not determine directory name');
    const dir = world.resolve(name);
    if (!world.canWrite(dir)) throw fatal(`could not create work tree dir '${name}': Permission denied`);
    const st = await statOrNull(world.pfs, dir);
    if (st && (!st.isDirectory() || (await world.pfs.readdir(dir)).length)) {
        throw fatal(`destination path '${name}' already exists and is not an empty directory.`, { kind: 'clone-exists' });
    }
    const transport = await transportFor(world, url);
    announce(g, { url, action: 'clone' });
    if (!opts.q) g.err(`Cloning into '${name}'...\n`);
    await mkdirp(world.pfs, dir);
    const remoteName = opts.o || 'origin';
    const depth = opts.depth ? Number(opts.depth) : (transport.kind === 'real' && CONFIG.realCloneDepth ? CONFIG.realCloneDepth : undefined);
    let received = 0;
    try {
        await git.clone({
            fs: world.fs,
            http: transport.http,
            corsProxy: transport.corsProxy,
            dir,
            url,
            remote: remoteName,
            ref: opts.b,
            singleBranch: Boolean(opts['single-branch']),
            depth,
            noCheckout: Boolean(opts['no-checkout']),
            onMessage: m => { if (!opts.q) remoteMessage(g, m); },
            onProgress: e => {
                if (g.ctx.signal?.aborted) throw new Error('interrupted');
                if (e.phase === 'Receiving objects' && e.total) received = e.total;
            },
            ...authCallbacks(g, url),
        });
    } catch (e) {
        await rmrf(world.pfs, dir);
        if (String(e.message).includes('interrupted')) throw new GitError('^C', { status: 130 });
        throw networkError(e, url.replace(/\/+$/, ''), 'access');
    }
    const repo = new Repo(world, dir);
    const head = await repo.head();
    if (!head.oid) {
        g.err('warning: You appear to have cloned an empty repository.\n');
    } else if (!opts.q) {
        if (received) g.err(`Receiving objects: 100% (${received}/${received}), done.\n`);
    }
    // reflog like git: "clone: from <url>"
    if (head.oid) {
        await appendReflog(repo, `refs/heads/${head.branch}`, null, head.oid, `clone: from ${url}`);
        await appendReflog(repo, 'HEAD', null, head.oid, `clone: from ${url}`);
    }
    g.info.clone = { dir, url, kind: transport.kind, branch: head.branch };
    return 0;
}

// Server messages ("remote: Counting objects: 42% (5/12)"). Like git, progress updates
// overwrite each other on a terminal and are left out when the output is not a terminal.
function remoteMessage(g, message) {
    for (const part of message.split(/\r?\n|\r/)) {
        const text = part.trimEnd();
        if (!text) continue;
        const inProgress = /\(\d+\/\d+\)$/.test(text);
        if (inProgress && !g.color) continue;
        g.err(g.color ? `\rremote: ${text}\x1b[K${inProgress ? '' : '\n'}` : `remote: ${text}\n`);
    }
}

// ---- fetch -----------------------------------------------------------------------------------------

function refLine(flag, summary, from, to, width, note = '') {
    return ` ${flag} ${summary.padEnd(17)} ${from.padEnd(width)} -> ${to}${note ? ' ' + note : ''}`;
}

export async function doFetch(g, repo, remoteName, { prune = false, quiet = false, refspecBranch = null } = {}) {
    const r = (await repo.remotes()).find(x => x.name === remoteName);
    if (!r) {
        throw new GitError(`fatal: '${remoteName}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, { status: 128, kind: 'no-remote', data: { remote: remoteName } });
    }
    const transport = await transportFor(g.world, r.url);
    announce(g, { url: r.url, remote: remoteName, action: 'fetch' });
    const before = new Map((await repo.remoteBranches()).filter(b => b.remote === remoteName).map(b => [b.branch, b.oid]));
    const tagsBefore = new Set((await repo.tags()).map(t => t.name));
    try {
        await git.fetch({
            fs: repo.fs,
            http: transport.http,
            corsProxy: transport.corsProxy,
            dir: repo.dir,
            gitdir: repo.gitdir,
            remote: remoteName,
            prune,
            tags: true,
            singleBranch: false,
            onMessage: m => { if (!quiet) remoteMessage(g, m); },
            ...authCallbacks(g, r.url),
        });
    } catch (e) {
        throw networkError(e, r.url.replace(/\/+$/, ''), 'access');
    }
    repo.invalidate();
    const after = new Map((await repo.remoteBranches()).filter(b => b.remote === remoteName).map(b => [b.branch, b.oid]));
    const lines = [];
    const width = Math.max(10, ...[...after.keys(), ...before.keys()].map(n => n.length));
    for (const [branch, oid] of after) {
        const old = before.get(branch);
        if (refspecBranch && branch !== refspecBranch) continue;
        if (!old) lines.push(refLine('*', '[new branch]', branch, `${remoteName}/${branch}`, width));
        else if (old !== oid) {
            const ff = await isAncestor(repo, old, oid);
            lines.push(ff ? refLine(' ', `${shortOid(old)}..${shortOid(oid)}`, branch, `${remoteName}/${branch}`, width)
                : refLine('+', `${shortOid(old)}...${shortOid(oid)}`, branch, `${remoteName}/${branch}`, width, '(forced update)'));
        }
    }
    for (const t of await repo.tags()) {
        if (!tagsBefore.has(t.name)) lines.push(refLine('*', '[new tag]', t.name, t.name, width));
    }
    if (prune) {
        for (const [branch] of before) {
            if (!after.has(branch)) lines.push(refLine('-', '[deleted]', '(none)', `${remoteName}/${branch}`, width));
        }
    }
    if (lines.length && !quiet) g.err(`From ${fromUrl(r.url)}\n${lines.join('\n')}\n`);
    const changed = [...after].filter(([b, oid]) => before.get(b) !== oid).map(([b]) => b);
    return { url: r.url, kind: transport.kind, changed, before, after };
}

async function fetch(g) {
    const { opts, rest, unknown } = getopt(g.args, { bool: ['all', 'p', 'prune', 'q', 'quiet', 'v', 'verbose', 'tags', 't'], alias: { prune: 'p', quiet: 'q', verbose: 'v', tags: 't' } });
    if (unknown.length) throw badOpt(unknown, 'fetch');
    const repo = g.repo;
    const remotes = await repo.remotes();
    if (!remotes.length && !rest.length) {
        throw new GitError('fatal: No remote repository specified.  Please, specify either a URL or a\nremote name from which new revisions should be fetched.', { status: 128, kind: 'no-remote' });
    }
    const head = await repo.head();
    const up = head.branch ? await repo.upstreamOf(head.branch) : null;
    const names = opts.all ? remotes.map(r => r.name) : [rest[0] || up?.remote || 'origin'];
    const results = [];
    for (const name of names) {
        if (opts.all && !opts.q) g.out(`Fetching ${name}\n`);
        results.push(await doFetch(g, repo, name, { prune: Boolean(opts.p), quiet: Boolean(opts.q), refspecBranch: rest[1] || null }));
    }
    g.info.fetch = results.map(r => ({ url: r.url, kind: r.kind, changed: r.changed }));
    return 0;
}

// ---- pull -------------------------------------------------------------------------------------------

async function pull(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['rebase', 'r', 'no-rebase', 'ff-only', 'no-ff', 'ff', 'q', 'quiet', 'v', 'no-edit', 'edit', 'autostash'],
        alias: { r: 'rebase', quiet: 'q' },
    });
    if (unknown.length) throw badOpt(unknown, 'pull');
    const repo = g.repo;
    const head = await repo.head();
    if (!head.branch) {
        throw new GitError('You are not currently on a branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n', { status: 1, kind: 'pull-detached' });
    }
    const op = await repo.operation();
    if (op) throw fatal(op.kind === 'merge' ? 'You have not concluded your merge (MERGE_HEAD exists).\nhint: Please, commit your changes before merging.\nfatal: Exiting because of unfinished merge.' : `You are in the middle of a ${op.kind}.`, { kind: 'operation-in-progress' });
    let remoteName = rest[0];
    let branch = rest[1];
    const up = await repo.upstreamOf(head.branch);
    if (!remoteName) {
        if (!up) {
            const remotes = await repo.remotes();
            throw new GitError(
                'There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\n' +
                'If you wish to set tracking information for this branch you can do so with:\n\n' +
                `    git branch --set-upstream-to=${remotes[0]?.name || '<remote>'}/<branch> ${head.branch}\n`,
                { status: 1, kind: 'no-upstream', data: { branch: head.branch } },
            );
        }
        remoteName = up.remote;
        branch = up.branch;
    }
    if (!branch) branch = up && up.remote === remoteName ? up.branch : head.branch;
    const res = await doFetch(g, repo, remoteName, { quiet: Boolean(opts.q) });
    const theirOid = await repo.readRef(`refs/remotes/${remoteName}/${branch}`);
    if (!theirOid) throw fatal(`couldn't find remote ref ${branch}`, { kind: 'no-remote-ref' });
    await repo.writeGitFile('FETCH_HEAD', `${theirOid}\t\tbranch '${branch}' of ${fromUrl(res.url)}\n`);
    const rebase = opts.rebase || (!opts['no-rebase'] && await repo.configBool('pull.rebase', false));
    g.info.pull = { remote: remoteName, branch, url: res.url, kind: res.kind, rebase };
    if (rebase) {
        const { runRebase } = await import('./advanced.js');
        return runRebase(g, { upstreamSpec: `${remoteName}/${branch}`, ontoOid: theirOid, reflogPrefix: 'pull --rebase' });
    }
    const ffOnly = opts['ff-only'] || (await repo.config('pull.ff')) === 'only';
    if (!opts.rebase && !opts['no-rebase'] && !ffOnly && (await repo.config('pull.rebase')) === undefined && (await repo.config('pull.ff')) === undefined) {
        // modern git refuses to guess for divergent branches without configuration
        const base = await mergeBase(repo, head.oid, theirOid);
        if (base !== head.oid && base !== theirOid) {
            throw new GitError(
                'hint: You have divergent branches and need to specify how to reconcile them.\nhint: You can do so by running one of the following commands sometime before\nhint: your next pull:\nhint:\nhint:   git config pull.rebase false  # merge\nhint:   git config pull.rebase true   # rebase\nhint:   git config pull.ff only       # fast-forward only\nhint:\nhint: You can replace "git config" with "git config --global" to set a default\nhint: preference for all repositories. You can also pass --rebase, --no-rebase,\nhint: or --ff-only on the command line to override the configured default per\nhint: invocation.\nfatal: Need to specify how to reconcile divergent branches.',
                { status: 128, kind: 'divergent-pull' },
            );
        }
    }
    return runMerge(g, {
        theirSpec: `${remoteName}/${branch}`,
        theirOid,
        ffOnly,
        noFf: Boolean(opts['no-ff']),
        message: `Merge branch '${branch}' of ${fromUrl(res.url)}${['main', 'master'].includes(head.branch) ? '' : ` into ${head.branch}`}`,
        edit: opts['no-edit'] ? false : opts.edit ? true : null,
        reflogPrefix: 'pull',
        quiet: Boolean(opts.q),
    });
}

// ---- push -------------------------------------------------------------------------------------------

async function countObjects(repo, localOid, remoteOids) {
    const { reachableSet } = await import('../history.js');
    const known = await reachableSet(repo, remoteOids.filter(Boolean));
    let commits = 0;
    let objects = 0;
    const seen = new Set();
    const stack = [localOid];
    while (stack.length) {
        const oid = stack.pop();
        if (!oid || seen.has(oid) || known.has(oid)) continue;
        seen.add(oid);
        const c = await repo.readCommit(oid).catch(() => null);
        if (!c) continue;
        commits++;
        objects++;
        const flat = await repo.flatTree(c.tree);
        objects += 1 + Math.min(flat.size, 50);
        stack.push(...c.parents);
    }
    return { commits, objects };
}

async function push(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['u', 'set-upstream', 'f', 'force', 'force-with-lease', 'tags', 'all', 'd', 'delete', 'q', 'quiet', 'v', 'n', 'dry-run', 'follow-tags'],
        alias: { 'set-upstream': 'u', force: 'f', delete: 'd', quiet: 'q', 'dry-run': 'n' },
    });
    if (unknown.length) throw badOpt(unknown, 'push');
    const repo = g.repo;
    const head = await repo.head();
    const remotes = await repo.remotes();
    if (!remotes.length && !rest.length) {
        throw new GitError('fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>\n', { status: 128, kind: 'no-remote' });
    }
    let remoteName = rest[0];
    let refspecs = rest.slice(1);
    if (!remoteName) {
        if (!head.branch) throw fatal('You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push origin HEAD:<name-of-remote-branch>\n', { kind: 'push-detached' });
        const up = await repo.upstreamOf(head.branch);
        if (!up && !opts.tags) {
            const autoSetup = await repo.configBool('push.autoSetupRemote', false);
            if (!autoSetup || remotes.length !== 1) {
                throw new GitError(`fatal: The current branch ${head.branch} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream ${remotes[0]?.name || 'origin'} ${head.branch}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n`, { status: 128, kind: 'no-upstream', data: { branch: head.branch, remote: remotes[0]?.name || 'origin' } });
            }
            remoteName = remotes[0].name;
            opts.u = true;
        } else {
            remoteName = up ? up.remote : remotes[0].name;
            if (up && up.branch !== head.branch && !opts.u) {
                throw new GitError(`fatal: The upstream branch of your current branch does not match\nthe name of your current branch.  To push to the upstream branch\non the remote, use\n\n    git push ${up.remote} HEAD:${up.branch}\n\nTo push to the branch of the same name on the remote, use\n\n    git push ${up.remote} HEAD\n`, { status: 128, kind: 'upstream-mismatch' });
            }
        }
    }
    const r = remotes.find(x => x.name === remoteName);
    if (!r) {
        throw new GitError(`fatal: '${remoteName}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, { status: 128, kind: 'no-remote', data: { remote: remoteName } });
    }
    if (!refspecs.length) {
        if (opts.tags) refspecs = (await repo.tags()).map(t => `refs/tags/${t.name}`);
        else if (!head.branch) throw fatal('You are not currently on a branch.');
        else refspecs = [head.branch];
    }
    const transport = await transportFor(g.world, r.url);
    announce(g, { url: r.url, remote: remoteName, action: 'push' });
    const results = [];
    let anyRejected = false;
    let anyPushed = false;
    for (const spec of refspecs) {
        const force = opts.f || spec.startsWith('+');
        let [src, dst] = spec.replace(/^\+/, '').split(':');
        if (dst === undefined) dst = src;
        if (src === 'HEAD') src = head.branch || head.oid;
        const isTag = src.startsWith('refs/tags/') || (await repo.readRef(`refs/tags/${src}`) && !(await repo.readRef(`refs/heads/${src}`)));
        const localRef = opts.d ? null : isTag ? (src.startsWith('refs/') ? src : `refs/tags/${src}`) : (src.startsWith('refs/') ? src : `refs/heads/${src}`);
        const remoteRef = isTag ? (dst.startsWith('refs/') ? dst : `refs/tags/${dst}`) : (dst.startsWith('refs/') ? dst : `refs/heads/${dst}`);
        const shortDst = remoteRef.replace(/^refs\/(heads|tags)\//, '');
        const localOid = localRef ? await repo.readRef(localRef) : null;
        if (!opts.d && !localOid) {
            g.err(`error: src refspec ${src} does not match any\nerror: failed to push some refs to '${r.url}'\n`);
            g.info.push = { error: 'src-refspec', src };
            return 1;
        }
        const trackingRef = `refs/remotes/${remoteName}/${shortDst}`;
        const knownRemote = await repo.readRef(trackingRef);
        if (!opts.n) {
            try {
                const remoteOidsKnown = (await repo.remoteBranches()).filter(b => b.remote === remoteName).map(b => b.oid);
                const counts = localOid ? await countObjects(repo, localOid, remoteOidsKnown) : { objects: 0 };
                const res = await git.push({
                    fs: repo.fs,
                    http: transport.http,
                    corsProxy: transport.corsProxy,
                    dir: repo.dir,
                    gitdir: repo.gitdir,
                    remote: remoteName,
                    ref: localRef || shortDst,
                    remoteRef,
                    force: Boolean(force),
                    delete: Boolean(opts.d),
                    onMessage: m => { if (!opts.q) g.err(`remote: ${m.replace(/\n$/, '')}\n`); },
                    ...authCallbacks(g, r.url),
                });
                if (counts.objects && !opts.q) {
                    const n = counts.objects;
                    g.err(`Enumerating objects: ${n}, done.\nCounting objects: 100% (${n}/${n}), done.\nWriting objects: 100% (${n}/${n}), done.\nTotal ${n} (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)\n`);
                }
                results.push({ ok: res.ok, src, dst: shortDst, old: knownRemote, new: localOid, isTag, force, deleted: Boolean(opts.d) });
                anyPushed = true;
            } catch (e) {
                if (e.code === 'PushRejectedError' || /not-fast-forward|tag-exists/.test(e.data?.reason || e.message)) {
                    const haveRemoteObject = knownRemote ? await repo.hasObject(knownRemote) : false;
                    const reason = e.data?.reason === 'tag-exists' ? 'already exists' : (haveRemoteObject && knownRemote && !(await isAncestor(repo, knownRemote, localOid)) ? 'non-fast-forward' : 'fetch first');
                    results.push({ rejected: true, reason, src, dst: shortDst, isTag });
                    anyRejected = true;
                    continue;
                }
                if (e.code === 'GitPushError' && /stale info/.test(e.message)) {
                    results.push({ rejected: true, reason: 'fetch first', src, dst: shortDst, isTag });
                    anyRejected = true;
                    continue;
                }
                throw networkError(e, r.url.replace(/\/+$/, ''), 'access');
            }
        }
    }
    const allUpToDate = results.length && results.every(x => !x.rejected && x.old === x.new && !x.deleted);
    if (allUpToDate) {
        g.err('Everything up-to-date\n');
        g.info.push = { upToDate: true, url: r.url, kind: transport.kind };
        return 0;
    }
    const lines = [`To ${displayUrl(r.url)}`];
    for (const x of results) {
        if (x.rejected) lines.push(` ! [rejected]        ${x.src} -> ${x.dst} (${x.reason})`);
        else if (x.deleted) lines.push(` - [deleted]         ${x.dst}`);
        else if (!x.old) lines.push(` * [new ${x.isTag ? 'tag' : 'branch'}]${x.isTag ? '         ' : '      '}${x.src} -> ${x.dst}`);
        else if (x.old === x.new) lines.push(` = [up to date]      ${x.src} -> ${x.dst}`);
        else if (x.force && !(await isAncestor(repo, x.old, x.new))) lines.push(` + ${shortOid(x.old)}...${shortOid(x.new)} ${x.src} -> ${x.dst} (forced update)`);
        else lines.push(`   ${shortOid(x.old)}..${shortOid(x.new)}  ${x.src} -> ${x.dst}`);
    }
    g.err(lines.join('\n') + '\n');
    if (anyRejected) {
        const reason = results.find(x => x.rejected).reason;
        let hint;
        if (reason === 'fetch first') {
            hint = 'hint: Updates were rejected because the remote contains work that you do not\nhint: have locally. This is usually caused by another repository pushing to\nhint: the same ref. If you want to integrate the remote changes, use\nhint: \'git pull\' before pushing again.\nhint: See the \'Note about fast-forwards\' in \'git push --help\' for details.';
        } else if (reason === 'non-fast-forward') {
            hint = 'hint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart. If you want to integrate the remote changes,\nhint: use \'git pull\' before pushing again.\nhint: See the \'Note about fast-forwards\' in \'git push --help\' for details.';
        } else {
            hint = 'hint: Updates were rejected because the tag already exists in the remote.';
        }
        g.err(`error: failed to push some refs to '${r.url}'\n${hint}\n`);
    }
    if (opts.u && anyPushed) {
        for (const x of results) {
            if (x.rejected || x.isTag || x.deleted) continue;
            await repo.setUpstream(x.src, remoteName, x.dst);
            g.out(`branch '${x.src}' set up to track '${remoteName}/${x.dst}'.\n`);
        }
    }
    g.info.push = { results, url: r.url, kind: transport.kind, rejected: anyRejected };
    return anyRejected ? 1 : 0;
}

export function registerRemote(define) {
    define({
        name: 'remote', run: remote, usage: 'git remote [-v] | add <name> <url> | remove <name>',
        summary: D('Verwaltet die Verbindungen zu entfernten Repositories (z. B. „origin“).', "Manages connections to remote repositories (like 'origin')."),
        options: [{ flags: ['-v'], desc: D('mit Adressen anzeigen', 'show the URLs') }, { flags: ['add'], desc: D('neues Remote eintragen', 'add a remote') }, { flags: ['remove'], desc: D('Remote entfernen', 'remove a remote') }],
    });
    define({
        name: 'clone', repo: false, run: clone, usage: 'git clone <url> [<ordner>]',
        summary: D('Lädt ein Repository komplett herunter (inkl. Geschichte).', 'Downloads a repository including its history.'),
        options: [{ flags: ['--depth'], arg: 'N', desc: D('nur die letzten N Commits', 'only the last N commits') }, { flags: ['-b'], arg: 'BRANCH', desc: D('diesen Branch auschecken', 'check out this branch') }],
    });
    define({
        name: 'fetch', run: fetch, usage: 'git fetch [<remote>] [--prune]',
        summary: D('Holt neue Commits vom Remote – ändert deine Branches aber NICHT.', 'Downloads new commits from the remote – does NOT change your branches.'),
        options: [{ flags: ['--all'], desc: D('alle Remotes', 'all remotes') }, { flags: ['--prune'], desc: D('gelöschte Remote-Branches auch lokal entfernen', 'remove deleted remote branches') }],
    });
    define({
        name: 'pull', run: pull, usage: 'git pull [--rebase] [<remote> <branch>]',
        summary: D('fetch + merge: holt neue Commits und führt sie in deinen Branch ein.', 'fetch + merge: downloads new commits and merges them into your branch.'),
        options: [{ flags: ['--rebase'], desc: D('statt mergen: eigene Commits obendrauf setzen', 'instead of merging: replay your commits on top') }, { flags: ['--ff-only'], desc: D('nur Fast-Forward erlauben', 'only allow a fast-forward') }],
    });
    define({
        name: 'push', run: push, usage: 'git push [-u] [<remote> <branch>]',
        summary: D('Lädt deine Commits auf das Remote hoch.', 'Uploads your commits to the remote.'),
        options: [
            { flags: ['-u'], desc: D('Upstream merken, danach reicht „git push“', "remember the upstream, afterwards 'git push' is enough") },
            { flags: ['--force'], desc: D('Remote überschreiben – kann Arbeit anderer zerstören!', "overwrite the remote – can destroy others' work!") },
            { flags: ['--tags'], desc: D('Tags hochladen', 'push tags') },
            { flags: ['--delete'], desc: D('Branch auf dem Remote löschen', 'delete a branch on the remote') },
        ],
    });
}
