// "Where you are" – a compact situation report built from the state snapshot.

import { shortOid } from '../core/util.js';

const t = (de, en) => ({ de, en });

export function situation(state) {
    const facts = [];
    const repo = state.repo;
    facts.push({
        key: 'where',
        label: t('Ordner', 'Folder'),
        value: { de: `\`${state.cwdDisplay}\``, en: `\`${state.cwdDisplay}\`` },
        note: repo ? t(`Repository **${repo.name}**`, `repository **${repo.name}**`) : t('kein Git-Repository', 'not a git repository'),
        tone: repo ? 'plain' : 'muted',
    });
    if (!repo || repo.broken) return facts;
    const h = repo.head;
    let branchValue;
    if (h.unborn) branchValue = t(`**${h.branch}** · noch keine Commits`, `**${h.branch}** · no commits yet`);
    else if (h.detached) branchValue = t(`losgelöst bei \`${shortOid(h.oid)}\``, `detached at \`${shortOid(h.oid)}\``);
    else branchValue = t(`**${h.branch}** · \`${shortOid(h.oid)}\``, `**${h.branch}** · \`${shortOid(h.oid)}\``);
    facts.push({ key: 'branch', label: t('Branch', 'Branch'), value: branchValue, tone: h.detached ? 'warn' : 'plain' });

    const st = repo.status;
    const parts = [];
    if (st.conflicts.length) parts.push({ n: st.conflicts.length, de: 'Konflikt', dePl: 'Konflikte', en: 'conflict', enPl: 'conflicts', tone: 'danger' });
    if (st.staged.length) parts.push({ n: st.staged.length, de: 'vorgemerkt', dePl: 'vorgemerkt', en: 'staged', enPl: 'staged', tone: 'staged' });
    if (st.unstaged.length) parts.push({ n: st.unstaged.length, de: 'geändert', dePl: 'geändert', en: 'changed', enPl: 'changed', tone: 'wd' });
    if (st.untrackedFiles.length) parts.push({ n: st.untrackedFiles.length, de: 'neu', dePl: 'neu', en: 'new', enPl: 'new', tone: 'wd' });
    facts.push({
        key: 'changes',
        label: t('Änderungen', 'Changes'),
        value: parts.length
            ? { de: parts.map(p => `${p.n} ${p.n === 1 ? p.de : p.dePl}`).join(' · '), en: parts.map(p => `${p.n} ${p.n === 1 ? p.en : p.enPl}`).join(' · ') }
            : t('keine – alles committet', 'none – everything committed'),
        parts,
        tone: st.conflicts.length ? 'danger' : parts.length ? 'plain' : 'muted',
    });

    if (repo.op) {
        const names = { merge: t('Merge', 'Merge'), rebase: t('Rebase', 'Rebase'), 'cherry-pick': t('Cherry-Pick', 'Cherry-pick'), revert: t('Revert', 'Revert') };
        facts.push({ key: 'op', label: t('Läuft gerade', 'In progress'), value: names[repo.op.kind] || t(repo.op.kind, repo.op.kind), tone: 'warn' });
    }

    for (const r of repo.remotes.slice(0, 2)) {
        const up = h.branch ? repo.upstreams[h.branch] : null;
        let sync = null;
        if (up && up.remote === r.name) {
            if (up.gone) sync = t('Upstream gelöscht', 'upstream gone');
            else if (!up.ahead && !up.behind) sync = t(`synchron mit \`${up.display}\``, `in sync with \`${up.display}\``);
            else {
                const a = up.ahead ? { de: `${up.ahead} voraus`, en: `${up.ahead} ahead` } : null;
                const b = up.behind ? { de: `${up.behind} zurück`, en: `${up.behind} behind` } : null;
                sync = { de: [a?.de, b?.de].filter(Boolean).join(', ') + ` (\`${up.display}\`)`, en: [a?.en, b?.en].filter(Boolean).join(', ') + ` (\`${up.display}\`)` };
            }
        } else if (h.branch && !h.unborn) {
            sync = t('dieser Branch ist noch nicht verknüpft', 'this branch is not linked yet');
        }
        facts.push({
            key: `remote:${r.name}`,
            label: t('Remote', 'Remote'),
            value: { de: `**${r.name}**`, en: `**${r.name}**` },
            remote: { kind: r.kind, host: r.host, url: r.url },
            note: sync,
            tone: 'plain',
        });
    }
    if (repo.stash.length) {
        facts.push({ key: 'stash', label: t('Stash', 'Stash'), value: t(`${repo.stash.length} Eintr${repo.stash.length === 1 ? 'ag' : 'äge'}`, `${repo.stash.length} entr${repo.stash.length === 1 ? 'y' : 'ies'}`), tone: 'plain' });
    }
    return facts;
}
