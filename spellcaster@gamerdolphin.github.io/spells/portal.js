// SPDX-License-Identifier: GPL-2.0-or-later
//
// ⭕ Portal: a swirling portal opens and every window on the workspace
// spirals into it (they get minimized). Cast it again and the portal
// spits them back out where they were.

import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {destroyer, mix} from '../lib/fx.js';
import {actorCenter, resetActor, workspaceWindows} from '../lib/windowUtils.js';

const SUCK_MS = 560;
const STAGGER_MS = 45;

/** Windows the portal swallowed, so a second cast can bring them back. */
let swallowed = [];

function forget(win) {
    const entry = swallowed.find(e => e.win === win);
    if (entry) {
        entry.win.disconnect(entry.unmanagedId);
        swallowed = swallowed.filter(e => e !== entry);
    }
}

export function reset() {
    for (const e of swallowed)
        e.win.disconnect(e.unmanagedId);
    swallowed = [];
}

function portalRing(fx, x, y, radius, colors, reverse) {
    const size = Math.round(radius * 2.4);
    const ring = fx.add(new St.DrawingArea({
        width: size, height: size,
        x: Math.round(x - size / 2), y: Math.round(y - size / 2),
        pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        scale_x: 0.05, scale_y: 0.05,
        reactive: false,
    }));
    const [c1, c2] = colors;
    ring.connect('repaint', a => {
        const cr = a.get_context();
        const c = size / 2;
        cr.translate(c, c);
        // Dark centre.
        cr.setSourceRGBA(0.05, 0, 0.12, 0.85);
        cr.arc(0, 0, radius * 0.55, 0, Math.PI * 2);
        cr.fill();
        // Swirling arms.
        cr.setLineCap(1);
        const arms = 6;
        for (let k = 0; k < arms; k++) {
            const base = (k / arms) * Math.PI * 2;
            const col = mix(c1, c2, k / arms);
            for (const [w, alpha] of [[10, 0.18], [5, 0.5], [2, 0.95]]) {
                cr.setSourceRGBA(...col, alpha);
                cr.setLineWidth(w);
                for (let i = 0; i <= 40; i++) {
                    const t = i / 40;
                    const r = radius * (0.15 + 0.95 * t);
                    const ang = base + t * Math.PI * 1.6;
                    const px = Math.cos(ang) * r, py = Math.sin(ang) * r;
                    if (i === 0)
                        cr.moveTo(px, py);
                    else
                        cr.lineTo(px, py);
                }
                cr.stroke();
            }
        }
        // Bright rim.
        cr.setSourceRGBA(...mix(c1, [1, 1, 1], 0.5), 0.8);
        cr.setLineWidth(3);
        cr.arc(0, 0, radius, 0, Math.PI * 2);
        cr.stroke();
        cr.$dispose();
    });

    const done = destroyer(ring);
    const spin = reverse ? -540 : 540;
    ring.ease({scale_x: 1, scale_y: 1, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    ring.ease({
        rotation_angle_z: spin,
        duration: 1300,
        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
        onComplete: () => ring.ease({
            scale_x: 0.05, scale_y: 0.05, opacity: 0, duration: 260,
            mode: Clutter.AnimationMode.EASE_IN_BACK, onStopped: done,
        }),
        onStopped: f => {
            if (!f)
                done();
        },
    });
    fx.burst(x, y, {count: 24, colors: [c1, c2, [1, 1, 1]], speed: radius * 1.2});
    return ring;
}

function swallow(ctx, center) {
    const wins = workspaceWindows();
    portalRing(ctx.fx, center.x, center.y, 120, ctx.colors, false);

    wins.forEach((win, i) => {
        const actor = win.get_compositor_private();
        if (!actor)
            return;
        const c = actorCenter(actor);
        const entry = {win, unmanagedId: win.connect('unmanaged', () => forget(win))};
        swallowed.push(entry);

        actor.set_pivot_point(0.5, 0.5);
        actor.ease({
            translation_x: center.x - c.x,
            translation_y: center.y - c.y,
            scale_x: 0.03,
            scale_y: 0.03,
            rotation_angle_z: 220,
            opacity: 0,
            delay: (wins.length - 1 - i) * STAGGER_MS, // top window first
            duration: SUCK_MS,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => {
                Main.wm.skipNextEffect(actor);
                win.minimize();
                // Put the actor back once it's hidden so it looks normal
                // when you restore it some other way.
                if (!actor.visible) {
                    resetActor(actor);
                } else {
                    const id = actor.connect('hide', () => {
                        actor.disconnect(id);
                        resetActor(actor);
                    });
                }
            },
        });
    });
}

function release(ctx, center, entries) {
    portalRing(ctx.fx, center.x, center.y, 120, ctx.colors, true);
    swallowed = [];

    entries.forEach((entry, i) => {
        const {win} = entry;
        win.disconnect(entry.unmanagedId);
        const actor = win.get_compositor_private();
        if (!actor)
            return;
        const r = win.get_frame_rect();
        const cx = r.x + r.width / 2, cy = r.y + r.height / 2;

        actor.set_pivot_point(0.5, 0.5);
        actor.set({
            translation_x: center.x - cx,
            translation_y: center.y - cy,
            scale_x: 0.03, scale_y: 0.03,
            rotation_angle_z: -220,
            opacity: 0,
        });
        Main.wm.skipNextEffect(actor);
        win.unminimize();
        actor.ease({
            translation_x: 0, translation_y: 0,
            scale_x: 1, scale_y: 1,
            rotation_angle_z: 0,
            opacity: 255,
            delay: 120 + i * STAGGER_MS,
            duration: SUCK_MS,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onStopped: () => resetActor(actor),
        });
    });
    const top = entries[entries.length - 1]?.win;
    top?.activate(global.get_current_time());
}

export function cast(ctx) {
    const center = ctx.result.info.center;
    const waiting = swallowed.filter(e => e.win.minimized);
    if (waiting.length > 0)
        release(ctx, center, waiting);
    else
        swallow(ctx, center);
}
