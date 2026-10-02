# Git-Werkstatt

Learn git and the command line in the browser, with real commands and an explanation of every step. Nothing to install. Made for vocational-school classes; the interface is German by default and can be switched to English (git's own output stays English, as in real git).

**Open it:** https://mamrehn.github.io/b3_git_webapp/

## What students get

- **Terminal**: a bash-like shell with about 60 commands (pipes, redirection, `grep`, `sed`, `find`, …) and git built on isomorphic-git. `help` lists everything. Git's output follows real git's wording; the tests compare it byte for byte with real git.
- **Coach**: after every command it explains what happened, where you are now and what to do next. While you type, a line below the prompt says what the command will do.
- **Views**: *Files* (with the status codes of `git status -s`), *Areas* (working directory → staging area → repository → server) and *History* (commits drawn as a metro map).
- **Missions**: 20 guided tasks in five lines: shell basics (optional), git basics, branches, teamwork, pro tools. A mission checks the state of the repository, so any correct solution counts, and hints get more specific step by step. Servers and teammates are simulated (`git.sim`).
- **Sandbox**: free play. On first start it clones [mamrehn/project1](https://github.com/mamrehn/project1) into `~/project1`. Remotes here are real servers such as GitHub, reached through a [CORS proxy](#cors-proxy). Simulated servers are marked differently, so students always know which kind they are talking to.
- **Undo**: a button that restores files and git data to the state before the last command.
- **Editor**: `nano`, `vi`, `code` and friends open files in a built-in editor (CodeMirror).
- **Accessibility**: keyboard navigation, an optional screen-reader mode, light and dark theme.

## Run it locally

There is no build step, but the app uses JavaScript modules, so it has to be served over HTTP. Opening `index.html` directly as a file does not work.

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Students' files are stored in their browser (IndexedDB), separately for each browser and device. The sandbox survives a reload; a mission starts from a fresh state every time.

## Embed it in a learning platform

```html
<iframe src="https://mamrehn.github.io/b3_git_webapp/" title="Git-Werkstatt"
        width="100%" height="800" style="border: 0"></iframe>
```

## Configuration

Settings a teacher may want to change are in [`src/config.js`](src/config.js):

| Setting | Meaning |
|---|---|
| `corsProxies` | CORS proxies for real remotes. Add your own proxy here **and** to `connect-src` in the Content-Security-Policy in [`index.html`](index.html). |
| `sandboxRepo` | Repository cloned into `~/project1` when the sandbox opens for the first time. |
| `simulatedHost` | Host name of the simulated server in missions. Never a real host. |
| `realCloneDepth` | How much history real clones fetch (`0` = all). Set it, e.g. to `50`, if students clone large repositories: a full clone of a big project can freeze the tab and fill the browser's storage. |

## CORS proxy

Browsers may not talk to git servers directly, so in the sandbox every real `git clone`, `fetch`, `pull` and `push` goes through a small Cloudflare Worker in [`cors-proxy/`](cors-proxy/). It forwards only git requests to known git hosts (GitHub, GitLab, Codeberg, Bitbucket), so it cannot be misused as an open proxy. Missions never use it. How to deploy your own: [`cors-proxy/DEPLOY.md`](cors-proxy/DEPLOY.md).

## Publishing

Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml), which publishes `index.html`, `src/`, `css/`, `vendor/` and `assets/` to GitHub Pages. In a fork, set *Settings → Pages → Source* to **GitHub Actions** once.

## Tests

```sh
cd tests
npm ci
npm test
```

The Node tests cover the shell, the git commands, the coach, every mission and the CORS proxy. Many of them run the same commands in real git and compare the output, so `git` and `bash` must be installed.

## Project layout

```
index.html       the page; its Content-Security-Policy lists the allowed proxies
src/main.js      entry point; src/app.js connects the parts
src/config.js    settings (see above)
src/core/        languages, texts, shared helpers
src/shell/       command line parser and shell commands
src/git/         git commands on top of isomorphic-git, simulated git server
src/learn/       the coach: explanations, situation detection, suggestions
src/missions/    mission engine; content/ holds the missions
src/ui/          terminal, file tree, editor, history view, help
src/vfs/         the file systems (sandbox, missions) and undo
css/             styles
vendor/          third-party libraries, stored here instead of loaded from a CDN (see vendor/README.md)
assets/          icon and self-hosted fonts
cors-proxy/      the Cloudflare Worker for real remotes
tests/           Node tests
```

## License

Free to use for educational purposes. Fork it and adapt it for your own teaching.
