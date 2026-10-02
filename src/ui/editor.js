// The editor pane (CodeMirror 6, loaded on first use). Used for files, commit
// messages, merge messages and rebase todo lists. Conflict blocks get buttons.

import { h, icon, clear, md } from './dom.js';
import { L } from '../core/i18n.js';

let cmPromise = null;
function loadCM() {
    if (!cmPromise) cmPromise = import('../../vendor/codemirror-6.bundle.mjs');
    return cmPromise;
}

const KIND_INFO = {
    commit: {
        title: { de: 'Commit-Nachricht schreiben', en: 'Write the commit message' },
        help: { de: 'Erste Zeile: kurze Zusammenfassung (max. ~50 Zeichen), z. B. „Navigation verbessert“. Optional nach einer Leerzeile: Details. Zeilen mit `#` werden ignoriert. **Speichern** erstellt den Commit, **Abbrechen** bricht ab.', en: 'First line: a short summary (≈50 characters max.), e.g. "Improve navigation". Optionally, after a blank line: details. Lines starting with `#` are ignored. **Save** creates the commit, **Cancel** aborts.' },
        save: { de: 'Commit erstellen', en: 'Create commit' },
    },
    merge: {
        title: { de: 'Nachricht für den Merge-Commit', en: 'Message for the merge commit' },
        help: { de: 'Git hat eine Nachricht vorgeschlagen. Meist kannst du sie einfach übernehmen.', en: 'Git suggested a message. Usually you can just accept it.' },
        save: { de: 'Übernehmen', en: 'Accept' },
    },
    revert: { title: { de: 'Nachricht für den Revert-Commit', en: 'Message for the revert commit' }, help: { de: 'Git hat eine Nachricht vorgeschlagen. Übernehmen oder ergänzen, warum der Commit zurückgenommen wird.', en: 'Git suggested a message. Accept it or add why the commit is being reverted.' }, save: { de: 'Übernehmen', en: 'Accept' } },
    squash: { title: { de: 'Nachricht für den zusammengefassten Commit', en: 'Message for the combined commit' }, help: { de: 'Beide Nachrichten stehen hier. Formuliere eine gemeinsame.', en: 'Both messages are here. Write a combined one.' }, save: { de: 'Übernehmen', en: 'Accept' } },
    reword: { title: { de: 'Commit-Nachricht ändern', en: 'Change the commit message' }, help: { de: 'Ändere die Nachricht und speichere.', en: 'Edit the message and save.' }, save: { de: 'Übernehmen', en: 'Accept' } },
    tag: { title: { de: 'Nachricht für den Tag', en: 'Message for the tag' }, help: { de: 'Beschreibe die Version, z. B. „Erste Version der Website“.', en: 'Describe the version, e.g. "First version of the website".' }, save: { de: 'Tag erstellen', en: 'Create tag' } },
    'rebase-todo': {
        title: { de: 'Rebase-Plan bearbeiten', en: 'Edit the rebase plan' },
        help: { de: 'Jede Zeile ist ein Commit, von oben nach unten. Ändere das erste Wort: `pick` behalten, `reword` Nachricht ändern, `squash`/`fixup` mit dem vorherigen zusammenfassen, `drop` weglassen. Zeilen umsortieren ändert die Reihenfolge.', en: 'Each line is a commit, top to bottom. Change the first word: `pick` keep, `reword` change the message, `squash`/`fixup` combine with the previous one, `drop` leave it out. Reorder lines to change the order.' },
        save: { de: 'Rebase starten', en: 'Start rebase' },
    },
};

function languageFor(cm, path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    const name = path.split('/').pop().toLowerCase();
    if (['html', 'htm', 'xml', 'svg'].includes(ext)) return cm.html();
    if (['css', 'scss'].includes(ext)) return cm.css();
    if (['js', 'mjs', 'cjs', 'json'].includes(ext)) return cm.javascript();
    if (['ts', 'tsx', 'jsx'].includes(ext)) return cm.javascript({ typescript: ext.startsWith('ts'), jsx: ext.endsWith('x') });
    if (['md', 'markdown'].includes(ext)) return cm.markdown();
    if (ext === 'py') return cm.python();
    if (ext === 'java') return cm.java();
    if (ext === 'sql') return cm.sql();
    if (['yml', 'yaml'].includes(ext)) return cm.yaml();
    if (['sh', 'bash'].includes(ext) || name === '.bashrc') return cm.StreamLanguage.define(cm.shell);
    if (['properties', 'ini', 'cfg'].includes(ext) || name === '.gitconfig' || name === 'config') return cm.StreamLanguage.define(cm.properties);
    if (['diff', 'patch'].includes(ext)) return cm.StreamLanguage.define(cm.diff);
    return [];
}

function highlightStyle(cm) {
    const t = cm.tags;
    return cm.HighlightStyle.define([
        { tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: 'var(--cm-keyword)' },
        { tag: [t.string, t.special(t.string), t.attributeValue], color: 'var(--cm-string)' },
        { tag: [t.number, t.bool, t.atom], color: 'var(--cm-number)' },
        { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
        { tag: [t.tagName, t.typeName, t.className], color: 'var(--cm-tag)' },
        { tag: [t.attributeName, t.propertyName], color: 'var(--cm-attr)' },
        { tag: [t.heading], color: 'var(--cm-tag)', fontWeight: '700' },
        { tag: [t.function(t.variableName), t.definition(t.variableName)], color: 'var(--cm-fn)' },
        { tag: [t.link, t.url], color: 'var(--repo)', textDecoration: 'underline' },
        { tag: [t.inserted], color: 'var(--staged)' },
        { tag: [t.deleted], color: 'var(--danger)' },
    ]);
}

// ---- conflict blocks -------------------------------------------------------------------------

function findConflicts(text) {
    const blocks = [];
    const lines = text.split('\n');
    let pos = 0;
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const start = pos;
        pos += line.length + 1;
        if (/^<{7}( |$)/.test(line)) cur = { start, oursStart: pos, ours: [], theirs: [], labelOurs: line.slice(8), phase: 'ours' };
        else if (cur && /^={7}$/.test(line)) { cur.sep = start; cur.phase = 'theirs'; cur.theirsStart = pos; }
        else if (cur && /^>{7}( |$)/.test(line)) {
            cur.end = Math.min(pos, text.length);
            cur.labelTheirs = line.slice(8);
            blocks.push(cur);
            cur = null;
        } else if (cur) cur[cur.phase].push(line);
    }
    return blocks;
}

export class EditorPane {
    constructor(root, { read, write, onSaved, onClose, onStateChange }) {
        this.root = root;
        this.read = read;
        this.write = write;
        this.onSaved = onSaved;
        this.onClose = onClose;
        this.onStateChange = onStateChange || (() => {});
        this.view = null;
        this.session = null;
    }

    get isOpen() {
        return Boolean(this.session);
    }

    get dirty() {
        return Boolean(this.session && this.view && this.view.state.doc.toString() !== this.session.saved);
    }

    async open(path, { kind = 'file', blocking = false, display = null } = {}) {
        if (this.session) {
            if (this.session.path === path) return this.session.promise;
            if (this.session.blocking) {
                // git is waiting for this editor (commit message …): keep it in front
                this.showBar(L({ de: 'Git wartet noch auf diese Nachricht. Speichere oder brich erst hier ab.', en: 'Git is still waiting for this message. Save or cancel here first.' }), []);
                this.view?.focus();
                return { saved: false };
            }
            // a different file: close the current one first (keeping unsaved text is not possible)
            if (this.dirty && !(await this.confirmDiscard())) return { saved: false };
            this.finish(false, { replacing: true });
        }
        const cm = await loadCM();
        let text = '';
        try { text = await this.read(path); } catch { text = ''; }
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        this.session = { path, kind, blocking, saved: text, resolve, promise, display: display || path };
        this.build(cm, text);
        this.onStateChange();
        setTimeout(() => this.view?.focus(), 30);
        return promise;
    }

    build(cm, text) {
        const root = clear(this.root);
        const info = KIND_INFO[this.session.kind];
        this.saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => this.save(true) }, icon('save'), h('span', {}, L(info?.save || { de: 'Speichern', en: 'Save' })), h('kbd', {}, 'Ctrl S'));
        const closeBtn = h('button', { class: 'btn quiet', type: 'button', onclick: () => this.close() }, L(info ? { de: 'Abbrechen', en: 'Cancel' } : { de: 'Schließen', en: 'Close' }), h('kbd', {}, 'Esc'));
        this.dirtyMark = h('span', { class: 'dirty-mark', title: L({ de: 'Nicht gespeichert', en: 'Not saved' }) });
        this.bar = h('div', { class: 'editor-confirm', hidden: true });
        const header = h('div', { class: 'editor-head' },
            h('div', { class: 'editor-title' },
                icon('file'),
                h('span', { class: 'mono' }, info ? L(info.title) : this.session.display),
                this.dirtyMark),
            h('div', { class: 'editor-actions' }, closeBtn, this.saveBtn));
        const help = info ? h('div', { class: 'editor-help' }, md(L(info.help))) : null;
        this.conflictBar = h('div', { class: 'conflict-bar', hidden: true });
        const host = h('div', { class: 'editor-host' });
        root.append(...[header, help, this.conflictBar, host, this.bar].filter(Boolean));
        // Esc also works while the focus is on the editor's own buttons
        root.onkeydown = ev => { if (ev.key === 'Escape' && !ev.defaultPrevented && this.session) { ev.preventDefault(); this.close(); } };

        const self = this;
        const conflictField = cm.StateField.define({
            create: st => self.decorations(cm, st.doc.toString()),
            update: (deco, tr) => (tr.docChanged ? self.decorations(cm, tr.state.doc.toString()) : deco),
            provide: f => cm.EditorView.decorations.from(f),
        });
        const theme = cm.EditorView.theme({
            '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--sheet)', color: 'var(--ink)' },
            '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
            '.cm-gutters': { backgroundColor: 'var(--panel)', color: 'var(--ink-3)', border: 'none', borderRight: '1px solid var(--rule)' },
            '.cm-activeLine': { backgroundColor: 'var(--shade)' },
            '.cm-activeLineGutter': { backgroundColor: 'var(--shade)', color: 'var(--ink)' },
            '&.cm-focused': { outline: 'none' },
            '.cm-cursor': { borderLeftColor: 'var(--ink)', borderLeftWidth: '2px' },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--repo-soft) !important' },
            '.cm-line': { padding: '0 10px' },
        });
        const keymap = cm.keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { self.save(self.session?.kind !== 'file'); return true; } },
            { key: 'Escape', run: () => { self.close(); return true; } },
            cm.indentWithTab,
            ...cm.defaultKeymap, ...cm.historyKeymap, ...cm.searchKeymap,
        ]);
        this.view = new cm.EditorView({
            parent: host,
            state: cm.EditorState.create({
                doc: text,
                extensions: [
                    cm.lineNumbers(), cm.highlightActiveLine(), cm.highlightActiveLineGutter(), cm.drawSelection(),
                    cm.history(), cm.bracketMatching(), cm.indentOnInput(), cm.highlightSpecialChars(),
                    cm.syntaxHighlighting(highlightStyle(cm)), cm.search({ top: true }),
                    keymap, theme, conflictField, cm.EditorView.lineWrapping,
                    languageFor(cm, this.session.path),
                    cm.EditorView.updateListener.of(u => { if (u.docChanged) self.refreshDirty(); }),
                    cm.EditorView.contentAttributes.of({ 'aria-label': L({ de: 'Datei-Editor', en: 'File editor' }) }),
                ],
            }),
        });
        this.refreshDirty();
        // a file with conflicts opens at the first conflict, not at line 1
        const first = findConflicts(text)[0];
        if (first) this.view.dispatch({ selection: { anchor: first.start }, effects: cm.EditorView.scrollIntoView(first.start, { y: 'start', yMargin: 40 }) });
    }

    decorations(cm, text) {
        const blocks = findConflicts(text);
        this.renderConflictBar(blocks);
        if (!blocks.length) return cm.Decoration.none;
        const ranges = [];
        const line = cls => cm.Decoration.line({ class: cls });
        const doc = text;
        const lineStarts = [0];
        for (let i = 0; i < doc.length; i++) if (doc[i] === '\n') lineStarts.push(i + 1);
        const self = this;
        class ConflictWidget extends cm.WidgetType {
            constructor(idx) { super(); this.idx = idx; }
            eq(o) { return o.idx === this.idx; }
            toDOM() {
                return h('div', { class: 'conflict-actions' },
                    h('span', { class: 'conflict-label' }, L({ de: 'Konflikt:', en: 'Conflict:' })),
                    h('button', { type: 'button', class: 'cbtn ours', onclick: () => self.resolve(this.idx, 'ours') }, L({ de: 'Meine Fassung behalten', en: 'Keep mine' })),
                    h('button', { type: 'button', class: 'cbtn theirs', onclick: () => self.resolve(this.idx, 'theirs') }, L({ de: 'Andere übernehmen', en: 'Take theirs' })),
                    h('button', { type: 'button', class: 'cbtn both', onclick: () => self.resolve(this.idx, 'both') }, L({ de: 'Beide behalten', en: 'Keep both' })));
            }
            ignoreEvent() { return true; }
        }
        blocks.forEach((blk, idx) => {
            const startLine = lineStarts.findIndex(p => p === blk.start);
            const sepLine = lineStarts.findIndex(p => p === blk.sep);
            const endLine = lineStarts.findIndex(p => p >= blk.end) === -1 ? lineStarts.length : lineStarts.findIndex(p => p >= blk.end);
            for (let l = startLine; l < endLine; l++) {
                const pos = lineStarts[l];
                let cls = 'cm-conflict-ours';
                if (l === startLine || l === sepLine || l === endLine - 1) cls = 'cm-conflict-marker';
                else if (l > sepLine) cls = 'cm-conflict-theirs';
                if (l === startLine) ranges.push(cm.Decoration.widget({ widget: new ConflictWidget(idx), side: -1, block: true }).range(pos));
                ranges.push(line(cls).range(pos));
            }
        });
        return cm.Decoration.set(ranges, true);
    }

    renderConflictBar(blocks) {
        if (!this.conflictBar) return;
        if (!blocks.length) {
            this.conflictBar.hidden = true;
            return;
        }
        this.conflictBar.hidden = false;
        clear(this.conflictBar).append(
            h('strong', {}, L({ de: `${blocks.length} Konflikt${blocks.length === 1 ? '' : 'e'} in dieser Datei.`, en: `${blocks.length} conflict${blocks.length === 1 ? '' : 's'} in this file.` })),
            ' ',
            md(L({ de: '**Oben** (blau) steht deine Fassung, **unten** (orange) die andere. Entscheide pro Block, speichere – und melde es danach mit `git add` als gelöst.', en: '**Top** (blue) is your version, **bottom** (orange) the other one. Decide for each block, save – then mark it resolved with `git add`.' })));
    }

    resolve(idx, choice) {
        const text = this.view.state.doc.toString();
        const blk = findConflicts(text)[idx];
        if (!blk) return;
        const keep = choice === 'ours' ? blk.ours : choice === 'theirs' ? blk.theirs : [...blk.ours, ...blk.theirs];
        const insert = keep.length ? keep.join('\n') + '\n' : '';
        this.view.dispatch({ changes: { from: blk.start, to: blk.end, insert } });
        this.view.focus();
    }

    refreshDirty() {
        const dirty = this.dirty;
        // "saved" only after a save – a file that was just opened is merely unchanged
        const clean = this.session?.wasSaved ? L({ de: 'gespeichert', en: 'saved' }) : L({ de: 'unverändert', en: 'unchanged' });
        this.dirtyMark.textContent = dirty ? L({ de: '● nicht gespeichert', en: '● unsaved' }) : clean;
        this.dirtyMark.classList.toggle('is-dirty', dirty);
        this.onStateChange();
    }

    async save(andClose = false) {
        if (!this.session) return;
        const text = this.view.state.doc.toString();
        try {
            await this.write(this.session.path, text);
        } catch (e) {
            this.showBar(L({ de: `Speichern fehlgeschlagen: ${e.message}`, en: `Saving failed: ${e.message}` }), []);
            return;
        }
        this.session.saved = text;
        this.session.wasSaved = true;
        this.refreshDirty();
        if (this.session.kind === 'file') this.onSaved?.(this.session.path);
        if (andClose || this.session.kind !== 'file') this.finish(true);
    }

    showBar(message, actions) {
        clear(this.bar).append(h('span', {}, message), ...actions);
        this.bar.hidden = false;
    }

    confirmDiscard() {
        return new Promise(resolve => {
            const done = v => { this.bar.hidden = true; resolve(v); };
            this.showBar(L({ de: 'Nicht gespeicherte Änderungen.', en: 'Unsaved changes.' }), [
                h('button', { class: 'btn primary', type: 'button', onclick: async () => { await this.save(false); done(true); } }, L({ de: 'Speichern', en: 'Save' })),
                h('button', { class: 'btn danger', type: 'button', onclick: () => done(true) }, L({ de: 'Verwerfen', en: 'Discard' })),
                h('button', { class: 'btn quiet', type: 'button', onclick: () => { done(false); this.view.focus(); } }, L({ de: 'Weiter bearbeiten', en: 'Keep editing' })),
            ]);
        });
    }

    async close() {
        if (!this.session) return;
        if (this.session.kind === 'file' && this.dirty && !(await this.confirmDiscard())) return;
        this.finish(Boolean(this.session.wasSaved));
    }

    finish(saved, { replacing = false } = {}) {
        const sess = this.session;
        if (!sess) return;
        const content = this.view ? this.view.state.doc.toString() : sess.saved;
        this.session = null;
        this.view?.destroy();
        this.view = null;
        clear(this.root);
        sess.resolve({ saved, content: saved ? content : undefined });
        if (!replacing) {
            this.onClose?.(sess);
            this.onStateChange();
        }
    }

    focus() {
        this.view?.focus();
    }
}
