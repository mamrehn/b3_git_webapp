// Small, dependency-free helpers shared by the shell, the git engine and the UI.

export const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(text) {
    return String(text).replace(ANSI_RE, '');
}

export function visibleLength(text) {
    return [...stripAnsi(text)].length;
}

export function padEndVisible(text, width) {
    const missing = width - visibleLength(text);
    return missing > 0 ? text + ' '.repeat(missing) : text;
}

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[b.length];
}

// Closest candidates, the way git and bash suggest "did you mean …".
export function closest(word, candidates, maxDistance = 2) {
    return candidates
        .map(c => ({ c, d: levenshtein(word, c) }))
        .filter(x => x.d <= maxDistance || (word.length >= 3 && x.c.startsWith(word)))
        .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
        .map(x => x.c);
}

export function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}

// ---- paths ----------------------------------------------------------------

export function normalizePath(path) {
    const absolute = path.startsWith('/');
    const out = [];
    for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (out.length) out.pop();
            continue;
        }
        out.push(part);
    }
    return (absolute ? '/' : '') + out.join('/') || (absolute ? '/' : '.');
}

export function joinPath(...parts) {
    return normalizePath(parts.filter(Boolean).join('/'));
}

export function dirname(path) {
    const p = normalizePath(path);
    if (p === '/') return '/';
    const i = p.lastIndexOf('/');
    if (i === -1) return '.';
    return i === 0 ? '/' : p.slice(0, i);
}

export function basename(path) {
    const p = normalizePath(path);
    if (p === '/') return '/';
    return p.slice(p.lastIndexOf('/') + 1);
}

export function relativePath(from, to) {
    const a = normalizePath(from).split('/').filter(Boolean);
    const b = normalizePath(to).split('/').filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const up = a.slice(i).map(() => '..');
    return [...up, ...b.slice(i)].join('/') || '.';
}

// A repository path (relative to the repository root) as seen from a subfolder `prefix`
// of the repository: what you type there, and what `git status` shows.
export function fromPrefix(prefix, repoPath) {
    if (!prefix) return repoPath;
    const from = prefix.split('/').filter(Boolean);
    const to = repoPath.split('/');
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    // "css/" seen from inside css is the folder itself
    return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/') || '.';
}

export function isInside(path, dir) {
    const p = normalizePath(path);
    const d = normalizePath(dir);
    return p === d || p.startsWith(d === '/' ? '/' : d + '/');
}

// ---- dates (git formats) ------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function tzString(offsetMinutes) {
    // git stores timezoneOffset as minutes *behind* UTC (like Date#getTimezoneOffset)
    const east = -offsetMinutes;
    const sign = east >= 0 ? '+' : '-';
    const abs = Math.abs(east);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

function shifted(timestamp, offsetMinutes) {
    // A Date whose UTC fields show the wall-clock time in the given zone.
    return new Date((timestamp - offsetMinutes * 60) * 1000);
}

// "Mon Sep 29 10:00:00 2026 +0200"
export function formatGitDate(timestamp, offsetMinutes = new Date(timestamp * 1000).getTimezoneOffset()) {
    const d = shifted(timestamp, offsetMinutes);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${hh}:${mm}:${ss} ${d.getUTCFullYear()} ${tzString(offsetMinutes)}`;
}

// "2026-09-29 10:00:00 +0200" (git blame / --date=iso)
export function formatIsoDate(timestamp, offsetMinutes = new Date(timestamp * 1000).getTimezoneOffset()) {
    const d = shifted(timestamp, offsetMinutes);
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${tzString(offsetMinutes)}`;
}

// "3 minutes ago" — same thresholds as git's show_date_relative()
export function relativeDate(timestamp, now = Date.now() / 1000) {
    const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    let diff = Math.max(0, Math.round(now - timestamp));
    if (diff < 90) return `${unit(diff, 'second')} ago`;
    diff = Math.round(diff / 60);
    if (diff < 90) return `${unit(diff, 'minute')} ago`;
    diff = Math.round(diff / 60);
    if (diff < 36) return `${unit(diff, 'hour')} ago`;
    diff = Math.round(diff / 24);
    if (diff < 14) return `${unit(diff, 'day')} ago`;
    if (diff < 70) return `${unit(Math.round(diff / 7), 'week')} ago`;
    if (diff < 365) return `${unit(Math.round(diff / 30), 'month')} ago`;
    if (diff < 1825) {
        const totalMonths = Math.round((diff * 12 * 2 + 365) / (365 * 2));
        const years = Math.floor(totalMonths / 12);
        const months = totalMonths % 12;
        return months ? `${unit(years, 'year')}, ${unit(months, 'month')} ago` : `${unit(years, 'year')} ago`;
    }
    return `${unit(Math.round((diff + 183) / 365), 'year')} ago`;
}

export function shortOid(oid, n = 7) {
    return oid ? oid.slice(0, n) : '0000000';
}

export function firstLine(text) {
    return String(text || '').split('\n')[0];
}

export function isBinary(bytes) {
    const n = Math.min(bytes.length, 8000);
    for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
    return false;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function toText(bytes) {
    if (typeof bytes === 'string') return bytes;
    return decoder.decode(bytes);
}

export function toBytes(text) {
    if (text instanceof Uint8Array) return text;
    return encoder.encode(text);
}

export function splitLines(text) {
    // Lines without their terminators; a trailing newline does not add an empty line.
    if (text === '') return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

export function uniq(list) {
    return [...new Set(list)];
}

export function globToRegExp(glob, { dotAll = false } = {}) {
    let re = '^';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') { re += '.*'; i++; } else re += dotAll ? '.*' : '[^/]*';
        } else if (c === '?') re += dotAll ? '.' : '[^/]';
        else if (c === '[') {
            const end = glob.indexOf(']', i + 1);
            if (end === -1) { re += '\\['; continue; }
            let cls = glob.slice(i + 1, end);
            if (cls.startsWith('!')) cls = '^' + cls.slice(1);
            re += `[${cls.replace(/\\/g, '\\\\')}]`;
            i = end;
        } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&');
    }
    return new RegExp(re + '$');
}

export function hasGlobChars(word) {
    return /[*?[]/.test(word);
}
