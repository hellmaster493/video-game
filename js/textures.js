/* ═══════════════════════════════════════════════════════════
   textures.js — every surface in the factory is drawn into a
   canvas at boot and turned into an albedo / normal / roughness
   set. No image files ship with the game.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Tex = {
  cache: {},
  aniso: 4,

  cv: function (size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  },

  /** Sobel a greyscale height canvas into a tangent-space normal map. */
  normalFromHeight: function (hc, strength) {
    var s = hc.width, src = hc.getContext('2d').getImageData(0, 0, s, s).data;
    var out = document.createElement('canvas'); out.width = out.height = s;
    var ctx = out.getContext('2d'), img = ctx.createImageData(s, s), d = img.data;
    var at = function (x, y) {
      x = (x + s) % s; y = (y + s) % s;                 // wrap, so tiling stays seamless
      return src[(y * s + x) * 4] / 255;
    };
    for (var y = 0; y < s; y++) {
      for (var x = 0; x < s; x++) {
        var dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
               - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
        var dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
               - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
        var nx = dx * strength, ny = dy * strength, nz = 1;
        var len = Math.hypot(nx, ny, nz);
        var i = (y * s + x) * 4;
        d[i]     = ((nx / len) * 0.5 + 0.5) * 255;
        d[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        d[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return out;
  },

  tex: function (canvas, repeat) {
    var t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.aniso;
    if (repeat) t.repeat.set(repeat, repeat);
    return t;
  },

  /* ── shared drawing helpers ─────────────────────────────── */
  fill: function (c, col) { var x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, c.width, c.height); },

  /** soft blobby noise — the base grain under most surfaces */
  blobs: function (c, rnd, n, rMin, rMax, cols, alpha) {
    var x = c.getContext('2d'), s = c.width;
    for (var i = 0; i < n; i++) {
      x.globalAlpha = alpha * (0.4 + rnd() * 0.6);
      x.fillStyle = cols[(rnd() * cols.length) | 0];
      var px = rnd() * s, py = rnd() * s, r = rMin + rnd() * (rMax - rMin);
      x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
      // wrap the edges so the tile is seamless
      if (px < r) { x.beginPath(); x.arc(px + s, py, r, 0, 6.2832); x.fill(); }
      if (px > s - r) { x.beginPath(); x.arc(px - s, py, r, 0, 6.2832); x.fill(); }
      if (py < r) { x.beginPath(); x.arc(px, py + s, r, 0, 6.2832); x.fill(); }
      if (py > s - r) { x.beginPath(); x.arc(px, py - s, r, 0, 6.2832); x.fill(); }
    }
    x.globalAlpha = 1;
  },

  speckle: function (c, rnd, n, cols, size) {
    var x = c.getContext('2d'), s = c.width;
    for (var i = 0; i < n; i++) {
      x.fillStyle = cols[(rnd() * cols.length) | 0];
      x.globalAlpha = 0.2 + rnd() * 0.7;
      var w = size * (0.5 + rnd());
      x.fillRect(rnd() * s, rnd() * s, w, w);
    }
    x.globalAlpha = 1;
  },

  /* ── the surfaces ───────────────────────────────────────── */
  SIZES: { concrete: 512, checker: 512, wall: 512, ceiling: 512, metal: 512,
           grate: 512, duct: 512, wood: 512, plush: 256, cloth: 256, porcelain: 512 },

  build: function (name) {
    if (this.cache[name]) return this.cache[name];
    var S = this.SIZES[name] || 256;
    var rnd = PP.rng(name.split('').reduce(function (a, ch) { return a + ch.charCodeAt(0) * 31; }, 7));
    var alb = this.cv(S), h = this.cv(S), rough = null;
    var a = alb.getContext('2d'), hh = h.getContext('2d');
    var i, j;

    switch (name) {
      case 'concrete':
        this.fill(alb, '#6e7480'); this.fill(h, '#808080');
        this.blobs(alb, rnd, 90, 8, 46, ['#787e8a', '#646a76', '#747a86'], 0.5);
        this.blobs(h, rnd, 60, 10, 40, ['#8a8a8a', '#6f6f6f'], 0.45);
        this.speckle(alb, rnd, 2600, ['#5a606b', '#848a96', '#4e535d'], 2);
        this.speckle(h, rnd, 2200, ['#6a6a6a', '#969696'], 2);
        // expansion joints
        a.strokeStyle = 'rgba(40,44,52,.65)'; a.lineWidth = 3;
        hh.strokeStyle = '#3a3a3a'; hh.lineWidth = 4;
        [0, S / 2].forEach(function (o) {
          a.beginPath(); a.moveTo(o, 0); a.lineTo(o, S); a.stroke();
          a.beginPath(); a.moveTo(0, o); a.lineTo(S, o); a.stroke();
          hh.beginPath(); hh.moveTo(o, 0); hh.lineTo(o, S); hh.stroke();
          hh.beginPath(); hh.moveTo(0, o); hh.lineTo(S, o); hh.stroke();
        });
        break;

      case 'checker': {
        var q = S / 2;
        for (j = 0; j < 2; j++) for (i = 0; i < 2; i++) {
          a.fillStyle = ((i + j) & 1) ? '#8b929e' : '#3d434e';
          a.fillRect(i * q, j * q, q, q);
        }
        this.fill(h, '#9a9a9a');
        this.speckle(alb, rnd, 1800, ['rgba(255,255,255,.10)', 'rgba(0,0,0,.14)'], 2);
        this.blobs(alb, rnd, 26, 12, 40, ['rgba(60,64,72,.30)', 'rgba(200,205,215,.14)'], 0.5);
        // grout between the tiles, cut into the height map
        a.strokeStyle = 'rgba(28,31,37,.85)'; a.lineWidth = 4;
        hh.strokeStyle = '#4a4a4a'; hh.lineWidth = 6;
        [0, q].forEach(function (o) {
          a.beginPath(); a.moveTo(o, 0); a.lineTo(o, S); a.stroke();
          a.beginPath(); a.moveTo(0, o); a.lineTo(S, o); a.stroke();
          hh.beginPath(); hh.moveTo(o, 0); hh.lineTo(o, S); hh.stroke();
          hh.beginPath(); hh.moveTo(0, o); hh.lineTo(S, o); hh.stroke();
        });
        break;
      }

      case 'carpet':
        this.fill(alb, '#7a3a4c'); this.fill(h, '#787878');
        this.blobs(alb, rnd, 120, 6, 30, ['#8c4457', '#682f40', '#7f3d50'], 0.55);
        // fibres
        for (i = 0; i < 5200; i++) {
          var cx = rnd() * S, cy = rnd() * S, ang = rnd() * 6.2832;
          a.strokeStyle = rnd() < 0.5 ? 'rgba(255,190,205,.10)' : 'rgba(40,16,24,.16)';
          a.lineWidth = 1;
          a.beginPath(); a.moveTo(cx, cy);
          a.lineTo(cx + Math.cos(ang) * 3, cy + Math.sin(ang) * 3); a.stroke();
          hh.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.20)' : 'rgba(0,0,0,.20)';
          hh.beginPath(); hh.moveTo(cx, cy);
          hh.lineTo(cx + Math.cos(ang) * 3, cy + Math.sin(ang) * 3); hh.stroke();
        }
        break;

      case 'wall':
        this.fill(alb, '#7a7d86'); this.fill(h, '#8c8c8c');
        this.blobs(alb, rnd, 70, 14, 60, ['#84878f', '#6e717a', '#797c85'], 0.42);
        this.speckle(alb, rnd, 1200, ['rgba(255,255,255,.07)', 'rgba(0,0,0,.09)'], 2);
        // painted panel seams + skirting scuffs
        a.fillStyle = 'rgba(30,33,40,.55)'; a.fillRect(0, S - 10, S, 4);
        hh.fillStyle = '#3c3c3c'; hh.fillRect(0, S - 10, S, 4);
        a.fillStyle = 'rgba(0,0,0,.30)'; a.fillRect(S - 5, 0, 5, S);
        hh.fillStyle = '#4a4a4a'; hh.fillRect(S - 5, 0, 5, S);
        for (i = 0; i < 22; i++) {         // dirt streaks running down the paint
          var sx = rnd() * S, w = 2 + rnd() * 9;
          var grd = a.createLinearGradient(0, 0, 0, S);
          grd.addColorStop(0, 'rgba(48,44,40,.24)'); grd.addColorStop(1, 'rgba(48,44,40,0)');
          a.fillStyle = grd; a.fillRect(sx, 0, w, S * (0.3 + rnd() * 0.7));
        }
        break;

      case 'ceiling':
        this.fill(alb, '#63666d'); this.fill(h, '#909090');
        this.speckle(alb, rnd, 5000, ['rgba(0,0,0,.10)', 'rgba(255,255,255,.10)'], 3);
        this.speckle(h, rnd, 4000, ['rgba(0,0,0,.25)', 'rgba(255,255,255,.25)'], 3);
        a.strokeStyle = 'rgba(70,74,82,.5)'; a.lineWidth = 3;
        hh.strokeStyle = '#5a5a5a'; hh.lineWidth = 4;
        a.strokeRect(1.5, 1.5, S - 3, S - 3);
        hh.strokeRect(1.5, 1.5, S - 3, S - 3);
        break;

      case 'metal':
        this.fill(alb, '#6a707c'); this.fill(h, '#8a8a8a');
        for (i = 0; i < 700; i++) {        // brushed grain
          a.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.055)' : 'rgba(0,0,0,.07)';
          a.lineWidth = 1;
          var yy = rnd() * S;
          a.beginPath(); a.moveTo(0, yy); a.lineTo(S, yy); a.stroke();
        }
        // rivets around the plate edge
        [[16, 16], [S - 16, 16], [16, S - 16], [S - 16, S - 16],
         [S / 2, 16], [S / 2, S - 16], [16, S / 2], [S - 16, S / 2]].forEach(function (p) {
          var g = a.createRadialGradient(p[0] - 1, p[1] - 1, 0, p[0], p[1], 6);
          g.addColorStop(0, '#a9b0bc'); g.addColorStop(1, '#525863');
          a.fillStyle = g; a.beginPath(); a.arc(p[0], p[1], 6, 0, 6.2832); a.fill();
          hh.fillStyle = '#dedede'; hh.beginPath(); hh.arc(p[0], p[1], 6, 0, 6.2832); hh.fill();
        });
        a.strokeStyle = 'rgba(28,31,37,.7)'; a.lineWidth = 4; a.strokeRect(2, 2, S - 4, S - 4);
        hh.strokeStyle = '#3a3a3a'; hh.lineWidth = 5; hh.strokeRect(2, 2, S - 4, S - 4);
        break;

      case 'grate':
        this.fill(alb, '#2b3038'); this.fill(h, '#303030');
        for (i = 0; i < S; i += 32) {
          a.fillStyle = '#78808e'; a.fillRect(i, 0, 20, S);
          hh.fillStyle = '#e8e8e8'; hh.fillRect(i, 0, 20, S);
        }
        for (j = 0; j < S; j += 64) {
          a.fillStyle = '#8c95a4'; a.fillRect(0, j, S, 10);
          hh.fillStyle = '#f4f4f4'; hh.fillRect(0, j, S, 10);
        }
        this.speckle(alb, rnd, 900, ['rgba(0,0,0,.35)', 'rgba(255,255,255,.10)'], 2);
        break;

      case 'duct':
        this.fill(alb, '#767c86'); this.fill(h, '#888888');
        for (j = 0; j < S; j += 22) {       // corrugation ribs
          var g2 = a.createLinearGradient(0, j, 0, j + 22);
          g2.addColorStop(0, 'rgba(255,255,255,.14)');
          g2.addColorStop(0.5, 'rgba(0,0,0,.22)');
          g2.addColorStop(1, 'rgba(255,255,255,.10)');
          a.fillStyle = g2; a.fillRect(0, j, S, 22);
          hh.fillStyle = '#dcdcdc'; hh.fillRect(0, j, S, 11);
          hh.fillStyle = '#404040'; hh.fillRect(0, j + 11, S, 11);
        }
        this.speckle(alb, rnd, 700, ['rgba(0,0,0,.16)'], 3);
        break;

      case 'wood':
        this.fill(alb, '#9c7440'); this.fill(h, '#8a8a8a');
        for (i = 0; i < 130; i++) {        // grain
          a.strokeStyle = rnd() < 0.5 ? 'rgba(80,52,24,.30)' : 'rgba(210,168,110,.22)';
          a.lineWidth = 1 + rnd() * 2;
          var yy2 = rnd() * S;
          a.beginPath(); a.moveTo(0, yy2);
          a.bezierCurveTo(S / 3, yy2 + rnd() * 8 - 4, 2 * S / 3, yy2 + rnd() * 8 - 4, S, yy2);
          a.stroke();
          hh.strokeStyle = rnd() < 0.5 ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.18)';
          hh.lineWidth = a.lineWidth;
          hh.beginPath(); hh.moveTo(0, yy2); hh.lineTo(S, yy2); hh.stroke();
        }
        a.fillStyle = 'rgba(60,38,16,.5)'; a.fillRect(0, 0, S, 5); a.fillRect(0, S - 5, S, 5);
        hh.fillStyle = '#4a4a4a'; hh.fillRect(0, 0, S, 5); hh.fillRect(0, S - 5, S, 5);
        break;

      case 'porcelain': {                  // a doll's face mask: glaze, crazing, chips
        this.fill(alb, '#ded6c4'); this.fill(h, '#8a8a8a');
        rough = this.cv(S);
        var pr = rough.getContext('2d');
        this.fill(rough, '#3a3a3a');        // glazed ceramic is smooth
        this.blobs(alb, rnd, 40, 14, 60, ['#e7dfcd', '#cfc6b2', '#d8cfbc'], 0.35);
        // crazing: fine branching hairline cracks in the glaze
        for (i = 0; i < 60; i++) {
          var cx3 = rnd() * S, cy3 = rnd() * S, ca3 = rnd() * 6.2832;
          a.strokeStyle = 'rgba(96,86,70,' + (0.20 + rnd() * 0.35) + ')';
          a.lineWidth = 0.8 + rnd() * 0.7;
          hh.strokeStyle = 'rgba(0,0,0,.55)'; hh.lineWidth = a.lineWidth + 0.6;
          a.beginPath(); hh.beginPath();
          a.moveTo(cx3, cy3); hh.moveTo(cx3, cy3);
          for (var seg2 = 0; seg2 < 7; seg2++) {
            ca3 += (rnd() - 0.5) * 1.5;
            cx3 += Math.cos(ca3) * S * 0.035; cy3 += Math.sin(ca3) * S * 0.035;
            a.lineTo(cx3, cy3); hh.lineTo(cx3, cy3);
          }
          a.stroke(); hh.stroke();
        }
        // chips, where the glaze has come off and the grey body shows
        for (i = 0; i < 22; i++) {
          var px3 = rnd() * S, py3 = rnd() * S, r3 = 3 + rnd() * 16;
          a.fillStyle = 'rgba(150,142,128,.85)';
          a.beginPath();
          for (var v3 = 0; v3 < 7; v3++) {
            var va = v3 / 7 * 6.2832, vr = r3 * (0.6 + rnd() * 0.6);
            var vx = px3 + Math.cos(va) * vr, vy = py3 + Math.sin(va) * vr;
            v3 ? a.lineTo(vx, vy) : a.moveTo(vx, vy);
          }
          a.closePath(); a.fill();
          hh.fillStyle = 'rgba(0,0,0,.6)';
          hh.beginPath(); hh.arc(px3, py3, r3 * 0.8, 0, 6.2832); hh.fill();
          pr.fillStyle = 'rgba(220,220,220,.9)';   // bare ceramic is matte
          pr.beginPath(); pr.arc(px3, py3, r3 * 0.9, 0, 6.2832); pr.fill();
        }
        // grime settled into the crazing
        for (i = 0; i < 18; i++) {
          var gx = rnd() * S, gy = rnd() * S, gr = S * (0.05 + rnd() * 0.14);
          var gg = a.createRadialGradient(gx, gy, 0, gx, gy, gr);
          gg.addColorStop(0, 'rgba(70,60,46,' + (0.08 + rnd() * 0.14) + ')');
          gg.addColorStop(1, 'rgba(70,60,46,0)');
          a.fillStyle = gg;
          a.beginPath(); a.arc(gx, gy, gr, 0, 6.2832); a.fill();
        }
        break;
      }

      case 'plush': {                      // short-pile fabric
        this.fill(alb, '#b0b0b0'); this.fill(h, '#808080');
        rough = this.cv(S);
        var rr = rough.getContext('2d');
        this.fill(rough, '#d8d8d8');        // fabric is rough almost everywhere
        // clumps of pile, so the nap is not uniform noise
        this.blobs(alb, rnd, 150, 8, 34, ['#bdbdbd', '#a2a2a2', '#b6b6b6'], 0.42);
        this.blobs(rough, rnd, 120, 10, 40, ['#eaeaea', '#c4c4c4'], 0.5);
        for (i = 0; i < 26000; i++) {
          var fx = rnd() * S, fy = rnd() * S;
          // fibres lie in a loosely shared direction, like brushed pile
          var fa = (fy / S) * 0.9 + rnd() * 1.5 - 0.2;
          var len = 2 + rnd() * 4;
          var lit = rnd() < 0.5;
          a.strokeStyle = lit ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.15)';
          a.lineWidth = rnd() < 0.15 ? 1.6 : 1;
          a.beginPath(); a.moveTo(fx, fy);
          a.lineTo(fx + Math.cos(fa) * len, fy + Math.sin(fa) * len); a.stroke();
          hh.strokeStyle = lit ? 'rgba(255,255,255,.34)' : 'rgba(0,0,0,.34)';
          hh.lineWidth = a.lineWidth;
          hh.beginPath(); hh.moveTo(fx, fy);
          hh.lineTo(fx + Math.cos(fa) * len, fy + Math.sin(fa) * len); hh.stroke();
        }
        // a stitched seam: the giveaway that something is sewn rather than moulded
        var seamY = S * 0.5;
        a.strokeStyle = 'rgba(0,0,0,.30)'; a.lineWidth = 3;
        a.beginPath(); a.moveTo(0, seamY); a.lineTo(S, seamY); a.stroke();
        hh.strokeStyle = 'rgba(0,0,0,.55)'; hh.lineWidth = 4;
        hh.beginPath(); hh.moveTo(0, seamY); hh.lineTo(S, seamY); hh.stroke();
        for (i = 0; i < S; i += 9) {
          a.strokeStyle = 'rgba(255,255,255,.30)'; a.lineWidth = 2;
          a.beginPath(); a.moveTo(i + 1, seamY - 3); a.lineTo(i + 5, seamY + 3); a.stroke();
          hh.strokeStyle = 'rgba(255,255,255,.65)';
          hh.beginPath(); hh.moveTo(i + 1, seamY - 3); hh.lineTo(i + 5, seamY + 3); hh.stroke();
          rr.strokeStyle = 'rgba(120,120,120,.8)'; rr.lineWidth = 2;
          rr.beginPath(); rr.moveTo(i + 1, seamY - 3); rr.lineTo(i + 5, seamY + 3); rr.stroke();
        }
        break;
      }

      case 'cloth':                        // staff overalls
        this.fill(alb, '#bcbcbc'); this.fill(h, '#8a8a8a');
        for (i = 0; i < S; i += 3) {
          a.strokeStyle = 'rgba(0,0,0,.06)'; a.lineWidth = 1;
          a.beginPath(); a.moveTo(i, 0); a.lineTo(i, S); a.stroke();
          a.strokeStyle = 'rgba(255,255,255,.06)';
          a.beginPath(); a.moveTo(0, i); a.lineTo(S, i); a.stroke();
          hh.strokeStyle = i % 6 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.18)';
          hh.beginPath(); hh.moveTo(i, 0); hh.lineTo(i, S); hh.stroke();
        }
        break;

      default:
        this.fill(alb, '#888888'); this.fill(h, '#808080');
    }

    if (['concrete', 'checker', 'wall', 'ceiling', 'metal', 'grate', 'duct'].indexOf(name) >= 0) {
      this.grime(alb, h, rough, rnd, S, name);
    }

    var set = {
      map: this.tex(alb),
      normalMap: this.tex(this.normalFromHeight(h, name === 'carpet' ? 1.2 : name === 'plush' ? 2.0 : name === 'porcelain' ? 2.4 : 3.2)),
      roughnessMap: rough ? this.tex(rough) : null
    };
    this.cache[name] = set;
    return set;
  },

  /**
   * Dirt, drips, scuffs and wear. Everything in a working building has been
   * leaked on, dragged across or scrubbed at.
   */
  grime: function (alb, h, rough, rnd, S, name) {
    var a = alb.getContext('2d'), hh = h.getContext('2d');
    var vertical = (name === 'wall' || name === 'duct');
    var i;

    // broad patches of accumulated dirt
    for (i = 0; i < 26; i++) {
      var px = rnd() * S, py = rnd() * S, r = S * (0.06 + rnd() * 0.20);
      var g = a.createRadialGradient(px, py, 0, px, py, r);
      var dark = rnd() < 0.72;
      g.addColorStop(0, dark ? 'rgba(38,32,26,' + (0.10 + rnd() * 0.16) + ')'
                             : 'rgba(190,185,172,' + (0.05 + rnd() * 0.08) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      a.fillStyle = g;
      a.beginPath(); a.arc(px, py, r, 0, 6.2832); a.fill();
    }

    // rust and water staining, running downward on vertical surfaces
    for (i = 0; i < (vertical ? 20 : 9); i++) {
      var sx = rnd() * S, sy = rnd() * S;
      var len = S * (0.15 + rnd() * (vertical ? 0.6 : 0.25));
      var wdt = 2 + rnd() * (vertical ? 10 : 26);
      var gd = a.createLinearGradient(sx, sy, sx, sy + len);
      var rust = rnd() < 0.4;
      gd.addColorStop(0, rust ? 'rgba(122,68,32,.34)' : 'rgba(44,40,34,.28)');
      gd.addColorStop(1, 'rgba(0,0,0,0)');
      a.fillStyle = gd;
      a.fillRect(sx, sy, wdt, len);
      hh.fillStyle = 'rgba(0,0,0,.14)';
      hh.fillRect(sx, sy, wdt, len);
      if (rough) {
        var rr2 = rough.getContext('2d');
        rr2.fillStyle = 'rgba(255,255,255,.20)';   // dried stains are rougher
        rr2.fillRect(sx, sy, wdt, len);
      }
    }

    // scuffs and drag marks
    for (i = 0; i < 46; i++) {
      var ax = rnd() * S, ay = rnd() * S, an = rnd() * 6.2832;
      var L = S * (0.02 + rnd() * 0.13);
      a.strokeStyle = rnd() < 0.6 ? 'rgba(30,26,22,.20)' : 'rgba(215,212,204,.14)';
      a.lineWidth = 1 + rnd() * 3;
      a.beginPath();
      a.moveTo(ax, ay);
      a.lineTo(ax + Math.cos(an) * L, ay + Math.sin(an) * L);
      a.stroke();
    }

    // chipped edges, which read as wear at grazing angles
    for (i = 0; i < 60; i++) {
      var cx2 = rnd() * S, cy2 = rnd() * S, cr = 1 + rnd() * 4;
      a.fillStyle = 'rgba(24,22,20,.30)';
      a.beginPath(); a.arc(cx2, cy2, cr, 0, 6.2832); a.fill();
      hh.fillStyle = 'rgba(0,0,0,.55)';
      hh.beginPath(); hh.arc(cx2, cy2, cr, 0, 6.2832); hh.fill();
    }
  },

  /**
   * A whole eye on one texture — sclera, veins, limbal ring, fibrous iris,
   * pupil. One mesh per eye instead of four, and it reads far better than
   * stacked spheres.
   */
  eyeTex: function (iris) {
    var key = 'eye' + iris;
    if (this.cache[key]) return this.cache[key];
    var S = 256, c = this.cv(S), x = c.getContext('2d');
    var rnd = PP.rng(iris | 0);
    x.fillStyle = '#f2efe8'; x.fillRect(0, 0, S, S);
    // a faint warm shadow toward the corners of the sclera
    var sg = x.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.62);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(1, 'rgba(196,176,166,.85)');
    x.fillStyle = sg; x.fillRect(0, 0, S, S);
    // veins
    for (var v = 0; v < 26; v++) {
      var a0 = rnd() * 6.2832, r0 = S * (0.30 + rnd() * 0.2);
      x.strokeStyle = 'rgba(196,72,72,' + (0.10 + rnd() * 0.16) + ')';
      x.lineWidth = 0.7 + rnd();
      x.beginPath();
      x.moveTo(S / 2 + Math.cos(a0) * r0, S / 2 + Math.sin(a0) * r0);
      for (var seg = 0; seg < 4; seg++) {
        r0 -= S * 0.035;
        a0 += (rnd() - 0.5) * 0.7;
        x.lineTo(S / 2 + Math.cos(a0) * r0, S / 2 + Math.sin(a0) * r0);
      }
      x.stroke();
    }
    var col = new THREE.Color(iris);
    var R = S * 0.30;
    // iris body, darker at the rim
    var ig = x.createRadialGradient(S / 2, S / 2, R * 0.25, S / 2, S / 2, R);
    ig.addColorStop(0, '#' + col.clone().multiplyScalar(1.5).getHexString());
    ig.addColorStop(0.65, '#' + col.getHexString());
    ig.addColorStop(1, '#' + col.clone().multiplyScalar(0.42).getHexString());
    x.fillStyle = ig;
    x.beginPath(); x.arc(S / 2, S / 2, R, 0, 6.2832); x.fill();
    // radial fibres
    for (var f = 0; f < 200; f++) {
      var fa = rnd() * 6.2832, r1 = R * (0.28 + rnd() * 0.2), r2 = R * (0.75 + rnd() * 0.24);
      x.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.26)';
      x.lineWidth = 0.9;
      x.beginPath();
      x.moveTo(S / 2 + Math.cos(fa) * r1, S / 2 + Math.sin(fa) * r1);
      x.lineTo(S / 2 + Math.cos(fa) * r2, S / 2 + Math.sin(fa) * r2);
      x.stroke();
    }
    // limbal ring — the dark band that makes an eye read as an eye
    x.strokeStyle = 'rgba(10,8,14,.85)'; x.lineWidth = R * 0.16;
    x.beginPath(); x.arc(S / 2, S / 2, R * 0.94, 0, 6.2832); x.stroke();
    x.fillStyle = '#07060a';
    x.beginPath(); x.arc(S / 2, S / 2, R * 0.44, 0, 6.2832); x.fill();
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = this.aniso;
    this.cache[key] = t;
    return t;
  },

  /**
   * Two 2x2 decal atlases — floor markings and wall signage. Everything that
   * makes a room look worked in rather than modelled.
   */
  decals: function (kind) {
    var key = 'decal' + kind;
    if (this.cache[key]) return this.cache[key];
    var S = 512, H = S / 2, c = this.cv(S), x = c.getContext('2d');
    var rnd = PP.rng(kind === 'floor' ? 31 : 77);
    x.clearRect(0, 0, S, S);

    function cell(i, j, fn) { x.save(); x.translate(i * H, j * H); fn(H); x.restore(); }

    if (kind === 'floor') {
      // hazard stripes
      cell(0, 0, function (D) {
        x.fillStyle = '#b8922a'; x.fillRect(0, D * 0.30, D, D * 0.40);
        x.fillStyle = '#2a2a2e';
        for (var i = -D; i < D * 2; i += D * 0.19) {
          x.beginPath();
          x.moveTo(i, D * 0.30); x.lineTo(i + D * 0.095, D * 0.30);
          x.lineTo(i + D * 0.095 + D * 0.40, D * 0.70); x.lineTo(i + D * 0.40, D * 0.70);
          x.closePath(); x.fill();
        }
        // worn away in the middle where people walk
        x.globalCompositeOperation = 'destination-out';
        for (var w = 0; w < 190; w++) {
          x.globalAlpha = 0.08 + rnd() * 0.42;
          x.beginPath();
          x.arc(rnd() * D, D * 0.3 + rnd() * D * 0.4, 3 + rnd() * 20, 0, 6.2832);
          x.fill();
        }
        x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      });
      // oil stain
      cell(1, 0, function (D) {
        for (var i = 0; i < 26; i++) {
          var px = D / 2 + (rnd() - 0.5) * D * 0.55, py = D / 2 + (rnd() - 0.5) * D * 0.55;
          var r = D * (0.05 + rnd() * 0.18);
          var g = x.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, 'rgba(14,12,14,' + (0.20 + rnd() * 0.35) + ')');
          g.addColorStop(1, 'rgba(14,12,14,0)');
          x.fillStyle = g;
          x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
        }
      });
      // floor drain
      cell(0, 1, function (D) {
        var cx = D / 2, cy = D / 2, R = D * 0.34;
        x.fillStyle = '#3a3f48';
        x.beginPath(); x.arc(cx, cy, R, 0, 6.2832); x.fill();
        x.fillStyle = '#14171c';
        x.beginPath(); x.arc(cx, cy, R * 0.82, 0, 6.2832); x.fill();
        x.strokeStyle = '#585f6b'; x.lineWidth = D * 0.035;
        for (var b = -4; b <= 4; b++) {
          x.beginPath();
          x.moveTo(cx + b * R * 0.19, cy - R * 0.78);
          x.lineTo(cx + b * R * 0.19, cy + R * 0.78);
          x.stroke();
        }
        x.strokeStyle = '#6d757f'; x.lineWidth = D * 0.03;
        x.beginPath(); x.arc(cx, cy, R * 0.9, 0, 6.2832); x.stroke();
      });
      // lane arrow
      cell(1, 1, function (D) {
        x.fillStyle = 'rgba(226,214,120,.72)';
        x.beginPath();
        x.moveTo(D * 0.5, D * 0.16); x.lineTo(D * 0.80, D * 0.52);
        x.lineTo(D * 0.63, D * 0.52); x.lineTo(D * 0.63, D * 0.86);
        x.lineTo(D * 0.37, D * 0.86); x.lineTo(D * 0.37, D * 0.52);
        x.lineTo(D * 0.20, D * 0.52);
        x.closePath(); x.fill();
        x.globalCompositeOperation = 'destination-out';
        for (var w = 0; w < 60; w++) {
          x.globalAlpha = 0.1 + rnd() * 0.4;
          x.beginPath(); x.arc(rnd() * D, rnd() * D, 3 + rnd() * 12, 0, 6.2832); x.fill();
        }
        x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      });
    } else {
      // a warning plate
      cell(0, 0, function (D) {
        x.fillStyle = '#d8c02a';
        x.beginPath();
        x.moveTo(D * 0.5, D * 0.14); x.lineTo(D * 0.88, D * 0.80);
        x.lineTo(D * 0.12, D * 0.80); x.closePath(); x.fill();
        x.strokeStyle = '#17171a'; x.lineWidth = D * 0.045; x.stroke();
        x.fillStyle = '#17171a';
        x.fillRect(D * 0.465, D * 0.34, D * 0.07, D * 0.26);
        x.beginPath(); x.arc(D * 0.5, D * 0.68, D * 0.045, 0, 6.2832); x.fill();
      });
      // a door number plate
      cell(1, 0, function (D) {
        x.fillStyle = 'rgba(126,134,148,.95)';
        x.fillRect(D * 0.12, D * 0.30, D * 0.76, D * 0.40);
        x.strokeStyle = 'rgba(210,218,232,.9)'; x.lineWidth = D * 0.02;
        x.strokeRect(D * 0.12, D * 0.30, D * 0.76, D * 0.40);
        x.fillStyle = '#f2f5fa';
        x.font = 'bold ' + (D * 0.20) + 'px Trebuchet MS';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('SECTOR 4', D * 0.5, D * 0.51);
      });
      // a peeling poster
      cell(0, 1, function (D) {
        x.fillStyle = '#e8ddc4';
        x.fillRect(D * 0.16, D * 0.10, D * 0.68, D * 0.80);
        x.fillStyle = '#3f6fbf';
        x.fillRect(D * 0.16, D * 0.10, D * 0.68, D * 0.22);
        x.fillStyle = '#f7f2e4';
        x.font = 'bold ' + (D * 0.10) + 'px Trebuchet MS';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText('PLAYTIME', D * 0.5, D * 0.21);
        x.fillStyle = '#c8503f';
        x.beginPath(); x.arc(D * 0.5, D * 0.52, D * 0.14, 0, 6.2832); x.fill();
        x.fillStyle = '#2b2b30';
        x.font = (D * 0.062) + 'px Trebuchet MS';
        x.fillText('SAFETY FIRST', D * 0.5, D * 0.76);
        // torn corner
        x.globalCompositeOperation = 'destination-out';
        x.beginPath();
        x.moveTo(D * 0.84, D * 0.10); x.lineTo(D * 0.84, D * 0.34); x.lineTo(D * 0.58, D * 0.10);
        x.closePath(); x.fill();
        x.globalCompositeOperation = 'source-over';
      });
      // scorch / handprints
      cell(1, 1, function (D) {
        for (var i = 0; i < 20; i++) {
          var px = D / 2 + (rnd() - 0.5) * D * 0.6, py = D / 2 + (rnd() - 0.5) * D * 0.6;
          var r = D * (0.04 + rnd() * 0.16);
          var g = x.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, 'rgba(44,34,28,' + (0.05 + rnd() * 0.10) + ')');
          g.addColorStop(1, 'rgba(44,34,28,0)');
          x.fillStyle = g;
          x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.fill();
        }
      });
    }
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = this.aniso;
    this.cache[key] = t;
    return t;
  },

  /** Soft gradient for the volumetric cones under ceiling lights. */
  shaftTex: function () {
    if (this._shaft) return this._shaft;
    var c = document.createElement('canvas');
    c.width = 32; c.height = 128;
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.00, 'rgba(255,244,222,0)');     // floor end, invisible
    g.addColorStop(0.55, 'rgba(255,240,214,0.16)');
    g.addColorStop(0.92, 'rgba(255,246,228,0.55)');
    g.addColorStop(1.00, 'rgba(255,250,236,0.75)');  // right under the fitting
    x.fillStyle = g; x.fillRect(0, 0, 32, 128);
    // fade the cone's silhouette so the edges are not hard lines
    var e = x.createLinearGradient(0, 0, 32, 0);
    e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(0.5, 'rgba(0,0,0,0)');
    e.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = e; x.fillRect(0, 0, 32, 128);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    this._shaft = t;
    return t;
  },

  /**
   * A tiny equirectangular "room" — dark floor, lit ceiling — run through
   * PMREM. Without an environment, anything metallic renders pure black.
   */
  envMap: function (renderer) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0.00, '#8d97a8');   // ceiling
    g.addColorStop(0.35, '#3d4451');
    g.addColorStop(0.52, '#1d212a');   // horizon
    g.addColorStop(1.00, '#07090d');   // floor
    x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    // a few warm patches where the strip lights would be
    for (var i = 0; i < 6; i++) {
      var lg = x.createRadialGradient(20 + i * 42, 16, 2, 20 + i * 42, 16, 26);
      lg.addColorStop(0, 'rgba(255,240,210,.55)');
      lg.addColorStop(1, 'rgba(255,240,210,0)');
      x.fillStyle = lg; x.fillRect(0, 0, 256, 60);
    }
    var t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    var pm = new THREE.PMREMGenerator(renderer);
    pm.compileEquirectangularShader();
    var rt = pm.fromEquirectangular(t);
    pm.dispose(); t.dispose();
    return rt.texture;
  },

  /** A standard material wearing one of the surfaces above. */
  mat: function (name, opts) {
    opts = opts || {};
    var set = this.build(name);
    var Ctor = opts.sheen ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    var m = new Ctor({
      map: set.map.clone(),
      normalMap: set.normalMap.clone(),
      roughness: opts.roughness == null ? 0.85 : opts.roughness,
      metalness: opts.metalness == null ? 0.04 : opts.metalness,
      color: opts.color == null ? 0xffffff : opts.color,
      side: opts.side || THREE.FrontSide
    });
    if (set.roughnessMap) {
      m.roughnessMap = set.roughnessMap.clone();
      m.roughnessMap.needsUpdate = true;
    }
    m.map.needsUpdate = m.normalMap.needsUpdate = true;
    var r = opts.repeat || 1;
    m.map.repeat.set(r, opts.repeatY || r);
    m.normalMap.repeat.set(r, opts.repeatY || r);
    if (m.roughnessMap) m.roughnessMap.repeat.set(r, opts.repeatY || r);
    // sheen is what makes velvet and short-pile plush read as fabric
    if (opts.sheen) {
      m.sheen = opts.sheen;
      m.sheenRoughness = opts.sheenRoughness == null ? 0.85 : opts.sheenRoughness;
      m.sheenColor = new THREE.Color(opts.sheenColor == null ? 0xffffff : opts.sheenColor);
    }
    m.normalScale = new THREE.Vector2(opts.normal == null ? 1 : opts.normal,
                                      opts.normal == null ? 1 : opts.normal);
    m.envMapIntensity = opts.env == null ? 0.30 : opts.env;
    if (opts.emissive != null) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity || 1; }
    return m;
  }
};
