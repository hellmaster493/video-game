/* ═══════════════════════════════════════════════════════════
   models.js — every character and prop, built from primitives.

   World scale: 32 units = 1 tile = 2 m, so 1 m = 16 units.
   Rigs expose named joints; entities.js drives them each frame.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.M = 16;   // units per metre

PP.Models = {
  matCache: {},

  /* ── material helpers ─────────────────────────────────── */
  plush: function (col, rough) {
    var k = 'plush' + col + rough;
    if (!this.matCache[k]) {
      this.matCache[k] = PP.Tex.mat('plush', {
        color: col, roughness: rough == null ? 0.94 : rough, metalness: 0.0,
        repeat: 2, normal: 0.8, env: 0.22
      });
    }
    return this.matCache[k];
  },
  cloth: function (col) {
    var k = 'cloth' + col;
    if (!this.matCache[k]) {
      this.matCache[k] = PP.Tex.mat('cloth', { color: col, roughness: 0.92, metalness: 0.0,
                                               repeat: 3, env: 0.22 });
    }
    return this.matCache[k];
  },
  plain: function (col, rough, metal, emis, ei) {
    var k = 'p' + col + rough + metal + emis + ei;
    if (!this.matCache[k]) {
      var m = new THREE.MeshStandardMaterial({
        color: col, roughness: rough == null ? 0.7 : rough, metalness: metal || 0
      });
      m.envMapIntensity = (metal || 0) > 0.4 ? 0.75 : 0.28;
      if (emis != null) { m.emissive = new THREE.Color(emis); m.emissiveIntensity = ei == null ? 1 : ei; }
      this.matCache[k] = m;
    }
    return this.matCache[k];
  },

  /* ── primitive helpers ────────────────────────────────── */
  mesh: function (geo, mat, x, y, z) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  },
  ball: function (r, mat, x, y, z, seg) {
    return this.mesh(new THREE.SphereGeometry(r, seg || 20, (seg || 20) * 0.7), mat, x, y, z);
  },
  cap: function (r, len, mat, x, y, z) {
    return this.mesh(new THREE.CapsuleGeometry(r, len, 6, 16), mat, x, y, z);
  },
  box: function (w, h, d, mat, x, y, z) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  },
  tube: function (r1, r2, len, mat, x, y, z) {
    return this.mesh(new THREE.CylinderGeometry(r1, r2, len, 14), mat, x, y, z);
  },

  /**
   * A limb that hangs from a pivot. Returns the pivot Object3D; rotate it
   * on X to swing the limb forward and back.
   */
  limb: function (len, r1, r2, mat, handMat, handR) {
    var g = new THREE.Group();
    var seg = this.tube(r1, r2, len, mat, 0, -len / 2, 0);
    g.add(seg);
    if (handR) {
      var hand = this.ball(handR, handMat || mat, 0, -len, 0, 14);
      hand.scale.set(1, 0.8, 1.15);
      g.add(hand);
      g.hand = hand;
    }
    return g;
  },

  /** Teeth ring inside a mouth opening. */
  teeth: function (style, w, mat) {
    var g = new THREE.Group();
    var white = this.plain(0xfffdf2, 0.4, 0);
    var n = style === 'buck' ? 2 : style === 'jagged' ? 7 : 6;
    for (var i = 0; i < n; i++) {
      var f = n === 1 ? 0.5 : i / (n - 1);
      var x = (f - 0.5) * w;
      var t;
      if (style === 'jagged') {
        t = this.mesh(new THREE.ConeGeometry(w * 0.075, w * 0.3, 4), white, x, -w * 0.1, 0);
        t.rotation.x = Math.PI;
      } else if (style === 'buck') {
        t = this.box(w * 0.2, w * 0.28, w * 0.09, white, x * 0.45, -w * 0.13, 0);
      } else {
        t = this.box(w * 0.11, w * 0.16, w * 0.08, white, x, -w * 0.06, 0);
      }
      g.add(t);
    }
    if (style !== 'buck' && style !== 'jagged') {
      for (var j = 0; j < n - 1; j++) {
        var b = this.box(w * 0.11, w * 0.13, w * 0.08, white, ((j / (n - 2)) - 0.5) * w * 0.85, -w * 0.26, 0);
        g.add(b);
      }
    }
    return g;
  },

  /** Two eyes with dark pupils and a faint self-lit sclera. */
  eyes: function (r, col, spread, z, y, glow) {
    var g = new THREE.Group();
    var white = this.plain(col, 0.25, 0, glow ? col : null, glow ? 0.45 : 0);
    var pupil = this.plain(0x08070a, 0.3, 0);
    for (var s = -1; s <= 1; s += 2) {
      var e = this.ball(r, white, s * spread, y, z, 16);
      var p = this.ball(r * 0.44, pupil, s * spread * 1.02, y, z + r * 0.72, 12);
      g.add(e); g.add(p);
    }
    return g;
  },

  /* ═══════════════ humans ═══════════════ */
  human: function (look) {
    var M = PP.M, g = new THREE.Group();
    var skin = this.plain(new THREE.Color(look.skin).getHex(), 0.78, 0);
    var body = this.cloth(new THREE.Color(look.body).getHex());
    var legMat = this.cloth(new THREE.Color(look.trousers || look.body).getHex());
    var rig = { root: g };

    var hips = new THREE.Group(); hips.position.y = 13; g.add(hips); rig.hips = hips;

    // torso
    var torso = this.cap(3.6, 7, body, 0, 4.4, 0);
    torso.scale.set(1.15, 1, 0.78);
    hips.add(torso);
    var collar = this.mesh(new THREE.TorusGeometry(3.0, 0.7, 8, 18),
                           this.plain(new THREE.Color(look.trim).getHex(), 0.8, 0), 0, 8.4, 0);
    collar.rotation.x = Math.PI / 2;
    hips.add(collar);

    // head
    var head = new THREE.Group(); head.position.y = 11.4; hips.add(head); rig.head = head;
    var skull = this.ball(3.4, skin, 0, 0, 0, 22);
    skull.scale.set(0.94, 1.08, 0.96);
    head.add(skull);
    head.add(this.mesh(new THREE.SphereGeometry(3.45, 18, 12, 0, 6.2832, 0, 1.25),
                       this.plain(new THREE.Color(look.hair || '#2a1d14').getHex(), 0.9, 0), 0, 0.35, 0));
    var eyes = this.eyes(0.62, 0xf4f4f4, 1.25, 3.0, 0.35, false);
    head.add(eyes);
    head.add(this.mesh(new THREE.ConeGeometry(0.55, 1.3, 8), skin, 0, -0.35, 3.15));
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    this.addHat(head, look.hat, look.hatCol);
    rig.hatSlot = head;

    // arms and legs
    rig.armL = this.limb(10.5, 1.15, 0.95, body, skin, 1.25);
    rig.armR = this.limb(10.5, 1.15, 0.95, body, skin, 1.25);
    rig.armL.position.set(-4.6, 8.2, 0); rig.armR.position.set(4.6, 8.2, 0);
    rig.armL.rotation.z = 0.16; rig.armR.rotation.z = -0.16;
    hips.add(rig.armL); hips.add(rig.armR);

    rig.legL = this.limb(13, 1.5, 1.15, legMat, this.plain(0x1a1a20, 0.7, 0), 1.5);
    rig.legR = this.limb(13, 1.5, 1.15, legMat, this.plain(0x1a1a20, 0.7, 0), 1.5);
    rig.legL.position.set(-1.9, 0, 0); rig.legR.position.set(1.9, 0, 0);
    hips.add(rig.legL); hips.add(rig.legR);

    rig.height = 28;
    rig.eyeHeight = 25.5;
    rig.kind = 'human';
    return rig;
  },

  addHat: function (head, hat, col) {
    var c = new THREE.Color(col || '#fff').getHex();
    switch (hat) {
      case 'cap':
        head.add(this.mesh(new THREE.SphereGeometry(3.6, 18, 10, 0, 6.2832, 0, 1.05),
                           this.plain(c, 0.75, 0), 0, 0.7, 0));
        var brim = this.mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.4, 18, 1, false, -0.9, 1.8),
                             this.plain(c, 0.75, 0), 0, 1.0, 1.6);
        head.add(brim);
        break;
      case 'helmet':
        head.add(this.mesh(new THREE.SphereGeometry(3.9, 20, 12, 0, 6.2832, 0, 1.25),
                           this.plain(c, 0.45, 0.1), 0, 0.4, 0));
        head.add(this.mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.45, 22), this.plain(c, 0.45, 0.1), 0, 1.1, 0));
        break;
      case 'cone':
        head.add(this.mesh(new THREE.ConeGeometry(2.6, 6, 16), this.plain(0xff5470, 0.6, 0), 0, 5.4, 0));
        head.add(this.mesh(new THREE.TorusGeometry(2.0, 0.35, 8, 16), this.plain(0x57e2c8, 0.6, 0), 0, 4.0, 0));
        head.children[head.children.length - 1].rotation.x = Math.PI / 2;
        break;
      case 'crown':
        var cr = this.mesh(new THREE.CylinderGeometry(3.1, 3.1, 2.0, 9, 1, true),
                           this.plain(0xffc94d, 0.3, 0.85), 0, 4.0, 0);
        head.add(cr);
        for (var i = 0; i < 9; i++) {
          var a = i / 9 * 6.2832;
          head.add(this.mesh(new THREE.ConeGeometry(0.55, 1.6, 4), this.plain(0xffc94d, 0.3, 0.85),
                             Math.cos(a) * 3.1, 5.6, Math.sin(a) * 3.1));
        }
        break;
      case 'bulb':
        head.add(this.box(6.6, 1.4, 1.2, this.plain(0x2c3444, 0.6, 0.2), 0, 2.4, 0));
        head.add(this.ball(1.1, this.plain(0xfff6c9, 0.2, 0, 0xfff0b0, 1.1), 0, 2.4, 2.3, 14));
        break;
    }
  },

  /* ═══════════════ monsters ═══════════════ */
  monster: function (def) {
    var fn = this['mon_' + def.build];
    var rig = (fn ? fn : this.mon_huggy).call(this, def);
    rig.kind = 'monster';
    rig.def = def;
    return rig;
  },

  /**
   * Shared scaffolding. Every length is a fraction of the toy's total height,
   * so each one frames identically in a portrait and scales as one piece.
   */
  baseToy: function (def) {
    var L = def.look, M = PP.M, g = new THREE.Group();
    var H = L.h * M;
    var fur = this.plush(new THREE.Color(L.fur).getHex());
    var belly = this.plush(new THREE.Color(L.belly).getHex());
    var lip = this.plain(new THREE.Color(L.lip).getHex(), 0.55, 0);
    var legLen = H * L.leg, torsoH = H * L.torso, torsoR = H * L.tr;
    var armLen = H * L.arm, limbR = H * L.limbR;
    var rig = { root: g, fur: fur, belly: belly, lip: lip, height: H };

    var hips = new THREE.Group(); hips.position.y = legLen; g.add(hips); rig.hips = hips;

    var torso = this.cap(torsoR, torsoH - torsoR, fur, 0, torsoH / 2, 0);
    torso.scale.set(1, 1, 0.85);
    hips.add(torso);
    rig.torso = torso;

    var bel = this.ball(torsoR * 0.7, belly, 0, torsoH * 0.45, torsoR * 0.55, 18);
    bel.scale.set(0.92, 1.2, 0.5);
    hips.add(bel);

    var head = new THREE.Group();
    head.position.y = torsoH + H * L.head * 0.72;
    hips.add(head); rig.head = head;

    rig.armL = this.limb(armLen, limbR, limbR * 0.85, fur, fur, limbR * 1.5);
    rig.armR = this.limb(armLen, limbR, limbR * 0.85, fur, fur, limbR * 1.5);
    // held clear of the torso, or they vanish into the silhouette
    rig.armL.position.set(-torsoR * 1.45, torsoH * 0.88, 0);
    rig.armR.position.set(torsoR * 1.45, torsoH * 0.88, 0);
    rig.armL.rotation.z = 0.22; rig.armR.rotation.z = -0.22;
    hips.add(rig.armL); hips.add(rig.armR);

    rig.legL = this.limb(legLen, limbR * 1.15, limbR * 0.95, fur, fur, limbR * 1.7);
    rig.legL.position.set(-torsoR * 0.5, 0, 0);
    rig.legR = this.limb(legLen, limbR * 1.15, limbR * 0.95, fur, fur, limbR * 1.7);
    rig.legR.position.set(torsoR * 0.5, 0, 0);
    hips.add(rig.legL); hips.add(rig.legR);

    rig.eyeHeight = legLen + torsoH + H * L.head * 0.6;
    rig.headR = H * L.head;
    return rig;
  },

  /** A round head with eyes and, optionally, a mouth full of teeth. */
  toyHead: function (rig, def, r, opts) {
    var L = def.look, head = rig.head;
    opts = opts || {};
    var skull = this.ball(r, rig.fur, 0, 0, 0, 24);
    skull.scale.set(1, opts.squash || 1, 1);
    head.add(skull);
    head.add(this.eyes(r * 0.30, new THREE.Color(L.eye).getHex(), r * 0.44, r * 0.80, r * 0.26, true));

    if (L.teeth && L.teeth !== 'none') {
      var mw = r * (opts.mouthW || 1.15);
      var lipRing = this.mesh(new THREE.TorusGeometry(mw * 0.44, mw * 0.10, 10, 24), rig.lip,
                              0, -r * 0.26, r * 0.80);
      lipRing.scale.set(1, opts.mouthSquash || 0.62, 1);
      head.add(lipRing);
      var maw = this.ball(mw * 0.42, this.plain(0x140a0c, 0.9, 0), 0, -r * 0.26, r * 0.80, 14);
      maw.scale.set(1, opts.mouthSquash || 0.62, 0.32);
      head.add(maw);
      var t = this.teeth(L.teeth, mw * 0.74, rig.lip);   // in front of the maw, not inside it
      t.position.set(0, -r * 0.26, r * 0.94);
      head.add(t);
      rig.mouth = t;
    } else {
      var smile = this.mesh(new THREE.TorusGeometry(r * 0.40, r * 0.055, 8, 20, Math.PI), rig.lip,
                            0, -r * 0.10, r * 0.90);
      smile.rotation.z = Math.PI;
      head.add(smile);
    }

    if (L.ears) {
      for (var s = -1; s <= 1; s += 2) {
        var tall = def.build === 'bunzo';
        var ear = tall ? this.cap(r * 0.17, r * 1.5, rig.fur, s * r * 0.38, r * 1.3, -r * 0.1)
                       : this.mesh(new THREE.ConeGeometry(r * 0.36, r * 0.8, 4), rig.fur,
                                   s * r * 0.62, r * 0.86, 0);
        if (tall) ear.rotation.z = s * 0.16;
        head.add(ear);
        var inner = tall ? this.cap(r * 0.08, r * 1.1, rig.belly, s * r * 0.38, r * 1.3, r * 0.03)
                         : this.mesh(new THREE.ConeGeometry(r * 0.21, r * 0.55, 4), rig.belly,
                                     s * r * 0.62, r * 0.88, r * 0.07);
        if (tall) inner.rotation.z = s * 0.16;
        head.add(inner);
      }
    }
    rig.headR = r;
    return rig;
  },

  mon_huggy: function (def) {
    var rig = this.baseToy(def);
    this.toyHead(rig, def, rig.headR, { mouthW: 1.4, mouthSquash: 0.72 });
    rig.armSwing = 1.15;
    rig.idleSway = 0.5;
    return rig;
  },

  mon_mommy: function (def) {
    var rig = this.baseToy(def), r = rig.headR;
    this.toyHead(rig, def, r, { squash: 1.2 });
    for (var s = -1; s <= 1; s += 2) {       // pigtail bunches
      rig.head.add(this.ball(r * 0.42, rig.fur, s * r * 1.0, r * 0.45, -r * 0.2, 14));
    }
    rig.armSwing = 0.55;
    rig.noodly = true;      // rubber limbs wobble instead of swinging stiffly
    return rig;
  },

  mon_bunzo: function (def) {
    var rig = this.baseToy(def), r = rig.headR, H = rig.height;
    this.toyHead(rig, def, r, { mouthW: 0.95 });
    var brass = this.plain(0xd9a441, 0.25, 0.65);
    var armLen = H * def.look.arm;
    rig.cymbals = [];
    [rig.armL, rig.armR].forEach(function (arm, i) {
      var cy = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, H * 0.012, 24), brass);
      cy.rotation.x = Math.PI / 2;
      cy.position.set(0, -armLen - r * 0.15, i ? -r * 0.12 : r * 0.12);
      cy.castShadow = true;
      arm.add(cy);
      rig.cymbals.push(cy);
    });
    rig.armSwing = 0.7;
    return rig;
  },

  mon_catnap: function (def) {
    var rig = this.baseToy(def), r = rig.headR, H = rig.height;
    this.toyHead(rig, def, r, { mouthW: 1.3, mouthSquash: 0.55 });
    var wm = this.plain(0xe8e0f5, 0.6, 0);
    for (var s = -1; s <= 1; s += 2) for (var i = 0; i < 3; i++) {
      var w = this.tube(H * 0.004, H * 0.004, r * 0.8, wm,
                        s * r * 0.45, -r * 0.15 + i * r * 0.12, r * 0.85);
      w.rotation.z = s * 1.35; w.rotation.y = s * 0.3;
      rig.head.add(w);
    }
    rig.tail = [];
    var prev = rig.hips, n = 6, seglen = H * 0.075;
    for (var t = 0; t < n; t++) {
      var seg = new THREE.Group();
      seg.position.set(0, t === 0 ? H * 0.08 : 0, t === 0 ? -H * 0.10 : -seglen);
      var mesh = this.tube(H * 0.028 * (1 - t / n * 0.6), H * 0.028 * (1 - (t + 1) / n * 0.6),
                           seglen, rig.fur, 0, 0, -seglen / 2);
      mesh.rotation.x = Math.PI / 2;
      seg.add(mesh);
      prev.add(seg); prev = seg;
      rig.tail.push(seg);
    }
    rig.armSwing = 0.9;
    return rig;
  },

  /** Boxy Boo: a crate, a steel spring, and a head that comes at you. */
  mon_boxy: function (def) {
    var M = PP.M, L = def.look, g = new THREE.Group();
    var H = L.h * M;
    var rig = { root: g, height: H };
    var fur = this.plush(new THREE.Color(L.fur).getHex());
    var wood = PP.Tex.mat('wood', { roughness: 0.85, repeat: 1 });
    var steel = this.plain(0xb8c0cc, 0.3, 0.55);
    rig.fur = fur;
    rig.belly = this.plush(new THREE.Color(L.belly).getHex());
    rig.lip = this.plain(new THREE.Color(L.lip).getHex(), 0.5, 0);

    var boxW = H * 0.40, boxH = H * 0.30;
    g.add(this.box(boxW, boxH, boxW, wood, 0, boxH / 2, 0));
    for (var e = 0; e < 4; e++) {
      var a2 = e / 4 * 6.2832 + 0.785;
      g.add(this.box(boxW * 0.09, boxH * 1.02, boxW * 0.09, steel,
                     Math.cos(a2) * boxW * 0.47, boxH / 2, Math.sin(a2) * boxW * 0.47));
    }
    var lidPivot = new THREE.Group();
    lidPivot.position.set(0, boxH, -boxW / 2);
    lidPivot.add(this.box(boxW * 1.05, boxH * 0.1, boxW * 1.05, wood, 0, 0, -boxW / 2));
    lidPivot.rotation.x = -2.1;
    g.add(lidPivot); rig.lid = lidPivot;

    // the coil: it stretches when he launches
    var spring = new THREE.Group();
    spring.position.y = boxH * 0.85;
    g.add(spring); rig.spring = spring;
    rig.coils = [];
    var COILS = 8, coilR = boxW * 0.30, step = H * 0.035;
    for (var i = 0; i < COILS; i++) {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(coilR, coilR * 0.16, 7, 18), steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = i * step;
      ring.castShadow = true;
      spring.add(ring);
      rig.coils.push(ring);
    }
    rig.coilStep = step;

    var top = new THREE.Group();
    top.position.y = (COILS - 1) * step;
    spring.add(top); rig.hips = top;

    var torsoR = H * 0.13, torsoH = H * 0.16;
    top.add(this.cap(torsoR, torsoH, fur, 0, torsoH * 0.6, 0));

    var collar = new THREE.Group(); collar.position.y = torsoH * 1.15; top.add(collar);
    for (var c = 0; c < 8; c++) {
      var ca = c / 8 * 6.2832;
      var pt = this.mesh(new THREE.ConeGeometry(torsoR * 0.3, torsoR * 0.8, 5),
                         c % 2 ? rig.belly : rig.lip,
                         Math.cos(ca) * torsoR, 0, Math.sin(ca) * torsoR);
      pt.rotation.z = -Math.cos(ca) * 1.1; pt.rotation.x = Math.sin(ca) * 1.1;
      collar.add(pt);
    }

    var r = H * 0.155;
    var head = new THREE.Group(); head.position.y = torsoH * 1.35 + r * 0.7; top.add(head);
    rig.head = head;
    rig.headR = r;
    this.toyHead(rig, def, r, { mouthW: 1.5, mouthSquash: 0.8 });
    for (var s2 = -1; s2 <= 1; s2 += 2) {   // jester horns
      var horn = this.mesh(new THREE.ConeGeometry(r * 0.26, r * 1.0, 8), rig.lip,
                           s2 * r * 0.62, r * 0.85, 0);
      horn.rotation.z = -s2 * 0.75;
      head.add(horn);
      head.add(this.ball(r * 0.16, rig.belly, s2 * r * 1.0, r * 1.24, 0, 10));
    }

    var armLen = H * 0.26, limbR = H * 0.032;
    rig.armL = this.limb(armLen, limbR, limbR * 0.8, fur, fur, limbR * 1.6);
    rig.armR = this.limb(armLen, limbR, limbR * 0.8, fur, fur, limbR * 1.6);
    rig.armL.position.set(-torsoR * 1.3, torsoH, 0);
    rig.armR.position.set(torsoR * 1.3, torsoH, 0);
    rig.armL.rotation.z = 0.3; rig.armR.rotation.z = -0.3;
    top.add(rig.armL); top.add(rig.armR);

    rig.eyeHeight = boxH * 0.85 + (COILS - 1) * step + torsoH * 1.35 + r * 0.7;
    rig.armSwing = 0.5;
    rig.springy = true;
    return rig;
  },

  /** PJ Pug-a-Pillar: a dog head towing a train of body segments. */
  mon_pj: function (def) {
    var M = PP.M, L = def.look, g = new THREE.Group();
    var H = L.h * M;
    var rig = { root: g, height: H };
    var fur = this.plush(new THREE.Color(L.fur).getHex());
    var belly = this.plush(new THREE.Color(L.belly).getHex());
    rig.fur = fur; rig.belly = belly;
    rig.lip = this.plain(new THREE.Color(L.lip).getHex(), 0.6, 0);

    var bodyR = H * 0.30;
    var hips = new THREE.Group(); hips.position.y = bodyR * 1.05; g.add(hips); rig.hips = hips;

    var r = H * 0.26;
    var head = new THREE.Group(); head.position.set(0, r * 0.25, r * 0.9); hips.add(head);
    rig.head = head; rig.headR = r;
    this.toyHead(rig, def, r, { mouthW: 1.0, squash: 0.92 });
    var snout = this.ball(r * 0.5, belly, 0, -r * 0.2, r * 0.82, 14);
    snout.scale.set(1.1, 0.8, 0.85);
    head.add(snout);
    head.add(this.ball(r * 0.16, this.plain(0x1a1216, 0.4, 0), 0, -r * 0.1, r * 1.22, 10));
    for (var s = -1; s <= 1; s += 2) {              // floppy pug ears
      var ear = this.ball(r * 0.4, fur, s * r * 0.82, r * 0.25, 0, 12);
      ear.scale.set(0.45, 1.5, 0.85);
      ear.rotation.z = s * 0.35;
      head.add(ear);
    }

    rig.segments = [];
    var n = L.segments || 7;
    for (var i = 0; i < n; i++) {
      var seg = new THREE.Group();
      var sr = bodyR * (1 - i / n * 0.4);
      var sm = this.ball(sr, i % 2 ? belly : fur, 0, 0, 0, 16);
      sm.scale.set(1, 0.9, 1.05);
      seg.add(sm);
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        var lg = this.limb(sr * 0.75, sr * 0.2, sr * 0.16, fur, fur, sr * 0.24);
        lg.position.set(s2 * sr * 0.85, -sr * 0.15, 0);
        lg.rotation.z = s2 * 0.5;
        seg.add(lg);
        seg.userData['leg' + (s2 > 0 ? 'R' : 'L')] = lg;
      }
      seg.position.set(0, sr * 1.05, -(i + 1) * bodyR * 1.5);
      g.add(seg);
      rig.segments.push({ node: seg, r: sr, trail: [] });
    }
    rig.eyeHeight = bodyR * 1.05 + r * 0.4;
    rig.crawler = true;
    rig.portraitScale = 2.1;    // it is longer than it is tall
    rig.portraitLift = 0.15;
    return rig;
  },

  /* ═══════════════ GrabPack (first-person hands) ═══════════════ */
  grabHand: function (side, gold) {
    var M = PP.M, g = new THREE.Group();
    var col = side === 'l' ? 0xe6404f : 0x3c7ff0;
    var shell = this.plain(gold ? 0xffc94d : col, 0.62, gold ? 0.55 : 0.15);
    var dark = this.plain(0x1b1f27, 0.75, 0.2);
    var palm = this.box(0.16 * M, 0.19 * M, 0.07 * M, shell, 0, 0, 0);
    g.add(palm);
    g.add(this.box(0.17 * M, 0.05 * M, 0.075 * M, dark, 0, -0.09 * M, 0));
    for (var f = -1; f <= 1; f++) {
      g.add(this.box(0.04 * M, 0.11 * M, 0.05 * M, shell, f * 0.055 * M, 0.14 * M, 0));
    }
    g.add(this.box(0.05 * M, 0.09 * M, 0.05 * M, shell, -0.115 * M, 0.02 * M, 0));  // thumb
    g.children.forEach(function (c) { c.castShadow = true; });
    g.scale.setScalar(0.55);
    return g;
  },

  /* ═══════════════ props ═══════════════ */
  prop: function (p) {
    var M = PP.M, g = new THREE.Group(), self = this;
    var steel = this.plain(0x6a7280, 0.48, 0.30);   // painted cabinet steel, not chrome
    var dark = this.plain(0x252a33, 0.7, 0.3);

    switch (p.kind) {
      case 'node': {
        g.add(this.box(1.4 * M, 1.6 * M, 0.5 * M, steel, 0, 0.8 * M, 0));
        g.add(this.box(1.15 * M, 0.75 * M, 0.1 * M, dark, 0, 1.1 * M, 0.28 * M));
        var scr = this.box(1.0 * M, 0.5 * M, 0.04 * M,
                           this.plain(0x14202c, 0.3, 0, 0xff5a4a, 0.35), 0, 1.14 * M, 0.34 * M);
        g.add(scr); g.screen = scr;
        g.add(this.box(1.5 * M, 0.12 * M, 0.6 * M, dark, 0, 0.06 * M, 0));
        for (var v = 0; v < 4; v++) {
          g.add(this.box(1.2 * M, 0.05 * M, 0.06 * M, dark, 0, (0.25 + v * 0.1) * M, 0.27 * M));
        }
        break;
      }
      case 'socket': {
        var col = p.side === 'l' ? 0xe6404f : 0x3c7ff0;
        var housing = this.mesh(new THREE.CylinderGeometry(0.28 * M, 0.28 * M, 0.16 * M, 20), steel, 0, 0, 0);
        housing.rotation.x = Math.PI / 2;          // lay the disc face-on to +Z
        g.add(housing);
        var ring = this.mesh(new THREE.TorusGeometry(0.2 * M, 0.05 * M, 8, 22),
                             this.plain(col, 0.35, 0.2, col, 0.8), 0, 0, 0.06 * M);
        g.add(ring); g.ring = ring;
        var core = this.mesh(new THREE.CylinderGeometry(0.11 * M, 0.11 * M, 0.14 * M, 16),
                             this.plain(col, 0.3, 0.1, col, 1.1), 0, 0, 0.05 * M);
        core.rotation.x = Math.PI / 2;
        g.add(core); g.core = core;
        break;
      }
      case 'task': {
        g.add(this.box(1.3 * M, 1.1 * M, 0.7 * M, this.plain(0x4a515f, 0.6, 0.4), 0, 0.55 * M, 0));
        g.add(this.box(1.34 * M, 0.1 * M, 0.74 * M, dark, 0, 1.1 * M, 0));
        var mon = this.box(0.95 * M, 0.6 * M, 0.06 * M,
                           this.plain(0x0f1a24, 0.25, 0, 0x4fc3f7, 0.5), 0, 0.75 * M, 0.36 * M);
        mon.rotation.x = -0.3;
        g.add(mon); g.screen = mon;
        for (var l = 0; l < 4; l++) {
          var a2 = l / 4 * 6.2832 + 0.78;
          g.add(this.box(0.09 * M, 0.5 * M, 0.09 * M, steel,
                         Math.cos(a2) * 0.55 * M, 0.25 * M, Math.sin(a2) * 0.3 * M));
        }
        break;
      }
      case 'locker': {
        var body = this.box(0.85 * M, 2.1 * M, 0.6 * M, this.plain(0x49607a, 0.5, 0.55), 0, 1.05 * M, 0);
        g.add(body);
        var door = new THREE.Group();
        door.position.set(-0.42 * M, 1.05 * M, 0.3 * M);
        var dm = this.box(0.82 * M, 2.0 * M, 0.06 * M, this.plain(0x546d8a, 0.45, 0.6), 0.41 * M, 0, 0);
        door.add(dm);
        for (var sv = 0; sv < 4; sv++) {
          door.add(this.box(0.5 * M, 0.04 * M, 0.08 * M, dark, 0.41 * M, (0.55 - sv * 0.12) * M, 0.03 * M));
        }
        door.add(this.box(0.05 * M, 0.22 * M, 0.05 * M, this.plain(0xffc94d, 0.3, 0.8), 0.76 * M, 0, 0.05 * M));
        g.add(door); g.door = door;
        break;
      }
      case 'lift': {
        g.add(this.box(3.0 * M, 0.16 * M, 3.0 * M, this.plain(0x3a4250, 0.5, 0.6), 0, 0.08 * M, 0));
        for (var w = 0; w < 3; w++) {
          var ang = w / 3 * 6.2832;
          g.add(this.box(0.16 * M, 3.0 * M, 0.16 * M, steel,
                         Math.cos(ang) * 1.4 * M, 1.5 * M, Math.sin(ang) * 1.4 * M));
        }
        var panel = this.box(0.7 * M, 0.9 * M, 0.12 * M, dark, 1.3 * M, 1.2 * M, 0);
        g.add(panel);
        var lamp = this.box(0.4 * M, 0.4 * M, 0.05 * M,
                            this.plain(0x223322, 0.3, 0, 0x33ff88, 0.2), 1.38 * M, 1.35 * M, 0);
        g.add(lamp); g.lamp = lamp;
        g.add(this.mesh(new THREE.TorusGeometry(1.45 * M, 0.06 * M, 8, 32), steel, 0, 3.0 * M, 0));
        g.children[g.children.length - 1].rotation.x = Math.PI / 2;
        break;
      }
      case 'crate': {
        var s3 = (0.7 + (p.seed || 0.4) * 0.5) * M;
        var wood2 = PP.Tex.mat('wood', { roughness: 0.9, repeat: 1 });
        g.add(this.box(s3 * 1.6, s3 * 1.5, s3 * 1.6, wood2, 0, s3 * 0.75, 0));
        [[0, s3 * 0.81], [0, -s3 * 0.81]].forEach(function (o) {
          g.add(self.box(s3 * 1.65, s3 * 0.12, s3 * 0.1, self.plain(0x6b5334, 0.9, 0), 0, s3 * 0.75, o[1]));
        });
        break;
      }
      case 'shelf': {
        var sm2 = this.plain(0x5b6273, 0.6, 0.25);
        g.add(this.box(2.4 * M, 0.09 * M, 0.8 * M, sm2, 0, 0.1 * M, 0));
        for (var lv = 1; lv <= 3; lv++) g.add(this.box(2.4 * M, 0.07 * M, 0.8 * M, sm2, 0, lv * 0.62 * M, 0));
        for (var pz = -1; pz <= 1; pz += 2) for (var px2 = -1; px2 <= 1; px2 += 2) {
          g.add(this.box(0.1 * M, 2.0 * M, 0.1 * M, sm2, px2 * 1.15 * M, 1.0 * M, pz * 0.35 * M));
        }
        var rnd2 = PP.rng(Math.floor((p.seed || 0.5) * 9999));
        for (var b2 = 0; b2 < 7; b2++) {
          var hue = Math.floor(rnd2() * 360);
          var toy = this.ball(0.16 * M, this.plush(new THREE.Color('hsl(' + hue + ',60%,55%)').getHex(), 0.95),
                              (rnd2() - 0.5) * 2.0 * M, (0.28 + Math.floor(rnd2() * 3) * 0.62) * M,
                              (rnd2() - 0.5) * 0.5 * M, 12);
          g.add(toy);
        }
        break;
      }
      case 'arcade': {
        g.add(this.box(0.9 * M, 1.8 * M, 0.8 * M, this.plain(0x39235c, 0.5, 0.2), 0, 0.9 * M, 0));
        var scr2 = this.box(0.7 * M, 0.55 * M, 0.06 * M,
                            this.plain(0x120c20, 0.2, 0, 0xff5470, 0.6), 0, 1.3 * M, 0.4 * M);
        scr2.rotation.x = -0.25;
        g.add(scr2); g.screen = scr2;
        g.add(this.box(0.8 * M, 0.1 * M, 0.45 * M, this.plain(0x2a1a44, 0.6, 0.1), 0, 0.95 * M, 0.4 * M));
        g.add(this.ball(0.08 * M, this.plain(0xe6404f, 0.3, 0.1), -0.18 * M, 1.03 * M, 0.42 * M, 12));
        g.add(this.ball(0.08 * M, this.plain(0x3c7ff0, 0.3, 0.1), 0.18 * M, 1.03 * M, 0.42 * M, 12));
        g.add(this.box(0.86 * M, 0.3 * M, 0.1 * M,
                       this.plain(0xffc94d, 0.3, 0, 0xffc94d, 0.45), 0, 1.75 * M, 0.36 * M));
        break;
      }
      case 'table': {
        var wood3 = PP.Tex.mat('wood', { roughness: 0.7, repeat: 1 });
        g.add(this.mesh(new THREE.CylinderGeometry(1.0 * M, 1.0 * M, 0.09 * M, 24), wood3, 0, 0.95 * M, 0));
        g.add(this.mesh(new THREE.CylinderGeometry(0.1 * M, 0.1 * M, 0.95 * M, 12), steel, 0, 0.47 * M, 0));
        g.add(this.mesh(new THREE.CylinderGeometry(0.5 * M, 0.5 * M, 0.05 * M, 20), steel, 0, 0.03 * M, 0));
        g.add(this.mesh(new THREE.CylinderGeometry(0.12 * M, 0.09 * M, 0.22 * M, 14),
                        this.plain(0xf2f2f2, 0.4, 0), 0.3 * M, 1.1 * M, 0.15 * M));
        break;
      }
      case 'plant': {
        g.add(this.mesh(new THREE.CylinderGeometry(0.32 * M, 0.24 * M, 0.5 * M, 16),
                        this.plain(0x8a5a3c, 0.85, 0), 0, 0.25 * M, 0));
        g.add(this.mesh(new THREE.CylinderGeometry(0.28 * M, 0.28 * M, 0.06 * M, 16),
                        this.plain(0x3a2a1c, 0.95, 0), 0, 0.5 * M, 0));
        var leaf = this.plain(0x2f7a4d, 0.85, 0);
        for (var lf = 0; lf < 9; lf++) {
          var la = lf / 9 * 6.2832 + (p.seed || 0) * 6;
          var blade = this.mesh(new THREE.ConeGeometry(0.14 * M, 0.9 * M, 5), leaf,
                                Math.cos(la) * 0.18 * M, (0.85 + (lf % 3) * 0.12) * M, Math.sin(la) * 0.18 * M);
          blade.rotation.z = -Math.cos(la) * 0.55;
          blade.rotation.x = Math.sin(la) * 0.55;
          g.add(blade);
        }
        break;
      }
      case 'desk': {
        g.add(this.box(2.2 * M, 0.09 * M, 1.1 * M, this.plain(0x4d5464, 0.55, 0.4), 0, 0.9 * M, 0));
        g.add(this.box(0.9 * M, 0.85 * M, 0.9 * M, this.plain(0x3b4150, 0.6, 0.3), -0.6 * M, 0.45 * M, 0));
        var cm = this.box(1.0 * M, 0.62 * M, 0.06 * M,
                          this.plain(0x0d141c, 0.2, 0, 0x64b5f6, 0.5), 0.35 * M, 1.3 * M, -0.2 * M);
        cm.rotation.x = 0.12;
        g.add(cm); g.screen = cm;
        g.add(this.box(0.16 * M, 0.35 * M, 0.16 * M, this.plain(0x2b303b, 0.6, 0.3), 0.35 * M, 1.05 * M, -0.2 * M));
        g.add(this.box(0.7 * M, 0.04 * M, 0.28 * M, this.plain(0x22262f, 0.7, 0.2), 0.3 * M, 0.96 * M, 0.3 * M));
        break;
      }
      case 'toy': {
        var tm = this.plush(new THREE.Color('hsl(' + p.hue + ',62%,58%)').getHex(), 0.95);
        g.add(this.ball(0.28 * M, tm, 0, 0.28 * M, 0, 14));
        g.add(this.ball(0.2 * M, tm, 0, 0.62 * M, 0, 14));
        g.add(this.eyes(0.05 * M, 0xffffff, 0.07 * M, 0.18 * M, 0.66 * M, false));
        for (var ta = -1; ta <= 1; ta += 2) {
          g.add(this.ball(0.09 * M, tm, ta * 0.28 * M, 0.34 * M, 0, 10));
        }
        break;
      }
      case 'decoy': {
        var dm2 = this.plain(0xffc94d, 0.4, 0.3, 0xffc94d, 0.7);
        g.add(this.ball(0.24 * M, dm2, 0, 0.24 * M, 0, 14));
        g.add(this.box(0.1 * M, 0.1 * M, 0.34 * M, this.plain(0x8a5c00, 0.5, 0.5), 0, 0.24 * M, -0.24 * M));
        break;
      }
      case 'gas': {
        var gm = new THREE.MeshBasicMaterial({ color: 0xff2a44, transparent: true, opacity: 0.16,
                                               depthWrite: false });
        var cloud = new THREE.Mesh(new THREE.SphereGeometry(0.9 * M, 12, 10), gm);
        cloud.position.y = 0.7 * M;
        g.add(cloud); g.cloud = cloud;
        break;
      }
    }
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }
};
