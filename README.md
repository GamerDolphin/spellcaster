# 🪄 Spellcaster

**Draw glowing runes with your mouse to cast spells on your GNOME desktop.**

Press <kbd>Super</kbd> + <kbd>Z</kbd>, draw a rune, and let go. Your trail glows, the rune flares, and the spell goes off.

![A glowing spiral rune drawn over a window](docs/screenshots/rune-trail.png)

## The runes

Every rune is **one quick stroke**. You never lift the mouse, and there are no stars or waves.

| Rune | Draw it | Spell | What happens |
|---|---|---|---|
| 🌀 Spiral | Swirl in or out, about 1½ turns | **Fireball** | The window under the spiral catches fire and closes. Apps with unsaved work still ask "Save?" |
| ⚡ Zig-zag | Like a Z or a lightning bolt | **Lightning Strike** | A bolt cracks down and an app launches (Godot by default) |
| ⭕ Circle | One loop | **Portal** | Every window spirals into a portal. Cast it again and they fly back out |
| ✔️ V | Down, then up | **Freeze** | Frost spreads over the screen, then it locks |
| ⛰️ Λ | Up, then down | **Summon** | Your familiar appears, or goes away if it's already out |
| 🥣 U | A smooth cup | **Sound Control** | Your mouse becomes a volume knob: left click quieter, right click louder, middle click mute, scroll for fine steps, Space when done |
| ⬇️ Line down | One straight stroke | **Slumber** | A curtain falls and the PC **suspends**. Click during the curtain to cancel |

Esc or a right-click cancels casting. A stroke that isn't a rune just **fizzles**.

🛡️ **Freeze and Slumber ask first.** A small popup with **Cancel** / **Freeze** (or **Sleep**) appears, and it cancels itself after 10 seconds if you do nothing, so a mis-drawn rune never locks or sleeps your PC. You can turn this off or change the timer in the Spellbook.

![Sound Control](docs/screenshots/sound.png)

Any rune can be rebound in the Spellbook to: Enchant (aurora + play/pause music), Snapshot (screenshot), Scry (overview), Step Left/Right (workspaces), a custom command, or nothing.

| | |
|---|---|
| ![Fireball burning a window away](docs/screenshots/fireball.png) | ![Portal](docs/screenshots/portal.png) |
| ![Lightning Strike](docs/screenshots/lightning.png) | ![Freeze](docs/screenshots/freeze.png) |
| ![Slumber: night falls](docs/screenshots/slumber.png) | ![Enchant: aurora](docs/screenshots/enchant.png) |

## Effects

The big effects are **real-time GPU shaders**: the window literally burns away from where the fireball hit, night falls with twinkling stars and a rising moon, ice crystals creep in from the edges, lightning crackles and branches, and aurora ribbons sweep across the sky. The casting trail (a glowing ribbon with energy pulses racing to your wand tip) and the magic circle (draws itself in, spins, then dissolves into motes) are shaders too.

They use GNOME 50's `Shell.GLSLEffect`. GNOME 51 removes that, so Spellcaster automatically switches to its replacement (`Clutter.ShaderEffect`) there. That path is written but can't be tested until GNOME 51 ships, which is why `metadata.json` only lists GNOME 50 for now.

The smaller particles use a hand-built texture set: glowing orbs, twinkling stars, flame licks, smoke, snowflakes, a magic sigil, a swirling vortex, a fireball and creeping frost. It's all **generated in code** by `tools/make-textures.js`, so there are no downloads or licences, and you can tweak the generator and run `make textures`.

![The texture set](docs/screenshots/textures.png)

## Familiars

![Wisp, owl and tiny dragon](docs/screenshots/familiars.png)

A familiar keeps you company, and each one has a job:

| Familiar | Job |
|---|---|
| ✨ **Spirit** (default) | **RAM Watcher**: a flickering flame creature that glows blue → purple → orange as your memory fills up, and warns you if it stays nearly full (can follow CPU instead) |
| 🦉 **Owl** | **Messenger**: announces new notifications in a speech bubble and hoots the hour |
| 🐉 **Tiny Dragon** | **Battery Guardian**: breathes fire and warns you at 20 %, 10 % and 5 %, cheers when you plug in, and breathes fire along with your Fireball |
| 💫 **Wisp** | A simple glowing companion |

![The Spirit](docs/screenshots/spirit.png) ![The Owl delivering a message](docs/screenshots/owl.png) ![The Dragon warning about the battery](docs/screenshots/dragon.png)

They're built to never get in the way:

- your clicks pass straight through them
- they keep their distance, and fade almost to nothing when your cursor gets close
- they **hide while a game or video is fullscreen**
- they never make a sound
- after **30 seconds without mouse movement** they float up under the top bar and sleep (*z z z*); move the mouse and they wake up
- they watch you cast, celebrate when a spell works, and go "oops" when one fizzles

You can set it to *Follow* (lazily trails the cursor), *Perch* (sits in a corner) or *Wander* (drifts around the screen edges).

## The Spellbook

Open it from the Extensions app, or run `gnome-extensions prefs spellcaster@gamerdolphin.github.io`.

![The Spellbook](docs/screenshots/spellbook.png)

- **Spells:** choose the spell for each rune, the app Lightning launches, what Enchant plays, and how long the Slumber curtain takes
- **Practice Room:** draw runes and see what Spellcaster thinks they are, with nothing cast. It also has a "How picky" slider
- **Casting:** the shortcut, trail colour (Arcane, Ember, Frost, Fey, Chaos), thickness, and *Reduce effects*
- **Familiar:** a live preview, creature, behaviour, size, opacity and the calm settings

## Install

Requires **GNOME Shell 50**.

```bash
git clone https://github.com/GamerDolphin/spellcaster.git
cd spellcaster
make install
```

Then **log out and back in** (on Wayland, GNOME only loads new extensions at login) and run:

```bash
gnome-extensions enable spellcaster@gamerdolphin.github.io
```

If you're working on the code, use `make dev-install` instead. It links the folder, so your edits apply after the next login.

## Development

```
spellcaster@gamerdolphin.github.io/
├── extension.js        wires everything together
├── prefs.js            the Spellbook
├── lib/
│   ├── recognizer.js   stroke → rune (pure JS, no GNOME imports)
│   ├── castOverlay.js  cast mode: input grab + glowing trail
│   ├── fx.js           particles, flashes, labels
│   ├── familiar.js     familiar behaviour
│   ├── familiarArt.js  familiar drawings (Cairo, shared with the Spellbook)
│   └── …
└── spells/             one file per spell
```

| Command | What it does |
|---|---|
| `make check` | Syntax check plus the rune recognizer tests (2,800 sloppy fake strokes; each rune must be ≥95% accurate) |
| `make test-shell` | Starts an **invisible, throwaway GNOME Shell**, draws every rune with a virtual mouse, checks the results and saves screenshots to `test-output/`. It never touches your real desktop or settings, and suspend/lock are faked |
| `make textures` | Regenerates the effect textures in `assets/` |
| `make pack` | Builds the zip for extensions.gnome.org |

Logs: `journalctl -f -o cat /usr/bin/gnome-shell`

The original design plan is in [docs/PLAN.md](docs/PLAN.md).

## License

GPL-2.0-or-later, like GNOME Shell itself.
