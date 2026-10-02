// Mission UI: the card above the coach, the metro map of all missions,
// the welcome screen and the breadcrumb in the top bar.

import { h, icon, clear } from '../ui/dom.js';
import { modal } from '../ui/modal.js';
import { L, lang, setLang, localizeTemplate, templateToInput } from '../core/i18n.js';
import { val } from './content/common.js';

const WELCOME_KEY = 'gw.welcomed';

export class MissionView {
    constructor(missions) {
        this.missions = missions;
        this.storyOpen = true;
    }

    get app() {
        return this.missions.app;
    }

    md(text) {
        return this.app.coach.markdown(text);
    }

    inline(text) {
        return this.app.coach.inline(text);
    }

    // ---- the card --------------------------------------------------------------------------------

    render({ justCompleted = false } = {}) {
        const slot = this.app.coach?.missionSlot;
        if (!slot) return;
        clear(slot);
        if (this.app.world?.id !== 'mission') {
            slot.hidden = true;
            return;
        }
        slot.hidden = false;
        const ms = this.missions;
        const m = ms.current;
        if (ms.preparing) {
            slot.appendChild(h('div', { class: 'mcard preparing' }, h('div', { class: 'mcard-kicker' }, L({ de: 'Mission wird vorbereitet …', en: 'Preparing the mission …' }))));
            return;
        }
        if (!m) {
            slot.appendChild(h('div', { class: 'mcard empty' },
                h('div', { class: 'mcard-kicker' }, L({ de: 'Keine Mission aktiv', en: 'No mission active' })),
                h('p', {}, L({ de: 'Wähle auf der Karte eine Mission. Hier kannst du so lange frei ausprobieren – der Server wäre simuliert.', en: 'Pick a mission on the map. Until then you can experiment freely here – the server would be simulated.' })),
                h('button', { class: 'btn primary', type: 'button', onclick: () => this.showMap() }, icon('map'), L({ de: 'Missionskarte', en: 'Mission map' }))));
            return;
        }
        const run = ms.run;
        const line = ms.lines().find(l => l.id === m.line);
        const card = h('section', { class: `mcard${run.finished ? ' finished' : ''}`, style: `--line:${line?.color || 'var(--repo)'}` });
        card.appendChild(h('div', { class: 'mcard-head' },
            h('span', { class: 'mcard-code' }, m.code),
            h('span', { class: 'mcard-kicker' }, L(line?.name || { de: 'Mission', en: 'Mission' })),
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn quiet icon-btn', type: 'button', title: L({ de: 'Missionskarte', en: 'Mission map' }), onclick: () => this.showMap() }, icon('map')),
            h('button', { class: 'btn quiet icon-btn', type: 'button', title: L({ de: 'Mission neu starten', en: 'Restart mission' }), onclick: () => this.app.confirmReset() }, icon('reset'))));
        card.appendChild(h('h2', { class: 'mcard-title' }, L(m.title)));

        if (run.finished) {
            card.appendChild(this.debrief(m));
            slot.appendChild(card);
            return;
        }

        const story = h('details', { class: 'mcard-story', open: this.storyOpen && run.index === 0 ? '' : null, ontoggle: ev => { this.storyOpen = ev.target.open; } },
            h('summary', {}, L({ de: 'Worum es geht', en: 'The situation' })),
            this.md(L(val(m.story, run.data))));
        card.appendChild(story);

        const list = h('ol', { class: 'objectives' });
        m.objectives.forEach((obj, i) => {
            const state = i < run.index ? 'done' : i === run.index ? 'current' : 'todo';
            const li = h('li', { class: `obj ${state}${justCompleted && i === run.index - 1 ? ' just-done' : ''}` },
                h('span', { class: 'obj-mark', 'aria-hidden': 'true' }, state === 'done' ? icon('check') : String(i + 1)),
                h('div', { class: 'obj-main' }, h('div', { class: 'obj-text' }, ...this.inline(L(val(obj.text, run.data))))));
            if (state === 'current') {
                const shown = ms.hintsShown(i);
                const hints = (obj.hints || []).slice(0, shown);
                const main = li.querySelector('.obj-main');
                for (const [k, hint] of hints.entries()) {
                    main.appendChild(h('div', { class: `obj-hint${k === (obj.hints.length - 1) ? ' final' : ''}` }, this.md(L(val(hint, run.data)))));
                }
                if (shown < (obj.hints || []).length) {
                    const label = shown === 0 ? L({ de: 'Tipp', en: 'Hint' }) : shown === obj.hints.length - 1 ? L({ de: 'Lösung zeigen', en: 'Show solution' }) : L({ de: 'Noch ein Tipp', en: 'Another hint' });
                    main.appendChild(h('button', { class: 'btn quiet hint-btn', type: 'button', onclick: () => ms.showHint(i) }, icon('lightbulb'), label));
                }
            }
            li.setAttribute('aria-current', state === 'current' ? 'step' : 'false');
            list.appendChild(li);
        });
        card.appendChild(list);
        slot.appendChild(card);
    }

    debrief(m) {
        const ms = this.missions;
        const next = ms.next();
        const wrap = h('div', { class: 'debrief' },
            h('div', { class: 'debrief-badge' }, icon('check'), L({ de: 'Geschafft', en: 'Complete' })),
            this.md(L(val(m.debrief, ms.run?.data))));
        if (m.learned?.length) {
            wrap.appendChild(h('div', { class: 'learned' },
                h('div', { class: 'label' }, L({ de: 'Neu in deinem Werkzeugkasten', en: 'New in your toolbox' })),
                h('div', { class: 'learned-cmds' }, ...m.learned.map(c => h('button', { class: 'chip mono', type: 'button', onclick: () => { const { text, cursorBack } = templateToInput(c); this.app.insert(text, { cursorBack }); } }, localizeTemplate(c))))));
        }
        const actions = h('div', { class: 'debrief-actions' });
        if (next) {
            actions.appendChild(h('button', { class: 'btn primary', type: 'button', onclick: () => ms.start(next.id) },
                L({ de: `Weiter: ${next.code} ${L(next.title)}`, en: `Next: ${next.code} ${L(next.title)}` }), icon('arrowRight')));
        }
        actions.appendChild(h('button', { class: 'btn quiet', type: 'button', onclick: () => this.showMap() }, icon('map'), L({ de: 'Karte', en: 'Map' })));
        wrap.appendChild(actions);
        wrap.appendChild(h('p', { class: 'debrief-free' }, L({ de: 'Du kannst hier auch einfach weiter ausprobieren.', en: 'You can also keep experimenting here.' })));
        return wrap;
    }

    // ---- breadcrumb ----------------------------------------------------------------------------------

    renderCrumb() {
        const el = this.app.crumb;
        if (!el) return;
        clear(el);
        const m = this.missions.current;
        if (this.app.world?.id !== 'mission' || !m) {
            el.hidden = true;
            return;
        }
        el.hidden = false;
        const run = this.missions.run;
        const dots = h('span', { class: 'progress-dots', 'aria-hidden': 'true' },
            ...m.objectives.map((o, i) => h('span', { class: `pdot${i < run.index ? ' done' : i === run.index ? ' current' : ''}` })));
        el.append(h('button', { type: 'button', class: 'crumb-btn', onclick: () => this.showMap(), title: L({ de: 'Missionskarte öffnen', en: 'Open the mission map' }) },
            h('span', { class: 'crumb-code' }, m.code),
            h('span', { class: 'crumb-title' }, L(m.title)),
            dots,
            h('span', { class: 'sr-only' }, L({ de: `${run.index} von ${m.objectives.length} Zielen erreicht`, en: `${run.index} of ${m.objectives.length} goals reached` }))));
    }

    // ---- overlays ----------------------------------------------------------------------------------

    closeOverlays() {
        document.querySelectorAll('.overlay.mission-overlay').forEach(o => o.remove());
    }

    overlay(cls, content, { onClose } = {}) {
        this.closeOverlays();
        const panel = h('div', { class: `sheet ${cls}`, role: 'dialog', 'aria-modal': 'true' },
            h('button', { class: 'btn quiet icon-btn sheet-close', type: 'button', 'aria-label': L({ de: 'Schließen', en: 'Close' }), onclick: () => handle.close() }, icon('close')),
            content);
        const handle = modal(panel, {
            cls: 'mission-overlay',
            onClose,
            restoreFocus: () => this.app.terminal?.focus(),
            // querySelector with a list returns the first match in document order, so ask in turn
            focus: () => panel.querySelector('.sheet-focus') || panel.querySelector('.btn.primary'),
        });
        return handle;
    }

    showMap() {
        const ms = this.missions;
        const current = ms.current;
        let selected = current || ms.next() || ms.missions()[0];
        const detail = h('div', { class: 'map-detail' });
        const lines = h('div', { class: 'metro-map' });

        const renderDetail = () => {
            const m = selected;
            const done = ms.isDone(m.id);
            const isCurrent = current && current.id === m.id;
            const line = ms.lines().find(l => l.id === m.line);
            clear(detail).append(
                h('div', { class: 'md-kicker', style: `--line:${line.color}` }, h('span', { class: 'mcard-code' }, m.code), L(line.name)),
                h('h3', {}, L(m.title)),
                this.md(L(m.summary || m.story)),
                m.learned?.length ? h('div', { class: 'md-learn' }, h('span', { class: 'label' }, L({ de: 'Du lernst', en: 'You learn' })), h('div', { class: 'learned-cmds' }, ...m.learned.map(c => h('code', { class: 'chip mono' }, localizeTemplate(c))))) : null,
                h('div', { class: 'md-actions' },
                    isCurrent && !ms.run?.finished
                        ? h('button', { class: 'btn primary', type: 'button', onclick: () => this.closeAndGo() }, L({ de: 'Weitermachen', en: 'Continue' }), icon('arrowRight'))
                        : h('button', { class: 'btn primary', type: 'button', onclick: () => ms.start(m.id) }, done ? L({ de: 'Nochmal spielen', en: 'Play again' }) : L({ de: 'Mission starten', en: 'Start mission' }), icon('arrowRight')),
                    isCurrent && !ms.run?.finished ? h('button', { class: 'btn quiet', type: 'button', onclick: () => ms.start(m.id) }, icon('reset'), L({ de: 'Von vorn', en: 'From the start' })) : null,
                    done ? h('span', { class: 'md-done' }, icon('check'), L({ de: 'erledigt', en: 'done' })) : null));
        };

        const renderLines = () => {
            clear(lines);
            for (const line of ms.lines()) {
                const missions = ms.missions().filter(m => m.line === line.id);
                const row = h('section', { class: 'mline', style: `--line:${line.color}` },
                    h('header', { class: 'mline-head' },
                        h('span', { class: 'mline-badge' }, line.letter),
                        h('div', {}, h('div', { class: 'mline-name' }, L(line.name)), h('div', { class: 'mline-sub' }, L(line.sub)))),
                    h('ol', { class: 'mstations' }, ...missions.map(m => {
                        const done = ms.isDone(m.id);
                        const isCurrent = current && current.id === m.id;
                        const btn = h('button', {
                            type: 'button',
                            class: `mstation${done ? ' done' : ''}${isCurrent ? ' current' : ''}${selected.id === m.id ? ' selected' : ''}`,
                            'aria-pressed': String(selected.id === m.id),
                            onclick: () => { selected = m; renderLines(); renderDetail(); },
                        },
                        h('span', { class: 'st-dot', 'aria-hidden': 'true' }, done ? icon('check') : ''),
                        h('span', { class: 'st-code' }, m.code),
                        h('span', { class: 'st-title' }, L(m.title)));
                        return h('li', {}, btn);
                    })));
                lines.appendChild(row);
            }
        };
        renderLines();
        renderDetail();
        const doneCount = ms.missions().filter(m => ms.isDone(m.id)).length;
        const content = h('div', { class: 'map' },
            h('header', { class: 'sheet-head' },
                h('div', { class: 'label' }, h('span', { class: 'net sim' }, L({ de: 'simuliert', en: 'simulated' })), L({ de: 'Missionen', en: 'Missions' })),
                h('h2', {}, L({ de: 'Wohin soll es gehen?', en: 'Where to?' })),
                h('p', { class: 'sheet-lead' }, L({ de: `Die Linien sind eine Empfehlung – du kannst überall einsteigen. ${doneCount} von ${ms.missions().length} Missionen erledigt.`, en: `The lines are a suggestion – you can start anywhere. ${doneCount} of ${ms.missions().length} missions done.` }))),
            h('div', { class: 'map-body' }, lines, detail));
        this.mapHandle = this.overlay('sheet-map', content);
    }

    closeAndGo() {
        this.closeOverlays();
        this.app.terminal?.focus();
    }

    showWelcome() {
        const ms = this.missions;
        const first = ms.missions().find(m => m.line === 'git') || ms.missions()[0];
        const shellFirst = ms.missions().find(m => m.line === 'shell');
        const markSeen = () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ } };
        const langBtn = code => h('button', { type: 'button', 'aria-pressed': String(lang() === code), onclick: () => { setLang(code); this.showWelcome(); } }, code.toUpperCase());
        const content = h('div', { class: 'welcome' },
            h('div', { class: 'welcome-top' }, h('div', { class: 'lang-switch', role: 'group' }, langBtn('de'), langBtn('en'))),
            h('h2', {}, L({ de: 'Willkommen in der Git-Werkstatt', en: 'Welcome to the Git Workshop' })),
            h('p', { class: 'sheet-lead' }, L({ de: 'Hier lernst du Git und die Kommandozeile mit echten Befehlen – direkt im Browser. Nichts zu installieren, und alles bleibt auf deinem Gerät.', en: 'Learn git and the command line with real commands – right in your browser. Nothing to install, and everything stays on your device.' })),
            h('ol', { class: 'welcome-steps' },
                h('li', {}, h('span', { class: 'ws-num' }, '1'), h('div', {}, h('strong', {}, L({ de: 'Tippen', en: 'Type' })), h('p', {}, L({ de: 'Im Terminal gibst du Befehle ein – wie an einem echten Linux-Rechner.', en: 'In the terminal you type commands – like on a real Linux machine.' })))),
                h('li', {}, h('span', { class: 'ws-num' }, '2'), h('div', {}, h('strong', {}, L({ de: 'Sehen', en: 'See' })), h('p', {}, L({ de: 'Oben siehst du, wo deine Dateien stehen: Arbeitsverzeichnis, Staging-Area, Repository, Server.', en: 'Above it you see where your files are: working directory, staging area, repository, server.' })))),
                h('li', {}, h('span', { class: 'ws-num' }, '3'), h('div', {}, h('strong', {}, L({ de: 'Verstehen', en: 'Understand' })), h('p', {}, L({ de: 'Der Coach erklärt nach jedem Befehl, was passiert ist – und was du jetzt tun kannst.', en: 'After every command the coach explains what happened – and what you can do now.' }))))),
            h('div', { class: 'welcome-worlds' },
                h('div', { class: 'ww sim' },
                    h('div', { class: 'ww-head' }, icon('flag'), h('strong', {}, L({ de: 'Missionen', en: 'Missions' })), h('span', { class: 'net sim' }, L({ de: 'simuliert', en: 'simulated' }))),
                    h('p', {}, L({ de: 'Geführte Aufgaben mit Geschichte. Server und Team sind simuliert – nichts verlässt deinen Browser.', en: 'Guided tasks with a story. Server and team are simulated – nothing leaves your browser.' }))),
                h('div', { class: 'ww real' },
                    h('div', { class: 'ww-head' }, icon('flask'), h('strong', {}, 'Sandbox'), h('span', { class: 'net real' }, L({ de: 'echtes Netz', en: 'real network' }))),
                    h('p', {}, L({ de: 'Freies Ausprobieren. Hier sprichst du mit echten Servern wie GitHub.', en: 'Free play. Here you talk to real servers like GitHub.' })))),
            h('div', { class: 'welcome-actions' },
                h('button', { class: 'btn primary big sheet-focus', type: 'button', onclick: () => { markSeen(); ms.start(first.id); } }, L({ de: `Mit Mission ${first.code} starten`, en: `Start with mission ${first.code}` }), icon('arrowRight')),
                h('button', { class: 'btn quiet', type: 'button', onclick: () => { markSeen(); ms.goSandbox(); } }, L({ de: 'Gleich in die Sandbox', en: 'Go straight to the sandbox' }))),
            shellFirst ? h('p', { class: 'welcome-shell' },
                L({ de: 'Noch nie mit einer Kommandozeile gearbeitet? ', en: 'Never used a command line? ' }),
                h('button', { class: 'link', type: 'button', onclick: () => { markSeen(); ms.start(shellFirst.id); } }, L({ de: `Starte mit ${shellFirst.code} „${L(shellFirst.title)}“.`, en: `Start with ${shellFirst.code} "${L(shellFirst.title)}".` }))) : null);
        // closing the welcome without a choice means: look around in the sandbox
        this.overlay('sheet-welcome', content, { onClose: () => { markSeen(); if (this.app.world?.id === 'sandbox') ms.goSandbox(); } });
    }
}
