// Live explanation of the line being typed – and concrete warnings before
// commands that destroy work (rm, reset --hard, restore, clean -f, push --force …).

import { looseWords, checkComplete } from '../shell/parse.js';
import { gitSpec } from '../git/gitcmd.js';
import { L } from '../core/i18n.js';

const t = (de, en) => ({ de, en });

function optionDesc(spec, flag) {
    for (const o of spec?.options || []) if (o.flags.includes(flag)) return o.desc;
    return null;
}

function listFiles(files, lang) {
    const shown = files.slice(0, 3).map(f => `\`${f}\``).join(', ');
    return files.length > 3 ? `${shown} ${lang === 'de' ? 'und' : 'and'} ${files.length - 3} ${lang === 'de' ? 'weitere' : 'more'}` : shown;
}

export function explainInput(line, registry, state) {
    const result = { parts: [], warning: null, pending: null };
    if (!line.trim()) return result;
    const complete = checkComplete(line);
    if (!complete.complete) {
        result.pending = /quote|matching/i.test(complete.reason)
            ? t('Ein Anführungszeichen ist noch offen. Schließe es – oder Enter macht in einer neuen Zeile weiter (`>`), Strg+C bricht ab.', 'A quote is still open. Close it – or Enter continues on a new line (`>`), Ctrl+C cancels.')
            : t('Die Zeile ist noch nicht fertig (z. B. nach `|` oder `&&` fehlt ein Befehl).', 'The line is not finished (e.g. a command is missing after `|` or `&&`).');
    }
    const words = looseWords(line);
    // explain the last simple command being typed
    const segStart = words.map(w => Boolean(w.op)).lastIndexOf(true) + 1;
    const seg = words.slice(segStart).filter(w => !w.op);
    if (!seg.length) return result;
    const name = seg[0].text;
    const spec = registry.get(name);
    const repo = state?.repo;
    if (!spec) {
        result.parts.push({ text: name, desc: t('unbekannter Befehl', 'unknown command'), unknown: true });
        return result;
    }
    if (name === 'git') {
        const sub = seg[1]?.text;
        const gspec = sub ? gitSpec(sub) : null;
        result.parts.push({ text: 'git', desc: t('Versionsverwaltung', 'version control') });
        if (sub) {
            if (gspec) result.parts.push({ text: sub, desc: gspec.summary });
            else result.parts.push({ text: sub, desc: t('kein git-Befehl', 'not a git command'), unknown: true });
        }
        for (const w of seg.slice(2)) {
            if (!w.text.startsWith('-')) continue;
            const flags = w.text.startsWith('--') ? [w.text.split('=')[0]] : (w.text.length > 2 && /^-[a-zA-Z]+$/.test(w.text) && !optionDesc(gspec, w.text) ? [...w.text.slice(1)].map(c => '-' + c) : [w.text]);
            for (const f of flags) {
                const d = optionDesc(gspec, f);
                if (d) result.parts.push({ text: f, desc: d, option: true });
            }
        }
        result.warning = gitWarning(sub, seg.slice(2).map(w => w.text), repo);
    } else {
        result.parts.push({ text: name, desc: spec.summary });
        for (const w of seg.slice(1)) {
            if (!w.text.startsWith('-')) continue;
            const flags = w.text.startsWith('--') ? [w.text] : [...w.text.slice(1)].map(c => '-' + c);
            for (const f of flags) {
                const d = optionDesc(spec, f);
                if (d) result.parts.push({ text: f, desc: d, option: true });
            }
        }
        result.warning = shellWarning(name, seg.slice(1).map(w => w.text));
    }
    return result;
}

function changedFiles(repo) {
    if (!repo) return [];
    const st = repo.status;
    return [...new Set([...st.staged.map(s => s.path), ...st.unstaged.map(s => s.path)])];
}

function gitWarning(sub, args, repo) {
    if (!repo) return null;
    const changed = changedFiles(repo);
    const has = f => args.includes(f);
    if (sub === 'reset' && has('--hard')) {
        return changed.length
            ? { level: 'danger', text: { de: `Verwirft endgültig deine nicht committeten Änderungen in ${listFiles(changed, 'de')}.`, en: `Permanently discards your uncommitted changes in ${listFiles(changed, 'en')}.` } }
            : { level: 'warn', text: t('Setzt Branch und Dateien zurück. Commits danach findest du nur noch über `git reflog`.', 'Resets branch and files. Commits after that point can only be found via `git reflog`.') };
    }
    if ((sub === 'restore' && !has('--staged') && !has('-S')) || (sub === 'checkout' && (has('--') || args.some(a => repo.status.unstaged.some(u => u.path === a))))) {
        const targets = args.filter(a => !a.startsWith('-') && repo.status.unstaged.some(u => u.path === a || a === '.' || u.path.startsWith(a + '/')));
        const files = targets.includes('.') ? repo.status.unstaged.map(u => u.path) : repo.status.unstaged.map(u => u.path).filter(p => targets.some(tg => p === tg || p.startsWith(tg + '/')));
        if (files.length) return { level: 'danger', text: { de: `Verwirft die Änderungen an ${listFiles(files, 'de')} endgültig – Git hatte sie nie gespeichert.`, en: `Permanently discards the changes to ${listFiles(files, 'en')} – git never stored them.` } };
    }
    if (sub === 'clean' && args.some(a => /^-[a-zA-Z]*f/.test(a)) && !args.some(a => /^-[a-zA-Z]*n/.test(a))) {
        const files = repo.status.untracked;
        if (files.length) return { level: 'danger', text: { de: `Löscht endgültig: ${listFiles(files, 'de')} (unversioniert, ohne Kopie).`, en: `Permanently deletes: ${listFiles(files, 'en')} (untracked, no copy).` } };
    }
    if (sub === 'push' && args.some(a => a === '-f' || a === '--force' || a.startsWith('+'))) {
        return { level: 'danger', text: t('Überschreibt den Branch auf dem Server – Commits anderer können verloren gehen. Im Team fast nie richtig.', 'Overwrites the branch on the server – other people\'s commits can be lost. In a team this is almost never right.') };
    }
    if (sub === 'branch' && has('-D')) {
        return { level: 'warn', text: t('Löscht den Branch auch dann, wenn seine Commits nirgendwo sonst sind.', 'Deletes the branch even if its commits exist nowhere else.') };
    }
    if (sub === 'stash' && (args[0] === 'drop' || args[0] === 'clear')) {
        return { level: 'warn', text: t('Löscht beiseitegelegte Änderungen.', 'Deletes shelved changes.') };
    }
    if ((sub === 'commit' && has('--amend')) || sub === 'rebase') {
        const b = repo.head.branch;
        const up = b ? repo.upstreams[b] : null;
        if (up && !up.gone && up.ahead === 0 && !repo.head.unborn) {
            return { level: 'warn', text: t('Dieser Commit ist schon auf dem Server. Umschreiben führt zu Konflikten mit allen, die ihn haben.', 'This commit is already on the server. Rewriting it causes trouble for everyone who has it.') };
        }
    }
    return null;
}

function shellWarning(name, args) {
    if (name === 'rm') {
        const recursive = args.some(a => /^-[a-zA-Z]*[rR]/.test(a));
        const targets = args.filter(a => !a.startsWith('-'));
        if (!targets.length) return null;
        return { level: recursive ? 'danger' : 'warn', text: recursive
            ? t('Löscht Ordner samt Inhalt endgültig – es gibt keinen Papierkorb.', 'Deletes folders and everything inside for good – there is no trash bin.')
            : t('`rm` löscht endgültig – es gibt keinen Papierkorb.', '`rm` deletes for good – there is no trash bin.') };
    }
    return null;
}

export function describeWarning(w) {
    return w ? L(w.text) : '';
}
