// SPDX-License-Identifier: GPL-2.0-or-later
//
// Draws the familiars with Cairo. Used by the shell (the real familiar)
// and by the Spellbook (the live preview), so only Cairo is imported.
//
// draw(cr, type, pose): the familiar is centred at (0, 0) and `pose.size`
// is its body size in pixels.
//
// pose = {
//   size, t (seconds), look {x,y} (-1..1), facing (1 right / -1 left),
//   blink (bool), mood ('idle'|'watch'|'happy'|'oops'|'sleep'),
//   glow [r,g,b], pulse (0..1), moving (0..1), tail [{x,y}] (relative)
// }

import Cairo from 'cairo';

const TAU = Math.PI * 2;

function ellipse(cr, x, y, rx, ry) {
    cr.save();
    cr.translate(x, y);
    cr.scale(rx, ry);
    cr.arc(0, 0, 1, 0, TAU);
    cr.restore();
}

function aura(cr, r, glow, strength) {
    const g = new Cairo.RadialGradient(0, 0, r * 0.1, 0, 0, r);
    g.addColorStopRGBA(0, glow[0], glow[1], glow[2], 0.45 * strength);
    g.addColorStopRGBA(0.5, glow[0], glow[1], glow[2], 0.18 * strength);
    g.addColorStopRGBA(1, glow[0], glow[1], glow[2], 0);
    cr.setSource(g);
    cr.arc(0, 0, r, 0, TAU);
    cr.fill();
}

/** Eyes shared by the wisp and owl. (x, y) centre, r radius. */
function eye(cr, x, y, r, pose, {white = true, iris = null} = {}) {
    const {mood, blink, look} = pose;
    if (mood === 'sleep' || blink) {
        // Closed: a little smile-shaped line.
        cr.setSourceRGBA(0.12, 0.08, 0.2, 0.9);
        cr.setLineWidth(Math.max(1, r * 0.35));
        cr.arc(x, y - r * 0.2, r * 0.8, 0.15 * Math.PI, 0.85 * Math.PI);
        cr.stroke();
        return;
    }
    if (mood === 'happy') {
        // ^ ^ eyes
        cr.setSourceRGBA(0.12, 0.08, 0.2, 0.95);
        cr.setLineWidth(Math.max(1, r * 0.4));
        cr.arc(x, y + r * 0.3, r * 0.8, 1.15 * Math.PI, 1.85 * Math.PI);
        cr.stroke();
        return;
    }
    if (mood === 'oops') {
        // > < eyes
        cr.setSourceRGBA(0.12, 0.08, 0.2, 0.95);
        cr.setLineWidth(Math.max(1, r * 0.35));
        const s = r * 0.7;
        cr.moveTo(x - s, y - s);
        cr.lineTo(x + s * 0.4, y);
        cr.lineTo(x - s, y + s);
        cr.stroke();
        return;
    }
    const wide = mood === 'watch' ? 1.15 : 1;
    if (white) {
        cr.setSourceRGBA(1, 1, 1, 0.97);
        cr.arc(x, y, r * wide, 0, TAU);
        cr.fill();
    }
    const px = x + look.x * r * 0.4;
    const py = y + look.y * r * 0.35;
    if (iris) {
        cr.setSourceRGBA(iris[0], iris[1], iris[2], 1);
        cr.arc(px, py, r * 0.62, 0, TAU);
        cr.fill();
    }
    cr.setSourceRGBA(0.1, 0.06, 0.16, 1);
    cr.arc(px, py, r * (white ? 0.42 : 1) * wide, 0, TAU);
    cr.fill();
    cr.setSourceRGBA(1, 1, 1, 0.9);
    cr.arc(px - r * 0.18, py - r * 0.2, r * 0.16, 0, TAU);
    cr.fill();
}

function drawWisp(cr, p) {
    const s = p.size;
    const g = p.glow;

    // Trailing tail of fading orbs.
    const tail = p.tail ?? [];
    for (let i = tail.length - 1; i >= 0; i--) {
        const k = 1 - (i + 1) / (tail.length + 1);
        cr.setSourceRGBA(g[0], g[1], g[2], 0.28 * k);
        cr.arc(tail[i].x, tail[i].y, s * 0.32 * (0.35 + 0.65 * k), 0, TAU);
        cr.fill();
    }

    aura(cr, s * (1.3 + 0.15 * p.pulse), g, 0.8 + 0.4 * p.pulse);

    const body = new Cairo.RadialGradient(-s * 0.1, -s * 0.12, s * 0.05, 0, 0, s * 0.5);
    body.addColorStopRGBA(0, 1, 1, 1, 1);
    body.addColorStopRGBA(0.45, 0.6 + g[0] * 0.4, 0.6 + g[1] * 0.4, 0.6 + g[2] * 0.4, 0.95);
    body.addColorStopRGBA(1, g[0], g[1], g[2], 0.0);
    cr.setSource(body);
    cr.arc(0, 0, s * 0.5, 0, TAU);
    cr.fill();

    eye(cr, -s * 0.13, -s * 0.02, s * 0.075, p, {white: false});
    eye(cr, s * 0.13, -s * 0.02, s * 0.075, p, {white: false});
}

function drawOwl(cr, p) {
    const s = p.size;
    const g = p.glow;
    aura(cr, s * (1.15 + 0.12 * p.pulse), g, 0.6 + 0.4 * p.pulse);

    const body = [0.42, 0.32, 0.58];
    const dark = [0.3, 0.22, 0.42];
    const belly = [0.82, 0.74, 0.9];
    const flap = Math.sin(p.t * 14) * 0.35 * p.moving;

    // Wings (behind body).
    for (const side of [-1, 1]) {
        cr.save();
        cr.translate(side * s * 0.36, s * 0.05);
        cr.rotate(side * (0.25 + flap));
        cr.setSourceRGBA(...dark, 1);
        ellipse(cr, 0, s * 0.1, s * 0.16, s * 0.3);
        cr.fill();
        cr.restore();
    }

    // Ear tufts.
    cr.setSourceRGBA(...dark, 1);
    for (const side of [-1, 1]) {
        cr.moveTo(side * s * 0.18, -s * 0.36);
        cr.lineTo(side * s * 0.36, -s * 0.58);
        cr.lineTo(side * s * 0.38, -s * 0.28);
        cr.closePath();
        cr.fill();
    }

    // Body.
    cr.setSourceRGBA(...body, 1);
    ellipse(cr, 0, 0, s * 0.42, s * 0.48);
    cr.fill();

    // Belly with little feather marks.
    cr.setSourceRGBA(...belly, 1);
    ellipse(cr, 0, s * 0.16, s * 0.26, s * 0.28);
    cr.fill();
    cr.setSourceRGBA(...dark, 0.5);
    cr.setLineWidth(Math.max(1, s * 0.025));
    for (const [x, y] of [[-0.1, 0.1], [0.1, 0.1], [0, 0.2], [-0.1, 0.3], [0.1, 0.3]]) {
        cr.moveTo((x - 0.05) * s, y * s);
        cr.lineTo(x * s, (y + 0.04) * s);
        cr.lineTo((x + 0.05) * s, y * s);
        cr.stroke();
    }

    // Face disc + eyes with glowing irises.
    cr.setSourceRGBA(0.55, 0.45, 0.7, 1);
    ellipse(cr, -s * 0.15, -s * 0.16, s * 0.17, s * 0.16);
    cr.fill();
    ellipse(cr, s * 0.15, -s * 0.16, s * 0.17, s * 0.16);
    cr.fill();
    eye(cr, -s * 0.15, -s * 0.16, s * 0.13, p, {iris: g});
    eye(cr, s * 0.15, -s * 0.16, s * 0.13, p, {iris: g});

    // Beak.
    cr.setSourceRGBA(1, 0.72, 0.25, 1);
    cr.moveTo(-s * 0.05, -s * 0.06);
    cr.lineTo(s * 0.05, -s * 0.06);
    cr.lineTo(0, s * 0.04);
    cr.closePath();
    cr.fill();

    // Feet.
    cr.setSourceRGBA(1, 0.72, 0.25, 1);
    cr.setLineWidth(Math.max(1, s * 0.05));
    for (const side of [-1, 1]) {
        cr.moveTo(side * s * 0.12, s * 0.44);
        cr.lineTo(side * s * 0.12, s * 0.52);
        cr.stroke();
    }
}

function drawDragon(cr, p) {
    const s = p.size;
    const g = p.glow;
    aura(cr, s * (1.2 + 0.12 * p.pulse), g, 0.55 + 0.4 * p.pulse);

    const scale = [0.28, 0.72, 0.58];
    const dark = [0.18, 0.5, 0.42];
    const belly = [0.98, 0.86, 0.55];
    const wingSkin = [0.52, 0.9, 0.78];
    const sleeping = p.mood === 'sleep';
    const flapSpeed = sleeping ? 0 : 5 + 9 * p.moving;
    const flap = Math.sin(p.t * flapSpeed) * (sleeping ? 0 : 0.55);

    cr.save();
    cr.scale(p.facing < 0 ? -1 : 1, 1);

    const wing = (dir, color) => {
        cr.save();
        cr.translate(-s * 0.05, -s * 0.12);
        cr.rotate(-0.4 + dir * 0.15 + flap);
        cr.setSourceRGBA(...color, 1);
        cr.moveTo(0, 0);
        cr.lineTo(-s * 0.2, -s * 0.5);
        cr.curveTo(-s * 0.3, -s * 0.35, -s * 0.45, -s * 0.3, -s * 0.55, -s * 0.2);
        cr.curveTo(-s * 0.4, -s * 0.12, -s * 0.3, -s * 0.05, 0, s * 0.02);
        cr.closePath();
        cr.fill();
        cr.setSourceRGBA(...dark, 0.8);
        cr.setLineWidth(Math.max(1, s * 0.03));
        cr.moveTo(0, 0);
        cr.lineTo(-s * 0.2, -s * 0.5);
        cr.stroke();
        cr.restore();
    };

    // Far wing.
    wing(-1, dark);

    // Tail with a spade tip.
    const sway = Math.sin(p.t * 2.2) * s * 0.06;
    cr.setSourceRGBA(...scale, 1);
    cr.setLineWidth(s * 0.12);
    cr.setLineCap(1);
    cr.moveTo(-s * 0.2, s * 0.1);
    cr.curveTo(-s * 0.45, s * 0.25, -s * 0.55, s * 0.05 + sway, -s * 0.62, -s * 0.08 + sway);
    cr.stroke();
    cr.save();
    cr.translate(-s * 0.64, -s * 0.1 + sway);
    cr.setSourceRGBA(...dark, 1);
    cr.moveTo(0, -s * 0.1);
    cr.lineTo(s * 0.07, s * 0.02);
    cr.lineTo(0, s * 0.06);
    cr.lineTo(-s * 0.07, s * 0.02);
    cr.closePath();
    cr.fill();
    cr.restore();

    // Body + belly.
    cr.setSourceRGBA(...scale, 1);
    ellipse(cr, 0, s * 0.08, s * 0.3, s * 0.24);
    cr.fill();
    cr.setSourceRGBA(...belly, 1);
    ellipse(cr, s * 0.06, s * 0.14, s * 0.17, s * 0.14);
    cr.fill();

    // Little legs.
    cr.setSourceRGBA(...dark, 1);
    ellipse(cr, -s * 0.1, s * 0.3, s * 0.06, s * 0.05);
    cr.fill();
    ellipse(cr, s * 0.14, s * 0.3, s * 0.06, s * 0.05);
    cr.fill();

    // Near wing.
    wing(1, wingSkin);

    // Head.
    const hx = s * 0.3, hy = -s * 0.14;
    cr.setSourceRGBA(...dark, 1); // horns
    cr.moveTo(hx - s * 0.1, hy - s * 0.14);
    cr.lineTo(hx - s * 0.2, hy - s * 0.32);
    cr.lineTo(hx - s * 0.02, hy - s * 0.18);
    cr.closePath();
    cr.fill();
    cr.moveTo(hx + s * 0.02, hy - s * 0.17);
    cr.lineTo(hx - s * 0.02, hy - s * 0.36);
    cr.lineTo(hx + s * 0.1, hy - s * 0.17);
    cr.closePath();
    cr.fill();

    cr.setSourceRGBA(...scale, 1);
    cr.arc(hx, hy, s * 0.2, 0, TAU);
    cr.fill();
    ellipse(cr, hx + s * 0.17, hy + s * 0.05, s * 0.13, s * 0.09); // snout
    cr.fill();
    cr.setSourceRGBA(...dark, 1);
    cr.arc(hx + s * 0.25, hy + s * 0.02, s * 0.018, 0, TAU); // nostril
    cr.fill();

    // Eye (side view). Look direction is mirrored with the body.
    const lookFlip = {...p.look, x: p.look.x * (p.facing < 0 ? -1 : 1)};
    eye(cr, hx + s * 0.04, hy - s * 0.04, s * 0.075, {...p, look: lookFlip}, {iris: g});

    cr.restore();
}

export const FAMILIARS = {
    // The real Spirit is a GPU shader in the shell; the Spellbook preview
    // uses the wisp drawing as a stand-in.
    spirit: {name: 'Spirit: CPU Watcher', draw: drawWisp},
    wisp: {name: 'Wisp', draw: drawWisp},
    owl: {name: 'Owl: Messenger (notifications, hoots the hour)', draw: drawOwl},
    dragon: {name: 'Tiny Dragon: Battery Guardian', draw: drawDragon},
};

export function draw(cr, type, pose) {
    (FAMILIARS[type] ?? FAMILIARS.wisp).draw(cr, pose);
}

/** Glow colour for a CPU load: calm blue → purple → orange. */
export function cpuGlow(load) {
    const stops = [[0, [0.45, 0.68, 1]], [0.5, [0.72, 0.5, 1]], [0.9, [1, 0.55, 0.25]], [1, [1, 0.45, 0.2]]];
    for (let i = 1; i < stops.length; i++) {
        if (load <= stops[i][0]) {
            const [a, ca] = stops[i - 1], [b, cb] = stops[i];
            const t = (load - a) / (b - a);
            return [0, 1, 2].map(k => ca[k] + (cb[k] - ca[k]) * t);
        }
    }
    return stops[stops.length - 1][1];
}
