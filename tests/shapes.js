// SPDX-License-Identifier: GPL-2.0-or-later
//
// Generates sloppy, human-like strokes for every rune so the recognizer
// can be tested without a mouse.

let seed = 1234567;
export function rand() {
    // Small deterministic PRNG so test runs are repeatable.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
}
export const between = (a, b) => a + (b - a) * rand();
const pick = arr => arr[Math.floor(rand() * arr.length)];

function polyline(corners, perSeg = 20) {
    const out = [];
    for (let i = 0; i < corners.length - 1; i++) {
        const [a, b] = [corners[i], corners[i + 1]];
        for (let k = 0; k < perSeg; k++) {
            const t = k / perSeg;
            out.push({x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t});
        }
    }
    const last = corners[corners.length - 1];
    out.push({x: last[0], y: last[1]});
    return out;
}

// Rounds off the sharp corners a little, like a real hand does.
function roundCorners(pts, amount = 3) {
    const out = pts.map(p => ({...p}));
    for (let pass = 0; pass < amount; pass++) {
        for (let i = 1; i < out.length - 1; i++) {
            out[i].x = (out[i - 1].x + out[i].x * 2 + out[i + 1].x) / 4;
            out[i].y = (out[i - 1].y + out[i].y * 2 + out[i + 1].y) / 4;
        }
    }
    return out;
}

export const generators = {
    circle() {
        const a0 = between(0, Math.PI * 2);
        const sweep = between(330, 400) * Math.PI / 180 * (rand() < 0.5 ? 1 : -1);
        const aspect = between(0.75, 1.3);
        const out = [];
        for (let i = 0; i <= 80; i++) {
            const a = a0 + sweep * i / 80;
            out.push({x: Math.cos(a) * aspect, y: Math.sin(a)});
        }
        return out;
    },
    spiral() {
        const turns = between(1.5, 2.6);
        const dir = rand() < 0.5 ? 1 : -1;
        const inward = rand() < 0.5;
        const a0 = between(0, Math.PI * 2);
        const out = [];
        const n = 140;
        for (let i = 0; i <= n; i++) {
            let t = i / n;
            if (!inward)
                t = 1 - t;
            const r = 1 - 0.85 * t;
            const a = a0 + dir * t * turns * Math.PI * 2;
            out.push({x: Math.cos(a) * r, y: Math.sin(a) * r});
        }
        return out;
    },
    lightning() {
        let shape = pick([
            [[0, 0], [1, 0], [0, 1], [1, 1]], // Z
            [[0.6, 0], [0.15, 0.5], [0.75, 0.5], [0.3, 1]], // bolt
            [[0, 0], [1, 0.33], [0, 0.66], [1, 1]], // zig-zag down
            [[0.7, 0], [0.2, 0.45], [0.6, 0.55], [0.1, 1]],
            [[0, 0], [0.7, 0.3], [0.2, 0.55], [0.9, 0.8], [0.4, 1.1]], // long bolt
        ]);
        // Bolts drawn tall and skinny are common, so squash the width sometimes.
        // (Much thinner than ~1/3 of the height and a bolt really is a wobbly
        // line, which is why Slumber asks before sleeping.)
        const squash = rand() < 0.4 ? between(0.36, 0.55) : between(0.8, 1.3);
        shape = shape.map(([x, y]) => [x * squash + between(-0.04, 0.04), y + between(-0.05, 0.05)]);
        if (rand() < 0.5)
            shape.forEach(p => (p[0] = 1 - p[0])); // mirrored bolt
        return roundCorners(polyline(shape), 2);
    },
    v() {
        const apex = between(0.3, 0.7);
        const wid = between(0.5, 1.4);
        const lh = between(0.8, 1.1), rh = between(0.8, 1.1);
        const pts = polyline([[0, 1 - lh], [apex * wid, 1], [wid, 1 - rh]]);
        // Some V's get a softly rounded tip.
        return roundCorners(rand() < 0.3 ? pts.reverse() : pts, rand() < 0.3 ? 6 : 2);
    },
    caret() {
        return generators.v().map(p => ({x: p.x, y: 1 - p.y}));
    },
    u() {
        const side = between(0, 0.9);
        // Quick U's are often narrow with a tight bottom.
        const wid = rand() < 0.4 ? between(0.3, 0.6) : between(0.7, 1.4);
        const out = [];
        for (let i = 0; i <= 10; i++)
            out.push({x: -wid, y: -side + side * i / 10});
        for (let i = 0; i <= 50; i++) {
            const a = Math.PI - Math.PI * i / 50;
            out.push({x: Math.cos(a) * wid, y: Math.sin(a)});
        }
        for (let i = 0; i <= 10; i++)
            out.push({x: wid, y: -side * i / 10});
        return rand() < 0.5 ? out.reverse() : out;
    },
    line() {
        const tilt = between(-0.3, 0.3);
        return polyline([[0, 0], [tilt, 1]], 40);
    },
};

// Strokes that are NOT runes and should fizzle.
export const junk = {
    lineRight: () => polyline([[0, 0], [1, between(-0.15, 0.15)]], 40),
    lineUp: () => polyline([[0, 1], [between(-0.2, 0.2), 0]], 40),
    wave() {
        const out = [];
        for (let i = 0; i <= 80; i++) {
            const t = i / 80;
            out.push({x: Math.sin(t * Math.PI * 2) * 0.5, y: t});
        }
        return out;
    },
    cShape() {
        const out = [];
        for (let i = 0; i <= 60; i++) {
            const a = Math.PI * 0.5 + Math.PI * i / 60;
            out.push({x: Math.cos(a), y: Math.sin(a)});
        }
        return out;
    },
    arch() {
        return generators.u().map(p => ({x: p.x, y: -p.y}));
    },
};

/** Turn a unit shape into a realistic screen stroke. */
export function humanize(shape) {
    const size = between(80, 600);
    const rot = between(-12, 12) * Math.PI / 180;
    const ox = between(100, 1500), oy = between(100, 900);
    const wobbleA = between(0, 0.04), wobbleF = between(1, 4), phase = between(0, 6);

    const pts = shape.map((p, i) => {
        const t = i / shape.length;
        const wx = p.x + Math.sin(t * wobbleF * 6.28 + phase) * wobbleA;
        const wy = p.y + Math.cos(t * wobbleF * 6.28 + phase) * wobbleA;
        const x = wx * Math.cos(rot) - wy * Math.sin(rot);
        const y = wx * Math.sin(rot) + wy * Math.cos(rot);
        return {
            x: ox + x * size + between(-1.5, 1.5),
            y: oy + y * size + between(-1.5, 1.5),
        };
    });

    // Uneven mouse sampling: drop random points (fast parts of the stroke).
    return pts.filter((_, i) => i === 0 || i === pts.length - 1 || rand() > between(0, 0.6));
}
