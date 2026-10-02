// Command registry. Every command carries a small spec that powers
// --help, `man`, tab completion and the live explanation bar.
//
// spec = {
//   name, summary: {de,en}, usage: 'ls [-la] [path…]',
//   options: [{ flags: ['-a', '--all'], arg?: 'N', desc: {de,en} }],
//   operands: 'path' | 'dir' | 'file' | 'command' | null,   // for completion
//   category: 'files' | 'text' | 'system' | 'git' | 'editor',
//   run: async ctx => status,
// }

export class Registry {
    constructor() {
        this.map = new Map();
    }

    register(spec) {
        this.map.set(spec.name, spec);
        for (const alias of spec.aliases || []) {
            this.map.set(alias, { ...spec, name: alias, aliasOf: spec.name });
        }
    }

    get(name) {
        return this.map.get(name) || null;
    }

    has(name) {
        return this.map.has(name);
    }

    names({ includeHidden = false } = {}) {
        return [...this.map.values()]
            .filter(s => includeHidden || !s.hidden)
            .map(s => s.name)
            .sort();
    }

    specs() {
        return [...this.map.values()].filter(s => !s.aliasOf && !s.hidden);
    }
}

// getopt-style parsing.
//   bool:   ['a', 'l', 'all', ...]        (short letters and long names)
//   value:  ['n', 'lines', 'm', ...]      (options that take an argument)
//   alias:  { all: 'a', lines: 'n' }     (long → canonical)
// Returns { opts, rest, unknown } where opts maps canonical names to true / value / [values].
export function getopt(args, { bool = [], value = [], alias = {}, multi = [], stopAtFirstOperand = false } = {}) {
    const opts = {};
    const rest = [];
    const unknown = [];
    const canon = name => alias[name] || name;
    const set = (name, v) => {
        const key = canon(name);
        if (multi.includes(key)) (opts[key] ||= []).push(v);
        else opts[key] = v;
    };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--') {
            rest.push(...args.slice(i + 1));
            break;
        }
        if (a.startsWith('--') && a.length > 2) {
            const eq = a.indexOf('=');
            const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
            if (value.includes(name) || value.includes(canon(name))) {
                if (eq !== -1) set(name, a.slice(eq + 1));
                else if (i + 1 < args.length) set(name, args[++i]);
                else unknown.push({ option: a, missingValue: true });
            } else if (bool.includes(name) || bool.includes(canon(name))) {
                set(name, true);
            } else if (name.startsWith('no-') && (bool.includes(name.slice(3)) || bool.includes(canon(name.slice(3))))) {
                set(name.slice(3), false);
            } else {
                unknown.push({ option: a });
            }
            continue;
        }
        if (a.startsWith('-') && a.length > 1 && !/^-\d+$/.test(a)) {
            for (let j = 1; j < a.length; j++) {
                const ch = a[j];
                if (value.includes(ch)) {
                    const inline = a.slice(j + 1);
                    if (inline) set(ch, inline);
                    else if (i + 1 < args.length) set(ch, args[++i]);
                    else unknown.push({ option: '-' + ch, missingValue: true });
                    break;
                }
                if (bool.includes(ch)) set(ch, true);
                else unknown.push({ option: '-' + ch });
            }
            continue;
        }
        if (/^-\d+$/.test(a) && value.includes('#')) {
            set('#', a.slice(1));
            continue;
        }
        rest.push(a);
        if (stopAtFirstOperand) {
            rest.push(...args.slice(i + 1));
            break;
        }
    }
    return { opts, rest, unknown };
}
