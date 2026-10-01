// SPDX-License-Identifier: GPL-2.0-or-later
//
// ⛰️ Summon: your familiar appears in a burst of light where you drew the
// rune, or waves goodbye if it's already out.

import {Palette} from '../lib/fx.js';

export function cast(ctx) {
    const {x, y} = ctx.result.info.center;
    ctx.fx.burst(x, y, {count: 36, colors: Palette.sparkle, speed: 110, up: 30});
    ctx.familiar.toggle(x, y);
}
