// One entry point for the learning layer: given the states before and after a
// command line, produce the coach's explanation, the situation and next steps.

import { diffStates } from './events.js';
import { narrate } from './narrate.js';
import { suggest } from './suggest.js';
import { situation } from './situation.js';

export function runMeta(result) {
    const git = (result.commands || []).filter(c => c.name === 'git' && c.info?.git?.sub);
    const last = git[git.length - 1];
    return { gitSub: last?.info.git.sub || null, args: last?.info.git.args || [] };
}

export function coachFor({ prev, next, result, line }) {
    const meta = runMeta(result);
    const run = { ...result, line, ...meta };
    const events = diffStates(prev, next, run);
    const entry = narrate({ run, prev, next, events });
    return { entry, events, situation: situation(next), suggestions: suggest(next, { run, events }) };
}
