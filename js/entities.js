/* ═══════════════════════════════════════════════════════════
   entities.js — Player, GrabPack hands, staff NPCs, monsters
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────── shared base ─────────────── */
function Actor(x, y, rad) {
  this.x = x; this.y = y; this.rad = rad || 13;
  this.vx = 0; this.vy = 0;
  this.face = 0;          // rendered facing angle
  this.walk = 0;          // stride phase
  this.speaking = null;   // { text, t }
  this.dead = false;
}
Actor.prototype.say = function (text, secs) {
  this.speaking = { text: text, t: secs || 3 };
};
Actor.prototype.tickSpeech = function (dt) {
  if (this.speaking) { this.speaking.t -= dt; if (this.speaking.t <= 0) this.speaking = null; }
};
Actor.prototype.stride = function (dt, sp) {
  this.walk += dt * sp * 0.09;
  if (sp > 4) this.face = PP.U.angLerp(this.face, Math.atan2(this.vy, this.vx), 1 - Math.exp(-14 * dt));
};

/* ═══════════════ GrabPack hand ═══════════════
   Fires on a wire toward the cursor. Latches sockets, drags props. */
function Hand(owner, side) {
  this.o = owner; this.side = side;              // 'l' (red) | 'r' (blue)
  this.state = 'idle';                           // idle | out | latched | back
  this.x = owner.x; this.y = owner.y;
  this.tx = 0; this.ty = 0;
  this.latch = null;                             // prop we're holding
  this.spin = 0;
}
Hand.prototype.origin = function () {
  var a = this.o.face + (this.side === 'l' ? -0.55 : 0.55);
  return { x: this.o.x + Math.cos(a) * 11, y: this.o.y + Math.sin(a) * 11 };
};
Hand.prototype.fire = function (wx, wy) {
  if (this.state !== 'idle') { this.release(); return; }
  this.state = 'out';
  var o = this.origin(); this.x = o.x; this.y = o.y;
  var d = PP.U.dist(o.x, o.y, wx, wy) || 1;
  var len = Math.min(d, this.o.grabLen);
  this.tx = o.x + (wx - o.x) / d * len;
  this.ty = o.y + (wy - o.y) / d * len;
  PP.Audio.grab();
};
Hand.prototype.release = function () {
  if (this.latch) { this.latch.heldBy = null; this.latch = null; }
  if (this.state !== 'idle') this.state = 'back';
};
Hand.prototype.update = function (dt, world) {
  var o = this.origin();
  this.spin += dt * 6;

  if (this.state === 'idle') { this.x = o.x; this.y = o.y; return; }

  if (this.state === 'out') {
    var dx = this.tx - this.x, dy = this.ty - this.y, d = Math.hypot(dx, dy);
    var step = 980 * dt;
    if (d <= step) { this.state = 'back'; }
    else {
      var nx = this.x + dx / d * step, ny = this.y + dy / d * step;
      if (world.solidPx(nx, ny)) { this.state = 'back'; }
      else {
        this.x = nx; this.y = ny;
        // snap onto anything grabbable in range
        for (var i = 0; i < world.props.length; i++) {
          var p = world.props[i];
          if (!this.canGrab(p)) continue;
          if (PP.U.dist2(this.x, this.y, p.gx != null ? p.gx : p.x, p.gy != null ? p.gy : p.y) < 26 * 26) {
            this.state = 'latched'; this.latch = p; p.heldBy = this.side;
            PP.Audio.latch();
            break;
          }
        }
      }
    }
    // wire snapped past max length
    if (PP.U.dist(o.x, o.y, this.x, this.y) > this.o.grabLen + 30) this.state = 'back';
  }

  if (this.state === 'latched') {
    var p = this.latch;
    if (!p) { this.state = 'back'; return; }
    var lx = p.gx != null ? p.gx : p.x, ly = p.gy != null ? p.gy : p.y;
    this.x = lx; this.y = ly;
    if (PP.U.dist(o.x, o.y, lx, ly) > this.o.grabLen + 46) this.release();   // wire yanked free
    if (p.kind === 'toy') {                                                   // drag toys around
      var a = Math.atan2(o.y - p.y, o.x - p.x), dd = PP.U.dist(o.x, o.y, p.x, p.y);
      if (dd > 40) { p.x += Math.cos(a) * 150 * dt; p.y += Math.sin(a) * 150 * dt; }
    }
  }

  if (this.state === 'back') {
    var bx = o.x - this.x, by = o.y - this.y, bd = Math.hypot(bx, by);
    if (bd < 12) { this.state = 'idle'; this.x = o.x; this.y = o.y; }
    else { this.x += bx / bd * 1250 * dt; this.y += by / bd * 1250 * dt; }
  }
};
Hand.prototype.canGrab = function (p) {
  if (p.heldBy) return false;
  if (p.kind === 'toy') return true;
  if (p.kind === 'socket' && !p.node.done) return p.side === this.side;
  return false;
};

/* ═══════════════ Player ═══════════════ */
function Player(x, y, role, name) {
  Actor.call(this, x, y, 12);
  this.role = role;
  this.name = name || 'New Hire';
  this.baseSpeed = role.speed;
  this.stamina = 1; this.maxStam = role.stamina;
  this.fear = 0;
  this.torch = true;
  this.torchRange = role.light;
  this.grabLen = role.grabLen;
  this.hands = { l: new Hand(this, 'l'), r: new Hand(this, 'r') };
  this.hiding = null;          // locker prop
  this.sprinting = false;
  this.noise = 0;              // 0..1, decays; monsters listen to this
  this.stepT = 0;
  this.emote = null;           // { anim, t }
  this.ability = { cd: 0, max: 0, ready: true };
  this.caught = false;
  this.invuln = 0;
}
Player.prototype = Object.create(Actor.prototype);
Player.prototype.constructor = Player;

Player.prototype.abilityInfo = function () {
  switch (this.role.id) {
    case 'worker':   return { name: 'Second Wind', cd: 30 };
    case 'guard':    return { name: 'Torch Flare', cd: 45 };
    case 'mechanic': return { name: 'Override',    cd: 50 };
    case 'toymaker': return { name: 'Wind-Up Decoy', cd: 40 };
    default:         return { name: 'Slip Away',   cd: 38 };
  }
};

Player.prototype.update = function (dt, game) {
  var In = PP.Input, world = PP.World, U = PP.U;
  this.tickSpeech(dt);
  if (this.invuln > 0) this.invuln -= dt;
  if (this.emote) { this.emote.t -= dt; if (this.emote.t <= 0) this.emote = null; }
  if (this.ability.cd > 0) { this.ability.cd -= dt; if (this.ability.cd <= 0) this.ability.ready = true; }

  /* ── input vector ── */
  var mx = 0, my = 0;
  if (In.down('w') || In.down('ArrowUp')) my -= 1;
  if (In.down('s') || In.down('ArrowDown')) my += 1;
  if (In.down('a') || In.down('ArrowLeft')) mx -= 1;
  if (In.down('d') || In.down('ArrowRight')) mx += 1;
  if (In.touch.mx || In.touch.my) { mx = In.touch.mx; my = In.touch.my; }
  var mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; mag = 1; }

  /* ── hiding freezes everything but the exit key ── */
  if (this.hiding) {
    this.vx = this.vy = 0;
    this.noise = Math.max(0, this.noise - dt * 2);
    this.stamina = U.clamp(this.stamina + dt * 0.5, 0, 1);
    if (In.hit('e') || In.touch.interact || mag > 0.6) {
      this.hiding.open = false; this.hiding = null; PP.Audio.noise(0.2, 300, 0.12);
    }
    return;
  }

  /* ── sprint & stamina ── */
  var wantSprint = (In.down('Shift') || In.touch.sprint) && mag > 0.1 && this.stamina > 0.02;
  this.sprinting = wantSprint;
  if (wantSprint) this.stamina = Math.max(0, this.stamina - dt / this.maxStam);
  else this.stamina = U.clamp(this.stamina + dt * (0.34 / this.maxStam) * (mag > 0.1 ? 1 : 2.4), 0, 1);

  var inVent = world.isVent(this.x, this.y);
  var sp = this.baseSpeed * (wantSprint ? 1.72 : 1) * (inVent ? 0.62 : 1)
         * (1 - this.fear * 0.12) * (game.slow > 0 ? 0.55 : 1);

  this.vx = mx * sp; this.vy = my * sp;
  world.move(this, this.vx * dt, this.vy * dt);
  this.stride(dt, mag * sp);

  /* ── aim at the cursor (mouse) or at movement (touch) ── */
  if (!In.touch.active && (In.mouse.x || In.mouse.y)) {
    var w = game.screenToWorld(In.mouse.x, In.mouse.y);
    this.face = Math.atan2(w.y - this.y, w.x - this.x);
  }

  /* ── footstep noise ── */
  if (mag > 0.1) {
    this.stepT -= dt * (wantSprint ? 2.9 : 1.7);
    if (this.stepT <= 0) {
      this.stepT = 1;
      PP.Audio.step();
      var loud = (wantSprint ? 0.85 : 0.34) * (inVent ? 0.5 : 1) * (world.isLoud(this.x, this.y) ? 1.5 : 1);
      this.noise = Math.min(1, this.noise + loud);
      game.makeNoise(this.x, this.y, loud * 320, this);
    }
  }
  this.noise = Math.max(0, this.noise - dt * 0.55);

  /* ── GrabPack ── */
  if (In.mouse.lHit) this.fireHand('l', game);
  if (In.mouse.rHit) this.fireHand('r', game);
  this.hands.l.update(dt, world);
  this.hands.r.update(dt, world);

  /* ── fear settles when nothing is near ── */
  this.fear = U.clamp(this.fear - dt * 0.16, 0, 1);
};

Player.prototype.fireHand = function (side, game) {
  var w = game.screenToWorld(PP.Input.mouse.x, PP.Input.mouse.y);
  this.hands[side].fire(w.x, w.y);
};

Player.prototype.useAbility = function (game) {
  if (!this.ability.ready) return false;
  var info = this.abilityInfo();
  var ok = true;
  switch (this.role.id) {
    case 'worker':
      this.stamina = 1; this.say('Second wind!', 2); break;
    case 'guard':
      game.flare(this.x, this.y); this.say('Lights up!', 2); break;
    case 'mechanic':
      ok = game.overrideNearestNode(this); break;
    case 'toymaker':
      game.dropDecoy(this.x, this.y); this.say('Go on, distract them.', 2.5); break;
    default:
      game.slipAway(4.5); this.say('*melts into the wall*', 2); break;
  }
  if (!ok) return false;
  this.ability.ready = false;
  this.ability.cd = info.cd; this.ability.max = info.cd;
  PP.Audio.good();
  return true;
};

/* ═══════════════ Staff NPC ═══════════════ */
function Npc(x, y, name, look) {
  Actor.call(this, x, y, 12);
  this.name = name;
  this.look = look;
  this.state = 'wander';         // wander | idle | flee | work | caught
  this.path = null; this.pi = 0;
  this.timer = PP.U.rand(0, 3);
  this.speed = PP.U.rand(70, 92);
  this.chatCd = PP.U.rand(6, 20);
  this.job = null;
  this.repairing = 0;
  this.caught = false;
  this.scare = 0;
}
Npc.prototype = Object.create(Actor.prototype);
Npc.prototype.constructor = Npc;

Npc.prototype.update = function (dt, game) {
  if (this.caught) { this.tickSpeech(dt); return; }
  var world = PP.World, U = PP.U;
  this.tickSpeech(dt);
  this.timer -= dt;
  this.chatCd -= dt;
  this.scare = Math.max(0, this.scare - dt * 0.4);

  var threat = game.nearestMonster(this.x, this.y);
  if (threat && threat.d < 250 && world.lineClear(this.x, this.y, threat.m.x, threat.m.y)) {
    if (this.state !== 'flee') {
      this.state = 'flee'; this.path = null; this.timer = 0;
      this.say(U.pick(['RUN!', 'It\'s here!', 'Oh no no no', 'GO GO GO']), 2.5);
      this.scare = 1;
    }
  }

  switch (this.state) {
    case 'flee': {
      if (!threat || threat.d > 430) { this.state = 'wander'; this.path = null; this.timer = 0; break; }
      // run directly away, hugging whatever is walkable
      var a = Math.atan2(this.y - threat.m.y, this.x - threat.m.x);
      var best = a, bestScore = -1;
      for (var k = -2; k <= 2; k++) {
        var ta = a + k * 0.45;
        var px = this.x + Math.cos(ta) * 46, py = this.y + Math.sin(ta) * 46;
        if (world.blocked(px, py, this.rad)) continue;
        var sc = 1 - Math.abs(k) * 0.12;
        if (sc > bestScore) { bestScore = sc; best = ta; }
      }
      var sp = this.speed * 1.55;
      this.vx = Math.cos(best) * sp; this.vy = Math.sin(best) * sp;
      world.move(this, this.vx * dt, this.vy * dt);
      this.stride(dt, sp);
      break;
    }
    case 'work': {
      this.repairing -= dt;
      this.vx = this.vy = 0;
      if (this.job && game.mode === 'monster') {
        this.job.charge = Math.min(1, this.job.charge + dt * 0.055);
        if (this.job.charge >= 1 && !this.job.done) {
          this.job.done = true; game.onNodeDone(this.job, this);
        }
      }
      if (this.repairing <= 0) { this.state = 'wander'; this.job = null; this.timer = 0; }
      break;
    }
    default: {
      if (this.timer <= 0 || !this.path) this.repick(game);
      this.followPath(dt);
      if (this.chatCd <= 0) {
        this.chatCd = U.rand(14, 34);
        if (U.chance(0.5)) this.say(U.pick(PP.NPC_CHATTER), 3.4);
      }
    }
  }
};

Npc.prototype.repick = function (game) {
  var world = PP.World;
  this.timer = PP.U.rand(4, 9);
  // in Monster Shift the staff make for the nearest unfinished node
  if (game.mode === 'monster') {
    var best = null, bd = 1e9;
    for (var i = 0; i < world.props.length; i++) {
      var p = world.props[i];
      if (p.kind !== 'node' || p.done) continue;
      var d = PP.U.dist2(this.x, this.y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      if (Math.sqrt(bd) < 44) {
        this.state = 'work'; this.job = best; this.repairing = 9;
        this.say('Working on it!', 2.5);
        return;
      }
      this.path = world.path(this.x, this.y, best.x, best.y, { noVent: true });
      this.pi = 0;
      return;
    }
  }
  var r = world.randomRoom(), s = world.spotIn(r, 1);
  this.path = world.path(this.x, this.y, s.x, s.y, { noVent: true });
  this.pi = 0;
};

Npc.prototype.followPath = function (dt) {
  if (!this.path || this.pi >= this.path.length) { this.vx = this.vy = 0; return; }
  var n = this.path[this.pi];
  var dx = n.x - this.x, dy = n.y - this.y, d = Math.hypot(dx, dy);
  if (d < 10) { this.pi++; return; }
  var sp = this.speed;
  this.vx = dx / d * sp; this.vy = dy / d * sp;
  PP.World.move(this, this.vx * dt, this.vy * dt);
  this.stride(dt, sp);
};

/* ═══════════════ Monster ═══════════════ */
function Monster(x, y, def) {
  Actor.call(this, x, y, 17);
  this.def = def;
  this.state = 'patrol';        // patrol | investigate | chase | search | stunned
  this.path = null; this.pi = 0;
  this.repathT = 0;
  this.target = null;
  this.lastSeen = null;
  this.interest = 0;            // how long it keeps hunting after losing you
  this.timer = 0;
  this.stunT = 0;
  this.lunge = 0;
  this.roarCd = 0;
  this.decoy = null;
}
Monster.prototype = Object.create(Actor.prototype);
Monster.prototype.constructor = Monster;

Monster.prototype.canSee = function (t, game) {
  if (!t || t.hiding) return false;
  var d = PP.U.dist(this.x, this.y, t.x, t.y);
  var range = this.def.sense * (game.slip > 0 ? 0.35 : 1);
  if (t.torch && t === game.player) range *= 1.15;
  if (d > range) return false;
  if (!PP.World.lineClear(this.x, this.y, t.x, t.y)) return false;
  // wide cone — it's a toy, it doesn't have to be fair
  var a = Math.atan2(t.y - this.y, t.x - this.x);
  var diff = Math.abs(((a - this.face + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
  return diff < 1.5 || d < 110;
};

Monster.prototype.hear = function (nx, ny, radius) {
  var d = PP.U.dist(this.x, this.y, nx, ny);
  if (d > radius * (this.def.hearing / 380)) return false;
  if (this.state === 'chase') return false;
  this.state = 'investigate';
  this.target = { x: nx, y: ny };
  this.path = null; this.repathT = 0;
  this.timer = 7;
  return true;
};

Monster.prototype.update = function (dt, game) {
  var U = PP.U, world = PP.World;
  this.tickSpeech(dt);
  this.repathT -= dt;
  this.roarCd -= dt;
  if (this.lunge > 0) this.lunge -= dt;

  if (this.stunT > 0) {
    this.stunT -= dt; this.vx = this.vy = 0;
    if (this.stunT <= 0) { this.state = 'search'; this.timer = 5; }
    return;
  }

  var prey = game.preyList();
  var seen = null, seenD = 1e9;
  for (var i = 0; i < prey.length; i++) {
    var p = prey[i];
    if (p.caught || p.dead) continue;
    if (this.canSee(p, game)) {
      var d = U.dist(this.x, this.y, p.x, p.y);
      if (d < seenD) { seenD = d; seen = p; }
    }
  }
  if (this.decoy && this.decoy.t > 0) { seen = null; }

  if (seen) {
    if (this.state !== 'chase' && this.roarCd <= 0) { PP.Audio.roar(); this.roarCd = 6; }
    this.state = 'chase';
    this.target = seen;
    this.lastSeen = { x: seen.x, y: seen.y };
    this.interest = 4.5 * this.def.patience
      * (seen.role && seen.role.id === 'intern' ? 0.6 : 1)
      * (game.saveData && game.saveData.owned && game.saveData.owned.suit_ghost && seen === game.player ? 0.8 : 1);
  }

  switch (this.state) {
    case 'chase': {
      var t = this.target;
      if (!t) { this.state = 'patrol'; break; }
      if (!seen) {
        this.interest -= dt;
        if (this.interest <= 0) {
          this.state = 'search'; this.timer = 6;
          this.target = this.lastSeen || { x: this.x, y: this.y };
          this.path = null; this.repathT = 0;
          if (this.def.id === 'jangle') PP.Audio.alarm();
          break;
        }
      }
      var goal = seen ? { x: t.x, y: t.y } : this.lastSeen;
      this.goto(goal, dt, this.def.speed * 1.0, true);
      // grab
      if (seen && seenD < this.def.reach) {
        this.lunge = 0.35;
        game.onCatch(this, seen);
      }
      break;
    }
    case 'investigate': {
      this.timer -= dt;
      this.goto(this.target, dt, this.def.speed * 0.72, true);
      if (this.timer <= 0 || (this.target && U.dist(this.x, this.y, this.target.x, this.target.y) < 40)) {
        this.state = 'search'; this.timer = 5;
      }
      break;
    }
    case 'search': {
      this.timer -= dt;
      if (!this.path || this.pi >= this.path.length) {
        var base = this.lastSeen || this;
        for (var n = 0; n < 8; n++) {
          var sx = base.x + U.rand(-260, 260), sy = base.y + U.rand(-260, 260);
          if (!world.solidPx(sx, sy)) {
            this.path = world.path(this.x, this.y, sx, sy, { noVent: !this.def.vent });
            this.pi = 0; break;
          }
        }
      }
      this.follow(dt, this.def.speed * 0.8);
      if (this.timer <= 0) { this.state = 'patrol'; this.path = null; }
      break;
    }
    default: {
      if (this.decoy && this.decoy.t > 0) {
        this.decoy.t -= dt;
        this.goto(this.decoy, dt, this.def.speed * 0.9, true);
        if (U.dist(this.x, this.y, this.decoy.x, this.decoy.y) < 40) this.decoy.t = 0;
        break;
      }
      if (!this.path || this.pi >= this.path.length) {
        var r = world.randomRoom(), s = world.spotIn(r, 1);
        this.path = world.path(this.x, this.y, s.x, s.y, { noVent: !this.def.vent });
        this.pi = 0;
      }
      this.follow(dt, this.def.speed * 0.62);
    }
  }
};

Monster.prototype.goto = function (goal, dt, speed, direct) {
  if (!goal) return;
  var world = PP.World;
  // straight line when the way is clear — cheaper and looks smarter
  if (direct && world.lineClear(this.x, this.y, goal.x, goal.y)) {
    var dx = goal.x - this.x, dy = goal.y - this.y, d = Math.hypot(dx, dy) || 1;
    this.vx = dx / d * speed; this.vy = dy / d * speed;
    world.move(this, this.vx * dt, this.vy * dt);
    this.stride(dt, speed);
    this.path = null;
    return;
  }
  if (this.repathT <= 0 || !this.path) {
    this.path = world.path(this.x, this.y, goal.x, goal.y, { noVent: !this.def.vent });
    this.pi = 0; this.repathT = 0.45;
  }
  this.follow(dt, speed);
};
Monster.prototype.follow = function (dt, speed) {
  if (!this.path || this.pi >= this.path.length) { this.vx = this.vy = 0; return; }
  var n = this.path[this.pi];
  var dx = n.x - this.x, dy = n.y - this.y, d = Math.hypot(dx, dy);
  if (d < 14) { this.pi++; return; }
  this.vx = dx / d * speed; this.vy = dy / d * speed;
  PP.World.move(this, this.vx * dt, this.vy * dt);
  this.stride(dt, speed);
};

/* ═══════════════ Player-controlled monster (Monster Shift) ═══════════════ */
function MonsterPlayer(x, y, def, name) {
  Monster.call(this, x, y, def);
  this.name = name;
  this.isPlayer = true;
  this.stamina = 1; this.maxStam = 4.5;
  this.sprinting = false;
  this.emote = null;
  this.grabCd = 0;
  this.torch = false;
  this.fear = 0;
  this.ability = { cd: 0, max: 0, ready: true };
}
MonsterPlayer.prototype = Object.create(Monster.prototype);
MonsterPlayer.prototype.constructor = MonsterPlayer;

MonsterPlayer.prototype.update = function (dt, game) {
  var In = PP.Input, world = PP.World;
  this.tickSpeech(dt);
  if (this.emote) { this.emote.t -= dt; if (this.emote.t <= 0) this.emote = null; }
  if (this.grabCd > 0) this.grabCd -= dt;
  if (this.ability.cd > 0) { this.ability.cd -= dt; if (this.ability.cd <= 0) this.ability.ready = true; }

  var mx = 0, my = 0;
  if (In.down('w') || In.down('ArrowUp')) my -= 1;
  if (In.down('s') || In.down('ArrowDown')) my += 1;
  if (In.down('a') || In.down('ArrowLeft')) mx -= 1;
  if (In.down('d') || In.down('ArrowRight')) mx += 1;
  if (In.touch.mx || In.touch.my) { mx = In.touch.mx; my = In.touch.my; }
  var mag = Math.hypot(mx, my);
  if (mag > 1) { mx /= mag; my /= mag; mag = 1; }

  var wantSprint = (In.down('Shift') || In.touch.sprint) && mag > 0.1 && this.stamina > 0.02;
  this.sprinting = wantSprint;
  if (wantSprint) this.stamina = Math.max(0, this.stamina - dt / this.maxStam);
  else this.stamina = PP.U.clamp(this.stamina + dt * 0.30 / this.maxStam * (mag > 0.1 ? 1 : 2.5), 0, 1);

  var sp = this.def.speed * (wantSprint ? 1.5 : 1) * (world.isVent(this.x, this.y) ? 0.8 : 1);
  this.vx = mx * sp; this.vy = my * sp;
  world.move(this, this.vx * dt, this.vy * dt);
  this.stride(dt, mag * sp);

  if (!In.touch.active) {
    var w = game.screenToWorld(In.mouse.x, In.mouse.y);
    this.face = Math.atan2(w.y - this.y, w.x - this.x);
  }

  // lunge: a long reach on a short cooldown
  if ((In.mouse.lHit || In.mouse.rHit) && this.grabCd <= 0) {
    this.grabCd = 1.1; this.lunge = 0.35;
    PP.Audio.roar();
    var list = game.preyList();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.caught) continue;
      if (PP.U.dist(this.x, this.y, p.x, p.y) < this.def.reach + 22
          && world.lineClear(this.x, this.y, p.x, p.y)) {
        game.onCatch(this, p);
        break;
      }
    }
  }
  if (mag > 0.1) {
    this.walk += dt * sp * 0.09;
    game.makeNoise(this.x, this.y, 40, this);
  }
};
