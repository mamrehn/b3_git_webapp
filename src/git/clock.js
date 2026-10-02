// One place for "now", so tests can produce stable commit hashes.

let override = null;
let fixedTz = true;

export function now() {
    return override ? override() : Math.floor(Date.now() / 1000);
}

export function tzOffset() {
    return override && fixedTz ? 0 : new Date().getTimezoneOffset();
}

// Tests pin the clock to UTC; mission setups move it into the past but keep the local zone.
export function setClock(fn, { localTz = false } = {}) {
    override = fn;
    fixedTz = !localTz;
}

export function signature(identity, timestamp = now()) {
    return { name: identity.name, email: identity.email, timestamp, timezoneOffset: override && fixedTz ? 0 : new Date(timestamp * 1000).getTimezoneOffset() };
}
