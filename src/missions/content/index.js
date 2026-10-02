// All missions, grouped into lines like a metro map. The order within a line is
// a recommendation; every mission can be started on its own.

import { t } from './common.js';
import { SHELL } from './shell.js';
import { GIT } from './git.js';
import { BRANCHES } from './branches.js';
import { TEAM_LINE } from './team.js';
import { PRO } from './pro.js';

export const LINES = [
    { id: 'shell', letter: 'S', color: 'var(--line-5)', name: t('Shell-Grundlagen', 'Shell basics'), sub: t('optional – für alle, die noch nie ein Terminal benutzt haben', 'optional – for anyone who has never used a terminal') },
    { id: 'git', letter: 'G', color: 'var(--line-0)', name: t('Git-Grundlagen', 'Git basics'), sub: t('Repository, Staging, Commits, Geschichte, Fehler beheben', 'repository, staging, commits, history, fixing mistakes') },
    { id: 'branches', letter: 'B', color: 'var(--line-1)', name: t('Branches', 'Branches'), sub: t('parallel arbeiten, zusammenführen, Konflikte lösen', 'work in parallel, merge, resolve conflicts') },
    { id: 'team', letter: 'T', color: 'var(--line-3)', name: t('Teamarbeit', 'Teamwork'), sub: t('mit dem simulierten Server git.sim: clone, push, pull', 'with the simulated server git.sim: clone, push, pull') },
    { id: 'pro', letter: 'P', color: 'var(--line-4)', name: t('Profi-Werkzeuge', 'Pro tools'), sub: t('stash, rebase, cherry-pick, tags', 'stash, rebase, cherry-pick, tags') },
];

export const MISSIONS = [...SHELL, ...GIT, ...BRANCHES, ...TEAM_LINE, ...PRO];

export function missionById(id) {
    return MISSIONS.find(m => m.id === id) || null;
}

// The next mission in the recommended order (the shell line is optional: after it comes G1)
export function nextMission(id) {
    const i = MISSIONS.findIndex(m => m.id === id);
    return i >= 0 && i < MISSIONS.length - 1 ? MISSIONS[i + 1] : null;
}
