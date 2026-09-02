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
  /** Short-pile fabric: rough, sheened, and lit at grazing angles. */
  plush: function (col, rough) {
    var k = 'plush' + col + rough;
    if (!this.matCache[k]) {
      var c = new THREE.Color(col);
      this.matCache[k] = PP.Tex.mat('plush', {
        color: col, roughness: rough == null ? 0.96 : rough, metalness: 0.0,
        repeat: 2.6, normal: 1.15, env: 0.20,
        sheen: 0.5, sheenRoughness: 0.78,
        // the fuzz catches light in a slightly lighter tint of the fabric itself
        sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.22).getHex()
      });
    }
    return this.matCache[k];
  },

  /**
   * Concatenate several geometries into one, so a hand with five fingers or a
   * mouth full of teeth costs a single draw call.
   */
  merge: function (parts) {
    var P = [], N = [], U = [];
    for (var i = 0; i < parts.length; i++) {
      var src = parts[i].g;
      var g = src.index ? src.toNonIndexed() : src.clone();
      if (parts[i].m) g.applyMatrix4(parts[i].m);
      var p = g.attributes.position.array, n = g.attributes.normal.array;
      var u = g.attributes.uv ? g.attributes.uv.array : null;
      for (var j = 0; j < p.length; j++) P.push(p[j]);
      for (var j2 = 0; j2 < n.length; j2++) N.push(n[j2]);
      var count = p.length / 3;
      for (var k = 0; k < count; k++) U.push(u ? u[k * 2] : 0, u ? u[k * 2 + 1] : 0);
      g.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    out.computeBoundingSphere();
    return out;
  },

  /** Build a transform for merge(), in the order translate · rotate · scale. */
  xf: function (x, y, z, rx, ry, rz, sx, sy, sz) {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x || 0, y || 0, z || 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
      new THREE.Vector3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
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

  /* ── anatomy ──────────────────────────────────────────── */

  /** A chain of tapering segments with knuckles — one finger or toe. */
  digit: function (parts, base, r, lens, curls, taper) {
    var m = base.clone();
    for (var i = 0; i < lens.length; i++) {
      m.multiply(this.xf(0, 0, 0, curls[i] || 0, 0, 0));
      var L = lens[i];
      var r0 = r * Math.pow(taper, i), r1 = r * Math.pow(taper, i + 1);
      parts.push({ g: new THREE.CylinderGeometry(r0, r1, L, 6), m: m.clone().multiply(this.xf(0, -L / 2, 0)) });
      parts.push({ g: new THREE.SphereGeometry(r1 * 1.05, 6, 4), m: m.clone().multiply(this.xf(0, -L, 0)) });
      m.multiply(this.xf(0, -L, 0));
    }
  },

  /**
   * A hand: palm plus four fingers and a thumb, all merged into one mesh.
   * `reach` stretches the fingers — the long-armed toys have long hands too.
   */
  handMesh: function (palmR, reach, mat, curl) {
    var parts = [], self = this;
    curl = curl == null ? 0.22 : curl;
    var palm = new THREE.SphereGeometry(palmR, 14, 10);
    parts.push({ g: palm, m: this.xf(0, -palmR * 0.4, 0, 0, 0, 0, 1.0, 1.25, 0.62) });
    var fr = palmR * 0.30, fl = palmR * reach;
    for (var f = 0; f < 4; f++) {
      var x = (f / 3 - 0.5) * palmR * 1.5;
      var splay = (f / 3 - 0.5) * 0.22;
      var base = this.xf(x, -palmR * 1.25, 0, 0, 0, -splay);
      this.digit(parts, base, fr * (f === 3 ? 0.82 : 1),
                 [fl * 0.5, fl * 0.34, fl * 0.24],
                 [curl * 0.6, curl, curl * 1.3], 0.86);
    }
    var thumb = this.xf(-palmR * 1.15, -palmR * 0.55, palmR * 0.15, 0.3, 0, 1.15);
    this.digit(parts, thumb, fr * 1.05, [fl * 0.4, fl * 0.3], [0.25, 0.45], 0.85);
    return this.mesh(this.merge(parts), mat);
  },

  /** A foot: a rounded sole with three stubby toes. */
  footMesh: function (r, mat) {
    var parts = [];
    parts.push({ g: new THREE.SphereGeometry(r, 14, 10), m: this.xf(0, 0, r * 0.35, 0, 0, 0, 1, 0.75, 1.7) });
    for (var t = -1; t <= 1; t++) {
      parts.push({ g: new THREE.SphereGeometry(r * 0.32, 8, 6),
                   m: this.xf(t * r * 0.5, -r * 0.1, r * 1.25, 0, 0, 0, 1, 0.8, 1.25) });
    }
    return this.mesh(this.merge(parts), mat);
  },

  /**
   * A limb articulated the way a limb actually is: a ball-and-socket at the
   * shoulder or hip, a hinge at the elbow or knee, and a wrist or ankle that
   * keeps the hand level and the foot flat.
   *
   *   g          shoulder / hip pivot
   *   g.lower    elbow / knee pivot
   *   g.wrist    wrist / ankle pivot, carrying the hand or foot
   */
  limb3: function (o) {
    var g = new THREE.Group();

    // upper: socket ball moulded into the shaft
    var up = [];
    up.push({ g: new THREE.SphereGeometry(o.r0 * 1.24, 14, 10), m: this.xf(0, 0, 0, 0, 0, 0, 1, 0.95, 1) });
    up.push({ g: new THREE.CylinderGeometry(o.r0, o.r1, o.upper, 14),
              m: this.xf(0, -o.upper / 2, 0) });
    g.add(this.mesh(this.merge(up), o.mat));

    var lower = new THREE.Group();
    lower.position.y = -o.upper;
    // the hinge is a darker band, so the articulation reads at a glance
    var knuck = this.mesh(new THREE.SphereGeometry(o.r1 * 1.16, 14, 10), o.jointMat || o.mat);
    knuck.scale.set(1.0, 0.9, 1.0);
    lower.add(knuck);
    lower.add(this.mesh(this.merge([
      { g: new THREE.CylinderGeometry(o.r1, o.r2, o.lower, 14), m: this.xf(0, -o.lower / 2, 0) }
    ]), o.mat));

    var wrist = new THREE.Group();
    wrist.position.y = -o.lower;
    // a hand or foot already fills the wrist, so only bare limbs need the ball
    if (o.end) wrist.add(o.end);
    else wrist.add(this.mesh(new THREE.SphereGeometry(o.r2 * 1.12, 12, 9), o.jointMat || o.mat));
    lower.add(wrist);

    g.add(lower);
    g.lower = lower;
    g.wrist = wrist;
    return g;
  },

  /** Kept for the simpler props and the crawler segments. */
  limb2: function (o) { return this.limb3(o); },

  /**
   * An eye painted onto a single sphere — sclera, veins, iris, pupil — under a
   * clearcoat, set into lids. Four stacked spheres never looked alive.
   */
  eyeUnit: function (r, irisHex, lidMat, glow) {
    var g = new THREE.Group();
    var k = 'eye' + irisHex + (glow ? 'g' : '');
    if (!this.matCache[k]) {
      var em = new THREE.MeshPhysicalMaterial({
        map: PP.Tex.eyeTex(irisHex), roughness: 0.16, metalness: 0.0,
        clearcoat: 1.0, clearcoatRoughness: 0.035, envMapIntensity: 1.1
      });
      if (glow) {
        em.emissive = new THREE.Color(irisHex);
        em.emissiveMap = PP.Tex.eyeTex(irisHex);
        em.emissiveIntensity = 0.55;
      }
      this.matCache[k] = em;
    }
    var ball = this.mesh(new THREE.SphereGeometry(r, 24, 18), this.matCache[k]);
    ball.rotation.y = -Math.PI / 2;          // brings the painted iris to +Z
    g.add(ball);

    // lids frame the eye; they are not supposed to cover it
    var lid = this.mesh(new THREE.SphereGeometry(r * 1.08, 20, 12, 0, 6.2832, 0, Math.PI * 0.26), lidMat);
    lid.rotation.x = -0.72;
    g.add(lid); g.lid = lid;
    var low = this.mesh(new THREE.SphereGeometry(r * 1.08, 20, 10, 0, 6.2832, Math.PI * 0.84, Math.PI * 0.16), lidMat);
    low.rotation.x = 0.30;
    g.add(low); g.lowLid = low;
    return g;
  },

  /** Teeth ring inside a mouth opening. */
  teethMesh: function (style, w, mat) {
    var parts = [], self = this;
    function tooth(x, y, z, h, wd, dp, flip) {
      // a real tooth is a rounded wedge, not a box
      var g = new THREE.CylinderGeometry(wd * 0.14, wd * 0.5, h, 6);
      parts.push({ g: g, m: self.xf(x, y, z, flip ? Math.PI : 0, 0, 0, 1, 1, dp) });
    }
    var n = style === 'buck' ? 2 : style === 'jagged' ? 7 : 6;
    for (var i = 0; i < n; i++) {
      var f = n === 1 ? 0.5 : i / (n - 1);
      var x = (f - 0.5) * w * 0.82;
      var arc = -Math.abs(f - 0.5) * w * 0.22;          // the row curves back
      if (style === 'jagged') tooth(x, -w * 0.02, arc, w * 0.34, w * 0.13, 0.7, true);
      else if (style === 'buck') tooth(x * 0.5, -w * 0.06, arc, w * 0.30, w * 0.24, 0.75, true);
      else tooth(x, -w * 0.03, arc, w * 0.20, w * 0.12, 0.75, true);
    }
    if (style !== 'buck') {
      var m2 = style === 'jagged' ? 6 : 5;
      for (var j = 0; j < m2; j++) {
        var f2 = j / (m2 - 1), x2 = (f2 - 0.5) * w * 0.72;
        var arc2 = -Math.abs(f2 - 0.5) * w * 0.20;
        tooth(x2, -w * 0.32, arc2, style === 'jagged' ? w * 0.26 : w * 0.16,
              w * 0.11, 0.72, false);
      }
    }
    return this.mesh(this.merge(parts), mat);
  },

  /** A pair of eyes set into their sockets. */
  eyes: function (r, iris, spread, z, y, glow, lidMat) {
    var g = new THREE.Group();
    lidMat = lidMat || this.plain(0x2a2028, 0.85, 0);
    for (var s = -1; s <= 1; s += 2) {
      var e = this.eyeUnit(r, iris, lidMat, glow);
      e.position.set(s * spread, y, z);
      e.rotation.y = s * 0.13;                 // eyes toe outward slightly
      g.add(e);
    }
    return g;
  },
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
    var eyes = this.eyes(0.62, 0x4a3320, 1.25, 3.0, 0.35, false);
    head.add(eyes);
    head.add(this.mesh(new THREE.ConeGeometry(0.55, 1.3, 8), skin, 0, -0.35, 3.15));
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    this.addHat(head, look.hat, look.hatCol);
    rig.hatSlot = head;

    // arms and legs, with elbows and knees
    var mkArm = function (self) {
      return self.limb2({ upper: 5.4, lower: 5.1, r0: 1.25, r1: 1.0, r2: 0.88, mat: body,
                          end: self.handMesh(1.15, 1.6, skin, 0.3) });
    };
    rig.armL = mkArm(this); rig.armR = mkArm(this);
    rig.armL.position.set(-4.5, 8.2, 0); rig.armR.position.set(4.5, 8.2, 0);
    rig.armL.rotation.z = 0.16; rig.armR.rotation.z = -0.16;
    hips.add(rig.armL); hips.add(rig.armR);

    var boot = this.plain(0x1a1a20, 0.62, 0.05);
    var mkLeg = function (self) {
      return self.limb2({ upper: 6.7, lower: 6.3, r0: 1.6, r1: 1.25, r2: 1.05, mat: legMat,
                          end: self.footMesh(1.5, boot) });
    };
    rig.legL = mkLeg(this); rig.legR = mkLeg(this);
    rig.legL.position.set(-1.9, 0, 0); rig.legR.position.set(1.9, 0, 0);
    hips.add(rig.legL); hips.add(rig.legR);
    rig.jointed = true;

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
  /**
   * Shared scaffolding. Every length is a fraction of the toy's total height,
   * so each one frames identically in a portrait and scales as one piece.
   * Limbs have real elbows and knees, and end in hands and feet.
   */
  baseToy: function (def) {
    var L = def.look, M = PP.M, g = new THREE.Group();
    var H = L.h * M;
    var fur = this.plush(new THREE.Color(L.fur).getHex());
    var furDark = this.plush(new THREE.Color(L.fur).multiplyScalar(0.62).getHex());
    var belly = this.plush(new THREE.Color(L.belly).getHex());
    var lip = this.plain(new THREE.Color(L.lip).getHex(), 0.62, 0);
    var legLen = H * L.leg, torsoH = H * L.torso, torsoR = H * L.tr;
    var armLen = H * L.arm, limbR = H * L.limbR;
    var rig = { root: g, fur: fur, furDark: furDark, belly: belly, lip: lip, height: H };

    var hips = new THREE.Group(); hips.position.y = legLen; g.add(hips); rig.hips = hips;

    // pelvis stays with the hips; everything above it hangs off a spine pivot
    var pelvis = this.mesh(new THREE.SphereGeometry(torsoR * 0.92, 20, 14), fur);
    pelvis.scale.set(1, 0.85, 0.82);
    pelvis.position.y = torsoR * 0.15;
    hips.add(pelvis);

    var spine = new THREE.Group();
    spine.position.y = torsoR * 0.30;
    hips.add(spine); rig.spine = spine;

    var body = [];
    body.push({ g: new THREE.CylinderGeometry(torsoR * 0.98, torsoR * 0.88, torsoH * 0.72, 20),
                m: this.xf(0, torsoH * 0.30, 0, 0, 0, 0, 1, 1, 0.82) });
    body.push({ g: new THREE.SphereGeometry(torsoR * 1.02, 20, 14),
                m: this.xf(0, torsoH * 0.66, 0, 0, 0, 0, 1, 0.78, 0.82) });
    var torso = this.mesh(this.merge(body), fur);
    spine.add(torso);
    rig.torso = torso;

    // a sewn-on belly patch, slightly proud of the body
    var bel = this.mesh(new THREE.SphereGeometry(torsoR * 0.66, 20, 14), belly);
    bel.position.set(0, torsoH * 0.28, torsoR * 0.44);
    bel.scale.set(0.95, 1.25, 0.42);
    spine.add(bel);

    for (var sd = -1; sd <= 1; sd += 2) {
      var del = this.mesh(new THREE.SphereGeometry(torsoR * 0.42, 14, 10), fur);
      del.position.set(sd * torsoR * 1.0, torsoH * 0.72, 0);
      del.scale.set(1, 0.9, 0.9);
      spine.add(del);
    }

    // the head rides a neck pivot, so it can turn without the body turning
    var neck = new THREE.Group();
    neck.position.y = torsoH * 0.78;
    spine.add(neck); rig.neck = neck;
    var column = this.mesh(new THREE.CylinderGeometry(torsoR * 0.40, torsoR * 0.52,
                                                      H * L.head * 0.50, 14), furDark);
    column.position.y = H * L.head * 0.16;
    neck.add(column);

    var head = new THREE.Group();
    head.position.y = H * L.head * 0.60;
    neck.add(head); rig.head = head;

    var handR = limbR * 1.5, self = this;
    var arm = function () {
      return self.limb3({ upper: armLen * 0.50, lower: armLen * 0.42,
                          r0: limbR * 1.15, r1: limbR * 0.92, r2: limbR * 0.8,
                          mat: fur, jointMat: furDark,
                          end: self.handMesh(handR, def.build === 'huggy' ? 3.4 : 2.2, fur, 0.2) });
    };
    rig.armL = arm(); rig.armR = arm();
    rig.armL.position.set(-torsoR * 1.35, torsoH * 0.72, 0);
    rig.armR.position.set(torsoR * 1.35, torsoH * 0.72, 0);
    rig.armL.rotation.z = 0.18; rig.armR.rotation.z = -0.18;
    spine.add(rig.armL); spine.add(rig.armR);

    var leg = function () {
      return self.limb3({ upper: legLen * 0.50, lower: legLen * 0.42,
                          r0: limbR * 1.45, r1: limbR * 1.1, r2: limbR * 0.92,
                          mat: fur, jointMat: furDark,
                          end: self.footMesh(limbR * 1.6, furDark) });
    };
    rig.legL = leg(); rig.legR = leg();
    rig.legL.position.set(-torsoR * 0.52, 0, 0);
    rig.legR.position.set(torsoR * 0.52, 0, 0);
    hips.add(rig.legL); hips.add(rig.legR);

    rig.eyeHeight = legLen + torsoH + H * L.head * 0.6;
    rig.headR = H * L.head;
    rig.jointed = true;
    return rig;
  },

  /**
   * A head with a brow, a muzzle, set-in eyes and a mouth that has a gum line,
   * a throat and a tongue behind the teeth.
   */
  toyHead: function (rig, def, r, opts) {
    var L = def.look, head = rig.head;
    opts = opts || {};

    var skull = [];
    skull.push({ g: new THREE.SphereGeometry(r, 26, 20),
                 m: this.xf(0, 0, 0, 0, 0, 0, 1, opts.squash || 1, 1) });
    // brow ridge and a slight muzzle, so the face is not a ball
    skull.push({ g: new THREE.SphereGeometry(r * 0.52, 16, 12),
                 m: this.xf(0, r * 0.20, r * 0.62, 0, 0, 0, 1.5, 0.5, 0.75) });
    if (opts.muzzle !== false) {
      skull.push({ g: new THREE.SphereGeometry(r * 0.62, 18, 14),
                   m: this.xf(0, -r * 0.16, r * 0.52, 0, 0, 0, 1.15, 0.85, 0.9) });
    }
    head.add(this.mesh(this.merge(skull), rig.fur));

    var eyeR = r * 0.27;
    var eyes = this.eyes(eyeR, new THREE.Color(L.eye).getHex(), r * 0.44, r * 0.86, r * 0.26,
                         true, rig.fur);
    head.add(eyes);
    rig.eyes = eyes;
    // sockets: a darker rim so the eyes sit in the head instead of on it
    for (var s = -1; s <= 1; s += 2) {
      var socket = this.mesh(new THREE.TorusGeometry(eyeR * 1.12, eyeR * 0.28, 8, 18), rig.furDark);
      socket.position.set(s * r * 0.44, r * 0.26, r * 0.80);
      socket.scale.z = 0.6;
      head.add(socket);
    }

    if (L.mouth === 'wide') {
      // a broad crescent grin: lips, a dark interior, a tongue, and no teeth
      var ww = r * (opts.mouthW || 1.5), wy = -r * 0.22, wz = r * 0.86;
      var maw2 = this.mesh(new THREE.SphereGeometry(ww * 0.5, 22, 14), this.plain(0x140a10, 0.95, 0));
      maw2.position.set(0, wy, wz);
      maw2.scale.set(1, 0.34, 0.40);
      head.add(maw2);
      var lips = this.mesh(new THREE.TorusGeometry(ww * 0.5, ww * 0.105, 12, 34, Math.PI * 1.12),
                           rig.lip);
      lips.position.set(0, wy + ww * 0.02, wz + ww * 0.04);
      lips.rotation.z = Math.PI * 1.06;
      lips.scale.set(1, 0.42, 0.7);
      head.add(lips);
      var tng = this.mesh(new THREE.SphereGeometry(ww * 0.30, 16, 12), this.plain(0x8c3a4a, 0.75, 0));
      tng.position.set(0, wy - ww * 0.06, wz + ww * 0.02);
      tng.scale.set(1.0, 0.22, 0.55);
      head.add(tng);
      // a nose above the grin
      head.add(this.mesh(new THREE.SphereGeometry(r * 0.12, 12, 9), rig.lip,
                         0, r * 0.10, r * 0.98));
    } else if (L.teeth && L.teeth !== 'none') {
      var mw = r * (opts.mouthW || 1.15), my = -r * 0.30, mz = r * 0.72;
      var squash = opts.mouthSquash || 0.62;
      // gum line
      var gum = this.mesh(new THREE.TorusGeometry(mw * 0.46, mw * 0.13, 12, 26), rig.lip);
      gum.position.set(0, my, mz);
      gum.scale.set(1, squash, 0.75);
      head.add(gum);
      // throat
      var maw = this.mesh(new THREE.SphereGeometry(mw * 0.44, 16, 12), this.plain(0x120a0d, 0.95, 0));
      maw.position.set(0, my, mz - mw * 0.10);
      maw.scale.set(0.98, squash, 0.55);
      head.add(maw);
      // tongue
      var tongue = this.mesh(new THREE.SphereGeometry(mw * 0.26, 14, 10), this.plain(0x8c3a4a, 0.75, 0));
      tongue.position.set(0, my - mw * 0.12 * squash, mz - mw * 0.02);
      tongue.scale.set(1.0, 0.32, 0.85);
      head.add(tongue);

      var t = this.teethMesh(L.teeth, mw * 1.02, this.plain(0xf6f2e6, 0.34, 0));
      t.position.set(0, my, mz + mw * 0.18);
      head.add(t);
      rig.mouth = t;
    } else {
      var smile = this.mesh(new THREE.TorusGeometry(r * 0.40, r * 0.06, 10, 22, Math.PI), rig.lip);
      smile.position.set(0, -r * 0.12, r * 0.86);
      smile.rotation.z = Math.PI;
      head.add(smile);
    }

    if (L.ears) {
      for (var e = -1; e <= 1; e += 2) {
        var tall = def.build === 'bunzo';
        var ear = tall ? this.cap(r * 0.17, r * 1.5, rig.fur, e * r * 0.38, r * 1.3, -r * 0.1)
                       : this.mesh(new THREE.ConeGeometry(r * 0.36, r * 0.8, 5), rig.fur,
                                   e * r * 0.62, r * 0.86, 0);
        if (tall) ear.rotation.z = e * 0.16;
        head.add(ear);
        var inner = tall ? this.cap(r * 0.08, r * 1.1, rig.belly, e * r * 0.38, r * 1.3, r * 0.03)
                         : this.mesh(new THREE.ConeGeometry(r * 0.21, r * 0.55, 5), rig.belly,
                                     e * r * 0.62, r * 0.88, r * 0.07);
        if (tall) inner.rotation.z = e * 0.16;
        head.add(inner);
      }
    }
    rig.headR = r;
    return rig;
  },


  mon_huggy: function (def) {
    var rig = this.baseToy(def);
    this.toyHead(rig, def, rig.headR, { mouthW: 1.02, mouthSquash: 0.70 });
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

  /** CatNap walks on four legs, head low and forward. */
  mon_catnap: function (def) {
    var M = PP.M, L = def.look, g = new THREE.Group();
    var H = L.h * M;                     // height at the shoulder
    var BL = (L.len || 2.2) * M;         // nose-to-tail body length
    var rig = { root: g, height: H * 1.15 };
    var fur = this.plush(new THREE.Color(L.fur).getHex());
    var furDark = this.plush(new THREE.Color(L.fur).multiplyScalar(0.6).getHex());
    var belly = this.plush(new THREE.Color(L.belly).getHex());
    rig.fur = fur; rig.furDark = furDark; rig.belly = belly;
    rig.lip = this.plain(new THREE.Color(L.lip).getHex(), 0.6, 0);

    var bodyR = H * 0.30;
    var body = new THREE.Group();
    body.position.y = H * 0.62;
    g.add(body);
    rig.body = body; rig.bodyY = body.position.y; rig.hips = body;

    // chest, midriff and haunches along Z
    var parts = [];
    parts.push({ g: new THREE.SphereGeometry(bodyR * 1.05, 20, 14),
                 m: this.xf(0, 0, BL * 0.24, 0, 0, 0, 1, 0.95, 1.05) });
    parts.push({ g: new THREE.CylinderGeometry(bodyR * 1.02, bodyR * 0.98, BL * 0.5, 20),
                 m: this.xf(0, 0, 0, Math.PI / 2, 0, 0, 1, 1, 0.95) });
    parts.push({ g: new THREE.SphereGeometry(bodyR * 1.12, 20, 14),
                 m: this.xf(0, bodyR * 0.05, -BL * 0.26, 0, 0, 0, 1.05, 1, 1.1) });
    body.add(this.mesh(this.merge(parts), fur));
    var bel = this.mesh(new THREE.SphereGeometry(bodyR * 0.72, 18, 12), belly);
    bel.position.set(0, -bodyR * 0.55, BL * 0.05);
    bel.scale.set(0.9, 0.4, 1.9);
    body.add(bel);

    // neck angles up and forward from the chest
    var neck = new THREE.Group();
    neck.position.set(0, bodyR * 0.35, BL * 0.42);
    neck.rotation.x = 0.42;
    body.add(neck); rig.neck = neck;
    var column = this.mesh(new THREE.CylinderGeometry(bodyR * 0.46, bodyR * 0.62, H * 0.38, 14), fur);
    column.position.y = H * 0.17;
    column.rotation.x = -0.30;
    neck.add(column);

    var head = new THREE.Group();
    head.position.set(0, H * 0.36, H * 0.14);
    head.rotation.x = -0.42;
    neck.add(head); rig.head = head;
    this.toyHead(rig, def, H * 0.42, { mouthW: 1.35, squash: 0.92, muzzle: false });

    // four legs: forelegs fold back, hind legs fold forward
    var limbR = H * 0.075, self = this;
    rig.legs = [];
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(function (p, i) {
      var back = p[1] < 0;
      var len = back ? H * 0.66 : H * 0.62;
      var lg = self.limb3({ upper: len * 0.52, lower: len * 0.48,
                            r0: limbR * 1.25, r1: limbR, r2: limbR * 0.85,
                            mat: fur, jointMat: furDark,
                            end: self.footMesh(limbR * 1.5, furDark) });
      lg.position.set(p[0] * bodyR * 0.72, -bodyR * 0.25, p[1] * BL * (back ? 0.30 : 0.34));
      body.add(lg);
      rig.legs.push({ node: lg, back: back, phase: (i === 0 || i === 3) ? 0 : Math.PI });
    });

    // tail
    rig.tail = [];
    var prev = body, n = 7, seglen = BL * 0.10;
    for (var t = 0; t < n; t++) {
      var seg = new THREE.Group();
      seg.position.set(0, t === 0 ? bodyR * 0.5 : 0, t === 0 ? -BL * 0.44 : -seglen);
      var mesh = this.tube(bodyR * 0.20 * (1 - t / n * 0.7), bodyR * 0.20 * (1 - (t + 1) / n * 0.7),
                           seglen, fur, 0, 0, -seglen / 2);
      mesh.rotation.x = Math.PI / 2;
      seg.add(mesh);
      prev.add(seg); prev = seg;
      rig.tail.push(seg);
    }

    rig.eyeHeight = H * 1.05;
    rig.quad = true;
    rig.idleSway = 1.2;
    rig.portraitScale = 1.75;   // longer than it is tall
    rig.portraitLift = 0.10;
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
    this.toyHead(rig, def, r, { mouthW: 1.15, mouthSquash: 0.8 });
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
