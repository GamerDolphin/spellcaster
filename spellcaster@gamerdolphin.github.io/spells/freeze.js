// SPDX-License-Identifier: GPL-2.0-or-later
//
// ✔️ Freeze: frost crystals grow in from the edges, everything tints icy
// blue, then the screen locks.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {Palette, destroyer} from '../lib/fx.js';
import {runShader, shaderActor} from '../lib/shaders.js';

const FROST_MS = 1300;

/** Ice spreading in from the edges (GPU shader), a cold tint and snow. */
function frostMonitor(fx, m) {
    const tint = fx.add(new St.Widget({
        style: 'background-color: rgba(140, 195, 255, 0.2);',
        x: m.x, y: m.y, width: m.width, height: m.height,
        opacity: 0, reactive: false,
    }));
    tint.ease({opacity: 255, duration: FROST_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD});

    const {actor, shader} = shaderActor('frost', {x: m.x, y: m.y, width: m.width, height: m.height});
    fx.add(actor);
    const aspect = m.width / m.height;
    runShader(actor, shader, FROST_MS + 400, (p, secs) => {
        const grow = Math.min(1, p * (FROST_MS + 400) / FROST_MS);
        shader.setAll({u_time: secs, u_progress: 1 - (1 - grow) ** 2.2, u_aspect: aspect});
    });
    fx.snowfall(m, 24);
    return [tint, actor];
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
            for (const done of pieces.map(destroyer))
                done();
        });
    });
}
