// SPDX-License-Identifier: GPL-2.0-or-later
//
// The Spellbook: Spellcaster's settings window.

import Adw from 'gi://Adw';
import Cairo from 'cairo';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {recognize} from './lib/recognizer.js';
import {RUNE_INFO, SPELL_INFO, THEMES, runeGuide, runeInfo, spellInfo, themeColors} from './lib/runes.js';
import {FAMILIARS, cpuGlow, draw as drawFamiliar} from './lib/familiarArt.js';

const ARCANE = [0.7, 0.42, 1];

// --- Little drawing helpers ------------------------------------------------

/** Draw a rune's "how to draw it" picture into a w×h box. */
function paintRune(cr, id, w, h, color = ARCANE) {
    const pts = runeGuide(id);
    if (pts.length < 2)
        return;
    const pad = Math.min(w, h) * 0.14;
    const size = Math.min(w, h) - pad * 2;
    const ox = (w - size) / 2, oy = (h - size) / 2;
    const P = p => [ox + p.x * size, oy + p.y * size];

    cr.setLineCap(1);
    cr.setLineJoin(1);
    for (const [lw, a] of [[size * 0.16, 0.15], [size * 0.08, 0.35], [size * 0.045, 1]]) {
        cr.setSourceRGBA(...color, a);
        cr.setLineWidth(lw);
        cr.moveTo(...P(pts[0]));
        for (const p of pts.slice(1))
            cr.lineTo(...P(p));
        cr.stroke();
    }

    // Arrow at the end shows which way to draw.
    const [ex, ey] = P(pts[pts.length - 1]);
    const [px, py] = P(pts[Math.max(0, pts.length - 4)]);
    const ang = Math.atan2(ey - py, ex - px);
    const al = size * 0.13;
    cr.setSourceRGBA(...color, 1);
    cr.moveTo(ex + Math.cos(ang) * al * 0.4, ey + Math.sin(ang) * al * 0.4);
    cr.lineTo(ex + Math.cos(ang + 2.5) * al, ey + Math.sin(ang + 2.5) * al);
    cr.lineTo(ex + Math.cos(ang - 2.5) * al, ey + Math.sin(ang - 2.5) * al);
    cr.closePath();
    cr.fill();

    // Green dot where you start.
    const [sx, sy] = P(pts[0]);
    cr.setSourceRGBA(0.35, 0.95, 0.55, 1);
    cr.arc(sx, sy, Math.max(3, size * 0.085), 0, Math.PI * 2);
    cr.fill();
}

function runePicture(id, px = 44) {
    const area = new Gtk.DrawingArea({content_width: px, content_height: px, valign: Gtk.Align.CENTER});
    area.set_draw_func((_a, cr, w, h) => paintRune(cr, id, w, h));
    return area;
}

// --- Settings binding helpers ----------------------------------------------

class Binder {
    constructor(settings) {
        this.settings = settings;
        this._ids = [];
    }

    watch(key, fn) {
        this._ids.push(this.settings.connect(`changed::${key}`, fn));
    }

    /** Bind an Adw.ComboRow to a string key using a list of ids. */
    combo(row, key, ids) {
        const sync = () => {
            const i = ids.indexOf(this.settings.get_string(key));
            if (i >= 0 && row.selected !== i)
                row.selected = i;
        };
        sync();
        row.connect('notify::selected', () => {
            const id = ids[row.selected];
            if (id !== undefined && this.settings.get_string(key) !== id)
                this.settings.set_string(key, id);
        });
        this.watch(key, sync);
    }

    switchRow(title, subtitle, key) {
        const row = new Adw.SwitchRow({title, subtitle});
        this.settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    spinRow(title, subtitle, key, lower, upper, step) {
        const row = Adw.SpinRow.new_with_range(lower, upper, step);
        row.set({title, subtitle});
        this.settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    scaleRow(title, subtitle, key, lower, upper, step, marks = []) {
        const row = new Adw.ActionRow({title, subtitle});
        const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, lower, upper, step);
        scale.set({hexpand: true, width_request: 220, valign: Gtk.Align.CENTER, draw_value: false});
        for (const [v, label] of marks)
            scale.add_mark(v, Gtk.PositionType.BOTTOM, label);
        this.settings.bind(key, scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(scale);
        return row;
    }

    disconnectAll() {
        for (const id of this._ids)
            this.settings.disconnect(id);
        this._ids = [];
    }
}

function comboRow(title, subtitle, names) {
    return new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(names)});
}

// --- Shortcut picker ---------------------------------------------------------

function shortcutRow(window, settings, key) {
    const row = new Adw.ActionRow({
        title: 'Cast shortcut',
        subtitle: 'Press it, draw a rune, let go. Esc or right-click cancels.',
    });
    const label = new Gtk.ShortcutLabel({disabled_text: 'Off', valign: Gtk.Align.CENTER});
    const sync = () => (label.accelerator = settings.get_strv(key)[0] ?? '');
    sync();
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(id));

    const button = new Gtk.Button({label: 'Change', valign: Gtk.Align.CENTER});
    button.connect('clicked', () => {
        const dialog = new Adw.AlertDialog({
            heading: 'New cast shortcut',
            body: 'Press the keys you want (for example Super + Z).\nEsc cancels · Backspace turns the shortcut off',
        });
        dialog.add_response('cancel', 'Cancel');
        const keys = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        keys.connect('key-pressed', (_c, keyval, keycode, state) => {
            let mask = state & Gtk.accelerator_get_default_mod_mask();
            mask &= ~Gdk.ModifierType.LOCK_MASK;
            const lower = Gdk.keyval_to_lower(keyval);
            if (mask === 0 && lower === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (mask === 0 && lower === Gdk.KEY_BackSpace) {
                settings.set_strv(key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            // Wait until a real key comes with the modifiers.
            if (!Gtk.accelerator_valid(lower, mask) || mask === 0)
                return Gdk.EVENT_STOP;
            settings.set_strv(key, [Gtk.accelerator_name_with_keycode(null, lower, keycode, mask)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(keys);
        dialog.present(window);
    });

    row.add_suffix(label);
    row.add_suffix(button);
    return row;
}

// --- Pages -------------------------------------------------------------------

function spellsPage(window, b) {
    const s = b.settings;
    const page = new Adw.PreferencesPage({title: 'Spells', icon_name: 'starred-symbolic'});

    const intro = new Adw.PreferencesGroup({
        title: 'Your runes',
        description: 'Each rune casts a spell. Pick a different spell for any rune. The green dot shows where to start drawing.',
    });
    page.add(intro);

    const spellIds = SPELL_INFO.map(x => x.id);
    const spellNames = SPELL_INFO.map(x => x.name);

    for (const rune of RUNE_INFO) {
        const key = `rune-${rune.id}`;
        const row = comboRow(`${rune.emoji}  ${rune.name}`, rune.hint, spellNames);
        row.add_prefix(runePicture(rune.id));
        b.combo(row, key, spellIds);
        intro.add(row);

        // Command box, only shown when the rune runs a custom command.
        const cmdRow = new Adw.EntryRow({title: `Command for the ${rune.name} rune`, show_apply_button: true});
        const cmds = () => s.get_value('rune-commands').deepUnpack();
        cmdRow.text = cmds()[rune.id] ?? '';
        cmdRow.connect('apply', () => {
            const all = cmds();
            all[rune.id] = cmdRow.text;
            s.set_value('rune-commands', new GLib.Variant('a{ss}', all));
        });
        const syncVis = () => (cmdRow.visible = s.get_string(key) === 'command');
        syncVis();
        b.watch(key, syncVis);
        intro.add(cmdRow);
    }

    // Lightning app.
    const lightning = new Adw.PreferencesGroup({title: '⚡ Lightning Strike'});
    const apps = Gio.AppInfo.get_all()
        .filter(a => a.should_show() && a.get_id())
        .sort((x, y) => x.get_display_name().localeCompare(y.get_display_name()));
    const appIds = apps.map(a => a.get_id());
    const current = s.get_string('lightning-app');
    if (current && !appIds.includes(current)) {
        appIds.unshift(current);
        apps.unshift(null);
    }
    const appRow = comboRow('App to launch', 'Opens it, or brings it to the front if it is already open',
        apps.map((a, i) => a ? a.get_display_name() : `${appIds[i]} (not found)`));
    appRow.enable_search = true;
    b.combo(appRow, 'lightning-app', appIds);
    lightning.add(appRow);
    page.add(lightning);

    // Enchant.
    const enchant = new Adw.PreferencesGroup({title: '🥣 Enchant'});
    const modeIds = ['quicklofi', 'any-player', 'command'];
    const modeRow = comboRow('Music', 'What the Enchant spell plays and pauses',
        ['Quick Lofi (then any player)', 'Any music player', 'Custom command']);
    b.combo(modeRow, 'enchant-mode', modeIds);
    enchant.add(modeRow);
    const enchantCmd = new Adw.EntryRow({title: 'Enchant command', show_apply_button: true});
    s.bind('enchant-command', enchantCmd, 'text', Gio.SettingsBindFlags.GET);
    enchantCmd.connect('apply', () => s.set_string('enchant-command', enchantCmd.text));
    const syncCmd = () => (enchantCmd.visible = s.get_string('enchant-mode') === 'command');
    syncCmd();
    b.watch('enchant-mode', syncCmd);
    enchant.add(enchantCmd);
    page.add(enchant);

    // Slumber.
    const slumber = new Adw.PreferencesGroup({title: '⬇️ Slumber'});
    slumber.add(b.spinRow('Curtain time (ms)', 'How long the curtain takes to fall. Click or press Esc during it to cancel',
        'slumber-curtain-ms', 500, 6000, 100));
    slumber.add(b.switchRow('Wake-up sparkle', 'A burst of sparkles when you come back', 'slumber-wake-sparkle'));
    page.add(slumber);

    return page;
}

function practicePage(b) {
    const s = b.settings;
    const page = new Adw.PreferencesPage({title: 'Practice Room', icon_name: 'input-mouse-symbolic'});
    const group = new Adw.PreferencesGroup({
        title: '🎯 Practice Room',
        description: 'Draw a rune in the box to see what Spellcaster thinks it is. Nothing gets cast here.',
    });

    let points = [];
    let last = null;
    const area = new Gtk.DrawingArea({content_height: 300, hexpand: true});
    area.add_css_class('card');
    const result = new Gtk.Label({
        label: 'Draw a rune…',
        wrap: true,
        justify: Gtk.Justification.CENTER,
        margin_top: 12,
        margin_bottom: 4,
    });
    result.add_css_class('title-3');
    const detail = new Gtk.Label({label: '', wrap: true, justify: Gtk.Justification.CENTER});
    detail.add_css_class('dim-label');

    const evaluate = () => {
        if (points.length < 2)
            return;
        const res = recognize(points, s.get_double('tolerance'));
        last = res;
        if (res.rune) {
            const r = runeInfo(res.rune);
            const spell = spellInfo(s.get_string(`rune-${res.rune}`));
            result.label = `${r.emoji}  ${r.name}  →  ${spell.name}`;
            detail.label = `${Math.round(res.confidence * 100)}% sure`;
        } else if (res.closest) {
            const r = runeInfo(res.closest);
            result.label = '💨  Fizzle';
            detail.label = `Closest was ${r.emoji} ${r.name} (${Math.round(res.closestConfidence * 100)}%). ` +
                'Try drawing it bigger and smoother, or move the slider toward Forgiving.';
        } else {
            result.label = '💨  Fizzle';
            detail.label = "That doesn't look like any rune yet.";
        }
        area.queue_draw();
    };

    area.set_draw_func((_a, cr, w, h) => {
        if (points.length === 0) {
            cr.setSourceRGBA(0.6, 0.5, 0.8, 0.45);
            cr.selectFontFace('Sans', 0, 0);
            cr.setFontSize(15);
            const text = 'draw here';
            const ext = cr.textExtents(text);
            cr.moveTo((w - ext.width) / 2, h / 2);
            cr.showText(text);
            return;
        }
        const color = last && !last.rune && points.length > 0 ? [0.55, 0.45, 0.7] : ARCANE;
        cr.setLineCap(1);
        cr.setLineJoin(1);
        for (const [lw, a] of [[18, 0.12], [9, 0.3], [4, 1]]) {
            cr.setSourceRGBA(...color, a);
            cr.setLineWidth(lw);
            cr.moveTo(points[0].x, points[0].y);
            for (const p of points.slice(1))
                cr.lineTo(p.x, p.y);
            cr.stroke();
        }
    });

    const drag = new Gtk.GestureDrag();
    drag.connect('drag-begin', (_g, x, y) => {
        points = [{x, y}];
        last = null;
        result.label = 'Drawing…';
        detail.label = '';
        area.queue_draw();
    });
    drag.connect('drag-update', (g, ox, oy) => {
        const [, sx, sy] = g.get_start_point();
        points.push({x: sx + ox, y: sy + oy});
        area.queue_draw();
    });
    drag.connect('drag-end', () => evaluate());
    area.add_controller(drag);

    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    box.append(area);
    box.append(result);
    box.append(detail);
    group.add(box);
    page.add(group);

    const tune = new Adw.PreferencesGroup({title: 'Recognition'});
    tune.add(b.scaleRow('How picky', 'Strict avoids mix-ups · Forgiving accepts sloppier runes',
        'tolerance', 0, 1, 0.05, [[0, 'Strict'], [0.5, null], [1, 'Forgiving']]));
    b.watch('tolerance', evaluate);
    page.add(tune);

    // Gallery.
    const gallery = new Adw.PreferencesGroup({title: 'How to draw each rune'});
    const flow = new Gtk.FlowBox({
        selection_mode: Gtk.SelectionMode.NONE,
        max_children_per_line: 7,
        min_children_per_line: 3,
        column_spacing: 12,
        row_spacing: 12,
        homogeneous: true,
    });
    for (const rune of RUNE_INFO) {
        const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4});
        card.add_css_class('card');
        card.set({margin_top: 2, margin_bottom: 2});
        const pic = runePicture(rune.id, 72);
        pic.set({margin_top: 8, halign: Gtk.Align.CENTER});
        card.append(pic);
        const name = new Gtk.Label({label: `${rune.emoji} ${rune.name}`});
        name.add_css_class('heading');
        card.append(name);
        const spell = new Gtk.Label({label: spellInfo(s.get_string(`rune-${rune.id}`)).name, margin_bottom: 8});
        spell.add_css_class('dim-label');
        b.watch(`rune-${rune.id}`, () => (spell.label = spellInfo(s.get_string(`rune-${rune.id}`)).name));
        card.append(spell);
        flow.append(card);
    }
    gallery.add(flow);
    page.add(gallery);

    return page;
}

function castingPage(window, b) {
    const s = b.settings;
    const page = new Adw.PreferencesPage({title: 'Casting', icon_name: 'applications-graphics-symbolic'});

    const group = new Adw.PreferencesGroup({title: 'Casting'});
    group.add(shortcutRow(window, s, 'cast-shortcut'));
    page.add(group);

    const look = new Adw.PreferencesGroup({title: 'Your magic'});
    const themeIds = Object.keys(THEMES);
    const themeRow = comboRow('Trail colour', 'Chaos picks new colours every cast', themeIds.map(t => THEMES[t].name));
    const swatch = new Gtk.DrawingArea({content_width: 90, content_height: 30, valign: Gtk.Align.CENTER});
    swatch.set_draw_func((_a, cr, w, h) => {
        const [c1, c2] = themeColors(s.get_string('trail-theme'));
        cr.setLineCap(1);
        for (const [lw, a] of [[12, 0.15], [6, 0.4], [3, 1]]) {
            const g = new Cairo.LinearGradient(8, 0, w - 8, 0);
            g.addColorStopRGBA(0, ...c1, a);
            g.addColorStopRGBA(1, ...c2, a);
            cr.setSource(g);
            cr.setLineWidth(lw);
            cr.moveTo(8, h * 0.7);
            cr.curveTo(w * 0.35, h * 0.05, w * 0.6, h * 1.0, w - 8, h * 0.3);
            cr.stroke();
        }
    });
    themeRow.add_suffix(swatch);
    b.combo(themeRow, 'trail-theme', themeIds);
    b.watch('trail-theme', () => swatch.queue_draw());
    look.add(themeRow);
    look.add(b.spinRow('Trail thickness', null, 'trail-width', 2, 20, 1));
    look.add(b.switchRow('Show spell names', 'A label pops up when you cast (or fizzle)', 'show-rune-name'));
    look.add(b.switchRow('Reduce effects', 'Fewer particles, for slower computers', 'reduce-effects'));
    page.add(look);

    return page;
}

function familiarPage(b) {
    const s = b.settings;
    const page = new Adw.PreferencesPage({title: 'Familiar', icon_name: 'emote-love-symbolic'});

    // Live preview.
    const preview = new Adw.PreferencesGroup({title: 'Your familiar', description: 'Move your mouse over it.'});
    const area = new Gtk.DrawingArea({content_height: 170, hexpand: true});
    area.add_css_class('card');
    let t = 0, look = {x: 0, y: 0}, mouse = null, blinkUntil = 0, nextBlink = 2;
    let start = null;
    area.add_tick_callback((_w, clock) => {
        const now = clock.get_frame_time() / 1e6;
        start ??= now;
        t = now - start;
        if (t > nextBlink) {
            blinkUntil = t + 0.14;
            nextBlink = t + 2.5 + Math.random() * 3;
        }
        area.queue_draw();
        return GLib.SOURCE_CONTINUE;
    });
    const motion = new Gtk.EventControllerMotion();
    motion.connect('motion', (_c, x, y) => (mouse = {x, y}));
    motion.connect('leave', () => (mouse = null));
    area.add_controller(motion);
    area.set_draw_func((_a, cr, w, h) => {
        const size = Math.min(s.get_int('familiar-size') * 1.4, h * 0.45);
        const cx = w / 2, cy = h / 2 + Math.sin(t * 2.1) * 3;
        const target = mouse ? (() => {
            const dx = mouse.x - cx, dy = mouse.y - cy, d = Math.hypot(dx, dy) || 1;
            return {x: dx / d, y: dy / d};
        })() : {x: 0, y: 0};
        look.x += (target.x - look.x) * 0.15;
        look.y += (target.y - look.y) * 0.15;
        const load = (Math.sin(t * 0.4) + 1) / 2; // demo the CPU glow
        cr.translate(cx, cy);
        drawFamiliar(cr, s.get_string('familiar-type'), {
            size, t, look,
            facing: mouse && mouse.x < cx ? -1 : 1,
            blink: t < blinkUntil,
            mood: mouse ? 'watch' : 'idle',
            glow: s.get_boolean('familiar-react-cpu') ? cpuGlow(load) : cpuGlow(0),
            pulse: (Math.sin(t * (1.2 + load * 4)) + 1) / 2 * 0.6,
            moving: 0.35,
            tail: [1, 2, 3, 4, 5, 6].map(i => ({x: -i * 5 - Math.sin(t * 2 + i) * 2, y: Math.sin(t * 2.1 - i * 0.4) * 4})),
        });
    });
    preview.add(area);
    page.add(preview);

    const main = new Adw.PreferencesGroup({title: 'Familiar'});
    main.add(b.switchRow('Summoned', 'Same as drawing the Summon rune', 'familiar-visible'));
    const typeIds = Object.keys(FAMILIARS);
    const typeRow = comboRow('Creature', null, typeIds.map(k => FAMILIARS[k].name));
    b.combo(typeRow, 'familiar-type', typeIds);
    main.add(typeRow);
    const modeIds = ['follow', 'perch', 'wander'];
    const modeRow = comboRow('Behaviour', null, [
        'Follow: lazily trails your cursor from a distance',
        'Perch: sits in the top-right corner and watches',
        'Wander: floats slowly around the screen edges',
    ]);
    b.combo(modeRow, 'familiar-mode', modeIds);
    main.add(modeRow);
    main.add(b.spinRow('Size', 'In pixels', 'familiar-size', 16, 96, 2));
    main.add(b.scaleRow('Opacity', null, 'familiar-opacity', 0.2, 1, 0.05));
    page.add(main);

    const calm = new Adw.PreferencesGroup({
        title: 'Keeping it calm',
        description: 'Your familiar never blocks clicks, makes no sound, and drifts away if your cursor gets close.',
    });
    calm.add(b.switchRow('Hide in fullscreen', 'Disappears during games and fullscreen videos', 'familiar-hide-fullscreen'));
    calm.add(b.switchRow('Glow with CPU load', 'Blue when idle → purple when busy → orange when maxed out', 'familiar-react-cpu'));
    calm.add(b.switchRow('Nap when idle', 'Floats up under the top bar and dozes off', 'familiar-nap'));
    const nap = b.spinRow('Nap after (minutes)', null, 'familiar-nap-minutes', 1, 60, 1);
    s.bind('familiar-nap', nap, 'sensitive', Gio.SettingsBindFlags.GET);
    calm.add(nap);
    page.add(calm);

    for (const key of ['familiar-type', 'familiar-size', 'familiar-react-cpu'])
        b.watch(key, () => area.queue_draw());

    return page;
}

export default class SpellcasterPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const b = new Binder(this.getSettings());
        window.set_default_size(720, 820);
        window.search_enabled = true;
        window.add(spellsPage(window, b));
        window.add(practicePage(b));
        window.add(castingPage(window, b));
        window.add(familiarPage(b));
        window.connect('close-request', () => b.disconnectAll());
    }
}
