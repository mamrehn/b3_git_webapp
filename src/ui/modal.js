// Modal overlays (dialogs, sheets): Escape and a click outside close them, Tab stays
// inside, and focus returns to where it was (usually the terminal) afterwards.

import { h } from './dom.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function modal(panel, { cls = '', onClose = null, focus = null, restoreFocus = null } = {}) {
    const previous = document.activeElement;
    let closed = false;
    const overlay = h('div', { class: `overlay ${cls}`.trim() }, panel);
    const close = () => {
        if (closed) return;
        closed = true;
        overlay.remove();
        onClose?.();
        if (restoreFocus) restoreFocus();
        else if (previous && document.contains(previous)) previous.focus();
    };
    overlay.addEventListener('mousedown', ev => { if (ev.target === overlay) close(); });
    overlay.addEventListener('keydown', ev => {
        if (ev.key === 'Escape') {
            ev.stopPropagation();
            close();
            return;
        }
        if (ev.key !== 'Tab') return;
        const items = [...panel.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
    document.body.appendChild(overlay);
    const target = typeof focus === 'function' ? focus() : focus;
    (target || panel.querySelector(FOCUSABLE))?.focus();
    return { overlay, close };
}
