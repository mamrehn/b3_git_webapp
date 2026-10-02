// Git config files. isomorphic-git only reads .git/config, so the global
// ~/.gitconfig (user.name, init.defaultBranch, …) is handled here.

export function parseConfig(text) {
    // returns [{ section: 'remote.origin', key: 'url', value: '…' }]
    const entries = [];
    let section = null;
    for (const raw of String(text || '').split('\n')) {
        const line = raw.replace(/^\s+|\s+$/g, '');
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const sec = line.match(/^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]$/);
        if (sec) {
            section = sec[2] !== undefined ? `${sec[1].toLowerCase()}.${sec[2]}` : sec[1].toLowerCase();
            continue;
        }
        if (!section) continue;
        const kv = line.match(/^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/);
        if (!kv) continue;
        let value = kv[2] === undefined ? 'true' : kv[2];
        value = value.replace(/\s+[#;].*$/, '');
        if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
        entries.push({ section, key: kv[1].toLowerCase(), value });
    }
    return entries;
}

function splitPath(path) {
    // "remote.origin.url" → { section: 'remote.origin', key: 'url' }
    const first = path.indexOf('.');
    const last = path.lastIndexOf('.');
    if (first === -1 || first === last && first === path.length - 1) return null;
    const section = path.slice(0, last);
    const key = path.slice(last + 1);
    const head = section.indexOf('.');
    const normSection = head === -1 ? section.toLowerCase() : section.slice(0, head).toLowerCase() + section.slice(head);
    return { section: normSection, key: key.toLowerCase() };
}

function quoteValue(v) {
    if (/^[\w@./:+-][\w @./:+-]*$/.test(v) && !/\s$/.test(v)) return v;
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function serializeConfig(entries) {
    const bySection = new Map();
    for (const e of entries) {
        if (!bySection.has(e.section)) bySection.set(e.section, []);
        bySection.get(e.section).push(e);
    }
    let out = '';
    for (const [section, items] of bySection) {
        const dot = section.indexOf('.');
        out += dot === -1 ? `[${section}]\n` : `[${section.slice(0, dot)} "${section.slice(dot + 1)}"]\n`;
        for (const e of items) out += `\t${e.key} = ${quoteValue(e.value)}\n`;
    }
    return out;
}

export class ConfigFile {
    constructor(pfs, path) {
        this.pfs = pfs;
        this.path = path;
    }

    async entries() {
        try {
            return parseConfig(await this.pfs.readFile(this.path, 'utf8'));
        } catch {
            return [];
        }
    }

    async get(path) {
        const p = splitPath(path);
        if (!p) return undefined;
        const all = (await this.entries()).filter(e => e.section === p.section && e.key === p.key);
        return all.length ? all[all.length - 1].value : undefined;
    }

    async getAll(path) {
        const p = splitPath(path);
        if (!p) return [];
        return (await this.entries()).filter(e => e.section === p.section && e.key === p.key).map(e => e.value);
    }

    async set(path, value) {
        const p = splitPath(path);
        if (!p) throw new Error(`invalid key: ${path}`);
        const entries = await this.entries();
        const idx = entries.map((e, i) => (e.section === p.section && e.key === p.key ? i : -1)).filter(i => i !== -1);
        if (value === undefined) {
            for (const i of idx.reverse()) entries.splice(i, 1);
        } else if (idx.length) {
            entries[idx[idx.length - 1]].value = value;
        } else {
            // insert after the last entry of the same section to keep sections together
            let insertAt = entries.length;
            for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].section === p.section) { insertAt = i + 1; break; }
            }
            entries.splice(insertAt, 0, { section: p.section, key: p.key, value });
        }
        await this.pfs.writeFile(this.path, serializeConfig(entries), 'utf8');
        return idx.length > 0;
    }

    async removeSection(section) {
        const entries = (await this.entries()).filter(e => e.section !== section);
        await this.pfs.writeFile(this.path, serializeConfig(entries), 'utf8');
    }

    async renameSection(from, to) {
        const entries = await this.entries();
        for (const e of entries) if (e.section === from) e.section = to;
        await this.pfs.writeFile(this.path, serializeConfig(entries), 'utf8');
    }
}

export function isValidKey(path) {
    return /^[A-Za-z][A-Za-z0-9-]*(\.[^\n]+)?\.[A-Za-z][A-Za-z0-9-]*$/.test(path);
}
