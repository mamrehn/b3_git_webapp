// The CORS proxy worker forwards git smart-HTTP to known hosts and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { default: worker } = await import('../cors-proxy/worker.js');
const W = 'https://proxy.example.workers.dev';

let calls = [];
globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init, headers: Object.fromEntries(init.headers) });
    const res = new Response('ok', { status: 200, headers: { 'content-type': 'application/x-git-upload-pack-advertisement', 'set-cookie': 'tracking=1' } });
    Object.defineProperty(res, 'url', { value: url.replace('/old-name.git', '/new-name.git').replace('github.com/evil-redirect', 'evil.example/x') });
    return res;
};

async function send(path, { method = 'GET', headers = {}, env = {}, body } = {}) {
    calls = [];
    const res = await worker.fetch(new Request(W + path, { method, headers, body }), env);
    return { status: res.status, text: await res.text(), headers: res.headers, calls };
}

test('git requests to known hosts are forwarded (full URL and protocol-less form)', async () => {
    for (const form of ['https://github.com/octocat/Hello-World.git', 'github.com/octocat/Hello-World.git']) {
        const r = await send(`/${form}/info/refs?service=git-upload-pack`, { headers: { Authorization: 'Basic eDp5', Cookie: 'session=1', Origin: 'https://school.example' } });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.calls[0].url, 'https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack');
        assert.equal(r.calls[0].headers.authorization, 'Basic eDp5');
        assert.equal(r.calls[0].headers.cookie, undefined, 'cookies are never forwarded');
        assert.equal(r.calls[0].headers.origin, undefined);
        assert.equal(r.headers.get('set-cookie'), null, 'cookies are never passed back');
        assert.equal(r.headers.get('access-control-allow-origin'), '*');
    }
    const push = await send('/https://gitlab.com/a/b.git/git-receive-pack', { method: 'POST', body: '0000', headers: { 'Content-Type': 'application/x-git-receive-pack-request' } });
    assert.equal(push.status, 200);
    assert.equal(push.calls[0].method, 'POST');
});

test('the preflight allows the Authorization header by name (needed for push)', async () => {
    const r = await send('/https://github.com/a/b.git/git-receive-pack', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(r.status, 204);
    assert.match(r.headers.get('access-control-allow-headers'), /\bAuthorization\b/);
    assert.equal(r.calls.length, 0);
});

test('anything that is not git smart-HTTP to an allowed host is refused', async () => {
    const refused = [
        ['/https://example.com/', 'GET'],
        ['/https://evil.example/repo.git/info/refs?service=git-upload-pack', 'GET'],
        ['/https://github.com/login', 'GET'],
        ['/https://github.com/a/b.git/info/refs?service=other', 'GET'],
        ['/https://github.com/a/b.git/info/refs?service=git-upload-pack', 'POST'],
        ['/https://github.com/a/b.git/git-upload-pack', 'GET'],
        ['/http://github.com/a/b.git/info/refs?service=git-upload-pack', 'GET'],
        ['/https://user:pw@github.com/a/b.git/info/refs?service=git-upload-pack', 'GET'],
    ];
    for (const [path, method] of refused) {
        const r = await send(path, { method, body: method === 'POST' ? 'x' : undefined });
        assert.ok(r.status >= 400, `${method} ${path} → ${r.status}`);
        assert.equal(r.calls.length, 0, `${method} ${path} must not be fetched`);
        assert.equal(r.headers.get('access-control-allow-origin'), '*', 'errors stay readable for the app');
    }
});

test('redirects to other hosts are not passed through; renamed repositories are', async () => {
    assert.equal((await send('/https://github.com/me/old-name.git/info/refs?service=git-upload-pack')).status, 200);
    assert.equal((await send('/https://github.com/evil-redirect.git/info/refs?service=git-upload-pack')).status, 403);
});

test('hosts and origins can be configured', async () => {
    const env = { ALLOWED_HOSTS: 'git.school.example', ALLOWED_ORIGINS: 'https://werkstatt.school.example' };
    const path = '/https://git.school.example/a/b.git/info/refs?service=git-upload-pack';
    assert.equal((await send(path, { env, headers: { Origin: 'https://werkstatt.school.example' } })).status, 200);
    const r = await send(path, { env, headers: { Origin: 'https://werkstatt.school.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://werkstatt.school.example');
    assert.equal((await send(path, { env, headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await send(path, { env })).status, 403, 'no Origin (curl …) is refused when origins are configured');
    assert.equal((await send('/https://github.com/a/b.git/info/refs?service=git-upload-pack', { env, headers: { Origin: 'https://werkstatt.school.example' } })).status, 403);
});
