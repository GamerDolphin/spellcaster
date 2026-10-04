// SPDX-License-Identifier: GPL-2.0-or-later
//
// GPU shaders for the big effects (fire, burning windows, frost, nightfall,
// lightning, aurora) and the Spirit familiar.
//
// Each shader is a Shell.GLSLEffect subclass. GNOME builds the pipeline once
// per class, so every shader gets its own class; uniforms are per instance.
//
// Output is premultiplied alpha and must stay valid (rgb <= alpha): GNOME 50's
// colour-managed compositor garbles "additive" pixels, so glows here are
// drawn as soft, coloured, partly transparent light instead.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

// Shared helpers: hashing, value noise, fbm, and a fire colour ramp.
const COMMON = `
float sc_hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
float sc_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sc_hash(i), sc_hash(i + vec2(1.0, 0.0)), u.x),
               mix(sc_hash(i + vec2(0.0, 1.0)), sc_hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float sc_fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * sc_noise(p);
        p = p * 2.03 + vec2(1.7, 9.2);
        a *= 0.5;
    }
    return v;
}
float sc_sq(float x) {
    return x * x;
}
float sq0(float x) {
    return x * x;
}
vec3 sc_fire(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 a = mix(vec3(0.45, 0.03, 0.02), vec3(1.0, 0.32, 0.04), smoothstep(0.0, 0.4, t));
    vec3 b = mix(vec3(1.0, 0.7, 0.2), vec3(1.0, 1.0, 0.9), smoothstep(0.78, 1.0, t));
    return mix(a, b, smoothstep(0.4, 0.8, t));
}
`;

// --- Fireball ---------------------------------------------------------------
const FIREBALL = {
    decl: 'uniform float u_time; uniform float u_grow; uniform float u_explode;',
    code: `
    vec2 uv = cogl_tex_coord_in[0].xy * 2.0 - 1.0;
    float r = length(uv);
    float ang = atan(uv.y, uv.x);
    float t = u_time;
    float R = 0.34 * u_grow;
    // Flames licking outward, churning surface.
    float n = sc_fbm(vec2(ang * 2.0 + t * 0.6, r * 4.0 - t * 3.0));
    float n2 = sc_fbm(uv * 3.5 + vec2(t * 0.9, -t * 1.6));
    float edge = R + 0.28 * u_grow * n;
    float heat = smoothstep(edge, edge - 0.4 * u_grow, r) * (0.55 + 0.65 * n2);
    heat += exp(-r * r / (R * R * 0.18 + 0.0001)) * 0.9 * u_grow;
    // Explosion: a ring of fire racing outward while the core blows apart.
    float re = u_explode * 0.92;
    float ring = exp(-sc_sq((r - re) / (0.05 + 0.1 * u_explode))) * (1.0 - u_explode);
    heat = heat * (1.0 - u_explode) + ring * (0.6 + 0.8 * n2);
    vec3 col = sc_fire(heat);
    float a = clamp(heat * 1.6, 0.0, 1.0) * smoothstep(1.0, 0.85, r);
    float glow = exp(-r * 2.8) * 0.45 * u_grow * (1.0 - u_explode);
    float ga = glow * (1.0 - a);
    cogl_color_out = vec4(col * a + vec3(1.0, 0.4, 0.08) * ga, a + ga);
`,
};

// --- Window burning away -----------------------------------------------------
const BURN = {
    decl: `uniform sampler2D tex;
        uniform float u_time; uniform float u_progress;
        uniform vec2 u_origin; uniform float u_aspect;`,
    code: `
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 c = cogl_color_in * texture2D(tex, uv);
    vec2 d = (uv - u_origin) * vec2(u_aspect, 1.0);
    float dist = length(d) / (max(u_aspect, 1.0) * 1.15);
    float n = sc_fbm(uv * vec2(u_aspect, 1.0) * 5.0 + vec2(0.0, u_time * 0.5));
    float front = u_progress * 1.5 - 0.15;
    float e = dist + (n - 0.5) * 0.4 - front;          // < 0 means burned away
    float burned = smoothstep(0.004, -0.004, e);
    float charred = smoothstep(0.14, 0.0, e) * (1.0 - burned);
    float glowBand = smoothstep(0.06, 0.0, e) * smoothstep(-0.035, 0.0, e);
    float flick = 0.55 + 0.45 * sc_noise(uv * vec2(u_aspect, 1.0) * 35.0 + vec2(0.0, -u_time * 9.0));
    // Brown, then black, toward the burning edge.
    c.rgb *= mix(vec3(1.0), vec3(0.32, 0.18, 0.1), charred);
    c *= 1.0 - burned;
    vec3 fire = sc_fire(0.45 + 0.55 * glowBand * flick);
    float fa = clamp(glowBand * flick * 1.3, 0.0, 1.0);
    c = vec4(mix(c.rgb, fire * max(c.a, fa), fa), max(c.a, fa));
    // Sparks drifting in the burned part near the edge.
    vec2 g = uv * vec2(u_aspect, 1.0) * 60.0 + vec2(0.0, u_time * 6.0);
    float h = sc_hash(floor(g));
    float spark = step(0.97, h) * exp(-dot(fract(g) - 0.5, fract(g) - 0.5) * 30.0)
        * smoothstep(-0.12, -0.02, e) * burned;
    c = mix(c, vec4(1.0, 0.7, 0.3, 1.0), clamp(spark, 0.0, 1.0));
    cogl_color_out = c;
`,
};

// --- Nightfall (Slumber) -----------------------------------------------------
const NIGHT = {
    decl: 'uniform float u_time; uniform float u_progress; uniform float u_aspect;',
    code: `
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec2 p = uv * vec2(u_aspect, 1.0);
    float wave = (sc_fbm(vec2(uv.x * 2.5 + u_time * 0.15, u_time * 0.1)) - 0.5) * 0.22;
    float edge = u_progress * 1.4 - 0.25 + wave;
    float cover = smoothstep(edge + 0.07, edge - 0.08, uv.y);
    vec3 sky = mix(vec3(0.015, 0.01, 0.06), vec3(0.07, 0.04, 0.17), uv.y);
    float neb = sc_fbm(p * 2.2 + vec2(u_time * 0.015, 0.0));
    float neb2 = sc_fbm(p * 4.0 - vec2(0.0, u_time * 0.02));
    sky += vec3(0.32, 0.14, 0.5) * pow(neb, 3.0) * 0.9 + vec3(0.1, 0.2, 0.45) * pow(neb2, 4.0) * 0.8;
    // Two layers of twinkling stars.
    vec2 g1 = p * 110.0;
    float h1 = sc_hash(floor(g1));
    vec2 f1 = fract(g1) - 0.5;
    float s1 = step(0.982, h1) * exp(-dot(f1, f1) * 40.0) * (0.55 + 0.45 * sin(u_time * 2.5 + h1 * 80.0));
    vec2 g2 = p * 38.0;
    float h2 = sc_hash(floor(g2) + 7.0);
    vec2 f2 = fract(g2) - 0.5;
    float s2 = step(0.985, h2) * (exp(-dot(f2, f2) * 25.0) + 0.6 * exp(-abs(f2.x) * 40.0) * exp(-abs(f2.y) * 6.0)
        + 0.6 * exp(-abs(f2.y) * 40.0) * exp(-abs(f2.x) * 6.0)) * (0.6 + 0.4 * sin(u_time * 1.7 + h2 * 50.0));
    sky += vec3(0.9, 0.92, 1.0) * s1 + vec3(1.0, 0.95, 0.85) * s2;
    // A crescent moon that rises as night falls.
    vec2 mc = vec2(0.82 * u_aspect, 0.2 + (1.0 - u_progress) * 0.3);
    float md = length(p - mc);
    float disc = smoothstep(0.062, 0.058, md);
    float bite = smoothstep(0.062, 0.058, length(p - mc - vec2(0.03, -0.018)));
    float moon = clamp(disc - bite, 0.0, 1.0);
    sky += vec3(1.0, 0.95, 0.8) * moon + vec3(0.6, 0.6, 1.0) * exp(-md * 9.0) * 0.25;
    // Glowing lavender rim where night meets day.
    float rim = exp(-sc_sq((uv.y - edge) / 0.03)) * (0.6 + 0.4 * sc_noise(vec2(uv.x * 25.0, u_time * 2.0)));
    vec3 rimc = vec3(0.7, 0.55, 1.0) * rim;
    float ra = clamp(rim * 0.9, 0.0, 1.0);
    float a = max(cover, ra);
    cogl_color_out = vec4(mix(sky * cover, rimc / max(rim, 0.001) * a, ra * (1.0 - cover * 0.5)), a);
`,
};

// --- Frost (Freeze) ------------------------------------------------------------
const FROST = {
    decl: 'uniform float u_time; uniform float u_progress; uniform float u_aspect;',
    code: `
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec2 p = uv * vec2(u_aspect, 1.0);
    float ex = min(uv.x, 1.0 - uv.x) * u_aspect;
    float ey = min(uv.y, 1.0 - uv.y);
    // Soft-min so the corners freeze first and fastest.
    float e = -log(exp(-ex * 9.0) + exp(-ey * 9.0)) / 9.0 + 0.08;
    float n = sc_fbm(p * 3.0);
    float f = u_progress * 0.42 - e + (n - 0.5) * 0.2;
    float cover = smoothstep(0.0, 0.06, f);
    // Crystal cells.
    vec2 g = p * 22.0;
    vec2 ip = floor(g);
    vec2 fp = fract(g);
    float m1 = 8.0;
    float m2 = 8.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(float(x), float(y));
            vec2 rp = vec2(sc_hash(ip + o), sc_hash(ip + o + 17.3));
            vec2 dd = o + rp - fp;
            float d = dot(dd, dd);
            if (d < m1) { m2 = m1; m1 = d; } else if (d < m2) { m2 = d; }
        }
    }
    float cellEdge = smoothstep(0.1, 0.0, sqrt(m2) - sqrt(m1));
    // Fern-like feathery ridges.
    float rid = 1.0 - abs(sc_fbm(p * 7.0 + vec2(n * 2.0)) * 2.0 - 1.0);
    rid = pow(rid, 6.0);
    float fine = sc_fbm(p * 30.0);
    float ice = clamp(0.3 + 0.2 * cellEdge + 0.8 * rid + 0.35 * fine, 0.0, 1.0);
    float thick = smoothstep(0.0, 0.35, f);
    vec3 col = mix(vec3(0.5, 0.72, 0.95), vec3(0.96, 0.99, 1.0), clamp(ice * (0.5 + 0.5 * thick), 0.0, 1.0));
    float a = cover * clamp(0.22 + 0.6 * ice * (0.35 + 0.65 * thick), 0.0, 0.9);
    // Bright frontier and twinkling glints.
    float front = exp(-sc_sq(f / 0.025)) * 0.8;
    vec2 gg = p * 70.0;
    float hh = sc_hash(floor(gg));
    float glint = step(0.993, hh) * exp(-dot(fract(gg) - 0.5, fract(gg) - 0.5) * 30.0)
        * (0.5 + 0.5 * sin(u_time * 6.0 + hh * 90.0)) * cover;
    float sparkle = min(1.0, front * smoothstep(-0.05, 0.0, f) * 0.6 + glint * 1.5);
    float oa = max(a, sparkle);
    cogl_color_out = vec4(mix(col * a, vec3(oa), sparkle), oa);
`,
};

// --- Lightning bolt ---------------------------------------------------------------
const BOLT = {
    decl: `uniform float u_time; uniform float u_seed; uniform float u_intensity; uniform float u_aspect;
        uniform vec2 u_a; uniform vec2 u_b; uniform vec2 u_b1; uniform vec2 u_b2;
        uniform vec3 u_color;
        vec2 sc_bolt_point(vec2 a, vec2 b, float s, float seed, float amp) {
            vec2 ab = b - a;
            vec2 nrm = normalize(vec2(-ab.y, ab.x));
            float env = sin(3.14159 * s);
            float j = (sc_fbm(vec2(s * 7.0 + seed, seed * 3.1 + floor(u_time * 14.0) * 0.37)) - 0.5);
            return a + ab * s + nrm * j * amp * length(ab) * env;
        }
        float sc_bolt_dist(vec2 p, vec2 a, vec2 b, float seed, float amp) {
            vec2 ab = b - a;
            float s = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
            return length(p - sc_bolt_point(a, b, s, seed, amp));
        }`,
    code: `
    vec2 p = cogl_tex_coord_in[0].xy * vec2(u_aspect, 1.0);
    vec2 a = u_a * vec2(u_aspect, 1.0);
    vec2 b = u_b * vec2(u_aspect, 1.0);
    float d = sc_bolt_dist(p, a, b, u_seed, 0.35);
    vec2 s1 = sc_bolt_point(a, b, 0.38, u_seed, 0.35);
    vec2 s2 = sc_bolt_point(a, b, 0.62, u_seed, 0.35);
    float d1 = sc_bolt_dist(p, s1, s1 + u_b1 * vec2(u_aspect, 1.0), u_seed + 11.0, 0.5);
    float d2 = sc_bolt_dist(p, s2, s2 + u_b2 * vec2(u_aspect, 1.0), u_seed + 23.0, 0.5);
    float db = min(d1, d2);
    float core = smoothstep(0.0055, 0.0015, d) + 0.7 * smoothstep(0.0035, 0.001, db);
    // Tight bright sheath plus a wide soft halo.
    float glow = 0.6 * exp(-d / 0.008) + 0.35 * exp(-d / 0.035) + 0.35 * exp(-db / 0.007) + 0.12 * exp(-db / 0.03);
    glow = min(glow, 1.0);
    vec3 col = mix(u_color * glow, vec3(1.0), clamp(core, 0.0, 1.0));
    float alpha = clamp(core + glow * 0.85, 0.0, 1.0) * clamp(u_intensity, 0.0, 1.0);
    cogl_color_out = vec4(col * alpha, alpha);
`,
};

// --- Aurora (Enchant) ----------------------------------------------------------------
const AURORA = {
    decl: 'uniform float u_time; uniform float u_progress; uniform float u_aspect; uniform vec3 u_c1; uniform vec3 u_c2;',
    code: `
    vec2 uv = cogl_tex_coord_in[0].xy;
    float t = u_time;
    vec3 col = vec3(0.0);
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float y0 = 0.12 + 0.09 * fk + 0.05 * sin(uv.x * (4.0 + fk) + t * (0.6 + 0.2 * fk) + fk * 2.0)
            + (sc_fbm(vec2(uv.x * 3.0 + fk * 5.0, t * 0.3)) - 0.5) * 0.1;
        float band = exp(-sc_sq((uv.y - y0) / (0.035 + 0.01 * fk)));
        // Curtains hang down from the ribbon.
        float hang = smoothstep(y0 - 0.02, y0 + 0.16, uv.y) * smoothstep(y0 + 0.3, y0, uv.y);
        float streak = pow(sc_noise(vec2(uv.x * 90.0 + fk * 13.0, t * 0.8)), 3.0);
        float shape = band * 0.9 + hang * streak * 0.8;
        col += mix(u_c1, u_c2, 0.5 + 0.5 * sin(uv.x * 5.0 + fk + t * 0.5)) * shape;
    }
    // Fade in, hold, fade out; sweep in from the left.
    float life = smoothstep(0.0, 0.2, u_progress) * smoothstep(1.0, 0.7, u_progress);
    float sweep = smoothstep(u_progress * 2.2 - 0.3, u_progress * 2.2 - 0.6, uv.x);
    col = col / (1.0 + col);           // soft tone-map, no hard overflow
    float k = life * sweep;
    float a = clamp(max(col.r, max(col.g, col.b)) * 1.4, 0.0, 0.85) * k;
    vec3 hue = col / max(max(col.r, max(col.g, col.b)), 0.001);
    cogl_color_out = vec4(mix(hue, vec3(1.0), 0.25) * a, a);
`,
};

// --- Spirit familiar --------------------------------------------------------------------
const SPIRIT = {
    decl: `uniform float u_time; uniform vec2 u_vel; uniform vec2 u_look;
        uniform float u_blink; uniform float u_mood; uniform vec3 u_glow; uniform float u_pulse;
        uniform float u_alpha;`,
    code: `
    vec2 p = (cogl_tex_coord_in[0].xy - 0.5) * 2.0;
    float t = u_time;
    // The tail streams away from the way it moves, and rises like a flame at rest.
    vec2 trail = -u_vel * 1.6 + vec2(0.0, -0.55);
    float tl = length(trail);
    vec2 td = trail / max(tl, 0.0001);
    vec2 tn = vec2(-td.y, td.x);
    float along = dot(p, td);
    float across = dot(p, tn);
    float tailLen = 0.62 + min(tl, 1.2) * 0.4;
    float s = clamp(along / tailLen, 0.0, 1.0);
    float wob = (sc_fbm(vec2(along * 3.5 - t * 3.2, across * 2.0 + t * 0.4)) - 0.5) * 0.35 * s;
    float width = 0.3 * (1.0 - s) * (1.0 - 0.3 * s);
    float tail = step(0.0, along) * smoothstep(width, width * 0.2, abs(across + wob)) * (1.0 - s);
    // Body: an orb whose top breaks into flickering flame tongues.
    float r = length(p);
    float n = sc_fbm(p * 3.5 + vec2(t * 0.3, -t * 1.6));
    float up = clamp(-p.y / 0.6, 0.0, 1.0);                 // 0 at centre, 1 above
    float lick = sc_fbm(vec2(p.x * 6.0, p.y * 3.0 + t * 3.5));
    // Tongues of flame rise off the top: three wavering peaks.
    float peaks = 0.5 + 0.5 * cos(p.x * 14.0 + sin(t * 3.0 + p.y * 6.0) * 1.2);
    float tongue = up * (0.12 + 0.38 * lick) * peaks * smoothstep(0.32, 0.05, abs(p.x));
    float bodyR = 0.32 + 0.04 * n + tongue;
    float body = smoothstep(bodyR, bodyR - 0.1, r);
    float core = exp(-r * r / 0.012);
    float flame = max(body, tail * (0.7 + 0.5 * n));
    // Colour: deep rim -> rich glow colour -> pale -> small white-hot core.
    float depth = smoothstep(bodyR, 0.0, r);
    float heat = clamp(flame * (0.25 + 0.45 * n + 0.35 * depth) + core * 0.9, 0.0, 1.0);
    vec3 col = mix(u_glow * 0.35, u_glow * 0.95, smoothstep(0.0, 0.45, heat));
    col = mix(col, mix(u_glow, vec3(1.0), 0.45), smoothstep(0.55, 0.85, heat));
    col = mix(col, vec3(1.0), smoothstep(0.88, 1.0, heat));
    float a = clamp(flame * 1.15, 0.0, 1.0);
    // Soft coloured aura.
    float halo = exp(-r * 3.2) * (0.5 + 0.3 * u_pulse);
    vec3 outc = col * a + u_glow * halo * 0.8 * (1.0 - a);
    float outa = max(a, halo * 0.55);
    // Orbiting motes of light.
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float ang = t * (1.2 + 0.3 * fk) + fk * 2.094;
        vec2 mp = vec2(cos(ang) * 0.55, sin(ang) * 0.22 - 0.05 + 0.08 * sin(t * 2.0 + fk));
        float md = length(p - mp);
        float mote = exp(-md * md / 0.0012) * (0.6 + 0.4 * sin(t * 5.0 + fk * 3.0));
        outc = mix(outc, mix(u_glow, vec3(1.0), 0.6), mote);
        outa = max(outa, mote);
    }
    // Eyes. Mood: 0 idle, 1 watch, 2 happy, 3 oops, 4 sleep.
    vec2 eo = vec2(0.095, -0.015) ;
    vec2 lk = u_look * vec2(0.045, 0.035);
    float eyes = 0.0;
    float shine = 0.0;
    for (int k = 0; k < 2; k++) {
        float side = k == 0 ? -1.0 : 1.0;
        vec2 ec = vec2(side * eo.x, eo.y) + lk;
        vec2 q = p - ec;
        if (u_mood > 3.5 || u_blink > 0.5) {
            // Closed: a gentle curve.
            float cy = 0.02 - q.x * q.x * 6.0;
            eyes += smoothstep(0.012, 0.004, abs(q.y - cy)) * step(abs(q.x), 0.04);
        } else if (u_mood > 1.5 && u_mood < 2.5) {
            // Happy: ^ ^
            float cy = -0.012 + abs(q.x) * 0.9;
            eyes += smoothstep(0.012, 0.004, abs(q.y - cy)) * step(abs(q.x), 0.04);
        } else {
            float big = u_mood > 0.5 && u_mood < 1.5 ? 1.2 : 1.0;
            float ed = length(q / vec2(0.034, 0.048) / big);
            eyes += smoothstep(1.0, 0.85, ed);
            shine += smoothstep(0.35, 0.2, length((q - vec2(-0.01, -0.016)) / vec2(0.034, 0.048)));
        }
    }
    eyes = clamp(eyes, 0.0, 1.0);
    vec3 eyeCol = vec3(0.08, 0.04, 0.16);
    outc = mix(outc, eyeCol * max(a, 0.6), eyes * step(0.3, a));
    outc = mix(outc, vec3(outa), clamp(shine * 0.9, 0.0, 1.0) * step(0.3, a));
    cogl_color_out = vec4(outc, outa) * u_alpha;
`,
};


// --- Casting trail -------------------------------------------------------------
// The trail is drawn by Cairo as a thin mask whose red channel holds "how far
// along the stroke" (0 = start, 1 = newest). This shader turns it into a
// glowing ribbon: soft halo from a blur of the mask, energy pulses racing
// toward the wand tip, shimmer and twinkles.
const TRAIL = {
    decl: `uniform sampler2D tex;
        uniform float u_time; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec2 u_px;
        uniform float u_len; uniform float u_flare; uniform float u_fizzle;`,
    code: `
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 m = texture2D(tex, uv);
    float core = m.a;
    float along = core > 0.01 ? m.r / m.a : 0.0;
    // Halo: a ring-shaped blur of the mask.
    float g = 0.0;
    float ga = 0.0;
    float wsum = 0.0;
    for (int i = 0; i < 12; i++) {
        float ang = float(i) * 0.5236 + 0.26;
        vec2 dir = vec2(cos(ang), sin(ang)) * u_px;
        for (int j = 1; j <= 3; j++) {
            float rad = float(j) * float(j) * 3.5;
            vec4 sm = texture2D(tex, uv + dir * rad);
            float w = 1.0 / float(j);
            g += sm.a * w;
            ga += sm.r * w;
            wsum += w;
        }
    }
    float halo = g / wsum;
    float hAlong = g > 0.001 ? ga / g : 0.0;
    float A = core > 0.01 ? along : hAlong;
    // Pulses of energy flowing toward the tip; the newest part burns brightest.
    float pulse = 0.5 + 0.5 * sin(A * u_len * 0.045 - u_time * 11.0);
    float tip = smoothstep(0.75, 1.0, A);
    vec3 base = mix(u_c1, u_c2, A);
    vec2 px = uv / u_px;
    float n = sc_noise(px * 0.06 + vec2(u_time * 2.5, -u_time * 1.3));
    float ha = clamp(halo * 2.6, 0.0, 1.0) * (0.5 + 0.3 * pulse + 0.25 * n + 0.3 * tip);
    vec3 coreCol = mix(base, vec3(1.0), clamp(0.55 + 0.35 * pulse + 0.3 * tip, 0.0, 1.0));
    float a = max(core, ha);
    vec3 col = mix(base * ha, coreCol, core);
    // Twinkles scattered in the glow.
    vec2 cell = floor(px / 9.0);
    float h = sc_hash(cell + floor(u_time * 6.0) * 0.13);
    float tw = step(0.93, h) * smoothstep(0.08, 0.35, halo) * (1.0 - core);
    col = mix(col, vec3(1.0), tw * 0.9);
    a = max(a, tw * 0.9);
    // Flare (rune recognised) and fizzle (not recognised).
    col = mix(col, vec3(a), u_flare * 0.45);
    a = min(1.0, a * (1.0 + u_flare * 0.4));
    float grey = dot(col, vec3(0.33));
    vec3 smoky = vec3(grey * 0.85, grey * 0.75, grey) * 0.8;
    float crumble = step(sc_noise(px * 0.08), 1.0 - u_fizzle * 0.9);
    col = mix(col, smoky * crumble, u_fizzle);
    a = mix(a, a * 0.7 * crumble, u_fizzle);
    cogl_color_out = vec4(col, a);
`,
};

// --- Magic circle ------------------------------------------------------------------
// Draws itself clockwise, spins, flows with energy, then dissolves.
const SIGIL = {
    decl: `uniform float u_time; uniform float u_progress; uniform vec3 u_c1; uniform vec3 u_c2;
        uniform float u_seed; uniform float u_spin;
        float sc_seg(vec2 p, vec2 a, vec2 b) {
            vec2 pa = p - a;
            vec2 ba = b - a;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            return length(pa - ba * h);
        }
        vec2 sc_rot(vec2 p, float a) {
            float c = cos(a);
            float s = sin(a);
            return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        }`,
    code: `
    vec2 p = (cogl_tex_coord_in[0].xy - 0.5) * 2.0;
    float t = u_time;
    float r = length(p);
    float TAU = 6.28318;
    // Appear: rings sweep in clockwise. Disappear: dissolve into motes.
    float reveal = smoothstep(0.0, 0.35, u_progress);
    float fade = smoothstep(0.72, 1.0, u_progress);
    float ang = atan(p.y, p.x);
    float a01 = fract((ang + 1.5708) / TAU);
    float drawn = step(a01, reveal * 1.02);

    float px = 0.0095;
    float lines = 0.0;
    // Rings.
    lines += smoothstep(px * 1.6, 0.0, abs(r - 0.92));
    lines += smoothstep(px, 0.0, abs(r - 0.86));
    lines += smoothstep(px * 1.3, 0.0, abs(r - 0.66));
    lines += smoothstep(px * 0.8, 0.0, abs(r - 0.61));
    lines += smoothstep(px, 0.0, abs(r - 0.2));
    // Rune band between the outer rings, turning one way...
    vec2 q = sc_rot(p, t * u_spin * 0.5);
    float qa = fract((atan(q.y, q.x) + 3.14159) / TAU);
    float N = 30.0;
    float cell = floor(qa * N);
    float cu = fract(qa * N) - 0.5;              // across the glyph
    float cv = (r - 0.89) / 0.035;               // up the glyph
    vec2 gp = vec2(cu * 1.6, cv * 0.5);
    float h1 = sc_hash(vec2(cell, u_seed));
    float h2 = sc_hash(vec2(cell + 7.0, u_seed));
    float glyph = 1e3;
    glyph = min(glyph, sc_seg(gp, vec2(-0.3 + h1 * 0.6, -0.45), vec2(-0.3 + h2 * 0.6, 0.45)));
    glyph = min(glyph, sc_seg(gp, vec2(-0.4, -0.4 + h2 * 0.8), vec2(0.4, -0.4 + h1 * 0.8)));
    if (h1 > 0.5)
        glyph = min(glyph, abs(length(gp - vec2(0.0, h2 * 0.4 - 0.2)) - 0.18));
    float band = step(abs(cv), 1.0) * smoothstep(0.09, 0.03, glyph);
    lines += band * 0.9;
    // ...and a hexagram + ticks turning the other way.
    vec2 s = sc_rot(p, -t * u_spin);
    float hex = 1e3;
    for (int k = 0; k < 6; k++) {
        float a0 = float(k) * 2.0944 * 1.0 - 1.5708 + (k > 2 ? 1.0472 : 0.0);
        float a1 = a0 + 2.0944;
        hex = min(hex, sc_seg(s, vec2(cos(a0), sin(a0)) * 0.61, vec2(cos(a1), sin(a1)) * 0.61));
    }
    lines += smoothstep(px * 1.2, 0.0, hex);
    for (int k = 0; k < 6; k++) {
        float a0 = float(k) * 1.0472 - 1.5708;
        lines += smoothstep(px, 0.0, abs(length(s - vec2(cos(a0), sin(a0)) * 0.61) - 0.045));
    }
    float sa = fract((atan(s.y, s.x) + 3.14159) / TAU);
    float tick = step(fract(sa * 72.0), 0.12) * step(0.55, r) * step(r, 0.6);
    lines += tick * 0.8;
    // Inner star.
    vec2 c = sc_rot(p, t * u_spin * 1.5);
    float star = 1e3;
    for (int k = 0; k < 8; k++) {
        float a0 = float(k) * 2.3562 - 1.5708;
        float a1 = a0 + 2.3562;
        star = min(star, sc_seg(c, vec2(cos(a0), sin(a0)) * 0.19, vec2(cos(a1), sin(a1)) * 0.19));
    }
    lines += smoothstep(px, 0.0, star);
    lines = clamp(lines, 0.0, 1.0) * drawn;

    // Energy racing around the rings.
    float flow = 0.55 + 0.45 * sin(ang * 3.0 - t * 7.0) * sin(r * 30.0 - t * 4.0);
    float glow = exp(-sq0(r - 0.92) / 0.002) + exp(-sq0(r - 0.66) / 0.002) * 0.8 + exp(-r * r / 0.02) * 0.5;
    glow *= reveal * 0.75;
    // Dissolve into sparkling motes at the end.
    float dn = sc_noise(p * 14.0 + u_seed);
    float keep = step(fade, dn * 0.95);
    float mote = step(dn, fade) * step(fade - 0.12, dn) * 1.0;
    vec3 lineCol = mix(u_c2, vec3(1.0), 0.55 + 0.25 * flow);
    float la = lines * keep;
    float ga = clamp(glow * (1.0 - fade), 0.0, 1.0);
    float ma = mote * clamp(lines + glow, 0.0, 1.0) * 0.9;
    float a = max(la, max(ga, ma));
    vec3 col = lineCol * la + u_c1 * ga * (1.0 - la) + vec3(1.0) * ma;
    cogl_color_out = vec4(min(col, vec3(a)), a);
`,
};

// --- Volume ring (Sound Control) --------------------------------------------------
const VOLRING = {
    decl: `uniform float u_time; uniform float u_level; uniform float u_muted; uniform float u_pop;
        uniform vec3 u_c1; uniform vec3 u_c2;`,
    code: `
    vec2 p = (cogl_tex_coord_in[0].xy - 0.5) * 2.0;
    float r = length(p);
    float TAU = 6.28318;
    // 0 at the top, going clockwise.
    float a01 = fract(atan(p.x, -p.y) / TAU + 1.0);
    float R = 0.7 + 0.04 * u_pop;
    float w = 0.075;
    float band = smoothstep(w, w * 0.55, abs(r - R));
    float lvl = clamp(u_level, 0.0, 1.0);
    float filled = smoothstep(lvl + 0.004, lvl - 0.004, a01);
    // Track, filled arc with a gradient, and a bright orb at the end.
    vec3 arc = mix(u_c1, u_c2, a01);
    float flow = 0.75 + 0.25 * sin(a01 * 40.0 - u_time * 6.0);
    vec2 tipP = vec2(sin(lvl * TAU), -cos(lvl * TAU)) * R;
    float tip = exp(-dot(p - tipP, p - tipP) / 0.006) * step(0.001, lvl);
    float glow = exp(-sq0((r - R) / 0.16)) * filled * (0.35 + 0.25 * u_pop);
    // Ticks every 10%.
    float tick = step(fract(a01 * 10.0 + 0.5), 0.05) * smoothstep(0.02, 0.0, abs(r - (R + 0.13)));
    // Muted: grey ring with a red slash.
    float slash = smoothstep(0.035, 0.02, abs(p.x + p.y) / 1.414) * step(r, R - 0.06) * u_muted;
    vec3 trackC = vec3(0.2, 0.15, 0.3);
    float trackA = band * 0.55;
    vec3 col = trackC * trackA;
    float a = trackA;
    float fa = band * filled;
    vec3 fc = mix(arc * flow, vec3(0.6), u_muted);
    col = mix(col, fc * fa, fa);
    a = max(a, fa);
    col = mix(col, mix(arc, vec3(0.6), u_muted) * glow, (1.0 - a) * step(0.001, glow));
    a = max(a, glow);
    float ta = clamp(tip * (1.0 - u_muted), 0.0, 1.0);
    col = mix(col, vec3(ta), ta);
    a = max(a, ta);
    float tka = tick * 0.6;
    col = mix(col, vec3(tka), tka);
    a = max(a, tka);
    // Dark disc behind the speaker icon.
    float disc = smoothstep(0.42, 0.38, r) * 0.85;
    col = mix(col, vec3(0.1, 0.04, 0.2) * disc, disc * (1.0 - a));
    a = max(a, disc);
    vec3 red = vec3(1.0, 0.3, 0.35);
    col = mix(col, red * slash, slash);
    a = max(a, slash);
    cogl_color_out = vec4(col, a);
`,
};

const SHADERS = {volring: VOLRING, trail: TRAIL, sigil: SIGIL, fireball: FIREBALL, burn: BURN, night: NIGHT, frost: FROST, bolt: BOLT, aurora: AURORA, spirit: SPIRIT};

function fullSource(src) {
    // Clamp so nothing is brighter than white, keep it valid premultiplied
    // colour (rgb <= alpha) or the compositor garbles it, and respect the
    // actor's opacity so fades and the familiar's shyness work.
    return `${src.code}
    cogl_color_out = clamp(cogl_color_out, 0.0, 1.0);
    cogl_color_out.rgb = min(cogl_color_out.rgb, vec3(cogl_color_out.a));
    cogl_color_out *= cogl_color_in.a;`;
}

// GNOME 50 has Shell.GLSLEffect. GNOME 51 removed it in favour of
// Clutter.ShaderEffect with a static snippet, where uniforms are addressed
// by name. Pick whichever exists so Spellcaster keeps working.
const USE_SHADER_EFFECT = !Shell.GLSLEffect;

// One GObject class per shader (registered once, when this file loads).
const CLASSES = {};
for (const [name, src] of Object.entries(SHADERS)) {
    if (USE_SHADER_EFFECT) {
        CLASSES[name] = GObject.registerClass({
            GTypeName: `SpellcasterShader_${name}`,
        }, class extends Clutter.ShaderEffect {
            vfunc_get_static_snippet() {
                const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, COMMON + src.decl, null);
                snippet.set_replace(fullSource(src));
                return snippet;
            }

            get_uniform_location(uniform) {
                return uniform;
            }

            set_uniform_float(uniform, nComponents, values) {
                super.set_uniform_float(uniform, nComponents, values.slice(0, nComponents));
            }
        });
    } else {
        CLASSES[name] = GObject.registerClass({
            GTypeName: `SpellcasterShader_${name}`,
        }, class extends Shell.GLSLEffect {
            vfunc_build_pipeline() {
                this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, COMMON + src.decl, fullSource(src), true);
            }
        });
    }
}

/** A shader effect with easy uniform setting. */
export class Shader {
    constructor(name) {
        this.effect = new CLASSES[name]();
        this._loc = new Map();
    }

    set(name, value) {
        let loc = this._loc.get(name);
        if (loc === undefined) {
            loc = this.effect.get_uniform_location(name);
            this._loc.set(name, loc);
        }
        const v = Array.isArray(value) ? value : [value];
        this.effect.set_uniform_float(loc, v.length, v);
        return this;
    }

    setAll(uniforms) {
        for (const [k, v] of Object.entries(uniforms))
            this.set(k, v);
        this.effect.queue_repaint();
    }
}

/**
 * A rectangle drawn entirely by a shader.
 * @returns {{actor: St.Widget, shader: Shader}}
 */
export function shaderActor(name, {x, y, width, height, parent}) {
    const actor = new St.Widget({
        // Something has to be painted for the effect to run.
        style: 'background-color: rgba(0, 0, 0, 0.004);',
        x: Math.round(x), y: Math.round(y),
        width: Math.ceil(width), height: Math.ceil(height),
        reactive: false,
    });
    const shader = new Shader(name);
    actor.add_effect(shader.effect);
    parent?.add_child(actor);
    return {actor, shader};
}

/**
 * Drive a shader for `duration` ms: onFrame(progress, seconds) each frame,
 * then onDone(). Two safety nets so an effect can never get stuck on screen:
 *  - GNOME is asked to keep compositing (a fullscreen or focused app could
 *    otherwise pause drawing on top of it), and
 *  - a backup timer finishes the effect if the animation clock stalls.
 * Returns an object with stop().
 */
export function runShader(actor, shader, duration, onFrame, onDone) {
    const tl = new Clutter.Timeline({actor, duration});
    const start = Date.now();
    let finished = false;
    let backup = 0;
    global.compositor.disable_unredirect();

    const finish = () => {
        if (finished)
            return;
        finished = true;
        global.compositor.enable_unredirect();
        if (backup) {
            GLib.source_remove(backup);
            backup = 0;
        }
        tl.stop();
        try {
            onFrame(1, (Date.now() - start) / 1000);
        } catch {}
        onDone?.();
    };
    const frame = () => {
        if (finished)
            return;
        // Use the wall clock, so a slow or skipped frame never stretches it.
        const p = Math.min(1, (Date.now() - start) / duration);
        onFrame(p, (Date.now() - start) / 1000);
        shader.effect.queue_repaint();
        if (p >= 1)
            finish();
    };
    tl.connect('new-frame', frame);
    tl.connect('completed', finish);
    backup = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration + 400, () => {
        backup = 0;
        finish();
        return GLib.SOURCE_REMOVE;
    });
    // If the actor goes away first (extension disabled), just clean up.
    actor.connect('destroy', () => {
        if (finished)
            return;
        finished = true;
        global.compositor.enable_unredirect();
        if (backup)
            GLib.source_remove(backup);
        backup = 0;
    });
    frame();
    tl.start();
    return {stop: () => {
        if (finished)
            return;
        finished = true;
        global.compositor.enable_unredirect();
        if (backup)
            GLib.source_remove(backup);
        backup = 0;
        tl.stop();
    }};
}
