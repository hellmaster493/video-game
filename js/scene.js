/* ═══════════════════════════════════════════════════════════
   scene.js — the three.js layer: level geometry merged out of
   the tile grid, lighting, actors, camera and the GrabPack.

   World mapping: the 2D game logic lives in (x, y); here that
   becomes (x, 0, y), with +Y up. 32 units = 1 tile = 2 m.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.CEIL = 3.3 * PP.M;    // room ceiling height
PP.VENT_H = 1.15 * PP.M; // duct ceiling — you are crawling in there

/* ── a tiny geometry builder, since BufferGeometryUtils is an addon ── */
function Geo() { this.p = []; this.n = []; this.u = []; this.i = []; }
Geo.prototype.quad = function (a, b, c, d, nx, ny, nz, uvs) {
  var base = this.p.length / 3;
  [a, b, c, d].forEach(function (v) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); }, this);
  this.u.push(uvs[0], uvs[1], uvs[2], uvs[3], uvs[4], uvs[5], uvs[6], uvs[7]);
  this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
};
Geo.prototype.empty = function () { return this.p.length === 0; };
Geo.prototype.finish = function () {
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
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
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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

    this.shadowTex = this.makeBlobShadow();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    this.resize();
  },

  resize: function () {
    var w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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

    for (var ty = 0; ty < W.H; ty++) {
      for (var tx = 0; tx < W.W; tx++) {
        var t = W.at(tx, ty);
        var x0 = tx * T, x1 = x0 + T, z0 = ty * T, z1 = z0 + T;

        if (t !== Tt.VOID && t !== Tt.WALL) {
          // floor — UVs in tile units so the texture tiles seamlessly
          bucket(floorTex[t] || 'concrete').quad(
            [x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0],
            0, 1, 0, [tx, ty, tx, ty + 1, tx + 1, ty + 1, tx + 1, ty]);
          // ceiling
          var ch = ceilOf(tx, ty);
          bucket(t === Tt.VENT ? 'duct' : 'ceiling').quad(
            [x0, ch, z1], [x0, ch, z0], [x1, ch, z0], [x1, ch, z1],
            0, -1, 0, [tx, ty + 1, tx, ty, tx + 1, ty, tx + 1, ty + 1]);
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
          if (nbs[k][0] === 1) {
            bucket(mat).quad([x1, 0, z1], [x1, h, z1], [x1, h, z0], [x1, 0, z0],
              1, 0, 0, [0, 0, 0, uh, uw, uh, uw, 0]);
          } else if (nbs[k][0] === -1) {
            bucket(mat).quad([x0, 0, z0], [x0, h, z0], [x0, h, z1], [x0, 0, z1],
              -1, 0, 0, [0, 0, 0, uh, uw, uh, uw, 0]);
          } else if (nbs[k][1] === 1) {
            bucket(mat).quad([x0, 0, z1], [x0, h, z1], [x1, h, z1], [x1, 0, z1],
              0, 0, 1, [0, 0, 0, uh, uw, uh, uw, 0]);
          } else {
            bucket(mat).quad([x1, 0, z0], [x1, h, z0], [x0, h, z0], [x0, 0, z0],
              0, 0, -1, [0, 0, 0, uh, uw, uh, uw, 0]);
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
      ceiling:  { roughness: 0.95, metalness: 0.0,  normal: 0.6 }
    };
    Object.keys(B).forEach(function (name) {
      if (B[name].empty()) return;
      var mesh = new THREE.Mesh(B[name].finish(), PP.Tex.mat(name, matOpts[name] || {}));
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;   // the level never moves
      mesh.updateMatrix();
      self.levelGroup.add(mesh);
    });

    this.buildLamps(game);
    this.buildProps();
    this.buildLights(game);
    this.buildHands(game);
    this.ready = true;
  },

  buildLamps: function (game) {
    var M = PP.M, self = this;
    this.lampMeshes = [];
    var housing = PP.Models.plain(0x3a4049, 0.5, 0.6);
    var tubeGeo = new THREE.BoxGeometry(1.5 * M, 0.09 * M, 0.32 * M);
    var caseGeo = new THREE.BoxGeometry(1.7 * M, 0.13 * M, 0.46 * M);
    PP.World.lamps.forEach(function (l) {
      var g = new THREE.Group();
      g.position.set(l.x, PP.CEIL - 0.1 * M, l.y);
      var cs = new THREE.Mesh(caseGeo, housing);
      cs.position.y = 0.06 * M;
      g.add(cs);
      var mat = new THREE.MeshStandardMaterial({
        color: 0x1a1c20, emissive: new THREE.Color(0xfff2d4), emissiveIntensity: 0, roughness: 0.4
      });
      var tube = new THREE.Mesh(tubeGeo, mat);
      g.add(tube);
      self.levelGroup.add(g);
      l.mesh = tube; l.mat = mat;
      self.lampMeshes.push(l);
    });
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
    var n = 9;
    for (var i = 0; i < n; i++) {
      var pl = new THREE.PointLight(0xffe6bd, 0, 320, 1.7);
      pl.castShadow = false;
      s.add(pl);
      this.lampPool.push(pl);
    }

    // the torch: the only shadow-caster, because six-face point shadows are not affordable
    this.torch = new THREE.SpotLight(0xfff0d0, 0, 900, 0.70, 0.62, 1.1);
    this.torch.castShadow = true;
    this.torch.shadow.mapSize.set(1024, 1024);
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

    // eyeshine, so a monster reads in the dark before you can make out its shape
    this.eyeLights = [];
    for (var e = 0; e < 3; e++) {
      var el = new THREE.PointLight(0xff5a4a, 0, 260, 1.6);
      s.add(el); this.eyeLights.push(el);
    }
    this.setMood(game);
  },

  setMood: function (game) {
    var night = game.mode === 'night';
    var monster = game.mode === 'monster';
    this.scene.fog = new THREE.FogExp2(night ? 0x05070c : monster ? 0x0a0810 : 0x161a24,
                                       night ? 0.0034 : monster ? 0.0016 : 0.0009);
    this.scene.background = new THREE.Color(night ? 0x05070c : monster ? 0x0a0810 : 0x161a24);
    this.hemi.intensity = night ? 0.055 : monster ? 0.17 : 0.40;
    this.ambient.intensity = night ? 0.045 : monster ? 0.13 : 0.30;
    this.renderer.toneMappingExposure = night ? 0.92 : 1.05;
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
    PP.World.lamps.forEach(function (l) { l.mesh = null; l.mat = null; });
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
      }
      // you do not see your own body from inside your own head
      var firstPersonSelf = (e === game.player && !this.thirdPerson && game.mode !== 'monster');
      rig.root.visible = !e.hiding && !firstPersonSelf;
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
    if (m.state === 'chase' && rig.head) {
      rig.head.rotation.x = -0.12 + Math.sin(T * 9) * 0.05;
    } else if (rig.head) {
      rig.head.rotation.x = PP.U.approach(rig.head.rotation.x, 0, 4, dt);
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
        m.emissiveIntensity = p.done ? 1.2 : 0.4 + Math.abs(Math.sin(T * 3)) * 0.5;
      }
      if (p.kind === 'socket') {
        var lit = p.node.done || p.heldBy;
        p.obj.ring.material.emissiveIntensity = lit ? 2.6 : 1.0 + Math.sin(T * 4) * 0.4;
        p.obj.core.material.emissiveIntensity = lit ? 3.4 : 1.4;
      }
      if (p.kind === 'task' && p.obj.screen) {
        p.obj.screen.material.emissive.setHex(p.done ? 0x39d98a : 0x4fc3f7);
      }
      if (p.kind === 'locker' && p.obj.door) {
        p.obj.door.rotation.y = PP.U.approach(p.obj.door.rotation.y, p.open ? -1.7 : 0, 9, dt);
      }
      if (p.kind === 'lift' && p.obj.lamp) {
        p.obj.lamp.material.emissive.setHex(p.armed ? 0x33ff88 : 0x223322);
        p.obj.lamp.material.emissiveIntensity = p.armed ? 1.6 + Math.sin(T * 5) * 0.6 : 0.2;
      }
      if (p.kind === 'gas' && p.obj) {
        p.obj.cloud.material.opacity = 0.18 * Math.min(1, p.life / 3);
        p.obj.cloud.scale.setScalar(1 + (1 - Math.min(1, p.life / 12)) * 0.8);
      }
    });
  },

  /** Assign the light pool to whichever lit lamps are nearest the camera. */
  updateLamps: function (game) {
    var cam = this.camera.position, best = [];
    for (var i = 0; i < this.lampMeshes.length; i++) {
      var l = this.lampMeshes[i];
      var lv = this.lampLevel(game, l);
      if (l.mat) {
        l.mat.emissiveIntensity = lv * 3.2;
        l.mat.emissive.setHex(game.power ? 0xfff2d4 : 0xffb27a);
      }
      if (lv <= 0.03) continue;
      var d = (l.x - cam.x) * (l.x - cam.x) + (l.y - cam.z) * (l.y - cam.z);
      if (d > 1100 * 1100) continue;
      best.push({ l: l, d: d, lv: lv });
    }
    best.sort(function (a, b) { return a.d - b.d; });
    for (var k = 0; k < this.lampPool.length; k++) {
      var pl = this.lampPool[k];
      if (k < best.length) {
        var e = best[k];
        pl.position.set(e.l.x, PP.CEIL - 0.25 * PP.M, e.l.y);
        pl.intensity = e.lv * (game.power ? 1.75 : 0.80);
        pl.distance = e.l.r * 1.6;
        pl.color.setHex(game.power ? 0xffe6bd : 0xff9a5c);
      } else pl.intensity = 0;
    }
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
    this.torch.intensity = (pl.torch ? 1 : 0) * (game.power ? 1.7 : 2.6);
    this.headLamp.position.copy(cam.position);
    this.headLamp.intensity = (pl.torch ? 0.55 : 0.22) * (game.power ? 1 : 0.8);

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

  render: function () {
    if (this.ready) this.renderer.render(this.scene, this.camera);
  }
};
