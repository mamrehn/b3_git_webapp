// Entry point: checks that the browser can run the Werkstatt, then starts it.

import { App } from './app.js';
import { L } from './core/i18n.js';

function fail(message, detail = '') {
    const root = document.getElementById('app');
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'boot-error';
    const h = document.createElement('h1');
    h.textContent = L({ de: 'Die Git-Werkstatt konnte nicht starten', en: 'The Git Workshop could not start' });
    const p = document.createElement('p');
    p.textContent = message;
    box.append(h, p);
    if (detail) {
        const pre = document.createElement('pre');
        pre.textContent = detail;
        box.appendChild(pre);
    }
    root.appendChild(box);
}

async function boot() {
    if (!window.indexedDB) {
        fail(L({ de: 'Dieser Browser erlaubt keinen lokalen Speicher (IndexedDB). Im privaten Modus von Firefox ist er z. B. abgeschaltet. Bitte ein normales Browserfenster verwenden.', en: 'This browser does not allow local storage (IndexedDB). It is disabled in Firefox private mode, for example. Please use a normal browser window.' }));
        return;
    }
    if (!window.git || !window.LightningFS) {
        fail(L({ de: 'Die Programmbibliotheken wurden nicht geladen. Bitte die Seite neu laden.', en: 'The program libraries were not loaded. Please reload the page.' }));
        return;
    }
    const app = new App(document.getElementById('app'));
    window.__werkstatt = app; // for debugging and end-to-end tests
    try {
        await app.start();
    } catch (e) {
        console.error(e);
        fail(L({ de: 'Ein unerwarteter Fehler ist aufgetreten.', en: 'An unexpected error occurred.' }), String(e?.stack || e));
    }
}

boot();
