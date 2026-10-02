// Promise-based helpers on top of a LightningFS (or Node-compatible) `fs.promises`.

import { joinPath, dirname, basename } from '../core/util.js';

export async function statOrNull(pfs, path) {
    try {
        return await pfs.stat(path);
    } catch {
        return null;
    }
}

export async function lstatOrNull(pfs, path) {
    try {
        return await pfs.lstat(path);
    } catch {
        return null;
    }
}

export async function exists(pfs, path) {
    return (await lstatOrNull(pfs, path)) !== null;
}

export async function isDir(pfs, path) {
    const st = await statOrNull(pfs, path);
    return Boolean(st && st.isDirectory());
}

export async function isFile(pfs, path) {
    const st = await statOrNull(pfs, path);
    return Boolean(st && st.isFile());
}

export async function mkdirp(pfs, path) {
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts) {
        cur += '/' + part;
        const st = await statOrNull(pfs, cur);
        if (st) {
            if (!st.isDirectory()) {
                const err = new Error(`ENOTDIR: not a directory, mkdir '${cur}'`);
                err.code = 'ENOTDIR';
                throw err;
            }
            continue;
        }
        try {
            await pfs.mkdir(cur);
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
        }
    }
}

export async function rmrf(pfs, path) {
    const st = await lstatOrNull(pfs, path);
    if (!st) return;
    if (st.isDirectory()) {
        for (const name of await pfs.readdir(path)) {
            await rmrf(pfs, joinPath(path, name));
        }
        await pfs.rmdir(path);
    } else {
        await pfs.unlink(path);
    }
}

export async function readText(pfs, path) {
    return pfs.readFile(path, 'utf8');
}

export async function readTextOrNull(pfs, path) {
    try {
        return await pfs.readFile(path, 'utf8');
    } catch {
        return null;
    }
}

export async function writeText(pfs, path, text, { mkdirs = false } = {}) {
    if (mkdirs) await mkdirp(pfs, dirname(path));
    await pfs.writeFile(path, text, 'utf8');
}

export async function readdirSorted(pfs, path) {
    const names = await pfs.readdir(path);
    return names.sort((a, b) => a.localeCompare(b, 'en'));
}

// Depth-first listing. `skip(name, fullPath)` prunes directories/files.
export async function walk(pfs, root, { skip = () => false, includeDirs = false } = {}) {
    const out = [];
    async function visit(dir, rel) {
        let names;
        try {
            names = await readdirSorted(pfs, dir);
        } catch {
            return;
        }
        for (const name of names) {
            const full = joinPath(dir, name);
            const relPath = rel ? `${rel}/${name}` : name;
            if (skip(name, full, relPath)) continue;
            const st = await lstatOrNull(pfs, full);
            if (!st) continue;
            if (st.isDirectory()) {
                if (includeDirs) out.push({ path: full, rel: relPath, isDir: true, stat: st });
                await visit(full, relPath);
            } else {
                out.push({ path: full, rel: relPath, isDir: false, stat: st });
            }
        }
    }
    await visit(root, '');
    return out;
}

export async function copyRecursive(pfs, src, dest) {
    const st = await lstatOrNull(pfs, src);
    if (!st) throw Object.assign(new Error(`ENOENT: ${src}`), { code: 'ENOENT' });
    if (st.isDirectory()) {
        if (!(await isDir(pfs, dest))) await pfs.mkdir(dest);
        for (const name of await pfs.readdir(src)) {
            await copyRecursive(pfs, joinPath(src, name), joinPath(dest, name));
        }
    } else if (st.isSymbolicLink && st.isSymbolicLink()) {
        await pfs.symlink(await pfs.readlink(src), dest);
    } else {
        await pfs.writeFile(dest, await pfs.readFile(src));
    }
}

export async function move(pfs, src, dest) {
    try {
        await pfs.rename(src, dest);
    } catch (e) {
        if (e.code === 'ENOENT') throw e;
        await copyRecursive(pfs, src, dest);
        await rmrf(pfs, src);
    }
}

// Resolve the destination like `cp a dir/` and `mv a dir` do.
export async function intoDirIfDir(pfs, src, dest) {
    if (await isDir(pfs, dest)) return joinPath(dest, basename(src));
    return dest;
}
