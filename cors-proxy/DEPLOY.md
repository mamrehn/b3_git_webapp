# Deploying the CORS proxy

Browsers may not talk to git servers directly, so in the **sandbox** every real
`git clone/fetch/pull/push` goes through this Cloudflare Worker. (The missions never
use it: their server is simulated in the browser.)

The worker forwards **only git smart-HTTP requests to known git hosts**. Everything else
is refused, so it cannot be misused as an open proxy under your account – which would also
use up the free daily request quota the students depend on.

## Deploy

You need Node.js and a free Cloudflare account.

```bash
cd cors-proxy
npx wrangler login     # opens a browser window to sign in
npx wrangler deploy    # prints the URL, e.g. https://isomorphic-git-cors-proxy.<you>.workers.dev
```

## Settings (optional)

Set them in `wrangler.toml` under `[vars]` or in the Cloudflare dashboard
(Workers → your worker → Settings → Variables):

| Variable | Meaning | Default |
|---|---|---|
| `ALLOWED_HOSTS` | git hosts the proxy talks to, comma-separated | `github.com,gitlab.com,codeberg.org,bitbucket.org` |
| `ALLOWED_ORIGINS` | addresses of the Werkstatt that may use the proxy, e.g. `https://git.example-school.de` | any |

Set `ALLOWED_ORIGINS` once the Werkstatt has a fixed address.

## Connect the Werkstatt to your proxy

Two places, both without a trailing slash:

1. `src/config.js` → `corsProxies`: put your worker URL first.
2. `index.html` → the `Content-Security-Policy` meta tag → add the URL to `connect-src`.
   Otherwise the browser blocks every request to it.

## Check that it works

```bash
P=https://isomorphic-git-cors-proxy.<you>.workers.dev
curl -s -o /dev/null -w '%{http_code}\n' "$P/https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack"   # 200
curl -s -o /dev/null -w '%{http_code}\n' "$P/https://example.com/"                                                          # 403
```

Then open the sandbox: on its first start it clones the practice project from GitHub.

The worker has tests: `cd tests && node --test cors-proxy.test.mjs`.
