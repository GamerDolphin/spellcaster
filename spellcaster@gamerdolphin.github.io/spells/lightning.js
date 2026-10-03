// SPDX-License-Identifier: GPL-2.0-or-later
//
// ⚡ Lightning Strike: a crackling plasma bolt (GPU shader) strikes where
// the rune ended, and an app launches (or comes to the front if it's
// already open).

import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {destroyer, mix, rand} from '../lib/fx.js';
import {runShader, shaderActor} from '../lib/shaders.js';

const BOLT_MS = 950;

/** Brightness over the strike: two hard flashes, then a crackling fade. */
function flicker(t) {
    if (t < 0.06)
        return t / 0.06;
    if (t < 0.12)
        return 0.35;
    if (t < 0.2)
        return 1.25;
    if (t < 0.28)
        return 0.5;
    return Math.max(0, 1 - (t - 0.28) / 0.72) ** 0.6 * (0.8 + 0.2 * Math.sin(t * 90));
}

export function cast(ctx) {
    const {fx, result, settings, colors} = ctx;
    const m = ctx.monitor;
    const end = result.info.end;
    const start = {x: end.x + rand(-m.width * 0.1, m.width * 0.1), y: m.y};
    const uv = p => [(p.x - m.x) / m.width, (p.y - m.y) / m.height];
    const len = (end.y - start.y) / m.height;
    const color = mix(colors[0], [0.6, 0.75, 1], 0.45);

    const {actor, shader} = shaderActor('bolt', {x: m.x, y: m.y, width: m.width, height: m.height});
    fx.add(actor);
    const seed = rand(0, 100);
    const side = Math.random() < 0.5 ? -1 : 1;
    runShader(actor, shader, BOLT_MS, (p, secs) => {
        shader.setAll({
            u_time: secs,
            u_seed: seed,
            u_intensity: flicker(p),
            u_aspect: m.width / m.height,
            u_a: uv(start),
            u_b: uv(end),
            u_b1: [side * len * 0.22, len * 0.3],
            u_b2: [-side * len * 0.18, len * 0.22],
            u_color: color,
        });
    }, destroyer(actor));

    fx.flash(m, [0.9, 0.94, 1], 0.32, 220);
    fx.later(140, () => fx.flash(m, [0.9, 0.94, 1], 0.18, 180));
    // Impact: ground rings, sparks and a few twinkles.
    fx.shockwave(end.x, end.y, {color, size: 420, duration: 550});
    fx.shockwave(end.x, end.y, {color: [1, 1, 1], size: 220, duration: 350});
    fx.burst(end.x, end.y, {count: 40, colors: [[1, 1, 1], color, [0.65, 0.88, 1]], speed: 220, size: [2, 6], stars: 0.35, up: 50});

    const appId = settings.get_string('lightning-app');
    const app = appId ? Shell.AppSystem.get_default().lookup_app(appId) : null;
    if (app)
        app.activate();
    else
        Main.notify('Spellcaster', `Lightning Strike can't find the app "${appId}". Pick one in the Spellbook.`);
}
