# Claudie Playtime

A first-person 3D roleplay horror game set in an abandoned toy factory. Clock in
as one of five staff roles, work the floor, chat with your coworkers — and try to
be on the lift before the toys notice you.

Seven toys are down there. One of them is Claudie, and Claudie does not move
while you are looking at it.

Runs in any browser with WebGL. No build step, no install, no CDN: three.js is
vendored and every texture, model and sound is generated at runtime, so the whole
thing works offline straight off the filesystem.

```
open index.html
```

## Everyone with the link plays together

Open the page and you are in a room with everyone else who has it open. Not a
lobby to fill, not a queue to match into: **one factory, and everybody is in
it.** Six of you or sixty — there is no cap, nobody is spilled into a second
copy, and the seventh person to arrive walks into the same shift as the first.

The first person to clock in opens the factory. Everybody after that drops into
it — same map, same seed, same toys walking the same corridors — whatever they
had picked on their own menu. You see each other with name tags overhead and
blue dots on the minimap, hear each other on the chat wheel, and finish the same
five nodes.

Getting caught stops being the end of your night. The toy takes you, the camera
does what it always did — and then you are **on the floor** instead of on the
end card. Anyone can stand over you and hold `E` for two and a half seconds to
pull you up. If nobody reaches you within thirty seconds you crawl back to the
stairwell yourself, shaken and briefly untouchable. The shift ends when someone
rides the lift up, or when every last one of you is down at the same time.

Pick **Monster Shift** and you are the toy in everyone else's night — a
player-driven hunter loose in the same factory as the AI one. Your grab only
lands when you swing it, and the person you swing at is the one who decides it
reached them.

Claudie is worth the trip in company: it freezes while *anyone* is looking at
it, so a friend watching the corridor behind you is genuinely holding it still.

None of this is a separate mode. If the page has no room to join — a local file,
a view that cannot connect — the game is exactly the single-player game it was,
with no error and no dead menu.

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
| `E` (hold) | Pull a downed workmate back up |

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

## The maps

Four floors, picked on the menu, each with a different shape to play:

| | |
|---|---|
| **Playtime Factory** | The main plant. Long sight lines, heavy machinery, and a lift on the far side. |
| **Playcare** | The orphanage under the plant. Wide open, brightly carpeted, and very little to hide behind. |
| **The Prototype Wing** | Cells, labs and a lot of ductwork. Tight corners, short sight lines, and everything uses the vents. |
| **Game Station** | The arcade wing: one bright hub with the mini-games spoked off it. Nowhere is far from anywhere. |

A map is pure data in `js/maps.js` — room rectangles carrying their own floor
material, clutter, job station and tags. Rooms are joined either by hand-placed
hall rectangles or by `links`, which carve an L-shaped corridor between two room
centres, so adding a floor is a dozen lines and no geometry work. Nothing
downstream knows a room by name: the game finds where you spawn, where the lift
is and where a monster wakes up by looking up the `spawn`, `exit` and `den` tags.

The menu draws each map's floorplan straight from that data, with the spawn room
in gold, the exit in green, and the vents dashed.

## The toys

Seven of them, all selectable, and the differences are mechanical rather than
cosmetic — each one changes how you have to play the floor:

| | Hunts by |
|---|---|
| **Huggy Wuggy** | **Wind-Up Sprint.** Locks onto a straight line and accelerates the longer it can see you. Break line of sight or lose. |
| **Boxy Boo** | **Spring Launch.** Slow on the ground, but coils for a beat and then crosses a whole room in one jump at triple speed. |
| **Mommy Long Legs** | **Stretch Grab.** Her reach is four times anyone else's. A corridor is a death sentence; use the vents. |
| **Bunzo Bunny** | **Cymbal Crash.** A crash every few seconds pinpoints you through walls for three seconds, and it hears a sprint two rooms away. |
| **PJ Pug-a-Pillar** | **Never Gives Up.** Corners badly — you can outmanoeuvre it — but once it has your scent it hunts for the rest of the shift. |
| **CatNap** | **Red Smoke.** Silent footsteps, so no audio warning at all, and a trail of gas that slows you and eats your stamina. |
| **Claudie** | **Never While You Watch.** It does not move while it is in your field of view, and it never stops coming when it is not. Silent, faster than you, and it always knows where you are. |

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

Alone, the second grab is the end of the shift. With anyone else in the room it
puts you on the floor instead — see *Everyone with the link plays together*.

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
  buffer with a depth texture, then: **SSAO** (hemisphere sampling with normals
  reconstructed from depth derivatives, blurred at half res), a bright pass with
  a soft knee, two separable gaussian blur levels for a tight halo and a wide
  glow, a composite that applies AO, bloom, an ACES filmic curve, a graded
  S-curve with a crushed black point, cool shadows and warm highlights,
  vignette, film grain and lens dispersion that widens as your character
  panics — and finally **FXAA**, because rendering through a render target
  throws away the MSAA buffer.
- **Set dressing.** Every room gets ceiling pipe runs with collars and hangers,
  a cable tray along one wall, recessed wall grilles, worn floor markings
  (hazard stripes at every hall mouth, oil stains, drains, lane arrows) and wall
  signage. It is all merged into four meshes, and it is the difference between
  a lit box and somewhere people worked.
- **Grime.** Concrete, tile, paint, ceiling, steel and grate all get a pass of
  accumulated dirt, rust and water staining that runs downward on vertical
  surfaces, drag marks and chipped edges — into the albedo, the height map that
  feeds the normals, and the roughness.
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
  single walk cycle drives everyone. Each limb is articulated the way a limb
  actually is: a ball-and-socket at the shoulder or hip, a hinge at the elbow or
  knee that only bends one way, and a wrist or ankle that counter-rotates to
  keep the hand level and the sole flat on the floor. Above that, a spine pivot
  leans into a run and counter-twists against the stride, and a neck pivot lets
  a monster keep its head locked on you while its body runs somewhere else.
  Hands have five jointed fingers, feet have toes, and the torso is a pelvis,
  ribcage and tapering chest with shoulders and a sewn-on belly patch. Anything
  rigid — a whole hand, a mouth full of teeth, a limb segment — is merged into
  one geometry, so the detail costs draw calls it doesn't need to.
- **CatNap walks on four legs**, with forelegs that fold back, hind legs that
  fold forward, and a diagonal gait — front-left swings with back-right.
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
  on the torch, and a second shadow-casting spot that rides the ceiling above
  the player so props and characters are grounded by a real shadow rather than
  a blob. The fittings sit recessed so they light the room rather than the
  ceiling, and with the power out only about a third run on emergency circuits.
  The fittings themselves are two instanced meshes, not sixty groups.
- A small procedural environment map is generated with `PMREMGenerator` so
  metals and rough surfaces resolve instead of rendering black.
- **Three quality presets** (Low / Medium / High) on the menu trade away
  post-processing, SSAO, anti-aliasing, shadows, light shafts and pixel ratio,
  so a weak machine still gets a playable frame rate.

## How the room is wired

`js/net.js` sits on the artifact runtime's `room` capability and touches nothing
else. `await claude.use('room')` resolving `null` is the whole feature switch:
the rest of the game never asks whether it is online.

- **Presence carries people.** Each page publishes its own absolute state — name,
  role or toy, position, facing, velocity and a flag word for hiding / downed /
  sprinting / torch — about thirty times a second. Absolute, never deltas, so a
  dropped update costs nothing and a late joiner is current the moment they
  arrive. Remote players are ordinary actors in the draw list: the same rigs,
  the same walk cycle, plus a name tag drawn into a canvas.
- **One peer is the host.** Whoever opens the factory claims it; if two open one
  at the same instant the lower peer id wins and the other migrates into it
  within a second and a half. The host runs the monster AI and the staff and
  publishes them in its own presence — a compact string of `id,x,y,face,state`
  rows — so every client watches the same toy take the same corner. Everyone
  else's monsters are net-driven puppets that still check, locally and only
  against their own player, whether one has reached them. If the host leaves,
  the next peer standing in the factory picks the simulation up mid-stride.
- **Two topics**, both opened to `interact` so every viewer can send on them:
  `evt` for the moments presence cannot carry (a node finished, a grab landing,
  a revive, the end of the shift) and `say` for the chat wheel.
- **The world is identical everywhere** because prop placement runs off the
  seeded RNG rather than `Math.random`, so the same seed lays the same node in
  the same corner of the same room on every machine. That is what lets a
  finished node travel as one integer.
- **Nothing off the wire is trusted.** Names and chat lines are stripped of
  control and invisible characters, capped, and only ever written as text —
  never as markup. Role and toy ids are matched against our own tables. A grab
  is decided by the person it lands on, and only believed from someone standing
  close enough to have thrown it, so no page can drop another from across the
  map.

Room state is deliberately ephemeral: nothing is written to a database, because
nothing here needs to outlive the people currently standing in the factory.

## Tokens

Jobs, nodes and escapes pay Playtime Tokens, saved to `localStorage`. Spend them
in the shop on cosmetics — two of which are quietly useful (`Head Lamp` extends
your torch, `Dust Sheet` makes monsters lose your trail sooner).

## Single-file build

```bash
node build.js              # dist/claudie-playtime.html — the whole game in one file
node build.js --fragment   # same, without the <html>/<head>/<body> wrapper
```

The bundler substitutes each `<link>` and `<script src>` for the file it points
at — there is nothing to compile. The result is one ~945 KB page (three.js is
most of it) that runs from `file://` with no flags, which is handy for dropping
into a WebView or a `.zip` game host.

## Layout

```
index.html      markup for the menus and HUD
css/style.css   all styling
vendor/         three.js r147 (MIT), vendored so the game works offline
js/core.js      math, input and pointer lock, save data, WebAudio synth
js/net.js       the room: shared world, host election, presence, events
js/roles.js     cast, monsters, modes, emotes, shop items
js/maps.js      the four playable floors, as data
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
