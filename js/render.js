/* ═══════════════════════════════════════════════════════════
   render.js — everything you see. Tiles, characters, torch
   lighting, minimap. No image assets: it is all drawn.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Render = {
  cv: null, ctx: null, light: null, lctx: null,
  w: 0, h: 0, dpr: 1, t: 0, zoom: 1.6,

  init: function (canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d');
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    this.resize();
  },

  resize: function () {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.cv.clientWidth || window.innerWidth;
    this.h = this.cv.clientHeight || window.innerHeight;
    this.cv.width = Math.floor(this.w * this.dpr);
    this.cv.height = Math.floor(this.h * this.dpr);
    this.light.width = this.cv.width;
    this.light.height = this.cv.height;
  },

  /* ═════════ main frame ═════════ */
  draw: function (game, dt) {
    var c = this.ctx, W = this.w, H = this.h;
    this.t += dt;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#05070c';
    c.fillRect(0, 0, W, H);

    var cam = game.cam, z = this.zoom;
    c.save();
    this.worldTransform(c, cam);

    var hw = W / (2 * z), hh = H / (2 * z);
    var view = {
      x0: cam.x - hw - 64, y0: cam.y - hh - 64,
      x1: cam.x + hw + 64, y1: cam.y + hh + 64
    };

    this.drawTiles(view);
    this.drawDetail(view);
    this.drawLamps(game, view);
    this.drawProps(game, view);
    this.drawActors(game, view);
    c.restore();

    this.drawLighting(game);
    this.drawGlows(game);
    this.drawScreenFx(game);
  },

  /** Camera transform shared by the scene, the light mask and the glow pass. */
  worldTransform: function (c, cam) {
    c.translate(this.w / 2, this.h / 2);
    c.scale(this.zoom, this.zoom);
    c.translate(-cam.x, -cam.y);
  },

  /* ═════════ floor & walls ═════════ */
  drawTiles: function (v) {
    var c = this.ctx, T = PP.TILE, W = PP.World, Tt = PP.T;
    var x0 = Math.max(0, Math.floor(v.x0 / T)), x1 = Math.min(W.W - 1, Math.ceil(v.x1 / T));
    var y0 = Math.max(0, Math.floor(v.y0 / T)), y1 = Math.min(W.H - 1, Math.ceil(v.y1 / T));

    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var t = W.at(tx, ty);
        if (t === Tt.VOID) continue;
        var px = tx * T, py = ty * T;

        if (t === Tt.WALL) { this.wallTile(c, px, py, T, tx, ty); continue; }

        // floor base
        var base = '#39414f';
        if (t === Tt.CHECKER) base = ((tx + ty) & 1) ? '#4a5468' : '#39414f';
        else if (t === Tt.CARPET) base = ((tx + ty) & 1) ? '#6b3a4c' : '#5e3343';
        else if (t === Tt.CONVEYOR) base = '#434b5b';
        else if (t === Tt.GRATE) base = '#2d3440';
        else if (t === Tt.VENT) base = '#20252e';
        c.fillStyle = base;
        c.fillRect(px, py, T, T);

        if (t === Tt.FLOOR || t === Tt.CHECKER) {
          c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 1;
          c.strokeRect(px + .5, py + .5, T - 1, T - 1);
        } else if (t === Tt.CONVEYOR) {
          // belt slats scrolling toward +x
          var off = (this.t * 26) % 12;
          c.fillStyle = 'rgba(255,255,255,.055)';
          for (var s = -12; s < T; s += 12) c.fillRect(px + s + off, py + 3, 5, T - 6);
          c.fillStyle = 'rgba(0,0,0,.3)';
          c.fillRect(px, py, T, 3); c.fillRect(px, py + T - 3, T, 3);
        } else if (t === Tt.GRATE) {
          c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 2;
          for (var g = 4; g < T; g += 7) {
            c.beginPath(); c.moveTo(px + g, py); c.lineTo(px + g, py + T); c.stroke();
          }
          c.strokeStyle = 'rgba(255,255,255,.05)';
          c.strokeRect(px + .5, py + .5, T - 1, T - 1);
        } else if (t === Tt.VENT) {
          c.strokeStyle = 'rgba(255,255,255,.045)'; c.lineWidth = 2;
          for (var r = 6; r < T; r += 9) {
            c.beginPath(); c.moveTo(px, py + r); c.lineTo(px + T, py + r); c.stroke();
          }
        }
      }
    }
  },

  /** the fixtures themselves, so a lit room looks furnished from above */
  drawLamps: function (game, v) {
    var c = this.ctx, L = PP.World.lamps;
    for (var i = 0; i < L.length; i++) {
      var l = L[i];
      if (l.x < v.x0 || l.x > v.x1 || l.y < v.y0 || l.y > v.y1) continue;
      var on = this.lampLevel(game, l);
      c.fillStyle = '#1d222c';
      c.fillRect(l.x - 17, l.y - 6, 34, 12);
      c.fillStyle = on <= 0.02 ? '#2b303a' : (game.power ? '#fff6dc' : '#ffb27a');
      c.globalAlpha = 0.3 + on * 0.7;
      c.fillRect(l.x - 14, l.y - 4, 28, 8);
      c.globalAlpha = 1;
    }
  },

  /** 0..1 brightness — dead tubes flicker, unpowered rooms run on emergency light */
  lampLevel: function (game, l) {
    if (game.power) {
      if (l.dead) return Math.abs(Math.sin(this.t * 9 + l.ph)) > 0.82 ? 1 : 0.05;
      return 1;
    }
    if (!l.emg) return 0;                       // dead circuit, no light at all
    return 0.30 + Math.abs(Math.sin(this.t * 1.4 + l.ph)) * 0.16;
  },

  wallTile: function (c, px, py, T, tx, ty) {
    var W = PP.World;
    var openBelow = !W.solid(tx, ty + 1);
    c.fillStyle = openBelow ? '#6c778f' : '#4b5468';
    c.fillRect(px, py, T, T);
    // top highlight + panel seam
    c.fillStyle = 'rgba(255,255,255,.06)';
    c.fillRect(px, py, T, 3);
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.fillRect(px, py + T - 4, T, 4);
    if (openBelow) {
      // cast a soft shadow onto the floor below
      var grd = c.createLinearGradient(0, py + T, 0, py + T + 14);
      grd.addColorStop(0, 'rgba(0,0,0,.42)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd; c.fillRect(px, py + T, T, 14);
    }
  },

  drawDetail: function (v) {
    var c = this.ctx, d = PP.World.detail;
    c.save();
    for (var i = 0; i < d.length; i++) {
      var s = d[i];
      if (s.x < v.x0 || s.x > v.x1 || s.y < v.y0 || s.y > v.y1) continue;
      c.globalAlpha = s.a;
      c.fillStyle = '#000';
      c.beginPath();
      c.ellipse(s.x, s.y, s.r, s.r * 0.7, s.rot, 0, 6.2832);
      c.fill();
    }
    c.restore();
  },

  /* ═════════ props ═════════ */
  drawProps: function (game, v) {
    var c = this.ctx, props = PP.World.props;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (p.x < v.x0 || p.x > v.x1 || p.y < v.y0 || p.y > v.y1) continue;
      c.save();
      c.translate(p.x, p.y);
      switch (p.kind) {
        case 'node':    this.pNode(c, p); break;
        case 'socket':  this.pSocket(c, p); break;
        case 'task':    this.pTask(c, p); break;
        case 'locker':  this.pLocker(c, p); break;
        case 'lift':    this.pLift(c, p, game); break;
        case 'crate':   this.pCrate(c, p); break;
        case 'shelf':   this.pShelf(c, p); break;
        case 'arcade':  this.pArcade(c, p); break;
        case 'table':   this.pTable(c, p); break;
        case 'plant':   this.pPlant(c, p); break;
        case 'desk':    this.pDesk(c, p); break;
        case 'toy':     this.pToy(c, p); break;
        case 'decoy':   this.pDecoy(c, p); break;
      }
      c.restore();
    }
  },

  shadow: function (c, rx, ry) {
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.beginPath(); c.ellipse(0, ry * 0.5, rx, ry * 0.45, 0, 0, 6.2832); c.fill();
  },

  pNode: function (c, p) {
    this.shadow(c, 24, 20);
    c.fillStyle = '#2b3140'; c.fillRect(-22, -30, 44, 44);
    c.fillStyle = '#1b2029'; c.fillRect(-18, -26, 36, 26);
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 2; c.strokeRect(-22, -30, 44, 44);
    // charge readout
    var pct = p.done ? 1 : p.charge;
    c.fillStyle = p.done ? '#49d67f' : '#e6404f';
    c.fillRect(-16, -8, 32 * pct, 5);
    c.fillStyle = 'rgba(255,255,255,.1)'; c.fillRect(-16, -8, 32, 5);
    c.fillStyle = p.done ? '#49d67f' : (Math.sin(this.t * 6) > 0 ? '#ffc94d' : '#7a5a18');
    c.beginPath(); c.arc(0, -19, 4, 0, 6.2832); c.fill();
  },

  pSocket: function (c, p) {
    var col = p.side === 'l' ? '#e6404f' : '#3c7ff0';
    var lit = p.node.done || p.heldBy;
    c.fillStyle = '#20252f';
    c.beginPath(); c.arc(0, 0, 13, 0, 6.2832); c.fill();
    c.strokeStyle = col; c.lineWidth = 3;
    c.globalAlpha = lit ? 1 : 0.55 + Math.sin(this.t * 4 + (p.side === 'l' ? 0 : 1.6)) * 0.2;
    c.beginPath(); c.arc(0, 0, 13, 0, 6.2832); c.stroke();
    c.fillStyle = col;
    c.beginPath(); c.arc(0, 0, lit ? 7 : 4, 0, 6.2832); c.fill();
    c.globalAlpha = 1;
  },

  pTask: function (c, p) {
    this.shadow(c, 20, 16);
    c.fillStyle = p.done ? '#2c3b31' : '#3b3f4d';
    c.fillRect(-19, -14, 38, 28);
    c.fillStyle = '#22262f'; c.fillRect(-15, -10, 30, 15);
    c.fillStyle = p.done ? '#49d67f' : '#7fd0ff';
    c.globalAlpha = p.done ? 1 : 0.6 + Math.sin(this.t * 3) * 0.25;
    c.fillRect(-13, -8, 26, 11);
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,.14)'; c.lineWidth = 2; c.strokeRect(-19, -14, 38, 28);
    if (!p.done && p.progress > 0) {
      c.fillStyle = '#ffc94d'; c.fillRect(-19, 16, 38 * p.progress, 4);
    }
  },

  pLocker: function (c, p) {
    this.shadow(c, 17, 15);
    c.fillStyle = '#39485c'; c.fillRect(-15, -26, 30, 42);
    c.fillStyle = p.open ? '#0d1117' : '#2e3a4b';
    c.fillRect(-11, -22, 22, 34);
    if (!p.open) {
      c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 1.5;
      for (var i = -16; i < 0; i += 5) {
        c.beginPath(); c.moveTo(-8, i); c.lineTo(8, i); c.stroke();
      }
      c.fillStyle = '#ffc94d'; c.fillRect(7, -3, 3, 7);
    }
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 2; c.strokeRect(-15, -26, 30, 42);
  },

  pLift: function (c, p, game) {
    c.fillStyle = '#171c25'; c.fillRect(-44, -44, 88, 88);
    c.strokeStyle = p.armed ? '#49d67f' : '#5a6478';
    c.lineWidth = 4; c.strokeRect(-44, -44, 88, 88);
    var glow = p.armed ? 0.55 + Math.sin(this.t * 4) * 0.35 : 0.14;
    c.globalAlpha = glow;
    c.fillStyle = p.armed ? '#49d67f' : '#7f8ba0';
    c.fillRect(-38, -38, 76, 76);
    c.globalAlpha = 1;
    c.fillStyle = p.armed ? '#d9ffe8' : '#9aa5ba';
    c.font = 'bold 15px Trebuchet MS'; c.textAlign = 'center';
    c.fillText(p.armed ? 'LIFT ▲' : 'LOCKED', 0, 5);
    c.textAlign = 'left';
  },

  pCrate: function (c, p) {
    this.shadow(c, 20, 17);
    var s = 17 + (p.seed || 0) * 6;
    c.fillStyle = '#6b5334'; c.fillRect(-s, -s, s * 2, s * 2);
    c.fillStyle = '#7d6240'; c.fillRect(-s + 3, -s + 3, s * 2 - 6, s * 2 - 6);
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-s, -s); c.lineTo(s, s); c.moveTo(s, -s); c.lineTo(-s, s); c.stroke();
  },

  pShelf: function (c, p) {
    this.shadow(c, 24, 14);
    c.fillStyle = '#3d4453'; c.fillRect(-26, -15, 52, 30);
    c.fillStyle = '#2a303c'; c.fillRect(-23, -12, 46, 24);
    var rnd = PP.rng(Math.floor((p.seed || 0.5) * 9999));
    for (var i = 0; i < 6; i++) {
      c.fillStyle = 'hsl(' + Math.floor(rnd() * 360) + ',52%,52%)';
      c.fillRect(-21 + i * 7.4, -9 + (i % 2) * 12, 6, 9);
    }
  },

  pArcade: function (c, p) {
    this.shadow(c, 17, 14);
    c.fillStyle = '#2b2140'; c.fillRect(-15, -22, 30, 40);
    c.fillStyle = '#100c1c'; c.fillRect(-11, -18, 22, 17);
    c.fillStyle = ['#ff5470', '#57e2c8', '#ffd166'][Math.floor(this.t * 3 + (p.seed || 0) * 7) % 3];
    c.globalAlpha = 0.85; c.fillRect(-9, -16, 18, 13); c.globalAlpha = 1;
    c.fillStyle = '#e6404f'; c.beginPath(); c.arc(-5, 6, 3.5, 0, 6.2832); c.fill();
    c.fillStyle = '#3c7ff0'; c.beginPath(); c.arc(5, 6, 3.5, 0, 6.2832); c.fill();
  },

  pTable: function (c, p) {
    this.shadow(c, 22, 18);
    c.fillStyle = '#5a4632'; c.beginPath(); c.arc(0, 0, 21, 0, 6.2832); c.fill();
    c.fillStyle = '#6d573f'; c.beginPath(); c.arc(0, 0, 18, 0, 6.2832); c.fill();
    c.fillStyle = '#d8dee9'; c.beginPath(); c.arc(6, -4, 5, 0, 6.2832); c.fill();
  },

  pPlant: function (c, p) {
    this.shadow(c, 14, 12);
    c.fillStyle = '#6a4a35'; c.fillRect(-10, 2, 20, 14);
    c.fillStyle = '#2f7a4d';
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * 6.2832 + (p.seed || 0) * 3;
      c.beginPath();
      c.ellipse(Math.cos(a) * 8, Math.sin(a) * 6 - 6, 9, 5, a, 0, 6.2832);
      c.fill();
    }
  },

  pDesk: function (c, p) {
    this.shadow(c, 26, 16);
    c.fillStyle = '#3a4152'; c.fillRect(-27, -16, 54, 32);
    c.fillStyle = '#12161d'; c.fillRect(-18, -12, 24, 17);
    c.fillStyle = 'rgba(120,200,255,' + (0.35 + Math.sin(this.t * 2 + (p.seed || 0) * 5) * 0.2) + ')';
    c.fillRect(-16, -10, 20, 13);
  },

  pToy: function (c, p) {
    this.shadow(c, 9, 8);
    c.fillStyle = 'hsl(' + p.hue + ',62%,58%)';
    c.beginPath(); c.arc(0, 0, 9, 0, 6.2832); c.fill();
    c.fillStyle = 'hsl(' + p.hue + ',62%,72%)';
    c.beginPath(); c.arc(0, -6, 6, 0, 6.2832); c.fill();
    c.fillStyle = '#111';
    c.beginPath(); c.arc(-2.2, -7, 1.3, 0, 6.2832); c.fill();
    c.beginPath(); c.arc(2.2, -7, 1.3, 0, 6.2832); c.fill();
  },

  pDecoy: function (c, p) {
    var b = 1 + Math.sin(this.t * 14) * 0.14;
    this.shadow(c, 11, 9);
    c.save(); c.scale(b, b);
    c.fillStyle = '#ffc94d'; c.beginPath(); c.arc(0, 0, 11, 0, 6.2832); c.fill();
    c.fillStyle = '#8a5c00'; c.beginPath(); c.arc(0, 0, 5, 0, 6.2832); c.fill();
    c.restore();
    c.globalAlpha = 0.25 + Math.sin(this.t * 8) * 0.15;
    c.strokeStyle = '#ffc94d'; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 20 + Math.sin(this.t * 8) * 6, 0, 6.2832); c.stroke();
    c.globalAlpha = 1;
  },

  /* ═════════ actors ═════════ */
  drawActors: function (game, v) {
    var list = game.drawList();
    list.sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.x < v.x0 - 60 || a.x > v.x1 + 60 || a.y < v.y0 - 60 || a.y > v.y1 + 60) continue;
      if (a instanceof Monster) this.drawMonster(a, game);
      else this.drawHuman(a, game);
    }
    // GrabPack wires sit above bodies
    if (game.player && game.player.hands) {
      this.drawWire(game.player.hands.l, game.player);
      this.drawWire(game.player.hands.r, game.player);
    }
  },

  drawWire: function (h, owner) {
    if (h.state === 'idle') return;
    var c = this.ctx, o = h.origin();
    var col = h.side === 'l' ? '#e6404f' : '#3c7ff0';
    var gold = owner.gold;
    // sagging cable
    var mx = (o.x + h.x) / 2, my = (o.y + h.y) / 2 + PP.U.dist(o.x, o.y, h.x, h.y) * 0.06;
    c.lineCap = 'round';
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(o.x, o.y); c.quadraticCurveTo(mx, my, h.x, h.y); c.stroke();
    c.strokeStyle = gold ? '#ffc94d' : col; c.lineWidth = 3;
    c.beginPath(); c.moveTo(o.x, o.y); c.quadraticCurveTo(mx, my, h.x, h.y); c.stroke();
    // the hand itself
    c.save();
    c.translate(h.x, h.y);
    c.rotate(Math.atan2(h.y - o.y, h.x - o.x) + h.spin * (h.state === 'out' ? 0.5 : 0));
    c.fillStyle = col;
    c.beginPath(); c.roundRect ? c.roundRect(-8, -7, 16, 14, 5) : c.rect(-8, -7, 16, 14);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.4)';
    for (var f = -1; f <= 1; f++) c.fillRect(5, f * 4 - 1.5, 5, 3);
    c.restore();
    c.lineCap = 'butt';
  },

  /** Humans: player + staff. Top-down with a swinging stride. */
  drawHuman: function (a, game) {
    var c = this.ctx, look = a.look || (a.role && a.role.look) || PP.ROLES[0].look;
    var sw = Math.sin(a.walk) * 5;
    var isPlayer = (a === game.player);
    c.save();
    c.translate(a.x, a.y);
    if (a.caught) { c.globalAlpha = 0.42; c.rotate(1.35); }

    this.shadow(c, 15, 14);
    if (isPlayer) {
      c.strokeStyle = 'rgba(255,201,77,.30)'; c.lineWidth = 2;
      c.beginPath(); c.ellipse(0, 6, 19, 9, 0, 0, 6.2832); c.stroke();
    }
    c.save();
    c.rotate(a.face + Math.PI / 2);
    c.scale(1.28, 1.28);
    c.lineJoin = 'round';

    // legs
    c.fillStyle = '#232833';
    c.fillRect(-8, 2 + sw * 0.4, 6, 12);
    c.fillRect(2, 2 - sw * 0.4, 6, 12);
    // arms (a held emote lifts one)
    var lift = a.emote && a.emote.anim === 'wave' ? Math.sin(this.t * 12) * 6 : 0;
    c.fillStyle = look.skin;
    c.fillRect(-13, -6 + sw * 0.5 - lift, 5, 13);
    c.fillRect(8, -6 - sw * 0.5, 5, 13);
    // torso
    c.fillStyle = look.body;
    c.strokeStyle = 'rgba(0,0,0,.55)'; c.lineWidth = 1.6;
    c.beginPath();
    if (c.roundRect) c.roundRect(-11, -12, 22, 22, 7); else c.rect(-11, -12, 22, 22);
    c.fill(); c.stroke();
    c.fillStyle = look.trim;
    c.fillRect(-11, -3, 22, 3);
    if (game.saveData && game.saveData.owned && game.saveData.owned.suit_hiviz && isPlayer) {
      c.fillStyle = '#d7ff3a'; c.fillRect(-11, -9, 22, 2.5); c.fillRect(-11, 3, 22, 2.5);
    }
    // head
    c.fillStyle = look.skin;
    c.beginPath(); c.arc(0, -12, 9, 0, 6.2832); c.fill(); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.26)';
    c.beginPath(); c.arc(0, -14, 9, Math.PI, 0); c.fill();
    // hat / cosmetic
    var owned = (game.saveData && game.saveData.owned) || {};
    var hat = look.hat;
    if (isPlayer) {
      if (owned.hat_crown) hat = 'crown';
      else if (owned.hat_cone) hat = 'cone';
      else if (owned.hat_bulb) hat = 'bulb';
    }
    this.drawHat(c, hat, look.hatCol);
    c.restore();

    if (!a.caught) this.nameTag(c, a, isPlayer);
    c.globalAlpha = 1;
    this.bubble(c, a);
    c.restore();
  },

  drawHat: function (c, hat, col) {
    switch (hat) {
      case 'cap':
        c.fillStyle = col; c.beginPath(); c.arc(0, -13, 8.5, Math.PI, 0); c.fill();
        c.fillRect(-8.5, -14, 17, 3);
        c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(-6, -22, 12, 3);
        break;
      case 'helmet':
        c.fillStyle = col; c.beginPath(); c.arc(0, -13, 10, 0, 6.2832); c.fill();
        c.fillStyle = 'rgba(0,0,0,.22)'; c.fillRect(-10, -14, 20, 3);
        break;
      case 'cone':
        c.fillStyle = '#ff5470';
        c.beginPath(); c.moveTo(0, -30); c.lineTo(-7, -13); c.lineTo(7, -13); c.closePath(); c.fill();
        c.fillStyle = '#57e2c8'; c.fillRect(-7, -17, 14, 3);
        break;
      case 'crown':
        c.fillStyle = '#ffc94d';
        c.beginPath();
        c.moveTo(-9, -14); c.lineTo(-9, -22); c.lineTo(-4.5, -18); c.lineTo(0, -24);
        c.lineTo(4.5, -18); c.lineTo(9, -22); c.lineTo(9, -14);
        c.closePath(); c.fill();
        break;
      case 'bulb':
        c.fillStyle = '#2c3444'; c.fillRect(-9, -19, 18, 5);
        c.fillStyle = '#fff6c9'; c.beginPath(); c.arc(0, -17, 4, 0, 6.2832); c.fill();
        break;
    }
  },

  /** Monsters: tall plush things with reaching arms and lit eyes. */
  drawMonster: function (m, game) {
    var c = this.ctx, L = m.def.look, U = PP.U;
    var sw = Math.sin(m.walk) * 8;
    var lunge = m.lunge > 0 ? (m.lunge / 0.35) : 0;
    var scale = L.tall;
    c.save();
    c.translate(m.x, m.y);
    c.fillStyle = 'rgba(0,0,0,.45)';
    c.beginPath(); c.ellipse(0, 6, 20 * scale, 15 * scale, 0, 0, 6.2832); c.fill();

    c.save();
    c.rotate(m.face + Math.PI / 2);
    c.scale(scale * 1.25, scale * 1.25);

    // long arms, swinging wide, thrown forward on a lunge
    c.strokeStyle = L.fur; c.lineWidth = 7; c.lineCap = 'round';
    var reach = 22 * L.arm * (1 + lunge * 0.85);
    for (var s = -1; s <= 1; s += 2) {
      var swing = sw * 0.7 * s;
      c.beginPath();
      c.moveTo(s * 12, -6);
      c.quadraticCurveTo(s * (20 + reach * 0.4), -2 + swing, s * 9 - lunge * s * 4, -reach + swing * 0.5);
      c.stroke();
      c.fillStyle = L.fur;
      c.beginPath(); c.arc(s * 9 - lunge * s * 4, -reach + swing * 0.5, 5.5, 0, 6.2832); c.fill();
    }
    // legs
    c.strokeStyle = L.fur; c.lineWidth = 8;
    c.beginPath(); c.moveTo(-7, 6); c.lineTo(-7, 16 + sw * 0.5); c.stroke();
    c.beginPath(); c.moveTo(7, 6); c.lineTo(7, 16 - sw * 0.5); c.stroke();
    c.lineCap = 'butt';

    // torso + belly patch
    c.fillStyle = L.fur;
    c.beginPath();
    if (c.roundRect) c.roundRect(-14, -16, 28, 28, 11); else c.rect(-14, -16, 28, 28);
    c.fill();
    c.fillStyle = L.belly;
    c.beginPath(); c.ellipse(0, -1, 8, 10, 0, 0, 6.2832); c.fill();

    // head
    c.fillStyle = L.fur;
    c.beginPath(); c.arc(0, -20, 13, 0, 6.2832); c.fill();
    // eyes — they glow, which is how you spot one in the dark
    var eo = m.state === 'chase' ? 1 : 0.72;
    c.fillStyle = L.eye; c.globalAlpha = eo;
    c.beginPath(); c.arc(-5, -23, 4.2, 0, 6.2832); c.fill();
    c.beginPath(); c.arc(5, -23, 4.2, 0, 6.2832); c.fill();
    c.globalAlpha = 1;
    c.fillStyle = '#0a0a0a';
    c.beginPath(); c.arc(-5, -24, 1.9, 0, 6.2832); c.fill();
    c.beginPath(); c.arc(5, -24, 1.9, 0, 6.2832); c.fill();
    // grin
    if (L.teeth) {
      c.fillStyle = '#12080a';
      c.beginPath(); c.ellipse(0, -15, 8, 4.5, 0, 0, 6.2832); c.fill();
      c.fillStyle = '#fffdf2';
      for (var i = -3; i <= 3; i++) c.fillRect(i * 2.2 - 0.8, -18.5, 1.7, 3.4);
      for (var j = -2; j <= 2; j++) c.fillRect(j * 2.6 - 0.8, -13.4, 1.7, 2.6);
    } else {
      c.strokeStyle = '#12080a'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, -17, 6, 0.25, Math.PI - 0.25); c.stroke();
    }
    c.restore();

    if (m.stunT > 0) {
      c.fillStyle = '#ffc94d'; c.font = 'bold 15px Trebuchet MS'; c.textAlign = 'center';
      c.fillText('✦ ✦ ✦', 0, -56 * scale);
      c.textAlign = 'left';
    }
    if (m === game.player) this.nameTag(c, m, true);
    this.bubble(c, m);
    c.restore();
  },

  nameTag: function (c, a, isPlayer) {
    var name = a.name || '';
    if (!name) return;
    c.font = '11px Trebuchet MS';
    c.textAlign = 'center';
    var w = c.measureText(name).width + 12;
    var y = a instanceof Monster ? -74 : -42;
    c.fillStyle = 'rgba(6,9,14,.72)';
    if (c.roundRect) { c.beginPath(); c.roundRect(-w / 2, y - 11, w, 15, 4); c.fill(); }
    else c.fillRect(-w / 2, y - 11, w, 15);
    c.fillStyle = isPlayer ? '#ffc94d' : '#c6d0e2';
    c.fillText(name, 0, y);
    c.textAlign = 'left';
  },

  bubble: function (c, a) {
    if (!a.speaking) return;
    var txt = a.speaking.text;
    c.font = '12px Trebuchet MS'; c.textAlign = 'center';
    var w = Math.min(210, c.measureText(txt).width + 18);
    var y = (a instanceof Monster ? -98 : -62);
    var alpha = Math.min(1, a.speaking.t * 2);
    c.globalAlpha = alpha;
    c.fillStyle = 'rgba(233,237,246,.94)';
    if (c.roundRect) { c.beginPath(); c.roundRect(-w / 2, y - 15, w, 21, 7); c.fill(); }
    else c.fillRect(-w / 2, y - 15, w, 21);
    c.beginPath(); c.moveTo(-5, y + 6); c.lineTo(5, y + 6); c.lineTo(0, y + 12); c.fill();
    c.fillStyle = '#131720';
    c.fillText(txt, 0, y);
    c.globalAlpha = 1;
    c.textAlign = 'left';
  },

  /* ═════════ lighting ═════════ */
  drawLighting: function (game) {
    var lc = this.lctx, W = this.w, H = this.h, cam = game.cam;
    var dark = game.darkness;
    if (dark <= 0.02) return;

    lc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, W, H);
    lc.fillStyle = 'rgba(2,3,7,' + dark + ')';
    lc.fillRect(0, 0, W, H);

    lc.save();
    this.worldTransform(lc, cam);
    lc.globalCompositeOperation = 'destination-out';
    var hw = W / (2 * this.zoom), hh = H / (2 * this.zoom);

    // ceiling fixtures light the place; a dead tube leaves a hole in the dark
    var L = PP.World.lamps;
    for (var i = 0; i < L.length; i++) {
      var l = L[i];
      if (Math.abs(l.x - cam.x) > hw + l.r || Math.abs(l.y - cam.y) > hh + l.r) continue;
      var lv = this.lampLevel(game, l);
      if (lv > 0.05) this.punch(lc, l.x, l.y, l.r * (0.6 + lv * 0.4), 0.9 * lv);
    }
    // props that emit
    for (var q = 0; q < PP.World.props.length; q++) {
      var p = PP.World.props[q];
      if (Math.abs(p.x - cam.x) > hw + 400 || Math.abs(p.y - cam.y) > hh + 400) continue;
      if (p.kind === 'node') this.punch(lc, p.x, p.y, p.done ? 150 : 96, p.done ? 0.8 : 0.5);
      else if (p.kind === 'decoy') this.punch(lc, p.x, p.y, 140, 0.62);
      else if (p.kind === 'lift' && p.armed) this.punch(lc, p.x, p.y, 210, 0.9);
      else if (p.kind === 'arcade') this.punch(lc, p.x, p.y, 96, 0.5);
      else if (p.kind === 'socket') this.punch(lc, p.x, p.y, 54, 0.34);
    }
    // flare bursts
    for (var f = 0; f < game.flares.length; f++) {
      var fl = game.flares[f];
      this.punch(lc, fl.x, fl.y, 400 * (fl.t / fl.max), fl.t / fl.max);
    }
    // the player's own torch
    var pl = game.player;
    if (pl) {
      this.punch(lc, pl.x, pl.y, 110, 0.95);
      if (pl.torch) this.cone(lc, pl.x, pl.y, pl.face, this.torchRange(game), 0.92);
    }
    // eyeshine: a monster's eyes carry their own little halo
    for (var e = 0; e < game.monsters.length; e++) {
      var mo = game.monsters[e];
      if (Math.abs(mo.x - cam.x) > hw + 200 || Math.abs(mo.y - cam.y) > hh + 200) continue;
      this.punch(lc, mo.x, mo.y - 20, mo.state === 'chase' ? 74 : 46, 0.5);
    }
    lc.restore();

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.light, 0, 0);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },

  torchRange: function (game) {
    var pl = game.player;
    return 340 * (pl.torchRange || 1)
      * ((game.saveData && game.saveData.owned && game.saveData.owned.hat_bulb) ? 1.2 : 1);
  },

  /** Additive pass: lit things actually emit colour, not just absence of dark. */
  drawGlows: function (game) {
    var c = this.ctx, cam = game.cam, W = this.w, H = this.h;
    var hw = W / (2 * this.zoom), hh = H / (2 * this.zoom);
    c.save();
    this.worldTransform(c, cam);
    c.globalCompositeOperation = 'lighter';

    var self = this;
    function glow(x, y, r, col, a) {
      if (Math.abs(x - cam.x) > hw + r || Math.abs(y - cam.y) > hh + r) return;
      var g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + col + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
    }

    var L = PP.World.lamps;
    for (var i = 0; i < L.length; i++) {
      var lv = this.lampLevel(game, L[i]);
      if (lv > 0.05) glow(L[i].x, L[i].y, L[i].r * 0.8,
                          game.power ? '255,214,158' : '255,150,90', 0.16 * lv);
    }
    for (var q = 0; q < PP.World.props.length; q++) {
      var p = PP.World.props[q];
      if (p.kind === 'node') glow(p.x, p.y - 18, p.done ? 110 : 64, p.done ? '90,240,150' : '255,190,70', p.done ? 0.3 : 0.16);
      else if (p.kind === 'socket') glow(p.x, p.y, 40, p.side === 'l' ? '255,90,105' : '90,150,255', p.heldBy ? 0.4 : 0.2);
      else if (p.kind === 'lift' && p.armed) glow(p.x, p.y, 170, '90,240,150', 0.26);
      else if (p.kind === 'arcade') glow(p.x, p.y - 12, 70, '190,120,255', 0.16);
      else if (p.kind === 'decoy') glow(p.x, p.y, 110, '255,200,90', 0.3);
      else if (p.kind === 'task' && !p.done) glow(p.x, p.y - 4, 46, '110,190,255', 0.14);
    }
    for (var f = 0; f < game.flares.length; f++) {
      var fl = game.flares[f];
      glow(fl.x, fl.y, 340 * (fl.t / fl.max), '255,250,220', 0.5 * (fl.t / fl.max));
    }
    for (var e = 0; e < game.monsters.length; e++) {
      var mo = game.monsters[e];
      var col = mo.def.look.eye;
      glow(mo.x, mo.y - 26 * mo.def.look.tall, mo.state === 'chase' ? 64 : 40,
           this.hexToRgb(col), mo.state === 'chase' ? 0.42 : 0.24);
    }
    var pl = game.player;
    if (pl && pl.torch) {
      var len = this.torchRange(game);
      var g2 = c.createRadialGradient(pl.x, pl.y, 16, pl.x, pl.y, len);
      g2.addColorStop(0, 'rgba(255,238,200,.20)');
      g2.addColorStop(0.5, 'rgba(255,232,190,.09)');
      g2.addColorStop(1, 'rgba(255,230,180,0)');
      c.fillStyle = g2;
      c.beginPath(); c.moveTo(pl.x, pl.y);
      c.arc(pl.x, pl.y, len, pl.face - 0.52, pl.face + 0.52);
      c.closePath(); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    c.restore();
  },

  hexToRgb: function (hex) {
    var n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  },

  punch: function (lc, x, y, r, strength) {
    var g = lc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
    g.addColorStop(0.6, 'rgba(0,0,0,' + strength * 0.5 + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath(); lc.arc(x, y, r, 0, 6.2832); lc.fill();
  },

  cone: function (lc, x, y, ang, len, strength) {
    var spread = 0.52;
    var g = lc.createRadialGradient(x, y, 20, x, y, len);
    g.addColorStop(0, 'rgba(0,0,0,' + strength + ')');
    g.addColorStop(0.55, 'rgba(0,0,0,' + strength * 0.62 + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.moveTo(x, y);
    lc.arc(x, y, len, ang - spread, ang + spread);
    lc.closePath();
    lc.fill();
  },

  /* ═════════ full-screen effects ═════════ */
  drawScreenFx: function (game) {
    var c = this.ctx, W = this.w, H = this.h, pl = game.player;
    // vignette
    var g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28,
                                   W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.62)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // fear: red pulse at the edges
    var fear = pl ? pl.fear : 0;
    if (fear > 0.02) {
      var pulse = 0.5 + Math.sin(this.t * (4 + fear * 8)) * 0.5;
      var g2 = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.22,
                                      W / 2, H / 2, Math.max(W, H) * 0.66);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(1, 'rgba(150,12,28,' + (fear * 0.5 * (0.65 + pulse * 0.35)) + ')');
      c.fillStyle = g2; c.fillRect(0, 0, W, H);
    }
    // catch flash
    if (game.flash > 0) {
      c.fillStyle = 'rgba(255,240,240,' + Math.min(1, game.flash) + ')';
      c.fillRect(0, 0, W, H);
    }
  },

  /* ═════════ maps ═════════ */
  minimap: function (game, canvas, big) {
    var c = canvas.getContext('2d'), W = PP.World;
    var pad = big ? 8 : 4;
    var sc = Math.min((canvas.width - pad * 2) / (W.W * PP.TILE),
                      (canvas.height - pad * 2) / (W.H * PP.TILE));
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    c.translate(pad, pad); c.scale(sc, sc);

    for (var i = 0; i < W.rooms.length; i++) {
      var r = W.rooms[i];
      var seen = game.seen[r.id];
      c.fillStyle = seen ? 'rgba(120,140,180,.36)' : 'rgba(70,80,102,.15)';
      c.fillRect(r.x * PP.TILE, r.y * PP.TILE, r.w * PP.TILE, r.h * PP.TILE);
      c.strokeStyle = seen ? 'rgba(180,200,235,.5)' : 'rgba(120,135,165,.2)';
      c.lineWidth = 3 / sc;
      c.strokeRect(r.x * PP.TILE, r.y * PP.TILE, r.w * PP.TILE, r.h * PP.TILE);
      if (big && seen) {
        c.fillStyle = '#c9d4e8';
        c.font = (11 / sc) + 'px Trebuchet MS';
        c.textAlign = 'center';
        c.fillText(r.name, r.cx, r.cy);
        c.textAlign = 'left';
      }
    }
    for (var h = 0; h < PP.HALLS.length; h++) {
      var hh = PP.HALLS[h];
      c.fillStyle = 'rgba(110,128,160,.24)';
      c.fillRect(hh[0] * PP.TILE, hh[1] * PP.TILE, hh[2] * PP.TILE, hh[3] * PP.TILE);
    }
    c.strokeStyle = 'rgba(255,201,77,.4)';
    c.lineWidth = 6 / sc;
    c.setLineDash([16 / sc, 12 / sc]);
    for (var vt = 0; vt < PP.VENTS.length; vt++) {
      var vv = PP.VENTS[vt];
      c.beginPath();
      c.moveTo(vv[0] * PP.TILE + 16, vv[1] * PP.TILE + 16);
      c.lineTo(vv[2] * PP.TILE + 16, vv[3] * PP.TILE + 16);
      c.stroke();
    }
    c.setLineDash([]);
    // objectives
    for (var p = 0; p < W.props.length; p++) {
      var pr = W.props[p];
      if (pr.kind === 'node') {
        c.fillStyle = pr.done ? '#49d67f' : '#ffc94d';
        c.beginPath(); c.arc(pr.x, pr.y, 9 / sc * 1.6, 0, 6.2832); c.fill();
      } else if (pr.kind === 'lift' && pr.armed) {
        c.fillStyle = '#49d67f';
        c.fillRect(pr.x - 22, pr.y - 22, 44, 44);
      }
    }
    // NPCs (only in modes where you can see the roster)
    for (var n = 0; n < game.npcs.length; n++) {
      var npc = game.npcs[n];
      if (npc.caught) continue;
      c.fillStyle = 'rgba(120,220,255,.75)';
      c.beginPath(); c.arc(npc.x, npc.y, 7 / sc * 1.4, 0, 6.2832); c.fill();
    }
    // monsters: the Night Guard gets a ping, everyone else gets nothing
    if (game.showMonsterOnMap()) {
      for (var m = 0; m < game.monsters.length; m++) {
        var mo = game.monsters[m];
        c.fillStyle = '#e6404f';
        c.beginPath(); c.arc(mo.x, mo.y, 10 / sc * 1.5, 0, 6.2832); c.fill();
      }
    }
    // you
    if (game.player) {
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(game.player.x, game.player.y, 9 / sc * 1.7, 0, 6.2832); c.fill();
      c.strokeStyle = '#ffc94d'; c.lineWidth = 4 / sc;
      c.beginPath();
      c.moveTo(game.player.x, game.player.y);
      c.lineTo(game.player.x + Math.cos(game.player.face) * 40,
               game.player.y + Math.sin(game.player.face) * 40);
      c.stroke();
    }
    c.restore();
  }
};
