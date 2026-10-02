// git log, show, diff, blame, shortlog, reflog, rev-parse, cat-file, ls-files, hash-object

import { git, Diff } from '../../lib.js';
import { GitError, fatal } from '../errors.js';
import { resolve, resolveCommit, resolveBlobSpec, unknownRevision } from '../revparse.js';
import { walk, topoOrder, graphRows, decorationMap, formatDecoration } from '../history.js';
import { formatFileDiff, formatStat, countChanges, hashBlob, summaryLine } from '../diffutil.js';
import { readReflog } from '../reflog.js';
import { now, tzOffset } from '../clock.js';
import { mergeBase } from '../status.js';
import { treeChanges, statsFor, C, paint, usage } from './common.js';
import { compilePathspecs } from './pathspec.js';
import { getopt } from '../../shell/registry.js';
import { formatGitDate, formatIsoDate, relativeDate, shortOid, toText, splitLines } from '../../core/util.js';

const D = (de, en) => ({ de, en });

function badOpt(unknown, cmd) {
    const u = unknown[0];
    return usage(`error: unknown ${u.option.startsWith('--') ? 'option' : 'switch'} \`${u.option.replace(/^-+/, '')}'\nusage: git ${cmd} [<options>]`);
}

// Split "rev… -- path…" (paths may also come without "--" if they are not revisions)
async function splitRevsAndPaths(repo, args) {
    const dd = args.indexOf('--');
    const revs = [];
    const paths = dd === -1 ? [] : args.slice(dd + 1);
    for (const a of dd === -1 ? args : args.slice(0, dd)) {
        const bare = a.replace(/^\^/, '');
        const parts = a.includes('...') ? a.split('...') : a.includes('..') ? a.split('..') : [bare];
        let ok = true;
        for (const p of parts) if (p && !(await resolveCommit(repo, p))) ok = false;
        if (ok) revs.push(a);
        else if (dd === -1) {
            const rel = repo.toRepoPath(a);
            const exists = rel !== null && (await repo.workBytes(rel)) !== null;
            const tracked = rel !== null && (await repo.indexFiles()).some(f => f === rel || f.startsWith(rel + '/'));
            if (exists || tracked) paths.push(a);
            else throw new GitError(unknownRevision(a), { status: 128, kind: 'unknown-revision', data: { rev: a } });
        } else {
            throw new GitError(unknownRevision(a), { status: 128, kind: 'unknown-revision', data: { rev: a } });
        }
    }
    return { revs, paths };
}

async function expandRanges(repo, revs) {
    const include = [];
    const exclude = [];
    for (const r of revs) {
        if (r.startsWith('^')) { exclude.push(await resolveCommit(repo, r.slice(1))); continue; }
        if (r.includes('...')) {
            const [a, b] = r.split('...').map(x => x || 'HEAD');
            const oa = await resolveCommit(repo, a);
            const ob = await resolveCommit(repo, b);
            include.push(oa, ob);
            const base = await mergeBase(repo, oa, ob);
            if (base) exclude.push(base);
            continue;
        }
        if (r.includes('..')) {
            const [a, b] = r.split('..').map(x => x || 'HEAD');
            exclude.push(await resolveCommit(repo, a));
            include.push(await resolveCommit(repo, b));
            continue;
        }
        include.push(await resolveCommit(repo, r));
    }
    return { include: include.filter(Boolean), exclude: exclude.filter(Boolean) };
}

function formatDate(sig, mode = 'default') {
    if (mode === 'relative') return relativeDate(sig.timestamp);
    if (mode === 'iso' || mode === 'iso8601') return formatIsoDate(sig.timestamp, sig.timezoneOffset);
    if (mode === 'short') return formatIsoDate(sig.timestamp, sig.timezoneOffset).slice(0, 10);
    return formatGitDate(sig.timestamp, sig.timezoneOffset);
}

function expandFormat(fmt, c, deco, { color, dateMode }) {
    const subject = c.message.split('\n')[0];
    const body = c.message.split('\n').slice(1).join('\n').replace(/^\n+/, '');
    const map = {
        H: c.oid, h: shortOid(c.oid), T: c.tree, t: shortOid(c.tree),
        P: c.parents.join(' '), p: c.parents.map(p => shortOid(p)).join(' '),
        an: c.author.name, ae: c.author.email, ad: formatDate(c.author, dateMode), ar: relativeDate(c.author.timestamp),
        at: String(c.author.timestamp), as: formatIsoDate(c.author.timestamp, c.author.timezoneOffset).slice(0, 10),
        ai: formatIsoDate(c.author.timestamp, c.author.timezoneOffset),
        cn: c.committer.name, ce: c.committer.email, cd: formatDate(c.committer, dateMode), cr: relativeDate(c.committer.timestamp),
        ct: String(c.committer.timestamp),
        s: subject, b: body ? body.replace(/\n?$/, '\n') : '', B: c.message,
        d: deco, D: deco.replace(/^ \(|\)$/g, ''), n: '\n', '%': '%',
    };
    const colors = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', reset: '\x1b[m', bold: '\x1b[1m' };
    return fmt.replace(/%C\((\w+)\)|%C(red|green|yellow|blue|magenta|cyan|reset)|%(an|ae|ad|ar|at|as|ai|cn|ce|cd|cr|ct|[HhTtPpsbBdDn%])/g, (m, c1, c2, key) => {
        if (c1 || c2) return color ? (colors[c1 || c2] || '') : '';
        return map[key] ?? m;
    });
}

const PRETTY = {
    oneline: '%H%d %s',
    onelineAbbrev: '%h%d %s',
};

async function log(g, { mode = 'log' } = {}) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['oneline', 'graph', 'all', 'branches', 'tags', 'remotes', 'reverse', 'stat', 'shortstat', 'name-only', 'name-status', 'p', 'patch', 'u', 'first-parent', 'merges', 'no-merges', 'abbrev-commit', 'no-decorate', 'decorate', 'follow', 'i', 'regexp-ignore-case', 'no-patch', 's', 'no-color', 'color', 'topo-order', 'date-order', 'full-history'],
        value: ['n', 'max-count', 'skip', 'author', 'committer', 'grep', 'since', 'after', 'until', 'before', 'pretty', 'format', 'date', '#'],
        alias: { 'max-count': 'n', patch: 'p', u: 'p', after: 'since', before: 'until', 'regexp-ignore-case': 'i', 'no-patch': 's' },
    });
    if (unknown.length) throw badOpt(unknown, mode);
    const repo = g.repo;
    const head = await repo.head();
    const { revs, paths } = await splitRevsAndPaths(repo, rest);
    let include = [];
    let exclude = [];
    if (revs.length) ({ include, exclude } = await expandRanges(repo, revs));
    if (opts.all || opts.branches) for (const b of await repo.branches()) include.push(b.oid);
    if (opts.all || opts.remotes) for (const r of await repo.remoteBranches()) include.push(r.oid);
    if (opts.all || opts.tags) for (const t of await repo.tags()) include.push(t.commit);
    if (opts.all) {
        if (head.oid) include.push(head.oid);
        const stash = await repo.readRef('refs/stash');
        if (stash) include.push(stash);
    }
    if (!include.length && !revs.length && !opts.all && !opts.branches && !opts.tags && !opts.remotes) {
        if (head.unborn) throw fatal(`your current branch '${head.branch}' does not have any commits yet`, { kind: 'no-commits' });
        include.push(head.oid);
    }
    let commits = await walk(repo, { include, exclude, firstParent: Boolean(opts['first-parent']) });
    if (opts.graph || opts['topo-order']) commits = topoOrder(commits, { firstParent: Boolean(opts['first-parent']) });

    // filters
    const pathspecs = paths.length ? compilePathspecs(repo, paths) : null;
    if (pathspecs) {
        const kept = [];
        for (const c of commits) {
            const parents = c.parents.length ? c.parents : [null];
            let touches = true;
            for (const p of parents) {
                const ptree = p ? (await repo.readCommit(p).catch(() => null))?.tree : null;
                const changes = await treeChanges(repo, ptree, c.tree, { pathFilter: f => pathspecs.some(s => s.test(f)) });
                if (!changes.length) { touches = false; break; } // TREESAME to one parent
            }
            if (touches) kept.push(c);
        }
        commits = kept;
    }
    const ci = opts.i;
    const re = (pat) => new RegExp(pat, ci ? 'i' : '');
    if (opts.author) { const r = re(opts.author); commits = commits.filter(c => r.test(`${c.author.name} <${c.author.email}>`)); }
    if (opts.committer) { const r = re(opts.committer); commits = commits.filter(c => r.test(`${c.committer.name} <${c.committer.email}>`)); }
    if (opts.grep) { const r = re(opts.grep); commits = commits.filter(c => r.test(c.message)); }
    if (opts.merges) commits = commits.filter(c => c.parents.length > 1);
    if (opts['no-merges']) commits = commits.filter(c => c.parents.length <= 1);
    const parseWhen = s => {
        const rel = String(s).match(/^(\d+)\.?\s*(second|minute|hour|day|week|month|year)s?(\.ago| ago)?$/);
        if (rel) {
            const mult = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[rel[2]];
            return Date.now() / 1000 - Number(rel[1]) * mult;
        }
        const t = Date.parse(s);
        return Number.isNaN(t) ? null : t / 1000;
    };
    if (opts.since) { const t = parseWhen(opts.since); if (t !== null) commits = commits.filter(c => c.committer.timestamp >= t); }
    if (opts.until) { const t = parseWhen(opts.until); if (t !== null) commits = commits.filter(c => c.committer.timestamp <= t); }
    if (opts.skip) commits = commits.slice(Number(opts.skip));
    const max = opts.n ?? opts['#'];
    if (max !== undefined) commits = commits.slice(0, Number(max));
    if (opts.reverse && !opts.graph) commits.reverse();

    // output
    const color = g.color && !opts['no-color'];
    const decorate = opts.decorate || (!opts['no-decorate'] && g.ctx.isTTY);
    const decos = decorate ? await decorationMap(repo) : null;
    const deco = oid => (decos ? formatDecoration(oid, decos, { color }) : '');
    // --oneline = --pretty=oneline --abbrev-commit; --pretty=oneline alone prints full hashes
    let format = opts.format !== undefined ? `tformat:${opts.format}` : opts.pretty;
    if (opts.oneline) format = `tformat:${PRETTY.onelineAbbrev}`;
    else if (format === 'oneline') format = `tformat:${opts['abbrev-commit'] ? PRETTY.onelineAbbrev : PRETTY.oneline}`;
    else if (format && /^(format|tformat):/.test(format) === false && !['short', 'medium', 'full', 'fuller', 'raw'].includes(format)) format = `tformat:${format}`;
    const isTformat = Boolean(format && /^t?format:/.test(format));
    const showPatch = mode === 'show' ? !opts.s && !opts.stat && !opts['name-only'] && !opts['name-status'] && !opts.shortstat : Boolean(opts.p);
    const graph = opts.graph ? graphRows(commits, { color, firstParent: Boolean(opts['first-parent']) }) : null;
    const yellow = s => (color ? `\x1b[33m${s}\x1b[m` : s);
    const pathFilter = pathspecs ? f => pathspecs.some(s => s.test(f)) : null;
    const dateMode = opts.date || 'default';

    const out = [];
    for (let i = 0; i < commits.length; i++) {
        const c = commits[i];
        const lines = [];
        if (isTformat) {
            const fmt = format.replace(/^t?format:/, '');
            let text = expandFormat(fmt, c, deco(c.oid), { color, dateMode });
            if (Object.values(PRETTY).includes(fmt) && color) text = text.replace(/^[0-9a-f]+/, m => yellow(m));
            lines.push(...text.split('\n'));
        } else {
            const style = format || 'medium';
            const id = opts['abbrev-commit'] ? shortOid(c.oid) : c.oid;
            lines.push(yellow(`commit ${id}`) + deco(c.oid));
            if (c.parents.length > 1) lines.push(`Merge: ${c.parents.map(p => shortOid(p)).join(' ')}`);
            lines.push(`Author: ${c.author.name} <${c.author.email}>`);
            if (style === 'full' || style === 'fuller') lines.push(`Commit: ${c.committer.name} <${c.committer.email}>`);
            if (style !== 'short') lines.push(`Date:   ${formatDate(c.author, dateMode)}`);
            lines.push('');
            const msg = c.message.replace(/\n+$/, '').split('\n');
            const shown = style === 'short' ? msg.slice(0, 1) : msg;
            for (const l of shown) lines.push(`    ${l}`); // git indents blank message lines too
        }
        // stat / patch
        const wantsStat = opts.stat || opts.shortstat || opts['name-only'] || opts['name-status'];
        if (wantsStat || showPatch) {
            if (c.parents.length <= 1 || mode === 'show') {
                const parentTree = c.parents.length ? (await repo.readCommit(c.parents[0]).catch(() => null))?.tree : null;
                const isMerge = c.parents.length > 1;
                const changes = isMerge ? [] : await treeChanges(repo, parentTree, c.tree, { pathFilter });
                if (changes.length) {
                    if (!isTformat || wantsStat) lines.push('');
                    if (opts['name-only']) for (const ch of changes) lines.push(ch.path);
                    else if (opts['name-status']) for (const ch of changes) lines.push(`${ch.status}\t${ch.path}`);
                    else if (opts.stat) lines.push(...formatStat(await statsFor(repo, changes), { color, width: g.columns }).replace(/\n$/, '').split('\n'));
                    else if (opts.shortstat) {
                        const st = await statsFor(repo, changes);
                        lines.push(summaryLine(changes.length, st.reduce((s, x) => s + x.insertions, 0), st.reduce((s, x) => s + x.deletions, 0)));
                    }
                    if (showPatch) {
                        if (wantsStat) lines.push('');
                        for (const ch of changes) {
                            const a = ch.a ? { oid: ch.a.oid, mode: ch.a.mode, bytes: await repo.readBlob(ch.a.oid) } : null;
                            const b = ch.b ? { oid: ch.b.oid, mode: ch.b.mode, bytes: await repo.readBlob(ch.b.oid) } : null;
                            lines.push(...formatFileDiff(ch.path, a, b, { color }).replace(/\n$/, '').split('\n'));
                        }
                    }
                }
            }
        }
        if (graph) {
            const row = graph[i];
            const rendered = lines.map((l, idx) => (idx === 0 ? row.head : (row.transitions[idx - 1] ?? row.pad)) + l);
            // transitions not consumed by text lines (e.g. with --oneline) get their own lines
            for (let k = Math.max(0, lines.length - 1); k < row.transitions.length; k++) rendered.push(row.transitions[k]);
            if (!isTformat && i < commits.length - 1) rendered.push(row.sep);
            out.push(rendered.join('\n'));
        } else {
            out.push(lines.join('\n'));
            if (!isTformat && i < commits.length - 1) out.push('');
        }
    }
    if (out.length) g.out(out.join('\n') + '\n');
    g.info.log = { count: commits.length, graph: Boolean(opts.graph), oneline: Boolean(opts.oneline), all: Boolean(opts.all) };
    return 0;
}

// ---- show ---------------------------------------------------------------------------------

async function show(g) {
    const repo = g.repo;
    const objects = g.args.filter(a => !a.startsWith('-'));
    const flags = g.args.filter(a => a.startsWith('-'));
    if (!objects.length) {
        if ((await repo.head()).unborn) throw fatal(`your current branch '${(await repo.head()).branch}' does not have any commits yet`);
        objects.push('HEAD');
    }
    let status = 0;
    for (const obj of objects) {
        if (obj.includes(':')) {
            const blob = await resolveBlobSpec(repo, obj);
            if (!blob || blob.error) throw fatal(blob?.error || `invalid object name '${obj}'.`);
            g.out(toText(await repo.readBlob(blob.oid)));
            continue;
        }
        const r = await resolve(repo, obj, { want: 'any' });
        if (!r || r.error) throw new GitError(unknownRevision(obj), { status: 128, kind: 'unknown-revision', data: { rev: obj } });
        if (r.type === 'tag') {
            const { tag } = await git.readTag({ fs: repo.fs, gitdir: repo.gitdir, oid: r.oid });
            g.out(`${paint(g, C.yellow, `tag ${tag.tag}`)}\nTagger: ${tag.tagger.name} <${tag.tagger.email}>\nDate:   ${formatGitDate(tag.tagger.timestamp, tag.tagger.timezoneOffset)}\n\n${tag.message.replace(/\n*$/, '\n')}\n`);
            const sub = { ...g, args: [...flags, '-n', '1', tag.object] };
            await log(sub, { mode: 'show' });
            continue;
        }
        if (r.type === 'tree') {
            const { tree } = await git.readTree({ fs: repo.fs, gitdir: repo.gitdir, oid: r.oid });
            g.out(`${paint(g, C.yellow, `tree ${obj}`)}\n\n${tree.map(e => e.path + (e.type === 'tree' ? '/' : '')).join('\n')}\n`);
            continue;
        }
        if (r.type === 'blob') {
            g.out(toText(await repo.readBlob(r.oid)));
            continue;
        }
        const sub = { ...g, args: [...flags, '-n', '1', r.oid] };
        status = await log(sub, { mode: 'show' }) || status;
    }
    return status;
}

// ---- diff -----------------------------------------------------------------------------------

async function diff(g) {
    const { opts, rest, unknown } = getopt(g.args, {
        bool: ['staged', 'cached', 'stat', 'shortstat', 'numstat', 'name-only', 'name-status', 'no-color', 'color', 'quiet', 'exit-code', 'w', 'ignore-all-space', 'merge-base'],
        value: ['U', 'unified'],
        alias: { cached: 'staged', unified: 'U', 'ignore-all-space': 'w' },
    });
    if (unknown.length) throw badOpt(unknown, 'diff');
    const repo = g.repo;
    const { revs, paths } = await splitRevsAndPaths(repo, rest);
    const pathspecs = paths.length ? compilePathspecs(repo, paths) : null;
    const inPaths = p => !pathspecs || pathspecs.some(s => s.test(p));
    const head = await repo.head();
    const color = g.color && !opts['no-color'];
    const context = opts.U !== undefined ? Number(opts.U) : 3;

    // collect pairs: { path, a: {oid, mode, bytes}|null, b: ... }
    const pairs = [];
    const fromTree = async (oid) => (oid ? repo.flatTree((await repo.readCommit(oid)).tree) : new Map());
    const withBytes = async e => (e ? { ...e, bytes: e.bytes || await repo.readBlob(e.oid) } : null);
    const pushPairs = async (aMap, bMap, bIsWork = false) => {
        const all = [...new Set([...aMap.keys(), ...bMap.keys()])].sort();
        for (const path of all) {
            if (!inPaths(path)) continue;
            const a = aMap.get(path) || null;
            let b = bMap.get(path) || null;
            if (bIsWork && b && b.work) {
                const bytes = await repo.workBytes(path);
                if (bytes === null) b = null;
                else b = { oid: await hashBlob(bytes), mode: b.mode, bytes };
            }
            if (a && b && a.oid === b.oid && a.mode === b.mode) continue;
            pairs.push({ path, a: await withBytes(a), b: b && b.bytes ? b : await withBytes(b) });
        }
    };
    const workMap = async (base) => {
        // tracked files (from base) as they are in the work tree
        const m = new Map();
        for (const [path, e] of base) m.set(path, { mode: e.mode, work: true });
        return m;
    };
    let description;
    if (opts.staged) {
        const base = revs[0] ? await resolveCommit(repo, revs[0]) : head.oid;
        await pushPairs(await fromTree(base), await repo.indexFlat());
        description = 'staged';
    } else if (revs.length >= 2 || (revs.length === 1 && /\.\./.test(revs[0]))) {
        let a;
        let b;
        if (revs.length === 1) {
            const sym = revs[0].includes('...');
            const [x, y] = revs[0].split(sym ? '...' : '..').map(s => s || 'HEAD');
            b = await resolveCommit(repo, y);
            a = sym ? await mergeBase(repo, await resolveCommit(repo, x), b) : await resolveCommit(repo, x);
        } else {
            a = await resolveCommit(repo, revs[0]);
            b = await resolveCommit(repo, revs[1]);
        }
        await pushPairs(await fromTree(a), await fromTree(b));
        description = 'commits';
    } else if (revs.length === 1) {
        const base = await fromTree(await resolveCommit(repo, revs[0]));
        const index = await repo.indexFlat();
        const work = await workMap(new Map([...base, ...index]));
        await pushPairs(base, work, true);
        description = 'commit-worktree';
    } else {
        const index = await repo.indexFlat();
        const conflicts = await repo.conflicts();
        for (const p of Object.keys(conflicts)) if (!index.has(p) && conflicts[p].theirs) index.set(p, { oid: conflicts[p].theirs, mode: '100644' });
        await pushPairs(index, await workMap(index), true);
        description = 'worktree';
    }
    g.info.diff = { mode: description, files: pairs.map(p => p.path) };
    if (opts.quiet || opts['exit-code']) {
        return pairs.length ? 1 : 0;
    }
    if (!pairs.length) return 0;
    if (opts['name-only']) { g.out(pairs.map(p => p.path).join('\n') + '\n'); return 0; }
    if (opts['name-status']) { g.out(pairs.map(p => `${!p.a ? 'A' : !p.b ? 'D' : 'M'}\t${p.path}`).join('\n') + '\n'); return 0; }
    const stats = pairs.map(p => ({ path: p.path, ...countChanges(p.a?.bytes ?? null, p.b?.bytes ?? null) }));
    if (opts.numstat) { g.out(stats.map(s => (s.binary ? `-\t-\t${s.path}` : `${s.insertions}\t${s.deletions}\t${s.path}`)).join('\n') + '\n'); return 0; }
    if (opts.stat || opts.shortstat) {
        if (opts.stat) g.out(formatStat(stats, { color, width: g.columns }));
        else g.out(summaryLine(stats.length, stats.reduce((s, x) => s + x.insertions, 0), stats.reduce((s, x) => s + x.deletions, 0)) + '\n');
        return 0;
    }
    let text = '';
    for (const p of pairs) {
        let a = p.a;
        let b = p.b;
        if (opts.w && a && b) {
            const strip = x => ({ ...x, bytes: new TextEncoder().encode(toText(x.bytes).replace(/[ \t]+/g, ' ').replace(/ +\n/g, '\n')) });
            if (toText(strip(a).bytes) === toText(strip(b).bytes)) continue;
        }
        text += formatFileDiff(p.path, a, b, { color, context });
    }
    if (text) {
        if (g.ctx.isTTY && g.ui.page && splitLines(text).length > 400) await g.ui.page(text, { title: 'git diff' });
        else g.out(text);
    }
    return 0;
}

// ---- blame -----------------------------------------------------------------------------------

async function blame(g) {
    const { opts, rest, unknown } = getopt(g.args, { bool: ['e', 's', 'l', 'w', 'c'], value: ['L'] });
    if (unknown.length) throw badOpt(unknown, 'blame');
    const repo = g.repo;
    const fileArg = rest[rest.length - 1];
    const revArg = rest.length > 1 ? rest[0] : null;
    if (!fileArg) throw usage('usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>');
    const path = repo.toRepoPath(fileArg);
    const start = revArg ? await resolveCommit(repo, revArg) : await repo.headOid();
    if (!start) throw fatal(revArg ? `bad revision '${revArg}'` : 'no such ref: HEAD');
    const startFlat = await repo.flatTree((await repo.readCommit(start)).tree);
    let finalText;
    let uncommitted = false;
    if (!revArg) {
        finalText = await repo.workText(path);
        if (finalText === null) throw fatal(`no such path '${fileArg}' in HEAD`);
        if (!startFlat.has(path)) uncommitted = true;
        else uncommitted = finalText !== await repo.blobText(startFlat.get(path).oid);
    } else {
        if (!startFlat.has(path)) throw fatal(`no such path ${fileArg} in ${revArg}`);
        finalText = await repo.blobText(startFlat.get(path).oid);
    }
    const finalLines = splitLines(finalText);
    const owner = new Array(finalLines.length).fill(null);
    // lines → map from current version line index to final index
    let pending = [];
    if (uncommitted) {
        const headText = startFlat.has(path) ? await repo.blobText(startFlat.get(path).oid) : '';
        const mapping = lineMapping(headText, finalText);
        finalLines.forEach((_, i) => {
            if (mapping.has(i)) pending.push({ commit: start, idx: mapping.get(i), final: i });
            else owner[i] = { oid: null };
        });
    } else {
        pending = finalLines.map((_, i) => ({ commit: start, idx: i, final: i }));
    }
    const textCache = new Map();
    const fileText = async (oid) => {
        if (!textCache.has(oid)) {
            const c = await repo.readCommit(oid);
            const flat = await repo.flatTree(c.tree);
            textCache.set(oid, flat.has(path) ? await repo.blobText(flat.get(path).oid) : null);
        }
        return textCache.get(oid);
    };
    // process commits newest first
    const commitCache = new Map();
    const getCommit = async oid => {
        if (!commitCache.has(oid)) commitCache.set(oid, await repo.readCommit(oid).catch(() => null));
        return commitCache.get(oid);
    };
    while (pending.length) {
        // pick the newest commit among pending
        let best = null;
        for (const p of pending) {
            const c = await getCommit(p.commit);
            if (!best || c.committer.timestamp > best.committer.timestamp) best = c;
        }
        const group = pending.filter(p => p.commit === best.oid);
        pending = pending.filter(p => p.commit !== best.oid);
        const myText = await fileText(best.oid);
        let remaining = group;
        for (const parent of best.parents) {
            if (!remaining.length) break;
            const pc = await getCommit(parent);
            if (!pc) continue;
            const ptext = await fileText(parent);
            if (ptext === null) continue;
            const mapping = lineMapping(ptext, myText);
            const passed = [];
            const kept = [];
            for (const r of remaining) {
                if (mapping.has(r.idx)) passed.push({ commit: parent, idx: mapping.get(r.idx), final: r.final });
                else kept.push(r);
            }
            pending.push(...passed);
            remaining = kept;
        }
        for (const r of remaining) owner[r.final] = { oid: best.oid, commit: best, boundary: !best.parents.length };
    }
    const lo = opts.L ? Number(String(opts.L).split(',')[0]) : 1;
    const hi = opts.L && String(opts.L).includes(',') ? Number(String(opts.L).split(',')[1]) : finalLines.length;
    const nameWidth = Math.max(...owner.map(o => (o.oid ? (opts.e ? `<${o.commit.author.email}>` : o.commit.author.name).length : 'Not Committed Yet'.length)), 1);
    const numWidth = String(finalLines.length).length;
    const out = [];
    for (let i = lo - 1; i < Math.min(hi, finalLines.length); i++) {
        const o = owner[i];
        if (!o.oid) {
            out.push(`00000000 (${'Not Committed Yet'.padEnd(nameWidth)} ${formatIsoDate(now(), tzOffset())} ${String(i + 1).padStart(numWidth)}) ${finalLines[i]}`);
            continue;
        }
        const id = (o.boundary ? '^' : '') + o.oid.slice(0, o.boundary ? 7 : 8);
        const who = opts.e ? `<${o.commit.author.email}>` : o.commit.author.name;
        const meta = opts.s ? '' : `(${who.padEnd(nameWidth)} ${formatIsoDate(o.commit.author.timestamp, o.commit.author.timezoneOffset)} ${String(i + 1).padStart(numWidth)}) `;
        out.push(`${paint(g, C.yellow, id)} ${opts.s ? `${String(i + 1).padStart(numWidth)}) ` : meta}${finalLines[i]}`);
    }
    if (out.length) g.out(out.join('\n') + '\n');
    return 0;
}

// Map line index in `newText` → line index in `oldText` for unchanged lines.
function lineMapping(oldText, newText) {
    const map = new Map();
    let a = 0;
    let b = 0;
    for (const part of Diff.diffLines(oldText, newText)) {
        const n = part.count || 0;
        if (part.added) b += n;
        else if (part.removed) a += n;
        else {
            for (let k = 0; k < n; k++) map.set(b + k, a + k);
            a += n;
            b += n;
        }
    }
    return map;
}

// ---- shortlog / reflog -------------------------------------------------------------------------------

async function shortlog(g) {
    const { opts, rest } = getopt(g.args, { bool: ['s', 'n', 'e', 'summary', 'numbered', 'email', 'all'], alias: { summary: 's', numbered: 'n', email: 'e' } });
    const repo = g.repo;
    let include = [];
    if (rest.length) ({ include } = await expandRanges(repo, rest));
    else if (opts.all) include = [...(await repo.branches()).map(b => b.oid)];
    else {
        const h = await repo.headOid();
        if (!h) throw fatal(`your current branch '${(await repo.head()).branch}' does not have any commits yet`);
        include = [h];
    }
    const commits = await walk(repo, { include });
    const groups = new Map();
    for (const c of commits) {
        const key = opts.e ? `${c.author.name} <${c.author.email}>` : c.author.name;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c.message.split('\n')[0]);
    }
    let entries = [...groups.entries()];
    entries.sort((x, y) => (opts.n ? y[1].length - x[1].length : 0) || x[0].localeCompare(y[0]));
    const out = [];
    for (const [name, subjects] of entries) {
        if (opts.s) out.push(`${String(subjects.length).padStart(6)}\t${name}`);
        else {
            out.push(`${name} (${subjects.length}):`);
            for (const s of subjects.slice().reverse()) out.push(`      ${s}`);
            out.push('');
        }
    }
    if (out.length) g.out(out.join('\n') + '\n');
    return 0;
}

async function reflog(g) {
    const args = g.args.filter(a => a !== 'show');
    if (args[0] === 'expire' || args[0] === 'delete') throw new GitError(g.lang === 'de' ? 'Diese Reflog-Funktion ist in der Werkstatt nicht verfügbar.' : 'This reflog subcommand is not available here.', { status: 1, kind: 'unsupported' });
    const { opts, rest } = getopt(args, { value: ['n', 'max-count'], alias: { 'max-count': 'n' } });
    const repo = g.repo;
    const target = rest[0] || 'HEAD';
    const ref = target === 'HEAD' ? 'HEAD' : target.startsWith('refs/') ? target : `refs/heads/${target}`;
    const entries = await readReflog(repo, ref);
    if (!entries.length && target !== 'HEAD' && !(await repo.readRef(ref))) throw fatal(`ambiguous argument '${target}': unknown revision or path not in the working tree.`);
    const color = g.color;
    const decos = color || g.ctx.isTTY ? await decorationMap(repo) : null;
    const limit = opts.n ? Number(opts.n) : entries.length;
    const out = [];
    entries.slice(0, limit).forEach((e, i) => {
        const deco = decos ? formatDecoration(e.new, decos, { color }) : '';
        out.push(`${paint(g, C.yellow, shortOid(e.new))}${i === 0 || deco ? deco : ''} ${target}@{${i}}: ${e.message}`);
    });
    if (out.length) g.out(out.join('\n') + '\n');
    g.info.reflog = { count: entries.length };
    return 0;
}

// ---- plumbing for the curious ----------------------------------------------------------------------

async function revParse(g) {
    const repo = g.repo;
    const out = [];
    let short = null;
    let abbrevRef = false;
    let verify = false;
    for (const a of g.args) {
        if (a === '--show-toplevel') { out.push(repo.dir); continue; }
        if (a === '--git-dir') { out.push(repo.world.cwd === repo.dir ? '.git' : repo.gitdir); continue; }
        if (a === '--is-inside-work-tree') { out.push('true'); continue; }
        if (a === '--show-prefix') { out.push(repo.prefix() ? repo.prefix() + '/' : ''); continue; }
        if (a === '--abbrev-ref') { abbrevRef = true; continue; }
        if (a === '--verify' || a === '-q' || a === '--quiet') { verify = true; continue; }
        if (a === '--short' || a.startsWith('--short=')) { short = a.includes('=') ? Number(a.split('=')[1]) : 7; continue; }
        if (abbrevRef) {
            const head = await repo.head();
            if (a === 'HEAD') { out.push(head.branch || 'HEAD'); continue; }
            const r = await resolve(repo, a);
            out.push(r?.ref ? r.ref.replace(/^refs\/(heads|remotes|tags)\//, '') : a);
            continue;
        }
        const r = await resolve(repo, a, { want: 'any' });
        if (!r || r.error) {
            if (verify) throw fatal('Needed a single revision');
            throw new GitError(unknownRevision(a), { status: 128, kind: 'unknown-revision', data: { rev: a } });
        }
        out.push(short ? r.oid.slice(0, short) : r.oid);
    }
    if (out.length) g.out(out.join('\n') + '\n');
    return 0;
}

async function catFile(g) {
    const repo = g.repo;
    const [flag, spec] = g.args;
    if (!flag || !spec) throw usage('usage: git cat-file <type> <object>\n   or: git cat-file (-e | -p | -t | -s) <object>');
    let oid;
    if (spec.includes(':')) {
        const b = await resolveBlobSpec(repo, spec);
        if (!b || b.error) throw fatal(b?.error || `Not a valid object name ${spec}`);
        oid = b.oid;
    } else {
        const r = await resolve(repo, spec, { want: 'any' });
        if (!r || r.error) {
            if (flag === '-e') return 1;
            throw fatal(`Not a valid object name ${spec}`);
        }
        oid = r.oid;
    }
    const obj = await git.readObject({ fs: repo.fs, gitdir: repo.gitdir, oid, format: 'content' });
    if (flag === '-e') return 0;
    if (flag === '-t') { g.out(obj.type + '\n'); return 0; }
    if (flag === '-s') { g.out(obj.object.length + '\n'); return 0; }
    if (obj.type === 'tree') {
        const { tree } = await git.readTree({ fs: repo.fs, gitdir: repo.gitdir, oid });
        g.out(tree.map(e => `${e.mode.padStart(6, '0')} ${e.type} ${e.oid}\t${e.path}`).join('\n') + '\n');
        return 0;
    }
    g.out(toText(obj.object));
    return 0;
}

async function lsFiles(g) {
    const { opts } = getopt(g.args, { bool: ['s', 'stage', 'o', 'others', 'm', 'modified', 'd', 'deleted', 'c', 'cached', 'exclude-standard'], alias: { stage: 's', others: 'o', modified: 'm', deleted: 'd', cached: 'c' } });
    const repo = g.repo;
    const prefix = repo.prefix();
    const inCwd = p => !prefix || p.startsWith(prefix + '/');
    const out = [];
    if (opts.o) {
        for (const [p, H, W, S] of await repo.statusMatrix()) if (!H && !S && W && inCwd(p)) out.push(repo.displayPath(p));
    } else if (opts.m || opts.d) {
        for (const [p, H, W, S] of await repo.statusMatrix()) {
            if (!inCwd(p) || (!H && !S)) continue;
            if (opts.d && W === 0) out.push(repo.displayPath(p));
            else if (opts.m && (W === 0 || (S === 1 && W === 2) || S === 3)) out.push(repo.displayPath(p));
        }
    } else {
        const index = await repo.indexFlat();
        for (const [p, e] of [...index].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
            if (!inCwd(p)) continue;
            out.push(opts.s ? `${e.mode} ${e.oid} 0\t${repo.displayPath(p)}` : repo.displayPath(p));
        }
    }
    if (out.length) g.out(out.join('\n') + '\n');
    return 0;
}

async function hashObject(g) {
    const { opts, rest } = getopt(g.args, { bool: ['w', 'stdin'] });
    let bytes;
    if (opts.stdin) bytes = new TextEncoder().encode(await g.ctx.readStdin());
    else {
        if (!rest[0]) throw usage('usage: git hash-object [-t <type>] [-w] [--stdin] <file>...');
        bytes = await g.world.pfs.readFile(g.world.resolve(rest[0])).catch(() => null);
        if (!bytes) throw fatal(`could not open '${rest[0]}' for reading: No such file or directory`);
    }
    const oid = opts.w && g.repo ? await git.writeBlob({ fs: g.repo.fs, gitdir: g.repo.gitdir, blob: bytes }) : await hashBlob(bytes);
    g.out(oid + '\n');
    return 0;
}

export function registerInspect(define) {
    define({
        name: 'log', run: g => log(g), usage: 'git log [--oneline] [--graph] [--all] [-n N] [<bereich>] [-- <datei>]',
        summary: D('Zeigt die Versionsgeschichte (Commits).', 'Shows the commit history.'),
        options: [
            { flags: ['--oneline'], desc: D('eine Zeile pro Commit', 'one line per commit') },
            { flags: ['--graph'], desc: D('Branches und Merges als Grafik', 'draw branches and merges') },
            { flags: ['--all'], desc: D('Commits aller Branches', 'commits of all branches') },
            { flags: ['-n'], arg: 'N', desc: D('nur die letzten N Commits', 'only the last N commits') },
            { flags: ['--stat'], desc: D('geänderte Dateien je Commit', 'changed files per commit') },
            { flags: ['-p'], desc: D('vollständige Änderungen (Patch)', 'full changes (patch)') },
            { flags: ['--author'], arg: 'NAME', desc: D('nur Commits dieser Person', 'only commits by this person') },
        ],
        examples: [{ cmd: 'git log --oneline --graph --all', desc: D('kompakter Überblick über alle Branches', 'compact overview of all branches') }],
    });
    define({
        name: 'show', run: show, usage: 'git show [<commit>] | git show <commit>:<datei>',
        summary: D('Zeigt einen Commit mit seinen Änderungen (oder eine Datei aus einem Commit).', 'Shows a commit with its changes (or a file from a commit).'),
        options: [{ flags: ['--stat'], desc: D('nur Übersicht der Dateien', 'only a file overview') }, { flags: ['--name-only'], desc: D('nur Dateinamen', 'file names only') }],
    });
    define({
        name: 'diff', run: diff, usage: 'git diff [--staged] [<commit> [<commit>]] [-- <datei>]',
        summary: D('Zeigt Unterschiede: was hat sich Zeile für Zeile geändert?', 'Shows differences: what changed, line by line?'),
        options: [
            { flags: ['(ohne)'], desc: D('Arbeitsverzeichnis gegen Staging-Area (noch nicht vorgemerkt)', 'working tree vs. staging area (not yet staged)') },
            { flags: ['--staged'], desc: D('Staging-Area gegen letzten Commit (wird committet)', 'staging area vs. last commit (will be committed)') },
            { flags: ['--stat'], desc: D('nur Übersicht', 'summary only') },
        ],
    });
    define({ name: 'blame', run: blame, usage: 'git blame <datei>', summary: D('Zeigt für jede Zeile, wer sie zuletzt geändert hat.', 'Shows who last changed each line.') });
    define({ name: 'shortlog', run: shortlog, usage: 'git shortlog [-sn]', summary: D('Fasst Commits nach Autor zusammen.', 'Summarizes commits by author.'), options: [{ flags: ['-s'], desc: D('nur Anzahl', 'counts only') }, { flags: ['-n'], desc: D('nach Anzahl sortieren', 'sort by count') }] });
    define({
        name: 'reflog', run: reflog, usage: 'git reflog [<branch>]',
        summary: D('Tagebuch von HEAD: wohin HEAD zuletzt zeigte. Rettungsanker für „verlorene“ Commits.', "HEAD's diary: where HEAD pointed recently. The lifeline for 'lost' commits."),
        examples: [{ cmd: 'git reset --hard HEAD@{1}', desc: D('zurück zum Stand vor dem letzten Schritt', 'go back to before the last step') }],
    });
    define({ name: 'rev-parse', run: revParse, usage: 'git rev-parse <revision>', summary: D('Wandelt Namen wie HEAD~2 in Commit-IDs um.', 'Turns names like HEAD~2 into commit ids.') });
    define({ name: 'cat-file', run: catFile, usage: 'git cat-file -p <objekt>', summary: D('Zeigt ein Git-Objekt (Commit, Tree, Blob) im Rohformat.', 'Shows a raw git object (commit, tree, blob).') });
    define({ name: 'ls-files', run: lsFiles, usage: 'git ls-files [-s]', summary: D('Listet die Dateien in der Staging-Area (Index).', 'Lists the files in the index.') });
    define({ name: 'hash-object', repo: 'optional', run: hashObject, usage: 'git hash-object <datei>', summary: D('Berechnet die Objekt-ID einer Datei.', 'Computes the object id of a file.') });
}

export { log, lineMapping };
