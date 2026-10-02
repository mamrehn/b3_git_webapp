// Where does a remote URL lead? Simulated server (git.sim) or the real internet.
// Students must always be able to tell the two apart, so every network command
// announces which one it talks to (see `announce`).

import { CONFIG } from '../config.js';
import { gitHttp } from '../lib.js';
import { createSimServer } from './simserver.js';
import { emit } from '../core/events.js';
import { GitError } from './errors.js';

export function parseRemoteUrl(url) {
    if (/^[\w.-]+@[\w.-]+:/.test(url) || url.startsWith('ssh://')) return { kind: 'ssh', url };
    if (url.startsWith('file://') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return { kind: 'path', url };
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'unsupported', url };
        if (u.host === CONFIG.simulatedHost) return { kind: 'simulated', url, host: u.host, path: u.pathname };
        return { kind: 'real', url, host: u.host, path: u.pathname };
    } catch {
        return { kind: 'unsupported', url };
    }
}

export function isSimulated(url) {
    return parseRemoteUrl(url).kind === 'simulated';
}

const servers = new WeakMap();

export function simServerFor(world) {
    if (!servers.has(world)) {
        servers.set(world, createSimServer(world, { onEvent: e => emit('sim:server', { world, ...e }) }));
    }
    return servers.get(world);
}

// ---- CORS proxy discovery (only when a real network command runs) -------------------------
//
// Requests go to "<proxy>/<full url>". isomorphic-git's own corsProxy option strips the
// "https://" from the target, which not every deployed version of our worker accepts;
// the full form works with all of them.

let proxyPromise = null;

function proxied(proxy, url) {
    return `${proxy}/${url}`;
}

async function probe(proxy) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(proxied(proxy, 'https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack'), { signal: controller.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export function findProxy() {
    if (!proxyPromise) {
        proxyPromise = (async () => {
            for (const p of CONFIG.corsProxies) {
                if (await probe(p)) {
                    emit('net:proxy', { proxy: p, ok: true });
                    return p;
                }
            }
            emit('net:proxy', { proxy: CONFIG.corsProxies[0], ok: false });
            proxyPromise = null; // nothing answered: probe again next time
            return CONFIG.corsProxies[0];
        })();
    }
    return proxyPromise;
}

export function resetProxyChoice() {
    proxyPromise = null;
}

export async function transportFor(world, url) {
    const info = parseRemoteUrl(url);
    if (info.kind === 'simulated') return { ...info, http: simServerFor(world), corsProxy: undefined };
    if (info.kind === 'real') {
        // missions are offline by design: only the simulated server exists there
        if (world.kind === 'mission') {
            throw new GitError(`fatal: unable to access '${url.replace(/\/?$/, '/')}': Could not resolve host: ${info.host}`, { status: 128, kind: 'mission-offline', data: { host: info.host } });
        }
        const http = gitHttp();
        if (!http) throw new GitError('fatal: the HTTP transport is not loaded (offline?)', { status: 128, kind: 'no-http' });
        const proxy = await findProxy();
        return { ...info, http: { request: args => http.request({ ...args, url: proxied(proxy, args.url) }) }, corsProxy: undefined, proxy };
    }
    if (info.kind === 'ssh') {
        throw new GitError(`fatal: Could not read from remote repository.\n\nSSH (${url}) is not possible inside a web browser.\nUse the https:// address of the repository instead.`, { status: 128, kind: 'ssh-unsupported' });
    }
    if (info.kind === 'path') {
        throw new GitError(`fatal: '${url}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, { status: 128, kind: 'path-remote' });
    }
    throw new GitError(`fatal: Unable to find remote helper for '${url.split(':')[0]}'`, { status: 128, kind: 'unsupported-url' });
}

// One clearly styled line before every network operation (rendered by the terminal UI,
// not part of the command's output, so pipes and redirects are unaffected).
export function announce(g, { url, remote = null, action }) {
    const info = parseRemoteUrl(url);
    g.info.network = { kind: info.kind, url, remote, action, host: info.host };
    g.ui?.annotate?.({ type: 'network', kind: info.kind, url, remote, action, host: info.host });
}
