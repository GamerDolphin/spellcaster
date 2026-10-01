// SPDX-License-Identifier: GPL-2.0-or-later
//
// Spellcaster: draw glowing runes with your mouse to cast spells.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

import {CastOverlay} from './lib/castOverlay.js';
import {Familiar} from './lib/familiar.js';
import {Fx, Palette} from './lib/fx.js';
import {RUNE_INFO, spellInfo} from './lib/runes.js';

import * as Fireball from './spells/fireball.js';
import * as Lightning from './spells/lightning.js';
import * as Portal from './spells/portal.js';
import * as Freeze from './spells/freeze.js';
import * as Summon from './spells/summon.js';
import * as Enchant from './spells/enchant.js';
import * as Slumber from './spells/slumber.js';
import * as Extras from './spells/extras.js';

const SPELLS = {
    'fireball': Fireball.cast,
    'lightning': Lightning.cast,
    'portal': Portal.cast,
    'freeze': Freeze.cast,
    'summon': Summon.cast,
    'enchant': Enchant.cast,
    'slumber': Slumber.cast,
    'screenshot': Extras.screenshot,
    'overview': Extras.overview,
    'workspace-left': Extras.workspaceLeft,
    'workspace-right': Extras.workspaceRight,
    'command': Extras.command,
    'none': () => {},
};

// The extension is switched off on the lock screen and back on after
// unlocking. This module stays loaded, so a flag here survives that and
// lets us play the wake-up sparkle after a Slumber.
let wakeSparklePending = false;

export default class SpellcasterExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._fx = new Fx(this._settings);
        this._familiar = new Familiar(this._settings, this._fx);

        this._overlay = new CastOverlay(this._settings, this._fx, {
            onBegin: () => this._familiar.onCastBegin(),
            onEnd: () => this._familiar.onCastEnd(),
            onCast: (result, info) => this._cast(result, info),
            onFizzle: (result, info) => this._fizzle(result, info),
        });

        Main.wm.addKeybinding('cast-shortcut', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._overlay.toggle());

        // Waking from Slumber without a lock screen in between.
        this._sleepId = LoginManager.getLoginManager().connect('prepare-for-sleep', (_lm, aboutToSuspend) => {
            if (!aboutToSuspend && wakeSparklePending)
                this._fx.later(700, () => this._wakeSparkle());
        });
        // Coming back after unlocking.
        if (wakeSparklePending)
            this._fx.later(600, () => this._wakeSparkle());
    }

    disable() {
        // Runs on the lock screen too (Freeze, Slumber), so clean up everything.
        Main.wm.removeKeybinding('cast-shortcut');
        LoginManager.getLoginManager().disconnect(this._sleepId);
        this._overlay.destroy();
        this._familiar.destroy();
        Portal.reset();
        this._fx.destroy();
        this._overlay = null;
        this._familiar = null;
        this._fx = null;
        this._settings = null;
    }

    _cast(result, {colors, monitor}) {
        const rune = result.rune;
        const spellId = this._settings.get_string(`rune-${rune}`);
        const spell = SPELLS[spellId] ?? SPELLS.none;

        if (this._settings.get_boolean('show-rune-name') && spellId !== 'none') {
            const info = RUNE_INFO.find(r => r.id === rune);
            // Just above the rune, so it doesn't cover what you drew on.
            const {x} = result.info.center;
            const y = Math.max(monitor.y + 70, result.info.bbox.y - 36);
            this._fx.label(`${info?.emoji ?? '✨'} ${spellInfo(spellId).name}`, x, y);
        }

        if (spellId !== 'summon')
            this._familiar.onCastSuccess();

        try {
            spell({
                rune,
                result,
                colors,
                monitor,
                settings: this._settings,
                fx: this._fx,
                familiar: this._familiar,
                onSlumber: () => {
                    wakeSparklePending = this._settings.get_boolean('slumber-wake-sparkle');
                },
            });
        } catch (e) {
            console.error(`Spellcaster: ${spellId} failed: ${e}\n${e.stack}`);
            Main.notify('Spellcaster', `The ${spellInfo(spellId).name} spell failed: ${e.message}`);
        }
    }

    _fizzle(result, {points}) {
        const p = result.info?.center ?? points[points.length - 1];
        if (p && this._settings.get_boolean('show-rune-name'))
            this._fx.label('fizzle…', p.x, p.y, {fizzle: true, duration: 900});
        this._familiar.onFizzle();
    }

    _wakeSparkle() {
        if (!wakeSparklePending || !this._fx)
            return;
        // Wait for the lock screen to be gone.
        if (Main.sessionMode.isLocked) {
            this._fx.later(1000, () => this._wakeSparkle());
            return;
        }
        wakeSparklePending = false;
        for (const m of Main.layoutManager.monitors) {
            this._fx.sparkleRain(m, 50);
            this._fx.burst(m.x + m.width / 2, m.y + m.height / 2, {count: 30, colors: Palette.sparkle, speed: 220});
        }
        this._familiar.wake();
    }
}
