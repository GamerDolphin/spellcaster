// SPDX-License-Identifier: GPL-2.0-or-later
//
// Bonus spells you can bind any rune to in the Spellbook.

import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {Palette} from '../lib/fx.js';

export function screenshot(ctx) {
    const {x, y} = ctx.result.info.center;
    ctx.fx.flash(ctx.monitor, [1, 1, 1], 0.4, 200);
    ctx.fx.burst(x, y, {count: 16, colors: Palette.sparkle});
    SystemActions.getDefault().activateScreenshotUI();
}

export function overview(ctx) {
    const {x, y} = ctx.result.info.center;
    ctx.fx.burst(x, y, {count: 20, colors: [ctx.colors[0], ctx.colors[1], [1, 1, 1]]});
    Main.overview.toggle();
}

function step(ctx, dir) {
    const ws = global.workspace_manager.get_active_workspace();
    const next = ws.get_neighbor(dir);
    const {x, y} = ctx.result.info.center;
    ctx.fx.burst(x, y, {count: 14, colors: [ctx.colors[0], ctx.colors[1]]});
    if (next && next !== ws)
        next.activate(global.get_current_time());
}

export const workspaceLeft = ctx => step(ctx, Meta.MotionDirection.LEFT);
export const workspaceRight = ctx => step(ctx, Meta.MotionDirection.RIGHT);

export function command(ctx) {
    const cmds = ctx.settings.get_value('rune-commands').deepUnpack();
    const cmd = (cmds[ctx.rune] ?? '').trim();
    const {x, y} = ctx.result.info.center;
    if (!cmd) {
        Main.notify('Spellcaster', `The ${ctx.rune} rune is set to run a command, but no command is set in the Spellbook.`);
        return;
    }
    ctx.fx.burst(x, y, {count: 18, colors: [ctx.colors[0], ctx.colors[1], [1, 1, 1]]});
    Util.spawnCommandLine(cmd);
}
