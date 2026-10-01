// SPDX-License-Identifier: GPL-2.0-or-later
//
// Visual effects: a click-through layer on top of everything, a small
// particle system, screen flashes/tints, floating labels and a helper for
// frame-by-frame animations.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MAX_PARTICLES = 220;

export const rand = (a, b) => a + (b - a) * Math.random();

export function rgba([r, g, b], a = 1) {
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

export function mix(c1, c2, t) {
    return [0, 1, 2].map(i => c1[i] + (c2[i] - c1[i]) * t);
}

export function monitorAt(x, y) {
    const monitors = Main.layoutManager.monitors;
    return monitors.find(m => x >= m.x && x < m.x + m.width && y >= m.y && y < m.y + m.height) ??
        Main.layoutManager.primaryMonitor ?? monitors[0];
}

export function pointerMonitor() {
    const [x, y] = global.get_pointer();
    return monitorAt(x, y);
}

export const Palette = {
    fire: [[1, 0.45, 0.08], [1, 0.75, 0.2], [1, 0.95, 0.6], [0.9, 0.2, 0.05]],
    frost: [[0.6, 0.85, 1], [0.85, 0.95, 1], [1, 1, 1]],
    sparkle: [[1, 0.88, 0.4], [1, 0.6, 0.9], [1, 1, 1], [0.7, 0.55, 1]],
    smoke: [[0.55, 0.45, 0.7], [0.45, 0.4, 0.55], [0.65, 0.6, 0.75]],
    dream: [[0.75, 0.7, 1], [0.55, 0.65, 1], [1, 0.9, 0.7]],
};

/** A callback that destroys the actor unless it is already gone. */
export function destroyer(actor) {
    let dead = false;
    actor.connect('destroy', () => (dead = true));
    return () => {
        if (!dead)
            actor.destroy();
    };
}

const pickColor = colors => colors[Math.floor(Math.random() * colors.length)];

export class Fx {
    constructor(settings) {
        this._settings = settings;
        this._count = 0;
        this._timeouts = new Set();

        this.layer = new St.Widget({
            name: 'spellcasterFxLayer',
            reactive: false,
            x: 0,
            y: 0,
        });
        this.layer.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));
        Main.layoutManager.uiGroup.add_child(this.layer);
    }

    /** 0.25 with "reduce effects" on, 1 otherwise. */
    get amount() {
        return this._settings.get_boolean('reduce-effects') ? 0.25 : 1;
    }

    /** Keep the layer above anything added after us (menus, etc). */
    raise() {
        const parent = this.layer.get_parent();
        parent?.set_child_above_sibling(this.layer, null);
    }

    add(actor) {
        this.raise();
        this.layer.add_child(actor);
        return actor;
    }

    /** setTimeout that is cleaned up on destroy. */
    later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    cancelLater(id) {
        if (id && this._timeouts.delete(id))
            GLib.source_remove(id);
    }

    /**
     * One glowing particle.
     * opts: x, y, dx, dy, size, color, alpha, duration, delay, glow,
     *       endScale, mode, parent
     */
    particle(opts) {
        if (this._count >= MAX_PARTICLES)
            return null;
        const size = opts.size ?? 6;
        const color = opts.color ?? [1, 1, 1];
        const alpha = opts.alpha ?? 0.95;
        const glow = opts.glow ?? size;
        const p = new St.Widget({
            style_class: 'spellcaster-particle',
            style: `background-color: ${rgba(color, alpha)};` +
                `box-shadow: 0 0 ${glow}px ${Math.ceil(glow / 3)}px ${rgba(color, alpha * 0.7)};` +
                `border-radius: ${size}px;`,
            width: size,
            height: size,
            x: opts.x - size / 2,
            y: opts.y - size / 2,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            reactive: false,
        });
        (opts.parent ?? this.layer).add_child(p);
        this._count++;
        p.connect('destroy', () => this._count--);
        const done = destroyer(p);
        const duration = opts.duration ?? 600;
        const delay = opts.delay ?? 0;
        // Fly out quickly, but stay bright for most of the trip, then fade.
        p.ease({
            x: opts.x - size / 2 + (opts.dx ?? 0),
            y: opts.y - size / 2 + (opts.dy ?? 0),
            delay,
            duration,
            mode: opts.mode ?? Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        p.ease({
            opacity: 0,
            scale_x: opts.endScale ?? 0.3,
            scale_y: opts.endScale ?? 0.3,
            delay,
            duration,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: done,
        });
        return p;
    }

    /** Particles flying outward from a point. */
    burst(x, y, {count = 24, colors = Palette.sparkle, speed = 120, size = [3, 8], duration = [400, 900], up = 0} = {}) {
        this.raise();
        const n = Math.round(count * this.amount);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = speed * rand(0.3, 1);
            this.particle({
                x, y,
                dx: Math.cos(a) * d,
                dy: Math.sin(a) * d - up * rand(0.5, 1),
                size: rand(size[0], size[1]),
                color: pickColor(colors),
                duration: rand(duration[0], duration[1]),
            });
        }
    }

    /** Embers rising out of a rectangle (a burning window). */
    embers(rect, count = 80) {
        this.raise();
        const n = Math.round(count * this.amount);
        for (let i = 0; i < n; i++) {
            const x = rect.x + Math.random() * rect.width;
            const y = rect.y + Math.random() * rect.height;
            this.particle({
                x, y,
                dx: rand(-30, 30),
                dy: -rand(60, 220),
                size: rand(3, 9),
                color: pickColor(Palette.fire),
                delay: rand(0, 250),
                duration: rand(600, 1300),
            });
        }
    }

    /** Soft puff of purple smoke (a fizzle). */
    smoke(x, y, count = 14) {
        this.raise();
        const n = Math.max(4, Math.round(count * this.amount));
        for (let i = 0; i < n; i++) {
            this.particle({
                x: x + rand(-10, 10),
                y: y + rand(-10, 10),
                dx: rand(-40, 40),
                dy: -rand(20, 70),
                size: rand(10, 22),
                alpha: 0.35,
                glow: 14,
                color: pickColor(Palette.smoke),
                endScale: 1.6,
                duration: rand(700, 1100),
            });
        }
    }

    /** Sparkles drifting down from the top of a monitor. */
    sparkleRain(monitor, count = 70) {
        this.raise();
        const n = Math.round(count * this.amount);
        for (let i = 0; i < n; i++) {
            const x = monitor.x + Math.random() * monitor.width;
            this.particle({
                x,
                y: monitor.y - rand(0, 40),
                dx: rand(-50, 50),
                dy: monitor.height * rand(0.35, 0.9),
                size: rand(3, 8),
                color: pickColor(Palette.sparkle),
                delay: rand(0, 900),
                duration: rand(1600, 2800),
                endScale: 0.5,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });
        }
    }

    /** Full-monitor colour flash. */
    flash(monitor, color = [1, 1, 1], peak = 0.6, duration = 260) {
        const f = this.add(new St.Widget({
            style: `background-color: ${rgba(color, 1)};`,
            x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height,
            opacity: Math.round(peak * 255),
            reactive: false,
        }));
        f.ease({opacity: 0, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: destroyer(f)});
        return f;
    }

    /** Floating text label that rises and fades. */
    label(text, x, y, {fizzle = false, duration = 1100} = {}) {
        const l = this.add(new St.Label({
            text,
            style_class: fizzle ? 'spellcaster-label-fizzle' : 'spellcaster-label',
            opacity: 0,
            reactive: false,
        }));
        const [, natW] = l.get_preferred_width(-1);
        const [, natH] = l.get_preferred_height(-1);
        l.set_position(Math.round(x - natW / 2), Math.round(y - natH / 2));
        const done = destroyer(l);
        l.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => l.ease({
                y: l.y - 50,
                opacity: 0,
                delay: duration * 0.35,
                duration: duration * 0.65,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: done,
            }),
            onStopped: finished => {
                if (!finished)
                    done();
            },
        });
        return l;
    }

    /**
     * Frame-by-frame animation driven by the stage clock.
     * onFrame(progress 0..1) every frame, onDone() at the end.
     * Returns the timeline (call .stop() to abort).
     */
    animate(actor, duration, onFrame, onDone) {
        const tl = new Clutter.Timeline({actor, duration});
        tl.connect('new-frame', () => onFrame(tl.get_progress()));
        tl.connect('completed', () => {
            onFrame(1);
            onDone?.();
        });
        tl.start();
        return tl;
    }

    destroy() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this.layer.destroy();
        this.layer = null;
    }
}
