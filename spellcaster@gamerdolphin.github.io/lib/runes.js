// SPDX-License-Identifier: GPL-2.0-or-later
//
// Rune + spell catalogue shared by the extension and the Spellbook.
// No GNOME imports here either.

/** Every rune, in the order they appear in the Spellbook. */
export const RUNE_INFO = [
    {id: 'spiral', name: 'Spiral', emoji: '🌀', hint: 'Swirl in or out, about 1½ turns or more'},
    {id: 'lightning', name: 'Lightning', emoji: '⚡', hint: 'A zig-zag, like a Z or a lightning bolt'},
    {id: 'circle', name: 'Circle', emoji: '⭕', hint: 'One loop that ends near where it started'},
    {id: 'v', name: 'V', emoji: '✔️', hint: 'Down, then back up. One sharp point at the bottom'},
    {id: 'caret', name: 'Λ', emoji: '⛰️', hint: 'Up, then back down. One sharp point at the top'},
    {id: 'u', name: 'U', emoji: '🥣', hint: 'A smooth cup shape with no sharp point'},
    {id: 'line', name: 'Line down', emoji: '⬇️', hint: 'One straight stroke from top to bottom'},
    {id: 'triangle', name: 'Triangle', emoji: '🔺', hint: 'Three straight sides, ending where you started'},
];

/** Every action a rune can be bound to. */
export const SPELL_INFO = [
    {id: 'fireball', name: 'Fireball', desc: 'Burn away (close) the window under the rune'},
    {id: 'lightning', name: 'Lightning Strike', desc: 'Launch or focus your chosen app'},
    {id: 'portal', name: 'Portal', desc: 'Pull every window into a portal (show desktop). Cast again to bring them back'},
    {id: 'freeze', name: 'Freeze', desc: 'Frost over and lock the screen'},
    {id: 'summon', name: 'Summon', desc: 'Summon or dismiss your familiar'},
    {id: 'sound', name: 'Sound Control', desc: 'Scroll to change the volume, middle click to mute, click to finish'},
    {id: 'enchant', name: 'Enchant', desc: 'Play or pause music (Quick Lofi first)'},
    {id: 'slumber', name: 'Slumber', desc: 'Lower the curtain and suspend the PC'},
    {id: 'logout', name: 'Farewell', desc: 'Log out (asks first)'},
    {id: 'screenshot', name: 'Snapshot', desc: 'Open the screenshot tool'},
    {id: 'overview', name: 'Scry', desc: 'Open the Activities overview'},
    {id: 'workspace-left', name: 'Step Left', desc: 'Move to the workspace on the left'},
    {id: 'workspace-right', name: 'Step Right', desc: 'Move to the workspace on the right'},
    {id: 'command', name: 'Custom Command', desc: 'Run a command of your choice'},
    {id: 'none', name: 'Nothing', desc: 'This rune does nothing'},
];

export function runeInfo(id) {
    return RUNE_INFO.find(r => r.id === id);
}

export function spellInfo(id) {
    return SPELL_INFO.find(s => s.id === id) ?? SPELL_INFO[SPELL_INFO.length - 1];
}

/**
 * Example path of each rune in a 0..1 box, used to draw the little
 * "how to draw it" pictures. The first point is where you start.
 */
export function runeGuide(id) {
    const pts = [];
    switch (id) {
    case 'spiral':
        for (let i = 0; i <= 120; i++) {
            const t = i / 120;
            const r = 0.46 * (1 - 0.85 * t);
            const a = -Math.PI / 2 + t * Math.PI * 2 * 2;
            pts.push({x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r});
        }
        break;
    case 'lightning':
        pts.push({x: 0.62, y: 0.06}, {x: 0.28, y: 0.5}, {x: 0.72, y: 0.5}, {x: 0.38, y: 0.94});
        break;
    case 'circle':
        for (let i = 0; i <= 80; i++) {
            const a = -Math.PI / 2 + Math.PI * 2 * 0.97 * i / 80;
            pts.push({x: 0.5 + Math.cos(a) * 0.42, y: 0.5 + Math.sin(a) * 0.42});
        }
        break;
    case 'v':
        pts.push({x: 0.12, y: 0.12}, {x: 0.5, y: 0.88}, {x: 0.88, y: 0.12});
        break;
    case 'caret':
        pts.push({x: 0.12, y: 0.88}, {x: 0.5, y: 0.12}, {x: 0.88, y: 0.88});
        break;
    case 'u':
        for (let i = 0; i <= 8; i++)
            pts.push({x: 0.14, y: 0.12 + 0.3 * i / 8});
        for (let i = 0; i <= 40; i++) {
            const a = Math.PI - Math.PI * i / 40;
            pts.push({x: 0.5 + Math.cos(a) * 0.36, y: 0.42 + Math.sin(a) * 0.46});
        }
        for (let i = 0; i <= 8; i++)
            pts.push({x: 0.86, y: 0.42 - 0.3 * i / 8});
        break;
    case 'line':
        pts.push({x: 0.5, y: 0.08}, {x: 0.5, y: 0.92});
        break;
    case 'triangle':
        pts.push({x: 0.5, y: 0.1}, {x: 0.9, y: 0.85}, {x: 0.1, y: 0.85}, {x: 0.47, y: 0.16});
        break;
    }
    return pts;
}

/** Trail colour themes: [main, accent] as [r, g, b] 0..1. */
export const THEMES = {
    arcane: {name: 'Arcane', colors: [[0.70, 0.42, 1.0], [1.0, 0.45, 0.85]]},
    ember: {name: 'Ember', colors: [[1.0, 0.48, 0.10], [1.0, 0.85, 0.25]]},
    frost: {name: 'Frost', colors: [[0.44, 0.83, 1.0], [0.92, 0.98, 1.0]]},
    fey: {name: 'Fey', colors: [[0.36, 1.0, 0.61], [1.0, 0.9, 0.42]]},
    chaos: {name: 'Chaos', colors: null},
};

export function hsv(h, s, v) {
    const f = n => {
        const k = (n + h * 6) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
}

/** Colours for one cast. Chaos picks a new random pair every time. */
export function themeColors(themeId) {
    const theme = THEMES[themeId] ?? THEMES.arcane;
    if (theme.colors)
        return theme.colors;
    const h = Math.random();
    return [hsv(h, 0.75, 1), hsv((h + 0.15) % 1, 0.55, 1)];
}
