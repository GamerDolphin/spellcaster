// SPDX-License-Identifier: GPL-2.0-or-later
//
// 🌀 Fireball: a churning fireball swells, explodes against the window,
// and the window burns away from the point of impact (a GPU shader on the
// window itself), then closes. It's a polite close, so apps with unsaved
// work still ask to save, and then the window comes back unburnt.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Palette, destroyer} from '../lib/fx.js';
import {Shader, runShader, shaderActor} from '../lib/shaders.js';
import {windowAt} from '../lib/windowUtils.js';

const ORB = 300;
const GROW_MS = 380;
const HOLD_MS = 250;
const BLAST_MS = 520;
const BURN_MS = 1500;
const RESTORE_AFTER_MS = 1500;

function easeOutBack(t) {
    const c = 1.7;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

/** The fireball: grows, churns, then explodes. Calls onBoom at the blast. */
function fireball(fx, x, y, {travel = null, onBoom = null} = {}) {
    const {actor, shader} = shaderActor('fireball', {x: x - ORB / 2, y: y - ORB / 2, width: ORB, height: ORB});
    fx.add(actor);
    const done = destroyer(actor);
    const total = GROW_MS + HOLD_MS + BLAST_MS;
    let boomed = false;
    runShader(actor, shader, total, (p, secs) => {
        const ms = p * total;
        const grow = Math.min(1, ms / GROW_MS);
        const explode = travel ? 0 : Math.max(0, (ms - GROW_MS - HOLD_MS) / BLAST_MS);
        shader.setAll({u_time: secs, u_grow: Math.max(0.05, easeOutBack(grow)), u_explode: explode});
        if (explode > 0 && !boomed) {
            boomed = true;
            onBoom?.();
        }
        if (travel && ms > GROW_MS) {
            // No window: it flies off the screen instead of exploding.
            const k = (ms - GROW_MS) / (total - GROW_MS);
            actor.translation_x = travel.x * k * k;
            actor.translation_y = travel.y * k * k;
        }
    }, done);
    return actor;
}

/** Burn a window away with the burn shader, then call onBurnt. */
function burnWindow(actor, impact, onBurnt) {
    const shader = new Shader('burn');
    actor.add_effect_with_name('spellcaster-burn', shader.effect);
    const w = Math.max(1, actor.width), h = Math.max(1, actor.height);
    const origin = [(impact.x - actor.x) / w, (impact.y - actor.y) / h];
    runShader(actor, shader, BURN_MS, (p, secs) => {
        shader.setAll({u_time: secs, u_progress: p * p * (3 - 2 * p), u_origin: origin, u_aspect: w / h});
    }, onBurnt);
}

/** Un-burn a window whose app refused to close. */
function unburn(actor) {
    const old = actor.get_effect('spellcaster-burn');
    if (!old)
        return;
    actor.remove_effect(old);
    const back = new Shader('burn');
    actor.add_effect_with_name('spellcaster-burn', back.effect);
    const w = Math.max(1, actor.width), h = Math.max(1, actor.height);
    runShader(actor, back, 500, (p, secs) => {
        back.setAll({u_time: secs, u_progress: 1 - p, u_origin: [0.5, 0.5], u_aspect: w / h});
    }, () => actor.remove_effect_by_name('spellcaster-burn'));
}

export function cast(ctx) {
    const {fx, result} = ctx;
    const {x, y} = result.info.center;
    const win = windowAt(x, y);

    if (!win) {
        const angle = Math.random() * Math.PI * 2;
        const far = Math.max(ctx.monitor.width, ctx.monitor.height);
        fireball(fx, x, y, {travel: {x: Math.cos(angle) * far, y: Math.sin(angle) * far}});
        return;
    }

    const actor = win.get_compositor_private();
    const rect = win.get_frame_rect();
    let unmanaged = false;
    const unmanagedId = win.connect('unmanaged', () => (unmanaged = true));

    fireball(fx, x, y, {
        onBoom: () => {
            if (unmanaged)
                return;
            fx.shockwave(x, y, {color: [1, 0.55, 0.15], size: 520, duration: 600});
            fx.burst(x, y, {count: 34, colors: Palette.fire, speed: 260, size: [3, 7], stars: 0.1});
            fx.embers(rect, 50);

            burnWindow(actor, {x, y}, () => {
                if (unmanaged)
                    return;
                Main.wm.skipNextEffect(actor);
                win.delete(global.get_current_time());
                // If the app asked "save changes?" (or refused), un-burn it.
                fx.later(RESTORE_AFTER_MS, () => {
                    if (unmanaged)
                        return;
                    win.disconnect(unmanagedId);
                    unburn(actor);
                });
            });
        },
    });
}
