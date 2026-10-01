// SPDX-License-Identifier: GPL-2.0-or-later

import Meta from 'gi://Meta';

const NORMAL_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
];

function isUserWindow(win, workspace) {
    return win &&
        NORMAL_TYPES.includes(win.get_window_type()) &&
        !win.minimized &&
        !win.is_skip_taskbar() &&
        win.located_on_workspace(workspace);
}

/** Windows on the current workspace, bottom to top. */
export function workspaceWindows() {
    const ws = global.workspace_manager.get_active_workspace();
    return global.get_window_actors()
        .filter(a => a.visible)
        .map(a => a.get_meta_window())
        .filter(w => isUserWindow(w, ws));
}

/** The topmost normal window under a screen point, or null. */
export function windowAt(x, y) {
    const wins = workspaceWindows();
    for (let i = wins.length - 1; i >= 0; i--) {
        const r = wins[i].get_frame_rect();
        if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height)
            return wins[i];
    }
    return null;
}

/** Centre of a window actor in stage coordinates. */
export function actorCenter(actor) {
    return {x: actor.x + actor.width / 2, y: actor.y + actor.height / 2};
}

/** Put an actor back to how the compositor expects it. */
export function resetActor(actor) {
    actor.remove_all_transitions();
    actor.set({
        opacity: 255,
        scale_x: 1,
        scale_y: 1,
        translation_x: 0,
        translation_y: 0,
        rotation_angle_z: 0,
    });
}
