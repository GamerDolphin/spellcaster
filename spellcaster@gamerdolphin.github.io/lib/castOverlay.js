// SPDX-License-Identifier: GPL-2.0-or-later
//
// Cast mode: grabs the mouse, draws the glowing rune trail, and hands the
// finished stroke to the recognizer.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {recognize} from './recognizer.js';
import {themeColors} from './runes.js';
import {Shader} from './shaders.js';
import {destroyer, mix, pointerMonitor, rgba} from './fx.js';

const IDLE_TIMEOUT_MS = 10000;
const MIN_POINT_GAP = 2;
const SPARK_EVERY = 16;

export class CastOverlay {
    /**
     * @param {Gio.Settings} settings
     * @param {Fx} fx
     * @param {{onBegin?, onCast, onFizzle, onEnd?}} callbacks
     */
    constructor(settings, fx, callbacks) {
        this._settings = settings;
        this._fx = fx;
        this._callbacks = callbacks;
        this._overlay = null;
    }

    get active() {
        return this._overlay !== null;
    }

    toggle() {
        if (this.active)
            this.cancel();
        else
            this.begin();
    }

    begin() {
        if (this.active)
            return;

        // Everything about this one cast. The trail keeps painting from it
        // while it fades out, even if a new cast has already started.
        this._cast = {
            monitor: pointerMonitor(),
            colors: themeColors(this._settings.get_string('trail-theme')),
            width: this._settings.get_int('trail-width'),
            points: [],
            state: 'drawing',
        };
        this._drawing = false;
        this._sinceSpark = 0;

        this._overlay = new St.Widget({
            style_class: 'spellcaster-overlay',
            reactive: true,
            can_focus: true,
            x: 0,
            y: 0,
            opacity: 0,
        });
        this._overlay.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));

        const m = this._cast.monitor;
        const cast = this._cast;
        this._trail = new St.DrawingArea({x: m.x, y: m.y, width: m.width, height: m.height, reactive: false});
        this._trail.connect('repaint', area => this._paintTrail(area, cast));
        this._overlay.add_child(this._trail);

        // The trail's look comes from a GPU shader on top of a Cairo mask.
        cast.shader = new Shader('trail');
        cast.flare = 0;
        cast.fizzle = 0;
        cast.len = 1;
        this._trail.add_effect(cast.shader.effect);
        const trail = this._trail;
        const t0 = Date.now();
        cast.timeline = new Clutter.Timeline({actor: trail, duration: 1000, repeat_count: -1});
        cast.timeline.connect('new-frame', () => {
            cast.shader.setAll({
                u_time: (Date.now() - t0) / 1000,
                u_c1: cast.colors[0],
                u_c2: cast.colors[1],
                u_px: [1 / m.width, 1 / m.height],
                u_len: cast.len,
                u_flare: cast.flare,
                u_fizzle: cast.fizzle,
            });
        });
        cast.timeline.start();
        trail.connect('destroy', () => cast.timeline.stop());

        const tipSize = 10;
        this._tip = new St.Widget({
            style_class: 'spellcaster-wand-tip',
            style: `box-shadow: 0 0 16px 6px ${rgba(this._cast.colors[0], 0.9)};`,
            width: tipSize,
            height: tipSize,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            reactive: false,
        });
        this._overlay.add_child(this._tip);
        const [px, py] = global.get_pointer();
        this._moveTip(px, py);

        Main.layoutManager.uiGroup.add_child(this._overlay);
        this._grab = Main.pushModal(this._overlay, {actionMode: Shell.ActionMode.POPUP});
        this._overlay.grab_key_focus();
        global.stage.set_cursor_type(Clutter.CursorType.CROSSHAIR);

        this._overlay.connect('event', (_a, event) => this._onEvent(event));
        this._overlay.ease({opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._tip.set_scale(0.2, 0.2);
        this._tip.ease({scale_x: 1, scale_y: 1, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        this._resetIdle();

        this._callbacks.onBegin?.();
    }

    _resetIdle() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IDLE_TIMEOUT_MS, () => {
            this._idleId = 0;
            this.cancel();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onEvent(event) {
        if (this._cast.state !== 'drawing')
            return Clutter.EVENT_STOP;

        const type = event.type();
        const [x, y] = event.get_coords();

        switch (type) {
        case Clutter.EventType.BUTTON_PRESS:
            if (event.get_button() === Clutter.BUTTON_PRIMARY)
                this._startStroke(x, y);
            else
                this.cancel();
            break;
        case Clutter.EventType.TOUCH_BEGIN:
            this._startStroke(x, y);
            break;
        case Clutter.EventType.MOTION:
        case Clutter.EventType.TOUCH_UPDATE:
            this._moveTip(x, y);
            if (this._drawing)
                this._addPoint(x, y);
            this._resetIdle();
            break;
        case Clutter.EventType.BUTTON_RELEASE:
            if (event.get_button() === Clutter.BUTTON_PRIMARY && this._drawing)
                this._finish();
            break;
        case Clutter.EventType.TOUCH_END:
            if (this._drawing)
                this._finish();
            break;
        case Clutter.EventType.KEY_PRESS:
            if (event.get_key_symbol() === Clutter.KEY_Escape)
                this.cancel();
            break;
        }
        return Clutter.EVENT_STOP;
    }

    _moveTip(x, y) {
        this._tip?.set_position(Math.round(x - this._tip.width / 2), Math.round(y - this._tip.height / 2));
    }

    _startStroke(x, y) {
        this._drawing = true;
        this._cast.points = [{x, y}];
        this._fx.burst(x, y, {count: 8, colors: [this._cast.colors[0], this._cast.colors[1], [1, 1, 1]], speed: 30, size: [2, 5]});
    }

    _addPoint(x, y) {
        const last = this._cast.points[this._cast.points.length - 1];
        const d = Math.hypot(x - last.x, y - last.y);
        if (d < MIN_POINT_GAP)
            return;
        this._cast.points.push({x, y});
        this._sinceSpark += d;
        if (this._sinceSpark > SPARK_EVERY) {
            this._sinceSpark = 0;
            const c = Math.random() < 0.5 ? this._cast.colors[0] : this._cast.colors[1];
            // Magic dust falling off the wand: mostly soft motes, some twinkles.
            const star = Math.random() < 0.35;
            this._fx.particle({
                kind: star ? 'sparkle' : 'orb',
                x: x + (Math.random() - 0.5) * 8,
                y: y + (Math.random() - 0.5) * 8,
                dx: (Math.random() - 0.5) * 50,
                dy: Math.random() * 40 + 8,
                size: star ? 3 + Math.random() * 4 : 2 + Math.random() * 3,
                color: mix(c, [1, 1, 1], 0.2),
                spin: star ? (Math.random() - 0.5) * 300 : 0,
                duration: 500 + Math.random() * 500,
            });
        }
        this._trail.queue_repaint();
    }

    _paintTrail(area, cast) {
        // A thin mask: red = how far along the stroke (0 start .. 1 newest),
        // drawn opaque so overlapping segments never "bead". The shader does
        // the glow, colour and sparkle.
        const cr = area.get_context();
        const pts = cast.points;
        if (pts.length > 1) {
            const m = cast.monitor;
            cr.translate(-m.x, -m.y);
            cr.setLineCap(1); // ROUND
            cr.setLineJoin(1); // ROUND
            cr.setLineWidth(Math.max(2, cast.width * 0.75));
            // Thin the points out a little for speed.
            const step = Math.max(1, Math.floor(pts.length / 400));
            const use = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
            let total = 0;
            const cum = [0];
            for (let i = 1; i < use.length; i++) {
                total += Math.hypot(use[i].x - use[i - 1].x, use[i].y - use[i - 1].y);
                cum.push(total);
            }
            cast.len = Math.max(1, total);
            for (let i = 1; i < use.length; i++) {
                cr.setSourceRGBA(cum[i] / cast.len, 1, 0, 1);
                cr.moveTo(use[i - 1].x, use[i - 1].y);
                cr.lineTo(use[i].x, use[i].y);
                cr.stroke();
            }
        }
        cr.$dispose();
    }

    _finish() {
        this._drawing = false;
        const result = recognize(this._cast.points, this._settings.get_double('tolerance'));
        const colors = this._cast.colors;
        const monitor = this._cast.monitor;
        this._releaseInput();

        const done = destroyer(this._overlay);
        const overlay = this._overlay;
        this._tip.ease({opacity: 0, scale_x: 2, scale_y: 2, duration: 250});

        if (result.rune) {
            this._cast.state = 'flare';
            this._animateCast(this._cast, 'flare', 260);
            // Sparkle along the rune.
            const pts = this._cast.points;
            const step = Math.max(1, Math.floor(pts.length / 26));
            for (let i = 0; i < pts.length; i += step) {
                const star = i % 3 === 0;
                this._fx.particle({
                    kind: star ? 'sparkle' : 'orb',
                    x: pts[i].x, y: pts[i].y,
                    dx: (Math.random() - 0.5) * 60, dy: -Math.random() * 60,
                    size: star ? 5 + Math.random() * 4 : 3 + Math.random() * 4,
                    color: mix(colors[i % 2], [1, 1, 1], 0.2),
                    spin: star ? 180 : 0,
                    duration: 600 + Math.random() * 500,
                });
            }
            // A magic circle flashes up behind the rune.
            const {center, bbox} = result.info;
            const size = Math.max(220, Math.min(520, Math.max(bbox.width, bbox.height) * 1.5));
            this._fx.sigil(center.x, center.y, {colors, size, hold: 250});
            this._fx.shockwave(center.x, center.y, {color: colors[0], size: size * 1.4, duration: 600});
            this._trail.set_pivot_point(0.5, 0.5);
            overlay.ease({opacity: 0, delay: 180, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: done});
        } else {
            this._cast.state = 'fizzle';
            this._animateCast(this._cast, 'fizzle', 450);
            const pts = this._cast.points;
            const step = Math.max(1, Math.floor(pts.length / 6));
            for (let i = 0; i < pts.length; i += step)
                this._fx.smoke(pts[i].x, pts[i].y, 3);
            overlay.ease({opacity: 0, duration: 500, mode: Clutter.AnimationMode.EASE_IN_QUAD, onStopped: done});
        }
        this._overlay = null;
        this._trail = null;
        this._tip = null;

        if (result.rune)
            this._callbacks.onCast(result, {colors, monitor});
        else
            this._callbacks.onFizzle(result, {colors, monitor, points: this._cast.points});
        this._callbacks.onEnd?.();
    }

    /** Ease a trail uniform (flare / fizzle) from 0 to 1. */
    _animateCast(cast, key, ms) {
        const t0 = Date.now();
        const tl = new Clutter.Timeline({actor: this._trail, duration: ms});
        tl.connect('new-frame', () => (cast[key] = Math.min(1, (Date.now() - t0) / ms)));
        tl.connect('completed', () => (cast[key] = 1));
        tl.start();
    }

    _releaseInput() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        global.stage.set_cursor_type(Clutter.CursorType.DEFAULT);
        this._overlay.reactive = false;
    }

    cancel() {
        if (!this.active)
            return;
        this._releaseInput();
        const overlay = this._overlay;
        overlay.ease({opacity: 0, duration: 150, onStopped: destroyer(overlay)});
        this._overlay = null;
        this._trail = null;
        this._tip = null;
        this._callbacks.onEnd?.();
    }

    destroy() {
        if (this.active) {
            this._releaseInput();
            this._overlay.destroy();
            this._overlay = null;
        }
    }
}
