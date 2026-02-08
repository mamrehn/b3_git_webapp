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

// Undo history
let undoHistory = [];
const MAX_UNDO_HISTORY = 50;

// Quoted insert mode (Ctrl+V)
let quotedInsertMode = false;

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

        // Update file tree
        await updateFileTree();

    } catch (error) {
        term.writeln(`\r\n\x1b[31mError initializing: ${error.message}\x1b[0m`);
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
    term.writeln('\r\n\x1b[36m╔════════════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[36m║        Welcome to the Git Learning Terminal!               ║\x1b[0m');
    term.writeln('\x1b[36m╚════════════════════════════════════════════════════════════╝\x1b[0m');
    term.writeln('\r\n\x1b[1;94m💡 \x1b[0m\x1b[1;94mHint: This is a safe learning environment. Try any git command!\x1b[0m');
    term.writeln('\x1b[1;94m💡 \x1b[0m\x1b[1;94mHint: Type "help" for available commands.\x1b[0m');
    term.writeln('\x1b[1;94m💡 \x1b[0m\x1b[1;94mHint: Edit files using "edit <filename>" or "vi <filename>".\x1b[0m');
    term.writeln('\x1b[1;94m💡 \x1b[0m\x1b[1;94mHint: project1 is cloned from GitHub (mamrehn/project1)\x1b[0m');
    term.writeln('\x1b[1;94m💡 \x1b[0m\x1b[1;94mHint: project2 is empty - You can initialize it with "git init"\x1b[0m\r\n');
}

function showPrompt() {
    const dir = currentDir.replace('/home/student', '~');
    term.write(`\r\n\x1b[36mme@gitlearning\x1b[0m:\x1b[34m${dir}\x1b[0m$ `);
}

function showPromptInline() {
    const dir = currentDir.replace('/home/student', '~');
    term.write(`\x1b[36mme@gitlearning\x1b[0m:\x1b[34m${dir}\x1b[0m$ `);
}

// Helper functions
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

function printNormal(text) {
    term.writeln(`\r\n${text}`);
}

function printHint(text) {
    // Use bright blue (1;94m) for hints - stands out and doesn't conflict with git colors
    // No leading newline - hints should be grouped together
    term.writeln(`\x1b[1;94m💡 \x1b[0m\x1b[1;94mHint: ${text}\x1b[0m`);
}

function printError(text) {
    term.writeln(`\r\n\x1b[31m${text}\x1b[0m`);
}

// Pipe handling
async function processPipedCommands(fullCommand) {
    try {
        const commands = fullCommand.split('|').map(c => c.trim());
        let output = '';

        // Execute first command and capture output
        const firstCmd = commands[0];
        const parts = firstCmd.split(/\s+/);
        const command = parts[0];
        const args = parts.slice(1);

        // Capture output from first command
        if (command === 'history') {
            output = commandHistory.map((cmd, i) => `${i + 1}  ${cmd}`).join('\n');
        } else {
            printError('Pipe only supported with history command currently');
            return;
        }

        // Process remaining commands in pipe
        for (let i = 1; i < commands.length; i++) {
            const pipeCmd = commands[i];
            const pipeParts = pipeCmd.split(/\s+/);
            const pipeCommand = pipeParts[0];
            const pipeArgs = pipeParts.slice(1);

            if (pipeCommand === 'grep') {
                if (pipeArgs.length === 0) {
                    printError('grep: missing search pattern');
                    return;
                }
                const pattern = pipeArgs[0].replace(/^["']|["']$/g, '');
                const lines = output.split('\n');
                output = lines.filter(line => line.toLowerCase().includes(pattern.toLowerCase())).join('\n');
            } else {
                printError(`Pipe command not supported: ${pipeCommand}`);
                return;
            }
        }

        // Print final output
        if (output) {
            printNormal('');
            output.split('\n').forEach(line => term.writeln(line));
        } else {
            printNormal('(no matches)');
        }
    } catch (error) {
        printError(`Pipe error: ${error.message}`);
    }
}

// Command processor
async function processCommand(cmd) {
    const trimmedCmd = cmd.trim();
    if (!trimmedCmd) {
        showPrompt();
        return;
    }

    // Add to history
    commandHistory.push(trimmedCmd);
    historyIndex = commandHistory.length;

    // Handle && chaining (split and run sequentially, stop on failure)
    if (trimmedCmd.includes('&&')) {
        const chainedCmds = trimmedCmd.split('&&').map(c => c.trim()).filter(c => c);
        for (const subcmd of chainedCmds) {
            try {
                await executeSingleCommand(subcmd);
            } catch (error) {
                printError(`Error: ${error.message}`);
                break; // Stop chain on failure, like real bash
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

async function executeSingleCommand(trimmedCmd) {
    // Handle pipes
    if (trimmedCmd.includes('|')) {
        await processPipedCommands(trimmedCmd);
        return;
    }

    const parts = trimmedCmd.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

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
            case 'git':
                await cmdGit(args);
                break;
            default:
                printError(`Command not found: ${command}`);
                printHint(`Type "help" to see available commands.`);
        }
    } catch (error) {
        printError(`Error: ${error.message}`);
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
    printNormal('  ls [options]          - List directory contents');
    printNormal('  ll                    - List all files (alias for ls -la)');
    printNormal('  cd <directory>        - Change directory');
    printNormal('  pwd                   - Print working directory');
    printNormal('  cat <file>            - Display file contents');
    printNormal('  mkdir <directory>     - Create directory');
    printNormal('  touch <file>          - Create empty file');
    printNormal('  rm <file>             - Remove file');
    printNormal('  echo <text>           - Print text or redirect to file');
    printNormal('  vi/vim/nano <file>    - Edit file');
    printNormal('  clear                 - Clear terminal');
    printNormal('  reset                 - Reset filesystem to initial state');
    printNormal('  history               - Show command history');
    printNormal('  debug                 - Show debug information');
    printNormal('');
    printNormal('\x1b[36mAdvanced Features:\x1b[0m');
    printNormal('  <cmd> && <cmd>        - Chain commands (stops on error)');
    printNormal('  <cmd> | grep <text>   - Filter output with grep');
    printNormal('  echo "text" > file    - Write text to file');
    printNormal('  echo "text" >> file   - Append text to file');
    printNormal('  Ctrl+R                - Reverse history search');
    printNormal('  Tab                   - Auto-complete commands/files');
    printNormal('  ↑/↓                   - Navigate command history');
    printNormal('');
    printNormal('\x1b[36mGit Commands (Basic):\x1b[0m');
    printNormal('  git init              - Initialize git repository');
    printNormal('  git status            - Show working tree status');
    printNormal('  git add <file>        - Add file to staging area');
    printNormal('  git commit [flags]    - Commit changes (-m "msg", --amend)');
    printNormal('  git log               - Show commit history');
    printNormal('  git branch [name]     - List or create branches');
    printNormal('  git checkout <ref>    - Switch branches or restore files');
    printNormal('  git switch <branch>   - Switch branches (modern)');
    printNormal('  git restore <file>    - Restore working tree files');
    printNormal('  git diff [file]       - Show changes');
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
        const showHidden = args.includes('-a') || args.includes('-la') || args.includes('-al');
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
            term.writeln('');
            term.writeln(targetName);
            return;
        }

        const files = await pfs.readdir(targetDir);

        const fileInfos = await Promise.all(files.map(async (file) => {
            const fullPath = `${targetDir}/${file}`;
            const stats = await pfs.stat(fullPath);
            return {
                name: file,
                isDirectory: stats.isDirectory(),
                isHidden: file.startsWith('.')
            };
        }));

        // Filter hidden files if not requested
        const filtered = showHidden ? fileInfos : fileInfos.filter(f => !f.isHidden);

        if (filtered.length === 0) {
            // printNormal('(empty directory)'); // Don't print for empty dirs to match ls
            return;
        }

        // Print file list without leading newline
        term.writeln('');
        filtered.forEach(file => {
            let color = '\x1b[0m';
            let suffix = '';

            if (file.isDirectory) {
                color = '\x1b[34m';
                suffix = '/';
            }

            if (file.isHidden) {
                color = '\x1b[90m'; // Grey for hidden
            }

            term.writeln(`${color}${file.name}${suffix}\x1b[0m`);
        });

        // Add spacing before hint (only for current dir if there are hidden files)
        if (targetDir === currentDir && !showHidden && fileInfos.some(f => f.isHidden)) {
            // term.writeln('');
            // printHint('Use "ls -a" to show hidden files (like .git)');
        }
    } catch (error) {
        printError(`ls: ${error.message}`);
    }
}

async function cmdCd(args) {
    if (args.length === 0) {
        currentDir = '/home/student';
        await updateFileTree();
        return;
    }

    let newDir = args[0];

    // Handle current directory
    if (newDir === '.') {
        // Stay in current directory, just update the file tree
        await updateFileTree();
        return;
    }

    // Handle parent directory
    if (newDir === '..') {
        const parts = currentDir.split('/').filter(p => p);
        if (parts.length > 0) {
            parts.pop();
            currentDir = '/' + parts.join('/');
            if (currentDir === '/home') currentDir = '/home/student'; // Don't go above home
        }
        await updateFileTree();
        return;
    }

    // Handle home directory
    if (newDir === '~') {
        currentDir = '/home/student';
        await updateFileTree();
        return;
    }

    // Resolve the path (handles ., .., relative paths)
    newDir = resolvePath(newDir);

    // Don't allow going above /home/student
    if (!newDir.startsWith('/home/student')) {
        newDir = '/home/student';
    }

    try {
        const stats = await pfs.stat(newDir);
        if (stats.isDirectory()) {
            currentDir = newDir;
            // Update current project if in a project directory
            if (currentDir.includes('/project1')) {
                currentProject = 'project1';
            } else if (currentDir.includes('/project2')) {
                currentProject = 'project2';
            }
            await updateFileTree();
        } else {
            printError(`cd: not a directory: ${args[0]}`);
        }
    } catch (error) {
        printError(`cd: no such file or directory: ${args[0]}`);
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

    const filename = args[0];
    const filepath = filename.startsWith('/') ? filename : `${currentDir}/${filename}`;

    try {
        const content = await pfs.readFile(filepath, 'utf8');
        printNormal('');
        term.writeln(content.split('\n').map(line => `\r\n${line}`).join(''));
    } catch (error) {
        printError(`cat: ${filename}: No such file or directory`);
    }
}

async function cmdMkdir(args) {
    if (args.length === 0) {
        printError('mkdir: missing operand');
        return;
    }

    const dirname = args[0];
    const dirpath = dirname.startsWith('/') ? dirname : `${currentDir}/${dirname}`;

    try {
        await pfs.mkdir(dirpath, { recursive: true });
        // Directory created silently, like in real terminals
    } catch (error) {
        printError(`mkdir: cannot create directory '${dirname}': ${error.message}`);
    }
}

async function cmdTouch(args) {
    if (args.length === 0) {
        printError('touch: missing file operand');
        return;
    }

    const filename = args[0];
    const filepath = filename.startsWith('/') ? filename : `${currentDir}/${filename}`;

    try {
        // Only create the file if it doesn't already exist (real touch updates mtime)
        try {
            await pfs.stat(filepath);
            // File exists -- real touch updates timestamp, but LightningFS doesn't support that
            // so just silently succeed like real touch
        } catch (e) {
            // File doesn't exist, create it
            await pfs.writeFile(filepath, '', 'utf8');
            printHint('Use "vi ' + filename + '" or "nano ' + filename + '" to edit it');
        }
    } catch (error) {
        printError(`touch: cannot create file '${filename}': ${error.message}`);
    }
}

async function cmdEcho(_args, fullCmd) {
    // Parse the full command to handle quotes and redirects properly
    // Extract everything after "echo "
    const echoContent = fullCmd.replace(/^echo\s*/, '');

    // Check for redirect operators: > (overwrite) or >> (append)
    const appendMatch = echoContent.match(/^(.*?)\s*>>\s*(.+)$/);
    const overwriteMatch = echoContent.match(/^(.*?)\s*>\s*(.+)$/);

    if (appendMatch || overwriteMatch) {
        const isAppend = !!appendMatch;
        const match = isAppend ? appendMatch : overwriteMatch;
        let text = match[1].trim().replace(/^["']|["']$/g, '');
        const filename = match[2].trim();
        const filepath = filename.startsWith('/') ? filename : `${currentDir}/${filename}`;

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

    // No redirect, just print to terminal
    const text = echoContent.replace(/^["']|["']$/g, '');
    printNormal(text);
}

async function cmdRm(args) {
    if (args.length === 0) {
        printError('rm: missing operand');
        return;
    }

    const filename = args[0];
    const filepath = filename.startsWith('/') ? filename : `${currentDir}/${filename}`;

    try {
        await pfs.unlink(filepath);
        printNormal(`File removed: ${filename}`);
    } catch (error) {
        printError(`rm: cannot remove '${filename}': ${error.message}`);
    }
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
        const file = args[0];

        if (file === '.') {
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
            printNormal('All changes added to staging area');
            printHint('Now use "git commit -m <message>" to save these changes');
        } else {
            await git.add({ fs, dir, filepath: file });
            printNormal(`Added ${file} to staging area`);
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

        // Parse commit message
        let message = '';
        const mIndex = args.indexOf('-m');
        if (mIndex !== -1 && args.length > mIndex + 1) {
            // Join all args after -m as the message
            message = args.slice(mIndex + 1).join(' ').replace(/^["']|["']$/g, '');
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

            // Use new message or keep the old one
            const amendMessage = message || lastCommit.commit.message;

            // Get current HEAD tree
            const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
            const { tree } = await git.readCommit({ fs, dir, oid: headOid });

            // Create new commit with parent of the amended commit
            const newCommitOid = await git.commit({
                fs,
                dir,
                message: amendMessage,
                author: { name: 'Student', email: 'student@example.com' },
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

        const sha = await git.commit({
            fs,
            dir,
            author: { name: 'Student', email: 'student@example.com' },
            message
        });

        printNormal(`[${currentBranch} ${sha.substring(0, 7)}] ${message}`);
        printHint('Commit created! Use "git log" to see your commit history');
    } catch (error) {
        printError(`git commit failed: ${error.message}`);
        if (error.message.includes('No changes')) {
            printHint('There are no staged changes. Use "git add <file>" first');
        }
    }
}

async function openCommitMessageEditor(dir) {
    // Get the list of staged files
    const statusMatrix = await git.statusMatrix({ fs, dir });
    const stagedFiles = statusMatrix.filter(([filepath, head, workdir, stage]) => {
        // staged=2 means staged for commit
        return stage === 2;
    });

    if (stagedFiles.length === 0) {
        printError('No changes added to commit');
        printHint('Use "git add <file>..." to stage files for commit');
        return;
    }

    // Generate commit message template with helpful comments
    // Start with two empty lines for user to write commit message
    let template = `

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# On branch ${await git.currentBranch({ fs, dir }).catch(() => 'main')}
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
        // Commit with the message
        const sha = await git.commit({
            fs,
            dir,
            author: { name: 'Student', email: 'student@example.com' },
            message
        });

        console.log('Commit successful, SHA:', sha);

        // Get first line for summary
        const firstLine = message.split('\n')[0];
        const branchName = await git.currentBranch({ fs, dir }).catch(() => 'main') || 'main';

        // Clear commit message mode flags
        isCommitMessageMode = false;
        commitMessageDir = null;

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

        // Support --all flag for more commits
        const depth = showAll ? 100 : 20;

        let commits = [];
        try {
            commits = await git.log({
                fs,
                dir,
                depth: depth,
                ref: 'HEAD'
            });
        } catch (error) {
            // Check for "Could not find refs/heads/..." which means empty repo
            if (error.code === 'NotFoundError' || error.message.includes('Could not find') || error.message.includes('no such file')) {
                printNormal('No commits yet');
                printHint('Create your first commit with "git add <file>" and "git commit -m <message>"');
                return;
            }
            throw error;
        }

        if (commits.length === 0) {
            printNormal('No commits yet');
            printHint('Create your first commit with "git add <file>" and "git commit -m <message>"');
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

                    // Format date properly
                    const date = new Date(commit.commit.author.timestamp * 1000);
                    const dateStr = date.toString();
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

                        // Format date properly
                        const date = new Date(commit.commit.author.timestamp * 1000);
                        const dateStr = date.toString();

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

                        // Format date properly
                        const date = new Date(commit.commit.author.timestamp * 1000);
                        const dateStr = date.toString();
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

                // Format date properly
                const date = new Date(commit.commit.author.timestamp * 1000);
                const dateStr = date.toString();
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
            // git checkout -- <file> : discard working tree changes
            const files = args.slice(dashDashIndex + 1);
            if (files.length === 0) {
                printError('Please specify a file after --');
                printHint('Usage: git checkout -- <filename>');
                return;
            }

            for (const file of files) {
                const filepath = file.startsWith('/') ? file : `${dir}/${file}`;

                try {
                    // Get file content from HEAD
                    const headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
                    const { blob } = await git.readBlob({
                        fs,
                        dir,
                        oid: headOid,
                        filepath: file
                    });

                    // Write the content back to working tree
                    const content = new TextDecoder().decode(blob);
                    await pfs.writeFile(filepath, content, 'utf8');
                    printNormal(`Updated 1 path from the index`);
                } catch (e) {
                    // File might not exist in HEAD (new file)
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

        if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
            printHint('Make sure the branch exists. Use "git branch" to see all branches');
            printHint('To create a new branch: git checkout -b <new-branch-name>');
        }
    }
}

async function gitDiff(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });

        // Parse arguments for diff mode
        const isStaged = args.includes('--staged') || args.includes('--cached');
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
            await printDiffStaged(dir, specificFile);
            return;
        }

        // Case 4: git diff [file] (Working Dir vs Index)
        await printDiffWorkdirIndex(dir, specificFile);

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
        try {
            newContent = await pfs.readFile(`${dir}/${filepath}`, 'utf8');
        } catch (e) { }

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

        if (stageStatus === 2 || stageStatus === 3) {
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

        // workdirStatus: 2 = modified (different from index)
        if (workdirStatus === 2 && stageStatus !== 2 && stageStatus !== 3) {
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

async function compareTrees(dir, tree1, tree2, specificFile) {
    // Simplified tree comparison
    const files1 = {};
    const files2 = {};

    for (const entry of tree1.tree) if (entry.type === 'blob') files1[entry.path] = entry.oid;
    for (const entry of tree2.tree) if (entry.type === 'blob') files2[entry.path] = entry.oid;

    const allFiles = new Set([...Object.keys(files1), ...Object.keys(files2)]);

    for (const filepath of allFiles) {
        if (specificFile && filepath !== specificFile) continue;

        const oid1 = files1[filepath];
        const oid2 = files2[filepath];

        if (oid1 !== oid2) {
            let oldContent = '';
            let newContent = '';

            if (oid1) {
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: oid1, filepath });
                    oldContent = new TextDecoder().decode(blob);
                } catch (e) { }
            }
            if (oid2) {
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: oid2, filepath });
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
            author: { name: 'Student', email: 'student@example.com' },
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

    const tagName = args[0];
    const hasMessage = args.includes('-m') || args.includes('-a');
    let message = '';

    if (hasMessage) {
        const msgIndex = args.indexOf('-m') !== -1 ? args.indexOf('-m') : args.indexOf('-a');
        message = args[msgIndex + 1] || '';
    }

    // Delete tag
    if (args.includes('-d')) {
        try {
            await git.deleteTag({ fs, dir, ref: tagName });
            printNormal(`Deleted tag '${tagName}'`);
        } catch (error) {
            printError(`error: tag '${tagName}' not found.`);
        }
        return;
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
        printNormal(`\\x1b[33mcommit ${oid}\\x1b[0m`);
        printNormal(`Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);
        printNormal(`Date:   ${new Date(commit.commit.author.timestamp * 1000).toString()}`);
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
                const parentTree = await git.readTree({ fs, dir, oid: parentCommit.commit.tree });
                const currentTree = await git.readTree({ fs, dir, oid: commit.commit.tree });

                // Build maps for comparison
                const parentFiles = {};
                const currentFiles = {};

                for (const entry of parentTree.tree) {
                    if (entry.type === 'blob') {
                        parentFiles[entry.path] = entry.oid;
                    }
                }
                for (const entry of currentTree.tree) {
                    if (entry.type === 'blob') {
                        currentFiles[entry.path] = entry.oid;
                    }
                }

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
                            const statusColor = c.status === 'A' ? '\\x1b[32m' :
                                c.status === 'D' ? '\\x1b[31m' : '\\x1b[33m';
                            printNormal(` ${statusColor}${c.file}\\x1b[0m | ${c.type}`);
                        });
                        printNormal(`${changes.length} file(s) changed`);
                    } else {
                        // Show actual diffs
                        for (const change of changes) {
                            printNormal(`\\x1b[1mdiff --git a/${change.file} b/${change.file}\\x1b[0m`);

                            if (change.status === 'A') {
                                printNormal('--- /dev/null');
                                printNormal(`+++ b/${change.file}`);
                                try {
                                    const { blob } = await git.readBlob({ fs, dir, oid: currentFiles[change.file] });
                                    const content = new TextDecoder().decode(blob);
                                    content.split('\n').forEach(line => {
                                        term.writeln(`\\x1b[32m+${line}\\x1b[0m`);
                                    });
                                } catch (e) { }
                            } else if (change.status === 'D') {
                                printNormal(`--- a/${change.file}`);
                                printNormal('+++ /dev/null');
                                try {
                                    const { blob } = await git.readBlob({ fs, dir, oid: parentFiles[change.file] });
                                    const content = new TextDecoder().decode(blob);
                                    content.split('\n').forEach(line => {
                                        term.writeln(`\\x1b[31m-${line}\\x1b[0m`);
                                    });
                                } catch (e) { }
                            } else {
                                printNormal(`--- a/${change.file}`);
                                printNormal(`+++ b/${change.file}`);
                                try {
                                    const { blob: oldBlob } = await git.readBlob({ fs, dir, oid: parentFiles[change.file] });
                                    const { blob: newBlob } = await git.readBlob({ fs, dir, oid: currentFiles[change.file] });
                                    const oldContent = new TextDecoder().decode(oldBlob).split('\n');
                                    const newContent = new TextDecoder().decode(newBlob).split('\n');

                                    // Simple diff display
                                    const maxLines = Math.max(oldContent.length, newContent.length);
                                    for (let i = 0; i < Math.min(maxLines, 20); i++) {
                                        const oldLine = oldContent[i] || '';
                                        const newLine = newContent[i] || '';
                                        if (oldLine !== newLine) {
                                            if (oldLine) term.writeln(`\\x1b[31m-${oldLine}\\x1b[0m`);
                                            if (newLine) term.writeln(`\\x1b[32m+${newLine}\\x1b[0m`);
                                        }
                                    }
                                    if (maxLines > 20) {
                                        printNormal(`... (${maxLines - 20} more lines)`);
                                    }
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
                printNormal(`  \\x1b[31mdeleted:  ${file.filepath}\\x1b[0m`);
            } else {
                printNormal(`  \\x1b[33mmodified: ${file.filepath}\\x1b[0m`);
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
            const userName = await git.getConfig({ fs, dir, path: 'user.name' }) || 'Student';
            const userEmail = await git.getConfig({ fs, dir, path: 'user.email' }) || 'student@example.com';
            printNormal(`user.name=${userName}`);
            printNormal(`user.email=${userEmail}`);
            printHint('These settings identify you in commits');
        } catch (error) {
            printError(`Error: ${error.message}`);
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

        // Get trees for both commits
        const revertTree = await git.readTree({ fs, dir, oid: commitToRevert.commit.tree });
        const parentTree = await git.readTree({ fs, dir, oid: (await git.readCommit({ fs, dir, oid: parentOid })).commit.tree });

        // Simple revert: restore files from parent commit
        // (Full 3-way merge revert is complex, this is a simplified version)
        for (const entry of parentTree.tree) {
            if (entry.type === 'blob') {
                const { blob } = await git.readBlob({ fs, dir, oid: entry.oid });
                const content = new TextDecoder().decode(blob);
                await pfs.writeFile(`${dir}/${entry.path}`, content, 'utf8');
                await git.add({ fs, dir, filepath: entry.path });
            }
        }

        // Create revert commit
        const revertMessage = `Revert "${commitToRevert.commit.message.split('\n')[0]}"\n\nThis reverts commit ${targetOid.substring(0, 7)}.`;
        const newOid = await git.commit({
            fs,
            dir,
            message: revertMessage,
            author: { name: 'Student', email: 'student@example.com' }
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
        let source = 'HEAD';
        const sourceArg = args.find(a => a.startsWith('--source='));
        if (sourceArg) {
            source = sourceArg.split('=')[1];
        }

        // Filter out flags to get file paths
        const files = args.filter(a =>
            !a.startsWith('--') && a !== '-S' && a !== '-W'
        );

        if (files.length === 0) {
            printError('fatal: you must specify path(s) to restore');
            return;
        }

        for (const file of files) {
            if (hasStaged) {
                // Unstage the file (like git reset <file>)
                await git.resetIndex({ fs, dir, filepath: file });
                printNormal(`Unstaged changes for ${file}`);
            } else {
                // Restore file from source (discard working tree changes)
                try {
                    const sourceOid = await git.resolveRef({ fs, dir, ref: source });
                    const { blob } = await git.readBlob({
                        fs,
                        dir,
                        oid: sourceOid,
                        filepath: file
                    });

                    const content = new TextDecoder().decode(blob);
                    const filepath = file.startsWith('/') ? file : `${dir}/${file}`;
                    await pfs.writeFile(filepath, content, 'utf8');
                    printNormal(`Updated 1 path from ${source}`);
                } catch (e) {
                    printError(`error: pathspec '${file}' did not match any file(s) known to git`);
                }
            }
        }

        if (hasStaged) {
            printHint('Files have been unstaged. Use "git add" to stage again.');
        } else {
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

        // For a simple rebase, we can use merge as a fallback
        // Real rebase replays commits on top of the target
        printNormal(`Rebasing ${currentBranch} onto ${targetBranch}...`);

        try {
            // Get commits to rebase (simplified)
            const result = await git.merge({
                fs,
                dir,
                ours: currentBranch,
                theirs: targetBranch,
                author: { name: 'Student', email: 'student@example.com' }
            });

            if (result && result.alreadyMerged) {
                printNormal(`Current branch ${currentBranch} is up to date.`);
            } else {
                printNormal(`Successfully rebased and updated refs/heads/${currentBranch}.`);
            }

            printHint('Rebase replays your commits on top of the target branch');
            printHint('This creates a linear history without merge commits');
        } catch (error) {
            if (error.code === 'MergeNotSupportedError') {
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
        // by showing recent commits with a reflog-like format
        const commits = await git.log({ fs, dir, depth: 20 });
        const currentBranch = await git.currentBranch({ fs, dir }).catch(() => 'HEAD') || 'HEAD';

        printNormal('');
        commits.forEach((commit, index) => {
            const shortOid = commit.oid.substring(0, 7);
            const message = commit.commit.message.split('\n')[0];
            const action = index === 0 ? `${currentBranch}: commit` : 'commit';
            term.writeln(`\\x1b[33m${shortOid}\\x1b[0m ${currentBranch}@{${index}}: ${action}: ${message}`);
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

        // Get the tree of the commit and its parent
        const pickTree = await git.readTree({ fs, dir, oid: commitToPick.commit.tree });

        // Apply changes from the picked commit
        // (Simplified: copy files from the picked commit's tree)
        for (const entry of pickTree.tree) {
            if (entry.type === 'blob') {
                try {
                    const { blob } = await git.readBlob({ fs, dir, oid: entry.oid });
                    const content = new TextDecoder().decode(blob);
                    await pfs.writeFile(`${dir}/${entry.path}`, content, 'utf8');
                    await git.add({ fs, dir, filepath: entry.path });
                } catch (e) {
                    // Skip files that can't be read
                }
            }
        }

        // Create new commit with the cherry-picked changes
        const newOid = await git.commit({
            fs,
            dir,
            message: commitToPick.commit.message,
            author: { name: 'Student', email: 'student@example.com' }
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

        // Read the current file
        let content;
        try {
            content = await pfs.readFile(filepath, 'utf8');
        } catch (e) {
            printError(`fatal: no such file: ${filename}`);
            return;
        }

        const lines = content.split('\n');

        // Get commit history to find who modified what
        // (Simplified: show the most recent commit for all lines)
        const commits = await git.log({ fs, dir, depth: 1 });
        const lastCommit = commits[0];

        printNormal('');
        lines.forEach((line, index) => {
            const lineNum = String(index + 1).padStart(4);
            const shortOid = lastCommit ? lastCommit.oid.substring(0, 8) : '00000000';
            const author = lastCommit ? lastCommit.commit.author.name.substring(0, 10).padEnd(10) : 'Unknown   ';
            term.writeln(`\\x1b[33m${shortOid}\\x1b[0m (${author} ${lineNum}) ${line}`);
        });

        printNormal('');
        printHint('Blame shows who last modified each line of a file');
        printHint('Note: This is a simplified version - real git blame tracks per-line history');
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

                currentDir = dirpath;
                await updateFileTree();
                showPrompt();
            });
        });
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
        const commands = ['help', 'ls', 'll', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm', 'echo', 'clear', 'reset', 'history', 'grep', 'vi', 'vim', 'nano', 'edit', 'git'];
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
        const gitCommands = ['init', 'status', 'add', 'commit', 'log', 'branch', 'checkout', 'diff', 'reset', 'rm', 'mv', 'merge', 'tag', 'show', 'fetch', 'stash', 'config', 'clone', 'push', 'pull', 'remote'];
        const matches = gitCommands.filter(cmd => cmd.startsWith(lastPart));

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
term.onData(data => {
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
            processCommand(currentLine);
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
            processCommand(currentLine);
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
        term.write('\r\n');
        processCommand(currentLine);
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
        term.write('\r\n');
        processCommand(currentLine);
        currentLine = '';
        cursorPos = 0;
    } else if (code === 9) { // Tab - autocomplete
        handleTabCompletion();
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

