// CORS proxy for the Git-Werkstatt (isomorphic-git in the browser).
//
// Browsers may not talk to git servers directly (they send no CORS headers), so git's
// smart-HTTP requests go through this worker:
//
//     https://<worker>/https://github.com/user/repo.git/info/refs?service=git-upload-pack
//
// It forwards ONLY git smart-HTTP requests (clone, fetch, pull, push) to known git hosts and
// refuses everything else. An open proxy would invite misuse under your Cloudflare account
// and could use up the free daily request quota the students depend on.
//
// Settings (wrangler.toml [vars] or the Cloudflare dashboard):
//   ALLOWED_HOSTS    comma-separated git hosts; default: github.com,gitlab.com,codeberg.org,bitbucket.org
//   ALLOWED_ORIGINS  comma-separated web origins that may use the proxy, e.g. "https://git.example-school.de";
//                    default: any origin. Setting it is recommended once the app has a fixed address.

const DEFAULT_HOSTS = ['github.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org'];
const SERVICES = ['git-upload-pack', 'git-receive-pack'];

// Headers git needs. Authorization must be listed by name: the "*" wildcard does not cover it.
const ALLOW_HEADERS = 'Authorization, Content-Type, Accept, Git-Protocol, User-Agent';
const FORWARD = ['authorization', 'content-type', 'accept', 'git-protocol', 'user-agent'];

function list(value, fallback) {
    const items = String(value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return items.length ? items : fallback;
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        'Access-Control-Expose-Headers': '*',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
}

function reply(status, text, cors) {
    return new Response(text, { status, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
}

// The target of a request, or the reason why it is refused.
export function checkTarget(rawTarget, method, hosts) {
    let target;
    try {
        // isomorphic-git's own corsProxy option strips "https://"; the Werkstatt sends the full URL
        target = new URL(/^https?:\/\//.test(rawTarget) ? rawTarget : `https://${rawTarget}`);
    } catch {
        return { status: 400, error: 'Invalid URL. Usage: https://<worker>/https://<git host>/<repository>' };
    }
    if (target.protocol !== 'https:') return { status: 400, error: 'Only https:// targets are allowed.' };
    if (target.username || target.password) return { status: 400, error: 'Credentials in the URL are not allowed.' };
    if (!hosts.includes(target.hostname.toLowerCase())) return { status: 403, error: `Host not allowed: ${target.hostname}` };
    const path = target.pathname;
    if (path.endsWith('/info/refs')) {
        if (method !== 'GET' && method !== 'HEAD') return { status: 405, error: 'info/refs only supports GET.' };
        if (!SERVICES.includes(target.searchParams.get('service'))) return { status: 403, error: 'Unknown git service.' };
        return { url: target };
    }
    const service = SERVICES.find(s => path.endsWith(`/${s}`));
    if (!service) return { status: 403, error: 'Only git smart-HTTP requests are forwarded.' };
    if (method !== 'POST') return { status: 405, error: `${service} only supports POST.` };
    return { url: target };
}

export default {
    async fetch(request, env = {}) {
        const hosts = list(env.ALLOWED_HOSTS, DEFAULT_HOSTS);
        const origins = list(env.ALLOWED_ORIGINS, null);
        const origin = request.headers.get('Origin');
        if (origins && !(origin && origins.includes(origin.toLowerCase()))) {
            return reply(403, 'Origin not allowed.', corsHeaders(null));
        }
        const cors = corsHeaders(origins ? origin : '*');

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

        const url = new URL(request.url);
        const rawTarget = url.pathname.slice(1) + url.search;
        if (!rawTarget) return reply(200, 'CORS proxy for git smart-HTTP (Git-Werkstatt). Usage: /https://<git host>/<repository>', cors);

        const check = checkTarget(rawTarget, request.method, hosts);
        if (check.error) return reply(check.status, check.error, cors);

        // only what git needs; never cookies, Origin, Referer or Cloudflare's own headers
        const headers = new Headers();
        for (const name of FORWARD) {
            const value = request.headers.get(name);
            if (value) headers.set(name, value);
        }
        let response;
        try {
            response = await fetch(check.url.toString(), {
                method: request.method,
                headers,
                body: request.method === 'POST' ? request.body : undefined,
                redirect: 'follow',
            });
        } catch (e) {
            return reply(502, `Proxy error: ${e.message}`, cors);
        }
        // a redirect must not lead somewhere else (e.g. a renamed repository is fine, another host is not)
        if (response.url && !hosts.includes(new URL(response.url).hostname.toLowerCase())) {
            return reply(403, 'Redirect to a host that is not allowed.', cors);
        }
        const out = new Headers(response.headers);
        out.delete('set-cookie');
        for (const [k, v] of Object.entries(cors)) out.set(k, v);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
    },
};
