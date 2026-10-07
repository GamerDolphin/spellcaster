// SPDX-License-Identifier: GPL-2.0-or-later
//
// Rune recognizer: turns one mouse stroke into a rune name.
//
// Pure JavaScript with no GNOME imports, so it runs inside the shell,
// inside the preferences window, and in plain `gjs` for the tests.
//
// It works by measuring a handful of simple features of the stroke
// (how straight it is, how much it turns, where its sharp corners are...)
// and scoring each rune with soft thresholds. Coordinates are screen
// coordinates, so y grows downward.

export const RUNES = ['spiral', 'lightning', 'circle', 'v', 'caret', 'u', 'line', 'up', 'triangle'];

const N_POINTS = 64;
const DEG = 180 / Math.PI;

/** Linear 0..1 ramp between lo and hi (works for lo > hi as a falling ramp). */
function ramp(x, lo, hi) {
    const t = (x - lo) / (hi - lo);
    return Math.max(0, Math.min(1, t));
}

function dist(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function pathLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++)
        len += dist(pts[i - 1], pts[i]);
    return len;
}

/** Resample to n points evenly spaced along the path. */
export function resample(points, n = N_POINTS) {
    const pts = points.map(p => ({x: p.x, y: p.y}));
    const interval = pathLength(pts) / (n - 1);
    if (interval === 0)
        return null;

    const out = [{...pts[0]}];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        const d = dist(pts[i - 1], pts[i]);
        if (acc + d >= interval && d > 0) {
            const t = (interval - acc) / d;
            const q = {
                x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
                y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
            };
            out.push(q);
            pts.splice(i, 0, q);
            acc = 0;
        } else {
            acc += d;
        }
    }
    while (out.length < n)
        out.push({...pts[pts.length - 1]});
    return out.slice(0, n);
}

function smooth(pts) {
    const out = pts.map(p => ({...p}));
    for (let i = 1; i < pts.length - 1; i++) {
        out[i].x = (pts[i - 1].x + 2 * pts[i].x + pts[i + 1].x) / 4;
        out[i].y = (pts[i - 1].y + 2 * pts[i].y + pts[i + 1].y) / 4;
    }
    return out;
}

function wrapAngle(a) {
    while (a > Math.PI)
        a -= 2 * Math.PI;
    while (a <= -Math.PI)
        a += 2 * Math.PI;
    return a;
}

/** Ramer–Douglas–Peucker simplification, returns kept indices. */
function rdp(pts, eps, first = 0, last = pts.length - 1, keep = null) {
    keep ??= new Set([first, last]);
    const a = pts[first], b = pts[last];
    const len = dist(a, b) || 1;
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
        const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
        if (d > maxD) {
            maxD = d;
            idx = i;
        }
    }
    if (idx >= 0 && maxD > eps) {
        keep.add(idx);
        rdp(pts, eps, first, idx, keep);
        rdp(pts, eps, idx, last, keep);
    }
    return keep;
}

/** Measure everything the rules need. Exported for the Practice Room / tests. */
export function measure(rawPoints) {
    if (!rawPoints || rawPoints.length < 6)
        return null;

    const minX = Math.min(...rawPoints.map(p => p.x));
    const maxX = Math.max(...rawPoints.map(p => p.x));
    const minY = Math.min(...rawPoints.map(p => p.y));
    const maxY = Math.max(...rawPoints.map(p => p.y));
    const w = maxX - minX, h = maxY - minY;
    const diag = Math.hypot(w, h);
    if (diag < 30)
        return null;

    const r = resample(rawPoints);
    if (!r)
        return null;
    const pts = smooth(smooth(r));
    const n = pts.length;
    const start = pts[0], end = pts[n - 1];
    const len = pathLength(pts);
    const chord = dist(start, end);

    // Turning angles between successive segments.
    const headings = [];
    for (let i = 1; i < n; i++)
        headings.push(Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x));
    const turns = [];
    for (let i = 1; i < headings.length; i++)
        turns.push(wrapAngle(headings[i] - headings[i - 1]));
    const signed = turns.reduce((s, t) => s + t, 0) * DEG;
    const absolute = turns.reduce((s, t) => s + Math.abs(t), 0) * DEG;

    // Sharpest corner: the most turning packed into a short window
    // (15% of the path). A V puts nearly all its turning in one spot,
    // a U spreads it out.
    const win = Math.max(3, Math.round(turns.length * 0.15));
    let sharp = 0, sharpAt = 0;
    for (let i = 0; i + win <= turns.length; i++) {
        let s = 0;
        for (let j = i; j < i + win; j++)
            s += turns[j];
        if (Math.abs(s) * DEG > sharp) {
            sharp = Math.abs(s) * DEG;
            sharpAt = i + Math.floor(win / 2) + 1;
        }
    }

    // Corners from a simplified polyline (for lightning).
    // Corner detail scales with the stroke, but tall skinny strokes use
    // their width so a narrow zig-zag's corners still count.
    const keep = [...rdp(pts, Math.max(5, Math.min(diag * 0.07, w * 0.22)))].sort((a, b) => a - b);
    const corners = [];
    for (let k = 1; k < keep.length - 1; k++) {
        const p0 = pts[keep[k - 1]], p1 = pts[keep[k]], p2 = pts[keep[k + 1]];
        const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
        const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const t = wrapAngle(a2 - a1) * DEG;
        if (Math.abs(t) > 60)
            corners.push({index: keep[k], turn: t});
    }
    let alternating = corners.length > 0 ? 1 : 0;
    for (let k = 1; k < corners.length; k++) {
        if (Math.sign(corners[k].turn) !== Math.sign(corners[k - 1].turn))
            alternating++;
    }

    // A rounded corner can show up as two small same-direction corners
    // next to each other. Merge those into one.
    const merged = [];
    for (const c of corners) {
        const prev = merged[merged.length - 1];
        if (prev && Math.sign(prev.turn) === Math.sign(c.turn) && c.index - prev.index < n * 0.18)
            prev.turn += c.turn;
        else
            merged.push({...c});
    }
    const bigCorners = merged.filter(c => Math.abs(c.turn) > 60);
    const mainCorner = bigCorners.reduce((a, c) => (!a || Math.abs(c.turn) > Math.abs(a.turn) ? c : a), null);

    // Turning measured on the simplified polyline ignores hand jitter.
    let coarseAbs = 0;
    for (let k = 1; k < keep.length - 1; k++) {
        const p0 = pts[keep[k - 1]], p1 = pts[keep[k]], p2 = pts[keep[k + 1]];
        coarseAbs += Math.abs(wrapAngle(Math.atan2(p2.y - p1.y, p2.x - p1.x) -
            Math.atan2(p1.y - p0.y, p1.x - p0.x))) * DEG;
    }

    // Radius variation around the centroid (spiral vs circle).
    const cx = pts.reduce((s, p) => s + p.x, 0) / n;
    const cy = pts.reduce((s, p) => s + p.y, 0) / n;
    const radii = pts.map(p => Math.hypot(p.x - cx, p.y - cy));
    const rMean = radii.reduce((s, v) => s + v, 0) / n;
    const rStd = Math.sqrt(radii.reduce((s, v) => s + (v - rMean) ** 2, 0) / n);

    // Lowest point (largest y) of the middle part of the stroke.
    let lowIdx = 0, highIdx = 0;
    for (let i = 0; i < n; i++) {
        if (pts[i].y > pts[lowIdx].y)
            lowIdx = i;
        if (pts[i].y < pts[highIdx].y)
            highIdx = i;
    }

    const hSafe = Math.max(h, diag * 0.25);
    const wSafe = Math.max(w, diag * 0.25);

    // How wide the stroke is just above its lowest point (and just below
    // its highest). A V is pointy there, a U is round and wide.
    const spanNear = keepFn => {
        const xs = pts.filter(keepFn).map(p => p.x);
        return xs.length ? (Math.max(...xs) - Math.min(...xs)) / wSafe : 0;
    };
    const bottomSpan = spanNear(p => p.y >= pts[lowIdx].y - 0.22 * hSafe);
    const topSpan = spanNear(p => p.y <= pts[highIdx].y + 0.22 * hSafe);

    // Furthest the stroke strays from the straight start→end line.
    let maxDev = 0;
    if (chord > 0) {
        for (const p of pts) {
            const d = Math.abs((end.x - start.x) * (start.y - p.y) - (start.x - p.x) * (end.y - start.y)) / chord;
            maxDev = Math.max(maxDev, d);
        }
    }
    return {
        pts, start, end, len, chord, w, h, diag,
        bbox: {x: minX, y: minY, width: w, height: h},
        center: {x: (minX + maxX) / 2, y: (minY + maxY) / 2},
        straightness: len > 0 ? chord / len : 0,
        gap: chord / diag,
        signed,
        turning: Math.abs(signed),
        absolute: coarseAbs,
        consistency: coarseAbs > 0 ? Math.min(1, Math.abs(signed) / coarseAbs) : 0,
        sharp,
        sharpRatio: coarseAbs > 0 ? Math.min(1, sharp / coarseAbs) : 0,
        cornerCount: bigCorners.length,
        mainCornerTurn: mainCorner ? Math.abs(mainCorner.turn) : 0,
        sharpAt,
        corners,
        alternating,
        radVar: rMean > 0 ? rStd / rMean : 0,
        downness: chord > 0 ? (end.y - start.y) / chord : 0,
        // How far the sharpest corner sits below (V) or above (Λ) both ends.
        vDepth: mainCorner ? (pts[mainCorner.index].y - Math.max(start.y, end.y)) / hSafe : 0,
        caretDepth: mainCorner ? (Math.min(start.y, end.y) - pts[mainCorner.index].y) / hSafe : 0,
        // How far the lowest point sits below both ends (U opens upward).
        uDepth: (pts[lowIdx].y - Math.max(start.y, end.y)) / hSafe,
        bottomSpan,
        topSpan,
        deviation: len > 0 ? maxDev / len : 0,
        lowMid: lowIdx > n * 0.2 && lowIdx < n * 0.8,
        highMid: highIdx > n * 0.2 && highIdx < n * 0.8,
    };
}

/** Score every rune from 0 to 1. */
export function score(m) {
    const s = {};

    // A line must be really straight: a skinny zig-zag is lightning, not a line.
    const straight = ramp(m.straightness, 0.86, 0.95) *
        (1 - ramp(m.deviation, 0.05, 0.1)) *
        (m.alternating >= 2 ? 0 : 1);
    s.line = straight * ramp(m.downness, 0.70, 0.88);
    s.up = straight * ramp(-m.downness, 0.70, 0.88);

    const loopy = ramp(m.consistency, 0.55, 0.78);
    s.circle = ramp(m.turning, 250, 310) *
        (1 - ramp(m.turning, 450, 540)) *
        loopy *
        (1 - ramp(m.gap, 0.28, 0.5)) *
        (1 - ramp(m.radVar, 0.22, 0.38));

    const manyTurns = ramp(m.turning, 440, 520);
    const oneTurnSpiral = ramp(m.turning, 300, 380) * ramp(m.radVar, 0.28, 0.42) * ramp(m.gap, 0.3, 0.5);
    // An over-drawn circle turns a lot but keeps a steady radius.
    const notCircle = m.turning > 620 ? 1 : ramp(m.radVar, 0.10, 0.2);
    // Loops never zig-zag back and forth.
    const zigzag = m.alternating >= 2 ? 0 : 1;
    // Triangle: a closed loop like a circle, but its turning is bunched
    // into sharp corners instead of spread evenly.
    const pointy = ramp(m.sharp, 80, 105);
    // (The corner where you start and finish isn't counted, so a triangle
    // shows about 240° of turning and two sharp corners.)
    s.triangle = ramp(m.turning, 185, 215) *
        (1 - ramp(m.turning, 330, 390)) *
        ramp(m.cornerCount, 1.5, 2) *
        loopy *
        (1 - ramp(m.gap, 0.3, 0.5)) *
        pointy * zigzag;
    s.circle *= zigzag * (1 - pointy);
    s.spiral = Math.max(manyTurns * notCircle, oneTurnSpiral) * loopy * zigzag;

    // Two or more back-and-forth corners is the giveaway. Tall skinny bolts
    // have small turns and look fairly straight, so be generous there.
    s.lightning = ramp(m.alternating, 1.5, 2) *
        ramp(m.absolute, 95, 140) *
        (1 - ramp(m.consistency, 0.55, 0.8)) *
        (1 - ramp(m.straightness, 0.93, 0.98)) *
        ramp(m.deviation, 0.025, 0.05);

    const oneCorner = ramp(m.mainCornerTurn, 70, 100) *
        (m.cornerCount === 1 ? 1 : 0) *
        (1 - ramp(m.straightness, 0.8, 0.92));
    // Pointy tip = V / Λ. A round, wide bottom is a U (and a round top is
    // just an arch, which isn't a rune).
    s.v = oneCorner * ramp(m.vDepth, 0.35, 0.65) * (1 - ramp(m.bottomSpan, 0.36, 0.52));
    s.caret = oneCorner * ramp(m.caretDepth, 0.35, 0.65) * (1 - ramp(m.topSpan, 0.36, 0.52));

    s.u = ramp(m.turning, 110, 145) *
        (1 - ramp(m.turning, 250, 290)) *
        ramp(m.consistency, 0.6, 0.8) *
        ramp(m.bottomSpan, 0.36, 0.52) *
        ramp(m.uDepth, 0.35, 0.65) *
        ramp(m.gap, 0.12, 0.25) *        // a U is open at the top
        (m.lowMid ? 1 : 0);

    return s;
}

/**
 * Recognize a stroke.
 *
 * @param {{x:number,y:number}[]} points raw stroke points
 * @param {number} tolerance 0 (strict) .. 1 (forgiving)
 * @returns {{rune: string|null, confidence: number, closest: string|null,
 *            closestConfidence: number, scores: object, info: object|null}}
 */
export function recognize(points, tolerance = 0.5) {
    const m = measure(points);
    if (!m)
        return {rune: null, confidence: 0, closest: null, closestConfidence: 0, scores: {}, info: null};

    const scores = score(m);
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [best, bestScore] = ranked[0];
    const second = ranked[1][1];

    const needed = 0.55 - 0.4 * Math.max(0, Math.min(1, tolerance));
    const clear = bestScore - second >= 0.08;
    const ok = bestScore >= needed && clear;

    return {
        rune: ok ? best : null,
        confidence: bestScore,
        closest: bestScore > 0.02 ? best : null,
        closestConfidence: bestScore,
        scores,
        info: {center: m.center, bbox: m.bbox, start: m.start, end: m.end, pts: m.pts},
    };
}
