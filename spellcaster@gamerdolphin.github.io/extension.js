// SPDX-License-Identifier: GPL-2.0-or-later
//
// Spellcaster: draw glowing runes with your mouse to cast spells.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';

import {CastOverlay} from './lib/castOverlay.js';
import {confirmSpell} from './lib/confirm.js';
import {SoundMode} from './lib/soundMode.js';
import {Familiar} from './lib/familiar.js';
import {FamiliarPowers} from './lib/familiarPowers.js';
import {Fx, Palette} from './lib/fx.js';
import {RUNE_INFO, spellInfo} from './lib/runes.js';

import * as Fireball from './spells/fireball.js';
import * as Lightning from './spells/lightning.js';
import * as Portal from './spells/portal.js';
import * as Freeze from './spells/freeze.js';
import * as Summon from './spells/summon.js';
import * as Enchant from './spells/enchant.js';
import * as Slumber from './spells/slumber.js';
import * as Logout from './spells/logout.js';
import * as Extras from './spells/extras.js';

// Spells big enough to ask "are you sure?" first.
const CONFIRM = {
    freeze: {title: 'Freeze?', body: 'This will lock your screen.', confirmLabel: 'Freeze'},
    slumber: {title: 'Slumber?', body: 'Your PC will go to sleep. Nothing gets closed.', confirmLabel: 'Sleep'},
    logout: {title: 'Log out?', body: 'You\u2019ll be logged out. Apps with unsaved work will ask you to save.', confirmLabel: 'Log out'},
};

const SPELLS = {
    'fireball': Fireball.cast,
    'lightning': Lightning.cast,
    'portal': Portal.cast,
    'freeze': Freeze.cast,
    'summon': Summon.cast,
    'enchant': Enchant.cast,
    'sound': ctx => {
        const {x, y} = ctx.result.info.center;
        ctx.fx.shockwave(x, y, {color: ctx.colors[0], size: 300, duration: 550});
        ctx.sound.toggle(ctx.colors);
    },
    'slumber': Slumber.cast,
    'logout': Logout.cast,
    'spellbook': ctx => ctx.openSpellbook(),
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
        this._fx = new Fx(this._settings, this.path);
        this._familiar = new Familiar(this._settings, this._fx);
        this._sound = new SoundMode(this._fx);
        this._powers = new FamiliarPowers(this._familiar, this._settings);

        this._overlay = new CastOverlay(this._settings, this._fx, {
            onBegin: () => this._familiar.onCastBegin(),
            onEnd: () => this._familiar.onCastEnd(),
            onCast: (result, info) => this._cast(result, info),
            onFizzle: (result, info) => this._fizzle(result, info),
        });

        Main.wm.addKeybinding('cast-shortcut', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => {
                // While Sound Control is on, the shortcut just ends it.
                if (this._sound.active)
                    this._sound.exit();
                else
                    this._overlay.toggle();
            });

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
        this._confirmDialog?.destroy();
        this._confirmDialog = null;
        Main.wm.removeKeybinding('cast-shortcut');
        LoginManager.getLoginManager().disconnect(this._sleepId);
        this._overlay.destroy();
        this._sound.destroy();
        this._sound = null;
        this._powers.destroy();
        this._powers = null;
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

        const ctx = {
            rune,
            result,
            colors,
            monitor,
            settings: this._settings,
            fx: this._fx,
            familiar: this._familiar,
            sound: this._sound,
            logOut: this._logOut, // only set by the test driver
            openSpellbook: () => this.openPreferences(),
            onSlumber: () => {
                wakeSparklePending = this._settings.get_boolean('slumber-wake-sparkle');
            },
        };

        const ask = CONFIRM[spellId];
        if (ask && this._settings.get_boolean('confirm-big-spells')) {
            this._confirmDialog?.destroy();
            // Let the cast sigil fade first so it doesn't cover the popup.
            this._fx.later(750, () => this._askFirst(ask, spellId, spell, ctx));
            return;
        }
        this._runSpell(spellId, spell, ctx);
    }

    _askFirst(ask, spellId, spell, ctx) {
        this._confirmDialog = confirmSpell({
            ...ask,
            seconds: this._settings.get_int('confirm-seconds'),
            onConfirm: () => {
                this._confirmDialog = null;
                this._runSpell(spellId, spell, ctx);
            },
            onCancel: () => {
                this._confirmDialog = null;
                const {x, y} = ctx.result.info.center;
                this._fx?.smoke(x, y, 6);
            },
        });
    }

    _runSpell(spellId, spell, ctx) {
        if (!this._fx)
            return;
        try {
            spell(ctx);
            this._familiar.onSpell(spellId, ctx.result.info.center);
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
