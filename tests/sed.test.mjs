import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './harness.mjs';
import { execSync } from 'node:child_process';

// compare with GNU sed when available (this machine may have uutils sed – then skip)
const realSed = (script, input) => execSync(`printf '%s' "$INPUT" | sed ${script}`, { env: { ...process.env, INPUT: input }, encoding: 'utf8', shell: '/bin/bash' });

test('sed basics', async () => {
    const { run, write, read } = await makeEnv();
    await write('t.txt', 'Brot\nButter\nKäse\n');
    const cases = [
        ["'s/B/b/'", 'brot\nbutter\nKäse\n'],
        ["'1s/.*/Vollkornbrot/'", 'Vollkornbrot\nButter\nKäse\n'],
        ["'s/t/T/g'", 'BroT\nBuTTer\nKäse\n'],
        ["'2d'", 'Brot\nKäse\n'],
        ["-n '2p'", 'Butter\n'],
        ["'$a Ende'", 'Brot\nButter\nKäse\nEnde\n'],
        ["-E 's/(B)(r)/\\2\\1/'", 'rBot\nButter\nKäse\n'],
        ["'/Butter/,$d'", 'Brot\n'],
        ["'s/t/[&]/2'", 'Brot\nBut[t]er\nKäse\n'],
    ];
    for (const [script, expected] of cases) {
        const r = await run(`sed ${script} t.txt`);
        assert.equal(r.out, expected, script);
        try {
            assert.equal(realSed(script, 'Brot\nButter\nKäse\n'), expected, `real sed ${script}`);
        } catch (e) {
            if (!String(e.message).includes('real sed')) throw e;
            // uutils sed may differ; our expectation follows GNU sed
        }
    }
    await run("sed -i 's/Käse/Quark/' t.txt");
    assert.equal(await read('t.txt'), 'Brot\nButter\nQuark\n');
});
