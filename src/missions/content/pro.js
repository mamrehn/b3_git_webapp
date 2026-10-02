// Line P – tools for later: stash, rebase, cherry-pick, tags.

import { t, SERVER_PATH, indexHtml, styleCss, menuHtml, contactHtml, teamHistory, serverWithHistory, studentClone, msg, short, sawHistory } from './common.js';
import { lang } from '../../core/i18n.js';

const de = () => lang() === 'de';
const isGit = (e, sub) => e.name === 'git' && e.args[0] === sub;

function galleryPage(n) {
    const items = de()
        ? ['Unser Laden in der Hauptstraße', 'Frische Brezeln am Morgen', 'Die Backstube um 4 Uhr früh']
        : ['Our shop on High Street', 'Fresh pretzels in the morning', 'The bakehouse at 4am'];
    return `<h2>${de() ? 'Galerie' : 'Gallery'}</h2>\n<ul>\n${items.slice(0, n).map(i => `    <li>${i}</li>`).join('\n')}\n</ul>\n`;
}

// commits on `branch` that are not on main's tip from the setup
async function ownCommits(c, branch) {
    const base = new Set((await c.commits('website', c.data.mainTip)).map(x => x.oid));
    return (await c.commits('website', branch)).filter(x => !base.has(x.oid));
}

export const PRO = [
    {
        id: 'p1',
        line: 'pro',
        code: 'P1',
        title: t('Kurz beiseitelegen', 'Putting work aside'),
        summary: t(
            'Mitten in der Arbeit ein dringender Fix? `git stash` räumt kurz auf.',
            'An urgent fix in the middle of your work? `git stash` tidies up for a moment.',
        ),
        story: d => t(
            `Du arbeitest auf dem Branch \`design\` an neuen Farben – halbfertig, noch nicht committet. Da ruft die Bäckerei an: Auf der Live-Seite steht „${d.typo}“ statt „${d.name}“! Das muss sofort auf \`main\` korrigiert werden. Deine halbfertigen Farben sollen aber nicht mit in den Fix.`,
            `You are on the branch \`design\` working on new colours – half done, not committed. Then the bakery calls: the live site says "${d.typo}" instead of "${d.name}"! That has to be fixed on \`main\` right away. But your half-done colours must not end up in the fix.`,
        ),
        async setup(kit) {
            kit.remember('name', de() ? 'Bäckerei Krume' : 'Krume Bakery');
            const typo = kit.remember('typo', de() ? 'Bäckerei Krüme' : 'Krüme Bakery');
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 3 });
            kit.at(1, '17:05');
            await kit.commitAs('sam', 'website', { files: { 'index.html': indexHtml({ title: typo }) }, message: msg(t('Überschrift neu gesetzt', 'Reset the heading')) });
            kit.at(0, '09:00');
            await kit.sh('website', ['git switch -q -c design']);
            await kit.commit('website', { files: { 'style.css': styleCss({ accent: '#a0522d' }) }, message: msg(t('Wärmere Überschriftsfarbe', 'Warmer heading colour')) });
            kit.now();
            const wip = styleCss({ accent: '#a0522d', extra: '\nnav a {\n    color: #a0522d;\n    /* TODO: Hover-Farbe */\n}\n' });
            kit.remember('wip', wip);
            await kit.files('website', { 'style.css': wip });
        },
        start: '~/website',
        objectives: [
            {
                text: t('Leg deine halbfertigen Änderungen beiseite, ohne sie zu committen.', 'Put your half-done changes aside without committing them.'),
                hints: [
                    t('Der Befehl heißt wie „verstauen“ auf Englisch.', 'The command is the English word for *to stow away*.'),
                    t('`git stash`', '`git stash`'),
                ],
                check: async c => Boolean(await c.refOid('website', 'refs/stash')) && (await c.file('~/website/style.css')) === (await c.committedText('website', 'style.css')),
            },
            {
                text: d => t(`Wechsle auf \`main\`, korrigiere „${d.typo}“ in \`index.html\` und committe.`, `Switch to \`main\`, fix "${d.typo}" in \`index.html\` and commit.`),
                hints: [
                    t('`git switch main`, dann die Datei bearbeiten und speichern.', '`git switch main`, then edit and save the file.'),
                    t('`git commit -am "Tippfehler in der Überschrift"`', '`git commit -am "Fix typo in the heading"`'),
                ],
                check: async c => {
                    const text = await c.committedText('website', 'index.html', 'main');
                    return Boolean(text) && !text.includes(c.data.typo) && text.includes(c.data.name);
                },
            },
            {
                text: t('Zurück auf `design` – und hol deine Änderungen wieder hervor.', 'Back to `design` – and bring your changes back.'),
                hints: [
                    t('`git stash list` zeigt, was beiseitegelegt ist. `pop` holt den obersten Eintrag zurück.', '`git stash list` shows what is put aside. `pop` brings back the top entry.'),
                    t('`git switch design` und dann `git stash pop`', '`git switch design` and then `git stash pop`'),
                ],
                // `git stash apply` is fine too (it keeps the entry – see the pitfall)
                check: async c => (await c.currentBranch('website')) === 'design' && (await c.file('~/website/style.css')) === c.data.wip,
            },
        ],
        debrief: t(
            '`git stash` legt Änderungen auf einen Stapel und räumt das Arbeitsverzeichnis auf:\n\n- `git stash` – beiseitelegen (`-u` nimmt auch neue Dateien mit)\n- `git stash list` – was liegt drauf?\n- `git stash pop` – obersten Eintrag zurückholen\n\nFür kurze Unterbrechungen ideal. Für längere Pausen ist ein normaler Commit auf einem Branch meist besser – Stash-Einträge vergisst man leicht.',
            '`git stash` puts changes on a stack and tidies the working directory:\n\n- `git stash` – put aside (`-u` includes new files)\n- `git stash list` – what is on the stack?\n- `git stash pop` – bring back the top entry\n\nIdeal for short interruptions. For longer breaks a normal commit on a branch is usually better – stash entries are easily forgotten.',
        ),
        pitfalls: [
            {
                id: 'applied',
                check: async c => (await c.currentBranch('website')) === 'design' && (await c.file('~/website/style.css')) === c.data.wip && Boolean(await c.refOid('website', 'refs/stash')),
                note: t(
                    '`git stash apply` hat die Änderungen zurückgeholt, den Eintrag aber auf dem Stapel gelassen. Brauchst du ihn nicht mehr: `git stash drop`. (`git stash pop` = apply + drop.)',
                    '`git stash apply` brought the changes back but left the entry on the stack. If you no longer need it: `git stash drop`. (`git stash pop` = apply + drop.)',
                ),
            },
        ],
        learned: ['git stash', 'git stash list', 'git stash pop'],
    },
    {
        id: 'p2',
        line: 'pro',
        code: 'P2',
        title: t('Eine gerade Linie', 'A straight line'),
        summary: t(
            'Mit `git rebase` eigene Commits auf den neuesten Stand setzen.',
            'Move your commits onto the latest state with `git rebase`.',
        ),
        story: d => t(
            `Dein Branch \`${d.branch}\` hat drei Commits, aber \`main\` ist inzwischen weitergelaufen. Das Team mag eine gerade Geschichte ohne unnötige Merge-Commits. Setz deine Commits mit \`rebase\` obendrauf – das geht, weil sie noch niemand anderes hat.`,
            `Your branch \`${d.branch}\` has three commits, but \`main\` has moved on in the meantime. The team likes a straight history without unnecessary merge commits. Put your commits on top with \`rebase\` – that is fine because nobody else has them yet.`,
        ),
        async setup(kit) {
            const branch = kit.remember('branch', de() ? 'galerie' : 'gallery');
            const page = de() ? 'galerie.html' : 'gallery.html';
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 4 });
            kit.at(2, '10:00');
            await kit.sh('website', [`git switch -q -c ${branch}`]);
            for (let n = 1; n <= 3; n++) {
                await kit.commit('website', { files: { [page]: galleryPage(n) }, message: msg(t(`Galerie: Bild ${n}`, `Gallery: picture ${n}`)) });
                kit.later(25);
            }
            kit.remember('galleryTip', await kit.headOf('website'));
            await kit.sh('website', ['git switch -q main']);
            kit.at(1, '11:30');
            await kit.commitAs('mia', 'website', { files: { 'menu.html': menuHtml().replace(/(<\/ul>)/, de() ? '    <li>Laugenstange – 1,10 €</li>\n$1' : '    <li>Pretzel stick – €1.10</li>\n$1') }, message: msg(t('Laugenstangen ins Sortiment', 'Add pretzel sticks')) });
            kit.at(0, '08:10');
            kit.remember('mainTip', await kit.commitAs('sam', 'website', { files: { 'contact.html': contactHtml({ phone: '0911 135790' }) }, message: msg(t('Telefonnummer aktualisiert', 'Update phone number')) }));
            await kit.sh('website', [`git switch -q ${branch}`]);
        },
        start: '~/website',
        objectives: [
            {
                text: t('Sieh dir an, wie die Branches auseinanderlaufen.', 'Look at how the branches have diverged.'),
                hints: [t('`git log --oneline --graph --all` – oder die Ansicht **Verlauf** oben.', '`git log --oneline --graph --all` – or the **History** view above.')],
                check: c => c.ran(e => sawHistory(e, { graph: true })),
            },
            {
                text: d => t(`Setze \`${d.branch}\` auf den aktuellen Stand von \`main\`.`, `Move \`${d.branch}\` onto the current state of \`main\`.`),
                hints: [
                    t('Du stehst auf dem Branch, der *umziehen* soll. Das Ziel ist `main`.', 'You are on the branch that should *move*. The target is `main`.'),
                    t('`git rebase main`', '`git rebase main`'),
                ],
                check: async c => {
                    const tip = await c.refOid('website', c.data.branch);
                    return Boolean(tip) && tip !== c.data.galleryTip && !(await c.operation('website')) && await c.isAncestor('website', c.data.mainTip, tip)
                        && (await ownCommits(c, c.data.branch)).every(x => x.parents.length === 1); // a straight line: no merge commit
                },
            },
            {
                text: t('Sieh dir die Geschichte jetzt an – und vergleiche die Hashes deiner Commits mit vorher.', 'Look at the history now – and compare the hashes of your commits with before.'),
                hints: [t('`git log --oneline --graph --all` – oder die Ansicht **Verlauf**.', '`git log --oneline --graph --all` – or the **History** view.')],
                check: c => c.ran(e => sawHistory(e)),
            },
            {
                text: d => t(`Bring \`${d.branch}\` nach \`main\` – diesmal als Fast-Forward.`, `Bring \`${d.branch}\` into \`main\` – as a fast-forward this time.`),
                hints: [d => t(`\`git switch main\` und \`git merge ${d.branch}\``, `\`git switch main\` and \`git merge ${d.branch}\``)],
                check: async c => {
                    const main = await c.refOid('website', 'main');
                    return Boolean(main) && main === (await c.refOid('website', c.data.branch)) && await c.isAncestor('website', c.data.mainTip, main);
                },
            },
        ],
        debrief: t(
            'Rebase nimmt deine Commits und spielt sie auf einer neuen Basis noch einmal ab: gleiche Änderungen, **neue Hashes**, neue Eltern. Danach ist der Merge ein einfaches Vorspulen.\n\nDie goldene Regel: **Nur rebasen, was du noch nicht geteilt hast.** Wer die alten Commits schon hat, bekommt sonst doppelte Geschichte. Merge bewahrt die Geschichte, wie sie war – Rebase macht sie gerader.\n\nWenn beim Rebase Konflikte entstehen: lösen, `git add`, `git rebase --continue`. Notausgang: `git rebase --abort`.',
            'Rebase takes your commits and replays them on a new base: same changes, **new hashes**, new parents. Afterwards the merge is a simple fast-forward.\n\nThe golden rule: **only rebase what you have not shared yet.** Whoever already has the old commits ends up with duplicated history. Merge keeps history as it happened – rebase makes it straighter.\n\nIf a rebase hits conflicts: resolve, `git add`, `git rebase --continue`. Emergency exit: `git rebase --abort`.',
        ),
        pitfalls: [
            {
                id: 'merged',
                // merged main into the branch, or the branch into main
                check: async c => (await ownCommits(c, c.data.branch)).some(x => x.parents.length > 1) || (await ownCommits(c, 'main')).some(x => x.parents.length > 1),
                note: d => t(
                    `Das war ein Merge: Er funktioniert, aber die Geschichte hat jetzt eine Abzweigung mit Merge-Commit – genau das will das Team vermeiden. Nimm ihn mit **Rückgängig** oben zurück und probier \`git rebase main\` auf \`${d.branch}\`.`,
                    `That was a merge: it works, but the history now has a fork with a merge commit – exactly what the team wants to avoid. Take it back with **Undo** at the top and try \`git rebase main\` on \`${d.branch}\`.`,
                ),
            },
        ],
        learned: ['git rebase main', 'git rebase --continue', 'git rebase --abort'],
    },
    {
        id: 'p3',
        line: 'pro',
        code: 'P3',
        title: t('Rosinen picken', 'Picking cherries'),
        summary: t(
            'Einen einzelnen Commit von einem anderen Branch übernehmen: `git cherry-pick`.',
            'Take over a single commit from another branch: `git cherry-pick`.',
        ),
        story: t(
            'Alex probiert auf dem Branch `test` wilde Ideen aus. Zwischen den Experimenten steckt aber ein echter Fix: das Kontaktformular. Nur **dieser eine** Commit soll nach `main` – die Experimente nicht.',
            'On the branch `test` Alex tries out wild ideas. Between the experiments there is a real fix though: the contact form. Only **this one** commit should go to `main` – not the experiments.',
        ),
        async setup(kit) {
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 4 });
            kit.at(1, '14:00');
            await kit.sh('website', ['git switch -q -c test']);
            await kit.commitAs('alex', 'website', { files: { 'style.css': styleCss({ accent: '#39ff14', extra: '\nbody {\n    background: #000;\n}\n' }) }, message: msg(t('Experiment: Neonfarben', 'Experiment: neon colours')) });
            kit.later(30);
            const fixed = contactHtml() + (de()
                ? '<form action="mailto:hallo@krume.example" method="post">\n    <input name="name" placeholder="Name" required>\n    <textarea name="nachricht" required></textarea>\n    <button>Senden</button>\n</form>\n'
                : '<form action="mailto:hello@krume.example" method="post">\n    <input name="name" placeholder="Name" required>\n    <textarea name="message" required></textarea>\n    <button>Send</button>\n</form>\n');
            kit.remember('fixCommit', await kit.commitAs('alex', 'website', { files: { 'contact.html': fixed }, message: msg(t('Kontaktformular repariert', 'Fix the contact form')) }));
            kit.remember('fixedContact', fixed);
            kit.later(40);
            kit.remember('testTip', await kit.commitAs('alex', 'website', { files: { 'index.html': indexHtml({ extra: '        <marquee>SONDERANGEBOT!!!</marquee>\n' }) }, message: msg(t('Experiment: Lauftext', 'Experiment: scrolling text')) }));
            await kit.sh('website', ['git switch -q main']);
        },
        start: '~/website',
        objectives: [
            {
                text: t('Sieh dir die Commits auf `test` an und finde den Fix.', 'Look at the commits on `test` and find the fix.'),
                hints: [t('`git log --oneline test`', '`git log --oneline test`')],
                check: c => c.ran(e => isGit(e, 'log') && e.args.some(a => a === 'test' || a === '--all' || a.endsWith('test'))),
            },
            {
                text: t('Übernimm genau diesen einen Commit nach `main`.', 'Take over exactly this one commit into `main`.'),
                hints: [
                    t('Du stehst auf `main`. Der Befehl pflückt einen einzelnen Commit wie eine Kirsche.', 'You are on `main`. The command picks a single commit like a cherry.'),
                    d => t(`\`git cherry-pick ${short(d.fixCommit)}\``, `\`git cherry-pick ${short(d.fixCommit)}\``),
                ],
                check: async c => {
                    const main = await c.refOid('website', 'main');
                    return !(await c.operation('website')) && (await c.committedText('website', 'contact.html', 'main')) === c.data.fixedContact && !(await c.isAncestor('website', c.data.testTip, main));
                },
            },
            {
                text: t('Vergleiche: Welchen Hash hat der übernommene Commit auf `main`, welchen das Original?', 'Compare: which hash does the copied commit have on `main`, which one the original?'),
                hints: [t('`git log --oneline --all` – oder die Ansicht **Verlauf**.', '`git log --oneline --all` – or the **History** view.')],
                check: c => c.ran(e => sawHistory(e) || isGit(e, 'show')),
            },
        ],
        debrief: t(
            '`git cherry-pick <commit>` kopiert die Änderungen eines einzelnen Commits auf deinen aktuellen Branch – als **neuen** Commit mit neuem Hash. Das Original bleibt auf `test`.\n\nPraktisch für Hotfixes oder wenn ein Branch nicht als Ganzes übernommen werden soll. Im Alltag sind Merges meist die bessere Wahl, weil Kopien doppelt in der Geschichte stehen.',
            '`git cherry-pick <commit>` copies the changes of a single commit onto your current branch – as a **new** commit with a new hash. The original stays on `test`.\n\nHandy for hotfixes or when a branch should not be taken over as a whole. In everyday work merges are usually the better choice, because copies appear twice in the history.',
        ),
        pitfalls: [
            {
                id: 'whole-branch',
                check: async c => c.isAncestor('website', c.data.testTip, await c.refOid('website', 'main')),
                note: t(
                    'Jetzt ist der ganze Branch `test` in `main` – samt Neonfarben und Lauftext. Nimm das mit **Rückgängig** oben zurück und übernimm nur den einen Commit mit `git cherry-pick`.',
                    'Now the whole branch `test` is in `main` – including neon colours and scrolling text. Take it back with **Undo** at the top and take over just the one commit with `git cherry-pick`.',
                ),
            },
        ],
        learned: ['git cherry-pick <commit>'],
    },
    {
        id: 'p4',
        line: 'pro',
        code: 'P4',
        title: t('Version 1.0', 'Version 1.0'),
        summary: t(
            'Einen Stand mit einem Tag markieren und das Tag mit dem Team teilen.',
            'Mark a state with a tag and share the tag with the team.',
        ),
        story: t(
            'Die Website geht offiziell online! Markiere diesen Stand als Version **v1.0**, damit ihn alle jederzeit wiederfinden – auch in zwei Jahren noch.',
            'The website officially goes live! Mark this state as version **v1.0** so everybody can find it again at any time – even two years from now.',
        ),
        async setup(kit) {
            await serverWithHistory(kit, { days: 6 });
            await studentClone(kit);
        },
        start: '~/website',
        objectives: [
            {
                text: t('Erstelle ein Tag `v1.0` mit einer Beschreibung (ein *annotiertes* Tag).', 'Create a tag `v1.0` with a description (an *annotated* tag).'),
                hints: [
                    t('`git tag` legt Tags an; `-a` macht es annotiert, `-m` gibt die Beschreibung mit.', '`git tag` creates tags; `-a` makes it annotated, `-m` passes the description.'),
                    t('`git tag -a v1.0 -m "Erste Version online"`', '`git tag -a v1.0 -m "First version online"`'),
                ],
                check: async c => {
                    const repo = await c.openRepo('website');
                    return Boolean(repo) && (await repo.tags()).some(tg => tg.name === 'v1.0' && tg.annotated);
                },
            },
            {
                text: t('Zeig dir das Tag samt Beschreibung an.', 'Show the tag with its description.'),
                hints: [t('`git show v1.0`', '`git show v1.0`')],
                check: c => c.ran(e => (isGit(e, 'show') && e.args.includes('v1.0')) || (isGit(e, 'tag') && e.args.some(a => /^-n/.test(a)))),
            },
            {
                text: t('Tags werden nicht automatisch gepusht. Bring es auf den Server.', 'Tags are not pushed automatically. Bring it to the server.'),
                hints: [
                    t('Gib beim Push den Namen des Tags an – oder schick mit `--tags` alle.', 'Name the tag when pushing – or send all of them with `--tags`.'),
                    t('`git push origin v1.0`', '`git push origin v1.0`'),
                ],
                check: async c => Boolean(await c.serverTag(SERVER_PATH, 'v1.0')),
            },
        ],
        debrief: t(
            'Ein Tag ist ein fester Name für einen Commit – anders als ein Branch bewegt es sich nie. Annotierte Tags (`-a`) speichern zusätzlich Autor, Datum und Beschreibung; sie sind für Versionen gedacht.\n\nÜblich ist *Semantic Versioning*: `v1.0.0` → `v1.0.1` (Fehlerkorrektur) → `v1.1.0` (neue Funktion) → `v2.0.0` (inkompatible Änderung). Auf GitHub werden aus Tags „Releases“.',
            'A tag is a fixed name for a commit – unlike a branch it never moves. Annotated tags (`-a`) also store author, date and description; they are meant for versions.\n\n*Semantic versioning* is common: `v1.0.0` → `v1.0.1` (bug fix) → `v1.1.0` (new feature) → `v2.0.0` (incompatible change). On GitHub, tags become "releases".',
        ),
        pitfalls: [
            {
                id: 'lightweight',
                check: async c => {
                    const repo = await c.openRepo('website');
                    return Boolean(repo) && (await repo.tags()).some(tg => tg.name === 'v1.0' && !tg.annotated);
                },
                note: t(
                    '`v1.0` ist ein *leichtes* Tag – nur ein Name, ohne Autor, Datum und Beschreibung. Lösch es mit `git tag -d v1.0` und leg es mit `git tag -a v1.0 -m "…"` neu an.',
                    '`v1.0` is a *lightweight* tag – just a name, without author, date and description. Delete it with `git tag -d v1.0` and create it again with `git tag -a v1.0 -m "…"`.',
                ),
            },
        ],
        learned: ['git tag -a v1.0 -m "…"', 'git show v1.0', 'git push origin v1.0'],
    },
];
