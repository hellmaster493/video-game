/* ═══════════════════════════════════════════════════════════
   world.js — the factory floor: tiles, rooms, vents, props,
   collision, line-of-sight and A* pathfinding.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.TILE = 32;
PP.T = { VOID: 0, FLOOR: 1, WALL: 2, VENT: 3, CARPET: 4, CONVEYOR: 5, CHECKER: 6, GRATE: 7 };

/* Room rectangles are in tiles: [x, y, w, h]. */
PP.ROOMS = [
  { id: 'lobby',     name: 'Main Lobby',    r: [6, 6, 24, 16],  floor: PP.T.CHECKER },
  { id: 'giftshop',  name: 'Gift Shop',     r: [34, 6, 16, 11], floor: PP.T.CARPET },
  { id: 'breakroom', name: 'Break Room',    r: [54, 6, 14, 10], floor: PP.T.CARPET },
  { id: 'generator', name: 'Generator Bay', r: [74, 6, 18, 14], floor: PP.T.FLOOR },
  { id: 'assembly',  name: 'Assembly Line', r: [6, 26, 28, 16], floor: PP.T.FLOOR },
  { id: 'vault',     name: 'Toy Vault',     r: [38, 22, 18, 14], floor: PP.T.CARPET },
  { id: 'control',   name: 'Control Room',  r: [60, 24, 16, 12], floor: PP.T.FLOOR },
  { id: 'gamestn',   name: 'Game Station',  r: [6, 46, 22, 16], floor: PP.T.CHECKER },
  { id: 'warehouse', name: 'Warehouse',     r: [32, 40, 24, 20], floor: PP.T.FLOOR },
  { id: 'venthub',   name: 'Vent Hub',      r: [60, 42, 12, 10], floor: PP.T.GRATE },
  { id: 'liftbay',   name: 'Lift Bay',      r: [78, 44, 14, 14], floor: PP.T.FLOOR }
];

/* [x, y, w, h] carved as open floor — the halls between rooms. */
PP.HALLS = [
  [28, 12, 8, 3],   // lobby → gift shop
  [48, 10, 8, 3],   // gift shop → break room
  [66, 10, 10, 3],  // break room → generator
  [16, 20, 4, 8],   // lobby → assembly
  [32, 28, 8, 3],   // assembly → vault
  [54, 28, 8, 3],   // vault → control
  [63, 34, 4, 10],  // control → vent hub
  [16, 40, 4, 8],   // assembly → game station
  [26, 50, 8, 3],   // game station → warehouse
  [54, 46, 8, 3],   // warehouse → vent hub
  [70, 46, 10, 3],  // vent hub → lift bay
  [81, 18, 4, 13],  // generator down
  [74, 29, 11, 3],  // ...into control room
  [44, 34, 3, 8]    // vault → warehouse
];

/* Crawl shortcuts: [x1, y1, x2, y2] single-tile lines. */
PP.VENTS = [
  [44, 16, 44, 23],  // gift shop ↔ toy vault
  [64, 15, 64, 25],  // break room ↔ control room
  [56, 54, 79, 54],  // warehouse ↔ lift bay (the long crawl)
  [26, 21, 26, 27]   // lobby ↔ assembly
];

/** Minimal binary min-heap — keeps A* linear-scan-free on the big grid. */
PP.Heap = function () { this.n = []; this.p = []; this.size = 0; };
PP.Heap.prototype.push = function (node, pri) {
  var i = this.size++;
  this.n[i] = node; this.p[i] = pri;
  while (i > 0) {
    var par = (i - 1) >> 1;
    if (this.p[par] <= this.p[i]) break;
    this.swap(i, par); i = par;
  }
};
PP.Heap.prototype.pop = function () {
  var top = this.n[0];
  this.size--;
  if (this.size > 0) {
    this.n[0] = this.n[this.size]; this.p[0] = this.p[this.size];
    var i = 0;
    for (;;) {
      var l = i * 2 + 1, r = l + 1, m = i;
      if (l < this.size && this.p[l] < this.p[m]) m = l;
      if (r < this.size && this.p[r] < this.p[m]) m = r;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
  }
  return top;
};
PP.Heap.prototype.swap = function (a, b) {
  var tn = this.n[a], tp = this.p[a];
  this.n[a] = this.n[b]; this.p[a] = this.p[b];
  this.n[b] = tn; this.p[b] = tp;
};

PP.World = {
  W: 100, H: 66, grid: null, rooms: [], props: [], detail: [], lamps: [],

  build: function (seed) {
    var T = PP.T, W = this.W, H = this.H, i, j, r;
    this.grid = new Uint8Array(W * H);          // starts as VOID
    this.rooms = []; this.props = []; this.detail = []; this.lamps = [];
    var rnd = PP.rng(seed || 1337);

    // ── carve rooms (floor + one-tile wall ring) ──
    for (i = 0; i < PP.ROOMS.length; i++) {
      var def = PP.ROOMS[i]; r = def.r;
      this.rect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2, T.WALL);
      this.rect(r[0], r[1], r[2], r[3], def.floor);
      this.rooms.push({
        id: def.id, name: def.name, x: r[0], y: r[1], w: r[2], h: r[3],
        cx: (r[0] + r[2] / 2) * PP.TILE, cy: (r[1] + r[3] / 2) * PP.TILE
      });
    }
    // ── carve halls (walled the same way) ──
    for (i = 0; i < PP.HALLS.length; i++) {
      var h = PP.HALLS[i];
      this.rect(h[0] - 1, h[1] - 1, h[2] + 2, h[3] + 2, T.WALL, true);
      this.rect(h[0], h[1], h[2], h[3], T.FLOOR);
    }
    // ── carve vents ──
    for (i = 0; i < PP.VENTS.length; i++) {
      var v = PP.VENTS[i];
      var dx = Math.sign(v[2] - v[0]), dy = Math.sign(v[3] - v[1]);
      var x = v[0], y = v[1], guard = 0;
      while (guard++ < 400) {
        // wall off the sides so a vent reads as a duct, not a room
        if (dx !== 0) { this.setIfVoid(x, y - 1, T.WALL); this.setIfVoid(x, y + 1, T.WALL); }
        else          { this.setIfVoid(x - 1, y, T.WALL); this.setIfVoid(x + 1, y, T.WALL); }
        this.set(x, y, T.VENT);
        if (x === v[2] && y === v[3]) break;
        x += dx; y += dy;
      }
    }
    // conveyor belts down the assembly line
    var asm = this.room('assembly');
    for (j = 0; j < 3; j++) {
      var cy = asm.y + 3 + j * 5;
      for (i = asm.x + 2; i < asm.x + asm.w - 2; i++) this.set(i, cy, T.CONVEYOR);
    }
    this.buildLamps(rnd);
    this.buildProps(rnd);
    this.buildDetail(rnd);
    return this;
  },

  /** Ceiling strip lights on a grid — big rooms need more than one bulb. */
  buildLamps: function (rnd) {
    var T = PP.TILE, i, j;
    for (i = 0; i < this.rooms.length; i++) {
      var r = this.rooms[i];
      // a real factory grid is dense; sparse fittings leave the walls unlit
      var stepX = Math.max(4, Math.round(r.w / Math.max(1, Math.round(r.w / 5))));
      var stepY = Math.max(4, Math.round(r.h / Math.max(1, Math.round(r.h / 5))));
      for (var ly = r.y + Math.floor(stepY / 2); ly < r.y + r.h; ly += stepY)
        for (var lx = r.x + Math.floor(stepX / 2); lx < r.x + r.w; lx += stepX)
          this.lamps.push({ x: lx * T + T / 2, y: ly * T + T / 2, r: 300,
                            dead: rnd() < 0.10, emg: rnd() < 0.30, ph: rnd() * 6.28 });
    }
    for (i = 0; i < PP.HALLS.length; i++) {
      var h = PP.HALLS[i];
      var horiz = h[2] >= h[3];
      var n = Math.max(1, Math.floor((horiz ? h[2] : h[3]) / 4));
      for (j = 0; j < n; j++) {
        var f = (j + 0.5) / n;
        this.lamps.push({
          x: (h[0] + (horiz ? f * h[2] : h[2] / 2)) * T,
          y: (h[1] + (horiz ? h[3] / 2 : f * h[3])) * T,
          r: 220, dead: rnd() < 0.18, emg: rnd() < 0.3, ph: rnd() * 6.28
        });
      }
    }
  },

  /* ── grid helpers ─────────────────────────────────────── */
  idx: function (tx, ty) { return ty * this.W + tx; },
  set: function (tx, ty, v) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return;
    this.grid[ty * this.W + tx] = v;
  },
  setIfVoid: function (tx, ty, v) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return;
    if (this.grid[ty * this.W + tx] === PP.T.VOID) this.grid[ty * this.W + tx] = v;
  },
  rect: function (x, y, w, h, v, onlyVoid) {
    for (var j = y; j < y + h; j++)
      for (var i = x; i < x + w; i++)
        onlyVoid ? this.setIfVoid(i, j, v) : this.set(i, j, v);
  },
  at: function (tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return PP.T.VOID;
    return this.grid[ty * this.W + tx];
  },
  atPx: function (x, y) { return this.at(Math.floor(x / PP.TILE), Math.floor(y / PP.TILE)); },
  solid: function (tx, ty) { var t = this.at(tx, ty); return t === PP.T.VOID || t === PP.T.WALL; },
  solidPx: function (x, y) { return this.solid(Math.floor(x / PP.TILE), Math.floor(y / PP.TILE)); },
  isVent: function (x, y) { return this.atPx(x, y) === PP.T.VENT; },
  isLoud: function (x, y) { var t = this.atPx(x, y); return t === PP.T.GRATE || t === PP.T.CONVEYOR; },

  room: function (id) {
    for (var i = 0; i < this.rooms.length; i++) if (this.rooms[i].id === id) return this.rooms[i];
    return this.rooms[0];
  },
  roomAt: function (x, y) {
    var tx = Math.floor(x / PP.TILE), ty = Math.floor(y / PP.TILE);
    for (var i = 0; i < this.rooms.length; i++) {
      var r = this.rooms[i];
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
    }
    return null;
  },
  roomName: function (x, y) {
    var r = this.roomAt(x, y);
    if (r) return r.name;
    return this.isVent(x, y) ? 'Air Duct' : 'Corridor';
  },
  /** a random walkable point inside a room, clear of props */
  spotIn: function (r, pad) {
    pad = pad || 1;
    for (var n = 0; n < 60; n++) {
      var tx = PP.U.randInt(r.x + pad, r.x + r.w - 1 - pad),
          ty = PP.U.randInt(r.y + pad, r.y + r.h - 1 - pad);
      if (this.solid(tx, ty)) continue;
      var px = tx * PP.TILE + PP.TILE / 2, py = ty * PP.TILE + PP.TILE / 2;
      if (this.propNear(px, py, 26)) continue;
      return { x: px, y: py };
    }
    return { x: r.cx, y: r.cy };
  },
  randomRoom: function () { return PP.U.pick(this.rooms); },

  /* ── props ────────────────────────────────────────────── */
  addProp: function (p) { p.id = this.props.length; this.props.push(p); return p; },
  propNear: function (x, y, rad) {
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i];
      if (PP.U.dist2(x, y, p.x, p.y) < rad * rad) return p;
    }
    return null;
  },

  buildProps: function (rnd) {
    var self = this, TL = PP.TILE;
    function put(kind, room, extra) {
      var r = self.room(room), s = self.spotIn(r, 1);
      var p = Object.assign({ kind: kind, x: s.x, y: s.y, room: room, rad: 16 }, extra || {});
      return self.addProp(p);
    }

    // Power nodes — the Night Shift objective. Two sockets, one per hand.
    ['generator', 'control', 'assembly', 'warehouse', 'gamestn'].forEach(function (rm, i) {
      put('node', rm, { rad: 30, done: false, charge: 0, label: 'Power Node ' + (i + 1) });
    });

    // Work stations — the roleplay jobs.
    var jobs = [
      ['assembly',  'Sort the conveyor',      'Sorting parts'],
      ['giftshop',  'Restock the shelves',    'Restocking'],
      ['vault',     'Log the toy inventory',  'Logging'],
      ['gamestn',   'Reset the arcade',       'Rebooting'],
      ['warehouse', 'Stack the pallets',      'Stacking'],
      ['breakroom', 'Clean the coffee maker', 'Scrubbing'],
      ['control',   'Run the camera check',   'Checking'],
      ['generator', 'Grease the turbines',    'Greasing']
    ];
    jobs.forEach(function (j) {
      put('task', j[0], { rad: 26, title: j[1], verb: j[2], done: false, progress: 0, pay: 25 });
    });

    // Lockers to hide in.
    ['lobby', 'giftshop', 'breakroom', 'assembly', 'vault', 'control',
     'gamestn', 'warehouse', 'generator'].forEach(function (rm) {
      put('locker', rm, { rad: 22, open: false });
      if (rnd() < 0.6) put('locker', rm, { rad: 22, open: false });
    });

    // The way out.
    var lb = this.room('liftbay');
    this.addProp({ kind: 'lift', x: lb.cx, y: lb.cy, rad: 46, room: 'liftbay', armed: false });

    // Flavour clutter — blocks sight lines, gives the rooms a shape.
    var clutter = { giftshop: 'shelf', vault: 'shelf', warehouse: 'crate', generator: 'crate',
                    gamestn: 'arcade', breakroom: 'table', lobby: 'plant', control: 'desk',
                    assembly: 'crate' };
    Object.keys(clutter).forEach(function (rm) {
      var n = 4 + Math.floor(rnd() * 4);
      for (var i = 0; i < n; i++) put(clutter[rm], rm, { rad: 20, block: true, seed: rnd() });
    });

    // Toy pile in the vault — pure atmosphere.
    var v = this.room('vault');
    for (var i = 0; i < 10; i++) {
      this.addProp({ kind: 'toy', x: v.cx + PP.U.rand(-140, 140), y: v.cy + PP.U.rand(-90, 90),
                     rad: 10, hue: Math.floor(rnd() * 360), seed: rnd() });
    }
  },

  /* Static scuffs and stains, generated once so the floor isn't flat. */
  buildDetail: function (rnd) {
    for (var i = 0; i < 260; i++) {
      var tx = Math.floor(rnd() * this.W), ty = Math.floor(rnd() * this.H);
      if (this.solid(tx, ty)) continue;
      this.detail.push({
        x: tx * PP.TILE + rnd() * PP.TILE, y: ty * PP.TILE + rnd() * PP.TILE,
        r: 4 + rnd() * 16, a: 0.03 + rnd() * 0.05, rot: rnd() * 6.28
      });
    }
  },

  /* ── movement collision: circle vs tiles, resolved per axis ── */
  move: function (ent, dx, dy) {
    var R = ent.rad;
    if (dx) {
      var nx = ent.x + dx;
      if (!this.blocked(nx, ent.y, R)) ent.x = nx;
      else {
        // slide: nudge along the wall so corners don't grab you
        var s = dx > 0 ? -1 : 1;
        if (!this.blocked(ent.x, ent.y + s * 2, R) && !this.blocked(nx, ent.y + s * 2, R)) ent.y += s * 2;
      }
    }
    if (dy) {
      var ny = ent.y + dy;
      if (!this.blocked(ent.x, ny, R)) ent.y = ny;
    }
  },
  /** true if a circle at (x,y) overlaps any solid tile or blocking prop */
  blocked: function (x, y, R) {
    var T = PP.TILE;
    var x0 = Math.floor((x - R) / T), x1 = Math.floor((x + R) / T);
    var y0 = Math.floor((y - R) / T), y1 = Math.floor((y + R) / T);
    for (var ty = y0; ty <= y1; ty++)
      for (var tx = x0; tx <= x1; tx++)
        if (this.solid(tx, ty)) {
          var cx = PP.U.clamp(x, tx * T, tx * T + T), cy = PP.U.clamp(y, ty * T, ty * T + T);
          if (PP.U.dist2(x, y, cx, cy) < R * R) return true;
        }
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i];
      if (!p.block) continue;
      var rr = R + p.rad * 0.55;
      if (PP.U.dist2(x, y, p.x, p.y) < rr * rr) return true;
    }
    return false;
  },

  /** DDA ray march — is there a clear sight line between two points? */
  lineClear: function (x1, y1, x2, y2) {
    var T = PP.TILE, d = PP.U.dist(x1, y1, x2, y2);
    var steps = Math.ceil(d / (T * 0.5));
    if (steps <= 0) return true;
    var sx = (x2 - x1) / steps, sy = (y2 - y1) / steps;
    for (var i = 1; i < steps; i++)
      if (this.solidPx(x1 + sx * i, y1 + sy * i)) return false;
    return true;
  },

  /* ── A* over the tile grid ────────────────────────────── */
  path: function (sx, sy, gx, gy, opts) {
    var T = PP.TILE, W = this.W, H = this.H;
    var s = { x: Math.floor(sx / T), y: Math.floor(sy / T) };
    var g = { x: Math.floor(gx / T), y: Math.floor(gy / T) };
    if (this.solid(g.x, g.y)) { g = this.nearestOpen(g.x, g.y); if (!g) return null; }
    if (this.solid(s.x, s.y)) { s = this.nearestOpen(s.x, s.y); if (!s) return null; }
    var noVent = opts && opts.noVent;
    var start = s.y * W + s.x, goal = g.y * W + g.x;
    if (start === goal) return [{ x: gx, y: gy }];

    var came = new Int32Array(W * H).fill(-1);
    var gScore = new Float32Array(W * H).fill(Infinity);
    var closed = new Uint8Array(W * H);
    var heap = new PP.Heap();
    gScore[start] = 0;
    heap.push(start, 0);
    var dirs = [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1];
    var expanded = 0, LIMIT = 6000;

    while (heap.size && expanded++ < LIMIT) {
      var cur = heap.pop();
      if (cur === goal) return this.rebuild(came, cur, gx, gy);
      if (closed[cur]) continue;
      closed[cur] = 1;

      var cx = cur % W, cy = (cur / W) | 0;
      for (var d = 0; d < 8; d++) {
        var nb = cur + dirs[d], bx = nb % W, by = (nb / W) | 0;
        if (bx < 0 || by < 0 || bx >= W || by >= H) continue;
        if (Math.abs(bx - cx) > 1 || Math.abs(by - cy) > 1) continue;   // wrapped row
        if (closed[nb]) continue;
        var t = this.grid[nb];
        if (t === PP.T.VOID || t === PP.T.WALL) continue;
        if (noVent && t === PP.T.VENT) continue;
        if (d >= 4 && (this.solid(bx, cy) || this.solid(cx, by))) continue;  // no corner cutting
        var step = (d >= 4 ? 1.414 : 1) + (t === PP.T.VENT ? 1.2 : 0);
        var tg = gScore[cur] + step;
        if (tg < gScore[nb]) {
          gScore[nb] = tg;
          came[nb] = cur;
          // octile heuristic, matching the movement cost model
          var ax = Math.abs(bx - g.x), ay = Math.abs(by - g.y);
          heap.push(nb, tg + (ax + ay) + (1.414 - 2) * Math.min(ax, ay));
        }
      }
    }
    return null;
  },
  rebuild: function (came, cur, gx, gy) {
    var T = PP.TILE, out = [], guard = 0;
    while (cur >= 0 && guard++ < 4000) {
      out.push({ x: (cur % this.W) * T + T / 2, y: ((cur / this.W) | 0) * T + T / 2 });
      cur = came[cur];
    }
    out.reverse();
    if (out.length) { out[out.length - 1] = { x: gx, y: gy }; }
    return out;
  },
  nearestOpen: function (tx, ty) {
    for (var r = 1; r < 12; r++)
      for (var j = -r; j <= r; j++)
        for (var i = -r; i <= r; i++) {
          if (Math.abs(i) !== r && Math.abs(j) !== r) continue;
          if (!this.solid(tx + i, ty + j)) return { x: tx + i, y: ty + j };
        }
    return null;
  }
};
