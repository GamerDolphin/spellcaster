// SPDX-License-Identifier: GPL-2.0-or-later
//
// Test driver for Spellcaster. Only ever loaded by tools/headless-test.sh
// inside a throwaway headless GNOME Shell. It draws runes with a virtual
// mouse, takes screenshots, and checks what happened.
//
// Suspend and lock are replaced with fakes so the test can never put the
// real computer to sleep.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot');

const OUT = GLib.getenv('SPELLTEST_OUT');
const REPO = GLib.getenv('SPELLTEST_REPO');
const UUID = 'spellcaster@gamerdolphin.github.io';

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));
const log = m => console.log(`SPELLTEST ${m}`);
const results = [];
function check(name, ok, detail = '') {
    results.push({name, ok: !!ok, detail: String(detail)});
    log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
}

async function shot(name) {
    try {
        const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    } catch (e) {
        log(`screenshot ${name} failed: ${e}`);
    }
}

let pointer, keyboard;
const now = () => GLib.get_monotonic_time();
const moveTo = (x, y) => pointer.notify_absolute_motion(now(), x, y);
const press = () => pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
const release = () => pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);

function key(keyval, pressed) {
    keyboard.notify_keyval(now(), keyval, pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
}

/** Rune guide path scaled to a box, with a point every ~5px. */
function runePath(runes, id, cx, cy, size) {
    const g = runes.runeGuide(id).map(p => ({x: cx + (p.x - 0.5) * size, y: cy + (p.y - 0.5) * size}));
    const out = [g[0]];
    for (let i = 1; i < g.length; i++) {
        const a = g[i - 1], b = g[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
        for (let k = 1; k <= n; k++)
            out.push({x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n});
    }
    return out;
}

async function drawStroke(points, {shotAt = -1, shotName = ''} = {}) {
    moveTo(points[0].x, points[0].y);
    await sleep(40);
    press();
    await sleep(16);
    for (let i = 1; i < points.length; i++) {
        moveTo(points[i].x, points[i].y);
        await sleep(6);
        if (i === shotAt)
            await shot(shotName);
    }
    await sleep(16);
    release();
}

function sc() {
    return Main.extensionManager.lookup(UUID)?.stateObj;
}

async function cast(runes, id, cx, cy, size = 320, opts = {}) {
    sc()._overlay.begin();
    await sleep(250);
    const pts = runePath(runes, id, cx, cy, size);
    await drawStroke(pts, {shotAt: opts.shotName ? Math.floor(pts.length * 0.8) : -1, shotName: opts.shotName});
}

function testWindows() {
    return global.get_window_actors()
        .map(a => a.get_meta_window())
        .filter(w => w.get_title()?.startsWith('🪟') || w.get_wm_class() === 'gjs' || (w.get_title() ?? '').includes('Window'));
}

function spawnWindow(title) {
    Util.spawn(['gjs', '-m', `${REPO}/tools/test-window.js`, title]);
}

async function waitFor(fn, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (fn())
            return true;
        await sleep(100);
    }
    return fn();
}

function countUiChildren() {
    return Main.layoutManager.uiGroup.get_n_children();
}

async function run() {
    const runes = await import(`file://${encodeURI(REPO)}/spellcaster@gamerdolphin.github.io/lib/runes.js`);
    const seat = Clutter.get_default_backend().get_default_seat();
    pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);

    // Never really suspend or lock.
    const sa = SystemActions.getDefault();
    let suspends = 0, locks = 0;
    sa.activateSuspend = () => suspends++;
    sa.activateLockScreen = () => locks++;

    const m = Main.layoutManager.primaryMonitor;
    const cx = m.x + m.width / 2, cy = m.y + m.height / 2;

    if (Main.overview.visible) {
        Main.overview.hide();
        await sleep(800);
    }

    const ext = Main.extensionManager.lookup(UUID);
    check('extension loaded', ext && ext.state === 1, `state=${ext?.state} error=${ext?.error ?? ''}`);
    if (!ext || ext.state !== 1) {
        finish();
        return;
    }
    const settings = sc()._settings;
    settings.set_boolean('familiar-visible', false);
    await shot('00-desktop');

    // Keyboard shortcut opens cast mode.
    key(Clutter.KEY_Super_L, true);
    key(Clutter.KEY_z, true);
    key(Clutter.KEY_z, false);
    key(Clutter.KEY_Super_L, false);
    await sleep(400);
    check('Super+Z starts casting', sc()._overlay.active);
    await shot('01-cast-mode');
    key(Clutter.KEY_Escape, true);
    key(Clutter.KEY_Escape, false);
    await sleep(400);
    check('Esc cancels casting', !sc()._overlay.active);

    // Windows to play with.
    spawnWindow('Window A');
    await sleep(600);
    spawnWindow('Window B');
    await sleep(600);
    spawnWindow('Window C');
    const gotWindows = await waitFor(() => testWindows().length >= 3, 15000);
    await sleep(1200);
    check('test windows opened', gotWindows, `count=${testWindows().length}`);
    await shot('02-windows');

    // Fizzle.
    sc()._overlay.begin();
    await sleep(200);
    const junk = [];
    for (let i = 0; i <= 60; i++)
        junk.push({x: cx - 200 + i * 7, y: cy + Math.sin(i / 3) * 4 + 200});
    await drawStroke(junk);
    await sleep(120);
    await shot('03-fizzle');
    check('junk stroke fizzles (overlay closed)', !sc()._overlay.active);
    await sleep(900);

    // Fireball on the top window.
    const before = testWindows().length;
    const top = testWindows().filter(w => !w.minimized).at(-1);
    const r = top.get_frame_rect();
    await cast(runes, 'spiral', r.x + r.width / 2, r.y + r.height / 2, 260, {shotName: '04-spiral-trail'});
    await sleep(120);
    await shot('04b-sigil');
    await sleep(130);
    await shot('05a-fireball-orb');
    await sleep(450);
    await shot('05b-fireball-boom');
    await sleep(600);
    await shot('05-fireball');
    const closed = await waitFor(() => testWindows().length === before - 1, 4000);
    check('Fireball closes the window under the spiral', closed, `before=${before} after=${testWindows().length}`);
    await sleep(800);

    // Portal: swallow and release.
    await cast(runes, 'circle', cx, cy, 300);
    await sleep(350);
    await shot('06-portal');
    const allMin = await waitFor(() => testWindows().every(w => w.minimized), 3000);
    check('Portal minimizes every window', allMin, testWindows().map(w => w.minimized).join(','));
    await sleep(1200);
    await cast(runes, 'circle', cx, cy, 300);
    await sleep(500);
    await shot('07-portal-release');
    const back = await waitFor(() => testWindows().every(w => !w.minimized), 3000);
    check('Second Portal brings the windows back', back, testWindows().map(w => w.minimized).join(','));
    await sleep(1000);
    const scaled = testWindows().map(w => w.get_compositor_private()).filter(a => a && (a.scale_x !== 1 || a.opacity !== 255));
    check('Restored windows look normal again', scaled.length === 0, `odd=${scaled.length}`);

    // Lightning launches the chosen app.
    settings.set_string('lightning-app', 'spellcaster-testwin.desktop');
    const n0 = testWindows().length;
    await cast(runes, 'lightning', cx - 300, cy, 300);
    await sleep(40);
    await shot('08a-lightning');
    await sleep(160);
    await shot('08-lightning');
    await sleep(150);
    await shot('08b-lightning');
    const launched = await waitFor(() => testWindows().length > n0, 12000);
    // Every shader actor should be cleaned up once its effect is over.
    await sleep(1500);
    const leftovers = sc()._fx.layer.get_children()
        .filter(a => a.get_effects().some(e => e.constructor.$gtype.name.startsWith('SpellcasterShader')));
    check('Lightning bolt goes away afterwards', leftovers.length === 0,
        `left=${leftovers.map(a => a.get_effects()[0].constructor.$gtype.name).join(',')} opacity=${leftovers.map(a => a.opacity).join(',')}`);
    await shot('08d-after-lightning');
    check('Lightning Strike launches the app', launched, `before=${n0} after=${testWindows().length}`);
    await sleep(1000);

    // Summon the familiar with the Λ rune.
    await cast(runes, 'caret', cx + 250, cy - 100, 260);
    await sleep(450);
    await shot('08c-summon-sigil');
    await sleep(450);
    check('Summon rune brings out the familiar', settings.get_boolean('familiar-visible') && sc()._familiar.visible);
    moveTo(cx - 400, cy + 200);
    await sleep(1500);
    await shot('09a-familiar-spirit');
    log(`FAMPOS ${Math.round(sc()._familiar.position.x)} ${Math.round(sc()._familiar.position.y)}`);
    moveTo(cx + 300, cy - 150);
    await sleep(700);
    await shot('09b-familiar-spirit-moving');
    log(`FAMPOS ${Math.round(sc()._familiar.position.x)} ${Math.round(sc()._familiar.position.y)}`);
    // Naps when the mouse is still, wakes when it moves.
    settings.set_int('familiar-nap-seconds', 5);
    await sleep(6500);
    const napY = sc()._familiar.position.y;
    check('Familiar falls asleep when the mouse is still', sc()._familiar._mood === 'sleep', `mood=${sc()._familiar._mood}`);
    await sleep(3000);
    check('Sleeping familiar floats up to the top', sc()._familiar.position.y < m.y + 200, `y=${Math.round(sc()._familiar.position.y)} was=${Math.round(napY)}`);
    await shot('09s-familiar-asleep');
    moveTo(cx - 350, cy + 150);
    await sleep(300);
    moveTo(cx - 380, cy + 170);
    await sleep(600);
    check('Moving the mouse wakes the familiar', sc()._familiar._mood !== 'sleep', `mood=${sc()._familiar._mood}`);
    settings.set_int('familiar-nap-seconds', 30);

    // Shy: it fades right out when the cursor is on it, and comes back after.
    settings.set_string('familiar-mode', 'perch');
    await sleep(2500);
    let fp = sc()._familiar.position;
    moveTo(fp.x, fp.y);
    await sleep(900);
    const shyOp = sc()._familiar._actor.opacity;
    check('Familiar fades when the cursor is on it', shyOp < 70, `opacity=${shyOp}`);
    await shot('09c-familiar-shy');
    moveTo(fp.x - 500, fp.y + 350);
    await sleep(2500);
    const backOp = sc()._familiar._actor.opacity;
    check('Familiar fades back in when the cursor leaves', backOp > 150, `opacity=${backOp}`);
    settings.set_string('familiar-mode', 'follow');
    settings.set_string('familiar-type', 'wisp');
    await sleep(1200);
    await shot('09-familiar-wisp');
    settings.set_string('familiar-type', 'owl');
    await sleep(1200);
    await shot('10-familiar-owl');
    log(`FAMPOS ${Math.round(sc()._familiar.position.x)} ${Math.round(sc()._familiar.position.y)}`);
    // Owl delivers notifications.
    Main.notify('Pizza is here', 'Come get it while it is hot');
    await sleep(900);
    const owlSaid = sc()._familiar._bubble?.text ?? '';
    check('Owl announces a new notification', owlSaid.includes('Pizza'), `bubble="${owlSaid}"`);
    await shot('10b-owl-message');
    await sleep(4500);

    settings.set_string('familiar-type', 'dragon');
    await sleep(1200);
    await shot('11-familiar-dragon');
    log(`FAMPOS ${Math.round(sc()._familiar.position.x)} ${Math.round(sc()._familiar.position.y)}`);
    // Dragon guards the battery.
    sc()._powers.onBattery(60, 2);
    sc()._powers.onBattery(18, 2);
    await sleep(500);
    const dragonSaid = sc()._familiar._bubble?.text ?? '';
    check('Dragon warns about a low battery', dragonSaid.includes('18%'), `bubble="${dragonSaid}"`);
    check('Dragon breathes fire when warning', sc()._familiar._breath > 0, `breath=${sc()._familiar._breath}`);
    await shot('11b-dragon-battery');
    await sleep(1500);
    sc()._powers.onBattery(18, 1);
    await sleep(400);
    check('Dragon cheers when charging', (sc()._familiar._bubble?.text ?? '').includes('Charging'));
    await sleep(1000);
    settings.set_int('familiar-size', 48);
    await sleep(800);
    await shot('11b-familiar-bigger');

    // Sound Control (U). The test session has no audio, so use a pretend speaker.
    const fake = {volume: 50000, is_muted: false, push_volume() {}, change_is_muted(v) {
        this.is_muted = v;
    }};
    sc()._sound._getSink = () => fake;
    sc()._sound._maxNorm = () => 100000;
    await cast(runes, 'u', cx, cy, 300);
    await sleep(700);
    check('U rune starts Sound Control', sc()._sound.active);
    moveTo(cx + 200, cy + 100);
    await sleep(200);
    const click = btn => {
        pointer.notify_button(now(), btn, Clutter.ButtonState.PRESSED);
        pointer.notify_button(now(), btn, Clutter.ButtonState.RELEASED);
    };
    click(Clutter.BUTTON_PRIMARY);
    await sleep(150);
    check('Left click lowers the volume', fake.volume === 45000, `volume=${fake.volume}`);
    click(Clutter.BUTTON_SECONDARY);
    click(Clutter.BUTTON_SECONDARY);
    await sleep(150);
    check('Right click raises the volume', fake.volume === 55000, `volume=${fake.volume}`);
    await sleep(250);
    await shot('12s-sound-control');
    click(Clutter.BUTTON_MIDDLE);
    await sleep(300);
    check('Middle click mutes', fake.is_muted === true);
    await shot('12m-sound-muted');
    click(Clutter.BUTTON_MIDDLE);
    await sleep(150);
    check('Middle click again unmutes', fake.is_muted === false);
    key(Clutter.KEY_space, true);
    key(Clutter.KEY_space, false);
    await sleep(400);
    check('Space leaves Sound Control', !sc()._sound.active);

    // Enchant (bound to U just for this test).
    settings.set_string('rune-u', 'enchant');
    await cast(runes, 'u', cx, cy, 300);
    await sleep(1400);
    await shot('12-enchant');
    await sleep(1500);
    settings.reset('rune-u');

    // Freeze asks first.
    settings.set_int('confirm-seconds', 10);
    await cast(runes, 'v', cx, cy, 300);
    await sleep(1300);
    check('Freeze asks before locking', sc()._confirmDialog?.open && locks === 0);
    await shot('13a-confirm-freeze');
    sc()._confirmDialog.confirm();
    await sleep(1100);
    await shot('13-freeze');
    await waitFor(() => locks > 0, 3000);
    check('Confirming Freeze locks the screen', locks === 1, `locks=${locks}`);
    await sleep(1200);

    // Doing nothing cancels it.
    settings.set_int('confirm-seconds', 3);
    await cast(runes, 'v', cx, cy, 300);
    await sleep(1100);
    const asked = sc()._confirmDialog?.open;
    await sleep(3500);
    check('Ignoring the popup cancels Freeze', asked && !sc()._confirmDialog && locks === 1, `locks=${locks}`);
    settings.set_int('confirm-seconds', 10);

    // Slumber: confirm, then cancel during the curtain with a click.
    settings.set_int('slumber-curtain-ms', 1500);
    await cast(runes, 'line', cx, cy, 300);
    await sleep(1200);
    check('Slumber asks before sleeping', sc()._confirmDialog?.open && suspends === 0);
    await shot('14a-confirm-slumber');
    sc()._confirmDialog.confirm();
    await sleep(800);
    await shot('14-slumber-curtain');
    moveTo(cx, cy);
    press();
    release();
    await sleep(2200);
    check('Clicking during the curtain cancels Slumber', suspends === 0, `suspends=${suspends}`);
    await shot('15-slumber-cancelled');

    // Slumber for real (fake suspend).
    await cast(runes, 'line', cx, cy, 300);
    await sleep(1200);
    sc()._confirmDialog?.confirm();
    await waitFor(() => suspends > 0, 4000);
    check('Confirming Slumber suspends', suspends === 1, `suspends=${suspends}`);
    await sleep(2500);
    await shot('16-after-slumber');

    // Dismiss the familiar.
    await cast(runes, 'caret', cx, cy, 260);
    await sleep(800);
    check('Summon rune again dismisses the familiar', !settings.get_boolean('familiar-visible') && !sc()._familiar.visible);

    // Disable / enable leaves nothing behind.
    settings.set_boolean('familiar-visible', true);
    await sleep(800);
    const kids = countUiChildren();
    Main.extensionManager.disableExtension(UUID);
    await sleep(600);
    const kidsOff = countUiChildren();
    check('Disabling removes everything it added', kidsOff <= kids - 2, `with=${kids} without=${kidsOff}`);
    Main.extensionManager.enableExtension(UUID);
    await sleep(1200);
    const e2 = Main.extensionManager.lookup(UUID);
    check('Re-enabling works', e2.state === 1 && sc()._familiar.visible, `state=${e2.state}`);
    settings.set_boolean('familiar-visible', false);

    // Spellbook window.
    Util.spawn(['gnome-extensions', 'prefs', UUID]);
    const prefsUp = await waitFor(() => global.get_window_actors().some(a => (a.get_meta_window().get_title() ?? '').includes('Spellcaster')), 15000);
    await sleep(2500);
    check('Spellbook opens', prefsUp);
    await shot('17-spellbook');

    finish();
}

function finish() {
    const file = Gio.File.new_for_path(`${OUT}/results.json`);
    file.replace_contents(new TextEncoder().encode(JSON.stringify(results, null, 2)), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    log('DONE');
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        Meta.exit(Meta.ExitCode.SUCCESS);
        return GLib.SOURCE_REMOVE;
    });
}

let started = false;

export default class TestDriver extends Extension {
    enable() {
        // GNOME re-enables later extensions when one is toggled; run once.
        if (started)
            return;
        started = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
            run().catch(e => {
                log(`CRASH ${e}\n${e.stack}`);
                check('test driver crashed', false, e);
                finish();
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {}
}
