/* ═══════════════════════════════════════════════════════════
   net.js — the room.

   Everyone who opens the link lands in the SAME factory: same
   seed, same map, same shift, same monsters. There is no lobby
   size — six players or sixty, they all play together.

   Shape of it:
     · presence  carries each player's absolute state, ~30×/s.
     · one peer is the host; it runs the AI and publishes the
       monsters, the staff and the objective board in its own
       presence, so a late joiner is caught up without asking.
     · topics carry the moments presence cannot: a grab landing,
       a node finished, a shout, a revive, the end of the shift.

   Everything here degrades to nothing. If claude.use('room')
   resolves null — a plain file, an unsupported view — the game
   is exactly the single-player game it was.

   Nothing that arrives here is trusted. Names and lines are
   scrubbed and only ever drawn as text; ids are matched against
   our own tables; a grab is only believed from someone actually
   standing close enough to have thrown it.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Net = {
  V: 1,
  room: null,
  status: 'connecting',        // connecting | online | offline
  online: false,
  fatal: null,
  me: '', hostPeer: '', isHost: false,
  peerList: [],                // frozen snapshot from the platform
  players: {},                 // peer -> RemotePlayer
  session: null,               // {seed, map, mode, epoch} we are playing
  offer: null,                 // the host's advertised session
  hostName: '',
  epoch: 0,
  sendT: 0, hudT: 0, sayN: 0, epochT: 0,
  wantHost: false,
  wipeT: 0,
  banner: '',

  /* ═════════ boot ═════════ */
  init: function (tries) {
    var self = this;
    // the host page may install window.claude a beat after ours runs
    if (!window.claude || typeof window.claude.use !== 'function') {
      if ((tries || 0) > 12) { this.status = 'offline'; this.refresh(); return; }
      setTimeout(function () { self.init((tries || 0) + 1); }, 100);
      return;
    }
    var settled = false;
    setTimeout(function () {
      if (!settled) { settled = true; self.status = 'offline'; self.refresh(); }
    }, 11000);
    window.claude.use('room').then(function (room) {
      if (settled) return;
      settled = true;
      if (!room) { self.status = 'offline'; self.refresh(); return; }
      self.room = room;
      self.online = true;
      self.status = 'online';
      self.wire();
      self.refresh();
    }, function () {
      if (settled) return;
      settled = true;
      self.status = 'offline';
      self.refresh();
    });
  },

  wire: function () {
    var self = this, room = this.room;
    var died = function (e) {
      self.fatal = (e && e.code) || 'upstream_error';
      self.online = false; self.status = 'offline';
      self.dropAll();
      self.refresh();
    };
    room.onPeers(function (change) { self.onPeers(change); }, died);
    room.on('say', function (msg) { self.onSay(msg); }, died);
    room.on('evt', function (msg) { self.onEvt(msg); }, died);
    room.onConnection(function () { self.refresh(); }, died);
    // say hello, so we show up in everyone's roster before the first shift
    this.push();
  },

  /* ═════════ who is here ═════════ */
  onPeers: function (change) {
    var self = this, i;
    this.peerList = change.peers;
    for (i = 0; i < change.peers.length; i++) {
      if (change.peers[i].isMe && change.peers[i].sameTab) this.me = change.peers[i].peer;
    }
    for (i = 0; i < change.left.length; i++) this.drop(change.left[i].peer);
    this.elect();
    this.refresh();
  },

  /**
   * The lowest peer id hosts. A peer already claiming the job keeps it even
   * when someone lower joins, so a late arrival never yanks the simulation
   * out from under a shift in progress.
   */
  elect: function () {
    var viewers = [], running = [], onShift = [], i, p;
    for (i = 0; i < this.peerList.length; i++) {
      p = this.peerList[i];
      if (p.kind !== 'viewer') continue;        // the publishing session never hosts
      viewers.push(p);
      var pr = p.presence;
      if (!pr) continue;
      if (pr.hs && pr.sd != null) running.push(p);
      if (pr.ep) onShift.push(p);
    }
    // our own claim counts before it has made the round trip
    if (this.session && this.me) {
      if (this.wantHost) running.push({ peer: this.me });
      if (PP.Game.running && !PP.Game.over) onShift.push({ peer: this.me });
    }
    // whoever is running a factory; failing that, whoever is standing in one
    var pool = running.length ? running : (onShift.length ? onShift : viewers);
    var best = '';
    for (i = 0; i < pool.length; i++) if (!best || pool[i].peer < best) best = pool[i].peer;
    if (!best) best = this.me;
    var was = this.isHost;
    this.hostPeer = best;
    this.isHost = !!this.me && best === this.me;
    if (this.isHost && !was) this.becomeHost();
  },

  /** Promoted mid-shift: the puppets we were watching are ours to drive now. */
  becomeHost: function () {
    var g = PP.Game, i;
    if (!g.running || g.over || !this.session) return;
    this.wantHost = true;                  // start publishing the world ourselves
    for (i = 0; i < g.monsters.length; i++) {
      g.monsters[i].net = false;
      g.monsters[i].path = null; g.monsters[i].repathT = 0;
    }
    for (i = 0; i < g.npcs.length; i++) {
      g.npcs[i].net = false;
      g.npcs[i].path = null; g.npcs[i].timer = 0;
    }
    if (this.session) PP.UI.toast('You are hosting the shift now.');
  },

  hostPeerObj: function () {
    for (var i = 0; i < this.peerList.length; i++) {
      if (this.peerList[i].peer === this.hostPeer) return this.peerList[i];
    }
    return null;
  },
  presenceOf: function (peer) {
    var p = null;
    for (var i = 0; i < this.peerList.length; i++) {
      if (this.peerList[i].peer === peer) p = this.peerList[i];
    }
    return p ? p.presence : null;
  },

  /* ═════════ scrubbing anything off the wire ═════════ */
  BAD: /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff]/g,
  clean: function (s, max) {
    if (typeof s !== 'string') return '';
    return s.replace(this.BAD, '').trim().slice(0, max || 24);
  },
  num: function (v, lo, hi, dflt) {
    var n = (typeof v === 'number' && isFinite(v)) ? v : dflt;
    return n < lo ? lo : n > hi ? hi : n;
  },

  /* ═════════ publishing ourselves ═════════ */
  push: function () {
    if (!this.room) return;
    var g = PP.Game, S = PP.Save.data;
    var patch = {
      v: this.V,
      nm: this.clean(S.name || 'New Hire', 14) || 'New Hire',
      ep: (g.running && !g.over && this.session) ? this.session.epoch : 0
    };
    if (g.running && g.player && !g.over) {
      var pl = g.player;
      patch.k = g.asMonster ? 'm' : 'h';
      patch.id = g.asMonster ? (pl.def && pl.def.id) : (pl.role && pl.role.id);
      patch.x = Math.round(pl.x);
      patch.y = Math.round(pl.y);
      patch.fa = Math.round(pl.face * 1000);
      patch.vx = Math.round(pl.vx || 0);
      patch.vy = Math.round(pl.vy || 0);
      patch.fl = (pl.hiding ? 1 : 0) | (pl.downed ? 2 : 0) | (pl.sprinting ? 4 : 0) |
                 (pl.torch ? 8 : 0) | (g.cine ? 16 : 0) | ((pl.lunge || 0) > 0 ? 32 : 0);
      patch.dn = pl.downId || 0;
    } else {
      patch.k = 'h'; patch.x = null; patch.y = null; patch.fl = 0;
    }
    if (this.wantHost) {
      var h = this.hostPatch();
      for (var k in h) patch[k] = h[k];
    } else {
      patch.hs = null; patch.sd = null; patch.mp = null; patch.md = null;
      patch.hz = null; patch.mn = null; patch.np = null; patch.wd = null; patch.ck = null;
    }
    this.room.presence(patch).catch(function () {});
  },

  /** The host's half of presence: the world every client mirrors. */
  hostPatch: function () {
    var g = PP.Game, out = { hs: 1 }, i;
    if (!g.running || g.over || !this.session || !this.isHost) {
      out.sd = null; out.mp = null; out.md = null; out.hz = null;
      out.mn = null; out.np = null; out.wd = null; out.ck = null;
      return out;
    }
    out.sd = this.session.seed;
    out.mp = this.session.map;
    out.md = this.session.mode;
    out.hz = this.session.epoch;
    out.ck = Math.round(g.clock);

    var mn = [], m;
    for (i = 0; i < g.monsters.length && i < 12; i++) {
      m = g.monsters[i];
      mn.push([m.def.id, Math.round(m.x), Math.round(m.y), Math.round(m.face * 100),
               this.CODE[m.state] || 0,
               (m.watched ? 1 : 0) | ((m.lunge || 0) > 0 ? 2 : 0) |
               (m.springPhase ? 4 : 0) | ((m.crashT || 0) > 0 ? 8 : 0)].join(','));
    }
    out.mn = mn.join(';');

    var np = [], n;
    for (i = 0; i < g.npcs.length && i < 14; i++) {
      n = g.npcs[i];
      np.push([Math.round(n.x), Math.round(n.y), Math.round(n.face * 100),
               n.caught ? 1 : 0, n.lookIdx || 0, n.nameIdx || 0].join(','));
    }
    out.np = np.join(';');

    var nodes = [], tasks = [];
    PP.World.props.forEach(function (p) {
      if (p.kind === 'node' && p.done) nodes.push(p.id);
      else if (p.kind === 'task' && p.done) tasks.push(p.id);
    });
    out.wd = [g.nodesDone, g.power ? 1 : 0, g.tasksDone].join(',') +
             '|' + nodes.join(',') + '|' + tasks.join(',');
    return out;
  },

  CODE: { patrol: 0, search: 1, investigate: 2, chase: 3, stunned: 4 },
  NAMES: ['patrol', 'search', 'investigate', 'chase', 'stunned'],

  /* ═════════ per-frame ═════════ */
  tick: function (dt) {
    if (!this.room) return;
    var g = PP.Game;
    this.readPeers(dt);
    if (g.running && !g.over && this.session) {
      if (this.isHost) this.hostRules(dt);
      else { this.mirror(dt); this.checkEpoch(dt); }
    }
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = 1 / 30; this.push(); }
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.5; this.refresh(); }
  },

  /** Fold everyone else's presence into the avatars we draw. */
  readPeers: function (dt) {
    var live = {}, i;
    // peers() hands back the same frozen snapshot until something changes, so
    // reading it every frame costs nothing and never lags the handler
    var snap = this.room.peers();
    if (snap !== this.peerList) { this.peerList = snap; this.elect(); }
    for (i = 0; i < this.peerList.length; i++) {
      var p = this.peerList[i];
      if (p.kind !== 'viewer' || p.peer === this.me) continue;
      var pr = p.presence || {};
      if (pr.v !== this.V) continue;
      live[p.peer] = true;
      var rp = this.players[p.peer] || (this.players[p.peer] = new RemotePlayer(p.peer));
      rp.name = this.clean(pr.nm, 14) || 'Someone';
      rp.epoch = this.num(pr.ep, 0, 1e12, 0);
      rp.inShift = !!(rp.epoch && this.session && rp.epoch === this.session.epoch);
      // sticky: a message can outrun the presence update that ends their shift
      if (rp.inShift) rp.everIn = true;
      rp.setKind(pr.k === 'm', typeof pr.id === 'string' ? pr.id : null);
      if (typeof pr.x === 'number' && typeof pr.y === 'number') {
        rp.nx = this.num(pr.x, -1e5, 1e5, rp.nx);
        rp.ny = this.num(pr.y, -1e5, 1e5, rp.ny);
        rp.nf = this.num(pr.fa, -1e7, 1e7, 0) / 1000;
        rp.vx = this.num(pr.vx, -900, 900, 0);
        rp.vy = this.num(pr.vy, -900, 900, 0);
        var fl = this.num(pr.fl, 0, 255, 0) | 0;
        rp.hiding = !!(fl & 1);
        rp.downed = !!(fl & 2);
        rp.caught = rp.downed;
        rp.sprinting = !!(fl & 4);
        rp.torch = !!(fl & 8);
        if (fl & 32) rp.lunge = 0.35;
        rp.downId = this.num(pr.dn, 0, 1e6, 0) | 0;
        rp.state = rp.isMonster ? 'chase' : 'patrol';
        if (!rp.have) { rp.x = rp.nx; rp.y = rp.ny; rp.face = rp.nf; rp.have = true; }
      }
      rp.update(dt);
    }
    for (var key in this.players) if (!live[key]) this.drop(key);

    // what the host is advertising
    var hp = this.hostPeerObj();
    this.hostName = hp ? (this.clean((hp.presence || {}).nm, 14) || 'Someone') : '';
    var h = hp && hp.presence;
    this.offer = (h && typeof h.sd === 'number' && typeof h.mp === 'string' && h.hz)
      ? { seed: h.sd | 0, map: h.mp, mode: h.md === 'night' ? 'night' : 'roam',
          epoch: this.num(h.hz, 0, 1e12, 0) }
      : null;
    if (this.isHost && this.wantHost) this.offer = this.session;
  },

  drop: function (peer) {
    var rp = this.players[peer];
    if (!rp) return;
    if (rp.rig) PP.Scene.detach(rp);
    delete this.players[peer];
  },
  dropAll: function () { for (var k in this.players) this.drop(k); },

  /** The remote players actually standing in our factory. */
  list: function () {
    var out = [];
    for (var k in this.players) {
      var rp = this.players[k];
      if (rp.have && rp.inShift) out.push(rp);
    }
    return out;
  },
  /** How many of us are down here — the number that has no cap. */
  inShift: function () {
    return ((PP.Game.running && !PP.Game.over) ? 1 : 0) + this.list().length;
  },
  standing: function () {
    var n = (PP.Game.running && !PP.Game.over && PP.Game.player &&
             !PP.Game.player.downed) ? 1 : 0;
    var l = this.list();
    for (var i = 0; i < l.length; i++) if (!l[i].downed) n++;
    return n;
  },
  /** Are multiplayer rules in force right now? */
  live: function () { return !!(this.online && this.session && this.list().length > 0); },

  /** How many people have the page open (the publishing session aside). */
  peerCount: function () {
    var n = 0;
    for (var i = 0; i < this.peerList.length; i++) {
      if (this.peerList[i].kind === 'viewer') n++;
    }
    return Math.max(n, this.online ? 1 : 0);
  },
  anyMonsterPlayer: function () {
    var l = this.list();
    for (var i = 0; i < l.length; i++) if (l[i].isMonster) return true;
    return false;
  },

  /** Catch an entity up to the absolute state its owner published. */
  glide: function (e, dt, posRate, angRate, keepVel) {
    if (typeof e.nx !== 'number') return;
    if (PP.U.dist(e.x, e.y, e.nx, e.ny) > 420) {          // a teleport, or a vent
      e.x = e.nx; e.y = e.ny; e.face = e.nf;
      if (!keepVel) e.vx = e.vy = 0;
      return;
    }
    var ox = e.x, oy = e.y, k = 1 - Math.exp(-posRate * dt);
    e.x += (e.nx - e.x) * k;
    e.y += (e.ny - e.y) * k;
    e.face = PP.U.angLerp(e.face, e.nf, 1 - Math.exp(-angRate * dt));
    if (!keepVel && dt > 1e-4) { e.vx = (e.x - ox) / dt; e.vy = (e.y - oy) / dt; }
  },

  /* ═════════ the host's extra duties ═════════ */
  hostRules: function (dt) {
    var l = this.list();
    if (l.length && this.standing() === 0) {
      this.wipeT += dt;
      if (this.wipeT > 3.5) {
        this.wipeT = -1e9;
        this.endRound(false, 'Every one of you is on the floor. Playtime is over.');
      }
    } else if (this.wipeT > -1e8) this.wipeT = 0;
  },

  /* ═════════ mirroring the host's world ═════════ */
  mirror: function (dt) {
    var hp = this.hostPeerObj();
    if (!hp || !hp.presence) return;
    var h = hp.presence;
    if (h.hz !== this.session.epoch) return;      // the host moved on; checkEpoch handles it
    if (typeof h.mn === 'string') this.mirrorMonsters(h.mn);
    if (typeof h.np === 'string') this.mirrorNpcs(h.np);
    if (typeof h.wd === 'string') this.mirrorWorld(h.wd);
  },

  mirrorMonsters: function (s) {
    var g = PP.Game, rows = s ? s.split(';') : [], i;
    for (i = 0; i < rows.length; i++) {
      var f = rows[i].split(',');
      var def = PP.getMonster(f[0]);
      if (!def) continue;
      var m = g.monsters[i];
      if (!m || m.def.id !== def.id) {
        if (m) { PP.Scene.detach(m); g.monsters.splice(i, 1); }
        m = new Monster(+f[1] || 0, +f[2] || 0, def);
        m.name = def.name;
        g.monsters.splice(i, 0, m);
      }
      m.net = true;
      m.nx = this.num(+f[1], -1e5, 1e5, m.x);
      m.ny = this.num(+f[2], -1e5, 1e5, m.y);
      m.nf = this.num(+f[3], -1e7, 1e7, 0) / 100;
      m.state = this.NAMES[this.num(+f[4], 0, 4, 0) | 0] || 'patrol';
      var fl = this.num(+f[5], 0, 255, 0) | 0;
      m.watched = !!(fl & 1);
      if (fl & 2) m.lunge = 0.35;
      m.springPhase = (fl & 4) ? 'launch' : null;
      if (fl & 8) m.crashT = 0.4;
    }
    while (g.monsters.length > rows.length) PP.Scene.detach(g.monsters.pop());
  },

  mirrorNpcs: function (s) {
    var g = PP.Game, rows = s ? s.split(';') : [], i;
    for (i = 0; i < rows.length; i++) {
      var f = rows[i].split(',');
      var n = g.npcs[i];
      if (!n) {
        var li = this.num(+f[4], 0, PP.ROLES.length - 1, 0) | 0;
        var ni = this.num(+f[5], 0, PP.NPC_NAMES.length - 1, 0) | 0;
        n = new Npc(+f[0] || 0, +f[1] || 0, PP.NPC_NAMES[ni],
                    Object.assign({}, PP.ROLES[li].look));
        n.lookIdx = li; n.nameIdx = ni;
        n.x = +f[0] || 0; n.y = +f[1] || 0;
        g.npcs.push(n);
      }
      n.net = true;
      n.nx = this.num(+f[0], -1e5, 1e5, n.x);
      n.ny = this.num(+f[1], -1e5, 1e5, n.y);
      n.nf = this.num(+f[2], -1e7, 1e7, 0) / 100;
      n.caught = f[3] === '1';
    }
    while (g.npcs.length > rows.length) PP.Scene.detach(g.npcs.pop());
  },

  mirrorWorld: function (s) {
    var g = PP.Game, parts = s.split('|');
    var head = (parts[0] || '').split(',');
    var wasNodes = g.nodesDone, wasPower = g.power;
    g.nodesDone = this.num(+head[0], 0, 99, g.nodesDone) | 0;
    g.power = head[1] === '1';
    g.tasksDone = this.num(+head[2], 0, 99, g.tasksDone) | 0;
    // an empty list is an empty list — ''.split(',') is [''], and +'' is prop 0
    var mark = function (str, kind) {
      var ids = str ? str.split(',') : [];
      for (var i = 0; i < ids.length; i++) {
        if (ids[i] === '') continue;
        var p = PP.World.propById(+ids[i]);
        if (p && p.kind === kind && !p.done) {
          p.done = true; p.charge = 1; p.progress = 1;
          if (p.sockets) p.sockets.forEach(function (sk) { sk.heldBy = null; });
        }
      }
    };
    mark(parts[1], 'node');
    mark(parts[2], 'task');
    if (g.power && !wasPower) {
      PP.World.props.forEach(function (p) { if (p.kind === 'lift') p.armed = true; });
      PP.UI.toast('POWER RESTORED — the lift is live.', 'good');
      PP.Audio.alarm();
    }
    if (g.nodesDone !== wasNodes) g.updateObjective();
  },

  /* ═════════ session handshake ═════════ */
  /**
   * Called as a shift starts. If someone is already down there we join THEIR
   * factory — same seed, same map, same shift — whatever this player picked
   * on the menu. Otherwise we open one, and everyone else falls in behind us.
   */
  claimSession: function (opts) {
    var asMonster = opts.mode === 'monster';
    if (!this.online) {
      this.session = null; this.epoch = 0; this.banner = ''; this.wantHost = false;
      return { mode: opts.mode, map: opts.map, seed: null, role: opts.role,
               monster: opts.monster, hunter: opts.hunter, asMonster: asMonster };
    }
    if (this.offer && !this.isHost && this.offer.epoch) {
      this.session = { seed: this.offer.seed, map: this.offer.map,
                       mode: this.offer.mode, epoch: this.offer.epoch };
      this.banner = 'Dropped into ' + (this.hostName || 'the') + '’s shift.';
      this.wantHost = false;
    } else {
      // the clock names the shift; the random tail keeps two openers apart
      this.session = { seed: (Math.random() * 1e9) | 0, map: opts.map,
                       mode: asMonster ? 'night' : opts.mode,
                       epoch: (Date.now() % 1e9) * 1000 + ((Math.random() * 1000) | 0) };
      this.banner = 'Factory open. Anyone with the link walks straight in.';
      // whoever opens it runs it, from this frame, before any round trip
      this.wantHost = true; this.isHost = true;
      if (this.me) this.hostPeer = this.me;
    }
    this.epoch = this.session.epoch;
    this.wipeT = 0; this.goneT = 0; this.epochT = 0;
    for (var k in this.players) this.players[k].everIn = false;
    return { mode: this.session.mode, map: this.session.map, seed: this.session.seed,
             role: opts.role, monster: opts.monster, hunter: opts.hunter,
             asMonster: asMonster };
  },

  /** Mid-shift: the host started a new round without us. Follow it. */
  checkEpoch: function (dt) {
    if (this.isHost || !this.session) return;
    if (!this.offer) {
      this.goneT = (this.goneT || 0) + dt;
      if (this.goneT > 10) {
        this.goneT = 0;
        PP.Game.finish(false, 'The shift broke up — whoever was running the floor left.');
      }
      return;
    }
    this.goneT = 0;
    if (this.offer.epoch && this.offer.epoch !== this.session.epoch) {
      this.epochT = (this.epochT || 0) + 1;
      if (this.epochT > 90) {                    // ~1.5 s of disagreement, not a blip
        this.epochT = 0;
        PP.UI.toast('A new shift is starting — following the room.');
        PP.UI.startGame();
      }
    } else this.epochT = 0;
  },

  /* ═════════ moments ═════════ */
  emitEvt: function (o) {
    if (!this.room) return;
    this.room.emit('evt', o).catch(function () {});
  },

  onEvt: function (msg) {
    var g = PP.Game, d = msg.data;
    if (!d || typeof d !== 'object' || msg.isMe) return;
    var who = this.players[msg.peer];
    switch (d.k) {
      case 'nd': this.remoteDone(d.i, 'node', who); break;
      case 'tk': this.remoteDone(d.i, 'task', who); break;
      case 'gr': this.takeHit(msg, d); break;
      case 'rv':
        // scoped to the knockdown it answers, so a re-sent one cannot lift us
        // out of a later one
        if (d.p === this.me && g.running && g.player && g.player.downed &&
            d.d === (g.player.downId || 0)) {
          g.reviveMe(who ? who.name : 'Someone');
        }
        break;
      case 'dn': if (who && who.inShift) PP.UI.toast(who.name + ' is down.', 'bad'); break;
      case 'up': if (who && who.inShift) PP.UI.toast(who.name + ' is back up.', 'good'); break;
      case 'end':
        if (!g.running || g.over) return;
        if (!who || !who.everIn) return;
        g.finish(!!d.w, this.clean(d.r, 120) || 'The shift ended.');
        break;
      case 'fl':
        if (g.running && who && who.inShift) {
          g.flare(this.num(d.x, -1e5, 1e5, 0), this.num(d.y, -1e5, 1e5, 0));
        }
        break;
    }
  },

  remoteDone: function (id, kind, who) {
    var g = PP.Game;
    if (!g.running || g.over || typeof id !== 'number') return;
    if (who && !who.everIn) return;
    var p = PP.World.propById(id | 0);
    if (!p || p.kind !== kind || p.done) return;
    p.done = true; p.charge = 1; p.progress = 1;
    if (p.sockets) p.sockets.forEach(function (s) { s.heldBy = null; });
    var name = who ? who.name : 'Someone';
    if (kind === 'node') {
      g.nodesDone++;
      PP.Audio.good();
      PP.UI.toast(name + ' brought node ' + g.nodesDone + ' of 5 online.', 'good');
      if (g.nodesDone >= 5 && !g.power) {
        g.power = true;
        PP.World.props.forEach(function (q) { if (q.kind === 'lift') q.armed = true; });
        PP.UI.toast('POWER RESTORED — the lift is live.', 'good');
        PP.Audio.alarm();
      }
    } else {
      g.tasksDone++;
      PP.UI.toast(name + ' finished ' + this.clean(p.title, 40).toLowerCase() + '.', 'good');
    }
    g.updateObjective();
  },

  /** Someone says their grab landed on us. Only believe it if they were close. */
  takeHit: function (msg, d) {
    var g = PP.Game;
    if (d.p !== this.me || !g.running || g.over || !g.player) return;
    if (g.player.downed || g.player.invuln > 0 || g.cine) return;
    var who = this.players[msg.peer];
    if (!who || !who.have || !who.inShift || !who.isMonster) return;
    if (PP.U.dist(who.x, who.y, g.player.x, g.player.y) > 240) return;
    g.onCatch(who, g.player);
  },

  /** Our monster's swipe connected with a remote player. */
  claimCatch: function (victim) {
    if (!victim || !victim.peer || victim.downed) return;
    victim.downed = true; victim.caught = true;     // shows instantly, presence confirms
    this.emitEvt({ k: 'gr', p: victim.peer });
    PP.UI.toast('You got ' + victim.name + '.', 'good');
  },

  nodeDone: function (p) { this.emitEvt({ k: 'nd', i: p.id }); },
  taskDone: function (p) { this.emitEvt({ k: 'tk', i: p.id }); },
  wentDown: function () { this.emitEvt({ k: 'dn' }); },
  gotUp: function () { this.emitEvt({ k: 'up' }); },
  /**
   * Nothing here is guaranteed to arrive, and this one matters, so say it
   * thrice — the knockdown id makes the repeats harmless.
   */
  revive: function (rp, downId) {
    var self = this, id = rp.peer, d = downId || 0;
    var send = function () { self.emitEvt({ k: 'rv', p: id, d: d }); };
    send();
    setTimeout(send, 220);
    setTimeout(send, 520);
  },
  flared: function (x, y) { this.emitEvt({ k: 'fl', x: Math.round(x), y: Math.round(y) }); },
  endRound: function (win, reason) {
    this.emitEvt({ k: 'end', w: win ? 1 : 0, r: String(reason).slice(0, 120) });
    if (!PP.Game.over) PP.Game.finish(win, reason);
  },

  /* ═════════ talking ═════════ */
  say: function (line) {
    if (!this.room) return;
    this.room.emit('say', { t: String(line).slice(0, 60), n: ++this.sayN })
      .catch(function () {});
  },
  onSay: function (msg) {
    if (msg.isMe) return;
    var line = this.clean(msg.data && msg.data.t, 60);
    if (!line) return;
    var rp = this.players[msg.peer];
    var name = rp ? rp.name
                  : (this.clean((this.presenceOf(msg.peer) || {}).nm, 14) || 'Someone');
    if (rp) rp.say(line, 3.4);
    PP.UI.subtitle(name, line);
  },

  /* ═════════ roster for the UI ═════════ */
  roster: function () {
    var out = [], i;
    var playing = PP.Game.running && !PP.Game.over;
    if (this.online) {
      out.push({ name: this.clean(PP.Save.data.name || 'New Hire', 14) || 'New Hire',
                 me: true, host: this.isHost,
                 what: playing ? (PP.Game.asMonster ? 'hunting' : 'on shift') : 'in the lobby',
                 down: !!(PP.Game.player && PP.Game.player.downed) });
    }
    for (i = 0; i < this.peerList.length; i++) {
      var p = this.peerList[i];
      if (p.kind !== 'viewer' || p.peer === this.me) continue;
      var pr = p.presence || {};
      var rp = this.players[p.peer];
      out.push({
        name: this.clean(pr.nm, 14) || 'Someone',
        me: false, host: p.peer === this.hostPeer,
        what: (rp && rp.inShift) ? (rp.isMonster ? 'hunting' : 'on shift')
            : (pr.ep ? 'in another shift' : 'in the lobby'),
        down: !!(rp && rp.downed)
      });
    }
    return out;
  },

  /** The shift ended, or we walked out of it. Stop advertising a factory. */
  leaveSession: function () {
    this.wantHost = false;
    this.wipeT = 0; this.epochT = 0;
    this.push();
  },

  refresh: function () { if (PP.UI && PP.UI.netRefresh) PP.UI.netRefresh(); }
};
