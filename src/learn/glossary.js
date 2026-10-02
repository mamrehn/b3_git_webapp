// Short, precise definitions. Linked from coach texts with [[key]] or [[key|label]].

export const GLOSSARY = {
    repository: {
        de: ['Repository', 'Ein Projektordner, dessen Geschichte Git verwaltet. Die Geschichte steckt im versteckten Unterordner `.git`; alles andere ist dein Arbeitsverzeichnis.'],
        en: ['repository', 'A project folder whose history git manages. The history lives in the hidden `.git` folder; everything else is your working directory.'],
    },
    workdir: {
        de: ['Arbeitsverzeichnis', 'Die Dateien, die du siehst und bearbeitest. Änderungen hier kennt Git erst, wenn du sie vormerkst (`git add`) und committest.'],
        en: ['working directory', 'The files you see and edit. Git only records changes here once you stage (`git add`) and commit them.'],
    },
    staging: {
        de: ['Staging-Area', 'Auch „Index“: die Sammelstelle für den nächsten Commit. `git add` legt die aktuelle Fassung einer Datei hinein, `git commit` speichert genau diesen Inhalt.'],
        en: ['staging area', "Also called the 'index': where the next commit is assembled. `git add` puts a file's current version there; `git commit` records exactly that."],
    },
    commit: {
        de: ['Commit', 'Ein gespeicherter Schnappschuss aller versionierten Dateien – mit Nachricht, Autor, Zeit und einem Verweis auf den vorherigen Commit (Elternteil). Commits ändern sich nie.'],
        en: ['commit', 'A saved snapshot of all tracked files – with a message, author, time and a link to the previous commit (its parent). Commits never change.'],
    },
    hash: {
        de: ['Commit-ID (Hash)', 'Die eindeutige Kennung eines Commits, z. B. `a1b2c3d`. Sie wird aus dem Inhalt berechnet; meist reichen die ersten 7 Zeichen.'],
        en: ['commit id (hash)', 'The unique id of a commit, e.g. `a1b2c3d`. It is computed from the content; the first 7 characters are usually enough.'],
    },
    branch: {
        de: ['Branch', 'Ein beweglicher Name, der auf einen Commit zeigt. Committest du auf einem Branch, rückt er automatisch zum neuen Commit vor. Branches kosten nichts – leg ruhig viele an.'],
        en: ['branch', 'A movable name that points to a commit. When you commit on a branch, it moves forward to the new commit. Branches are cheap – create as many as you like.'],
    },
    head: {
        de: ['HEAD', '„Du bist hier“: zeigt auf den Branch (oder Commit), auf dem du gerade arbeitest. Neue Commits entstehen dort, wo HEAD steht.'],
        en: ['HEAD', "'You are here': points to the branch (or commit) you are working on. New commits are added where HEAD is."],
    },
    detached: {
        de: ['losgelöster HEAD', 'HEAD zeigt direkt auf einen Commit statt auf einen Branch. Zum Anschauen alter Stände gut – neue Commits gehören dann aber zu keinem Branch und gehen leicht verloren.'],
        en: ['detached HEAD', 'HEAD points directly at a commit instead of a branch. Fine for looking at old versions – but new commits belong to no branch and are easily lost.'],
    },
    merge: {
        de: ['Merge', 'Führt die Commits eines anderen Branches in den aktuellen zusammen. Hatten beide Seiten eigene Commits, entsteht ein Merge-Commit mit zwei Eltern.'],
        en: ['merge', 'Brings the commits of another branch into the current one. If both sides have their own commits, a merge commit with two parents is created.'],
    },
    'fast-forward': {
        de: ['Fast-Forward', 'Der einfachste Merge: Dein Branch hatte nichts Eigenes, also schiebt Git ihn nur nach vorne auf den anderen Commit. Es entsteht kein neuer Commit.'],
        en: ['fast-forward', 'The simplest merge: your branch had nothing of its own, so git just moves it forward to the other commit. No new commit is created.'],
    },
    conflict: {
        de: ['Konflikt', 'Beide Seiten haben dieselben Zeilen unterschiedlich geändert. Git kann nicht entscheiden und markiert die Stelle mit <<<<<<<, ======= und >>>>>>>. Du entscheidest, speicherst, und meldest es mit `git add` als gelöst.'],
        en: ['conflict', 'Both sides changed the same lines differently. Git cannot decide and marks the spot with <<<<<<<, ======= and >>>>>>>. You decide, save, and mark it resolved with `git add`.'],
    },
    remote: {
        de: ['Remote', 'Eine andere Kopie des Repositories, meist auf einem Server (z. B. GitHub). Mit `fetch`/`pull` holst du Commits von dort, mit `push` schickst du deine hin.'],
        en: ['remote', 'Another copy of the repository, usually on a server (like GitHub). `fetch`/`pull` get commits from it, `push` sends yours.'],
    },
    origin: {
        de: ['origin', 'Der übliche Kurzname des Remotes, von dem du geklont hast. Nur ein Name – er steht für eine Adresse (URL).'],
        en: ['origin', 'The usual short name of the remote you cloned from. Just a name – it stands for an address (URL).'],
    },
    'remote-tracking': {
        de: ['Remote-Tracking-Branch', 'z. B. `origin/main`: deine lokale Erinnerung daran, wo `main` auf dem Server stand – beim letzten `fetch`, `pull` oder `push`. Er aktualisiert sich nicht von selbst.'],
        en: ['remote-tracking branch', "e.g. `origin/main`: your local memory of where `main` was on the server – as of your last `fetch`, `pull` or `push`. It does not update by itself."],
    },
    upstream: {
        de: ['Upstream', 'Der Remote-Branch, mit dem dein Branch verknüpft ist (z. B. main ↔ origin/main). Dann reichen `git push` und `git pull` ohne weitere Angaben.'],
        en: ['upstream', 'The remote branch your branch is linked to (e.g. main ↔ origin/main). Then `git push` and `git pull` need no further arguments.'],
    },
    clone: {
        de: ['Klonen', 'Ein komplettes Repository herunterladen – mit allen Commits. Git trägt dabei die Quelle automatisch als Remote „origin“ ein.'],
        en: ['clone', "Downloading a complete repository – with all commits. Git automatically records the source as the remote 'origin'."],
    },
    fetch: {
        de: ['Fetch', 'Holt neue Commits vom Remote und aktualisiert `origin/…` – deine eigenen Branches und Dateien bleiben unverändert.'],
        en: ['fetch', 'Downloads new commits from the remote and updates `origin/…` – your own branches and files stay unchanged.'],
    },
    pull: {
        de: ['Pull', 'Fetch und danach Merge (oder Rebase) in deinen aktuellen Branch – in einem Schritt.'],
        en: ['pull', 'Fetch followed by a merge (or rebase) into your current branch – in one step.'],
    },
    push: {
        de: ['Push', 'Schickt deine Commits zum Remote. Klappt nur, wenn der Server nichts hat, was dir fehlt – sonst erst pullen.'],
        en: ['push', "Sends your commits to the remote. Only works if the server has nothing you're missing – otherwise pull first."],
    },
    reflog: {
        de: ['Reflog', 'Gits Tagebuch: jede Bewegung von HEAD und deinen Branches, ca. 90 Tage lang. Damit findest du „verlorene“ Commits wieder.'],
        en: ['reflog', "Git's diary: every move of HEAD and your branches, kept for about 90 days. Use it to find 'lost' commits again."],
    },
    stash: {
        de: ['Stash', 'Eine Ablage für unfertige Änderungen. `git stash` räumt sie weg (sauberes Arbeitsverzeichnis), `git stash pop` holt sie zurück.'],
        en: ['stash', 'A shelf for unfinished changes. `git stash` puts them away (clean working directory), `git stash pop` brings them back.'],
    },
    rebase: {
        de: ['Rebase', 'Kopiert deine Commits nacheinander auf eine neue Basis. Ergebnis: eine gerade Geschichte – aber neue Commit-IDs. Nur für Commits, die noch niemand anderes hat.'],
        en: ['rebase', "Copies your commits one by one onto a new base. Result: a straight history – but new commit ids. Only for commits nobody else has yet."],
    },
    'cherry-pick': {
        de: ['Cherry-Pick', 'Übernimmt die Änderungen eines einzelnen Commits als neuen Commit in deinen Branch.'],
        en: ['cherry-pick', "Applies a single commit's changes to your branch as a new commit."],
    },
    revert: {
        de: ['Revert', 'Macht einen Commit rückgängig, indem ein neuer Commit mit den umgekehrten Änderungen entsteht. Die Geschichte bleibt erhalten – sicher auch für geteilte Commits.'],
        en: ['revert', 'Undoes a commit by adding a new commit with the opposite changes. History is kept – safe even for shared commits.'],
    },
    reset: {
        de: ['Reset', 'Setzt deinen Branch auf einen anderen Commit. `--soft`: nur der Zeiger; `--mixed`: plus Staging-Area; `--hard`: plus Dateien – nicht Gespeichertes geht dabei verloren.'],
        en: ['reset', 'Moves your branch to another commit. `--soft`: just the pointer; `--mixed`: plus the staging area; `--hard`: plus your files – unsaved work is lost.'],
    },
    tag: {
        de: ['Tag', 'Ein fester Name für einen Commit, z. B. eine Version wie `v1.0`. Anders als ein Branch bewegt er sich nicht.'],
        en: ['tag', "A fixed name for a commit, e.g. a version like `v1.0`. Unlike a branch, it doesn't move."],
    },
    untracked: {
        de: ['unversioniert', 'Eine Datei, die Git (noch) nicht kennt. Sie ist in keinem Commit und wird nicht beachtet, bis du sie mit `git add` vormerkst.'],
        en: ['untracked', 'A file git does not know (yet). It is in no commit and is ignored until you stage it with `git add`.'],
    },
    gitignore: {
        de: ['.gitignore', 'Eine Datei mit Mustern (z. B. `*.log`, `node_modules/`) für Dateien, die Git ignorieren soll – sie tauchen dann nicht mehr als unversioniert auf.'],
        en: ['.gitignore', 'A file with patterns (e.g. `*.log`, `node_modules/`) for files git should ignore – they no longer show up as untracked.'],
    },
    shell: {
        de: ['Shell', 'Das Programm, das deine Befehle im Terminal ausführt (hier: bash). Jede Zeile ist ein Befehl, gefolgt von Optionen (`-a`) und Argumenten (Dateinamen …).'],
        en: ['shell', 'The program that runs the commands you type in the terminal (here: bash). Each line is a command followed by options (`-a`) and arguments (file names …).'],
    },
    path: {
        de: ['Pfad', 'Die Adresse einer Datei. Absolut beginnt mit `/` (z. B. `/home/student`), relativ gilt vom aktuellen Ordner aus. `..` ist der Ordner darüber, `~` dein Home-Verzeichnis.'],
        en: ['path', "A file's address. Absolute paths start with `/` (e.g. `/home/student`), relative ones start from the current folder. `..` is the parent folder, `~` your home directory."],
    },
};

export function term(key) {
    return GLOSSARY[key] || null;
}
