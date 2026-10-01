// SPDX-License-Identifier: GPL-2.0-or-later
//
// ⚡ Lightning Strike: a bolt cracks down and an app launches (or comes
// to the front if it's already open).

import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {destroyer, mix, rand} from '../lib/fx.js';

/** Jagged bolt from a to b by midpoint displacement. */
function bolt(a, b, roughness, depth) {
    if (depth === 0)
        return [a, b];
    const mid = {
        x: (a.x + b.x) / 2 + rand(-1, 1) * roughness,
        y: (a.y + b.y) / 2 + rand(-0.3, 0.3) * roughness,
    };
    const left = bolt(a, mid, roughness / 2, depth - 1);
    const right = bolt(mid, b, roughness / 2, depth - 1);
    return [...left.slice(0, -1), ...right];
}

export function cast(ctx) {
    const {fx, result, settings, colors} = ctx;
    const m = ctx.monitor;
    const end = result.info.end;
    const start = {x: end.x + rand(-m.width * 0.12, m.width * 0.12), y: m.y};
    const len = Math.hypot(end.x - start.x, end.y - start.y);

    const main = bolt(start, end, len * 0.25, 6);
    const branches = [];
    for (let i = 0; i < 3; i++) {
        const from = main[Math.floor(rand(0.2, 0.7) * main.length)];
        const to = {x: from.x + rand(-1, 1) * len * 0.25, y: from.y + rand(0.1, 0.35) * len};
        branches.push(bolt(from, to, len * 0.08, 4));
    }

    const area = fx.add(new St.DrawingArea({x: m.x, y: m.y, width: m.width, height: m.height, reactive: false}));
    const color = mix(colors[0], [0.75, 0.85, 1], 0.5);
    area.connect('repaint', a => {
        const cr = a.get_context();
        cr.translate(-m.x, -m.y);
        cr.setLineCap(1);
        cr.setLineJoin(1);
        const path = pts => {
            cr.moveTo(pts[0].x, pts[0].y);
            for (const p of pts.slice(1))
                cr.lineTo(p.x, p.y);
        };
        for (const [w, alpha, c] of [[34, 0.12, color], [16, 0.3, color], [8, 0.7, color], [3.5, 1, [1, 1, 1]]]) {
            cr.setSourceRGBA(...c, alpha);
            cr.setLineWidth(w);
            path(main);
            cr.stroke();
            cr.setLineWidth(w * 0.5);
            for (const b of branches) {
                path(b);
                cr.stroke();
            }
        }
        cr.$dispose();
    });

    fx.flash(m, [0.92, 0.95, 1], 0.55, 260);
    fx.burst(end.x, end.y, {count: 30, colors: [[1, 1, 1], color, [0.7, 0.8, 1]], speed: 140, size: [2, 6]});

    // Flicker, then fade.
    const steps = [[60, 60], [255, 50], [90, 40], [255, 60], [0, 380]];
    const done = destroyer(area);
    const flicker = i => {
        if (i >= steps.length) {
            done();
            return;
        }
        area.ease({opacity: steps[i][0], duration: steps[i][1], onComplete: () => flicker(i + 1),
            onStopped: finished => {
                if (!finished)
                    done();
            }});
    };
    flicker(0);

    const appId = settings.get_string('lightning-app');
    const app = appId ? Shell.AppSystem.get_default().lookup_app(appId) : null;
    if (app)
        app.activate();
    else
        Main.notify('Spellcaster', `Lightning Strike can't find the app "${appId}". Pick one in the Spellbook.`);
}
