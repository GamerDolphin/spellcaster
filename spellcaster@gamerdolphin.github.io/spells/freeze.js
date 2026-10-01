// SPDX-License-Identifier: GPL-2.0-or-later
//
// ✔️ Freeze: frost crystals grow in from the edges, everything tints icy
// blue, then the screen locks.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {Palette, rand} from '../lib/fx.js';

const FROST_MS = 950;

/** A branching ice crystal growing from (x, y) in direction `angle`. */
function crystal(x, y, angle, length, depth) {
    const segs = [];
    const grow = (sx, sy, a, len, d, t0) => {
        const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
        segs.push({sx, sy, ex, ey, t0, t1: t0 + 0.35 / (4 - d), w: 1 + d * 0.9});
        if (d <= 0)
            return;
        const n = 2 + Math.floor(Math.random() * 2);
        for (let i = 1; i <= n; i++) {
            const k = i / (n + 1);
            const bx = sx + (ex - sx) * k, by = sy + (ey - sy) * k;
            const tb = t0 + (0.35 / (4 - d)) * k;
            grow(bx, by, a + Math.PI / 3, len * 0.42, d - 1, tb);
            grow(bx, by, a - Math.PI / 3, len * 0.42, d - 1, tb);
        }
    };
    grow(x, y, angle, length, depth, 0);
    return segs;
}

function frostMonitor(fx, m) {
    const tint = fx.add(new St.Widget({
        style: 'background-color: rgba(150, 205, 255, 0.38);',
        x: m.x, y: m.y, width: m.width, height: m.height,
        opacity: 0, reactive: false,
    }));
    tint.ease({opacity: 255, duration: FROST_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD});

    const depth = fx.amount < 1 ? 1 : 2;
    const segs = [];
    const L = Math.min(m.width, m.height) * 0.22;
    // Corners first, then along the edges.
    const seeds = [
        [0, 0, Math.PI / 4], [m.width, 0, Math.PI * 3 / 4],
        [0, m.height, -Math.PI / 4], [m.width, m.height, -Math.PI * 3 / 4],
    ];
    for (let i = 0; i < 10; i++) {
        const edge = i % 4;
        const t = rand(0.1, 0.9);
        if (edge === 0)
            seeds.push([m.width * t, 0, Math.PI / 2 + rand(-0.4, 0.4)]);
        else if (edge === 1)
            seeds.push([m.width * t, m.height, -Math.PI / 2 + rand(-0.4, 0.4)]);
        else if (edge === 2)
            seeds.push([0, m.height * t, rand(-0.4, 0.4)]);
        else
            seeds.push([m.width, m.height * t, Math.PI + rand(-0.4, 0.4)]);
    }
    seeds.forEach(([x, y, a], i) =>
        segs.push(...crystal(x, y, a, L * (i < 4 ? 1.3 : rand(0.5, 0.9)), depth)));

    const area = fx.add(new St.DrawingArea({x: m.x, y: m.y, width: m.width, height: m.height, reactive: false}));
    let progress = 0;
    area.connect('repaint', a => {
        const cr = a.get_context();
        cr.setLineCap(1);
        for (const s of segs) {
            if (progress <= s.t0)
                continue;
            const k = Math.min(1, (progress - s.t0) / (s.t1 - s.t0));
            const ex = s.sx + (s.ex - s.sx) * k, ey = s.sy + (s.ey - s.sy) * k;
            cr.setSourceRGBA(0.75, 0.92, 1, 0.35);
            cr.setLineWidth(s.w * 3);
            cr.moveTo(s.sx, s.sy);
            cr.lineTo(ex, ey);
            cr.stroke();
            cr.setSourceRGBA(1, 1, 1, 0.9);
            cr.setLineWidth(s.w);
            cr.moveTo(s.sx, s.sy);
            cr.lineTo(ex, ey);
            cr.stroke();
        }
        cr.$dispose();
    });
    const tl = fx.animate(area, FROST_MS, p => {
        progress = p;
        area.queue_repaint();
    });
    return {tint, area, tl};
}

export function cast(ctx) {
    const {fx} = ctx;
    const pieces = Main.layoutManager.monitors.map(m => frostMonitor(fx, m));
    for (const m of Main.layoutManager.monitors)
        fx.burst(m.x + m.width / 2, m.y + m.height / 2, {count: 18, colors: Palette.frost, speed: 200});

    fx.later(FROST_MS + 120, () => {
        try {
            SystemActions.getDefault().activateLockScreen();
        } catch (e) {
            Main.notify('Spellcaster', `Freeze couldn't lock the screen: ${e.message}`);
        }
        // The extension is switched off on the lock screen anyway, but
        // clean up in case locking is disabled.
        fx.later(800, () => {
            for (const p of pieces) {
                p.tl.stop();
                p.tint.destroy();
                p.area.destroy();
            }
        });
    });
}
