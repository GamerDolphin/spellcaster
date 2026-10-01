# 🪄 Spellcaster: the plan

> This is the original design plan. Version 1.0 builds nearly all of it; checked boxes are done.
> See the README for how to install and use it.

> Draw glowing runes with your mouse, and your desktop does magic.
> It's like Fly-Pie, but instead of picking from a menu you **cast spells**.

**Target system:** Bazzite 44 (Fedora Silverblue base), **GNOME Shell 50**, **Wayland**

---

## 1. The Big Idea

1. Press the **cast shortcut** (default: `Super` + `Z`, changeable in the Spellbook).
2. The screen dims a little and your cursor turns into a **glowing wand tip**.
3. Draw a rune. A trail of magic light and sparks follows the cursor.
4. Let go. The rune **flares up**, gets recognized, and the spell goes off with its own effect.
5. If the rune isn't recognized, the spell **fizzles** in a small puff of purple smoke and nothing happens.
6. `Esc` or a right-click cancels at any time.

Casting only works while cast mode is on, so normal mouse use can never set off a spell by accident.

---

## 2. The Runes (all quick to draw)

Every rune is **one stroke** with no lifting. Nothing is fiddly: no stars, no waves.

| Rune | How to draw it | Spell | What happens |
|---|---|---|---|
| 🌀 **Spiral** | Swirl inward or outward (1.5+ turns) | **Fireball** | The window under the spiral bursts into embers and **closes** |
| ⚡ **Lightning** | Zig-zag, like a Z or a longer bolt | **Lightning Strike** | A bolt cracks down, the screen flashes, and **an app launches** (default: Godot) |
| ⭕ **Circle** | One loop that ends near where it started | **Portal** | A swirling portal opens and all windows **get sucked in** (show desktop). Cast it again and they come back out. |
| ✔️ **V** | Down then up, one sharp point at the bottom | **Freeze** | Frost spreads from the corners and the screen **locks** |
| ⛰️ **Λ (upside-down V)** | Up then down, one sharp point at the top | **Summon** | Your **familiar** appears in a puff of light, or gets dismissed if it's already out |
| 🥣 **U** | A smooth cup shape, no sharp point | **Enchant** | Sparkles drift down and **lofi music starts** (or pauses) |
| ⬇️ **Straight line down** | One firm stroke top to bottom | **Slumber** | A sleepy "magic fades out" animation plays, then the PC **suspends** (goes to sleep) |

**Why these are easy to tell apart:**
- **Spiral vs Circle:** a spiral turns *more* than one full loop and doesn't close. A circle is about one loop and closes.
- **V vs Λ vs U:** V has a sharp point at the *bottom*, Λ has one at the *top*, and U has *no* sharp point.
- **Lightning:** the only rune with 2 or more sharp zig-zag corners.
- **Line:** the only rune that's nearly straight.

All of these can be changed in the Spellbook (§7). You can swap which rune does which spell.

---

## 3. How It Works (Architecture)

```
spellcaster@local/
├── metadata.json            # name, uuid, shell-version: ["50"]
├── extension.js             # enable()/disable(), wires everything together
├── prefs.js                 # the Spellbook (settings window, libadwaita)
├── stylesheet.css           # wand cursor, familiar glow, UI bits
├── schemas/
│   └── org.gnome.shell.extensions.spellcaster.gschema.xml
├── lib/
│   ├── castOverlay.js       # full-screen input grab + trail drawing
│   ├── recognizer.js        # turns a stroke into a rune name (pure JS, testable)
│   ├── particles.js         # tiny sparks/embers/frost/sparkle engine
│   ├── windowUtils.js       # "which window is under this point?"
│   ├── systemWatch.js       # CPU load, idle, fullscreen detection
│   └── familiar.js          # the familiar creature
├── spells/
│   ├── fireball.js
│   ├── lightning.js
│   ├── portal.js
│   ├── freeze.js
│   ├── summon.js
│   ├── enchant.js
│   └── slumber.js
└── assets/
    (no image files: all three familiars are drawn in code with Cairo, see lib/familiarArt.js)
```

It uses modern **ES modules** (`import ... from 'resource:///org/gnome/shell/...'`), as GNOME 45+ requires.

### 3.1 Cast Overlay (`castOverlay.js`)
- Registers the shortcut with `Main.wm.addKeybinding(...)`.
- When cast mode starts, it puts a full-screen, see-through `St.Widget` on `Main.layoutManager.uiGroup` and calls `Main.pushModal()` so the overlay gets **all** mouse input. On Wayland only the shell can do this, which is why this has to be an extension and not a normal app.
- It records points on `motion-event` between `button-press` and `button-release`.
- It draws the trail on an `St.DrawingArea` with Cairo: a thick soft stroke underneath for the glow and a thin bright core on top. The tail fades out over about 0.5 s.
- It sprinkles a few sparks along the path (count is capped so it stays smooth).
- A safety timeout closes cast mode after 10 s of no drawing.

### 3.2 Recognizer (`recognizer.js`)
This is a **simple, tweakable shape classifier** rather than a machine-learning model, so it's fast, predictable and easy to adjust.

Steps:
1. **Clean up:** resample the stroke to 64 evenly spaced points and smooth out the jitter.
2. **Measure features:**
   - *Straightness* = distance from start to end ÷ path length
   - *Closedness* = gap between start and end ÷ size of the bounding box
   - *Total turning* = how many degrees the path rotates in total (a circle ≈ 360°, a spiral > 500°)
   - *Sharp corners* = points where the direction changes by more than about 100°
   - *Corner position* = whether the sharp corner is at the top or the bottom
   - *Main direction* = which way the stroke goes overall (for the line-down rune)
3. **Rules** (checked in order, each giving a confidence score):
   - Straightness > 0.9 and heading down → **Line**
   - 2+ alternating sharp corners → **Lightning**
   - Turning > 500° and not closed → **Spiral**
   - Turning 280–440° and closed → **Circle**
   - 1 sharp corner at the bottom → **V**
   - 1 sharp corner at the top → **Λ**
   - 0 sharp corners, about 180° of turning, opening upward → **U**
4. If the best score is under the **tolerance** setting, the spell fizzles.

It has no GNOME imports, so it can be **tested outside the shell** with `gjs` and saved test strokes.

### 3.3 Particles (`particles.js`)
- A small pool of reusable `St.Widget` dots animated with `actor.ease()` for movement, fading and shrinking.
- Presets: `sparks`, `embers`, `frost`, `sparkles`, `smoke`, `lightningFlash`.
- A hard cap on particles on screen (for example 150) so it can't lag.
- A **"reduce effects"** setting cuts particles to a minimum.

---

## 4. Trail Themes
You pick the color of your magic in the Spellbook:
- 💜 **Arcane** (purple and pink, the default)
- 🔥 **Ember** (orange and gold)
- ❄️ **Frost** (ice blue and white)
- 🌿 **Fey** (green and gold)
- 🌈 **Chaos** (a new random color every cast)

---

## 5. The Spells (details)

### 5.1 🌀 Fireball: close a window
- It finds the window under the **center of the spiral** (the topmost window at that point).
- The window glows orange (`Clutter.ColorizeEffect`), shakes a little, and then **bursts into embers** while it shrinks and fades.
- Then it calls `metaWindow.delete()`. That's a *polite* close, so apps with unsaved work still ask "Save changes?". Nothing gets force-killed.
- If there's no window there (just desktop), the fireball flies off the edge of the screen for fun.

### 5.2 ⚡ Lightning Strike: launch an app
- A jagged bolt, generated fresh each time so it never looks the same, strikes from the top of the screen down to where your rune ended, with a quick white screen flash.
- It launches the chosen app with `Shell.AppSystem.get_default().lookup_app(id).activate()`.
- The default is **Godot**, and you can pick any app in the Spellbook.
- If that app is already open, it brings it to the front instead.

### 5.3 ⭕ Portal: show the desktop
- A swirling purple ring opens where you drew the circle.
- Every window on the current workspace **spirals into the portal** (it shrinks, spins a bit and moves toward the center) and gets minimized.
- **Cast the circle again** and the portal spits them all back out where they were.

### 5.4 ✔️ Freeze: lock the screen
- Frost crystals grow in from the corners of the screen and a cold blue tint spreads over everything.
- Then it calls `Main.screenShield.lock(true)` and your Live Lockscreen takes over.

### 5.5 ⛰️ Summon: familiar on or off
- A burst of light and the familiar appears (details in §6).
- Casting it again sends the familiar away with a little wave and a *poof*.

### 5.6 🥣 Enchant: lofi music
- Soft sparkles float down from the top of the screen.
- It **toggles music play/pause** over MPRIS (the standard Linux media-control system).
- **To check during the build:** whether the Quick Lofi extension shows up as an MPRIS player. If it does, this just works. If it doesn't, Enchant can run a custom command or open a lofi stream URL instead (you can set this in the Spellbook).

### 5.7 ⬇️ Slumber: suspend the PC
- The screen slowly **darkens from the top down like a curtain**, while glowing dust drifts upward and fades. If the familiar is out, it curls up and falls asleep too.
- Then the PC **suspends** using GNOME's own suspend action (`SystemActions.getDefault().activateSuspend()` from `resource:///org/gnome/shell/misc/systemActions.js`).
- Suspend doesn't close anything, so all your apps and unsaved work are right where you left them when you wake the PC.
- The curtain takes about 1.5 s, and clicking anywhere or pressing `Esc` during it cancels the spell.
- When you wake the PC up, a little "wake up" sparkle plays (optional).

---

## 6. The Familiar 🦉🐉✨

A small magical creature that lives on your desktop. **Rule #1: it must never be annoying.**

### 6.1 Types
- ✨ **Wisp** (built first): a glowing orb with a soft trailing tail, drawn entirely in code, so no art is needed.
- 🐉 **Tiny Dragon**: drawn in code, flaps its wings faster when it moves.
- 🦉 **Owl**: drawn in code, blinks and follows your cursor with big glowing eyes.

Sprites can be made in Pinta (which you already have) or rendered from Blender.

### 6.2 "Not annoying" rules (built in from the start)
- **You can click through it.** It never blocks the mouse (`reactive: false`).
- **It keeps its distance.** It follows the cursor lazily and stays about 120 px away, never sitting on top of what you're pointing at.
- **It gets shy.** If your cursor comes close, it fades out and drifts away.
- **It vanishes in fullscreen.** While a game or fullscreen video is running (Steam games!), the familiar hides completely and comes back afterward.
- **It's silent.** No sounds at all.
- **It's slow and calm.** Smooth floating, no zipping around or flashing.
- **It naps.** After a few minutes idle it drifts to the top bar, perches there and falls asleep (floating "z z z").
- **Behavior modes** (Spellbook):
  - *Follow*: lazily trails the cursor at a distance
  - *Perch*: sits quietly in a screen corner or on the top bar and only looks at the cursor
  - *Wander*: floats slowly around the edges of the screen
- Size and opacity sliders.

### 6.3 Reacting to your system (extra)
- **CPU load:** its glow shifts from calm **blue** (idle) to **purple** (busy) to a bright **orange pulse** (maxed out, for example while Blender renders or Godot exports). CPU is read from `/proc/stat` every 2 s.
- **Idle:** falls asleep (see above) using `Meta.IdleMonitor`.
- **Casting:** when you draw a rune, the familiar turns to watch, and it does a small happy spin when a spell succeeds.
- **Fizzle:** if a spell fizzles, it does a tiny puff-of-smoke "oops."

### 6.4 Performance
- It updates about 30 times a second only while it's moving. When it's asleep or hidden, updates stop completely.

---

## 7. The Spellbook 📖 (settings window)

A good-looking libadwaita settings window (`prefs.js`) with these pages:

### Page: Spells
- A list of all 7 runes, each with a **little drawing of the rune** so you remember how it goes.
- A dropdown for each rune to choose its action:
  - Fireball (close window), Lightning (launch app), Portal (show desktop), Freeze (lock), Summon familiar, Enchant (music), Slumber (suspend)
  - **Extras:** take a screenshot, switch workspace left or right, open the Overview, run a custom command
- An app picker for Lightning.
- Enchant options (MPRIS, custom command, or URL).

### Page: Practice Room 🎯
- A drawing area **inside the settings window**. Draw a rune and it shows which rune it saw and how confident it was, without casting anything.
- A **tolerance slider** ("Strict" to "Forgiving") if runes get missed or mixed up.

### Page: Casting
- The cast shortcut (key combination).
- ~~Optional mouse-button trigger~~: dropped. On Wayland, Super + mouse buttons already move and resize windows, and side buttons go straight to apps, so a keyboard shortcut is the reliable trigger.
- Trail theme (§4).
- Trail thickness.
- "Reduce effects" switch.

### Page: Familiar
- Type (Wisp, Dragon, Owl), mode (Follow, Perch, Wander), size, opacity.
- Switches: "Hide in fullscreen" (on by default), "React to CPU", "Nap when idle".

### Page: Slumber
- Curtain length (how long you have to cancel).
- "Wake-up sparkle" switch.

All settings live in the GSettings schema and apply immediately without logging out.

---

## 8. Build Plan (phases)

### Phase 1: First spark ✨
- [x] Extension skeleton: `metadata.json`, `extension.js`, schema, and a clean `enable()`/`disable()`
- [x] Cast shortcut starts cast mode (`pushModal`)
- [x] Glowing trail and sparks follow the mouse
- [x] Letting go always **fizzles** (no recognizer yet)
- [x] `Esc` and right-click cancel
- ✅ **Goal:** drawing magic on the screen looks and feels good

### Phase 2: Reading runes 🔮
- [x] `recognizer.js` with all 7 runes
- [x] A test script in `gjs` with recorded sample strokes (several of each rune, drawn sloppily on purpose)
- [x] Tune it until each rune is recognized 95%+ of the time and they don't get mixed up
- [x] Show a "✓ Spiral" style label on the screen when a rune is recognized (for testing)

### Phase 3: Big three spells 🔥⚡⭕
- [x] Particle engine (`lib/fx.js`)
- [x] Fireball, Lightning and Portal with full effects

### Phase 4: The rest of the spells ❄️🥣⬇️
- [x] Freeze (lock)
- [x] Enchant (check whether Quick Lofi uses MPRIS, and pick the fallback if not)
- [x] Slumber (suspend) with the cancelable curtain

### Phase 5: The familiar ✨🦉
- [x] The wisp with all the "not annoying" rules
- [x] Follow, Perch and Wander modes
- [x] Hide in fullscreen, idle naps, CPU glow
- [x] Summon rune toggles it

### Phase 6: The Spellbook 📖
- [x] All the settings pages
- [x] Rune pictures
- [x] Practice Room

### Phase 7: Polish 💎
- [x] Dragon and owl sprites
- [x] Trail themes
- [ ] Performance pass on real hardware (particles are capped at 220, and *Reduce effects* cuts them to a quarter)
- [x] Double-check that `disable()` removes *everything* (no leftover actors, timers or keybindings)
- [ ] Optional: package it (`make pack`) and submit to extensions.gnome.org

---

## 9. Developing on Bazzite / GNOME 50 / Wayland

- **Install location for development:** `~/.local/share/gnome-shell/extensions/spellcaster@local/`
- **Compile settings:** `glib-compile-schemas schemas/`
- **Testing without logging out:** on Wayland you can't restart GNOME Shell with Alt+F2 → `r`. Instead, run a **nested test shell in a window**:
  `dbus-run-session gnome-shell --devkit` (GNOME 49+; needs the mutter devkit tool installed, which on Bazzite may mean a toolbox or layering it). The fallback is to log out and back in.
- **Logs:** `journalctl -f -o cat /usr/bin/gnome-shell`
- **Settings window:** `gnome-extensions prefs spellcaster@local`
- **Recognizer tests:** `gjs -m tests/recognizer.test.js` (runs outside the shell)

---

## 10. Safety & Good Manners
- A spell only happens after a **deliberate** cast (shortcut, draw, release).
- **Fireball** closes politely, so unsaved work still gets a "Save?" prompt.
- **Slumber** only suspends, so nothing gets closed or lost, and you can cancel it during the curtain.
- The extension grabs no input when it's not casting, and cast mode closes itself after 10 s.
- Turning the extension off cleans up everything it added.

---

## 11. Decisions I Made (tell me if you want any changed)
- **Summon = Λ, Enchant = U, Slumber = line down.** These replace the star and wave with easy shapes.
- **"Turn off" rune = suspend the PC** (Slumber), not a full shutdown.
- **Default shortcut:** `Super` + `Z` to start casting (Super + Alt alone can't be a GNOME shortcut), then draw with the left mouse button. Touchscreens work too.
- **Lightning opens Godot** by default.
- **No mana.** Cast as much as you like.
- **All three familiars shipped in 1.0**, drawn in code, so no sprite art was needed.
