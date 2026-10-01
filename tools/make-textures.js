// SPDX-License-Identifier: GPL-2.0-or-later
//
// Generates every particle/effect texture Spellcaster uses, procedurally.
// No downloads, no licences to worry about, and you can tweak and re-run.
//
//   gjs -m tools/make-textures.js
//
// Output: spellcaster@gamerdolphin.github.io/assets/*.png + manifest.json

import Cairo from 'cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

const HERE = GLib.path_get_dirname(decodeURIComponent(import.meta.url.replace('file://', '')));
const OUT = GLib.build_filenamev([HERE, '..', 'spellcaster@gamerdolphin.github.io', 'assets']);
GLib.mkdir_with_parents(OUT, 0o755);
const TMP = GLib.build_filenamev([GLib.get_tmp_dir(), `spellcaster-tex-${GLib.random_int()}.png`]);

// ---------------------------------------------------------------------------
// Small image toolkit: float RGBA buffers with straight alpha.

class Img {
    constructor(w, h = w) {
        this.w = w;
        this.h = h;
        this.d = new Float32Array(w * h * 4);
    }

    set(x, y, r, g, b, a) {
        const i = (y * this.w + x) * 4;
        this.d[i] = r;
        this.d[i + 1] = g;
        this.d[i + 2] = b;
        this.d[i + 3] = a;
    }

    /** fn(u, v) -> [r,g,b,a]; u,v in -1..1 */
    fill(fn) {
        for (let y = 0; y < this.h; y++) {
            for (let x = 0; x < this.w; x++) {
                const u = (x + 0.5) / this.w * 2 - 1, v = (y + 0.5) / this.h * 2 - 1;
                const [r, g, b, a] = fn(u, v, x, y);
                this.set(x, y, r, g, b, a);
            }
        }
        return this;
    }

    /** Paint `top` over this (straight alpha "over"). */
    over(top, opacity = 1) {
        const a = this.d, b = top.d;
        for (let i = 0; i < a.length; i += 4) {
            const ta = b[i + 3] * opacity;
            const oa = ta + a[i + 3] * (1 - ta);
            for (let k = 0; k < 3; k++)
                a[i + k] = oa > 0 ? (b[i + k] * ta + a[i + k] * a[i + 3] * (1 - ta)) / oa : 0;
            a[i + 3] = oa;
        }
        return this;
    }

    /** Gaussian-ish blur (3 box passes) on premultiplied data. */
    blurred(radius) {
        const out = new Img(this.w, this.h);
        const p = new Float32Array(this.d.length);
        for (let i = 0; i < p.length; i += 4) {
            const al = this.d[i + 3];
            p[i] = this.d[i] * al;
            p[i + 1] = this.d[i + 1] * al;
            p[i + 2] = this.d[i + 2] * al;
            p[i + 3] = al;
        }
        const r = Math.max(1, Math.round(radius / 1.7));
        let src = p, tmp = new Float32Array(p.length);
        const pass = (from, to, horiz) => {
            const {w, h} = this;
            const len = horiz ? w : h, lines = horiz ? h : w;
            for (let l = 0; l < lines; l++) {
                for (let c = 0; c < 4; c++) {
                    let acc = 0;
                    const idx = k => {
                        const kk = Math.min(len - 1, Math.max(0, k));
                        return (horiz ? l * w + kk : kk * w + l) * 4 + c;
                    };
                    for (let k = -r; k <= r; k++)
                        acc += from[idx(k)];
                    for (let k = 0; k < len; k++) {
                        to[(horiz ? l * w + k : k * w + l) * 4 + c] = acc / (2 * r + 1);
                        acc += from[idx(k + r + 1)] - from[idx(k - r)];
                    }
                }
            }
        };
        for (let n = 0; n < 3; n++) {
            pass(src, tmp, true);
            pass(tmp, src, false);
        }
        for (let i = 0; i < src.length; i += 4) {
            const al = src[i + 3];
            out.d[i] = al > 1e-5 ? src[i] / al : 0;
            out.d[i + 1] = al > 1e-5 ? src[i + 1] / al : 0;
            out.d[i + 2] = al > 1e-5 ? src[i + 2] / al : 0;
            out.d[i + 3] = al;
        }
        return out;
    }

    scaleAlpha(k) {
        for (let i = 3; i < this.d.length; i += 4)
            this.d[i] = Math.min(1, this.d[i] * k);
        return this;
    }

    save(name) {
        const u8 = new Uint8Array(this.w * this.h * 4);
        for (let i = 0; i < u8.length; i++)
            u8[i] = Math.round(Math.max(0, Math.min(1, this.d[i])) * 255);
        const pb = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(u8),
            GdkPixbuf.Colorspace.RGB, true, 8, this.w, this.h, this.w * 4);
        pb.savev(GLib.build_filenamev([OUT, `${name}.png`]), 'png', ['compression'], ['9']);
        count++;
    }

    /** Load a Cairo drawing into an Img. draw(cr, w, h) */
    static fromCairo(w, h, draw) {
        const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
        const cr = new Cairo.Context(surf);
        draw(cr, w, h);
        surf.writeToPNG(TMP);
        cr.$dispose();
        const pb = GdkPixbuf.Pixbuf.new_from_file(TMP);
        const px = pb.get_pixels();
        const img = new Img(w, h);
        const rs = pb.get_rowstride(), ch = pb.get_n_channels();
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const o = y * rs + x * ch;
                img.set(x, y, px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, ch === 4 ? px[o + 3] / 255 : 1);
            }
        }
        return img;
    }
}

let count = 0;

// ---------------------------------------------------------------------------
// Noise

let seed = 1337;
function rnd() {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
}

const PERM = new Uint8Array(512);
{
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++)
        PERM[i] = p[i & 255];
}
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y) {
    const a = h & 7;
    const u = a < 4 ? x : y, v = a < 4 ? y : x;
    return ((a & 1) ? -u : u) + ((a & 2) ? -2 * v : 2 * v);
}
function perlin(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const A = PERM[X] + Y, B = PERM[X + 1] + Y;
    const l1 = grad(PERM[A], x, y) + u * (grad(PERM[B], x - 1, y) - grad(PERM[A], x, y));
    const l2 = grad(PERM[A + 1], x, y - 1) + u * (grad(PERM[B + 1], x - 1, y - 1) - grad(PERM[A + 1], x, y - 1));
    return (l1 + v * (l2 - l1)) * 0.25 + 0.5;
}
function fbm(x, y, oct = 5) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
        s += a * perlin(x * f, y * f);
        n += a;
        a *= 0.5;
        f *= 2.03;
    }
    return s / n;
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Black-body-ish fire ramp: 0 (cool) .. 1 (white hot). */
function fireRamp(t) {
    const stops = [[0, [0.5, 0.05, 0.02]], [0.35, [0.95, 0.25, 0.04]], [0.6, [1, 0.55, 0.1]],
        [0.82, [1, 0.85, 0.35]], [1, [1, 1, 0.9]]];
    for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0])
            return mix(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
    return stops[stops.length - 1][1];
}

function hsv(h, s, v) {
    const f = n => {
        const k = (n + h * 6) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
}

// ---------------------------------------------------------------------------
// Colours baked into the small particle textures. The extension maps any
// requested colour to the nearest one of these.

const COLORS = {
    white: [1, 1, 1],
    gold: [1, 0.85, 0.4],
    pink: [1, 0.55, 0.88],
    violet: [0.68, 0.5, 1],
    ice: [0.65, 0.88, 1],
    icewhite: [0.88, 0.96, 1],
    fire1: [1, 0.45, 0.08],
    fire2: [1, 0.72, 0.2],
    fire3: [1, 0.93, 0.6],
    fire4: [0.92, 0.22, 0.05],
    dream1: [0.75, 0.7, 1],
    dream2: [0.55, 0.65, 1],
    arcane1: [0.7, 0.42, 1],
    arcane2: [1, 0.45, 0.85],
    fey1: [0.36, 1, 0.61],
    fey2: [1, 0.9, 0.42],
};
for (let i = 0; i < 12; i++)
    COLORS[`hue${i}`] = hsv(i / 12, 0.72, 1);

// ---------------------------------------------------------------------------
// 1. Glow orb: hot white core, coloured halo.

function orb(c, S = 64) {
    return new Img(S).fill((u, v) => {
        const r = Math.hypot(u, v);
        const core = Math.exp(-(((r / 0.16) ** 2)));
        const halo = Math.exp(-(((r / 0.45) ** 2))) * 0.75;
        const a = clamp(core + halo) * (1 - smooth(0.85, 1, r));
        const col = mix([1, 1, 1], c, smooth(0.05, 0.4, r));
        return [...col, a];
    });
}

// 2. Twinkle star: 4 long spikes + 4 faint diagonals + soft glow.
function sparkle(c, S = 96) {
    return new Img(S).fill((u, v) => {
        const r = Math.hypot(u, v);
        const ax = Math.abs(u), ay = Math.abs(v);
        const spikeH = Math.exp(-ay / 0.022) * Math.pow(clamp(1 - ax), 2.2);
        const spikeV = Math.exp(-ax / 0.022) * Math.pow(clamp(1 - ay), 2.2);
        const d1 = Math.abs(u - v) / Math.SQRT2, d2 = Math.abs(u + v) / Math.SQRT2;
        const diag = (Math.exp(-d1 / 0.02) + Math.exp(-d2 / 0.02)) * Math.pow(clamp(1 - r * 1.6), 2) * 0.45;
        const glow = Math.exp(-(((r / 0.22) ** 2))) * 0.7 + Math.exp(-(((r / 0.07) ** 2)));
        const a = clamp(spikeH + spikeV + diag + glow) * (1 - smooth(0.92, 1, r));
        const col = mix([1, 1, 1], c, smooth(0.04, 0.5, r));
        return [...col, a];
    });
}

// 3. Flame tongue, white-hot base flickering up into red wisps.
function flame(variant, W = 112, H = 160) {
    const ox = variant * 13.7;
    const img = new Img(W, H);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const u = (x + 0.5) / W * 2 - 1;
            const t = 1 - (y + 0.5) / H; // 0 bottom .. 1 top
            // Domain warp makes the licks curl.
            const wx = fbm(u * 1.5 + ox, t * 2 - ox, 4) - 0.5;
            const n = fbm(u * 2.4 + wx * 2 + ox, t * 3.4 - ox * 0.3, 5);
            const sway = wx * 1.1 * t;
            const width = 0.9 * Math.pow(1 - t, 0.6) * (0.7 + 0.6 * n);
            const dx = Math.abs(u - sway) / Math.max(0.02, width);
            let heat = Math.pow(clamp(1 - dx), 0.8) * clamp(1.2 - t * 1.05) * (0.45 + 0.8 * n);
            heat *= smooth(0, 0.2, t);
            const col = fireRamp(clamp(heat * 1.35));
            const a = clamp(heat * 1.9) * (1 - smooth(0.8, 1, t));
            img.set(x, y, ...col, a);
        }
    }
    return img.over(img.blurred(3), 0.45);
}

// 4. Smoke puff.
function smoke(variant, S = 128) {
    const ox = variant * 7.3;
    return new Img(S).fill((u, v) => {
        const r = Math.hypot(u, v);
        const n = fbm(u * 2 + ox, v * 2 - ox, 5);
        const body = clamp(1 - r * (1.05 - 0.4 * (n - 0.5))) ;
        const a = Math.pow(body, 1.4) * (0.4 + 0.8 * n);
        const shade = 0.55 + 0.35 * n;
        return [shade * 0.9, shade * 0.85, shade, clamp(a)];
    });
}

// 5. Snowflake (6-fold, drawn) with glow.
function snowflake(variant, S = 96) {
    const sharp = Img.fromCairo(S, S, (cr, w) => {
        cr.translate(w / 2, w / 2);
        cr.setLineCap(1);
        cr.setSourceRGBA(1, 1, 1, 1);
        const R = w * 0.42;
        for (let k = 0; k < 6; k++) {
            cr.save();
            cr.rotate(k * Math.PI / 3);
            cr.setLineWidth(w * 0.035);
            cr.moveTo(0, 0);
            cr.lineTo(0, -R);
            cr.stroke();
            const branches = variant === 0 ? [0.35, 0.62] : [0.28, 0.5, 0.72];
            for (const b of branches) {
                const len = R * (variant === 0 ? 0.32 : 0.22) * (1.1 - b * 0.6);
                cr.setLineWidth(w * 0.025);
                for (const s of [-1, 1]) {
                    cr.moveTo(0, -R * b);
                    cr.lineTo(s * len * Math.sin(Math.PI / 3), -R * b - len * Math.cos(Math.PI / 3));
                    cr.stroke();
                }
            }
            cr.restore();
        }
        cr.arc(0, 0, w * 0.06, 0, Math.PI * 2);
        cr.fill();
    });
    const glow = sharp.blurred(S * 0.06);
    for (let i = 0; i < glow.d.length; i += 4) {
        glow.d[i] = 0.6;
        glow.d[i + 1] = 0.85;
        glow.d[i + 2] = 1;
    }
    glow.scaleAlpha(1.6);
    return glow.over(sharp);
}

// 6. Magic sigil: concentric rings, runes, a star — white, tinted in-shell.
function sigilLines(S = 512) {
    seed = 4242;
    return Img.fromCairo(S, S, (cr, w) => {
        const c = w / 2;
        cr.translate(c, c);
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.setLineCap(1);
        const ring = (r, lw) => {
            cr.setLineWidth(lw);
            cr.arc(0, 0, r, 0, Math.PI * 2);
            cr.stroke();
        };
        const R = w * 0.46;
        ring(R, w * 0.008);
        ring(R * 0.93, w * 0.004);
        ring(R * 0.7, w * 0.006);
        ring(R * 0.64, w * 0.003);
        ring(R * 0.2, w * 0.005);

        // Rune band between the two outer rings.
        const n = 28;
        for (let i = 0; i < n; i++) {
            cr.save();
            cr.rotate(i / n * Math.PI * 2);
            cr.translate(0, -R * 0.815);
            cr.setLineWidth(w * 0.0045);
            const g = w * 0.022;
            // Each glyph: 2-4 random strokes inside a small box.
            const strokes = 2 + Math.floor(rnd() * 3);
            for (let s = 0; s < strokes; s++) {
                const pts = [[rnd() * 2 - 1, rnd() * 2 - 1], [rnd() * 2 - 1, rnd() * 2 - 1]];
                cr.moveTo(pts[0][0] * g, pts[0][1] * g);
                if (rnd() < 0.3)
                    cr.arc(pts[0][0] * g, pts[0][1] * g, g * 0.5, 0, Math.PI * (0.5 + rnd()));
                else
                    cr.lineTo(pts[1][0] * g, pts[1][1] * g);
                cr.stroke();
            }
            cr.restore();
        }

        // Ticks on the inner ring.
        for (let i = 0; i < 72; i++) {
            cr.save();
            cr.rotate(i / 72 * Math.PI * 2);
            cr.setLineWidth(w * 0.003);
            cr.moveTo(0, -R * 0.64);
            cr.lineTo(0, -R * (i % 6 === 0 ? 0.58 : 0.61));
            cr.stroke();
            cr.restore();
        }

        // Two overlapping triangles (hexagram) + small circles at points.
        cr.setLineWidth(w * 0.005);
        for (const off of [0, Math.PI / 3]) {
            for (let k = 0; k <= 3; k++) {
                const a = off + k * Math.PI * 2 / 3 - Math.PI / 2;
                const x = Math.cos(a) * R * 0.64, y = Math.sin(a) * R * 0.64;
                if (k === 0)
                    cr.moveTo(x, y);
                else
                    cr.lineTo(x, y);
            }
            cr.stroke();
        }
        for (let k = 0; k < 6; k++) {
            const a = k * Math.PI / 3 - Math.PI / 2;
            cr.arc(Math.cos(a) * R * 0.64, Math.sin(a) * R * 0.64, w * 0.018, 0, Math.PI * 2);
            cr.stroke();
        }
        // Inner star.
        for (let k = 0; k <= 8; k++) {
            const a = k * Math.PI * 2 * 3 / 8 - Math.PI / 2;
            const x = Math.cos(a) * R * 0.2, y = Math.sin(a) * R * 0.2;
            if (k === 0)
                cr.moveTo(x, y);
            else
                cr.lineTo(x, y);
        }
        cr.stroke();
    });
}

// 7. Vortex: spiral arms in white (tinted in-shell) + white-hot highlights.
function vortex(S = 512) {
    const base = new Img(S), hot = new Img(S);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
            const r = Math.hypot(u, v);
            const th = Math.atan2(v, u);
            const twist = th + 2.6 * Math.log(r + 0.05);
            const n = fbm(Math.cos(twist) * 2 + r * 3, Math.sin(twist) * 2 + r * 3, 5);
            const arms = Math.pow(0.5 + 0.5 * Math.sin(5 * twist + n * 4), 2.2);
            const env = smooth(0.08, 0.3, r) * (1 - smooth(0.7, 1, r));
            const l = clamp((arms * 0.75 + n * 0.5) * env);
            base.set(x, y, 1, 1, 1, clamp(l * 1.15));
            const h = Math.pow(arms, 5) * smooth(0.14, 0.3, r) * (1 - smooth(0.4, 0.75, r)) * (0.6 + n);
            hot.set(x, y, 1, 1, 1, clamp(h));
        }
    }
    return {base: base.over(base.blurred(6), 0.6), hot: hot.over(hot.blurred(4), 0.8)};
}

// 8. Shockwave ring (white, tinted in-shell).
function shockwave(S = 256) {
    return new Img(S).fill((u, v) => {
        const r = Math.hypot(u, v);
        const ring = Math.exp(-(((r - 0.82) / 0.035) ** 2)) + Math.exp(-(((r - 0.78) / 0.12) ** 2)) * 0.35;
        return [1, 1, 1, clamp(ring) * (1 - smooth(0.96, 1, r))];
    });
}

// 9. Fireball: turbulent sphere with flame tendrils and a white core.
function fireball(S = 256) {
    const img = new Img(S).fill((u, v) => {
        const r = Math.hypot(u, v);
        const th = Math.atan2(v, u);
        const warp = fbm(u * 2.5 + 9, v * 2.5 - 4, 4) - 0.5;
        const n = fbm(u * 4 + warp * 3 + 5, v * 4 - warp * 3 - 2, 6);
        const lick = fbm(Math.cos(th) * 3 + 2, Math.sin(th) * 3 + r * 4, 4);
        const edge = 0.5 + (lick - 0.5) * 0.55 + (n - 0.5) * 0.2;
        const body = clamp(1 - r / edge);
        const heat = Math.pow(body, 0.7) * (0.55 + 0.75 * n) + Math.exp(-(((r / 0.2) ** 2))) * 0.7;
        const col = fireRamp(clamp(heat));
        const a = clamp(heat * 2.6) * (1 - smooth(0.9, 1, r));
        return [...col, a];
    });
    const glow = img.blurred(S * 0.05);
    for (let i = 0; i < glow.d.length; i += 4) {
        glow.d[i] = 1;
        glow.d[i + 1] = 0.4;
        glow.d[i + 2] = 0.06;
    }
    return glow.scaleAlpha(1.1).over(img);
}

// 10. Frost corner: crystals growing from the top-left corner + frosty haze.
function frostCorner(S = 512) {
    seed = 777;
    const lines = Img.fromCairo(S, S, (cr, w) => {
        cr.setLineCap(1);
        const branch = (x, y, a, len, depth, lw) => {
            const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
            // Slightly wandering line, thinner toward the tip, like real ice.
            const steps = 8;
            for (let k = 0; k < steps; k++) {
                const t0 = k / steps, t1 = (k + 1) / steps;
                const j = (t) => (rnd() - 0.5) * len * 0.035 * Math.sin(t * Math.PI);
                const nx = -Math.sin(a), ny = Math.cos(a);
                const j0 = k === 0 ? 0 : j(t0), j1 = j(t1);
                cr.setSourceRGBA(1, 1, 1, 0.9 - t0 * 0.35);
                cr.setLineWidth(lw * (1 - t0 * 0.7));
                cr.moveTo(x + (ex - x) * t0 + nx * j0, y + (ey - y) * t0 + ny * j0);
                cr.lineTo(x + (ex - x) * t1 + nx * j1, y + (ey - y) * t1 + ny * j1);
                cr.stroke();
            }
            if (depth <= 0)
                return;
            const n = 2 + Math.floor(rnd() * 2);
            for (let i = 1; i <= n; i++) {
                const k = i / (n + 1);
                const bx = x + (ex - x) * k, by = y + (ey - y) * k;
                const sl = len * (0.5 - k * 0.3) * (0.7 + rnd() * 0.5);
                branch(bx, by, a + Math.PI / 3, sl, depth - 1, lw * 0.6);
                branch(bx, by, a - Math.PI / 3, sl, depth - 1, lw * 0.6);
            }
        };
        for (let i = 0; i < 6; i++) {
            const a = (0.06 + i / 5 * 0.88) * Math.PI / 2 + (rnd() - 0.5) * 0.12;
            branch(0, 0, a, w * (0.5 + rnd() * 0.45), 2, w * 0.007);
        }
    });
    const haze = new Img(S).fill((u, v) => {
        const x = (u + 1) / 2, y = (v + 1) / 2;
        const d = Math.hypot(x, y);
        const n = fbm(x * 8, y * 8, 5);
        const crackle = Math.pow(fbm(x * 22, y * 22, 3), 3) * 1.5;
        const a = clamp((1 - smooth(0.05, 1.05, d)) * (0.45 + 0.75 * n + crackle) * 0.85);
        return [0.82, 0.93, 1, a];
    });
    const glow = lines.blurred(S * 0.012);
    for (let i = 0; i < glow.d.length; i += 4) {
        glow.d[i] = 0.55;
        glow.d[i + 1] = 0.85;
        glow.d[i + 2] = 1;
    }
    return haze.over(glow.scaleAlpha(1.5)).over(lines);
}

// ---------------------------------------------------------------------------

const t0 = Date.now();
for (const [name, c] of Object.entries(COLORS)) {
    orb(c).save(`orb-${name}`);
    sparkle(c).save(`sparkle-${name}`);
}
for (let i = 0; i < 4; i++)
    flame(i).save(`flame-${i}`);
for (let i = 0; i < 3; i++)
    smoke(i).save(`smoke-${i}`);
for (let i = 0; i < 2; i++)
    snowflake(i).save(`snow-${i}`);

const sl = sigilLines();
sl.save('sigil');
const sg = sl.blurred(7);
sg.scaleAlpha(2.2).save('sigil-glow');

const vx = vortex();
vx.base.save('vortex');
vx.hot.save('vortex-hot');
shockwave().save('shockwave');
fireball().save('fireball');
frostCorner().save('frost-corner');

GLib.file_set_contents(GLib.build_filenamev([OUT, 'manifest.json']),
    JSON.stringify({colors: COLORS}, null, 1));
GLib.unlink(TMP);
print(`Made ${count} textures in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
