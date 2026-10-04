// SPDX-License-Identifier: GPL-2.0-or-later
//
// The familiar: a small creature that keeps you company.
//
// Rule #1: never be annoying.
//  - clicks pass straight through it (reactive: false)
//  - keeps its distance from the cursor and gets shy when you come close
//  - disappears while a game or video is fullscreen
//  - silent, slow, calm; naps when you're idle

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {LoadWatch} from './systemWatch.js';
import {cpuGlow, draw} from './familiarArt.js';
import {runShader, shaderActor} from './shaders.js';
import {Palette, destroyer, monitorAt, rand} from './fx.js';

// Familiars drawn by shaders, and how big their box is (× size).
const SHADER_FAMILIARS = {
    spirit: {box: 4.2},
    owl: {box: 3.2},
    dragon: {box: 3.6},
};

const FPS_AWAKE = 30;
const FPS_ASLEEP = 8;
const TAIL_LENGTH = 9;

export class Familiar {
    constructor(settings, fx) {
        this._settings = settings;
        this._fx = fx;
        this._actor = null;
        this._tickId = 0;
        this._zzzId = 0;
        this._moodId = 0;

        this._pos = null;
        this._tail = [];
        this._t = 0;
        this._facing = 1;
        this._look = {x: 0, y: 0};
        this._mood = 'idle';
        this._cpu = 0;
        this._blinkUntil = 0;
        this._nextBlink = rand(2, 5);
        this._waypoint = null;
        this._waypointTime = 0;
        this._moving = 0;
        this._hiddenFullscreen = false;
        this._opacity = 1;

        this._cpuWatch = new LoadWatch(() => this._settings.get_string('familiar-glow-source'), load => (this._cpu = load));

        this._settingsIds = [
            settings.connect('changed::familiar-visible', () => this._syncVisible()),
            settings.connect('changed::familiar-size', () => this._rebuild()),
            settings.connect('changed::familiar-type', () => this._rebuild()),
            settings.connect('changed::familiar-react-cpu', () => this._syncCpu()),
            settings.connect('changed::familiar-glow-source', () => {
                this._cpuWatch.stop();
                this._syncCpu();
            }),
            settings.connect('changed::familiar-hide-fullscreen', () => this._syncFullscreen()),
            settings.connect('changed::familiar-mode', () => (this._waypoint = null)),
        ];
        this._fullscreenId = global.display.connect('in-fullscreen-changed', () => this._syncFullscreen());

        this._syncVisible(true);
    }

    get visible() {
        return this._actor !== null;
    }

    get _size() {
        return this._settings.get_int('familiar-size');
    }

    // --- Showing and hiding ------------------------------------------------

    /** Summon at a point (or near the cursor). */
    summonAt(x, y) {
        this._summonPoint = {x, y};
        if (this._settings.get_boolean('familiar-visible'))
            this._syncVisible();
        else
            this._settings.set_boolean('familiar-visible', true);
    }

    dismiss() {
        this._settings.set_boolean('familiar-visible', false);
    }

    toggle(x, y) {
        if (this._settings.get_boolean('familiar-visible'))
            this.dismiss();
        else
            this.summonAt(x, y);
    }

    _syncVisible(initial = false) {
        const want = this._settings.get_boolean('familiar-visible');
        if (want && !this._actor)
            this._create(initial);
        else if (!want && this._actor)
            this._vanish();
    }

    _create(quiet) {
        const S = this._size;
        // Spirit, Owl and Dragon are drawn by GPU shaders; the Wisp by Cairo.
        const type = this._settings.get_string('familiar-type');
        this._shaderType = SHADER_FAMILIARS[type] ? type : null;
        const box = Math.ceil(S * (SHADER_FAMILIARS[type]?.box ?? 3.2));
        this._box = box;
        this._vel = {x: 0, y: 0};
        this._breath = 0;

        if (this._shaderType) {
            const {actor, shader} = shaderActor(this._shaderType, {x: 0, y: 0, width: box, height: box});
            this._actor = actor;
            this._shader = shader;
            actor.set({opacity: 0, pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        } else {
            this._shader = null;
            this._actor = new St.DrawingArea({
                width: box,
                height: box,
                reactive: false,
                opacity: 0,
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            });
            this._actor.connect('repaint', area => this._paint(area));
        }

        // If GNOME tears the UI down under us (logging out), stop cleanly.
        const created = this._actor;
        created.connect('destroy', () => {
            if (this._actor === created)
                this._teardownActor();
        });

        const lm = Main.layoutManager;
        lm.uiGroup.insert_child_below(this._actor, lm.modalDialogGroup);

        if (!this._pos || this._summonPoint) {
            const [px, py] = global.get_pointer();
            const sp = this._summonPoint ?? {x: px + 120, y: py - 60};
            this._pos = {x: sp.x, y: sp.y};
            this._summonPoint = null;
        }
        this._tail = [];
        this._mood = 'idle';
        this._place();

        // Opacity is faded in by the tick; only the scale pops here.
        this._opacity = 0;
        this._actor.set_scale(0.2, 0.2);
        this._actor.ease({
            scale_x: 1,
            scale_y: 1,
            duration: quiet ? 400 : 650,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
        if (!quiet)
            this._fx.burst(this._pos.x, this._pos.y, {count: 30, colors: Palette.sparkle, speed: 90});

        this._syncCpu();
        this._stillFor = 0;
        this._lastPointer = null;
        this._syncFullscreen();
        this._startTicking(FPS_AWAKE);
    }

    _vanish() {
        const actor = this._actor;
        this._teardownActor();
        if (this._pos)
            this._fx.burst(this._pos.x, this._pos.y, {count: 20, colors: Palette.dream, speed: 60});
        actor.ease({
            opacity: 0,
            scale_x: 0.1,
            scale_y: 0.1,
            duration: 350,
            mode: Clutter.AnimationMode.EASE_IN_BACK,
            onStopped: destroyer(actor),
        });
    }

    _rebuild() {
        if (!this._actor)
            return;
        const actor = this._actor;
        this._teardownActor();
        actor.destroy();
        this._create(true);
    }

    _teardownActor() {
        this._stopTicking();
        this._cpuWatch.stop();
        this._stopZzz();
        if (this._moodId) {
            GLib.source_remove(this._moodId);
            this._moodId = 0;
        }
        this._actor = null;
    }

    // --- Ticking -----------------------------------------------------------

    _startTicking(fps) {
        this._stopTicking();
        if (!this._actor)
            return;
        const dt = 1 / fps;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(1000 / fps), () => {
            this._tick(dt);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTicking() {
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
    }

    _targetOpacity() {
        return this._settings.get_double('familiar-opacity');
    }

    _tick(dt) {
        if (!this._actor)
            return;
        // Check about once a second whether we wandered onto a fullscreen
        // monitor (or the cursor did, in follow mode).
        this._fsCheck = (this._fsCheck ?? 0) + dt;
        if (this._fsCheck > 1) {
            this._fsCheck = 0;
            this._syncFullscreen();
        }
        if (this._hiddenFullscreen)
            return;
        this._t += dt;
        const S = this._size;
        const [px, py] = global.get_pointer();

        // Nap when the mouse has been still for a while; wake when it moves.
        const lp = this._lastPointer;
        const moved = !lp || Math.hypot(px - lp.x, py - lp.y) > 2;
        this._lastPointer = {x: px, y: py};
        if (moved) {
            this._stillFor = 0;
            if (this._mood === 'sleep' && !this._curled)
                this.wake();
        } else {
            this._stillFor += dt;
            if (this._mood !== 'sleep' && this._settings.get_boolean('familiar-nap') &&
                this._stillFor >= this._settings.get_int('familiar-nap-seconds'))
                this.sleep();
        }
        const pos = this._pos;
        const dx = px - pos.x, dy = py - pos.y;
        const d = Math.hypot(dx, dy) || 1;

        // Blinking.
        if (this._t > this._nextBlink) {
            this._blinkUntil = this._t + 0.14;
            this._nextBlink = this._t + rand(2.5, 6);
        }

        let target = {x: pos.x, y: pos.y};
        let ease = 0.05;
        const mode = this._settings.get_string('familiar-mode');
        const keep = Math.max(110, S * 3);

        if (this._mood === 'sleep') {
            target = this._napSpot();
            ease = 0.03;
        } else if (mode === 'follow') {
            if (d > keep * 1.5 || d < keep * 0.8)
                target = {x: px - (dx / d) * keep, y: py - (dy / d) * keep};
        } else if (mode === 'perch') {
            target = this._perchSpot();
            ease = 0.04;
        } else {
            // Wander slowly between spots near the screen edges.
            if (!this._waypoint || this._t > this._waypointTime ||
                Math.hypot(this._waypoint.x - pos.x, this._waypoint.y - pos.y) < 20) {
                this._waypoint = this._randomEdgeSpot();
                this._waypointTime = this._t + rand(6, 12);
            }
            target = this._waypoint;
            ease = 0.012;
        }

        // Shy: fade out and drift away from a close cursor (not while napping).
        const shyR = Math.max(90, S * 2.6);
        const close = d < shyR && this._mood !== 'sleep';
        // 0 = cursor right on it, 1 = comfortably far away.
        const shyNear = S * 0.8, shyFar = Math.max(shyR, keep * 0.9);
        const comfort = this._mood === 'sleep' ? 1
            : Math.min(1, Math.max(0, (d - shyNear) / (shyFar - shyNear)));
        if (close && mode !== 'perch') {
            const push = (shyR - d) / shyR;
            target = {x: target.x - (dx / d) * push * 80, y: target.y - (dy / d) * push * 80};
        }

        // Move with a speed limit so it never zips around.
        let mx = (target.x - pos.x) * ease;
        let my = (target.y - pos.y) * ease;
        const sp = Math.hypot(mx, my);
        const maxSp = Math.max(4, S * 0.25);
        if (sp > maxSp) {
            mx *= maxSp / sp;
            my *= maxSp / sp;
        }
        pos.x += mx;
        pos.y += my;
        this._moving = Math.min(1, Math.hypot(mx, my) / 3);
        this._vel.x += (mx / maxSp - this._vel.x) * 0.2;
        this._vel.y += (my / maxSp - this._vel.y) * 0.2;

        if (mx > 0.4)
            this._facing = 1;
        else if (mx < -0.4)
            this._facing = -1;
        else if (mode === 'perch' || this._mood === 'watch')
            this._facing = dx >= 0 ? 1 : -1;

        // Eyes follow the cursor.
        const lookTarget = this._mood === 'sleep' ? {x: 0, y: 0} : {x: dx / d, y: dy / d};
        this._look.x += (lookTarget.x - this._look.x) * 0.15;
        this._look.y += (lookTarget.y - this._look.y) * 0.15;

        this._tail.unshift({x: pos.x, y: pos.y});
        this._tail.length = Math.min(this._tail.length, this._settings.get_boolean('reduce-effects') ? 4 : TAIL_LENGTH);

        const want = this._targetOpacity() * (0.12 + 0.88 * comfort * comfort);
        // Fade out quickly when the cursor comes near, back in slowly.
        this._opacity += (want - this._opacity) * (want < this._opacity ? 0.3 : 0.08);
        this._actor.opacity = Math.round(255 * this._opacity);

        this._place();
        this._placeBubble();
        this._redraw();
    }

    _glowAndPulse() {
        const load = this._settings.get_boolean('familiar-react-cpu') ? this._cpu : 0;
        const pulse = (Math.sin(this._t * (1.2 + load * 4)) + 1) / 2 * (0.4 + load * 0.6);
        return [cpuGlow(load), pulse];
    }

    _redraw() {
        if (!this._actor)
            return;
        if (!this._shader) {
            this._actor.queue_repaint();
            return;
        }
        const [glow, pulse] = this._glowAndPulse();
        const MOODS = {idle: 0, watch: 1, happy: 2, oops: 3, sleep: 4};
        this._actor.translation_y = this._drawY ?? 0;
        const u = {
            u_time: this._t,
            u_look: [this._look.x, this._look.y],
            u_blink: this._t < this._blinkUntil ? 1 : 0,
            u_mood: MOODS[this._mood] ?? 0,
            u_glow: glow,
            u_pulse: pulse,
            u_alpha: 1,
        };
        if (this._shaderType === 'spirit') {
            u.u_vel = [this._vel.x, this._vel.y];
        } else {
            u.u_facing = this._facing < 0 ? -1 : 1;
            u.u_flap = this._moving;
            u.u_breath = this._breath;
        }
        this._shader.setAll(u);
    }

    _place() {
        const bob = this._mood === 'sleep' ? Math.sin(this._t * 1.2) * 1.5 : Math.sin(this._t * 2.1) * 3;
        this._drawY = bob;
        this._actor.set_position(Math.round(this._pos.x - this._box / 2), Math.round(this._pos.y - this._box / 2));
    }

    _paint(area) {
        const cr = area.get_context();
        const S = this._size;
        const c = this._box / 2;
        cr.translate(c, c + (this._drawY ?? 0));

        const [glow, pulse] = this._glowAndPulse();

        const maxOff = c - S * 0.4;
        const tail = this._tail.slice(1).map(p => {
            let x = p.x - this._pos.x, y = p.y - this._pos.y;
            const m = Math.hypot(x, y);
            if (m > maxOff) {
                x *= maxOff / m;
                y *= maxOff / m;
            }
            return {x, y};
        });

        draw(cr, this._settings.get_string('familiar-type'), {
            size: S,
            t: this._t,
            look: this._look,
            facing: this._facing,
            blink: this._t < this._blinkUntil,
            mood: this._mood,
            glow,
            pulse,
            moving: this._moving,
            tail,
        });
        cr.$dispose();
    }

    // --- Where to go -------------------------------------------------------

    _perchSpot() {
        const m = Main.layoutManager.primaryMonitor;
        const S = this._size;
        return {x: m.x + m.width - S * 2.2, y: m.y + Main.panel.height + S * 1.4};
    }

    _napSpot() {
        // Curl up just under the top bar, a little right of the clock.
        const m = monitorAt(this._pos.x, this._pos.y);
        const S = this._size;
        return {x: m.x + m.width * 0.62, y: m.y + Main.panel.height + S * 0.8};
    }

    _randomEdgeSpot() {
        const m = monitorAt(this._pos.x, this._pos.y);
        const margin = Math.max(60, this._size * 2);
        const top = m.y + Main.panel.height + margin;
        const side = Math.floor(Math.random() * 4);
        switch (side) {
        case 0: return {x: rand(m.x + margin, m.x + m.width - margin), y: top};
        case 1: return {x: m.x + m.width - margin, y: rand(top, m.y + m.height - margin)};
        case 2: return {x: rand(m.x + margin, m.x + m.width - margin), y: m.y + m.height - margin * 1.6};
        default: return {x: m.x + margin, y: rand(top, m.y + m.height - margin)};
        }
    }

    // --- Fullscreen, CPU, idle ---------------------------------------------

    _syncFullscreen() {
        if (!this._actor)
            return;
        let hide = false;
        if (this._settings.get_boolean('familiar-hide-fullscreen')) {
            const [px, py] = global.get_pointer();
            const mons = [monitorAt(this._pos.x, this._pos.y), monitorAt(px, py)];
            hide = mons.some(m => m?.inFullscreen);
        }
        if (hide === this._hiddenFullscreen)
            return;
        this._hiddenFullscreen = hide;
        if (hide) {
            this._actor.remove_transition('opacity');
            this._actor.opacity = 0;
            this._opacity = 0;
        }
        // Coming back, the tick fades it in gently.
    }

    _syncCpu() {
        if (this._actor && this._settings.get_boolean('familiar-react-cpu'))
            this._cpuWatch.start();
        else
            this._cpuWatch.stop();
    }

    sleep() {
        if (!this._actor || this._mood === 'sleep')
            return;
        this._setMood('sleep');
        this._startTicking(FPS_ASLEEP);
        this._startZzz();
    }

    wake() {
        if (!this._actor || this._mood !== 'sleep')
            return;
        this._curled = false;
        this._stillFor = 0;
        this._stopZzz();
        this._startTicking(FPS_AWAKE);
        this._setMood('idle');
        this.flashMood('happy', 900);
        // Little stretch.
        this._actor.ease({
            scale_x: 1.15, scale_y: 0.9, duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._actor?.ease({scale_x: 1, scale_y: 1, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_BACK}),
        });
    }

    _startZzz() {
        this._stopZzz();
        this._zzzId = GLib.timeout_add(GLib.PRIORITY_LOW, 2400, () => {
            if (!this._actor || this._hiddenFullscreen)
                return GLib.SOURCE_CONTINUE;
            const z = new St.Label({text: 'z', style_class: 'spellcaster-zzz', opacity: 0, reactive: false});
            this._fx.add(z);
            const x = this._pos.x + this._size * 0.4, y = this._pos.y - this._size * 0.5;
            z.set_position(Math.round(x), Math.round(y));
            z.ease({opacity: 220, duration: 400, onComplete: () => {
                z.ease({x: x + 18, y: y - 30, opacity: 0, duration: 1400, onStopped: destroyer(z)});
            }, onStopped: f => {
                if (!f)
                    z.destroy();
            }});
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopZzz() {
        if (this._zzzId) {
            GLib.source_remove(this._zzzId);
            this._zzzId = 0;
        }
    }

    // --- Reactions to casting ----------------------------------------------

    _setMood(mood) {
        this._mood = mood;
        this._redraw();
    }

    /** Show a mood for a moment, then go back to idle. */
    flashMood(mood, ms) {
        if (!this._actor || this._mood === 'sleep')
            return;
        if (this._moodId)
            GLib.source_remove(this._moodId);
        this._setMood(mood);
        this._moodId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._moodId = 0;
            if (this._mood === mood)
                this._setMood('idle');
            return GLib.SOURCE_REMOVE;
        });
    }

    onCastBegin() {
        if (this._actor && this._mood !== 'sleep')
            this._setMood('watch');
    }

    onCastEnd() {
        if (this._mood === 'watch')
            this._setMood('idle');
    }

    onCastSuccess() {
        if (!this._actor || this._mood === 'sleep')
            return;
        this.flashMood('happy', 1000);
        this._actor.rotation_angle_z = 0;
        this._actor.ease({
            rotation_angle_z: 360,
            duration: 650,
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            onStopped: () => {
                if (this._actor)
                    this._actor.rotation_angle_z = 0;
            },
        });
    }

    onFizzle() {
        if (!this._actor || this._mood === 'sleep')
            return;
        this.flashMood('oops', 1100);
        this._fx.smoke(this._pos.x + this._size * 0.5, this._pos.y - this._size * 0.4, 5);
    }

    /** Slumber: curl up right away. */
    curlUp() {
        if (!this._actor)
            return;
        this._curled = true;
        this.sleep();
        // Let the mouse wake it again after a bit (or after waking the PC).
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
            this._curled = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    get position() {
        return this._pos;
    }

    get type() {
        return this._settings.get_string('familiar-type');
    }

    get awake() {
        return this._actor !== null && !this._hiddenFullscreen;
    }

    /** Show a little speech bubble above the familiar. */
    say(text, ms = 4000) {
        if (!this._actor || this._hiddenFullscreen)
            return;
        if (this._mood === 'sleep')
            this.wake();
        this._bubble?.destroy();
        const b = new St.Label({text, style_class: 'spellcaster-bubble', opacity: 0, reactive: false});
        this._fx.add(b);
        this._bubble = b;
        b.connect('destroy', () => {
            if (this._bubble === b)
                this._bubble = null;
        });
        this._placeBubble();
        b.set_pivot_point(0.5, 1);
        b.set_scale(0.6, 0.6);
        b.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        const done = destroyer(b);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (this._bubble === b)
                b.ease({opacity: 0, duration: 300, onStopped: done});
            return GLib.SOURCE_REMOVE;
        });
    }

    _placeBubble() {
        const b = this._bubble;
        if (!b || !this._pos)
            return;
        const [, w] = b.get_preferred_width(-1);
        const [, h] = b.get_preferred_height(-1);
        const top = Main.layoutManager.panelBox.height + 4;
        b.set_position(Math.round(this._pos.x - w / 2), Math.round(Math.max(top, this._pos.y - this._box * 0.42 - h)));
    }

    /** A happy hop and flap. */
    excite() {
        if (!this._actor)
            return;
        this.flashMood('happy', 1400);
        this._actor.ease({
            translation_y: -14, duration: 160, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._actor?.ease({translation_y: 0, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_BOUNCE}),
        });
    }

    /** Dragon only: breathe fire toward a point (or straight ahead). */
    breathe(target = null, ms = 1100) {
        if (!this._actor || this._shaderType !== 'dragon' || this._hiddenFullscreen)
            return;
        if (this._mood === 'sleep')
            this.wake();
        if (target)
            this._facing = target.x >= this._pos.x ? 1 : -1;
        const f = this._facing < 0 ? -1 : 1;
        const half = this._box / 2;
        const mouth = {x: this._pos.x + f * 0.57 * half, y: this._pos.y - 0.22 * half};
        const len = Math.max(this._box * 1.6, target ? Math.min(600, Math.hypot(target.x - mouth.x, target.y - mouth.y)) : 0);
        const hgt = this._box * 0.75;
        const {actor, shader} = shaderActor('breath', {x: mouth.x, y: mouth.y - hgt / 2, width: len, height: hgt});
        this._fx.add(actor);
        actor.set_pivot_point(0, 0.5);
        const ang = target ? Math.atan2(target.y - mouth.y, target.x - mouth.x) : (f > 0 ? 0 : Math.PI);
        actor.rotation_angle_z = ang * 180 / Math.PI;
        this._breath = 1;
        runShader(actor, shader, ms, (p, secs) => {
            const power = p < 0.25 ? p / 0.25 : p > 0.75 ? (1 - p) / 0.25 : 1;
            shader.setAll({u_time: secs, u_power: power});
            this._breath = power;
        }, () => {
            this._breath = 0;
            actor.destroy();
        });
    }

    /** Called after a spell is cast, so familiars can join in. */
    onSpell(spellId, point) {
        if (!this._actor)
            return;
        if (spellId === 'fireball' && this._shaderType === 'dragon')
            this.breathe(point);
    }

    destroy() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        global.display.disconnect(this._fullscreenId);
        const actor = this._actor;
        if (actor) {
            this._teardownActor();
            actor.destroy();
        }
        this._cpuWatch.stop();
        this._bubble?.destroy();
    }

    /** Current RAM or CPU load 0..1 (whichever the glow follows). */
    get cpu() {
        return this._cpu;
    }
}
