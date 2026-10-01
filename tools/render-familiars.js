// Renders the three familiars to docs/screenshots/familiars.png
// gjs -m tools/render-familiars.js
import Cairo from 'cairo';
import {draw, cpuGlow} from '../spellcaster@gamerdolphin.github.io/lib/familiarArt.js';

const W = 900, H = 300;
const surf = new Cairo.ImageSurface(Cairo.Format.ARGB32, W, H);
const cr = new Cairo.Context(surf);
const bg = new Cairo.LinearGradient(0, 0, 0, H);
bg.addColorStopRGBA(0, 0.09, 0.05, 0.2, 1);
bg.addColorStopRGBA(1, 0.03, 0.02, 0.08, 1);
cr.setSource(bg);
cr.paint();

const types = [['wisp', 0.1], ['owl', 0.5], ['dragon', 0.95]];
types.forEach(([type, load], i) => {
    cr.save();
    cr.translate(W / 6 + i * W / 3, H / 2);
    draw(cr, type, {
        size: 110, t: 0.6, look: {x: 0.4, y: 0.2}, facing: 1, blink: false, mood: 'idle',
        glow: cpuGlow(load), pulse: 0.5, moving: 0.3,
        tail: [1, 2, 3, 4, 5, 6, 7].map(k => ({x: -k * 14, y: Math.sin(k * 0.7) * 8})),
    });
    cr.restore();
});
surf.writeToPNG(ARGV[0] ?? 'docs/screenshots/familiars.png');
print('ok');
