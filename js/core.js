/* ═══════════════════════════════════════════════════════════
   core.js — math helpers, input, persistence, synth audio
   ═══════════════════════════════════════════════════════════ */
'use strict';
var PP = window.PP = {};

/* ── math ────────────────────────────────────────────────── */
PP.U = {
  clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp:  function (a, b, t) { return a + (b - a) * t; },
  dist:  function (ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); },
  dist2: function (ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; },
  rand:  function (a, b) { return a + Math.random() * (b - a); },
  randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
  pick:  function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  chance: function (p) { return Math.random() < p; },
  // shortest-path angle interpolation
  angLerp: function (a, b, t) {
    var d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  },
  // frame-rate independent easing toward a target
  approach: function (v, target, rate, dt) { return v + (target - v) * (1 - Math.exp(-rate * dt)); },
  fmtTime: function (s) {
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
};

/* ── seeded RNG (mulberry32) — for repeatable factory clutter ── */
PP.rng = function (seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ── input ───────────────────────────────────────────────── */
PP.Input = {
  keys: {}, pressed: {},
  mouse: { x: 0, y: 0, l: false, r: false, lHit: false, rHit: false },
  look: { dx: 0, dy: 0 },
  sens: 0.0022,
  touch: { active: false, mx: 0, my: 0, sprint: false, interact: false },
  locked: false, wantLock: false,
  _blocked: false,

  init: function (canvas) {
    var self = this;
    window.addEventListener('keydown', function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!self.keys[k]) self.pressed[k] = true;
      self.keys[k] = true;
      if (['Tab', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) >= 0
          && document.activeElement.tagName !== 'INPUT') e.preventDefault();
    });
    window.addEventListener('keyup', function (e) {
      self.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false;
    });
    window.addEventListener('blur', function () { self.keys = {}; });

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // ── pointer lock: the game is mouse-look, so the cursor has to go away ──
    document.addEventListener('pointerlockchange', function () {
      self.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('locked', self.locked);
    });
    canvas.addEventListener('mousemove', function (e) {
      var r = canvas.getBoundingClientRect();
      self.mouse.x = e.clientX - r.left;
      self.mouse.y = e.clientY - r.top;
      // pointer lock is the normal path; dragging is the fallback when a
      // browser refuses it, so the game never becomes unplayable
      if (!self._blocked && (self.locked || (self.wantLock && (self.mouse.l || self.mouse.r)))) {
        self.look.dx += e.movementX || 0;
        self.look.dy += e.movementY || 0;
      }
    });
    canvas.addEventListener('mousedown', function (e) {
      if (self._blocked) return;
      // ask for the lock, but never swallow the click that asked for it
      if (self.wantLock && !self.locked) self.lock(canvas);
      if (e.button === 0) { self.mouse.l = true; self.mouse.lHit = true; }
      if (e.button === 2) { self.mouse.r = true; self.mouse.rHit = true; }
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) self.mouse.l = false;
      if (e.button === 2) self.mouse.r = false;
    });
    this.canvas = canvas;
    this.initTouch();
  },

  lock: function (canvas) {
    var el = canvas || this.canvas;
    if (el && el.requestPointerLock) { try { el.requestPointerLock(); } catch (e) {} }
  },
  unlock: function () {
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  },

  initTouch: function () {
    var self = this, stick = document.getElementById('stick');
    if (!stick) return;
    var knob = stick.querySelector('i'), id = null, cx = 0, cy = 0, R = 46;

    function down(e) {
      var t = e.changedTouches[0]; id = t.identifier;
      var r = stick.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      self.touch.active = true; move(e);
    }
    function move(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== id) continue;
        var dx = t.clientX - cx, dy = t.clientY - cy, d = Math.hypot(dx, dy) || 1;
        var k = Math.min(1, d / R);
        self.touch.mx = (dx / d) * k; self.touch.my = (dy / d) * k;
        knob.style.transform = 'translate(' + (self.touch.mx * R) + 'px,' + (self.touch.my * R) + 'px)';
      }
      e.preventDefault();
    }
    function up() {
      id = null; self.touch.mx = self.touch.my = 0;
      knob.style.transform = ''; self.touch.active = false;
    }
    stick.addEventListener('touchstart', down, { passive: false });
    stick.addEventListener('touchmove', move, { passive: false });
    stick.addEventListener('touchend', up);
    stick.addEventListener('touchcancel', up);

    document.querySelectorAll('.tbtn').forEach(function (b) {
      var act = b.dataset.act;
      b.addEventListener('touchstart', function (e) {
        e.preventDefault();
        if (act === 'sprint') self.touch.sprint = true;
        else if (act === 'interact') self.touch.interact = true;
        else if (act === 'chat') self.pressed.c = true;
      }, { passive: false });
      b.addEventListener('touchend', function () {
        if (act === 'sprint') self.touch.sprint = false;
      });
    });
  },

  /** true only on the frame a key went down */
  hit: function (k) { return !!this.pressed[k]; },
  down: function (k) { return !!this.keys[k]; },
  block: function (v) { this._blocked = v; if (v) { this.mouse.l = this.mouse.r = false; } },
  endFrame: function () {
    this.pressed = {};
    this.mouse.lHit = this.mouse.rHit = false;
    this.touch.interact = false;
    this.look.dx = this.look.dy = 0;
  }
};

/* ── persistence ─────────────────────────────────────────── */
PP.Save = {
  KEY: 'playtime-factory-rp.v1',
  data: null,
  defaults: function () {
    return {
      name: 'New Hire', tokens: 0, role: 'worker', mode: 'roam', gfx: 'high', map: 'factory',
      owned: {}, unlocked: {}, best: {}, shifts: 0
    };
  },
  load: function () {
    try {
      var raw = localStorage.getItem(this.KEY);
      this.data = raw ? Object.assign(this.defaults(), JSON.parse(raw)) : this.defaults();
    } catch (e) { this.data = this.defaults(); }
    return this.data;
  },
  flush: function () {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) {}
  }
};

/* ── audio: everything synthesized, zero asset files ─────── */
PP.Audio = {
  ctx: null, master: null, muted: false, _drone: null,

  unlock: function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  },

  /** one-shot oscillator blip */
  tone: function (freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    var t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol == null ? 0.16 : vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  /** filtered noise burst — footsteps, impacts, static */
  noise: function (dur, freq, vol, q) {
    if (!this.ctx || this.muted) return;
    var t = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
    var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = this.ctx.createBufferSource(); src.buffer = buf;
    var f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq || 800; f.Q.value = q || 1.2;
    var g = this.ctx.createGain(); g.gain.value = vol == null ? 0.2 : vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  },

  step:   function () { this.noise(0.09, PP.U.rand(320, 520), 0.09, 1.6); },
  grab:   function () { this.tone(760, 0.10, 'square', 0.07, 220); },
  latch:  function () { this.tone(180, 0.16, 'sawtooth', 0.10, 460); },
  ui:     function () { this.tone(560, 0.07, 'triangle', 0.08); },
  good:   function () { var s = this; [520, 660, 830].forEach(function (f, i) {
            setTimeout(function () { s.tone(f, 0.16, 'triangle', 0.10); }, i * 85); }); },
  bad:    function () { this.tone(220, 0.42, 'sawtooth', 0.14, 60); },
  alarm:  function () { this.tone(880, 0.30, 'square', 0.09, 500); },
  roar:   function () { this.tone(150, 0.85, 'sawtooth', 0.20, 44); this.noise(0.7, 240, 0.18, 0.7); },
  vent:   function () { this.noise(0.35, 180, 0.13, 0.9); },
  coin:   function () { this.tone(1180, 0.09, 'square', 0.06, 1560); },
  crash:  function () {
    this.noise(0.9, 5200, 0.20, 0.4);
    this.noise(0.6, 2600, 0.14, 0.5);
    this.tone(1400, 0.5, 'square', 0.05, 700);
  },

  /** low ambience whose pitch/volume rises with danger */
  drone: function (level) {
    if (!this.ctx || this.muted) return;
    if (!this._drone) {
      var o = this.ctx.createOscillator(), g = this.ctx.createGain(),
          f = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = 44;
      f.type = 'lowpass'; f.frequency.value = 220;
      g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(this.master); o.start();
      this._drone = { o: o, g: g, f: f };
    }
    var t = this.ctx.currentTime;
    this._drone.g.gain.setTargetAtTime(0.015 + level * 0.075, t, 0.6);
    this._drone.o.frequency.setTargetAtTime(40 + level * 30, t, 0.9);
  },
  stopDrone: function () {
    if (this._drone && this.ctx) this._drone.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
  }
};
