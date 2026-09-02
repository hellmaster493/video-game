/* ═══════════════════════════════════════════════════════════
   maps.js — the places you can play.

   Each map is pure data: room rectangles with their own floor,
   clutter, job station and tags. Rooms are joined either by
   hand-placed hall rectangles or by `links`, which carve an
   L-shaped corridor between two room centres.

   Tags the rest of the game looks up:
     spawn  where a worker clocks in
     exit   where the lift out lives
     den    where a monster wakes up
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.MAPS = [
  /* ─────────────────────────────────────────────────────── */
  {
    id: 'factory', name: 'Playtime Factory', icon: '🏭',
    blurb: 'The main plant. Long sight lines, heavy machinery, and a lift on the far side.',
    W: 100, H: 66,
    rooms: [
      { id: 'lobby', name: 'Main Lobby', r: [6, 6, 24, 16], floor: 'checker',
        clutter: 'plant', lockers: 2, tags: ['spawn'] },
      { id: 'giftshop', name: 'Gift Shop', r: [34, 6, 16, 11], floor: 'carpet',
        clutter: 'shelf', lockers: 2, job: ['Restock the shelves', 'Restocking'] },
      { id: 'breakroom', name: 'Break Room', r: [54, 6, 14, 10], floor: 'carpet',
        clutter: 'table', lockers: 1, job: ['Clean the coffee maker', 'Scrubbing'] },
      { id: 'generator', name: 'Generator Bay', r: [74, 6, 18, 14], floor: 'floor',
        clutter: 'crate', lockers: 1, node: true, job: ['Grease the turbines', 'Greasing'] },
      { id: 'assembly', name: 'Assembly Line', r: [6, 26, 28, 16], floor: 'floor',
        clutter: 'crate', lockers: 2, node: true, belts: 3,
        job: ['Sort the conveyor', 'Sorting parts'] },
      { id: 'vault', name: 'Toy Vault', r: [38, 22, 18, 14], floor: 'carpet',
        clutter: 'shelf', lockers: 1, toys: 10, job: ['Log the toy inventory', 'Logging'] },
      { id: 'control', name: 'Control Room', r: [60, 24, 16, 12], floor: 'floor',
        clutter: 'desk', lockers: 1, node: true, job: ['Run the camera check', 'Checking'] },
      { id: 'gamestn', name: 'Game Station', r: [6, 46, 22, 16], floor: 'checker',
        clutter: 'arcade', lockers: 2, node: true, job: ['Reset the arcade', 'Rebooting'] },
      { id: 'warehouse', name: 'Warehouse', r: [36, 42, 22, 18], floor: 'floor',
        clutter: 'crate', lockers: 2, node: true, job: ['Stack the pallets', 'Stacking'],
        tags: ['den'] },
      { id: 'venthub', name: 'Vent Hub', r: [60, 42, 12, 10], floor: 'grate', tags: ['vent'] },
      { id: 'liftbay', name: 'Lift Bay', r: [78, 44, 14, 14], floor: 'floor', tags: ['exit'] }
    ],
    halls: [
      [28, 12, 8, 3], [48, 10, 8, 3], [66, 10, 10, 3], [16, 20, 4, 8],
      [32, 28, 8, 3], [54, 28, 8, 3], [63, 34, 4, 10], [16, 40, 4, 8],
      [26, 50, 11, 3], [56, 46, 6, 3], [70, 46, 10, 3], [81, 18, 4, 13],
      [74, 29, 11, 3], [44, 34, 3, 10]
    ],
    vents: [[44, 16, 44, 23], [64, 15, 64, 25], [56, 54, 79, 54], [26, 21, 26, 27]]
  },

  /* ─────────────────────────────────────────────────────── */
  {
    id: 'playcare', name: 'Playcare', icon: '🎠',
    blurb: 'The orphanage under the plant. Wide open, brightly carpeted, and very little to hide behind.',
    W: 96, H: 72,
    rooms: [
      { id: 'atrium', name: 'The Atrium', r: [28, 24, 28, 22], floor: 'checker',
        clutter: 'plant', lockers: 2, tags: ['spawn'] },
      { id: 'dorms', name: 'Dormitories', r: [6, 6, 22, 14], floor: 'carpet',
        clutter: 'shelf', lockers: 3, node: true, job: ['Strip the bunks', 'Stripping beds'] },
      { id: 'cafeteria', name: 'Cafeteria', r: [34, 6, 20, 12], floor: 'checker',
        clutter: 'table', lockers: 1, job: ['Wipe the long tables', 'Wiping'] },
      { id: 'classroom', name: 'School Room', r: [60, 6, 18, 14], floor: 'carpet',
        clutter: 'desk', lockers: 2, node: true, job: ['Collect the workbooks', 'Collecting'] },
      { id: 'tunnel', name: 'Tunnel Head', r: [80, 8, 12, 14], floor: 'grate', tags: ['vent'] },
      { id: 'ballpit', name: 'Ball Pit', r: [6, 26, 18, 16], floor: 'carpet',
        toys: 26, lockers: 1, job: ['Fish out the lost balls', 'Fishing'] },
      { id: 'infirmary', name: 'Infirmary', r: [62, 26, 18, 14], floor: 'checker',
        clutter: 'desk', lockers: 2, node: true, job: ['Log the medicine cart', 'Logging'] },
      { id: 'laundry', name: 'Laundry', r: [6, 48, 20, 16], floor: 'floor',
        clutter: 'crate', lockers: 3, node: true, job: ['Empty the driers', 'Emptying'] },
      { id: 'playground', name: 'Playground', r: [30, 50, 26, 16], floor: 'grate',
        clutter: 'arcade', lockers: 1, toys: 8, job: ['Reset the swings', 'Resetting'],
        tags: ['den'] },
      { id: 'chapel', name: 'Quiet Room', r: [60, 46, 16, 12], floor: 'carpet',
        clutter: 'plant', lockers: 2, node: true, job: ['Straighten the chairs', 'Straightening'] },
      { id: 'lift', name: 'Service Lift', r: [78, 48, 14, 16], floor: 'floor', tags: ['exit'] }
    ],
    links: [
      ['dorms', 'cafeteria'], ['cafeteria', 'classroom'], ['classroom', 'tunnel'],
      ['dorms', 'ballpit'], ['ballpit', 'atrium'], ['cafeteria', 'atrium'],
      ['classroom', 'infirmary'], ['atrium', 'infirmary'], ['ballpit', 'laundry'],
      ['atrium', 'playground'], ['laundry', 'playground'], ['playground', 'chapel'],
      ['chapel', 'lift'], ['infirmary', 'lift'], ['tunnel', 'infirmary']
    ],
    vents: [[24, 20, 24, 30], [58, 18, 58, 30], [58, 60, 79, 60]]
  },

  /* ─────────────────────────────────────────────────────── */
  {
    id: 'prototype', name: 'The Prototype Wing', icon: '🧪',
    blurb: 'Cells, labs and a lot of ductwork. Tight corners, short sight lines, and everything uses the vents.',
    W: 104, H: 60,
    rooms: [
      { id: 'airlock', name: 'Airlock', r: [6, 6, 14, 10], floor: 'grate',
        lockers: 1, tags: ['spawn'] },
      { id: 'cell1', name: 'Holding A', r: [24, 6, 12, 9], floor: 'floor', lockers: 2 },
      { id: 'cell2', name: 'Holding B', r: [40, 6, 12, 9], floor: 'floor', lockers: 2,
        job: ['Reset the door seals', 'Resealing'] },
      { id: 'cell3', name: 'Holding C', r: [56, 6, 12, 9], floor: 'floor', lockers: 2 },
      { id: 'observation', name: 'Observation', r: [72, 6, 18, 12], floor: 'checker',
        clutter: 'desk', lockers: 1, node: true, job: ['Run the tape back', 'Reviewing'] },
      { id: 'labA', name: 'Wet Lab', r: [6, 20, 16, 12], floor: 'checker',
        clutter: 'desk', lockers: 1, node: true, job: ['Sterilise the trays', 'Sterilising'] },
      { id: 'junction', name: 'Junction', r: [26, 20, 18, 12], floor: 'grate',
        clutter: 'crate', lockers: 1, tags: ['vent'] },
      { id: 'labB', name: 'Assembly Lab', r: [48, 20, 16, 12], floor: 'floor',
        clutter: 'crate', lockers: 1, belts: 2, node: true, job: ['Feed the line', 'Feeding'] },
      { id: 'server', name: 'Server Room', r: [68, 22, 16, 12], floor: 'grate',
        clutter: 'desk', lockers: 1, job: ['Swap the drive array', 'Swapping'] },
      { id: 'incinerator', name: 'Incinerator', r: [88, 20, 12, 14], floor: 'floor',
        clutter: 'crate', node: true, job: ['Rake the ash pit', 'Raking'], tags: ['den'] },
      { id: 'storage', name: 'Cold Storage', r: [6, 38, 18, 14], floor: 'floor',
        clutter: 'shelf', lockers: 3, toys: 12, job: ['Count the crates', 'Counting'] },
      { id: 'morgue', name: 'Disposal', r: [28, 38, 16, 12], floor: 'checker',
        clutter: 'table', lockers: 2, node: true },
      { id: 'chamber', name: 'Test Chamber', r: [48, 38, 22, 16], floor: 'grate',
        clutter: 'arcade', lockers: 1, job: ['Recalibrate the rig', 'Calibrating'] },
      { id: 'exitbay', name: 'Freight Lift', r: [76, 40, 16, 14], floor: 'floor', tags: ['exit'] }
    ],
    links: [
      ['airlock', 'cell1'], ['cell1', 'cell2'], ['cell2', 'cell3'], ['cell3', 'observation'],
      ['airlock', 'labA'], ['labA', 'junction'], ['junction', 'labB'], ['labB', 'server'],
      ['server', 'incinerator'], ['observation', 'incinerator'], ['cell2', 'junction'],
      ['labA', 'storage'], ['storage', 'morgue'], ['morgue', 'chamber'],
      ['chamber', 'exitbay'], ['incinerator', 'exitbay'], ['junction', 'morgue'],
      ['labB', 'chamber']
    ],
    vents: [
      [30, 16, 30, 22], [46, 16, 46, 22], [62, 16, 62, 24], [86, 14, 86, 26],
      [20, 33, 20, 40], [45, 33, 45, 40], [74, 35, 74, 42], [26, 45, 46, 45]
    ]
  },

  /* ─────────────────────────────────────────────────────── */
  {
    id: 'gamestation', name: 'Game Station', icon: '🕹️',
    blurb: 'The arcade wing: one bright hub with the mini-games spoked off it. Nowhere is far from anywhere.',
    W: 94, H: 64,
    rooms: [
      { id: 'hub', name: 'Game Hub', r: [30, 24, 26, 18], floor: 'checker',
        clutter: 'arcade', lockers: 2, tags: ['spawn'] },
      { id: 'prize', name: 'Prize Counter', r: [6, 6, 18, 12], floor: 'carpet',
        clutter: 'shelf', lockers: 2, toys: 14, node: true,
        job: ['Restock the prize wall', 'Restocking'] },
      { id: 'musical', name: 'Musical Memory', r: [30, 6, 18, 12], floor: 'checker',
        clutter: 'arcade', lockers: 1, job: ['Retune the pads', 'Retuning'] },
      { id: 'whack', name: 'Whack-a-Wuggy', r: [54, 6, 16, 12], floor: 'carpet',
        clutter: 'arcade', lockers: 1, node: true, job: ['Reset the mallets', 'Resetting'] },
      { id: 'statues', name: 'Statues', r: [76, 8, 12, 12], floor: 'floor',
        clutter: 'crate', lockers: 1, job: ['Dust the statues', 'Dusting'], tags: ['den'] },
      { id: 'tickets', name: 'Ticket Room', r: [6, 24, 18, 14], floor: 'floor',
        clutter: 'desk', lockers: 2, node: true, job: ['Bag the tickets', 'Bagging'] },
      { id: 'ducts', name: 'Duct Access', r: [62, 26, 14, 12], floor: 'grate', tags: ['vent'] },
      { id: 'bumper', name: 'Bumper Floor', r: [6, 46, 20, 14], floor: 'checker',
        clutter: 'plant', lockers: 1, job: ['Recharge the cars', 'Recharging'] },
      { id: 'claw', name: 'Claw Machines', r: [30, 48, 24, 14], floor: 'carpet',
        clutter: 'arcade', lockers: 2, toys: 12, node: true,
        job: ['Refill the claw drums', 'Refilling'] },
      { id: 'backstage', name: 'Backstage', r: [58, 44, 16, 14], floor: 'floor',
        clutter: 'crate', lockers: 2, node: true, job: ['Coil the cables', 'Coiling'] },
      { id: 'exitgate', name: 'Turnstiles', r: [78, 44, 12, 16], floor: 'floor', tags: ['exit'] }
    ],
    links: [
      ['prize', 'musical'], ['musical', 'whack'], ['whack', 'statues'],
      ['prize', 'tickets'], ['tickets', 'hub'], ['musical', 'hub'], ['whack', 'ducts'],
      ['hub', 'ducts'], ['statues', 'ducts'], ['tickets', 'bumper'], ['hub', 'claw'],
      ['bumper', 'claw'], ['claw', 'backstage'], ['backstage', 'exitgate'],
      ['ducts', 'exitgate']
    ],
    vents: [[27, 20, 27, 26], [52, 20, 52, 26], [28, 43, 28, 50], [56, 40, 56, 47]]
  }
];

PP.getMap = function (id) {
  for (var i = 0; i < PP.MAPS.length; i++) if (PP.MAPS[i].id === id) return PP.MAPS[i];
  return PP.MAPS[0];
};
