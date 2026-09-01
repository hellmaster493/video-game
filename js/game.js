/* ═══════════════════════════════════════════════════════════
   game.js — the shift itself: modes, objectives, AI director,
   interaction, scoring, win and loss.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Game = {
  running: false, paused: false, over: false,
  mode: 'roam', player: null, npcs: [], monsters: [],
  cam: { x: 0, y: 0 },
  clock: 0, shift: 1,
  darkness: 0.4, power: true,
  flares: [], noises: [], seen: {},
  slow: 0, slip: 0, flash: 0,
  earned: 0, tasksDone: 0, nodesDone: 0, caughtCount: 0,
  saveData: null,
  hint: '', promptProp: null,

  /* ═════════ start ═════════ */
  start: function (opts) {
    var S = this.saveData = PP.Save.data;
    this.mode = opts.mode;
    this.running = true; this.paused = false; this.over = false;
    this.clock = 0; this.earned = 0; this.tasksDone = 0;
    this.nodesDone = 0; this.caughtCount = 0;
    this.flares = []; this.noises = []; this.seen = {};
    this.slow = 0; this.slip = 0; this.flash = 0;
    this.npcs = []; this.monsters = [];
    this.shift = (S.shifts || 0) + 1;

    PP.World.build(12345 + this.shift * 7);
    this.addSockets();

    var lobby = PP.World.room('lobby');
    var role = PP.getRole(opts.role);

    if (this.mode === 'monster') {
      var mdef = PP.getMonster(opts.monster || 'snugglepaw');
      var vh = PP.World.room('venthub');
      this.player = new MonsterPlayer(vh.cx, vh.cy, mdef, S.name || 'It');
      this.player.grabLen = 0;
      this.darkness = 0.5; this.power = true;
      this.spawnStaff(6, true);
    } else {
      this.player = new Player(lobby.cx, lobby.cy + 120, role, S.name || 'New Hire');
      this.player.gold = !!S.owned.pack_gold;
      if (this.player.gold) this.player.grabLen += 90;
      var info = this.player.abilityInfo();
      this.player.ability = { cd: 0, max: info.cd, ready: true };
      this.player.saves = 1;
      if (this.mode === 'night') {
        this.darkness = 0.82; this.power = false;
        this.spawnStaff(3, false);
        this.spawnMonster(PP.getMonster('snugglepaw'), 'warehouse');
      } else {
        this.darkness = 0.3; this.power = true;
        this.player.torch = false;      // the lights are on; F turns it back on
        this.spawnStaff(7, false);
      }
    }
    this.cam.x = this.player.x; this.cam.y = this.player.y;
    PP.Audio.unlock();
    this.updateObjective();
  },

  /** Each power node gets a red and a blue socket — one per GrabPack hand. */
  addSockets: function () {
    var add = [];
    PP.World.props.forEach(function (p) {
      if (p.kind !== 'node') return;
      p.sockets = [];
      [['l', -46], ['r', 46]].forEach(function (s) {
        var sk = { kind: 'socket', x: p.x + s[1], y: p.y - 6, rad: 14,
                   side: s[0], node: p, heldBy: null, block: false };
        p.sockets.push(sk); add.push(sk);
      });
    });
    add.forEach(function (s) { PP.World.addProp(s); });
  },

  spawnStaff: function (n, workers) {
    for (var i = 0; i < n; i++) {
      var r = PP.World.randomRoom();
      if (r.id === 'liftbay') r = PP.World.room('assembly');
      var s = PP.World.spotIn(r, 1);
      var look = PP.ROLES[i % PP.ROLES.length].look;
      var npc = new Npc(s.x, s.y, PP.NPC_NAMES[(i * 3 + 1) % PP.NPC_NAMES.length],
                        Object.assign({}, look));
      this.npcs.push(npc);
    }
  },

  spawnMonster: function (def, roomId) {
    var r = PP.World.room(roomId || 'warehouse'), s = PP.World.spotIn(r, 2);
    var m = new Monster(s.x, s.y, def);
    m.name = def.name;
    this.monsters.push(m);
    return m;
  },

  /* ═════════ per-frame ═════════ */
  update: function (dt) {
    if (!this.running || this.paused || this.over) return;
    var In = PP.Input, U = PP.U, world = PP.World;
    this.clock += dt;
    if (this.slow > 0) this.slow -= dt;
    if (this.slip > 0) this.slip -= dt;
    if (this.flash > 0) this.flash -= dt * 2.2;

    // decay noise pings and light flares
    for (var i = this.noises.length - 1; i >= 0; i--) {
      this.noises[i].t -= dt;
      if (this.noises[i].t <= 0) this.noises.splice(i, 1);
    }
    for (var f = this.flares.length - 1; f >= 0; f--) {
      this.flares[f].t -= dt;
      if (this.flares[f].t <= 0) this.flares.splice(f, 1);
    }
    // expire decoys
    for (var d = world.props.length - 1; d >= 0; d--) {
      var pr = world.props[d];
      if (pr.kind === 'decoy') {
        pr.life -= dt;
        if (pr.life <= 0) {
          world.props.splice(d, 1);
          this.monsters.forEach(function (m) { if (m.decoy === pr) m.decoy = null; });
        }
      }
    }

    this.player.update(dt, this);
    for (var n = 0; n < this.npcs.length; n++) this.npcs[n].update(dt, this);
    for (var m = 0; m < this.monsters.length; m++) this.monsters[m].update(dt, this);

    this.tickNodes(dt);
    this.tickInteraction(dt);
    this.tickFear(dt);
    this.tickCamera(dt);
    this.tickDirector(dt);

    var room = world.roomAt(this.player.x, this.player.y);
    if (room && !this.seen[room.id]) {
      this.seen[room.id] = true;
      PP.UI.toast('Entered ' + room.name);
    }

    if (In.hit('f') && this.player.torch !== undefined) {
      this.player.torch = !this.player.torch;
      PP.Audio.ui();
    }
    if (In.hit('q')) {
      if (this.player.useAbility) { if (!this.player.useAbility(this)) PP.Audio.bad(); }
    }
  },

  /* Power nodes charge only while both hands hold their matching sockets. */
  tickNodes: function (dt) {
    if (this.mode === 'monster') return;
    var props = PP.World.props, self = this;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (p.kind !== 'node' || p.done || !p.sockets) continue;
      var both = p.sockets[0].heldBy === 'l' && p.sockets[1].heldBy === 'r';
      if (both) {
        var rate = 0.42 * (this.player.role && this.player.role.id === 'mechanic' ? 1.7 : 1);
        p.charge = Math.min(1, p.charge + dt * rate);
        if (Math.random() < dt * 8) PP.Audio.tone(300 + p.charge * 500, 0.05, 'square', 0.04);
        if (p.charge >= 1) { p.done = true; this.onNodeDone(p, this.player); }
      } else if (p.charge > 0 && p.charge < 1) {
        p.charge = Math.max(0, p.charge - dt * 0.18);
      }
    }
  },

  /* Contextual E-prompt: tasks, lockers, the lift, chatting to staff. */
  tickInteraction: function (dt) {
    var In = PP.Input, U = PP.U, pl = this.player;
    this.promptProp = null;
    if (pl.hiding) { PP.UI.prompt('Leave the locker'); return; }
    if (this.mode === 'monster') { PP.UI.prompt(null); return; }

    var best = null, bestD = 1e9, props = PP.World.props;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (['task', 'locker', 'lift', 'node'].indexOf(p.kind) < 0) continue;
      var d = U.dist(pl.x, pl.y, p.x, p.y);
      if (d < p.rad + 26 && d < bestD) { bestD = d; best = p; }
    }
    // staff are interactable too — that's the roleplay part
    var npc = null, nd = 1e9;
    for (var n = 0; n < this.npcs.length; n++) {
      var q = this.npcs[n];
      var dd = U.dist(pl.x, pl.y, q.x, q.y);
      if (dd < 46 && dd < nd) { nd = dd; npc = q; }
    }
    if (npc && nd < bestD) {
      PP.UI.prompt('Talk to ' + npc.name);
      if (In.hit('e') || In.touch.interact) this.talkTo(npc);
      return;
    }
    if (!best) { PP.UI.prompt(null); return; }
    this.promptProp = best;

    switch (best.kind) {
      case 'task':
        if (best.done) { PP.UI.prompt(null); break; }
        PP.UI.prompt('Hold to ' + best.title.toLowerCase());
        if (In.down('e') || In.touch.interact) {
          best.progress += dt * 0.4 * (pl.role ? pl.role.taskRate : 1);
          this.makeNoise(best.x, best.y, 120, pl);
          if (best.progress >= 1) { best.done = true; this.onTaskDone(best); }
        } else if (best.progress > 0) {
          best.progress = Math.max(0, best.progress - dt * 0.25);
        }
        break;
      case 'locker':
        PP.UI.prompt('Hide in locker');
        if (In.hit('e') || In.touch.interact) {
          pl.hiding = best; best.open = true;
          pl.x = best.x; pl.y = best.y + 4;
          PP.Audio.noise(0.22, 260, 0.12);
          PP.UI.toast('Hidden. Stay quiet.');
        }
        break;
      case 'lift':
        if (best.armed) {
          PP.UI.prompt('Ride the lift out');
          if (In.hit('e') || In.touch.interact) this.finish(true, 'You made it to the surface.');
        } else {
          PP.UI.prompt(null);
          this.hint = 'The lift needs power.';
        }
        break;
      case 'node':
        if (!best.done) PP.UI.prompt('Red hand → red socket, blue hand → blue socket');
        else PP.UI.prompt(null);
        break;
    }
  },

  talkTo: function (npc) {
    var lines = PP.NPC_CHATTER.concat([
      'Nice to see a friendly face, ' + this.player.name + '.',
      'Keep your pack charged. You\'ll need it.',
      'Tokens are in your account already.',
      'Stick to lit rooms and you\'ll be fine.'
    ]);
    npc.say(PP.U.pick(lines), 4);
    npc.timer = 2.5;
    this.player.say(PP.U.pick(['Hey.', 'How\'s the shift?', 'You good?', 'Seen anything?']), 2.2);
    PP.Audio.ui();
    PP.UI.subtitle(npc.name, npc.speaking.text);
  },

  /* Fear rises near a monster and drives the screen effects + audio. */
  tickFear: function (dt) {
    var pl = this.player;
    if (this.mode === 'monster') { PP.Audio.drone(0.25); return; }
    var near = this.nearestMonster(pl.x, pl.y);
    var t = 0;
    if (near) {
      var d = near.d;
      if (d < 420) t = PP.U.clamp(1 - (d - 90) / 330, 0, 1);
      if (near.m.state === 'chase') t = Math.max(t, 0.75);
      if (pl.hiding) t *= 0.6;
    }
    if (t > pl.fear) pl.fear = PP.U.approach(pl.fear, t, 3.2, dt);
    PP.Audio.drone(pl.fear);
  },

  tickCamera: function (dt) {
    var pl = this.player, lead = { x: 0, y: 0 };
    if (!PP.Input.touch.active) {
      var z = PP.Render.zoom;
      var mx = (PP.Input.mouse.x - PP.Render.w / 2) / z, my = (PP.Input.mouse.y - PP.Render.h / 2) / z;
      lead.x = PP.U.clamp(mx * 0.22, -90, 90);
      lead.y = PP.U.clamp(my * 0.22, -90, 90);
    }
    var tx = pl.x + lead.x, ty = pl.y + lead.y;
    this.cam.x = PP.U.approach(this.cam.x, tx, 7, dt);
    this.cam.y = PP.U.approach(this.cam.y, ty, 7, dt);
    if (this.player.fear > 0.5) {
      var s = (this.player.fear - 0.5) * 6;
      this.cam.x += PP.U.rand(-s, s); this.cam.y += PP.U.rand(-s, s);
    }
  },

  /** Escalate the night as the player makes progress. */
  tickDirector: function (dt) {
    if (this.mode !== 'night') return;
    if (this.nodesDone >= 3 && this.monsters.length < 2) {
      var m = this.spawnMonster(PP.getMonster('longlimb'), 'vault');
      m.state = 'search'; m.timer = 8;
      PP.UI.toast('Something else just woke up.', 'bad');
      PP.Audio.roar();
    }
    if (this.nodesDone >= 5 && this.monsters.length < 3) {
      this.spawnMonster(PP.getMonster('jangle'), 'giftshop');
      PP.UI.toast('Cymbals in the west wing.', 'bad');
    }
  },

  /* ═════════ events ═════════ */
  onTaskDone: function (task) {
    this.tasksDone++;
    var pay = task.pay + (this.mode === 'night' ? 15 : 0);
    this.award(pay, task.title);
    PP.Audio.good();
    var praise = PP.U.pick(['Nice one.', 'That\'s logged.', 'Good work.', 'Ticked off.']);
    this.player.say(praise, 2);
    this.updateObjective();
  },

  onNodeDone: function (node, by) {
    this.nodesDone++;
    node.charge = 1;
    if (node.sockets) node.sockets.forEach(function (s) { s.heldBy = null; });
    if (this.player.hands) {
      ['l', 'r'].forEach(function (k) {
        var h = PP.Game.player.hands[k];
        if (h.latch && h.latch.node === node) h.release();
      });
    }
    PP.Audio.good();
    if (this.mode === 'monster') {
      PP.UI.toast('A node came back online. Stop them.', 'bad');
      if (this.nodesDone >= 5) this.finish(false, 'The staff restored power and walked out.');
    } else {
      this.award(40, 'Power node');
      PP.UI.toast('Node ' + this.nodesDone + ' of 5 online.', 'good');
      if (this.nodesDone >= 5) {
        this.power = true;
        PP.World.props.forEach(function (p) { if (p.kind === 'lift') p.armed = true; });
        PP.UI.toast('POWER RESTORED — the lift is live.', 'good');
        PP.Audio.alarm();
      }
    }
    this.updateObjective();
  },

  onCatch: function (monster, victim) {
    if (victim === this.player) {
      if (this.player.invuln > 0 || this.over) return;
      this.flash = 1;
      PP.Audio.roar(); PP.Audio.bad();

      // one close call per shift: you tear loose, drop tokens, and it stays angry
      if (this.player.saves > 0) {
        this.player.saves--;
        this.player.invuln = 3.2;
        this.player.fear = 1;
        this.player.stamina = 0.25;
        monster.stunT = 2.4; monster.state = 'stunned'; monster.path = null;
        this.slow = 1.2;
        var lost = Math.min(this.earned, 50);
        this.earned -= lost;
        this.saveData.tokens = Math.max(0, this.saveData.tokens - lost);
        PP.Save.flush();
        // shoved clear of the grab
        var a = Math.atan2(this.player.y - monster.y, this.player.x - monster.x);
        for (var s = 90; s > 0; s -= 15) {
          var nx = this.player.x + Math.cos(a) * s, ny = this.player.y + Math.sin(a) * s;
          if (!PP.World.blocked(nx, ny, this.player.rad)) { this.player.x = nx; this.player.y = ny; break; }
        }
        this.player.say('Let GO!', 2.2);
        PP.UI.toast('Close call — you tore free. Lost ' + lost + ' tokens. No second chances.', 'bad');
        return;
      }
      this.finish(false, monster.def.name + ' found you in the ' +
                  PP.World.roomName(this.player.x, this.player.y) + '.');
    } else if (victim instanceof Npc) {
      if (victim.caught) return;
      victim.caught = true; victim.say('!!', 2);
      this.caughtCount++;
      PP.Audio.bad();
      if (monster === this.player) {
        this.award(30, 'Caught ' + victim.name);
        PP.UI.toast('Caught ' + victim.name + '.', 'good');
        var left = this.npcs.filter(function (n) { return !n.caught; }).length;
        if (left === 0) this.finish(true, 'Every worker accounted for. The factory is quiet again.');
      } else {
        PP.UI.toast(victim.name + ' was taken.', 'bad');
      }
      this.updateObjective();
    }
  },

  award: function (n, why) {
    this.earned += n;
    this.saveData.tokens += n;
    PP.Save.flush();
    PP.Audio.coin();
    PP.UI.toast('+' + n + ' tokens — ' + why, 'good');
    PP.UI.refreshHud(this);
  },

  /* ═════════ abilities ═════════ */
  flare: function (x, y) {
    this.flares.push({ x: x, y: y, t: 2.4, max: 2.4 });
    PP.Audio.alarm();
    var self = this;
    this.monsters.forEach(function (m) {
      if (PP.U.dist(m.x, m.y, x, y) < 420 && PP.World.lineClear(m.x, m.y, x, y)) {
        m.stunT = 3.2; m.state = 'stunned'; m.path = null;
      }
    });
  },
  dropDecoy: function (x, y) {
    var d = PP.World.addProp({ kind: 'decoy', x: x, y: y, rad: 14, life: 12, block: false });
    this.monsters.forEach(function (m) {
      if (PP.U.dist(m.x, m.y, x, y) < 700) { m.decoy = { x: x, y: y, t: 9 }; m.state = 'patrol'; m.path = null; }
    });
    this.makeNoise(x, y, 420, null);
    return d;
  },
  slipAway: function (t) { this.slip = t; },
  overrideNearestNode: function (pl) {
    var best = null, bd = 200 * 200;
    PP.World.props.forEach(function (p) {
      if (p.kind !== 'node' || p.done) return;
      var d = PP.U.dist2(pl.x, pl.y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    });
    if (!best) { PP.UI.toast('No node in range.', 'bad'); return false; }
    best.charge = Math.min(1, best.charge + 0.45);
    PP.UI.toast('Override: node jumped to ' + Math.round(best.charge * 100) + '%.', 'good');
    if (best.charge >= 1) { best.done = true; this.onNodeDone(best, pl); }
    return true;
  },

  /* ═════════ helpers used by entities ═════════ */
  makeNoise: function (x, y, radius, src) {
    this.noises.push({ x: x, y: y, r: radius, t: 0.5 });
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m === src) continue;
      m.hear(x, y, radius);
    }
  },
  nearestMonster: function (x, y) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.monsters.length; i++) {
      var d = PP.U.dist(x, y, this.monsters[i].x, this.monsters[i].y);
      if (d < bd) { bd = d; best = this.monsters[i]; }
    }
    return best ? { m: best, d: bd } : null;
  },
  /** who the monsters are allowed to hunt */
  preyList: function () {
    if (this.mode === 'monster') return this.npcs;
    return [this.player].concat(this.npcs);
  },
  drawList: function () {
    return [this.player].concat(this.npcs, this.monsters)
      .filter(function (a) { return a && !(a.caught && a instanceof Npc && a.hidden); });
  },
  showMonsterOnMap: function () {
    if (this.mode === 'monster') return false;
    return this.player.role && this.player.role.id === 'guard';
  },
  screenToWorld: function (sx, sy) {
    var z = PP.Render.zoom;
    return { x: (sx - PP.Render.w / 2) / z + this.cam.x,
             y: (sy - PP.Render.h / 2) / z + this.cam.y };
  },

  /* ═════════ objective text ═════════ */
  updateObjective: function () {
    var txt, pct = 0;
    if (this.mode === 'roam') {
      var total = 0, done = 0;
      PP.World.props.forEach(function (p) {
        if (p.kind === 'task') { total++; if (p.done) done++; }
      });
      pct = total ? done / total : 0;
      txt = 'Work the floor: ' + done + '/' + total + ' jobs finished';
      if (total && done >= total && !this.over) {
        var self = this;
        setTimeout(function () {
          if (!self.over) self.finish(true, 'Every job on the board, signed off. Go home.');
        }, 1400);
      }
    } else if (this.mode === 'night') {
      if (this.nodesDone < 5) {
        txt = 'Restore the power: ' + this.nodesDone + '/5 nodes';
        pct = this.nodesDone / 5;
      } else {
        txt = 'Get to the Lift Bay and ride out';
        pct = 1;
      }
    } else {
      var left = this.npcs.filter(function (n) { return !n.caught; }).length;
      txt = 'Catch the staff: ' + (this.npcs.length - left) + '/' + this.npcs.length +
            '  ·  nodes online ' + this.nodesDone + '/5';
      pct = this.npcs.length ? (this.npcs.length - left) / this.npcs.length : 0;
    }
    PP.UI.objective(txt, pct);
  },

  /* ═════════ end of shift ═════════ */
  finish: function (win, reason) {
    if (this.over) return;
    this.over = true; this.running = false;
    PP.Audio.stopDrone();
    var S = this.saveData;
    S.shifts = (S.shifts || 0) + 1;

    var rows = [];
    rows.push(['Tokens earned', this.earned]);
    rows.push(['Jobs finished', this.tasksDone]);
    if (this.mode !== 'monster') rows.push(['Power nodes', this.nodesDone + '/5']);
    else rows.push(['Staff caught', this.caughtCount + '/' + this.npcs.length]);
    rows.push(['Time on shift', PP.U.fmtTime(this.clock)]);

    if (win) {
      var bonus = this.mode === 'night' ? 150 : this.mode === 'monster' ? 200 : 60;
      this.earned += bonus; S.tokens += bonus;
      rows.push(['Completion bonus', bonus]);
      PP.Audio.good();
    }
    var key = this.mode;
    if (!S.best[key] || this.earned > S.best[key]) S.best[key] = this.earned;

    // monsters unlock as you bank tokens
    PP.MONSTERS.forEach(function (m) {
      if (S.tokens >= m.unlockAt) S.unlocked[m.id] = true;
    });
    PP.Save.flush();
    PP.UI.endCard(win, reason, rows, this);
  }
};
