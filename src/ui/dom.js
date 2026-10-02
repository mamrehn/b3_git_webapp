// Tiny DOM helpers – no framework.

export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
    }
    append(el, children);
    return el;
}

export function append(el, children) {
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false) continue;
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, String(v));
    }
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false) continue;
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

export function replace(el, ...children) {
    clear(el);
    return append(el, children);
}

// Icons: 24×24 grid, 1.6px strokes, drawn for this app.
const PATHS = {
    folder: 'M3.5 6.5a1 1 0 0 1 1-1h4.2l1.8 2h9a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z',
    folderOpen: 'M3.5 6.5a1 1 0 0 1 1-1h4.2l1.8 2h8a1 1 0 0 1 1 1v1.5M3.5 18.5l2.4-8a1 1 0 0 1 1-.7h13.6a.6.6 0 0 1 .6.8l-2.3 7.4a1 1 0 0 1-1 .7H4.5a1 1 0 0 1-1-1V6.5',
    file: 'M6.5 3.5h7l4 4v12a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM13.5 3.5v4h4',
    branch: 'M7 4v10M7 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 8c0 5-10 3-10 7',
    commit: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM3 12h6M15 12h6',
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4.5h4.5',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.2v.3',
    sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.5 5.6 12 3z',
    flask: 'M9.5 3.5h5M10.5 3.5v5.2L5.2 18a1.6 1.6 0 0 0 1.4 2.5h10.8a1.6 1.6 0 0 0 1.4-2.5L13.5 8.7V3.5M7.5 14.5h9',
    flag: 'M5.5 21V4.5M5.5 4.5h11l-2 4 2 4h-11',
    map: 'M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2zM9 4.5v13M15 6.5v13',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6 6 18',
    warn: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.3',
    terminal: 'M3.5 5.5h17v13h-17zM7 9.5l3 2.5-3 2.5M12.5 15h4.5',
    expand: 'M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5 13 11M4.5 19.5 11 13',
    collapse: 'M20 4l-6 6M14 5.5V10h4.5M4 20l6-6M10 18.5V14H5.5',
    save: 'M5 3.5h11l3.5 3.5v12.5a1 1 0 0 1-1 1h-13.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM8 3.5v5h7v-5M7.5 20.5v-6h9v6',
    lightbulb: 'M9.5 18h5M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9v.2h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z',
    arrowRight: 'M4 12h15M14 7l5 5-5 5',
    arrowLeft: 'M20 12H5M10 7l-5 5 5 5',
    server: 'M4.5 4.5h15v6h-15zM4.5 13.5h15v6h-15zM8 7.5h.01M8 16.5h.01',
    menu: 'M4 7h16M4 12h16M4 17h16',
    sidebar: 'M3.5 4.5h17v15h-17zM9 4.5v15',
    stash: 'M4 8.5h16v11H4zM2.5 4.5h19v4h-19zM10 12.5h4',
    tag: 'M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.4 7.4a1 1 0 0 1-1.4 0zM8 8h.01',
    play: 'M7 4.5v15l12-7.5z',
    book: 'M4.5 4.5h6a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4.5zM19.5 4.5h-6a2 2 0 0 0-1 .3M19.5 4.5V18h-6.5a1.5 1.5 0 0 0-1.5 1.5',
};

export function icon(name, cls = 'icon') {
    const d = PATHS[name] || PATHS.file;
    return s('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d }));
}

// The wordmark: three stations on two metro lines (a branch that merges back).
export function logo() {
    return s('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
        s('path', { d: 'M5 22h22', stroke: 'var(--line-0)', 'stroke-width': '4', 'stroke-linecap': 'round', fill: 'none' }),
        s('path', { d: 'M9 22c0-8 5-11 9-11s6 4 6 11', stroke: 'var(--line-1)', 'stroke-width': '4', 'stroke-linecap': 'round', fill: 'none' }),
        s('circle', { cx: '9', cy: '22', r: '3.4', fill: 'var(--sheet)', stroke: 'var(--ink)', 'stroke-width': '2' }),
        s('circle', { cx: '18', cy: '11', r: '3.4', fill: 'var(--sheet)', stroke: 'var(--ink)', 'stroke-width': '2' }),
        s('circle', { cx: '24', cy: '22', r: '3.4', fill: 'var(--ink)', stroke: 'var(--ink)', 'stroke-width': '2' }));
}

// minimal markdown: **bold**, *em*, `code`, [[term]], paragraphs and "- " lists
export function md(text, { onCode, onTerm } = {}) {
    const frag = document.createDocumentFragment();
    const blocks = String(text || '').trim().split(/\n{2,}/);
    for (const block of blocks) {
        const lines = block.split('\n');
        if (lines.every(l => /^\s*[-•]\s/.test(l))) {
            const ul = h('ul');
            for (const l of lines) ul.appendChild(inline(h('li'), l.replace(/^\s*[-•]\s/, ''), { onCode, onTerm }));
            frag.appendChild(ul);
        } else if (lines.every(l => /^\s*\d+\.\s/.test(l))) {
            const ol = h('ol');
            for (const l of lines) ol.appendChild(inline(h('li'), l.replace(/^\s*\d+\.\s/, ''), { onCode, onTerm }));
            frag.appendChild(ol);
        } else {
            frag.appendChild(inline(h('p'), lines.join(' '), { onCode, onTerm }));
        }
    }
    return frag;
}

function inline(el, text, { onCode, onTerm }) {
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\[[^\]]+\]\])/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
        if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
        const tok = m[0];
        if (tok.startsWith('**')) el.appendChild(h('strong', {}, tok.slice(2, -2)));
        else if (tok.startsWith('`')) {
            const code = tok.slice(1, -1);
            if (onCode && /^(git|cd|ls|cat|nano|echo|mkdir|touch|rm|mv|cp|pwd|less|grep|head|tail|help|man|history|clear)\b/.test(code)) {
                el.appendChild(h('button', { class: 'cmd-inline', type: 'button', title: code, onclick: () => onCode(code) }, code));
            } else {
                el.appendChild(h('code', {}, code));
            }
        } else if (tok.startsWith('[[')) {
            const [key, label] = tok.slice(2, -2).split('|');
            el.appendChild(onTerm ? onTerm(key, label || key) : h('span', { class: 'term' }, label || key));
        } else el.appendChild(h('em', {}, tok.slice(1, -1)));
        last = m.index + tok.length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
    return el;
}
