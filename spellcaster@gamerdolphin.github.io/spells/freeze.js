// SPDX-License-Identifier: GPL-2.0-or-later
//
// ✔️ Freeze: frost crystals grow in from the edges, everything tints icy
// blue, then the screen locks.

import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {Palette, rand} from '../lib/fx.js';

const FROST_MS = 950;

/** Frost creeping in from the four corners, plus a cold tint and glints. */
function frostMonitor(fx, m) {
    const tint = fx.add(new St.Widget({
        style: 'background-color: rgba(150, 205, 255, 0.34);',
        x: m.x, y: m.y, width: m.width, height: m.height,
        opacity: 0, reactive: false,
    }));
    tint.ease({opacity: 255, duration: FROST_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD});

    // The texture grows from its top-left corner; rotate it for the others.
    const S = Math.round(Math.min(m.width, m.height) * 0.62);
    const corners = [
        {x: m.x, y: m.y, rot: 0, px: 0, py: 0},
        {x: m.x + m.width - S, y: m.y, rot: 90, px: 1, py: 0},
        {x: m.x + m.width - S, y: m.y + m.height - S, rot: 180, px: 1, py: 1},
        {x: m.x, y: m.y + m.height - S, rot: 270, px: 0, py: 1},
    ];
    const pieces = [tint];
    corners.forEach((c, i) => {
        const holder = fx.add(new St.Widget({
            x: c.x, y: c.y, width: S, height: S,
            pivot_point: new Graphene.Point({x: c.px, y: c.py}),
            scale_x: 0.05, scale_y: 0.05, opacity: 0, reactive: false,
        }));
        fx.sprite({texture: 'frost-corner', x: S / 2, y: S / 2, size: S, rotation: c.rot, parent: holder});
        holder.ease({
            scale_x: 1, scale_y: 1, opacity: 255,
            delay: i * 60, duration: FROST_MS - 100,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        pieces.push(holder);
    });

    // Glints of light twinkling on the ice.
    const n = Math.round(18 * fx.amount);
    for (let i = 0; i < n; i++) {
        const c = corners[i % 4];
        const d = rand(0.05, 0.5) * S;
        const a = rand(0, Math.PI / 2);
        const gx = c.px ? m.x + m.width - Math.cos(a) * d : m.x + Math.cos(a) * d;
        const gy = c.py ? m.y + m.height - Math.sin(a) * d : m.y + Math.sin(a) * d;
        fx.particle({kind: 'sparkle', x: gx, y: gy, size: rand(5, 10), color: [0.88, 0.96, 1],
            spin: 90, startScale: 0.2, endScale: 1.1, delay: rand(200, FROST_MS), duration: rand(400, 700)});
    }
    fx.snowfall(m, 30);
    return pieces;
}

export function cast(ctx) {
    const {fx} = ctx;
    const pieces = Main.layoutManager.monitors.flatMap(m => frostMonitor(fx, m));
    const {x, y} = ctx.result.info.center;
    fx.shockwave(x, y, {color: [0.65, 0.88, 1], size: 500, duration: 700});
    fx.burst(x, y, {count: 26, colors: Palette.frost, speed: 220, stars: 0.5});

    fx.later(FROST_MS + 120, () => {
        try {
            SystemActions.getDefault().activateLockScreen();
        } catch (e) {
            Main.notify('Spellcaster', `Freeze couldn't lock the screen: ${e.message}`);
        }
        // The extension is switched off on the lock screen anyway, but
        // clean up in case locking is disabled.
        fx.later(800, () => {
            for (const p of pieces)
                p.destroy();
        });
    });
}
