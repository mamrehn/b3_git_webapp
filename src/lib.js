// Access to the third-party libraries that index.html loads as classic scripts.
// The proxies resolve lazily, so tests (Node) can install the globals before first use.

function lazyGlobal(name) {
    return new Proxy({}, {
        get(_target, key) {
            const lib = globalThis[name];
            if (!lib) throw new Error(`Library "${name}" is not loaded`);
            const value = lib[key];
            return typeof value === 'function' ? value.bind(lib) : value;
        },
    });
}

export const git = lazyGlobal('git');
export const Diff = lazyGlobal('Diff');

export function gitHttp() {
    const http = globalThis.GitHttp;
    return http && (http.default || http);
}

export function hasLib(name) {
    return Boolean(globalThis[name]);
}
