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

/**
 * The portal: a dark eye, two counter-spinning vortex layers, a sigil
 * ring around the rim, and motes of light being pulled in.
 */
function portalRing(fx, x, y, radius, colors, reverse) {
    const [c1, c2] = colors;
    const size = Math.round(radius * 2.6);
    const dir = reverse ? -1 : 1;
    const LIFE = 1500;

    const box = fx.add(new St.Widget({
        width: size, height: size,
        x: Math.round(x - size / 2), y: Math.round(y - size / 2),
        pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        scale_x: 0.05, scale_y: 0.05, opacity: 0,
        reactive: false,
    }));
    const c = size / 2;

    fx.sprite({texture: 'orb-white', x: c, y: c, size: size * 1.25, tint: c1, opacity: 0.75, parent: box});
    const eye = new St.Widget({
        style: `background-gradient-direction: radial;
            background-gradient-start: rgba(4, 0, 14, 0.97);
            background-gradient-end: rgba(4, 0, 14, 0);
            border-radius: ${size}px;`,
        width: Math.round(size * 0.62), height: Math.round(size * 0.62),
        x: Math.round(c - size * 0.31), y: Math.round(c - size * 0.31),
        reactive: false,
    });
    box.add_child(eye);
    const swirl = fx.sprite({texture: 'vortex', x: c, y: c, size: size * 0.95, tint: c1, parent: box});
    const hot = fx.sprite({texture: 'vortex-hot', x: c, y: c, size: size * 0.8, tint: mix(c2, [1, 1, 1], 0.5), parent: box});
    const rim = fx.sprite({texture: 'sigil', x: c, y: c, size: size * 1.05, tint: mix(c2, [1, 1, 1], 0.6), opacity: 0.85, parent: box});

    const LIN = Clutter.AnimationMode.LINEAR;
    swirl.ease({rotation_angle_z: dir * -720, duration: LIFE, mode: LIN});
    hot.ease({rotation_angle_z: dir * -1080, duration: LIFE, mode: LIN});
    rim.ease({rotation_angle_z: dir * 160, duration: LIFE, mode: LIN});

    const done = destroyer(box);
    box.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    fx.later(LIFE - 320, () => box.ease({
        opacity: 0, scale_x: 0.05, scale_y: 0.05, rotation_angle_z: dir * -90, duration: 320,
        mode: Clutter.AnimationMode.EASE_IN_BACK, onStopped: done,
    }));

    // Motes spiralling inward (or flying out when releasing).
    const n = Math.round(40 * fx.amount);
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const far = radius * (1.4 + Math.random() * 0.9);
        const near = radius * 0.1;
        const [from, to] = reverse ? [near, far] : [far, near];
        const a2 = a + dir * 1.2;
        fx.particle({
            kind: Math.random() < 0.3 ? 'sparkle' : 'orb',
            x: x + Math.cos(a) * from, y: y + Math.sin(a) * from,
            dx: Math.cos(a2) * to - Math.cos(a) * from,
            dy: Math.sin(a2) * to - Math.sin(a) * from,
            size: 2 + Math.random() * 4,
            color: Math.random() < 0.5 ? c1 : c2,
            startScale: 1,
            endScale: reverse ? 0.3 : 0.6,
            delay: Math.random() * 600,
            duration: 500 + Math.random() * 400,
            mode: reverse ? Clutter.AnimationMode.EASE_OUT_QUAD : Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }
    fx.shockwave(x, y, {color: c1, size: size * 1.2, duration: 600, delay: reverse ? 0 : 200});
    return box;
}

function swallow(ctx, center) {
    const wins = workspaceWindows();
    portalRing(ctx.fx, center.x, center.y, 150, ctx.colors, false);

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
    portalRing(ctx.fx, center.x, center.y, 150, ctx.colors, true);
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
