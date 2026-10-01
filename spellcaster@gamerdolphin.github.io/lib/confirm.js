// SPDX-License-Identifier: GPL-2.0-or-later
//
// "Are you sure?" popup for the big spells (Freeze, Slumber). It cancels
// itself after a few seconds, so a mis-drawn rune never locks or sleeps
// the PC on its own.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.body
 * @param {string} o.confirmLabel
 * @param {number} o.seconds      auto-cancel after this many seconds
 * @param {() => void} o.onConfirm
 * @param {() => void} [o.onCancel]
 * @returns {{confirm: () => void, cancel: () => void, destroy: () => void}}
 */
export function confirmSpell({title, body, confirmLabel, seconds = 10, onConfirm, onCancel}) {
    const dialog = new ModalDialog.ModalDialog({styleClass: 'spellcaster-confirm', destroyOnClose: true});
    const content = new Dialog.MessageDialogContent({title, description: body});
    dialog.contentLayout.add_child(content);

    let left = seconds;
    let done = false;
    let timer = 0;
    const describe = () => (content.description = `${body}\n\nCancelling in ${left}s…`);
    describe();

    const finish = ok => {
        if (done)
            return;
        done = true;
        if (timer)
            GLib.source_remove(timer);
        timer = 0;
        dialog.close(global.get_current_time());
        if (ok)
            onConfirm();
        else
            onCancel?.();
    };

    // Cancel is the default (Enter / Esc), so a stray key press is safe.
    dialog.addButton({label: 'Cancel', action: () => finish(false), key: Clutter.KEY_Escape, default: true});
    dialog.addButton({label: confirmLabel, action: () => finish(true)});

    timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        left--;
        if (left <= 0) {
            timer = 0;
            finish(false);
            return GLib.SOURCE_REMOVE;
        }
        describe();
        return GLib.SOURCE_CONTINUE;
    });

    dialog.open(global.get_current_time());

    return {
        confirm: () => finish(true),
        cancel: () => finish(false),
        destroy: () => {
            done = true;
            if (timer)
                GLib.source_remove(timer);
            timer = 0;
            dialog.destroy();
        },
        get open() {
            return !done;
        },
    };
}
