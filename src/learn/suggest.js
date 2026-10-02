// "What you can do now" – like the exits of a text adventure, but for git.
// Paths in the state are relative to the repository root; commands are typed in the
// current folder, so every path is converted (`arg`) before it goes into a command.

import { fromPrefix } from '../core/util.js';

const t = (de, en) => ({ de, en });

export function quoteArg(p) {
    return /^[\w./@+-]+$/.test(p) ? p : `"${p.replace(/"/g, '\\"')}"`;
}

// `run` is the command that just ran (if any): some advice depends on what just happened,
// e.g. after a rejected push the state still looks "ahead", but pushing again is pointless.
export function suggest(state, { run = null, events = [] } = {}) {
    const out = [];
    const add = (cmd, why, kind = 'act', extra = {}) => {
        if (!out.some(s => s.cmd === cmd)) out.push({ cmd, why, kind, ...extra });
    };
    const repo = state.repo;

    if (!repo) {
        const atHome = state.cwd === '/home/student';
        for (const r of state.homeRepos.slice(0, 2)) add(`cd ~/${r}`, t(`ins Repository **${r}** wechseln`, `go into the repository **${r}**`), 'nav');
        for (const d of (state.subdirs || []).filter(d => !(atHome && state.homeRepos.includes(d))).slice(0, 2)) {
            add(`cd ${quoteArg(d)}`, t(`in den Ordner **${d}** wechseln`, `go into the folder **${d}**`), 'nav');
        }
        // no point in suggesting the command that just ran
        const last = run?.commands?.[run.commands.length - 1]?.name;
        if (!['ls', 'll', 'la', 'tree'].includes(last)) add('ls', t('sehen, was in diesem Ordner liegt', 'see what is in this folder'), 'look');
        if (!atHome && state.cwd !== '/') add('cd ..', t('eine Ordnerebene nach oben', 'one folder level up'), 'nav');
        if (!atHome) add('git init', t('diesen Ordner zum Git-Repository machen', 'turn this folder into a git repository'), 'act');
        else add('mkdir website && cd website', t('einen Projektordner anlegen', 'create a project folder'), 'act');
        return out;
    }
    if (repo.broken) return out;
    const shown = path => fromPrefix(repo.prefix, path);
    const arg = path => quoteArg(shown(path));
    // `git add .` only covers the current folder; in a subfolder -A takes the whole repository
    const addAll = repo.prefix ? 'git add -A' : 'git add .';
    const st = repo.status;
    const op = repo.op;
    const conflicts = st.conflicts.map(c => c.path);

    // 1. an operation in progress comes first
    if (op) {
        const cont = { merge: 'git commit', rebase: 'git rebase --continue', 'cherry-pick': 'git cherry-pick --continue', revert: 'git revert --continue' }[op.kind];
        const abort = `git ${op.kind === 'merge' ? 'merge' : op.kind} --abort`;
        if (conflicts.length) {
            add(`nano ${arg(conflicts[0])}`, t(`Konflikt in **${shown(conflicts[0])}** lösen (Marker entfernen, speichern)`, `resolve the conflict in **${shown(conflicts[0])}** (remove markers, save)`), 'fix');
            add(`git add ${arg(conflicts[0])}`, t('danach als gelöst markieren', 'then mark it as resolved'), 'stage');
            add(abort, t('abbrechen – alles wie vorher', 'abort – back to how it was'), 'undo', { danger: true });
        } else {
            add(cont, t(`${op.kind === 'merge' ? 'Merge' : op.kind === 'rebase' ? 'Rebase' : op.kind} abschließen`, `finish the ${op.kind}`), 'save');
            add('git status', t('Stand prüfen', 'check the state'), 'look');
            add(abort, t('abbrechen', 'abort'), 'undo', { danger: true });
        }
        return out;
    }

    // 1a. conflicts without an operation in progress: a `git stash pop/apply` ran into one.
    // Nothing to commit or continue; `git reset --merge` goes back (the stash entry is kept).
    if (!op && conflicts.length) {
        add(`nano ${arg(conflicts[0])}`, t(`Konflikt in **${shown(conflicts[0])}** lösen (Marker entfernen, speichern)`, `resolve the conflict in **${shown(conflicts[0])}** (remove markers, save)`), 'fix');
        add(`git add ${arg(conflicts[0])}`, t('danach als gelöst markieren', 'then mark it as resolved'), 'stage');
        add('git reset --merge', t('abbrechen – zurück zum Stand vorher (der Stash-Eintrag bleibt)', 'cancel – back to the state before (the stash entry is kept)'), 'undo', { danger: true });
        return out;
    }
    // … and once it is resolved, the stash entry is still there
    if (!op && repo.stash.length && events.some(e => e.type === 'conflict-resolved') && !conflicts.length) {
        add('git stash drop', t('den Stash-Eintrag löschen – seine Änderungen sind jetzt eingebaut', 'drop the stash entry – its changes are now in place'), 'act');
    }

    // 1b. a push was just rejected: the server has commits you do not have yet
    const pushRejected = (run?.commands || []).some(c => c.name === 'git' && c.info?.push?.rejected);
    if (pushRejected) {
        add('git pull', t('erst die neuen Commits vom Server holen und mit deinen zusammenführen – danach klappt `git push`', 'first get the new commits from the server and merge them with yours – then `git push` works'), 'sync');
    }

    // 2. identity
    if (!repo.identity) {
        add('git config --global user.name ""', t('Git deinen Namen sagen (steht in jedem Commit)', 'tell git your name (it goes into every commit)'), 'setup', { cursorBack: 1 });
        add('git config --global user.email ""', t('und deine E-Mail-Adresse', 'and your email address'), 'setup', { cursorBack: 1 });
    }

    // 3. changes in the working directory / staging area
    const untracked = st.untrackedFiles;
    const modified = st.unstaged.map(u => u.path);
    const staged = st.staged;
    if (staged.length) {
        add('git commit -m ""', t(`die ${staged.length === 1 ? 'vorgemerkte Änderung' : `${staged.length} vorgemerkten Änderungen`} als Commit speichern`, `save the ${staged.length === 1 ? 'staged change' : `${staged.length} staged changes`} as a commit`), 'save', { cursorBack: 1 });
        add('git diff --staged', t('prüfen, was genau in den Commit kommt', 'check exactly what goes into the commit'), 'look');
    }
    if (modified.length) {
        add(modified.length === 1 ? `git add ${arg(modified[0])}` : addAll, t(modified.length === 1 ? `die Änderung an **${shown(modified[0])}** vormerken` : `alle ${modified.length} Änderungen vormerken`, modified.length === 1 ? `stage the change to **${shown(modified[0])}**` : `stage all ${modified.length} changes`), 'stage');
        add('git diff', t('ansehen, was du geändert hast', 'see what you changed'), 'look');
    }
    if (untracked.length) {
        add(untracked.length === 1 ? `git add ${arg(untracked[0])}` : addAll, t(untracked.length === 1 ? `die neue Datei **${shown(untracked[0])}** vormerken` : `die ${untracked.length} neuen Dateien vormerken`, untracked.length === 1 ? `stage the new file **${shown(untracked[0])}**` : `stage the ${untracked.length} new files`), 'stage');
    }
    if (staged.length) add(`git restore --staged ${arg(staged[0].path)}`, t(`**${shown(staged[0].path)}** wieder aus der Staging-Area nehmen`, `take **${shown(staged[0].path)}** out of the staging area again`), 'undo');
    if (modified.length) add(`git restore ${arg(modified[0])}`, t(`Änderungen an **${shown(modified[0])}** verwerfen`, `discard the changes to **${shown(modified[0])}**`), 'undo', { danger: true });

    // 4. empty repository
    if (repo.head.unborn && !staged.length && !untracked.length && !modified.length) {
        add('echo "# Website" > README.md', t('eine erste Datei anlegen', 'create a first file'), 'act');
    }

    // 5. history and branches
    const head = repo.head;
    if (head.detached) {
        add('git switch -', t('zurück zum vorherigen Branch', 'back to the previous branch'), 'nav');
        add('git switch -c ', t('hier einen Branch anlegen, um weiterzuarbeiten', 'create a branch here to keep working'), 'branch');
    }
    const up = head.branch ? repo.upstreams[head.branch] : null;
    if (up && !up.gone) {
        if (up.ahead && !up.behind && st.clean && !pushRejected) add('git push', t(`${up.ahead} Commit${up.ahead === 1 ? '' : 's'} zum Server hochladen`, `upload ${up.ahead} commit${up.ahead === 1 ? '' : 's'} to the server`), 'sync');
        if (up.behind && !up.ahead) add('git pull', t(`${up.behind} neue${up.behind === 1 ? 'n Commit' : ' Commits'} vom Server übernehmen`, `get ${up.behind} new commit${up.behind === 1 ? '' : 's'} from the server`), 'sync');
        if (up.behind && up.ahead) add('git pull', t('die Commits vom Server mit deinen zusammenführen (danach pushen)', 'merge the server\'s commits with yours (then push)'), 'sync');
    }
    if (repo.remotes.length && head.branch && !up && repo.commits.size && !head.unborn) {
        add(`git push -u ${repo.remotes[0].name} ${head.branch}`, t(`den Branch **${head.branch}** zum ersten Mal hochladen`, `upload the branch **${head.branch}** for the first time`), 'sync');
    }
    if (repo.stash.length && st.clean) add('git stash pop', t('beiseitegelegte Änderungen zurückholen', 'bring back your shelved changes'), 'act');

    // a branch with commits that are not on the current branch → merge
    if (head.branch && !head.detached) {
        const currentOid = head.oid;
        for (const b of repo.branches) {
            if (b.name === head.branch || b.oid === currentOid) continue;
            const inCurrent = reachableFrom(repo.commits, currentOid).has(b.oid);
            if (!inCurrent && reachableFrom(repo.commits, b.oid).has(currentOid)) {
                add(`git merge ${b.name}`, t(`**${b.name}** in **${head.branch}** einbauen (Fast-Forward)`, `bring **${b.name}** into **${head.branch}** (fast-forward)`), 'merge');
                break;
            }
        }
    }
    // on a side branch with its own commits: the usual next step is going back
    const mainName = repo.branches.find(b => b.name === 'main' || b.name === 'master')?.name;
    if (mainName && head.branch && head.branch !== mainName && st.clean) {
        const mainOid = repo.branches.find(b => b.name === mainName).oid;
        if (!reachableFrom(repo.commits, mainOid).has(head.oid)) {
            add(`git switch ${mainName}`, t(`zurück auf **${mainName}** – deine Arbeit bleibt auf **${head.branch}**`, `back to **${mainName}** – your work stays on **${head.branch}**`), 'nav');
        }
    }
    if (st.clean && !head.detached && !head.unborn) {
        if (repo.remotes.length) add('git fetch', t('nachsehen, ob es Neues auf dem Server gibt', 'check whether the server has something new'), 'sync');
        add('git log --oneline --graph --all', t('die Geschichte als Grafik ansehen', 'look at the history as a graph'), 'look');
        add('git switch -c ', t('einen neuen Branch für eine Idee anlegen', 'create a new branch for an idea'), 'branch');
        const someFile = repo.trackedFiles.find(f => /\.(md|txt|html|css|js|py|java)$/.test(f)) || repo.trackedFiles[0];
        if (someFile) add(`nano ${arg(someFile)}`, t(`**${shown(someFile)}** bearbeiten`, `edit **${shown(someFile)}**`), 'act');
    }
    if (!out.length) add('git status', t('den aktuellen Stand ansehen', 'look at the current state'), 'look');
    return out;
}

function reachableFrom(commits, oid) {
    const seen = new Set();
    const stack = [oid];
    while (stack.length) {
        const o = stack.pop();
        if (!o || seen.has(o)) continue;
        seen.add(o);
        const c = commits.get(o);
        if (c) stack.push(...c.parents);
    }
    return seen;
}
