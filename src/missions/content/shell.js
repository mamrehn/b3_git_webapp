// Line S – the shell, for students who have never used a command line.
// File names follow the language the mission was started in; they are stored in
// the mission data (d) so texts and checks agree even if the language changes later.

import { t } from './common.js';
import { lang } from '../../core/i18n.js';

const de = () => lang() === 'de';

export const SHELL = [
    {
        id: 's1',
        line: 'shell',
        code: 'S1',
        title: t('Orientierung im Terminal', 'Finding your way around'),
        summary: t(
            'Wo bin ich, was liegt hier, wie komme ich woanders hin? Die drei Grundfragen jeder Kommandozeile.',
            'Where am I, what is here, how do I get somewhere else? The three basic questions of every command line.',
        ),
        story: t(
            'Ein Terminal ist ein Gespräch mit dem Computer: Du tippst einen Befehl, drückst **Enter**, und er antwortet. Gerade bist du in deinem [[path|Home-Ordner]] `~`. Dort liegen Unterlagen von deinem Praktikum bei der Bäckerei Krume. Sieh dich um!',
            'A terminal is a conversation with the computer: you type a command, press **Enter**, and it answers. Right now you are in your [[path|home folder]] `~`. It holds documents from your internship at Krume Bakery. Have a look around!',
        ),
        async setup(kit) {
            if (de()) {
                kit.remember('dir', 'praktikum');
                kit.remember('file', 'aufgaben.txt');
                await kit.files('~', {
                    'notizen/einkauf.txt': 'Mehl\nZucker\nHefe\nButter\n',
                    'notizen/ideen.txt': 'Website für die Bäckerei?\nOnline-Bestellung für Torten\n',
                    'praktikum/aufgaben.txt': 'Aufgaben im Praktikum\n=====================\n1. Brötchen zählen\n2. Website der Bäckerei verbessern\n\nDas Codewort lautet: Sauerteig\n',
                    'praktikum/bilder/README.txt': 'Hier kommen später die Fotos hin.\n',
                });
            } else {
                kit.remember('dir', 'internship');
                kit.remember('file', 'tasks.txt');
                await kit.files('~', {
                    'notes/shopping.txt': 'flour\nsugar\nyeast\nbutter\n',
                    'notes/ideas.txt': 'A website for the bakery?\nOnline orders for cakes\n',
                    'internship/tasks.txt': 'Internship tasks\n================\n1. Count the bread rolls\n2. Improve the bakery website\n\nThe password is: sourdough\n',
                    'internship/pictures/README.txt': 'Photos will go here later.\n',
                });
            }
        },
        start: '~',
        objectives: [
            {
                text: t('Finde heraus, in welchem Ordner du gerade bist.', 'Find out which folder you are in.'),
                hints: [
                    t('Der Befehl ist eine Abkürzung für *print working directory*.', 'The command is short for *print working directory*.'),
                    t('Tippe `pwd` und drück Enter.', 'Type `pwd` and press Enter.'),
                ],
                check: c => c.ran(/^pwd\b/, { ok: true }),
            },
            {
                text: t('Lass dir anzeigen, was in diesem Ordner liegt.', 'Show what is inside this folder.'),
                hints: [
                    t('Gesucht ist eine *Liste* – der Befehl hat nur zwei Buchstaben.', 'You want a *list* – the command has just two letters.'),
                    t('`ls`', '`ls`'),
                ],
                check: c => c.ran(/^(ls|ll|la|tree)\b/, { ok: true }),
            },
            {
                text: d => t(`Wechsle in den Ordner \`${d.dir}\`.`, `Change into the folder \`${d.dir}\`.`),
                hints: [
                    t('*change directory*, gefolgt vom Ordnernamen. Mit **Tab** vervollständigt das Terminal angefangene Namen.', '*change directory*, followed by the folder name. **Tab** completes names you have started typing.'),
                    d => t(`\`cd ${d.dir}\``, `\`cd ${d.dir}\``),
                ],
                check: c => c.cwdIs(`~/${c.data.dir}`),
            },
            {
                text: d => t(`Lies \`${d.file}\`. Darin steht ein Codewort.`, `Read \`${d.file}\`. It contains a password.`),
                hints: [
                    t('`cat` gibt den Inhalt einer Datei im Terminal aus.', '`cat` prints the contents of a file in the terminal.'),
                    d => t(`\`cat ${d.file}\``, `\`cat ${d.file}\``),
                ],
                check: c => c.ran(e => /^(cat|less|more|head|tail|nl|nano|vi|vim|edit|code)$/.test(e.name) && e.args.some(a => a.endsWith(c.data.file)), { ok: true }),
            },
            {
                text: t('Geh zurück in deinen Home-Ordner.', 'Go back to your home folder.'),
                hints: [
                    t('`..` ist immer der Ordner eine Ebene höher. `cd` ganz ohne Ziel führt nach Hause.', '`..` is always the folder one level up. `cd` without a target takes you home.'),
                    t('`cd ..` oder einfach `cd`', '`cd ..` or simply `cd`'),
                ],
                check: c => c.cwdIs('~'),
            },
        ],
        debrief: t(
            'Du bewegst dich jetzt im Dateisystem wie ein Profi:\n\n- `pwd` sagt, wo du bist\n- `ls` zeigt, was da ist (`ls -l` mit Details, `ls -a` auch versteckte Dateien)\n- `cd ordner` wechselt hinein, `cd ..` eine Ebene hoch, `cd` nach Hause\n- `cat datei` zeigt den Inhalt\n\nZwei Kniffe sparen viel Tipparbeit: **Tab** vervollständigt Namen, **↑** holt frühere Befehle zurück.',
            'You now move around the file system like a pro:\n\n- `pwd` tells you where you are\n- `ls` shows what is there (`ls -l` with details, `ls -a` including hidden files)\n- `cd folder` goes in, `cd ..` one level up, `cd` home\n- `cat file` shows the contents\n\nTwo tricks save a lot of typing: **Tab** completes names, **↑** brings back earlier commands.',
        ),
        learned: ['pwd', 'ls', 'cd', 'cd ..', 'cat'],
    },
    {
        id: 's2',
        line: 'shell',
        code: 'S2',
        title: t('Dateien und Ordner', 'Files and folders'),
        summary: t(
            'Ordner anlegen, Dateien erstellen, kopieren, umbenennen und löschen – ganz ohne Maus.',
            'Create folders and files, copy, rename and delete – without a mouse.',
        ),
        story: t(
            'Die Bäckerei braucht eine Website, und du legst die Grundstruktur an. In deinem Home-Ordner liegen schon ein Textentwurf, ein altes Stylesheet und etwas Müll.',
            'The bakery needs a website, and you set up its structure. Your home folder already holds a text draft, an old stylesheet and some junk.',
        ),
        async setup(kit) {
            const draft = kit.remember('draft', de() ? 'entwurf.txt' : 'draft.txt');
            const junk = kit.remember('junk', de() ? 'muell.tmp' : 'junk.tmp');
            await kit.files('~', {
                [draft]: de() ? 'Willkommen bei der Bäckerei Krume!\nFrisches Brot jeden Morgen.\n' : 'Welcome to Krume Bakery!\nFresh bread every morning.\n',
                'old.css': 'body { background: #fdf6e3; }\n',
                [junk]: 'xxxxxxxx\n',
            });
        },
        start: '~',
        objectives: [
            {
                text: t('Lege einen Ordner `website` an.', 'Create a folder called `website`.'),
                hints: [t('*make directory*', '*make directory*'), t('`mkdir website`', '`mkdir website`')],
                check: c => c.isDir('~/website'),
            },
            {
                text: t('Erstelle darin eine leere Datei `index.html`.', 'Create an empty file `index.html` inside it.'),
                hints: [
                    t('`touch` legt eine leere Datei an. Statt hineinzuwechseln kannst du den Pfad angeben: `ordner/datei`.', '`touch` creates an empty file. Instead of changing into the folder you can give a path: `folder/file`.'),
                    t('`touch website/index.html`', '`touch website/index.html`'),
                ],
                check: c => c.exists('~/website/index.html'),
            },
            {
                text: d => t(`Kopiere \`${d.draft}\` in den Ordner \`website\`.`, `Copy \`${d.draft}\` into the \`website\` folder.`),
                hints: [t('*copy*: `cp quelle ziel`', '*copy*: `cp source target`'), d => t(`\`cp ${d.draft} website/\``, `\`cp ${d.draft} website/\``)],
                check: async c => (await c.exists(`~/website/${c.data.draft}`)) && (await c.exists(`~/${c.data.draft}`)),
            },
            {
                text: t('Verschiebe `old.css` nach `website` und benenne sie dabei in `style.css` um.', 'Move `old.css` into `website`, renaming it to `style.css` on the way.'),
                hints: [
                    t('*move* verschiebt – und benennt um, wenn du einen neuen Namen angibst.', '*move* moves – and renames if you give a new name.'),
                    t('`mv old.css website/style.css`', '`mv old.css website/style.css`'),
                ],
                check: async c => (await c.exists('~/website/style.css')) && !(await c.exists('~/old.css')),
            },
            {
                text: d => t(`Lösche \`${d.junk}\`.`, `Delete \`${d.junk}\`.`),
                hints: [
                    t('*remove* – aber Vorsicht: Im Terminal gibt es keinen Papierkorb.', '*remove* – but careful: the terminal has no recycle bin.'),
                    d => t(`\`rm ${d.junk}\``, `\`rm ${d.junk}\``),
                ],
                check: async c => !(await c.exists(`~/${c.data.junk}`)),
            },
            {
                text: t('Schreib eine Überschrift in `website/index.html`.', 'Write a heading into `website/index.html`.'),
                hints: [
                    t('`echo text > datei` schreibt Text in eine Datei (und überschreibt sie). Oder öffne sie mit `nano` im Editor.', '`echo text > file` writes text into a file (overwriting it). Or open it in the editor with `nano`.'),
                    t('`echo "<h1>Bäckerei Krume</h1>" > website/index.html`', '`echo "<h1>Krume Bakery</h1>" > website/index.html`'),
                ],
                check: async c => Boolean((await c.file('~/website/index.html'))?.trim()),
            },
        ],
        debrief: t(
            'Anlegen, kopieren, verschieben, löschen – diese Handgriffe brauchst du ständig, auch mit Git:\n\n- `mkdir` Ordner, `touch` leere Datei\n- `cp quelle ziel` kopiert, `mv quelle ziel` verschiebt oder benennt um\n- `rm datei` löscht **endgültig**, `rm -r ordner` samt Inhalt\n- `echo text > datei` schreibt, `>>` hängt an\n\nGenau weil `rm` nichts verzeiht, gibt es Versionsverwaltung. Weiter geht es mit Git!',
            'Create, copy, move, delete – you will need these all the time, with git too:\n\n- `mkdir` folder, `touch` empty file\n- `cp source target` copies, `mv source target` moves or renames\n- `rm file` deletes **for good**, `rm -r folder` with its contents\n- `echo text > file` writes, `>>` appends\n\nPrecisely because `rm` is unforgiving, version control exists. On to git!',
        ),
        pitfalls: [
            {
                id: 'website-is-file',
                check: async c => (await c.exists('~/website')) && !(await c.isDir('~/website')),
                note: t(
                    '`website` ist jetzt eine **Datei**, kein Ordner – `cp` oder `mv` auf einen Namen, den es noch nicht gibt, legt eine Datei an. Lösche sie mit `rm website` und leg den Ordner mit `mkdir website` an.',
                    '`website` is now a **file**, not a folder – `cp` or `mv` to a name that does not exist yet creates a file. Delete it with `rm website` and create the folder with `mkdir website`.',
                ),
            },
            {
                id: 'draft-moved',
                check: async c => (await c.exists(`~/website/${c.data.draft}`)) && !(await c.exists(`~/${c.data.draft}`)),
                note: d => t(
                    `\`${d.draft}\` wurde verschoben statt kopiert – das Original ist weg. \`cp website/${d.draft} .\` legt wieder eine Kopie in deinen Home-Ordner (\`.\` heißt „hierher“).`,
                    `\`${d.draft}\` was moved instead of copied – the original is gone. \`cp website/${d.draft} .\` puts a copy back into your home folder (\`.\` means "here").`,
                ),
            },
        ],
        learned: ['mkdir <ordner>', 'touch <datei>', 'cp <quelle> <ziel>', 'mv <quelle> <ziel>', 'rm <datei>', 'echo "…" > <datei>', 'nano <datei>'],
    },
];
