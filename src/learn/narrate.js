// Turns "what changed" (events) into the coach's explanation of a command.
// All texts are bilingual objects so the journal can switch language at any time.

import { explainError } from './errors.js';
import { shortOid } from '../core/util.js';

const t = (de, en) => ({ de, en });

function list(files, lang, max = 4) {
    const shown = files.slice(0, max).map(f => `\`${f}\``);
    const rest = files.length - shown.length;
    const and = lang === 'de' ? 'und' : 'and';
    if (rest > 0) return `${shown.join(', ')} ${and} ${rest} ${lang === 'de' ? 'weitere' : 'more'}`;
    if (shown.length <= 1) return shown.join('');
    return `${shown.slice(0, -1).join(', ')} ${and} ${shown[shown.length - 1]}`;
}

function join(...parts) {
    const ok = parts.filter(Boolean);
    return { de: ok.map(p => p.de ?? p).join('\n\n'), en: ok.map(p => p.en ?? p).join('\n\n') };
}

function sentence(tpl) {
    // tpl: (lang) => string – helper for texts with interpolated bilingual parts
    return { de: tpl('de'), en: tpl('en') };
}

function pick(obj, lang) {
    return typeof obj === 'string' ? obj : obj?.[lang] ?? '';
}

// ---- notes: secondary events that are worth mentioning ---------------------------------------

function noteFor(e) {
    switch (e.type) {
        case 'changes-discarded':
            return { tone: 'danger', text: sentence(l => (l === 'de'
                ? `**Verworfen:** Die nicht committeten Änderungen an ${list(e.files, l)} sind weg. Git hatte sie nie gespeichert – es gibt keinen Weg zurück. (Nur hier in der Werkstatt hilft „Rückgängig“.)`
                : `**Discarded:** the uncommitted changes to ${list(e.files, l)} are gone. Git never stored them – there is no way back. (Only here in the Werkstatt, "Undo" helps.)`)) };
        case 'untracked-removed':
            return { tone: 'warn', text: sentence(l => (l === 'de'
                ? `${list(e.files, l)} ${e.files.length === 1 ? 'wurde' : 'wurden'} gelöscht. ${e.files.length === 1 ? 'Sie war' : 'Sie waren'} nie in einem Commit – Git kann ${e.files.length === 1 ? 'sie' : 'sie'} nicht wiederherstellen.`
                : `${list(e.files, l)} ${e.files.length === 1 ? 'was' : 'were'} deleted. ${e.files.length === 1 ? 'It was' : 'They were'} never committed – git cannot bring ${e.files.length === 1 ? 'it' : 'them'} back.`)) };
        case 'orphaned':
            return { tone: 'warn', text: sentence(l => (l === 'de'
                ? `**${e.oids.length === 1 ? '1 Commit hängt' : `${e.oids.length} Commits hängen`} jetzt an keinem Branch** (${e.oids.slice(0, 3).map(o => `\`${shortOid(o)}\``).join(', ')}). Gelöscht ist nichts: \`git reflog\` zeigt sie, \`git branch rettung ${shortOid(e.oids[0])}\` würde sie retten.`
                : `**${e.oids.length === 1 ? '1 commit is' : `${e.oids.length} commits are`} no longer on any branch** (${e.oids.slice(0, 3).map(o => `\`${shortOid(o)}\``).join(', ')}). Nothing is deleted: \`git reflog\` shows them, \`git branch rescue ${shortOid(e.oids[0])}\` would save them.`)) };
        case 'files-created':
            return { tone: 'info', text: sentence(l => (l === 'de'
                ? `Neu: ${list(e.files, l)} – für Git noch [[untracked|unversioniert]].`
                : `New: ${list(e.files, l)} – still [[untracked]] for git.`)) };
        case 'files-modified':
            return { tone: 'info', text: sentence(l => (l === 'de'
                ? `Geändert: ${list(e.files, l)} – die Änderung liegt bisher nur im [[workdir|Arbeitsverzeichnis]].`
                : `Changed: ${list(e.files, l)} – so far the change only exists in your [[workdir|working directory]].`)) };
        case 'files-deleted':
            return { tone: 'info', text: sentence(l => (l === 'de'
                ? `Gelöscht: ${list(e.files, l)}. Für Git ist das eine Änderung wie jede andere – mit \`git add\` oder \`git rm\` merkst du das Löschen vor.`
                : `Deleted: ${list(e.files, l)}. For git this is a change like any other – stage the deletion with \`git add\` or \`git rm\`.`)) };
        case 'upstream-set':
            return { tone: 'info', text: sentence(l => (l === 'de'
                ? `**${e.branch}** ist jetzt mit **${e.upstream}** verknüpft ([[upstream]]). Ab jetzt reichen \`git push\` und \`git pull\`.`
                : `**${e.branch}** is now linked to **${e.upstream}** ([[upstream]]). From now on \`git push\` and \`git pull\` are enough.`)) };
        default:
            return null;
    }
}

// ---- main ------------------------------------------------------------------------------------

export function narrate({ run, prev, next, events }) {
    const cmds = run.commands || [];
    const failed = cmds.find(c => c.status !== 0 && !isBenignFailure(c));
    const base = { line: run.line, time: Date.now(), highlight: highlightsFor(events) };
    if (failed) {
        const err = explainError(failed, run, next);
        if (err) return { ...base, tone: err.tone || 'error', key: `error:${err.key}`, title: err.title, body: err.body, more: err.more, notes: [] };
    }
    const gitCmds = cmds.filter(c => c.name === 'git' && c.info?.git?.sub);
    const main = gitCmds[gitCmds.length - 1];
    let entry = null;
    if (main) entry = gitNarration(main, events, prev, next, run);
    if (!entry) entry = shellNarration(cmds, events, prev, next);
    if (!entry) return null;
    const used = new Set(entry.consumed || []);
    const notes = events.filter(e => !used.has(e.type)).map(noteFor).filter(Boolean);
    // data loss notes go first, they matter most
    notes.sort((a, b) => (a.tone === 'danger' ? -1 : 0) - (b.tone === 'danger' ? -1 : 0));
    if (notes.some(x => x.tone === 'danger') && entry.tone !== 'error') entry.tone = 'danger';
    return { ...base, ...entry, notes };
}

function isBenignFailure(c) {
    if (c.name === 'grep' && c.status === 1) return true; // no match is not an error
    if (c.name === 'git' && c.info?.git?.sub === 'diff' && c.status === 1) return true;
    if (c.name === 'false' || c.name === 'test') return true;
    return false;
}

function highlightsFor(events) {
    const h = { files: [], commits: [], branches: [] };
    for (const e of events) {
        if (e.files) h.files.push(...e.files.map(f => f.path || f));
        if (e.type === 'commits') h.commits.push(...e.commits.map(c => c.oid));
        if (e.type === 'branch-created' || e.type === 'branch-moved') h.branches.push(e.name);
    }
    return h;
}

const find = (events, type) => events.find(e => e.type === type);
const all = (events, type) => events.filter(e => e.type === type);

// ---- shell commands ----------------------------------------------------------------------------

function shellNarration(cmds, events, prev, next) {
    const last = cmds[cmds.length - 1];
    if (!last) return null;
    const cwd = find(events, 'cwd');
    if (cwd) {
        const intoRepo = cwd.enteredRepo;
        return {
            key: 'cd', tone: 'info', consumed: ['cwd'],
            title: t(`Du bist jetzt in \`${cwd.to}\``, `You are now in \`${cwd.to}\``),
            body: intoRepo
                ? t(`Dieser Ordner gehört zum [[repository|Repository]] **${intoRepo}** (er enthält \`.git\`). Git-Befehle beziehen sich ab jetzt darauf.`,
                    `This folder belongs to the [[repository]] **${intoRepo}** (it contains \`.git\`). Git commands now work on it.`)
                : cwd.leftRepo
                    ? t(`Du hast das Repository **${cwd.leftRepo}** verlassen. Hier gibt es kein \`.git\` – Git-Befehle melden „not a git repository“.`,
                        `You left the repository **${cwd.leftRepo}**. There is no \`.git\` here – git commands will report "not a git repository".`)
                    : t('`pwd` zeigt jederzeit, wo du bist; `ls` zeigt, was hier liegt.', '`pwd` always shows where you are; `ls` shows what is here.'),
        };
    }
    const fileEvents = events.filter(e => ['files-created', 'files-modified', 'files-deleted', 'untracked-removed'].includes(e.type));
    const name = last.name;
    const SIMPLE = {
        ls: t('`ls` listet den Inhalt des Ordners. Versteckte Einträge (beginnen mit `.`, z. B. `.git`) zeigt `ls -a`.', '`ls` lists the folder. Hidden entries (starting with `.`, like `.git`) need `ls -a`.'),
        ll: t('`ll` ist eine Abkürzung für `ls -la`: alles, auch Verstecktes, mit Details.', '`ll` is short for `ls -la`: everything, including hidden entries, with details.'),
        pwd: t('`pwd` = „print working directory“: der [[path|Pfad]] des Ordners, in dem du gerade bist.', '`pwd` = "print working directory": the [[path]] of the folder you are in.'),
        cat: t('`cat` gibt Dateien vollständig aus. Für lange Dateien ist `less` angenehmer (q beendet).', '`cat` prints whole files. For long files `less` is nicer (q quits).'),
        clear: null,
        history: t('Das sind deine letzten Befehle. `!12` führt Befehl 12 erneut aus, ↑ blättert zurück, Strg+R sucht.', 'These are your recent commands. `!12` runs command 12 again, ↑ goes back, Ctrl+R searches.'),
        help: t('Das ist die Befehlsübersicht. Zu jedem Befehl gibt es mehr mit `man <befehl>` oder `<befehl> --help`.', 'That is the command overview. More about each command: `man <command>` or `<command> --help`.'),
        echo: t('`echo` gibt Text aus. Mit `>` landet er in einer Datei (überschreibt sie), mit `>>` wird angehängt.', '`echo` prints text. With `>` it goes into a file (overwriting it), with `>>` it is appended.'),
        nano: t('Gespeichert wird mit **Strg+S**, geschlossen mit **Esc**. Erst nach dem Speichern sieht Git die Änderung.', 'Save with **Ctrl+S**, close with **Esc**. Git only sees the change once it is saved.'),
        mkdir: t('`mkdir` legt einen Ordner an. Hinein kommst du mit `cd <ordner>`. `mkdir -p a/b/c` legt auch alle Zwischenordner an.', '`mkdir` creates a folder. `cd <folder>` takes you into it. `mkdir -p a/b/c` also creates all folders in between.'),
        touch: t('`touch` legt eine leere Datei an. Gibt es die Datei schon, ändert sich nur ihr Zeitstempel.', '`touch` creates an empty file. If the file already exists, only its timestamp changes.'),
        cp: t('`cp quelle ziel` kopiert. Ist das Ziel ein vorhandener Ordner, landet die Kopie darin – sonst entsteht eine Datei mit dem neuen Namen. Ordner kopierst du mit `cp -r`.', '`cp source target` copies. If the target is an existing folder, the copy goes inside it – otherwise a file with the new name is created. Folders need `cp -r`.'),
        mv: t('`mv quelle ziel` verschiebt – oder benennt um, wenn das Ziel ein neuer Name ist. Das Original gibt es danach nicht mehr.', '`mv source target` moves – or renames, if the target is a new name. The original no longer exists afterwards.'),
        rm: t('`rm` löscht **endgültig** – im Terminal gibt es keinen Papierkorb. Ordner löscht `rm -r`. Was in Git committet ist, holt `git restore` zurück.', '`rm` deletes **for good** – the terminal has no recycle bin. `rm -r` deletes folders. Whatever is committed in git can be brought back with `git restore`.'),
        rmdir: t('`rmdir` löscht einen **leeren** Ordner. Für Ordner mit Inhalt: `rm -r`.', '`rmdir` deletes an **empty** folder. For folders with contents: `rm -r`.'),
        less: t('`less` zeigt lange Texte seitenweise: Leertaste blättert, `/wort` sucht, **q** beendet.', '`less` shows long texts page by page: space scrolls, `/word` searches, **q** quits.'),
        head: t('`head` zeigt die ersten Zeilen einer Datei (`-n 5` für fünf).', '`head` shows the first lines of a file (`-n 5` for five).'),
        tail: t('`tail` zeigt die letzten Zeilen einer Datei (`-n 5` für fünf).', '`tail` shows the last lines of a file (`-n 5` for five).'),
        grep: t('`grep muster datei` zeigt alle Zeilen, die das Muster enthalten. `-i` ignoriert Groß-/Kleinschreibung, `-r` sucht in Ordnern.', '`grep pattern file` shows all lines containing the pattern. `-i` ignores case, `-r` searches folders.'),
        tree: t('`tree` zeigt Ordner und Dateien als Baum – wie die Dateiliste links.', '`tree` shows folders and files as a tree – like the file list on the left.'),
    };
    if (fileEvents.length) {
        return {
            key: `shell-files:${name}`, tone: 'info', consumed: fileEvents.map(e => e.type),
            title: t('Dateien verändert', 'Files changed'),
            body: join(...fileEvents.map(e => noteFor(e)?.text)),
        };
    }
    const text = SIMPLE[name];
    if (text === null || text === undefined) return null;
    return { key: `shell:${name}`, tone: 'info', title: t(`\`${name}\``, `\`${name}\``), body: text, compact: true };
}

// ---- git subcommands -------------------------------------------------------------------------------

function gitNarration(cmd, events, prev, next, run) {
    const sub = cmd.info.git.sub;
    const info = cmd.info;
    const repo = next.repo;
    const fn = GIT[sub];
    if (!fn) return null;
    return fn({ cmd, info, events, prev, next, repo, run });
}

const GIT = {
    init({ info }) {
        const i = info.init || {};
        const warnings = [];
        if (i.nestedIn) {
            warnings.push(t(`**Achtung:** Du bist bereits im Repository \`${i.nestedIn}\`. Ein Repository in einem Repository ist fast nie gewollt. Lösche ggf. den neuen \`.git\`-Ordner wieder (\`rm -rf .git\`).`,
                `**Careful:** you are already inside the repository \`${i.nestedIn}\`. A repository inside a repository is almost never intended. Consider removing the new \`.git\` folder again (\`rm -rf .git\`).`));
        }
        if (i.inHome) {
            warnings.push(t('**Achtung:** Du hast dein ganzes Home-Verzeichnis zum Repository gemacht. Besser: einen Projektordner anlegen (`mkdir projekt && cd projekt`) und dort `git init`.',
                '**Careful:** you turned your whole home directory into a repository. Better: create a project folder (`mkdir project && cd project`) and run `git init` there.'));
        }
        if (i.existed) {
            return { key: 'init-again', tone: 'info', title: t('Repository war schon da', 'Repository already existed'),
                body: t('Hier gibt es bereits ein `.git`. „Reinitialized“ heißt: Git hat nichts gelöscht, die Geschichte ist unverändert.', "There already is a `.git` here. 'Reinitialized' means git deleted nothing; the history is unchanged.") };
        }
        return {
            key: 'init', tone: warnings.length ? 'warn' : 'ok',
            title: t('Neues Repository angelegt', 'New repository created'),
            body: join(t(`Git hat den versteckten Ordner \`.git\` angelegt (sichtbar mit \`ls -a\`). Darin speichert Git ab jetzt die ganze Geschichte. Der erste Branch heißt **${i.branch || 'main'}** – er hat aber noch keine Commits.`,
                `Git created the hidden folder \`.git\` (see it with \`ls -a\`). From now on git keeps the whole history there. The first branch is **${i.branch || 'main'}** – it has no commits yet.`), ...warnings),
            more: t('So geht es weiter: Dateien anlegen oder bearbeiten → `git add <datei>` (vormerken) → `git commit -m "Nachricht"` (speichern).', 'Next: create or edit files → `git add <file>` (stage) → `git commit -m "message"` (save).'),
        };
    },

    status({ repo }) {
        if (!repo) return null;
        const st = repo.status;
        const lines = [];
        if (st.conflicts.length) lines.push(sentence(l => (l === 'de' ? `**Konflikte:** ${list(st.conflicts.map(c => c.path), l)} – bearbeiten, dann \`git add\`.` : `**Conflicts:** ${list(st.conflicts.map(c => c.path), l)} – edit, then \`git add\`.`)));
        if (st.staged.length) lines.push(sentence(l => (l === 'de' ? `**Vorgemerkt** (kommt in den nächsten Commit): ${list(st.staged.map(s => s.path), l)}` : `**Staged** (goes into the next commit): ${list(st.staged.map(s => s.path), l)}`)));
        if (st.unstaged.length) lines.push(sentence(l => (l === 'de' ? `**Geändert, nicht vorgemerkt:** ${list(st.unstaged.map(s => s.path), l)}` : `**Changed, not staged:** ${list(st.unstaged.map(s => s.path), l)}`)));
        if (st.untracked.length) lines.push(sentence(l => (l === 'de' ? `**Unversioniert** (Git kennt sie nicht): ${list(st.untracked, l)}` : `**Untracked** (unknown to git): ${list(st.untracked, l)}`)));
        const title = st.clean
            ? (repo.head.unborn ? t('Leeres Repository – noch keine Commits', 'Empty repository – no commits yet') : t('Alles gespeichert', 'Everything is committed'))
            : t('Das hat sich seit dem letzten Commit getan', 'What changed since the last commit');
        const body = st.clean
            ? (repo.head.unborn
                ? t('Lege eine Datei an (z. B. `echo "# Projekt" > README.md`) und merke sie mit `git add` vor.', 'Create a file (e.g. `echo "# Project" > README.md`) and stage it with `git add`.')
                : t('Arbeitsverzeichnis und Staging-Area stimmen mit dem letzten [[commit|Commit]] überein. Ändere eine Datei, um weiterzumachen.', 'Working directory and staging area match the last [[commit]]. Change a file to continue.'))
            : { de: lines.map(x => '- ' + x.de).join('\n'), en: lines.map(x => '- ' + x.en).join('\n') };
        return {
            key: 'status', tone: st.conflicts.length ? 'warn' : 'info', title, body,
            more: t('`git status` liest du von oben nach unten: grün = vorgemerkt, rot = nur im Arbeitsverzeichnis geändert oder unversioniert. Die Zeilen in Klammern sagen dir die passenden Befehle. Kurzform: `git status -s`.',
                '`git status` reads top to bottom: green = staged, red = changed only in the working directory or untracked. The lines in brackets tell you the matching commands. Short form: `git status -s`.'),
        };
    },

    add({ info, events, repo }) {
        const staged = find(events, 'staged');
        const resolved = find(events, 'conflict-resolved');
        if (info.nothingSpecified) {
            return { key: 'add-empty', tone: 'warn', title: t('Was soll vorgemerkt werden?', 'What should be staged?'),
                body: t('`git add` braucht Dateinamen. `git add datei.txt` merkt eine Datei vor, `git add .` alles im aktuellen Ordner.', '`git add` needs file names. `git add file.txt` stages one file, `git add .` everything in the current folder.') };
        }
        if (resolved) {
            const markers = info.markersLeft || [];
            return {
                key: 'add-resolve', tone: markers.length ? 'danger' : 'ok', consumed: ['staged', 'conflict-resolved'],
                title: t(`Konflikt als gelöst markiert`, 'Conflict marked as resolved'),
                body: join(
                    sentence(l => (l === 'de' ? `${list(resolved.files, l)} ${resolved.files.length === 1 ? 'gilt' : 'gelten'} jetzt als gelöst.` : `${list(resolved.files, l)} ${resolved.files.length === 1 ? 'is' : 'are'} now marked as resolved.`)),
                    markers.length ? sentence(l => (l === 'de' ? `**Achtung:** In ${list(markers, l)} stehen noch Konfliktmarker (\`<<<<<<<\`). Git prüft das nicht! Entferne sie, speichere und führe \`git add\` noch einmal aus.` : `**Careful:** ${list(markers, l)} still contains conflict markers (\`<<<<<<<\`). Git does not check this! Remove them, save and run \`git add\` again.`)) : null,
                    resolved.remaining.length ? sentence(l => (l === 'de' ? `Noch offen: ${list(resolved.remaining, l)}.` : `Still open: ${list(resolved.remaining, l)}.`))
                        : !repo?.op
                            // a conflict from `git stash pop/apply`: nothing to finish, but the entry is still there
                            ? t('Alle Konflikte gelöst – die Änderungen aus dem Stash sind eingebaut. Der Stash-Eintrag ist aber noch da: `git stash drop` löscht ihn.', 'All conflicts resolved – the stashed changes are in place. The stash entry is still there, though: `git stash drop` removes it.')
                            : t('Alle Konflikte gelöst – schließe mit `git commit` ab (bei einem Rebase: `git rebase --continue`).', 'All conflicts resolved – finish with `git commit` (during a rebase: `git rebase --continue`).'),
                ),
            };
        }
        if (!staged) {
            return { key: 'add-nothing', tone: 'info', title: t('Nichts Neues vorzumerken', 'Nothing new to stage'),
                body: t('Die Dateien waren schon vorgemerkt oder unverändert. `git status` zeigt den Stand.', 'The files were already staged or unchanged. `git status` shows the state.') };
        }
        const fl = staged.files.map(f => f.path);
        return {
            key: 'add', tone: 'ok', consumed: ['staged'],
            title: fl.length === 1 ? t(`\`${fl[0]}\` ist vorgemerkt`, `\`${fl[0]}\` is staged`) : t(`${fl.length} Dateien vorgemerkt`, `${fl.length} files staged`),
            body: sentence(l => (l === 'de'
                ? `Git hat sich die aktuelle Fassung von ${list(fl, l)} in der [[staging|Staging-Area]] gemerkt. Genau diese Fassung kommt in den nächsten Commit. Änderst du die Datei jetzt noch einmal, musst du sie erneut mit \`git add\` vormerken.`
                : `Git stored the current version of ${list(fl, l)} in the [[staging|staging area]]. Exactly this version goes into the next commit. If you change the file again now, stage it again with \`git add\`.`)),
            more: t('Warum dieser Zwischenschritt? So kannst du entscheiden, welche Änderungen zusammen in einen Commit gehören – auch wenn du an mehreren Dingen gleichzeitig arbeitest.', 'Why this extra step? It lets you choose which changes belong together in one commit – even when you work on several things at once.'),
        };
    },

    commit({ info, events, repo }) {
        if (info.nothingToCommit) return null; // handled as error
        const c = find(events, 'commits');
        if (!c) return null;
        const commit = c.commits[c.commits.length - 1];
        const meta = info.commit || {};
        const leftovers = repo.status.unstaged.map(u => u.path).concat(repo.status.untrackedFiles);
        const branch = repo.head.branch;
        const body = [];
        if (meta.amend) {
            body.push(t(`Der letzte Commit wurde **ersetzt**: neuer Inhalt bzw. neue Nachricht, neue ID \`${shortOid(commit.oid)}\`. Der alte Commit steht nur noch im [[reflog|Reflog]]. Nie Commits ändern, die schon gepusht sind!`,
                `The last commit was **replaced**: new content or message, new id \`${shortOid(commit.oid)}\`. The old commit only remains in the [[reflog]]. Never amend commits that are already pushed!`));
        } else if (meta.merge) {
            body.push(t('Das ist ein **Merge-Commit** mit zwei Eltern – die Zusammenführung ist damit abgeschlossen.', 'This is a **merge commit** with two parents – the merge is complete.'));
        } else {
            body.push(sentence(l => (l === 'de'
                ? `Git hat einen dauerhaften Schnappschuss gespeichert: „${commit.subject}“ (ID \`${shortOid(commit.oid)}\`). ${branch ? `Der Branch **${branch}** zeigt jetzt auf diesen Commit.` : 'Achtung: Du bist auf keinem Branch (losgelöster HEAD).'}`
                : `Git saved a permanent snapshot: "${commit.subject}" (id \`${shortOid(commit.oid)}\`). ${branch ? `The branch **${branch}** now points to this commit.` : 'Careful: you are not on a branch (detached HEAD).'}`)));
            if (!commit.parents.length) body.push(t('Es ist der **erste Commit** (root commit) – der Anfang der Geschichte dieses Projekts.', 'It is the **first commit** (root commit) – the start of this project\'s history.'));
        }
        if (leftovers.length) {
            body.push(sentence(l => (l === 'de'
                ? `**Nicht im Commit:** ${list(leftovers, l)} – ${leftovers.length === 1 ? 'diese Datei war' : 'diese Dateien waren'} nicht vorgemerkt.`
                : `**Not in the commit:** ${list(leftovers, l)} – ${leftovers.length === 1 ? 'it was' : 'they were'} not staged.`)));
        }
        return {
            key: meta.amend ? 'commit-amend' : meta.merge ? 'commit-merge' : 'commit',
            tone: 'ok', consumed: ['commits', 'branch-moved', 'branch-created', 'orphaned'].filter(x => meta.amend || x !== 'orphaned'),
            title: meta.amend ? t('Commit ersetzt (amend)', 'Commit replaced (amend)') : t(`Commit \`${shortOid(commit.oid)}\` gespeichert`, `Commit \`${shortOid(commit.oid)}\` saved`),
            body: join(...body),
            more: t('Ein [[commit|Commit]] ist wie ein Foto aller versionierten Dateien. Die Staging-Area gleicht danach wieder dem neuen Commit – sie ist „leer“, bis du wieder etwas vormerkst. Gute Nachrichten beschreiben in einer Zeile, *was* und *warum*.',
                'A [[commit]] is like a photo of all tracked files. Afterwards the staging area matches the new commit again – it is "empty" until you stage something. Good messages say in one line *what* and *why*.'),
        };
    },

    log({ info }) {
        const l = info.log || {};
        return {
            key: l.graph ? 'log-graph' : 'log', tone: 'info', compact: true,
            title: t(`Geschichte: ${l.count} Commit${l.count === 1 ? '' : 's'}`, `History: ${l.count} commit${l.count === 1 ? '' : 's'}`),
            body: l.oneline || l.graph
                ? t('Jede Zeile ist ein Commit: [[hash|ID]] und Nachricht; oben der neueste. In Klammern steht, welche [[branch|Branches]] und [[head|HEAD]] auf den Commit zeigen.', 'Each line is a commit: [[hash|id]] and message; newest on top. The brackets show which [[branch|branches]] and [[head|HEAD]] point to it.')
                : t('Oben steht der neueste Commit: [[hash|ID]], Autor, Datum, Nachricht. Kompakter: `git log --oneline`; mit allen Branches als Grafik: `git log --oneline --graph --all`.', 'The newest commit is on top: [[hash|id]], author, date, message. More compact: `git log --oneline`; all branches as a graph: `git log --oneline --graph --all`.'),
        };
    },

    diff({ info }) {
        const d = info.diff || {};
        const empty = !d.files?.length;
        const what = {
            worktree: t('zwischen Arbeitsverzeichnis und Staging-Area – also was du **noch nicht** vorgemerkt hast', 'between working directory and staging area – what you have **not yet** staged'),
            staged: t('zwischen letztem Commit und Staging-Area – also was der **nächste Commit** enthält', 'between the last commit and the staging area – what the **next commit** contains'),
            commits: t('zwischen zwei Commits', 'between two commits'),
            'commit-worktree': t('zwischen einem Commit und deinem Arbeitsverzeichnis', 'between a commit and your working directory'),
        }[d.mode] || t('', '');
        return {
            key: `diff-${d.mode}`, tone: 'info', compact: !empty,
            title: empty ? t('Keine Unterschiede', 'No differences') : t('Unterschiede Zeile für Zeile', 'Differences line by line'),
            body: empty
                ? (d.mode === 'worktree'
                    ? t('Keine Ausgabe heißt: nichts Unvorgemerktes. Vorgemerkte Änderungen zeigt `git diff --staged`.', 'No output means: nothing unstaged. Staged changes are shown by `git diff --staged`.')
                    : t('Die verglichenen Stände sind gleich.', 'The compared versions are identical.'))
                : sentence(l => (l === 'de' ? `Verglichen wird ${what.de}. Zeilen mit **+** kamen hinzu, mit **−** fielen weg; \`@@ -3,4 +3,5 @@\` sagt, wo im Text das ist.` : `This compares ${what.en}. Lines with **+** were added, lines with **−** removed; \`@@ -3,4 +3,5 @@\` tells you where in the file.`)),
        };
    },

    show() {
        return { key: 'show', tone: 'info', compact: true, title: t('Commit im Detail', 'Commit in detail'),
            body: t('Oben die Daten des Commits, darunter seine Änderungen als Diff (+ hinzugefügt, − entfernt).', 'On top the commit data, below its changes as a diff (+ added, − removed).') };
    },

    restore({ info, events }) {
        const mode = info.mode || {};
        const discarded = find(events, 'changes-discarded');
        if (mode.staged && !mode.worktree) {
            return { key: 'restore-staged', tone: 'ok', consumed: ['unstaged'],
                title: t('Nicht mehr vorgemerkt', 'No longer staged'),
                body: sentence(l => (l === 'de'
                    ? `${list(info.restored || [], l)} ${info.restored?.length === 1 ? 'ist' : 'sind'} aus der Staging-Area genommen. Deine Änderungen in der Datei bleiben erhalten – sie kommen nur nicht in den nächsten Commit.`
                    : `${list(info.restored || [], l)} ${info.restored?.length === 1 ? 'was' : 'were'} taken out of the staging area. Your changes in the file are kept – they just won't go into the next commit.`)) };
        }
        return { key: 'restore', tone: discarded ? 'danger' : 'ok', consumed: ['changes-discarded'],
            title: t('Datei zurückgesetzt', 'File restored'),
            body: join(sentence(l => (l === 'de'
                ? `${list(info.restored || [], l)} ${info.restored?.length === 1 ? 'hat' : 'haben'} wieder den Stand ${mode.source ? `von \`${mode.source}\`` : 'der Staging-Area (bzw. des letzten Commits)'}.`
                : `${list(info.restored || [], l)} ${info.restored?.length === 1 ? 'is' : 'are'} back to the version ${mode.source ? `from \`${mode.source}\`` : 'in the staging area (or the last commit)'}.`)),
            discarded ? noteFor(discarded).text : null) };
    },

    rm({ info }) {
        return { key: info.cached ? 'rm-cached' : 'rm', tone: 'ok',
            title: info.cached ? t('Nicht mehr versioniert', 'No longer tracked') : t('Gelöscht und Löschen vorgemerkt', 'Deleted and deletion staged'),
            body: info.cached
                ? t('Die Datei bleibt auf der Platte, Git verfolgt sie nach dem nächsten Commit aber nicht mehr. Damit sie nicht wieder auftaucht: in `.gitignore` eintragen.', 'The file stays on disk, but git stops tracking it after the next commit. To keep it from showing up again, add it to `.gitignore`.')
                : t('Die Datei ist weg und das Löschen ist vorgemerkt. Mit dem nächsten Commit verschwindet sie auch aus der Geschichte „ab jetzt“ – ältere Commits enthalten sie weiter.', 'The file is gone and the deletion is staged. With the next commit it disappears from now on – older commits still contain it.') };
    },

    mv() {
        return { key: 'mv', tone: 'ok', title: t('Umbenannt und vorgemerkt', 'Renamed and staged'),
            body: t('`git mv` verschiebt die Datei und merkt die Umbenennung gleich vor. `git status` zeigt sie als „renamed“.', '`git mv` moves the file and stages the rename right away. `git status` shows it as "renamed".') };
    },

    branch({ info, events, repo }) {
        const created = find(events, 'branch-created');
        if (created) {
            return { key: 'branch-create', tone: 'ok', consumed: ['branch-created'],
                title: t(`Branch **${created.name}** angelegt`, `Branch **${created.name}** created`),
                body: t(`Ein [[branch|Branch]] ist nur ein Zeiger auf einen Commit – **${created.name}** zeigt auf \`${shortOid(created.oid)}\`, genau wie dein aktueller Stand. Du bist aber noch auf **${repo.head.branch || 'HEAD'}**. Wechseln: \`git switch ${created.name}\`.`,
                    `A [[branch]] is just a pointer to a commit – **${created.name}** points to \`${shortOid(created.oid)}\`, the same as your current state. But you are still on **${repo.head.branch || 'HEAD'}**. Switch with \`git switch ${created.name}\`.`) };
        }
        const deleted = all(events, 'branch-deleted');
        if (deleted.length) {
            return { key: 'branch-delete', tone: 'ok', consumed: ['branch-deleted', 'orphaned'],
                title: t(`Branch gelöscht`, 'Branch deleted'),
                body: sentence(l => (l === 'de'
                    ? `${list(deleted.map(d => d.name), l)} ${deleted.length === 1 ? 'ist' : 'sind'} weg – nur der Name. Die Commits bleiben erhalten, solange ein anderer Branch sie enthält (sonst sind sie noch eine Weile im Reflog).`
                    : `${list(deleted.map(d => d.name), l)} ${deleted.length === 1 ? 'is' : 'are'} gone – just the name. The commits stay as long as another branch contains them (otherwise they remain in the reflog for a while).`)) };
        }
        if (info.renamed) {
            return { key: 'branch-rename', tone: 'ok', title: t('Branch umbenannt', 'Branch renamed'), body: t(`**${info.renamed.from}** heißt jetzt **${info.renamed.to}**.`, `**${info.renamed.from}** is now called **${info.renamed.to}**.`) };
        }
        return { key: 'branch-list', tone: 'info', compact: true, title: t('Deine Branches', 'Your branches'),
            body: t('Der `*` markiert den Branch, auf dem du bist ([[head|HEAD]]). Neuer Branch: `git branch name`, wechseln: `git switch name`.', 'The `*` marks the branch you are on ([[head|HEAD]]). New branch: `git branch name`, switch: `git switch name`.') };
    },

    switch: switchNarration,
    checkout(ctx) {
        if (ctx.info.restoredFiles) {
            const discarded = find(ctx.events, 'changes-discarded');
            return { key: 'checkout-files', tone: discarded ? 'danger' : 'ok', consumed: ['changes-discarded'],
                title: t('Dateien zurückgeholt', 'Files restored'),
                body: join(t('`git checkout -- datei` holt die Datei aus der Staging-Area (bzw. einem Commit) zurück. Heute nimmt man dafür meist `git restore datei` – das ist eindeutiger.', '`git checkout -- file` restores the file from the staging area (or a commit). Today `git restore file` is preferred – it is clearer.'), discarded ? noteFor(discarded).text : null) };
        }
        return switchNarration(ctx);
    },

    merge({ info, events, repo }) {
        const m = info.merge || {};
        if (info.mergeAborted) {
            return { key: 'merge-abort', tone: 'ok', consumed: ['operation-finished', 'changes-discarded'], title: t('Merge abgebrochen', 'Merge aborted'),
                body: t('Alles ist wieder wie vor dem `git merge`. Die Konflikte sind verworfen.', 'Everything is back to before `git merge`. The conflicts are gone.') };
        }
        if (m.result === 'up-to-date') {
            return { key: 'merge-uptodate', tone: 'info', title: t('Schon zusammengeführt', 'Already merged'),
                body: t('Alle Commits des anderen Branches sind bereits in deinem enthalten – es gibt nichts zu tun.', 'All commits of the other branch are already in yours – there is nothing to do.') };
        }
        if (m.result === 'fast-forward') {
            return { key: 'merge-ff', tone: 'ok', consumed: ['branch-moved'],
                title: t('Fast-Forward', 'Fast-forward'),
                body: t(`**${repo.head.branch}** hatte keine eigenen neuen Commits. Darum hat Git den Branch einfach nach vorne geschoben ([[fast-forward]]) – es entsteht kein Merge-Commit. Die Dateien sind jetzt auf dem neuen Stand.`,
                    `**${repo.head.branch}** had no new commits of its own, so git simply moved the branch forward ([[fast-forward]]) – no merge commit is needed. Your files are now up to date.`) };
        }
        if (m.result === 'merge-commit') {
            return { key: 'merge-commit', tone: 'ok', consumed: ['commits', 'branch-moved'],
                title: t('Zusammengeführt (Merge-Commit)', 'Merged (merge commit)'),
                body: t(`Beide Seiten hatten eigene Commits. Git hat die Änderungen automatisch kombiniert und einen [[merge|Merge-Commit]] mit zwei Eltern angelegt. In der Grafik siehst du, wie die Linien zusammenlaufen.`,
                    'Both sides had their own commits. Git combined the changes automatically and created a [[merge|merge commit]] with two parents. In the map you can see the lines join.') };
        }
        if (m.result === 'conflict') return conflictNarration(m.conflicts.map(c => c.path), 'merge', m.theirs);
        if (m.result === 'stopped') {
            return { key: 'merge-stopped', tone: 'warn', title: t('Merge nicht abgeschlossen', 'Merge not completed'),
                body: t('Du hast die Nachricht leer gelassen, darum hat Git nicht committet. Die Zusammenführung ist vorbereitet – schließe sie mit `git commit` ab oder brich mit `git merge --abort` ab.', 'You left the message empty, so git did not commit. The merge is prepared – complete it with `git commit` or cancel with `git merge --abort`.') };
        }
        return null;
    },

    reset({ info }) {
        const r = info.reset || {};
        if (r.mode === 'paths') {
            return { key: 'reset-paths', tone: 'ok', title: t('Nicht mehr vorgemerkt', 'Unstaged'),
                body: t('`git reset <datei>` nimmt Dateien aus der Staging-Area; deine Änderungen bleiben in den Dateien. Modern: `git restore --staged <datei>`.', '`git reset <file>` takes files out of the staging area; your changes stay in the files. Modern equivalent: `git restore --staged <file>`.') };
        }
        const moved = r.from && r.to && r.from !== r.to;
        const texts = {
            soft: t('**--soft:** Nur der Branch-Zeiger wurde versetzt. Die Änderungen der „zurückgenommenen“ Commits liegen jetzt vorgemerkt in der Staging-Area – bereit für einen neuen Commit.', '**--soft:** only the branch pointer moved. The changes of the "undone" commits are now staged – ready for a new commit.'),
            mixed: t('**--mixed** (Standard): Branch-Zeiger und Staging-Area wurden zurückgesetzt. Deine Dateien sind unverändert – die Änderungen sind jetzt „nicht vorgemerkt“.', '**--mixed** (default): branch pointer and staging area were reset. Your files are unchanged – the changes are now "not staged".'),
            hard: r.discarded?.length
                ? sentence(l => (l === 'de' ? `**--hard:** Branch, Staging-Area **und Dateien** wurden auf den Ziel-Commit gesetzt. Dabei gingen die nicht committeten Änderungen in ${list(r.discarded, l)} verloren.` : `**--hard:** branch, staging area **and files** were set to the target commit. The uncommitted changes in ${list(r.discarded, l)} were lost.`))
                : t('**--hard:** Branch, Staging-Area **und Dateien** wurden auf den Ziel-Commit gesetzt. Es gab keine nicht committeten Änderungen – verloren ging dabei nichts.', '**--hard:** branch, staging area **and files** were set to the target commit. There were no uncommitted changes, so nothing was lost.'),
        };
        return {
            key: `reset-${r.mode}`, tone: r.mode === 'hard' ? 'warn' : 'ok', consumed: ['branch-moved', 'changes-discarded', 'orphaned'],
            title: moved ? t(`Zurückgesetzt auf \`${shortOid(r.to)}\``, `Reset to \`${shortOid(r.to)}\``) : t('Zurückgesetzt', 'Reset'),
            body: join(texts[r.mode] || texts.mixed,
                r.lostCommits?.length ? t(`Die ${r.lostCommits.length} „entfernten“ Commits sind nicht gelöscht – \`git reflog\` zeigt sie, \`git reset --hard HEAD@{1}\` bringt den alten Stand zurück.`, `The ${r.lostCommits.length} "removed" commit(s) are not deleted – \`git reflog\` shows them, \`git reset --hard HEAD@{1}\` brings the old state back.`) : null),
            more: t('Merke: `reset` schreibt Geschichte um. Für Commits, die andere schon haben (gepusht), nimm lieber `git revert`.', 'Remember: `reset` rewrites history. For commits others already have (pushed), prefer `git revert`.'),
        };
    },

    revert({ info }) {
        const r = info.revert || {};
        if (r.conflict) return conflictNarration(r.files, 'revert');
        return { key: 'revert', tone: 'ok', consumed: ['commits', 'branch-moved'],
            title: t('Rückgängig gemacht – mit einem neuen Commit', 'Undone – with a new commit'),
            body: t('Git hat einen neuen Commit angelegt, der die Änderungen des alten genau umkehrt. Die Geschichte bleibt vollständig erhalten – darum ist [[revert]] der sichere Weg für Commits, die schon geteilt sind.', 'Git created a new commit that exactly reverses the old one. History stays complete – that is why [[revert]] is the safe way for commits that are already shared.') };
    },

    'cherry-pick'({ info }) {
        const r = info['cherry-pick'] || {};
        if (r.conflict) return conflictNarration(r.files, 'cherry-pick');
        return { key: 'cherry-pick', tone: 'ok', consumed: ['commits', 'branch-moved'],
            title: t('Commit übernommen (cherry-pick)', 'Commit copied (cherry-pick)'),
            body: t('Die Änderungen des gewählten Commits wurden als **neuer** Commit auf deinen Branch gesetzt – mit neuer ID, aber gleicher Nachricht und gleichem Autor.', "The chosen commit's changes were applied to your branch as a **new** commit – new id, same message and author.") };
    },

    rebase({ info }) {
        const r = info.rebase || {};
        if (r.conflict) return conflictNarration(r.files, 'rebase');
        if (r.aborted) return { key: 'rebase-abort', tone: 'ok', consumed: ['changes-discarded', 'operation-finished', 'switched', 'reattached'], title: t('Rebase abgebrochen', 'Rebase aborted'), body: t('Dein Branch ist wieder genau wie vor dem Rebase.', 'Your branch is exactly as it was before the rebase.') };
        if (r.upToDate) return { key: 'rebase-uptodate', tone: 'info', title: t('Nichts zu tun', 'Nothing to do'), body: t('Dein Branch baut schon auf der gewünschten Basis auf.', 'Your branch is already based on the target.') };
        if (r.stopped) return { key: 'rebase-edit', tone: 'info', title: t('Rebase angehalten (edit)', 'Rebase paused (edit)'), body: t('Ändere jetzt Dateien und/oder `git commit --amend`, dann `git rebase --continue`.', 'Now change files and/or `git commit --amend`, then `git rebase --continue`.') };
        return { key: 'rebase', tone: 'ok', consumed: ['commits', 'branch-moved', 'orphaned', 'detached', 'reattached'],
            title: t('Rebase fertig', 'Rebase done'),
            body: t('Deine Commits wurden nacheinander auf die neue Basis kopiert – die Geschichte ist jetzt gerade. Achtung: Die Commits haben **neue IDs**; die alten stehen nur noch im Reflog. Rebase nur Commits, die noch niemand anderes hat!', 'Your commits were copied one by one onto the new base – the history is now straight. Careful: the commits have **new ids**; the old ones remain only in the reflog. Only rebase commits nobody else has!') };
    },

    stash({ info, events }) {
        const s = info.stash || {};
        if (s.nothing) return { key: 'stash-nothing', tone: 'info', title: t('Nichts zum Beiseitelegen', 'Nothing to stash'), body: t('Es gibt keine Änderungen an versionierten Dateien. (Neue Dateien nimmt `git stash -u` mit.)', 'There are no changes to tracked files. (New files need `git stash -u`.)') };
        if (s.conflict) return conflictNarration(s.files, 'stash');
        if (find(events, 'stash-pushed')) {
            return { key: 'stash-push', tone: 'ok', consumed: ['stash-pushed', 'changes-discarded'], title: t('Änderungen beiseitegelegt', 'Changes shelved'),
                body: t('Deine Änderungen liegen jetzt im [[stash|Stash]], das Arbeitsverzeichnis ist sauber. Du kannst gefahrlos den Branch wechseln oder pullen. Zurückholen: `git stash pop`.', 'Your changes are now in the [[stash]] and the working directory is clean. You can safely switch branches or pull. Bring them back with `git stash pop`.') };
        }
        if (s.applied) {
            return { key: 'stash-pop', tone: 'ok', consumed: ['stash-removed', 'files-modified', 'files-created'], title: s.popped ? t('Änderungen zurückgeholt', 'Changes restored') : t('Stash angewendet', 'Stash applied'),
                body: s.popped ? t('Die Änderungen sind wieder im Arbeitsverzeichnis, der Stash-Eintrag ist entfernt.', 'The changes are back in the working directory and the stash entry is removed.') : t('Die Änderungen sind wieder da; der Eintrag bleibt im Stash (`git stash drop` entfernt ihn).', 'The changes are back; the entry stays in the stash (`git stash drop` removes it).') };
        }
        if (s.dropped) return { key: 'stash-drop', tone: 'ok', consumed: ['stash-removed'], title: t('Stash-Eintrag gelöscht', 'Stash entry dropped'), body: t('Der Eintrag ist entfernt.', 'The entry is removed.') };
        return { key: 'stash-list', tone: 'info', compact: true, title: t('Stash', 'Stash'), body: t('`stash@{0}` ist der neueste Eintrag.', '`stash@{0}` is the newest entry.') };
    },

    tag({ events }) {
        const c = find(events, 'tag-created');
        if (c) return { key: 'tag', tone: 'ok', consumed: ['tag-created'], title: t(`Tag **${c.name}** gesetzt`, `Tag **${c.name}** created`), body: t(`Ein [[tag|Tag]] ist ein fester Name für \`${shortOid(c.oid)}\` – typisch für Versionen. Tags werden nicht automatisch gepusht: \`git push origin ${c.name}\`.`, `A [[tag]] is a fixed name for \`${shortOid(c.oid)}\` – typical for versions. Tags are not pushed automatically: \`git push origin ${c.name}\`.`) };
        return null;
    },

    config({ info }) {
        const c = info.config;
        if (!c) return null;
        const scope = c.global ? t('für alle deine Repositories (~/.gitconfig)', 'for all your repositories (~/.gitconfig)') : t('nur für dieses Repository', 'for this repository only');
        if (c.key === 'user.name' || c.key === 'user.email') {
            return { key: 'config-identity', tone: 'ok', consumed: ['identity-set'], title: t(`${c.key} gesetzt`, `${c.key} set`),
                body: sentence(l => (l === 'de' ? `„${c.value}“ steht ab jetzt in jedem neuen Commit – ${scope.de}. Bestehende Commits ändern sich nicht.` : `"${c.value}" will appear in every new commit – ${scope.en}. Existing commits do not change.`)) };
        }
        return { key: 'config', tone: 'ok', title: t(`${c.key} gesetzt`, `${c.key} set`), body: scope };
    },

    remote({ events }) {
        const a = find(events, 'remote-added');
        if (a) {
            return { key: 'remote-add', tone: 'ok', consumed: ['remote-added'], title: t(`Remote **${a.name}** eingetragen`, `Remote **${a.name}** added`),
                body: join(t(`**${a.name}** ist nur ein Kurzname für \`${a.url}\`. Es wurde noch nichts übertragen – das passiert erst mit \`git push\` oder \`git fetch\`.`, `**${a.name}** is just a short name for \`${a.url}\`. Nothing was transferred yet – that only happens with \`git push\` or \`git fetch\`.`),
                    a.kind === 'simulated' ? t('Diese Adresse gehört zum **simulierten Server** der Werkstatt.', 'This address belongs to the Werkstatt\'s **simulated server**.') : a.kind === 'real' ? t('Diese Adresse ist ein **echter Server** im Internet.', 'This address is a **real server** on the internet.') : null) };
        }
        return { key: 'remote-list', tone: 'info', compact: true, title: t('Remotes', 'Remotes'), body: t('Mit `-v` siehst du die Adressen. „fetch“ und „push“ sind meist dieselbe URL.', 'With `-v` you see the URLs. "fetch" and "push" are usually the same URL.') };
    },

    clone({ info }) {
        const c = info.clone || {};
        return { key: `clone-${c.kind}`, tone: 'ok', title: t('Repository geklont', 'Repository cloned'),
            body: join(t(`Der Ordner \`${(c.dir || '').split('/').pop()}\` enthält jetzt eine vollständige Kopie – mit allen Commits. Die Quelle ist als Remote **origin** eingetragen; \`origin/${c.branch || 'main'}\` merkt sich, wo der Server steht.`, `The folder \`${(c.dir || '').split('/').pop()}\` now holds a complete copy – with all commits. The source is recorded as the remote **origin**; \`origin/${c.branch || 'main'}\` remembers where the server is.`),
                c.kind === 'simulated' ? t('Quelle: **simulierter Server** (offline, nur in deinem Browser).', 'Source: **simulated server** (offline, only in your browser).') : t('Quelle: **echter Server** im Internet.', 'Source: **real server** on the internet.'),
                t('Wechsle mit `cd` hinein.', 'Change into it with `cd`.')) };
    },

    fetch({ events, repo }) {
        const upd = find(events, 'remote-tracking-updated');
        const branch = repo?.head.branch || 'main';
        const upstream = repo?.upstreams?.[branch]?.display || `origin/${branch}`;
        if (!upd) return { key: 'fetch-nothing', tone: 'info', title: t('Nichts Neues auf dem Server', 'Nothing new on the server'), body: t('Deine `origin/…`-Branches waren schon aktuell.', 'Your `origin/…` branches were already up to date.') };
        return { key: 'fetch', tone: 'ok', consumed: ['remote-tracking-updated', 'tracking'],
            title: t('Neue Commits geholt', 'New commits downloaded'),
            body: join(sentence(l => (l === 'de'
                ? `Aktualisiert: ${list(upd.branches.map(b => b.name), l)}. **Deine eigenen Branches und Dateien sind unverändert** – [[fetch]] lädt nur herunter.`
                : `Updated: ${list(upd.branches.map(b => b.name), l)}. **Your own branches and files are unchanged** – [[fetch]] only downloads.`)),
                t(`Einbauen: \`git merge ${upstream}\` (oder gleich \`git pull\`). Vorher anschauen: \`git log --oneline ${branch}..${upstream}\`.`, `To integrate: \`git merge ${upstream}\` (or simply \`git pull\`). Look first: \`git log --oneline ${branch}..${upstream}\`.`)) };
    },

    pull({ info }) {
        const m = info.merge || {};
        if (m.result === 'conflict') return conflictNarration(m.conflicts.map(c => c.path), 'merge', 'origin');
        const upToDate = m.result === 'up-to-date';
        return { key: upToDate ? 'pull-nothing' : `pull-${m.result || 'done'}`, tone: 'ok', consumed: ['remote-tracking-updated', 'branch-moved', 'commits', 'tracking'],
            title: upToDate ? t('Schon aktuell', 'Already up to date') : t('Gepullt: fetch + merge', 'Pulled: fetch + merge'),
            body: upToDate ? t('Auf dem Server gab es nichts, was dir fehlt.', 'The server had nothing you were missing.')
                : m.result === 'fast-forward'
                    ? t('Git hat die neuen Commits geholt und deinen Branch vorgespult ([[fast-forward]]). Deine Dateien sind auf dem neuesten Stand.', 'Git downloaded the new commits and moved your branch forward ([[fast-forward]]). Your files are up to date.')
                    : t('Git hat die neuen Commits geholt und mit deinen zusammengeführt (Merge-Commit). Jetzt kannst du `git push` ausführen.', 'Git downloaded the new commits and merged them with yours (merge commit). Now you can `git push`.') };
    },

    push({ info, repo }) {
        const p = info.push || {};
        if (p.upToDate) return { key: 'push-uptodate', tone: 'info', title: t('Schon alles auf dem Server', 'Server is already up to date'), body: t('Es gab keine neuen Commits zu übertragen.', 'There were no new commits to send.') };
        const sim = p.kind === 'simulated';
        return { key: 'push', tone: 'ok', consumed: ['remote-tracking-updated', 'tracking', 'upstream-set'],
            title: t('Gepusht', 'Pushed'),
            body: join(t(`Der ${sim ? 'simulierte ' : ''}Server hat jetzt deine Commits. \`origin/${repo.head.branch}\` zeigt auf denselben Commit wie **${repo.head.branch}** – ihr seid synchron.`, `The ${sim ? 'simulated ' : ''}server now has your commits. \`origin/${repo.head.branch}\` points to the same commit as **${repo.head.branch}** – you are in sync.`),
                p.results?.some(r => !r.old && !r.isTag) ? t('Der Branch existierte auf dem Server noch nicht – er wurde neu angelegt.', 'The branch did not exist on the server yet – it was created.') : null) };
    },

    blame() {
        return { key: 'blame', tone: 'info', compact: true, title: t('Wer hat welche Zeile geändert?', 'Who changed which line?'), body: t('Links stehen Commit-ID, Autor und Datum der letzten Änderung jeder Zeile. `git show <id>` zeigt den ganzen Commit.', 'On the left: commit id, author and date of the last change of each line. `git show <id>` shows the whole commit.') };
    },

    reflog() {
        return { key: 'reflog', tone: 'info', title: t('Das Tagebuch von HEAD', "HEAD's diary"),
            body: t('Jede Zeile ist ein Schritt, den HEAD gemacht hat – auch Commits, die an keinem Branch mehr hängen. `HEAD@{1}` ist der Stand vor dem letzten Schritt. Sicher zurückholen: `git branch rettung <id>` legt dort einen Branch an, ohne etwas zu verändern. `git reset --hard HEAD@{1}` setzt dagegen deinen Branch zurück und verwirft nicht committete Änderungen.', 'Each line is a step HEAD took – including commits no longer on any branch. `HEAD@{1}` is the state before the last step. The safe way back: `git branch rescue <id>` creates a branch there without changing anything. `git reset --hard HEAD@{1}`, in contrast, moves your branch back and throws away uncommitted changes.') };
    },

    clean({ info }) {
        if (info.dryRun) return { key: 'clean-dry', tone: 'info', title: t('Probelauf', 'Dry run'), body: t('So würde `git clean -f` löschen. Diese Dateien sind unversioniert – einmal gelöscht, sind sie weg.', 'This is what `git clean -f` would delete. These files are untracked – once deleted, they are gone.') };
        return { key: 'clean', tone: 'warn', consumed: ['untracked-removed'], title: t('Unversionierte Dateien gelöscht', 'Untracked files deleted'), body: sentence(l => (l === 'de' ? `Gelöscht: ${list(info.cleaned || [], l)}. Git kannte sie nicht und kann sie nicht wiederherstellen.` : `Deleted: ${list(info.cleaned || [], l)}. Git never knew them and cannot restore them.`)) };
    },
};

function switchNarration({ info, events, repo }) {
    const detached = find(events, 'detached');
    if (info.alreadyOn) return { key: 'switch-same', tone: 'info', title: t(`Du bist schon auf **${info.alreadyOn}**`, `You are already on **${info.alreadyOn}**`), body: t('Nichts passiert.', 'Nothing happened.') };
    if (detached || info.detached) {
        return { key: 'detached', tone: 'warn', consumed: ['detached', 'switched'],
            title: t('Losgelöster HEAD (detached HEAD)', 'Detached HEAD'),
            body: t(`Du schaust dir den Commit \`${shortOid(repo.head.oid)}\` direkt an – nicht über einen Branch. Gut zum Ansehen alter Stände. Neue Commits hier gehören aber zu **keinem** Branch und gehen leicht verloren.`, `You are looking at commit \`${shortOid(repo.head.oid)}\` directly – not through a branch. Fine for viewing old versions. But new commits here belong to **no** branch and are easily lost.`),
            more: t('Zurück: `git switch -`. Hier weiterarbeiten: `git switch -c neuer-branch` – dann ist alles sicher.', 'Back: `git switch -`. To continue here: `git switch -c new-branch` – then everything is safe.') };
    }
    const sw = info.switched;
    if (!sw) return null;
    const changed = (find(events, 'files-modified')?.files.length || 0);
    return {
        key: sw.created ? 'switch-create' : 'switch', tone: 'ok', consumed: ['switched', 'branch-created', 'reattached'],
        title: sw.created ? t(`Neuer Branch **${sw.to}** – du bist jetzt dort`, `New branch **${sw.to}** – you are on it now`) : t(`Du bist jetzt auf **${sw.to}**`, `You are now on **${sw.to}**`),
        body: join(
            t(`[[head|HEAD]] zeigt jetzt auf **${sw.to}**. Neue Commits landen ab jetzt auf diesem Branch.`, `[[head|HEAD]] now points to **${sw.to}**. New commits will go onto this branch.`),
            sw.created ? t(`Der Branch startet beim selben Commit wie **${sw.from}**; die Dateien bleiben deshalb gleich.`, `The branch starts at the same commit as **${sw.from}**, so your files stay the same.`)
                : t('Git hat dein Arbeitsverzeichnis an den Stand dieses Branches angepasst.', 'Git updated your working directory to match this branch.'),
            changed ? t('Deine nicht gespeicherten Änderungen wurden mitgenommen.', 'Your uncommitted changes came along.') : null,
        ),
    };
}

function conflictNarration(paths, op, theirs) {
    if (op === 'stash') return stashConflictNarration(paths);
    const cont = { merge: 'git commit', rebase: 'git rebase --continue', 'cherry-pick': 'git cherry-pick --continue', revert: 'git revert --continue' }[op] || 'git commit';
    const abort = { merge: 'git merge --abort', rebase: 'git rebase --abort', 'cherry-pick': 'git cherry-pick --abort', revert: 'git revert --abort' }[op];
    return {
        key: `conflict-${op}`, tone: 'danger', consumed: ['conflict', 'files-modified'],
        title: t('Konflikt – du entscheidest', 'Conflict – your decision'),
        body: sentence(l => (l === 'de'
            ? `Beide Seiten haben dieselben Zeilen in ${list(paths || [], l)} unterschiedlich geändert. Git hat die Stelle markiert:\n\n1. Datei öffnen (Klick in der Dateiliste oder \`nano ${paths?.[0] || 'datei'}\`)\n2. Zwischen \`<<<<<<<\` und \`>>>>>>>\` die richtige Fassung herstellen und **alle Marker löschen**\n3. Speichern, dann \`git add ${paths?.[0] || '<datei>'}\`\n4. Abschließen: \`${cont}\`\n\nDoch nicht? \`${abort}\` stellt den Zustand vorher wieder her.`
            : `Both sides changed the same lines in ${list(paths || [], l)} differently. Git marked the spot:\n\n1. Open the file (click it in the file list or \`nano ${paths?.[0] || 'file'}\`)\n2. Between \`<<<<<<<\` and \`>>>>>>>\` make the right version and **delete all markers**\n3. Save, then \`git add ${paths?.[0] || '<file>'}\`\n4. Finish: \`${cont}\`\n\nChanged your mind? \`${abort}\` restores the previous state.`)),
        more: t(`Zwischen \`<<<<<<< HEAD\` und \`=======\` steht **deine** Fassung, zwischen \`=======\` und \`>>>>>>>\` die **andere**${theirs ? ` (${theirs})` : ''}. Du darfst eine nehmen, beide kombinieren oder etwas ganz Neues schreiben.`,
            `Between \`<<<<<<< HEAD\` and \`=======\` is **your** version, between \`=======\` and \`>>>>>>>\` the **other** one${theirs ? ` (${theirs})` : ''}. You may take one, combine both or write something new.`),
    };
}

// `git stash pop/apply` with a conflict is not an operation in progress: nothing to commit
// or continue. Git keeps the stash entry, so the last step is dropping it.
function stashConflictNarration(paths) {
    const first = paths?.[0] || 'datei';
    return {
        key: 'conflict-stash', tone: 'danger', consumed: ['conflict', 'files-modified'],
        title: t('Konflikt beim Zurückholen', 'Conflict while restoring the stash'),
        body: sentence(l => (l === 'de'
            ? `Deine beiseitegelegten Änderungen und der aktuelle Stand ändern dieselben Zeilen in ${list(paths || [], l)}. Git hat die Stelle markiert:\n\n1. Datei öffnen, die richtige Fassung herstellen und **alle Marker löschen**\n2. Speichern, dann \`git add ${first}\` – damit gilt der Konflikt als gelöst\n3. Der Stash-Eintrag ist **noch da** (Git löscht ihn bei einem Konflikt nicht). Wenn alles passt: \`git stash drop\`\n\nDoch nicht? \`git reset --merge\` stellt den Stand vor dem Zurückholen wieder her – der Stash-Eintrag bleibt erhalten.`
            : `Your shelved changes and the current state change the same lines in ${list(paths || [], l)}. Git marked the spot:\n\n1. Open the file, make the right version and **delete all markers**\n2. Save, then \`git add ${first}\` – that marks the conflict as resolved\n3. The stash entry is **still there** (git does not drop it after a conflict). Once everything is right: \`git stash drop\`\n\nChanged your mind? \`git reset --merge\` restores the state before the stash was applied – the stash entry is kept.`)),
        more: t('Hier gibt es kein `--continue` und keinen Commit: Das Zurückholen ist mit dem Auflösen des Konflikts fertig. `git add` merkt die Datei dabei auch vor; wer das nicht will, nimmt danach `git restore --staged <datei>`.',
            'There is no `--continue` and no commit here: applying the stash is finished once the conflict is resolved. `git add` also stages the file; if you do not want that, run `git restore --staged <file>` afterwards.'),
    };
}

export { list, pick };
