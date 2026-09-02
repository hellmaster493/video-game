/* ═══════════════════════════════════════════════════════════
   world.js — the factory floor: tiles, rooms, vents, props,
   collision, line-of-sight and A* pathfinding.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.TILE = 32;
PP.T = { VOID: 0, FLOOR: 1, WALL: 2, VENT: 3, CARPET: 4, CONVEYOR: 5, CHECKER: 6, GRATE: 7 };

PP.FLOORS = {
  floor: PP.T.FLOOR, wall: PP.T.WALL, vent: PP.T.VENT, carpet: PP.T.CARPET,
  conveyor: PP.T.CONVEYOR, checker: PP.T.CHECKER, grate: PP.T.GRATE
};

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
  halls: [], ventLines: [], map: null,

  build: function (seed, mapId) {
    var T = PP.T, i, j, r;
    var map = this.map = PP.getMap(mapId || 'factory');
    this.W = map.W; this.H = map.H;
    var W = this.W, H = this.H;
    this.grid = new Uint8Array(W * H);          // starts as VOID
    this.rooms = []; this.props = []; this.detail = []; this.lamps = [];
    this.halls = []; this.ventLines = (map.vents || []).slice();
    var rnd = PP.rng(seed || 1337);

    // ── carve rooms (floor + one-tile wall ring) ──
    for (i = 0; i < map.rooms.length; i++) {
      var def = map.rooms[i]; r = def.r;
      this.rect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2, T.WALL);
      this.rect(r[0], r[1], r[2], r[3], PP.FLOORS[def.floor] || T.FLOOR);
      this.rooms.push({
        id: def.id, name: def.name, def: def, tags: def.tags || [],
        x: r[0], y: r[1], w: r[2], h: r[3],
        cx: (r[0] + r[2] / 2) * PP.TILE, cy: (r[1] + r[3] / 2) * PP.TILE
      });
    }
    // ── hand-placed halls, where a map wants a specific shape ──
    (map.halls || []).forEach(function (h) { this.carveHall(h[0], h[1], h[2], h[3]); }, this);
    // ── links: an L-shaped corridor between two room centres ──
    (map.links || []).forEach(function (l) { this.carveLink(l[0], l[1]); }, this);

    // ── carve vents ──
    for (i = 0; i < this.ventLines.length; i++) {
      var v = this.ventLines[i];
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
    // conveyor belts, for rooms that asked for them
    this.rooms.forEach(function (room) {
      var n = room.def.belts || 0;
      for (var b = 0; b < n; b++) {
        var cy = room.y + 3 + Math.floor(b * (room.h - 6) / Math.max(1, n - 1 || 1));
        for (var cx = room.x + 2; cx < room.x + room.w - 2; cx++) this.set(cx, cy, T.CONVEYOR);
      }
    }, this);

    this.buildLamps(rnd);
    this.buildProps(rnd);
    this.buildDetail(rnd);
    return this;
  },

  /** Carve one open rectangle and remember it for the minimap. */
  carveHall: function (x, y, w, h) {
    this.rect(x - 1, y - 1, w + 2, h + 2, PP.T.WALL, true);
    this.rect(x, y, w, h, PP.T.FLOOR);
    this.halls.push([x, y, w, h]);
  },

  /** An L-shaped corridor between two room centres, three tiles wide. */
  carveLink: function (aId, bId) {
    var a = this.room(aId), b = this.room(bId);
    if (!a || !b) return;
    var ax = Math.round(a.x + a.w / 2), ay = Math.round(a.y + a.h / 2);
    var bx = Math.round(b.x + b.w / 2), by = Math.round(b.y + b.h / 2);
    var x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
    var y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    // run along whichever axis is longer first, so corridors hug the rooms
    if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
      this.carveHall(x0 - 1, ay - 1, x1 - x0 + 3, 3);
      this.carveHall(bx - 1, y0 - 1, 3, y1 - y0 + 3);
    } else {
      this.carveHall(ax - 1, y0 - 1, 3, y1 - y0 + 3);
      this.carveHall(x0 - 1, by - 1, x1 - x0 + 3, 3);
    }
  },

  /** First room carrying a tag, with a sensible fallback. */
  tagged: function (tag, fallback) {
    for (var i = 0; i < this.rooms.length; i++) {
      if (this.rooms[i].tags.indexOf(tag) >= 0) return this.rooms[i];
    }
    return fallback ? this.room(fallback) : this.rooms[0];
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
    for (i = 0; i < this.halls.length; i++) {
      var h = this.halls[i];
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
    var self = this;
    function put(kind, room, extra) {
      var s = self.spotIn(room, 1);
      return self.addProp(Object.assign({ kind: kind, x: s.x, y: s.y, room: room.id, rad: 16 },
                                        extra || {}));
    }

    var nodeIdx = 0;
    this.rooms.forEach(function (room) {
      var d = room.def;
      if (d.node) {
        put('node', room, { rad: 30, done: false, charge: 0,
                            label: 'Power Node ' + (++nodeIdx) });
      }
      if (d.job) {
        put('task', room, { rad: 26, title: d.job[0], verb: d.job[1],
                            done: false, progress: 0, pay: 25 });
      }
      for (var l = 0; l < (d.lockers || 0); l++) put('locker', room, { rad: 22, open: false });
      var n = d.clutter ? 4 + Math.floor(rnd() * 4) : 0;
      for (var c = 0; c < n; c++) {
        put(d.clutter, room, { rad: 20, block: true, seed: rnd() });
      }
      for (var t = 0; t < (d.toys || 0); t++) {
        var sp = self.spotIn(room, 1);
        self.addProp({ kind: 'toy', x: sp.x, y: sp.y, rad: 10,
                       hue: Math.floor(rnd() * 360), seed: rnd() });
      }
    });

    // The way out.
    var ex = this.tagged('exit');
    this.addProp({ kind: 'lift', x: ex.cx, y: ex.cy, rad: 46, room: ex.id, armed: false });
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
