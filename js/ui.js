/* ═══════════════════════════════════════════════════════════
   ui.js — menus, HUD, chat wheel, shop, maps, end card.
   The cast screen renders real 3D portraits of every character.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.UI = {
  el: {}, wheelOpen: false, mapOpen: false, abilityPill: null, pr: null,

  init: function () {
    var $ = function (id) { return document.getElementById(id); };
    this.el = {
      menu: $('menu'), hud: $('hud'), pause: $('pause'), end: $('endcard'),
      wheel: $('wheel'), bigmap: $('bigmap'), bigmapCv: $('bigmap-canvas'),
      minimap: $('minimap'), touch: $('touch'), cross: $('crosshair'),
      objText: $('obj-text'), objFill: $('obj-fill'),
      roleName: $('hud-role-name'), tokens: $('hud-tokens'), clock: $('hud-clock'),
      stam: $('stamina-fill'), fear: $('fear-fill'),
      handL: $('hand-l'), handR: $('hand-r'), hands: $('hands'),
      prompt: $('prompt'), promptText: $('prompt-text'),
      toasts: $('toasts'), sub: $('subtitle'), subWho: $('sub-who'), subLine: $('sub-line'),
      name: $('playername'), flash: $('flash'), lockhint: $('lockhint'),
      blackout: $('blackout')
    };

    var pill = document.createElement('div');
    pill.id = 'ability';
    pill.innerHTML = '<kbd>Q</kbd><span id="ability-name">—</span>' +
                     '<span id="ability-cd">READY</span>';
    document.querySelector('.hud-bottom').appendChild(pill);
    this.abilityPill = pill;

    this.buildMenu();
    this.bind();
    this.el.name.value = PP.Save.data.name || '';
  },

  /* ═════════ 3D portraits ═════════ */
  portrait: function (canvas, rig, opts) {
    if (!this.pr) {
      this.pr = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.pr.setPixelRatio(2);
      this.pr.setSize(180, 220);
      this.pr.outputEncoding = THREE.sRGBEncoding;
      this.pr.toneMapping = THREE.ACESFilmicToneMapping;
      this.pr.toneMappingExposure = 0.95;
      this.prScene = new THREE.Scene();
      this.prScene.environment = PP.Tex.envMap(this.pr);
      this.prCam = new THREE.PerspectiveCamera(30, 180 / 220, 1, 900);
      var key = new THREE.DirectionalLight(0xfff0d8, 1.35); key.position.set(60, 90, 80);
      var rim = new THREE.DirectionalLight(0x6f9cff, 0.75); rim.position.set(-70, 40, -60);
      var fill = new THREE.HemisphereLight(0x4a5a78, 0x14171d, 0.45);
      this.prScene.add(key); this.prScene.add(rim); this.prScene.add(fill);
    }
    var s = this.prScene;
    while (s.children.length > 3) s.remove(s.children[3]);
    rig.root.rotation.y = opts.spin == null ? -0.5 : opts.spin;
    s.add(rig.root);
    var h = rig.height, d = h * 2.45 * (rig.portraitScale || 1);
    this.prCam.position.set(0, h * (0.60 + (rig.portraitLift || 0)), d);
    this.prCam.lookAt(0, h * 0.52, 0);
    this.pr.render(s, this.prCam);
    var c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(this.pr.domElement, 0, 0, canvas.width, canvas.height);
    s.remove(rig.root);
  },

  /* ═════════ menu construction ═════════ */
  buildMenu: function () {
    this.buildMaps(); this.buildModes(); this.buildCast(); this.buildShop(); this.buildQuality();
  },

  buildMaps: function () {
    var host = document.getElementById('map-list'), S = PP.Save.data, self = this;
    host.innerHTML = '';
    PP.MAPS.forEach(function (m) {
      var d = document.createElement('div');
      d.className = 'mapcard' + (S.map === m.id ? ' sel' : '');
      var cv = document.createElement('canvas');
      cv.width = 260; cv.height = 190;
      d.appendChild(cv);
      var info = document.createElement('div');
      info.innerHTML = '<h4><span>' + m.icon + '</span>' + m.name + '</h4><p>' + m.blurb + '</p>';
      d.appendChild(info);
      PP.Minimap.preview(m, cv);
      d.onclick = function () {
        S.map = m.id; PP.Save.flush(); PP.Audio.ui(); self.buildMaps();
      };
      host.appendChild(d);
    });
  },

  buildQuality: function () {
    var S = PP.Save.data, self = this;
    document.querySelectorAll('.qbtn').forEach(function (b) {
      b.classList.toggle('sel', (S.gfx || 'high') === b.dataset.q);
      b.onclick = function () {
        S.gfx = b.dataset.q; PP.Save.flush(); PP.Audio.ui();
        PP.Scene.applyQuality(S.gfx);
        self.buildQuality();
      };
    });
  },

  buildModes: function () {
    var host = document.getElementById('mode-list'), S = PP.Save.data, self = this;
    host.innerHTML = '';
    PP.MODES.forEach(function (m) {
      var d = document.createElement('div');
      d.className = 'mode' + (S.mode === m.id ? ' sel' : '');
      d.innerHTML = '<div class="ic">' + m.icon + '</div><div><h3>' + m.name +
                    '</h3><p>' + m.desc + '</p></div>';
      d.onclick = function () {
        S.mode = m.id; PP.Save.flush(); PP.Audio.ui();
        self.buildModes(); self.buildCast();
      };
      host.appendChild(d);
    });
  },

  monsterCard: function (m, selected, onPick) {
    var self = this;
    var d = document.createElement('div');
    d.className = 'card mon' + (selected ? ' sel' : '');
    var cv = document.createElement('canvas');
    cv.width = 180; cv.height = 220;
    cv.className = 'shot';
    d.appendChild(cv);
    var info = document.createElement('div');
    info.className = 'cardinfo';
    info.innerHTML = '<h4>' + m.name + '</h4><p>' + m.blurb + '</p>' +
      '<span class="perk">' + m.specialName + '</span>' +
      '<p class="special">' + m.specialText + '</p>' +
      '<div class="stats">' +
        '<span>speed<b>' + m.speed + '</b></span>' +
        '<span>reach<b>' + m.reach + '</b></span>' +
        '<span>ears<b>' + m.hearing + '</b></span>' +
        '<span>vents<b>' + (m.vent ? 'yes' : 'no') + '</b></span>' +
      '</div>';
    d.appendChild(info);
    // build the model once, snapshot it, then throw it away
    var rig = PP.Models.monster(m);
    this.portrait(cv, rig, { spin: (m.build === 'pj' || m.look.quad) ? -1.05 : -0.55 });
    d.onclick = function () { onPick(); PP.Audio.ui(); };
    return d;
  },

  buildCast: function () {
    var host = document.getElementById('tab-cast'), S = PP.Save.data, self = this;
    host.innerHTML = '';
    if (!S.monster) S.monster = 'huggy';
    if (!S.hunter) S.hunter = 'huggy';

    function section(title, sub) {
      var h = document.createElement('div');
      h.className = 'section';
      h.innerHTML = '<h3>' + title + '</h3><p>' + sub + '</p>';
      host.appendChild(h);
      var grid = document.createElement('div');
      grid.className = 'cast';
      host.appendChild(grid);
      return grid;
    }

    if (S.mode === 'monster') {
      var g1 = section('You play as', 'Six toys, six completely different ways to hunt.');
      g1.classList.add('wide');
      PP.MONSTERS.forEach(function (m) {
        g1.appendChild(self.monsterCard(m, S.monster === m.id, function () {
          S.monster = m.id; PP.Save.flush(); self.buildCast();
        }));
      });
      return;
    }

    var g0 = section('Your role', 'Each one changes how you play a shift.');
    PP.ROLES.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'card' + (S.role === r.id ? ' sel' : '');
      var cv = document.createElement('canvas');
      cv.width = 180; cv.height = 220; cv.className = 'shot';
      d.appendChild(cv);
      var info = document.createElement('div');
      info.className = 'cardinfo';
      info.innerHTML = '<h4>' + r.name + '</h4><p>' + r.blurb + '</p>' +
                       '<span class="perk">' + r.perk + '</span>';
      d.appendChild(info);
      self.portrait(cv, PP.Models.human(r.look), { spin: -0.5 });
      d.onclick = function () { S.role = r.id; PP.Save.flush(); PP.Audio.ui(); self.buildCast(); };
      g0.appendChild(d);
    });

    if (S.mode === 'night') {
      var g2 = section('Who is awake down there',
                       'Pick the toy that hunts you. They are not reskins — each one hunts differently.');
      g2.classList.add('wide');
      PP.MONSTERS.forEach(function (m) {
        g2.appendChild(self.monsterCard(m, S.hunter === m.id, function () {
          S.hunter = m.id; PP.Save.flush(); self.buildCast();
        }));
      });
    }
  },

  buildShop: function () {
    var host = document.getElementById('shop-list'), S = PP.Save.data, self = this;
    host.innerHTML = '';
    PP.SHOP.forEach(function (it) {
      var owned = !!S.owned[it.id];
      var d = document.createElement('div');
      d.className = 'item' + (owned ? ' owned' : '');
      d.innerHTML = '<h4>' + it.name + '</h4><p>' + it.desc + '</p>';
      var b = document.createElement('button');
      b.textContent = owned ? 'Owned' : it.cost + ' tokens';
      b.disabled = owned || S.tokens < it.cost;
      b.onclick = function () {
        if (S.tokens < it.cost) return;
        S.tokens -= it.cost; S.owned[it.id] = true;
        PP.Save.flush(); PP.Audio.good();
        self.toast('Bought ' + it.name + '.', 'good');
        self.buildShop();
      };
      d.appendChild(b);
      host.appendChild(d);
    });
    var old = document.getElementById('shop-balance');
    if (old) old.parentNode.removeChild(old);
    var bal = document.createElement('p');
    bal.id = 'shop-balance'; bal.className = 'hint';
    bal.innerHTML = 'Balance: <b style="color:#ffc94d">' + S.tokens + '</b> tokens';
    host.parentNode.insertBefore(bal, host);
  },

  /* ═════════ wiring ═════════ */
  bind: function () {
    var self = this, S = PP.Save.data;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.onclick = function () {
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
        document.querySelectorAll('.tabpanel').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        document.getElementById('tab-' + t.dataset.tab).classList.add('active');
        PP.Audio.ui();
        if (t.dataset.tab === 'shop') self.buildShop();
        if (t.dataset.tab === 'cast') self.buildCast();
      };
    });
    this.el.name.oninput = function () {
      S.name = this.value.trim().slice(0, 14) || 'New Hire';
      PP.Save.flush();
    };
    document.getElementById('btn-start').onclick = function () { self.startGame(); };
    document.getElementById('btn-resume').onclick = function () { self.setPause(false); };
    document.getElementById('btn-quit').onclick = function () { self.toMenu(); };
    document.getElementById('btn-again').onclick = function () {
      self.el.end.classList.add('hidden'); self.startGame();
    };
    document.getElementById('btn-menu').onclick = function () {
      self.el.end.classList.add('hidden'); self.toMenu();
    };
    if (PP.isTouch) {
      this.el.touch.classList.remove('hidden');
      document.body.classList.add('touch');
    }
  },

  startGame: function () {
    var S = PP.Save.data;
    PP.Audio.unlock();
    S.name = (this.el.name.value.trim() || 'New Hire').slice(0, 14);
    PP.Save.flush();
    var stage = document.getElementById('stage');
    stage.scrollTop = 0; stage.scrollLeft = 0;
    this.el.menu.scrollTop = 0;
    this.el.menu.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.end.classList.add('hidden');
    this.clearToasts();
    PP.Game.start({ mode: S.mode, role: S.role, map: S.map || 'factory',
                    monster: S.monster || 'huggy', hunter: S.hunter || 'huggy' });
    if (!PP.isTouch) { PP.Input.wantLock = true; PP.Input.lock(); }
    this.refreshHud(PP.Game);
    var g = PP.Game;
    this.toast(g.mode === 'monster' ? 'Hunt them down. Left-click to strike.'
             : g.mode === 'night' ? 'Torch on. Five nodes. Do not get cornered.'
             : 'Take your time. Say hello to people.');
  },

  toMenu: function () {
    PP.Game.running = false; PP.Game.paused = false;
    PP.Audio.stopDrone();
    PP.Input.wantLock = false;
    PP.Input.unlock();
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.add('hidden');
    this.el.menu.classList.remove('hidden');
    this.buildMenu();
  },

  setPause: function (v) {
    PP.Game.paused = v;
    this.el.pause.classList.toggle('hidden', !v);
    PP.Input.block(v);
    if (PP.isTouch) return;
    if (v) PP.Input.unlock(); else PP.Input.lock();
  },

  /* ═════════ HUD ═════════ */
  refreshHud: function (g) {
    if (!g.player) return;
    var isMonster = g.mode === 'monster';
    this.el.roleName.textContent = isMonster ? g.player.def.name : g.player.role.name;
    this.el.tokens.innerHTML = '<b>' + g.saveData.tokens + '</b> tokens';
    this.el.clock.textContent = 'Shift ' + g.shift + ' · ' + PP.U.fmtTime(g.clock);
    this.el.stam.style.width = (g.player.stamina * 100) + '%';
    this.el.fear.style.width = ((g.player.fear || 0) * 100) + '%';

    if (g.player.hands) {
      this.el.handL.classList.toggle('on', g.player.hands.l.state !== 'idle');
      this.el.handR.classList.toggle('on', g.player.hands.r.state !== 'idle');
      this.el.hands.style.display = '';
    } else this.el.hands.style.display = 'none';

    var ab = g.player.ability;
    if (ab && g.player.abilityInfo) {
      this.abilityPill.style.display = '';
      document.getElementById('ability-name').textContent = g.player.abilityInfo().name;
      var cd = document.getElementById('ability-cd');
      cd.textContent = ab.ready ? 'READY' : Math.ceil(ab.cd) + 's';
      cd.style.color = ab.ready ? '#ffc94d' : '#93a0b8';
    } else this.abilityPill.style.display = 'none';

    this.el.cross.classList.toggle('hidden', PP.Scene.thirdPerson && isMonster);
    this.el.flash.style.opacity = Math.max(0, Math.min(1, g.flash));
    this.el.blackout.style.opacity = Math.max(0, Math.min(1, g.fade || 0));
    this.el.lockhint.classList.toggle('hidden',
      PP.isTouch || PP.Input.locked || !g.running || g.paused);
    PP.Minimap.draw(g, this.el.minimap, false);
  },

  /** Pull the HUD out of the way while the camera is not yours. */
  hideHud: function (on) { this.el.hud.classList.toggle('cine', !!on); },

  objective: function (text, pct) {
    this.el.objText.textContent = text;
    this.el.objFill.style.width = Math.round(pct * 100) + '%';
  },
  prompt: function (text) {
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    this.el.promptText.textContent = text;
    this.el.prompt.classList.remove('hidden');
  },
  toast: function (text, kind) {
    var d = document.createElement('div');
    d.className = 'toast' + (kind ? ' ' + kind : '');
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(function () {
      d.style.transition = 'opacity .4s,transform .4s';
      d.style.opacity = 0; d.style.transform = 'translateX(20px)';
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 420);
    }, 3200);
    while (this.el.toasts.children.length > 5) this.el.toasts.removeChild(this.el.toasts.firstChild);
  },
  clearToasts: function () { this.el.toasts.innerHTML = ''; },
  subtitle: function (who, line) {
    var el = this.el.sub;
    this.el.subWho.textContent = who;
    this.el.subLine.textContent = line;
    el.classList.remove('hidden');
    clearTimeout(this._subT);
    this._subT = setTimeout(function () { el.classList.add('hidden'); }, 3600);
  },

  /* ═════════ chat wheel ═════════ */
  toggleWheel: function (open) {
    this.wheelOpen = open;
    var w = this.el.wheel;
    w.classList.toggle('hidden', !open);
    PP.Input.block(open);
    if (PP.isTouch) return;
    if (open) PP.Input.unlock(); else if (PP.Game.running && !PP.Game.paused) PP.Input.lock();
    if (!open) { w.innerHTML = ''; return; }
    PP.Audio.ui();

    var ring = document.createElement('div');
    ring.className = 'wheel-ring';
    var self = this, n = PP.EMOTES.length;
    PP.EMOTES.forEach(function (e, i) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var d = document.createElement('div');
      d.className = 'wedge';
      d.style.left = (50 + Math.cos(a) * 42) + '%';
      d.style.top = (50 + Math.sin(a) * 42) + '%';
      d.innerHTML = e.label + '<small>' + e.key + '</small>';
      d.onclick = function () { self.doEmote(i); };
      ring.appendChild(d);
    });
    var hint = document.createElement('div');
    hint.className = 'wheel-hint';
    hint.innerHTML = 'CHAT<br><span style="font-size:10px">press 1–8 or click<br>C or Esc to close</span>';
    ring.appendChild(hint);
    w.innerHTML = '';
    w.appendChild(ring);
  },

  doEmote: function (i) {
    var e = PP.EMOTES[i], g = PP.Game;
    if (!e || !g.player) return;
    g.player.say(e.say, 3.2);
    g.player.emote = { anim: e.anim, t: 2.2 };
    if (e.kind === 'chat') {
      PP.Audio.ui();
      g.makeNoise(g.player.x, g.player.y, 200, g.player);
      g.npcs.forEach(function (n) {
        if (n.caught) return;
        if (PP.U.dist(n.x, n.y, g.player.x, g.player.y) < 300 && PP.U.chance(0.65)) {
          setTimeout(function () {
            if (n.caught) return;
            n.say(PP.U.pick(['Copy that.', 'On my way!', 'Understood.', 'Right behind you.',
                             'Where?!', 'Got it.']), 3);
          }, PP.U.randInt(350, 1100));
        }
      });
    }
    this.toggleWheel(false);
  },

  toggleMap: function (open) {
    this.mapOpen = open;
    this.el.bigmap.classList.toggle('hidden', !open);
    if (open) PP.Minimap.draw(PP.Game, this.el.bigmapCv, true);
    if (PP.isTouch) return;
    if (open) PP.Input.unlock();
    else if (PP.Game.running && !PP.Game.paused) PP.Input.lock();
  },

  endCard: function (win, reason, rows, g) {
    var self = this;
    var t = document.getElementById('end-title');
    t.textContent = win ? (g.mode === 'monster' ? 'ALL ACCOUNTED FOR' : 'CLOCKED OUT ALIVE') : 'SHIFT OVER';
    t.style.color = win ? '#49d67f' : '#e6404f';
    document.getElementById('end-body').textContent = reason;
    var host = document.getElementById('end-payout');
    host.innerHTML = '';
    rows.forEach(function (r) {
      var d = document.createElement('div');
      d.innerHTML = '<span>' + r[0] + '</span><b>' + r[1] + '</b>';
      host.appendChild(d);
    });
    var d2 = document.createElement('div');
    d2.innerHTML = '<span>Balance</span><b>' + g.saveData.tokens + '</b>';
    host.appendChild(d2);
    setTimeout(function () { self.el.end.classList.remove('hidden'); }, 700);
  }
};
