// Initialize xterm.js
const term = new Terminal({
    cursorBlink: true,
    theme: {
        background: '#1e1e1e',
        foreground: '#ffffff',
        cursor: '#ffffff',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff'
    }
});

const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();

// Handle window resize
window.addEventListener('resize', () => {
    fitAddon.fit();
});

// Constants
const CORS_PROXIES = [
    // 'https://<your-subdomain>.workers.dev/', // TODO: Uncomment and add your worker URL here
    'https://isomorphic-git-cors-proxy.mamrehn.workers.dev/',
    'https://cors.isomorphic-git.org',
    'https://corsproxy.io/?url=',
];
let GIT_PROXY = CORS_PROXIES[0];
const DEFAULT_REPO_URL = 'https://github.com/mamrehn/project1.git';
const DEFAULT_USER = { name: 'Student', email: 'student@example.com' };

// Test CORS proxies and use the first one that works
async function findWorkingProxy() {
    console.log('🔍 Testing CORS proxies...');
    for (const proxy of CORS_PROXIES) {
        try {
            // Test with a lightweight request to GitHub's git info/refs
            // increased timeout to 10s for slower connections
            const testUrl = proxy.includes('?url=')
                ? `${proxy}https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack`
                : `${proxy}/https://github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack`;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await fetch(testUrl, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                console.log(`✅ CORS proxy working: ${proxy}`);
                return { url: proxy, verified: true };
            }
            console.warn(`❌ CORS proxy returned ${response.status}: ${proxy}`);
        } catch (e) {
            console.warn(`❌ CORS proxy failed: ${proxy}`, e.message);
        }
    }
    console.warn('⚠️ No working CORS proxy found during check, defaulting to first option');
    return { url: CORS_PROXIES[0], verified: false };
}

// Initialize filesystem
const fs = new LightningFS('gitlearning');
const pfs = fs.promises;
const git = window.git;
const http = window.GitHttp || window.git?.http;

// State
let currentDir = '/home/student';
let currentLine = '';
let cursorPos = 0;
let commandHistory = ['git clone https://github.com/octocat/Hello-World.git'];
let historyIndex = 1; // Start after the pre-filled command
let currentProject = 'project1';
let editorFile = null;
let editorOriginalContent = '';
let codeMirrorInstance = null;
let isCommitMessageMode = false;
let commitMessageDir = null;
let commitMessageIsAmend = false;
let promptBranch = '';
let previousDir = '/home/student';
let hintsEnabled = true;

// Reverse search state
let reverseSearchMode = false;
let reverseSearchQuery = '';
let reverseSearchIndex = -1;
let savedLine = '';

// Forward search state
let forwardSearchMode = false;
let forwardSearchQuery = '';
let forwardSearchIndex = -1;

// Kill ring (for Ctrl+Y yank)
let killRing = [];
const MAX_KILL_RING_SIZE = 10;

// Environment variables
const envVars = {
    HOME: '/home/student',
    USER: 'student',
    SHELL: '/bin/bash',
    PWD: '/home/student',
    TERM: 'xterm-256color',
    LANG: 'en_US.UTF-8',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOSTNAME: 'gitlearning',
    EDITOR: 'vi'
};

// Undo history
let undoHistory = [];
const MAX_UNDO_HISTORY = 50;

// Quoted insert mode (Ctrl+V)
let quotedInsertMode = false;

// Real-time command preview hint dictionary
const COMMAND_HINTS = {
    ls:       { desc: 'Lists files and directories. Use -a for hidden files, -l for details.', syntax: 'ls [options] [path]' },
    ll:       { desc: 'Lists all files in long format (alias for ls -la).', syntax: 'll' },
    cd:       { desc: 'Changes directory. Use ".." for parent, "~" for home, "-" for previous.', syntax: 'cd <directory>' },
    pwd:      { desc: 'Prints the full path of the current working directory.', syntax: 'pwd' },
    cat:      { desc: 'Displays file contents. Concatenates multiple files together.', syntax: 'cat <file> [file2...]' },
    mkdir:    { desc: 'Creates a new directory. Use -p to create parent dirs automatically.', syntax: 'mkdir [-p] <directory>' },
    touch:    { desc: 'Creates an empty file, or updates the timestamp of an existing file.', syntax: 'touch <file> [file2...]' },
    rm:       { desc: 'Removes files. Use -r for directories, -f to force. Deletion is permanent!', syntax: 'rm [-rf] <file>' },
    cp:       { desc: 'Copies files or directories. Use -r for directories.', syntax: 'cp [-r] <source> <dest>' },
    mv:       { desc: 'Moves or renames files and directories.', syntax: 'mv <source> <dest>' },
    echo:     { desc: 'Prints text to the terminal. Use > to write to a file, >> to append.', syntax: 'echo <text>' },
    grep:     { desc: 'Searches for a pattern in files. -i case-insensitive, -r recursive.', syntax: 'grep [options] <pattern> <file>' },
    head:     { desc: 'Shows the first N lines of a file (default 10).', syntax: 'head [-n N] <file>' },
    tail:     { desc: 'Shows the last N lines of a file (default 10).', syntax: 'tail [-n N] <file>' },
    wc:       { desc: 'Counts lines, words, and bytes in a file.', syntax: 'wc [-lwc] <file>' },
    find:     { desc: 'Searches for files by name or pattern in a directory tree.', syntax: 'find [dir] -name <pattern>' },
    diff:     { desc: 'Compares two files line by line and shows differences.', syntax: 'diff <file1> <file2>' },
    sort:     { desc: 'Sorts lines alphabetically. Use -n for numeric, -r for reverse.', syntax: 'sort [-rnu] <file>' },
    uniq:     { desc: 'Filters adjacent duplicate lines. Tip: sort the file first.', syntax: 'uniq [-cd] <file>' },
    clear:    { desc: 'Clears the terminal screen. Command history is preserved.', syntax: 'clear' },
    reset:    { desc: 'Resets the entire filesystem to its initial state. All changes lost!', syntax: 'reset' },
    history:  { desc: 'Shows command history. Use !n to re-run command #n.', syntax: 'history' },
    help:     { desc: 'Shows all available commands with descriptions.', syntax: 'help' },
    whoami:   { desc: 'Prints the current username.', syntax: 'whoami' },
    hostname: { desc: 'Prints the system hostname.', syntax: 'hostname' },
    date:     { desc: 'Prints the current date and time.', syntax: 'date' },
    env:      { desc: 'Prints all environment variables.', syntax: 'env' },
    printenv: { desc: 'Prints all environment variables.', syntax: 'printenv' },
    export:   { desc: 'Sets an environment variable for the current session.', syntax: 'export KEY=VALUE' },
    which:    { desc: 'Shows where a command executable is located.', syntax: 'which <command>' },
    type:     { desc: 'Shows whether a command is a builtin, alias, or external.', syntax: 'type <command>' },
    hints:    { desc: 'Toggles educational hints on or off.', syntax: 'hints [on|off]' },
    vi:       { desc: 'Opens a file in the editor. Ctrl+S save, Ctrl+X close.', syntax: 'vi <file>' },
    vim:      { desc: 'Opens a file in the editor. Ctrl+S save, Ctrl+X close.', syntax: 'vim <file>' },
    nano:     { desc: 'Opens a file in the editor. Ctrl+S save, Ctrl+X close.', syntax: 'nano <file>' },
    edit:     { desc: 'Opens a file in the editor. Ctrl+S save, Ctrl+X close.', syntax: 'edit <file>' },
    debug:    { desc: 'Shows debug info: current directory, git state, file system.', syntax: 'debug' },
    git: {
        desc: 'Git version control. Type "git <command>" for specific operations.',
        syntax: 'git <command> [options]',
        sub: {
            init:          { desc: 'Creates a new Git repository in the current directory (.git folder).', syntax: 'git init' },
            status:        { desc: 'Shows staged, modified, and untracked files. Run this often!', syntax: 'git status' },
            add:           { desc: 'Stages changes for the next commit. Files must be staged before committing.', syntax: 'git add <file>',
                             flags: { '.': 'Stage ALL changes in current directory', '-A': 'Stage all changes in entire repo' } },
            commit:        { desc: 'Records staged changes as a new snapshot in history.', syntax: 'git commit -m "<message>"',
                             flags: { '-m': 'Provide commit message inline', '--amend': 'Modify the most recent commit', '-a': 'Auto-stage tracked modified files' } },
            log:           { desc: 'Shows the commit history with hash, author, date, and message.', syntax: 'git log [options]',
                             flags: { '--oneline': 'Compact one-line format', '--graph': 'Show branch graph', '--all': 'Show all branches', '-n': 'Limit to N commits' } },
            diff:          { desc: 'Shows line-by-line changes between working directory and last commit.', syntax: 'git diff [file]',
                             flags: { '--staged': 'Compare staging area vs last commit', '--stat': 'Summary of changes' } },
            branch:        { desc: 'Lists, creates, or deletes branches for independent work.', syntax: 'git branch [name]',
                             flags: { '-d': 'Delete a merged branch', '-D': 'Force delete', '-m': 'Rename current branch', '-a': 'Show all branches' } },
            checkout:      { desc: 'Switches branches or restores files.', syntax: 'git checkout <branch|file>',
                             flags: { '-b': 'Create and switch to new branch', '--': 'Discard changes to a file' } },
            switch:        { desc: 'Switches branches (modern, clearer than checkout).', syntax: 'git switch <branch>',
                             flags: { '-c': 'Create and switch to a new branch' } },
            restore:       { desc: 'Discards changes or unstages files (modern replacement for checkout --).', syntax: 'git restore <file>',
                             flags: { '--staged': 'Unstage a file (keep working tree changes)' } },
            merge:         { desc: 'Combines another branch into the current branch.', syntax: 'git merge <branch>',
                             flags: { '--abort': 'Abort an in-progress merge' } },
            rebase:        { desc: 'Replays commits on top of another branch for linear history.', syntax: 'git rebase <branch>',
                             flags: { '--abort': 'Abort the rebase', '--continue': 'Continue after resolving conflicts' } },
            reset:         { desc: 'Moves HEAD to a different commit. Can unstage or undo commits.', syntax: 'git reset [mode] [commit]',
                             flags: { '--soft': 'Keep changes staged', '--mixed': 'Unstage changes (default)', '--hard': 'Discard ALL changes (dangerous!)' } },
            stash:         { desc: 'Temporarily saves uncommitted changes to switch branches cleanly.', syntax: 'git stash [push|pop|list|drop]' },
            tag:           { desc: 'Creates a named reference to a commit (e.g. for releases).', syntax: 'git tag [name]',
                             flags: { '-d': 'Delete a tag', '-a': 'Create annotated tag' } },
            remote:        { desc: 'Manages connections to remote repositories (like GitHub).', syntax: 'git remote [add|remove]' },
            clone:         { desc: 'Downloads a remote repository with all its history.', syntax: 'git clone <url> [dir]' },
            fetch:         { desc: 'Downloads new commits from remote, but does NOT merge them.', syntax: 'git fetch [remote]' },
            push:          { desc: 'Uploads local commits to a remote repository.', syntax: 'git push [remote] [branch]' },
            pull:          { desc: 'Fetches AND merges remote changes. Equivalent to fetch + merge.', syntax: 'git pull [remote] [branch]' },
            show:          { desc: 'Shows detailed info about a commit, including the diff.', syntax: 'git show [commit]' },
            rm:            { desc: 'Removes a file from working directory and staging area.', syntax: 'git rm <file>',
                             flags: { '--cached': 'Remove from staging only, keep file', '-r': 'Remove directories recursively' } },
            mv:            { desc: 'Moves/renames a file and stages the change automatically.', syntax: 'git mv <source> <dest>' },
            config:        { desc: 'Gets or sets Git config values (name, email, etc).', syntax: 'git config <key> [value]' },
            'cherry-pick': { desc: 'Applies a specific commit from another branch onto current branch.', syntax: 'git cherry-pick <hash>' },
            revert:        { desc: 'Creates a NEW commit that undoes a previous commit (safe for shared history).', syntax: 'git revert <commit>' },
            reflog:        { desc: 'Shows where HEAD has pointed. Lifesaver for recovering "lost" commits!', syntax: 'git reflog' },
            blame:         { desc: 'Shows who last modified each line of a file, and when.', syntax: 'git blame <file>' },
            clean:         { desc: 'Removes untracked files from the working directory.', syntax: 'git clean [-n|-f] [-d]',
                             flags: { '-n': 'Dry run (preview)', '-f': 'Force deletion', '-d': 'Include directories' } },
            shortlog:      { desc: 'Summarizes commit history grouped by author.', syntax: 'git shortlog [-s] [-n]' },
        }
    }
};

// Command preview panel state
let previewEl = null;
let previewTextEl = null;
let previewDebounceTimer = null;
const PREVIEW_DEBOUNCE_MS = 100;

function initPreviewPanel() {
    previewEl = document.getElementById('commandPreview');
}

function getCommandPreview(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // For piped/chained commands, show hint for the first command
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];

    const entry = COMMAND_HINTS[cmd];
    if (!entry) return null;

    // Git with subcommands
    if (cmd === 'git' && entry.sub) {
        if (parts.length < 2 || parts[1] === '') {
            return `<span class="preview-cmd">git</span> <span class="preview-syntax">&lt;command&gt;</span> <span class="preview-desc">\u2014 ${entry.desc}</span>`;
        }

        const subcmd = parts[1];

        // Partial subcommand match (user still typing)
        if (parts.length === 2 && !entry.sub[subcmd]) {
            const matches = Object.keys(entry.sub).filter(s => s.startsWith(subcmd));
            if (matches.length === 1) {
                const match = entry.sub[matches[0]];
                return `<span class="preview-cmd">git ${matches[0]}</span> <span class="preview-desc">\u2014 ${match.desc}</span>`;
            } else if (matches.length > 1 && matches.length <= 8) {
                return `<span class="preview-desc">Did you mean: </span><span class="preview-cmd">${matches.join(', ')}</span>`;
            }
            return null;
        }

        const subEntry = entry.sub[subcmd];
        if (!subEntry) return null;

        // Check for flag-specific hints
        if (subEntry.flags) {
            const typedFlags = parts.slice(2).filter(p => p.startsWith('-'));
            if (typedFlags.length > 0) {
                const lastFlag = typedFlags[typedFlags.length - 1];
                if (subEntry.flags[lastFlag]) {
                    return `<span class="preview-cmd">git ${subcmd} ${lastFlag}</span> <span class="preview-desc">\u2014 ${subEntry.flags[lastFlag]}</span>`;
                }
            }
            // Check for non-flag args like "." in "git add ."
            const nonFlagArgs = parts.slice(2).filter(p => !p.startsWith('-'));
            if (nonFlagArgs.length > 0) {
                const lastArg = nonFlagArgs[nonFlagArgs.length - 1];
                if (subEntry.flags[lastArg]) {
                    return `<span class="preview-cmd">git ${subcmd} ${lastArg}</span> <span class="preview-desc">\u2014 ${subEntry.flags[lastArg]}</span>`;
                }
            }
        }

        return `<span class="preview-cmd">git ${subcmd}</span> <span class="preview-syntax">${escapeHtml(subEntry.syntax.replace('git ' + subcmd, '').trim())}</span> <span class="preview-desc">\u2014 ${subEntry.desc}</span>`;
    }

    // Non-git commands
    return `<span class="preview-cmd">${cmd}</span> <span class="preview-syntax">${escapeHtml(entry.syntax.replace(cmd, '').trim())}</span> <span class="preview-desc">\u2014 ${entry.desc}</span>`;
}

function showPreview(htmlContent) {
    if (!previewEl) return;
    previewEl.innerHTML = htmlContent;
    previewEl.classList.remove('hidden');
}

function hidePreview() {
    if (!previewEl) return;
    previewEl.classList.add('hidden');
}

function updatePreview() {
    if (!hintsEnabled) { hidePreview(); return; }
    if (reverseSearchMode || forwardSearchMode || isCommitMessageMode) { hidePreview(); return; }

    const editorContainer = document.getElementById('editorContainer');
    if (editorContainer && !editorContainer.classList.contains('hidden')) { hidePreview(); return; }

    const hint = getCommandPreview(currentLine);
    if (hint) { showPreview(hint); } else { hidePreview(); }
}

function schedulePreviewUpdate() {
    if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(updatePreview, PREVIEW_DEBOUNCE_MS);
}

// Shell-like tokenizer: handles "double quotes", 'single quotes', backslash escaping
function tokenize(input) {
    const tokens = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let i = 0;
    while (i < input.length) {
        const char = input[i];
        if (inSingle) {
            if (char === "'") inSingle = false;
            else current += char;
            i++; continue;
        }
        if (inDouble) {
            if (char === '"') inDouble = false;
            else if (char === '\\' && i + 1 < input.length && '"\\$`'.includes(input[i + 1])) {
                current += input[i + 1]; i += 2; continue;
            } else current += char;
            i++; continue;
        }
        if (char === '\\' && i + 1 < input.length) { current += input[i + 1]; i += 2; continue; }
        if (char === "'") { inSingle = true; i++; continue; }
        if (char === '"') { inDouble = true; i++; continue; }
        if (char === ' ' || char === '\t') {
            if (current !== '') { tokens.push(current); current = ''; }
            i++; continue;
        }
        current += char;
        i++;
    }
    if (current !== '') tokens.push(current);
    return tokens;
}

// Split on shell operators (&&, ||) respecting quotes
function splitOnShellOperators(input) {
    const parts = [];
    let current = '';
    let inSingle = false, inDouble = false;
    let i = 0;
    while (i < input.length) {
        const char = input[i];
        if (inSingle) { current += char; if (char === "'") inSingle = false; i++; continue; }
        if (inDouble) { current += char; if (char === '"') inDouble = false; i++; continue; }
        if (char === "'") { inSingle = true; current += char; i++; continue; }
        if (char === '"') { inDouble = true; current += char; i++; continue; }
        if (char === '\\' && i + 1 < input.length) { current += char + input[i + 1]; i += 2; continue; }
        if (char === '&' && input[i + 1] === '&') {
            parts.push(current.trim()); parts.push('&&'); current = ''; i += 2; continue;
        }
        if (char === '|' && input[i + 1] === '|') {
            parts.push(current.trim()); parts.push('||'); current = ''; i += 2; continue;
        }
        current += char; i++;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

// Split on pipe (|) but not || respecting quotes
function splitOnPipe(input) {
    const parts = [];
    let current = '';
    let inSingle = false, inDouble = false;
    let i = 0;
    while (i < input.length) {
        const char = input[i];
        if (inSingle) { current += char; if (char === "'") inSingle = false; i++; continue; }
        if (inDouble) { current += char; if (char === '"') inDouble = false; i++; continue; }
        if (char === "'") { inSingle = true; current += char; i++; continue; }
        if (char === '"') { inDouble = true; current += char; i++; continue; }
        if (char === '|' && input[i + 1] !== '|') {
            parts.push(current.trim()); current = ''; i++; continue;
        }
        if (char === '|' && input[i + 1] === '|') {
            current += '||'; i += 2; continue;
        }
        current += char; i++;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

// Parse output redirect (> or >>) outside quotes
function parseRedirect(cmd) {
    let inSingle = false, inDouble = false;
    for (let i = 0; i < cmd.length; i++) {
        const char = cmd[i];
        if (inSingle) { if (char === "'") inSingle = false; continue; }
        if (inDouble) { if (char === '"') inDouble = false; continue; }
        if (char === "'") { inSingle = true; continue; }
        if (char === '"') { inDouble = true; continue; }
        if (char === '>') {
            const isAppend = cmd[i + 1] === '>';
            const fileStart = isAppend ? i + 2 : i + 1;
            return { command: cmd.substring(0, i).trim(), redirectFile: cmd.substring(fileStart).trim(), isAppend };
        }
    }
    return { command: cmd, redirectFile: null, isAppend: false };
}

// Expand glob patterns in arguments
async function expandGlobs(args) {
    const expanded = [];
    for (const arg of args) {
        if (arg.includes('*') || arg.includes('?')) {
            try {
                const hasPath = arg.includes('/');
                const dir = hasPath ? resolvePath(arg.substring(0, arg.lastIndexOf('/'))) : currentDir;
                const pattern = hasPath ? arg.substring(arg.lastIndexOf('/') + 1) : arg;
                const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
                const files = await pfs.readdir(dir);
                const matches = files.filter(f => regex.test(f)).sort();
                if (matches.length > 0) {
                    const prefix = hasPath ? arg.substring(0, arg.lastIndexOf('/') + 1) : '';
                    expanded.push(...matches.map(m => prefix + m));
                } else {
                    expanded.push(arg);
                }
            } catch (e) {
                expanded.push(arg);
            }
        } else {
            expanded.push(arg);
        }
    }
    return expanded;
}

// Format git date consistently (matches real git output)
function formatGitDate(timestamp) {
    const date = new Date(timestamp * 1000);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const tzOffset = -date.getTimezoneOffset();
    const tzSign = tzOffset >= 0 ? '+' : '-';
    const tzH = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
    const tzM = String(Math.abs(tzOffset) % 60).padStart(2, '0');
    return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')} ${date.getFullYear()} ${tzSign}${tzH}${tzM}`;
}

// History expansion: !!, !n, !-n, !string
function expandHistory(cmd) {
    if (cmd === '!!') {
        if (commandHistory.length === 0) return cmd;
        const expanded = commandHistory[commandHistory.length - 1];
        printNormal(expanded);
        return expanded;
    }
    if (cmd.startsWith('!') && cmd.length > 1 && cmd[1] !== ' ' && cmd[1] !== '=') {
        const rest = cmd.substring(1);
        if (rest.startsWith('-')) {
            const n = parseInt(rest.substring(1), 10);
            if (!isNaN(n) && n > 0 && n <= commandHistory.length) {
                const expanded = commandHistory[commandHistory.length - n];
                printNormal(expanded);
                return expanded;
            }
        } else if (/^\d+$/.test(rest)) {
            const n = parseInt(rest, 10);
            if (n > 0 && n <= commandHistory.length) {
                const expanded = commandHistory[n - 1];
                printNormal(expanded);
                return expanded;
            }
        } else {
            for (let i = commandHistory.length - 1; i >= 0; i--) {
                if (commandHistory[i].startsWith(rest)) {
                    const expanded = commandHistory[i];
                    printNormal(expanded);
                    return expanded;
                }
            }
        }
    }
    // Replace !! within the command (e.g., "sudo !!")
    if (cmd.includes('!!') && commandHistory.length > 0) {
        const expanded = cmd.replace(/!!/g, commandHistory[commandHistory.length - 1]);
        printNormal(expanded);
        return expanded;
    }
    return cmd;
}

// Initialize the application
async function init() {
    try {
        // Wait for HTTP module to load (if using module import)
        let attempts = 0;
        while (!window.GitHttp && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (window.GitHttp) {
            console.log('✅ HTTP module loaded successfully');
        } else {
            console.warn('⚠️  HTTP module not loaded, cloning will fallback to sample project');
        }

        // Find a working CORS proxy and update status indicator
        const statusEl = document.getElementById('connectionStatus');
        const proxyResult = await findWorkingProxy();

        GIT_PROXY = proxyResult.url;

        if (proxyResult.verified) {
            statusEl.textContent = 'Online (proxy connected)';
            statusEl.className = 'connection-status connected';
            statusEl.title = `Using verified CORS proxy: ${GIT_PROXY}`;
        } else {
            statusEl.textContent = 'Online (unverified proxy)';
            statusEl.className = 'connection-status warning';
            statusEl.title = `Proxy check failed, but forcing use of: ${GIT_PROXY}. Operations might still work.`;
            console.warn('⚠️ Proxy check failed, but application will attempt to use default proxy.');
        }

        // Setup directory structure
        await setupFileSystem();

        // Print welcome message
        printWelcome();

        // Show prompt
        showPrompt();

        // Initialize command preview panel
        initPreviewPanel();

        // Update file tree
        await updateFileTree();

    } catch (error) {
        term.writeln(`\x1b[31mError initializing: ${error.message}\x1b[0m`);
    }
}

async function setupFileSystem() {
    // Helper function to check if directory exists
    async function dirExists(path) {
        try {
            const stat = await pfs.stat(path);
            return stat.isDirectory();
        } catch (e) {
            return false;
        }
    }

    // Helper function to check if file exists
    async function fileExists(path) {
        try {
            const stat = await pfs.stat(path);
            return stat.isFile();
        } catch (e) {
            return false;
        }
    }

    // Create directory structure only if it doesn't exist
    if (!await dirExists('/home')) {
        await pfs.mkdir('/home', { recursive: true });
    }
    if (!await dirExists('/home/student')) {
        await pfs.mkdir('/home/student', { recursive: true });
    }
    if (!await dirExists('/home/student/project1')) {
        await pfs.mkdir('/home/student/project1', { recursive: true });
    }
    if (!await dirExists('/home/student/project2')) {
        await pfs.mkdir('/home/student/project2', { recursive: true });
    }

    // Setup project1 with initial files and commits (only if not already initialized)
    // Check for .git directory instead of specific files (works for any cloned repo)
    if (!await dirExists('/home/student/project1/.git')) {
        await setupProject1();
    }

    // Setup empty project2 (only if not already initialized)
    if (!await dirExists('/home/student/project2/.git')) {
        await setupProject2();
    }
}

async function setupProject1() {
    const project1Path = '/home/student/project1';

    try {
        // Get HTTP module (might be loaded dynamically)
        const httpModule = window.GitHttp || window.git?.http;

        // Check if HTTP module is available
        if (!httpModule) {
            throw new Error('isomorphic-git HTTP module not loaded. Check if the script is included in index.html');
        }

        // Clone the real GitHub repository
        console.log(`🔄 Cloning ${DEFAULT_REPO_URL}...`);
        console.log(`   Using CORS proxy: ${GIT_PROXY}`);
        console.log('   HTTP module available:', !!httpModule);
        console.log('   Git version:', git.version?.());

        await git.clone({
            fs,
            http: httpModule,
            dir: project1Path,
            url: DEFAULT_REPO_URL,
            corsProxy: GIT_PROXY,
            singleBranch: true,
            depth: 100, // Limit history depth for performance
            onProgress: (event) => {
                console.log(`   Progress: ${event.phase} ${event.loaded}/${event.total || '?'}`);
            },
            onMessage: (message) => {
                console.log(`   Git: ${message}`);
            }
        });

        // Configure git user for the cloned repo
        await git.setConfig({ fs, dir: project1Path, path: 'user.name', value: DEFAULT_USER.name });
        await git.setConfig({ fs, dir: project1Path, path: 'user.email', value: DEFAULT_USER.email });

        console.log('✅ Successfully cloned project1 from GitHub!');
        console.log('   Repository has real commit history from GitHub');

    } catch (error) {
        console.error('❌ Error cloning repository:', error);
        console.error('   Error name:', error.name);
        console.error('   Error message:', error.message);
        console.error('   Error stack:', error.stack);

        // Additional debugging
        if (error.data) {
            console.error('   Error data:', error.data);
        }
        if (error.caller) {
            console.error('   Error caller:', error.caller);
        }

        // Check if it's a network error
        if (error.message?.includes('fetch') || error.message?.includes('CORS') || error.message?.includes('network')) {
            console.error('   🌐 This appears to be a network/CORS error');
            console.error('   💡 Make sure:');
            console.error(`      1. GitHub repository is public (currently trying: ${DEFAULT_REPO_URL})`);
            console.error(`      2. CORS proxy is accessible (currently using: ${GIT_PROXY})`);
            console.error('      3. Network connection is working');
        }

        console.log('⚠️  Falling back to creating sample project...');

        // Fallback: Create sample project if cloning fails
        await createFallbackProject1(project1Path);
    }
}

async function createFallbackProject1(project1Path) {
    // Initialize git repo
    await git.init({ fs, dir: project1Path, defaultBranch: 'main' });

    // Configure git
    await git.setConfig({ fs, dir: project1Path, path: 'user.name', value: DEFAULT_USER.name });
    await git.setConfig({ fs, dir: project1Path, path: 'user.email', value: DEFAULT_USER.email });

    // Create initial HTML file
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hello World</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <h1>Hello World!</h1>
    <p>This is my first project.</p>
</body>
</html>`;

    await pfs.writeFile(`${project1Path}/index.html`, htmlContent, 'utf8');
    await git.add({ fs, dir: project1Path, filepath: 'index.html' });
    await git.commit({
        fs,
        dir: project1Path,
        author: DEFAULT_USER,
        message: 'Initial commit: Add index.html'
    });

    // Create CSS file
    const cssContent = `body {
    font-family: Arial, sans-serif;
    background-color: #f0f0f0;
}

h1 {
    color: #333;
}`;

    await pfs.writeFile(`${project1Path}/style.css`, cssContent, 'utf8');
    await git.add({ fs, dir: project1Path, filepath: 'style.css' });
    await git.commit({
        fs,
        dir: project1Path,
        author: DEFAULT_USER,
        message: 'Add basic styling'
    });

    // Update CSS
    const cssContent2 = `body {
    font-family: Arial, sans-serif;
    background-color: #e8f4f8;
    font-size: 16px;
}

h1 {
    color: #2c3e50;
    font-size: 32px;
}

p {
    color: #555;
}`;

    await pfs.writeFile(`${project1Path}/style.css`, cssContent2, 'utf8');
    await git.add({ fs, dir: project1Path, filepath: 'style.css' });
    await git.commit({
        fs,
        dir: project1Path,
        author: DEFAULT_USER,
        message: 'Update colors and font sizes'
    });

    // Create .gitignore
    const gitignoreContent = `*.log
*.tmp
node_modules/
.DS_Store`;

    await pfs.writeFile(`${project1Path}/.gitignore`, gitignoreContent, 'utf8');
    await git.add({ fs, dir: project1Path, filepath: '.gitignore' });
    await git.commit({
        fs,
        dir: project1Path,
        author: DEFAULT_USER,
        message: 'Add .gitignore file'
    });
}

async function setupProject2() {
    const project2Path = '/home/student/project2';
    // Just create empty directory, student will initialize git themselves
}

function printWelcome() {
    term.writeln('\x1b[36m╔════════════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[36m║        Welcome to the Git Learning Terminal!               ║\x1b[0m');
    term.writeln('\x1b[36m╚════════════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln('');
    term.writeln('\x1b[1;94m💡 This is a safe learning environment. Try any git command!\x1b[0m');
    term.writeln('\x1b[1;94m💡 Type "help" for available commands.\x1b[0m');
    term.writeln('\x1b[1;94m💡 Type "hints off" to disable educational hints.\x1b[0m');
    term.writeln('\x1b[1;94m💡 project1 is cloned from GitHub | project2 is empty for practice\x1b[0m');
    term.writeln('');
}

function showPrompt() {
    const dir = currentDir.replace('/home/student', '~');
    const branch = promptBranch ? ` \x1b[33m(${promptBranch})\x1b[0m` : '';
    term.write(`\x1b[32mstudent@gitlearning\x1b[0m:\x1b[34m${dir}\x1b[0m${branch}$ `);
}

function showPromptInline() {
    const dir = currentDir.replace('/home/student', '~');
    const branch = promptBranch ? ` \x1b[33m(${promptBranch})\x1b[0m` : '';
    term.write(`\x1b[32mstudent@gitlearning\x1b[0m:\x1b[34m${dir}\x1b[0m${branch}$ `);
}

// Helper functions

// Get configured author from git config (falls back to defaults)
async function getAuthor(dir) {
    try {
        const name = await git.getConfig({ fs, dir, path: 'user.name' }) || DEFAULT_USER.name;
        const email = await git.getConfig({ fs, dir, path: 'user.email' }) || DEFAULT_USER.email;
        return { name, email };
    } catch (e) {
        return { ...DEFAULT_USER };
    }
}

function formatLsDate(date) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, ' ');
    const now = new Date();
    // If within the last 6 months, show time; otherwise show year
    const sixMonths = 180 * 24 * 60 * 60 * 1000;
    if (now - date < sixMonths) {
        const hours = String(date.getHours()).padStart(2, '0');
        const mins = String(date.getMinutes()).padStart(2, '0');
        return `${mon} ${day} ${hours}:${mins}`;
    } else {
        return `${mon} ${day}  ${date.getFullYear()}`;
    }
}

function resolvePath(path) {
    let resolvedPath;

    if (path.startsWith('/')) {
        resolvedPath = path;
    } else if (path.startsWith('~')) {
        resolvedPath = path.replace('~', '/home/student');
    } else {
        resolvedPath = `${currentDir}/${path}`;
    }

    // Normalize the path: handle . and .. 
    const parts = resolvedPath.split('/').filter(p => p);
    const normalized = [];

    for (const part of parts) {
        if (part === '..') {
            if (normalized.length > 0) {
                normalized.pop();
            }
        } else if (part !== '.') {
            normalized.push(part);
        }
    }

    return '/' + normalized.join('/');
}

async function removeDirectory(dirPath) {
    const items = await fs.promises.readdir(dirPath);

    for (const item of items) {
        const itemPath = `${dirPath}/${item}`;
        const stat = await fs.promises.stat(itemPath);

        if (stat.isDirectory()) {
            await removeDirectory(itemPath);
        } else {
            await fs.promises.unlink(itemPath);
        }
    }

    await fs.promises.rmdir(dirPath);
}

// Recursively flatten a git tree into { filepath: blobOid } map
async function flattenTree(dir, treeOid, prefix = '') {
    const result = {};
    const { tree } = await git.readTree({ fs, dir, oid: treeOid });
    for (const entry of tree) {
        const fullPath = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === 'blob') {
            result[fullPath] = entry.oid;
        } else if (entry.type === 'tree') {
            const subFiles = await flattenTree(dir, entry.oid, fullPath);
            Object.assign(result, subFiles);
        }
    }
    return result;
}

function printNormal(text) {
    term.writeln(text);
}

function printHint(text) {
    if (!hintsEnabled) return;
    term.writeln(`\x1b[1;94m💡 \x1b[0m\x1b[1;94mHint: ${text}\x1b[0m`);
}

function printError(text) {
    term.writeln(`\x1b[31m${text}\x1b[0m`);
}

// Pipe handling
async function processPipedCommands(fullCommand) {
    try {
        const commands = splitOnPipe(fullCommand);
        let output = '';

        // Capture output from first command by temporarily intercepting term.writeln
        const originalWriteln = term.writeln.bind(term);
        const originalWrite = term.write.bind(term);
        let capturedLines = [];
        let capturing = false;

        function startCapture() {
            capturing = true;
            capturedLines = [];
            term.writeln = (text) => {
                if (text !== '') capturedLines.push(text);
            };
            term.write = (text) => {
                if (text !== '') capturedLines.push(text);
            };
        }

        function stopCapture() {
            capturing = false;
            term.writeln = originalWriteln;
            term.write = originalWrite;
            return capturedLines.join('\n');
        }

        // Execute first command and capture output
        const firstCmd = commands[0];
        const firstParts = tokenize(firstCmd);
        const firstCommand = firstParts[0];
        const firstArgs = firstParts.slice(1);

        // Special handling for commands that produce output
        startCapture();
        try {
            if (firstCommand === 'history') {
                output = commandHistory.map((cmd, i) => `${i + 1}  ${cmd}`).join('\n');
            } else if (firstCommand === 'cat') {
                for (const file of firstArgs) {
                    try {
                        const content = await pfs.readFile(resolvePath(file), 'utf8');
                        output += content;
                    } catch (e) { }
                }
            } else if (firstCommand === 'echo') {
                output = processEchoText(firstCmd.replace(/^echo\s*/, ''));
            } else if (firstCommand === 'ls') {
                const targetDir = firstArgs.length > 0 && !firstArgs[0].startsWith('-') ? resolvePath(firstArgs[0]) : currentDir;
                const showHidden = firstArgs.some(a => a.includes('a'));
                try {
                    const files = await pfs.readdir(targetDir);
                    const filtered = showHidden ? files : files.filter(f => !f.startsWith('.'));
                    output = filtered.join('\n');
                } catch (e) { }
            } else if (firstCommand === 'git') {
                // Run git command and capture its output
                await cmdGit(firstArgs);
                output = stopCapture();
                startCapture();
            } else if (firstCommand === 'find') {
                await cmdFind(firstArgs);
                output = stopCapture();
                startCapture();
            } else {
                // Try running the command generically
                const genericRunner = {
                    'head': () => cmdHead(firstArgs),
                    'tail': () => cmdTail(firstArgs),
                    'grep': () => cmdGrep(firstArgs),
                    'wc': () => cmdWc(firstArgs),
                    'env': () => cmdEnv(),
                    'printenv': () => cmdEnv(),
                };
                if (genericRunner[firstCommand]) {
                    await genericRunner[firstCommand]();
                    output = stopCapture();
                    startCapture();
                } else {
                    stopCapture();
                    printError(`Pipe not supported for: ${firstCommand}`);
                    return;
                }
            }
        } finally {
            stopCapture();
        }

        // Process remaining commands in the pipe
        for (let i = 1; i < commands.length; i++) {
            const pipeCmd = commands[i];
            const pipeParts = tokenize(pipeCmd);
            const pipeCommand = pipeParts[0];
            const pipeArgs = pipeParts.slice(1);

            if (pipeCommand === 'grep') {
                if (pipeArgs.length === 0) {
                    printError('grep: missing search pattern');
                    return;
                }
                const ignoreCase = pipeArgs.includes('-i');
                const invertMatch = pipeArgs.includes('-v');
                const countOnly = pipeArgs.includes('-c');
                const pattern = pipeArgs.filter(a => !a.startsWith('-'))[0]?.replace(/^["']|["']$/g, '');
                if (!pattern) { printError('grep: missing pattern'); return; }
                let regex;
                try { regex = new RegExp(pattern, ignoreCase ? 'i' : ''); } catch (e) { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
                const lines = output.split('\n');
                const filtered = lines.filter(line => {
                    // Strip ANSI codes for matching
                    const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
                    return regex.test(clean) !== invertMatch;
                });
                if (countOnly) {
                    output = String(filtered.length);
                } else {
                    output = filtered.join('\n');
                }
            } else if (pipeCommand === 'head') {
                let n = 10;
                if (pipeArgs[0] === '-n' && pipeArgs[1]) n = parseInt(pipeArgs[1], 10);
                else if (pipeArgs[0]?.startsWith('-')) n = parseInt(pipeArgs[0].slice(1), 10);
                output = output.split('\n').slice(0, n).join('\n');
            } else if (pipeCommand === 'tail') {
                let n = 10;
                if (pipeArgs[0] === '-n' && pipeArgs[1]) n = parseInt(pipeArgs[1], 10);
                else if (pipeArgs[0]?.startsWith('-')) n = parseInt(pipeArgs[0].slice(1), 10);
                output = output.split('\n').slice(-n).join('\n');
            } else if (pipeCommand === 'wc') {
                const showL = pipeArgs.includes('-l') || pipeArgs.length === 0;
                const showW = pipeArgs.includes('-w') || pipeArgs.length === 0;
                const lines = output.split('\n');
                const words = output.split(/\s+/).filter(w => w).length;
                let result = '';
                if (showL) result += String(lines.length).padStart(8);
                if (showW) result += String(words).padStart(8);
                output = result;
            } else if (pipeCommand === 'sort') {
                const lines = output.split('\n');
                const reverse = pipeArgs.includes('-r');
                const numeric = pipeArgs.includes('-n');
                lines.sort((a, b) => {
                    if (numeric) return parseFloat(a) - parseFloat(b);
                    return a.localeCompare(b);
                });
                if (reverse) lines.reverse();
                output = lines.join('\n');
            } else if (pipeCommand === 'uniq') {
                const lines = output.split('\n');
                output = lines.filter((line, i) => i === 0 || line !== lines[i - 1]).join('\n');
            } else if (pipeCommand === 'cat') {
                // cat with no args in pipe = passthrough (no-op)
            } else {
                printError(`Pipe command not supported: ${pipeCommand}`);
                return;
            }
        }

        // Print final output
        if (output) {
            output.split('\n').forEach(line => term.writeln(line));
        }
    } catch (error) {
        printError(`Pipe error: ${error.message}`);
    }
}

// Helper to remove comments (handles quotes)
function removeShellComments(cmd) {
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < cmd.length; i++) {
        const char = cmd[i];

        if (inQuote) {
            if (char === quoteChar) {
                inQuote = false;
            }
        } else {
            if (char === '"' || char === "'") {
                inQuote = true;
                quoteChar = char;
            } else if (char === '#') {
                // Comment starts if # is at start or preceded by whitespace
                if (i === 0 || /\s/.test(cmd[i - 1])) {
                    return cmd.substring(0, i);
                }
            }
        }
    }
    return cmd;
}

// Command processor
async function processCommand(cmd) {
    hidePreview();
    let trimmedCmd = removeShellComments(cmd).trim();
    if (!trimmedCmd) {
        showPrompt();
        return;
    }

    // Expand environment variables ($VAR, ${VAR})
    trimmedCmd = expandEnvVars(trimmedCmd);

    // History expansion: !!, !n, !-n, !string
    trimmedCmd = expandHistory(trimmedCmd);

    // Add to history (after expansion)
    commandHistory.push(trimmedCmd);
    historyIndex = commandHistory.length;

    // Handle && and || chaining (quote-aware)
    const chainParts = splitOnShellOperators(trimmedCmd);
    if (chainParts.length > 1) {
        let lastSuccess = true;
        for (let i = 0; i < chainParts.length; i++) {
            if (chainParts[i] === '&&') {
                if (!lastSuccess) break;
                continue;
            }
            if (chainParts[i] === '||') {
                if (lastSuccess) {
                    i++;
                    continue;
                }
                continue;
            }
            try {
                await executeSingleCommand(chainParts[i]);
                lastSuccess = true;
            } catch (error) {
                printError(`${error.message}`);
                lastSuccess = false;
            }
        }
        await updateFileTree();
        showPrompt();
        return;
    }

    await executeSingleCommand(trimmedCmd);
    await updateFileTree();
    showPrompt();
}

function expandEnvVars(str) {
    // Update PWD
    envVars.PWD = currentDir;
    // Expand ${VAR} and $VAR (not inside single quotes)
    return str.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, braced, plain) => {
        const varName = braced || plain;
        return envVars[varName] !== undefined ? envVars[varName] : match;
    });
}

async function executeSingleCommand(trimmedCmd) {
    // Handle pipes (quote-aware)
    const pipeParts = splitOnPipe(trimmedCmd);
    if (pipeParts.length > 1) {
        await processPipedCommands(trimmedCmd);
        return;
    }

    // Handle output redirect for non-echo commands
    const { command: cmdWithoutRedirect, redirectFile, isAppend } = parseRedirect(trimmedCmd);
    if (redirectFile) {
        const cmdName = tokenize(cmdWithoutRedirect)[0];
        if (cmdName !== 'echo') {
            // Capture output and write to file
            const capturedOutput = [];
            const origWriteln = term.writeln.bind(term);
            const origWrite = term.write.bind(term);
            term.writeln = (text) => capturedOutput.push(text);
            term.write = (text) => capturedOutput.push(text);
            try {
                await executeDispatch(cmdWithoutRedirect);
            } finally {
                term.writeln = origWriteln;
                term.write = origWrite;
            }
            const filepath = resolvePath(redirectFile);
            const content = capturedOutput.join('\n').replace(/\x1b\[[0-9;]*m/g, '') + '\n';
            try {
                if (isAppend) {
                    let existing = '';
                    try { existing = await pfs.readFile(filepath, 'utf8'); } catch (e) {}
                    await pfs.writeFile(filepath, existing + content, 'utf8');
                } else {
                    await pfs.writeFile(filepath, content, 'utf8');
                }
            } catch (error) {
                printError(`redirect: ${error.message}`);
            }
            return;
        }
    }

    await executeDispatch(trimmedCmd);
}

async function executeDispatch(trimmedCmd) {
    const parts = tokenize(trimmedCmd);
    const command = parts[0];
    let args = parts.slice(1);

    // Expand globs for file-operating commands
    const globCommands = ['ls', 'cat', 'rm', 'cp', 'mv', 'head', 'tail', 'wc', 'grep', 'touch', 'git'];
    if (globCommands.includes(command)) {
        args = await expandGlobs(args);
    }

    try {
        switch (command) {
            case 'help':
                await cmdHelp();
                break;
            case 'ls':
                await cmdLs(args);
                break;
            case 'll':
                await cmdLs(['-la']);
                break;
            case 'cd':
                await cmdCd(args);
                break;
            case 'pwd':
                await cmdPwd();
                break;
            case 'cat':
                await cmdCat(args);
                break;
            case 'mkdir':
                await cmdMkdir(args);
                break;
            case 'touch':
                await cmdTouch(args);
                break;
            case 'rm':
                await cmdRm(args);
                break;
            case 'clear':
                term.clear();
                break;
            case 'reset':
                await cmdReset();
                break;
            case 'history':
                await cmdHistory(args);
                break;
            case 'debug':
                await cmdDebug();
                break;
            case 'vi':
            case 'vim':
            case 'nano':
            case 'edit':
                await cmdEdit(args);
                break;
            case 'echo':
                await cmdEcho(args, trimmedCmd);
                break;
            case 'cp':
                await cmdCp(args);
                break;
            case 'mv':
                await cmdMv(args);
                break;
            case 'grep':
                await cmdGrep(args);
                break;
            case 'head':
                await cmdHead(args);
                break;
            case 'tail':
                await cmdTail(args);
                break;
            case 'wc':
                await cmdWc(args);
                break;
            case 'whoami':
                printNormal('student');
                printHint('Prints the current username. In real systems, this shows who is logged in.');
                break;
            case 'hostname':
                printNormal('gitlearning');
                printHint('Prints the system hostname. Used to identify the machine on a network.');
                break;
            case 'date':
                printNormal(new Date().toString());
                printHint('Prints the current date and time. Use "date +%Y-%m-%d" for custom formats in real bash.');
                break;
            case 'find':
                await cmdFind(args);
                break;
            case 'diff':
                await cmdDiff(args);
                break;
            case 'env':
            case 'printenv':
                cmdEnv();
                break;
            case 'export':
                cmdExport(args, trimmedCmd);
                break;
            case 'which':
                cmdWhich(args);
                break;
            case 'type':
                cmdType(args);
                break;
            case 'hints':
                cmdHints(args);
                break;
            case 'sort':
                await cmdSort(args);
                break;
            case 'uniq':
                await cmdUniq(args);
                break;
            case 'true':
                break;
            case 'false':
                throw new Error('false');
            case 'git':
                await cmdGit(args);
                break;
            case 'source':
            case '.':
                printError(`${command}: not supported in this environment`);
                printHint('In real bash, "source" runs commands from a file in the current shell.');
                break;
            case 'man':
                printError(`No manual entry for ${args[0] || 'unknown'}`);
                printHint('Use "help" to see available commands, or "<command> --help" for specific usage.');
                break;
            case 'sudo':
                printError('sudo: command not found (not needed in this sandbox)');
                printHint('This is a safe sandbox. All operations run as your user. No sudo needed!');
                break;
            default:
                printError(`${command}: command not found`);
                printHint('Type "help" to see available commands.');
        }
    } catch (error) {
        printError(`${error.message}`);
    }
}

async function cmdReset() {
    printNormal('\x1b[33mResetting filesystem to initial state...\x1b[0m');
    printNormal('This may take a few seconds while cloning from GitHub...');

    try {
        // Recursively delete all files and directories
        async function deleteRecursive(path) {
            try {
                const stat = await pfs.stat(path);
                if (stat.isDirectory()) {
                    const files = await pfs.readdir(path);
                    for (const file of files) {
                        await deleteRecursive(`${path}/${file}`);
                    }
                    await pfs.rmdir(path);
                } else {
                    await pfs.unlink(path);
                }
            } catch (e) {
                // Ignore errors for files that don't exist
                console.log(`Skip delete: ${path}`, e.message);
            }
        }

        // Delete all content under /home/student
        try {
            const projects = await pfs.readdir('/home/student');
            for (const project of projects) {
                await deleteRecursive(`/home/student/${project}`);
            }
        } catch (e) {
            console.log('Error deleting projects:', e);
        }

        // Reinitialize filesystem
        await setupFileSystem();

        // Reset to home directory
        currentDir = '/home/student';
        currentProject = 'project1';

        printNormal('\x1b[32m✓ Filesystem reset complete!\x1b[0m');
        printHint('project1 has been cloned from GitHub with real commit history!');
        printHint('Use "cd project1 && git log" to see the real commits.');

        await updateFileTree();
    } catch (error) {
        printError(`Error resetting filesystem: ${error.message}`);
        console.error('Reset error details:', error);
    }
}

async function cmdDebug() {
    printNormal('\x1b[33m=== Debug Information ===\x1b[0m');
    printNormal('');

    // Check HTTP module
    printNormal('\x1b[36mHTTP Module Status:\x1b[0m');
    printNormal(`  window.GitHttp: ${!!window.GitHttp ? '\x1b[32m✓ loaded\x1b[0m' : '\x1b[31m✗ not loaded\x1b[0m'}`);
    printNormal(`  window.git.http: ${!!window.git?.http ? '\x1b[32m✓ available\x1b[0m' : '\x1b[31m✗ not available\x1b[0m'}`);
    printNormal('');

    // Check project1 status
    printNormal('\x1b[36mProject1 Status:\x1b[0m');
    try {
        const gitDirExists = await pfs.stat('/home/student/project1/.git').then(() => true).catch(() => false);
        printNormal(`  .git directory: ${gitDirExists ? '\x1b[32m✓ exists\x1b[0m' : '\x1b[31m✗ not found\x1b[0m'}`);

        if (gitDirExists) {
            // Try to get the latest commit
            const commits = await git.log({ fs, dir: '/home/student/project1', depth: 1 });
            if (commits.length > 0) {
                const commit = commits[0];
                printNormal(`  Latest commit:`);
                printNormal(`    Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);
                printNormal(`    Message: ${commit.commit.message}`);
                printNormal(`    Date: ${new Date(commit.commit.author.timestamp * 1000).toLocaleString()}`);

                // Check if it's the fallback dummy project
                if (commit.commit.author.email === 'student@example.com') {
                    printNormal(`  \x1b[31m⚠️  This is the FALLBACK dummy project\x1b[0m`);
                    printHint('The GitHub clone must have failed. Check browser console for errors.');
                    printHint('Run "reset" to try cloning from GitHub again.');
                } else {
                    printNormal(`  \x1b[32m✓ This appears to be a REAL cloned repository\x1b[0m`);
                }
            }
        }
    } catch (error) {
        printError(`Error checking project1: ${error.message}`);
    }
    printNormal('');

    printHint('Check browser console (F12) for detailed logs');
}

async function cmdHistory(args) {
    if (commandHistory.length === 0) {
        printNormal('(no commands in history)');
        return;
    }

    printNormal('');
    commandHistory.forEach((cmd, index) => {
        term.writeln(`${String(index + 1).padStart(5)}  ${cmd}`);
    });

    printHint('Use Ctrl+R for reverse history search, or pipe to grep: "history | grep pattern"');
}

async function cmdHelp() {
    printNormal('\x1b[33m╔════════════════════════════════════════════════════════════╗');
    printNormal('║                  Available Commands                        ║');
    printNormal('╚════════════════════════════════════════════════════════════╝\x1b[0m');
    printNormal('\x1b[36mFile System Commands:\x1b[0m');
    printNormal('  ls [options]          - List directory contents (-l, -a, -la)');
    printNormal('  ll                    - List all files (alias for ls -la)');
    printNormal('  cd <directory>        - Change directory (supports -, ~, ..)');
    printNormal('  pwd                   - Print working directory');
    printNormal('  cat <file> [file2...] - Display file contents');
    printNormal('  mkdir [-p] <dir>      - Create directory (-p for parents)');
    printNormal('  touch <file>          - Create empty file');
    printNormal('  rm [-rf] <file>       - Remove file or directory');
    printNormal('  cp [-r] <src> <dest>  - Copy file or directory');
    printNormal('  mv <src> <dest>       - Move/rename file or directory');
    printNormal('  echo <text>           - Print text or redirect to file');
    printNormal('  head [-n N] <file>    - Display first N lines (default 10)');
    printNormal('  tail [-n N] <file>    - Display last N lines (default 10)');
    printNormal('  wc [-lwc] <file>      - Count lines, words, bytes');
    printNormal('  grep [opts] PAT file  - Search for pattern (-i, -n, -v, -c, -r)');
    printNormal('  find [dir] -name PAT  - Find files by name pattern');
    printNormal('  diff <file1> <file2>  - Compare two files');
    printNormal('  sort [-rnU] <file>    - Sort lines of a file');
    printNormal('  uniq [-cd] <file>     - Filter adjacent duplicate lines');
    printNormal('  vi/vim/nano <file>    - Edit file');
    printNormal('');
    printNormal('\x1b[36mSystem Commands:\x1b[0m');
    printNormal('  whoami                - Print current user');
    printNormal('  hostname              - Print hostname');
    printNormal('  date                  - Print current date/time');
    printNormal('  env / printenv        - Print environment variables');
    printNormal('  export KEY=VALUE      - Set environment variable');
    printNormal('  which <command>       - Locate a command');
    printNormal('  type <command>        - Show command type (builtin/external)');
    printNormal('  clear                 - Clear terminal');
    printNormal('  reset                 - Reset filesystem to initial state');
    printNormal('  history               - Show command history');
    printNormal('  hints [on|off]        - Toggle educational hints');
    printNormal('');
    printNormal('\x1b[36mShell Features:\x1b[0m');
    printNormal('  <cmd> && <cmd>        - Chain commands (stops on error)');
    printNormal('  <cmd> || <cmd>        - Chain commands (runs on failure)');
    printNormal('  <cmd> | <cmd>         - Pipe output (grep, head, tail, wc, sort, uniq)');
    printNormal('  <cmd> > file          - Redirect output to file (any command)');
    printNormal('  <cmd> >> file         - Append output to file');
    printNormal('  "quoted args"         - Arguments with spaces');
    printNormal('  $VAR / ${VAR}         - Environment variable expansion');
    printNormal('  !!                    - Repeat last command');
    printNormal('  !n / !-n / !string    - History expansion');
    printNormal('  *.txt                 - Glob pattern expansion');
    printNormal('  Ctrl+R                - Reverse history search');
    printNormal('  Tab                   - Auto-complete commands/files/branches');
    printNormal('  ↑/↓                   - Navigate command history');
    printNormal('');
    printNormal('\x1b[36mGit Commands (Basic):\x1b[0m');
    printNormal('  git init              - Initialize git repository');
    printNormal('  git status            - Show working tree status');
    printNormal('  git add <file>        - Add file to staging area');
    printNormal('  git commit [flags]    - Commit changes (-m, --amend, -a)');
    printNormal('  git log [flags]       - Show commit history (-n, --oneline, --graph, --author)');
    printNormal('  git branch [flags]    - List/create/delete/rename branches (-d, -D, -m)');
    printNormal('  git checkout <ref>    - Switch branches or restore files');
    printNormal('  git switch <branch>   - Switch branches (modern)');
    printNormal('  git restore <file>    - Restore working tree files');
    printNormal('  git diff [flags]      - Show changes (--staged, --stat)');
    printNormal('  git reset [mode]      - Reset current HEAD (--soft, --mixed, --hard)');
    printNormal('');
    printNormal('\x1b[36mGit Commands (Advanced):\x1b[0m');
    printNormal('  git revert <commit>   - Create a new commit that undoes a commit');
    printNormal('  git rebase <branch>   - Reapply commits on top of another base tip');
    printNormal('  git merge <branch>    - Merge branches');
    printNormal('  git cherry-pick <sha> - Apply changes from a specific commit');
    printNormal('  git blame <file>      - Show what revision and author last modified each line');
    printNormal('  git clean [flags]     - Remove untracked files (-n, -f, -d)');
    printNormal('  git reflog            - Manage reflog information');
    printNormal('  git shortlog          - Summarize git log output');
    printNormal('');
    printNormal('\x1b[36mGit Remote & Tags:\x1b[0m');
    printNormal('  git clone <url>       - Clone remote repository');
    printNormal('  git fetch             - Download objects from remote');
    printNormal('  git push [remote]     - Push to remote');
    printNormal('  git pull [remote]     - Pull from remote');
    printNormal('  git remote [cmd]      - Manage remotes (add, remove, rename, set-url)');
    printNormal('  git tag [name]        - Create, list, delete tags');
    printNormal('  git show [commit]     - Show commit details and diffs');
    printNormal('  git stash [cmd]       - Stash changes (push, pop, list, show, drop)');
    printNormal('  git config <key> <val>- Get/set configuration');
}

async function cmdLs(args) {
    try {
        const flagArgs = args.filter(arg => arg.startsWith('-')).join('');
        const showHidden = flagArgs.includes('a');
        const longFormat = flagArgs.includes('l');
        const pathArgs = args.filter(arg => !arg.startsWith('-'));

        let targetDir = currentDir;
        let isFile = false;
        let fileStat = null;
        let targetName = '';

        if (pathArgs.length > 0) {
            const targetPath = resolvePath(pathArgs[0]);
            try {
                const stat = await pfs.stat(targetPath);
                if (stat.isDirectory()) {
                    targetDir = targetPath;
                } else {
                    isFile = true;
                    fileStat = stat;
                    targetName = pathArgs[0].split('/').pop();
                }
            } catch (e) {
                printError(`ls: cannot access '${pathArgs[0]}': No such file or directory`);
                return;
            }
        }

        if (isFile) {
            if (longFormat) {
                const size = fileStat.size || 0;
                const mtime = fileStat.mtimeMs ? new Date(fileStat.mtimeMs) : new Date();
                const dateStr = formatLsDate(mtime);
                term.writeln(`-rw-r--r--  1 student student ${String(size).padStart(6)} ${dateStr} ${targetName}`);
            } else {
                term.writeln(targetName);
            }
            return;
        }

        const files = await pfs.readdir(targetDir);

        const fileInfos = await Promise.all(files.map(async (file) => {
            const fullPath = `${targetDir}/${file}`;
            const stats = await pfs.stat(fullPath);
            return {
                name: file,
                isDirectory: stats.isDirectory(),
                isHidden: file.startsWith('.'),
                size: stats.size || 0,
                mtime: stats.mtimeMs ? new Date(stats.mtimeMs) : new Date()
            };
        }));

        // Filter hidden files if not requested
        const filtered = showHidden ? fileInfos : fileInfos.filter(f => !f.isHidden);

        if (filtered.length === 0) {
            return;
        }

        if (longFormat) {
            // Calculate total blocks (simplified)
            const totalSize = filtered.reduce((sum, f) => sum + (f.size || 0), 0);
            term.writeln(`total ${Math.ceil(totalSize / 1024)}`);

            filtered.forEach(file => {
                const perms = file.isDirectory ? 'drwxr-xr-x' : '-rw-r--r--';
                const size = String(file.size).padStart(6);
                const dateStr = formatLsDate(file.mtime);
                let color = '\x1b[0m';
                let suffix = '';

                if (file.isDirectory) {
                    color = '\x1b[34m';
                    suffix = '/';
                }
                if (file.isHidden) {
                    color = '\x1b[90m';
                }

                term.writeln(`${perms}  1 student student ${size} ${dateStr} ${color}${file.name}${suffix}\x1b[0m`);
            });
        } else {
            // Multi-column layout (like real ls)
            const items = filtered.map(file => {
                let color = '\x1b[0m';
                let suffix = '';
                if (file.isDirectory) { color = '\x1b[34m'; suffix = '/'; }
                if (file.isHidden) { color = '\x1b[90m'; }
                return { display: `${color}${file.name}${suffix}\x1b[0m`, length: file.name.length + (file.isDirectory ? 1 : 0) };
            });

            // Calculate column width based on longest name + padding
            const maxLen = Math.max(...items.map(i => i.length));
            const colWidth = maxLen + 2;
            const termWidth = 80;
            const numCols = Math.max(1, Math.floor(termWidth / colWidth));

            let line = '';
            let col = 0;
            for (const item of items) {
                line += item.display + ' '.repeat(Math.max(1, colWidth - item.length));
                col++;
                if (col >= numCols) {
                    term.writeln(line.trimEnd());
                    line = '';
                    col = 0;
                }
            }
            if (line) {
                term.writeln(line.trimEnd());
            }
        }

        // Add spacing before hint (only for current dir if there are hidden files)
        if (targetDir === currentDir && !showHidden && fileInfos.some(f => f.isHidden)) {
            // hint removed to match real ls behavior
        }
    } catch (error) {
        printError(`ls: ${error.message}`);
    }
}

async function cmdCd(args) {
    if (args.length === 0) {
        previousDir = currentDir;
        currentDir = '/home/student';
        await updateFileTree();
        printHint('cd without arguments goes to your home directory (~).');
        return;
    }

    let newDir = args[0];

    // Handle cd - (go to previous directory)
    if (newDir === '-') {
        if (previousDir) {
            const tmp = currentDir;
            currentDir = previousDir;
            previousDir = tmp;
            printNormal(currentDir.replace('/home/student', '~'));
            await updateFileTree();
        } else {
            printError('-bash: cd: OLDPWD not set');
        }
        return;
    }

    // Handle current directory
    if (newDir === '.') {
        await updateFileTree();
        return;
    }

    // Handle home directory
    if (newDir === '~') {
        previousDir = currentDir;
        currentDir = '/home/student';
        await updateFileTree();
        return;
    }

    // Resolve the path (handles ., .., relative paths)
    newDir = resolvePath(newDir);

    // Restrict navigation to /home tree (sandbox)
    if (!newDir.startsWith('/home')) {
        printError('-bash: cd: restricted: cannot navigate above /home');
        printHint('This sandbox restricts navigation to the /home directory tree.');
        return;
    }

    try {
        const stats = await pfs.stat(newDir);
        if (stats.isDirectory()) {
            previousDir = currentDir;
            currentDir = newDir;
            // Update current project if in a project directory
            if (currentDir.includes('/project1')) {
                currentProject = 'project1';
            } else if (currentDir.includes('/project2')) {
                currentProject = 'project2';
            }
            await updateFileTree();
        } else {
            printError(`-bash: cd: ${args[0]}: Not a directory`);
        }
    } catch (error) {
        printError(`-bash: cd: ${args[0]}: No such file or directory`);
    }
}

async function cmdPwd() {
    printNormal(currentDir);
}

async function cmdCat(args) {
    if (args.length === 0) {
        printError('cat: missing file operand');
        printHint('Usage: cat <filename>');
        return;
    }

    for (const filename of args) {
        const filepath = resolvePath(filename);

        try {
            const content = await pfs.readFile(filepath, 'utf8');
            content.split('\n').forEach(line => {
                term.writeln(line);
            });
        } catch (error) {
            printError(`cat: ${filename}: No such file or directory`);
        }
    }
}

async function cmdMkdir(args) {
    if (args.length === 0) {
        printError('mkdir: missing operand');
        return;
    }

    // Extract flags
    const flags = args.filter(a => a.startsWith('-'));
    const dirs = args.filter(a => !a.startsWith('-'));
    const recursive = flags.includes('-p');

    for (const dirname of dirs) {
        const dirpath = resolvePath(dirname);

        try {
            if (!recursive) {
                // Check that parent directory exists
                const parentParts = dirpath.split('/');
                parentParts.pop();
                const parentPath = parentParts.join('/') || '/';
                try {
                    const parentStat = await pfs.stat(parentPath);
                    if (!parentStat.isDirectory()) {
                        printError(`mkdir: cannot create directory '${dirname}': Not a directory`);
                        continue;
                    }
                } catch (e) {
                    printError(`mkdir: cannot create directory '${dirname}': No such file or directory`);
                    continue;
                }
            }
            await pfs.mkdir(dirpath, { recursive: recursive });
        } catch (error) {
            printError(`mkdir: cannot create directory '${dirname}': ${error.message}`);
        }
    }
}

async function cmdTouch(args) {
    if (args.length === 0) {
        printError('touch: missing file operand');
        return;
    }

    for (const filename of args) {
        const filepath = resolvePath(filename);

        try {
            // Only create the file if it doesn't already exist (real touch updates mtime)
            try {
                await pfs.stat(filepath);
                // File exists -- real touch updates timestamp, but LightningFS doesn't support that
                // so just silently succeed like real touch
            } catch (e) {
                // File doesn't exist, create it
                await pfs.writeFile(filepath, '', 'utf8');
            }
        } catch (error) {
            printError(`touch: cannot create file '${filename}': ${error.message}`);
        }
    }
}

async function cmdEcho(_args, fullCmd) {
    // Extract everything after "echo "
    let echoContent = fullCmd.replace(/^echo\s*/, '');

    // Handle -n flag (no trailing newline)
    let noNewline = false;
    if (echoContent.startsWith('-n ')) {
        noNewline = true;
        echoContent = echoContent.slice(3);
    }

    // Check for redirect operators: >> (append) or > (overwrite)
    // Match redirect that's not inside quotes
    let redirectMatch = null;
    let isAppend = false;
    let textPart = echoContent;
    let redirectFile = null;

    // Simple redirect detection (outside quotes)
    const redir = echoContent.match(/^((?:[^"'>]|"[^"]*"|'[^']*')*?)\s*(>>|>)\s*(.+)$/);
    if (redir) {
        textPart = redir[1].trim();
        isAppend = redir[2] === '>>';
        redirectFile = redir[3].trim();
    }

    // Process the text: strip matching outer quotes, handle adjacent quoted segments
    let text = processEchoText(textPart);

    if (redirectFile) {
        const filepath = resolvePath(redirectFile);
        try {
            if (isAppend) {
                let existing = '';
                try { existing = await pfs.readFile(filepath, 'utf8'); } catch (e) { /* new file */ }
                await pfs.writeFile(filepath, existing + text + '\n', 'utf8');
            } else {
                await pfs.writeFile(filepath, text + '\n', 'utf8');
            }
        } catch (error) {
            printError(`echo: ${error.message}`);
        }
        return;
    }

    // No redirect, just print
    if (noNewline) {
        term.write(`\r\n${text}`);
    } else {
        printNormal(text);
    }
}

function processEchoText(text) {
    // Process echo text: handle "double quotes", 'single quotes', and concatenation
    let result = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] === '"') {
            // Double-quoted: find closing quote
            let j = i + 1;
            while (j < text.length && text[j] !== '"') {
                if (text[j] === '\\' && j + 1 < text.length) {
                    result += text[j + 1];
                    j += 2;
                } else {
                    result += text[j];
                    j++;
                }
            }
            i = j + 1;
        } else if (text[i] === "'") {
            // Single-quoted: literal, find closing quote
            let j = i + 1;
            while (j < text.length && text[j] !== "'") {
                result += text[j];
                j++;
            }
            i = j + 1;
        } else if (text[i] === '\\' && i + 1 < text.length) {
            result += text[i + 1];
            i += 2;
        } else {
            result += text[i];
            i++;
        }
    }
    return result;
}

async function cmdRm(args) {
    if (args.length === 0) {
        printError('rm: missing operand');
        return;
    }

    // Extract flags
    const flags = args.filter(a => a.startsWith('-'));
    const files = args.filter(a => !a.startsWith('-'));
    const recursive = flags.some(f => f.includes('r') || f.includes('R'));
    const force = flags.some(f => f.includes('f'));

    if (files.length === 0) {
        printError('rm: missing operand');
        return;
    }

    for (const filename of files) {
        const filepath = resolvePath(filename);

        try {
            const stat = await pfs.stat(filepath);
            if (stat.isDirectory()) {
                if (!recursive) {
                    printError(`rm: cannot remove '${filename}': Is a directory`);
                    printHint('Use rm -r to remove directories');
                    continue;
                }
                await removeDirectory(filepath);
            } else {
                await pfs.unlink(filepath);
            }
        } catch (error) {
            if (!force) {
                printError(`rm: cannot remove '${filename}': No such file or directory`);
            }
        }
    }
}

async function cmdCp(args) {
    const flags = args.filter(a => a.startsWith('-'));
    const paths = args.filter(a => !a.startsWith('-'));
    const recursive = flags.some(f => f.includes('r') || f.includes('R'));

    if (paths.length < 2) {
        printError('cp: missing file operand');
        printHint('Usage: cp [-r] <source> <destination>');
        return;
    }

    const src = resolvePath(paths[0]);
    const dest = resolvePath(paths[1]);

    try {
        const srcStat = await pfs.stat(src);

        if (srcStat.isDirectory()) {
            if (!recursive) {
                printError(`cp: -r not specified; omitting directory '${paths[0]}'`);
                return;
            }
            await copyDirectoryRecursive(src, dest);
        } else {
            // Check if dest is a directory
            let destPath = dest;
            try {
                const destStat = await pfs.stat(dest);
                if (destStat.isDirectory()) {
                    destPath = `${dest}/${paths[0].split('/').pop()}`;
                }
            } catch (e) { /* dest doesn't exist, use as-is */ }
            const content = await pfs.readFile(src, 'utf8');
            await pfs.writeFile(destPath, content, 'utf8');
        }
    } catch (error) {
        printError(`cp: cannot stat '${paths[0]}': No such file or directory`);
    }
}

async function copyDirectoryRecursive(src, dest) {
    try { await pfs.mkdir(dest); } catch (e) { /* exists */ }
    const entries = await pfs.readdir(src);
    for (const entry of entries) {
        const srcPath = `${src}/${entry}`;
        const destPath = `${dest}/${entry}`;
        const stat = await pfs.stat(srcPath);
        if (stat.isDirectory()) {
            await copyDirectoryRecursive(srcPath, destPath);
        } else {
            const content = await pfs.readFile(srcPath, 'utf8');
            await pfs.writeFile(destPath, content, 'utf8');
        }
    }
}

async function cmdMv(args) {
    if (args.length < 2) {
        printError('mv: missing file operand');
        printHint('Usage: mv <source> <destination>');
        return;
    }

    const src = resolvePath(args[0]);
    const dest = resolvePath(args[1]);

    try {
        const srcStat = await pfs.stat(src);

        let destPath = dest;
        try {
            const destStat = await pfs.stat(dest);
            if (destStat.isDirectory()) {
                destPath = `${dest}/${args[0].split('/').pop()}`;
            }
        } catch (e) { /* dest doesn't exist */ }

        if (srcStat.isDirectory()) {
            // Move directory: copy + remove
            await copyDirectoryRecursive(src, destPath);
            await removeDirectory(src);
        } else {
            const content = await pfs.readFile(src, 'utf8');
            await pfs.writeFile(destPath, content, 'utf8');
            await pfs.unlink(src);
        }
    } catch (error) {
        printError(`mv: cannot stat '${args[0]}': No such file or directory`);
    }
}

async function cmdGrep(args) {
    const flags = args.filter(a => a.startsWith('-'));
    const nonFlags = args.filter(a => !a.startsWith('-'));
    const ignoreCase = flags.some(f => f.includes('i'));
    const lineNumbers = flags.some(f => f.includes('n'));
    const invertMatch = flags.some(f => f.includes('v'));
    const countOnly = flags.some(f => f.includes('c'));
    const recursive = flags.some(f => f.includes('r') || f.includes('R'));

    if (nonFlags.length < 1) {
        printError('Usage: grep [options] PATTERN [FILE...]');
        return;
    }

    const pattern = nonFlags[0];
    const fileArgs = nonFlags.slice(1);
    let regex;
    try {
        regex = new RegExp(pattern, ignoreCase ? 'i' : '');
    } catch (e) {
        printError(`grep: Invalid regex pattern: ${pattern}`);
        return;
    }

    const targets = fileArgs.length > 0 ? fileArgs : ['.'];
    const multiFile = fileArgs.length > 1 || recursive;

    async function grepFile(filepath, displayName) {
        try {
            const content = await pfs.readFile(filepath, 'utf8');
            const lines = content.split('\n');
            let matchCount = 0;
            const results = [];

            lines.forEach((line, idx) => {
                const matches = regex.test(line);
                if (matches !== invertMatch) {
                    matchCount++;
                    if (!countOnly) {
                        const prefix = multiFile ? `\x1b[35m${displayName}\x1b[36m:\x1b[0m` : '';
                        const lineNum = lineNumbers ? `\x1b[32m${idx + 1}\x1b[36m:\x1b[0m` : '';
                        // Highlight matches
                        const highlighted = line.replace(regex, (m) => `\x1b[1;31m${m}\x1b[0m`);
                        results.push(`${prefix}${lineNum}${highlighted}`);
                    }
                }
            });

            if (countOnly) {
                const prefix = multiFile ? `${displayName}:` : '';
                printNormal(`${prefix}${matchCount}`);
            } else {
                results.forEach(r => term.writeln(r));
            }
        } catch (e) {
            // Skip non-readable files
        }
    }

    async function grepDir(dirPath, prefix) {
        try {
            const entries = await pfs.readdir(dirPath);
            for (const entry of entries) {
                if (entry.startsWith('.')) continue;
                const fullPath = `${dirPath}/${entry}`;
                const displayName = prefix ? `${prefix}/${entry}` : entry;
                try {
                    const stat = await pfs.stat(fullPath);
                    if (stat.isDirectory()) {
                        if (recursive) await grepDir(fullPath, displayName);
                    } else {
                        await grepFile(fullPath, displayName);
                    }
                } catch (e) { }
            }
        } catch (e) { }
    }

    for (const target of targets) {
        const resolvedPath = resolvePath(target);
        try {
            const stat = await pfs.stat(resolvedPath);
            if (stat.isDirectory()) {
                if (!recursive) {
                    printError(`grep: ${target}: Is a directory`);
                } else {
                    await grepDir(resolvedPath, target === '.' ? '' : target);
                }
            } else {
                await grepFile(resolvedPath, target);
            }
        } catch (e) {
            printError(`grep: ${target}: No such file or directory`);
        }
    }
}

async function cmdHead(args) {
    let lines = 10;
    const files = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && i + 1 < args.length) {
            lines = parseInt(args[++i], 10);
        } else if (args[i].startsWith('-') && !isNaN(args[i].slice(1))) {
            lines = parseInt(args[i].slice(1), 10);
        } else if (!args[i].startsWith('-')) {
            files.push(args[i]);
        }
    }

    if (files.length === 0) {
        printError('head: missing file operand');
        return;
    }

    for (const file of files) {
        try {
            const content = await pfs.readFile(resolvePath(file), 'utf8');
            if (files.length > 1) printNormal(`==> ${file} <==`);
            const allLines = content.split('\n');
            allLines.slice(0, lines).forEach(l => term.writeln(l));
        } catch (e) {
            printError(`head: cannot open '${file}': No such file or directory`);
        }
    }
}

async function cmdTail(args) {
    let lines = 10;
    const files = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && i + 1 < args.length) {
            lines = parseInt(args[++i], 10);
        } else if (args[i].startsWith('-') && !isNaN(args[i].slice(1))) {
            lines = parseInt(args[i].slice(1), 10);
        } else if (!args[i].startsWith('-')) {
            files.push(args[i]);
        }
    }

    if (files.length === 0) {
        printError('tail: missing file operand');
        return;
    }

    for (const file of files) {
        try {
            const content = await pfs.readFile(resolvePath(file), 'utf8');
            if (files.length > 1) printNormal(`==> ${file} <==`);
            const allLines = content.split('\n');
            allLines.slice(-lines).forEach(l => term.writeln(l));
        } catch (e) {
            printError(`tail: cannot open '${file}': No such file or directory`);
        }
    }
}

async function cmdWc(args) {
    const flags = args.filter(a => a.startsWith('-'));
    const files = args.filter(a => !a.startsWith('-'));
    const showLines = flags.length === 0 || flags.some(f => f.includes('l'));
    const showWords = flags.length === 0 || flags.some(f => f.includes('w'));
    const showBytes = flags.length === 0 || flags.some(f => f.includes('c'));

    if (files.length === 0) {
        printError('wc: missing file operand');
        return;
    }

    let totalLines = 0, totalWords = 0, totalBytes = 0;

    for (const file of files) {
        try {
            const content = await pfs.readFile(resolvePath(file), 'utf8');
            const lineCount = content.split('\n').length;
            const wordCount = content.split(/\s+/).filter(w => w).length;
            const byteCount = new TextEncoder().encode(content).length;

            totalLines += lineCount;
            totalWords += wordCount;
            totalBytes += byteCount;

            let out = '';
            if (showLines) out += String(lineCount).padStart(8);
            if (showWords) out += String(wordCount).padStart(8);
            if (showBytes) out += String(byteCount).padStart(8);
            out += ` ${file}`;
            printNormal(out);
        } catch (e) {
            printError(`wc: ${file}: No such file or directory`);
        }
    }

    if (files.length > 1) {
        let out = '';
        if (showLines) out += String(totalLines).padStart(8);
        if (showWords) out += String(totalWords).padStart(8);
        if (showBytes) out += String(totalBytes).padStart(8);
        out += ' total';
        printNormal(out);
    }
}

async function cmdFind(args) {
    let searchDir = '.';
    let namePattern = null;
    let typeFilter = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-name' && i + 1 < args.length) {
            namePattern = args[++i].replace(/^["']|["']$/g, '');
        } else if (args[i] === '-type' && i + 1 < args.length) {
            typeFilter = args[++i];
        } else if (!args[i].startsWith('-')) {
            searchDir = args[i];
        }
    }

    const rootPath = resolvePath(searchDir);

    async function findRecursive(dirPath, prefix) {
        try {
            const entries = await pfs.readdir(dirPath);
            for (const entry of entries) {
                if (entry === '.git') continue;
                const fullPath = `${dirPath}/${entry}`;
                const displayPath = prefix ? `${prefix}/${entry}` : `./${entry}`;
                try {
                    const stat = await pfs.stat(fullPath);
                    const isDir = stat.isDirectory();

                    // Type filter: 'f' = file, 'd' = directory
                    if (typeFilter === 'f' && isDir) { /* skip display */ }
                    else if (typeFilter === 'd' && !isDir) { /* skip display */ }
                    else {
                        // Name matching with glob support
                        if (namePattern) {
                            const regex = new RegExp('^' + namePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
                            if (regex.test(entry)) {
                                printNormal(displayPath);
                            }
                        } else {
                            printNormal(displayPath);
                        }
                    }

                    if (isDir) {
                        await findRecursive(fullPath, displayPath);
                    }
                } catch (e) { }
            }
        } catch (e) { }
    }

    // Print root directory first (unless type filter excludes directories)
    if (typeFilter !== 'f') {
        printNormal(searchDir === '.' ? '.' : searchDir);
    }
    await findRecursive(rootPath, searchDir === '.' ? '.' : searchDir);
}

async function cmdDiff(args) {
    if (args.length < 2) {
        printError('Usage: diff <file1> <file2>');
        return;
    }

    try {
        const content1 = await pfs.readFile(resolvePath(args[0]), 'utf8');
        const content2 = await pfs.readFile(resolvePath(args[1]), 'utf8');

        if (content1 === content2) {
            // No output for identical files (matches real diff)
            return;
        }

        await printColorizedDiff(content1, content2, args[1]);
    } catch (e) {
        printError(`diff: ${e.message}`);
    }
}

function cmdEnv() {
    // Update PWD
    envVars.PWD = currentDir;
    for (const [key, value] of Object.entries(envVars)) {
        printNormal(`${key}=${value}`);
    }
    printHint('Environment variables configure your shell session. Use "export KEY=VALUE" to set one.');
}

function cmdExport(args, fullCmd) {
    const exportContent = fullCmd.replace(/^export\s+/, '');
    const eqIndex = exportContent.indexOf('=');
    if (eqIndex === -1) {
        // Just show the variable
        const val = envVars[exportContent.trim()];
        if (val !== undefined) {
            printNormal(`declare -x ${exportContent.trim()}="${val}"`);
        }
        return;
    }
    const key = exportContent.substring(0, eqIndex).trim();
    let value = exportContent.substring(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    envVars[key] = value;
    printHint(`Environment variable ${key} set. Use "env" or "echo $${key}" to verify.`);
}

function cmdWhich(args) {
    if (args.length === 0) {
        printError('which: missing argument');
        return;
    }
    const available = ['ls', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'echo', 'grep', 'head', 'tail', 'wc', 'find', 'diff', 'sort', 'uniq', 'git', 'vi', 'vim', 'nano'];
    for (const cmd of args) {
        if (available.includes(cmd)) {
            printNormal(`/usr/bin/${cmd}`);
        } else {
            printError(`which: no ${cmd} in (${envVars.PATH})`);
        }
    }
    printHint('"which" locates the executable file for a command in your PATH.');
}

function cmdType(args) {
    if (args.length === 0) {
        printError('-bash: type: missing argument');
        return;
    }
    const builtins = ['cd', 'pwd', 'echo', 'export', 'history', 'alias', 'type', 'source'];
    const available = ['ls', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'grep', 'head', 'tail', 'wc', 'find', 'diff', 'sort', 'uniq', 'git', 'vi', 'vim', 'nano'];
    for (const cmd of args) {
        if (builtins.includes(cmd)) {
            printNormal(`${cmd} is a shell builtin`);
        } else if (available.includes(cmd)) {
            printNormal(`${cmd} is /usr/bin/${cmd}`);
        } else {
            printError(`-bash: type: ${cmd}: not found`);
        }
    }
    printHint('"type" shows how a command name would be interpreted (builtin, alias, or external).');
}

function cmdHints(args) {
    if (args[0] === 'off') {
        hintsEnabled = false;
        printNormal('Educational hints disabled. Use "hints on" to re-enable.');
    } else if (args[0] === 'on') {
        hintsEnabled = true;
        printNormal('Educational hints enabled.');
    } else {
        hintsEnabled = !hintsEnabled;
        printNormal(`Educational hints ${hintsEnabled ? 'enabled' : 'disabled'}.`);
    }
    hidePreview();
}

async function cmdSort(args) {
    const reverse = args.includes('-r');
    const numeric = args.includes('-n');
    const unique = args.includes('-u');
    const fileArgs = args.filter(a => !a.startsWith('-'));

    let content = '';
    if (fileArgs.length === 0) {
        printError('sort: missing file operand');
        printHint('Usage: sort [options] <file>  Options: -r (reverse), -n (numeric), -u (unique)');
        return;
    }
    for (const file of fileArgs) {
        try {
            content += await pfs.readFile(resolvePath(file), 'utf8');
        } catch (e) {
            printError(`sort: ${file}: No such file or directory`);
            return;
        }
    }
    let lines = content.split('\n');
    lines.sort((a, b) => {
        if (numeric) return parseFloat(a) - parseFloat(b);
        return a.localeCompare(b);
    });
    if (reverse) lines.reverse();
    if (unique) lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
    lines.forEach(l => term.writeln(l));
    printHint('"sort" orders lines alphabetically. Use -n for numeric, -r for reverse, -u to remove duplicates.');
}

async function cmdUniq(args) {
    const countFlag = args.includes('-c');
    const dupsOnly = args.includes('-d');
    const fileArgs = args.filter(a => !a.startsWith('-'));

    let content = '';
    if (fileArgs.length === 0) {
        printError('uniq: missing file operand');
        printHint('Usage: uniq [options] <file>  Options: -c (count), -d (only duplicates)');
        return;
    }
    for (const file of fileArgs) {
        try {
            content += await pfs.readFile(resolvePath(file), 'utf8');
        } catch (e) {
            printError(`uniq: ${file}: No such file or directory`);
            return;
        }
    }
    const lines = content.split('\n');
    const result = [];
    let prevLine = null;
    let count = 0;
    for (const line of lines) {
        if (line === prevLine) {
            count++;
        } else {
            if (prevLine !== null) {
                if (!dupsOnly || count > 1) {
                    result.push(countFlag ? `${String(count).padStart(7)} ${prevLine}` : prevLine);
                }
            }
            prevLine = line;
            count = 1;
        }
    }
    if (prevLine !== null) {
        if (!dupsOnly || count > 1) {
            result.push(countFlag ? `${String(count).padStart(7)} ${prevLine}` : prevLine);
        }
    }
    result.forEach(l => term.writeln(l));
    printHint('"uniq" filters out adjacent duplicate lines. Sort first for full dedup: sort file | uniq');
}

async function cmdEdit(args) {
    if (args.length === 0) {
        printError('No file specified');
        printHint('Usage: vi <filename> or nano <filename>');
        return;
    }

    const filename = args[0];
    const filepath = filename.startsWith('/') ? filename : `${currentDir}/${filename}`;

    editorFile = filepath;

    try {
        // Try to read existing file
        try {
            editorOriginalContent = await pfs.readFile(filepath, 'utf8');
        } catch {
            // File doesn't exist, create new
            editorOriginalContent = '';
        }

        openEditor(filename, editorOriginalContent);
        printHint('Editor opened. Edit the file and use Ctrl+S to save, Ctrl+X to close.');
    } catch (error) {
        printError(`Error opening file: ${error.message}`);
    }
}

// Git commands
async function cmdGit(args) {
    if (args.length === 0) {
        printError('usage: git <command> [<args>]');
        printHint('Type "help" to see available git commands');
        return;
    }

    const subcmd = args[0];
    const subargs = args.slice(1);

    // Check if in a git repo for most commands
    const needsRepo = !['init', 'clone', 'help'].includes(subcmd);
    if (needsRepo) {
        try {
            await git.findRoot({ fs, filepath: currentDir });
        } catch {
            printError('fatal: not a git repository (or any of the parent directories): .git');
            printHint('Use "git init" to create a git repository');
            return;
        }
    }

    switch (subcmd) {
        case 'init':
            await gitInit(subargs);
            break;
        case 'status':
            await gitStatus(subargs);
            break;
        case 'add':
            await gitAdd(subargs);
            break;
        case 'commit':
            await gitCommit(subargs);
            break;
        case 'log':
            await gitLog(subargs);
            break;
        case 'branch':
            await gitBranch(subargs);
            break;
        case 'checkout':
            await gitCheckout(subargs);
            break;
        case 'diff':
            await gitDiff(subargs);
            break;
        case 'reset':
            await gitReset(subargs);
            break;
        case 'remote':
            await gitRemote(subargs);
            break;
        case 'push':
            await gitPush(subargs);
            break;
        case 'pull':
            await gitPull(subargs);
            break;
        case 'clone':
            await gitClone(subargs);
            break;
        case 'rm':
            await gitRm(subargs);
            break;
        case 'mv':
            await gitMv(subargs);
            break;
        case 'merge':
            await gitMerge(subargs);
            break;
        case 'tag':
            await gitTag(subargs);
            break;
        case 'show':
            await gitShow(subargs);
            break;
        case 'fetch':
            await gitFetch(subargs);
            break;
        case 'stash':
            await gitStash(subargs);
            break;
        case 'config':
            await gitConfig(subargs);
            break;
        case 'revert':
            await gitRevert(subargs);
            break;
        case 'restore':
            await gitRestore(subargs);
            break;
        case 'switch':
            await gitSwitch(subargs);
            break;
        case 'rebase':
            await gitRebase(subargs);
            break;
        case 'reflog':
            await gitReflog(subargs);
            break;
        case 'clean':
            await gitClean(subargs);
            break;
        case 'shortlog':
            await gitShortlog(subargs);
            break;
        case 'cherry-pick':
            await gitCherryPick(subargs);
            break;
        case 'blame':
            await gitBlame(subargs);
            break;
        default:
            printError(`git: '${subcmd}' is not a git command. See 'help'.`);
    }
}

async function gitInit(args) {
    try {
        await git.init({ fs, dir: currentDir, defaultBranch: 'main' });
        await git.setConfig({ fs, dir: currentDir, path: 'user.name', value: 'Student' });
        await git.setConfig({ fs, dir: currentDir, path: 'user.email', value: 'student@example.com' });

        printNormal(`Initialized empty Git repository in ${currentDir}/.git/`);
        printHint('Great! Now you can add files with "git add <filename>" and commit with "git commit -m <message>"');
    } catch (error) {
        printError(`git init failed: ${error.message}`);
    }
}

async function gitStatus(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Check if we're in the middle of a merge
        let mergeInProgress = false;
        try {
            await pfs.stat(`${dir}/.git/MERGE_HEAD`);
            mergeInProgress = true;
        } catch (e) {
            // Not in merge
        }

        const status = await git.statusMatrix({ fs, dir });

        // Get current branch
        let currentBranch = 'main';
        try {
            currentBranch = await git.currentBranch({ fs, dir });
        } catch (e) {
            // Fallback to main
        }

        printNormal(`On branch ${currentBranch}`);

        if (mergeInProgress) {
            printError('You have unmerged paths.');
            printNormal('  (fix conflicts and run "git commit")');
            printNormal('  (use "git merge --abort" to abort the merge)');
            printNormal('');
        }

        const staged = [];     // { filepath, type } where type is 'new file'|'modified'|'deleted'
        const modified = [];
        const untracked = [];
        const conflicted = [];
        const deleted = [];

        for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
            // Skip .git directory entries
            if (filepath.startsWith('.git/')) continue;

            // Check if file has conflict markers
            if (mergeInProgress && workdirStatus === 2) {
                try {
                    const content = await pfs.readFile(`${dir}/${filepath}`, 'utf8');
                    if (content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>')) {
                        conflicted.push(filepath);
                        continue;
                    }
                } catch (e) {
                    // Ignore read errors
                }
            }

            // HEADStatus: 0 = absent, 1 = present
            // workdirStatus: 0 = absent, 1 = unchanged, 2 = modified
            // stageStatus: 0 = absent, 1 = unchanged, 2 = added, 3 = modified

            if (HEADStatus === 0 && workdirStatus === 2 && stageStatus === 2) {
                staged.push({ filepath, type: 'new file' });
            } else if (HEADStatus === 1 && workdirStatus === 2 && stageStatus === 2) {
                staged.push({ filepath, type: 'modified' });
            } else if (HEADStatus === 1 && stageStatus === 2 && workdirStatus === 0) {
                staged.push({ filepath, type: 'deleted' });
            } else if (workdirStatus === 2 && stageStatus === 1) {
                modified.push(filepath);
            } else if (HEADStatus === 1 && workdirStatus === 0 && stageStatus === 1) {
                deleted.push(filepath);
            } else if (HEADStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
                untracked.push(filepath);
            }
        }

        if (staged.length === 0 && modified.length === 0 && untracked.length === 0 && conflicted.length === 0 && deleted.length === 0) {
            if (!mergeInProgress) {
                printNormal('\nnothing to commit, working tree clean');
                printHint('Your working directory is clean. Try modifying a file or creating a new one!');
            }
            return;
        }

        if (conflicted.length > 0) {
            printNormal('\nUnmerged paths:');
            printNormal('  (use "git add <file>..." to mark resolution)');
            printNormal('');
            conflicted.forEach(file => {
                term.writeln(`\t\x1b[31mboth modified:   ${file}\x1b[0m`);
            });
            printHint('Edit the files to resolve conflicts, then use "git add <file>" to mark as resolved');
        }

        if (staged.length > 0) {
            printNormal('\nChanges to be committed:');
            printNormal('  (use "git reset HEAD <file>..." to unstage)');
            printNormal('');
            staged.forEach(({ filepath, type }) => {
                term.writeln(`\t\x1b[32m${type}:   ${filepath}\x1b[0m`);
            });
            printHint('These files are staged and ready to commit with "git commit -m <message>"');
        }

        if (modified.length > 0) {
            printNormal('\nChanges not staged for commit:');
            printNormal('  (use "git add <file>..." to update what will be committed)');
            printNormal('');
            modified.forEach(file => {
                term.writeln(`\t\x1b[31mmodified:   ${file}\x1b[0m`);
            });
            printHint('Use "git add <file>" to stage these changes for commit');
        }

        if (deleted.length > 0) {
            printNormal('\nChanges not staged for commit:');
            printNormal('  (use "git add/rm <file>..." to update what will be committed)');
            printNormal('');
            deleted.forEach(file => {
                term.writeln(`\t\x1b[31mdeleted:    ${file}\x1b[0m`);
            });
            printHint('Use "git rm <file>" to stage the deletion for commit');
        }

        if (untracked.length > 0) {
            printNormal('\nUntracked files:');
            printNormal('  (use "git add <file>..." to include in what will be committed)');
            printNormal('');
            untracked.forEach(file => {
                term.writeln(`\t\x1b[31m${file}\x1b[0m`);
            });
            printHint('These files are not tracked by git. Use "git add <file>" to start tracking them');
        }

    } catch (error) {
        printError(`git status failed: ${error.message}`);
    }
}

async function gitAdd(args) {
    if (args.length === 0) {
        printError('Nothing specified, nothing added.');
        printHint('Usage: git add <filename>');
        return;
    }

    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args[0] === '.') {
            // Add all files (including deletions)
            const status = await git.statusMatrix({ fs, dir });
            for (const [filepath, HEADStatus, workdirStatus] of status) {
                if (filepath.startsWith('.git/')) continue;
                if (workdirStatus === 2) {
                    await git.add({ fs, dir, filepath });
                } else if (HEADStatus === 1 && workdirStatus === 0) {
                    // File was deleted from working directory
                    await git.remove({ fs, dir, filepath });
                }
            }
            printHint('All files staged. Use "git commit -m <message>" to save changes.');
        } else {
            for (const file of args) {
                // Resolve the filepath relative to repo root
                const absPath = resolvePath(file);
                let relPath = absPath;
                if (absPath.startsWith(dir + '/')) {
                    relPath = absPath.slice(dir.length + 1);
                } else if (absPath.startsWith(dir)) {
                    relPath = absPath.slice(dir.length);
                    if (relPath.startsWith('/')) relPath = relPath.slice(1);
                }
                // If relPath is empty (user typed the repo root), treat as '.'
                if (!relPath) relPath = file;

                try {
                    // Check if file was deleted
                    try {
                        await pfs.stat(absPath);
                        await git.add({ fs, dir, filepath: relPath });
                    } catch (e) {
                        // File doesn't exist on disk - remove from index
                        await git.remove({ fs, dir, filepath: relPath });
                    }
                } catch (error) {
                    printError(`fatal: pathspec '${file}' did not match any files`);
                }
            }
            printHint('Use "git status" to see what\'s staged, then "git commit -m <message>" to commit');
        }
    } catch (error) {
        printError(`git add failed: ${error.message}`);
        printHint('Make sure the file exists in the current directory');
    }
}

async function gitCommit(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        const hasAmend = args.includes('--amend');
        const autoStage = args.includes('-a') || args.includes('-am');

        // Parse commit message
        let message = '';
        const mIndex = args.indexOf('-m');
        // Handle -am "message" shorthand
        const amIndex = args.indexOf('-am');
        if (mIndex !== -1 && args.length > mIndex + 1) {
            message = args[mIndex + 1];
        } else if (amIndex !== -1 && args.length > amIndex + 1) {
            message = args[amIndex + 1];
        }

        // Auto-stage tracked modified files
        if (autoStage) {
            const statusMatrix = await git.statusMatrix({ fs, dir });
            for (const [filepath, HEADStatus, workdirStatus, stageStatus] of statusMatrix) {
                // Stage tracked files that are modified (HEADStatus=1 means tracked)
                if (HEADStatus === 1 && workdirStatus !== 1) {
                    if (workdirStatus === 0) {
                        // Deleted
                        await git.remove({ fs, dir, filepath });
                    } else {
                        // Modified
                        await git.add({ fs, dir, filepath });
                    }
                }
            }
        }

        if (hasAmend) {
            // Amend the last commit
            const commits = await git.log({ fs, dir, depth: 1 });
            if (commits.length === 0) {
                printError('fatal: No commits to amend');
                return;
            }

            const lastCommit = commits[0];
            const parentOid = lastCommit.commit.parent[0] || null;

            if (!message) {
                // No -m flag: open editor pre-filled with old commit message
                await openCommitMessageEditor(dir, true, lastCommit.commit.message);
                return;
            }

            // Use new message
            const amendMessage = message;

            // Create new commit with parent of the amended commit
            const author = await getAuthor(dir);
            const newCommitOid = await git.commit({
                fs,
                dir,
                message: amendMessage,
                author,
                parent: parentOid ? [parentOid] : []
            });

            const currentBranch = await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';
            printNormal(`[${currentBranch} ${newCommitOid.substring(0, 7)}] ${amendMessage.split('\n')[0]}`);
            printHint('Amended the previous commit. Use "git log" to see the updated history');
            return;
        }

        if (!message) {
            // No -m flag: Open editor for commit message
            await openCommitMessageEditor(dir);
            return;
        }

        const currentBranch = await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';

        const author = await getAuthor(dir);
        const sha = await git.commit({
            fs,
            dir,
            author,
            message
        });
        // Small delay to ensure FS allows subsequent reads (fix for multi-line paste)
        await new Promise(resolve => setTimeout(resolve, 100));

        printNormal(`[${currentBranch} ${sha.substring(0, 7)}] ${message}`);
        printHint('Commit created! Use "git log" to see your commit history');
    } catch (error) {
        printError(`git commit failed: ${error.message}`);
        if (error.message.includes('No changes')) {
            printHint('There are no staged changes. Use "git add <file>" first');
        }
    }
}

async function openCommitMessageEditor(dir, isAmend = false, existingMessage = '') {
    // Get the list of staged files
    const statusMatrix = await git.statusMatrix({ fs, dir });
    const stagedFiles = statusMatrix.filter(([filepath, head, workdir, stage]) => {
        return stage === 2;
    });

    if (!isAmend && stagedFiles.length === 0) {
        printError('No changes added to commit');
        printHint('Use "git add <file>..." to stage files for commit');
        return;
    }

    // Generate commit message template
    const branchName = await git.currentBranch({ fs, dir }).catch(() => 'main');
    let template = isAmend ? existingMessage.replace(/\n$/, '') : '';
    template += `
${isAmend ? '\n# Amending commit.' : ''}
# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# On branch ${branchName}
# Changes to be committed:
`;

    for (const [filepath] of stagedFiles) {
        template += `#\t${filepath}\n`;
    }

    template += `#
# You can write a multi-line commit message.
# First line is the commit summary (max 50 chars recommended).
# Leave a blank line, then write detailed description if needed.
`;

    // Create temporary commit message file
    const commitMsgPath = `${dir}/.git/COMMIT_EDITMSG`;
    await pfs.writeFile(commitMsgPath, template, 'utf8');

    // Open editor using existing editor infrastructure
    editorFile = commitMsgPath;
    editorOriginalContent = template;

    // Set commit message mode flags
    isCommitMessageMode = true;
    commitMessageDir = dir;
    commitMessageIsAmend = isAmend;

    // Use the existing openEditor function
    openEditor('COMMIT_EDITMSG', template);

    // Override save behavior for commit message
    // Store reference to original extraKeys
    const originalExtraKeys = codeMirrorInstance.getOption('extraKeys');

    codeMirrorInstance.setOption('extraKeys', {
        'Ctrl-S': function (cm) {
            console.log('Ctrl-S pressed in commit editor');
            saveCommitMessage(dir).then(() => {
                console.log('saveCommitMessage completed');
                // Restore original keys after commit
                codeMirrorInstance.setOption('extraKeys', originalExtraKeys);
            }).catch(err => {
                console.error('saveCommitMessage error:', err);
                // Restore original keys even on error
                codeMirrorInstance.setOption('extraKeys', originalExtraKeys);
            });
        },
        'Ctrl-X': function (cm) {
            console.log('Ctrl-X pressed in commit editor');
            cancelCommit();
            // Restore original keys after cancel
            codeMirrorInstance.setOption('extraKeys', originalExtraKeys);
        }
    });
}

async function saveCommitMessage(dir) {
    console.log('saveCommitMessage called with dir:', dir);
    const content = codeMirrorInstance.getValue();
    console.log('Content:', content);

    // Remove comment lines (lines starting with #)
    const lines = content.split('\n');
    const messageLines = lines.filter(line => !line.trim().startsWith('#'));
    const message = messageLines.join('\n').trim();
    console.log('Commit message after filtering:', message);

    if (!message) {
        closeEditor();
        printError('Aborting commit due to empty commit message.');
        return;
    }

    try {
        console.log('Attempting to commit...');
        const author = await getAuthor(dir);
        let sha;

        if (commitMessageIsAmend) {
            // Amend: get existing commit's parent to replace it
            const commits = await git.log({ fs, dir, depth: 1 });
            const lastCommit = commits[0];
            const parentOid = lastCommit.commit.parent[0] || null;
            sha = await git.commit({
                fs,
                dir,
                message,
                author,
                parent: parentOid ? [parentOid] : []
            });
        } else {
            sha = await git.commit({
                fs,
                dir,
                author,
                message
            });
        }

        console.log('Commit successful, SHA:', sha);

        // Get first line for summary
        const firstLine = message.split('\n')[0];
        const branchName = await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';

        // Clear commit message mode flags
        isCommitMessageMode = false;
        commitMessageDir = null;
        commitMessageIsAmend = false;

        // Close editor first, then print success messages
        closeEditor();

        // Use setTimeout to ensure terminal is ready to receive output
        setTimeout(() => {
            printNormal(`[${branchName} ${sha.substring(0, 7)}] ${firstLine}`);
            printHint('Commit created! Use "git log" to see your commit history');
            showPrompt();
        }, 100);

    } catch (error) {
        console.error('Commit failed:', error);

        // Clear commit message mode flags
        isCommitMessageMode = false;
        commitMessageDir = null;
        commitMessageIsAmend = false;

        closeEditor();
        setTimeout(() => {
            printError(`git commit failed: ${error.message}`);
            showPrompt();
        }, 100);
    }
}

function cancelCommit() {
    // Clear commit message mode flags
    isCommitMessageMode = false;
    commitMessageDir = null;
    commitMessageIsAmend = false;

    printError('Commit cancelled.');
    closeEditor();
}

async function gitLog(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Parse flags
        const showGraph = args.includes('--graph');
        const showOneline = args.includes('--oneline');
        const showAll = args.includes('--all');
        const showDecorate = args.includes('--decorate') || showOneline;

        // Parse -n / -<number> for max count
        let maxCount = null;
        let authorFilter = null;
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-n' && i + 1 < args.length) {
                maxCount = parseInt(args[i + 1], 10);
                i++;
            } else if (args[i].match(/^-(\d+)$/)) {
                maxCount = parseInt(args[i].slice(1), 10);
            } else if (args[i] === '--author' && i + 1 < args.length) {
                authorFilter = args[i + 1].toLowerCase();
                i++;
            } else if (args[i].startsWith('--author=')) {
                authorFilter = args[i].slice(9).replace(/^["']|["']$/g, '').toLowerCase();
            }
        }

        // Support --all flag for more commits
        const depth = showAll ? 100 : (maxCount ? Math.max(maxCount * 2, 40) : 20);

        let commits = [];
        try {
            commits = await git.log({
                fs,
                dir,
                depth: depth,
                ref: 'HEAD'
            });
        } catch (error) {
            let recovered = false;

            // If error suggests missing object (but not missing ref), try depth: 1
            if ((error.code === 'NotFoundError' || error.message.includes('Could not find') || error.message.includes('no such file')) &&
                !error.message.includes('refs/')) {
                try {
                    commits = await git.log({
                        fs,
                        dir,
                        depth: 1,
                        ref: 'HEAD'
                    });
                    printHint('Note: Showing only latest commit (history incomplete).');
                    recovered = true;
                } catch (e2) {
                    // Fallback failed, proceed to error handling
                }
            }

            if (!recovered) {
                // Check for "Could not find refs/heads/..." which means empty repo
                if (error.code === 'NotFoundError' || error.message.includes('Could not find') || error.message.includes('no such file')) {
                    printNormal(`No commits yet (Debug: ${error.message})`);
                    printHint('Create your first commit with "git add <file>" and "git commit -m <message>"');
                    return;
                }
                throw error;
            }
        }

        if (commits.length === 0) {
            printNormal('No commits yet');
            printHint('Create your first commit with "git add <file>" and "git commit -m <message>"');
            return;
        }

        // Apply --author filter
        if (authorFilter) {
            commits = commits.filter(c => {
                const name = (c.commit.author?.name || '').toLowerCase();
                const email = (c.commit.author?.email || '').toLowerCase();
                return name.includes(authorFilter) || email.includes(authorFilter);
            });
        }

        // Apply -n limit
        if (maxCount && maxCount > 0) {
            commits = commits.slice(0, maxCount);
        }

        if (commits.length === 0) {
            printNormal('No matching commits found.');
            return;
        }

        // Get current branch for decoration
        let currentBranch = '';
        try {
            currentBranch = await git.currentBranch({ fs, dir });
        } catch (e) {
            // Ignore if can't get branch
        }

        // Get all branches for decoration
        let branches = [];
        try {
            branches = await git.listBranches({ fs, dir });
        } catch (e) {
            // Ignore if can't get branches
        }

        // Get all branch tips for decoration (used by all formats)
        const branchTips = new Map();

        // Add local branches
        for (const branch of branches) {
            try {
                const oid = await git.resolveRef({ fs, dir, ref: branch });
                if (!branchTips.has(oid)) {
                    branchTips.set(oid, []);
                }
                branchTips.get(oid).push(branch);
            } catch (e) {
                // Ignore errors
            }
        }

        // Add remote branches
        try {
            const remoteBranches = await git.listBranches({ fs, dir, remote: 'origin' });
            for (const branch of remoteBranches) {
                try {
                    const oid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` });
                    if (!branchTips.has(oid)) {
                        branchTips.set(oid, []);
                    }
                    branchTips.get(oid).push(`origin/${branch}`);
                } catch (e) {
                    // Ignore errors
                }
            }

            // Add origin/HEAD if it exists
            try {
                const headOid = await git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/HEAD' });
                if (!branchTips.has(headOid)) {
                    branchTips.set(headOid, []);
                }
                branchTips.get(headOid).push('origin/HEAD');
            } catch (e) {
                // Ignore if origin/HEAD doesn't exist
            }
        } catch (e) {
            // No remote branches
        }

        printNormal('');

        if (showOneline) {
            // White commit symbols, consistent with full graph view
            const commitSymbolColor = '\x1b[37m';  // White for commit symbols (*)
            const reset = '\x1b[0m';

            // Compact one-line format
            commits.forEach((commit, index) => {
                const shortHash = commit.oid.substring(0, 7);
                const firstLine = commit.commit.message.split('\n')[0];

                // Build decoration (standard git colors)
                let decoration = '';
                const decorParts = [];

                if (showDecorate && index === 0 && currentBranch) {
                    decorParts.push(`\x1b[1;36mHEAD\x1b[0m\x1b[33m ->\x1b[0m \x1b[1;32m${currentBranch}\x1b[0m`);
                }

                // Add other branches pointing to this commit (remove duplicates)
                if (branchTips.has(commit.oid)) {
                    let branchNames = branchTips.get(commit.oid).filter(b => b !== currentBranch || !index);
                    // Remove duplicates
                    branchNames = [...new Set(branchNames)];

                    branchNames.forEach(b => {
                        // Remote branches (origin/...) in red, local branches in green
                        if (b.startsWith('origin/')) {
                            decorParts.push(`\x1b[1;31m${b}\x1b[0m`);  // Bold red for remote branches
                        } else {
                            decorParts.push(`\x1b[1;32m${b}\x1b[0m`);  // Bold green for local branches
                        }
                    });
                }

                if (decorParts.length > 0) {
                    decoration = ` \x1b[33m(\x1b[0m${decorParts.join('\x1b[33m,\x1b[0m ')}\x1b[33m)\x1b[0m`;
                }

                if (showGraph) {
                    // Check if this is a merge commit
                    const parents = commit.commit.parent || [];
                    const isMerge = parents.length > 1;

                    if (isMerge) {
                        // Merge commit - show with merge indicator
                        const graphColors = ['\x1b[31m', '\x1b[32m'];  // Red main, Green branch
                        const color = graphColors[0];
                        const secondColor = graphColors[1];

                        term.writeln(`${commitSymbolColor}*${reset}   \x1b[33m${shortHash}\x1b[0m${decoration} ${firstLine}`);
                        term.writeln(`${color}|\\${reset}`);
                    } else {
                        // Check if this is part of a merged branch
                        const prevCommit = index > 0 ? commits[index - 1] : null;
                        const isPrevMerge = prevCommit && prevCommit.commit.parent && prevCommit.commit.parent.length > 1;
                        const isSecondParent = isPrevMerge && prevCommit.commit.parent.length > 1 &&
                            prevCommit.commit.parent[1] === commit.oid;

                        if (isSecondParent) {
                            // This is a commit from the merged branch
                            const graphColors = ['\x1b[31m', '\x1b[32m'];
                            const color = graphColors[0];
                            const secondColor = graphColors[1];

                            // Check if there's another commit after this one
                            const nextCommit = index < commits.length - 1 ? commits[index + 1] : null;
                            const hasMoreAfter = nextCommit && nextCommit.commit.parent &&
                                nextCommit.commit.parent.includes(commit.commit.parent[0]);

                            if (hasMoreAfter) {
                                term.writeln(`${color}|${reset} ${commitSymbolColor}*${reset} \x1b[33m${shortHash}\x1b[0m${decoration} ${firstLine}`);
                            } else {
                                // Last commit before merge point
                                term.writeln(`${color}|${reset} ${commitSymbolColor}*${reset} \x1b[33m${shortHash}\x1b[0m${decoration} ${firstLine}`);
                                term.writeln(`${color}|/${reset}`);
                            }
                        } else {
                            // Regular commit on main branch
                            term.writeln(`${commitSymbolColor}*${reset} \x1b[33m${shortHash}\x1b[0m${decoration} ${firstLine}`);
                        }
                    }
                } else {
                    term.writeln(`\x1b[33m${shortHash}\x1b[0m${decoration} ${firstLine}`);
                }
            });
        } else if (showGraph) {
            // Graph format with ASCII art - now supports branches!
            // Git's standard rotating color palette for graph lines
            const graphColors = [
                '\x1b[31m',      // Red
                '\x1b[32m',      // Green
                '\x1b[33m',      // Yellow
                '\x1b[34m',      // Blue
                '\x1b[35m',      // Magenta
                '\x1b[36m',      // Cyan
                '\x1b[1;31m',    // Bold Red
                '\x1b[1;32m',    // Bold Green
                '\x1b[1;33m',    // Bold Yellow
                '\x1b[1;34m',    // Bold Blue
                '\x1b[1;35m',    // Bold Magenta
                '\x1b[1;36m',    // Bold Cyan
            ];
            const commitSymbolColor = '\x1b[37m';  // White for commit symbols (*)
            const reset = '\x1b[0m';

            // Build commit map for parent lookup
            const commitMap = new Map();
            commits.forEach(commit => {
                commitMap.set(commit.oid, commit);
            });

            commits.forEach((commit, index) => {
                const isFirst = index === 0;
                const isLast = index === commits.length - 1;
                const parents = commit.commit.parent || [];
                const isMerge = parents.length > 1;
                const nextCommit = index < commits.length - 1 ? commits[index + 1] : null;

                // Use consistent colors: Red for main branch, Green for merged branch
                // In complex histories, we would rotate, but for simple linear + merge, keep it consistent
                const color = graphColors[0];  // Red for main branch
                const secondColor = graphColors[1];  // Green for merged branch

                // Build decoration (standard git colors)
                let decoration = '';
                const decorParts = [];

                if (isFirst && currentBranch) {
                    // HEAD is cyan, arrow is yellow, branch is green
                    decorParts.push(`\x1b[1;36mHEAD\x1b[0m\x1b[33m ->\x1b[0m \x1b[1;32m${currentBranch}\x1b[0m`);
                }

                // Add other branches pointing to this commit (remove duplicates and sort)
                if (branchTips.has(commit.oid)) {
                    let branchNames = branchTips.get(commit.oid).filter(b => b !== currentBranch || !isFirst);
                    // Remove duplicates
                    branchNames = [...new Set(branchNames)];

                    branchNames.forEach(b => {
                        // Remote branches (origin/...) in red, local branches in green
                        if (b.startsWith('origin/')) {
                            decorParts.push(`\x1b[1;31m${b}\x1b[0m`);  // Bold red for remote branches
                        } else {
                            decorParts.push(`\x1b[1;32m${b}\x1b[0m`);  // Bold green for local branches
                        }
                    });
                }

                if (decorParts.length > 0) {
                    decoration = ` \x1b[33m(\x1b[0m${decorParts.join('\x1b[33m,\x1b[0m ')}\x1b[33m)\x1b[0m`;
                }

                // Check if this is a merge commit
                if (isMerge) {
                    // Find if the second parent is in our commit list
                    const secondParentInList = parents.length > 1 && commitMap.has(parents[1]);
                    const secondParentIndex = secondParentInList ? commits.findIndex(c => c.oid === parents[1]) : -1;
                    const showBranchCommit = secondParentInList && secondParentIndex === index + 1;

                    // Merge commit header (white star)
                    term.writeln(`${commitSymbolColor}*${reset}   \x1b[33mcommit ${commit.oid}\x1b[0m${decoration}`);
                    // Merge line with graph branch split (|\ on same line as "Merge:")
                    term.writeln(`${color}|\\${reset}  Merge: ${parents.map(p => p.substring(0, 7)).join(' ')}`);
                    term.writeln(`${color}|${reset} ${secondColor}|${reset} Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);

                    const dateStr = formatGitDate(commit.commit.author.timestamp);
                    term.writeln(`${color}|${reset} ${secondColor}|${reset} Date:   ${dateStr}`);
                    term.writeln(`${color}|${reset} ${secondColor}|${reset}`);

                    // Handle multi-line commit messages
                    const messageLines = commit.commit.message.trim().split('\n');
                    messageLines.forEach((line, lineIndex) => {
                        term.writeln(`${color}|${reset} ${secondColor}|${reset}     ${line}`);
                    });
                    term.writeln(`${color}|${reset} ${secondColor}|${reset}`);

                    // If next commit is the second parent (merged branch commit)
                    if (showBranchCommit) {
                        // The next iteration will show this commit with proper prefix
                        // We just continue the branch lines
                    }
                } else {
                    // Check if this is part of a merged branch
                    const prevCommit = index > 0 ? commits[index - 1] : null;
                    const isPrevMerge = prevCommit && prevCommit.commit.parent && prevCommit.commit.parent.length > 1;
                    const isSecondParent = isPrevMerge && prevCommit.commit.parent.length > 1 &&
                        prevCommit.commit.parent[1] === commit.oid;

                    if (isSecondParent) {
                        // This is a commit from the merged branch
                        // Check if there's another commit after this one
                        const hasNextCommit = index < commits.length - 1;
                        const nextIsLast = index === commits.length - 2;

                        term.writeln(`${color}|${reset} ${commitSymbolColor}*${reset} \x1b[33mcommit ${commit.oid}\x1b[0m${decoration}`);
                        term.writeln(`${color}|/${reset}  Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);

                        const dateStr = formatGitDate(commit.commit.author.timestamp);

                        // After |/ we continue with red line if there's more commits
                        if (hasNextCommit) {
                            term.writeln(`${color}|${reset}   Date:   ${dateStr}`);
                            term.writeln(`${color}|${reset}`);

                            // Handle multi-line commit messages
                            const messageLines = commit.commit.message.trim().split('\n');
                            messageLines.forEach(line => {
                                term.writeln(`${color}|${reset}       ${line}`);
                            });
                            term.writeln(`${color}|${reset}`);
                        } else {
                            // Last commit - no more lines
                            term.writeln(`   Date:   ${dateStr}`);
                            term.writeln(``);

                            // Handle multi-line commit messages
                            const messageLines = commit.commit.message.trim().split('\n');
                            messageLines.forEach(line => {
                                term.writeln(`       ${line}`);
                            });
                            term.writeln(``);
                        }
                    } else {
                        // Regular commit (not part of merge) - main branch
                        const graphPrefix = `${commitSymbolColor}*${reset}`;
                        const linePrefix = isLast ? '  ' : `${color}|${reset}`;

                        term.writeln(`${graphPrefix}   \x1b[33mcommit ${commit.oid}\x1b[0m${decoration}`);
                        term.writeln(`${linePrefix}   Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);

                        const dateStr = formatGitDate(commit.commit.author.timestamp);
                        term.writeln(`${linePrefix}   Date:   ${dateStr}`);
                        term.writeln(`${linePrefix}`);

                        // Handle multi-line commit messages
                        const messageLines = commit.commit.message.trim().split('\n');
                        messageLines.forEach(line => {
                            term.writeln(`${linePrefix}       ${line}`);
                        });

                        term.writeln(isLast ? '' : linePrefix);
                    }
                }
            });
        } else {
            // Standard format
            commits.forEach((commit, index) => {
                // Build decoration (standard git colors)
                let decoration = '';
                const decorParts = [];

                if (showDecorate && index === 0 && currentBranch) {
                    decorParts.push(`\x1b[1;36mHEAD\x1b[0m\x1b[33m ->\x1b[0m \x1b[1;32m${currentBranch}\x1b[0m`);
                }

                // Add other branches pointing to this commit (remove duplicates)
                if (branchTips.has(commit.oid)) {
                    let branchNames = branchTips.get(commit.oid).filter(b => b !== currentBranch || !index);
                    // Remove duplicates
                    branchNames = [...new Set(branchNames)];

                    branchNames.forEach(b => {
                        // Remote branches (origin/...) in red, local branches in green
                        if (b.startsWith('origin/')) {
                            decorParts.push(`\x1b[1;31m${b}\x1b[0m`);  // Bold red for remote branches
                        } else {
                            decorParts.push(`\x1b[1;32m${b}\x1b[0m`);  // Bold green for local branches
                        }
                    });
                }

                if (decorParts.length > 0) {
                    decoration = ` \x1b[33m(\x1b[0m${decorParts.join('\x1b[33m,\x1b[0m ')}\x1b[33m)\x1b[0m`;
                }

                term.writeln(`\x1b[33mcommit ${commit.oid}\x1b[0m${decoration}`);
                term.writeln(`Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);

                const dateStr = formatGitDate(commit.commit.author.timestamp);
                term.writeln(`Date:   ${dateStr}`);
                term.writeln(``);

                // Handle multi-line commit messages
                const messageLines = commit.commit.message.trim().split('\n');
                messageLines.forEach(line => {
                    term.writeln(`    ${line}`);
                });
                term.writeln(``);
            });
        }

        if (commits.length >= depth) {
            printHint(`Showing last ${depth} commits. Use "git log --all" to see more`);
        } else {
            printHint('Use "git log --graph --oneline" for a compact graph view');
        }
    } catch (error) {
        printError(`git log failed: ${error.message}`);
        console.error('Git log error:', error);
    }
}

async function gitBranch(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Check for flags
        const showRemote = args.includes('-r') || args.includes('--remotes');
        const showAll = args.includes('-a') || args.includes('--all');
        const deleteBranch = args.includes('-d') || args.includes('-D') || args.includes('--delete');
        const forceDelete = args.includes('-D');
        const renameBranch = args.includes('-m') || args.includes('-M');

        if (deleteBranch) {
            const branchName = args.find(a => !a.startsWith('-'));
            if (!branchName) {
                printError('fatal: branch name required');
                return;
            }
            const currentBranch = await git.currentBranch({ fs, dir });
            if (branchName === currentBranch) {
                printError(`error: Cannot delete branch '${branchName}' checked out at '${dir}'`);
                return;
            }
            try {
                await git.deleteBranch({ fs, dir, ref: branchName });
                printNormal(`Deleted branch ${branchName}.`);
            } catch (e) {
                if (forceDelete) {
                    try {
                        await pfs.unlink(`${dir}/.git/refs/heads/${branchName}`);
                        printNormal(`Deleted branch ${branchName} (force deleted).`);
                    } catch (e2) {
                        printError(`error: branch '${branchName}' not found.`);
                    }
                } else {
                    printError(`error: The branch '${branchName}' is not fully merged.`);
                    printHint('Use "git branch -D <branch>" to force deletion.');
                }
            }
            return;
        }

        if (renameBranch) {
            const nonFlags = args.filter(a => !a.startsWith('-'));
            if (nonFlags.length === 0) {
                printError('fatal: branch name required');
                return;
            }
            const currentBranch = await git.currentBranch({ fs, dir });
            let oldName, newName;
            if (nonFlags.length === 1) {
                oldName = currentBranch;
                newName = nonFlags[0];
            } else {
                oldName = nonFlags[0];
                newName = nonFlags[1];
            }
            try {
                await git.renameBranch({ fs, dir, ref: newName, oldref: oldName });
                printNormal(`Branch '${oldName}' renamed to '${newName}'.`);
            } catch (e) {
                // Fallback: create new, delete old
                try {
                    const oid = await git.resolveRef({ fs, dir, ref: oldName });
                    await git.branch({ fs, dir, ref: newName, object: oid });
                    await git.deleteBranch({ fs, dir, ref: oldName });
                    if (oldName === currentBranch) {
                        await git.checkout({ fs, dir, ref: newName });
                    }
                    printNormal(`Branch '${oldName}' renamed to '${newName}'.`);
                } catch (e2) {
                    printError(`error: ${e2.message}`);
                }
            }
            return;
        }

        if (args.length === 0 || showRemote || showAll) {
            // List branches
            const current = await git.currentBranch({ fs, dir });

            printNormal('');

            // Show local branches
            if (!showRemote) {
                const localBranches = await git.listBranches({ fs, dir });
                localBranches.forEach(branch => {
                    const marker = branch === current ? '* ' : '  ';
                    const color = branch === current ? '\x1b[32m' : '';
                    term.writeln(`${marker}${color}${branch}\x1b[0m`);
                });
            }

            // Show remote branches
            if (showRemote || showAll) {
                try {
                    const remoteBranches = await git.listBranches({ fs, dir, remote: 'origin' });
                    if (remoteBranches.length > 0) {
                        if (showAll) printNormal('');
                        remoteBranches.forEach(branch => {
                            term.writeln(`  \x1b[31mremotes/origin/${branch}\x1b[0m`);
                        });
                    } else if (showRemote) {
                        printHint('No remote branches found. Try "git fetch --all" first.');
                    }
                } catch (e) {
                    if (showRemote) {
                        printHint('No remote configured or remote branches not fetched yet.');
                    }
                }
            }

            if (!showRemote && !showAll) {
                printHint('Use "git branch -r" to see remote branches');
                printHint('Use "git branch -a" to see all branches');
                printHint('Create a new branch with "git branch <branchname>"');
            }
        } else {
            // Create branch (filter out flags)
            const branchName = args.find(arg => !arg.startsWith('-'));
            if (!branchName) {
                printError('Please specify a branch name');
                return;
            }

            await git.branch({ fs, dir, ref: branchName });
            printNormal(`Branch '${branchName}' created`);
            printHint(`Switch to the new branch with "git checkout ${branchName}"`);
        }
    } catch (error) {
        printError(`git branch failed: ${error.message}`);
    }
}

async function gitCheckout(args) {
    if (args.length === 0) {
        printError('Please specify a branch name or commit');
        printHint('Usage: git checkout <branchname>');
        printHint('       git checkout -b <new-branch>');
        printHint('       git checkout <commit-hash>');
        printHint('       git checkout -- <file>  (discard changes)');
        return;
    }

    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Check for -- (file checkout / discard changes)
        const dashDashIndex = args.indexOf('--');
        if (dashDashIndex !== -1) {
            // git checkout [tree-ish] -- <file>
            const files = args.slice(dashDashIndex + 1);
            if (files.length === 0) {
                printError('Please specify a file after --');
                printHint('Usage: git checkout -- <filename>');
                return;
            }

            let sourceRef = null;
            if (dashDashIndex > 0) {
                sourceRef = args[0];
            }

            for (const file of files) {
                const filepath = file.startsWith('/') ? file : `${dir}/${file}`;

                try {
                    let blob;
                    if (sourceRef) {
                        const sourceOid = await git.resolveRef({ fs, dir, ref: sourceRef });
                        const result = await git.readBlob({ fs, dir, oid: sourceOid, filepath: file });
                        blob = result.blob;
                    } else {
                        // Read from Index
                        const result = await git.readBlob({ fs, dir, filepath: file });
                        blob = result.blob;
                    }

                    // Write the content back to working tree
                    const content = new TextDecoder().decode(blob);
                    await pfs.writeFile(filepath, content, 'utf8');
                    printNormal(`Updated 1 path from ${sourceRef || 'the index'}`);
                } catch (e) {
                    // File might not exist in source
                    printError(`error: pathspec '${file}' did not match any file(s) known to git`);
                }
            }
            printHint('Working tree changes have been discarded');
            return;
        }

        // Check for -b flag (create new branch)
        const createBranch = args.includes('-b');

        if (createBranch) {
            // git checkout -b <new-branch-name>
            const bIndex = args.indexOf('-b');
            if (args.length <= bIndex + 1) {
                printError('Please specify a branch name after -b');
                printHint('Usage: git checkout -b <new-branch-name>');
                return;
            }

            const newBranchName = args[bIndex + 1];

            // Check if branch already exists
            const branches = await git.listBranches({ fs, dir });
            if (branches.includes(newBranchName)) {
                printError(`A branch named '${newBranchName}' already exists.`);
                printHint('Use "git checkout ' + newBranchName + '" to switch to it');
                return;
            }

            // Create and checkout the new branch
            await git.branch({ fs, dir, ref: newBranchName, checkout: true });
            printNormal(`Switched to a new branch '${newBranchName}'`);
            printHint(`You created and switched to branch "${newBranchName}". Changes you commit will be on this branch.`);

        } else {
            // Regular checkout (branch or commit)
            const ref = args[0];

            // Check if it's a commit hash (7 or 40 character hex string)
            const isCommitHash = /^[0-9a-f]{7,40}$/i.test(ref);

            if (isCommitHash) {
                // Checkout specific commit (detached HEAD state)
                try {
                    // Try to resolve the commit
                    const fullOid = await git.expandOid({ fs, dir, oid: ref });

                    await git.checkout({ fs, dir, ref: fullOid });
                    printNormal(`Note: switching to '${ref}'.`);
                    printNormal('');
                    printNormal('You are in \'detached HEAD\' state. You can look around, make experimental');
                    printNormal('changes and commit them, and you can discard any commits you make in this');
                    printNormal('state without impacting any branches by switching back to a branch.');
                    printNormal('');
                    printNormal(`HEAD is now at ${ref.substring(0, 7)}`);
                    printHint('To create a new branch from this commit: git checkout -b <new-branch-name>');
                } catch (e) {
                    printError(`fatal: reference is not a tree: ${ref}`);
                    printHint('Make sure the commit hash is valid. Use "git log" to see commit hashes');
                }
            } else {
                // Checkout branch
                await git.checkout({ fs, dir, ref });
                printNormal(`Switched to branch '${ref}'`);
                printHint(`You are now on the "${ref}" branch. Changes you commit will be on this branch.`);
            }
        }

    } catch (error) {
        printError(`git checkout failed: ${error.message}`);

        if (error.message?.includes('not found') || error.message?.includes('does not exist') || error.code === 'NotFoundError') {
            printHint('Make sure the branch exists. Use "git branch" to see all branches');

            // Smart hint for main/master confusion
            if (args.length > 0 && (args[0] === 'main' || args[0] === 'master')) {
                try {
                    const branches = await git.listBranches({ fs, dir: await git.findRoot({ fs, filepath: currentDir }) });
                    const target = args[0];
                    const alternative = target === 'main' ? 'master' : 'main';
                    if (branches.includes(alternative) && !branches.includes(target)) {
                        printHint(`Did you mean to checkout '${alternative}'?`);
                    }
                } catch (e) { }
            }

            printHint('To create a new branch: git checkout -b <new-branch-name>');
        }
    }
}

async function gitDiff(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Parse arguments for diff mode
        const isStaged = args.includes('--staged') || args.includes('--cached');
        const showStat = args.includes('--stat');
        const flags = args.filter(a => a.startsWith('-'));
        const nonFlags = args.filter(a => !a.startsWith('-'));

        // Identify file arguments (paths existing on disk or looking like paths)
        // This is a naive heuristic: if it looks like a commit OID or ref, it's a ref.
        // Otherwise it's a file.
        // In a real git, we'd check if the ref exists.

        // Helper to check if string is likely a ref (branch, tag, HEAD, or SHA)
        async function isRef(str) {
            if (str === 'HEAD' || str.startsWith('HEAD~') || str.startsWith('HEAD^')) return true;
            try {
                await git.resolveRef({ fs, dir, ref: str });
                return true;
            } catch (e) {
                // Try as OID
                if (/^[0-9a-f]{4,40}$/i.test(str)) return true;
                return false;
            }
        }

        const refs = [];
        const files = [];

        for (const arg of nonFlags) {
            if (await isRef(arg)) {
                refs.push(arg);
            } else {
                files.push(arg);
            }
        }

        const specificFile = files.length > 0 ? files[0] : null;

        // Case 1: git diff <commit1> <commit2> [file]
        if (refs.length >= 2) {
            const ref1 = refs[0];
            const ref2 = refs[1];

            // Resolve refs to OIDs
            const oid1 = await resolveRefOrHead(ref1, dir);
            const oid2 = await resolveRefOrHead(ref2, dir);

            await printDiffCommits(dir, oid1, oid2, specificFile);
            return;
        }

        // Case 2: git diff <commit> [file]
        if (refs.length === 1) {
            const ref1 = refs[0];
            const oid1 = await resolveRefOrHead(ref1, dir);

            // Compare commit vs working directory
            await printDiffCommitWorkdir(dir, oid1, specificFile);
            return;
        }

        // Case 3: git diff --staged [file]
        if (isStaged) {
            if (showStat) {
                await printDiffStatStaged(dir, specificFile);
            } else {
                await printDiffStaged(dir, specificFile);
            }
            return;
        }

        // Case 4: git diff [file] (Working Dir vs Index)
        if (showStat) {
            await printDiffStatWorkdir(dir, specificFile);
        } else {
            await printDiffWorkdirIndex(dir, specificFile);
        }

    } catch (error) {
        printError(`git diff failed: ${error.message}`);
    }
}

// Helper to resolve HEAD~n syntax
async function resolveRefOrHead(ref, dir) {
    const headMatch = ref.match(/^HEAD~(\d+)$/);
    if (headMatch) {
        const n = parseInt(headMatch[1], 10);
        const commits = await git.log({ fs, dir, depth: n + 1 });
        if (commits.length <= n) {
            throw new Error(`${ref} does not exist`);
        }
        return commits[n].oid;
    }
    return await git.expandOid({ fs, dir, oid: await git.resolveRef({ fs, dir, ref }) });
}

async function printDiffCommits(dir, oid1, oid2, specificFile) {
    const tree1 = await git.readTree({ fs, dir, oid: (await git.readCommit({ fs, dir, oid: oid1 })).commit.tree });
    const tree2 = await git.readTree({ fs, dir, oid: (await git.readCommit({ fs, dir, oid: oid2 })).commit.tree });

    // Simplistic diff by iterating trees (doesn't handle deep recursion well in this snippet)
    // For a robust implementation we define a comparison helper
    await compareTrees(dir, tree1, tree2, specificFile);
}

async function printDiffCommitWorkdir(dir, oid, specificFile) {
    const tree = await git.readTree({ fs, dir, oid: (await git.readCommit({ fs, dir, oid })).commit.tree });

    // Compare tree vs workdir (simplified)
    const commitFiles = {};
    for (const entry of tree.tree) {
        if (entry.type === 'blob') commitFiles[entry.path] = entry.oid;
    }

    // Walk workdir
    // This is expensive, simplified to just checking tracked files + specificFile
    // Use git.statusMatrix to get all files
    const status = await git.statusMatrix({ fs, dir });

    for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
        if (filepath.startsWith('.git/')) continue;
        if (specificFile && filepath !== specificFile) continue;

        // Ignore untracked files (not in stage)
        if (stageStatus === 0) continue;

        let oldContent = '';
        let newContent = '';
        let showDiff = false;

        // Check if file exists in commit
        if (commitFiles[filepath]) {
            // Get commit content
            try {
                const { blob } = await git.readBlob({ fs, dir, oid: commitFiles[filepath], filepath });
                oldContent = new TextDecoder().decode(blob);
            } catch (e) { }
        }

        // Get workdir content
        // If workdirStatus is 0, file is deleted in workdir
        if (workdirStatus !== 0) {
            try {
                newContent = await pfs.readFile(`${dir}/${filepath}`, 'utf8');
            } catch (e) { }
        }

        if (oldContent !== newContent) {
            await printColorizedDiff(oldContent, newContent, filepath);
        }
    }
}

async function printDiffStaged(dir, specificFile) {
    const status = await git.statusMatrix({ fs, dir });
    let hasChanges = false;

    for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
        if (filepath.startsWith('.git/')) continue;
        if (specificFile && filepath !== specificFile) continue;

        // Check for staged changes (added/modified) OR staged deletion (HEAD=1, Stage=0)
        if (stageStatus === 2 || stageStatus === 3 || (HEADStatus === 1 && stageStatus === 0)) {
            hasChanges = true;
            let oldContent = '';
            let newContent = '';

            // HEAD content
            if (HEADStatus === 1) {
                try {
                    const commitOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
                    const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
                    oldContent = new TextDecoder().decode(blob);
                } catch (e) { }
            }

            // Staged content (read from workdir? No, index. But we simulate index reading by trusting status)
            // Ideally we'd read from index. simulated by reading file (as git add writes to object db but we don't have easy index read)
            // Wait, isomorphic-git statusMatrix tells use about index. 
            // In this app, we treat workdir as index for "added" files? No.
            // When we git add, it writes to object DB.
            // We can read from index using git.readBlob with filepath (it defaults to index if no oid?)
            // Actually git.readBlob requires oid.

            // For this environment, "Staged" usually implies we've run git add.
            // Since we can't easily read the index object directly without internal APIs,
            // we will approximate by reading the file from workdir IF it matches status.

            // Improved:
            // Since `git add` writes the blob to the object database, we can compute the OID of the workdir file
            // and try to read it? No.

            // Let's assume (for this learning tool) that staged content == workdir content
            // unless we have specific "staged but modified in workdir" state.
            // But if stageStatus == 2 or 3, it means index matches workdir or index has modification.

            try {
                newContent = await pfs.readFile(`${dir}/${filepath}`, 'utf8');
            } catch (e) { }

            await printColorizedDiff(oldContent, newContent, filepath);
        }
    }
    if (!hasChanges) printNormal('No staged changes.');
}

async function printDiffWorkdirIndex(dir, specificFile) {
    const status = await git.statusMatrix({ fs, dir });
    let hasChanges = false;

    for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
        if (filepath.startsWith('.git/')) continue;
        if (specificFile && filepath !== specificFile) continue;

        // Ignore untracked files (stageStatus 0)
        if (stageStatus === 0) continue;

        // workdirStatus: 2 = modified (different from index), 0 = deleted
        // We show diff if workdirStatus is 0 (deleted) OR 
        // workdirStatus is 2 (modified) AND stageStatus is not 2 (identical to workdir)
        // Wait, stageStatus 2 means "added to index, identical to workdir"? 
        // If stageStatus is 2, workdir matches index. so no diff.

        if (workdirStatus === 0 || (workdirStatus === 2 && stageStatus !== 2)) {
            hasChanges = true;
            let oldContent = ''; // Index content
            let newContent = ''; // Workdir content

            // Index content (Simulation: usage HEAD content if not staged, or previous add?)
            // Since we can't easily access the intermediate index blob, using HEAD is a safe fallback
            // for "files modified but not staged" IF they weren't previously staged.

            if (HEADStatus === 1) {
                try {
                    const commitOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
                    const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
                    oldContent = new TextDecoder().decode(blob);
                } catch (e) { }
            }

            try {
                newContent = await pfs.readFile(`${dir}/${filepath}`, 'utf8');
            } catch (e) { }

            await printColorizedDiff(oldContent, newContent, filepath);
        }
    }
    if (!hasChanges) printNormal('No changes.');
}

async function printDiffStatWorkdir(dir, specificFile) {
    const status = await git.statusMatrix({ fs, dir });
    const stats = [];

    for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
        if (filepath.startsWith('.git/')) continue;
        if (specificFile && filepath !== specificFile) continue;
        if (stageStatus === 0) continue;

        if (workdirStatus === 0 || (workdirStatus === 2 && stageStatus !== 2)) {
            let oldContent = '';
            let newContent = '';

            if (HEADStatus === 1) {
                try {
                    const commitOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
                    const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
                    oldContent = new TextDecoder().decode(blob);
                } catch (e) { }
            }
            try { newContent = await pfs.readFile(`${dir}/${filepath}`, 'utf8'); } catch (e) { }

            const diff = Diff.structuredPatch('', '', oldContent, newContent, '', '');
            let added = 0, removed = 0;
            diff.hunks.forEach(h => h.lines.forEach(l => { if (l[0] === '+') added++; if (l[0] === '-') removed++; }));
            stats.push({ filepath, added, removed });
        }
    }
    printStatSummary(stats);
}

async function printDiffStatStaged(dir, specificFile) {
    const status = await git.statusMatrix({ fs, dir });
    const stats = [];

    for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
        if (filepath.startsWith('.git/')) continue;
        if (specificFile && filepath !== specificFile) continue;
        if (stageStatus === 2 || stageStatus === 3 || (HEADStatus === 1 && stageStatus === 0)) {
            let oldContent = '';
            let newContent = '';

            if (HEADStatus === 1) {
                try {
                    const commitOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
                    const { blob } = await git.readBlob({ fs, dir, oid: commitOid, filepath });
                    oldContent = new TextDecoder().decode(blob);
                } catch (e) { }
            }
            if (stageStatus !== 0) {
                try { newContent = await pfs.readFile(`${dir}/${filepath}`, 'utf8'); } catch (e) { }
            }

            const diff = Diff.structuredPatch('', '', oldContent, newContent, '', '');
            let added = 0, removed = 0;
            diff.hunks.forEach(h => h.lines.forEach(l => { if (l[0] === '+') added++; if (l[0] === '-') removed++; }));
            stats.push({ filepath, added, removed });
        }
    }
    printStatSummary(stats);
}

function printStatSummary(stats) {
    if (stats.length === 0) {
        printNormal('No changes.');
        return;
    }

    const maxNameLen = Math.max(...stats.map(s => s.filepath.length));
    const maxChanges = Math.max(...stats.map(s => s.added + s.removed));
    const barWidth = Math.min(40, maxChanges);
    let totalAdded = 0, totalRemoved = 0;

    term.writeln('');
    for (const s of stats) {
        totalAdded += s.added;
        totalRemoved += s.removed;
        const total = s.added + s.removed;
        const scale = maxChanges > barWidth ? barWidth / maxChanges : 1;
        const plusCount = Math.round(s.added * scale) || (s.added > 0 ? 1 : 0);
        const minusCount = Math.round(s.removed * scale) || (s.removed > 0 ? 1 : 0);
        const bar = `\x1b[32m${'+'.repeat(plusCount)}\x1b[31m${'-'.repeat(minusCount)}\x1b[0m`;
        term.writeln(` ${s.filepath.padEnd(maxNameLen)} | ${String(total).padStart(4)} ${bar}`);
    }
    term.writeln(` ${stats.length} file${stats.length !== 1 ? 's' : ''} changed, ${totalAdded} insertion${totalAdded !== 1 ? 's' : ''}(+), ${totalRemoved} deletion${totalRemoved !== 1 ? 's' : ''}(-)`);
}

async function compareTrees(dir, tree1, tree2, specificFile) {
    // Recursively flatten both trees to get all files (including subdirectories)
    const tree1Oid = tree1.oid;
    const tree2Oid = tree2.oid;

    const files1 = tree1Oid ? await flattenTree(dir, tree1Oid) : {};
    const files2 = tree2Oid ? await flattenTree(dir, tree2Oid) : {};

    const allFiles = new Set([...Object.keys(files1), ...Object.keys(files2)]);

    for (const filepath of [...allFiles].sort()) {
        if (specificFile && filepath !== specificFile) continue;

        const oid1 = files1[filepath];
        const oid2 = files2[filepath];

        if (oid1 !== oid2) {
            let oldContent = '';
            let newContent = '';

            if (oid1) {
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: oid1 });
                    oldContent = new TextDecoder().decode(blob);
                } catch (e) { }
            }
            if (oid2) {
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: oid2 });
                    newContent = new TextDecoder().decode(blob);
                } catch (e) { }
            }
            await printColorizedDiff(oldContent, newContent, filepath);
        }
    }
}

// Helper function to generate a simple hash for display
async function getShortOid(content) {
    // Simple hash for display purposes (not cryptographic)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(7, '0').substring(0, 7);
}

// Helper function to get syntax highlighting mode based on file extension
function getSyntaxMode(filepath) {
    const ext = filepath.split('.').pop().toLowerCase();
    const modeMap = {
        'js': 'javascript',
        'jsx': 'javascript',
        'ts': 'javascript',
        'tsx': 'javascript',
        'html': 'htmlmixed',
        'htm': 'htmlmixed',
        'css': 'css',
        'scss': 'css',
        'sass': 'css',
        'json': 'javascript',
        'xml': 'xml',
        'svg': 'xml',
        'md': 'markdown',
        'markdown': 'markdown',
        'py': 'python',
        'sh': 'shell',
        'bash': 'shell',
        'txt': null,
        'gitignore': null
    };
    return modeMap[ext] || null;
}

// Sophisticated diff printing with syntax highlighting using diff.js library
async function printColorizedDiff(oldText, newText, filepath) {
    // Use the diff library (Diff.js by kpdecker)
    if (!window.Diff) {
        // Fallback if library not loaded
        console.error('Diff library not loaded');
        term.writeln('\x1b[31m(Diff library not available)\x1b[0m');
        return;
    }

    // Create unified diff using the sophisticated library
    const patch = Diff.createPatch(filepath, oldText, newText, '', '', { context: 3 });
    const lines = patch.split('\n');

    // Skip the patch header lines (first 4 lines: ---, +++, index, @@)
    let inHunk = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip empty lines at the end
        if (!line && i === lines.length - 1) continue;

        // Check if this is a hunk header
        if (line.startsWith('@@')) {
            inHunk = true;
            term.writeln(`\x1b[36m${line}\x1b[0m`);
            continue;
        }

        // Skip the diff header lines (we already printed them)
        if (!inHunk && (line.startsWith('---') || line.startsWith('+++') ||
            line.startsWith('Index:') || line.startsWith('==='))) {
            continue;
        }

        if (!inHunk) continue;

        // Color the diff lines with syntax highlighting
        if (line.startsWith('+')) {
            // Added line - apply syntax highlighting if possible
            const content = line.substring(1);
            const highlighted = applySyntaxHighlight(content, filepath);
            term.writeln(`\x1b[32m+${highlighted}\x1b[0m`);
        } else if (line.startsWith('-')) {
            // Removed line - apply syntax highlighting if possible
            const content = line.substring(1);
            const highlighted = applySyntaxHighlight(content, filepath);
            term.writeln(`\x1b[31m-${highlighted}\x1b[0m`);
        } else if (line.startsWith(' ')) {
            // Context line - apply syntax highlighting
            const content = line.substring(1);
            const highlighted = applySyntaxHighlight(content, filepath);
            term.writeln(` ${highlighted}`);
        } else {
            // Other lines (shouldn't happen in unified diff)
            term.writeln(line);
        }
    }
}

// Apply basic syntax highlighting to a line of code
function applySyntaxHighlight(line, filepath) {
    const mode = getSyntaxMode(filepath);

    // If no syntax mode or plain text, return as-is
    if (!mode) {
        return escapeAnsi(line);
    }

    // Use CodeMirror's simple tokenizer for basic syntax highlighting
    try {
        // For HTML/XML/CSS/JS, apply basic highlighting
        let highlighted = escapeAnsi(line);

        if (mode === 'javascript' || mode === 'json') {
            // Highlight strings, keywords, comments
            highlighted = highlighted
                .replace(/\/\/.*/g, match => `\x1b[90m${match}\x1b[0m`) // comments
                .replace(/(['"`])(.*?)\1/g, (match, quote, content) => `\x1b[33m${quote}${content}${quote}\x1b[0m`) // strings
                .replace(/\b(const|let|var|function|class|if|else|for|while|return|import|export|from|async|await)\b/g,
                    match => `\x1b[35m${match}\x1b[0m`); // keywords
        } else if (mode === 'htmlmixed' || mode === 'xml') {
            // Highlight tags and attributes
            highlighted = highlighted
                .replace(/(&lt;\/?)(\w+)/g, (match, bracket, tag) => `${bracket}\x1b[34m${tag}\x1b[0m`) // tags
                .replace(/(\w+)=/g, (match, attr) => `\x1b[36m${attr}\x1b[0m=`) // attributes
                .replace(/(['"])(.*?)\1/g, (match, quote, content) => `\x1b[33m${quote}${content}${quote}\x1b[0m`); // attribute values
        } else if (mode === 'css') {
            // Highlight selectors, properties, values
            highlighted = highlighted
                .replace(/([.#]?[\w-]+)(?=\s*[{:])/g, match => `\x1b[36m${match}\x1b[0m`) // selectors
                .replace(/([\w-]+):/g, (match, prop) => `\x1b[35m${prop}\x1b[0m:`) // properties
                .replace(/:\s*([^;]+);/g, (match, value) => `: \x1b[33m${value}\x1b[0m;`); // values
        } else if (mode === 'python') {
            // Highlight Python keywords, strings, comments
            highlighted = highlighted
                .replace(/#.*/g, match => `\x1b[90m${match}\x1b[0m`) // comments
                .replace(/(['"])(.*?)\1/g, (match, quote, content) => `\x1b[33m${quote}${content}${quote}\x1b[0m`) // strings
                .replace(/\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|with|lambda|yield)\b/g,
                    match => `\x1b[35m${match}\x1b[0m`); // keywords
        }

        return highlighted;
    } catch (e) {
        return escapeAnsi(line);
    }
}

// Escape any existing ANSI codes in the line
function escapeAnsi(text) {
    return text; // For now, just return as-is since we control the content
}

async function gitReset(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Parse mode: --soft, --mixed (default), --hard
        const hasSoft = args.includes('--soft');
        const hasHard = args.includes('--hard');
        const mode = hasSoft ? 'soft' : (hasHard ? 'hard' : 'mixed');

        // Filter out mode flags
        const filteredArgs = args.filter(a => !['--soft', '--hard', '--mixed'].includes(a));

        if (filteredArgs.length === 0) {
            // No ref or file specified - show usage
            printError('usage: git reset [--soft | --mixed | --hard] [<commit>]');
            printHint('       git reset [<file>...]');
            printHint('');
            printHint('Modes:');
            printHint('  --soft  : Only move HEAD, keep staging and working tree');
            printHint('  --mixed : Move HEAD and unstage (default)');
            printHint('  --hard  : Move HEAD, unstage, AND reset working tree');
            return;
        }

        const ref = filteredArgs[0];

        // Handle "git reset HEAD <file>" - unstage specific files
        if (ref === 'HEAD' && filteredArgs.length > 1) {
            for (let i = 1; i < filteredArgs.length; i++) {
                try {
                    await git.resetIndex({ fs, dir, filepath: filteredArgs[i] });
                    printNormal(`Unstaged changes for ${filteredArgs[i]}`);
                } catch (e) {
                    printError(`error: pathspec '${filteredArgs[i]}' did not match any file(s) known to git`);
                }
            }
            printHint('Files have been unstaged. Use "git status" to see the current state.');
            return;
        }

        // Check if ref looks like HEAD~n or a commit hash
        const headMatch = ref.match(/^HEAD~(\d+)$/);
        const isCommitRef = headMatch || /^[0-9a-f]{7,40}$/i.test(ref) || ref === 'HEAD';

        if (isCommitRef) {
            // Reset to a specific commit
            let targetOid;

            if (headMatch) {
                // Handle HEAD~n
                const n = parseInt(headMatch[1], 10);
                const commits = await git.log({ fs, dir, depth: n + 1 });
                if (commits.length <= n) {
                    printError(`fatal: HEAD~${n} does not exist (only ${commits.length} commits in history)`);
                    return;
                }
                targetOid = commits[n].oid;
            } else if (ref === 'HEAD') {
                targetOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
            } else {
                // Commit hash
                targetOid = await git.expandOid({ fs, dir, oid: ref });
            }

            const currentBranch = await git.currentBranch({ fs, dir });

            if (mode === 'soft') {
                // Soft reset: only move HEAD/branch pointer
                if (currentBranch) {
                    await pfs.writeFile(`${dir}/.git/refs/heads/${currentBranch}`, targetOid + '\n', 'utf8');
                }
                printNormal(`HEAD is now at ${targetOid.substring(0, 7)}`);
                printHint('Soft reset: Your staged changes are preserved');
            } else if (mode === 'hard') {
                // Hard reset: move HEAD + reset index + reset working tree
                await git.checkout({
                    fs,
                    dir,
                    ref: targetOid,
                    force: true
                });
                // Update branch pointer
                if (currentBranch) {
                    await pfs.writeFile(`${dir}/.git/refs/heads/${currentBranch}`, targetOid + '\n', 'utf8');
                    await git.checkout({ fs, dir, ref: currentBranch });
                }
                printNormal(`HEAD is now at ${targetOid.substring(0, 7)}`);
                printHint('Hard reset: Working tree and index have been reset');
                printError('⚠️  Any uncommitted changes have been lost!');
            } else {
                // Mixed reset (default): move HEAD + reset index, keep working tree
                if (currentBranch) {
                    await pfs.writeFile(`${dir}/.git/refs/heads/${currentBranch}`, targetOid + '\n', 'utf8');
                }
                // Reset index to match the commit
                const { tree } = await git.readCommit({ fs, dir, oid: targetOid });
                // Note: isomorphic-git doesn't have a direct "reset index" - we simulate by checkout + preserve working tree
                printNormal(`Unstaged changes after reset:`);
                printNormal(`HEAD is now at ${targetOid.substring(0, 7)}`);
                printHint('Mixed reset: Working tree preserved, but changes are now unstaged');
            }
        } else {
            // File reset (unstage specific file)
            await git.resetIndex({ fs, dir, filepath: ref });
            printNormal(`Unstaged changes for ${ref}`);
            printHint('The file is now unstaged. Use "git add" to stage it again');
        }
    } catch (error) {
        printError(`git reset failed: ${error.message}`);
    }
}

async function gitRemote(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args.length === 0 || args[0] === '-v') {
            // List remotes
            const remotes = await git.listRemotes({ fs, dir });

            if (remotes.length === 0) {
                printNormal('No remotes configured');
                printHint('Add a remote with: git remote add origin <url>');
                printHint('For learning, you can use fake URLs like "https://github.com/student/project1.git"');
            } else {
                printNormal('');
                remotes.forEach(remote => {
                    printNormal(`${remote.remote}\t${remote.url} (fetch)`);
                    printNormal(`${remote.remote}\t${remote.url} (push)`);
                });
            }
            return;
        }

        const subcommand = args[0];

        if (subcommand === 'add') {
            if (args.length < 3) {
                printError('Usage: git remote add <name> <url>');
                return;
            }
            const remoteName = args[1];
            const remoteUrl = args[2];
            await git.addRemote({ fs, dir, remote: remoteName, url: remoteUrl });
            printNormal(`Remote '${remoteName}' added: ${remoteUrl}`);
        }
        else if (subcommand === 'remove' || subcommand === 'rm') {
            if (args.length < 2) {
                printError('Usage: git remote remove <name>');
                return;
            }
            const remoteName = args[1];
            await git.deleteRemote({ fs, dir, remote: remoteName });
            printNormal(`Remote '${remoteName}' removed`);
        }
        else if (subcommand === 'rename') {
            if (args.length < 3) {
                printError('Usage: git remote rename <old> <new>');
                return;
            }
            // isomorphic-git doesn't have renameRemote, so we read, delete, add
            const oldName = args[1];
            const newName = args[2];

            const remotes = await git.listRemotes({ fs, dir });
            const remote = remotes.find(r => r.remote === oldName);

            if (!remote) {
                printError(`fatal: No such remote: '${oldName}'`);
                return;
            }

            await git.addRemote({ fs, dir, remote: newName, url: remote.url });
            await git.deleteRemote({ fs, dir, remote: oldName });
            printNormal(`Renamed remote '${oldName}' to '${newName}'`);
        }
        else if (subcommand === 'set-url') {
            if (args.length < 3) {
                printError('Usage: git remote set-url <name> <newurl>');
                return;
            }
            const remoteName = args[1];
            const newUrl = args[2];

            // isomorphic-git doesn't have setRemoteUrl, so we delete and add
            // checking if it exists first
            const remotes = await git.listRemotes({ fs, dir });
            if (!remotes.find(r => r.remote === remoteName)) {
                printError(`fatal: No such remote: '${remoteName}'`);
                return;
            }

            await git.deleteRemote({ fs, dir, remote: remoteName });
            await git.addRemote({ fs, dir, remote: remoteName, url: newUrl });
            printNormal(`Remote '${remoteName}' url set to: ${newUrl}`);
        }
        else {
            printError(`Unknown subcommand: ${subcommand}`);
            printHint('Usage: git remote [add|remove|rename|set-url]');
        }

    } catch (error) {
        printError(`git remote failed: ${error.message}`);
    }
}

async function gitPush(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        const remotes = await git.listRemotes({ fs, dir });

        if (remotes.length === 0) {
            printError('No remote configured');
            printHint('Add a remote first with: git remote add origin <url>');
            return;
        }

        // Get HTTP module
        const httpModule = window.GitHttp || window.git?.http;
        if (!httpModule) {
            printError('HTTP module not loaded. Cannot push to remote repositories.');
            printHint('Push functionality requires the isomorphic-git HTTP module');
            return;
        }

        // Parse arguments
        const remote = args.find(arg => !arg.startsWith('-')) || 'origin';
        const force = args.includes('-f') || args.includes('--force');

        // Get current branch
        const currentBranch = await git.currentBranch({ fs, dir }) || 'main';
        const ref = args.find(arg => arg.includes(':')) || `refs/heads/${currentBranch}:refs/heads/${currentBranch}`;

        printNormal(`Pushing to ${remotes[0].url}...`);

        try {
            // Attempt to push (this will fail without authentication for private repos)
            const result = await git.push({
                fs,
                http: httpModule,
                dir,
                remote,
                ref,
                force,
                corsProxy: GIT_PROXY,
                onAuth: () => {
                    // For learning purposes, we'll use a callback that explains auth
                    printNormal('');
                    printError('Authentication required!');
                    printHint('Pushing to GitHub requires authentication. For this learning environment:');
                    printHint('1. You can push to public repos you own (if you fork them)');
                    printHint('2. For private repos, you would need a GitHub Personal Access Token');
                    printHint('3. In real development, use SSH keys or credential managers');
                    return { cancel: true };
                },
                onAuthFailure: () => {
                    printError('Authentication failed or cancelled');
                    return { cancel: true };
                },
                onMessage: (message) => {
                    if (message) {
                        printNormal(message);
                    }
                }
            });

            printNormal('');
            printNormal(`To ${remotes[0].url}`);
            printNormal(`   ${result.ok ? '✓' : '✗'} ${currentBranch} -> ${currentBranch}`);
            printHint('Push successful! Your commits are now on the remote server');

        } catch (error) {
            // Handle specific error cases
            if (error.message?.includes('401') || error.message?.includes('403')) {
                printError('Authentication failed or access denied');
                printHint('For public repos: Make sure the repository exists and you have push access');
                printHint('For private repos: You need a GitHub Personal Access Token');
                printHint('This learning environment works best with local operations');
            } else if (error.message?.includes('404')) {
                printError('Repository not found');
                printHint('Make sure the remote URL is correct and the repository exists');
            } else if (error.message?.includes('non-fast-forward')) {
                printError('Updates were rejected (non-fast-forward)');
                printHint('The remote has commits you don\'t have locally');
                printHint('Pull first with "git pull", or force push with "git push -f" (dangerous!)');
            } else {
                throw error;
            }
        }
    } catch (error) {
        printError(`git push failed: ${error.message}`);
        printHint('This is usually an authentication issue. Push works fully in browsers with proper credentials!');
    }
}

async function gitPull(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        const remotes = await git.listRemotes({ fs, dir });

        if (remotes.length === 0) {
            printError('No remote configured');
            printHint('Add a remote first with: git remote add origin <url>');
            return;
        }

        // Get HTTP module
        const httpModule = window.GitHttp || window.git?.http;
        if (!httpModule) {
            printError('HTTP module not loaded. Cannot pull from remote repositories.');
            printHint('Pull functionality requires the isomorphic-git HTTP module');
            return;
        }

        // Parse arguments
        const remote = args.find(arg => !arg.startsWith('-')) || 'origin';
        const currentBranch = await git.currentBranch({ fs, dir }) || 'main';

        printNormal(`Fetching from ${remotes[0].url}...`);

        try {
            // First, fetch from remote
            await git.fetch({
                fs,
                http: httpModule,
                dir,
                remote,
                ref: currentBranch,
                corsProxy: GIT_PROXY,
                singleBranch: true,
                tags: false,
                onProgress: (event) => {
                    const percent = Math.round((event.loaded / (event.total || event.loaded)) * 100);
                    if (percent === 100 || percent % 25 === 0) {
                        term.write(`\r${event.phase}: ${percent}%...`);
                        if (percent === 100) {
                            term.write('\r\n');
                        }
                    }
                },
                onMessage: (message) => {
                    if (message) {
                        printNormal(message);
                    }
                }
            });

            printNormal('From ' + remotes[0].url);
            printNormal(` * branch            ${currentBranch}       -> FETCH_HEAD`);

            // Get the remote branch OID
            let remoteBranchOid;
            try {
                remoteBranchOid = await git.resolveRef({
                    fs,
                    dir,
                    ref: `refs/remotes/${remote}/${currentBranch}`
                });
            } catch (e) {
                printError('Could not find remote branch');
                printHint(`Make sure the branch "${currentBranch}" exists on the remote`);
                return;
            }

            // Get the current branch OID
            const currentOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });

            // Check if already up to date
            if (currentOid === remoteBranchOid) {
                printNormal('Already up to date.');
                return;
            }

            // Check if it's a fast-forward merge
            const canFastForward = await git.isDescendent({
                fs,
                dir,
                oid: remoteBranchOid,
                ancestor: currentOid
            });

            if (canFastForward) {
                // Fast-forward merge
                await git.fastForward({
                    fs,
                    dir,
                    ref: currentBranch,
                    remote,
                    singleBranch: true
                });

                printNormal('Updating ' + currentOid.substring(0, 7) + '..' + remoteBranchOid.substring(0, 7));
                printNormal('Fast-forward');

                // Show changed files
                const commits = await git.log({
                    fs,
                    dir,
                    ref: currentBranch,
                    since: new Date(Date.now() - 1000 * 60 * 60 * 24) // Last 24 hours
                });

                if (commits.length > 0) {
                    const latestCommit = commits[0];
                    printNormal(` ${latestCommit.commit.message.split('\n')[0]}`);
                }

                printHint('Successfully pulled changes! Your local branch is now up to date');
            } else {
                printError('Cannot fast-forward. You have diverged from the remote branch.');
                printHint('You need to merge the changes. Try: git merge origin/' + currentBranch);
                printHint('Or, if you want to discard local changes: git reset --hard origin/' + currentBranch);
            }

        } catch (error) {
            if (error.message?.includes('401') || error.message?.includes('403')) {
                printError('Authentication failed or access denied');
                printHint('Public repositories should work without authentication');
            } else if (error.message?.includes('404')) {
                printError('Repository or branch not found');
                printHint('Make sure the remote URL and branch name are correct');
            } else {
                throw error;
            }
        }

    } catch (error) {
        printError(`git pull failed: ${error.message}`);
        printHint('This is usually an authentication or network issue. Pull works fully in browsers!');
    }
}

async function gitClone(args) {
    if (args.length === 0) {
        printError('You must specify a repository to clone.');
        printHint('Usage: git clone <url> [directory]');
        printHint('Example: git clone https://github.com/numpy/numpy.git');
        return;
    }

    // Get HTTP module (required for cloning)
    const httpModule = window.GitHttp || window.git?.http;
    if (!httpModule) {
        printError('HTTP module not loaded. Cannot clone from remote repositories.');
        printHint('Make sure the page loaded correctly. Try refreshing.');
        return;
    }

    const url = args[0];
    const customDir = args[1]; // Optional custom directory name

    // Extract repository name from URL
    let repoName = url.split('/').pop().replace('.git', '');
    if (customDir) {
        repoName = customDir;
    }

    // Validate URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        printError('Only HTTP(S) URLs are supported');
        printHint('Example: git clone https://github.com/user/repo.git');
        return;
    }

    const targetPath = resolvePath(repoName);

    // Check if directory already exists
    try {
        await pfs.stat(targetPath);
        printError(`fatal: destination path '${repoName}' already exists and is not an empty directory.`);
        return;
    } catch (e) {
        // Directory doesn't exist, which is what we want
    }

    printNormal(`Cloning into '${repoName}'...`);

    try {
        // Create directory
        await pfs.mkdir(targetPath, { recursive: true });

        // Clone the repository (fetch all branches by default)
        let lastPhase = '';
        await git.clone({
            fs,
            http: httpModule,
            dir: targetPath,
            url: url,
            corsProxy: GIT_PROXY,
            singleBranch: false, // Fetch all branches
            depth: 10, // Shallow clone for performance (only last 10 commits)
            onProgress: (event) => {
                if (event.phase === 'Receiving objects' || event.phase === 'Resolving deltas') {
                    const percent = event.total ? Math.round((event.loaded / event.total) * 100) : '?';
                    // Only show every 25% or when phase changes to reduce output
                    if (event.phase !== lastPhase || percent === 100 || percent % 25 === 0) {
                        term.write(`\r${event.phase}: ${percent}% (${event.loaded}/${event.total || '?'})`);
                        if (percent === 100) {
                            term.write('\r\n');
                            lastPhase = event.phase;
                        }
                    }
                }
            },
            onMessage: (message) => {
                term.write(`\rremote: ${message}\r\n`);
            },
            onAuth: () => {
                // For public repos, no auth needed
                return { username: '', password: '' };
            }
        });

        // Configure git user in the cloned repo
        await git.setConfig({ fs, dir: targetPath, path: 'user.name', value: DEFAULT_USER.name });
        await git.setConfig({ fs, dir: targetPath, path: 'user.email', value: DEFAULT_USER.email });

        printNormal(`\x1b[32m✓ Successfully cloned repository!\x1b[0m`);
        term.writeln(''); // Blank line before hints
        printHint(`cd ${repoName} && git log --graph --oneline to explore the history`);
        printHint('Large repositories may take some time. Using shallow clone for performance.');

    } catch (error) {
        printError(`Failed to clone repository: ${error.message}`);

        // Clean up partial clone
        try {
            await removeDirectory(targetPath);
        } catch (cleanupError) {
            // Ignore cleanup errors
        }

        // Provide helpful error messages
        if (error.message.includes('404') || error.message.includes('not found')) {
            printHint('Repository not found. Check the URL and make sure the repository is public.');
        } else if (error.message.includes('CORS') || error.message.includes('cors')) {
            printHint('CORS error. The repository might not allow cross-origin requests.');
        } else if (error.message.includes('rate limit')) {
            printHint('GitHub rate limit exceeded. Try again later.');
        } else if (error.message.includes('timeout')) {
            printHint('Request timed out. The repository might be too large or your connection is slow.');
            printHint('Try a smaller repository or check your internet connection.');
        } else {
            printHint('Make sure the repository URL is correct and the repository is public.');
        }

        console.error('Clone error details:', error);
    }
}

async function gitRm(args) {
    if (args.length === 0) {
        printError('fatal: No pathspec was given. Which files should I remove?');
        printHint('Usage: git rm <file>...');
        printHint('Use -r to remove directories recursively');
        return;
    }

    const dir = await git.findRoot({ fs, filepath: currentDir });
    const recursive = args.includes('-r') || args.includes('--recursive');
    const cached = args.includes('--cached');
    const force = args.includes('-f') || args.includes('--force');

    // Filter out flags
    const files = args.filter(arg => !arg.startsWith('-'));

    if (files.length === 0) {
        printError('fatal: No pathspec was given. Which files should I remove?');
        return;
    }

    try {
        for (const file of files) {
            const filepath = resolvePath(file);
            const relPath = filepath.replace(dir + '/', '');

            // Check if file exists
            try {
                const stat = await fs.promises.stat(filepath);

                if (stat.isDirectory() && !recursive) {
                    printError(`fatal: not removing '${file}' recursively without -r`);
                    continue;
                }

                // Remove from git index
                await git.remove({ fs, dir, filepath: relPath });
                printNormal(`rm '${file}'`);

                // Remove from filesystem (unless --cached)
                if (!cached) {
                    if (stat.isDirectory()) {
                        await removeDirectory(filepath);
                    } else {
                        await fs.promises.unlink(filepath);
                    }
                }
            } catch (error) {
                printError(`fatal: pathspec '${file}' did not match any files`);
            }
        }

        if (!cached) {
            printHint('Files removed from working directory and staging area');
        } else {
            printHint('Files removed from staging area only (use --cached to keep in working directory)');
        }
    } catch (error) {
        printError(`Error: ${error.message}`);
    }
}

async function gitMv(args) {
    if (args.length < 2) {
        printError('fatal: bad source or destination');
        printHint('Usage: git mv <source> <destination>');
        return;
    }

    const dir = await git.findRoot({ fs, filepath: currentDir });
    const source = args[0];
    const dest = args[1];

    const sourcePath = resolvePath(source);
    const destPath = resolvePath(dest);
    const relSource = sourcePath.replace(dir + '/', '');
    const relDest = destPath.replace(dir + '/', '');

    try {
        // Check if source exists
        const stat = await fs.promises.stat(sourcePath);

        // Read source content
        const content = await fs.promises.readFile(sourcePath, 'utf8');

        // Write to destination
        await fs.promises.writeFile(destPath, content);

        // Remove from git index (old path)
        await git.remove({ fs, dir, filepath: relSource });

        // Add to git index (new path)
        await git.add({ fs, dir, filepath: relDest });

        // Remove old file
        await fs.promises.unlink(sourcePath);

        printNormal(`Renamed ${source} -> ${dest}`);
        printHint('File has been moved/renamed and staged for commit');
    } catch (error) {
        printError(`fatal: ${error.message}`);
        printHint('Make sure the source file exists and the destination is valid');
    }
}

async function gitMerge(args) {
    if (args.length === 0) {
        printError('fatal: No remote for the current branch.');
        printHint('Usage: git merge <branch>');
        return;
    }

    const dir = await git.findRoot({ fs, filepath: currentDir });

    try {
        // Check for --abort flag first (before branch validation)
        if (args.includes('--abort')) {
            try {
                const mergeHeadPath = `${dir}/.git/MERGE_HEAD`;
                await pfs.unlink(mergeHeadPath);
                printNormal('Merge aborted.');
                printHint('You are back to the state before the merge');
                return;
            } catch (e) {
                printError('No merge in progress');
                return;
            }
        }

        const branchToMerge = args[0];
        const branches = await git.listBranches({ fs, dir });
        if (!branches.includes(branchToMerge)) {
            printError(`error: pathspec '${branchToMerge}' did not match any file(s) known to git`);
            return;
        }

        const currentBranch = await git.currentBranch({ fs, dir });

        const result = await git.merge({
            fs,
            dir,
            ours: currentBranch,
            theirs: branchToMerge,
            author: await getAuthor(dir),
            dryRun: false,
            noUpdateBranch: false
        });

        // Check if merge was successful
        if (result && result.alreadyMerged) {
            printNormal('Already up to date.');
            return;
        }

        printNormal(`Merge made by the 'recursive' strategy.`);
        printNormal(`Merged branch '${branchToMerge}' into ${currentBranch}`);
        printHint('Files from the merged branch are now in your working directory');

    } catch (error) {
        console.error('Merge error:', error);

        if (error.code === 'MergeNotSupportedError' || error.data) {
            // Handle merge conflicts
            printError('CONFLICT (content): Merge conflict detected');
            printNormal('Automatic merge failed; fix conflicts and then commit the result.');

            // Show conflicted files if available
            if (error.data && error.data.filepaths) {
                printNormal('');
                printNormal('Conflicted files:');
                error.data.filepaths.forEach(filepath => {
                    printError(`  ${filepath}`);
                });
            }

            term.writeln(''); // Blank line before hints
            printHint('To resolve conflicts:');
            printHint('  1. Edit the conflicted files (look for <<<<<<< markers)');
            printHint('  2. Remove conflict markers and choose the correct content');
            printHint('  3. git add <file> - to mark as resolved');
            printHint('  4. git commit - to complete the merge');
            printHint('Or use: git merge --abort - to abort the merge');

        } else if (error.message.includes('conflict')) {
            printError(`Merge conflict: ${error.message}`);
            printHint('Fix conflicts and run "git add <file>" then "git commit"');
            printHint('Or run "git merge --abort" to cancel the merge');
        } else {
            printError(`Error: ${error.message}`);
        }
    }
}

async function gitTag(args) {
    const dir = await git.findRoot({ fs, filepath: currentDir });

    if (args.length === 0) {
        // List tags
        try {
            const tags = await git.listTags({ fs, dir });
            if (tags.length === 0) {
                printHint('No tags found. Create one with: git tag <tagname>');
            } else {
                tags.forEach(tag => printNormal(tag));
            }
        } catch (error) {
            printError(`Error: ${error.message}`);
        }
        return;
    }

    // Delete tag
    if (args.includes('-d')) {
        const dIndex = args.indexOf('-d');
        const deleteTagName = args.find((a, i) => i !== dIndex && !a.startsWith('-'));
        if (!deleteTagName) {
            printError('fatal: tag name required');
            printHint('Usage: git tag -d <tagname>');
            return;
        }
        try {
            await git.deleteTag({ fs, dir, ref: deleteTagName });
            printNormal(`Deleted tag '${deleteTagName}'`);
        } catch (error) {
            printError(`error: tag '${deleteTagName}' not found.`);
        }
        return;
    }

    const tagName = args.find(a => !a.startsWith('-'));
    if (!tagName) {
        printError('fatal: tag name required');
        return;
    }
    const hasMessage = args.includes('-m') || args.includes('-a');
    let message = '';

    if (hasMessage) {
        const msgIndex = args.indexOf('-m') !== -1 ? args.indexOf('-m') : args.indexOf('-a');
        message = args[msgIndex + 1] || '';
    }

    // Create tag
    try {
        await git.tag({ fs, dir, ref: tagName, object: await git.resolveRef({ fs, dir, ref: 'HEAD' }) });
        printNormal(`Created tag '${tagName}'`);
        printHint('Tags are useful for marking release points (v1.0, v2.0, etc.)');
    } catch (error) {
        printError(`Error: ${error.message}`);
    }
}

async function gitShow(args) {
    const dir = await git.findRoot({ fs, filepath: currentDir });

    try {
        let ref = 'HEAD';
        if (args.length > 0 && !args[0].startsWith('-')) {
            ref = args[0];
        }

        const showStat = args.includes('--stat');
        const showNameOnly = args.includes('--name-only');
        const showNameStatus = args.includes('--name-status');

        // Handle HEAD~n syntax
        const headMatch = ref.match(/^HEAD~(\d+)$/);
        let oid;
        if (headMatch) {
            const n = parseInt(headMatch[1], 10);
            const commits = await git.log({ fs, dir, depth: n + 1 });
            if (commits.length <= n) {
                printError(`fatal: ${ref} does not exist`);
                return;
            }
            oid = commits[n].oid;
        } else {
            oid = await git.resolveRef({ fs, dir, ref });
        }

        const commit = await git.readCommit({ fs, dir, oid });

        // Print commit header
        printNormal(`\x1b[33mcommit ${oid}\x1b[0m`);
        printNormal(`Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);
        printNormal(`Date:   ${formatGitDate(commit.commit.author.timestamp)}`);
        printNormal('');

        // Print message with proper indentation
        commit.commit.message.split('\n').forEach(line => {
            printNormal(`    ${line}`);
        });
        printNormal('');

        // Get parent commit for diff
        const parentOid = commit.commit.parent[0];
        if (parentOid) {
            try {
                const parentCommit = await git.readCommit({ fs, dir, oid: parentOid });
                const parentFiles = await flattenTree(dir, parentCommit.commit.tree);
                const currentFiles = await flattenTree(dir, commit.commit.tree);

                // Find changed files
                const allFiles = new Set([...Object.keys(parentFiles), ...Object.keys(currentFiles)]);
                const changes = [];

                for (const file of allFiles) {
                    if (!parentFiles[file]) {
                        changes.push({ file, status: 'A', type: 'added' });
                    } else if (!currentFiles[file]) {
                        changes.push({ file, status: 'D', type: 'deleted' });
                    } else if (parentFiles[file] !== currentFiles[file]) {
                        changes.push({ file, status: 'M', type: 'modified' });
                    }
                }

                if (changes.length > 0) {
                    if (showNameOnly) {
                        changes.forEach(c => printNormal(c.file));
                    } else if (showNameStatus) {
                        changes.forEach(c => printNormal(`${c.status}\t${c.file}`));
                    } else if (showStat) {
                        printNormal('---');
                        changes.forEach(c => {
                            const statusColor = c.status === 'A' ? '\x1b[32m' :
                                c.status === 'D' ? '\x1b[31m' : '\x1b[33m';
                            printNormal(` ${statusColor}${c.file}\x1b[0m | ${c.type}`);
                        });
                        printNormal(`${changes.length} file(s) changed`);
                    } else {
                        // Show actual diffs
                        for (const change of changes) {
                            printNormal(`\x1b[1mdiff --git a/${change.file} b/${change.file}\x1b[0m`);

                            if (change.status === 'A') {
                                printNormal('--- /dev/null');
                                printNormal(`+++ b/${change.file}`);
                                try {
                                    const { blob } = await git.readBlob({ fs, dir, oid: currentFiles[change.file] });
                                    const content = new TextDecoder().decode(blob);
                                    content.split('\n').forEach(line => {
                                        term.writeln(`\x1b[32m+${line}\x1b[0m`);
                                    });
                                } catch (e) { }
                            } else if (change.status === 'D') {
                                printNormal(`--- a/${change.file}`);
                                printNormal('+++ /dev/null');
                                try {
                                    const { blob } = await git.readBlob({ fs, dir, oid: parentFiles[change.file] });
                                    const content = new TextDecoder().decode(blob);
                                    content.split('\n').forEach(line => {
                                        term.writeln(`\x1b[31m-${line}\x1b[0m`);
                                    });
                                } catch (e) { }
                            } else {
                                try {
                                    const { blob: oldBlob } = await git.readBlob({ fs, dir, oid: parentFiles[change.file] });
                                    const { blob: newBlob } = await git.readBlob({ fs, dir, oid: currentFiles[change.file] });
                                    const oldContent = new TextDecoder().decode(oldBlob);
                                    const newContent = new TextDecoder().decode(newBlob);
                                    await printColorizedDiff(oldContent, newContent, change.file);
                                } catch (e) { }
                            }
                            printNormal('');
                        }
                    }
                }
            } catch (e) {
                // No parent or error reading - just show commit info
            }
        }

        printHint('Use git show <commit> to view specific commits');
        printHint('Options: --stat, --name-only, --name-status');
    } catch (error) {
        printError(`fatal: ${error.message}`);
    }
}

async function gitFetch(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Get HTTP module
        const httpModule = window.GitHttp || window.git?.http;
        if (!httpModule) {
            printError('HTTP module not loaded. Cannot fetch from remote repositories.');
            printHint('Fetch requires network access. Make sure the page loaded correctly.');
            return;
        }

        // Check if there's a remote configured
        let remoteUrl;
        try {
            remoteUrl = await git.getConfig({ fs, dir, path: 'remote.origin.url' });
        } catch (e) {
            printError('fatal: No remote repository configured.');
            printHint('Add a remote with: git remote add origin <url>');
            return;
        }

        if (!remoteUrl) {
            printError('fatal: No remote repository configured.');
            printHint('This repository was not cloned. Add a remote with: git remote add origin <url>');
            return;
        }

        // Parse arguments
        const fetchAll = args.includes('--all') || args.includes('-a');
        const prune = args.includes('--prune') || args.includes('-p');

        printNormal(`Fetching origin`);

        try {
            // Fetch from remote
            let lastPhase = '';
            const fetchResult = await git.fetch({
                fs,
                http: httpModule,
                dir: dir,
                url: remoteUrl,
                remote: 'origin',
                corsProxy: GIT_PROXY,
                prune: prune,
                singleBranch: !fetchAll, // If --all, fetch all branches
                depth: 10,
                onProgress: (event) => {
                    if (event.phase === 'Receiving objects' || event.phase === 'Resolving deltas') {
                        const percent = event.total ? Math.round((event.loaded / event.total) * 100) : '?';
                        // Only show every 25% or when phase changes to reduce output
                        if (event.phase !== lastPhase || percent === 100 || percent % 25 === 0) {
                            term.write(`\r${event.phase}: ${percent}% (${event.loaded}/${event.total || '?'})`);
                            if (percent === 100) {
                                term.write('\r\n');
                                lastPhase = event.phase;
                            }
                        }
                    }
                },
                onMessage: (message) => {
                    term.write(`\rremote: ${message}\r\n`);
                },
                onAuth: () => {
                    return { username: '', password: '' };
                }
            });

            printNormal(`From ${remoteUrl}`);

            // List fetched branches
            const remoteBranches = await git.listBranches({ fs, dir, remote: 'origin' });
            if (remoteBranches.length > 0) {
                printNormal(`Fetched ${remoteBranches.length} branch(es):`);
                remoteBranches.forEach(branch => {
                    printNormal(`  * [new branch]      ${branch} -> origin/${branch}`);
                });
            }

            printNormal('\x1b[32m✓ Fetch complete!\x1b[0m');
            term.writeln(''); // Blank line before hints
            printHint('Use "git branch -r" to see remote branches');
            printHint('Use "git checkout <branch>" to switch to a fetched branch');

        } catch (error) {
            printError(`Failed to fetch: ${error.message}`);

            if (error.message.includes('404') || error.message.includes('not found')) {
                printHint('Remote repository not found. The URL might have changed.');
            } else if (error.message.includes('CORS')) {
                printHint('CORS error. The remote server might not allow cross-origin requests.');
            } else {
                printHint('Make sure you have internet connection and the remote URL is correct.');
            }

            console.error('Fetch error details:', error);
        }

    } catch (error) {
        printError(`git fetch failed: ${error.message}`);
        console.error('Fetch error:', error);
    }
}

async function gitStash(args) {
    const dir = await git.findRoot({ fs, filepath: currentDir });
    const stashDir = `${dir}/.git/stash`;
    const stashIndexFile = `${dir}/.git/stash/index.json`;

    // Helper to ensure stash directory exists
    async function ensureStashDir() {
        try {
            await pfs.stat(stashDir);
        } catch (e) {
            await pfs.mkdir(stashDir, { recursive: true });
        }
    }

    // Helper to read stash index
    async function readStashIndex() {
        try {
            const data = await pfs.readFile(stashIndexFile, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            return [];
        }
    }

    // Helper to write stash index
    async function writeStashIndex(index) {
        await ensureStashDir();
        await pfs.writeFile(stashIndexFile, JSON.stringify(index, null, 2), 'utf8');
    }

    const currentBranch = await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';

    if (args.length === 0 || args[0] === 'push') {
        // Stash push - save current changes
        const status = await git.statusMatrix({ fs, dir });
        const modifiedFiles = [];

        for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
            if (filepath.startsWith('.git/')) continue;
            // Modified or staged files
            if (workdirStatus === 2 || stageStatus === 2) {
                try {
                    const content = await pfs.readFile(`${dir}/${filepath}`, 'utf8');
                    modifiedFiles.push({ filepath, content, stageStatus });
                } catch (e) {
                    // File might be deleted
                    modifiedFiles.push({ filepath, deleted: true, stageStatus });
                }
            }
        }

        if (modifiedFiles.length === 0) {
            printNormal('No local changes to save');
            return;
        }

        // Get current HEAD for reference
        const commits = await git.log({ fs, dir, depth: 1 });
        const headOid = commits[0]?.oid?.substring(0, 7) || 'HEAD';
        const headMessage = commits[0]?.commit?.message?.split('\n')[0] || 'commit';

        // Parse custom message
        let message = `WIP on ${currentBranch}: ${headOid} ${headMessage}`;
        const mIndex = args.indexOf('-m');
        if (mIndex !== -1 && args[mIndex + 1]) {
            message = args[mIndex + 1];
        }

        // Save stash
        const stashIndex = await readStashIndex();
        const stashEntry = {
            id: Date.now(),
            message,
            branch: currentBranch,
            files: modifiedFiles,
            timestamp: new Date().toISOString()
        };
        stashIndex.unshift(stashEntry);
        await writeStashIndex(stashIndex);

        // Restore files to HEAD state
        for (const file of modifiedFiles) {
            if (!file.deleted) {
                try {
                    const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
                    const { blob } = await git.readBlob({ fs, dir, oid: headOid, filepath: file.filepath });
                    const content = new TextDecoder().decode(blob);
                    await pfs.writeFile(`${dir}/${file.filepath}`, content, 'utf8');
                } catch (e) {
                    // File might be new, delete it
                    try { await pfs.unlink(`${dir}/${file.filepath}`); } catch (e2) { }
                }
            }
        }

        printNormal(`Saved working directory and index state ${message}`);
        printHint('Use "git stash pop" to restore your changes');
        return;
    }

    if (args[0] === 'list') {
        const stashIndex = await readStashIndex();
        if (stashIndex.length === 0) {
            printHint('No stashes found. Use "git stash" to save changes.');
            return;
        }
        stashIndex.forEach((entry, index) => {
            printNormal(`stash@{${index}}: ${entry.message}`);
        });
        return;
    }

    if (args[0] === 'show') {
        const stashIndex = await readStashIndex();
        const stashNum = args[1] ? parseInt(args[1].match(/\d+/)?.[0] || '0', 10) : 0;

        if (stashIndex.length === 0 || !stashIndex[stashNum]) {
            printError(`error: stash@{${stashNum}} does not exist`);
            return;
        }

        const entry = stashIndex[stashNum];
        printNormal(`stash@{${stashNum}}: ${entry.message}`);
        printNormal('');
        entry.files.forEach(file => {
            if (file.deleted) {
                printNormal(`  \x1b[31mdeleted:  ${file.filepath}\x1b[0m`);
            } else {
                printNormal(`  \x1b[33mmodified: ${file.filepath}\x1b[0m`);
            }
        });
        return;
    }

    if (args[0] === 'pop' || args[0] === 'apply') {
        const stashIndex = await readStashIndex();
        const stashNum = args[1] ? parseInt(args[1].match(/\d+/)?.[0] || '0', 10) : 0;

        if (stashIndex.length === 0 || !stashIndex[stashNum]) {
            printError(`error: stash@{${stashNum}} does not exist`);
            return;
        }

        const entry = stashIndex[stashNum];

        // Restore files
        for (const file of entry.files) {
            if (file.deleted) {
                try { await pfs.unlink(`${dir}/${file.filepath}`); } catch (e) { }
            } else {
                await pfs.writeFile(`${dir}/${file.filepath}`, file.content, 'utf8');
            }
        }

        printNormal(`On branch ${currentBranch}`);
        printNormal('Changes restored from stash:');
        entry.files.forEach(file => {
            printNormal(`  modified: ${file.filepath}`);
        });

        if (args[0] === 'pop') {
            stashIndex.splice(stashNum, 1);
            await writeStashIndex(stashIndex);
            printNormal(`Dropped stash@{${stashNum}}`);
        }

        printHint('Your stashed changes have been restored to the working directory');
        return;
    }

    if (args[0] === 'drop') {
        const stashIndex = await readStashIndex();
        const stashNum = args[1] ? parseInt(args[1].match(/\d+/)?.[0] || '0', 10) : 0;

        if (stashIndex.length === 0 || !stashIndex[stashNum]) {
            printError(`error: stash@{${stashNum}} does not exist`);
            return;
        }

        stashIndex.splice(stashNum, 1);
        await writeStashIndex(stashIndex);
        printNormal(`Dropped stash@{${stashNum}}`);
        return;
    }

    if (args[0] === 'clear') {
        await writeStashIndex([]);
        printNormal('Cleared all stash entries');
        return;
    }

    printError(`Unknown stash subcommand: ${args[0]}`);
    printHint('Available: git stash [push|pop|apply|list|show|drop|clear]');
}

async function gitConfig(args) {
    const dir = await git.findRoot({ fs, filepath: currentDir });

    if (args.length === 0) {
        printError('usage: git config [<options>]');
        printHint('Common: git config user.name "Your Name"');
        printHint('        git config user.email "your@email.com"');
        printHint('        git config --list (to view all settings)');
        return;
    }

    if (args[0] === '--list' || args[0] === '-l') {
        try {
            const configPath = `${dir}/.git/config`;
            const configContent = await pfs.readFile(configPath, 'utf8');
            const lines = configContent.split('\n');
            let section = '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('[')) {
                    const match = trimmed.match(/^\[(\w+)(?:\s+"([^"]+)")?\]/);
                    if (match) {
                        section = match[2] ? `${match[1]}.${match[2]}` : match[1];
                    }
                } else if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                    const eqIdx = trimmed.indexOf('=');
                    const key = trimmed.substring(0, eqIdx).trim();
                    const val = trimmed.substring(eqIdx + 1).trim();
                    printNormal(`${section}.${key}=${val}`);
                }
            }
            printHint('Use "git config <key> <value>" to change a setting.');
        } catch (error) {
            // Fallback to reading individual values
            const userName = await git.getConfig({ fs, dir, path: 'user.name' }) || 'Student';
            const userEmail = await git.getConfig({ fs, dir, path: 'user.email' }) || 'student@example.com';
            printNormal(`user.name=${userName}`);
            printNormal(`user.email=${userEmail}`);
            printHint('These settings identify you in commits');
        }
        return;
    }

    // Set config
    if (args.length >= 2) {
        const key = args[0];
        const value = args[1];

        try {
            await git.setConfig({ fs, dir, path: key, value });
            printNormal(`Set ${key} = ${value}`);
            printHint('Configuration updated successfully');
        } catch (error) {
            printError(`Error: ${error.message}`);
        }
    } else {
        // Get config
        try {
            const value = await git.getConfig({ fs, dir, path: args[0] });
            if (value) {
                printNormal(value);
            } else {
                printError(`No value found for ${args[0]}`);
            }
        } catch (error) {
            printError(`Error: ${error.message}`);
        }
    }
}

// New git commands - Phase 1 & 3

async function gitRevert(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args.length === 0) {
            printError('fatal: No commit to revert');
            printHint('Usage: git revert <commit>');
            printHint('Creates a new commit that undoes the changes from the specified commit');
            return;
        }

        const ref = args[0];
        let targetOid;

        // Handle HEAD~n syntax
        const headMatch = ref.match(/^HEAD~(\d+)$/);
        if (headMatch) {
            const n = parseInt(headMatch[1], 10);
            const commits = await git.log({ fs, dir, depth: n + 1 });
            if (commits.length <= n) {
                printError(`fatal: ${ref} does not exist`);
                return;
            }
            targetOid = commits[n].oid;
        } else if (ref === 'HEAD') {
            targetOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
        } else {
            // Try to resolve as commit hash
            try {
                targetOid = await git.expandOid({ fs, dir, oid: ref });
            } catch (e) {
                printError(`fatal: bad revision '${ref}'`);
                return;
            }
        }

        // Get the commit to revert
        const commitToRevert = await git.readCommit({ fs, dir, oid: targetOid });
        const parentOid = commitToRevert.commit.parent[0];

        if (!parentOid) {
            printError('fatal: Cannot revert the initial commit');
            return;
        }

        // Get trees for the commit and its parent to compute inverse diff
        const revertFiles = await flattenTree(dir, commitToRevert.commit.tree);
        const parentFiles = await flattenTree(dir, (await git.readCommit({ fs, dir, oid: parentOid })).commit.tree);

        // Apply inverse diff: changes introduced in targetOid should be reversed
        const allPaths = new Set([...Object.keys(revertFiles), ...Object.keys(parentFiles)]);
        let changed = false;
        for (const filepath of allPaths) {
            const revertOidBlob = revertFiles[filepath];
            const parentOidBlob = parentFiles[filepath];

            if (revertOidBlob === parentOidBlob) continue; // No change in this file by the commit

            changed = true;
            if (revertOidBlob && !parentOidBlob) {
                // File was added by the commit being reverted → delete it
                try {
                    await pfs.unlink(`${dir}/${filepath}`);
                    await git.remove({ fs, dir, filepath });
                } catch (e) { }
            } else if (!revertOidBlob && parentOidBlob) {
                // File was deleted by the commit being reverted → restore it
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: parentOidBlob });
                    const content = new TextDecoder().decode(blob);
                    const parts = filepath.split('/');
                    if (parts.length > 1) {
                        const dirPath = `${dir}/${parts.slice(0, -1).join('/')}`;
                        try { await pfs.mkdir(dirPath, { recursive: true }); } catch (e) { }
                    }
                    await pfs.writeFile(`${dir}/${filepath}`, content, 'utf8');
                    await git.add({ fs, dir, filepath });
                } catch (e) { }
            } else {
                // File was modified by the commit being reverted → restore parent version
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: parentOidBlob });
                    const content = new TextDecoder().decode(blob);
                    await pfs.writeFile(`${dir}/${filepath}`, content, 'utf8');
                    await git.add({ fs, dir, filepath });
                } catch (e) { }
            }
        }

        if (!changed) {
            printNormal('nothing to revert');
            return;
        }

        // Create revert commit
        const revertMessage = `Revert "${commitToRevert.commit.message.split('\n')[0]}"\n\nThis reverts commit ${targetOid.substring(0, 7)}.`;
        const author = await getAuthor(dir);
        const newOid = await git.commit({
            fs,
            dir,
            message: revertMessage,
            author
        });

        const currentBranch = await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';
        printNormal(`[${currentBranch} ${newOid.substring(0, 7)}] Revert "${commitToRevert.commit.message.split('\n')[0]}"`);
        printHint('Created a new commit that reverts the specified commit');
        printHint('The original commit history is preserved');
    } catch (error) {
        printError(`git revert failed: ${error.message}`);
    }
}

async function gitRestore(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args.length === 0) {
            printError('fatal: you must specify path(s) to restore');
            printHint('Usage: git restore <file>           (discard working tree changes)');
            printHint('       git restore --staged <file>  (unstage file)');
            printHint('       git restore --source=<commit> <file>');
            return;
        }

        const hasStaged = args.includes('--staged') || args.includes('-S');
        const hasWorktree = args.includes('--worktree') || args.includes('-W');

        // Parse --source=<commit>
        let sourceRef = null;
        const sourceArg = args.find(a => a.startsWith('--source='));
        if (sourceArg) {
            sourceRef = sourceArg.split('=')[1];
        }

        // Filter out flags to get file paths
        const files = args.filter(a =>
            !a.startsWith('--') && a !== '-S' && a !== '-W' && !a.startsWith('--source=')
        );

        if (files.length === 0) {
            printError('fatal: you must specify path(s) to restore');
            return;
        }

        let hasErrors = false;

        for (const file of files) {
            // Resolve path relative to repo root
            const absPath = file.startsWith('/') ? file : `${currentDir}/${file}`;
            // Handle case where currentDir might not end with slash, ensure slice works
            let relPath = file;
            if (absPath.startsWith(dir)) {
                relPath = absPath.slice(dir.length);
                if (relPath.startsWith('/')) relPath = relPath.slice(1);
            }

            if (hasStaged) {
                // git.resetIndex uses filepath relative to dir
                let oid = 'HEAD';
                if (sourceRef) oid = sourceRef;

                await git.resetIndex({ fs, dir, filepath: relPath, ref: oid });
                printNormal(`Unstaged changes for ${relPath}`);
            } else {
                try {
                    let blob;
                    const ref = sourceRef || 'HEAD';
                    const resolvedOid = await git.resolveRef({ fs, dir, ref });
                    const result = await git.readBlob({ fs, dir, oid: resolvedOid, filepath: relPath });
                    blob = result.blob;

                    const content = new TextDecoder().decode(blob);
                    await pfs.writeFile(absPath, content, 'utf8');
                    printNormal(`Updated 1 path from ${sourceRef || 'the index'}`);
                } catch (e) {
                    hasErrors = true;
                    printError(`error: pathspec '${relPath}' did not match any file(s) known to git`);
                }
            }
        }

        if (hasStaged) {
            printHint('Files have been unstaged. Use "git add" to stage again.');
        } else if (!hasErrors) {
            printHint('Working tree changes have been discarded');
        }
    } catch (error) {
        printError(`git restore failed: ${error.message}`);
    }
}

async function gitSwitch(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args.length === 0) {
            printError('fatal: missing branch or commit argument');
            printHint('Usage: git switch <branch>');
            printHint('       git switch -c <new-branch>  (create and switch)');
            printHint('       git switch -             (switch to previous branch)');
            return;
        }

        // Check for -c (create new branch)
        const createBranch = args.includes('-c') || args.includes('--create');

        if (createBranch) {
            const cIndex = args.indexOf('-c') !== -1 ? args.indexOf('-c') : args.indexOf('--create');
            const newBranchName = args[cIndex + 1];

            if (!newBranchName) {
                printError('fatal: missing branch name');
                return;
            }

            const branches = await git.listBranches({ fs, dir });
            if (branches.includes(newBranchName)) {
                printError(`fatal: A branch named '${newBranchName}' already exists.`);
                return;
            }

            await git.branch({ fs, dir, ref: newBranchName, checkout: true });
            printNormal(`Switched to a new branch '${newBranchName}'`);
            printHint('git switch -c is the modern way to create and switch to a new branch');
        } else {
            const branchName = args[0];

            // Check if branch exists
            const branches = await git.listBranches({ fs, dir });
            if (!branches.includes(branchName)) {
                printError(`fatal: invalid reference: ${branchName}`);
                printHint(`Use "git switch -c ${branchName}" to create a new branch`);
                return;
            }

            await git.checkout({ fs, dir, ref: branchName });
            printNormal(`Switched to branch '${branchName}'`);
        }

        printHint('git switch is the modern replacement for git checkout when switching branches');
    } catch (error) {
        printError(`git switch failed: ${error.message}`);
    }
}

async function gitRebase(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args.length === 0) {
            printError('fatal: No rebase in progress?');
            printHint('Usage: git rebase <branch>');
            printHint('       git rebase --abort     (abort an in-progress rebase)');
            printHint('       git rebase --continue  (continue after resolving conflicts)');
            return;
        }

        if (args.includes('--abort')) {
            // Check if there's a rebase in progress
            try {
                await pfs.stat(`${dir}/.git/rebase-merge`);
                await removeDirectory(`${dir}/.git/rebase-merge`);
                printNormal('Rebase aborted');
            } catch (e) {
                printError('fatal: No rebase in progress?');
            }
            return;
        }

        if (args.includes('--continue')) {
            printError('fatal: No rebase in progress?');
            printHint('Start a rebase with: git rebase <branch>');
            return;
        }

        if (args.includes('-i') || args.includes('--interactive')) {
            printError('Interactive rebase is not supported in this learning environment');
            printHint('Interactive rebase (-i) allows you to edit, squash, or reorder commits');
            printHint('In a real terminal: git rebase -i HEAD~3 (edit last 3 commits)');
            return;
        }

        const targetBranch = args[0];
        const currentBranch = await git.currentBranch({ fs, dir });

        // Check if target branch exists
        const branches = await git.listBranches({ fs, dir });
        if (!branches.includes(targetBranch)) {
            printError(`fatal: invalid upstream '${targetBranch}'`);
            return;
        }

        // Replay commits from current branch on top of target branch
        printNormal(`Rebasing ${currentBranch} onto ${targetBranch}...`);

        try {
            // Get the base (merge-base) between current and target
            const targetOid = await git.resolveRef({ fs, dir, ref: targetBranch });
            const currentOid = await git.resolveRef({ fs, dir, ref: currentBranch });

            // Get commits on current branch
            const allCommits = await git.log({ fs, dir, ref: currentBranch, depth: 100 });
            const targetCommits = await git.log({ fs, dir, ref: targetBranch, depth: 100 });
            const targetOids = new Set(targetCommits.map(c => c.oid));

            // Find commits to replay (commits on current branch not in target)
            const toReplay = [];
            for (const commit of allCommits) {
                if (targetOids.has(commit.oid)) break; // Reached common ancestor
                toReplay.push(commit);
            }
            toReplay.reverse(); // Oldest first

            if (toReplay.length === 0) {
                printNormal(`Current branch ${currentBranch} is up to date.`);
                return;
            }

            // Move branch pointer to target tip
            await git.checkout({ fs, dir, ref: targetBranch, force: true });
            // Re-create the branch at target tip
            try { await git.deleteBranch({ fs, dir, ref: currentBranch }); } catch (e) { }
            await git.branch({ fs, dir, ref: currentBranch, checkout: true });

            // Replay each commit
            const author = await getAuthor(dir);
            for (const commit of toReplay) {
                // Get tree contents for this commit and its parent
                const parentOid = commit.commit.parent[0];
                if (!parentOid) continue;

                const commitFiles = await flattenTree(dir, commit.commit.tree);
                const parentFiles = await flattenTree(dir, (await git.readCommit({ fs, dir, oid: parentOid })).commit.tree);

                // Apply the diff
                const allPaths = new Set([...Object.keys(commitFiles), ...Object.keys(parentFiles)]);
                for (const filepath of allPaths) {
                    if (commitFiles[filepath] === parentFiles[filepath]) continue;

                    if (commitFiles[filepath] && !parentFiles[filepath]) {
                        const { blob } = await git.readBlob({ fs, dir, oid: commitFiles[filepath] });
                        const parts = filepath.split('/');
                        if (parts.length > 1) {
                            try { await pfs.mkdir(`${dir}/${parts.slice(0, -1).join('/')}`, { recursive: true }); } catch (e) { }
                        }
                        await pfs.writeFile(`${dir}/${filepath}`, new TextDecoder().decode(blob), 'utf8');
                        await git.add({ fs, dir, filepath });
                    } else if (!commitFiles[filepath] && parentFiles[filepath]) {
                        try {
                            await pfs.unlink(`${dir}/${filepath}`);
                            await git.remove({ fs, dir, filepath });
                        } catch (e) { }
                    } else {
                        const { blob } = await git.readBlob({ fs, dir, oid: commitFiles[filepath] });
                        await pfs.writeFile(`${dir}/${filepath}`, new TextDecoder().decode(blob), 'utf8');
                        await git.add({ fs, dir, filepath });
                    }
                }

                await git.commit({
                    fs,
                    dir,
                    message: commit.commit.message,
                    author
                });
            }

            printNormal(`Successfully rebased and updated refs/heads/${currentBranch}.`);
            printHint('Rebase replays your commits on top of the target branch');
            printHint('This creates a linear history without merge commits');
        } catch (error) {
            if (error.code === 'MergeNotSupportedError' || error.message?.includes('conflict')) {
                printError('CONFLICT: Merge conflict during rebase');
                printNormal('Resolve conflicts and use "git rebase --continue"');
                printNormal('Or use "git rebase --abort" to cancel');
            } else {
                throw error;
            }
        }
    } catch (error) {
        printError(`git rebase failed: ${error.message}`);
    }
}

async function gitReflog(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // isomorphic-git doesn't have reflog support, so we simulate it
        // by showing recent commits with a reflog-like format and
        // inferring the action type from the commit message.
        const commits = await git.log({ fs, dir, depth: 20 });
        const currentBranch = await git.currentBranch({ fs, dir }).catch(() => 'HEAD') || 'HEAD';

        printNormal('');
        commits.forEach((commit, index) => {
            const shortOid = commit.oid.substring(0, 7);
            const message = commit.commit.message.split('\n')[0];

            // Infer the reflog action from the commit message
            let action;
            if (message.startsWith('Merge branch') || message.startsWith('Merge pull request')) {
                // Merge commits
                const mergeTarget = message.match(/Merge (?:branch|pull request) .*/);
                action = mergeTarget ? mergeTarget[0] : `merge: ${message}`;
            } else if (index === 0) {
                // Most recent entry — show as commit (initial)
                action = `commit: ${message}`;
            } else {
                action = `commit: ${message}`;
            }

            term.writeln(`\x1b[33m${shortOid}\x1b[0m HEAD@{${index}}: ${action}`);
        });

        printNormal('');
        printHint('Reflog shows a history of where HEAD has pointed');
        printHint('Useful for recovering lost commits or undoing operations');
        printHint('Note: This is a simulated reflog based on commit history');
    } catch (error) {
        printError(`git reflog failed: ${error.message}`);
    }
}

async function gitClean(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        const dryRun = args.includes('-n') || args.includes('--dry-run');
        const force = args.includes('-f') || args.includes('--force');
        const removeDirectories = args.includes('-d');

        if (!dryRun && !force) {
            printError('fatal: clean.requireForce defaults to true and -n or -f not given');
            printHint('Use -n for dry run (show what would be deleted)');
            printHint('Use -f to actually delete files');
            return;
        }

        // Get status to find untracked files
        const status = await git.statusMatrix({ fs, dir });
        const untrackedFiles = [];

        for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
            if (filepath.startsWith('.git/')) continue;
            // Untracked: not in HEAD, in workdir, not staged
            if (HEADStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
                untrackedFiles.push(filepath);
            }
        }

        if (untrackedFiles.length === 0) {
            printNormal('Nothing to clean');
            return;
        }

        if (dryRun) {
            printNormal('Would remove:');
            untrackedFiles.forEach(file => {
                printNormal(`  ${file}`);
            });
            printHint('Run with -f to actually delete these files');
        } else {
            // Actually delete the files
            for (const file of untrackedFiles) {
                try {
                    await pfs.unlink(`${dir}/${file}`);
                    printNormal(`Removing ${file}`);
                } catch (e) {
                    // Might be a directory if -d was used
                    if (removeDirectories) {
                        try {
                            await removeDirectory(`${dir}/${file}`);
                            printNormal(`Removing ${file}/`);
                        } catch (e2) {
                            printError(`Failed to remove ${file}`);
                        }
                    }
                }
            }
            printHint('Untracked files have been removed');
        }
    } catch (error) {
        printError(`git clean failed: ${error.message}`);
    }
}

async function gitShortlog(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        const showSummary = args.includes('-s') || args.includes('--summary');
        const showNumbered = args.includes('-n') || args.includes('--numbered');

        const commits = await git.log({ fs, dir, depth: 100 });

        // Group commits by author
        const authorCommits = {};
        for (const commit of commits) {
            const author = commit.commit.author.name;
            if (!authorCommits[author]) {
                authorCommits[author] = [];
            }
            authorCommits[author].push(commit);
        }

        // Sort authors
        let authors = Object.keys(authorCommits);
        if (showNumbered) {
            // Sort by number of commits (descending)
            authors.sort((a, b) => authorCommits[b].length - authorCommits[a].length);
        } else {
            // Sort alphabetically
            authors.sort();
        }

        printNormal('');
        for (const author of authors) {
            const commits = authorCommits[author];
            if (showSummary) {
                printNormal(`     ${commits.length}\t${author}`);
            } else {
                printNormal(`${author} (${commits.length}):`);
                commits.forEach(commit => {
                    const message = commit.commit.message.split('\n')[0];
                    printNormal(`      ${message}`);
                });
                printNormal('');
            }
        }

        printHint('Shortlog summarizes commit history by author');
        printHint('Use -s for counts only, -n to sort by number of commits');
    } catch (error) {
        printError(`git shortlog failed: ${error.message}`);
    }
}

async function gitCherryPick(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args.length === 0) {
            printError('fatal: missing commit to cherry-pick');
            printHint('Usage: git cherry-pick <commit>');
            printHint('Applies the changes from the specified commit to the current branch');
            return;
        }

        const ref = args[0];
        let targetOid;

        // Resolve the commit reference
        const headMatch = ref.match(/^HEAD~(\d+)$/);
        if (headMatch) {
            const n = parseInt(headMatch[1], 10);
            const commits = await git.log({ fs, dir, depth: n + 1 });
            if (commits.length <= n) {
                printError(`fatal: ${ref} does not exist`);
                return;
            }
            targetOid = commits[n].oid;
        } else {
            try {
                targetOid = await git.expandOid({ fs, dir, oid: ref });
            } catch (e) {
                printError(`fatal: bad revision '${ref}'`);
                return;
            }
        }

        // Get the commit to cherry-pick
        const commitToPick = await git.readCommit({ fs, dir, oid: targetOid });
        const parentOid = commitToPick.commit.parent[0];

        if (!parentOid) {
            printError('fatal: Cannot cherry-pick the initial commit');
            return;
        }

        // Get trees for both the commit and its parent to compute the diff
        const parentFiles = await flattenTree(dir, (await git.readCommit({ fs, dir, oid: parentOid })).commit.tree);
        const pickFiles = await flattenTree(dir, commitToPick.commit.tree);

        // Apply only the changed files (diff between parent and cherry-picked commit)
        const allPaths = new Set([...Object.keys(parentFiles), ...Object.keys(pickFiles)]);
        for (const filepath of allPaths) {
            const parentOidBlob = parentFiles[filepath];
            const pickOidBlob = pickFiles[filepath];

            if (parentOidBlob === pickOidBlob) continue; // No change in this file

            if (pickOidBlob && !parentOidBlob) {
                // File was added in the picked commit
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: pickOidBlob });
                    const content = new TextDecoder().decode(blob);
                    // Ensure parent directories exist
                    const parts = filepath.split('/');
                    if (parts.length > 1) {
                        const dirPath = `${dir}/${parts.slice(0, -1).join('/')}`;
                        try { await pfs.mkdir(dirPath, { recursive: true }); } catch (e) { }
                    }
                    await pfs.writeFile(`${dir}/${filepath}`, content, 'utf8');
                    await git.add({ fs, dir, filepath });
                } catch (e) { }
            } else if (!pickOidBlob && parentOidBlob) {
                // File was deleted in the picked commit
                try {
                    await pfs.unlink(`${dir}/${filepath}`);
                    await git.remove({ fs, dir, filepath });
                } catch (e) { }
            } else {
                // File was modified in the picked commit
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: pickOidBlob });
                    const content = new TextDecoder().decode(blob);
                    await pfs.writeFile(`${dir}/${filepath}`, content, 'utf8');
                    await git.add({ fs, dir, filepath });
                } catch (e) { }
            }
        }

        // Create new commit with the cherry-picked changes
        const author = await getAuthor(dir);
        const newOid = await git.commit({
            fs,
            dir,
            message: commitToPick.commit.message,
            author
        });

        const currentBranch = await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';
        const shortMessage = commitToPick.commit.message.split('\n')[0];
        printNormal(`[${currentBranch} ${newOid.substring(0, 7)}] ${shortMessage}`);
        printHint('Cherry-pick applies a commit from another branch to your current branch');
    } catch (error) {
        printError(`git cherry-pick failed: ${error.message}`);
    }
}

async function gitBlame(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        if (args.length === 0) {
            printError('fatal: no file specified');
            printHint('Usage: git blame <file>');
            return;
        }

        const filename = args[0];
        const filepath = filename.startsWith('/') ? filename : `${dir}/${filename}`;

        // Compute the file's path relative to the repo root
        let relFile = filepath;
        if (filepath.startsWith(dir)) {
            relFile = filepath.slice(dir.length);
            if (relFile.startsWith('/')) relFile = relFile.slice(1);
        }

        // Read the current file
        let content;
        try {
            content = await pfs.readFile(filepath, 'utf8');
        } catch (e) {
            printError(`fatal: no such file: ${filename}`);
            return;
        }

        const currentLines = content.split('\n');
        // Remove trailing empty element from a final newline
        if (currentLines.length > 0 && currentLines[currentLines.length - 1] === '') {
            currentLines.pop();
        }

        // Walk the commit history and do per-line blame tracking
        const commits = await git.log({ fs, dir });

        // For each line, find the commit that last changed it
        // Start by attributing every line to the most recent commit,
        // then walk backwards and re-attribute lines whose content
        // appeared identically in the parent commit (meaning a later
        // commit actually introduced the current text).
        const blameInfo = currentLines.map(() => (commits.length > 0 ? commits[0] : null));

        if (commits.length > 1) {
            try {
                // Build a map: for each commit that touches this file,
                // record its lines so we can compare.
                const commitFileLines = new Map();
                for (const commit of commits) {
                    try {
                        const result = await git.readBlob({ fs, dir, oid: commit.oid, filepath: relFile });
                        const text = new TextDecoder().decode(result.blob);
                        const lines = text.split('\n');
                        if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
                        commitFileLines.set(commit.oid, lines);
                    } catch {
                        // File didn't exist in this commit
                        commitFileLines.set(commit.oid, null);
                    }
                }

                // Walk commits from newest to oldest.  For each line
                // still attributed to commit[i], check if the same
                // line text exists in commit[i+1] (its parent in our
                // linear walk).  If so, push blame further back.
                for (let i = 0; i < commits.length - 1; i++) {
                    const curOid = commits[i].oid;
                    const parentOid = commits[i + 1].oid;
                    const curLines = commitFileLines.get(curOid);
                    const parentLines = commitFileLines.get(parentOid);

                    if (!curLines || !parentLines) continue;

                    for (let ln = 0; ln < currentLines.length; ln++) {
                        if (blameInfo[ln] && blameInfo[ln].oid === curOid) {
                            // If the line exists identically in the parent, attribute to parent
                            if (ln < parentLines.length && parentLines[ln] === currentLines[ln]) {
                                blameInfo[ln] = commits[i + 1];
                            }
                        }
                    }
                }
            } catch {
                // If per-line tracking fails, we still have the fallback
                // (all lines attributed to HEAD).
            }
        }

        // Format and output
        printNormal('');

        // Find max author name length for alignment (capped at 15)
        const maxAuthor = Math.min(15, blameInfo.reduce((max, c) => {
            const len = c ? c.commit.author.name.length : 7;
            return Math.max(max, len);
        }, 0));

        currentLines.forEach((line, index) => {
            const commit = blameInfo[index];
            const lineNum = String(index + 1).padStart(4);
            if (commit) {
                const shortOid = commit.oid.substring(0, 8);
                const author = commit.commit.author.name.substring(0, maxAuthor).padEnd(maxAuthor);
                const date = new Date(commit.commit.author.timestamp * 1000);
                const dateStr = date.toISOString().slice(0, 10);
                term.writeln(`\x1b[33m${shortOid}\x1b[0m (${author} ${dateStr} ${lineNum}) ${line}`);
            } else {
                const oid = '00000000';
                const author = 'Unknown'.padEnd(maxAuthor);
                term.writeln(`\x1b[33m${oid}\x1b[0m (${author}            ${lineNum}) ${line}`);
            }
        });

        printNormal('');
        printHint('Blame shows who last modified each line of a file');
    } catch (error) {
        printError(`git blame failed: ${error.message}`);
    }
}

// File tree management
async function updateFileTree() {
    const treeContainer = document.getElementById('fileTree');
    const currentDirDisplay = document.getElementById('currentDir');
    treeContainer.innerHTML = '';

    // Update current directory display
    const displayDir = currentDir.replace('/home/student', '~');
    currentDirDisplay.textContent = `📁 ${displayDir}`;

    try {
        const tree = await buildFileTree('/home/student');
        treeContainer.innerHTML = tree;

        // Add click handlers to files
        const clickableFiles = treeContainer.querySelectorAll('.clickable-file');
        clickableFiles.forEach(fileElement => {
            fileElement.addEventListener('click', async () => {
                const filepath = fileElement.getAttribute('data-filepath');
                const filename = filepath.split('/').pop();

                // Echo the command to terminal
                term.write(`edit ${filename}`);

                try {
                    const content = await pfs.readFile(filepath, 'utf8');
                    editorFile = filepath;
                    editorOriginalContent = content;
                    openEditor(filename, content);
                    term.writeln('\r\n');
                    printHint(`Opened ${filename} in editor. Edit and use Ctrl+S to save, Ctrl+X to close.`);
                } catch (error) {
                    printError(`Error opening file: ${error.message}`);
                }
            });
        });

        // Add click handlers to directories
        const clickableDirs = treeContainer.querySelectorAll('.clickable-dir');
        clickableDirs.forEach(dirElement => {
            dirElement.addEventListener('click', async () => {
                const dirpath = dirElement.getAttribute('data-dirpath');

                // Echo the cd command to terminal
                term.write(`cd ${dirpath.replace('/home/student', '~')}`);

                previousDir = currentDir;
                currentDir = dirpath;
                await updateFileTree();
                showPrompt();
            });
        });

        // Update cached branch name for prompt
        try {
            const gitDir = await git.findRoot({ fs, filepath: currentDir });
            promptBranch = await git.currentBranch({ fs, dir: gitDir }) || '';
        } catch (e) {
            promptBranch = '';
        }
    } catch (error) {
        treeContainer.innerHTML = `<div style="color: #f44;">Error loading file tree</div>`;
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function buildFileTree(path, indent = 0) {
    let html = '';

    try {
        const files = await pfs.readdir(path);
        const fileInfos = await Promise.all(files.map(async (file) => {
            const fullPath = `${path}/${file}`;
            const stats = await pfs.stat(fullPath);
            return {
                name: file,
                path: fullPath,
                isDirectory: stats.isDirectory(),
                isHidden: file.startsWith('.')
            };
        }));

        // Sort: directories first, then files
        fileInfos.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        for (const file of fileInfos) {
            const indentStr = '&nbsp;'.repeat(indent * 4);
            const hiddenClass = file.isHidden ? (file.isDirectory ? 'hidden-folder' : 'hidden-file') : '';
            const safeName = escapeHtml(file.name);
            const safePath = escapeHtml(file.path);

            if (file.isDirectory) {
                // Don't show contents of .git folder
                html += `<div class="tree-folder ${hiddenClass} clickable-dir" data-dirpath="${safePath}" style="margin-left: ${indent * 15}px; cursor: pointer;">`;
                html += `<span class="folder-icon"></span>${safeName}/`;
                html += `</div>`;
                if (file.name !== '.git') {
                    html += await buildFileTree(file.path, indent + 1);
                }
            } else {
                html += `<div class="tree-file ${hiddenClass} clickable-file" data-filepath="${safePath}" style="margin-left: ${indent * 15}px">`;
                html += `<span class="file-icon"></span>${safeName}`;
                html += `</div>`;
            }
        }
    } catch (error) {
        // Ignore errors for individual files
    }

    return html;
}

// Helper function to detect file mode from extension
function getEditorMode(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const modeMap = {
        'html': 'htmlmixed',
        'htm': 'htmlmixed',
        'css': 'css',
        'js': 'javascript',
        'json': 'javascript',
        'md': 'markdown',
        'markdown': 'markdown',
        'py': 'python',
        'sh': 'shell',
        'bash': 'shell',
        'xml': 'xml',
        'txt': 'text'
    };
    return modeMap[ext] || 'text';
}

// Editor management
function openEditor(filename, content) {
    const editorContainer = document.getElementById('editorContainer');
    const editorTitle = document.getElementById('editorTitle');
    let editorElement = document.getElementById('editor');

    editorTitle.textContent = `Editing: ${filename}`;

    // If CodeMirror instance exists, just update it
    if (codeMirrorInstance) {
        codeMirrorInstance.setValue(content);
        codeMirrorInstance.setOption('mode', getEditorMode(filename));
        editorContainer.classList.remove('hidden');
        codeMirrorInstance.refresh();
        setTimeout(() => codeMirrorInstance.refresh(), 10);
        codeMirrorInstance.focus();
        return;
    }

    // Create new CodeMirror instance
    codeMirrorInstance = CodeMirror(function (elt) {
        editorElement.parentNode.replaceChild(elt, editorElement);
    }, {
        value: content,
        mode: getEditorMode(filename),
        theme: 'dracula',
        lineNumbers: true,
        lineWrapping: true,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        autoCloseBrackets: true,
        matchBrackets: true,
        extraKeys: {
            'Ctrl-S': function () {
                saveEditor();
            },
            'Ctrl-X': function () {
                closeEditor();
            }
        }
    });

    editorContainer.classList.remove('hidden');
    // Force refresh after showing
    setTimeout(() => {
        codeMirrorInstance.refresh();
        codeMirrorInstance.focus();
    }, 10);
}

function closeEditor() {
    const editorContainer = document.getElementById('editorContainer');

    // Clear commit message mode flags if still set
    isCommitMessageMode = false;
    commitMessageDir = null;

    // Just hide the editor, don't destroy CodeMirror instance
    editorContainer.classList.add('hidden');
    editorFile = null;
    editorOriginalContent = '';
    showPrompt();
    term.focus();
}

async function saveEditor() {
    if (!codeMirrorInstance) return;

    // Check if we're in commit message mode
    if (isCommitMessageMode && commitMessageDir) {
        await saveCommitMessage(commitMessageDir);
        return;
    }

    const content = codeMirrorInstance.getValue();

    try {
        await pfs.writeFile(editorFile, content, 'utf8');
        printHint('File saved successfully. Changes are now in your working directory.');
        printHint('Use "git status" to stage the changes, or "git diff" to see what changed.');
        await updateFileTree();
    } catch (error) {
        printError(`Error saving file: ${error.message}`);
    }
}

// Editor event handlers
document.getElementById('saveEditor').addEventListener('click', async () => {
    await saveEditor();
});

document.getElementById('closeEditor').addEventListener('click', () => {
    closeEditor();
});

// Tab completion
// Helper function to find common prefix among matches
function getCommonPrefix(matches) {
    if (matches.length === 0) return '';
    if (matches.length === 1) return matches[0];

    let prefix = matches[0];
    for (let i = 1; i < matches.length; i++) {
        let j = 0;
        while (j < prefix.length && j < matches[i].length && prefix[j] === matches[i][j]) {
            j++;
        }
        prefix = prefix.substring(0, j);
        if (prefix === '') break;
    }
    return prefix;
}

async function handleTabCompletion() {
    const parts = currentLine.split(/\s+/);
    const lastPart = parts[parts.length - 1];

    // Command completion (if it's the first word)
    if (parts.length === 1) {
        const commands = ['help', 'ls', 'll', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'echo', 'clear', 'reset', 'history', 'grep', 'head', 'tail', 'wc', 'find', 'diff', 'sort', 'uniq', 'whoami', 'hostname', 'date', 'env', 'printenv', 'export', 'vi', 'vim', 'nano', 'edit', 'git', 'which', 'type', 'hints', 'true', 'false', 'man', 'sudo'];
        const matches = commands.filter(cmd => cmd.startsWith(lastPart));

        if (matches.length === 1) {
            const completion = matches[0].substring(lastPart.length);
            currentLine += completion + ' ';
            cursorPos = currentLine.length;
            term.write(completion + ' ');
        } else if (matches.length > 1) {
            // Find common prefix and auto-complete it
            const commonPrefix = getCommonPrefix(matches);
            if (commonPrefix.length > lastPart.length) {
                const completion = commonPrefix.substring(lastPart.length);
                currentLine += completion;
                cursorPos = currentLine.length;
                term.write(completion);
            } else {
                // No additional common prefix, show all matches
                term.write('\r\n');
                term.writeln(matches.join('  '));
                showPromptInline();
                term.write(currentLine);
            }
        }
        return;
    }

    // Git subcommand completion
    if (parts.length === 2 && parts[0] === 'git') {
        const gitCommands = ['init', 'status', 'add', 'commit', 'log', 'branch', 'checkout', 'switch', 'restore', 'diff', 'reset', 'rm', 'mv', 'merge', 'tag', 'show', 'fetch', 'stash', 'config', 'clone', 'push', 'pull', 'remote', 'rebase', 'cherry-pick', 'revert', 'reflog', 'blame', 'clean'];
        const matches = gitCommands.filter(cmd => cmd.startsWith(lastPart));

        if (matches.length === 1) {
            const completion = matches[0].substring(lastPart.length);
            currentLine += completion + ' ';
            cursorPos = currentLine.length;
            term.write(completion + ' ');
        } else if (matches.length > 1) {
            const commonPrefix = getCommonPrefix(matches);
            if (commonPrefix.length > lastPart.length) {
                const completion = commonPrefix.substring(lastPart.length);
                currentLine += completion;
                cursorPos = currentLine.length;
                term.write(completion);
            } else {
                term.write('\r\n');
                term.writeln(matches.join('  '));
                showPromptInline();
                term.write(currentLine);
            }
        }
        return;
    }

    // Branch name completion for git commands that take branch arguments
    const branchCommands = ['checkout', 'merge', 'rebase', 'branch', 'switch'];
    if (parts[0] === 'git' && parts.length >= 3 && branchCommands.includes(parts[1])) {
        try {
            const dir = await git.findRoot({ fs, filepath: currentDir });
            const branches = await git.listBranches({ fs, dir });
            const matches = branches.filter(b => b.startsWith(lastPart));

            if (matches.length === 1) {
                const completion = matches[0].substring(lastPart.length);
                currentLine += completion + ' ';
                cursorPos = currentLine.length;
                term.write(completion + ' ');
            } else if (matches.length > 1) {
                const commonPrefix = getCommonPrefix(matches);
                if (commonPrefix.length > lastPart.length) {
                    const completion = commonPrefix.substring(lastPart.length);
                    currentLine += completion;
                    cursorPos = currentLine.length;
                    term.write(completion);
                } else {
                    term.write('\r\n');
                    term.writeln(matches.join('  '));
                    showPromptInline();
                    term.write(currentLine);
                }
            }
            return;
        } catch (e) {
            // Not in a git repo, fall through to file completion
        }
    }

    // File/directory completion
    try {
        const files = await pfs.readdir(currentDir);

        // Add special directory entries . and ..
        const allEntries = ['.', '..', ...files];
        const matches = allEntries.filter(file => file.startsWith(lastPart));

        if (matches.length === 1) {
            const completion = matches[0].substring(lastPart.length);
            let suffix = ' ';

            // Determine if it's a directory and add appropriate suffix
            if (matches[0] === '.' || matches[0] === '..') {
                suffix = '/';
            } else {
                const fullPath = `${currentDir}/${matches[0]}`;
                const stats = await pfs.stat(fullPath);
                suffix = stats.isDirectory() ? '/' : ' ';
            }

            currentLine = currentLine.substring(0, currentLine.length - lastPart.length) + matches[0] + suffix;
            cursorPos = currentLine.length;
            term.write('\r\x1b[K');
            showPromptInline();
            term.write(currentLine);
        } else if (matches.length > 1) {
            // Find common prefix and auto-complete it
            const commonPrefix = getCommonPrefix(matches);
            if (commonPrefix.length > lastPart.length) {
                const completion = commonPrefix.substring(lastPart.length);
                currentLine = currentLine.substring(0, currentLine.length - lastPart.length) + commonPrefix;
                cursorPos = currentLine.length;
                term.write('\r\x1b[K');
                showPromptInline();
                term.write(currentLine);
            } else {
                // No additional common prefix, show all matches
                term.write('\r\n');
                term.writeln(matches.join('  '));
                showPromptInline();
                term.write(currentLine);
            }
        }
    } catch (error) {
        // Ignore completion errors
    }
}

// Reverse search functions
function startReverseSearch() {
    hidePreview();
    if (commandHistory.length === 0) {
        // No history available
        term.write('\r\x1b[K');
        term.write('\x1b[31m(no history available)\x1b[0m');
        setTimeout(() => {
            term.write('\r\x1b[K');
            showPromptInline();
            term.write(currentLine);
        }, 1000);
        return;
    }

    reverseSearchMode = true;
    reverseSearchQuery = '';
    reverseSearchIndex = commandHistory.length;
    savedLine = currentLine;
    currentLine = '';
    cursorPos = 0;
    updateReverseSearchPrompt();
}

function updateReverseSearchPrompt(failed = false) {
    term.write('\r\x1b[K');
    if (failed) {
        term.write(`\x1b[31m(failed reverse-i-search)\`${reverseSearchQuery}': \x1b[0m${currentLine}`);
    } else {
        term.write(`\x1b[33m(reverse-i-search)\`${reverseSearchQuery}': \x1b[0m${currentLine}`);
    }
}

function exitReverseSearch(accept = true) {
    reverseSearchMode = false;
    if (!accept) {
        currentLine = savedLine;
        cursorPos = savedLine.length;
    } else {
        cursorPos = currentLine.length;
    }
    term.write('\r\x1b[K');
    showPromptInline();
    term.write(currentLine);
}

function searchHistoryReverse() {
    // Empty query - show most recent command (or next on subsequent Ctrl+R presses)
    if (reverseSearchQuery === '') {
        if (reverseSearchIndex > 0) {
            reverseSearchIndex--;
            currentLine = commandHistory[reverseSearchIndex];
            updateReverseSearchPrompt(false);
        } else {
            // Already at the beginning, stay at first command
            reverseSearchIndex = 0;
            currentLine = commandHistory[0];
            updateReverseSearchPrompt(false);
        }
        return;
    }

    // Search backwards through history with query
    for (let i = reverseSearchIndex - 1; i >= 0; i--) {
        if (commandHistory[i].toLowerCase().includes(reverseSearchQuery.toLowerCase())) {
            reverseSearchIndex = i;
            currentLine = commandHistory[i];
            updateReverseSearchPrompt(false);
            return;
        }
    }

    // Wrap around to end
    for (let i = commandHistory.length - 1; i > reverseSearchIndex; i--) {
        if (commandHistory[i].toLowerCase().includes(reverseSearchQuery.toLowerCase())) {
            reverseSearchIndex = i;
            currentLine = commandHistory[i];
            updateReverseSearchPrompt(false);
            return;
        }
    }

    // No match found - show failed search indicator
    currentLine = '';
    updateReverseSearchPrompt(true);
}

// Word navigation helpers
function findPreviousWordBoundary(line, pos) {
    if (pos <= 0) return 0;
    let i = pos - 1;
    // Skip any trailing spaces
    while (i > 0 && line[i] === ' ') i--;
    // Skip the current word
    while (i > 0 && line[i - 1] !== ' ') i--;
    return i;
}

function findNextWordBoundary(line, pos) {
    if (pos >= line.length) return line.length;
    let i = pos;
    // Skip current word
    while (i < line.length && line[i] !== ' ') i++;
    // Skip spaces
    while (i < line.length && line[i] === ' ') i++;
    return i;
}

// Redraw the current line from the start
function redrawLine() {
    term.write('\r\x1b[K');
    showPromptInline();
    term.write(currentLine);
    // Move cursor to correct position
    const moveBack = currentLine.length - cursorPos;
    if (moveBack > 0) {
        term.write('\x1b[' + moveBack + 'D');
    }
    schedulePreviewUpdate();
}

// Kill ring helpers
function pushToKillRing(text) {
    if (text) {
        killRing.push(text);
        if (killRing.length > MAX_KILL_RING_SIZE) {
            killRing.shift();
        }
    }
}

function yankFromKillRing() {
    return killRing.length > 0 ? killRing[killRing.length - 1] : '';
}

// Undo helpers
function saveUndoState() {
    undoHistory.push({ line: currentLine, pos: cursorPos });
    if (undoHistory.length > MAX_UNDO_HISTORY) {
        undoHistory.shift();
    }
}

function restoreUndoState() {
    if (undoHistory.length > 0) {
        const state = undoHistory.pop();
        currentLine = state.line;
        cursorPos = state.pos;
        redrawLine();
        return true;
    }
    return false;
}

// Forward search functions
function startForwardSearch() {
    hidePreview();
    if (commandHistory.length === 0) {
        term.write('\r\x1b[K');
        term.write('\x1b[31m(no history available)\x1b[0m');
        setTimeout(() => {
            term.write('\r\x1b[K');
            showPromptInline();
            term.write(currentLine);
        }, 1000);
        return;
    }

    forwardSearchMode = true;
    forwardSearchQuery = '';
    forwardSearchIndex = -1;
    savedLine = currentLine;
    currentLine = '';
    cursorPos = 0;
    updateForwardSearchPrompt();
}

function updateForwardSearchPrompt(failed = false) {
    term.write('\r\x1b[K');
    if (failed) {
        term.write(`\x1b[31m(failed i-search)\`${forwardSearchQuery}': \x1b[0m${currentLine}`);
    } else {
        term.write(`\x1b[33m(i-search)\`${forwardSearchQuery}': \x1b[0m${currentLine}`);
    }
}

function exitForwardSearch(accept = true) {
    forwardSearchMode = false;
    if (!accept) {
        currentLine = savedLine;
        cursorPos = savedLine.length;
    } else {
        cursorPos = currentLine.length;
    }
    term.write('\r\x1b[K');
    showPromptInline();
    term.write(currentLine);
}

function searchHistoryForward() {
    // Empty query - show next command (or previous on subsequent Ctrl+S presses)
    if (forwardSearchQuery === '') {
        if (forwardSearchIndex < commandHistory.length - 1) {
            forwardSearchIndex++;
            currentLine = commandHistory[forwardSearchIndex];
            updateForwardSearchPrompt(false);
        } else {
            // Already at the end
            forwardSearchIndex = commandHistory.length - 1;
            if (commandHistory.length > 0) {
                currentLine = commandHistory[forwardSearchIndex];
            }
            updateForwardSearchPrompt(false);
        }
        return;
    }

    // Search forwards through history with query
    for (let i = forwardSearchIndex + 1; i < commandHistory.length; i++) {
        if (commandHistory[i].toLowerCase().includes(forwardSearchQuery.toLowerCase())) {
            forwardSearchIndex = i;
            currentLine = commandHistory[i];
            updateForwardSearchPrompt(false);
            return;
        }
    }

    // Wrap around to beginning
    for (let i = 0; i < forwardSearchIndex; i++) {
        if (commandHistory[i].toLowerCase().includes(forwardSearchQuery.toLowerCase())) {
            forwardSearchIndex = i;
            currentLine = commandHistory[i];
            updateForwardSearchPrompt(false);
            return;
        }
    }

    // No match found
    currentLine = '';
    updateForwardSearchPrompt(true);
}

// Word case manipulation helpers
function findWordEnd(line, pos) {
    let i = pos;
    // Skip to start of word if in whitespace
    while (i < line.length && line[i] === ' ') i++;
    // Find end of word
    while (i < line.length && line[i] !== ' ') i++;
    return i;
}

function uppercaseWord() {
    if (cursorPos >= currentLine.length) return;
    saveUndoState();
    const wordEnd = findWordEnd(currentLine, cursorPos);
    const before = currentLine.slice(0, cursorPos);
    const word = currentLine.slice(cursorPos, wordEnd).toUpperCase();
    const after = currentLine.slice(wordEnd);
    currentLine = before + word + after;
    cursorPos = wordEnd;
    redrawLine();
}

function lowercaseWord() {
    if (cursorPos >= currentLine.length) return;
    saveUndoState();
    const wordEnd = findWordEnd(currentLine, cursorPos);
    const before = currentLine.slice(0, cursorPos);
    const word = currentLine.slice(cursorPos, wordEnd).toLowerCase();
    const after = currentLine.slice(wordEnd);
    currentLine = before + word + after;
    cursorPos = wordEnd;
    redrawLine();
}

function capitalizeWord() {
    if (cursorPos >= currentLine.length) return;
    saveUndoState();
    let i = cursorPos;
    // Skip whitespace
    while (i < currentLine.length && currentLine[i] === ' ') i++;
    if (i >= currentLine.length) return;

    const wordEnd = findWordEnd(currentLine, i);
    const before = currentLine.slice(0, i);
    const firstChar = currentLine[i].toUpperCase();
    const rest = currentLine.slice(i + 1, wordEnd).toLowerCase();
    const after = currentLine.slice(wordEnd);
    currentLine = before + firstChar + rest + after;
    cursorPos = wordEnd;
    redrawLine();
}

// Transpose characters
function transposeChars() {
    if (currentLine.length < 2) return;
    saveUndoState();

    let pos = cursorPos;
    // If at end of line, swap the last two characters
    if (pos >= currentLine.length) {
        pos = currentLine.length;
    }
    // If at beginning, can't transpose
    if (pos < 1) return;

    // If at position 1 or greater but not at end, swap char before cursor with char at cursor
    // If at end, swap the two chars before cursor
    let swapPos = pos;
    if (pos >= currentLine.length) {
        swapPos = pos - 1;
    }

    const before = currentLine.slice(0, swapPos - 1);
    const char1 = currentLine[swapPos - 1];
    const char2 = currentLine[swapPos] || '';
    const after = currentLine.slice(swapPos + 1);

    if (char2) {
        currentLine = before + char2 + char1 + after;
        cursorPos = swapPos + 1;
    } else {
        // At end, swap last two
        currentLine = before + char1;
        cursorPos = pos;
    }
    redrawLine();
}

// Transpose words
function transposeWords() {
    if (cursorPos === 0 || currentLine.trim().split(/\s+/).length < 2) return;
    saveUndoState();

    // Find the current word boundaries
    let wordStart = cursorPos;
    let wordEnd = cursorPos;

    // Go back to find current word start
    while (wordStart > 0 && currentLine[wordStart - 1] !== ' ') wordStart--;
    // Go forward to find current word end
    while (wordEnd < currentLine.length && currentLine[wordEnd] !== ' ') wordEnd++;

    // Find previous word
    let prevEnd = wordStart;
    while (prevEnd > 0 && currentLine[prevEnd - 1] === ' ') prevEnd--;
    let prevStart = prevEnd;
    while (prevStart > 0 && currentLine[prevStart - 1] !== ' ') prevStart--;

    if (prevEnd === 0) return; // No previous word

    const word1 = currentLine.slice(prevStart, prevEnd);
    const separator = currentLine.slice(prevEnd, wordStart);
    const word2 = currentLine.slice(wordStart, wordEnd);

    currentLine = currentLine.slice(0, prevStart) + word2 + separator + word1 + currentLine.slice(wordEnd);
    cursorPos = prevStart + word2.length + separator.length + word1.length;
    redrawLine();
}

// Get last argument from previous command
function getLastArgument() {
    if (commandHistory.length === 0) return '';
    const lastCmd = commandHistory[commandHistory.length - 1];
    const parts = lastCmd.trim().split(/\s+/);
    return parts.length > 0 ? parts[parts.length - 1] : '';
}

// Terminal input handling
async function handleTermInput(data) {
    const code = data.charCodeAt(0);

    // Ctrl+R - Reverse search
    if (code === 18) { // Ctrl+R
        if (reverseSearchMode) {
            searchHistoryReverse();
        } else if (forwardSearchMode) {
            // Switch from forward to reverse search
            exitForwardSearch(false);
            startReverseSearch();
        } else {
            startReverseSearch();
        }
        return;
    }

    // Ctrl+S - Forward search
    if (code === 19) { // Ctrl+S
        if (forwardSearchMode) {
            searchHistoryForward();
        } else if (reverseSearchMode) {
            // Switch from reverse to forward search
            exitReverseSearch(false);
            startForwardSearch();
        } else {
            startForwardSearch();
        }
        return;
    }

    // Ctrl+G - Abort (cancel current operation)
    if (code === 7) { // Ctrl+G
        if (reverseSearchMode) {
            exitReverseSearch(false);
        } else if (forwardSearchMode) {
            exitForwardSearch(false);
        } else {
            term.write('^G\r\n');
            currentLine = '';
            cursorPos = 0;
            showPrompt();
        }
        return;
    }

    // Ctrl+C or Escape - Exit search modes
    if ((code === 3 || code === 27) && (reverseSearchMode || forwardSearchMode)) {
        if (reverseSearchMode) exitReverseSearch(false);
        if (forwardSearchMode) exitForwardSearch(false);
        return;
    }

    // Handle reverse search mode
    if (reverseSearchMode) {
        if (code === 13) { // Enter - accept current match
            exitReverseSearch(true);
            term.write('\r\n');
            await processCommand(currentLine);
            currentLine = '';
            cursorPos = 0;
            return;
        } else if (code === 127) { // Backspace in search
            if (reverseSearchQuery.length > 0) {
                reverseSearchQuery = reverseSearchQuery.slice(0, -1);
                reverseSearchIndex = commandHistory.length;
                currentLine = '';
                searchHistoryReverse();
            }
            return;
        } else if (code >= 32 && code <= 126) { // Add to search query
            reverseSearchQuery += data;
            reverseSearchIndex = commandHistory.length;
            searchHistoryReverse();
            return;
        }
        return;
    }

    // Handle forward search mode
    if (forwardSearchMode) {
        if (code === 13) { // Enter - accept current match
            exitForwardSearch(true);
            term.write('\r\n');
            await processCommand(currentLine);
            currentLine = '';
            cursorPos = 0;
            return;
        } else if (code === 127) { // Backspace in search
            if (forwardSearchQuery.length > 0) {
                forwardSearchQuery = forwardSearchQuery.slice(0, -1);
                forwardSearchIndex = -1;
                currentLine = '';
                searchHistoryForward();
            }
            return;
        } else if (code >= 32 && code <= 126) { // Add to search query
            forwardSearchQuery += data;
            forwardSearchIndex = -1;
            searchHistoryForward();
            return;
        }
        return;
    }

    // Handle quoted insert mode (Ctrl+V)
    if (quotedInsertMode) {
        quotedInsertMode = false;
        saveUndoState();
        // Insert the character literally, including control characters
        currentLine = currentLine.slice(0, cursorPos) + data + currentLine.slice(cursorPos);
        cursorPos++;
        redrawLine();
        return;
    }

    // Handle Ctrl key combinations (codes 1-26 correspond to Ctrl+A through Ctrl+Z)
    // Ctrl+A - Move to beginning of line
    if (code === 1) {
        if (cursorPos > 0) {
            cursorPos = 0;
            redrawLine();
        }
        return;
    }

    // Ctrl+E - Move to end of line
    if (code === 5) {
        if (cursorPos < currentLine.length) {
            cursorPos = currentLine.length;
            redrawLine();
        }
        return;
    }

    // Ctrl+K - Kill (delete) from cursor to end of line
    if (code === 11) {
        if (cursorPos < currentLine.length) {
            saveUndoState();
            const killed = currentLine.slice(cursorPos);
            pushToKillRing(killed);
            currentLine = currentLine.slice(0, cursorPos);
            redrawLine();
        }
        return;
    }

    // Ctrl+U - Kill (delete) from cursor to beginning of line
    if (code === 21) {
        if (cursorPos > 0) {
            saveUndoState();
            const killed = currentLine.slice(0, cursorPos);
            pushToKillRing(killed);
            currentLine = currentLine.slice(cursorPos);
            cursorPos = 0;
            redrawLine();
        }
        return;
    }

    // Ctrl+W - Delete previous word
    if (code === 23) {
        if (cursorPos > 0) {
            saveUndoState();
            const newPos = findPreviousWordBoundary(currentLine, cursorPos);
            const killed = currentLine.slice(newPos, cursorPos);
            pushToKillRing(killed);
            currentLine = currentLine.slice(0, newPos) + currentLine.slice(cursorPos);
            cursorPos = newPos;
            redrawLine();
        }
        return;
    }

    // Ctrl+L - Clear screen
    if (code === 12) {
        term.clear();
        showPromptInline();
        term.write(currentLine);
        const moveBack = currentLine.length - cursorPos;
        if (moveBack > 0) {
            term.write('\x1b[' + moveBack + 'D');
        }
        return;
    }

    // Ctrl+C - Cancel current line (when not in reverse search mode)
    if (code === 3) {
        hidePreview();
        term.write('^C\r\n');
        currentLine = '';
        cursorPos = 0;
        historyIndex = commandHistory.length;
        showPrompt();
        return;
    }

    // Ctrl+D - Delete character under cursor (or exit if line is empty)
    if (code === 4) {
        if (currentLine.length === 0) {
            // Could handle "exit" here, but for now just ignore
            return;
        }
        if (cursorPos < currentLine.length) {
            currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
            redrawLine();
        }
        return;
    }

    // Ctrl+B - Move cursor back (like left arrow)
    if (code === 2) {
        if (cursorPos > 0) {
            cursorPos--;
            term.write('\x1b[D');
        }
        return;
    }

    // Ctrl+F - Move cursor forward (like right arrow)
    if (code === 6) {
        if (cursorPos < currentLine.length) {
            cursorPos++;
            term.write('\x1b[C');
        }
        return;
    }

    // Ctrl+P - Previous history (like up arrow)
    if (code === 16) {
        if (historyIndex > 0) {
            historyIndex--;
            currentLine = commandHistory[historyIndex] || '';
            cursorPos = currentLine.length;
            redrawLine();
        }
        return;
    }

    // Ctrl+N - Next history (like down arrow)
    if (code === 14) {
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
            currentLine = commandHistory[historyIndex] || '';
        } else {
            historyIndex = commandHistory.length;
            currentLine = '';
        }
        cursorPos = currentLine.length;
        redrawLine();
        return;
    }

    // Ctrl+T - Transpose characters
    if (code === 20) {
        transposeChars();
        return;
    }

    // Ctrl+Y - Yank (paste) from kill ring
    if (code === 25) {
        const yanked = yankFromKillRing();
        if (yanked) {
            saveUndoState();
            currentLine = currentLine.slice(0, cursorPos) + yanked + currentLine.slice(cursorPos);
            cursorPos += yanked.length;
            redrawLine();
        }
        return;
    }

    // Ctrl+_ or Ctrl+/ - Undo
    if (code === 31) {
        restoreUndoState();
        return;
    }

    // Ctrl+H - Same as backspace
    if (code === 8) {
        if (cursorPos > 0) {
            saveUndoState();
            currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
            cursorPos--;
            redrawLine();
        }
        return;
    }

    // Ctrl+J - Same as Enter (line feed)
    if (code === 10) {
        hidePreview();
        term.write('\r\n');
        await processCommand(currentLine);
        currentLine = '';
        cursorPos = 0;
        undoHistory = [];
        return;
    }

    // Ctrl+V - Quoted insert (insert next char literally)
    if (code === 22) {
        quotedInsertMode = true;
        return;
    }

    // Handle special keys
    if (code === 13) { // Enter
        hidePreview();
        term.write('\r\n');
        await processCommand(currentLine);
        currentLine = '';
        cursorPos = 0;
    } else if (code === 9) { // Tab - autocomplete
        await handleTabCompletion();
    } else if (code === 127) { // Backspace
        if (cursorPos > 0) {
            currentLine = currentLine.slice(0, cursorPos - 1) + currentLine.slice(cursorPos);
            cursorPos--;
            // Move cursor back, redraw rest of line with space at end, then reposition cursor
            const restOfLine = currentLine.slice(cursorPos);
            term.write('\b' + restOfLine + ' ');
            const moveBack = restOfLine.length + 1;
            if (moveBack > 0) {
                term.write('\x1b[' + moveBack + 'D');
            }
            schedulePreviewUpdate();
        }
    } else if (code === 27) { // Escape sequences (arrow keys, special keys)
        // Up arrow
        if (data === '\x1b[A') {
            if (historyIndex > 0) {
                historyIndex--;
                currentLine = commandHistory[historyIndex] || '';
                cursorPos = currentLine.length;
                redrawLine();
            }
            // Down arrow
        } else if (data === '\x1b[B') {
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                currentLine = commandHistory[historyIndex] || '';
            } else {
                historyIndex = commandHistory.length;
                currentLine = '';
            }
            cursorPos = currentLine.length;
            redrawLine();
            // Right arrow
        } else if (data === '\x1b[C') {
            if (cursorPos < currentLine.length) {
                cursorPos++;
                term.write('\x1b[C');
            }
            // Left arrow
        } else if (data === '\x1b[D') {
            if (cursorPos > 0) {
                cursorPos--;
                term.write('\x1b[D');
            }
            // Ctrl+Right arrow - move to next word
        } else if (data === '\x1b[1;5C') {
            const newPos = findNextWordBoundary(currentLine, cursorPos);
            if (newPos !== cursorPos) {
                cursorPos = newPos;
                redrawLine();
            }
            // Ctrl+Left arrow - move to previous word
        } else if (data === '\x1b[1;5D') {
            const newPos = findPreviousWordBoundary(currentLine, cursorPos);
            if (newPos !== cursorPos) {
                cursorPos = newPos;
                redrawLine();
            }
            // Alt+Right arrow (alternative word navigation)
        } else if (data === '\x1b[1;3C' || data === '\x1bf') {
            const newPos = findNextWordBoundary(currentLine, cursorPos);
            if (newPos !== cursorPos) {
                cursorPos = newPos;
                redrawLine();
            }
            // Alt+Left arrow (alternative word navigation)
        } else if (data === '\x1b[1;3D' || data === '\x1bb') {
            const newPos = findPreviousWordBoundary(currentLine, cursorPos);
            if (newPos !== cursorPos) {
                cursorPos = newPos;
                redrawLine();
            }
            // Home key
        } else if (data === '\x1b[H' || data === '\x1bOH' || data === '\x1b[1~') {
            if (cursorPos > 0) {
                cursorPos = 0;
                redrawLine();
            }
            // End key
        } else if (data === '\x1b[F' || data === '\x1bOF' || data === '\x1b[4~') {
            if (cursorPos < currentLine.length) {
                cursorPos = currentLine.length;
                redrawLine();
            }
            // Delete key
        } else if (data === '\x1b[3~') {
            if (cursorPos < currentLine.length) {
                currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(cursorPos + 1);
                redrawLine();
            }
            // Ctrl+Delete - delete word forward
        } else if (data === '\x1b[3;5~') {
            if (cursorPos < currentLine.length) {
                const endPos = findNextWordBoundary(currentLine, cursorPos);
                currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(endPos);
                redrawLine();
            }
            // Alt+D - delete word forward (readline style)
        } else if (data === '\x1bd') {
            if (cursorPos < currentLine.length) {
                saveUndoState();
                const endPos = findNextWordBoundary(currentLine, cursorPos);
                const killed = currentLine.slice(cursorPos, endPos);
                pushToKillRing(killed);
                currentLine = currentLine.slice(0, cursorPos) + currentLine.slice(endPos);
                redrawLine();
            }
            // Alt+Backspace - delete word backward
        } else if (data === '\x1b\x7f') {
            if (cursorPos > 0) {
                saveUndoState();
                const newPos = findPreviousWordBoundary(currentLine, cursorPos);
                const killed = currentLine.slice(newPos, cursorPos);
                pushToKillRing(killed);
                currentLine = currentLine.slice(0, newPos) + currentLine.slice(cursorPos);
                cursorPos = newPos;
                redrawLine();
            }
            // Alt+U - Uppercase word
        } else if (data === '\x1bu') {
            uppercaseWord();
            // Alt+L - Lowercase word
        } else if (data === '\x1bl') {
            lowercaseWord();
            // Alt+C - Capitalize word
        } else if (data === '\x1bc') {
            capitalizeWord();
            // Alt+T - Transpose words
        } else if (data === '\x1bt') {
            transposeWords();
            // Alt+. or Alt+_ - Insert last argument from previous command
        } else if (data === '\x1b.' || data === '\x1b_') {
            const lastArg = getLastArgument();
            if (lastArg) {
                saveUndoState();
                currentLine = currentLine.slice(0, cursorPos) + lastArg + currentLine.slice(cursorPos);
                cursorPos += lastArg.length;
                redrawLine();
            }
            // Alt+< - Go to beginning of history
        } else if (data === '\x1b<') {
            if (commandHistory.length > 0) {
                historyIndex = 0;
                currentLine = commandHistory[0];
                cursorPos = currentLine.length;
                redrawLine();
            }
            // Alt+> - Go to end of history (current line)
        } else if (data === '\x1b>') {
            historyIndex = commandHistory.length;
            currentLine = '';
            cursorPos = 0;
            redrawLine();
        }
    } else if (code >= 32 && code <= 126) { // Printable characters
        currentLine = currentLine.slice(0, cursorPos) + data + currentLine.slice(cursorPos);
        cursorPos++;
        // Redraw the line from cursor position
        const restOfLine = currentLine.slice(cursorPos - 1);
        term.write(restOfLine);
        // Move cursor back to correct position
        const moveBack = restOfLine.length - 1;
        if (moveBack > 0) {
            term.write('\x1b[' + moveBack + 'D');
        }
        schedulePreviewUpdate();
    }
}

term.onData(async (data) => {
    // Handle special escape sequences as a single unit
    if (data.length > 1 && data.charCodeAt(0) === 27) {
        await handleTermInput(data);
        return;
    }

    // Handle character by character (supports paste)
    for (const char of data) {
        // Normalize newlines to Enter?
        // Original code handles \r (13) and \n (10).
        // If I paste \n, char code is 10.
        // handleTermInput handles code 10 correctly.
        await handleTermInput(char);
    }
});

// Reset button handler
document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset the filesystem? All changes will be lost.')) {
        await cmdReset();
        showPrompt();
    }
});

// Debug function - expose to window for console testing
window.debugGit = function () {
    console.log('=== Git Debug Info ===');
    console.log('window.git:', !!window.git);
    console.log('window.git.http:', !!window.git?.http);
    console.log('window.GitHttp:', !!window.GitHttp);
    console.log('http variable:', !!http);
    console.log('git.version:', git.version?.());
    console.log('fs:', !!fs);
    console.log('LightningFS:', !!window.LightningFS);

    // Try to list what's on window.git
    if (window.git) {
        console.log('window.git keys:', Object.keys(window.git).slice(0, 20));
    }
};

// Initialize when page loads
init();

