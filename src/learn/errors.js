// Plain-language explanations for errors – what went wrong and how to fix it.

import { closest } from '../core/util.js';

const t = (de, en) => ({ de, en });

function firstFile(data) {
    return data?.files?.[0] || '<datei>';
}

const GIT_ERRORS = {
    'not-a-repo': (e, ctx) => ({
        title: t('Hier ist kein Git-Repository', 'There is no git repository here'),
        body: ctx.homeRepos.length
            ? t(`Git-Befehle funktionieren nur in einem Ordner mit \`.git\`. Du bist in \`${ctx.cwdDisplay}\`. Repositories in deinem Home: ${ctx.homeRepos.map(r => `\`cd ~/${r}\``).join(', ')}. Ein neues Repository legst du mit \`git init\` an.`,
                `Git commands only work inside a folder with \`.git\`. You are in \`${ctx.cwdDisplay}\`. Repositories in your home: ${ctx.homeRepos.map(r => `\`cd ~/${r}\``).join(', ')}. Create a new repository with \`git init\`.`)
            : t(`Git-Befehle funktionieren nur in einem Ordner mit \`.git\`. Du bist in \`${ctx.cwdDisplay}\`. Wechsle in ein Projekt (\`cd\`) oder lege mit \`git init\` ein neues Repository an.`,
                `Git commands only work inside a folder with \`.git\`. You are in \`${ctx.cwdDisplay}\`. Change into a project (\`cd\`) or create a new repository with \`git init\`.`),
    }),
    pathspec: (e) => ({
        title: t('Diese Datei kennt Git nicht', 'Git does not know this file'),
        body: t(`Der Name passt auf keine Datei. Häufige Ursachen: Tippfehler, falscher Ordner (\`pwd\`, \`ls\`), oder die Datei ist unversioniert. \`git status\` zeigt, welche Dateien Git kennt.`, 'The name matches no file. Common causes: a typo, the wrong folder (`pwd`, `ls`), or the file is untracked. `git status` shows which files git knows.'),
    }),
    identity: () => ({
        title: t('Git weiß noch nicht, wer du bist', 'Git does not know who you are yet'),
        body: t('Jeder Commit speichert Name und E-Mail der Person, die ihn erstellt. Einmal einstellen, dann gilt es für alle Repositories:\n\n`git config --global user.name "Vorname Nachname"`\n\n`git config --global user.email "du@beispiel.de"`',
            'Every commit records the name and email of its author. Set it once and it applies to all repositories:\n\n`git config --global user.name "First Last"`\n\n`git config --global user.email "you@example.com"`'),
    }),
    'unresolved-conflicts': (e) => ({
        title: t('Erst die Konflikte lösen', 'Resolve the conflicts first'),
        body: t(`Es gibt noch Dateien mit Konflikten${e.data?.files ? ` (\`${e.data.files.join('`, `')}\`)` : ''}. Öffne sie, entscheide dich zwischen den Markern, speichere und führe \`git add\` aus. Danach geht es weiter.`, `There are still files with conflicts${e.data?.files ? ` (\`${e.data.files.join('`, `')}\`)` : ''}. Open them, choose between the markers, save and run \`git add\`. Then you can continue.`),
    }),
    'local-changes': (e) => ({
        title: t('Deine Änderungen wären sonst verloren', 'Your changes would be lost'),
        body: t(`Git würde ${e.data?.files ? `\`${e.data.files.join('`, `')}\`` : 'Dateien'} überschreiben, in denen du nicht gespeicherte Änderungen hast. Darum hat Git abgebrochen – nichts ist passiert. Möglichkeiten: Änderungen committen (\`git commit -am "…"\`), beiseitelegen (\`git stash\`) oder bewusst verwerfen (\`git restore ${firstFile(e.data)}\`).`,
            `Git would overwrite ${e.data?.files ? `\`${e.data.files.join('`, `')}\`` : 'files'} that contain uncommitted changes. So git stopped – nothing happened. Options: commit them (\`git commit -am "…"\`), shelve them (\`git stash\`) or deliberately discard them (\`git restore ${firstFile(e.data)}\`).`),
    }),
    'untracked-overwrite': (e) => ({
        title: t('Eine unversionierte Datei steht im Weg', 'An untracked file is in the way'),
        body: t(`Der Ziel-Stand enthält \`${firstFile(e.data)}\`, und in deinem Ordner liegt eine gleichnamige Datei, die Git nicht kennt. Benenne sie um (\`mv\`), lösche sie oder merke sie vor und committe sie.`, `The target contains \`${firstFile(e.data)}\`, and your folder has an untracked file with the same name. Rename it (\`mv\`), delete it, or stage and commit it.`),
    }),
    'unknown-revision': (e) => ({
        title: t('Diesen Commit oder Branch gibt es nicht', 'That commit or branch does not exist'),
        body: t(`\`${e.data?.rev || ''}\` ist kein bekannter Name. \`git branch -a\` zeigt Branches, \`git log --oneline\` Commit-IDs, \`git tag\` Tags. Tippfehler bei IDs passieren leicht – meist reichen 7 Zeichen.`, `\`${e.data?.rev || ''}\` is not a known name. \`git branch -a\` shows branches, \`git log --oneline\` commit ids, \`git tag\` tags. Typos in ids are easy – usually 7 characters are enough.`),
    }),
    'invalid-reference': (e) => ({
        title: t('Diesen Branch gibt es nicht', 'That branch does not exist'),
        body: t(`Einen Branch \`${e.data?.target || ''}\` gibt es (noch) nicht. Neu anlegen und wechseln: \`git switch -c ${e.data?.target || 'name'}\`. Vorhandene Branches: \`git branch -a\`.`, `There is no branch \`${e.data?.target || ''}\` (yet). Create and switch: \`git switch -c ${e.data?.target || 'name'}\`. Existing branches: \`git branch -a\`.`),
    }),
    'branch-expected': (e) => ({
        title: t('`git switch` erwartet einen Branch', '`git switch` expects a branch'),
        body: t(`\`${e.data?.target}\` ist ein ${e.data?.kind === 'tag' ? 'Tag' : e.data?.kind === 'remote branch' ? 'Remote-Tracking-Branch' : 'Commit'}, kein lokaler Branch. Nur anschauen: \`git switch --detach ${e.data?.target}\`. Weiterarbeiten: \`git switch -c neuer-name ${e.data?.target}\`.`, `\`${e.data?.target}\` is a ${e.data?.kind || 'commit'}, not a local branch. Just to look: \`git switch --detach ${e.data?.target}\`. To work on it: \`git switch -c new-name ${e.data?.target}\`.`),
    }),
    'invalid-branch-name': () => ({
        title: t('Ungültiger Branch-Name', 'Invalid branch name'),
        body: t('Branch-Namen dürfen keine Leerzeichen und Zeichen wie `~ ^ : ? * [` enthalten. Üblich: Kleinbuchstaben mit Bindestrich, z. B. `neue-startseite` oder `fix/login`.', 'Branch names may not contain spaces or characters like `~ ^ : ? * [`. Common style: lowercase with dashes, e.g. `new-homepage` or `fix/login`.'),
    }),
    'not-fast-forward': () => ({
        title: t('Kein Fast-Forward möglich', 'No fast-forward possible'),
        body: t('Beide Seiten haben eigene Commits. Mit `--ff-only` verweigert Git dann. Ohne die Option entsteht ein Merge-Commit; alternativ `git rebase`.', 'Both sides have their own commits. With `--ff-only` git refuses. Without the option a merge commit is created; alternatively `git rebase`.'),
    }),
    'unrelated-histories': () => ({
        title: t('Zwei völlig getrennte Geschichten', 'Two completely separate histories'),
        body: t('Die beiden Stände haben keinen gemeinsamen Vorfahren-Commit – oft, weil ein Repository neu angelegt statt geklont wurde. Bewusst zusammenführen: `git merge --allow-unrelated-histories …`.', 'The two have no common ancestor commit – often because a repository was created anew instead of cloned. To merge deliberately: `git merge --allow-unrelated-histories …`.'),
    }),
    'merge-in-progress': () => ({
        title: t('Ein Merge ist noch nicht abgeschlossen', 'A merge is still in progress'),
        body: t('Schließe ihn mit `git commit` ab oder brich ihn mit `git merge --abort` ab.', 'Finish it with `git commit` or abort it with `git merge --abort`.'),
    }),
    'operation-in-progress': () => ({
        title: t('Erst die laufende Aktion beenden', 'Finish the current operation first'),
        body: t('Ein Merge, Rebase, Cherry-Pick oder Revert läuft noch. `git status` zeigt, welcher – und wie du ihn fortsetzt (`--continue`) oder abbrichst (`--abort`).', 'A merge, rebase, cherry-pick or revert is in progress. `git status` shows which one – and how to continue (`--continue`) or abort (`--abort`).'),
    }),
    'no-upstream': (e) => ({
        title: t('Der Branch hat noch keinen Partner auf dem Server', 'The branch has no counterpart on the server yet'),
        body: t(`Git weiß nicht, wohin \`${e.data?.branch || 'dieser Branch'}\` gehört. Beim ersten Push gibst du es an – \`-u\` merkt es sich für später:\n\n\`git push -u ${e.data?.remote || 'origin'} ${e.data?.branch || '<branch>'}\``, `Git does not know where \`${e.data?.branch || 'this branch'}\` belongs. On the first push you tell it – \`-u\` remembers it for later:\n\n\`git push -u ${e.data?.remote || 'origin'} ${e.data?.branch || '<branch>'}\``),
    }),
    'no-remote': (e) => ({
        title: t('Kein Remote eingetragen', 'No remote configured'),
        body: t(`Dieses Repository kennt keinen Server${e.data?.remote ? ` namens \`${e.data.remote}\`` : ''}. \`git remote -v\` zeigt die eingetragenen. Neu eintragen: \`git remote add origin <url>\`.`, `This repository knows no server${e.data?.remote ? ` called \`${e.data.remote}\`` : ''}. \`git remote -v\` lists the configured ones. Add one: \`git remote add origin <url>\`.`),
    }),
    'divergent-pull': () => ({
        title: t('Git will wissen, wie es zusammenführen soll', 'Git wants to know how to combine'),
        body: t('Du und der Server habt beide neue Commits. Wähle einmalig: zusammenführen (`git config pull.rebase false`) oder deine Commits obenauf setzen (`git config pull.rebase true`). Dann erneut `git pull`.', 'You and the server both have new commits. Choose once: merge (`git config pull.rebase false`) or put your commits on top (`git config pull.rebase true`). Then `git pull` again.'),
    }),
    'repo-not-found': () => ({
        title: t('Repository nicht gefunden', 'Repository not found'),
        body: t('Unter dieser Adresse gibt es kein (öffentliches) Repository. Prüfe die URL – sie endet meist auf `.git`. Private Repositories brauchen eine Anmeldung.', 'There is no (public) repository at this address. Check the URL – it usually ends in `.git`. Private repositories need a login.'),
    }),
    'auth-failed': () => ({
        title: t('Anmeldung fehlgeschlagen', 'Login failed'),
        body: t('GitHub & Co. akzeptieren kein Passwort mehr, sondern ein **Personal Access Token** (in den Account-Einstellungen unter „Developer settings“). Zum Üben ohne Konto eignen sich die Missionen mit simuliertem Server.', 'GitHub & co. no longer accept passwords, only a **personal access token** (account settings → "Developer settings"). To practise without an account, use the missions with the simulated server.'),
    }),
    network: () => ({
        title: t('Keine Verbindung', 'No connection'),
        body: t('Der Server war nicht erreichbar – vielleicht ist das Internet weg oder der CORS-Proxy blockiert. Prüfe die Adresse mit `git remote -v`. Die Missionen funktionieren auch offline.', 'The server could not be reached – maybe the internet is down or the CORS proxy is blocked. Check the address with `git remote -v`. Missions work offline too.'),
    }),
    'mission-offline': (e) => ({
        title: t('In den Missionen gibt es kein Internet', 'There is no internet in the missions'),
        body: t(`Missionen laufen absichtlich offline: Der einzige Server ist der simulierte \`git.sim\`. ${e.data?.host ? `\`${e.data.host}\`` : 'Echte Server'} erreichst du in der **Sandbox** (Umschalter oben).`, `Missions are offline on purpose: the only server is the simulated \`git.sim\`. You can reach ${e.data?.host ? `\`${e.data.host}\`` : 'real servers'} in the **sandbox** (switch at the top).`),
    }),
    'ssh-unsupported': () => ({
        title: t('SSH geht im Browser nicht', 'SSH does not work in a browser'),
        body: t('Adressen wie `git@github.com:user/repo.git` brauchen SSH. Nutze die HTTPS-Adresse: `https://github.com/user/repo.git`.', 'Addresses like `git@github.com:user/repo.git` need SSH. Use the HTTPS address: `https://github.com/user/repo.git`.'),
    }),
    'clean-require-force': () => ({
        title: t('Sicherheitsabfrage von `git clean`', 'A safety check of `git clean`'),
        body: t('`git clean` löscht unversionierte Dateien endgültig. Erst schauen: `git clean -n`. Wirklich löschen: `git clean -f` (Ordner: `-fd`).', '`git clean` deletes untracked files for good. Look first: `git clean -n`. Really delete: `git clean -f` (folders: `-fd`).'),
    }),
    'rm-local-changes': (e) => ({
        title: t('Die Datei hat noch Änderungen', 'The file still has changes'),
        body: t(`\`git rm\` würde nicht gespeicherte Arbeit in \`${firstFile(e.data)}\` löschen. Nur aus Git entfernen, Datei behalten: \`git rm --cached ${firstFile(e.data)}\`. Wirklich weg damit: \`git rm -f ${firstFile(e.data)}\`.`, `\`git rm\` would delete unsaved work in \`${firstFile(e.data)}\`. To stop tracking but keep the file: \`git rm --cached ${firstFile(e.data)}\`. To really delete: \`git rm -f ${firstFile(e.data)}\`.`),
    }),
    'tag-exists': () => ({ title: t('Den Tag gibt es schon', 'The tag already exists'), body: t('Tags sind feste Namen und werden normalerweise nicht verschoben. Wähle einen neuen Namen (z. B. `v1.1`).', 'Tags are fixed names and are usually not moved. Pick a new name (e.g. `v1.1`).') }),
    'rebase-dirty': () => ({ title: t('Erst aufräumen, dann rebasen', 'Clean up before rebasing'), body: t('Rebase braucht ein sauberes Arbeitsverzeichnis. Committe deine Änderungen oder lege sie mit `git stash` beiseite.', 'A rebase needs a clean working directory. Commit your changes or shelve them with `git stash`.') }),
    'no-rebase': () => ({ title: t('Es läuft kein Rebase', 'No rebase in progress'), body: t('`--continue`/`--abort` gibt es nur während eines Rebase.', '`--continue`/`--abort` only exist during a rebase.') }),
    'nothing-in-progress': () => ({ title: t('Es läuft nichts', 'Nothing in progress'), body: t('`--continue`/`--abort` gibt es nur, während ein Cherry-Pick oder Revert läuft.', '`--continue`/`--abort` only exist while a cherry-pick or revert is in progress.') }),
    'no-commits': () => ({ title: t('Noch keine Commits', 'No commits yet'), body: t('Dieses Repository ist leer. Erster Commit: Datei anlegen → `git add <datei>` → `git commit -m "Erster Commit"`.', 'This repository is empty. First commit: create a file → `git add <file>` → `git commit -m "First commit"`.') }),
    'clone-exists': () => ({ title: t('Der Ordner existiert schon', 'The folder already exists'), body: t('`git clone` legt einen neuen Ordner an. Gib einen anderen Namen an: `git clone <url> anderer-name`.', '`git clone` creates a new folder. Use another name: `git clone <url> other-name`.') }),
    unsupported: () => ({ title: t('Nicht verfügbar', 'Not available'), body: t('Diese Variante gibt es in der Werkstatt nicht – siehe Meldung im Terminal.', 'This variant is not available in the Werkstatt – see the terminal message.') }),
    usage: () => ({ title: t('Falsche Aufruf-Form', 'Wrong usage'), body: t('Option oder Argument stimmt nicht. Die Hilfe zum Befehl: `git <befehl> -h` oder `man git-<befehl>`.', 'An option or argument is wrong. Help for the command: `git <command> -h` or `man git-<command>`.') }),
};

export function explainError(cmd, run, state) {
    const ctx = { cwdDisplay: state?.cwdDisplay || '~', homeRepos: state?.homeRepos || [] };
    const stderr = run.stderr || '';
    if (cmd.notFound) {
        const known = ['git', 'ls', 'cd', 'cat', 'pwd', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'nano', 'echo', 'less', 'grep', 'clear', 'help', 'history', 'tree', 'find', 'head', 'tail', 'diff', 'sed', 'man'];
        const guess = closest(cmd.name.toLowerCase(), known, 2)[0];
        return {
            key: 'not-found', tone: 'error',
            title: t(`Den Befehl \`${cmd.name}\` gibt es nicht`, `There is no command \`${cmd.name}\``),
            body: guess
                ? t(`Meintest du \`${guess}\`? Die Shell nimmt es genau: Tippfehler und Groß-/Kleinschreibung zählen.`, `Did you mean \`${guess}\`? The shell is strict: typos and upper/lower case matter.`)
                : t('Die Shell kennt diesen Befehl nicht. Alle Befehle zeigt `help`.', 'The shell does not know this command. `help` lists all commands.'),
        };
    }
    if (cmd.name === 'git') {
        const g = cmd.info.git || {};
        if (g.unknown) {
            return {
                key: 'git-unknown', tone: 'error',
                title: t(`\`git ${g.unknown}\` gibt es nicht`, `\`git ${g.unknown}\` does not exist`),
                body: g.similar?.length ? t(`Meintest du \`git ${g.similar[0]}\`?`, `Did you mean \`git ${g.similar[0]}\`?`) : t('`git help` zeigt die häufigsten Befehle.', '`git help` lists the most common commands.'),
            };
        }
        if (cmd.info.nothingToCommit) {
            const st = state?.repo?.status;
            const hasUnstaged = st && (st.unstaged.length || st.untracked.length);
            return {
                key: 'nothing-to-commit', tone: 'warn',
                title: t('Kein Commit – nichts vorgemerkt', 'No commit – nothing staged'),
                body: hasUnstaged
                    ? t('Ein Commit speichert nur, was in der [[staging|Staging-Area]] liegt – und die ist leer. Merke deine Änderungen erst vor: `git add <datei>` (oder `git add .`), dann `git commit -m "…"`.', 'A commit only records what is in the [[staging|staging area]] – and it is empty. Stage your changes first: `git add <file>` (or `git add .`), then `git commit -m "…"`.')
                    : t('Es gibt keine Änderungen seit dem letzten Commit. Ändere zuerst eine Datei.', 'There are no changes since the last commit. Change a file first.'),
            };
        }
        if (cmd.info.emptyMessage) {
            return { key: 'empty-message', tone: 'warn', title: t('Commit abgebrochen: leere Nachricht', 'Commit aborted: empty message'), body: t('Ohne Nachricht speichert Git nichts. Tipp: `git commit -m "Was ich geändert habe"` – oder im Editor eine Zeile schreiben (ohne # am Anfang).', 'Without a message git records nothing. Tip: `git commit -m "What I changed"` – or write a line in the editor (not starting with #).') };
        }
        if (cmd.info.notMerged) {
            return { key: 'not-merged', tone: 'warn', title: t('Der Branch ist noch nicht zusammengeführt', 'The branch is not merged yet'), body: t(`\`${cmd.info.notMerged}\` enthält Commits, die nirgendwo sonst sind. Erst mergen – oder bewusst wegwerfen mit \`git branch -D ${cmd.info.notMerged}\`.`, `\`${cmd.info.notMerged}\` has commits that exist nowhere else. Merge it first – or deliberately throw it away with \`git branch -D ${cmd.info.notMerged}\`.`) };
        }
        if (cmd.info.notMergeable) {
            return { key: 'not-mergeable', tone: 'error', title: t('Das kann Git nicht mergen', 'Git cannot merge that'), body: t(`\`${cmd.info.notMergeable}\` ist weder Branch noch Commit. \`git branch -a\` zeigt, was es gibt.`, `\`${cmd.info.notMergeable}\` is neither a branch nor a commit. \`git branch -a\` shows what exists.`) };
        }
        if (cmd.info.push?.rejected) {
            const reason = cmd.info.push.results?.find(r => r.rejected)?.reason;
            return {
                key: `push-rejected-${reason}`, tone: 'warn',
                title: t('Push abgelehnt', 'Push rejected'),
                body: reason === 'fetch first'
                    ? t('Auf dem Server liegen Commits, die du noch nicht hast – vermutlich hat jemand anderes gepusht. Git lehnt ab, damit diese Arbeit nicht überschrieben wird. Lösung: `git pull` (holt und führt zusammen), dann erneut `git push`.', 'The server has commits you do not have yet – probably someone else pushed. Git refuses so that work is not overwritten. Fix: `git pull` (downloads and merges), then `git push` again.')
                    : t('Dein Branch liegt hinter dem Server zurück. Hole erst die neuen Commits (`git pull`), dann klappt `git push`. Niemals einfach `--force` verwenden: Das würde die Arbeit anderer löschen.', 'Your branch is behind the server. Get the new commits first (`git pull`), then `git push` works. Never just use `--force`: it would delete other people\'s work.'),
                more: t('Das ist der Alltag im Team: Vor dem Push zuerst den Stand der anderen einbauen.', 'This is everyday teamwork: integrate the others\' work before you push.'),
            };
        }
        const err = g.error;
        if (err?.kind && GIT_ERRORS[err.kind]) {
            const res = GIT_ERRORS[err.kind](err, ctx);
            return { key: `git-${err.kind}`, tone: 'error', ...res };
        }
        if (cmd.status === 1 && !stderr) return null; // e.g. git diff --exit-code
        return {
            key: 'git-generic', tone: 'error',
            title: t('Git hat abgebrochen', 'Git stopped'),
            body: t('Lies die Meldung im Terminal von oben nach unten: Zeilen mit `error:` oder `fatal:` nennen den Grund, `hint:`-Zeilen schlagen oft schon die Lösung vor.', 'Read the terminal message top to bottom: lines with `error:` or `fatal:` give the reason, `hint:` lines often suggest the fix.'),
        };
    }
    // shell errors
    if (/No such file or directory/.test(stderr)) {
        return { key: 'enoent', tone: 'error', title: t('Datei oder Ordner nicht gefunden', 'File or folder not found'), body: t(`Den Namen gibt es hier nicht. Prüfe mit \`ls\`, was in \`${ctx.cwdDisplay}\` liegt, und mit \`pwd\`, wo du bist. Tipp: Die Tab-Taste vervollständigt Namen.`, `That name does not exist here. Check with \`ls\` what is in \`${ctx.cwdDisplay}\` and with \`pwd\` where you are. Tip: the Tab key completes names.`) };
    }
    if (/Permission denied/.test(stderr)) {
        return { key: 'eacces', tone: 'error', title: t('Keine Berechtigung', 'Permission denied'), body: t('Außerhalb deines Home-Verzeichnisses (`~`) darfst du nichts ändern – wie auf einem echten Mehrbenutzer-System. Arbeite in `~` oder dessen Unterordnern.', 'You may not change anything outside your home directory (`~`) – like on a real multi-user system. Work in `~` or its subfolders.') };
    }
    if (/Is a directory/.test(stderr)) {
        return { key: 'eisdir', tone: 'error', title: t('Das ist ein Ordner', 'That is a folder'), body: t('Der Befehl erwartet eine Datei. In einen Ordner wechselst du mit `cd`, seinen Inhalt zeigt `ls`. Ordner löschen: `rm -r`.', 'The command expects a file. Change into a folder with `cd`, list it with `ls`. Delete folders with `rm -r`.') };
    }
    if (/File exists/.test(stderr)) {
        return { key: 'eexist', tone: 'error', title: t('Das gibt es schon', 'That already exists'), body: t('Wähle einen anderen Namen. `mkdir -p` meldet keinen Fehler, wenn der Ordner schon da ist.', 'Pick another name. `mkdir -p` does not complain if the folder exists.') };
    }
    if (/missing (file )?operand|missing destination/.test(stderr)) {
        return { key: 'missing-operand', tone: 'error', title: t('Da fehlt etwas', 'Something is missing'), body: t(`\`${cmd.name}\` braucht noch einen Namen (z. B. eine Datei). Beispiel und Optionen: \`${cmd.name} --help\`.`, `\`${cmd.name}\` needs a name (e.g. a file). Example and options: \`${cmd.name} --help\`.`) };
    }
    if (/invalid option|unrecognized option/.test(stderr)) {
        return { key: 'bad-option', tone: 'error', title: t('Unbekannte Option', 'Unknown option'), body: t(`Diese Option kennt \`${cmd.name}\` nicht. Alle Optionen: \`${cmd.name} --help\`.`, `\`${cmd.name}\` does not know this option. All options: \`${cmd.name} --help\`.`) };
    }
    if (/syntax error|unexpected EOF/.test(stderr)) {
        return { key: 'syntax', tone: 'error', title: t('Die Zeile ist unvollständig', 'The line is incomplete'), body: t('Wahrscheinlich fehlt ein schließendes Anführungszeichen oder nach `|`/`&&` fehlt ein Befehl.', 'Probably a closing quote is missing, or a command is missing after `|`/`&&`.') };
    }
    if (/Directory not empty/.test(stderr)) {
        return { key: 'enotempty', tone: 'error', title: t('Der Ordner ist nicht leer', 'The folder is not empty'), body: t('`rmdir` löscht nur leere Ordner. Mit Inhalt: `rm -r ordner` (endgültig!).', '`rmdir` only removes empty folders. With contents: `rm -r folder` (permanent!).') };
    }
    return null;
}
