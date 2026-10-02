// Test harness: runs the browser modules in Node with an in-memory file system,
// and can run the same scenario through real git for output comparisons.
import git from 'isomorphic-git';
import * as Diff from 'diff';
import { Volume, createFsFromVolume } from 'memfs';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

globalThis.git = git;
globalThis.Diff = Diff;

const { World } = await import('../src/vfs/world.js');
const { Shell } = await import('../src/shell/exec.js');
const { buildRegistry } = await import('../src/shell/commands/index.js');
const { registerGit } = await import('../src/git/gitcmd.js');
const { setClock } = await import('../src/git/clock.js');

registerGit();

export const FIXED_TIME = 1767225600; // 2026-01-01 00:00:00 UTC

export function stripAnsi(s) {
    return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

export async function makeEnv({ id = 'test', kind = 'sandbox', identity = true, fixedClock = true } = {}) {
    setClock(fixedClock ? () => FIXED_TIME : null);
    const vol = new Volume();
    const fs = createFsFromVolume(vol);
    const world = new World({ id, kind, fs });
    await world.open();
    let gitconfig = '[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n';
    if (identity) gitconfig = '[user]\n\tname = Student\n\temail = student@example.com\n' + gitconfig;
    await world.pfs.writeFile('/home/student/.gitconfig', gitconfig, 'utf8');
    let output = '';
    const ui = {
        write(s) { output += s; },
        columns: () => 80,
        clear() { output += '[clear]'; },
        async page(text) { output += text; },
        editResponses: [],
        async edit(path) {
            ui.edited = path;
            const next = ui.editResponses.shift();
            if (next === undefined) return { saved: false };
            if (typeof next === 'function') {
                const current = await world.pfs.readFile(path, 'utf8');
                const content = next(current);
                await world.pfs.writeFile(path, content, 'utf8');
                return { saved: true, content };
            }
            await world.pfs.writeFile(path, next, 'utf8');
            return { saved: true, content: next };
        },
        async readInteractive() { return ''; },
    };
    const registry = buildRegistry();
    const shell = new Shell({ registry, ui });
    shell.setWorld(world);
    const run = async (line, { tty = true } = {}) => {
        output = '';
        const res = await shell.runLine(line, { tty });
        return { ...res, out: stripAnsi(output), raw: output };
    };
    const pfs = world.pfs;
    const write = (path, text) => pfs.writeFile(world.resolve(path), text, 'utf8');
    const read = path => pfs.readFile(world.resolve(path), 'utf8');
    return { world, shell, ui, run, pfs, write, read, vol };
}

// Run a bash script with real git in a temp dir; same identity and fixed dates.
export function realGit(script) {
    const dir = mkdtempSync(join(tmpdir(), 'realgit-'));
    try {
        const env = {
            ...process.env,
            HOME: dir,
            LANG: 'C', LC_ALL: 'C', LANGUAGE: 'C',
            GIT_AUTHOR_NAME: 'Student', GIT_AUTHOR_EMAIL: 'student@example.com',
            GIT_COMMITTER_NAME: 'Student', GIT_COMMITTER_EMAIL: 'student@example.com',
            GIT_AUTHOR_DATE: `${FIXED_TIME} +0000`, GIT_COMMITTER_DATE: `${FIXED_TIME} +0000`,
            GIT_CONFIG_NOSYSTEM: '1', GIT_PAGER: 'cat', PAGER: 'cat', TZ: 'UTC',
        };
        execSync('git config --global init.defaultBranch main && git config --global user.name Student && git config --global user.email student@example.com && git config --global pull.rebase false && git config --global advice.waitingForEditor false', { cwd: dir, env });
        return execSync(script, { cwd: dir, env, encoding: 'utf8', shell: '/bin/bash', stdio: ['ignore', 'pipe', 'pipe'] });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// Runs each line of `script` in the Werkstatt and in real git and returns the output of
// every command separately – exactly, blank lines included (stdout and stderr together).
export async function runBoth(script, { setup = null, normalize = s => s } = {}) {
    // real git runs in a temporary home folder; the Werkstatt's home is /home/student
    const norm = s => normalize(s.replace(/[^\s'"]*\/realgit-\w+/g, '/home/student'));
    const lines = script.split('\n').map(l => l.trim()).filter(Boolean);
    const env = await makeEnv();
    if (setup) await setup(env);
    const ours = [];
    for (const line of lines) ours.push(norm((await env.run(line, { tty: false })).out));
    const SEP = '\u0001';
    // the last command may fail on purpose; the script itself must not
    const real = realGit(lines.map(l => `printf '${SEP}\\n'; { ${l} ; } 2>&1`).join('\n') + '\ntrue');
    const realParts = real.split(`${SEP}\n`).slice(1).map(norm);
    return { env, steps: lines.map((cmd, i) => ({ cmd, ours: ours[i], real: realParts[i] })) };
}

// assert helper: the first command whose output differs, with both versions
export function firstDifference(steps) {
    const d = steps.find(s => s.ours !== s.real);
    return d ? `$ ${d.cmd}\n--- real ---\n${d.real}--- werkstatt ---\n${d.ours}` : null;
}
