# Vendored libraries

All third-party code is stored here instead of being loaded from a CDN, so that

- the app works on school networks that block or throttle CDNs,
- no student IP addresses are sent to third parties (GDPR), and
- an upstream release can never silently break the app.

Versions were the latest published releases on 2026-10-01.

| File | Package | Version | License | Source file |
|---|---|---|---|---|
| `isomorphic-git-1.42.5.min.js` | isomorphic-git | 1.42.5 | MIT | `index.umd.min.js` |
| `isomorphic-git-http-web-1.42.5.js` | isomorphic-git (HTTP client) | 1.42.5 | MIT | `http/web/index.umd.js` |
| `lightning-fs-4.10.3.min.js` | @isomorphic-git/lightning-fs | 4.10.3 | MIT | `dist/lightning-fs.min.js` |
| `buffer-6.0.3.min.js` | buffer | 6.0.3 | MIT | bundled, see below |
| `diff-9.0.0.min.js` | diff (jsdiff) | 9.0.0 | BSD-3-Clause | `dist/diff.min.js` |
| `node-diff3-3.2.1.mjs` | node-diff3 | 3.2.1 | MIT | `src/diff3.mjs` |
| `xterm-6.0.0.mjs`, `xterm-6.0.0.css` | @xterm/xterm | 6.0.0 | MIT | `lib/xterm.mjs`, `css/xterm.css` |
| `xterm-addon-fit-0.11.0.mjs` | @xterm/addon-fit | 0.11.0 | MIT | `lib/addon-fit.mjs` |
| `codemirror-6.bundle.mjs` | @codemirror/* (view 6.43.13, state 6.7.6, …) | 6.x | MIT | bundled, see below |

The `sourceMappingURL` comments were removed from the xterm files because the maps are not shipped.

## Rebuilding the two bundles

The app itself has no build step. Only these two files were produced once with esbuild 0.28.2:

```sh
npm install buffer@6.0.3 esbuild@0.28.2 \
  @codemirror/view@6.43.13 @codemirror/state@6.7.6 @codemirror/commands@6.11.1 \
  @codemirror/language@6.12.4 @codemirror/search@6.7.2 @lezer/highlight@1.2.5 \
  @codemirror/lang-html@6.4.12 @codemirror/lang-css@6.3.1 @codemirror/lang-javascript@6.2.5 \
  @codemirror/lang-markdown@6.5.2 @codemirror/lang-python@6.2.1 @codemirror/lang-java@6.0.2 \
  @codemirror/lang-sql@6.10.0 @codemirror/lang-yaml@6.1.3 @codemirror/legacy-modes@6.5.4

# Buffer polyfill (isomorphic-git expects a global Buffer in the browser)
npx esbuild node_modules/buffer/index.js --bundle --format=iife --minify \
  --global-name=__BufferMod --outfile=buffer-iife.js
(cat buffer-iife.js; echo 'globalThis.Buffer = globalThis.Buffer || __BufferMod.Buffer;') > buffer-6.0.3.min.js

# CodeMirror 6 (entry file: codemirror-entry.js in this folder)
npx esbuild codemirror-entry.js --bundle --format=esm --minify --legal-comments=none \
  --outfile=codemirror-6.bundle.mjs
```

The CodeMirror bundle is loaded lazily, only when the editor is opened for the first time.

## Fonts

`../assets/fonts/` contains Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono
(Braille Institute, SIL Open Font License 1.1, see `OFL.txt`), downloaded from Google Fonts
and served locally. They were chosen for legibility: `0/O` and `1/l/I` are clearly distinct,
which matters when students read commit hashes and type commands.
