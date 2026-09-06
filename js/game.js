/* ═══════════════════════════════════════════════════════════
   game.js — the shift itself: modes, objectives, the AI
   director, interaction, scoring, win and loss.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Game = {
  running: false, paused: false, over: false,
  mode: 'roam', asMonster: false, sim: true, npcWork: false,
  player: null, npcs: [], monsters: [],
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
    this.cine = null; this.fade = 0;
    this.npcs = []; this.monsters = [];
    this.shift = (S.shifts || 0) + 1;

    this.asMonster = !!opts.asMonster;
    this.sim = !PP.Net.online || PP.Net.isHost;   // do I run the AI, or watch it?
    this.npcWork = this.asMonster;
    var crowd = PP.Net.online ? Math.max(0, PP.Net.peerCount() - 1) : 0;

    PP.World.build(opts.seed != null ? opts.seed : 12345 + this.shift * 7, opts.map);
    this.addSockets();

    var spawn = PP.World.tagged('spawn');
    var role = PP.getRole(opts.role);

    if (this.asMonster) {
      var mdef = PP.getMonster(opts.monster || 'huggy');
      var vh = PP.World.tagged('vent'), vs = PP.World.spotIn(vh, 1);
      this.player = new MonsterPlayer(vs.x, vs.y, mdef, S.name || 'It');
      this.player.grabLen = 0;
      var mi = this.player.abilityInfo();
      this.player.ability = { cd: 0, max: mi.cd, ready: true };
      this.power = this.mode !== 'night';
      this.spawnStaff(this.sim ? Math.max(1, 6 - crowd) : 0);
    } else {
      var s = PP.World.spotIn(spawn, 2);
      this.player = new Player(s.x, s.y, role, S.name || 'New Hire');
      this.player.gold = !!S.owned.pack_gold;
      if (this.player.gold) this.player.grabLen += 90;
      var info = this.player.abilityInfo();
      this.player.ability = { cd: 0, max: info.cd, ready: true };
      this.player.saves = 1;
      if (this.mode === 'night') {
        this.power = false;
        this.spawnStaff(this.sim ? Math.max(1, 3 - crowd) : 0);
        if (this.sim) {
          this.spawnMonster(PP.getMonster(opts.hunter || 'huggy'), PP.World.tagged('den').id);
        }
      } else {
        this.power = true;
        this.player.torch = false;
        this.spawnStaff(this.sim ? Math.max(2, 7 - crowd) : 0);
      }
    }

    PP.Scene.build(this);
    PP.Scene.setMood(this);
    PP.Scene.thirdPerson = (this.asMonster);
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
      if (r.tags.indexOf('exit') >= 0) r = PP.World.tagged('spawn');
      var s = PP.World.spotIn(r, 1);
      var li = i % PP.ROLES.length, ni = (i * 3 + 1) % PP.NPC_NAMES.length;
      var npc = new Npc(s.x, s.y, PP.NPC_NAMES[ni], Object.assign({}, PP.ROLES[li].look));
      npc.lookIdx = li; npc.nameIdx = ni;
      this.npcs.push(npc);
    }
  },

  /** The walkable room furthest from the player, for waking something new. */
  farRoom: function () {
    var pl = this.player, best = null, bd = -1;
    PP.World.rooms.forEach(function (r) {
      if (r.tags.indexOf('exit') >= 0) return;
      var d = PP.U.dist2(r.cx, r.cy, pl.x, pl.y);
      if (d > bd) { bd = d; best = r; }
    });
    return best || PP.World.rooms[0];
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
    if (this.cine) { this.tickCinematic(dt); return; }
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

    this.sim = !PP.Net.online || PP.Net.isHost;      // host may change under us
    if (this.sim) this.npcWork = this.asMonster || PP.Net.anyMonsterPlayer();

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

    if (In.hit('f') && !this.asMonster) { this.player.torch = !this.player.torch; PP.Audio.ui(); }
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
      if (pr.kind === 'gas' && !this.asMonster
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
    if (this.asMonster) return;
    var props = PP.World.props;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (p.kind !== 'node' || p.done || !p.sockets) continue;
      var both = p.sockets[0].heldBy === 'l' && p.sockets[1].heldBy === 'r';
      if (both) {
        var rate = 0.42 * (this.player.role && this.player.role.id === 'mechanic' ? 1.7 : 1);
        p.charge = Math.min(1, p.charge + dt * rate);
        if (Math.random() < dt * 8) PP.Audio.tone(300 + p.charge * 500, 0.05, 'square', 0.04);
        if (p.charge >= 1) { p.done = true; PP.Net.nodeDone(p); this.onNodeDone(p, this.player); }
      } else if (p.charge > 0 && p.charge < 1) {
        p.charge = Math.max(0, p.charge - dt * 0.18);
      }
    }
  },

  /** Contextual E-prompt: tasks, lockers, the lift, chatting to staff. */
  tickInteraction: function (dt) {
    var In = PP.Input, U = PP.U, pl = this.player;
    this.promptProp = null;
    if (pl.downed) {
      PP.UI.prompt('Down — someone has to pull you up  (' + Math.ceil(pl.downT) + 's)');
      return;
    }
    if (pl.hiding) { PP.UI.prompt('Leave the locker'); return; }
    if (this.asMonster) { PP.UI.prompt(null); return; }
    if (this.tickRevive(dt)) return;

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
          if (best.progress >= 1) { best.done = true; PP.Net.taskDone(best); this.onTaskDone(best); }
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
          if (In.hit('e') || In.touch.interact) {
            if (PP.Net.live()) {
              PP.Net.endRound(true, (pl.name || 'Someone') +
                ' got the lift up. Everybody out.');
            } else this.finish(true, 'You made it to the surface.');
          }
        } else PP.UI.prompt(null);
        break;
      case 'node':
        PP.UI.prompt(best.done ? null : 'Red hand → red socket, blue hand → blue socket');
        break;
    }
  },

  /**
   * Stand over someone on the floor and hold E. Two and a half seconds and
   * they are back on their feet — which is the whole reason to stay together.
   */
  tickRevive: function (dt) {
    var In = PP.Input, pl = this.player;
    var l = PP.Net.list(), best = null, bd = 78;
    for (var i = 0; i < l.length; i++) {
      var rp = l[i];
      if (!rp.downed || rp.isMonster) continue;
      var d = PP.U.dist(pl.x, pl.y, rp.x, rp.y);
      if (d < bd) { bd = d; best = rp; }
    }
    if (!best) { pl.reviveT = 0; return false; }
    var held = In.down('e') || In.touch.interact;
    if (held) {
      pl.reviveT += dt;
      if (pl.reviveT >= 2.5) {
        pl.reviveT = 0;
        PP.Net.revive(best, best.downId);
        best.downed = false; best.caught = false;
        pl.say('Up you get.', 2.2);
        PP.Audio.good();
        PP.UI.toast('You pulled ' + best.name + ' back up.', 'good');
      }
    } else pl.reviveT = Math.max(0, pl.reviveT - dt * 1.5);
    PP.UI.prompt('Hold to pull ' + best.name + ' up  ' +
                 Math.round(Math.min(1, pl.reviveT / 2.5) * 100) + '%');
    return true;
  },

  /* ═════════ down, and back up ═════════ */
  goDown: function (reason) {
    var pl = this.player;
    pl.downed = true; pl.caught = true;
    pl.downId = (pl.downId || 0) + 1;     // this knockdown, not the last one
    pl.downT = 30; pl.reviveT = 0;
    pl.hiding = null; pl.fear = 1; pl.invuln = 0;
    if (pl.hands) { pl.hands.l.release(); pl.hands.r.release(); }
    PP.Scene.thirdPerson = true;
    PP.Net.wentDown();
    PP.UI.toast(reason, 'bad');
    PP.UI.toast('Someone can pull you up — or you crawl back in 30 seconds.', 'bad');
  },
  reviveMe: function (byName) {
    var pl = this.player;
    if (!pl || !pl.downed) return;
    pl.downed = false; pl.caught = false;
    pl.downT = 0; pl.invuln = 4; pl.stamina = 0.35; pl.fear = 1;
    PP.Scene.thirdPerson = this.asMonster;
    PP.Net.gotUp();
    PP.Audio.good();
    PP.UI.toast(byName + ' pulled you back up. Move.', 'good');
  },
  /** Nobody came. You drag yourself back to the stairwell on your own. */
  crawlBack: function () {
    var pl = this.player, r = PP.World.tagged('spawn');
    var spot = PP.World.spotIn(r, 2);
    pl.x = spot.x; pl.y = spot.y;
    this.reviveMe('You crawled back to the stairwell');
    pl.invuln = 6;
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
    if (this.asMonster) { PP.Audio.drone(0.25); return; }
    var near = this.nearestMonster(pl.x, pl.y), t = 0;
    if (near) {
      if (near.d < 460) t = PP.U.clamp(1 - (near.d - 90) / 370, 0, 1);
      if (near.m.state === 'chase') t = Math.max(t, 0.75);
      if (pl.hiding) t *= 0.6;
    }
    if (t > pl.fear) pl.fear = PP.U.approach(pl.fear, t, 3.2, dt);
    PP.Audio.drone(pl.fear);
    // a thin high tone that only Claudie brings with it
    var dread = 0;
    for (var i = 0; i < this.monsters.length; i++) {
      var m = this.monsters[i];
      if (m.def.special !== 'still') continue;
      dread = Math.max(dread, PP.U.clamp(1 - PP.U.dist(pl.x, pl.y, m.x, m.y) / 700, 0, 1));
    }
    PP.Audio.dread(dread);
    if (pl.fear > 0.75) PP.Scene.camShake = Math.max(PP.Scene.camShake, 0.08);
  },

  /** Escalate the night as the player makes progress. */
  tickDirector: function (dt) {
    if (this.mode !== 'night' || !this.sim) return;
    // a room full of player-controlled toys does not need more of them
    var cap = 3 - Math.min(2, PP.Net.live() ? PP.Net.list().filter(function (r) {
      return r.isMonster;
    }).length : 0);
    if (this.monsters.length >= cap) return;
    var roster = ['mommy', 'bunzo', 'pj', 'catnap', 'boxy', 'huggy', 'claudie'];
    var pick = function (taken) {
      for (var i = 0; i < roster.length; i++) if (taken.indexOf(roster[i]) < 0) return roster[i];
      return 'huggy';
    };
    var taken = this.monsters.map(function (m) { return m.def.id; });
    if (this.nodesDone >= 3 && this.monsters.length < 2) {
      var m = this.spawnMonster(PP.getMonster(pick(taken)), this.farRoom().id);
      m.state = 'search'; m.timer = 8;
      PP.UI.toast(m.def.name + ' just woke up.', 'bad');
      PP.Audio.roar();
    }
    if (this.nodesDone >= 5 && this.monsters.length < 3) {
      var m2 = this.spawnMonster(PP.getMonster(pick(taken)), this.farRoom().id);
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
    if (this.asMonster) {
      PP.UI.toast('A node came back online. Stop them.', 'bad');
      if (this.nodesDone >= 5 && !PP.Net.live()) {
        this.finish(false, 'The staff restored power and walked out.');
      }
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
    if (victim && victim.isRemote) {
      // Only our own toy reports a grab. An AI monster reaching someone else is
      // their page's business — it runs the same check against its own player.
      if (victim.isMonster || monster !== this.player) return;
      PP.Net.claimCatch(victim);
      this.caughtCount++;
      this.award(30, 'Caught ' + victim.name);
      PP.Audio.roar();
      return;
    }
    if (victim === this.player) {
      if (this.player.invuln > 0 || this.over || this.player.downed || this.cine) return;
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
      this.beginDeath(monster);
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

  /**
   * The camera stops being yours. Every monster gets a grab; Claudie gets its
   * own, because being taken from behind is the whole point of it.
   */
  beginDeath: function (monster) {
    var pl = this.player;
    var claudie = monster.def.special === 'still';
    if (claudie) {
      // it was never in front of you
      var behind = pl.face + Math.PI;
      var bx = pl.x + Math.cos(behind) * 52, by = pl.y + Math.sin(behind) * 52;
      for (var d = 52; d > 10; d -= 8) {
        bx = pl.x + Math.cos(behind) * d; by = pl.y + Math.sin(behind) * d;
        if (!PP.World.blocked(bx, by, monster.rad)) break;
      }
      monster.x = bx; monster.y = by;
      PP.Audio.ceramic(); PP.Audio.roar();
    }
    monster.face = Math.atan2(pl.y - monster.y, pl.x - monster.x);
    this.cine = {
      m: monster, t: 0,
      dur: claudie ? 2.7 : 2.1,
      kind: claudie ? 'claudie' : 'grab',
      yaw0: pl.face, pitch0: pl.pitch,
      px: pl.x, py: pl.y,
      reason: claudie
        ? 'You never saw Claudie move. That is how it works.'
        : monster.def.name + ' caught you in the ' +
          PP.World.roomName(pl.x, pl.y) + '.'
    };
    PP.Input.block(true);
    PP.Audio.stopDrone();
    PP.UI.hideHud(true);
  },

  tickCinematic: function (dt) {
    var c = this.cine, m = c.m;
    c.t += dt;
    m.lunge = 0.35;
    m.watched = false;
    m.vx = m.vy = 0;
    m.face = PP.U.angLerp(m.face, Math.atan2(c.py - m.y, c.px - m.x),
                          1 - Math.exp(-8 * dt));
    // it drags you the last little way in
    if (c.kind !== 'claudie' && c.t < c.dur * 0.5) {
      this.player.x = PP.U.approach(this.player.x, m.x, 1.6, dt);
      this.player.y = PP.U.approach(this.player.y, m.y, 1.6, dt);
    }
    var fadeAt = c.dur - 0.45;
    this.fade = c.t > fadeAt ? Math.min(1, (c.t - fadeAt) / 0.42) : 0;
    if (c.t >= c.dur) {
      var reason = c.reason;
      var shared = PP.Net.live();
      this.cine = null; this.fade = 0;
      PP.Input.block(false);
      PP.UI.hideHud(false);
      if (shared) this.goDown(reason);
      else this.finish(false, reason);
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
  flare: function (x, y, mine) {
    if (mine) PP.Net.flared(x, y);
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
  /**
   * Is this thing on screen and unobstructed? Claudie's whole behaviour hangs
   * off it — and hiding in a locker means you cannot see it either.
   */
  playerSees: function (m) {
    var pl = this.player;
    if (!pl || pl.hiding) return false;
    var d = PP.U.dist(pl.x, pl.y, m.x, m.y);
    if (d > 1200) return false;
    var a = Math.atan2(m.y - pl.y, m.x - pl.x);
    var diff = Math.abs(((a - pl.face + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI);
    if (diff > 0.80) return false;             // outside the frame
    return PP.World.lineClear(pl.x, pl.y, m.x, m.y);
  },
  /**
   * Claudie stops for anybody's eyes, not only ours — so a friend watching the
   * corridor behind you is genuinely holding it still.
   */
  anyoneSees: function (m) {
    if (this.playerSees(m)) return true;
    var l = PP.Net.list();
    for (var i = 0; i < l.length; i++) {
      var p = l[i];
      if (p.isMonster || p.hiding || p.downed) continue;
      var d = PP.U.dist(p.x, p.y, m.x, m.y);
      if (d > 1200) continue;
      var a = Math.atan2(m.y - p.y, m.x - p.x);
      var diff = Math.abs(((a - p.face + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI);
      if (diff > 0.80) continue;
      if (PP.World.lineClear(p.x, p.y, m.x, m.y)) return true;
    }
    return false;
  },

  nearestMonster: function (x, y) {
    var best = null, bd = 1e9, i, d;
    for (i = 0; i < this.monsters.length; i++) {
      d = PP.U.dist(x, y, this.monsters[i].x, this.monsters[i].y);
      if (d < bd) { bd = d; best = this.monsters[i]; }
    }
    var l = PP.Net.list();
    for (i = 0; i < l.length; i++) {
      if (!l[i].isMonster || l[i].downed) continue;
      d = PP.U.dist(x, y, l[i].x, l[i].y);
      if (d < bd) { bd = d; best = l[i]; }
    }
    return best ? { m: best, d: bd } : null;
  },
  preyList: function () {
    var out = this.asMonster ? [] : [this.player];
    out = out.concat(this.npcs);
    var l = PP.Net.list();
    for (var i = 0; i < l.length; i++) if (!l[i].isMonster) out.push(l[i]);
    return out;
  },
  /** Whoever a monster would reach for first — anybody's player, not just ours. */
  nearestPrey: function (x, y) {
    var list = this.preyList(), best = null, bd = 1e9;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.caught || p.downed || p instanceof Npc) continue;
      var d = PP.U.dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) return best;
    for (var n = 0; n < list.length; n++) if (!list[n].caught) return list[n];
    return this.player;
  },
  drawList: function () {
    return [this.player].concat(this.npcs, this.monsters, PP.Net.list());
  },
  showMonsterOnMap: function () {
    if (this.asMonster) return false;
    return this.player.role && this.player.role.id === 'guard';
  },

  /* ═════════ objective text ═════════ */
  updateObjective: function () {
    var txt, pct = 0;
    if (this.asMonster && PP.Net.live()) {
      var crew = PP.Net.list().filter(function (r) { return !r.isMonster; });
      var floored = crew.filter(function (r) { return r.downed; }).length;
      txt = 'Put the crew on the floor: ' + floored + '/' + crew.length +
            '  ·  nodes online ' + this.nodesDone + '/5';
      pct = crew.length ? floored / crew.length : 0;
      PP.UI.objective(txt, pct);
      return;
    }
    if (this.mode === 'roam') {
      var total = 0, done = 0;
      PP.World.props.forEach(function (p) {
        if (p.kind === 'task') { total++; if (p.done) done++; }
      });
      pct = total ? done / total : 0;
      txt = 'Work the floor: ' + done + '/' + total + ' jobs finished';
      if (total && done >= total && !this.over && (this.sim || !PP.Net.live())) {
        var self = this;
        setTimeout(function () {
          if (self.over) return;
          var line = 'Every job on the board, signed off. Go home.';
          if (PP.Net.live()) PP.Net.endRound(true, line);
          else self.finish(true, line);
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
    if (PP.Net.live()) {
      txt += '  ·  ' + PP.Net.standing() + ' of ' + PP.Net.inShift() + ' still standing';
    }
    PP.UI.objective(txt, pct);
  },

  /* ═════════ end of shift ═════════ */
  finish: function (win, reason) {
    if (this.over) return;
    this.cine = null; this.fade = 0;
    PP.UI.hideHud(false);
    this.over = true; this.running = false;
    PP.Net.leaveSession();          // stop advertising a factory that just closed
    PP.Audio.stopDrone();
    PP.Input.unlock();
    var S = this.saveData;
    S.shifts = (S.shifts || 0) + 1;

    var rows = [['Tokens earned', this.earned], ['Jobs finished', this.tasksDone]];
    if (!this.asMonster) rows.push(['Power nodes', this.nodesDone + '/5']);
    else if (PP.Net.live()) rows.push(['Caught', this.caughtCount]);
    else rows.push(['Staff caught', this.caughtCount + '/' + this.npcs.length]);
    if (PP.Net.online && PP.Net.session) rows.push(['Played with', PP.Net.inShift() - 1]);
    rows.push(['Time on shift', PP.U.fmtTime(this.clock)]);

    if (win) {
      var bonus = this.mode === 'night' ? 150 : this.asMonster ? 200 : 60;
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
