// SPDX-License-Identifier: GPL-2.0-or-later
//
// Sound Control mode: after the rune, your mouse becomes a volume knob.
//   left click   quieter
//   right click  louder
//   middle click mute / unmute
//   scroll       fine adjust
//   Space / Esc  done
//
// A glowing ring (GPU shader) follows the cursor and shows the volume.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {destroyer, rand} from './fx.js';
import {shaderActor} from './shaders.js';

const STEP = 0.05;
const FINE_STEP = 0.02;
const RING = 170;
const IDLE_EXIT_MS = 60000;
const NOTES = ['♪', '♫', '♬', '♩'];

export class SoundMode {
    constructor(fx) {
        this._fx = fx;
        this._active = false;
    }

    get active() {
        return this._active;
    }

    // --- Volume backend (overridable in tests) --------------------------------

    _getSink() {
        const control = Volume.getMixerControl();
        return control.get_default_sink();
    }

    _maxNorm() {
        return Volume.getMixerControl().get_vol_max_norm();
    }

    _level() {
        const sink = this._getSink();
        return sink ? sink.volume / this._maxNorm() : 0;
    }

    _muted() {
        return !!this._getSink()?.is_muted;
    }

    _setLevel(level) {
        const sink = this._getSink();
        if (!sink)
            return false;
        level = Math.max(0, Math.min(1, level));
        sink.volume = Math.round(level * this._maxNorm());
        sink.push_volume();
        if (sink.is_muted && level > 0)
            sink.change_is_muted(false);
        return true;
    }

    _toggleMute() {
        const sink = this._getSink();
        if (!sink)
            return false;
        if (sink.is_muted && sink.volume === 0) {
            sink.volume = Math.round(0.3 * this._maxNorm());
            sink.push_volume();
        }
        sink.change_is_muted(!sink.is_muted);
        return true;
    }

    _showOsd() {
        const level = this._level();
        const muted = this._muted();
        const icon = muted || level === 0 ? 'audio-volume-muted-symbolic'
            : level < 0.34 ? 'audio-volume-low-symbolic'
                : level < 0.67 ? 'audio-volume-medium-symbolic' : 'audio-volume-high-symbolic';
        Main.osdWindowManager.showAll(new Gio.ThemedIcon({name: icon}), null, muted ? 0 : level, 1);
        this._icon?.set_icon_name(icon);
    }

    // --- Mode ------------------------------------------------------------------

    toggle(colors) {
        if (this._active)
            this.exit();
        else
            this.enter(colors);
    }

    enter(colors = [[0.7, 0.42, 1], [1, 0.45, 0.85]]) {
        if (this._active)
            return;
        if (!this._getSink()) {
            Main.notify('Spellcaster', 'Sound Control couldn’t find a speaker or headphones to control.');
            return;
        }
        this._active = true;
        this._colors = colors;
        this._pop = 0;
        this._t0 = Date.now();

        // Invisible catcher that receives the mouse while the mode is on.
        this._catcher = new St.Widget({reactive: true, can_focus: true, x: 0, y: 0});
        this._catcher.add_constraint(new Clutter.BindConstraint({source: global.stage, coordinate: Clutter.BindCoordinate.SIZE}));
        this._fx.add(this._catcher);
        this._grab = Main.pushModal(this._catcher, {actionMode: Shell.ActionMode.POPUP});
        this._catcher.grab_key_focus();
        this._catcher.connect('event', (_a, e) => this._onEvent(e));

        // The ring that follows the cursor.
        const {actor, shader} = shaderActor('volring', {x: 0, y: 0, width: RING, height: RING});
        this._ring = actor;
        this._shader = shader;
        this._fx.add(actor);
        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(0.3, 0.3);
        actor.opacity = 0;
        actor.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_BACK});

        // A sibling (not a child), so the ring's shader doesn't paint over it.
        this._icon = new St.Icon({icon_name: 'audio-volume-high-symbolic', icon_size: 26,
            style: 'color: white;', reactive: false, opacity: 0});
        this._fx.add(this._icon);
        this._icon.ease({opacity: 255, duration: 280});

        // How-to pill at the bottom of the screen.
        const m = Main.layoutManager.primaryMonitor;
        this._hint = this._fx.add(new St.Label({
            text: '🎵  Left: quieter   ·   Right: louder   ·   Middle: mute   ·   Scroll: fine   ·   Space: done',
            style_class: 'spellcaster-countdown',
            opacity: 0,
            reactive: false,
        }));
        const [, hw] = this._hint.get_preferred_width(-1);
        this._hint.set_position(Math.round(m.x + (m.width - hw) / 2), Math.round(m.y + m.height * 0.74));
        this._hint.ease({opacity: 255, duration: 300});

        // Keep the ring on the cursor and animated.
        this._timeline = new Clutter.Timeline({actor, duration: 1000, repeat_count: -1});
        this._timeline.connect('new-frame', () => this._frame());
        this._timeline.start();
        this._frame();
        this._resetIdle();
        this._showOsd();
    }

    _frame() {
        if (!this._ring)
            return;
        const [x, y] = global.get_pointer();
        this._ring.set_position(Math.round(x - RING / 2), Math.round(y - RING / 2));
        this._icon?.set_position(Math.round(x - 13), Math.round(y - 13));
        this._pop = Math.max(0, this._pop - 0.06);
        this._shader.setAll({
            u_time: (Date.now() - this._t0) / 1000,
            u_level: this._level(),
            u_muted: this._muted() ? 1 : 0,
            u_pop: this._pop,
            u_c1: this._colors[0],
            u_c2: this._colors[1],
        });
    }

    _resetIdle() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IDLE_EXIT_MS, () => {
            this._idleId = 0;
            this.exit();
            return GLib.SOURCE_REMOVE;
        });
    }

    _notes(up) {
        const [x, y] = global.get_pointer();
        const n = Math.round(3 * this._fx.amount) + 1;
        for (let i = 0; i < n; i++) {
            const c = this._colors[i % 2];
            const l = this._fx.add(new St.Label({
                text: NOTES[Math.floor(Math.random() * NOTES.length)],
                style: `font-size: ${Math.round(rand(16, 26))}pt; font-weight: 800;` +
                    `color: rgb(${c.map(v => Math.round(255 * (0.4 + 0.6 * v))).join(',')});` +
                    'text-shadow: 0 0 8px rgba(0,0,0,0.6);',
                opacity: 0,
                reactive: false,
            }));
            const sx = x + rand(-RING * 0.35, RING * 0.35), sy = y - RING * 0.3;
            l.set_position(Math.round(sx), Math.round(sy));
            const done = destroyer(l);
            l.ease({opacity: 255, duration: 120, onComplete: () => l.ease({
                x: sx + rand(-40, 40), y: sy - (up ? rand(60, 120) : rand(20, 60)), opacity: 0,
                duration: rand(700, 1100), mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: done,
            }), onStopped: f => {
                if (!f)
                    done();
            }});
        }
    }

    _bump(delta) {
        if (this._setLevel(this._level() + delta)) {
            this._pop = 1;
            this._notes(delta > 0);
            this._showOsd();
        }
    }

    _onEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS) {
            this._resetIdle();
            const b = event.get_button();
            if (b === Clutter.BUTTON_PRIMARY)
                this._bump(-STEP);
            else if (b === Clutter.BUTTON_SECONDARY)
                this._bump(STEP);
            else if (b === Clutter.BUTTON_MIDDLE && this._toggleMute()) {
                this._pop = 1;
                this._notes(!this._muted());
                this._showOsd();
            }
        } else if (type === Clutter.EventType.SCROLL) {
            this._resetIdle();
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP)
                this._bump(FINE_STEP);
            else if (dir === Clutter.ScrollDirection.DOWN)
                this._bump(-FINE_STEP);
            else if (dir === Clutter.ScrollDirection.SMOOTH) {
                const [, dy] = event.get_scroll_delta();
                if (Math.abs(dy) > 0.01)
                    this._bump(-dy * FINE_STEP);
            }
        } else if (type === Clutter.EventType.KEY_PRESS) {
            const k = event.get_key_symbol();
            if (k === Clutter.KEY_space || k === Clutter.KEY_Escape)
                this.exit();
        }
        return Clutter.EVENT_STOP;
    }

    exit() {
        if (!this._active)
            return;
        this._active = false;
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._catcher?.destroy();
        this._catcher = null;
        this._timeline?.stop();
        this._timeline = null;
        const ring = this._ring, hint = this._hint, icon = this._icon;
        this._ring = null;
        this._hint = null;
        this._icon = null;
        if (icon)
            icon.ease({opacity: 0, duration: 180, onStopped: destroyer(icon)});
        if (ring)
            ring.ease({scale_x: 0.2, scale_y: 0.2, opacity: 0, duration: 220, mode: Clutter.AnimationMode.EASE_IN_BACK, onStopped: destroyer(ring)});
        if (hint)
            hint.ease({opacity: 0, duration: 200, onStopped: destroyer(hint)});
    }

    destroy() {
        this.exit();
    }
}

