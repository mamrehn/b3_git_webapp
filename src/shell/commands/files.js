// File and directory commands: ls, cd, pwd, mkdir, rmdir, touch, rm, cp, mv, ln,
// stat, tree, find, basename, dirname, realpath, file, chmod, du.
// Messages follow GNU coreutils 9 / bash so that they match tutorials and real machines.

import { getopt } from '../registry.js';
import { statOrNull, lstatOrNull, mkdirp, rmrf, copyRecursive, move, readdirSorted } from '../../vfs/fsutil.js';
import { joinPath, basename, dirname, normalizePath, globToRegExp, isInside } from '../../core/util.js';

const C = {
    dir: '\x1b[01;34m',
    link: '\x1b[01;36m',
    exec: '\x1b[01;32m',
    reset: '\x1b[0m',
};

function usageError(ctx, cmd, message) {
    ctx.errln(`${cmd}: ${message}`);
    ctx.errln(`Try '${cmd} --help' for more information.`);
    return 1;
}

function badOption(ctx, cmd, unknown) {
    const u = unknown[0];
    if (u.missingValue) ctx.errln(`${cmd}: option requires an argument -- '${u.option.replace(/^-+/, '')}'`);
    else if (u.option.startsWith('--')) ctx.errln(`${cmd}: unrecognized option '${u.option}'`);
    else ctx.errln(`${cmd}: invalid option -- '${u.option.slice(1)}'`);
    ctx.errln(`Try '${cmd} --help' for more information.`);
    return cmd === 'ls' ? 2 : 1;
}

function denied(ctx, path) {
    return !ctx.world.canWrite(path);
}

function isExecutable(st) {
    return Boolean(st && st.isFile() && (st.mode & 0o111));
}

function colorName(name, st, isTTY) {
    if (!isTTY || !st) return name;
    if (st.isSymbolicLink && st.isSymbolicLink()) return C.link + name + C.reset;
    if (st.isDirectory()) return C.dir + name + C.reset;
    if (isExecutable(st)) return C.exec + name + C.reset;
    return name;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function lsDate(ms) {
    const d = new Date(ms || Date.now());
    const mon = MONTHS[d.getMonth()];
    const day = String(d.getDate()).padStart(2, ' ');
    if (Date.now() - d.getTime() < 182 * 24 * 3600 * 1000) {
        return `${mon} ${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${mon} ${day}  ${d.getFullYear()}`;
}

function permString(st) {
    if (st.isSymbolicLink && st.isSymbolicLink()) return 'lrwxrwxrwx';
    if (st.isDirectory()) return 'drwxr-xr-x';
    return isExecutable(st) ? '-rwxr-xr-x' : '-rw-r--r--';
}

function humanSize(n) {
    if (n < 1024) return String(n);
    const units = ['K', 'M', 'G'];
    let v = n;
    let u = -1;
    do { v /= 1024; u++; } while (v >= 1024 && u < units.length - 1);
    return (v < 10 ? Math.ceil(v * 10) / 10 : Math.ceil(v)) + units[u];
}

function sizeOf(st) {
    return st.isDirectory() ? 4096 : (st.size || 0);
}

function columns(names, plain, width) {
    if (!names.length) return '';
    const maxLen = Math.max(...plain.map(n => [...n].length));
    const colWidth = maxLen + 2;
    const cols = Math.max(1, Math.floor((width + 2) / colWidth));
    const rows = Math.ceil(names.length / cols);
    let out = '';
    for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) {
            const idx = c * rows + r;
            if (idx >= names.length) break;
            const isLast = (c + 1) * rows + r >= names.length;
            line += names[idx] + (isLast ? '' : ' '.repeat(colWidth - [...plain[idx]].length));
        }
        out += line + '\n';
    }
    return out;
}

// ---- ls ---------------------------------------------------------------------------

async function ls(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, {
        bool: ['a', 'A', 'l', 'h', '1', 'R', 't', 'r', 'S', 'd', 'F', 'all', 'almost-all', 'human-readable', 'recursive', 'reverse', 'directory', 'classify', 'color'],
        alias: { all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', reverse: 'r', directory: 'd', classify: 'F' },
    });
    if (unknown.length) return badOption(ctx, 'ls', unknown);
    const pfs = ctx.pfs;
    const targets = rest.length ? rest : ['.'];
    let status = 0;
    const files = [];
    const dirs = [];
    for (const t of targets) {
        const st = await lstatOrNull(pfs, ctx.resolve(t));
        if (!st) {
            ctx.errln(`ls: cannot access '${t}': No such file or directory`);
            status = 2;
            continue;
        }
        if (st.isDirectory() && !opts.d) dirs.push(t);
        else files.push({ name: t, st });
    }

    const sortEntries = (entries) => {
        if (opts.t) entries.sort((a, b) => (b.st.mtimeMs || 0) - (a.st.mtimeMs || 0));
        else if (opts.S) entries.sort((a, b) => sizeOf(b.st) - sizeOf(a.st));
        else entries.sort((a, b) => a.name.replace(/^\./, '').localeCompare(b.name.replace(/^\./, ''), 'en'));
        if (opts.r) entries.reverse();
        return entries;
    };

    const render = (entries, { total = false } = {}) => {
        if (opts.l) {
            let out = '';
            if (total) {
                const blocks = entries.reduce((s, e) => s + Math.ceil(sizeOf(e.st) / 4096) * 4, 0);
                out += `total ${blocks}\n`;
            }
            const sizes = entries.map(e => (opts.h ? humanSize(sizeOf(e.st)) : String(sizeOf(e.st))));
            const sw = Math.max(...sizes.map(s => s.length), 1);
            entries.forEach((e, i) => {
                const links = e.st.isDirectory() ? 2 : 1;
                let name = colorName(e.name, e.st, ctx.isTTY);
                if (e.link) name += ` -> ${e.link}`;
                else if (opts.F) name += suffixF(e.st);
                out += `${permString(e.st)} ${links} student student ${sizes[i].padStart(sw)} ${lsDate(e.st.mtimeMs)} ${name}\n`;
            });
            return out;
        }
        const plain = entries.map(e => e.name + (opts.F ? suffixF(e.st) : ''));
        const colored = entries.map((e, i) => colorName(e.name, e.st, ctx.isTTY) + plain[i].slice(e.name.length));
        if (!ctx.isTTY || opts['1']) return plain.length ? plain.join('\n') + '\n' : '';
        return columns(colored, plain, ctx.columns);
    };

    if (files.length) {
        const entries = [];
        for (const f of files) {
            const link = f.st.isSymbolicLink && f.st.isSymbolicLink() ? await pfs.readlink(ctx.resolve(f.name)).catch(() => null) : null;
            entries.push({ name: f.name, st: f.st, link });
        }
        ctx.out(render(sortEntries(entries)));
    }

    const listDir = async (shown, path, header) => {
        let names;
        try {
            names = await pfs.readdir(path);
        } catch {
            ctx.errln(`ls: cannot open directory '${shown}': Permission denied`);
            status = 2;
            return;
        }
        if (!opts.a && !opts.A) names = names.filter(n => !n.startsWith('.'));
        const entries = [];
        if (opts.a) {
            entries.push({ name: '.', st: await pfs.stat(path) });
            entries.push({ name: '..', st: await pfs.stat(normalizePath(path + '/..')) });
        }
        for (const n of names) {
            const full = joinPath(path, n);
            const st = await lstatOrNull(pfs, full);
            if (!st) continue;
            const link = st.isSymbolicLink && st.isSymbolicLink() ? await pfs.readlink(full).catch(() => null) : null;
            entries.push({ name: n, st, link });
        }
        if (header) ctx.out(`${shown}:\n`);
        ctx.out(render(sortEntries(entries), { total: true }));
        if (opts.R) {
            for (const e of entries) {
                if (e.name === '.' || e.name === '..' || !e.st.isDirectory()) continue;
                ctx.out('\n');
                await listDir(shown === '.' ? `./${e.name}` : `${shown}/${e.name}`, joinPath(path, e.name), true);
            }
        }
    };

    for (let i = 0; i < dirs.length; i++) {
        if (files.length || i > 0) ctx.out('\n');
        await listDir(dirs[i], ctx.resolve(dirs[i]), targets.length > 1 || opts.R);
    }
    return status;
}

function suffixF(st) {
    if (st.isDirectory()) return '/';
    if (st.isSymbolicLink && st.isSymbolicLink()) return '@';
    if (isExecutable(st)) return '*';
    return '';
}

// ---- cd / pwd -----------------------------------------------------------------------

async function cd(ctx) {
    const w = ctx.world;
    const args = ctx.args.filter(a => a !== '-L' && a !== '-P');
    if (args.length > 1) {
        ctx.errln('bash: cd: too many arguments');
        return 1;
    }
    let target = args[0];
    let print = false;
    if (target === undefined || target === '') target = w.env.HOME;
    if (target === '-') {
        if (!w.oldpwd) {
            ctx.errln('bash: cd: OLDPWD not set');
            return 1;
        }
        target = w.oldpwd;
        print = true;
    }
    const path = ctx.resolve(target);
    const st = await statOrNull(ctx.pfs, path);
    if (!st) {
        ctx.errln(`bash: cd: ${args[0]}: No such file or directory`);
        return 1;
    }
    if (!st.isDirectory()) {
        ctx.errln(`bash: cd: ${args[0]}: Not a directory`);
        return 1;
    }
    w.oldpwd = w.cwd;
    w.cwd = path;
    ctx.info.cwdChanged = { from: w.oldpwd, to: path };
    if (print) ctx.outln(path);
    return 0;
}

async function pwd(ctx) {
    ctx.outln(ctx.cwd);
    return 0;
}

// ---- mkdir / rmdir / touch ---------------------------------------------------------------

async function mkdir(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['p', 'v', 'parents', 'verbose'], alias: { parents: 'p', verbose: 'v' } });
    if (unknown.length) return badOption(ctx, 'mkdir', unknown);
    if (!rest.length) return usageError(ctx, 'mkdir', 'missing operand');
    let status = 0;
    for (const name of rest) {
        const path = ctx.resolve(name);
        if (denied(ctx, path)) {
            ctx.errln(`mkdir: cannot create directory ‘${name}’: Permission denied`);
            status = 1;
            continue;
        }
        const st = await statOrNull(ctx.pfs, path);
        if (st) {
            if (opts.p && st.isDirectory()) continue;
            ctx.errln(`mkdir: cannot create directory ‘${name}’: File exists`);
            status = 1;
            continue;
        }
        try {
            if (opts.p) {
                await mkdirp(ctx.pfs, path);
            } else {
                const parent = await statOrNull(ctx.pfs, dirname(path));
                if (!parent) throw Object.assign(new Error(), { code: 'ENOENT' });
                if (!parent.isDirectory()) throw Object.assign(new Error(), { code: 'ENOTDIR' });
                await ctx.pfs.mkdir(path);
            }
            if (opts.v) ctx.outln(`mkdir: created directory '${name}'`);
        } catch (e) {
            const reason = e.code === 'ENOTDIR' ? 'Not a directory' : 'No such file or directory';
            ctx.errln(`mkdir: cannot create directory ‘${name}’: ${reason}`);
            status = 1;
        }
    }
    return status;
}

async function rmdir(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['p', 'v', 'parents', 'verbose'], alias: { parents: 'p', verbose: 'v' } });
    if (unknown.length) return badOption(ctx, 'rmdir', unknown);
    if (!rest.length) return usageError(ctx, 'rmdir', 'missing operand');
    let status = 0;
    for (const name of rest) {
        const path = ctx.resolve(name);
        const st = await statOrNull(ctx.pfs, path);
        if (!st) { ctx.errln(`rmdir: failed to remove '${name}': No such file or directory`); status = 1; continue; }
        if (!st.isDirectory()) { ctx.errln(`rmdir: failed to remove '${name}': Not a directory`); status = 1; continue; }
        if (denied(ctx, path) || path === ctx.world.env.HOME) { ctx.errln(`rmdir: failed to remove '${name}': Permission denied`); status = 1; continue; }
        if ((await ctx.pfs.readdir(path)).length) { ctx.errln(`rmdir: failed to remove '${name}': Directory not empty`); status = 1; continue; }
        await ctx.pfs.rmdir(path);
        if (opts.v) ctx.outln(`rmdir: removing directory, '${name}'`);
    }
    return status;
}

async function touch(ctx) {
    const { rest, unknown } = getopt(ctx.args, { bool: ['c', 'a', 'm', 'no-create'], alias: { 'no-create': 'c' } });
    if (unknown.length) return badOption(ctx, 'touch', unknown);
    if (!rest.length) return usageError(ctx, 'touch', 'missing file operand');
    let status = 0;
    for (const name of rest) {
        const path = ctx.resolve(name);
        if (denied(ctx, path)) { ctx.errln(`touch: cannot touch '${name}': Permission denied`); status = 1; continue; }
        const st = await statOrNull(ctx.pfs, path);
        try {
            if (st) {
                if (st.isFile()) await ctx.pfs.writeFile(path, await ctx.pfs.readFile(path), { mode: st.mode });
            } else {
                const parent = await statOrNull(ctx.pfs, dirname(path));
                if (!parent || !parent.isDirectory()) throw new Error('ENOENT');
                await ctx.pfs.writeFile(path, '', 'utf8');
            }
        } catch {
            ctx.errln(`touch: cannot touch '${name}': No such file or directory`);
            status = 1;
        }
    }
    return status;
}

// ---- rm / cp / mv / ln --------------------------------------------------------------------

async function rm(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, {
        bool: ['r', 'R', 'f', 'i', 'v', 'd', 'recursive', 'force', 'verbose', 'dir'],
        alias: { recursive: 'r', force: 'f', verbose: 'v', dir: 'd' },
    });
    if (unknown.length) return badOption(ctx, 'rm', unknown);
    if (!rest.length) {
        if (opts.f) return 0;
        return usageError(ctx, 'rm', 'missing operand');
    }
    const recursive = opts.r || opts.R;
    let status = 0;
    const removed = [];
    for (const name of rest) {
        const path = ctx.resolve(name);
        if (/(^|\/)\.\.?\/?$/.test(name)) {
            ctx.errln(`rm: refusing to remove '.' or '..' directory: skipping '${name}'`);
            status = 1;
            continue;
        }
        const st = await lstatOrNull(ctx.pfs, path);
        if (!st) {
            if (!opts.f) { ctx.errln(`rm: cannot remove '${name}': No such file or directory`); status = 1; }
            continue;
        }
        if (path === '/' || denied(ctx, path) || path === ctx.world.env.HOME) {
            ctx.errln(`rm: cannot remove '${name}': Permission denied`);
            status = 1;
            continue;
        }
        if (st.isDirectory()) {
            if (!recursive) {
                if (opts.d && !(await ctx.pfs.readdir(path)).length) {
                    await ctx.pfs.rmdir(path);
                    removed.push(name);
                    continue;
                }
                ctx.errln(`rm: cannot remove '${name}': Is a directory`);
                status = 1;
                continue;
            }
            if (isInside(ctx.cwd, path)) ctx.info.removedCwd = true;
            await rmrf(ctx.pfs, path);
            if (opts.v) ctx.outln(`removed directory '${name}'`);
        } else {
            await ctx.pfs.unlink(path);
            if (opts.v) ctx.outln(`removed '${name}'`);
        }
        removed.push(name);
    }
    ctx.info.removed = removed;
    return status;
}

async function cp(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, {
        bool: ['r', 'R', 'f', 'i', 'n', 'v', 'a', 'p', 'recursive', 'force', 'verbose', 'archive'],
        alias: { recursive: 'r', force: 'f', verbose: 'v', archive: 'a' },
    });
    if (unknown.length) return badOption(ctx, 'cp', unknown);
    if (!rest.length) return usageError(ctx, 'cp', 'missing file operand');
    if (rest.length === 1) return usageError(ctx, 'cp', `missing destination file operand after '${rest[0]}'`);
    const recursive = opts.r || opts.R || opts.a;
    const sources = rest.slice(0, -1);
    const destName = rest[rest.length - 1];
    const dest = ctx.resolve(destName);
    const destSt = await statOrNull(ctx.pfs, dest);
    if (sources.length > 1 && !(destSt && destSt.isDirectory())) {
        ctx.errln(`cp: target '${destName}' is not a directory`);
        return 1;
    }
    let status = 0;
    for (const s of sources) {
        const src = ctx.resolve(s);
        const st = await lstatOrNull(ctx.pfs, src);
        if (!st) { ctx.errln(`cp: cannot stat '${s}': No such file or directory`); status = 1; continue; }
        const target = destSt && destSt.isDirectory() ? joinPath(dest, basename(src)) : dest;
        if (denied(ctx, target)) { ctx.errln(`cp: cannot create regular file '${destName}': Permission denied`); status = 1; continue; }
        if (st.isDirectory()) {
            if (!recursive) { ctx.errln(`cp: -r not specified; omitting directory '${s}'`); status = 1; continue; }
            if (isInside(target, src)) { ctx.errln(`cp: cannot copy a directory, '${s}', into itself, '${destName}'`); status = 1; continue; }
            await copyRecursive(ctx.pfs, src, target);
        } else {
            if (target === src) { ctx.errln(`cp: '${s}' and '${destName}' are the same file`); status = 1; continue; }
            if (opts.n && await statOrNull(ctx.pfs, target)) continue;
            const parent = await statOrNull(ctx.pfs, dirname(target));
            if (!parent) { ctx.errln(`cp: cannot create regular file '${destName}': No such file or directory`); status = 1; continue; }
            await ctx.pfs.writeFile(target, await ctx.pfs.readFile(src), { mode: st.mode });
        }
        if (opts.v) ctx.outln(`'${s}' -> '${destSt && destSt.isDirectory() ? joinPath(destName, basename(src)) : destName}'`);
    }
    return status;
}

async function mv(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, {
        bool: ['f', 'i', 'n', 'v', 'force', 'verbose', 'no-clobber'],
        alias: { force: 'f', verbose: 'v', 'no-clobber': 'n' },
    });
    if (unknown.length) return badOption(ctx, 'mv', unknown);
    if (!rest.length) return usageError(ctx, 'mv', 'missing file operand');
    if (rest.length === 1) return usageError(ctx, 'mv', `missing destination file operand after '${rest[0]}'`);
    const sources = rest.slice(0, -1);
    const destName = rest[rest.length - 1];
    const dest = ctx.resolve(destName);
    const destSt = await statOrNull(ctx.pfs, dest);
    if (sources.length > 1 && !(destSt && destSt.isDirectory())) {
        ctx.errln(`mv: target '${destName}' is not a directory`);
        return 1;
    }
    let status = 0;
    for (const s of sources) {
        const src = ctx.resolve(s);
        const st = await lstatOrNull(ctx.pfs, src);
        if (!st) { ctx.errln(`mv: cannot stat '${s}': No such file or directory`); status = 1; continue; }
        const target = destSt && destSt.isDirectory() ? joinPath(dest, basename(src)) : dest;
        if (denied(ctx, src) || denied(ctx, target)) { ctx.errln(`mv: cannot move '${s}' to '${destName}': Permission denied`); status = 1; continue; }
        if (target === src) { ctx.errln(`mv: '${s}' and '${destName}' are the same file`); status = 1; continue; }
        if (st.isDirectory() && isInside(target, src)) { ctx.errln(`mv: cannot move '${s}' to a subdirectory of itself, '${destName}'`); status = 1; continue; }
        const existing = await statOrNull(ctx.pfs, target);
        if (existing) {
            if (opts.n) continue;
            if (existing.isDirectory() && !st.isDirectory()) { ctx.errln(`mv: cannot overwrite directory '${destName}' with non-directory`); status = 1; continue; }
            if (existing.isDirectory()) {
                if ((await ctx.pfs.readdir(target)).length) { ctx.errln(`mv: cannot move '${s}' to '${destName}': Directory not empty`); status = 1; continue; }
                await ctx.pfs.rmdir(target);
            } else {
                await ctx.pfs.unlink(target);
            }
        }
        const parent = await statOrNull(ctx.pfs, dirname(target));
        if (!parent) { ctx.errln(`mv: cannot move '${s}' to '${destName}': No such file or directory`); status = 1; continue; }
        if (isInside(ctx.cwd, src)) ctx.info.movedCwd = true;
        await move(ctx.pfs, src, target);
        if (opts.v) ctx.outln(`renamed '${s}' -> '${destSt && destSt.isDirectory() ? joinPath(destName, basename(src)) : destName}'`);
    }
    return status;
}

async function ln(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['s', 'f', 'v', 'symbolic', 'force'], alias: { symbolic: 's', force: 'f' } });
    if (unknown.length) return badOption(ctx, 'ln', unknown);
    if (rest.length < 1) return usageError(ctx, 'ln', 'missing file operand');
    const [target, linkName = basename(rest[0])] = rest;
    const linkPath = ctx.resolve(linkName);
    if (denied(ctx, linkPath)) { ctx.errln(`ln: failed to create symbolic link '${linkName}': Permission denied`); return 1; }
    const existing = await lstatOrNull(ctx.pfs, linkPath);
    if (existing) {
        if (!opts.f) {
            ctx.errln(`ln: failed to create ${opts.s ? 'symbolic' : 'hard'} link '${linkName}': File exists`);
            return 1;
        }
        await rmrf(ctx.pfs, linkPath);
    }
    if (opts.s) {
        await ctx.pfs.symlink(target, linkPath);
        return 0;
    }
    // Hard links are not supported by the virtual file system: copy instead.
    const src = ctx.resolve(target);
    const st = await statOrNull(ctx.pfs, src);
    if (!st) { ctx.errln(`ln: failed to access '${target}': No such file or directory`); return 1; }
    if (st.isDirectory()) { ctx.errln(`ln: ${target}: hard link not allowed for directory`); return 1; }
    await ctx.pfs.writeFile(linkPath, await ctx.pfs.readFile(src), { mode: st.mode });
    ctx.info.note = 'hardlink-copy';
    return 0;
}

// ---- inspection -----------------------------------------------------------------------------

async function stat(ctx) {
    const { rest } = getopt(ctx.args, { bool: ['L', 'c'] });
    if (!rest.length) return usageError(ctx, 'stat', 'missing operand');
    let status = 0;
    for (const name of rest) {
        const st = await lstatOrNull(ctx.pfs, ctx.resolve(name));
        if (!st) { ctx.errln(`stat: cannot statx '${name}': No such file or directory`); status = 1; continue; }
        const type = st.isDirectory() ? 'directory' : st.isSymbolicLink && st.isSymbolicLink() ? 'symbolic link' : (st.size ? 'regular file' : 'regular empty file');
        const when = new Date(st.mtimeMs || Date.now()).toISOString().replace('T', ' ').replace('Z', ' +0000');
        const perm = permString(st);
        const octal = st.isDirectory() ? '0755' : isExecutable(st) ? '0755' : '0644';
        ctx.outln(`  File: ${name}`);
        ctx.outln(`  Size: ${String(sizeOf(st)).padEnd(15)} Blocks: ${String(Math.ceil(sizeOf(st) / 512)).padEnd(10)} IO Block: 4096   ${type}`);
        ctx.outln(`Device: 0,42    Inode: ${String(st.ino || 0).padEnd(11)} Links: ${st.isDirectory() ? 2 : 1}`);
        ctx.outln(`Access: (${octal}/${perm})  Uid: ( 1000/ student)   Gid: ( 1000/ student)`);
        ctx.outln(`Modify: ${when}`);
    }
    return status;
}

async function tree(ctx) {
    const { opts, rest, unknown } = getopt(ctx.args, { bool: ['a', 'd', 'f'], value: ['L', 'I'] });
    if (unknown.length) return badOption(ctx, 'tree', unknown);
    const roots = rest.length ? rest : ['.'];
    const maxDepth = opts.L ? Number(opts.L) : Infinity;
    const ignore = opts.I ? globToRegExp(opts.I) : null;
    let dirs = 0;
    let files = 0;
    for (const root of roots) {
        const path = ctx.resolve(root);
        const st = await statOrNull(ctx.pfs, path);
        if (!st) { ctx.outln(`${root}  [error opening dir]`); continue; }
        ctx.outln(colorName(root, st, ctx.isTTY));
        const visit = async (dir, prefix, depth) => {
            if (depth > maxDepth) return;
            let names = await readdirSorted(ctx.pfs, dir);
            if (!opts.a) names = names.filter(n => !n.startsWith('.'));
            if (ignore) names = names.filter(n => !ignore.test(n));
            const entries = [];
            for (const n of names) {
                const s = await lstatOrNull(ctx.pfs, joinPath(dir, n));
                if (!s || (opts.d && !s.isDirectory())) continue;
                entries.push({ n, s });
            }
            for (let i = 0; i < entries.length; i++) {
                const { n, s } = entries[i];
                const last = i === entries.length - 1;
                ctx.outln(`${prefix}${last ? '└── ' : '├── '}${colorName(n, s, ctx.isTTY)}`);
                if (s.isDirectory()) {
                    dirs++;
                    await visit(joinPath(dir, n), prefix + (last ? '    ' : '│   '), depth + 1);
                } else {
                    files++;
                }
            }
        };
        await visit(path, '', 1);
    }
    ctx.outln('');
    ctx.outln(opts.d ? `${dirs} director${dirs === 1 ? 'y' : 'ies'}` : `${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`);
    return 0;
}

async function find(ctx) {
    // find [path...] [expression]
    const args = [...ctx.args];
    const paths = [];
    while (args.length && !args[0].startsWith('-') && args[0] !== '!' && args[0] !== '(') paths.push(args.shift());
    if (!paths.length) paths.push('.');
    const tests = [];
    let maxDepth = Infinity;
    let minDepth = 0;
    let negateNext = false;
    while (args.length) {
        const a = args.shift();
        const push = test => { tests.push(negateNext ? (e => !test(e)) : test); negateNext = false; };
        if (a === '!' || a === '-not') { negateNext = true; continue; }
        if (a === '-name' || a === '-iname') {
            const pat = args.shift();
            if (pat === undefined) { ctx.errln(`find: missing argument to \`${a}'`); return 1; }
            const re = globToRegExp(pat, { dotAll: true });
            const reI = new RegExp(re.source, 'i');
            push(e => (a === '-iname' ? reI : re).test(e.name));
        } else if (a === '-path' || a === '-wholename') {
            const re = globToRegExp(args.shift() || '', { dotAll: true });
            push(e => re.test(e.shown));
        } else if (a === '-type') {
            const t = args.shift();
            push(e => (t === 'd' ? e.st.isDirectory() : t === 'f' ? e.st.isFile() : t === 'l' ? e.st.isSymbolicLink?.() : false));
        } else if (a === '-maxdepth') {
            maxDepth = Number(args.shift());
        } else if (a === '-mindepth') {
            minDepth = Number(args.shift());
        } else if (a === '-empty') {
            push(e => (e.st.isDirectory() ? e.empty : (e.st.size || 0) === 0));
        } else if (a === '-print') {
            continue;
        } else {
            ctx.errln(`find: unknown predicate \`${a}'`);
            return 1;
        }
    }
    let status = 0;
    for (const p of paths) {
        const root = ctx.resolve(p);
        const st = await lstatOrNull(ctx.pfs, root);
        if (!st) { ctx.errln(`find: '${p}': No such file or directory`); status = 1; continue; }
        const visit = async (full, shown, s, depth) => {
            let names = [];
            if (s.isDirectory()) names = await readdirSorted(ctx.pfs, full).catch(() => []);
            const entry = { name: depth === 0 ? basename(full) : basename(shown), shown, st: s, empty: s.isDirectory() && names.length === 0 };
            if (depth >= minDepth && tests.every(t => t(entry))) ctx.outln(shown);
            if (s.isDirectory() && depth < maxDepth) {
                for (const n of names) {
                    const child = joinPath(full, n);
                    const cs = await lstatOrNull(ctx.pfs, child);
                    if (cs) await visit(child, shown.endsWith('/') ? shown + n : `${shown}/${n}`, cs, depth + 1);
                }
            }
        };
        await visit(root, p, st, 0);
    }
    return status;
}

async function basenameCmd(ctx) {
    const { opts, rest } = getopt(ctx.args, { bool: ['a'], value: ['s'] });
    if (!rest.length) return usageError(ctx, 'basename', 'missing operand');
    const names = opts.a || opts.s ? rest : [rest[0]];
    const suffix = opts.s ?? (opts.a ? null : rest[1]);
    for (const n of names) {
        let b = n.replace(/\/+$/, '');
        b = b.slice(b.lastIndexOf('/') + 1) || '/';
        if (suffix && b.endsWith(suffix) && b !== suffix) b = b.slice(0, -suffix.length);
        ctx.outln(b);
    }
    return 0;
}

async function dirnameCmd(ctx) {
    if (!ctx.args.length) return usageError(ctx, 'dirname', 'missing operand');
    for (const n of ctx.args) {
        const p = n.replace(/\/+$/, '') || '/';
        const i = p.lastIndexOf('/');
        ctx.outln(i === -1 ? '.' : i === 0 ? '/' : p.slice(0, i));
    }
    return 0;
}

async function realpath(ctx) {
    if (!ctx.args.length) return usageError(ctx, 'realpath', 'missing operand');
    let status = 0;
    for (const n of ctx.args.filter(a => !a.startsWith('-'))) {
        const p = ctx.resolve(n);
        if (!(await statOrNull(ctx.pfs, dirname(p)))) { ctx.errln(`realpath: ${n}: No such file or directory`); status = 1; continue; }
        ctx.outln(p);
    }
    return status;
}

async function fileCmd(ctx) {
    if (!ctx.args.length) { ctx.errln('Usage: file [-bcEhikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding] [--mime-type] file...'); return 1; }
    for (const n of ctx.args) {
        const path = ctx.resolve(n);
        const st = await lstatOrNull(ctx.pfs, path);
        if (!st) { ctx.outln(`${n}: cannot open \`${n}' (No such file or directory)`); continue; }
        if (st.isDirectory()) { ctx.outln(`${n}: directory`); continue; }
        if (st.isSymbolicLink && st.isSymbolicLink()) { ctx.outln(`${n}: symbolic link to ${await ctx.pfs.readlink(path)}`); continue; }
        const data = await ctx.pfs.readFile(path);
        if (!data.length) { ctx.outln(`${n}: empty`); continue; }
        const text = new TextDecoder().decode(data.slice(0, 4096));
        let kind = /[^\x00-\x7f]/.test(text) ? 'Unicode text, UTF-8 text' : 'ASCII text';
        if (data.includes(0)) kind = 'data';
        else if (/^<!DOCTYPE html|<html/i.test(text)) kind = 'HTML document, ' + kind;
        else if (/^#!.*\b(ba)?sh\b/.test(text)) kind = 'Bourne-Again shell script, ' + kind + ' executable';
        else if (/^#!.*python/.test(text)) kind = 'Python script, ' + kind + ' executable';
        ctx.outln(`${n}: ${kind}`);
    }
    return 0;
}

async function chmod(ctx) {
    const { rest } = getopt(ctx.args, { bool: ['R', 'v', 'c', 'f'] });
    if (rest.length < 2) return usageError(ctx, 'chmod', rest.length ? `missing operand after '${rest[0]}'` : 'missing operand');
    const [mode, ...names] = rest;
    let status = 0;
    for (const n of names) {
        const path = ctx.resolve(n);
        const st = await statOrNull(ctx.pfs, path);
        if (!st) { ctx.errln(`chmod: cannot access '${n}': No such file or directory`); status = 1; continue; }
        if (denied(ctx, path)) { ctx.errln(`chmod: changing permissions of '${n}': Operation not permitted`); status = 1; continue; }
        if (st.isDirectory()) continue;
        let exec = isExecutable(st);
        if (/^[0-7]{3,4}$/.test(mode)) exec = (parseInt(mode, 8) & 0o100) !== 0;
        else if (/[+]x/.test(mode)) exec = true;
        else if (/-x/.test(mode)) exec = false;
        else if (!/^[ugoa]*[+-=][rwxX]*$/.test(mode)) { ctx.errln(`chmod: invalid mode: '${mode}'`); return 1; }
        await ctx.pfs.writeFile(path, await ctx.pfs.readFile(path), { mode: exec ? 0o755 : 0o644 });
    }
    return status;
}

async function du(ctx) {
    const { opts, rest } = getopt(ctx.args, { bool: ['s', 'h', 'a', 'c'] });
    const targets = rest.length ? rest : ['.'];
    for (const t of targets) {
        const root = ctx.resolve(t);
        let total = 0;
        const sizes = [];
        const visit = async (full, shown) => {
            const st = await lstatOrNull(ctx.pfs, full);
            if (!st) return 0;
            if (!st.isDirectory()) return Math.max(4, Math.ceil((st.size || 0) / 4096) * 4);
            let sum = 4;
            for (const n of await readdirSorted(ctx.pfs, full)) sum += await visit(joinPath(full, n), `${shown}/${n}`);
            if (!opts.s) sizes.push([sum, shown]);
            return sum;
        };
        if (!(await statOrNull(ctx.pfs, root))) { ctx.errln(`du: cannot access '${t}': No such file or directory`); continue; }
        total = await visit(root, t);
        if (opts.s) sizes.push([total, t]);
        for (const [size, shown] of sizes) ctx.outln(`${opts.h ? humanSize(size * 1024) : size}\t${shown}`);
    }
    return 0;
}

export function registerFileCommands(reg) {
    const D = (de, en) => ({ de, en });
    reg.register({
        name: 'ls', category: 'files', operands: 'path', run: ls,
        usage: 'ls [-alhR1] [path…]',
        summary: D('Listet Dateien und Ordner auf.', 'Lists files and directories.'),
        options: [
            { flags: ['-a', '--all'], desc: D('auch versteckte Einträge (beginnen mit .)', 'include hidden entries (starting with .)') },
            { flags: ['-l'], desc: D('ausführliche Liste: Rechte, Größe, Datum', 'long listing: permissions, size, date') },
            { flags: ['-h'], desc: D('Größen lesbar (K, M) – mit -l', 'human-readable sizes (K, M) – with -l') },
            { flags: ['-R'], desc: D('Unterordner rekursiv auflisten', 'list subdirectories recursively') },
            { flags: ['-1'], desc: D('ein Eintrag pro Zeile', 'one entry per line') },
            { flags: ['-t'], desc: D('nach Änderungszeit sortieren', 'sort by modification time') },
        ],
    });
    reg.register({
        name: 'cd', category: 'files', operands: 'dir', run: cd, builtin: true,
        usage: 'cd [ordner]',
        summary: D('Wechselt das aktuelle Verzeichnis.', 'Changes the current directory.'),
        options: [
            { flags: ['..'], desc: D('eine Ebene nach oben', 'one level up') },
            { flags: ['~'], desc: D('ins Home-Verzeichnis', 'to your home directory') },
            { flags: ['-'], desc: D('zurück ins vorherige Verzeichnis', 'back to the previous directory') },
        ],
    });
    reg.register({ name: 'pwd', category: 'files', run: pwd, builtin: true, usage: 'pwd', summary: D('Zeigt den Pfad des aktuellen Verzeichnisses.', 'Prints the path of the current directory.') });
    reg.register({
        name: 'mkdir', category: 'files', operands: 'path', run: mkdir, usage: 'mkdir [-p] ordner…',
        summary: D('Legt neue Ordner an.', 'Creates new directories.'),
        options: [{ flags: ['-p', '--parents'], desc: D('fehlende Elternordner mit anlegen, kein Fehler wenn vorhanden', 'create missing parents, no error if it exists') }],
    });
    reg.register({ name: 'rmdir', category: 'files', operands: 'dir', run: rmdir, usage: 'rmdir ordner…', summary: D('Löscht leere Ordner.', 'Removes empty directories.') });
    reg.register({ name: 'touch', category: 'files', operands: 'path', run: touch, usage: 'touch datei…', summary: D('Legt leere Dateien an (oder aktualisiert ihren Zeitstempel).', 'Creates empty files (or updates their timestamp).') });
    reg.register({
        name: 'rm', category: 'files', operands: 'path', run: rm, usage: 'rm [-rf] datei…',
        summary: D('Löscht Dateien – endgültig, ohne Papierkorb.', 'Deletes files – permanently, there is no trash bin.'),
        options: [
            { flags: ['-r', '-R'], desc: D('Ordner samt Inhalt löschen', 'delete directories and their contents') },
            { flags: ['-f'], desc: D('keine Fehler bei fehlenden Dateien, keine Rückfragen', 'ignore missing files, never prompt') },
            { flags: ['-v'], desc: D('jede gelöschte Datei anzeigen', 'show each removed file') },
        ],
        danger: true,
    });
    reg.register({
        name: 'cp', category: 'files', operands: 'path', run: cp, usage: 'cp [-r] quelle… ziel',
        summary: D('Kopiert Dateien oder Ordner.', 'Copies files or directories.'),
        options: [{ flags: ['-r', '-R'], desc: D('Ordner rekursiv kopieren', 'copy directories recursively') }, { flags: ['-v'], desc: D('jede Kopie anzeigen', 'show each copy') }],
    });
    reg.register({ name: 'mv', category: 'files', operands: 'path', run: mv, usage: 'mv quelle… ziel', summary: D('Verschiebt oder benennt Dateien/Ordner um.', 'Moves or renames files and directories.'), options: [{ flags: ['-n'], desc: D('nichts überschreiben', 'do not overwrite') }, { flags: ['-v'], desc: D('jede Aktion anzeigen', 'show each action') }] });
    reg.register({ name: 'ln', category: 'files', operands: 'path', run: ln, usage: 'ln -s ziel linkname', summary: D('Legt einen Link auf eine Datei an.', 'Creates a link to a file.'), options: [{ flags: ['-s'], desc: D('symbolischer Link (Verknüpfung)', 'symbolic link') }] });
    reg.register({ name: 'stat', category: 'files', operands: 'path', run: stat, usage: 'stat datei…', summary: D('Zeigt Details zu einer Datei (Größe, Rechte, Zeit).', 'Shows file details (size, permissions, time).') });
    reg.register({ name: 'tree', category: 'files', operands: 'dir', run: tree, usage: 'tree [-a] [-L tiefe] [ordner]', summary: D('Zeigt Ordner als Baum.', 'Shows directories as a tree.'), options: [{ flags: ['-a'], desc: D('auch versteckte Einträge', 'include hidden entries') }, { flags: ['-L'], arg: 'N', desc: D('nur bis Tiefe N', 'limit depth to N') }, { flags: ['-d'], desc: D('nur Ordner', 'directories only') }] });
    reg.register({ name: 'find', category: 'files', operands: 'dir', run: find, usage: "find [pfad] -name 'muster'", summary: D('Sucht Dateien nach Name, Typ …', 'Searches files by name, type …'), options: [{ flags: ['-name'], arg: 'MUSTER', desc: D('Name passt auf Muster, z. B. "*.html"', 'name matches a pattern like "*.html"') }, { flags: ['-type'], arg: 'f|d', desc: D('nur Dateien (f) oder Ordner (d)', 'files (f) or directories (d) only') }, { flags: ['-maxdepth'], arg: 'N', desc: D('höchstens N Ebenen tief', 'at most N levels deep') }] });
    reg.register({ name: 'basename', category: 'files', run: basenameCmd, usage: 'basename pfad [endung]', summary: D('Gibt den letzten Teil eines Pfades aus.', 'Prints the last part of a path.') });
    reg.register({ name: 'dirname', category: 'files', run: dirnameCmd, usage: 'dirname pfad', summary: D('Gibt den Ordner-Teil eines Pfades aus.', 'Prints the directory part of a path.') });
    reg.register({ name: 'realpath', category: 'files', operands: 'path', run: realpath, usage: 'realpath pfad', summary: D('Gibt den vollständigen (absoluten) Pfad aus.', 'Prints the absolute path.') });
    reg.register({ name: 'file', category: 'files', operands: 'path', run: fileCmd, usage: 'file datei…', summary: D('Rät, welche Art Datei es ist.', 'Guesses what kind of file it is.') });
    reg.register({ name: 'chmod', category: 'files', operands: 'path', run: chmod, usage: 'chmod +x datei', summary: D('Ändert Dateirechte (z. B. ausführbar machen).', 'Changes file permissions (e.g. make executable).') });
    reg.register({ name: 'du', category: 'files', operands: 'path', run: du, usage: 'du [-sh] [pfad]', summary: D('Zeigt, wie viel Platz Dateien belegen.', 'Shows disk usage.') });
}
