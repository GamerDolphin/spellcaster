// SPDX-License-Identifier: GPL-2.0-or-later
//
// 🔺 Farewell: night falls over the screen, your familiar waves goodbye,
// and you're logged out, without GNOME's extra "log out in 60 seconds"
// dialog. Apps with unsaved work can still ask you to save first.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {runShader, shaderActor} from '../lib/shaders.js';

const FADE_MS = 1400;
// org.gnome.SessionManager.Logout modes: 0 normal (asks), 1 no confirmation.
const LOGOUT_NO_CONFIRMATION = 1;

/** Ask GNOME's session manager to log out. */
export function logOut() {
    Gio.DBus.session.call('org.gnome.SessionManager', '/org/gnome/SessionManager',
        'org.gnome.SessionManager', 'Logout', new GLib.Variant('(u)', [LOGOUT_NO_CONFIRMATION]),
        null, Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
            try {
                conn.call_finish(res);
            } catch (e) {
                Main.notify('Spellcaster', `Farewell couldn't log out: ${e.message}`);
            }
        });
}

export function cast(ctx) {
    const {fx, familiar} = ctx;
    familiar.say?.('👋  Bye for now!', 2500);
    const shades = Main.layoutManager.monitors.map(m => {
        const {actor, shader} = shaderActor('night', {x: m.x, y: m.y, width: m.width, height: m.height});
        fx.add(actor);
        runShader(actor, shader, FADE_MS, (p, secs) => {
            shader.setAll({u_time: secs, u_progress: p * p * (3 - 2 * p), u_aspect: m.width / m.height});
        });
        return actor;
    });
    fx.later(FADE_MS + 150, () => {
        (ctx.logOut ?? logOut)();
        // If an app asked to save first, lift the night again.
        fx.later(4000, () => {
            for (const a of shades)
                a.ease({opacity: 0, duration: 600, onStopped: () => a.destroy()});
        });
    });
}
