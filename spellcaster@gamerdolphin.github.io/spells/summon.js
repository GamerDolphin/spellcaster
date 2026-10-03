// SPDX-License-Identifier: GPL-2.0-or-later
//
// ⛰️ Summon: your familiar appears in a burst of light where you drew the
// rune, or waves goodbye if it's already out.

import {Palette} from '../lib/fx.js';

export function cast(ctx) {
    const {x, y} = ctx.result.info.center;
    const {fx} = ctx;
    fx.shockwave(x, y, {color: [1, 0.85, 0.4], size: 360, duration: 700, delay: 250});
    fx.burst(x, y, {count: 40, colors: Palette.sparkle, speed: 130, up: 40, stars: 0.5});
    // The familiar steps out of the circle a moment later.
    fx.later(280, () => ctx.familiar.toggle(x, y));
}
