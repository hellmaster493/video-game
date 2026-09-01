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
  build: function (name) {
    if (this.cache[name]) return this.cache[name];
    var S = 256, rnd = PP.rng(name.split('').reduce(function (a, ch) { return a + ch.charCodeAt(0) * 31; }, 7));
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
        this.fill(alb, '#83878f'); this.fill(h, '#909090');
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

      case 'plush':                        // monster fabric
        this.fill(alb, '#b4b4b4'); this.fill(h, '#8a8a8a');
        for (i = 0; i < 9000; i++) {
          var fx = rnd() * S, fy = rnd() * S, fa = rnd() * 6.2832;
          a.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.24)' : 'rgba(0,0,0,.20)';
          a.lineWidth = 1;
          a.beginPath(); a.moveTo(fx, fy);
          a.lineTo(fx + Math.cos(fa) * 4, fy + Math.sin(fa) * 4); a.stroke();
          hh.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.30)' : 'rgba(0,0,0,.30)';
          hh.beginPath(); hh.moveTo(fx, fy);
          hh.lineTo(fx + Math.cos(fa) * 4, fy + Math.sin(fa) * 4); hh.stroke();
        }
        break;

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

    var set = {
      map: this.tex(alb),
      normalMap: this.tex(this.normalFromHeight(h, name === 'carpet' || name === 'plush' ? 1.2 : 3.2))
    };
    this.cache[name] = set;
    return set;
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
    var m = new THREE.MeshStandardMaterial({
      map: set.map.clone(),
      normalMap: set.normalMap.clone(),
      roughness: opts.roughness == null ? 0.85 : opts.roughness,
      metalness: opts.metalness == null ? 0.04 : opts.metalness,
      color: opts.color == null ? 0xffffff : opts.color,
      side: opts.side || THREE.FrontSide
    });
    m.map.needsUpdate = m.normalMap.needsUpdate = true;
    var r = opts.repeat || 1;
    m.map.repeat.set(r, opts.repeatY || r);
    m.normalMap.repeat.set(r, opts.repeatY || r);
    m.normalScale = new THREE.Vector2(opts.normal == null ? 1 : opts.normal,
                                      opts.normal == null ? 1 : opts.normal);
    m.envMapIntensity = opts.env == null ? 0.30 : opts.env;
    if (opts.emissive != null) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity || 1; }
    return m;
  }
};
