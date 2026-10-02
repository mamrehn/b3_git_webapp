// Minimal app-wide event bus (sim server activity, editor saves, mission progress …).

const handlers = new Map();

export function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
}

export function emit(type, payload) {
    for (const fn of handlers.get(type) || []) {
        try {
            fn(payload);
        } catch (e) {
            console.error(`[events] ${type} handler failed`, e);
        }
    }
}
