# Playtime Factory RP

A first-person 3D roleplay horror game set in an abandoned toy factory. Clock in
as one of five staff roles, work the floor, chat with your coworkers — and try to
be on the lift before the toys notice you.

Runs in any browser with WebGL. No build step, no install, no CDN: three.js is
vendored and every texture, model and sound is generated at runtime, so the whole
thing works offline straight off the filesystem.

```
open index.html
```

## The three shifts

| Mode | What you do |
|---|---|
| **Open Shift** | Free roleplay. The lights are on and nothing hunts you. Work the eight job stations, talk to staff, bank tokens. |
| **Night Shift** | The power is out. Find five power nodes, bring each back online with both GrabPack hands, then reach the Lift Bay. You pick which toy is awake down there. |
| **Monster Shift** | You play the toy. Six workers are repairing the factory — catch all of them before they finish all five nodes. |

## Controls

| | |
|---|---|
| `W A S D` | Walk — the mouse looks around |
| `Shift` | Sprint — fast, loud, drains stamina |
| `E` | Interact: hold for job stations, tap for lockers, the lift, staff |
| `LMB` / `RMB` | Fire the **red** / **blue** GrabPack hand |
| `Q` | Your role's ability |
| `C` | Chat & emote wheel |
| `F` | Torch |
| `V` | First person / third person |
| `Tab` | Full factory map |
| `Esc` | Pause — also releases the mouse |

Click the view to capture the mouse. If a browser refuses pointer lock, the game
falls back to drag-to-look rather than becoming unplayable. Touch controls
(stick + buttons) appear automatically on touch devices.

### The GrabPack

Two hands on retractable cables, one per mouse button, fired down the crosshair
by raycast. A power node has a red socket and a blue socket, and it only charges
while **both** hands are latched onto their matching colour at once — so you are
pinned in place, facing a wall, for the several seconds that takes. That is the
whole tension of Night Shift. The wrong hand bounces off the wrong socket, and
the cable snaps if you walk too far.

## The toys

Six of them, all selectable, and the differences are mechanical rather than
cosmetic — each one changes how you have to play the floor:

| | Hunts by |
|---|---|
| **Huggy Wuggy** | **Wind-Up Sprint.** Locks onto a straight line and accelerates the longer it can see you. Break line of sight or lose. |
| **Boxy Boo** | **Spring Launch.** Slow on the ground, but coils for a beat and then crosses a whole room in one jump at triple speed. |
| **Mommy Long Legs** | **Stretch Grab.** Her reach is four times anyone else's. A corridor is a death sentence; use the vents. |
| **Bunzo Bunny** | **Cymbal Crash.** A crash every few seconds pinpoints you through walls for three seconds, and it hears a sprint two rooms away. |
| **PJ Pug-a-Pillar** | **Never Gives Up.** Corners badly — you can outmanoeuvre it — but once it has your scent it hunts for the rest of the shift. |
| **CatNap** | **Red Smoke.** Silent footsteps, so no audio warning at all, and a trail of gas that slows you and eats your stamina. |

In Night Shift you choose which one is down there with you. In Monster Shift you
play as it, and the ability is bound to your own `Q` — or, for Boxy Boo, to
holding the left mouse button to coil the spring.

## The cast

Five staff roles, each with a passive perk and an active ability on `Q`:

- **Line Worker** — finishes jobs fastest. *Second Wind* refills stamina.
- **Night Guard** — long torch, and monsters show on your minimap. *Torch Flare*
  stuns anything that can see you for three seconds.
- **Mechanic** — longest cable, charges nodes 70% faster. *Override* jumps the
  nearest node 45% forward.
- **Toy Maker** — *Wind-Up Decoy* drops a toy that pulls monsters off your scent
  for nine seconds.
- **Intern** — fastest on foot, worst stamina; monsters lose interest in you
  quickly. *Slip Away* makes you near-invisible for four seconds.

## Getting caught

The first grab of a shift is a close call: you tear free, lose 50 tokens, and the
monster is stunned for a moment. There is no second one.

Lockers hide you completely — a monster cannot see you inside one, but it will
search where it last saw you go.

## The factory

Eleven hand-authored rooms — Lobby, Gift Shop, Break Room, Generator Bay,
Assembly Line, Toy Vault, Control Room, Game Station, Warehouse, Vent Hub and
Lift Bay — joined by corridors and four crawlable vents that cut across the map.
Vents are slow and cramped, but Mommy, Bunzo, PJ and CatNap use them too.

The level is built from a tile grid at load: floors, ceilings and only the wall
faces that actually border open space are merged into one geometry per material,
which keeps the whole factory to a handful of draw calls.

## Monster AI

Each monster runs a small state machine: `patrol → investigate → chase → search`.

- **Sight** is a wide cone with a line-of-sight check, plus a short all-round
  radius so you cannot stand behind one and be safe.
- **Hearing** is a noise budget. Walking is quiet, sprinting is loud, grate and
  conveyor floors are louder still, and shouting into the chat wheel carries.
- **Losing you** doesn't reset it — it heads for where it last saw you, then
  searches outward from there before going back on patrol. How long it stays
  interested is per-monster (PJ's patience is four times Huggy's).

Pathfinding is A\* over the tile grid with a binary heap and an octile heuristic;
a monster prefers a straight line whenever the way is clear and only paths when
it has to. A full corner-to-corner path costs about half a millisecond.

Night Shift escalates as you make progress: a second toy wakes at three nodes
repaired, a third at five, both drawn from the ones you didn't pick.

## Rendering

- **No asset files.** Every surface is drawn into a canvas at boot and turned
  into an albedo map plus a normal map derived by Sobel from a matching height
  pass. Concrete, checker tile, carpet, painted wall, ceiling tile, brushed
  metal, floor grate, duct, wood, plush and cloth.
- **Post-processing** is hand-rolled in `js/post.js`, because EffectComposer is
  an addon and this ships no addons. The scene renders into a linear half-float
  buffer, then: bright pass with a soft knee, two separable gaussian blur levels
  for a tight halo and a wide glow, then one composite that does bloom, an ACES
  filmic curve, a colour grade (cool shadows, warm highlights), vignette, film
  grain and lens dispersion that widens as your character panics.
- **Ambient occlusion is baked into the level's vertex colours** at build time.
  A floor corner darkens for each solid tile touching it and wall faces darken
  at the floor, which is what grounds the walls and reads the room corners —
  free at runtime, and each quad is split along its shorter AO gradient so the
  shading doesn't crease.
- **Wall trim.** Every wall face gets a skirting board and a dado rail as
  shallow ledges proud of the surface, so a wall is never one flat plane.
- **Volumetric light shafts** — a pool of additive cones reassigned to the
  nearest lit fittings. With the power out they are the strongest thing in the
  room.
- **Characters** are built from primitives and rigged as joint hierarchies, so a
  single walk cycle drives everyone. Limbs have real elbows and knees that only
  bend one way; hands have five jointed fingers and feet have toes; the torso is
  a pelvis, ribcage and tapering chest rather than one capsule, with shoulders,
  a neck and a sewn-on belly patch. Anything rigid — a whole hand, a mouth full
  of teeth, a limb segment — is merged into one geometry, so the detail costs
  draw calls it doesn't need to.
- **Fabric.** The toys wear a `MeshPhysicalMaterial` with sheen, which is the
  shading model for velvet and short-pile plush: it lights the fuzz at grazing
  angles the way real fabric does. The texture underneath is a directional fibre
  weave with a stitched seam and its own roughness map.
- **Eyes** are a whole eye painted onto one sphere — sclera, veins, a fibrous
  iris, a limbal ring and a pupil — under a clearcoat, set into fur lids and a
  darker socket rim. Stacked white and black spheres never looked alive.
- Every toy's proportions are fractions of its own height, which is why they all
  frame correctly in the cast screen and scale as one piece.
- **Lighting** is a pool of eleven point lights reassigned each frame to
  whichever ceiling fixtures are nearest, plus a single shadow-casting spotlight
  on the torch. The fittings sit recessed so they light the room rather than the
  ceiling, and with the power out only about a third run on emergency circuits.
  The fittings themselves are two instanced meshes, not sixty groups.
- A small procedural environment map is generated with `PMREMGenerator` so
  metals and rough surfaces resolve instead of rendering black.
- **Three quality presets** (Low / Medium / High) on the menu trade away
  post-processing, shadows, light shafts and pixel ratio, so a weak machine
  still gets a playable frame rate.

## Tokens

Jobs, nodes and escapes pay Playtime Tokens, saved to `localStorage`. Spend them
in the shop on cosmetics — two of which are quietly useful (`Head Lamp` extends
your torch, `Dust Sheet` makes monsters lose your trail sooner).

## Single-file build

```bash
node build.js              # dist/playtime-factory.html — the whole game in one file
node build.js --fragment   # same, without the <html>/<head>/<body> wrapper
```

The bundler substitutes each `<link>` and `<script src>` for the file it points
at — there is nothing to compile. The result is one ~790 KB page (three.js is
most of it) that runs from `file://` with no flags, which is handy for dropping
into a WebView or a `.zip` game host.

## Layout

```
index.html      markup for the menus and HUD
css/style.css   all styling
vendor/         three.js r147 (MIT), vendored so the game works offline
js/core.js      math, input and pointer lock, save data, WebAudio synth
js/roles.js     cast, monsters, modes, emotes, shop items
js/textures.js  procedural albedo + normal maps, environment map
js/models.js    every character and prop, built from primitives
js/post.js      bloom, tone mapping, colour grade, vignette, grain
js/world.js     tiles, rooms, vents, collision, line-of-sight, A*
js/minimap.js   the 2D floor plan overlay
js/entities.js  player, GrabPack, staff NPCs, monster behaviour
js/scene.js     level geometry, lighting, camera, actor animation
js/game.js      modes, objectives, interaction, scoring
js/ui.js        menus, HUD, 3D cast portraits, chat wheel, end card
js/main.js      boot and frame loop
build.js        optional single-file bundler
```

Scripts are plain (non-module) so the page loads over `file://` without a server.

---

A fan-made homage. Not affiliated with, or endorsed by, MOB Games or any other
rights holder. All models, code and art in this repository were made for this
project.
