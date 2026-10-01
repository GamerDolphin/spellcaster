// SPDX-License-Identifier: GPL-2.0-or-later
//
// Run with:  gjs -m tests/recognizer.test.js
// Draws thousands of sloppy fake runes and checks the recognizer.

import {recognize, RUNES} from '../spellcaster@gamerdolphin.github.io/lib/recognizer.js';
import {generators, junk, humanize} from './shapes.js';

const TRIALS = 400;
const TOLERANCE = 0.5;
const REQUIRED_ACCURACY = 0.95;
const MAX_WRONG = 0.01; // wrong spell is worse than a fizzle
const MAX_JUNK_ACCEPTED = 0.15;

let failed = false;
const pct = x => `${(x * 100).toFixed(1)}%`.padStart(6);

print('Rune        correct  fizzled  wrong   (confused with)');
for (const rune of RUNES) {
    let correct = 0, fizzled = 0, wrong = 0;
    const confusions = {};
    for (let i = 0; i < TRIALS; i++) {
        const res = recognize(humanize(generators[rune]()), TOLERANCE);
        if (res.rune === rune) {
            correct++;
        } else if (res.rune === null) {
            fizzled++;
            confusions[`~${res.closest}`] = (confusions[`~${res.closest}`] ?? 0) + 1;
        } else {
            wrong++;
            confusions[res.rune] = (confusions[res.rune] ?? 0) + 1;
        }
    }
    const acc = correct / TRIALS, wr = wrong / TRIALS;
    const bad = acc < REQUIRED_ACCURACY || wr > MAX_WRONG;
    failed ||= bad;
    const conf = Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `${k}:${v}`).join(' ');
    print(`${bad ? '✗' : '✓'} ${rune.padEnd(9)} ${pct(acc)}  ${pct(fizzled / TRIALS)}  ${pct(wr)}   ${conf}`);
}

print('\nJunk strokes (should fizzle)');
// A wave is allowed to count as lightning (a fast zig-zag looks like one).
const ALLOWED = {wave: ['lightning']};
for (const [name, gen] of Object.entries(junk)) {
    const hits = {};
    let accepted = 0;
    for (let i = 0; i < TRIALS; i++) {
        const res = recognize(humanize(gen()), TOLERANCE);
        if (res.rune && !(ALLOWED[name] ?? []).includes(res.rune)) {
            accepted++;
            hits[res.rune] = (hits[res.rune] ?? 0) + 1;
        }
    }
    const rate = accepted / TRIALS;
    const bad = rate > MAX_JUNK_ACCEPTED;
    failed ||= bad;
    print(`${bad ? '✗' : '✓'} ${name.padEnd(9)} accepted ${pct(rate)}  ${JSON.stringify(hits)}`);
}

// Tiny strokes / clicks must never cast.
const tiny = recognize([{x: 10, y: 10}, {x: 12, y: 11}, {x: 13, y: 13}], 1);
if (tiny.rune !== null) {
    print('✗ tiny stroke was recognized');
    failed = true;
}

print(failed ? '\nFAILED' : '\nALL PASSED');
if (failed)
    imports.system.exit(1);
