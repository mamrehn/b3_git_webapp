// git pathspecs: "file", "dir/", ".", "*.txt" (git globs also match across "/").

import { GitError } from '../errors.js';
import { hasGlobChars } from '../../core/util.js';

function globToRe(glob) {
    let re = '^';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') re += '.*';
        else if (c === '?') re += '.';
        else if (c === '[') {
            const end = glob.indexOf(']', i + 1);
            if (end === -1) { re += '\\['; continue; }
            re += '[' + glob.slice(i + 1, end).replace(/^!/, '^') + ']';
            i = end;
        } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&');
    }
    return new RegExp(re + '$');
}

// Turn user pathspecs into matchers on repo-relative paths.
export function compilePathspecs(repo, specs) {
    return specs.map(spec => {
        const isGlob = hasGlobChars(spec);
        const rel = repo.toRepoPath(spec.replace(/\/+$/, '') || '.');
        if (rel === null) {
            throw new GitError(`fatal: ${spec}: '${spec}' is outside repository at '${repo.dir}'`, { status: 128, kind: 'outside-repo' });
        }
        if (isGlob) {
            const re = globToRe(rel);
            return { spec, rel, test: p => re.test(p) };
        }
        if (rel === '') return { spec, rel, all: true, test: () => true };
        return { spec, rel, test: p => p === rel || p.startsWith(rel + '/') };
    });
}

// Returns { matched: Set, unmatched: [spec] }
export function matchPathspecs(compiled, candidates) {
    const matched = new Set();
    const hits = new Map(compiled.map(c => [c, false]));
    for (const p of candidates) {
        for (const c of compiled) {
            if (c.test(p)) {
                matched.add(p);
                hits.set(c, true);
            }
        }
    }
    const unmatched = compiled.filter(c => !hits.get(c)).map(c => c.spec);
    return { matched, unmatched };
}
