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

// Initialize the application
async function init() {
    try {
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
    if (!await fileExists('/home/student/project1/index.html')) {
        await setupProject1();
    }
    
    // Setup empty project2 (only if not already initialized)
    if (!await dirExists('/home/student/project2/.git')) {
        await setupProject2();
    }
}

async function setupProject1() {
    const project1Path = '/home/student/project1';
    
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
    term.writeln('\x1b[32m💡  Hint: Edit files using "vi <filename>" or "nano <filename>".\x1b[0m');
    term.writeln('\x1b[32m💡  Hint: Two projects available: project1 (with commits) and project2 (empty).\x1b[0m\r\n');
}

function showPrompt() {
    const dir = currentDir.replace('/home/student', '~');
    term.write(`\r\n\x1b[36mme@gitlearning\x1b[0m:\x1b[34m${dir}\x1b[0m$ `);
}

function showPromptInline() {
    const dir = currentDir.replace('/home/student', '~');
    term.write(`\x1b[36mme@gitlearning\x1b[0m:\x1b[34m${dir}\x1b[0m$ `);
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
    
    try {
        // Clear the entire filesystem by wiping IndexedDB
        await fs.wipe();
        
        // Reinitialize
        await setupFileSystem();
        
        // Reset to home directory
        currentDir = '/home/student';
        currentProject = 'project1';
        
        printNormal('\x1b[32m✓ Filesystem reset complete!\x1b[0m');
        printHint('All projects have been reset to their initial state.');
        
        await updateFileTree();
    } catch (error) {
        printError(`Error resetting filesystem: ${error.message}`);
    }
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
        const commits = await git.log({ fs, dir, depth: 10 });
        
        if (commits.length === 0) {
            printNormal('No commits yet');
            printHint('Create your first commit with "git add <file>" and "git commit -m <message>"');
            return;
        }
        
        printNormal('');
        commits.forEach(commit => {
            term.writeln(`\x1b[33mcommit ${commit.oid}\x1b[0m`);
            term.writeln(`Author: ${commit.commit.author.name} <${commit.commit.author.email}>`);
            term.writeln(`Date:   ${new Date(commit.commit.author.timestamp * 1000).toLocaleString()}`);
            term.writeln(``);
            term.writeln(`    ${commit.commit.message}`);
            term.writeln(``);
        });
        
        printHint('Each commit has a unique ID (hash). You can use "git diff" to see changes between commits');
    } catch (error) {
        printError(`git log failed: ${error.message}`);
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
        const commands = ['help', 'ls', 'll', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm', 'clear', 'reset', 'vi', 'vim', 'nano', 'edit', 'git'];
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

// Terminal input handling
term.onData(data => {
    const code = data.charCodeAt(0);
    
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

// Initialize when page loads
init();

