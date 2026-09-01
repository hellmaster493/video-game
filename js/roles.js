/* ═══════════════════════════════════════════════════════════
   roles.js — the cast, the modes, emotes and cosmetics.
   All characters are original creations built for this game.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* Human staff you can clock in as. `look` drives the character renderer. */
PP.ROLES = [
  {
    id: 'worker', name: 'Line Worker', perk: 'Fast hands',
    blurb: 'Bread and butter of the floor. Finishes tasks quicker than anyone.',
    speed: 118, stamina: 5.5, taskRate: 1.55, light: 1.0, grabLen: 300, nerve: 1.0,
    look: { body: '#3f6fbf', trim: '#d8e3f5', skin: '#e5b48c', hat: 'cap', hatCol: '#e6404f' }
  },
  {
    id: 'guard', name: 'Night Guard', perk: 'Long torch',
    blurb: 'Walks the halls after dark. Their torch reaches far and it never dies.',
    speed: 110, stamina: 6.5, taskRate: 0.85, light: 1.75, grabLen: 270, nerve: 1.45,
    look: { body: '#2c3444', trim: '#ffc94d', skin: '#8d5f42', hat: 'cap', hatCol: '#20252f' }
  },
  {
    id: 'mechanic', name: 'Mechanic', perk: 'Rewires doors',
    blurb: 'Keeps the machines breathing. Can force locked shutters open by hand.',
    speed: 106, stamina: 5.0, taskRate: 1.2, light: 1.1, grabLen: 380, nerve: 1.15,
    look: { body: '#c9762c', trim: '#3a3128', skin: '#f0cfae', hat: 'helmet', hatCol: '#ffc94d' }
  },
  {
    id: 'toymaker', name: 'Toy Maker', perk: 'Decoy toys',
    blurb: 'Builds the smiles. Drops a wind-up toy that pulls a monster off your scent.',
    speed: 112, stamina: 5.0, taskRate: 1.3, light: 0.95, grabLen: 320, nerve: 0.85,
    look: { body: '#7d4bb5', trim: '#ffd9f2', skin: '#c98d63', hat: 'none', hatCol: '#fff' }
  },
  {
    id: 'intern', name: 'Intern', perk: 'Nobody notices',
    blurb: 'First day, worst day. Monsters lose interest in you noticeably faster.',
    speed: 124, stamina: 4.2, taskRate: 0.95, light: 0.8, grabLen: 250, nerve: 0.6,
    look: { body: '#4c9e78', trim: '#e9f5ef', skin: '#f3d3b5', hat: 'none', hatCol: '#fff' }
  }
];

/* Monsters. Playable in Monster Shift once unlocked. */
PP.MONSTERS = [
  {
    id: 'snugglepaw', name: 'Snugglepaw', unlockAt: 0,
    blurb: 'Ten feet of blue plush with arms that reach the far wall.',
    speed: 132, sense: 330, hearing: 420, vent: false, reach: 96, patience: 1.0,
    look: { fur: '#2f6fd0', belly: '#a8d0ff', eye: '#fff9c4', teeth: true, tall: 1.35, arm: 1.7 }
  },
  {
    id: 'longlimb', name: 'Mama Longlimb', unlockAt: 600,
    blurb: 'Rubber-jointed doll. Slow to start, impossible to outrun in a straight hall.',
    speed: 108, sense: 300, hearing: 520, vent: true, reach: 132, patience: 1.5,
    look: { fur: '#e35aa8', belly: '#ffd0ea', eye: '#7cf3ff', teeth: false, tall: 1.15, arm: 2.4 }
  },
  {
    id: 'jangle', name: 'Jangle Bunny', unlockAt: 1400,
    blurb: 'Crashes its cymbals when it loses you. Hears a sprint through two rooms.',
    speed: 148, sense: 250, hearing: 640, vent: true, reach: 84, patience: 0.7,
    look: { fur: '#f0c23a', belly: '#fff2c2', eye: '#ff4f4f', teeth: true, tall: 1.0, arm: 1.2 }
  }
];

/* Friendly staff who wander the floor and hand out work. */
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

/* Chat wheel — the roleplay heart of the thing. */
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

/* Cosmetics bought with tokens. Purely visual + a little swagger. */
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
    desc: 'Free roleplay. Wander, take jobs from staff, earn tokens. Nothing hunts you.' },
  { id: 'night',   icon: '🔦', name: 'Night Shift',
    desc: 'Restore five power nodes and reach the lift. Something is awake down here.' },
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
