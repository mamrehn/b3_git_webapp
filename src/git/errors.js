// Errors raised by git subcommands. The message is printed verbatim (like real git),
// `status` becomes the exit code, and `kind` lets the coach explain what went wrong.

export class GitError extends Error {
    constructor(message, { status = 128, kind = null, data = null } = {}) {
        super(message);
        this.status = status;
        this.kind = kind;
        this.data = data;
    }
}

export function fatal(message, opts = {}) {
    return new GitError(`fatal: ${message}`, { status: 128, ...opts });
}

export function usageError(message) {
    return new GitError(message, { status: 129, kind: 'usage' });
}
