// SPDX-License-Identifier: GPL-2.0-or-later
//
// ⬇️ Slumber: a dark curtain slowly lowers while glowing dust drifts up,
// your familiar curls up, and the PC suspends. Nothing is closed, so
// everything is right where you left it when you wake the PC.
//
// Click anywhere or press Esc while the curtain is falling to cancel.

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {Palette, destroyer, rand} from '../lib/fx.js';

export function cast(ctx) {
    const {fx, settings, familiar} = ctx;
    const ms = settings.get_int('slumber-curtain-ms');
    const monitors = Main.layoutManager.monitors;

    // Invisible catcher so a click or Esc can cancel.
    const catcher = fx.add(new St.Widget({reactive: true, can_focus: true, x: 0, y: 0}));
    catcher.add_constraint(new Clutter.BindConstraint({source: global.stage, coordinate: Clutter.BindCoordinate.SIZE}));
    let grab = Main.pushModal(catcher, {actionMode: Shell.ActionMode.POPUP});
    catcher.grab_key_focus();

    // Each curtain is a dark body with a soft, feathered bottom edge.
    const curtains = monitors.map(m => {
        const feather = Math.round(m.height * 0.18);
        const c = fx.add(new St.Widget({
            x: m.x, y: m.y, width: m.width, height: m.height + feather,
            translation_y: -(m.height + feather),
            reactive: false,
        }));
        c.add_child(new St.Widget({
            style: 'background-gradient-direction: vertical;' +
                'background-gradient-start: rgba(14, 6, 34, 0.98);' +
                'background-gradient-end: rgba(0, 0, 4, 1);',
            x: 0, y: 0, width: m.width, height: m.height,
        }));
        c.add_child(new St.Widget({
            style: 'background-gradient-direction: vertical;' +
                'background-gradient-start: rgba(0, 0, 4, 1);' +
                'background-gradient-end: rgba(0, 0, 4, 0);',
            x: 0, y: m.height, width: m.width, height: feather,
        }));
        c.ease({translation_y: 0, duration: ms, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE});
        return c;
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

    // Dust drifting up while the curtain falls.
    let dustTimer = 0;
    const dust = () => {
        for (const m of monitors) {
            for (let i = 0; i < Math.round(6 * fx.amount) + 1; i++) {
                fx.particle({
                    x: m.x + Math.random() * m.width,
                    y: m.y + m.height - rand(0, m.height * 0.3),
                    dx: rand(-20, 20),
                    dy: -rand(100, 300),
                    size: rand(2, 5),
                    color: Palette.dream[Math.floor(Math.random() * Palette.dream.length)],
                    duration: rand(1200, 2000),
                });
            }
        }
        dustTimer = fx.later(120, dust);
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
        // Lift the curtain once we're asleep, so it's gone when you wake up.
        fx.later(1500, () => {
            for (const c of curtains)
                c.ease({opacity: 0, duration: 600, onStopped: destroyer(c)});
        });
    });

    const cancel = () => {
        if (finished)
            return;
        finished = true;
        fx.cancelLater(sleepNow);
        releaseGrab();
        hint.ease({opacity: 0, duration: 200, onStopped: destroyer(hint)});
        curtains.forEach(c => c.ease({
            translation_y: -c.height,
            duration: 450,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: destroyer(c),
        }));
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
