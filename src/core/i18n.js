// Bilingual text support. German is the default; English is a toggle.
//
// Two ways to write translatable text:
//   t('key', {param})       – UI strings collected in strings.js
//   L({ de: '…', en: '…' })  – content written inline (coach, missions, glossary)

import { STRINGS } from './strings.js';

export const LANGS = ['de', 'en'];
const STORAGE_KEY = 'gw.lang';
const listeners = new Set();

let current = readStoredLang();

function readStoredLang() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (LANGS.includes(stored)) return stored;
    } catch { /* storage unavailable (private mode, tests) */ }
    return 'de';
}

export function lang() {
    return current;
}

export function setLang(next) {
    if (!LANGS.includes(next) || next === current) return;
    current = next;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    if (typeof document !== 'undefined') document.documentElement.lang = next;
    for (const fn of listeners) fn(next);
}

export function onLangChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function interpolate(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

export function L(entry, params) {
    if (entry == null) return '';
    if (typeof entry === 'string') return interpolate(entry, params);
    if (typeof entry === 'function') return entry(current, params);
    const text = entry[current] ?? entry.de ?? entry.en ?? '';
    return typeof text === 'function' ? text(params) : interpolate(text, params);
}

export function t(key, params) {
    const entry = STRINGS[key];
    if (!entry) {
        if (typeof console !== 'undefined') console.warn(`[i18n] missing key: ${key}`);
        return key;
    }
    return L(entry, params);
}

// Command templates like `git add <datei>` or `git commit -m "…"` (cheat sheet, mission
// toolbox): placeholders in the reader's language …
export function localizeTemplate(cmd) {
    return current === 'de' ? cmd : cmd.replace(/<datei>/g, '<file>').replace(/<ordner>/g, '<folder>').replace(/<adresse>/g, '<address>').replace(/<quelle>/g, '<source>').replace(/<ziel>/g, '<target>');
}

// … and what goes into the prompt when one is clicked: placeholders are left out (the
// student types their own), "…" becomes "" with the cursor between the quotes.
export function templateToInput(cmd) {
    const text = cmd.replace(/<[^>]+>/g, '').replace(/"…"/g, '""').replace(/…/g, '').replace(/ {2,}/g, ' ').trimStart();
    return { text, cursorBack: /""\s*$/.test(text) ? 1 + (text.length - text.trimEnd().length) : 0 };
}

// Count-aware helper: n({ de: ['1 Datei', '{n} Dateien'], en: [...] }, n)
export function N(entry, n, params = {}) {
    const forms = entry[current] ?? entry.de;
    return interpolate(n === 1 ? forms[0] : forms[1], { n, ...params });
}
