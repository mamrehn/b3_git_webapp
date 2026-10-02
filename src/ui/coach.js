// The coach: what just happened, where you are, what you can do now.

import { h, icon, clear, md } from './dom.js';
import { L, lang } from '../core/i18n.js';
import { GLOSSARY } from '../learn/glossary.js';

const SEEN_KEY = 'gw.coach.seen';
const LEVEL_KEY = 'gw.coach.level';
const FADE_AFTER = 4;

function loadSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}

const KIND_GLYPH = {
    look: 'help', stage: 'arrowRight', save: 'commit', sync: 'globe', undo: 'undo', fix: 'warn',
    nav: 'folder', branch: 'branch', merge: 'branch', setup: 'check', act: 'play',
};

export class Coach {
    constructor(root, { onCommand, slot }) {
        this.root = root;
        this.onCommand = onCommand;
        this.slot = slot;
        this.entries = [];
        this.state = { situation: [], suggestions: [] };
        this.seen = loadSeen();
        this.level = (() => { try { return localStorage.getItem(LEVEL_KEY) || 'auto'; } catch { return 'auto'; } })();
        this.build();
    }

    build() {
        this.levelBtn = h('button', { class: 'btn quiet', type: 'button', onclick: () => this.cycleLevel() });
        this.head = h('div', { class: 'pane-head' },
            h('h2', { class: 'label' }, h('span', { class: 'num' }, '04'), h('span', { class: 'lbl-coach' })),
            this.levelBtn);
        this.missionSlot = h('div', { class: 'mission-slot' });
        this.now = h('section', { class: 'coach-now', 'aria-live': 'polite' });
        this.where = h('section', { class: 'coach-where' });
        this.next = h('section', { class: 'coach-next' });
        this.journal = h('section', { class: 'coach-journal' });
        this.body = h('div', { class: 'pane-body coach-body' }, this.missionSlot, this.now, this.next, this.where, this.journal);
        this.root.append(this.head, this.body);
        this.relabel();
    }

    relabel() {
        this.head.querySelector('.lbl-coach').textContent = L({ de: 'Coach', en: 'Coach' });
        const names = { auto: { de: 'Erklärungen: automatisch', en: 'Explanations: auto' }, full: { de: 'Erklärungen: immer', en: 'Explanations: always' }, short: { de: 'Erklärungen: kurz', en: 'Explanations: short' } };
        this.levelBtn.textContent = L(names[this.level] || names.auto);
        this.levelBtn.title = L({ de: 'Wie ausführlich der Coach erklärt (klicken zum Wechseln)', en: 'How detailed the coach explains (click to change)' });
    }

    cycleLevel(to) {
        const order = ['auto', 'full', 'short'];
        this.level = to && order.includes(to) ? to : order[(order.indexOf(this.level) + 1) % order.length];
        try { localStorage.setItem(LEVEL_KEY, this.level); } catch { /* ignore */ }
        this.relabel();
        this.render();
    }

    markdown(text) {
        return md(text, {
            onCode: code => this.onCommand(code),
            onTerm: (key, label) => this.termButton(key, label),
        });
    }

    termButton(key, label) {
        const entry = GLOSSARY[key];
        if (!entry) return h('span', {}, label);
        const [word] = entry[lang()] || entry.de;
        return h('button', { type: 'button', class: 'term', onclick: ev => this.showTerm(key, ev.currentTarget) }, label === key ? word : label);
    }

    showTerm(key, anchor) {
        document.querySelector('.term-pop')?.remove();
        const [word, text] = GLOSSARY[key][lang()] || GLOSSARY[key].de;
        const pop = h('div', { class: 'term-pop', role: 'dialog' },
            h('strong', {}, word),
            h('div', {}, md(text, { onCode: c => this.onCommand(c) })),
            h('button', { type: 'button', class: 'pop-close', 'aria-label': 'close', onclick: () => pop.remove() }, '×'));
        document.body.appendChild(pop);
        const r = anchor.getBoundingClientRect();
        pop.style.left = `${Math.max(12, Math.min(window.innerWidth - 332, r.left - 20))}px`;
        pop.style.top = `${r.bottom + 8}px`;
        setTimeout(() => {
            const off = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', off); } };
            document.addEventListener('pointerdown', off);
        });
    }

    push(entry, { situation, suggestions }) {
        if (entry) {
            const count = (this.seen[entry.key] || 0) + 1;
            this.seen[entry.key] = count;
            try { localStorage.setItem(SEEN_KEY, JSON.stringify(this.seen)); } catch { /* ignore */ }
            entry.seenCount = count;
            this.entries.unshift(entry);
            if (this.entries.length > 40) this.entries.pop();
        }
        this.state = { situation, suggestions };
        this.render();
    }

    setState({ situation, suggestions }) {
        this.state = { situation, suggestions };
        this.render();
    }

    renderEntry(entry, { latest }) {
        const collapsed = this.level === 'short' || (this.level === 'auto' && entry.seenCount > FADE_AFTER && !['danger', 'error', 'warn'].includes(entry.tone));
        const body = h('div', { class: 'entry-body' }, this.markdown(L(entry.body)));
        const notes = (entry.notes || []).map(n => h('div', { class: `entry-note tone-${n.tone}` }, this.markdown(L(n.text))));
        const more = entry.more && L(entry.more) ? h('details', { class: 'entry-more' }, h('summary', {}, L({ de: 'Mehr dazu', en: 'More about this' })), this.markdown(L(entry.more))) : null;
        const wrap = h('article', { class: `entry tone-${entry.tone || 'info'}${latest ? ' latest' : ''}${collapsed ? ' collapsed' : ''}` },
            entry.line ? h('div', { class: 'entry-cmd mono' }, h('span', { class: 'prompt-sign' }, '$'), ' ', entry.line) : null,
            h('h3', { class: 'entry-title' }, ...this.inline(L(entry.title))),
            collapsed ? h('button', { type: 'button', class: 'entry-expand', onclick: () => { wrap.classList.remove('collapsed'); } }, L({ de: 'Erklärung zeigen', en: 'Show explanation' })) : null,
            body, ...notes, more);
        return wrap;
    }

    render() {
        // what just happened
        clear(this.now);
        const latest = this.entries[0];
        this.now.appendChild(h('h2', { class: 'label' }, L({ de: 'Was gerade passiert ist', en: 'What just happened' })));
        if (latest) this.now.appendChild(this.renderEntry(latest, { latest: true }));
        else this.now.appendChild(h('p', { class: 'coach-idle' }, this.markdown(L({ de: 'Tippe unten im Terminal einen Befehl und drücke Enter. Hier erfährst du dann, was er bewirkt hat. Probier zum Beispiel `ls` oder `git status`.', en: 'Type a command in the terminal below and press Enter. Here you will learn what it did. Try `ls` or `git status`, for example.' }))));

        // what you can do now
        clear(this.next);
        this.next.appendChild(h('h2', { class: 'label' }, L({ de: 'Was du jetzt tun kannst', en: 'What you can do now' })));
        const sugg = this.state.suggestions || [];
        const list = h('ul', { class: 'suggestions' });
        sugg.slice(0, 6).forEach((s, i) => {
            list.appendChild(h('li', {},
                h('button', {
                    type: 'button', class: `suggestion${s.danger ? ' danger' : ''}`,
                    onclick: () => this.onCommand(s.cmd, { cursorBack: s.cursorBack || 0 }),
                    title: L({ de: 'In die Eingabe übernehmen – dann Enter drücken', en: 'Put it into the prompt – then press Enter' }),
                },
                h('span', { class: 'sug-key', 'aria-hidden': 'true' }, String(i + 1)),
                h('span', { class: 'sug-main' },
                    // break only between words, never inside an option like --all
                    h('code', { class: 'sug-cmd' }, ...(s.cmd.trim() || s.cmd).split(' ').flatMap((word, i) => [i ? ' ' : null, h('span', { class: 'nowrap' }, word)])),
                    h('span', { class: 'sug-why' }, ...this.inline(L(s.why)))),
                s.danger ? h('span', { class: 'sug-danger', title: L({ de: 'Verwirft Arbeit', en: 'Discards work' }) }, icon('warn')) : icon(KIND_GLYPH[s.kind] || 'arrowRight'))));
        });
        this.next.appendChild(list);
        if (sugg.length) this.next.appendChild(h('p', { class: 'coach-tip' }, L({ de: 'Klick übernimmt den Befehl in die Eingabe – ausgeführt wird erst mit Enter.', en: 'A click puts the command into the prompt – it only runs when you press Enter.' })));

        // where you are
        clear(this.where);
        this.where.appendChild(h('h2', { class: 'label' }, L({ de: 'Wo du stehst', en: 'Where you are' })));
        const dl = h('dl', { class: 'facts' });
        for (const f of this.state.situation || []) {
            const value = h('dd', { class: `tone-${f.tone || 'plain'}` }, ...this.inline(L(f.value)));
            if (f.remote) {
                value.appendChild(h('span', { class: `net ${f.remote.kind === 'simulated' ? 'sim' : 'real'}`, title: f.remote.url },
                    f.remote.kind === 'simulated' ? L({ de: 'simuliert', en: 'simulated' }) : L({ de: 'echtes Netz', en: 'real network' })));
            }
            if (f.note) value.appendChild(h('span', { class: 'fact-note' }, ...this.inline(L(f.note))));
            dl.append(h('dt', {}, L(f.label)), value);
        }
        this.where.appendChild(dl);

        // journal
        clear(this.journal);
        const older = this.entries.slice(1);
        if (older.length) {
            const det = h('details', { class: 'journal' }, h('summary', {}, L({ de: `Verlauf (${older.length})`, en: `Journal (${older.length})` })));
            for (const e of older) {
                const item = h('details', { class: `journal-item tone-${e.tone}` },
                    h('summary', {}, h('code', {}, e.line || ''), h('span', {}, ' — '), ...this.inline(L(e.title))));
                item.appendChild(this.renderEntry(e, { latest: false }));
                det.appendChild(item);
            }
            this.journal.appendChild(det);
        }
    }

    inline(text) {
        const frag = this.markdown(text);
        const p = frag.firstChild;
        return p && p.childNodes ? [...p.childNodes] : [text];
    }

    focusSuggestion(n) {
        const btn = this.next.querySelectorAll('.suggestion')[n - 1];
        btn?.click();
    }
}
