// The terminal: xterm.js + a readline-style line editor, pager, prompts and
// the network banners that tell students whether a remote is simulated or real.

import { Terminal } from '../../vendor/xterm-6.0.0.mjs';
import { FitAddon } from '../../vendor/xterm-addon-fit-0.11.0.mjs';
import { checkComplete } from '../shell/parse.js';
import { stripAnsi, visibleLength } from '../core/util.js';
import { L } from '../core/i18n.js';

const THEMES = {
    light: {
        background: '#16181d', foreground: '#e7e2d8', cursor: '#f2c14e', cursorAccent: '#16181d',
        selectionBackground: '#3a4152',
        black: '#1e2127', red: '#f0716a', green: '#7bd88f', yellow: '#e5c07b', blue: '#7aa7f7', magenta: '#c49cf2', cyan: '#6cc9d6', white: '#d9d4ca',
        brightBlack: '#8f8a80', brightRed: '#ff8b80', brightGreen: '#97e6a8', brightYellow: '#f2d394', brightBlue: '#9cbdfb', brightMagenta: '#d6b6f7', brightCyan: '#8fdbe5', brightWhite: '#ffffff',
    },
    dark: {
        background: '#0d0f12', foreground: '#e7e2d8', cursor: '#f2c14e', cursorAccent: '#0d0f12',
        selectionBackground: '#323947',
        black: '#1e2127', red: '#f0716a', green: '#7bd88f', yellow: '#e5c07b', blue: '#7aa7f7', magenta: '#c49cf2', cyan: '#6cc9d6', white: '#d9d4ca',
        brightBlack: '#8f8a80', brightRed: '#ff8b80', brightGreen: '#97e6a8', brightYellow: '#f2d394', brightBlue: '#9cbdfb', brightMagenta: '#d6b6f7', brightCyan: '#8fdbe5', brightWhite: '#ffffff',
    },
};

const MAX_KILL = 10;

export class TerminalView {
    constructor(container, { onLine, onInput, complete, getPrompt, getHistory, onInterrupt, theme = 'light' }) {
        this.onLine = onLine;
        this.onInput = onInput || (() => {});
        this.complete = complete;
        this.getPrompt = getPrompt;
        this.getHistory = getHistory;
        this.onInterrupt = onInterrupt || (() => {});
        this.line = '';
        this.cursor = 0;
        this.cursorRow = 0;
        this.continuation = '';
        this.historyIndex = null;
        this.savedLine = '';
        this.killRing = [];
        this.undoStack = [];
        this.mode = 'idle'; // idle | busy | pager | prompt | stdin | search
        this.queue = Promise.resolve();
        this.typeahead = [];
        this.term = new Terminal({
            fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace',
            fontSize: 14,
            lineHeight: 1.22,
            cursorBlink: true,
            cursorStyle: 'block',
            scrollback: 5000,
            allowProposedApi: false,
            // git's colours (dark red, blue …) must stay readable on the dark screen (WCAG AA)
            minimumContrastRatio: 4.5,
            theme: THEMES[theme],
            screenReaderMode: false,
        });
        this.fit = new FitAddon();
        this.term.loadAddon(this.fit);
        this.term.open(container);
        this.fitSoon();
        new ResizeObserver(() => this.fitSoon()).observe(container);
        this.term.onData(data => {
            this.queue = this.queue.then(() => this.handleData(data)).catch(e => console.error(e));
        });
        // Ctrl+C copies when text is selected; otherwise it goes to the shell
        this.term.attachCustomKeyEventHandler(ev => {
            if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'c' && this.term.hasSelection()) {
                navigator.clipboard?.writeText(this.term.getSelection()).catch(() => {});
                return false;
            }
            // let the browser's own paste event deliver the text (no literal ^V)
            if (ev.type === 'keydown' && (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'v') return false;
            return true;
        });
    }

    // xterm's accessibility mode: output is mirrored into a hidden list screen readers can read
    setScreenReader(on) {
        this.term.options.screenReaderMode = Boolean(on);
    }

    // keys from the on-screen key bar (touch devices)
    sendKeys(seq) {
        this.queue = this.queue.then(() => this.handleData(seq)).catch(e => console.error(e));
    }

    fitSoon() {
        cancelAnimationFrame(this.fitFrame);
        this.fitFrame = requestAnimationFrame(() => {
            try {
                this.fit.fit();
            } catch { /* not visible */ }
            if (this.mode === 'pager') this.renderPager();
        });
    }

    setTheme(theme) {
        this.term.options.theme = THEMES[theme] || THEMES.light;
    }

    columns() {
        return this.term.cols || 80;
    }

    focus() {
        this.term.focus();
    }

    write(text) {
        this.term.write(String(text).replace(/\r?\n/g, '\r\n'));
    }

    clear() {
        this.term.clear();
        this.term.write('\x1b[2J\x1b[H');
    }

    // ---- prompt / line rendering ------------------------------------------------------------

    promptText() {
        return this.continuation ? '> ' : this.getPrompt();
    }

    showPrompt() {
        this.mode = 'idle';
        this.line = '';
        this.cursor = 0;
        this.cursorRow = 0;
        this.historyIndex = null;
        this.undoStack = [];
        this.term.write(this.promptText());
        this.onInput(this.continuation + this.line, this.cursor);
        // replay keys typed while the last command was running
        if (this.typeahead.length) {
            const keys = this.typeahead.join('');
            this.typeahead = [];
            this.queue = this.queue.then(() => this.handleData(keys));
        }
    }

    // Repaints prompt + input. The input may wrap over several rows, so we remember
    // on which row (relative to the prompt) the cursor is and start from there.
    paint(prefix, text, cursor) {
        const cols = this.term.cols || 80;
        const plen = visibleLength(prefix);
        let out = this.cursorRow > 0 ? `\x1b[${this.cursorRow}A` : '';
        out += '\r\x1b[J' + prefix + text;
        const total = plen + text.length;
        // at the exact end of a row the terminal waits before wrapping: force the wrap
        if (total > 0 && total % cols === 0) out += '\r\n';
        const endRow = Math.floor(total / cols);
        const target = plen + cursor;
        const row = Math.floor(target / cols);
        const col = target % cols;
        if (endRow > row) out += `\x1b[${endRow - row}A`;
        out += '\r' + (col ? `\x1b[${col}C` : '');
        this.cursorRow = row;
        this.term.write(out);
    }

    redraw() {
        this.paint(this.promptText(), this.line, this.cursor);
        this.onInput(this.continuation + this.line, this.cursor);
    }

    // Moves the cursor behind the input (before Enter or ^C), so output starts below it.
    toEnd() {
        if (this.cursor !== this.line.length) {
            this.cursor = this.line.length;
            this.paint(this.promptText(), this.line, this.cursor);
        }
    }

    setInput(text, cursor = text.length) {
        if (this.mode !== 'idle') return;
        this.pushUndo();
        this.line = text;
        this.cursor = Math.max(0, Math.min(cursor, text.length));
        this.redraw();
        this.focus();
    }

    pushUndo() {
        this.undoStack.push({ line: this.line, cursor: this.cursor });
        if (this.undoStack.length > 50) this.undoStack.shift();
    }

    // ---- input dispatch -----------------------------------------------------------------------

    async handleData(data) {
        if (this.mode === 'pager') return this.pagerKey(data);
        if (this.mode === 'prompt') return this.promptKey(data);
        if (this.mode === 'stdin') return this.stdinKey(data);
        if (this.mode === 'busy') {
            if (data === '\x03') {
                this.term.write('^C');
                this.onInterrupt();
            } else {
                this.typeahead.push(data);
            }
            return;
        }
        if (this.mode === 'search') return this.searchKey(data);
        // escape sequences arrive as one chunk; pasted text is processed char by char
        if (data.length > 1 && data[0] === '\x1b') return this.escape(data);
        for (const ch of data) {
            if (this.mode !== 'idle') {
                this.typeahead.push(ch);
                continue;
            }
            await this.key(ch);
        }
    }

    async key(ch) {
        const code = ch.charCodeAt(0);
        switch (code) {
            case 13: // Enter
            case 10:
                return this.enter();
            case 3: // Ctrl+C
                this.toEnd();
                this.term.write('^C\r\n');
                this.continuation = '';
                this.showPrompt();
                return;
            case 4: // Ctrl+D
                if (!this.line) return;
                if (this.cursor < this.line.length) {
                    this.pushUndo();
                    this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1);
                    this.redraw();
                }
                return;
            case 9: // Tab
                return this.tab();
            case 127: // Backspace
            case 8:
                if (this.cursor > 0) {
                    this.pushUndo();
                    this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
                    this.cursor--;
                    this.redraw();
                }
                return;
            case 1: this.cursor = 0; return this.redraw(); // Ctrl+A
            case 5: this.cursor = this.line.length; return this.redraw(); // Ctrl+E
            case 2: if (this.cursor > 0) { this.cursor--; this.redraw(); } return; // Ctrl+B
            case 6: if (this.cursor < this.line.length) { this.cursor++; this.redraw(); } return; // Ctrl+F
            case 11: // Ctrl+K
                if (this.cursor < this.line.length) {
                    this.pushUndo();
                    this.kill(this.line.slice(this.cursor));
                    this.line = this.line.slice(0, this.cursor);
                    this.redraw();
                }
                return;
            case 21: // Ctrl+U
                if (this.cursor > 0) {
                    this.pushUndo();
                    this.kill(this.line.slice(0, this.cursor));
                    this.line = this.line.slice(this.cursor);
                    this.cursor = 0;
                    this.redraw();
                }
                return;
            case 23: return this.deleteWordBack(); // Ctrl+W (if the browser lets it through)
            case 25: { // Ctrl+Y
                const text = this.killRing[this.killRing.length - 1];
                if (text) this.insert(text);
                return;
            }
            case 12: // Ctrl+L
                this.term.write('\x1b[2J\x1b[H');
                this.cursorRow = 0;
                return this.redraw();
            case 16: return this.historyMove(-1); // Ctrl+P
            case 14: return this.historyMove(1); // Ctrl+N
            case 18: return this.startSearch(); // Ctrl+R
            case 20: return this.transpose(); // Ctrl+T
            case 31: { // Ctrl+_
                const s = this.undoStack.pop();
                if (s) { this.line = s.line; this.cursor = s.cursor; this.redraw(); }
                return;
            }
            case 27: return; // lone Escape
            default:
                if (code >= 32 && code !== 127) this.insert(ch);
        }
    }

    insert(text) {
        this.pushUndo();
        this.line = this.line.slice(0, this.cursor) + text + this.line.slice(this.cursor);
        this.cursor += text.length;
        const cols = this.term.cols || 80;
        const total = visibleLength(this.promptText()) + this.line.length;
        const startRow = Math.floor((total - text.length) / cols);
        // fast path: typing at the end of a line that stays on the same row
        if (this.cursor === this.line.length && !text.includes('\x1b') && Math.floor(total / cols) === startRow && total % cols !== 0 && this.cursorRow === startRow) {
            this.term.write(text);
            this.onInput(this.continuation + this.line, this.cursor);
        } else {
            this.redraw();
        }
    }

    kill(text) {
        this.killRing.push(text);
        if (this.killRing.length > MAX_KILL) this.killRing.shift();
    }

    wordLeft(pos) {
        let i = pos;
        while (i > 0 && this.line[i - 1] === ' ') i--;
        while (i > 0 && this.line[i - 1] !== ' ') i--;
        return i;
    }

    wordRight(pos) {
        let i = pos;
        while (i < this.line.length && this.line[i] === ' ') i++;
        while (i < this.line.length && this.line[i] !== ' ') i++;
        return i;
    }

    deleteWordBack() {
        if (!this.cursor) return;
        this.pushUndo();
        const start = this.wordLeft(this.cursor);
        this.kill(this.line.slice(start, this.cursor));
        this.line = this.line.slice(0, start) + this.line.slice(this.cursor);
        this.cursor = start;
        this.redraw();
    }

    transpose() {
        if (this.line.length < 2 || this.cursor === 0) return;
        this.pushUndo();
        const i = this.cursor >= this.line.length ? this.line.length - 1 : this.cursor;
        const chars = [...this.line];
        [chars[i - 1], chars[i]] = [chars[i], chars[i - 1]];
        this.line = chars.join('');
        this.cursor = Math.min(this.line.length, i + 1);
        this.redraw();
    }

    escape(seq) {
        const map = {
            '\x1b[A': () => this.historyMove(-1),
            '\x1b[B': () => this.historyMove(1),
            '\x1b[C': () => { if (this.cursor < this.line.length) { this.cursor++; this.redraw(); } },
            '\x1b[D': () => { if (this.cursor > 0) { this.cursor--; this.redraw(); } },
            '\x1b[H': () => { this.cursor = 0; this.redraw(); },
            '\x1bOH': () => { this.cursor = 0; this.redraw(); },
            '\x1b[1~': () => { this.cursor = 0; this.redraw(); },
            '\x1b[F': () => { this.cursor = this.line.length; this.redraw(); },
            '\x1bOF': () => { this.cursor = this.line.length; this.redraw(); },
            '\x1b[4~': () => { this.cursor = this.line.length; this.redraw(); },
            '\x1b[3~': () => {
                if (this.cursor < this.line.length) {
                    this.pushUndo();
                    this.line = this.line.slice(0, this.cursor) + this.line.slice(this.cursor + 1);
                    this.redraw();
                }
            },
            '\x1b[1;5C': () => { this.cursor = this.wordRight(this.cursor); this.redraw(); },
            '\x1b[1;5D': () => { this.cursor = this.wordLeft(this.cursor); this.redraw(); },
            '\x1b[1;3C': () => { this.cursor = this.wordRight(this.cursor); this.redraw(); },
            '\x1b[1;3D': () => { this.cursor = this.wordLeft(this.cursor); this.redraw(); },
            '\x1bf': () => { this.cursor = this.wordRight(this.cursor); this.redraw(); },
            '\x1bb': () => { this.cursor = this.wordLeft(this.cursor); this.redraw(); },
            '\x1bd': () => {
                const end = this.wordRight(this.cursor);
                if (end > this.cursor) {
                    this.pushUndo();
                    this.kill(this.line.slice(this.cursor, end));
                    this.line = this.line.slice(0, this.cursor) + this.line.slice(end);
                    this.redraw();
                }
            },
            '\x1b\x7f': () => this.deleteWordBack(),
            '\x1b.': () => {
                const hist = this.getHistory();
                const last = hist[hist.length - 1] || '';
                const words = last.trim().split(/\s+/);
                if (words.length) this.insert(words[words.length - 1]);
            },
        };
        const fn = map[seq];
        if (fn) return fn();
        // a pasted chunk that starts with ESC: treat the rest as text
        if (!seq.startsWith('\x1b[') && !seq.startsWith('\x1bO')) {
            for (const ch of seq.slice(1)) this.key(ch);
        }
    }

    historyMove(dir) {
        const hist = this.getHistory();
        if (!hist.length) return;
        if (this.historyIndex === null) {
            if (dir > 0) return;
            this.savedLine = this.line;
            this.historyIndex = hist.length;
        }
        const next = this.historyIndex + dir;
        if (next < 0) return;
        if (next >= hist.length) {
            this.historyIndex = null;
            this.line = this.savedLine;
        } else {
            this.historyIndex = next;
            this.line = hist[next];
        }
        this.cursor = this.line.length;
        this.redraw();
    }

    // ---- reverse history search (Ctrl+R) ----------------------------------------------------------

    startSearch() {
        this.mode = 'search';
        this.search = { query: '', index: this.getHistory().length, saved: this.line, failed: false };
        this.renderSearch();
    }

    renderSearch() {
        const { query, failed } = this.search;
        const label = failed ? '(failed reverse-i-search)' : '(reverse-i-search)';
        this.paint(`\x1b[33m${label}\`${query}'\x1b[0m: `, this.line, this.line.length);
    }

    findSearch(fromIndex) {
        const hist = this.getHistory();
        const q = this.search.query.toLowerCase();
        for (let i = Math.min(fromIndex, hist.length) - 1; i >= 0; i--) {
            if (hist[i].toLowerCase().includes(q)) {
                this.search.index = i;
                this.line = hist[i];
                this.search.failed = false;
                return;
            }
        }
        this.search.failed = true;
    }

    searchKey(data) {
        const code = data.charCodeAt(0);
        if (data === '\x12') { this.findSearch(this.search.index); return this.renderSearch(); }
        if (code === 13) {
            this.mode = 'idle';
            this.cursor = this.line.length;
            this.redraw();
            return this.enter();
        }
        if (data === '\x07' || data === '\x03' || data === '\x1b') {
            this.mode = 'idle';
            this.line = this.search.saved;
            this.cursor = this.line.length;
            return this.redraw();
        }
        if (code === 127) {
            this.search.query = this.search.query.slice(0, -1);
            this.findSearch(this.getHistory().length);
            return this.renderSearch();
        }
        if (data.startsWith('\x1b') || code < 32) {
            // accept and continue editing
            this.mode = 'idle';
            this.cursor = this.line.length;
            this.redraw();
            if (data.startsWith('\x1b')) return this.escape(data);
            return this.key(data);
        }
        this.search.query += data;
        this.findSearch(this.getHistory().length);
        this.renderSearch();
    }

    // ---- tab completion -------------------------------------------------------------------------

    async tab() {
        if (!this.complete) return;
        const res = await this.complete(this.line, this.cursor);
        if (!res || !res.candidates.length) {
            this.term.write('\x07');
            return;
        }
        const { from, candidates } = res;
        const typed = this.line.slice(from, this.cursor);
        let common = candidates[0].value;
        for (const c of candidates) {
            let i = 0;
            while (i < common.length && i < c.value.length && common[i] === c.value[i]) i++;
            common = common.slice(0, i);
        }
        if (candidates.length === 1) {
            const c = candidates[0];
            const text = c.value + (c.suffix ?? ' ');
            this.line = this.line.slice(0, from) + text + this.line.slice(this.cursor);
            this.cursor = from + text.length;
            return this.redraw();
        }
        if (common.length > typed.length) {
            this.line = this.line.slice(0, from) + common + this.line.slice(this.cursor);
            this.cursor = from + common.length;
            return this.redraw();
        }
        // show the options like bash does
        const names = candidates.map(c => c.display || c.value);
        const width = Math.max(...names.map(n => n.length)) + 2;
        const cols = Math.max(1, Math.floor(this.columns() / width));
        let out = '\r\n';
        names.forEach((n, i) => { out += n.padEnd(width) + ((i + 1) % cols === 0 ? '\r\n' : ''); });
        if (names.length % cols) out += '\r\n';
        this.toEnd();
        this.term.write(out);
        this.cursorRow = 0;
        this.redraw();
    }

    // ---- running a line ---------------------------------------------------------------------------

    // bash history expansion (!!, !n, !-n, !prefix) – not inside single quotes
    expandHistory(line) {
        const hist = this.getHistory();
        let changed = false;
        const parts = line.split(/('[^']*')/);
        const out = parts.map(part => {
            if (part.startsWith("'") && part.endsWith("'") && part.length > 1) return part;
            return part.replace(/(^|[^\\])!(!|-?\d+|[A-Za-z][^\s"'()]*)/g, (m, pre, ref) => {
                let hit = null;
                if (ref === '!') hit = hist[hist.length - 1];
                else if (/^-\d+$/.test(ref)) hit = hist[hist.length + Number(ref)];
                else if (/^\d+$/.test(ref)) hit = hist[Number(ref) - 1];
                else hit = [...hist].reverse().find(h => h.startsWith(ref));
                if (hit === undefined || hit === null) throw new Error(`bash: !${ref}: event not found`);
                changed = true;
                return pre + hit;
            });
        }).join('');
        return { line: out, changed };
    }

    async enter() {
        this.toEnd();
        this.term.write('\r\n');
        this.cursorRow = 0;
        const full = this.continuation + this.line;
        if (!checkComplete(full).complete) {
            this.continuation = full + '\n';
            this.line = '';
            this.cursor = 0;
            this.term.write('> ');
            this.onInput(this.continuation, 0);
            return;
        }
        this.continuation = '';
        let line = full;
        if (/![!\-\w]/.test(line) && !/^\s*#/.test(line)) {
            try {
                const res = this.expandHistory(line);
                if (res.changed) {
                    line = res.line;
                    this.term.write(line + '\r\n');
                }
            } catch (e) {
                this.write(e.message + '\n');
                return this.showPrompt();
            }
        }
        this.mode = 'busy';
        this.onInput('', 0);
        try {
            await this.onLine(line);
        } catch (e) {
            console.error(e);
            this.write(`\x1b[31minternal error: ${e.message}\x1b[0m\n`);
        }
        if (this.mode === 'busy') this.showPrompt();
    }

    // ---- pager (less, man, long git output) ------------------------------------------------------

    page(text, { title = '' } = {}) {
        return new Promise(resolve => {
            this.pager = { lines: String(text).replace(/\n$/, '').split('\n'), top: 0, title, resolve };
            this.mode = 'pager';
            this.term.write('\x1b[?1049h\x1b[H');
            this.renderPager();
        });
    }

    renderPager() {
        const p = this.pager;
        if (!p) return;
        const rows = Math.max(3, this.term.rows - 1);
        p.top = Math.max(0, Math.min(p.top, Math.max(0, p.lines.length - rows)));
        let out = '\x1b[H\x1b[2J';
        for (let i = 0; i < rows; i++) {
            const line = p.lines[p.top + i];
            out += (line === undefined ? '\x1b[90m~\x1b[0m' : line) + '\x1b[K\r\n';
        }
        const atEnd = p.top + rows >= p.lines.length;
        const pct = Math.min(100, Math.round(((p.top + rows) / Math.max(1, p.lines.length)) * 100));
        const status = atEnd ? '(END)' : `${p.title ? p.title + ' ' : ''}${pct}%`;
        const help = L({ de: 'Leertaste weiter · b zurück · ↑↓ Zeile · q beenden', en: 'space next · b back · ↑↓ line · q quit' });
        out += `\x1b[7m${status}\x1b[0m \x1b[90m${help}\x1b[0m\x1b[K`;
        this.term.write(out.replace(/\r\n$/, ''));
    }

    pagerKey(data) {
        const p = this.pager;
        const rows = Math.max(3, this.term.rows - 1);
        const keys = {
            q: 'quit', Q: 'quit', '\x03': 'quit', '\x1b': 'quit',
            ' ': 'page', f: 'page', '\x1b[6~': 'page', '\x06': 'page',
            b: 'back', '\x1b[5~': 'back', '\x02': 'back',
            '\r': 'down', j: 'down', '\x1b[B': 'down', '\x0e': 'down',
            k: 'up', '\x1b[A': 'up', '\x10': 'up', y: 'up',
            g: 'top', '<': 'top', '\x1b[H': 'top',
            G: 'bottom', '>': 'bottom', '\x1b[F': 'bottom',
        };
        const action = keys[data];
        if (!action) return;
        if (action === 'quit') {
            this.term.write('\x1b[?1049l');
            this.mode = 'busy';
            const done = p.resolve;
            this.pager = null;
            done();
            return;
        }
        if (action === 'page') p.top += rows;
        if (action === 'back') p.top -= rows;
        if (action === 'down') p.top += 1;
        if (action === 'up') p.top -= 1;
        if (action === 'top') p.top = 0;
        if (action === 'bottom') p.top = p.lines.length;
        this.renderPager();
    }

    // ---- prompts (credentials) and interactive stdin ----------------------------------------------

    prompt({ text, secret = false }) {
        return new Promise(resolve => {
            this.write(text);
            this.promptState = { secret, value: '', resolve, prevMode: this.mode };
            this.mode = 'prompt';
        });
    }

    promptKey(data) {
        const st = this.promptState;
        for (const ch of data) {
            const code = ch.charCodeAt(0);
            if (code === 13 || code === 10) {
                this.term.write('\r\n');
                this.mode = st.prevMode;
                this.promptState = null;
                return st.resolve(st.value);
            }
            if (code === 3) {
                this.term.write('^C\r\n');
                this.mode = st.prevMode;
                this.promptState = null;
                return st.resolve(null);
            }
            if (code === 127) {
                if (st.value) {
                    st.value = st.value.slice(0, -1);
                    if (!st.secret) this.term.write('\b \b');
                }
                continue;
            }
            if (code >= 32) {
                st.value += ch;
                if (!st.secret) this.term.write(ch);
            }
        }
    }

    readInteractive({ signal } = {}) {
        return new Promise(resolve => {
            this.stdinState = { text: '', line: '', resolve, prevMode: this.mode };
            this.mode = 'stdin';
            signal?.addEventListener('abort', () => this.finishStdin(true), { once: true });
        });
    }

    finishStdin(aborted = false) {
        const st = this.stdinState;
        if (!st) return;
        this.stdinState = null;
        this.mode = st.prevMode === 'stdin' ? 'busy' : st.prevMode;
        st.resolve(aborted ? '' : st.text);
    }

    stdinKey(data) {
        const st = this.stdinState;
        for (const ch of data) {
            const code = ch.charCodeAt(0);
            if (code === 4) { // Ctrl+D
                if (st.line) { st.text += st.line; st.line = ''; }
                this.term.write('\r\n');
                return this.finishStdin();
            }
            if (code === 3) {
                this.term.write('^C\r\n');
                this.onInterrupt();
                return this.finishStdin(true);
            }
            if (code === 13 || code === 10) {
                st.text += st.line + '\n';
                st.line = '';
                this.term.write('\r\n');
                continue;
            }
            if (code === 127) {
                if (st.line) { st.line = st.line.slice(0, -1); this.term.write('\b \b'); }
                continue;
            }
            if (code >= 32) {
                st.line += ch;
                this.term.write(ch);
            }
        }
    }

    // Writes something above the input line without losing what the student has typed.
    interject(writeFn) {
        if (this.mode !== 'idle') return writeFn();
        this.term.write((this.cursorRow > 0 ? `\x1b[${this.cursorRow}A` : '') + '\r\x1b[J');
        this.cursorRow = 0;
        writeFn();
        this.redraw();
    }

    // ---- annotations: lines that belong to the Werkstatt, not to the program ---------------------

    annotate(note) {
        if (note.type === 'network') {
            const sim = note.kind === 'simulated';
            const badge = sim
                ? '\x1b[48;2;105;65;198m\x1b[38;2;255;255;255m\x1b[1m ' + L({ de: 'SIMULIERT', en: 'SIMULATED' }) + ' \x1b[0m'
                : '\x1b[48;2;231;226;216m\x1b[38;2;22;24;29m\x1b[1m ' + L({ de: 'ECHTES NETZ', en: 'REAL NETWORK' }) + ' \x1b[0m';
            const text = sim
                ? L({ de: `${note.host} ist ein simulierter Server – alles bleibt in deinem Browser.`, en: `${note.host} is a simulated server – nothing leaves your browser.` })
                : L({ de: `Verbindung zu ${note.host} über das Internet (via CORS-Proxy).`, en: `Connecting to ${note.host} over the internet (via CORS proxy).` });
            this.write(`${badge} \x1b[38;2;160;154;142m${text}\x1b[0m\n`);
        } else if (note.type === 'credentials') {
            this.write(`\x1b[38;2;160;154;142m${L({
                de: `Hinweis: ${note.host} verlangt eine Anmeldung. Statt des Passworts brauchst du ein Personal Access Token. Es wird nicht gespeichert, läuft aber über den CORS-Proxy der Schule.`,
                en: `Note: ${note.host} needs a login. Use a personal access token instead of your password. It is not stored, but it passes through the school's CORS proxy.`,
            })}\x1b[0m\n`);
        } else if (note.type === 'team') {
            const badge = '\x1b[48;2;105;65;198m\x1b[38;2;255;255;255m\x1b[1m ' + L({ de: 'SIMULIERT', en: 'SIMULATED' }) + ' \x1b[0m';
            const who = note.person?.name || 'Team';
            const text = L({ de: `${who} hat auf ${note.branch} gepusht (Teammitglied, simuliert).`, en: `${who} pushed to ${note.branch} (teammate, simulated).` });
            this.write(`${badge} \x1b[35m${text}\x1b[0m\n`);
        } else if (note.type === 'system') {
            this.write(`\x1b[38;2;160;154;142m${note.text}\x1b[0m\n`);
        }
    }

    visibleText() {
        const buf = this.term.buffer.active;
        const lines = [];
        for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
        return stripAnsi(lines.join('\n'));
    }
}
