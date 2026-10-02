// Line G – git basics: repository, staging, commits, diffs, history, undo.

import { t, indexHtml, styleCss, menuHtml, contactHtml, teamHistory, msg, pointsAt, short } from './common.js';
import { lang } from '../../core/i18n.js';

const de = () => lang() === 'de';
const isGit = (e, sub) => e.name === 'git' && e.args[0] === sub;

export const GIT = [
    {
        id: 'g1',
        line: 'git',
        code: 'G1',
        identity: false,
        title: t('Ein Repository anlegen', 'Create a repository'),
        summary: t(
            'Git vorstellen, wer du bist, und aus einem Ordner ein Repository machen.',
            'Tell git who you are and turn a folder into a repository.',
        ),
        story: t(
            'Die ersten Dateien der Bäckerei-Website liegen in `~/website`. Ab jetzt soll Git jede Version aufheben. Dafür braucht Git zwei Dinge: **wer du bist** (das steht später an jedem Commit) – und ein [[repository|Repository]].',
            'The first files of the bakery website are in `~/website`. From now on git should keep every version. For that git needs two things: **who you are** (it goes on every commit) – and a [[repository]].',
        ),
        async setup(kit) {
            await kit.files('website', { 'index.html': indexHtml(), 'style.css': styleCss() });
        },
        start: '~',
        objectives: [
            {
                text: t('Sag Git deinen Namen.', 'Tell git your name.'),
                hints: [
                    t('Einstellungen macht man mit `git config`. Mit `--global` gelten sie für alle Repositories auf diesem Rechner.', 'Settings are made with `git config`. With `--global` they apply to all repositories on this computer.'),
                    t('`git config --global user.name "Vorname Nachname"` – mit deinem Namen in den Anführungszeichen.', '`git config --global user.name "First Last"` – with your name inside the quotes.'),
                ],
                check: async c => Boolean(await c.config(null, 'user.name')),
            },
            {
                text: t('… und deine E-Mail-Adresse.', '… and your email address.'),
                hints: [
                    t('Genau wie beim Namen, nur mit `user.email`. Hier reicht eine ausgedachte Adresse.', 'Just like the name, but with `user.email`. A made-up address is fine here.'),
                    t('`git config --global user.email "du@example.com"`', '`git config --global user.email "you@example.com"`'),
                ],
                check: async c => Boolean(await c.config(null, 'user.email')),
            },
            {
                text: t('Wechsle in den Ordner `website`.', 'Change into the `website` folder.'),
                hints: [t('`cd website`', '`cd website`')],
                check: c => c.cwdIs('~/website'),
            },
            {
                text: t('Mach aus dem Ordner ein Git-Repository.', 'Turn the folder into a git repository.'),
                hints: [
                    t('Ein Repository wird *initialisiert*.', 'A repository is *initialised*.'),
                    t('`git init`', '`git init`'),
                ],
                check: c => c.isRepo('~/website'),
            },
            {
                text: t('Frag Git, was es sieht.', 'Ask git what it sees.'),
                hints: [
                    t('Der wichtigste Befehl überhaupt fragt nach dem *Zustand*.', 'The most important command of all asks for the *status*.'),
                    t('`git status`', '`git status`'),
                ],
                check: c => c.ran(e => isGit(e, 'status')),
            },
        ],
        debrief: t(
            '`git init` hat den versteckten Ordner `.git` angelegt (sichtbar mit `ls -a`). **Das** ist das Repository – Gits Gedächtnis. Deine Dateien liegen daneben im [[workdir|Arbeitsverzeichnis]].\n\n`git status` meldet sie als *untracked*: Git sieht sie, hebt sie aber noch nicht auf. Wie man das ändert, lernst du in G2.',
            '`git init` created the hidden folder `.git` (visible with `ls -a`). **That** is the repository – git\'s memory. Your files sit next to it in the [[workdir|working directory]].\n\n`git status` reports them as *untracked*: git sees them but does not keep them yet. How to change that is G2.',
        ),
        learned: ['git config --global user.name', 'git init', 'git status'],
    },
    {
        id: 'g2',
        line: 'git',
        code: 'G2',
        title: t('Der erste Commit', 'The first commit'),
        summary: t(
            'Erst vormerken, dann speichern: Staging-Area und Commit.',
            'Stage first, then save: the staging area and commits.',
        ),
        story: d => t(
            `Git sieht deine Dateien, hebt aber noch nichts auf. Speichern geht in zwei Schritten: Erst legst du fest, **was** in die nächste Version soll (die [[staging|Staging-Area]]), dann speicherst du genau diese Auswahl als [[commit|Commit]].\n\nÜbrigens: \`${d.notes}\` sind deine privaten Notizen. Die gehören nicht in die Website.`,
            `Git sees your files but keeps nothing yet. Saving takes two steps: first you decide **what** goes into the next version (the [[staging|staging area]]), then you save exactly that selection as a [[commit]].\n\nBy the way: \`${d.notes}\` holds your private notes. They do not belong in the website.`,
        ),
        async setup(kit) {
            const notes = kit.remember('notes', de() ? 'notizen.txt' : 'notes.txt');
            await kit.files('website', {
                'index.html': indexHtml(),
                'style.css': styleCss(),
                [notes]: de() ? 'Farben mit Sam absprechen\nFotos vom Laden machen\n' : 'Check colours with Sam\nTake photos of the shop\n',
            });
            await kit.sh('website', ['git init -q']);
        },
        start: '~/website',
        objectives: [
            {
                text: t('Merke `index.html` für den nächsten Commit vor.', 'Stage `index.html` for the next commit.'),
                hints: [
                    t('Vormerken heißt in Git *hinzufügen*.', 'In git, staging is called *adding*.'),
                    t('`git add index.html`', '`git add index.html`'),
                ],
                check: c => c.tracked('website', 'index.html'),
            },
            {
                text: t('Schau nach, was jetzt vorgemerkt ist.', 'Check what is staged now.'),
                hints: [t('`git status` – der vorgemerkte Teil steht unter „Changes to be committed“.', '`git status` – the staged part is listed under "Changes to be committed".')],
                check: c => c.ran(e => isGit(e, 'status')),
            },
            {
                text: t('Speichere die Auswahl als Commit – mit einer Nachricht, die sagt, was du getan hast.', 'Save the selection as a commit – with a message that says what you did.'),
                hints: [
                    t('`git commit` öffnet einen Editor für die Nachricht. Mit `-m "…"` gibst du sie direkt mit.', '`git commit` opens an editor for the message. With `-m "…"` you pass it directly.'),
                    t('`git commit -m "Startseite anlegen"`', '`git commit -m "Add the home page"`'),
                ],
                check: async c => (await c.committedText('website', 'index.html')) !== null,
            },
            {
                text: t('Committe jetzt auch `style.css`.', 'Now commit `style.css` as well.'),
                hints: [
                    d => t(`Wieder zwei Schritte: vormerken, dann speichern. Nimm nur \`style.css\` – mit \`git add .\` wären auch deine Notizen (\`${d.notes}\`) dabei.`, `Two steps again: stage, then save. Take only \`style.css\` – \`git add .\` would include your notes (\`${d.notes}\`) too.`),
                    t('`git add style.css` und dann `git commit -m "Farben und Schrift"`', '`git add style.css` and then `git commit -m "Colours and font"`'),
                ],
                check: async c => (await c.committedText('website', 'style.css')) !== null,
            },
            {
                text: t('Sieh dir die Geschichte deines Projekts an.', 'Look at the history of your project.'),
                hints: [t('Das *Logbuch* des Repositorys: `git log`', 'The repository\'s *log book*: `git log`')],
                check: c => c.ran(e => isGit(e, 'log')),
            },
        ],
        pitfalls: [
            {
                id: 'notes-staged',
                check: async c => (await c.status('website'))?.staged.some(s => s.path === c.data.notes),
                note: d => t(
                    `**Achtung:** \`${d.notes}\` ist jetzt vorgemerkt – das sind deine privaten Notizen. Mit \`git restore --staged ${d.notes}\` nimmst du sie wieder aus der Staging-Area (die Datei selbst bleibt).`,
                    `**Careful:** \`${d.notes}\` is staged now – those are your private notes. \`git restore --staged ${d.notes}\` takes them out of the staging area again (the file itself stays).`,
                ),
            },
            {
                id: 'notes-committed',
                check: async c => {
                    const hit = (await c.committedText('website', c.data.notes)) !== null;
                    if (hit) c.data.notesCommitted = true;
                    return hit;
                },
                note: d => t(
                    `\`${d.notes}\` ist mit im Commit gelandet. Für diese Mission ist das kein Drama. In einem echten Projekt würdest du sie mit \`git rm --cached ${d.notes}\` wieder aus Git entfernen und in die \`.gitignore\` eintragen – das kommt in Mission G5.`,
                    `\`${d.notes}\` ended up in the commit. For this mission that is no drama. In a real project you would remove it from git with \`git rm --cached ${d.notes}\` and list it in \`.gitignore\` – that comes in mission G5.`,
                ),
            },
        ],
        debrief: d => t(
            `Zwei Schritte, die du ab jetzt ständig machst: \`git add\` (vormerken) und \`git commit\` (speichern). Die zwei Schritte geben dir die Kontrolle, was zusammengehört${d.notesCommitted ? ` – nächstes Mal bleibt \`${d.notes}\` draußen` : ` – \`${d.notes}\` ist zum Beispiel draußen geblieben`}.\n\nJeder Commit hat eine eindeutige Nummer (den [[hash|Hash]]), Autor, Datum und Nachricht. In der Ansicht **Verlauf** siehst du deine Commits als Stationen einer Linie.`,
            `Two steps you will do all the time from now on: \`git add\` (stage) and \`git commit\` (save). The two steps give you control over what belongs together${d.notesCommitted ? ` – next time \`${d.notes}\` stays out` : ` – \`${d.notes}\` stayed out, for example`}.\n\nEvery commit has a unique number (its [[hash]]), an author, a date and a message. The **History** view shows your commits as stations on a line.`,
        ),
        learned: ['git add <datei>', 'git commit -m "…"', 'git log'],
    },
    {
        id: 'g3',
        line: 'git',
        code: 'G3',
        title: t('Änderungen verfolgen', 'Tracking changes'),
        summary: t(
            'Mit `git diff` genau sehen, was sich geändert hat – vor und nach dem Vormerken.',
            'See exactly what changed with `git diff` – before and after staging.',
        ),
        story: t(
            'Die Bäckerei ruft an: Samstags ist jetzt bis 14 Uhr geöffnet. Die Öffnungszeiten stehen in `index.html`. Ändere sie – und lass dir von Git genau zeigen, was du geändert hast, bevor du es speicherst.',
            'The bakery calls: on Saturdays they now open until 2pm. The opening hours are in `index.html`. Change them – and let git show you exactly what you changed before you save it.',
        ),
        async setup(kit) {
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 4 });
            kit.remember('initialIndex', await kit.read('website/index.html'));
        },
        start: '~/website',
        objectives: [
            {
                text: t('Ändere in `index.html` die Öffnungszeiten am Samstag und speichere die Datei.', 'Change the Saturday opening hours in `index.html` and save the file.'),
                hints: [
                    t('Öffne die Datei mit einem Klick im Dateibaum – oder im Terminal mit `nano index.html`. Speichern mit **Strg+S**.', 'Open the file with a click in the file tree – or in the terminal with `nano index.html`. Save with **Ctrl+S**.'),
                    t('`nano index.html`, dann „Sa 7–13 Uhr“ in „Sa 7–14 Uhr“ ändern, **Strg+S**, **Esc**.', '`nano index.html`, change "Sat 7am–1pm" to "Sat 7am–2pm", **Ctrl+S**, **Esc**.'),
                ],
                check: async c => (await c.file('~/website/index.html')) !== c.data.initialIndex || (await c.committedText('website', 'index.html')) !== c.data.initialIndex,
            },
            {
                text: t('Lass dir von Git zeigen, was sich geändert hat.', 'Let git show you what changed.'),
                hints: [
                    t('Gesucht ist der *Unterschied* (englisch: difference) zwischen Datei und letzter Version.', 'You want the *difference* between the file and the last version.'),
                    t('`git diff`', '`git diff`'),
                ],
                check: c => c.ran(e => isGit(e, 'diff') && !e.args.some(a => a === '--staged' || a === '--cached')),
            },
            {
                text: t('Merke die Änderung vor.', 'Stage the change.'),
                hints: [t('`git add index.html`', '`git add index.html`')],
                check: async c => ((await c.status('website'))?.staged || []).some(s => s.path === 'index.html') || (await c.committedText('website', 'index.html')) !== c.data.initialIndex,
            },
            {
                text: t('Prüfe, was im nächsten Commit landen wird.', 'Check what will go into the next commit.'),
                hints: [
                    t('`git diff` allein zeigt nur, was noch *nicht* vorgemerkt ist – jetzt bleibt es leer. Es gibt eine Option für das Vorgemerkte.', '`git diff` alone only shows what is *not* staged yet – so it is empty now. There is an option for the staged part.'),
                    t('`git diff --staged`', '`git diff --staged`'),
                ],
                check: c => c.ran(e => isGit(e, 'diff') && e.args.some(a => a === '--staged' || a === '--cached')),
            },
            {
                text: t('Committe die Änderung.', 'Commit the change.'),
                hints: [t('`git commit -m "Öffnungszeiten am Samstag verlängert"`', '`git commit -m "Extend Saturday opening hours"`')],
                check: async c => (await c.committedText('website', 'index.html')) !== c.data.initialIndex,
            },
            {
                text: t('Sieh dir deinen Commit noch einmal an – samt Änderungen.', 'Look at your commit once more – including its changes.'),
                hints: [t('`git show` zeigt den letzten Commit mit seinem Diff.', '`git show` shows the latest commit with its diff.')],
                check: c => c.ran(e => isGit(e, 'show') || (isGit(e, 'log') && e.args.some(a => a === '-p' || a === '--patch'))),
            },
        ],
        debrief: t(
            '- `git diff` vergleicht **Arbeitsverzeichnis ↔ Staging-Area** (was du noch nicht vorgemerkt hast)\n- `git diff --staged` vergleicht **Staging-Area ↔ letzter Commit** (was gleich gespeichert wird)\n- `git show` zeigt einen fertigen Commit\n\nZeilen mit `-` fallen weg, Zeilen mit `+` kommen dazu. Ein kurzer Blick vor jedem Commit verhindert, dass Tippfehler oder Testcode in der Geschichte landen.',
            '- `git diff` compares **working directory ↔ staging area** (what you have not staged yet)\n- `git diff --staged` compares **staging area ↔ last commit** (what is about to be saved)\n- `git show` shows a finished commit\n\nLines with `-` are removed, lines with `+` are added. A quick look before every commit keeps typos and test code out of the history.',
        ),
        learned: ['git diff', 'git diff --staged', 'git show'],
    },
    {
        id: 'g4',
        line: 'git',
        code: 'G4',
        title: t('Detektivarbeit', 'Detective work'),
        summary: t(
            'In der Geschichte suchen: Wer hat wann was geändert – und warum?',
            'Search the history: who changed what, when – and why?',
        ),
        story: d => t(
            `Ein Kunde beschwert sich: Auf der Website kostet eine Brezel **${d.badPrice} €**. Richtig wären ${d.goodPrice} €. Das Projekt hat schon eine Geschichte mit mehreren Leuten. Finde heraus, wann und von wem der Preis geändert wurde – und repariere ihn.`,
            `A customer complains: on the website a pretzel costs **€${d.badPrice}**. It should be €${d.goodPrice}. The project already has a history with several people. Find out when and by whom the price was changed – and fix it.`,
        ),
        async setup(kit) {
            kit.remember('goodPrice', de() ? '0,80' : '0.80');
            const bad = kit.remember('badPrice', de() ? '8,00' : '8.00');
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 6 });
            kit.at(3, '11:20');
            await kit.commitAs('alex', 'website', { files: { 'style.css': styleCss({ extra: '\nmain {\n    font-size: 1.1rem;\n}\n' }) }, message: msg(t('Schrift im Hauptteil vergrößert', 'Larger font in the main area')) });
            kit.at(2, '16:45');
            const badCommit = await kit.commitAs('sam', 'website', { files: { 'menu.html': menuHtml({ pretzel: bad }) }, message: msg(t('Preise aktualisiert', 'Update prices')) });
            kit.remember('badCommit', badCommit);
            kit.at(1, '08:05');
            await kit.commitAs('mia', 'website', { files: { 'contact.html': contactHtml({ phone: '0911 654321' }) }, message: msg(t('Neue Telefonnummer', 'New phone number')) });
            kit.later(90);
            await kit.commitAs('alex', 'website', { files: { 'style.css': styleCss({ extra: '\nmain {\n    font-size: 1.1rem;\n}\n\nfooter {\n    border-top: 1px solid #d8c8b0;\n}\n' }) }, message: msg(t('Trennlinie über dem Footer', 'Divider above the footer')) });
        },
        start: '~/website',
        objectives: [
            {
                text: t('Verschaffe dir einen Überblick: alle Commits, je eine Zeile.', 'Get an overview: all commits, one line each.'),
                hints: [
                    t('`git log` hat eine Option für die Kurzform.', '`git log` has an option for the short form.'),
                    t('`git log --oneline`', '`git log --oneline`'),
                ],
                check: c => c.ran(e => isGit(e, 'log') && e.args.some(a => a === '--oneline' || /^--(pretty|format)=oneline/.test(a))),
            },
            {
                text: t('Finde den Commit, der den Brezel-Preis geändert hat, und zeig ihn mit allen Details an.', 'Find the commit that changed the pretzel price and show it with all details.'),
                hints: [
                    t('Die Commit-Nachrichten verraten, welcher Commit Preise anfasst.', 'The commit messages reveal which commit touches prices.'),
                    t('`git show <hash>` zeigt einen Commit. Den Hash kopierst du aus der Log-Ausgabe – die ersten 7 Zeichen reichen. (Oder klick die Station in der Ansicht **Verlauf** an.)', '`git show <hash>` shows a commit. Copy the hash from the log output – the first 7 characters are enough. (Or click the station in the **History** view.)'),
                    d => t(`\`git show ${short(d.badCommit)}\``, `\`git show ${short(d.badCommit)}\``),
                ],
                check: async c => {
                    for (const e of c.commandsSince()) {
                        if (e.name === 'git' && e.args[0] === 'show' && await pointsAt(c, 'website', e.args.slice(1), c.data.badCommit)) return true;
                    }
                    return false;
                },
            },
            {
                text: t('Lass dir für `menu.html` zeigen, wer welche Zeile zuletzt geändert hat.', 'Show who last changed each line of `menu.html`.'),
                hints: [
                    t('Der Befehl heißt wie „jemandem die Schuld geben“ auf Englisch.', 'The command is named after "blaming" someone.'),
                    t('`git blame menu.html`', '`git blame menu.html`'),
                ],
                check: c => c.ran(e => isGit(e, 'blame') && e.args.some(a => a.endsWith('menu.html'))),
            },
            {
                text: d => t(`Korrigiere den Preis in \`menu.html\` wieder auf ${d.goodPrice} € und committe.`, `Fix the price in \`menu.html\` back to €${d.goodPrice} and commit.`),
                hints: [
                    t('Datei öffnen (Dateibaum oder `nano menu.html`), ändern, speichern – dann `git add` und `git commit`.', 'Open the file (file tree or `nano menu.html`), change it, save – then `git add` and `git commit`.'),
                    t('`git commit -am "Brezelpreis korrigiert"` – `-a` merkt alle geänderten, bekannten Dateien automatisch vor.', '`git commit -am "Fix pretzel price"` – `-a` stages all changed, tracked files automatically.'),
                ],
                // the pretzel line counts; 0,80 and 0.80 are both fine
                check: async c => {
                    const txt = await c.committedText('website', 'menu.html');
                    const line = txt?.split('\n').find(l => /Brezel|Pretzel/i.test(l));
                    return Boolean(line) && /(^|[^\d])0[.,]80([^\d]|$)/.test(line) && !/8[.,]00/.test(line);
                },
            },
        ],
        debrief: t(
            'Git vergisst nichts:\n\n- `git log --oneline` für den Überblick, `git log -p` mit allen Änderungen\n- `git show <hash>` für einen einzelnen Commit\n- `git blame <datei>` zeigt pro Zeile, wer sie zuletzt geändert hat\n\nDeshalb sind gute Commit-Nachrichten so wertvoll: „Preise aktualisiert“ verrät, *was* passiert ist – noch besser wäre auch *warum*. Und `blame` dient dem Verstehen, nicht dem Beschuldigen.',
            'Git forgets nothing:\n\n- `git log --oneline` for an overview, `git log -p` with all changes\n- `git show <hash>` for a single commit\n- `git blame <file>` shows who last changed each line\n\nThat is why good commit messages are valuable: "Update prices" tells *what* happened – even better would be *why*. And `blame` is for understanding, not for blaming.',
        ),
        learned: ['git log --oneline', 'git show <hash>', 'git blame <datei>', 'git commit -am "…"'],
    },
    {
        id: 'g5',
        line: 'git',
        code: 'G5',
        title: t('Fehler ausbügeln', 'Fixing mistakes'),
        summary: t(
            'Änderungen verwerfen, Vormerken zurücknehmen, Dateien ignorieren, den letzten Commit nachbessern.',
            'Discard changes, unstage, ignore files, amend the last commit.',
        ),
        story: d => t(
            `Ein typischer Freitagnachmittag: Du hast in \`style.css\` herumprobiert und alles verschlimmbessert. Außerdem hast du aus Versehen \`${d.creds}\` vorgemerkt – darin stehen Passwörter! Und dein letzter Commit hat einen Tippfehler in der Nachricht. Zum Glück ist noch nichts gepusht. Räum auf!`,
            `A typical Friday afternoon: you experimented in \`style.css\` and made everything worse. You also accidentally staged \`${d.creds}\` – it contains passwords! And your last commit has a typo in its message. Luckily nothing is pushed yet. Clean up!`,
        ),
        async setup(kit) {
            const creds = kit.remember('creds', de() ? 'zugangsdaten.txt' : 'credentials.txt');
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 3 });
            kit.at(0, '15:10');
            const typo = await kit.commit('website', { files: { 'index.html': indexHtml({ hours: de() ? 'Mo–Fr 7–18 Uhr, Sa 7–14 Uhr' : 'Mon–Fri 7am–6pm, Sat 7am–2pm' }) }, message: msg(t('Öffnungszeiten aktualsiert', 'Update opening hors')) });
            kit.remember('typoCommit', typo);
            kit.remember('typoWord', de() ? 'aktualsiert' : 'hors');
            kit.remember('newHours', de() ? 'Sa 7–14 Uhr' : 'Sat 7am–2pm');
            kit.now();
            await kit.files('website', {
                'style.css': styleCss({ accent: 'hotpink', extra: '\nbody {\n    font-family: "Comic Sans MS";\n    background: lime;\n}\n' }),
                [creds]: 'admin / Brezel123!\nftp: krume / Sauerteig2026\n',
            });
            await kit.sh('website', [`git add ${creds}`]);
        },
        start: '~/website',
        objectives: [
            {
                text: t('Verwirf deine Experimente in `style.css` – zurück zur letzten gespeicherten Version.', 'Discard your experiments in `style.css` – back to the last saved version.'),
                hints: [
                    t('`git status` nennt dir sogar den passenden Befehl („to discard changes …“).', '`git status` even tells you the right command ("to discard changes …").'),
                    t('`git restore style.css` – Achtung: Das lässt sich nicht rückgängig machen.', '`git restore style.css` – careful: this cannot be undone.'),
                ],
                check: async c => {
                    const w = await c.file('~/website/style.css');
                    const st = await c.status('website');
                    return w !== null && w === (await c.committedText('website', 'style.css')) && !st?.staged.some(s => s.path === 'style.css');
                },
            },
            {
                text: d => t(`Nimm \`${d.creds}\` aus der Staging-Area – die Datei selbst soll bleiben.`, `Take \`${d.creds}\` out of the staging area – the file itself should stay.`),
                hints: [
                    t('Auch hier hilft `git status` („to unstage …“).', '`git status` helps here too ("to unstage …").'),
                    d => t(`\`git restore --staged ${d.creds}\``, `\`git restore --staged ${d.creds}\``),
                ],
                check: async c => (await c.exists(`~/website/${c.data.creds}`)) && !(await c.tracked('website', c.data.creds)),
            },
            {
                text: d => t(`Sorg dafür, dass Git \`${d.creds}\` künftig gar nicht mehr anzeigt.`, `Make git stop showing \`${d.creds}\` at all.`),
                hints: [
                    t('Eine Datei namens `.gitignore` listet Dateien, die Git übersehen soll – ein Muster pro Zeile.', 'A file called `.gitignore` lists files git should ignore – one pattern per line.'),
                    d => t(`\`echo ${d.creds} >> .gitignore\``, `\`echo ${d.creds} >> .gitignore\``),
                ],
                check: async c => {
                    const st = await c.status('website');
                    return Boolean(st) && (await c.exists(`~/website/${c.data.creds}`)) && !(await c.tracked('website', c.data.creds)) && !st.untrackedFiles.includes(c.data.creds);
                },
            },
            {
                text: t('Korrigiere den Tippfehler in der Nachricht deines letzten Commits.', 'Fix the typo in the message of your last commit.'),
                hints: [
                    t('Den *letzten* Commit kann man nachbessern („amend“) – solange er noch nicht gepusht ist.', 'The *latest* commit can be amended – as long as it has not been pushed.'),
                    t('`git commit --amend -m "Öffnungszeiten aktualisiert"`', '`git commit --amend -m "Update opening hours"`'),
                ],
                // any message without the typo counts – as long as the change itself is still committed
                check: async c => {
                    const commits = await c.commits('website');
                    const typo = new RegExp(`\\b${c.data.typoWord}\\b`);
                    return commits.length > 0 && !commits.some(x => x.oid === c.data.typoCommit || typo.test(x.message))
                        && Boolean((await c.committedText('website', 'index.html'))?.includes(c.data.newHours));
                },
            },
            {
                text: t('Committe die `.gitignore`, damit das ganze Team davon profitiert.', 'Commit the `.gitignore` so the whole team benefits.'),
                hints: [t('`git add .gitignore` und `git commit -m ".gitignore für Zugangsdaten"`', '`git add .gitignore` and `git commit -m "Ignore credentials"`')],
                check: async c => Boolean((await c.committedText('website', '.gitignore'))?.includes(c.data.creds)),
            },
        ],
        debrief: t(
            'Deine Rettungsleinen:\n\n- `git restore <datei>` verwirft Änderungen im Arbeitsverzeichnis – **endgültig**\n- `git restore --staged <datei>` nimmt nur das Vormerken zurück, die Datei bleibt\n- `.gitignore` hält Dateien dauerhaft draußen (Passwörter, Logs, `node_modules/`)\n- `git commit --amend` bessert den letzten Commit nach\n\nWichtig: `--amend` ersetzt den Commit durch einen neuen (neuer Hash). Nur für Commits, die noch nicht gepusht sind!',
            'Your safety lines:\n\n- `git restore <file>` discards changes in the working directory – **for good**\n- `git restore --staged <file>` only unstages, the file stays\n- `.gitignore` keeps files out permanently (passwords, logs, `node_modules/`)\n- `git commit --amend` fixes up the latest commit\n\nImportant: `--amend` replaces the commit with a new one (new hash). Only for commits that are not pushed yet!',
        ),
        pitfalls: [
            {
                id: 'creds-deleted-staged',
                check: async c => !(await c.exists(`~/website/${c.data.creds}`)) && (await c.tracked('website', c.data.creds)),
                note: d => t(
                    `\`${d.creds}\` ist gelöscht – aber noch vorgemerkt. Die Staging-Area hat eine Kopie: \`git restore ${d.creds}\` holt die Datei von dort zurück.`,
                    `\`${d.creds}\` is deleted – but still staged. The staging area keeps a copy: \`git restore ${d.creds}\` brings the file back from there.`,
                ),
            },
            {
                id: 'creds-deleted',
                check: async c => !(await c.exists(`~/website/${c.data.creds}`)) && !(await c.tracked('website', c.data.creds)),
                note: d => t(
                    `\`${d.creds}\` ist weg – und Git hatte keine Kopie mehr. In echt wäre die Datei verloren. Hier hilft der Knopf **Rückgängig** oben.`,
                    `\`${d.creds}\` is gone – and git had no copy left. In real life the file would be lost. Here the **Undo** button at the top helps.`,
                ),
            },
            {
                id: 'hours-lost',
                check: async c => {
                    const commits = await c.commits('website');
                    if (commits.some(x => x.oid === c.data.typoCommit)) return false;
                    const committed = await c.committedText('website', 'index.html');
                    const work = await c.file('~/website/index.html');
                    return !committed?.includes(c.data.newHours) && !work?.includes(c.data.newHours);
                },
                note: t(
                    'Der letzte Commit ist weg – und mit ihm die neuen Öffnungszeiten. `git reset --hard` wirft Änderungen weg. Mit **Rückgängig** oben (oder `git reset --hard ORIG_HEAD`) holst du sie zurück; dann `git commit --amend`.',
                    'The last commit is gone – and with it the new opening hours. `git reset --hard` throws changes away. **Undo** at the top (or `git reset --hard ORIG_HEAD`) brings them back; then use `git commit --amend`.',
                ),
            },
        ],
        learned: ['git restore <datei>', 'git restore --staged <datei>', '.gitignore', 'git commit --amend'],
    },
    {
        id: 'g6',
        line: 'git',
        code: 'G6',
        title: t('Einen Commit zurücknehmen', 'Taking back a commit'),
        summary: t(
            'Einen alten Commit rückgängig machen, ohne die Geschichte umzuschreiben: `git revert`.',
            'Undo an old commit without rewriting history: `git revert`.',
        ),
        story: t(
            'Alex hat vorgestern ein „experimentelles Farbschema“ committet. Die Bäckerei findet es scheußlich. Danach hat Mia aber noch etwas Wichtiges committet, das bleiben muss. Nimm nur Alex’ Commit zurück – und zwar so, dass die Geschichte ehrlich bleibt.',
            'Two days ago Alex committed an "experimental colour scheme". The bakery hates it. Mia committed something important afterwards that has to stay. Take back only Alex\'s commit – in a way that keeps the history honest.',
        ),
        async setup(kit) {
            await kit.sh('website', ['git init -q']);
            await teamHistory(kit, 'website', { days: 5 });
            kit.remember('goodStyle', await kit.read('website/style.css'));
            kit.at(2, '17:30');
            const bad = await kit.commitAs('alex', 'website', { files: { 'style.css': styleCss({ accent: '#ff00ff', extra: '\nbody {\n    background: #111;\n    color: #0f0;\n}\n' }) }, message: msg(t('Neues Farbschema (experimentell)', 'New colour scheme (experimental)')) });
            kit.remember('badCommit', bad);
            kit.at(1, '09:40');
            kit.remember('miaCommit', await kit.commitAs('mia', 'website', { files: { 'menu.html': menuHtml().replace(/1,40|1\.40/, m => (m.includes(',') ? '1,50' : '1.50')) }, message: msg(t('Croissant-Preis angepasst', 'Adjust croissant price')) }));
        },
        pitfalls: [
            {
                id: 'history-rewritten',
                check: async c => !(await c.isAncestor('website', c.data.miaCommit, await c.refOid('website', 'HEAD'))),
                note: t(
                    'Mias Commit ist nicht mehr in deiner Geschichte – vermutlich durch `git reset`. Genau das soll hier nicht passieren. Hol ihn mit **Rückgängig** oben (oder `git reset --hard ORIG_HEAD`) zurück und nimm `git revert`.',
                    'Mia\'s commit is no longer in your history – probably because of `git reset`. That is exactly what must not happen here. Get it back with **Undo** at the top (or `git reset --hard ORIG_HEAD`) and use `git revert`.',
                ),
            },
        ],
        start: '~/website',
        objectives: [
            {
                text: t('Finde den Commit mit dem Farbschema.', 'Find the commit with the colour scheme.'),
                hints: [t('`git log --oneline`', '`git log --oneline`')],
                check: c => c.ran(e => isGit(e, 'log') || isGit(e, 'show')),
            },
            {
                text: t('Nimm genau diesen Commit zurück, ohne Commits zu löschen.', 'Take back exactly this commit without deleting any commits.'),
                hints: [
                    t('Gesucht ist ein Befehl, der einen *neuen* Commit erzeugt, der das Gegenteil des alten tut.', 'You want a command that creates a *new* commit doing the opposite of the old one.'),
                    d => t(`\`git revert ${short(d.badCommit)}\` – Git schlägt eine Nachricht vor; übernimm sie mit **Speichern**.`, `\`git revert ${short(d.badCommit)}\` – git suggests a message; accept it with **Save**.`),
                ],
                check: async c => {
                    const style = await c.committedText('website', 'style.css');
                    const head = await c.refOid('website', 'HEAD');
                    return style === c.data.goodStyle && head !== null && await c.isAncestor('website', c.data.badCommit, head);
                },
            },
            {
                text: t('Sieh dir die Geschichte an: Fehler und Korrektur stehen beide drin.', 'Look at the history: the mistake and its correction are both in it.'),
                hints: [t('`git log --oneline`', '`git log --oneline`')],
                check: c => c.ran(e => isGit(e, 'log')),
            },
        ],
        debrief: t(
            '`git revert <commit>` erzeugt einen neuen Commit, der die Änderungen des alten umkehrt. Nichts wird gelöscht – jeder kann nachvollziehen, was passiert ist.\n\nWarum nicht `git reset`? Reset verschiebt den Branch zurück und wirft damit Commits aus der Geschichte – auch Mias. Und wer die Commits schon hat, bekommt Probleme. Faustregel:\n\n- schon geteilt (gepusht) → `git revert`\n- nur bei dir → `git reset` ist in Ordnung',
            '`git revert <commit>` creates a new commit that reverses the changes of the old one. Nothing is deleted – everybody can see what happened.\n\nWhy not `git reset`? Reset moves the branch back and so throws commits out of the history – Mia\'s too. And whoever already has those commits gets into trouble. Rule of thumb:\n\n- already shared (pushed) → `git revert`\n- only on your machine → `git reset` is fine',
        ),
        learned: ['git revert <commit>'],
    },
];
