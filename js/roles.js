/* ═══════════════════════════════════════════════════════════
   roles.js — the cast, the modes, emotes and cosmetics.

   Speeds are in world units per second. 32 units = one tile = 2 m,
   so 55 u/s is a brisk jog and 95 u/s is a sprint.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* Human staff you can clock in as. `look` drives the character model builder. */
PP.ROLES = [
  {
    id: 'worker', name: 'Line Worker', perk: 'Fast hands',
    blurb: 'Bread and butter of the floor. Finishes tasks quicker than anyone.',
    speed: 56, stamina: 5.5, taskRate: 1.55, light: 1.0, grabLen: 300, height: 1.0,
    look: { body: '#3f6fbf', trim: '#d8e3f5', skin: '#e5b48c', hair: '#3a2a1c',
            hat: 'cap', hatCol: '#e6404f', trousers: '#232b3a' }
  },
  {
    id: 'guard', name: 'Night Guard', perk: 'Long torch',
    blurb: 'Walks the halls after dark. Their torch reaches far and it never dies.',
    speed: 53, stamina: 6.5, taskRate: 0.85, light: 1.8, grabLen: 270, height: 1.05,
    look: { body: '#2c3444', trim: '#ffc94d', skin: '#8d5f42', hair: '#141414',
            hat: 'cap', hatCol: '#20252f', trousers: '#1c212b' }
  },
  {
    id: 'mechanic', name: 'Mechanic', perk: 'Rewires nodes',
    blurb: 'Keeps the machines breathing. Charges a power node far faster than anyone.',
    speed: 51, stamina: 5.0, taskRate: 1.2, light: 1.1, grabLen: 380, height: 1.02,
    look: { body: '#c9762c', trim: '#3a3128', skin: '#f0cfae', hair: '#6b4a22',
            hat: 'helmet', hatCol: '#ffc94d', trousers: '#7a4a1c' }
  },
  {
    id: 'toymaker', name: 'Toy Maker', perk: 'Decoy toys',
    blurb: 'Builds the smiles. Drops a wind-up toy that pulls a monster off your scent.',
    speed: 54, stamina: 5.0, taskRate: 1.3, light: 0.95, grabLen: 320, height: 0.97,
    look: { body: '#7d4bb5', trim: '#ffd9f2', skin: '#c98d63', hair: '#2b1a35',
            hat: 'none', hatCol: '#fff', trousers: '#3d2a52' }
  },
  {
    id: 'intern', name: 'Intern', perk: 'Nobody notices',
    blurb: 'First day, worst day. Monsters lose interest in you noticeably faster.',
    speed: 60, stamina: 4.2, taskRate: 0.95, light: 0.8, grabLen: 250, height: 0.94,
    look: { body: '#4c9e78', trim: '#e9f5ef', skin: '#f3d3b5', hair: '#8a5a2b',
            hat: 'none', hatCol: '#fff', trousers: '#2a3b33' }
  }
];

/* ═══════════════ The toys ═══════════════
   Six of them, and the differences are mechanical, not cosmetic.
   `special` names the behaviour that entities.js and game.js switch on;
   `build` names the model builder in models.js.                        */
PP.MONSTERS = [
  {
    id: 'huggy', name: 'Huggy Wuggy', unlockAt: 0, build: 'huggy',
    blurb: 'Ten feet of blue plush. Once it has a straight line on you it winds up and does not stop.',
    special: 'sprint', specialName: 'Wind-Up Sprint',
    specialText: 'Locks onto a straight line and accelerates the longer it can see you.',
    speed: 62, sense: 340, hearing: 400, vent: false, reach: 46, patience: 1.0, silent: false,
    look: { fur: '#2f6fd0', belly: '#a8d0ff', eye: '#fff9c4', lip: '#e8443f',
            h: 3.0, leg: 0.34, torso: 0.32, tr: 0.135, head: 0.195, arm: 0.60,
            limbR: 0.030, teeth: 'wide' }
  },
  {
    id: 'boxy', name: 'Boxy Boo', unlockAt: 0, build: 'boxy',
    blurb: 'A jack-in-the-box on a steel spring. It coils up, then crosses the whole room in one jump.',
    special: 'spring', specialName: 'Spring Launch',
    specialText: 'Coils for a moment, then rockets in a straight line at triple speed.',
    speed: 40, sense: 300, hearing: 420, vent: false, reach: 52, patience: 1.2, silent: false,
    look: { fur: '#c0392b', belly: '#f2e3c9', eye: '#ffffff', lip: '#7a1f16',
            h: 2.4, teeth: 'jagged', box: true }
  },
  {
    id: 'mommy', name: 'Mommy Long Legs', unlockAt: 0, build: 'mommy',
    blurb: 'Rubber-jointed doll. Slow on her feet, but her arm reaches down the whole corridor.',
    special: 'stretch', specialName: 'Stretch Grab',
    specialText: 'Her reach is four times anyone else\'s. Corridors are death.',
    speed: 46, sense: 300, hearing: 520, vent: true, reach: 190, patience: 1.5, silent: false,
    look: { fur: '#e35aa8', belly: '#ffd0ea', eye: '#7cf3ff', lip: '#a3286d',
            h: 3.1, leg: 0.44, torso: 0.24, tr: 0.105, head: 0.135, arm: 0.56,
            limbR: 0.020, teeth: 'none' }
  },
  {
    id: 'bunzo', name: 'Bunzo Bunny', unlockAt: 0, build: 'bunzo',
    blurb: 'Crashes its cymbals when it loses the trail. The noise tells it exactly where you flinched.',
    special: 'cymbals', specialName: 'Cymbal Crash',
    specialText: 'A crash every few seconds pinpoints you through walls for three seconds.',
    speed: 58, sense: 250, hearing: 700, vent: true, reach: 42, patience: 0.8, silent: false,
    look: { fur: '#f0c23a', belly: '#fff2c2', eye: '#ff4f4f', lip: '#8a6410',
            h: 2.1, leg: 0.27, torso: 0.36, tr: 0.155, head: 0.175, arm: 0.34,
            limbR: 0.050, teeth: 'buck', ears: true }
  },
  {
    id: 'pj', name: 'PJ Pug-a-Pillar', unlockAt: 0, build: 'pj',
    blurb: 'Twelve segments of dog. It cannot corner to save its life and it never, ever gives up.',
    special: 'relentless', specialName: 'Never Gives Up',
    specialText: 'Turns slowly, but once it has your scent it hunts until the shift ends.',
    speed: 52, sense: 280, hearing: 460, vent: true, reach: 44, patience: 4.0, silent: false,
    look: { fur: '#3fa86a', belly: '#d9f2c4', eye: '#ffe066', lip: '#245c3b',
            h: 1.35, teeth: 'buck', segments: 7 }
  },
  {
    id: 'catnap', name: 'CatNap', unlockAt: 0, build: 'catnap',
    blurb: 'Moves without a sound and leaves red gas behind it. You will hear nothing until the arms close.',
    special: 'gas', specialName: 'Red Smoke',
    specialText: 'Silent footsteps, and a trail of gas that slows you and eats your stamina.',
    speed: 54, sense: 320, hearing: 480, vent: true, reach: 50, patience: 2.0, silent: true,
    look: { fur: '#6b4ba8', belly: '#d9c9f0', eye: '#ff3b3b', lip: '#2e1c4d',
            h: 2.7, leg: 0.29, torso: 0.36, tr: 0.150, head: 0.180, arm: 0.40,
            limbR: 0.046, teeth: 'wide', ears: true, tail: true }
  }
];

/* Friendly staff who wander the floor. */
PP.NPC_NAMES = ['Dana', 'Marco', 'Iris', 'Pete', 'Yuki', 'Ollie', 'Rae', 'Bex',
                'Sam', 'Nadia', 'Cyril', 'Wren', 'Toby', 'Fern'];

PP.NPC_CHATTER = [
  'Third shift again. Lucky us.',
  'Don\'t take the east vents. Trust me.',
  'They moved the toys overnight. Again.',
  'If the lights go red, you run. Simple.',
  'I heard something laughing in the ducts.',
  'Payroll says the tokens are real money now.',
  'Never look a toy in the eye. Rule one.',
  'Someone left a hand in the vault. A big one.',
  'You new? Grab a pack from the lobby.',
  'Machines are humming wrong today.'
];

PP.EMOTES = [
  { key: '1', label: 'Wave',       kind: 'act',  say: '*waves*',                anim: 'wave' },
  { key: '2', label: 'Follow me',  kind: 'chat', say: 'Follow me!',             anim: 'point' },
  { key: '3', label: 'Hide!',      kind: 'chat', say: 'Hide! It\'s coming!',    anim: 'panic' },
  { key: '4', label: 'All clear',  kind: 'chat', say: 'All clear over here.',   anim: 'wave' },
  { key: '5', label: 'Help!',      kind: 'chat', say: 'HELP! Someone!',         anim: 'panic' },
  { key: '6', label: 'Dance',      kind: 'act',  say: '*dances badly*',         anim: 'dance' },
  { key: '7', label: 'Point',      kind: 'act',  say: '*points*',               anim: 'point' },
  { key: '8', label: 'Nice work',  kind: 'chat', say: 'Nice work, team.',       anim: 'wave' }
];

PP.SHOP = [
  { id: 'hat_cone',  name: 'Party Cone',      cost: 120, desc: 'A birthday hat that has seen things.' },
  { id: 'hat_crown', name: 'Employee Crown',  cost: 300, desc: 'Awarded for zero incidents. Nobody has one.' },
  { id: 'hat_bulb',  name: 'Head Lamp',       cost: 220, desc: '+20% torch range, permanently.' },
  { id: 'suit_hiviz',name: 'Hi-Viz Vest',     cost: 180, desc: 'NPCs greet you on sight.' },
  { id: 'suit_ghost',name: 'Dust Sheet',      cost: 420, desc: 'Monsters lose your trail 20% sooner.' },
  { id: 'pack_gold', name: 'Gold GrabPack',   cost: 500, desc: 'Longer wire. Obnoxiously shiny.' }
];

PP.MODES = [
  { id: 'roam',    icon: '🏭', name: 'Open Shift',
    desc: 'Free roleplay. Wander, work the job stations, earn tokens. Nothing hunts you.' },
  { id: 'night',   icon: '🔦', name: 'Night Shift',
    desc: 'Restore five power nodes and reach the lift. Pick which toy is awake down here.' },
  { id: 'monster', icon: '🐾', name: 'Monster Shift',
    desc: 'You are the toy. Catch every worker before they finish the repairs.' }
];

PP.getRole = function (id) {
  for (var i = 0; i < PP.ROLES.length; i++) if (PP.ROLES[i].id === id) return PP.ROLES[i];
  return PP.ROLES[0];
};
PP.getMonster = function (id) {
  for (var i = 0; i < PP.MONSTERS.length; i++) if (PP.MONSTERS[i].id === id) return PP.MONSTERS[i];
  return PP.MONSTERS[0];
};
