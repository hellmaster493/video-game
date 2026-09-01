# Playtime Factory RP

A top-down roleplay horror game set in an abandoned toy factory. Clock in as one
of five staff roles, work the floor, chat with your coworkers — and try to be on
the lift before the toys notice you.

Runs in any modern browser. No build step, no dependencies, no asset files: every
sprite, light and sound is generated at runtime.

```
open index.html
```

That's it. It works straight off the filesystem (`file://`), so it also drops
into a WebView or a `.zip`-based game host unchanged.

## The three shifts

| Mode | What you do |
|---|---|
| **Open Shift** | Free roleplay. The lights are on and nothing hunts you. Work the eight job stations, talk to staff, bank tokens. |
| **Night Shift** | The power is out. Find five power nodes, bring each back online with both GrabPack hands, then reach the Lift Bay. Something is down here with you. |
| **Monster Shift** | You play the toy. Six workers are repairing the factory — catch all of them before they finish all five nodes. |

## Controls

| | |
|---|---|
| `W A S D` / arrows | Move |
| `Shift` | Sprint — fast, loud, drains stamina |
| `E` | Interact: hold for job stations, tap for lockers, doors, staff |
| `LMB` / `RMB` | Fire the **red** / **blue** GrabPack hand |
| `Q` | Your role's ability |
| `C` | Chat & emote wheel |
| `F` | Torch |
| `Tab` | Full factory map |
| `Esc` | Pause |

Touch controls (stick + buttons) appear automatically on touch devices.

### The GrabPack

Two hands on retractable wires, one per mouse button. A power node has a red
socket and a blue socket, and it only charges while **both** hands are latched
onto their matching colour at once — so you are pinned in place, facing away from
the room, for the several seconds it takes. That is the whole tension of Night
Shift. Hands also drag loose toys around, and the wire snaps if you walk too far.

## The cast

Five staff roles, each with a passive perk and an active ability on `Q`:

- **Line Worker** — finishes jobs fastest. *Second Wind* refills stamina.
- **Night Guard** — long torch, and monsters show on your minimap. *Torch Flare*
  stuns anything that can see you for three seconds.
- **Mechanic** — longest wire, charges nodes 70% faster. *Override* jumps the
  nearest node 45% forward.
- **Toy Maker** — *Wind-Up Decoy* drops a toy that pulls monsters off your scent
  for nine seconds.
- **Intern** — fastest on foot, worst stamina; monsters lose interest in you
  quickly. *Slip Away* makes you near-invisible for four seconds.

Three monsters, unlocked by banking tokens, playable in Monster Shift:
**Snugglepaw** (long arms, fast), **Mama Longlimb** (slow, enormous reach, uses
vents) and **Jangle Bunny** (hears a sprint from two rooms away).

## Getting caught

The first grab of a shift is a close call: you tear free, lose 50 tokens, and the
monster is stunned for a moment. There is no second one.

Lockers hide you completely — a monster cannot see you inside one, but it will
search where it last saw you go.

## The factory

Eleven hand-authored rooms — Lobby, Gift Shop, Break Room, Generator Bay,
Assembly Line, Toy Vault, Control Room, Game Station, Warehouse, Vent Hub and
Lift Bay — joined by corridors and four crawlable vents that cut across the map.
Vents are slow and cramped, but Mama Longlimb and Jangle Bunny use them too.

## Monster AI

Each monster runs a small state machine: `patrol → investigate → chase → search`.

- **Sight** is a wide cone with a line-of-sight check, plus a short all-round
  radius so you cannot stand behind one and be safe.
- **Hearing** is a noise budget. Walking is quiet, sprinting is loud, grate and
  conveyor floors are louder still, and shouting into the chat wheel carries.
- **Losing you** doesn't reset it — it heads for where it last saw you, then
  searches outward from there before going back on patrol.

Pathfinding is A\* over the tile grid with a binary heap and an octile heuristic;
a monster prefers a straight line whenever the way is clear, and only paths when
it has to.

Night Shift escalates as you make progress: a second monster wakes at three nodes
repaired, a third at five.

## Tokens

Jobs, nodes and escapes pay Playtime Tokens, saved to `localStorage`. Spend them
in the shop on cosmetics — two of which are quietly useful (`Head Lamp` extends
your torch, `Dust Sheet` makes monsters lose your trail sooner) — or bank them to
unlock the other two monsters.

## Single-file build

```bash
node build.js              # dist/playtime-factory.html — the whole game in one file
node build.js --fragment   # same, without the <html>/<head>/<body> wrapper
```

The bundler just substitutes each `<link>` and `<script src>` for the file it
points at — there is nothing to compile. Handy for dropping the game into a
WebView, a `.zip` game host, or anywhere a single page is easier than nine.

## Layout

```
index.html      markup for the menus and HUD
css/style.css   all styling
js/core.js      math, input, save data, WebAudio synth
js/roles.js     cast, modes, emotes, shop items
js/world.js     tiles, rooms, vents, collision, line-of-sight, A*
js/entities.js  player, GrabPack hands, staff NPCs, monster AI
js/render.js    tile art, characters, lighting, minimap
js/game.js      modes, objectives, interaction, scoring
js/ui.js        menus, HUD, chat wheel, shop, end card
js/main.js      boot and frame loop
build.js        optional single-file bundler
```

Scripts are plain (non-module) so the page loads over `file://` without a server.

---

An original fan-made homage to the toy-factory horror genre. All characters,
names and art here were written for this project; it is not affiliated with or
endorsed by any existing franchise.
