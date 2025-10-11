# Git Learning Terminal

An interactive web-based terminal application for learning Git commands in a safe, sandboxed environment. Perfect for embedding in Learning Management Systems (LMS) via iframe.

## Features

### 🎯 Core Functionality
- **Full Terminal Emulation**: Powered by xterm.js for a realistic terminal experience
- **Git Operations**: Implemented using isomorphic-git for authentic Git behavior
- **🆕 Real GitHub Integration**: Automatically clones actual repositories from GitHub using CORS proxy
- **In-Browser File System**: Uses LightningFS (IndexedDB) for persistent storage within the session
- **Safe Learning Environment**: Nothing can break - resets on page reload

### 📁 File System Commands
- `ls` - List directory contents (use `-a` for hidden files)
- `ll` - Alias for `ls -la` (list all with details)
- `cd` - Change directory
- `pwd` - Print working directory
- `cat` - Display file contents
- `mkdir` - Create directories
- `touch` - Create empty files
- `rm` - Remove files
- `vi/vim/nano/edit` - Open the built-in text editor
- `history` - Show command history
- `clear` - Clear terminal screen
- `reset` - Reset filesystem to initial state

### 🔧 Git Commands
**Repository Setup & Configuration**
- `git init` - Initialize a repository
- `git config` - Get and set configuration options

**Basic Snapshotting**
- `git status` - Show working tree status
- `git add` - Stage files
- `git commit` - Commit changes
- `git diff` - Show changes
- `git reset` - Unstage files
- `git rm` - Remove files from working tree and index
- `git mv` - Move or rename files

**Branching & Merging**
- `git branch` - List/create branches
- `git checkout` - Switch branches
- `git merge` - Merge branches

**Inspecting & Comparing**
- `git log` - View commit history
- `git show` - Show commit details
- `git tag` - Create or list tags

**Sharing & Updating**
- `git remote` - Manage remotes (simulated)
- `git fetch` - Download objects from remote (simulated)
- `git push` - Push to remote (simulated)
- `git pull` - Pull from remote (simulated)
- `git clone` - Clone repository (simulated)

**Temporary Commits**
- `git stash` - Stash changes (simulated)

### 🎨 Learning Features
- **Color-Coded Output**:
  - White text: Standard Git output
  - Green text: Educational hints and tips
  - Red text: Errors and warnings
- **Contextual Hints**: Automatic hints after commands to guide learning
- **File Tree View**: Real-time visualization of the project structure with clickable files
- **Syntax Highlighting**: Code editor with support for HTML, CSS, JavaScript, Python, Markdown, and Shell
- **Hidden Files Display**: Shows `.git/`, `.gitignore`, etc. (but not `.git/` contents)
- **Advanced Terminal Features**:
  - Tab completion for commands and files
  - Command history navigation (↑/↓ arrow keys)
  - Reverse history search (Ctrl+R)
  - Cursor positioning (←/→ arrow keys)
  - Pipe support for filtering (`history | grep pattern`)

### 📚 Pre-configured Projects
- **project1**: 🆕 **Cloned from real GitHub repository!**
  - Automatically clones `https://github.com/mamrehn/project1.git`
  - Real commit history from GitHub
  - Authentic Git repository experience
  - Uses CORS proxy for browser access
  - Falls back to sample project if cloning fails
- **project2**: Empty directory for students to initialize themselves

## Installation

Simply open `index.html` in a web browser. No build process or server required!

### For LMS Integration
Embed using an iframe:

```html
<iframe src="path/to/index.html" width="100%" height="800px" frameborder="0"></iframe>
```

## Usage

1. **Start Exploring**: The terminal opens in the home directory with two projects available
2. **Navigate**: Use `cd project1` or `cd project2` to enter a project
3. **Try Git Commands**: All basic Git operations are available
4. **Edit Files**: Use `vi filename.txt` or `nano filename.txt` to open the editor
5. **View File Tree**: The left panel shows the current directory structure in real-time

## Learning Path Suggestions

### Beginners
1. Start in `project1` and use `git status` to see the current state
2. Use `git log` to see existing commits
3. Modify `index.html` using `vi index.html`
4. Practice staging and committing: `git add index.html`, then `git commit -m "My change"`

### Intermediate
1. Navigate to `project2` and initialize Git: `git init`
2. Create files: `touch README.md`
3. Practice the full workflow: create → add → commit
4. Experiment with branches: `git branch feature`, `git checkout feature`

### Advanced
1. Practice with remotes (simulated): `git remote add origin <url>`
2. Try push/pull operations
3. Experiment with `git reset` and `git diff`
4. Create multiple branches and switch between them

## Technical Details

### Technologies Used
- **xterm.js**: Terminal emulation
- **isomorphic-git**: Git implementation for browsers
- **LightningFS**: In-memory/IndexedDB file system
- **Vanilla JavaScript**: No framework dependencies

### Browser Compatibility
- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support

### Limitations
- File system resets on page reload (intentional for learning)
- No actual remote server communication (simulated for safety)
- Large file operations may be slower than native Git

## Customization

### Changing Pre-loaded Content
Edit the `setupProject1()` function in `app.js` to modify the initial repository state.

### Adding New Commands
Extend the `processCommand()` function to add custom commands or Git workflows.

### Modifying Hints
Edit the hint messages throughout `app.js` - all hints use the `printHint()` function with green color.

## License

Free to use for educational purposes.

## Contributing

This is an educational tool. Feel free to fork and adapt for your teaching needs!
