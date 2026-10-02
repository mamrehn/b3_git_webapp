// git-formatted diffs and diffstats (checked against real git output).

import { Diff, git } from '../lib.js';
import { isBinary, toText, shortOid } from '../core/util.js';

export const COLOR = {
    meta: '\x1b[1m',
    frag: '\x1b[36m',
    old: '\x1b[31m',
    new: '\x1b[32m',
    reset: '\x1b[m',
};

export async function hashBlob(bytes) {
    const { oid } = await git.hashBlob({ object: bytes });
    return oid;
}

// git's default "function context" for hunk headers: the closest line before the
// hunk that starts with a letter, '_' or '$' (xdiff's def_ff), cut to 80 bytes.
function funcname(lines, beforeIndex) {
    for (let i = beforeIndex - 1; i >= 0; i--) {
        const l = lines[i];
        if (l && /^[A-Za-z_$]/.test(l)) return l.replace(/\s+$/, '').slice(0, 80);
    }
    return '';
}

function range(start, count) {
    if (count === 0) return `${start - 1},0`;
    return count === 1 ? String(start) : `${start},${count}`;
}

// a/b: { oid, mode, bytes } | null (null = file absent on that side)
export function formatFileDiff(path, a, b, { color = false, context = 3, nameOnly = false } = {}) {
    const c = color ? COLOR : { meta: '', frag: '', old: '', new: '', reset: '' };
    const R = color ? c.reset : '';
    const out = [];
    const meta = s => out.push(`${c.meta}${s}${R}`);
    meta(`diff --git a/${path} b/${path}`);
    if (!a) meta(`new file mode ${b.mode || '100644'}`);
    else if (!b) meta(`deleted file mode ${a.mode || '100644'}`);
    else if (a.mode !== b.mode) {
        meta(`old mode ${a.mode}`);
        meta(`new mode ${b.mode}`);
    }
    const ao = a ? shortOid(a.oid) : '0000000';
    const bo = b ? shortOid(b.oid) : '0000000';
    if (!a || !b || a.oid !== b.oid) meta(`index ${ao}..${bo}${a && b && a.mode === b.mode ? ' ' + a.mode : ''}`);
    if (nameOnly) return out.join('\n') + '\n';
    const aBytes = a ? a.bytes : new Uint8Array();
    const bBytes = b ? b.bytes : new Uint8Array();
    if ((a && isBinary(aBytes)) || (b && isBinary(bBytes))) {
        out.push(`Binary files ${a ? 'a/' + path : '/dev/null'} and ${b ? 'b/' + path : '/dev/null'} differ`);
        return out.join('\n') + '\n';
    }
    const aText = toText(aBytes);
    const bText = toText(bBytes);
    if (aText === bText) return out.join('\n') + '\n';
    meta(`--- ${a ? 'a/' + path : '/dev/null'}`);
    meta(`+++ ${b ? 'b/' + path : '/dev/null'}`);
    const patch = Diff.structuredPatch(path, path, aText, bText, '', '', { context });
    const oldLines = aText.split('\n');
    for (const h of patch.hunks) {
        const fn = funcname(oldLines, h.oldLines === 0 ? h.oldStart : h.oldStart - 1);
        out.push(`${c.frag}@@ -${range(h.oldStart, h.oldLines)} +${range(h.newStart, h.newLines)} @@${R}${fn ? ' ' + fn : ''}`);
        for (const line of h.lines) {
            if (line.startsWith('+')) out.push(`${c.new}${line}${R}`);
            else if (line.startsWith('-')) out.push(`${c.old}${line}${R}`);
            else out.push(line);
        }
    }
    return out.join('\n') + '\n';
}

export function countChanges(aBytes, bBytes) {
    if ((aBytes && isBinary(aBytes)) || (bBytes && isBinary(bBytes))) {
        return { binary: true, insertions: 0, deletions: 0, oldSize: aBytes ? aBytes.length : 0, newSize: bBytes ? bBytes.length : 0 };
    }
    const aText = aBytes ? toText(aBytes) : '';
    const bText = bBytes ? toText(bBytes) : '';
    let insertions = 0;
    let deletions = 0;
    if (aText !== bText) {
        for (const part of Diff.diffLines(aText, bText)) {
            if (part.added) insertions += part.count;
            else if (part.removed) deletions += part.count;
        }
    }
    return { binary: false, insertions, deletions };
}

export function summaryLine(files, insertions, deletions) {
    let s = ` ${files} file${files === 1 ? '' : 's'} changed`;
    if (insertions || !deletions) s += `, ${insertions} insertion${insertions === 1 ? '' : 's'}(+)`;
    if (deletions || !insertions) s += `, ${deletions} deletion${deletions === 1 ? '' : 's'}(-)`;
    return s;
}

// stats: [{ path, insertions, deletions, binary, oldSize, newSize }]
export function formatStat(stats, { color = false, width = 80 } = {}) {
    if (!stats.length) return '';
    const plus = color ? `${COLOR.new}` : '';
    const minus = color ? `${COLOR.old}` : '';
    const R = color ? COLOR.reset : '';
    const nameWidth = Math.max(...stats.map(s => s.path.length));
    const maxChange = Math.max(...stats.map(s => s.insertions + s.deletions), 0);
    const numWidth = Math.max(String(maxChange).length, stats.some(s => s.binary) ? 3 : 1);
    const graphMax = Math.max(10, width - nameWidth - numWidth - 6);
    const scale = maxChange > graphMax ? graphMax / maxChange : 1;
    const out = [];
    let ins = 0;
    let del = 0;
    for (const s of stats) {
        ins += s.insertions;
        del += s.deletions;
        const name = s.path.padEnd(nameWidth);
        if (s.binary) {
            out.push(` ${name} | ${'Bin'.padStart(numWidth)} ${s.oldSize} -> ${s.newSize} bytes`);
            continue;
        }
        const total = s.insertions + s.deletions;
        let p = Math.round(s.insertions * scale);
        let m = Math.round(s.deletions * scale);
        if (s.insertions && !p) p = 1;
        if (s.deletions && !m) m = 1;
        const bar = (p ? `${plus}${'+'.repeat(p)}${R}` : '') + (m ? `${minus}${'-'.repeat(m)}${R}` : '');
        out.push(` ${name} | ${String(total).padStart(numWidth)}${bar ? ' ' + bar : ''}`);
    }
    out.push(summaryLine(stats.length, ins, del));
    return out.join('\n') + '\n';
}
