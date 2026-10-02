// Settings a teacher may want to change. Everything else lives in the code.

export const CONFIG = {
    // CORS proxies for REAL network access (GitHub etc.). Browsers cannot talk to git
    // servers directly; see cors-proxy/DEPLOY.md to run your own (no trailing slash!).
    corsProxies: [
        'https://isomorphic-git-cors-proxy.mamrehn.workers.dev',
        'https://isomorphic-git-cors-proxy.mamreh.workers.dev',
    ],

    // Cloned from GitHub into ~/project1 the first time the free sandbox opens.
    sandboxRepo: 'https://github.com/mamrehn/project1.git',

    // Host name of the simulated git server used by missions. Never a real host.
    simulatedHost: 'git.sim',

    // Depth for real clones (0 = full history). Large repositories are slow in a browser.
    realCloneDepth: 0,
};
