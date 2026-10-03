// SPDX-License-Identifier: GPL-2.0-or-later
//
// 🥣 Enchant: sparkles drift down and the music starts (or pauses).
//
// Modes:
//  quicklofi  - Quick Lofi first (can even start a station from scratch),
//               then any other music player
//  any-player - whatever music player is open (MPRIS PlayPause)
//  command    - run a command of your choice

import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {destroyer} from '../lib/fx.js';
import {runShader, shaderActor} from '../lib/shaders.js';

const QUICK_LOFI_UUID = 'quick-lofi@eucaue';
const QUICK_LOFI_BUS = 'org.mpris.MediaPlayer2.QuickLofi';
const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

function dbusCall(bus, path, iface, method, params = null) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(bus, path, iface, method, params, null,
            Gio.DBusCallFlags.NONE, 2000, null, (conn, res) => {
                try {
                    resolve(conn.call_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

async function mprisPlayers() {
    const reply = await dbusCall('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'ListNames');
    const [names] = reply.deepUnpack();
    return names.filter(n => n.startsWith(MPRIS_PREFIX));
}

function playPause(bus) {
    return dbusCall(bus, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'PlayPause');
}

/**
 * Talk to Quick Lofi directly. It can only be started through its own
 * player when nothing is playing yet. Returns true if it handled it.
 */
function quickLofiDirect() {
    try {
        const ext = Main.extensionManager.lookup(QUICK_LOFI_UUID);
        const indicator = ext?.stateObj?._indicator;
        const player = indicator?.mpvPlayer;
        if (!player)
            return false;
        if (player.isPlaying()) {
            player.playPause();
            return true;
        }
        const radios = indicator._radios ?? [];
        if (radios.length === 0)
            return false;
        player.startPlayer(radios[0]);
        return true;
    } catch (e) {
        console.warn(`Spellcaster: Quick Lofi direct control failed: ${e}`);
        return false;
    }
}

async function toggleMusic(settings) {
    const mode = settings.get_string('enchant-mode');

    if (mode === 'command') {
        const cmd = settings.get_string('enchant-command').trim();
        if (cmd)
            Util.spawnCommandLine(cmd);
        else
            Main.notify('Spellcaster', 'Enchant is set to run a command, but no command is set in the Spellbook.');
        return;
    }

    let players = [];
    try {
        players = await mprisPlayers();
    } catch (e) {
        console.warn(`Spellcaster: couldn't list music players: ${e}`);
    }

    if (mode === 'quicklofi') {
        if (players.includes(QUICK_LOFI_BUS)) {
            try {
                await playPause(QUICK_LOFI_BUS);
                return;
            } catch {}
        }
        if (quickLofiDirect())
            return;
    }

    const others = players.filter(p => p !== QUICK_LOFI_BUS || mode === 'any-player');
    for (const p of others) {
        try {
            await playPause(p);
            return;
        } catch {}
    }
    Main.notify('Spellcaster', 'Enchant found no music to play. Open Quick Lofi or a music player first.');
}

export function cast(ctx) {
    const {fx} = ctx;
    const {x, y} = ctx.result.info.center;
    fx.shockwave(x, y, {color: [1, 0.6, 0.9], size: 320, duration: 650});
    for (const m of Main.layoutManager.monitors) {
        // Aurora ribbons sweep across the top of each screen.
        const h = Math.round(m.height * 0.6);
        const {actor, shader} = shaderActor('aurora', {x: m.x, y: m.y, width: m.width, height: h});
        fx.add(actor);
        runShader(actor, shader, 3200, (p, secs) => {
            shader.setAll({u_time: secs, u_progress: p, u_aspect: m.width / h,
                u_c1: [1, 0.45, 0.85], u_c2: [1, 0.82, 0.35]});
        }, destroyer(actor));
        fx.sparkleRain(m, 45);
    }
    toggleMusic(ctx.settings).catch(e => console.warn(`Spellcaster: Enchant failed: ${e}`));
}
