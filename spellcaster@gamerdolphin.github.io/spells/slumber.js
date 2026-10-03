// SPDX-License-Identifier: GPL-2.0-or-later
//
// ⬇️ Slumber: night falls across the screen (stars, a rising moon) while
// dreamy motes drift up,
// your familiar curls up, and the PC suspends. Nothing is closed, so
// everything is right where you left it when you wake the PC.
//
// Click anywhere or press Esc while night is falling to cancel.

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {Palette, destroyer, rand} from '../lib/fx.js';
import {runShader, shaderActor} from '../lib/shaders.js';

export function cast(ctx) {
    const {fx, settings, familiar} = ctx;
    const ms = settings.get_int('slumber-curtain-ms');
    const monitors = Main.layoutManager.monitors;

    // Invisible catcher so a click or Esc can cancel.
    const catcher = fx.add(new St.Widget({reactive: true, can_focus: true, x: 0, y: 0}));
    catcher.add_constraint(new Clutter.BindConstraint({source: global.stage, coordinate: Clutter.BindCoordinate.SIZE}));
    let grab = Main.pushModal(catcher, {actionMode: Shell.ActionMode.POPUP});
    catcher.grab_key_focus();

    // Night falls: a GPU-drawn starry sky with a rising moon sweeps down
    // each monitor.
    const smooth = t => t * t * (3 - 2 * t);
    const curtains = monitors.map(m => {
        const {actor, shader} = shaderActor('night', {x: m.x, y: m.y, width: m.width, height: m.height});
        fx.add(actor);
        const aspect = m.width / m.height;
        const night = {actor, shader, aspect, progress: 0, time: 0};
        night.tl = runShader(actor, shader, ms, (p, secs) => {
            night.progress = smooth(p);
            night.time = secs;
            shader.setAll({u_time: secs, u_progress: night.progress, u_aspect: aspect});
        });
        return night;
    });
    const primary = Main.layoutManager.primaryMonitor;
    const hint = fx.add(new St.Label({
        text: 'Sleeping… click to cancel',
        style_class: 'spellcaster-countdown',
        opacity: 0,
        reactive: false,
    }));
    const [, hw] = hint.get_preferred_width(-1);
    hint.set_position(Math.round(primary.x + (primary.width - hw) / 2), Math.round(primary.y + primary.height * 0.82));
    hint.ease({opacity: 255, duration: 300});

    // A few dreamy motes drift up while night falls.
    let dustTimer = 0;
    const dust = () => {
        for (const m of monitors) {
            const star = Math.random() < 0.4;
            fx.particle({
                kind: star ? 'sparkle' : 'orb',
                x: m.x + Math.random() * m.width,
                y: m.y + m.height - rand(0, m.height * 0.25),
                dx: rand(-20, 20),
                dy: -rand(140, 300),
                size: star ? rand(4, 7) : rand(2, 4),
                color: Palette.dream[Math.floor(Math.random() * Palette.dream.length)],
                spin: star ? rand(-90, 90) : 0,
                startScale: 1,
                endScale: 0.4,
                duration: rand(1400, 2200),
            });
        }
        dustTimer = fx.later(Math.round(160 / fx.amount), dust);
    };
    dust();
    familiar.curlUp();

    let finished = false;
    const releaseGrab = () => {
        if (grab) {
            Main.popModal(grab);
            grab = null;
        }
        catcher.destroy();
        fx.cancelLater(dustTimer);
    };

    const sleepNow = fx.later(ms, () => {
        finished = true;
        releaseGrab();
        hint.destroy();
        ctx.onSlumber?.();
        try {
            SystemActions.getDefault().activateSuspend();
        } catch (e) {
            Main.notify('Spellcaster', `Slumber couldn't suspend: ${e.message}`);
        }
        // Lift the night once we're asleep, so it's gone when you wake up.
        fx.later(1500, () => {
            for (const c of curtains)
                c.actor.ease({opacity: 0, duration: 600, onStopped: destroyer(c.actor)});
        });
    });

    const cancel = () => {
        if (finished)
            return;
        finished = true;
        fx.cancelLater(sleepNow);
        releaseGrab();
        hint.ease({opacity: 0, duration: 200, onStopped: destroyer(hint)});
        // Day comes back: roll the night back up.
        for (const c of curtains) {
            c.tl.stop();
            const from = c.progress, t0 = c.time;
            runShader(c.actor, c.shader, 500, (p, secs) => {
                c.shader.setAll({u_time: t0 + secs, u_progress: from * (1 - p), u_aspect: c.aspect});
            }, destroyer(c.actor));
        }
        familiar.wake();
    };

    catcher.connect('event', (_a, event) => {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN ||
            (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape))
            cancel();
        return Clutter.EVENT_STOP;
    });
}
