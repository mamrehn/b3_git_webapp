// Line T – teamwork with the simulated server git.sim: clone, push, pull, pull requests.

import { t, SERVER_PATH, menuHtml, serverWithHistory, teammateClone, studentClone, msg } from './common.js';
import { lang } from '../../core/i18n.js';
import { q } from '../kit.js';

const de = () => lang() === 'de';
const isGit = (e, sub) => e.name === 'git' && e.args[0] === sub;
const URL = `https://git.sim/${SERVER_PATH}.git`;

export const TEAM_LINE = [
    {
        id: 't1',
        line: 'team',
        code: 'T1',
        title: t('Ins Team einsteigen', 'Joining the team'),
        summary: t(
            'Ein Repository vom (simulierten) Server klonen und sich darin umsehen.',
            'Clone a repository from the (simulated) server and look around.',
        ),
        story: t(
            `Willkommen im Website-Team der Bäckerei! Sam, Alex und Mia arbeiten schon eine Weile daran. Der Code liegt auf dem Server **git.sim** – einem simulierten Server, der nur in deinem Browser existiert (erkennbar an der violetten Markierung). Hol dir deine eigene Kopie:\n\n\`${URL}\``,
            `Welcome to the bakery's website team! Sam, Alex and Mia have been working on it for a while. The code lives on the server **git.sim** – a simulated server that exists only in your browser (look for the violet marker). Get your own copy:\n\n\`${URL}\``,
        ),
        async setup(kit) {
            await serverWithHistory(kit, { days: 6 });
        },
        start: '~',
        objectives: [
            {
                text: t('Klone das Repository der Website.', 'Clone the website repository.'),
                hints: [
                    t('`git clone <adresse>` lädt ein Repository komplett herunter und legt einen Ordner dafür an.', '`git clone <address>` downloads a whole repository and creates a folder for it.'),
                    t(`\`git clone ${URL}\``, `\`git clone ${URL}\``),
                ],
                // any folder name and place is fine
                check: async c => {
                    for (const dir of await c.findRepos()) {
                        if (String(await c.config(dir, 'remote.origin.url') || '').includes(SERVER_PATH)) {
                            c.data.cloneDir = dir;
                            c.data.cloneName = dir.split('/').pop();
                            return true;
                        }
                    }
                    return false;
                },
            },
            {
                text: t('Wechsle in den neuen Ordner.', 'Change into the new folder.'),
                hints: [d => t(`\`cd ${d.cloneName || 'website'}\``, `\`cd ${d.cloneName || 'website'}\``)],
                check: c => Boolean(c.state.repo) && c.state.repo.dir === c.data.cloneDir,
            },
            {
                text: t('Sieh nach, welchen Server dein Repository kennt.', 'Check which server your repository knows.'),
                hints: [
                    t('Server heißen in Git *Remotes*. `-v` zeigt die Adressen.', 'In git, servers are called *remotes*. `-v` shows the addresses.'),
                    t('`git remote -v`', '`git remote -v`'),
                ],
                check: c => c.ran(e => isGit(e, 'remote')),
            },
            {
                text: t('Zeig alle Branches – auch die, die dein Repository vom Server kennt.', 'Show all branches – including the ones your repository knows from the server.'),
                hints: [t('`git branch -a` (*all*)', '`git branch -a` (*all*)')],
                check: c => c.ran(e => isGit(e, 'branch') && e.args.some(a => a === '-a' || a === '--all' || a === '-r' || a === '--remotes')),
            },
            {
                text: t('Wer hat bisher am Projekt gearbeitet? Sieh dir die Geschichte an.', 'Who has worked on the project so far? Look at the history.'),
                hints: [t('`git log` – oder kompakt `git shortlog -sn`', '`git log` – or compact: `git shortlog -sn`')],
                check: c => c.ran(e => isGit(e, 'log') || isGit(e, 'shortlog')),
            },
        ],
        debrief: t(
            '`git clone` hat drei Dinge auf einmal erledigt:\n\n- das **komplette** Repository samt Geschichte kopiert\n- den Server unter dem Namen [[origin|`origin`]] eingetragen\n- den Branch `main` ausgecheckt\n\n`origin/main` ist dein lokales Bild vom Stand des Servers (ein [[remote-tracking|Remote-Tracking-Branch]]). Es ändert sich nur, wenn du mit dem Server sprichst – mit `fetch`, `pull` oder `push`.',
            '`git clone` did three things at once:\n\n- copied the **complete** repository with its history\n- registered the server under the name [[origin|`origin`]]\n- checked out the branch `main`\n\n`origin/main` is your local picture of the server\'s state (a [[remote-tracking|remote-tracking branch]]). It only changes when you talk to the server – with `fetch`, `pull` or `push`.',
        ),
        learned: ['git clone <url>', 'git remote -v', 'git branch -a'],
    },
    {
        id: 't2',
        line: 'team',
        code: 'T2',
        title: t('Die erste Lieferung', 'Your first delivery'),
        summary: t(
            'Commits mit `git push` auf den Server bringen, damit das Team sie bekommt.',
            'Bring commits to the server with `git push` so the team gets them.',
        ),
        story: t(
            'Alex bittet dich: „Kannst du im Footer der Startseite noch den Link zum Impressum ergänzen? `<a href="impressum.html">Impressum</a>` reicht.“ Mach die Änderung – und liefere sie auf den Server, damit alle sie bekommen.',
            'Alex asks you: "Could you add a link to the legal notice in the footer of the home page? `<a href="legal.html">Legal notice</a>` is enough." Make the change – and deliver it to the server so everybody gets it.',
        ),
        async setup(kit) {
            await serverWithHistory(kit, { days: 5 });
            await studentClone(kit);
            kit.remember('serverStart', await kit.headOf('website', 'origin/main'));
        },
        start: '~/website',
        objectives: [
            {
                text: t('Ergänze den Link im Footer von `index.html` und committe.', 'Add the link to the footer of `index.html` and commit.'),
                hints: [
                    t('Datei öffnen (Dateibaum oder `nano index.html`), Link in die Zeile mit `<footer>` schreiben, speichern.', 'Open the file (file tree or `nano index.html`), put the link into the `<footer>` line, save.'),
                    t('`git commit -am "Link zum Impressum"`', '`git commit -am "Link to the legal notice"`'),
                ],
                check: async c => {
                    const head = await c.refOid('website', 'main');
                    return Boolean(head) && head !== c.data.serverStart && await c.isAncestor('website', c.data.serverStart, head);
                },
            },
            {
                text: t('Sieh nach, wie dein Branch zum Server steht.', 'Check how your branch relates to the server.'),
                hints: [t('`git status` – achte auf die Zeile „Your branch is ahead of …“.', '`git status` – look for the line "Your branch is ahead of …".')],
                check: c => c.ran(e => isGit(e, 'status')),
            },
            {
                text: t('Liefere deinen Commit auf den Server.', 'Deliver your commit to the server.'),
                hints: [
                    t('*Schieben* heißt auf Englisch …', 'The word you need means *to shove* …'),
                    t('`git push`', '`git push`'),
                ],
                check: async c => {
                    const server = await c.serverRef(SERVER_PATH, 'main');
                    return Boolean(server) && server !== c.data.serverStart && server === (await c.refOid('website', 'main'));
                },
            },
        ],
        debrief: t(
            '`git push` schickt deine Commits zum Server und verschiebt dort den Branch. Danach zeigen `main` und `origin/main` auf denselben Commit: „up to date“.\n\nGepusht wird nur, was **committet** ist – nicht vorgemerkte oder ungespeicherte Änderungen bleiben bei dir. Im Terminal hat die violette Markierung **SIMULIERT** gezeigt: Diese Lieferung ging an den Server in deinem Browser, nicht ins Internet.',
            '`git push` sends your commits to the server and moves the branch there. Afterwards `main` and `origin/main` point to the same commit: "up to date".\n\nOnly what is **committed** gets pushed – unstaged or unsaved changes stay with you. In the terminal the violet marker **SIMULATED** showed that this delivery went to the server in your browser, not to the internet.',
        ),
        learned: ['git push', 'git status'],
    },
    {
        id: 't3',
        line: 'team',
        code: 'T3',
        title: t('Wenn andere schneller waren', 'When someone was faster'),
        summary: t(
            'Ein abgelehnter Push, `git pull` und warum man nicht einfach `--force` nimmt.',
            'A rejected push, `git pull` and why you do not just use `--force`.',
        ),
        story: t(
            'Die Bäckerei hat eine neue Telefonnummer: **0911 246810**. Trag sie auf der Kontaktseite ein. Aber Achtung – im Team arbeiten alle gleichzeitig. Was passiert, wenn jemand anderes vor dir pusht?',
            'The bakery has a new phone number: **0911 246810**. Put it on the contact page. But careful – everyone in the team works at the same time. What happens when someone else pushes before you?',
        ),
        async setup(kit) {
            await serverWithHistory(kit, { days: 4 });
            await teammateClone(kit, 'mia');
            await studentClone(kit);
            kit.remember('serverStart', await kit.headOf('website', 'origin/main'));
        },
        start: '~/website',
        objectives: [
            {
                text: t('Ändere die Telefonnummer in `contact.html` und committe.', 'Change the phone number in `contact.html` and commit.'),
                hints: [t('Datei öffnen, Nummer ändern, speichern – dann `git commit -am "Neue Telefonnummer"`', 'Open the file, change the number, save – then `git commit -am "New phone number"`')],
                check: async c => {
                    const head = await c.refOid('website', 'main');
                    return Boolean(head) && head !== c.data.serverStart && await c.isAncestor('website', c.data.serverStart, head);
                },
                // meanwhile Mia pushes a change of her own
                async after(kit) {
                    const oid = await kit.teammate('mia', SERVER_PATH, {
                        files: { 'menu.html': menuHtml().replace(/(<\/ul>)/, de() ? '    <li>Zimtschnecke – 2,20 €</li>\n$1' : '    <li>Cinnamon roll – €2.20</li>\n$1') },
                        message: msg(t('Zimtschnecken ins Sortiment', 'Add cinnamon rolls to the menu')),
                    });
                    kit.remember('miaCommit', oid);
                },
            },
            {
                text: t('Versuch, deinen Commit zu pushen.', 'Try to push your commit.'),
                hints: [t('`git push` – und lies die Antwort genau.', '`git push` – and read the answer carefully.')],
                check: c => c.ran(e => isGit(e, 'push')),
            },
            {
                text: t('Hol dir Mias Arbeit und führe sie mit deiner zusammen.', 'Get Mia\'s work and combine it with yours.'),
                hints: [
                    t('Der Server hat einen Commit, den du nicht hast. Hol ihn ab – das *Gegenteil* von push.', 'The server has a commit you do not have. Fetch it – the *opposite* of push.'),
                    t('`git pull` (= `git fetch` + `git merge`). Die vorgeschlagene Merge-Nachricht mit **Übernehmen** bestätigen.', '`git pull` (= `git fetch` + `git merge`). Confirm the suggested merge message with **Accept**.'),
                ],
                check: async c => Boolean(c.data.miaCommit) && await c.isAncestor('website', c.data.miaCommit, await c.refOid('website', 'main')),
            },
            {
                text: t('Jetzt klappt der Push.', 'Now the push works.'),
                hints: [t('`git push`', '`git push`')],
                check: async c => {
                    const server = await c.serverRef(SERVER_PATH, 'main');
                    return Boolean(server) && server === (await c.refOid('website', 'main')) && await c.isAncestor('website', c.data.miaCommit, server);
                },
            },
        ],
        debrief: t(
            'Der Server nimmt einen Push nur an, wenn dabei nichts verloren geht. Hat jemand anderes vorher gepusht, lehnt er ab (*rejected – fetch first*). Dann:\n\n1. `git pull` holt die neuen Commits und führt sie mit deinen zusammen\n2. `git push` klappt jetzt\n\nNiemals `git push --force`, nur um eine Ablehnung loszuwerden: Das überschreibt den Server und löscht Mias Commit für alle. Tipp: Vor dem Arbeiten `git pull` – dann gibt es seltener Überraschungen.',
            'The server only accepts a push if nothing gets lost. If someone else pushed first, it refuses (*rejected – fetch first*). Then:\n\n1. `git pull` fetches the new commits and combines them with yours\n2. `git push` works now\n\nNever `git push --force` just to get rid of a rejection: it overwrites the server and deletes Mia\'s commit for everybody. Tip: `git pull` before you start working – fewer surprises.',
        ),
        learned: ['git pull', 'git fetch', 'git push'],
    },
    {
        id: 't4',
        line: 'team',
        code: 'T4',
        title: t('Feature-Branch und Pull Request', 'Feature branch and pull request'),
        summary: t(
            'Der Team-Ablauf: eigener Branch, Push mit `-u`, Review, Merge auf dem Server, aufräumen.',
            'The team workflow: own branch, push with `-u`, review, merge on the server, clean up.',
        ),
        story: d => t(
            `Im Team arbeitet niemand direkt auf \`main\`. Jede Änderung bekommt einen eigenen Branch, wird gepusht, und Sam sieht sie sich an (ein *Pull Request*), bevor sie in \`main\` landet.\n\nDeine Aufgabe: ein „Angebot der Woche“ auf der Seite \`${d.page}\`.`,
            `Nobody in the team works on \`main\` directly. Every change gets its own branch, is pushed, and Sam reviews it (a *pull request*) before it lands in \`main\`.\n\nYour task: an "offer of the week" on the page \`${d.page}\`.`,
        ),
        async setup(kit) {
            kit.remember('branch', de() ? 'angebot-der-woche' : 'weekly-offer');
            kit.remember('page', de() ? 'angebot.html' : 'offer.html');
            await serverWithHistory(kit, { days: 4 });
            await studentClone(kit);
        },
        start: '~/website',
        objectives: [
            {
                text: d => t(`Erstelle den Branch \`${d.branch}\`, lege dort \`${d.page}\` an und committe.`, `Create the branch \`${d.branch}\`, add \`${d.page}\` there and commit.`),
                hints: [
                    d => t(`\`git switch -c ${d.branch}\`, Datei anlegen, \`git add ${d.page}\`, \`git commit -m "Angebot der Woche"\``, `\`git switch -c ${d.branch}\`, create the file, \`git add ${d.page}\`, \`git commit -m "Offer of the week"\``),
                ],
                check: async c => (await c.committedText('website', c.data.page, c.data.branch)) !== null,
            },
            {
                text: t('Pushe den Branch auf den Server – so, dass Git sich die Verbindung merkt.', 'Push the branch to the server – so that git remembers the connection.'),
                hints: [
                    t('Ein neuer Branch existiert auf dem Server noch nicht. `-u` (*upstream*) legt ihn an und verbindet beide.', 'A new branch does not exist on the server yet. `-u` (*upstream*) creates it and connects both.'),
                    d => t(`\`git push -u origin ${d.branch}\``, `\`git push -u origin ${d.branch}\``),
                ],
                check: async c => {
                    const server = await c.serverRef(SERVER_PATH, c.data.branch);
                    return Boolean(server) && server === (await c.refOid('website', c.data.branch));
                },
                // Sam reviews and merges the pull request on the server
                async after(kit, c) {
                    const dir = kit.teammateDir('sam', SERVER_PATH);
                    const branch = c.data.branch;
                    await kit.sh(dir, ['git switch -q main', 'git pull -q --no-rebase origin main', `git fetch -q origin ${branch}`, `git merge --no-ff -m ${q(msg(t(`Merge pull request #12 from ${branch}`, `Merge pull request #12 from ${branch}`)))} origin/${branch}`]);
                    await kit.teammatePush('sam', SERVER_PATH, { branch: 'main' });
                    kit.remember('prMerge', await kit.headOf(dir));
                },
            },
            {
                text: t('Sam hat deinen Pull Request angenommen und auf dem Server gemergt. Wechsle auf `main` und hol dir den neuen Stand.', 'Sam accepted your pull request and merged it on the server. Switch to `main` and get the new state.'),
                hints: [t('`git switch main` und dann `git pull`', '`git switch main` and then `git pull`')],
                check: async c => Boolean(c.data.prMerge) && await c.isAncestor('website', c.data.prMerge, await c.refOid('website', 'main')),
            },
            {
                text: d => t(`Räum auf: Lösche deinen Branch \`${d.branch}\` lokal.`, `Clean up: delete your branch \`${d.branch}\` locally.`),
                hints: [d => t(`\`git branch -d ${d.branch}\``, `\`git branch -d ${d.branch}\``)],
                check: async c => !(await c.branchExists('website', c.data.branch)),
            },
        ],
        debrief: t(
            'So arbeiten die meisten Teams:\n\n1. Branch anlegen, Commits machen\n2. `git push -u origin <branch>`\n3. Pull Request öffnen → Review → Merge auf dem Server\n4. `git switch main` und `git pull`\n5. Branch löschen\n\nDen Pull Request selbst gibt es nicht in Git, sondern auf Plattformen wie GitHub oder GitLab. Git liefert die Zutaten: Branches, Push und Merge. In der Sandbox kannst du das mit einem echten GitHub-Repository ausprobieren.',
            'This is how most teams work:\n\n1. Create a branch, make commits\n2. `git push -u origin <branch>`\n3. Open a pull request → review → merge on the server\n4. `git switch main` and `git pull`\n5. Delete the branch\n\nThe pull request itself is not part of git but of platforms like GitHub or GitLab. Git provides the ingredients: branches, push and merge. In the sandbox you can try this with a real GitHub repository.',
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
                    `Dein Branch heißt \`${d.otherName}\` – die Mission erwartet \`${d.branch}\`. Umbenennen: \`git branch -m ${d.branch}\`.`,
                    `Your branch is called \`${d.otherName}\` – the mission expects \`${d.branch}\`. Rename it: \`git branch -m ${d.branch}\`.`,
                ),
            },
        ],
        learned: ['git switch -c <branch>', 'git push -u origin <branch>', 'git pull', 'git branch -d <branch>'],
    },
];
