/* ═══════════════════════════════════════════════════════════
   entities.js — Player, GrabPack hands, staff NPCs, monsters.

   Game logic still runs on the flat (x, y) plane; scene.js lifts
   it into 3D. Only aiming and the GrabPack are truly 3D.
   ═══════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────── shared base ─────────────── */
function Actor(x, y, rad) {
  this.x = x; this.y = y; this.rad = rad || 13;
  this.vx = 0; this.vy = 0;
  this.face = 0; this.pitch = 0;
  this.animPhase = 0;
  this.speaking = null;
  this.dead = false;
}
Actor.prototype.say = function (text, secs) { this.speaking = { text: text, t: secs || 3 }; };
Actor.prototype.tickSpeech = function (dt) {
  if (this.speaking) { this.speaking.t -= dt; if (this.speaking.t <= 0) this.speaking = null; }
};
Actor.prototype.turnTo = function (dt, ax, ay, rate) {
  var want = Math.atan2(ay - this.y, ax - this.x);
  this.face = PP.U.angLerp(this.face, want, 1 - Math.exp(-rate * dt));
};

/* ═══════════════ GrabPack hand ═══════════════
   Fired down the crosshair. scene.js owns the visuals and the
   flight; this owns the state machine.                          */
function Hand(owner, side) {
  this.o = owner; this.side = side;
  this.state = 'idle';           // idle | out | latched | back
  this.pos = null;               // THREE.Vector3, created by scene.js
  this.target = null;
  this.latch = null;
  this.pendingLatch = null;
}
Hand.prototype.fire = function () {
  if (this.state !== 'idle') { this.release(); return; }
  var aim = PP.Scene.aim(this.o.grabLen);
  this.target = aim.point.clone();
  this.pendingLatch = (aim.prop && aim.prop.side === this.side && !aim.prop.heldBy) ? aim.prop : null;
  this.state = 'out';
  this.justFired = true;   // scene.js snaps the hand to the wrist before it flies
  PP.Audio.grab();
};
Hand.prototype.release = function () {
  if (this.latch) { this.latch.heldBy = null; this.latch = null; }
  this.pendingLatch = null;
  if (this.state !== 'idle') this.state = 'back';
};

/* ═══════════════ Player ═══════════════ */
function Player(x, y, role, name) {
  Actor.call(this, x, y, 11);
  this.role = role;
  this.name = name || 'New Hire';
  this.baseSpeed = role.speed;
  this.stamina = 1; this.maxStam = role.stamina;
  this.fear = 0;
  this.torch = true;
  this.torchRange = role.light;
  this.grabLen = role.grabLen;
  this.hands = { l: new Hand(this, 'l'), r: new Hand(this, 'r') };
  this.hiding = null;
  this.sprinting = false;
  this.noise = 0;
  this.stepT = 0;
  this.emote = null;
  this.ability = { cd: 0, max: 0, ready: true };
  this.saves = 1;
  this.invuln = 0;
  this.gassed = 0;
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

/** Mouse-look. Shared by the player and the player-controlled monster. */
Actor.prototype.mouseLook = function () {
  var In = PP.Input;
  if (In.look.dx || In.look.dy) {
    this.face += In.look.dx * In.sens;
    this.pitch = PP.U.clamp(this.pitch - In.look.dy * In.sens, -1.25, 1.25);
    In.look.dx = In.look.dy = 0;
  }
};

/** WASD relative to where you are looking. Returns the input magnitude. */
Actor.prototype.moveVector = function () {
  var In = PP.Input, f = 0, s = 0;
  if (In.down('w') || In.down('ArrowUp')) f += 1;
  if (In.down('s') || In.down('ArrowDown')) f -= 1;
  if (In.down('d') || In.down('ArrowRight')) s += 1;
  if (In.down('a') || In.down('ArrowLeft')) s -= 1;
  if (In.touch.mx || In.touch.my) { s = In.touch.mx; f = -In.touch.my; }
  var mag = Math.hypot(f, s);
  if (mag > 1) { f /= mag; s /= mag; mag = 1; }
  var cf = Math.cos(this.face), sf = Math.sin(this.face);
  return { x: cf * f - sf * s, y: sf * f + cf * s, mag: mag };
};

Player.prototype.update = function (dt, game) {
  var In = PP.Input, world = PP.World, U = PP.U;
  this.tickSpeech(dt);
  if (this.invuln > 0) this.invuln -= dt;
  if (this.gassed > 0) this.gassed -= dt;
  if (this.emote) { this.emote.t -= dt; if (this.emote.t <= 0) this.emote = null; }
  if (this.ability.cd > 0) { this.ability.cd -= dt; if (this.ability.cd <= 0) this.ability.ready = true; }

  this.mouseLook();

  if (this.hiding) {
    this.vx = this.vy = 0;
    this.noise = Math.max(0, this.noise - dt * 2);
    this.stamina = U.clamp(this.stamina + dt * 0.5, 0, 1);
    if (In.hit('e') || In.touch.interact) { this.hiding.open = false; this.hiding = null; PP.Audio.noise(0.2, 300, 0.12); }
    return;
  }

  var mv = this.moveVector();
  var wantSprint = (In.down('Shift') || In.touch.sprint) && mv.mag > 0.1 && this.stamina > 0.02;
  this.sprinting = wantSprint;
  if (wantSprint) this.stamina = Math.max(0, this.stamina - dt / this.maxStam);
  else this.stamina = U.clamp(this.stamina + dt * (0.34 / this.maxStam) * (mv.mag > 0.1 ? 1 : 2.4), 0, 1);
  if (this.gassed > 0) this.stamina = Math.max(0, this.stamina - dt * 0.22);

  var inVent = world.isVent(this.x, this.y);
  var sp = this.baseSpeed * (wantSprint ? 1.7 : 1) * (inVent ? 0.62 : 1)
         * (1 - this.fear * 0.10) * (this.gassed > 0 ? 0.6 : 1) * (game.slow > 0 ? 0.55 : 1);

  this.vx = mv.x * sp; this.vy = mv.y * sp;
  world.move(this, this.vx * dt, this.vy * dt);

  if (mv.mag > 0.1) {
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

  if (In.mouse.lHit) this.hands.l.fire();
  if (In.mouse.rHit) this.hands.r.fire();

  this.fear = U.clamp(this.fear - dt * 0.16, 0, 1);
};

Player.prototype.useAbility = function (game) {
  if (!this.ability.ready) return false;
  var info = this.abilityInfo(), ok = true;
  switch (this.role.id) {
    case 'worker':   this.stamina = 1; this.say('Second wind!', 2); break;
    case 'guard':    game.flare(this.x, this.y); this.say('Lights up!', 2); break;
    case 'mechanic': ok = game.overrideNearestNode(this); break;
    case 'toymaker': game.dropDecoy(this.x, this.y); this.say('Go on, distract them.', 2.5); break;
    default:         game.slipAway(4.5); this.say('*melts into the wall*', 2); break;
  }
  if (!ok) return false;
  this.ability.ready = false;
  this.ability.cd = info.cd; this.ability.max = info.cd;
  PP.Audio.good();
  return true;
};

/* ═══════════════ Staff NPC ═══════════════ */
function Npc(x, y, name, look) {
  Actor.call(this, x, y, 11);
  this.name = name;
  this.look = look;
  this.state = 'wander';
  this.path = null; this.pi = 0;
  this.timer = PP.U.rand(0, 3);
  this.speed = PP.U.rand(34, 44);
  this.chatCd = PP.U.rand(6, 20);
  this.job = null;
  this.repairing = 0;
  this.caught = false;
}
Npc.prototype = Object.create(Actor.prototype);
Npc.prototype.constructor = Npc;

Npc.prototype.update = function (dt, game) {
  if (this.caught) { this.tickSpeech(dt); this.vx = this.vy = 0; return; }
  var world = PP.World, U = PP.U;
  this.tickSpeech(dt);
  this.timer -= dt; this.chatCd -= dt;

  var threat = game.nearestMonster(this.x, this.y);
  if (threat && threat.d < 250 && world.lineClear(this.x, this.y, threat.m.x, threat.m.y)) {
    if (this.state !== 'flee') {
      this.state = 'flee'; this.path = null; this.timer = 0;
      this.say(U.pick(['RUN!', 'It\'s here!', 'Oh no no no', 'GO GO GO']), 2.5);
    }
  }

  switch (this.state) {
    case 'flee': {
      if (!threat || threat.d > 430) { this.state = 'wander'; this.path = null; this.timer = 0; break; }
      var a = Math.atan2(this.y - threat.m.y, this.x - threat.m.x), best = a;
      for (var k = -2; k <= 2; k++) {
        var ta = a + k * 0.45;
        if (!world.blocked(this.x + Math.cos(ta) * 46, this.y + Math.sin(ta) * 46, this.rad)) { best = ta; break; }
      }
      var sp = this.speed * 1.55;
      this.vx = Math.cos(best) * sp; this.vy = Math.sin(best) * sp;
      world.move(this, this.vx * dt, this.vy * dt);
      this.turnTo(dt, this.x + this.vx, this.y + this.vy, 10);
      break;
    }
    case 'work': {
      this.repairing -= dt;
      this.vx = this.vy = 0;
      if (this.job && game.mode === 'monster') {
        this.job.charge = Math.min(1, this.job.charge + dt * 0.055);
        if (this.job.charge >= 1 && !this.job.done) { this.job.done = true; game.onNodeDone(this.job, this); }
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
  this.vx = dx / d * this.speed; this.vy = dy / d * this.speed;
  PP.World.move(this, this.vx * dt, this.vy * dt);
  this.turnTo(dt, n.x, n.y, 9);
};

/* ═══════════════ Monster ═══════════════ */
function Monster(x, y, def) {
  Actor.call(this, x, y, 15);
  this.def = def;
  this.state = 'patrol';
  this.path = null; this.pi = 0;
  this.repathT = 0;
  this.target = null;
  this.lastSeen = null;
  this.interest = 0;
  this.timer = 0;
  this.stunT = 0;
  this.lunge = 0;
  this.roarCd = 0;
  this.decoy = null;
  this.chaseTime = 0;
  this.springPhase = null; this.springT = 0; this.springCd = 0;
  this.springDir = { x: 0, y: 0 };
  this.crashT = 0; this.crashCd = 6;
  this.gasT = 0;
  this.stompT = 0;
  this.trail = [];
}
Monster.prototype = Object.create(Actor.prototype);
Monster.prototype.constructor = Monster;

Monster.prototype.canSee = function (t, game) {
  if (!t || t.hiding || t.caught) return false;
  var d = PP.U.dist(this.x, this.y, t.x, t.y);
  var range = this.def.sense * (game.slip > 0 ? 0.35 : 1);
  if (t.torch && t === game.player) range *= 1.15;
  if (d > range) return false;
  if (!PP.World.lineClear(this.x, this.y, t.x, t.y)) return false;
  var a = Math.atan2(t.y - this.y, t.x - this.x);
  var diff = Math.abs(((a - this.face + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
  return diff < 1.5 || d < 110;
};

Monster.prototype.hear = function (nx, ny, radius) {
  if (PP.U.dist(this.x, this.y, nx, ny) > radius * (this.def.hearing / 380)) return false;
  if (this.state === 'chase') return false;
  this.state = 'investigate';
  this.target = { x: nx, y: ny };
  this.path = null; this.repathT = 0; this.timer = 7;
  return true;
};

Monster.prototype.update = function (dt, game) {
  var U = PP.U, world = PP.World;
  this.tickSpeech(dt);
  this.repathT -= dt; this.roarCd -= dt;
  if (this.lunge > 0) this.lunge -= dt;
  if (this.crashT > 0) this.crashT -= dt;
  if (this.springCd > 0) this.springCd -= dt;
  this.crashCd -= dt; this.stompT -= dt;

  if (this.stunT > 0) {
    this.stunT -= dt; this.vx = this.vy = 0;
    if (this.stunT <= 0) { this.state = 'search'; this.timer = 5; }
    return;
  }

  // ── Boxy Boo's spring overrides everything while it is coiled or airborne ──
  if (this.def.special === 'spring' && this.springPhase) {
    this.springT -= dt;
    if (this.springPhase === 'charge') {
      this.vx = this.vy = 0;
      if (this.springT <= 0) {
        this.springPhase = 'launch'; this.springT = 0.75;
        PP.Audio.tone(180, 0.3, 'square', 0.16, 900);
      }
    } else {
      var lsp = this.def.speed * 3.1;
      this.vx = this.springDir.x * lsp; this.vy = this.springDir.y * lsp;
      var bx = this.x, by = this.y;
      world.move(this, this.vx * dt, this.vy * dt);
      if (Math.abs(this.x - bx) < 0.6 && Math.abs(this.y - by) < 0.6) this.springT = 0;  // hit a wall
      if (this.springT <= 0) { this.springPhase = null; this.springCd = 3.4; }
    }
    this.tryCatch(game);
    return;
  }

  var prey = game.preyList(), seen = null, seenD = 1e9;
  for (var i = 0; i < prey.length; i++) {
    var p = prey[i];
    if (p.caught || p.dead) continue;
    if (this.canSee(p, game)) {
      var d = U.dist(this.x, this.y, p.x, p.y);
      if (d < seenD) { seenD = d; seen = p; }
    }
  }
  if (this.decoy && this.decoy.t > 0) seen = null;

  if (seen) {
    if (this.state !== 'chase' && this.roarCd <= 0) { PP.Audio.roar(); this.roarCd = 6; }
    if (this.state !== 'chase') this.chaseTime = 0;
    this.state = 'chase';
    this.target = seen;
    this.lastSeen = { x: seen.x, y: seen.y };
    this.interest = 4.5 * this.def.patience
      * (seen.role && seen.role.id === 'intern' ? 0.6 : 1)
      * (game.saveData && game.saveData.owned && game.saveData.owned.suit_ghost && seen === game.player ? 0.8 : 1);
  }

  this.special(dt, game, seen, seenD);

  switch (this.state) {
    case 'chase': {
      this.chaseTime += dt;
      if (!seen) {
        this.interest -= dt;
        if (this.interest <= 0) {
          this.state = 'search'; this.timer = 6 * this.def.patience;
          this.target = this.lastSeen || { x: this.x, y: this.y };
          this.path = null; this.repathT = 0; this.chaseTime = 0;
          break;
        }
      }
      var mult = this.def.special === 'sprint' ? (1 + Math.min(0.5, this.chaseTime * 0.16)) : 1;
      this.goto(seen ? { x: this.target.x, y: this.target.y } : this.lastSeen,
                dt, this.def.speed * mult, true);
      this.tryCatch(game);
      break;
    }
    case 'investigate':
      this.timer -= dt;
      this.goto(this.target, dt, this.def.speed * 0.72, true);
      if (this.timer <= 0 || (this.target && U.dist(this.x, this.y, this.target.x, this.target.y) < 40)) {
        this.state = 'search'; this.timer = 5;
      }
      break;
    case 'search':
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
    default:
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

  // heavy footfalls you can hear coming — unless it is CatNap
  if (!this.def.silent && this.stompT <= 0 && Math.hypot(this.vx, this.vy) > 8) {
    var pd = U.dist(this.x, this.y, game.player.x, game.player.y);
    if (pd < 520) {
      PP.Audio.noise(0.14, 90 + Math.random() * 60, 0.16 * (1 - pd / 520), 0.8);
      this.stompT = this.state === 'chase' ? 0.34 : 0.62;
    }
  }
};

/** Per-monster behaviour that runs alongside the state machine. */
Monster.prototype.special = function (dt, game, seen, seenD) {
  var U = PP.U;
  switch (this.def.special) {
    case 'spring':
      if (seen && this.springCd <= 0 && seenD > 130 && seenD < 620
          && PP.World.lineClear(this.x, this.y, seen.x, seen.y)) {
        var a = Math.atan2(seen.y - this.y, seen.x - this.x);
        this.springDir = { x: Math.cos(a), y: Math.sin(a) };
        this.face = a;
        this.springPhase = 'charge'; this.springT = 0.85;
        PP.Audio.tone(520, 0.5, 'triangle', 0.10, 160);
      }
      break;
    case 'cymbals':
      if (this.crashCd <= 0 && this.state !== 'patrol') {
        this.crashCd = 9 + Math.random() * 4;
        this.crashT = 0.4;
        PP.Audio.crash();
        // the crash tells it exactly where everyone flinched
        var pl = game.player;
        if (game.mode !== 'monster' && U.dist(this.x, this.y, pl.x, pl.y) < 900 && !pl.hiding) {
          this.lastSeen = { x: pl.x, y: pl.y };
          if (this.state !== 'chase') { this.state = 'investigate'; this.target = this.lastSeen; this.timer = 8; this.path = null; }
          PP.Scene.camShake = 0.5;
          pl.fear = Math.min(1, pl.fear + 0.3);
        }
      }
      break;
    case 'gas':
      this.gasT -= dt;
      if (this.state === 'chase' && this.gasT <= 0) {
        this.gasT = 1.1;
        game.dropGas(this.x, this.y);
      }
      break;
    case 'relentless':
      // it does not stop hunting; a lost trail becomes a very long search
      if (this.state === 'patrol' && this.lastSeen) { this.state = 'search'; this.timer = 20; }
      break;
  }
};

Monster.prototype.tryCatch = function (game) {
  var list = game.preyList();
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.caught) continue;
    if (PP.U.dist(this.x, this.y, p.x, p.y) < this.def.reach + 14) {
      this.lunge = 0.35;
      game.onCatch(this, p);
      return true;
    }
  }
  return false;
};

Monster.prototype.goto = function (goal, dt, speed, direct) {
  if (!goal) return;
  var world = PP.World;
  if (direct && world.lineClear(this.x, this.y, goal.x, goal.y)) {
    var dx = goal.x - this.x, dy = goal.y - this.y, d = Math.hypot(dx, dy) || 1;
    this.vx = dx / d * speed; this.vy = dy / d * speed;
    world.move(this, this.vx * dt, this.vy * dt);
    this.turnTo(dt, goal.x, goal.y, this.def.special === 'relentless' ? 3 : 8);
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
  this.turnTo(dt, n.x, n.y, this.def.special === 'relentless' ? 3 : 8);
};

/* ═══════════════ Player-controlled monster ═══════════════ */
function MonsterPlayer(x, y, def, name) {
  Monster.call(this, x, y, def);
  this.name = name;
  this.isPlayer = true;
  this.stamina = 1; this.maxStam = 4.5;
  this.sprinting = false;
  this.grabCd = 0;
  this.torch = false;
  this.fear = 0;
  this.burst = 0;
  this.charging = 0;
  this.ability = { cd: 0, max: 0, ready: true };
}
MonsterPlayer.prototype = Object.create(Monster.prototype);
MonsterPlayer.prototype.constructor = MonsterPlayer;

MonsterPlayer.prototype.abilityInfo = function () {
  var d = this.def;
  return { name: d.specialName, cd: d.special === 'spring' ? 5 : d.special === 'cymbals' ? 14 : 18 };
};

MonsterPlayer.prototype.update = function (dt, game) {
  var In = PP.Input, world = PP.World;
  this.tickSpeech(dt);
  if (this.grabCd > 0) this.grabCd -= dt;
  if (this.burst > 0) this.burst -= dt;
  if (this.crashT > 0) this.crashT -= dt;
  if (this.ability.cd > 0) { this.ability.cd -= dt; if (this.ability.cd <= 0) this.ability.ready = true; }

  this.mouseLook();

  // spring launch, driven by the player
  if (this.springPhase) {
    this.springT -= dt;
    if (this.springPhase === 'charge') {
      this.vx = this.vy = 0;
      if (!In.mouse.l || this.springT <= 0) {
        this.springPhase = 'launch'; this.springT = 0.7;
        this.springDir = { x: Math.cos(this.face), y: Math.sin(this.face) };
        PP.Audio.tone(180, 0.3, 'square', 0.16, 900);
      }
    } else {
      var lsp = this.def.speed * 3.1;
      this.vx = this.springDir.x * lsp; this.vy = this.springDir.y * lsp;
      var bx = this.x, by = this.y;
      world.move(this, this.vx * dt, this.vy * dt);
      if (Math.abs(this.x - bx) < 0.6 && Math.abs(this.y - by) < 0.6) this.springT = 0;
      if (this.springT <= 0) this.springPhase = null;
      this.grabSweep(game, 1.4);
    }
    return;
  }

  var mv = this.moveVector();
  var wantSprint = (In.down('Shift') || In.touch.sprint) && mv.mag > 0.1 && this.stamina > 0.02;
  this.sprinting = wantSprint;
  if (wantSprint) this.stamina = Math.max(0, this.stamina - dt / this.maxStam);
  else this.stamina = PP.U.clamp(this.stamina + dt * 0.30 / this.maxStam * (mv.mag > 0.1 ? 1 : 2.5), 0, 1);

  var sp = this.def.speed * (wantSprint ? 1.5 : 1) * (this.burst > 0 ? 1.5 : 1)
         * (world.isVent(this.x, this.y) ? 0.8 : 1);
  this.vx = mv.x * sp; this.vy = mv.y * sp;
  world.move(this, this.vx * dt, this.vy * dt);

  // Boxy Boo charges its spring on held LMB; everyone else swipes
  if (this.def.special === 'spring') {
    if (In.mouse.lHit) { this.springPhase = 'charge'; this.springT = 1.4; PP.Audio.tone(520, 0.5, 'triangle', 0.10, 160); }
  } else if ((In.mouse.lHit || In.mouse.rHit) && this.grabCd <= 0) {
    this.grabCd = 1.0; this.lunge = 0.35;
    PP.Audio.roar();
    this.grabSweep(game, 1.0);
  }
  if (mv.mag > 0.1) game.makeNoise(this.x, this.y, 40, this);
};

MonsterPlayer.prototype.grabSweep = function (game, scale) {
  var list = game.preyList();
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.caught) continue;
    if (PP.U.dist(this.x, this.y, p.x, p.y) < this.def.reach * scale + 22
        && PP.World.lineClear(this.x, this.y, p.x, p.y)) {
      game.onCatch(this, p);
      return true;
    }
  }
  return false;
};

MonsterPlayer.prototype.useAbility = function (game) {
  if (!this.ability.ready) return false;
  var info = this.abilityInfo();
  switch (this.def.special) {
    case 'sprint': case 'relentless':
      this.burst = 4; this.say('*winds up*', 2); break;
    case 'spring':
      this.springPhase = 'charge'; this.springT = 1.2; break;
    case 'stretch':
      this.burst = 3; this.grabSweep(game, 1.6); break;
    case 'cymbals':
      this.crashT = 0.4; PP.Audio.crash();
      game.revealStaff(6);
      break;
    case 'gas':
      game.dropGas(this.x, this.y, true); break;
  }
  this.ability.ready = false;
  this.ability.cd = info.cd; this.ability.max = info.cd;
  return true;
};
