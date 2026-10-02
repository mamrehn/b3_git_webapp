// Builds the command registry with every shell and git command.
import { Registry } from '../registry.js';
import { registerFileCommands } from './files.js';
import { registerTextCommands } from './text.js';
import { registerSystemCommands } from './system.js';

const extraRegistrars = [];

// The git command (and anything else) registers itself here to avoid import cycles.
export function addRegistrar(fn) {
    extraRegistrars.push(fn);
}

export function buildRegistry() {
    const reg = new Registry();
    registerFileCommands(reg);
    registerTextCommands(reg);
    registerSystemCommands(reg);
    for (const fn of extraRegistrars) fn(reg);
    return reg;
}
