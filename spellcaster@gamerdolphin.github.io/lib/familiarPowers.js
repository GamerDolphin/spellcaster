// SPDX-License-Identifier: GPL-2.0-or-later
//
// Each familiar has a job:
//   🦉 Owl     – Messenger: announces new notifications and hoots the hour.
//   🐉 Dragon  – Battery Guardian: warns (with fire!) at 20 / 10 / 5 % and
//                cheers when you plug in. Also breathes fire with Fireball.
//   ✨ Spirit  – CPU Watcher: glows with CPU load and warns if it stays maxed.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {loadInterfaceXML} from 'resource:///org/gnome/shell/misc/fileUtils.js';

const UPOWER_BUS = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const STATE_CHARGING = 1;
const STATE_DISCHARGING = 2;
const BATTERY_WARNINGS = [20, 10, 5];
const CPU_HOT = 0.9;
const CPU_HOT_SECONDS = 12;
const CPU_COOLDOWN_SECONDS = 300;

const short = (text, n = 34) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export class FamiliarPowers {
    constructor(familiar, settings) {
        this._familiar = familiar;
        this._settings = settings;
        this._sources = new Map();
        this._lastHour = new Date().getHours();
        this._warned = new Set();
        this._hotFor = 0;
        this._lastHotWarning = 0;

        // Owl: notifications.
        this._trayId = Main.messageTray.connect('source-added', (_t, source) => this._watchSource(source));
        for (const source of Main.messageTray.getSources?.() ?? [])
            this._watchSource(source);

        // Owl: the hour. Spirit: CPU.
        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, () => {
            this._checkHour();
            this._checkCpu(2);
            return GLib.SOURCE_CONTINUE;
        });

        // Dragon: battery.
        try {
            const Proxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.UPower.Device'));
            this._battery = new Proxy(Gio.DBus.system, UPOWER_BUS, UPOWER_PATH, (proxy, error) => {
                if (error)
                    return;
                this._lastState = proxy.State;
                this._batteryId = proxy.connect('g-properties-changed', () => this._onBattery());
            });
        } catch (e) {
            console.warn(`Spellcaster: no battery info: ${e}`);
        }
    }

    _is(type) {
        return this._familiar.type === type && this._familiar.awake;
    }

    // --- Owl ---------------------------------------------------------------------

    _watchSource(source) {
        if (this._sources.has(source))
            return;
        const id = source.connect('notification-added', (_s, n) => this.onNotification(n.title ?? '', n.body ?? ''));
        const destroyId = source.connect('destroy', () => {
            this._sources.delete(source);
        });
        this._sources.set(source, [id, destroyId]);
    }

    onNotification(title, body) {
        if (!this._is('owl'))
            return;
        // Our own messages don't need delivering twice.
        if (title === 'Spellcaster')
            return;
        this._familiar.excite();
        this._familiar.say(`✉️  ${short(title || body || 'New message')}`, 5000);
    }

    _checkHour() {
        const now = new Date();
        const h = now.getHours();
        if (h === this._lastHour)
            return;
        this._lastHour = h;
        if (!this._is('owl'))
            return;
        const time = now.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
        this._familiar.excite();
        this._familiar.say(`🦉  Hoo! It's ${time}`, 5000);
    }

    // --- Dragon --------------------------------------------------------------------

    _onBattery() {
        const b = this._battery;
        if (!b || !b.IsPresent)
            return;
        this.onBattery(Math.round(b.Percentage), b.State);
    }

    /** percent 0..100, state = UPower state number. */
    onBattery(percent, state) {
        const wasCharging = this._lastState === STATE_CHARGING;
        this._lastState = state;
        if (state === STATE_CHARGING) {
            this._warned.clear();
            if (!wasCharging && this._is('dragon')) {
                this._familiar.excite();
                this._familiar.say('⚡  Yum, power! Charging', 4000);
            }
            return;
        }
        if (state !== STATE_DISCHARGING)
            return;
        for (const level of BATTERY_WARNINGS) {
            if (percent <= level && !this._warned.has(level)) {
                // Mark every level at or above this one as handled.
                for (const l of BATTERY_WARNINGS) {
                    if (l >= level)
                        this._warned.add(l);
                }
                if (this._is('dragon')) {
                    this._familiar.breathe(null, 1300);
                    this._familiar.say(`🔋  ${percent}%! Plug me in!`, 6000);
                }
                break;
            }
        }
    }

    // --- Spirit ---------------------------------------------------------------------

    _checkCpu(dt) {
        if (!this._is('spirit') || !this._settings.get_boolean('familiar-react-cpu')) {
            this._hotFor = 0;
            return;
        }
        this._hotFor = this._familiar.cpu > CPU_HOT ? this._hotFor + dt : 0;
        const now = GLib.get_monotonic_time() / 1e6;
        if (this._hotFor >= CPU_HOT_SECONDS && now - this._lastHotWarning > CPU_COOLDOWN_SECONDS) {
            this._lastHotWarning = now;
            this._familiar.say(`🔥  CPU at ${Math.round(this._familiar.cpu * 100)}% for a while!`, 5000);
        }
    }

    destroy() {
        Main.messageTray.disconnect(this._trayId);
        for (const [source, ids] of this._sources) {
            for (const id of ids)
                source.disconnect(id);
        }
        this._sources.clear();
        GLib.source_remove(this._clockId);
        if (this._battery && this._batteryId)
            this._battery.disconnect(this._batteryId);
        this._battery = null;
    }
}
