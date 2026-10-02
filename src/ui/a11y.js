// Screen-reader support switch, shared by the settings dialog and the help.

import { h } from './dom.js';
import { L } from '../core/i18n.js';

export function screenReaderToggle(app) {
    const box = h('input', { type: 'checkbox', id: 'sr-toggle', onchange: () => app.setScreenReader(box.checked) });
    box.checked = app.screenReader();
    return h('label', { class: 'check', for: 'sr-toggle' }, box, L({ de: 'Unterstützung einschalten', en: 'Enable support' }));
}
