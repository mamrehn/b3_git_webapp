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

// Initialize filesystem
const fs = new LightningFS('gitlearning');
const pfs = fs.promises;
const git = window.git;
const http = window.GitHttp || window.git?.http;

// State
let currentDir = '/home/student';
let currentLine = '';
let cursorPos = 0;
let commandHistory = [];
let historyIndex = -1;
let currentProject = 'project1';
let editorFile = null;
let editorOriginalContent = '';
let codeMirrorInstance = null;

// Reverse search state
let reverseSearchMode = false;
let reverseSearchQuery = '';
let reverseSearchIndex = -1;
let savedLine = '';

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
        console.log('🔄 Cloning https://github.com/mamrehn/project1.git...');
        console.log('   Using CORS proxy: https://cors.isomorphic-git.org');
        console.log('   HTTP module available:', !!httpModule);
        console.log('   Git version:', git.version?.());
        
        await git.clone({
            fs,
            http: httpModule,
            dir: project1Path,
            url: 'https://github.com/mamrehn/project1.git',
            corsProxy: 'https://cors.isomorphic-git.org',
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
        await git.setConfig({ fs, dir: project1Path, path: 'user.name', value: 'Student' });
        await git.setConfig({ fs, dir: project1Path, path: 'user.email', value: 'student@example.com' });
        
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
            console.error('      1. GitHub repository is public');
            console.error('      2. CORS proxy is accessible');
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
    await git.setConfig({ fs, dir: project1Path, path: 'user.name', value: 'Student' });
    await git.setConfig({ fs, dir: project1Path, path: 'user.email', value: 'student@example.com' });
    
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
        author: { name: 'Student', email: 'student@example.com' },
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
        author: { name: 'Student', email: 'student@example.com' },
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
        author: { name: 'Student', email: 'student@example.com' },
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
        author: { name: 'Student', email: 'student@example.com' },
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
    term.writeln('\r\n\x1b[32m💡  Hint: This is a safe learning environment. Try any git command!\x1b[0m');
    term.writeln('\x1b[32m💡  Hint: Type "help" for available commands.\x1b[0m');
    term.writeln('\x1b[32m💡  Hint: Edit files using "edit <filename>" or "vi <filename>".\x1b[0m');
    term.writeln('\x1b[32m💡  Hint: project1 is cloned from GitHub (mamrehn/project1)\x1b[0m');
    term.writeln('\x1b[32m💡  Hint: project2 is empty - You can initialize it with "git init"\x1b[0m\r\n');
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
    if (path.startsWith('/')) {
        return path;
    }
    if (path.startsWith('~')) {
        return path.replace('~', '/home/student');
    }
    return `${currentDir}/${path}`.replace(/\/+/g, '/');
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
    term.writeln(`\r\n\x1b[32m💡  Hint: ${text}\x1b[0m`);
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
    
    // Handle pipes
    if (trimmedCmd.includes('|')) {
        await processPipedCommands(trimmedCmd);
        await updateFileTree();
        showPrompt();
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
    
    await updateFileTree();
    showPrompt();
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
    printNormal('  vi/vim/nano <file>    - Edit file');
    printNormal('  clear                 - Clear terminal');
    printNormal('  reset                 - Reset filesystem to initial state');
    printNormal('  history               - Show command history');
    printNormal('  debug                 - Show debug information');
    printNormal('');
    printNormal('\x1b[36mAdvanced Features:\x1b[0m');
    printNormal('  <cmd> | grep <text>   - Filter output with grep');
    printNormal('  Ctrl+R                - Reverse history search');
    printNormal('  Tab                   - Auto-complete commands/files');
    printNormal('  ↑/↓                   - Navigate command history');
    printNormal('');
    printNormal('\x1b[36mGit Commands:\x1b[0m');
    printNormal('  git init              - Initialize git repository');
    printNormal('  git status            - Show working tree status');
    printNormal('  git add <file>        - Add file to staging area');
    printNormal('  git commit -m "msg"   - Commit changes');
    printNormal('  git log               - Show commit history');
    printNormal('  git branch [name]     - List or create branches');
    printNormal('  git checkout <branch> - Switch branches');
    printNormal('  git diff [file]       - Show changes');
    printNormal('  git reset <file>      - Unstage file');
    printNormal('  git rm <file>         - Remove file from index');
    printNormal('  git mv <src> <dest>   - Move/rename file');
    printNormal('  git merge <branch>    - Merge branches');
    printNormal('  git tag [name]        - Create or list tags');
    printNormal('  git show [commit]     - Show commit details');
    printNormal('  git fetch             - Download objects from remote');
    printNormal('  git stash [push|pop]  - Stash changes');
    printNormal('  git config <key> <val>- Get/set configuration');
    printNormal('  git clone <url>       - Clone remote repository');
    printNormal('  git push [remote]     - Push to remote');
    printNormal('  git pull [remote]     - Pull from remote');
    printNormal('  git remote add <name> <url> - Add remote');
    printNormal('  git remote -v         - List remotes');
}

async function cmdLs(args) {
    try {
        const showHidden = args.includes('-a') || args.includes('-la') || args.includes('-al');
        const files = await pfs.readdir(currentDir);
        
        const fileInfos = await Promise.all(files.map(async (file) => {
            const fullPath = `${currentDir}/${file}`;
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
            printNormal('(empty directory)');
            return;
        }
        
        printNormal('');
        filtered.forEach(file => {
            const color = file.isDirectory ? '\x1b[34m' : '\x1b[0m';
            const suffix = file.isDirectory ? '/' : '';
            const hiddenColor = file.isHidden ? '\x1b[90m' : '';
            term.writeln(`${hiddenColor}${color}${file.name}${suffix}\x1b[0m`);
        });
        
        if (!showHidden && fileInfos.some(f => f.isHidden)) {
            printHint('Use "ls -a" to show hidden files (like .git)');
        }
    } catch (error) {
        printError(`Cannot access '${currentDir}': ${error.message}`);
    }
}

async function cmdCd(args) {
    if (args.length === 0) {
        currentDir = '/home/student';
        return;
    }
    
    let newDir = args[0];
    
    // Handle relative paths
    if (newDir === '..') {
        const parts = currentDir.split('/').filter(p => p);
        if (parts.length > 0) {
            parts.pop();
            currentDir = '/' + parts.join('/');
            if (currentDir === '/home') currentDir = '/home/student'; // Don't go above home
        }
        return;
    }
    
    if (newDir === '~') {
        currentDir = '/home/student';
        return;
    }
    
    if (!newDir.startsWith('/')) {
        newDir = `${currentDir}/${newDir}`;
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
        printNormal(`Directory created: ${dirname}`);
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
        await pfs.writeFile(filepath, '', 'utf8');
        printNormal(`File created: ${filename}`);
        printHint('Use "vi ' + filename + '" or "nano ' + filename + '" to edit it');
    } catch (error) {
        printError(`touch: cannot create file '${filename}': ${error.message}`);
    }
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
        const status = await git.statusMatrix({ fs, dir });
        
        printNormal('On branch main');
        
        const staged = [];
        const modified = [];
        const untracked = [];
        
        for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
            // Skip .git directory entries
            if (filepath.startsWith('.git/')) continue;
            
            // HEADStatus: 0 = absent, 1 = present
            // workdirStatus: 0 = absent, 1 = unchanged, 2 = modified
            // stageStatus: 0 = absent, 1 = unchanged, 2 = added, 3 = modified
            
            if (HEADStatus === 0 && workdirStatus === 2 && stageStatus === 2) {
                staged.push(filepath);
            } else if (HEADStatus === 1 && workdirStatus === 2 && stageStatus === 2) {
                staged.push(filepath);
            } else if (workdirStatus === 2 && stageStatus === 1) {
                modified.push(filepath);
            } else if (HEADStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
                untracked.push(filepath);
            }
        }
        
        if (staged.length === 0 && modified.length === 0 && untracked.length === 0) {
            printNormal('\nnothing to commit, working tree clean');
            printHint('Your working directory is clean. Try modifying a file or creating a new one!');
            return;
        }
        
        if (staged.length > 0) {
            printNormal('\nChanges to be committed:');
            printNormal('  (use "git reset HEAD <file>..." to unstage)');
            printNormal('');
            staged.forEach(file => {
                term.writeln(`\t\x1b[32mnew file:   ${file}\x1b[0m`);
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
            // Add all files
            const status = await git.statusMatrix({ fs, dir });
            for (const [filepath, HEADStatus, workdirStatus] of status) {
                if (filepath.startsWith('.git/')) continue;
                if (workdirStatus === 2) {
                    await git.add({ fs, dir, filepath });
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
        
        // Parse commit message
        let message = '';
        const mIndex = args.indexOf('-m');
        if (mIndex !== -1 && args.length > mIndex + 1) {
            // Join all args after -m as the message
            message = args.slice(mIndex + 1).join(' ').replace(/^["']|["']$/g, '');
        }
        
        if (!message) {
            printError('Aborting commit due to empty commit message.');
            printHint('Usage: git commit -m "Your commit message"');
            return;
        }
        
        const sha = await git.commit({
            fs,
            dir,
            author: { name: 'Student', email: 'student@example.com' },
            message
        });
        
        printNormal(`[main ${sha.substring(0, 7)}] ${message}`);
        printHint('Commit created! Use "git log" to see your commit history');
    } catch (error) {
        printError(`git commit failed: ${error.message}`);
        if (error.message.includes('No changes')) {
            printHint('There are no staged changes. Use "git add <file>" first');
        }
    }
}

async function gitLog(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        
        // Support --all flag for more commits
        const depth = args.includes('--all') ? 100 : 20;
        
        const commits = await git.log({ 
            fs, 
            dir, 
            depth: depth,
            ref: 'HEAD'
        });
        
        if (commits.length === 0) {
            printNormal('No commits yet');
            printHint('Create your first commit with "git add <file>" and "git commit -m <message>"');
            return;
        }
        
        printNormal('');
        commits.forEach(commit => {
            term.writeln(`\x1b[33mcommit ${commit.oid}\x1b[0m`);
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
        
        if (commits.length >= depth) {
            printHint(`Showing last ${depth} commits. Use "git log --all" to see more`);
        } else {
            printHint('Use "git show <commit-hash>" to see details of a specific commit');
        }
    } catch (error) {
        printError(`git log failed: ${error.message}`);
        console.error('Git log error:', error);
    }
}

async function gitBranch(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        
        if (args.length === 0) {
            // List branches
            const branches = await git.listBranches({ fs, dir });
            const current = await git.currentBranch({ fs, dir });
            
            printNormal('');
            branches.forEach(branch => {
                const marker = branch === current ? '* ' : '  ';
                const color = branch === current ? '\x1b[32m' : '';
                term.writeln(`${marker}${color}${branch}\x1b[0m`);
            });
            printHint('Create a new branch with "git branch <branchname>"');
        } else {
            // Create branch
            const branchName = args[0];
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
        printError('Please specify a branch name');
        printHint('Usage: git checkout <branchname>');
        return;
    }
    
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        const branchName = args[0];
        
        await git.checkout({ fs, dir, ref: branchName });
        printNormal(`Switched to branch '${branchName}'`);
        printHint('You are now on the "' + branchName + '" branch. Changes you commit will be on this branch.');
    } catch (error) {
        printError(`git checkout failed: ${error.message}`);
        printHint('Make sure the branch exists. Use "git branch" to see all branches');
    }
}

async function gitDiff(args) {
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        printNormal('git diff output (simplified):');
        printNormal('');
        
        const status = await git.statusMatrix({ fs, dir });
        let hasChanges = false;
        
        for (const [filepath, HEADStatus, workdirStatus, stageStatus] of status) {
            if (filepath.startsWith('.git/')) continue;
            
            if (workdirStatus === 2 && stageStatus === 1) {
                hasChanges = true;
                term.writeln(`\x1b[33mdiff --git a/${filepath} b/${filepath}\x1b[0m`);
                term.writeln(`--- a/${filepath}`);
                term.writeln(`+++ b/${filepath}`);
                term.writeln(`\x1b[32m(file modified - use "git add ${filepath}" to stage)\x1b[0m`);
                term.writeln('');
            }
        }
        
        if (!hasChanges) {
            printNormal('No changes');
            printHint('Modify some files to see differences here');
        }
    } catch (error) {
        printError(`git diff failed: ${error.message}`);
    }
}

async function gitReset(args) {
    if (args.length === 0) {
        printError('Please specify a file');
        printHint('Usage: git reset <filename>');
        return;
    }
    
    try {
        const dir = await git.findRoot({ fs, filepath: currentDir });
        const file = args[0];
        
        await git.resetIndex({ fs, dir, filepath: file });
        printNormal(`Unstaged changes for ${file}`);
        printHint('The file is now unstaged. Use "git add" to stage it again');
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
                    term.writeln(`${remote.remote}\t${remote.url} (fetch)`);
                    term.writeln(`${remote.remote}\t${remote.url} (push)`);
                });
            }
        } else if (args[0] === 'add') {
            if (args.length < 3) {
                printError('Usage: git remote add <name> <url>');
                return;
            }
            
            const remoteName = args[1];
            const remoteUrl = args[2];
            
            await git.addRemote({ fs, dir, remote: remoteName, url: remoteUrl });
            printNormal(`Remote '${remoteName}' added: ${remoteUrl}`);
            printHint('This is a simulated remote. You can practice push/pull commands!');
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
        
        // Simulated push
        printNormal('Counting objects: 5, done.');
        printNormal('Compressing objects: 100% (3/3), done.');
        printNormal('Writing objects: 100% (5/5), 456 bytes | 456.00 KiB/s, done.');
        printNormal('Total 5 (delta 0), reused 0 (delta 0)');
        printNormal('To ' + remotes[0].url);
        printNormal('   a1b2c3d..e4f5g6h  main -> main');
        printHint('Push simulated! In a real scenario, this would upload your commits to a remote server');
    } catch (error) {
        printError(`git push failed: ${error.message}`);
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
        
        // Simulated pull
        printNormal('From ' + remotes[0].url);
        printNormal(' * branch            main       -> FETCH_HEAD');
        printNormal('Already up to date.');
        printHint('Pull simulated! In a real scenario, this would download changes from a remote server');
    } catch (error) {
        printError(`git pull failed: ${error.message}`);
    }
}

async function gitClone(args) {
    if (args.length === 0) {
        printError('You must specify a repository to clone.');
        printHint('Usage: git clone <url>');
        printHint('For learning, try: git clone https://github.com/student/example.git');
        return;
    }
    
    const url = args[0];
    const repoName = url.split('/').pop().replace('.git', '');
    
    printNormal(`Cloning into '${repoName}'...`);
    printNormal('remote: Counting objects: 15, done.');
    printNormal('remote: Compressing objects: 100% (10/10), done.');
    printNormal('remote: Total 15 (delta 2), reused 15 (delta 2)');
    printNormal('Receiving objects: 100% (15/15), done.');
    printNormal('Resolving deltas: 100% (2/2), done.');
    printHint('Clone simulated! In a real scenario, this would download a repository from a remote server');
    printHint('The actual cloning functionality requires a real remote server, which is beyond this learning environment');
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
    const branchToMerge = args[0];
    
    try {
        const branches = await git.listBranches({ fs, dir });
        if (!branches.includes(branchToMerge)) {
            printError(`error: pathspec '${branchToMerge}' did not match any file(s) known to git`);
            return;
        }
        
        const currentBranch = await git.currentBranch({ fs, dir });
        
        await git.merge({ fs, dir, ours: currentBranch, theirs: branchToMerge, author: { name: 'Student', email: 'student@example.com' } });
        
        printNormal(`Merge made by the 'recursive' strategy.`);
        printNormal(`Merged branch '${branchToMerge}' into ${currentBranch}`);
        printHint('Files from the merged branch are now in your working directory');
    } catch (error) {
        if (error.code === 'MergeNotSupportedError') {
            printError('Merge conflicts detected!');
            printHint('This learning environment has limited merge conflict resolution support');
            printHint('In a real scenario, you would need to resolve conflicts manually and commit');
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
        if (args.length > 0) {
            ref = args[0];
        }
        
        const oid = await git.resolveRef({ fs, dir, ref });
        const commit = await git.readCommit({ fs, dir, oid });
        
        printNormal(`\x1b[33mcommit ${oid}\x1b[0m`);
        printNormal(`Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);
        printNormal(`Date:   ${new Date(commit.commit.author.timestamp * 1000).toString()}`);
        printNormal('');
        printNormal(`    ${commit.commit.message}`);
        printNormal('');
        
        printHint('Use git show <commit-hash> to view specific commits');
    } catch (error) {
        printError(`fatal: ${error.message}`);
    }
}

async function gitFetch(args) {
    printNormal('Fetching origin...');
    printNormal('remote: Counting objects: 5, done.');
    printNormal('remote: Compressing objects: 100% (3/3), done.');
    printNormal('remote: Total 5 (delta 2), reused 5 (delta 2)');
    printNormal('Unpacking objects: 100% (5/5), done.');
    printNormal('From https://github.com/student/project');
    printNormal('   abc1234..def5678  main       -> origin/main');
    printHint('Fetch downloads objects and refs from another repository');
    printHint('Unlike pull, fetch does not merge changes into your working directory');
}

async function gitStash(args) {
    const dir = await git.findRoot({ fs, filepath: currentDir });
    
    if (args.length === 0 || args[0] === 'push') {
        printNormal('Saved working directory and index state WIP on main: Latest commit');
        printHint('Stash saves your local modifications away and reverts to a clean working directory');
        printHint('Use "git stash pop" to restore your changes');
        printHint('Note: This learning environment has limited stash support');
        return;
    }
    
    if (args[0] === 'list') {
        printNormal('stash@{0}: WIP on main: abc1234 Latest commit');
        printHint('This shows saved stashes (simulated in learning environment)');
        return;
    }
    
    if (args[0] === 'pop') {
        printNormal('On branch main');
        printNormal('Changes not staged for commit:');
        printNormal('  modified:   file.txt');
        printNormal('Dropped refs/stash@{0}');
        printHint('Stash pop applies the most recent stash and removes it from the stash list');
        return;
    }
    
    printError(`Unknown stash subcommand: ${args[0]}`);
    printHint('Available: git stash [push|pop|list]');
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
                
                try {
                    const content = await pfs.readFile(filepath, 'utf8');
                    editorFile = filepath;
                    editorOriginalContent = content;
                    openEditor(filename, content);
                    printHint(`Opened ${filename} in editor. Edit and use Ctrl+S to save, Ctrl+X to close.`);
                } catch (error) {
                    printError(`Error opening file: ${error.message}`);
                }
            });
        });
    } catch (error) {
        treeContainer.innerHTML = `<div style="color: #f44;">Error loading file tree</div>`;
    }
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
            
            if (file.isDirectory) {
                // Don't show contents of .git folder
                if (file.name === '.git') {
                    html += `<div class="tree-folder ${hiddenClass}" style="margin-left: ${indent * 15}px">`;
                    html += `<span class="folder-icon"></span>${file.name}/`;
                    html += `</div>`;
                } else {
                    html += `<div class="tree-folder ${hiddenClass}" style="margin-left: ${indent * 15}px">`;
                    html += `<span class="folder-icon"></span>${file.name}/`;
                    html += `</div>`;
                    html += await buildFileTree(file.path, indent + 1);
                }
            } else {
                html += `<div class="tree-file ${hiddenClass} clickable-file" data-filepath="${file.path}" style="margin-left: ${indent * 15}px">`;
                html += `<span class="file-icon"></span>${file.name}`;
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
    codeMirrorInstance = CodeMirror(function(elt) {
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
            'Ctrl-S': function() {
                saveEditor();
            },
            'Ctrl-X': function() {
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
    
    // Just hide the editor, don't destroy CodeMirror instance
    editorContainer.classList.add('hidden');
    editorFile = null;
    editorOriginalContent = '';
    showPrompt();
    term.focus();
}

async function saveEditor() {
    if (!codeMirrorInstance) return;
    
    const content = codeMirrorInstance.getValue();
    
    try {
        await pfs.writeFile(editorFile, content, 'utf8');
        printNormal(`File saved: ${editorFile.split('/').pop()}`);
        printHint('File saved successfully. Changes are now in your working directory.');
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
async function handleTabCompletion() {
    const parts = currentLine.split(/\s+/);
    const lastPart = parts[parts.length - 1];
    
    // Command completion (if it's the first word)
    if (parts.length === 1) {
        const commands = ['help', 'ls', 'll', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm', 'clear', 'reset', 'history', 'grep', 'vi', 'vim', 'nano', 'edit', 'git'];
        const matches = commands.filter(cmd => cmd.startsWith(lastPart));
        
        if (matches.length === 1) {
            const completion = matches[0].substring(lastPart.length);
            currentLine += completion + ' ';
            cursorPos = currentLine.length;
            term.write(completion + ' ');
        } else if (matches.length > 1) {
            term.write('\r\n');
            term.writeln(matches.join('  '));
            showPromptInline();
            term.write(currentLine);
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
            term.write('\r\n');
            term.writeln(matches.join('  '));
            showPromptInline();
            term.write(currentLine);
        }
        return;
    }
    
    // File/directory completion
    try {
        const files = await pfs.readdir(currentDir);
        const matches = files.filter(file => file.startsWith(lastPart));
        
        if (matches.length === 1) {
            const completion = matches[0].substring(lastPart.length);
            const fullPath = `${currentDir}/${matches[0]}`;
            const stats = await pfs.stat(fullPath);
            const suffix = stats.isDirectory() ? '/' : ' ';
            
            currentLine = currentLine.substring(0, currentLine.length - lastPart.length) + matches[0] + suffix;
            cursorPos = currentLine.length;
            term.write('\r\x1b[K');
            showPromptInline();
            term.write(currentLine);
        } else if (matches.length > 1) {
            term.write('\r\n');
            term.writeln(matches.join('  '));
            showPromptInline();
            term.write(currentLine);
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

// Terminal input handling
term.onData(data => {
    const code = data.charCodeAt(0);
    
    // Ctrl+R - Reverse search
    if (code === 18) { // Ctrl+R
        if (reverseSearchMode) {
            searchHistoryReverse();
        } else {
            startReverseSearch();
        }
        return;
    }
    
    // Ctrl+C or Escape - Exit reverse search
    if ((code === 3 || code === 27) && reverseSearchMode) {
        exitReverseSearch(false);
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
    } else if (code === 27) { // Escape sequences (arrow keys)
        if (data === '\x1b[A') { // Up arrow
            if (historyIndex > 0) {
                historyIndex--;
                // Clear current line
                term.write('\r\x1b[K');
                showPromptInline();
                currentLine = commandHistory[historyIndex] || '';
                cursorPos = currentLine.length;
                term.write(currentLine);
            }
        } else if (data === '\x1b[B') { // Down arrow
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                term.write('\r\x1b[K');
                showPromptInline();
                currentLine = commandHistory[historyIndex] || '';
                cursorPos = currentLine.length;
                term.write(currentLine);
            } else {
                historyIndex = commandHistory.length;
                term.write('\r\x1b[K');
                showPromptInline();
                currentLine = '';
                cursorPos = 0;
            }
        } else if (data === '\x1b[C') { // Right arrow
            if (cursorPos < currentLine.length) {
                cursorPos++;
                term.write('\x1b[C'); // Move cursor right
            }
        } else if (data === '\x1b[D') { // Left arrow
            if (cursorPos > 0) {
                cursorPos--;
                term.write('\x1b[D'); // Move cursor left
            }
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
window.debugGit = function() {
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

