/* ═══════════════════════════════════════════════════════════
   scene.js — the three.js layer: level geometry merged out of
   the tile grid, lighting, actors, camera and the GrabPack.

   World mapping: the 2D game logic lives in (x, y); here that
   becomes (x, 0, y), with +Y up. 32 units = 1 tile = 2 m.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.CEIL = 3.9 * PP.M;    // room ceiling height — industrial, not domestic
PP.VENT_H = 1.15 * PP.M; // duct ceiling — you are crawling in there

/* ── a tiny geometry builder, since BufferGeometryUtils is an addon ── */
function Geo() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
/** ao is four corner brightnesses (0..1) baked into vertex colour. */
Geo.prototype.quad = function (a, b, c, d, nx, ny, nz, uvs, ao) {
  var base = this.p.length / 3;
  [a, b, c, d].forEach(function (v) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); }, this);
  this.u.push(uvs[0], uvs[1], uvs[2], uvs[3], uvs[4], uvs[5], uvs[6], uvs[7]);
  ao = ao || [1, 1, 1, 1];
  for (var k = 0; k < 4; k++) this.c.push(ao[k], ao[k], ao[k]);
  // split the quad along the shorter AO gradient so the shading doesn't crease
  if (Math.abs(ao[0] - ao[2]) > Math.abs(ao[1] - ao[3])) {
    this.i.push(base, base + 1, base + 3, base + 1, base + 2, base + 3);
  } else {
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
};
Geo.prototype.empty = function () { return this.p.length === 0; };
Geo.prototype.finish = function () {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
  g.setIndex(this.i);
  g.computeBoundingSphere();
  return g;
};

PP.Scene = {
  renderer: null, scene: null, camera: null, canvas: null,
  levelGroup: null, propGroup: null, actorGroup: null, fxGroup: null,
  lampMeshes: [], lampPool: [], torch: null, torchTarget: null,
  hands: {}, shadowTex: null, ready: false,
  quality: 1, thirdPerson: false, camShake: 0,

  init: function (canvas) {
    this.canvas = canvas;
    var r = this.renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, powerPreference: 'high-performance'
    });
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.physicallyCorrectLights = false;   // intensities below are plain multipliers


    this.scene = new THREE.Scene();
    this.scene.environment = PP.Tex.envMap(r);
    this.camera = new THREE.PerspectiveCamera(74, 1, 1, 3000);
    this.camera.rotation.order = 'YXZ';

    PP.Post.init(r);
    this.applyQuality((PP.Save.data && PP.Save.data.gfx) || 'high');

    this.shadowTex = this.makeBlobShadow();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    this.resize();
  },

  resize: function () {
    var w = window.innerWidth, h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr || 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    PP.Post.resize(w, h, dpr);
  },

  /** Three presets, because a soft-rendered laptop should still be playable. */
  applyQuality: function (level) {
    var r = this.renderer;
    this.quality = level;
    if (level === 'low') {
      this.maxDpr = 1; PP.Post.enabled = false;
      r.shadowMap.enabled = false;
      this.shaftsOn = false; this.roomShadow = false;
      PP.Post.ssao = false; PP.Post.fxaa = false;
    } else if (level === 'medium') {
      this.maxDpr = 1.5; PP.Post.enabled = true;
      PP.Post.params.bloom = 0.5;
      PP.Post.ssao = true; PP.Post.fxaa = true;
      PP.Post.params.ao = 0.75;
      r.shadowMap.enabled = true;
      this.shadowSize = 512;
      this.shaftsOn = true; this.roomShadow = false;
    } else {
      this.maxDpr = 2; PP.Post.enabled = true;
      PP.Post.params.bloom = 0.62;
      PP.Post.ssao = true; PP.Post.fxaa = true;
      PP.Post.params.ao = 1.0;
      r.shadowMap.enabled = true;
      this.shadowSize = 1024;
      this.shaftsOn = true; this.roomShadow = true;
    }
    if (this.roomLight) {
      this.roomLight.castShadow = r.shadowMap.enabled && this.roomShadow;
      if (this.roomLight.shadow.map) {
        this.roomLight.shadow.map.dispose(); this.roomLight.shadow.map = null;
      }
    }
    if (this.torch) {
      this.torch.castShadow = r.shadowMap.enabled;
      this.torch.shadow.mapSize.set(this.shadowSize || 1024, this.shadowSize || 1024);
      if (this.torch.shadow.map) { this.torch.shadow.map.dispose(); this.torch.shadow.map = null; }
    }
    if (this.shafts) this.shafts.forEach(function (m) { m.visible = false; });
    this.resize();
  },

  /** soft round blob used as a cheap contact shadow under every actor */
  makeBlobShadow: function () {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,.75)');
    g.addColorStop(0.55, 'rgba(0,0,0,.34)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c);
    return t;
  },

  /* ═════════ level ═════════ */
  build: function (game) {
    var W = PP.World, T = PP.TILE, Tt = PP.T, M = PP.M;
    this.dispose();

    this.levelGroup = new THREE.Group(); this.scene.add(this.levelGroup);
    this.propGroup = new THREE.Group(); this.scene.add(this.propGroup);
    this.actorGroup = new THREE.Group(); this.scene.add(this.actorGroup);
    this.fxGroup = new THREE.Group(); this.scene.add(this.fxGroup);

    // one geometry bucket per surface
    var floorTex = {};
    floorTex[Tt.FLOOR] = 'concrete'; floorTex[Tt.CHECKER] = 'checker';
    floorTex[Tt.CARPET] = 'carpet'; floorTex[Tt.CONVEYOR] = 'metal';
    floorTex[Tt.GRATE] = 'grate'; floorTex[Tt.VENT] = 'duct';
    var B = {}, self = this;
    function bucket(name) { if (!B[name]) B[name] = new Geo(); return B[name]; }

    var ceilOf = function (tx, ty) {
      return W.at(tx, ty) === Tt.VENT ? PP.VENT_H : PP.CEIL;
    };
    var solid = function (tx, ty) { return W.solid(tx, ty); };

    /* Baked ambient occlusion. A floor corner darkens for each solid tile
       touching it — that is what grounds the walls and reads room corners. */
    function floorAO(tx, ty, sx, sz) {
      var s1 = solid(tx + sx, ty), s2 = solid(tx, ty + sz);
      var n = (s1 ? 1 : 0) + (s2 ? 1 : 0) + ((s1 && s2) ? 1 : (solid(tx + sx, ty + sz) ? 1 : 0));
      return [1.0, 0.76, 0.58, 0.44][n];
    }
    /* Wall faces darken hard at the floor and softly at the ceiling. */
    function wallAO(tx, ty, ax, az, top) {
      var v = top ? 0.94 : 0.52;
      if (solid(tx + ax, ty + az)) v *= 0.88;   // an inside corner with the next wall
      return v;
    }

    /* Skirting board and dado rail: two shallow ledges proud of the wall.
       Cheap geometry, but it stops every wall reading as one flat plane. */
    function trim(at, a0, a1, axis, dir, skH, railY, railH, out) {
      var g = bucket('trim');
      function ledge(y0, y1) {
        var o = at + dir * out;
        if (axis === 'x') {
          g.quad([o, y0, a1], [o, y1, a1], [o, y1, a0], [o, y0, a0],
                 dir, 0, 0, [0, 0, 0, (y1 - y0) / 24, 2, (y1 - y0) / 24, 2, 0],
                 [0.55, 0.95, 0.95, 0.55]);
          g.quad([at, y1, a0], [o, y1, a0], [o, y1, a1], [at, y1, a1],
                 0, 1, 0, [0, 0, 1, 0, 1, 1, 0, 1], [0.85, 1, 1, 0.85]);
        } else {
          g.quad([a0, y0, o], [a0, y1, o], [a1, y1, o], [a1, y0, o],
                 0, 0, dir, [0, 0, 0, (y1 - y0) / 24, 2, (y1 - y0) / 24, 2, 0],
                 [0.55, 0.95, 0.95, 0.55]);
          g.quad([a0, y1, at], [a0, y1, o], [a1, y1, o], [a1, y1, at],
                 0, 1, 0, [0, 0, 1, 0, 1, 1, 0, 1], [0.85, 1, 1, 0.85]);
        }
      }
      ledge(0, skH);
      ledge(railY, railY + railH);
    }

    for (var ty = 0; ty < W.H; ty++) {
      for (var tx = 0; tx < W.W; tx++) {
        var t = W.at(tx, ty);
        var x0 = tx * T, x1 = x0 + T, z0 = ty * T, z1 = z0 + T;

        if (t !== Tt.VOID && t !== Tt.WALL) {
          // floor — UVs in tile units so the texture tiles seamlessly
          bucket(floorTex[t] || 'concrete').quad(
            [x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0],
            0, 1, 0, [tx, ty, tx, ty + 1, tx + 1, ty + 1, tx + 1, ty],
            [floorAO(tx, ty, -1, -1), floorAO(tx, ty, -1, 1),
             floorAO(tx, ty, 1, 1), floorAO(tx, ty, 1, -1)]);
          // ceiling
          var ch = ceilOf(tx, ty);
          bucket(t === Tt.VENT ? 'duct' : 'ceiling').quad(
            [x0, ch, z1], [x0, ch, z0], [x1, ch, z0], [x1, ch, z1],
            0, -1, 0, [tx, ty + 1, tx, ty, tx + 1, ty, tx + 1, ty + 1],
            [0.1 + 0.9 * floorAO(tx, ty, -1, 1), 0.1 + 0.9 * floorAO(tx, ty, -1, -1),
             0.1 + 0.9 * floorAO(tx, ty, 1, -1), 0.1 + 0.9 * floorAO(tx, ty, 1, 1)]);
          continue;
        }

        // a solid tile shows a face wherever it borders open space
        var nbs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var k = 0; k < 4; k++) {
          var nx = tx + nbs[k][0], nz = ty + nbs[k][1];
          var nt = W.at(nx, nz);
          if (nt === Tt.VOID || nt === Tt.WALL) continue;
          var h = ceilOf(nx, nz);
          var mat = nt === Tt.VENT ? 'duct' : 'wall';
          var uw = T / T, uh = h / T;
          var vent = nt === Tt.VENT;
          var lo = wallAO(tx, ty, nbs[k][1], nbs[k][0], false);
          var hiA = wallAO(tx, ty, nbs[k][1], nbs[k][0], true);
          var uv = [0, 0, 0, uh, uw, uh, uw, 0], ao = [lo, hiA, hiA, lo];
          var SK = 0.15 * PP.M, RAIL = 1.02 * PP.M, RH = 0.055 * PP.M, OUT = 0.04 * PP.M;

          if (nbs[k][0] === 1) {
            bucket(mat).quad([x1, 0, z1], [x1, h, z1], [x1, h, z0], [x1, 0, z0], 1, 0, 0, uv, ao);
            if (!vent) trim(x1, z0, z1, 'x', 1, SK, RAIL, RH, OUT);
          } else if (nbs[k][0] === -1) {
            bucket(mat).quad([x0, 0, z0], [x0, h, z0], [x0, h, z1], [x0, 0, z1], -1, 0, 0, uv, ao);
            if (!vent) trim(x0, z0, z1, 'x', -1, SK, RAIL, RH, OUT);
          } else if (nbs[k][1] === 1) {
            bucket(mat).quad([x0, 0, z1], [x0, h, z1], [x1, h, z1], [x1, 0, z1], 0, 0, 1, uv, ao);
            if (!vent) trim(z1, x0, x1, 'z', 1, SK, RAIL, RH, OUT);
          } else {
            bucket(mat).quad([x1, 0, z0], [x1, h, z0], [x0, h, z0], [x0, 0, z0], 0, 0, -1, uv, ao);
            if (!vent) trim(z0, x0, x1, 'z', -1, SK, RAIL, RH, OUT);
          }
        }
      }
    }

    var matOpts = {
      concrete: { roughness: 0.94, metalness: 0.02, normal: 1.1 },
      checker:  { roughness: 0.62, metalness: 0.05, normal: 0.8 },
      carpet:   { roughness: 1.0,  metalness: 0.0,  normal: 0.7 },
      metal:    { roughness: 0.45, metalness: 0.75, normal: 1.0 },
      grate:    { roughness: 0.55, metalness: 0.7,  normal: 1.4 },
      duct:     { roughness: 0.6,  metalness: 0.55, normal: 1.2 },
      wall:     { roughness: 0.88, metalness: 0.03, normal: 1.0 },
      ceiling:  { roughness: 0.95, metalness: 0.0,  normal: 0.6 },
      trim:     { roughness: 0.55, metalness: 0.12, normal: 0.7, color: 0x9aa2b0 }
    };
    Object.keys(B).forEach(function (name) {
      if (B[name].empty()) return;
      var opts = matOpts[name] || {};
      var mat = PP.Tex.mat(name === 'trim' ? 'metal' : name, opts);
      mat.vertexColors = true;                 // baked AO rides in the colour channel
      var mesh = new THREE.Mesh(B[name].finish(), mat);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;   // the level never moves
      mesh.updateMatrix();
      self.levelGroup.add(mesh);
    });

    this.buildLamps(game);
    this.buildDressing();
    this.buildProps();
    this.buildLights(game);
    this.buildHands(game);
    this.ready = true;
  },

  /** ~60 fittings, drawn as two instanced meshes rather than 120 draws. */
  buildLamps: function (game) {
    var M = PP.M, self = this;
    this.lampMeshes = PP.World.lamps;
    var n = this.lampMeshes.length;
    if (!n) return;

    var housing = PP.Models.plain(0x30353d, 0.55, 0.45);
    var tubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    var caseGeo = new THREE.BoxGeometry(1.7 * M, 0.13 * M, 0.46 * M);
    var tubeGeo = new THREE.BoxGeometry(1.5 * M, 0.09 * M, 0.32 * M);

    this.lampCases = new THREE.InstancedMesh(caseGeo, housing, n);
    this.lampTubes = new THREE.InstancedMesh(tubeGeo, tubeMat, n);
    this.lampTubes.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);

    var m4 = new THREE.Matrix4();
    for (var i = 0; i < n; i++) {
      var l = this.lampMeshes[i];
      l.idx = i;
      m4.makeTranslation(l.x, PP.CEIL - 0.10 * M + 0.06 * M, l.y);
      this.lampCases.setMatrixAt(i, m4);
      m4.makeTranslation(l.x, PP.CEIL - 0.10 * M, l.y);
      this.lampTubes.setMatrixAt(i, m4);
    }
    this.lampCases.instanceMatrix.needsUpdate = true;
    this.lampTubes.instanceMatrix.needsUpdate = true;
    this.lampCases.frustumCulled = false;
    this.lampTubes.frustumCulled = false;
    this.levelGroup.add(this.lampCases);
    this.levelGroup.add(this.lampTubes);
    this._lampCol = new THREE.Color();
  },

  /**
   * Set dressing: the pipework, grilles, floor markings and signage that make a
   * room read as a place somebody worked in. All merged into four meshes.
   */
  buildDressing: function () {
    var M = PP.M, T = PP.TILE, W = PP.World, self = this;
    var rnd = PP.rng(4242);
    var pipes = [], grilles = [], floorQ = new Geo(), wallQ = new Geo();

    function pipeRun(x0, z0, x1, z1, y, r) {
      var len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 20) return;
      var ang = Math.atan2(z1 - z0, x1 - x0);
      pipes.push({ g: new THREE.CylinderGeometry(r, r, len, 10),
                   m: PP.Models.xf((x0 + x1) / 2, y, (z0 + z1) / 2, 0, -ang, Math.PI / 2) });
      // collars along the run, and a bracket up to the ceiling every few metres
      var n = Math.max(1, Math.floor(len / (2.6 * M)));
      for (var i = 0; i <= n; i++) {
        var f = i / n, px = x0 + (x1 - x0) * f, pz = z0 + (z1 - z0) * f;
        pipes.push({ g: new THREE.TorusGeometry(r * 1.35, r * 0.36, 6, 12),
                     m: PP.Models.xf(px, y, pz, 0, -ang, Math.PI / 2) });
        if (i % 2 === 0) {
          pipes.push({ g: new THREE.BoxGeometry(r * 0.5, PP.CEIL - y, r * 0.5),
                       m: PP.Models.xf(px, (PP.CEIL + y) / 2, pz) });
        }
      }
    }

    /** A quad from the decal atlas: cell (ci,cj) of a 2x2 sheet. */
    function decal(geo, pts, nx, ny, nz, ci, cj) {
      var u0 = ci * 0.5, v0 = cj * 0.5, u1 = u0 + 0.5, v1 = v0 + 0.5;
      geo.quad(pts[0], pts[1], pts[2], pts[3], nx, ny, nz,
               [u0, v0, u0, v1, u1, v1, u1, v0], [1, 1, 1, 1]);
    }

    W.rooms.forEach(function (r) {
      var x0 = r.x * T, x1 = (r.x + r.w) * T, z0 = r.y * T, z1 = (r.y + r.h) * T;
      var alongX = r.w >= r.h;
      var py = PP.CEIL - 0.42 * M;

      // ceiling pipe runs down the long axis
      var runs = r.w > 18 || r.h > 18 ? 3 : 2;
      for (var i = 0; i < runs; i++) {
        var f = (i + 1) / (runs + 1);
        var rad = (0.10 + (i % 2) * 0.045) * M;
        if (alongX) pipeRun(x0 + T, z0 + (z1 - z0) * f, x1 - T, z0 + (z1 - z0) * f, py, rad);
        else        pipeRun(x0 + (x1 - x0) * f, z0 + T, x0 + (x1 - x0) * f, z1 - T, py, rad);
      }
      // a cable tray hugging one wall
      var ty = PP.CEIL - 0.75 * M;
      if (alongX) {
        pipes.push({ g: new THREE.BoxGeometry(x1 - x0 - T, 0.10 * M, 0.34 * M),
                     m: PP.Models.xf((x0 + x1) / 2, ty, z0 + 0.55 * M) });
      } else {
        pipes.push({ g: new THREE.BoxGeometry(0.34 * M, 0.10 * M, z1 - z0 - T),
                     m: PP.Models.xf(x0 + 0.55 * M, ty, (z0 + z1) / 2) });
      }

      // wall grilles, set into the wall face
      var gy = PP.CEIL - 1.05 * M, gw = 0.7 * M, gh = 0.45 * M;
      [[x0 + (x1 - x0) * 0.3, z0 + 0.06 * M, 0], [x1 - 0.06 * M, z0 + (z1 - z0) * 0.6, Math.PI / 2],
       [x0 + (x1 - x0) * 0.7, z1 - 0.06 * M, 0], [x0 + 0.06 * M, z0 + (z1 - z0) * 0.35, Math.PI / 2]
      ].forEach(function (p, k) {
        if (rnd() < 0.35) return;
        grilles.push({ g: new THREE.BoxGeometry(gw, gh, 0.09 * M),
                       m: PP.Models.xf(p[0], gy, p[1], 0, p[2], 0) });
        for (var b = 0; b < 4; b++) {
          grilles.push({ g: new THREE.BoxGeometry(gw * 0.86, gh * 0.10, 0.13 * M),
                         m: PP.Models.xf(p[0], gy - gh * 0.28 + b * gh * 0.19, p[1], 0, p[2], 0) });
        }
      });

      // floor markings: stains, drains and a lane arrow
      var marks = 2 + Math.floor(rnd() * 3);
      for (var mI = 0; mI < marks; mI++) {
        var sp = W.spotIn(r, 2), sz = (1.1 + rnd() * 1.6) * M;
        var cell = rnd() < 0.55 ? [1, 0] : (rnd() < 0.5 ? [0, 1] : [1, 1]);
        var rot = rnd() * 6.2832;
        var ca = Math.cos(rot), sa = Math.sin(rot);
        var pt = function (dx, dz) {
          return [sp.x + dx * ca - dz * sa, 0.18, sp.y + dx * sa + dz * ca];
        };
        decal(floorQ, [pt(-sz, -sz), pt(-sz, sz), pt(sz, sz), pt(sz, -sz)],
              0, 1, 0, cell[0], cell[1]);
      }
    });

    // hazard stripes across every hall mouth
    W.halls.forEach(function (h) {
      if (rnd() < 0.45) return;
      var horiz = h[2] >= h[3];
      var cx = (h[0] + h[2] / 2) * T, cz = (h[1] + h[3] / 2) * T;
      var half = (horiz ? h[3] : h[2]) * T * 0.5;
      var band = 0.55 * M;
      var p = horiz
        ? [[cx - band, 0.18, cz - half], [cx - band, 0.18, cz + half],
           [cx + band, 0.18, cz + half], [cx + band, 0.18, cz - half]]
        : [[cx - half, 0.18, cz - band], [cx - half, 0.18, cz + band],
           [cx + half, 0.18, cz + band], [cx + half, 0.18, cz - band]];
      decal(floorQ, p, 0, 1, 0, 0, 0);
    });

    // signage on the walls, facing into the room
    W.rooms.forEach(function (r) {
      var x0 = r.x * T, x1 = (r.x + r.w) * T, z0 = r.y * T, z1 = (r.y + r.h) * T;
      var n = 1 + Math.floor(rnd() * 2);
      for (var i = 0; i < n; i++) {
        var w = (0.85 + rnd() * 0.5) * M, hgt = w * 1.15;
        var y = (1.55 + rnd() * 0.5) * M;
        // cells (0,0) warning plate, (1,0) door number, (0,1) poster — never the grime cell
        var pick3 = Math.floor(rnd() * 3);
        var ci = pick3 === 1 ? 1 : 0, cj = pick3 === 2 ? 1 : 0;
        var side = Math.floor(rnd() * 4), e = 0.14 * M;
        var pts, nx = 0, nz = 0;
        if (side === 0) {
          var px = x0 + (x1 - x0) * (0.2 + rnd() * 0.6);
          pts = [[px - w, y - hgt, z0 + e], [px - w, y + hgt, z0 + e],
                 [px + w, y + hgt, z0 + e], [px + w, y - hgt, z0 + e]];
          nz = 1;
        } else if (side === 1) {
          var px2 = x0 + (x1 - x0) * (0.2 + rnd() * 0.6);
          pts = [[px2 + w, y - hgt, z1 - e], [px2 + w, y + hgt, z1 - e],
                 [px2 - w, y + hgt, z1 - e], [px2 - w, y - hgt, z1 - e]];
          nz = -1;
        } else if (side === 2) {
          var pz = z0 + (z1 - z0) * (0.2 + rnd() * 0.6);
          pts = [[x0 + e, y - hgt, pz + w], [x0 + e, y + hgt, pz + w],
                 [x0 + e, y + hgt, pz - w], [x0 + e, y - hgt, pz - w]];
          nx = 1;
        } else {
          var pz2 = z0 + (z1 - z0) * (0.2 + rnd() * 0.6);
          pts = [[x1 - e, y - hgt, pz2 - w], [x1 - e, y + hgt, pz2 - w],
                 [x1 - e, y + hgt, pz2 + w], [x1 - e, y - hgt, pz2 + w]];
          nx = -1;
        }
        decal(wallQ, pts, nx, 0, nz, ci, cj);
      }
    });

    var steel = PP.Tex.mat('metal', { roughness: 0.52, metalness: 0.55, repeat: 1, normal: 0.8 });
    if (pipes.length) {
      var pm = new THREE.Mesh(PP.Models.merge(pipes), steel);
      pm.castShadow = true; pm.receiveShadow = true;
      pm.matrixAutoUpdate = false; pm.updateMatrix();
      this.levelGroup.add(pm);
    }
    if (grilles.length) {
      var gm = new THREE.Mesh(PP.Models.merge(grilles),
                              PP.Models.plain(0x3b424e, 0.55, 0.5));
      gm.castShadow = true; gm.receiveShadow = true;
      gm.matrixAutoUpdate = false; gm.updateMatrix();
      this.levelGroup.add(gm);
    }
    function decalMesh(geo, tex) {
      if (geo.empty()) return;
      var mat = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, roughness: 0.85, metalness: 0.05,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
      mat.envMapIntensity = 0.2;
      var m = new THREE.Mesh(geo.finish(), mat);
      m.receiveShadow = true;
      m.renderOrder = 2;
      m.matrixAutoUpdate = false; m.updateMatrix();
      self.levelGroup.add(m);
    }
    decalMesh(floorQ, PP.Tex.decals('floor'));
    decalMesh(wallQ, PP.Tex.decals('wall'));
  },

  buildProps: function () {
    var self = this;
    PP.World.props.forEach(function (p) {
      if (p.kind === 'gas') return;
      var m = PP.Models.prop(p);
      if (!m) return;
      m.position.set(p.x, p.h || 0, p.y);
      if (p.rot != null) m.rotation.y = p.rot;
      m.userData.prop = p;
      m.traverse(function (o) { o.userData.prop = p; });
      p.obj = m;
      self.propGroup.add(m);
      // props with no moving parts can skip matrix recomputation every frame
      if (['crate', 'shelf', 'table', 'plant', 'toy', 'socket', 'node'].indexOf(p.kind) >= 0) {
        m.updateMatrixWorld(true);
        m.matrixAutoUpdate = false;
      }
    });
  },

  buildLights: function (game) {
    var s = this.scene;
    this.hemi = new THREE.HemisphereLight(0x3d4557, 0x14171d, 0.28);
    s.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x2a3040, 0.22);
    s.add(this.ambient);

    // a small pool of real point lights, reassigned to whichever lamps are nearest
    this.lampPool = [];
    var n = 11;
    for (var i = 0; i < n; i++) {
      var pl = new THREE.PointLight(0xffe6bd, 0, 560, 1.5);
      pl.castShadow = false;
      s.add(pl);
      this.lampPool.push(pl);
    }

    // the torch: the only shadow-caster, because six-face point shadows are not affordable
    this.torch = new THREE.SpotLight(0xfff0d0, 0, 900, 0.70, 0.62, 1.1);
    this.torch.castShadow = this.renderer.shadowMap.enabled;
    this.torch.shadow.mapSize.set(this.shadowSize || 1024, this.shadowSize || 1024);
    this.torch.shadow.camera.near = 6;
    this.torch.shadow.camera.far = 900;
    this.torch.shadow.bias = -0.0004;
    this.torch.shadow.normalBias = 1.6;
    this.torchTarget = new THREE.Object3D();
    s.add(this.torch); s.add(this.torchTarget);
    this.torch.target = this.torchTarget;

    // a soft bubble around the player, so your own feet are never pitch black
    this.headLamp = new THREE.PointLight(0xffeed4, 0.5, 260, 1.7);
    s.add(this.headLamp);

    // the ceiling fitting overhead casts real shadows, so everything is grounded
    this.roomLight = new THREE.SpotLight(0xffe9c8, 0, 520, 1.05, 0.75, 1.2);
    this.roomLight.castShadow = !!this.roomShadow;
    this.roomLight.shadow.mapSize.set(1024, 1024);
    this.roomLight.shadow.camera.near = 8;
    this.roomLight.shadow.camera.far = 520;
    this.roomLight.shadow.bias = -0.0006;
    this.roomLight.shadow.normalBias = 2.2;
    this.roomTarget = new THREE.Object3D();
    s.add(this.roomLight); s.add(this.roomTarget);
    this.roomLight.target = this.roomTarget;

    // eyeshine, so a monster reads in the dark before you can make out its shape
    this.eyeLights = [];
    for (var e = 0; e < 3; e++) {
      var el = new THREE.PointLight(0xff5a4a, 0, 260, 1.6);
      s.add(el); this.eyeLights.push(el);
    }
    this.buildShafts();
    this.setMood(game);
  },

  /** A pool of additive cones, reassigned to whichever lit fittings are nearest. */
  buildShafts: function () {
    var self = this;
    if (this.shafts) this.shafts.forEach(function (m) { self.scene.remove(m); });
    this.shafts = [];
    var geo = new THREE.ConeGeometry(1.35 * PP.M, PP.CEIL - 0.3 * PP.M, 14, 1, true);
    geo.translate(0, -(PP.CEIL - 0.3 * PP.M) / 2, 0);
    for (var i = 0; i < 7; i++) {
      var mat = new THREE.MeshBasicMaterial({
        map: PP.Tex.shaftTex(), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: true
      });
      var m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 5;
      this.scene.add(m);
      this.shafts.push(m);
    }
  },

  setMood: function (game) {
    var night = game.mode === 'night';
    var monster = game.mode === 'monster';
    this.scene.fog = new THREE.FogExp2(night ? 0x05070c : monster ? 0x0a0810 : 0x161a24,
                                       night ? 0.0034 : monster ? 0.0016 : 0.0009);
    this.scene.background = new THREE.Color(night ? 0x05070c : monster ? 0x0a0810 : 0x161a24);
    this.hemi.intensity = night ? 0.085 : monster ? 0.13 : 0.22;
    this.ambient.intensity = night ? 0.065 : monster ? 0.10 : 0.16;
    var P = PP.Post.params;
    P.exposure  = night ? 1.22 : monster ? 0.95 : 0.88;
    P.threshold = night ? 1.00 : 1.22;
    P.vignette  = night ? 0.62 : monster ? 0.52 : 0.42;
    P.grain     = night ? 0.026 : 0.014;
    P.sat       = night ? 0.96 : 1.04;
    P.contrast  = night ? 1.20 : 1.14;
    P.black     = night ? 0.020 : 0.012;
    P.aoRadius  = 16;
    this.renderer.toneMappingExposure = P.exposure;
  },

  buildHands: function (game) {
    var self = this;
    ['l', 'r'].forEach(function (side) {
      var gold = game.saveData && game.saveData.owned && game.saveData.owned.pack_gold;
      var mesh = PP.Models.grabHand(side, gold);
      mesh.visible = false;
      self.scene.add(mesh);
      // the cable: a chain of short cylinders laid along a bezier each frame
      var rope = [];
      var mat = PP.Models.plain(gold ? 0xffc94d : (side === 'l' ? 0xe6404f : 0x3c7ff0), 0.4, 0.5);
      var geo = new THREE.CylinderGeometry(0.045 * PP.M, 0.045 * PP.M, 1, 6);
      for (var i = 0; i < 10; i++) {
        var seg = new THREE.Mesh(geo, mat);
        seg.visible = false;
        seg.castShadow = false;
        self.scene.add(seg);
        rope.push(seg);
      }
      self.hands[side] = { mesh: mesh, rope: rope };
    });
  },

  dispose: function () {
    var self = this;
    ['levelGroup', 'propGroup', 'actorGroup', 'fxGroup'].forEach(function (k) {
      if (!self[k]) return;
      self[k].traverse(function (o) {
        if (o.isMesh && o.geometry) o.geometry.dispose();
      });
      self.scene.remove(self[k]);
      self[k] = null;
    });
    Object.keys(this.hands).forEach(function (k) {
      var h = self.hands[k];
      self.scene.remove(h.mesh);
      h.rope.forEach(function (r) { self.scene.remove(r); });
    });
    this.hands = {};
    PP.World.props.forEach(function (p) { p.obj = null; });
    PP.World.lamps.forEach(function (l) { l.idx = null; });
    this.ready = false;
  },

  /* ═════════ actors ═════════ */
  attach: function (ent) {
    var rig = (ent instanceof Monster) ? PP.Models.monster(ent.def)
                                       : PP.Models.human(ent.look || (ent.role && ent.role.look) || PP.ROLES[0].look);
    ent.rig = rig;
    rig.root.position.set(ent.x, 0, ent.y);
    // contact shadow
    var blob = new THREE.Mesh(
      new THREE.PlaneGeometry(rig.height * 0.85, rig.height * 0.85),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false,
                                    opacity: 0.8, color: 0x000000 }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.6;
    rig.root.add(blob);
    rig.blob = blob;
    this.actorGroup.add(rig.root);
    return rig;
  },
  detach: function (ent) {
    if (ent.rig && ent.rig.root.parent) ent.rig.root.parent.remove(ent.rig.root);
    ent.rig = null;
  },

  /* ═════════ per-frame ═════════ */
  update: function (game, dt) {
    if (!this.ready) return;
    var M = PP.M, pl = game.player;
    this.animateActors(game, dt);
    this.animateProps(game, dt);
    this.updateLamps(game);
    this.updateCamera(game, dt);
    this.updateHands(game, dt);
  },

  animateActors: function (game, dt) {
    var list = game.drawList(), self = this;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e.rig) this.attach(e);
      var rig = e.rig, r = rig.root;
      r.position.x = e.x; r.position.z = e.y;
      var targetRot = Math.PI / 2 - e.face;
      r.rotation.y = PP.U.angLerp(r.rotation.y, targetRot,
                                  1 - Math.exp(-(rig.crawler ? 5 : 16) * dt));

      var sp = Math.hypot(e.vx || 0, e.vy || 0);
      var moving = sp > 3;
      e.animPhase = (e.animPhase || 0) + dt * (moving ? sp * 0.10 : 1.6);
      var amp = moving ? Math.min(1, sp / 60) : 0;
      var swing = Math.sin(e.animPhase) * amp * (rig.armSwing || 1);

      if (e.caught) {                       // slumped where it fell
        r.rotation.z = PP.U.approach(r.rotation.z, 1.35, 6, dt);
        r.position.y = PP.U.approach(r.position.y, -rig.height * 0.28, 6, dt);
        if (rig.blob) rig.blob.material.opacity = 0.4;
        continue;
      }

      if (rig.armL) rig.armL.rotation.x = swing * 0.9 + (rig.noodly ? Math.sin(e.animPhase * 1.7) * 0.2 : 0);
      if (rig.armR) rig.armR.rotation.x = -swing * 0.9 + (rig.noodly ? Math.cos(e.animPhase * 1.7) * 0.2 : 0);
      if (rig.legL) rig.legL.rotation.x = -swing;
      if (rig.legR) rig.legR.rotation.x = swing;
      // elbows and knees only bend one way; wrists and ankles counter-rotate so
      // the hand stays level and the sole stays flat on the floor
      if (rig.jointed) {
        var elbow = 0.22 + amp * 0.30;
        this.hinge(rig.armL, elbow + Math.max(0, swing) * 0.55, 0.55);
        this.hinge(rig.armR, elbow + Math.max(0, -swing) * 0.55, 0.55);
        // a digitigrade rig needs the whole leg biased into its reversed shape
        var bias = rig.legBias;
        if (bias) {
          rig.legL.rotation.x += bias.hip; rig.legR.rotation.x += bias.hip;
        }
        this.hinge(rig.legL, Math.max(0, swing) * 1.05 + 0.04 + (bias ? bias.knee : 0), 0.85);
        this.hinge(rig.legR, Math.max(0, -swing) * 1.05 + 0.04 + (bias ? bias.knee : 0), 0.85);
        if (bias) {
          if (rig.legL.wrist) rig.legL.wrist.rotation.x += bias.ankle;
          if (rig.legR.wrist) rig.legR.wrist.rotation.x += bias.ankle;
        }
      }
      if (rig.quad) this.animateQuad(e, rig, dt, amp, sp);
      if (rig.spine) {
        // the body leans into a run and counter-twists against the stride
        var lean = 0.04 + amp * 0.20 + (e.state === 'chase' ? 0.12 : 0);
        rig.spine.rotation.x = PP.U.approach(rig.spine.rotation.x, lean, 6, dt);
        rig.spine.rotation.z = Math.sin(e.animPhase) * amp * 0.055;
        rig.spine.rotation.y = Math.sin(e.animPhase) * amp * 0.075;
      }
      if (rig.neck) this.aimHead(e, rig, game, dt, amp);
      if (rig.hips) {
        rig.hips.position.y = (rig.hips.userData.base == null
          ? (rig.hips.userData.base = rig.hips.position.y) : rig.hips.userData.base)
          + Math.abs(Math.sin(e.animPhase)) * amp * 1.1;
        rig.hips.rotation.z = Math.sin(e.animPhase) * amp * 0.06;
      }

      // monster-specific flourishes
      if (e instanceof Monster) this.animateMonster(e, rig, dt, amp);
      // a reaching lunge
      if (e.lunge > 0 && rig.armL) {
        var L = e.lunge / 0.35;
        rig.armL.rotation.x = -1.5 * L; rig.armR.rotation.x = -1.5 * L;
        if (rig.armL.lower) rig.armL.lower.rotation.x = 0.25 * (1 - L);
        if (rig.armR.lower) rig.armR.lower.rotation.x = 0.25 * (1 - L);
      }
      // you do not see your own body from inside your own head
      var firstPersonSelf = (e === game.player && !this.thirdPerson && game.mode !== 'monster');
      rig.root.visible = !e.hiding && !firstPersonSelf;
    }
  },

  /** Bend one limb's hinge, then take the slack out at the wrist or ankle. */
  hinge: function (limb, bend, counter) {
    if (!limb || !limb.lower) return;
    limb.lower.rotation.x = bend;
    if (limb.wrist) limb.wrist.rotation.x = -(limb.rotation.x + bend) * counter;
  },

  /** Diagonal gait: front-left swings with back-right. */
  animateQuad: function (e, rig, dt, amp, sp) {
    var ph = e.animPhase;
    for (var i = 0; i < rig.legs.length; i++) {
      var L = rig.legs[i];
      var sw = Math.sin(ph + L.phase) * amp;
      L.node.rotation.x = sw * 0.55;
      // a foreleg's elbow folds backward, a hind leg's hock folds forward
      this.hinge(L.node, L.back ? Math.max(0, -sw) * 0.9 + 0.35
                                : Math.max(0, sw) * 0.75 + 0.25, 0.8);
    }
    if (rig.body) rig.body.position.y = rig.bodyY + Math.abs(Math.sin(ph * 2)) * amp * 1.4;
  },

  /** A monster that has seen you keeps its head pointed at you. */
  aimHead: function (e, rig, game, dt, amp) {
    var neck = rig.neck, T = performance.now() / 1000;
    var target = game.player;
    var lock = (e instanceof Monster) && e !== game.player && target &&
               (e.state === 'chase' || e.state === 'investigate') &&
               PP.U.dist(e.x, e.y, target.x, target.y) < 700;
    if (lock) {
      var want = Math.atan2(target.y - e.y, target.x - e.x);
      var local = ((e.face - want + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
      var eye = rig.eyeHeight || rig.height * 0.8;
      var drop = Math.atan2(eye - 26, Math.max(30, PP.U.dist(e.x, e.y, target.x, target.y)));
      neck.rotation.y = PP.U.approach(neck.rotation.y, PP.U.clamp(local, -0.95, 0.95), 7, dt);
      neck.rotation.x = PP.U.approach(neck.rotation.x, PP.U.clamp(drop, -0.5, 0.5), 6, dt);
      neck.rotation.z = PP.U.approach(neck.rotation.z, Math.sin(T * 5) * 0.05, 5, dt);
    } else {
      neck.rotation.y = PP.U.approach(neck.rotation.y, Math.sin(T * 0.6 + (rig.idleSway || 0)) * 0.3, 3, dt);
      neck.rotation.x = PP.U.approach(neck.rotation.x, -amp * 0.12, 3, dt);
      neck.rotation.z = PP.U.approach(neck.rotation.z, 0, 3, dt);
    }
  },

  animateMonster: function (m, rig, dt, amp) {
    var t = PP.Render3 ? 0 : 0;
    var T = performance.now() / 1000;
    if (rig.springy) {
      // Boxy Boo rides its spring: compressed while charging, flung out on release
      var stretch = m.springPhase === 'charge' ? 0.35
                  : m.springPhase === 'launch' ? 1.75 : 1 + Math.sin(T * 4) * 0.06;
      rig.spring.scale.y = PP.U.approach(rig.spring.scale.y, stretch, 12, dt);
      for (var i = 0; i < rig.coils.length; i++) {
        rig.coils[i].position.y = i * rig.coilStep;
        rig.coils[i].rotation.z = Math.sin(T * 6 + i) * 0.06;
      }
      rig.hips.position.y = (rig.coils.length - 1) * rig.coilStep;
      rig.lid.rotation.x = -1.9 - Math.sin(T * 2) * 0.1;
    }
    if (rig.cymbals && m.crashT > 0) {
      var c = Math.min(1, m.crashT / 0.3);
      rig.armL.rotation.z = 1.2 * c; rig.armR.rotation.z = -1.2 * c;
      rig.armL.rotation.x = -0.9; rig.armR.rotation.x = -0.9;
    } else if (rig.cymbals) {
      rig.armL.rotation.z = 0.35; rig.armR.rotation.z = -0.35;
    }
    if (rig.tail) {
      for (var s = 0; s < rig.tail.length; s++) {
        rig.tail[s].rotation.y = Math.sin(T * 3 - s * 0.6) * 0.24;
        rig.tail[s].rotation.x = Math.sin(T * 2.2 - s * 0.5) * 0.12 - 0.1;
      }
    }
    if (rig.segments) {
      // PJ's body is a train: each segment records where the head has been
      var head = { x: m.x, y: m.y };
      m.trail = m.trail || [];
      m.trail.unshift({ x: m.x, y: m.y });
      if (m.trail.length > 200) m.trail.length = 200;
      for (var q = 0; q < rig.segments.length; q++) {
        var seg = rig.segments[q];
        var idx = Math.min(m.trail.length - 1, Math.round((q + 1) * 9));
        var pt = m.trail[idx] || head;
        // segments are children of root, so convert to the rig's local space
        var dx = pt.x - m.x, dz = pt.y - m.y;
        var ca = Math.cos(-rig.root.rotation.y), sa = Math.sin(-rig.root.rotation.y);
        seg.node.position.set(dx * ca - dz * sa, seg.r * 0.9 + Math.sin(T * 6 + q) * 1.2,
                              dx * sa + dz * ca);
        var lgL = seg.node.userData.legL, lgR = seg.node.userData.legR;
        if (lgL) { lgL.rotation.x = Math.sin(T * 8 + q) * 0.5 * amp; lgR.rotation.x = -lgL.rotation.x; }
      }
    }
    // ── Claudie ──
    if (rig.jawL) {
      // the mask opens only as it reaches you
      var open = m.lunge > 0 ? (m.lunge / 0.35)
               : (m.state === 'chase' && !m.watched ? 0.18 : 0);
      rig.jawL.rotation.y = PP.U.approach(rig.jawL.rotation.y, open * 1.25, 16, dt);
      rig.jawR.rotation.y = PP.U.approach(rig.jawR.rotation.y, -open * 1.25, 16, dt);
    }
    if (rig.stutter) {
      if (m.watched) {
        // dead still, except a tremor you are not sure you saw
        var tr = Math.sin(T * 31) * 0.35 + Math.sin(T * 53) * 0.18;
        rig.root.position.x += tr * 0.03;
        rig.root.position.z += tr * 0.02;
        if (rig.neck) rig.neck.rotation.z = PP.U.approach(rig.neck.rotation.z, 0.22, 0.5, dt);
      } else {
        // it does not walk so much as advance in snaps
        var j = Math.sin(T * 26) * 0.05 + Math.sin(T * 43) * 0.028;
        if (rig.spine) rig.spine.rotation.z += j;
        if (rig.neck) rig.neck.rotation.z += j * 1.7;
      }
    }

    if (rig.head && !rig.neck) {
      rig.head.rotation.y = Math.sin(T * 0.7 + (rig.idleSway || 0)) * 0.25;
    }
  },

  animateProps: function (game, dt) {
    var T = performance.now() / 1000;
    PP.World.props.forEach(function (p) {
      if (!p.obj) return;
      if (p.kind === 'node' && p.obj.screen) {
        var m = p.obj.screen.material;
        m.emissive.setHex(p.done ? 0x39d98a : 0xff5a4a);
        m.emissiveIntensity = p.done ? 1.10 : 0.30 + Math.abs(Math.sin(T * 3)) * 0.40;
      }
      if (p.kind === 'socket') {
        var lit = p.node.done || p.heldBy;
        p.obj.ring.material.emissiveIntensity = lit ? 1.9 : 0.60 + Math.sin(T * 4) * 0.25;
        p.obj.core.material.emissiveIntensity = lit ? 2.6 : 0.95;
      }
      if (p.kind === 'task' && p.obj.screen) {
        p.obj.screen.material.emissive.setHex(p.done ? 0x39d98a : 0x4fc3f7);
      }
      if (p.kind === 'locker' && p.obj.door) {
        p.obj.door.rotation.y = PP.U.approach(p.obj.door.rotation.y, p.open ? -1.7 : 0, 9, dt);
      }
      if (p.kind === 'lift' && p.obj.lamp) {
        p.obj.lamp.material.emissive.setHex(p.armed ? 0x33ff88 : 0x223322);
        p.obj.lamp.material.emissiveIntensity = p.armed ? 0.95 + Math.sin(T * 5) * 0.35 : 0.12;
      }
      if (p.kind === 'gas' && p.obj) {
        p.obj.cloud.material.opacity = 0.18 * Math.min(1, p.life / 3);
        p.obj.cloud.scale.setScalar(1 + (1 - Math.min(1, p.life / 12)) * 0.8);
      }
    });
  },

  /** Assign the light pool to whichever lit lamps are nearest the camera. */
  updateLamps: function (game) {
    var cam = this.camera.position, best = [], dirty = false;
    for (var i = 0; i < this.lampMeshes.length; i++) {
      var l = this.lampMeshes[i];
      var lv = this.lampLevel(game, l);
      if (this.lampTubes && l.idx != null) {
        var base = game.power ? 0xfff2d4 : 0xffb27a;
        this._lampCol.setHex(base).multiplyScalar(0.04 + lv * 1.85);
        this.lampTubes.setColorAt(l.idx, this._lampCol);
        dirty = true;
      }
      if (lv <= 0.03) continue;
      var d = (l.x - cam.x) * (l.x - cam.x) + (l.y - cam.z) * (l.y - cam.z);
      if (d > 1400 * 1400) continue;
      best.push({ l: l, d: d, lv: lv });
    }
    if (dirty && this.lampTubes && this.lampTubes.instanceColor) {
      this.lampTubes.instanceColor.needsUpdate = true;
    }
    best.sort(function (a, b) { return a.d - b.d; });

    // light shafts on the nearest few, so the beam is visible in the dust
    if (this.shafts) {
      for (var sIdx = 0; sIdx < this.shafts.length; sIdx++) {
        var sh = this.shafts[sIdx], e2 = best[sIdx];
        if (!this.shaftsOn || !e2 || e2.d > 620 * 620) { sh.visible = false; continue; }
        sh.visible = true;
        sh.position.set(e2.l.x, PP.CEIL - 0.16 * PP.M, e2.l.y);
        var fade = 1 - Math.sqrt(e2.d) / 620;
        sh.material.opacity = e2.lv * fade * (game.power ? 0.11 : 0.46);
        sh.material.color.setHex(game.power ? 0xfff2d8 : 0xffb488);
      }
    }

    for (var k = 0; k < this.lampPool.length; k++) {
      var pl = this.lampPool[k];
      if (k < best.length) {
        var e = best[k];
        pl.position.set(e.l.x, PP.CEIL - 0.95 * PP.M, e.l.y);
        pl.intensity = e.lv * (game.power ? 0.52 : 0.62);
        pl.distance = e.l.r * 2.1;
        pl.color.setHex(game.power ? 0xffe6bd : 0xff9a5c);
      } else pl.intensity = 0;
    }
  },

  /** How lit the ceiling is above a point — drives the shadow-casting room light. */
  lampNear: function (x, y, game) {
    var best = 0;
    for (var i = 0; i < this.lampMeshes.length; i++) {
      var l = this.lampMeshes[i];
      var d2 = (l.x - x) * (l.x - x) + (l.y - y) * (l.y - y);
      if (d2 > 420 * 420) continue;
      var lv = this.lampLevel(game, l) * (1 - Math.sqrt(d2) / 420);
      if (lv > best) best = lv;
    }
    return best;
  },

  lampLevel: function (game, l) {
    var t = performance.now() / 1000;
    if (game.power) {
      if (l.dead) return Math.abs(Math.sin(t * 9 + l.ph)) > 0.82 ? 1 : 0.05;
      return 1;
    }
    if (!l.emg) return 0;
    return 0.16 + Math.abs(Math.sin(t * 1.4 + l.ph)) * 0.12;
  },

  updateCamera: function (game, dt) {
    var pl = game.player, cam = this.camera, M = PP.M;
    if (!pl) return;
    if (game.cine) { this.cinematicCamera(game, dt); return; }
    var rig = pl.rig;
    var eye = rig ? rig.eyeHeight : 25;
    var third = this.thirdPerson || game.mode === 'monster';

    var bob = 0, sp = Math.hypot(pl.vx || 0, pl.vy || 0);
    if (sp > 3 && !pl.hiding) {
      pl.bobPhase = (pl.bobPhase || 0) + dt * sp * 0.11;
      bob = Math.sin(pl.bobPhase * 2) * (pl.sprinting ? 1.5 : 0.8);
      cam.rotation.z = Math.sin(pl.bobPhase) * (pl.sprinting ? 0.016 : 0.008);
    } else {
      cam.rotation.z = PP.U.approach(cam.rotation.z, 0, 6, dt);
    }

    var yaw = -pl.face - Math.PI / 2;
    var pitch = pl.pitch || 0;

    if (third) {
      var dist = (game.mode === 'monster' ? 2.6 : 2.2) * M * 1.6;
      var hx = pl.x - Math.cos(pl.face) * dist;
      var hz = pl.y - Math.sin(pl.face) * dist;
      // pull the camera in if a wall is in the way
      var steps = 8;
      for (var s = 1; s <= steps; s++) {
        var f = s / steps;
        var tx = pl.x + (hx - pl.x) * f, tz = pl.y + (hz - pl.y) * f;
        if (PP.World.solidPx(tx, tz)) {
          hx = pl.x + (hx - pl.x) * ((s - 1) / steps);
          hz = pl.y + (hz - pl.y) * ((s - 1) / steps);
          break;
        }
      }
      cam.position.set(hx, eye * 1.05 + 0.35 * M - pitch * 14, hz);
    } else {
      cam.position.set(pl.x, eye + bob + (pl.hiding ? -3 : 0), pl.y);
    }
    cam.rotation.y = yaw;
    cam.rotation.x = pitch;

    if (this.camShake > 0) {
      this.camShake -= dt;
      var k = this.camShake * 2.2;
      cam.position.x += PP.U.rand(-k, k);
      cam.position.y += PP.U.rand(-k, k);
      cam.position.z += PP.U.rand(-k, k);
    }

    // torch rides the camera
    var range = 620 * (pl.torchRange || 1)
      * ((game.saveData && game.saveData.owned && game.saveData.owned.hat_bulb) ? 1.2 : 1);
    this.torch.position.copy(cam.position);
    var dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.torchTarget.position.copy(cam.position).addScaledVector(dir, range);
    this.torch.distance = range * 1.35;
    this.torch.intensity = (pl.torch ? 1 : 0) * (game.power ? 0.95 : 1.35);
    // Claudie does something to the wiring; the closer it is, the worse the torch
    var interference = 0;
    for (var ci = 0; ci < game.monsters.length; ci++) {
      var cm = game.monsters[ci];
      if (cm.def.special !== 'still' || cm === pl) continue;
      interference = Math.max(interference,
        PP.U.clamp(1 - PP.U.dist(pl.x, pl.y, cm.x, cm.y) / 620, 0, 1));
    }
    if (interference > 0.02) {
      var t2 = performance.now() / 1000;
      var flick = 1 - interference * (0.35 + 0.65 * (Math.sin(t2 * 37) * Math.sin(t2 * 13) > 0.35 ? 1 : 0));
      this.torch.intensity *= Math.max(0.05, flick);
    }
    this.headLamp.position.copy(cam.position);
    this.headLamp.intensity = (pl.torch ? 0.30 : 0.12) * (game.power ? 0.30 : 1.0);

    // the room light rides the ceiling above the player
    if (this.roomLight) {
      this.roomLight.position.set(pl.x, PP.CEIL - 0.4 * M, pl.y);
      this.roomTarget.position.set(pl.x, 0, pl.y);
      var lit = this.lampNear(pl.x, pl.y, game);
      this.roomLight.intensity = this.roomShadow ? lit * (game.power ? 0.9 : 0.55) : 0;
    }

    // eyeshine on whichever monsters are closest
    var ms = game.monsters.slice(0, this.eyeLights.length);
    for (var i = 0; i < this.eyeLights.length; i++) {
      var el = this.eyeLights[i], m = ms[i];
      if (!m || m === pl) { el.intensity = 0; continue; }
      el.position.set(m.x, (m.rig ? m.rig.eyeHeight : 30), m.y);
      el.color.setHex(new THREE.Color(m.def.look.eye).getHex());
      el.intensity = (m.state === 'chase' ? 1.1 : 0.5);
    }
  },

  /**
   * The grab. For most of them you are yanked in, held up and then the mouth
   * closes over the lens. Claudie takes you from behind, turns you round, and
   * puts you into the mask.
   */
  cinematicCamera: function (game, dt) {
    var c = game.cine, m = c.m, cam = this.camera, M = PP.M;
    var rig = m.rig;
    var headY = rig ? rig.eyeHeight : 40;
    var head = new THREE.Vector3(m.x, headY, m.y);
    var fwd = new THREE.Vector3(Math.cos(m.face), 0, Math.sin(m.face));
    var eye = new THREE.Vector3(), look = new THREE.Vector3(), roll = 0, shake = 0;
    var t = c.t;

    if (c.kind === 'claudie') {
      var pl = game.player;
      if (t < 0.5) {
        // turned round to face it, whether you wanted to be or not
        var k = PP.U.clamp(t / 0.5, 0, 1);
        var ease = k * k * (3 - 2 * k);
        var awayPt = new THREE.Vector3(pl.x + Math.cos(c.yaw0) * 200, 26,
                                       pl.y + Math.sin(c.yaw0) * 200);
        eye.set(pl.x, 26, pl.y);
        look.lerpVectors(awayPt, head, ease);
        roll = ease * 0.22;
        shake = 1.6 * (1 - ease * 0.4);
      } else if (t < 1.35) {
        // lifted off the floor
        var k2 = PP.U.clamp((t - 0.5) / 0.85, 0, 1);
        eye.set(pl.x, 26 + k2 * 22, pl.y).addScaledVector(fwd, k2 * 14);
        look.copy(head);
        roll = 0.22 + k2 * 0.18;
        shake = 1.1;
      } else {
        // and into the mask
        var k3 = PP.U.clamp((t - 1.35) / 0.95, 0, 1);
        var e3 = k3 * k3;
        var start = new THREE.Vector3(pl.x, 48, pl.y).addScaledVector(fwd, 14);
        var end = head.clone().addScaledVector(fwd, rig ? rig.headR * 0.35 : 6);
        eye.lerpVectors(start, end, e3);
        look.copy(head).addScaledVector(fwd, -20);
        roll = 0.40 + e3 * 0.55;
        shake = 1.4 + e3 * 2.2;
      }
    } else {
      if (t < 0.65) {
        var g0 = PP.U.clamp(t / 0.65, 0, 1);
        var from = new THREE.Vector3(c.px, 26, c.py);
        var to = head.clone().addScaledVector(fwd, (rig ? rig.headR : 8) * 4.2);
        to.y = headY * 0.86;
        eye.lerpVectors(from, to, g0 * g0 * (3 - 2 * g0));
        look.copy(head);
        roll = g0 * 0.16;
        shake = 2.0 * (1 - g0 * 0.5);
      } else if (t < 1.5) {
        var g1 = PP.U.clamp((t - 0.65) / 0.85, 0, 1);
        eye.copy(head).addScaledVector(fwd, (rig ? rig.headR : 8) * (4.2 - g1 * 1.4));
        eye.y = headY * (0.86 + g1 * 0.12);
        look.copy(head);
        roll = 0.16 + Math.sin(g1 * 6.0) * 0.10;
        shake = 0.9;
      } else {
        var g2 = PP.U.clamp((t - 1.5) / 0.6, 0, 1);
        var e2 = g2 * g2;
        eye.copy(head).addScaledVector(fwd, (rig ? rig.headR : 8) * (2.8 - e2 * 2.6));
        eye.y = headY * 0.98;
        look.copy(head).addScaledVector(fwd, -20);
        roll = 0.26 + e2 * 0.5;
        shake = 1.2 + e2 * 2.0;
      }
    }

    cam.position.copy(eye);
    cam.lookAt(look);
    cam.rotation.z = roll;
    if (shake > 0) {
      var s = shake;
      cam.position.x += PP.U.rand(-s, s);
      cam.position.y += PP.U.rand(-s, s);
      cam.position.z += PP.U.rand(-s, s);
    }

    // the torch swings loose in your hand
    this.torch.position.copy(cam.position);
    var dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.torchTarget.position.copy(cam.position).addScaledVector(dir, 400);
    this.torch.intensity = 2.0;
    this.torch.distance = 700;
    this.headLamp.position.copy(cam.position);
    this.headLamp.intensity = 0.75;
    if (this.roomLight) this.roomLight.intensity = 0;
    for (var i = 0; i < this.eyeLights.length; i++) {
      var el = this.eyeLights[i];
      if (i === 0) {
        el.position.set(m.x, headY, m.y);
        el.color.setHex(new THREE.Color(m.def.look.eye).getHex());
        el.intensity = 2.2;
      } else el.intensity = 0;
    }
  },

  /* ═════════ GrabPack ═════════ */
  /** Raycast down the crosshair; return a socket if one is under it. */
  aim: function (maxDist) {
    var cam = this.camera;
    var origin = cam.position.clone();
    var dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    var rc = new THREE.Raycaster(origin, dir, 1, maxDist);
    var targets = [];
    PP.World.props.forEach(function (p) {
      if (p.kind === 'socket' && p.obj && !p.node.done && !p.heldBy) targets.push(p.obj);
    });
    var hits = rc.intersectObjects(targets, true);
    if (hits.length) {
      var o = hits[0].object;
      while (o && !o.userData.prop) o = o.parent;
      if (o && o.userData.prop) return { prop: o.userData.prop, point: hits[0].point };
    }
    // otherwise stop at the wall
    var end = origin.clone().addScaledVector(dir, maxDist);
    var step = 8, n = Math.ceil(maxDist / step);
    for (var i = 1; i <= n; i++) {
      var pt = origin.clone().addScaledVector(dir, i * step);
      if (pt.y < 2 || pt.y > PP.CEIL - 2 || PP.World.solidPx(pt.x, pt.z)) {
        end = origin.clone().addScaledVector(dir, (i - 1) * step);
        break;
      }
    }
    return { prop: null, point: end };
  },

  updateHands: function (game, dt) {
    var pl = game.player, self = this, M = PP.M;
    if (!pl || !pl.hands) {
      Object.keys(this.hands).forEach(function (k) {
        self.hands[k].mesh.visible = false;
        self.hands[k].rope.forEach(function (r) { r.visible = false; });
      });
      return;
    }
    var cam = this.camera;
    ['l', 'r'].forEach(function (side) {
      var H = pl.hands[side], view = self.hands[side];
      if (!H.pos) H.pos = new THREE.Vector3();

      // rest pose, held out in front of the camera
      var rest = new THREE.Vector3(side === 'l' ? -0.52 * M : 0.52 * M, -0.56 * M, -1.10 * M);
      rest.applyQuaternion(cam.quaternion).add(cam.position);
      // a hand always launches from the wrist, even if the player just teleported
      if (H.justFired) { H.pos.copy(rest); H.justFired = false; }
      // if the player was moved (a close call, a locker), reel the hand straight in
      if (H.state !== 'idle' && H.pos.distanceTo(cam.position) > pl.grabLen + 220) {
        H.release(); H.pos.copy(rest); H.state = 'idle';
      }

      if (H.state === 'idle') {
        H.pos.lerp(rest, 1 - Math.exp(-22 * dt));
        view.mesh.position.copy(H.pos);
        view.mesh.quaternion.copy(cam.quaternion);
        view.mesh.rotateX(-0.42);
        view.mesh.rotateZ(side === 'l' ? 0.3 : -0.3);
        view.mesh.visible = !self.thirdPerson && game.mode !== 'monster';
        view.rope.forEach(function (r) { r.visible = false; });
        return;
      }

      view.mesh.visible = true;
      var goal = H.state === 'latched' && H.latch && H.latch.obj
        ? H.latch.obj.getWorldPosition(new THREE.Vector3())
        : (H.state === 'out' ? H.target : rest);
      var speed = H.state === 'back' ? 1600 : 1300;
      var d = H.pos.distanceTo(goal);
      if (d > 1) H.pos.addScaledVector(goal.clone().sub(H.pos).normalize(), Math.min(d, speed * dt));

      if (H.state === 'out' && H.pos.distanceTo(H.target) < 6) {
        H.state = H.pendingLatch ? 'latched' : 'back';
        if (H.pendingLatch) {
          H.latch = H.pendingLatch; H.latch.heldBy = side; H.pendingLatch = null;
          PP.Audio.latch();
        }
      }
      if (H.state === 'back' && H.pos.distanceTo(rest) < 5) { H.state = 'idle'; }
      if (H.state === 'latched') {
        // the cable snaps if you walk away
        if (H.pos.distanceTo(cam.position) > pl.grabLen + 60) H.release();
      }

      view.mesh.position.copy(H.pos);
      view.mesh.lookAt(cam.position);

      // lay the cable along a sagging bezier
      var a = rest, b = H.pos;
      var mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y -= a.distanceTo(b) * 0.11;
      var prev = a.clone();
      for (var i = 0; i < view.rope.length; i++) {
        var t = (i + 1) / view.rope.length;
        var pt = new THREE.Vector3(
          (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mid.x + t * t * b.x,
          (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * mid.y + t * t * b.y,
          (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * mid.z + t * t * b.z);
        var seg = view.rope[i];
        seg.visible = true;
        seg.position.copy(prev).add(pt).multiplyScalar(0.5);
        seg.scale.y = Math.max(0.01, prev.distanceTo(pt));
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
                                          pt.clone().sub(prev).normalize());
        prev = pt;
      }
    });
  },

  render: function (dt, fear) {
    if (!this.ready) return;
    PP.Post.render(this.scene, this.camera, dt || 0.016, fear || 0);
  }
};
