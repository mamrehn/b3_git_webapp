// Line B – branches: create, switch, merge, resolve conflicts, rescue lost work.

import { t, indexHtml, contactHtml, teamHistory, msg, short, sawHistory } from './common.js';
import { lang } from '../../core/i18n.js';

const de = () => lang() === 'de';
const isGit = (e, sub) => e.name === 'git' && e.args[0] === sub;
const graphLog = e => isGit(e, 'log') && e.args.includes('--graph');

function cakePage() {
    return de()
        ? '<h2>Torten auf Bestellung</h2>\n<p>Hochzeit, Geburtstag, Firmenfeier: Wir backen Ihre Wunschtorte.</p>\n'
        : '<h2>Cakes to order</h2>\n<p>Wedding, birthday, office party: we bake the cake you want.</p>\n';
}

function cakePrices() {
    return de()
        ? '<h3>Preise</h3>\n<ul>\n    <li>Obsttorte (12 Stück) – 32 €</li>\n    <li>Schwarzwälder Kirsch (16 Stück) – 45 €</li>\n</ul>\n'
        : '<h3>Prices</h3>\n<ul>\n    <li>Fruit cake (12 slices) – €32</li>\n    <li>Black Forest cake (16 slices) – €45</li>\n</ul>\n';
}

export const BRANCHES = [
    {
        id: 'b1',
        line: 'branches',
        code: 'B1',
        title: t('Ein eigener Zweig', 'A branch of your own'),
        summary: t(
            'Mit Branches an etwas Neuem arbeiten, ohne das Funktionierende zu gefährden.',
            'Work on something new with branches without endangering what works.',
        ),
        story: d => t(
            `Die Bäckerei möchte eine neue Seite: „Torten auf Bestellung“. Du willst daran in Ruhe arbeiten, ohne die laufende Website zu gefährden – vielleicht wird die Idee ja auch wieder verworfen. Genau dafür gibt es [[branch|Branches]]. Nenne deinen Branch \`${d.branch}\`.`,
            `The bakery wants a new page: "Cakes to order". You want to work on it in peace without endangering the live website – maybe the idea gets dropped again. That is what [[branch|branches]] are for. Call your branch \`${d.branch}\`.`,
        ),
        async setup(kit) {
            kit.remember('branch', de() ? 'torten' : 'cakes');
            kit.remember('page', de() ? 'torten.html' : 'cakes.html');
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 4 });
        },
        start: '~/website',
        objectives: [
            {
                text: t('Lass dir anzeigen, welche Branches es gibt.', 'Show which branches exist.'),
                hints: [t('`git branch` ohne weitere Angaben listet sie auf. Der Stern markiert, wo du gerade bist.', '`git branch` without arguments lists them. The star marks where you are.')],
                check: c => c.ran(e => isGit(e, 'branch') && !e.args.slice(1).some(a => !a.startsWith('-'))),
            },
            {
                text: d => t(`Erstelle den Branch \`${d.branch}\` und wechsle hinein.`, `Create the branch \`${d.branch}\` and switch to it.`),
                hints: [
                    t('`git switch -c <name>` erstellt einen Branch *und* wechselt hinein (`-c` wie *create*).', '`git switch -c <name>` creates a branch *and* switches to it (`-c` for *create*).'),
                    d => t(`\`git switch -c ${d.branch}\``, `\`git switch -c ${d.branch}\``),
                ],
                check: async c => (await c.currentBranch('website')) === c.data.branch,
            },
            {
                text: d => t(`Lege \`${d.page}\` mit einer Überschrift an und committe sie auf diesem Branch.`, `Create \`${d.page}\` with a heading and commit it on this branch.`),
                hints: [
                    t('Datei anlegen (`echo … > datei` oder `nano datei`), dann `git add` und `git commit`.', 'Create the file (`echo … > file` or `nano file`), then `git add` and `git commit`.'),
                    d => t(`\`echo "<h1>Torten</h1>" > ${d.page}\`, dann \`git add ${d.page}\` und \`git commit -m "Tortenseite anlegen"\``, `\`echo "<h1>Cakes</h1>" > ${d.page}\`, then \`git add ${d.page}\` and \`git commit -m "Add cakes page"\``),
                ],
                check: async c => (await c.committedText('website', c.data.page, c.data.branch)) !== null,
            },
            {
                text: d => t(`Wechsle zurück auf \`main\` – und schau mit \`ls\`, was mit \`${d.page}\` passiert.`, `Switch back to \`main\` – and check with \`ls\` what happens to \`${d.page}\`.`),
                hints: [t('`git switch main`', '`git switch main`')],
                check: async c => (await c.currentBranch('website')) === 'main',
            },
            {
                text: t('Zeig die Geschichte aller Branches als Bild an.', 'Show the history of all branches as a picture.'),
                hints: [
                    t('`git log` kann mit `--graph` zeichnen; `--all` nimmt alle Branches dazu, `--oneline` hält es kurz.', '`git log` can draw with `--graph`; `--all` includes all branches, `--oneline` keeps it short.'),
                    t('`git log --oneline --graph --all`', '`git log --oneline --graph --all`'),
                ],
                check: c => c.ran(e => graphLog(e) && e.args.includes('--all')),
            },
        ],
        debrief: d => t(
            `Ein Branch ist nur ein beweglicher **Zeiger** auf einen Commit. Mit jedem Commit rückt der aktuelle Branch weiter; [[head|HEAD]] zeigt, auf welchem du stehst.\n\nBeim Wechsel tauscht Git die Dateien im Arbeitsverzeichnis aus: \`${d.page}\` ist nicht weg, sie wohnt auf \`${d.branch}\`. In der Ansicht **Verlauf** siehst du beide Linien.`,
            `A branch is just a movable **pointer** to a commit. With every commit the current branch moves on; [[head|HEAD]] shows which one you are on.\n\nWhen you switch, git swaps the files in the working directory: \`${d.page}\` is not gone, it lives on \`${d.branch}\`. The **History** view shows both lines.`,
        ),
        pitfalls: [
            {
                id: 'other-name',
                check: async c => {
                    const b = await c.currentBranch('website');
                    if (!b || b === 'main' || b === c.data.branch || await c.branchExists('website', c.data.branch)) return false;
                    c.data.otherName = b;
                    return true;
                },
                note: d => t(
                    `Dein Branch heißt \`${d.otherName}\` – die Mission erwartet \`${d.branch}\`. Umbenennen geht so: \`git branch -m ${d.branch}\` (benennt den Branch um, auf dem du stehst).`,
                    `Your branch is called \`${d.otherName}\` – the mission expects \`${d.branch}\`. Renaming works like this: \`git branch -m ${d.branch}\` (renames the branch you are on).`,
                ),
            },
        ],
        learned: ['git branch', 'git switch -c <name>', 'git switch <name>', 'git log --oneline --graph --all'],
    },
    {
        id: 'b2',
        line: 'branches',
        code: 'B2',
        title: t('Zusammenführen', 'Merging'),
        summary: t(
            'Die Arbeit eines Branches mit `git merge` zurück nach `main` holen.',
            'Bring the work of a branch back into `main` with `git merge`.',
        ),
        story: d => t(
            `Die Tortenseite auf \`${d.branch}\` ist fertig und soll online. Während du daran gearbeitet hast, hat Sam auf \`main\` die Telefonnummer aktualisiert. Zeit, beides zusammenzuführen.`,
            `The cakes page on \`${d.branch}\` is done and should go live. While you worked on it, Sam updated the phone number on \`main\`. Time to bring both together.`,
        ),
        async setup(kit) {
            const branch = kit.remember('branch', de() ? 'torten' : 'cakes');
            const page = kit.remember('page', de() ? 'torten.html' : 'cakes.html');
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 4 });
            kit.at(1, '10:15');
            await kit.sh('website', [`git switch -q -c ${branch}`]);
            await kit.commit('website', { files: { [page]: cakePage() }, message: msg(t('Tortenseite anlegen', 'Add cakes page')) });
            kit.later(35);
            kit.remember('featureTip', await kit.commit('website', { files: { [page]: cakePage() + cakePrices() }, message: msg(t('Tortenpreise ergänzt', 'Add cake prices')) }));
            await kit.sh('website', ['git switch -q main']);
            kit.at(0, '08:30');
            await kit.commitAs('sam', 'website', { files: { 'contact.html': contactHtml({ phone: '0911 777888' }) }, message: msg(t('Neue Telefonnummer', 'New phone number')) });
            await kit.sh('website', [`git switch -q ${branch}`]);
        },
        start: '~/website',
        objectives: [
            {
                text: t('Sieh dir an, wie die beiden Branches auseinanderlaufen.', 'Look at how the two branches have diverged.'),
                hints: [t('`git log --oneline --graph --all` – oder die Ansicht **Verlauf** oben.', '`git log --oneline --graph --all` – or the **History** view above.')],
                check: c => c.ran(e => sawHistory(e, { graph: true })),
            },
            {
                text: d => t(`Führe \`${d.branch}\` in \`main\` zusammen.`, `Merge \`${d.branch}\` into \`main\`.`),
                hints: [
                    t('Merge holt Arbeit *in den Branch, auf dem du stehst*. Du musst also zuerst auf den Branch, der etwas bekommen soll.', 'A merge brings work *into the branch you are on*. So first go to the branch that should receive something.'),
                    d => t(`\`git switch main\` und dann \`git merge ${d.branch}\`. Git schlägt eine Nachricht für den Merge-Commit vor – mit **Übernehmen** bestätigen.`, `\`git switch main\` and then \`git merge ${d.branch}\`. Git suggests a message for the merge commit – confirm it with **Accept**.`),
                ],
                check: async c => {
                    const main = await c.refOid('website', 'main');
                    return Boolean(main) && await c.isAncestor('website', c.data.featureTip, main);
                },
            },
            {
                text: d => t(`Lösche den Branch \`${d.branch}\` – er wird nicht mehr gebraucht.`, `Delete the branch \`${d.branch}\` – it is no longer needed.`),
                hints: [
                    t('`git branch -d <name>` löscht einen Branch, aber nur, wenn seine Arbeit schon gemergt ist.', '`git branch -d <name>` deletes a branch, but only if its work has been merged.'),
                    d => t(`\`git branch -d ${d.branch}\``, `\`git branch -d ${d.branch}\``),
                ],
                check: async c => !(await c.branchExists('website', c.data.branch)) && await c.isAncestor('website', c.data.featureTip, await c.refOid('website', 'main')),
            },
        ],
        debrief: t(
            'Weil beide Seiten neue Commits hatten, hat Git einen **Merge-Commit** mit zwei Eltern erstellt – in der Ansicht **Verlauf** ein Umsteigebahnhof.\n\nWäre `main` stehen geblieben, hätte Git den Zeiger einfach vorgespult (*fast-forward*), ganz ohne neuen Commit.\n\n`git branch -d` löscht nur den Zeiger. Die Commits bleiben erhalten – sie sind ja jetzt Teil von `main`.',
            'Because both sides had new commits, git created a **merge commit** with two parents – an interchange station in the **History** view.\n\nHad `main` not moved, git would simply have moved the pointer forward (*fast-forward*), without a new commit.\n\n`git branch -d` only deletes the pointer. The commits stay – they are part of `main` now.',
        ),
        pitfalls: [
            {
                id: 'merge-into-itself',
                check: async c => (await c.currentBranch('website')) === c.data.branch && c.ranNow(e => isGit(e, 'merge') && e.args.includes(c.data.branch)),
                note: d => t(
                    `Du stehst noch auf \`${d.branch}\` – ein Branch kann sich nicht in sich selbst mergen („Already up to date“). Merge holt Arbeit *in* den aktuellen Branch: erst \`git switch main\`, dann \`git merge ${d.branch}\`.`,
                    `You are still on \`${d.branch}\` – a branch cannot merge into itself ("Already up to date"). A merge brings work *into* the current branch: first \`git switch main\`, then \`git merge ${d.branch}\`.`,
                ),
            },
        ],
        learned: ['git merge <branch>', 'git branch -d <branch>'],
    },
    {
        id: 'b3',
        line: 'branches',
        code: 'B3',
        title: t('Konflikte lösen', 'Resolving conflicts'),
        summary: t(
            'Wenn zwei dieselbe Zeile ändern, entscheidest du. Konflikte sind Fragen, keine Fehler.',
            'When two people change the same line, you decide. Conflicts are questions, not errors.',
        ),
        story: d => t(
            `Mia hat auf dem Branch \`${d.branch}\` die Überschrift der Startseite geändert. Du hast auf \`main\` dieselbe Zeile geändert – anders. Git kann nicht wissen, welche Fassung gilt. Das musst du entscheiden.`,
            `On the branch \`${d.branch}\` Mia changed the heading of the home page. You changed the same line on \`main\` – differently. Git cannot know which version is right. You have to decide.`,
        ),
        async setup(kit) {
            const branch = kit.remember('branch', 'slogan');
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 3 });
            kit.at(1, '13:00');
            await kit.sh('website', [`git switch -q -c ${branch}`]);
            const theirs = de() ? 'Bäckerei Krume – seit 1923' : 'Krume Bakery – since 1923';
            kit.remember('sloganTip', await kit.commitAs('mia', 'website', { files: { 'index.html': indexHtml({ title: theirs }) }, message: msg(t('Slogan in der Überschrift', 'Slogan in the heading')) }));
            await kit.sh('website', ['git switch -q main']);
            kit.at(0, '09:20');
            const ours = de() ? 'Bäckerei Krume – frisch aus dem Ofen' : 'Krume Bakery – fresh from the oven';
            await kit.commit('website', { files: { 'index.html': indexHtml({ title: ours }) }, message: msg(t('Überschrift mit Untertitel', 'Heading with a subtitle')) });
        },
        start: '~/website',
        objectives: [
            {
                text: d => t(`Führe \`${d.branch}\` in \`main\` zusammen.`, `Merge \`${d.branch}\` into \`main\`.`),
                hints: [d => t(`\`git merge ${d.branch}\``, `\`git merge ${d.branch}\``)],
                check: async c => (await c.operation('website'))?.kind === 'merge' || await c.isAncestor('website', c.data.sloganTip, await c.refOid('website', 'HEAD')),
            },
            {
                text: t('Öffne `index.html` und entscheide dich für eine Fassung – oder kombiniere beide. Die Konfliktmarker müssen raus.', 'Open `index.html` and choose a version – or combine both. The conflict markers have to go.'),
                hints: [
                    t('Klick `index.html` im Dateibaum an. Über dem Konflikt sind Knöpfe: *Meine Fassung*, *Andere übernehmen*, *Beide behalten*. Danach speichern.', 'Click `index.html` in the file tree. Above the conflict there are buttons: *Keep mine*, *Take theirs*, *Keep both*. Then save.'),
                    t('Alles zwischen `<<<<<<<` und `>>>>>>>` ist der Konflikt: oben deine Fassung, unter `=======` die andere. Lass nur stehen, was gelten soll.', 'Everything between `<<<<<<<` and `>>>>>>>` is the conflict: your version on top, the other one below `=======`. Keep only what should stay.'),
                ],
                check: async c => {
                    const text = await c.file('~/website/index.html');
                    const merging = (await c.operation('website'))?.kind === 'merge' || await c.isAncestor('website', c.data.sloganTip, await c.refOid('website', 'HEAD'));
                    return merging && text !== null && !/^(<{7}|>{7}|={7})( |$)/m.test(text);
                },
            },
            {
                text: t('Melde Git, dass der Konflikt gelöst ist.', 'Tell git that the conflict is resolved.'),
                hints: [
                    t('„Gelöst“ meldest du, indem du die Datei vormerkst.', 'You report "resolved" by staging the file.'),
                    t('`git add index.html`', '`git add index.html`'),
                ],
                check: async c => (await c.conflicts('website')).length === 0,
            },
            {
                text: t('Schließe den Merge mit einem Commit ab.', 'Finish the merge with a commit.'),
                hints: [t('`git commit` – Git hat die Nachricht schon vorbereitet; bestätige sie mit **Übernehmen**.', '`git commit` – git has prepared the message already; confirm it with **Accept**.')],
                check: async c => !(await c.operation('website')) && await c.isAncestor('website', c.data.sloganTip, await c.refOid('website', 'HEAD'))
                    && !/^(<{7}|>{7}|={7})( |$)/m.test((await c.committedText('website', 'index.html')) || ''),
            },
        ],
        debrief: t(
            'Ein Konflikt ist eine Frage: „Welche Fassung gilt?“ Der Ablauf ist immer gleich:\n\n1. `git merge …` meldet den Konflikt\n2. Datei öffnen, Marker entfernen, die richtige Fassung stehen lassen\n3. `git add <datei>` meldet: gelöst\n4. `git commit` schließt den Merge ab\n\nNotausgang: `git merge --abort` stellt den Zustand vor dem Merge wieder her. Konflikte werden seltener, wenn alle kleine Commits machen und oft mergen.',
            'A conflict is a question: "which version is right?" The procedure is always the same:\n\n1. `git merge …` reports the conflict\n2. Open the file, remove the markers, keep the right version\n3. `git add <file>` reports: resolved\n4. `git commit` finishes the merge\n\nEmergency exit: `git merge --abort` restores the state before the merge. Conflicts get rarer when everyone makes small commits and merges often.',
        ),
        pitfalls: [
            {
                id: 'markers-committed',
                check: async c => !(await c.operation('website')) && /^(<{7}|>{7}|={7})( |$)/m.test((await c.committedText('website', 'index.html')) || ''),
                note: t(
                    'Die Konfliktmarker (`<<<<<<<`, `=======`, `>>>>>>>`) sind mit im Commit gelandet – so wäre die Website kaputt. Entferne sie in `index.html` und committe die Korrektur: `git commit -am "Konfliktmarker entfernt"`.',
                    'The conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) ended up in the commit – the website would be broken like this. Remove them from `index.html` and commit the fix: `git commit -am "Remove conflict markers"`.',
                ),
            },
        ],
        learned: ['git merge <branch>', 'git add <datei>', 'git commit', 'git merge --abort'],
    },
    {
        id: 'b4',
        line: 'branches',
        code: 'B4',
        title: t('Verlorenes wiederfinden', 'Finding lost work'),
        summary: t(
            'Ein versehentlich gelöschter Branch? Das Reflog weiß, wo er war.',
            'Deleted a branch by accident? The reflog knows where it was.',
        ),
        story: d => t(
            `Panik! Gestern hast du den Branch \`${d.branch}\` gelöscht – mit \`-D\`, ohne ihn zu mergen. Darin steckten zwei Stunden Arbeit. Aber: Git vergisst so schnell nichts. Jede Bewegung von [[head|HEAD]] steht in einem Tagebuch.`,
            `Panic! Yesterday you deleted the branch \`${d.branch}\` – with \`-D\`, without merging it. It held two hours of work. But: git does not forget that quickly. Every move of [[head|HEAD]] is written down in a diary.`,
        ),
        async setup(kit) {
            const branch = kit.remember('branch', de() ? 'rezepte' : 'recipes');
            const page = de() ? 'rezepte.html' : 'recipes.html';
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 4 });
            kit.at(1, '15:00');
            await kit.sh('website', [`git switch -q -c ${branch}`]);
            await kit.commit('website', { files: { [page]: de() ? '<h2>Rezepte</h2>\n<p>Unser Roggenbrot: 500 g Roggenmehl, Sauerteig, Salz, Wasser.</p>\n' : '<h2>Recipes</h2>\n<p>Our rye bread: 500 g rye flour, sourdough, salt, water.</p>\n' }, message: msg(t('Rezeptseite angefangen', 'Start recipes page')) });
            kit.later(70);
            const tip = await kit.commit('website', { files: { [page]: de() ? '<h2>Rezepte</h2>\n<p>Unser Roggenbrot: 500 g Roggenmehl, Sauerteig, Salz, Wasser.</p>\n<p>Apfelkuchen: Mürbteig, 1 kg Äpfel, Zimt.</p>\n' : '<h2>Recipes</h2>\n<p>Our rye bread: 500 g rye flour, sourdough, salt, water.</p>\n<p>Apple cake: shortcrust pastry, 1 kg apples, cinnamon.</p>\n' }, message: msg(t('Rezept für Apfelkuchen', 'Apple cake recipe')) });
            kit.remember('lostTip', tip);
            kit.later(10);
            await kit.sh('website', ['git switch -q main', `git branch -q -D ${branch}`]);
        },
        start: '~/website',
        objectives: [
            {
                text: t('Schau ins Tagebuch von HEAD: Wo war es zuletzt?', 'Look into HEAD\'s diary: where has it been?'),
                hints: [
                    t('Das Tagebuch heißt *Reflog* – der Befehl auch.', 'The diary is called the *reflog* – and so is the command.'),
                    t('`git reflog`', '`git reflog`'),
                ],
                check: c => c.ran(e => isGit(e, 'reflog') || (isGit(e, 'log') && e.args.some(a => a === '-g' || a === '--walk-reflogs'))),
            },
            {
                text: d => t(`Stell den Branch \`${d.branch}\` wieder her: Er soll auf den letzten Commit von gestern zeigen.`, `Restore the branch \`${d.branch}\`: it should point at yesterday's last commit.`),
                hints: [
                    t('Im Reflog steht beim Wechsel zurück auf `main` („checkout: moving from …“), von welchem Commit du kamst.', 'In the reflog, the switch back to `main` ("checkout: moving from …") shows which commit you came from.'),
                    t('Ein Branch ist nur ein Name für einen Commit: `git branch <name> <commit>` legt ihn an.', 'A branch is just a name for a commit: `git branch <name> <commit>` creates it.'),
                    d => t(`\`git branch ${d.branch} ${short(d.lostTip)}\``, `\`git branch ${d.branch} ${short(d.lostTip)}\``),
                ],
                check: async c => (await c.branches('website')).some(b => b.oid === c.data.lostTip),
            },
            {
                text: t('Prüfe, ob die Arbeit wirklich wieder da ist.', 'Check that the work is really back.'),
                hints: [d => t(`\`git log --oneline ${d.branch}\` oder \`git switch ${d.branch}\` und \`ls\``, `\`git log --oneline ${d.branch}\` or \`git switch ${d.branch}\` and \`ls\``)],
                check: c => c.ran(e => (isGit(e, 'log') && e.args.length > 1) || isGit(e, 'switch') || isGit(e, 'checkout') || isGit(e, 'show')),
            },
        ],
        debrief: t(
            'Das [[reflog|Reflog]] protokolliert jede Bewegung von HEAD und den Branches – lokal auf deinem Rechner, standardmäßig 90 Tage lang. Ein gelöschter Branch, ein verunglücktes `git reset --hard`, ein vermurkster Rebase: Solange die Arbeit **committet** war, findest du sie hier.\n\nWas nie committet wurde, kann allerdings auch das Reflog nicht retten. Darum: lieber einmal zu oft committen.',
            'The [[reflog]] records every move of HEAD and the branches – locally on your machine, for 90 days by default. A deleted branch, an unlucky `git reset --hard`, a botched rebase: as long as the work was **committed**, you will find it here.\n\nWhat was never committed cannot be rescued, not even by the reflog. So: rather commit once too often.',
        ),
        learned: ['git reflog', 'git branch <name> <commit>'],
    },
];
