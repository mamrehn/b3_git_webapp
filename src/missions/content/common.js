// Shared story material: the website of "Bäckerei Krume" (a small bakery) and the
// team that builds it. Missions build their worlds from these pieces.

import { L, lang } from '../../core/i18n.js';

export const t = (de, en) => ({ de, en });

// Mission texts may depend on data remembered during setup (file names, commit ids)
export function val(x, data) {
    return typeof x === 'function' ? x(data || {}) : x;
}

export const TEAM = {
    sam: { name: 'Sam Becker', email: 'sam@krume.example' },
    alex: { name: 'Alex Yilmaz', email: 'alex@krume.example' },
    mia: { name: 'Mia Hoffmann', email: 'mia@krume.example' },
};

export const SERVER_PATH = 'baeckerei/website';

const de = () => lang() === 'de';

export function bakeryName() {
    return de() ? 'Bäckerei Krume' : 'Krume Bakery';
}

export function indexHtml({ hours = null, title = null, extra = '' } = {}) {
    const name = title || bakeryName();
    if (de()) {
        return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <title>${bakeryName()}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <h1>${name}</h1>
        <nav><a href="index.html">Start</a> · <a href="menu.html">Sortiment</a> · <a href="contact.html">Kontakt</a></nav>
    </header>
    <main>
        <p>Frisches Brot, Brezeln und Kuchen – jeden Morgen aus unserem Ofen.</p>
        <p>Öffnungszeiten: ${hours || 'Mo–Fr 7–18 Uhr, Sa 7–13 Uhr'}</p>
${extra}    </main>
    <footer>Bäckerei Krume · Hauptstraße 12 · 90762 Fürth</footer>
</body>
</html>
`;
    }
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>${bakeryName()}</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <h1>${name}</h1>
        <nav><a href="index.html">Home</a> · <a href="menu.html">Menu</a> · <a href="contact.html">Contact</a></nav>
    </header>
    <main>
        <p>Fresh bread, pretzels and cakes – every morning from our oven.</p>
        <p>Opening hours: ${hours || 'Mon–Fri 7am–6pm, Sat 7am–1pm'}</p>
${extra}    </main>
    <footer>Krume Bakery · 12 High Street · Fürth</footer>
</body>
</html>
`;
}

export function styleCss({ accent = '#8b4513', extra = '' } = {}) {
    return `body {
    font-family: Georgia, serif;
    background: #fdf6e3;
    color: #3b2f2f;
    max-width: 40rem;
    margin: 0 auto;
}

h1 {
    color: ${accent};
}

footer {
    font-size: 0.9rem;
    color: #7a6a5a;
}
${extra}`;
}

export function menuHtml({ pretzel = null } = {}) {
    if (de()) {
        return `<h2>Unser Sortiment</h2>
<ul>
    <li>Brezel – ${pretzel || '0,80'} €</li>
    <li>Roggenbrot – 3,90 €</li>
    <li>Apfelkuchen (Stück) – 2,50 €</li>
    <li>Croissant – 1,40 €</li>
</ul>
`;
    }
    return `<h2>Our menu</h2>
<ul>
    <li>Pretzel – €${pretzel || '0.80'}</li>
    <li>Rye bread – €3.90</li>
    <li>Apple cake (slice) – €2.50</li>
    <li>Croissant – €1.40</li>
</ul>
`;
}

export function contactHtml({ phone = '0911 123456' } = {}) {
    if (de()) {
        return `<h2>Kontakt</h2>
<p>Telefon: ${phone}</p>
<p>E-Mail: hallo@krume.example</p>
<p>Bestellungen für Torten bitte zwei Tage vorher.</p>
`;
    }
    return `<h2>Contact</h2>
<p>Phone: ${phone}</p>
<p>Email: hello@krume.example</p>
<p>Please order cakes two days in advance.</p>
`;
}

export function readme() {
    return de()
        ? '# Website der Bäckerei Krume\n\nStatische Website: `index.html`, `menu.html`, `contact.html`, `style.css`.\n'
        : '# Krume Bakery website\n\nStatic website: `index.html`, `menu.html`, `contact.html`, `style.css`.\n';
}

// Commit messages in the language the mission is played in
export function msg(entry) {
    return L(entry);
}

// The usual history of the website, written by the team over a few days.
// `dir` must already be a repository. Returns the commit ids.
export async function teamHistory(kit, dir, { days = 5 } = {}) {
    const ids = {};
    kit.at(days, '09:12');
    ids.start = await kit.commitAs('sam', dir, { files: { 'index.html': indexHtml(), 'README.md': readme() }, message: msg(t('Startseite anlegen', 'Add the home page')) });
    kit.later(47);
    ids.style = await kit.commitAs('alex', dir, { files: { 'style.css': styleCss() }, message: msg(t('Grundlegendes Styling', 'Basic styling')) });
    kit.at(days - 1, '14:03');
    ids.menu = await kit.commitAs('mia', dir, { files: { 'menu.html': menuHtml() }, message: msg(t('Sortiment mit Preisen', 'Menu with prices')) });
    kit.at(days - 2, '10:31');
    ids.contact = await kit.commitAs('sam', dir, { files: { 'contact.html': contactHtml() }, message: msg(t('Kontaktseite hinzufügen', 'Add the contact page')) });
    return ids;
}

// A teammate's repository that is connected to the simulated server and has the history
export async function serverWithHistory(kit, { path = SERVER_PATH, days = 5 } = {}) {
    const url = await kit.server(path);
    const dir = kit.teammateDir('sam', path);
    await kit.sh(dir, ['git init -q -b main', `git config user.name '${TEAM.sam.name}'`, `git config user.email '${TEAM.sam.email}'`, `git remote add origin ${url}`]);
    const ids = await teamHistory(kit, dir, { days });
    await kit.sh(dir, ['git push -q -u origin main']);
    return { url, dir, ids };
}

// Another teammate clones the server so they can push later
export async function teammateClone(kit, id, path = SERVER_PATH) {
    return kit.teammateClone(id, path);
}

// The student's own clone in ~/website
export async function studentClone(kit, { path = SERVER_PATH, dir = 'website' } = {}) {
    await kit.sh('~', [`git clone -q https://git.sim/${path}.git ${dir}`]);
    return kit.path(dir);
}

// Commands of the current objective: does any `git show …` argument point at `oid`?
export async function pointsAt(c, dir, args, oid) {
    for (const a of args) {
        if (a.startsWith('-')) continue;
        if (/^[0-9a-f]{4,40}$/.test(a) && oid.startsWith(a)) return true;
        if ((await c.refOid(dir, a)) === oid) return true;
    }
    return false;
}

// "looked at the history": a git log (with --graph if required) or the History view
export function sawHistory(e, { graph = false } = {}) {
    if (e.name === '#view') return e.args[0] === 'graph';
    return e.name === 'git' && e.args[0] === 'log' && (!graph || e.args.includes('--graph'));
}

export function short(oid) {
    return oid ? oid.slice(0, 7) : '…';
}
