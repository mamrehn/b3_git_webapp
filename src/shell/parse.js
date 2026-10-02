// Shell parser: turns a command line into a list of pipelines.
//
//   script   := list
//   list     := pipeline ( (';' | '&' | '&&' | '||' | NEWLINE) pipeline )*
//   pipeline := ['!'] command ( '|' command )*
//   command  := (NAME=word)* ( word | redirect )*
//
// A word is a list of segments so that later expansion knows what was quoted:
//   { t: 'lit', v, q }   literal text, q = false | "'" | '"'
//   { t: 'var', name, q } $NAME / ${NAME} / $? / $$ / $#
//   { t: 'sub', src, q }  $(command) or `command`

export class ParseError extends Error {
    constructor(message, { incomplete = false, pos = 0 } = {}) {
        super(message);
        this.incomplete = incomplete;
        this.pos = pos;
    }
}

const OPERATORS = ['&&', '||', ';;', '|', ';', '&', '\n'];

function isSpace(c) {
    return c === ' ' || c === '\t' || c === '\r';
}

function isNameStart(c) {
    return /[A-Za-z_]/.test(c);
}

function isNameChar(c) {
    return /[A-Za-z0-9_]/.test(c);
}

// --- lexer -------------------------------------------------------------------

function lex(src) {
    const tokens = [];
    let i = 0;

    function readSubstitution(open, close) {
        // i points just after the opening sequence; returns inner source
        let depth = 1;
        let j = i;
        let quote = null;
        while (j < src.length) {
            const c = src[j];
            if (quote) {
                if (c === '\\' && quote === '"') { j += 2; continue; }
                if (c === quote) quote = null;
                j++;
                continue;
            }
            if (c === "'" || c === '"') { quote = c; j++; continue; }
            if (c === '\\') { j += 2; continue; }
            if (open && src.startsWith(open, j)) { depth++; j += open.length; continue; }
            if (src.startsWith(close, j)) {
                depth--;
                if (depth === 0) {
                    const inner = src.slice(i, j);
                    i = j + close.length;
                    return inner;
                }
            }
            j++;
        }
        throw new ParseError(`unexpected EOF while looking for matching \`${close}'`, { incomplete: true, pos: i });
    }

    function readVariable(q, segs) {
        // i points at '$'
        const next = src[i + 1];
        if (next === '(') {
            i += 2;
            segs.push({ t: 'sub', src: readSubstitution('(', ')'), q });
            return true;
        }
        if (next === '{') {
            const end = src.indexOf('}', i + 2);
            if (end === -1) throw new ParseError('bad substitution', { incomplete: true, pos: i });
            segs.push({ t: 'var', name: src.slice(i + 2, end), q });
            i = end + 1;
            return true;
        }
        if (next === '?' || next === '$' || next === '#' || next === '@' || next === '*' || /[0-9]/.test(next || '')) {
            segs.push({ t: 'var', name: next, q });
            i += 2;
            return true;
        }
        if (next && isNameStart(next)) {
            let j = i + 1;
            while (j < src.length && isNameChar(src[j])) j++;
            segs.push({ t: 'var', name: src.slice(i + 1, j), q });
            i = j;
            return true;
        }
        return false;
    }

    while (i < src.length) {
        const c = src[i];
        if (isSpace(c)) { i++; continue; }
        if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
        if (c === '#') {
            // comment until end of line
            while (i < src.length && src[i] !== '\n') i++;
            continue;
        }
        // redirections, possibly with a leading file descriptor number
        const redir = src.slice(i).match(/^(\d?)(>>|>&|<&|&>|>\||>|<)(\d|-)?/);
        if (redir && (redir[1] || !/\d/.test(c))) {
            let [whole, fd, op, dupTarget] = redir;
            if (!(op === '>&' || op === '<&')) {
                // a digit after a plain > is the start of a filename, not a dup target
                whole = fd + op;
                dupTarget = undefined;
            }
            tokens.push({ type: 'redir', fd: fd === '' ? null : Number(fd), op, dup: dupTarget, start: i, end: i + whole.length });
            i += whole.length;
            continue;
        }
        const op = OPERATORS.find(o => src.startsWith(o, i));
        if (op) {
            tokens.push({ type: 'op', v: op === ';;' ? ';' : op, start: i, end: i + op.length });
            i += op.length;
            continue;
        }
        // a word
        const start = i;
        const segs = [];
        let lit = '';
        const flush = (q = false) => {
            if (lit) { segs.push({ t: 'lit', v: lit, q }); lit = ''; }
        };
        while (i < src.length) {
            const ch = src[i];
            if (isSpace(ch) || ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '<' || ch === '>') break;
            if (ch === '\\') {
                if (i + 1 >= src.length) throw new ParseError('unexpected end after backslash', { incomplete: true, pos: i });
                if (src[i + 1] === '\n') { i += 2; continue; }
                flush();
                segs.push({ t: 'lit', v: src[i + 1], q: '\\' });
                i += 2;
                continue;
            }
            if (ch === "'") {
                flush();
                const end = src.indexOf("'", i + 1);
                if (end === -1) throw new ParseError("unexpected EOF while looking for matching `''", { incomplete: true, pos: i });
                segs.push({ t: 'lit', v: src.slice(i + 1, end), q: "'" });
                i = end + 1;
                continue;
            }
            if (ch === '"') {
                flush();
                i++;
                let dq = '';
                let closed = false;
                while (i < src.length) {
                    const d = src[i];
                    if (d === '"') { closed = true; i++; break; }
                    if (d === '\\' && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
                        if (src[i + 1] !== '\n') dq += src[i + 1];
                        i += 2;
                        continue;
                    }
                    if (d === '$') {
                        if (dq) { segs.push({ t: 'lit', v: dq, q: '"' }); dq = ''; }
                        if (readVariable('"', segs)) continue;
                        dq += d; i++;
                        continue;
                    }
                    if (d === '`') {
                        if (dq) { segs.push({ t: 'lit', v: dq, q: '"' }); dq = ''; }
                        i++;
                        segs.push({ t: 'sub', src: readSubstitution(null, '`'), q: '"' });
                        continue;
                    }
                    dq += d;
                    i++;
                }
                if (!closed) throw new ParseError('unexpected EOF while looking for matching `"\'', { incomplete: true, pos: i });
                // keep empty "" as an (empty) word segment
                segs.push({ t: 'lit', v: dq, q: '"' });
                continue;
            }
            if (ch === '$') {
                flush();
                if (readVariable(false, segs)) continue;
                lit += ch; i++;
                continue;
            }
            if (ch === '`') {
                flush();
                i++;
                segs.push({ t: 'sub', src: readSubstitution(null, '`'), q: false });
                continue;
            }
            lit += ch;
            i++;
        }
        flush();
        tokens.push({ type: 'word', segs, start, end: i, raw: src.slice(start, i) });
    }
    return tokens;
}

// --- parser ------------------------------------------------------------------

function wordText(word) {
    // Literal text of a word if it has no expansions, else null
    if (!word.segs.every(s => s.t === 'lit')) return null;
    return word.segs.map(s => s.v).join('');
}

function assignmentOf(word) {
    const first = word.segs[0];
    if (!first || first.t !== 'lit' || first.q) return null;
    const m = first.v.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) return null;
    const rest = first.v.slice(m[0].length);
    const valueSegs = (rest ? [{ ...first, v: rest }] : []).concat(word.segs.slice(1));
    return { name: m[1], value: { segs: valueSegs.length ? valueSegs : [{ t: 'lit', v: '', q: '"' }] } };
}

export function parse(src) {
    const tokens = lex(src);
    const list = [];
    let pos = 0;

    function parseCommand() {
        const cmd = { assigns: [], words: [], redirects: [], start: null, end: null };
        while (pos < tokens.length) {
            const tok = tokens[pos];
            if (tok.type === 'op') break;
            cmd.start ??= tok.start;
            cmd.end = tok.end;
            if (tok.type === 'redir') {
                pos++;
                if (tok.dup !== undefined) {
                    cmd.redirects.push({ fd: tok.fd ?? (tok.op === '<&' ? 0 : 1), op: tok.op, dup: tok.dup });
                    continue;
                }
                const target = tokens[pos];
                if (!target || target.type !== 'word') {
                    if (!target) throw new ParseError("syntax error near unexpected token `newline'", { pos: tok.end });
                    throw new ParseError(`syntax error near unexpected token \`${target.v ?? target.op}'`, { pos: target.start });
                }
                cmd.redirects.push({ fd: tok.fd, op: tok.op, target });
                cmd.end = target.end;
                pos++;
                continue;
            }
            if (cmd.words.length === 0) {
                const assign = assignmentOf(tok);
                if (assign) {
                    cmd.assigns.push(assign);
                    pos++;
                    continue;
                }
            }
            cmd.words.push(tok);
            pos++;
        }
        return cmd;
    }

    function parsePipeline() {
        const pipeline = { negate: false, cmds: [] };
        if (tokens[pos]?.type === 'word' && wordText(tokens[pos]) === '!') {
            pipeline.negate = true;
            pos++;
        }
        for (;;) {
            const cmd = parseCommand();
            if (!cmd.words.length && !cmd.assigns.length && !cmd.redirects.length) {
                const tok = tokens[pos];
                if (tok) throw new ParseError(`syntax error near unexpected token \`${tok.v === '\n' ? 'newline' : tok.v}'`, { pos: tok.start });
                if (pipeline.cmds.length) throw new ParseError('unexpected end after |', { incomplete: true, pos: src.length });
                return null;
            }
            pipeline.cmds.push(cmd);
            if (tokens[pos]?.type === 'op' && tokens[pos].v === '|') {
                pos++;
                if (pos >= tokens.length) throw new ParseError('unexpected end after |', { incomplete: true, pos: src.length });
                continue;
            }
            return pipeline;
        }
    }

    while (pos < tokens.length) {
        if (tokens[pos].type === 'op' && (tokens[pos].v === '\n' || tokens[pos].v === ';')) {
            if (tokens[pos].v === ';' && list.length === 0) {
                throw new ParseError("syntax error near unexpected token `;'", { pos: tokens[pos].start });
            }
            pos++;
            continue;
        }
        const pipeline = parsePipeline();
        if (!pipeline) break;
        const sep = tokens[pos];
        let op = ';';
        if (sep && sep.type === 'op') {
            op = sep.v === '\n' ? ';' : sep.v;
            pos++;
            if ((op === '&&' || op === '||') && pos >= tokens.length) {
                throw new ParseError(`unexpected end after ${op}`, { incomplete: true, pos: src.length });
            }
        }
        list.push({ pipeline, op });
    }
    return list;
}

// Is the line complete, or does the user still need to type more (open quote, trailing |)?
export function checkComplete(src) {
    try {
        parse(src);
        return { complete: true };
    } catch (e) {
        if (e instanceof ParseError && e.incomplete) return { complete: false, reason: e.message };
        return { complete: true };
    }
}

// Best-effort split of a (possibly incomplete) line into words with positions;
// used by tab completion and the live explanation bar.
export function looseWords(src) {
    const words = [];
    let i = 0;
    let cmdIndex = 0;
    while (i < src.length) {
        const c = src[i];
        if (isSpace(c)) { i++; continue; }
        if ('|;&'.includes(c)) {
            let j = i;
            while (j < src.length && '|;&'.includes(src[j])) j++;
            words.push({ op: src.slice(i, j), start: i, end: j });
            cmdIndex++;
            i = j;
            continue;
        }
        const start = i;
        let text = '';
        let quote = null;
        while (i < src.length) {
            const ch = src[i];
            if (quote) {
                if (ch === quote) { quote = null; i++; continue; }
                if (ch === '\\' && quote === '"' && i + 1 < src.length) { text += src[i + 1]; i += 2; continue; }
                text += ch; i++;
                continue;
            }
            if (isSpace(ch) || '|;&'.includes(ch)) break;
            if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
            if (ch === '\\' && i + 1 < src.length) { text += src[i + 1]; i += 2; continue; }
            text += ch;
            i++;
        }
        words.push({ text, start, end: i, quoted: src[start] === '"' || src[start] === "'", openQuote: quote, cmd: cmdIndex });
    }
    return words;
}

export { wordText };
