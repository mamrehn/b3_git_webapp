// Help: how the Werkstatt works, keyboard, cheat sheet, glossary, network, about.

import { h, icon, clear, md } from './dom.js';
import { modal } from './modal.js';
import { screenReaderToggle } from './a11y.js';
import { L, lang, localizeTemplate, templateToInput } from '../core/i18n.js';
import { GLOSSARY } from '../learn/glossary.js';

const t = (de, en) => ({ de, en });

const CHEATS = [
    {
        title: t('Orientierung', 'Getting around'),
        items: [
            ['pwd', t('wo bin ich?', 'where am I?')],
            ['ls -la', t('was liegt hier (alles, mit Details)', 'what is here (everything, with details)')],
            ['cd <ordner>', t('in einen Ordner wechseln (`cd ..` hoch)', 'change folder (`cd ..` up)')],
            ['cat <datei>', t('Datei anzeigen', 'show a file')],
            ['nano <datei>', t('Datei im Editor öffnen', 'open a file in the editor')],
        ],
    },
    {
        title: t('Anfangen', 'Starting'),
        items: [
            ['git config --global user.name "Name"', t('sagen, wer du bist', 'tell git who you are')],
            ['git init', t('Ordner zum Repository machen', 'turn a folder into a repository')],
            ['git clone <url>', t('Repository herunterladen', 'download a repository')],
        ],
    },
    {
        title: t('Alltag', 'Every day'),
        items: [
            ['git status', t('Was ist los? (immer zuerst)', 'what is going on? (always first)')],
            ['git add <datei>', t('für den Commit vormerken', 'stage for the commit')],
            ['git commit -m "…"', t('Vorgemerktes speichern', 'save what is staged')],
            ['git diff', t('Änderungen ansehen (`--staged`: vorgemerkte)', 'see changes (`--staged`: staged ones)')],
            ['git log --oneline', t('Geschichte, kurz', 'history, short')],
            ['git show <commit>', t('einen Commit ansehen', 'look at a commit')],
        ],
    },
    {
        title: t('Branches', 'Branches'),
        items: [
            ['git branch', t('Branches auflisten', 'list branches')],
            ['git switch -c <name>', t('neuen Branch anlegen und wechseln', 'create a branch and switch to it')],
            ['git switch <name>', t('Branch wechseln', 'switch branch')],
            ['git merge <name>', t('Branch in den aktuellen holen', 'merge a branch into the current one')],
            ['git branch -d <name>', t('gemergten Branch löschen', 'delete a merged branch')],
            ['git log --oneline --graph --all', t('alle Branches als Bild', 'all branches as a picture')],
        ],
    },
    {
        title: t('Mit dem Team', 'With the team'),
        items: [
            ['git remote -v', t('welche Server kennt das Repository?', 'which servers does the repository know?')],
            ['git pull', t('Neues holen und zusammenführen', 'get new work and merge it')],
            ['git push', t('eigene Commits hochladen', 'upload your commits')],
            ['git push -u origin <branch>', t('neuen Branch hochladen und verbinden', 'upload a new branch and connect it')],
            ['git fetch', t('nur nachsehen, nichts ändern', 'only look, change nothing')],
        ],
    },
    {
        title: t('Rückgängig machen', 'Undoing things'),
        items: [
            ['git restore <datei>', t('Änderungen verwerfen (endgültig!)', 'discard changes (for good!)')],
            ['git restore --staged <datei>', t('nicht mehr vormerken', 'unstage')],
            ['git commit --amend', t('letzten Commit nachbessern (nur ungepusht)', 'fix up the last commit (unpushed only)')],
            ['git revert <commit>', t('Commit durch Gegen-Commit zurücknehmen', 'take back a commit with a counter-commit')],
            ['git reset --soft HEAD~1', t('letzten Commit auflösen, Änderungen bleiben', 'undo the last commit, keep the changes')],
            ['git reflog', t('wo war HEAD? (Rettungsanker)', 'where has HEAD been? (lifeline)')],
        ],
    },
    {
        title: t('Für später', 'For later'),
        items: [
            ['git stash', t('Änderungen kurz beiseitelegen (`pop` holt sie zurück)', 'put changes aside (`pop` brings them back)')],
            ['git rebase main', t('eigene Commits auf main setzen', 'move your commits onto main')],
            ['git cherry-pick <commit>', t('einzelnen Commit übernehmen', 'take over a single commit')],
            ['git tag -a v1.0 -m "…"', t('Version markieren', 'mark a version')],
        ],
    },
];

const KEYS = [
    ['Tab', t('Befehle, Dateien und Branches vervollständigen', 'complete commands, files and branches')],
    ['↑ / ↓', t('frühere Befehle', 'previous commands')],
    ['Ctrl R', t('in früheren Befehlen suchen', 'search previous commands')],
    ['Ctrl C', t('Befehl abbrechen (mit Auswahl: kopieren)', 'cancel a command (with a selection: copy)')],
    ['Ctrl L', t('Terminal leeren', 'clear the terminal')],
    ['Ctrl A / Ctrl E', t('an den Anfang / das Ende der Zeile', 'to the start / end of the line')],
    ['Ctrl W', t('Wort löschen (Alt+Backspace, falls der Browser Ctrl W abfängt)', 'delete a word (Alt+Backspace if the browser grabs Ctrl W)')],
    ['Ctrl S', t('im Editor: speichern', 'in the editor: save')],
    ['Esc', t('Editor oder Dialog schließen', 'close the editor or a dialog')],
    ['q', t('lange Ausgaben (git log, man) verlassen', 'leave long output (git log, man)')],
];

export function showHelp(app, section = 'start') {
    document.querySelectorAll('.overlay.help-overlay').forEach(o => o.remove());
    const sections = [
        ['start', t('So funktioniert’s', 'How it works'), renderStart],
        ['keys', t('Tastatur', 'Keyboard'), renderKeys],
        ['cheats', t('Spickzettel', 'Cheat sheet'), renderCheats],
        ['terms', t('Begriffe', 'Glossary'), renderTerms],
        ['network', t('Echt oder simuliert?', 'Real or simulated?'), renderNetwork],
        ['about', t('Über & Datenschutz', 'About & privacy'), renderAbout],
    ];
    const nav = h('nav', { class: 'help-nav', 'aria-label': 'help' });
    const body = h('div', { class: 'help-body' });
    const close = () => handle.close();
    const ctx = {
        app,
        insert: cmd => { close(); const { text, cursorBack } = templateToInput(cmd); app.insert(text, { cursorBack }); },
        md: text => md(text, { onCode: c => ctx.insert(c) }),
    };
    const show = id => {
        for (const b of nav.children) b.setAttribute('aria-current', String(b.dataset.id === id));
        const [, title, render] = sections.find(s => s[0] === id);
        clear(body).append(h('h2', {}, L(title)), render(ctx));
        body.scrollTop = 0;
    };
    for (const [id, title] of sections) nav.appendChild(h('button', { type: 'button', 'data-id': id, onclick: () => show(id) }, L(title)));
    const panel = h('div', { class: 'sheet sheet-help', role: 'dialog', 'aria-modal': 'true', 'aria-label': L(t('Hilfe', 'Help')) },
        h('button', { class: 'btn quiet icon-btn sheet-close', type: 'button', 'aria-label': L(t('Schließen', 'Close')), onclick: close }, icon('close')),
        h('div', { class: 'help' }, nav, body));
    show(section);
    const handle = modal(panel, { cls: 'help-overlay', focus: () => nav.querySelector('[aria-current="true"]'), restoreFocus: () => app.terminal?.focus() });
}

function renderStart(ctx) {
    const legend = [
        ['01', t('**Dateien** – dein Home-Ordner. Klick auf einen Ordner wechselt hinein (`cd`), Klick auf eine Datei öffnet sie im Editor. Die Kürzel wie `M` oder `??` sind dieselben wie bei `git status -s`.', '**Files** – your home folder. Clicking a folder changes into it (`cd`), clicking a file opens it in the editor. Codes like `M` or `??` are the same as in `git status -s`.')],
        ['02', t('**Repository** – *Bereiche* zeigt, wo deine Änderungen gerade liegen (Arbeitsverzeichnis → Staging-Area → Repository → Server). *Verlauf* zeigt die Commits als Liniennetz: Branches sind Linien, Commits Stationen.', '**Repository** – *Areas* shows where your changes are right now (working directory → staging area → repository → server). *History* shows the commits as a metro map: branches are lines, commits are stations.')],
        ['03', t('**Terminal** – hier tippst du. Es ist eine echte Bash-ähnliche Shell mit echtem Git. Die Zeile darunter erklärt schon beim Tippen, was dein Befehl tun wird.', '**Terminal** – this is where you type. It is a real bash-like shell with real git. The line below explains while you type what your command will do.')],
        ['04', t('**Coach** – erklärt nach jedem Befehl, was passiert ist, und schlägt nächste Schritte vor. Ein Klick übernimmt einen Vorschlag in die Eingabe; ausgeführt wird erst mit Enter.', '**Coach** – explains after every command what happened and suggests next steps. A click puts a suggestion into the prompt; it only runs when you press Enter.')],
    ];
    return h('div', {},
        h('ul', { class: 'layout-legend' }, ...legend.map(([n, text]) => h('li', {}, h('span', { class: 'num' }, n), h('div', {}, ctx.md(L(text)))))),
        h('h3', {}, L(t('Zwei Welten', 'Two worlds'))),
        ctx.md(L(t('**Missionen** sind geführte Aufgaben mit Geschichte. Server und Teammitglieder sind dort *simuliert* (violett schraffiert). **Sandbox** ist freies Ausprobieren; Remotes sind dort echte Server im Internet. Beide Welten haben getrennte Dateien.', '**Missions** are guided tasks with a story. Servers and teammates are *simulated* there (violet hatching). The **sandbox** is free play; remotes there are real servers on the internet. Both worlds have separate files.'))),
        h('h3', {}, L(t('Rückgängig', 'Undo'))),
        ctx.md(L(t('Der Knopf **Rückgängig** oben stellt Dateien und Git-Daten wie vor dem letzten Befehl wieder her. Den gibt es nur hier – im echten Leben helfen `git reflog`, `git restore` und `git revert`.', 'The **Undo** button at the top restores files and git data to before the last command. It only exists here – in real life `git reflog`, `git restore` and `git revert` help.'))),
        h('h3', {}, L(t('Hilfe im Terminal', 'Help in the terminal'))),
        ctx.md(L(t('`help` listet alle Befehle. `man git-commit` oder `git commit --help` zeigt die Anleitung, `git commit -h` die Kurzfassung. `hints off` macht den Coach knapper.', '`help` lists all commands. `man git-commit` or `git commit --help` shows the manual, `git commit -h` the short version. `hints off` makes the coach briefer.'))));
}

function renderKeys(ctx) {
    return h('div', {},
        h('dl', { class: 'keys' }, ...KEYS.flatMap(([k, d]) => [h('dt', {}, ...k.split(' / ').flatMap((part, i) => [i ? ' / ' : null, h('kbd', {}, part)])), h('dd', {}, L(d))])),
        h('h3', {}, L(t('Bildschirmleser', 'Screen readers'))),
        ctx.md(L(t(
            'Mit eingeschalteter Unterstützung liest dein Bildschirmleser die Ausgabe des Terminals vor, und nach jedem Befehl wird die Zusammenfassung des Coachs angesagt. Alles lässt sich mit der Tastatur bedienen: **Tab** wechselt zwischen den Bereichen, **Esc** schließt Dialoge.',
            'With support switched on, your screen reader reads the terminal output, and after every command the coach\'s summary is announced. Everything works with the keyboard: **Tab** moves between the areas, **Esc** closes dialogs.'))),
        screenReaderToggle(ctx.app));
}

function renderCheats(ctx) {
    return h('div', {},
        h('p', {}, L(t('Klick übernimmt den Befehl in die Eingabe. Platzhalter wie <datei> musst du ersetzen.', 'A click puts the command into the prompt. Replace placeholders like <file>.'))),
        h('div', { class: 'cheats' }, ...CHEATS.map(group => h('section', { class: 'cheat-group' },
            h('h3', {}, L(group.title)),
            ...group.items.map(([cmd, desc]) => h('button', { type: 'button', class: 'cheat', onclick: () => ctx.insert(cmd) },
                h('code', {}, localizeTemplate(cmd)),
                h('span', {}, ...[...ctx.md(L(desc)).firstChild.childNodes])))))));
}

function renderTerms(ctx) {
    const entries = Object.entries(GLOSSARY).map(([key, e]) => [key, ...(e[lang()] || e.de)]).sort((a, b) => a[1].localeCompare(b[1], lang()));
    return h('dl', { class: 'glossary-list' }, ...entries.flatMap(([key, word, text]) => [h('dt', { id: `term-${key}` }, word), h('dd', {}, ctx.md(text))]));
}

function renderNetwork(ctx) {
    return h('div', {},
        ctx.md(L(t(
            'Bei jedem Befehl, der mit einem Server spricht (`clone`, `fetch`, `pull`, `push`), steht im Terminal eine Markierung davor:',
            'Every command that talks to a server (`clone`, `fetch`, `pull`, `push`) is preceded by a marker in the terminal:'))),
        h('div', { class: 'welcome-worlds' },
            h('div', { class: 'ww sim' }, h('div', { class: 'ww-head' }, h('span', { class: 'net sim' }, L(t('simuliert', 'simulated')))),
                ctx.md(L(t('Der Server `git.sim` existiert nur in deinem Browser. Teammitglieder sind gespielt. Nichts verlässt deinen Rechner – du kannst nichts kaputt machen.', 'The server `git.sim` exists only in your browser. Teammates are simulated. Nothing leaves your computer – you cannot break anything.')))),
            h('div', { class: 'ww real' }, h('div', { class: 'ww-head' }, h('span', { class: 'net real' }, L(t('echtes Netz', 'real network')))),
                ctx.md(L(t('Echte Server wie GitHub, erreichbar über einen CORS-Proxy der Schule. Was du pushst, ist wirklich im Internet. Zum Pushen brauchst du ein Personal Access Token. Es geht über den Proxy an den Server und bleibt nur bis zum Neuladen der Seite im Speicher – gespeichert wird es nirgends.', 'Real servers like GitHub, reached through the school\'s CORS proxy. What you push is really on the internet. Pushing needs a personal access token. It passes through the proxy to the server and is only kept in memory until the page is reloaded – it is never saved.'))))),
        ctx.md(L(t(
            'In den **Missionen** gibt es nur den simulierten Server. In der **Sandbox** sind normale Adressen echt – und `https://git.sim/…` wäre auch dort simuliert. Im Bereich *Remote* und in der Titelzeile des Terminals steht immer dabei, welcher Fall gerade gilt.',
            'In the **missions** there is only the simulated server. In the **sandbox** normal addresses are real – and `https://git.sim/…` would be simulated there too. The *Remote* area and the terminal title always say which case applies.'))));
}

function renderAbout(ctx) {
    return h('div', {},
        ctx.md(L(t(
            'Die Git-Werkstatt läuft komplett in deinem Browser. Dateien und Repositories liegen im Speicher dieses Browsers (IndexedDB) – nicht auf einem Server. Es gibt keine Anmeldung, kein Tracking und keine Cookies.\n\nNur Befehle mit echten Remotes in der Sandbox verbinden sich über den CORS-Proxy mit dem jeweiligen Server.\n\nAlles zurücksetzen: Knopf ↺ oben (Sandbox oder Mission). Wer die Browserdaten löscht, löscht auch die Werkstatt-Dateien.',
            'The Git Workshop runs entirely in your browser. Files and repositories live in this browser\'s storage (IndexedDB) – not on a server. There is no login, no tracking and no cookies.\n\nOnly commands with real remotes in the sandbox connect to the respective server through the CORS proxy.\n\nReset everything: the ↺ button at the top (sandbox or mission). Clearing the browser data also deletes the workshop\'s files.'))),
        h('h3', {}, L(t('Bausteine', 'Building blocks'))),
        ctx.md(L(t(
            'Git: isomorphic-git (MIT) mit eigenen Ergänzungen für Merge, Rebase, Stash und Reflog · Dateisystem: LightningFS (MIT) · Terminal: xterm.js (MIT) · Editor: CodeMirror 6 (MIT) · Diffs: jsdiff (BSD), node-diff3 (MIT) · Schrift: Atkinson Hyperlegible (SIL OFL). Alle Bibliotheken liegen lokal im Ordner `vendor/`.',
            'Git: isomorphic-git (MIT) with our own additions for merge, rebase, stash and reflog · File system: LightningFS (MIT) · Terminal: xterm.js (MIT) · Editor: CodeMirror 6 (MIT) · Diffs: jsdiff (BSD), node-diff3 (MIT) · Font: Atkinson Hyperlegible (SIL OFL). All libraries are served locally from the `vendor/` folder.'))),
        h('h3', {}, L(t('Unterschiede zu echtem Git', 'Differences from real git'))),
        ctx.md(L(t(
            '- Ausgaben entsprechen Git 2.53, Meldungen bleiben wie im Original auf Englisch\n- kein SSH, keine Hooks, keine Submodule\n- der Knopf *Rückgängig* ist eine Lernhilfe, die es in echtem Git nicht gibt',
            '- output matches git 2.53; messages stay in English like the original\n- no SSH, no hooks, no submodules\n- the *Undo* button is a learning aid that does not exist in real git'))));
}
