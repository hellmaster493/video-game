/* ═══════════════════════════════════════════════════════════
   game.js — the shift itself: modes, objectives, the AI
   director, interaction, scoring, win and loss.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Game = {
  running: false, paused: false, over: false,
  mode: 'roam', player: null, npcs: [], monsters: [],
  clock: 0, shift: 1,
  power: true,
  flares: [], noises: [], seen: {},
  slow: 0, slip: 0, flash: 0, reveal: 0,
  earned: 0, tasksDone: 0, nodesDone: 0, caughtCount: 0,
  saveData: null, promptProp: null,

  /* ═════════ start ═════════ */
  start: function (opts) {
    var S = this.saveData = PP.Save.data;
    this.mode = opts.mode;
    this.running = true; this.paused = false; this.over = false;
    this.clock = 0; this.earned = 0; this.tasksDone = 0;
    this.nodesDone = 0; this.caughtCount = 0;
    this.flares = []; this.noises = []; this.seen = {};
    this.slow = 0; this.slip = 0; this.flash = 0; this.reveal = 0;
    this.npcs = []; this.monsters = [];
    this.shift = (S.shifts || 0) + 1;

    PP.World.build(12345 + this.shift * 7);
    this.addSockets();

    var lobby = PP.World.room('lobby');
    var role = PP.getRole(opts.role);

    if (this.mode === 'monster') {
      var mdef = PP.getMonster(opts.monster || 'huggy');
      var vh = PP.World.room('venthub'), vs = PP.World.spotIn(vh, 1);
      this.player = new MonsterPlayer(vs.x, vs.y, mdef, S.name || 'It');
      this.player.grabLen = 0;
      var mi = this.player.abilityInfo();
      this.player.ability = { cd: 0, max: mi.cd, ready: true };
      this.power = true;
      this.spawnStaff(6);
    } else {
      var s = PP.World.spotIn(lobby, 2);
      this.player = new Player(s.x, s.y, role, S.name || 'New Hire');
      this.player.gold = !!S.owned.pack_gold;
      if (this.player.gold) this.player.grabLen += 90;
      var info = this.player.abilityInfo();
      this.player.ability = { cd: 0, max: info.cd, ready: true };
      this.player.saves = 1;
      if (this.mode === 'night') {
        this.power = false;
        this.spawnStaff(3);
        this.spawnMonster(PP.getMonster(opts.hunter || 'huggy'), 'warehouse');
      } else {
        this.power = true;
        this.player.torch = false;
        this.spawnStaff(7);
      }
    }

    PP.Scene.build(this);
    PP.Scene.setMood(this);
    PP.Scene.thirdPerson = (this.mode === 'monster');
    PP.Audio.unlock();
    this.updateObjective();
  },

  /** Each node gets a red and a blue socket bolted to its panel. */
  addSockets: function () {
    var M = PP.M, add = [];
    PP.World.props.forEach(function (p) {
      if (p.kind !== 'node') return;
      p.sockets = [];
      [['l', -0.45], ['r', 0.45]].forEach(function (o) {
        var sk = { kind: 'socket', x: p.x + o[1] * M, y: p.y + 0.30 * M, h: 1.15 * M,
                   rad: 12, side: o[0], node: p, heldBy: null, block: false };
        p.sockets.push(sk); add.push(sk);
      });
    });
    add.forEach(function (s) { PP.World.addProp(s); });
  },

  spawnStaff: function (n) {
    for (var i = 0; i < n; i++) {
      var r = PP.World.randomRoom();
      if (r.id === 'liftbay') r = PP.World.room('assembly');
      var s = PP.World.spotIn(r, 1);
      var look = PP.ROLES[i % PP.ROLES.length].look;
      this.npcs.push(new Npc(s.x, s.y, PP.NPC_NAMES[(i * 3 + 1) % PP.NPC_NAMES.length],
                             Object.assign({}, look)));
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
    var In = PP.Input;
    this.clock += dt;
    if (this.slow > 0) this.slow -= dt;
    if (this.slip > 0) this.slip -= dt;
    if (this.reveal > 0) this.reveal -= dt;
    if (this.flash > 0) this.flash -= dt * 2.2;

    for (var i = this.noises.length - 1; i >= 0; i--) {
      this.noises[i].t -= dt;
      if (this.noises[i].t <= 0) this.noises.splice(i, 1);
    }
    for (var f = this.flares.length - 1; f >= 0; f--) {
      this.flares[f].t -= dt;
      if (this.flares[f].t <= 0) this.flares.splice(f, 1);
    }
    this.tickTimedProps(dt);

    this.player.update(dt, this);
    for (var n = 0; n < this.npcs.length; n++) this.npcs[n].update(dt, this);
    for (var m = 0; m < this.monsters.length; m++) this.monsters[m].update(dt, this);

    this.tickNodes(dt);
    this.tickInteraction(dt);
    this.tickFear(dt);
    this.tickDirector(dt);

    var room = PP.World.roomAt(this.player.x, this.player.y);
    if (room && !this.seen[room.id]) {
      this.seen[room.id] = true;
      PP.UI.toast('Entered ' + room.name);
    }

    if (In.hit('f') && this.mode !== 'monster') { this.player.torch = !this.player.torch; PP.Audio.ui(); }
    if (In.hit('v')) { PP.Scene.thirdPerson = !PP.Scene.thirdPerson; PP.Audio.ui(); }
    if (In.hit('q') && this.player.useAbility && !this.player.useAbility(this)) PP.Audio.bad();
  },

  /** Decoys and gas clouds expire; gas also works on whoever stands in it. */
  tickTimedProps: function (dt) {
    var props = PP.World.props, pl = this.player, self = this;
    for (var d = props.length - 1; d >= 0; d--) {
      var pr = props[d];
      if (pr.kind !== 'decoy' && pr.kind !== 'gas') continue;
      pr.life -= dt;
      if (pr.kind === 'gas' && this.mode !== 'monster'
          && PP.U.dist(pl.x, pl.y, pr.x, pr.y) < 46) {
        pl.gassed = 1.2;
        pl.fear = Math.min(1, pl.fear + dt * 0.35);
      }
      if (pr.life <= 0) {
        if (pr.obj && pr.obj.parent) pr.obj.parent.remove(pr.obj);
        props.splice(d, 1);
        this.monsters.forEach(function (m) { if (m.decoy === pr) m.decoy = null; });
      }
    }
  },

  tickNodes: function (dt) {
    if (this.mode === 'monster') return;
    var props = PP.World.props;
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

  /** Contextual E-prompt: tasks, lockers, the lift, chatting to staff. */
  tickInteraction: function (dt) {
    var In = PP.Input, U = PP.U, pl = this.player;
    this.promptProp = null;
    if (pl.hiding) { PP.UI.prompt('Leave the locker'); return; }
    if (this.mode === 'monster') { PP.UI.prompt(null); return; }

    // only things roughly in front of you count
    var facing = function (p) {
      var a = Math.atan2(p.y - pl.y, p.x - pl.x);
      var diff = Math.abs(((a - pl.face + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI);
      return diff < 1.5;
    };

    var best = null, bestD = 1e9, props = PP.World.props;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (['task', 'locker', 'lift', 'node'].indexOf(p.kind) < 0) continue;
      var d = U.dist(pl.x, pl.y, p.x, p.y);
      if (d < p.rad + 30 && d < bestD && facing(p)) { bestD = d; best = p; }
    }
    var npc = null, nd = 1e9;
    for (var n = 0; n < this.npcs.length; n++) {
      var q = this.npcs[n];
      if (q.caught) continue;
      var dd = U.dist(pl.x, pl.y, q.x, q.y);
      if (dd < 48 && dd < nd && facing(q)) { nd = dd; npc = q; }
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
          pl.x = best.x; pl.y = best.y;
          PP.Audio.noise(0.22, 260, 0.12);
          PP.UI.toast('Hidden. Stay quiet.');
        }
        break;
      case 'lift':
        if (best.armed) {
          PP.UI.prompt('Ride the lift out');
          if (In.hit('e') || In.touch.interact) this.finish(true, 'You made it to the surface.');
        } else PP.UI.prompt(null);
        break;
      case 'node':
        PP.UI.prompt(best.done ? null : 'Red hand → red socket, blue hand → blue socket');
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

  tickFear: function (dt) {
    var pl = this.player;
    if (this.mode === 'monster') { PP.Audio.drone(0.25); return; }
    var near = this.nearestMonster(pl.x, pl.y), t = 0;
    if (near) {
      if (near.d < 460) t = PP.U.clamp(1 - (near.d - 90) / 370, 0, 1);
      if (near.m.state === 'chase') t = Math.max(t, 0.75);
      if (pl.hiding) t *= 0.6;
    }
    if (t > pl.fear) pl.fear = PP.U.approach(pl.fear, t, 3.2, dt);
    PP.Audio.drone(pl.fear);
    if (pl.fear > 0.75) PP.Scene.camShake = Math.max(PP.Scene.camShake, 0.08);
  },

  /** Escalate the night as the player makes progress. */
  tickDirector: function (dt) {
    if (this.mode !== 'night') return;
    var roster = ['mommy', 'bunzo', 'pj', 'catnap', 'boxy', 'huggy'];
    var pick = function (taken) {
      for (var i = 0; i < roster.length; i++) if (taken.indexOf(roster[i]) < 0) return roster[i];
      return 'huggy';
    };
    var taken = this.monsters.map(function (m) { return m.def.id; });
    if (this.nodesDone >= 3 && this.monsters.length < 2) {
      var m = this.spawnMonster(PP.getMonster(pick(taken)), 'vault');
      m.state = 'search'; m.timer = 8;
      PP.UI.toast(m.def.name + ' just woke up.', 'bad');
      PP.Audio.roar();
    }
    if (this.nodesDone >= 5 && this.monsters.length < 3) {
      var m2 = this.spawnMonster(PP.getMonster(pick(taken)), 'giftshop');
      PP.UI.toast(m2.def.name + ' is in the west wing.', 'bad');
    }
  },

  /* ═════════ events ═════════ */
  onTaskDone: function (task) {
    this.tasksDone++;
    this.award(task.pay + (this.mode === 'night' ? 15 : 0), task.title);
    PP.Audio.good();
    this.player.say(PP.U.pick(['Nice one.', 'That\'s logged.', 'Good work.', 'Ticked off.']), 2);
    this.updateObjective();
  },

  onNodeDone: function (node, by) {
    this.nodesDone++;
    node.charge = 1;
    if (node.sockets) node.sockets.forEach(function (s) { s.heldBy = null; });
    if (this.player.hands) {
      var self = this;
      ['l', 'r'].forEach(function (k) {
        var h = self.player.hands[k];
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
      PP.Scene.camShake = 0.6;
      PP.Audio.roar(); PP.Audio.bad();

      // one close call per shift: you tear loose and it stays angry
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
  },

  /* ═════════ abilities ═════════ */
  flare: function (x, y) {
    this.flares.push({ x: x, y: y, t: 2.4, max: 2.4 });
    PP.Audio.alarm();
    this.monsters.forEach(function (m) {
      if (PP.U.dist(m.x, m.y, x, y) < 420 && PP.World.lineClear(m.x, m.y, x, y)) {
        m.stunT = 3.2; m.state = 'stunned'; m.path = null; m.springPhase = null;
      }
    });
  },
  dropDecoy: function (x, y) {
    var d = PP.World.addProp({ kind: 'decoy', x: x, y: y, rad: 14, life: 12, block: false });
    d.obj = PP.Models.prop(d);
    d.obj.position.set(x, 0, y);
    PP.Scene.propGroup.add(d.obj);
    this.monsters.forEach(function (m) {
      if (PP.U.dist(m.x, m.y, x, y) < 700) { m.decoy = { x: x, y: y, t: 9 }; m.state = 'patrol'; m.path = null; }
    });
    this.makeNoise(x, y, 420, null);
    return d;
  },
  dropGas: function (x, y, big) {
    var g = PP.World.addProp({ kind: 'gas', x: x, y: y, rad: 40, life: big ? 16 : 9, block: false });
    g.obj = PP.Models.prop(g);
    g.obj.position.set(x, 0, y);
    if (big) g.obj.scale.setScalar(1.6);
    PP.Scene.propGroup.add(g.obj);
    PP.Audio.noise(0.5, 320, 0.09, 0.6);
    return g;
  },
  revealStaff: function (secs) {
    this.reveal = secs;
    PP.UI.toast('The crash echoes back. You can hear all of them.', 'good');
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

  /* ═════════ helpers ═════════ */
  makeNoise: function (x, y, radius, src) {
    this.noises.push({ x: x, y: y, r: radius, t: 0.5 });
    for (var i = 0; i < this.monsters.length; i++) {
      if (this.monsters[i] !== src) this.monsters[i].hear(x, y, radius);
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
  preyList: function () {
    return this.mode === 'monster' ? this.npcs : [this.player].concat(this.npcs);
  },
  drawList: function () {
    return [this.player].concat(this.npcs, this.monsters);
  },
  showMonsterOnMap: function () {
    if (this.mode === 'monster') return false;
    return this.player.role && this.player.role.id === 'guard';
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
      } else { txt = 'Get to the Lift Bay and ride out'; pct = 1; }
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
    PP.Input.unlock();
    var S = this.saveData;
    S.shifts = (S.shifts || 0) + 1;

    var rows = [['Tokens earned', this.earned], ['Jobs finished', this.tasksDone]];
    if (this.mode !== 'monster') rows.push(['Power nodes', this.nodesDone + '/5']);
    else rows.push(['Staff caught', this.caughtCount + '/' + this.npcs.length]);
    rows.push(['Time on shift', PP.U.fmtTime(this.clock)]);

    if (win) {
      var bonus = this.mode === 'night' ? 150 : this.mode === 'monster' ? 200 : 60;
      this.earned += bonus; S.tokens += bonus;
      rows.push(['Completion bonus', bonus]);
      PP.Audio.good();
    }
    if (!S.best[this.mode] || this.earned > S.best[this.mode]) S.best[this.mode] = this.earned;
    PP.MONSTERS.forEach(function (m) { if (S.tokens >= m.unlockAt) S.unlocked[m.id] = true; });
    PP.Save.flush();
    PP.UI.endCard(win, reason, rows, this);
  }
};
