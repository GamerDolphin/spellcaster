// SPDX-License-Identifier: GPL-2.0-or-later
//
// 🌀 Fireball: the window under the spiral bursts into embers and closes.
// It's a polite close, so apps with unsaved work still ask to save.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Palette, destroyer} from '../lib/fx.js';
import {resetActor, windowAt} from '../lib/windowUtils.js';

const RESTORE_AFTER_MS = 1500;

/** A roiling fireball sprite with a hot glow behind it. */
function fireOrb(fx, x, y, size) {
    const orb = fx.sprite({texture: 'fireball', x, y, size, rotation: Math.random() * 360});
    orb.set_scale(0.15, 0.15);
    // Keep it churning.
    orb.ease({rotation_angle_z: orb.rotation_angle_z + 540, duration: 1400, mode: Clutter.AnimationMode.LINEAR});
    return orb;
}

/** Embers peeling off a moving fireball. */
function trailEmbers(fx, orb, ms) {
    const end = Date.now() + ms;
    const tick = () => {
        if (Date.now() > end || !orb.get_parent())
            return;
        const cx = orb.x + orb.width / 2, cy = orb.y + orb.height / 2;
        fx.particle({x: cx, y: cy, dx: (Math.random() - 0.5) * 40, dy: -Math.random() * 40,
            size: 3 + Math.random() * 4, color: Palette.fire[Math.floor(Math.random() * 4)], duration: 500});
        if (Math.random() < 0.3)
            fx.smoke(cx, cy, 1, {tint: 'none'});
        fx.later(30, tick);
    };
    tick();
}

export function cast(ctx) {
    const {fx, result} = ctx;
    const {x, y} = result.info.center;
    const win = windowAt(x, y);

    const orb = fireOrb(fx, x, y, 150);
    const orbDone = destroyer(orb);

    if (!win) {
        // Nothing to burn: the fireball flies off the screen for fun.
        const m = ctx.monitor;
        const angle = Math.random() * Math.PI * 2;
        const far = Math.max(m.width, m.height);
        orb.ease({
            scale_x: 1, scale_y: 1, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => {
                trailEmbers(fx, orb, 700);
                orb.ease({
                    x: orb.x + Math.cos(angle) * far,
                    y: orb.y + Math.sin(angle) * far,
                    duration: 700,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onStopped: orbDone,
                });
            },
            onStopped: finished => {
                if (!finished)
                    orbDone();
            },
        });
        fx.burst(x, y, {count: 20, colors: Palette.fire, speed: 80});
        return;
    }

    const actor = win.get_compositor_private();
    const rect = win.get_frame_rect();
    let unmanaged = false;
    const unmanagedId = win.connect('unmanaged', () => (unmanaged = true));

    // Fireball swells, then explodes against the window.
    orb.ease({
        scale_x: 1, scale_y: 1, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK,
        onComplete: () => {
            orb.ease({scale_x: 2.4, scale_y: 2.4, opacity: 0, duration: 380,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: orbDone});
            fx.shockwave(x, y, {color: [1, 0.55, 0.15], size: 420, duration: 550});
            fx.burst(x, y, {count: 40, colors: Palette.fire, speed: 220, size: [3, 8], stars: 0.15});
        },
        onStopped: finished => {
            if (!finished)
                orbDone();
        },
    });

    // Glow orange and shake.
    let burn;
    try {
        burn = new Clutter.ColorizeEffect({tint: new Cogl.Color({red: 255, green: 140, blue: 60, alpha: 255})});
    } catch {
        burn = new Clutter.BrightnessContrastEffect();
        burn.set_brightness_full(0.2, -0.05, -0.35);
    }
    actor.add_effect_with_name('spellcaster-burn', burn);
    actor.set_pivot_point(0.5, 0.5);

    // Flames climbing up the window from the bottom edge.
    const flames = fx.add(new St.Widget({
        style: 'background-gradient-direction: vertical;' +
            'background-gradient-start: rgba(255, 210, 80, 0);' +
            'background-gradient-end: rgba(255, 90, 10, 0.85);' +
            'border-radius: 12px;',
        x: rect.x, y: rect.y + rect.height, width: rect.width, height: 0,
        reactive: false,
    }));
    const flamesDone = destroyer(flames);
    flames.ease({
        y: rect.y - rect.height * 0.15,
        height: rect.height * 1.15,
        duration: 650,
        mode: Clutter.AnimationMode.EASE_IN_QUAD,
        onComplete: () => flames.ease({opacity: 0, duration: 450, onStopped: flamesDone}),
        onStopped: finished => {
            if (!finished)
                flamesDone();
        },
    });

    const shakes = [10, -9, 7, -5, 3, 0];
    const shake = i => {
        if (unmanaged)
            return;
        if (i >= shakes.length) {
            burnAway();
            return;
        }
        actor.ease({
            translation_x: shakes[i],
            duration: 45,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => shake(i + 1),
        });
    };

    const burnAway = () => {
        fx.embers(rect, 110);
        fx.later(500, () => {
            for (let i = 0; i < 6; i++)
                fx.smoke(rect.x + Math.random() * rect.width, rect.y + rect.height * (0.2 + Math.random() * 0.6), 2, {tint: 'none'});
        });
        actor.ease({
            opacity: 0,
            scale_x: 0.88,
            scale_y: 0.88,
            duration: 450,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (unmanaged)
                    return;
                Main.wm.skipNextEffect(actor);
                win.delete(global.get_current_time());
                // If the app asked "save changes?" (or refused), bring it back.
                fx.later(RESTORE_AFTER_MS, () => {
                    if (unmanaged)
                        return;
                    win.disconnect(unmanagedId);
                    actor.remove_effect_by_name('spellcaster-burn');
                    actor.ease({
                        opacity: 255, scale_x: 1, scale_y: 1, translation_x: 0,
                        duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onStopped: () => resetActor(actor),
                    });
                });
            },
        });
    };

    shake(0);
}
