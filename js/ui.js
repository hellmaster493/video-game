/* ═══════════════════════════════════════════════════════════
   ui.js — menus, HUD, chat wheel, shop, maps, end card
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.UI = {
  el: {}, wheelOpen: false, mapOpen: false, abilityPill: null,

  init: function () {
    var $ = function (id) { return document.getElementById(id); };
    this.el = {
      menu: $('menu'), hud: $('hud'), pause: $('pause'), end: $('endcard'),
      wheel: $('wheel'), bigmap: $('bigmap'), bigmapCv: $('bigmap-canvas'),
      minimap: $('minimap'), touch: $('touch'),
      objText: $('obj-text'), objFill: $('obj-fill'),
      roleName: $('hud-role-name'), tokens: $('hud-tokens'), clock: $('hud-clock'),
      stam: $('stamina-fill'), fear: $('fear-fill'),
      handL: $('hand-l'), handR: $('hand-r'),
      prompt: $('prompt'), promptText: $('prompt-text'),
      toasts: $('toasts'), sub: $('subtitle'), subWho: $('sub-who'), subLine: $('sub-line'),
      name: $('playername')
    };

    // an ability chip, built here so index.html stays about layout
    var pill = document.createElement('div');
    pill.id = 'ability';
    pill.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(14,18,28,.92);' +
      'border:1px solid rgba(255,255,255,.10);border-radius:9px;padding:6px 11px;width:214px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.45);white-space:nowrap';
    pill.innerHTML = '<kbd>Q</kbd><span style="flex:1;font-size:11px" id="ability-name">—</span>' +
      '<span id="ability-cd" style="font-size:11px;color:#ffc94d;margin-left:6px">READY</span>';
    document.querySelector('.hud-bottom').appendChild(pill);
    this.abilityPill = pill;

    this.buildMenu();
    this.bind();
    this.el.name.value = PP.Save.data.name || '';
  },

  /* ═════════ menu construction ═════════ */
  buildMenu: function () {
    this.buildModes();
    this.buildCast();
    this.buildShop();
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

  buildCast: function () {
    var host = document.getElementById('cast-list'), S = PP.Save.data, self = this;
    host.innerHTML = '';
    var monsterMode = S.mode === 'monster';

    if (monsterMode) {
      PP.MONSTERS.forEach(function (m) {
        var unlocked = S.tokens >= m.unlockAt || S.unlocked[m.id];
        var d = document.createElement('div');
        d.className = 'card' + (S.monster === m.id ? ' sel' : '') + (unlocked ? '' : ' locked');
        var cv = document.createElement('canvas');
        cv.width = 76; cv.height = 84;
        d.appendChild(cv);
        var info = document.createElement('div');
        info.innerHTML = '<h4>' + m.name + '</h4><p>' + m.blurb + '</p>' +
          '<span class="perk">reach ' + m.reach + ' · speed ' + m.speed + '</span>' +
          (unlocked ? '' : '<span class="lock">🔒 ' + m.unlockAt + '</span>');
        d.appendChild(info);
        self.previewMonster(cv, m.look);
        d.onclick = function () {
          if (!unlocked) { self.toast('Bank ' + m.unlockAt + ' tokens to unlock ' + m.name + '.', 'bad'); return; }
          S.monster = m.id; PP.Save.flush(); PP.Audio.ui(); self.buildCast();
        };
        host.appendChild(d);
      });
      if (!S.monster) S.monster = 'snugglepaw';
      return;
    }

    PP.ROLES.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'card' + (S.role === r.id ? ' sel' : '');
      var cv = document.createElement('canvas');
      cv.width = 76; cv.height = 84;
      d.appendChild(cv);
      var info = document.createElement('div');
      info.innerHTML = '<h4>' + r.name + '</h4><p>' + r.blurb + '</p>' +
                       '<span class="perk">' + r.perk + '</span>';
      d.appendChild(info);
      self.previewRole(cv, r.look);
      d.onclick = function () {
        S.role = r.id; PP.Save.flush(); PP.Audio.ui(); self.buildCast();
      };
      host.appendChild(d);
    });
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
    bal.id = 'shop-balance';
    bal.className = 'hint';
    bal.innerHTML = 'Balance: <b style="color:#ffc94d">' + S.tokens + '</b> tokens';
    host.parentNode.insertBefore(bal, host);
  },

  /* small portraits for the cast cards */
  previewRole: function (cv, look) {
    var c = cv.getContext('2d');
    c.translate(38, 52); c.scale(1.5, 1.5);
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath(); c.ellipse(0, 14, 13, 5, 0, 0, 6.2832); c.fill();
    c.fillStyle = '#232833'; c.fillRect(-8, 2, 6, 12); c.fillRect(2, 2, 6, 12);
    c.fillStyle = look.skin; c.fillRect(-13, -6, 5, 13); c.fillRect(8, -6, 5, 13);
    c.fillStyle = look.body;
    c.beginPath();
    if (c.roundRect) c.roundRect(-11, -12, 22, 22, 7); else c.rect(-11, -12, 22, 22);
    c.fill();
    c.fillStyle = look.trim; c.fillRect(-11, -3, 22, 3);
    c.fillStyle = look.skin;
    c.beginPath(); c.arc(0, -12, 8.5, 0, 6.2832); c.fill();
    c.fillStyle = '#1c1a17';
    c.beginPath(); c.arc(-3, -13, 1.5, 0, 6.2832); c.fill();
    c.beginPath(); c.arc(3, -13, 1.5, 0, 6.2832); c.fill();
    PP.Render.drawHat(c, look.hat, look.hatCol);
  },

  previewMonster: function (cv, L) {
    var c = cv.getContext('2d');
    c.translate(38, 58); c.scale(1.25, 1.25);
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath(); c.ellipse(0, 16, 16, 6, 0, 0, 6.2832); c.fill();
    c.strokeStyle = L.fur; c.lineWidth = 6; c.lineCap = 'round';
    for (var s = -1; s <= 1; s += 2) {
      c.beginPath(); c.moveTo(s * 12, -6);
      c.quadraticCurveTo(s * 24, 2, s * 18, 12); c.stroke();
    }
    c.beginPath(); c.moveTo(-7, 6); c.lineTo(-7, 16); c.stroke();
    c.beginPath(); c.moveTo(7, 6); c.lineTo(7, 16); c.stroke();
    c.lineCap = 'butt';
    c.fillStyle = L.fur;
    c.beginPath();
    if (c.roundRect) c.roundRect(-14, -16, 28, 28, 11); else c.rect(-14, -16, 28, 28);
    c.fill();
    c.fillStyle = L.belly;
    c.beginPath(); c.ellipse(0, -1, 8, 10, 0, 0, 6.2832); c.fill();
    c.fillStyle = L.fur;
    c.beginPath(); c.arc(0, -22, 13, 0, 6.2832); c.fill();
    c.fillStyle = L.eye;
    c.beginPath(); c.arc(-5, -25, 4.2, 0, 6.2832); c.fill();
    c.beginPath(); c.arc(5, -25, 4.2, 0, 6.2832); c.fill();
    c.fillStyle = '#0a0a0a';
    c.beginPath(); c.arc(-5, -26, 1.9, 0, 6.2832); c.fill();
    c.beginPath(); c.arc(5, -26, 1.9, 0, 6.2832); c.fill();
    if (L.teeth) {
      c.fillStyle = '#12080a';
      c.beginPath(); c.ellipse(0, -17, 8, 4.5, 0, 0, 6.2832); c.fill();
      c.fillStyle = '#fffdf2';
      for (var i = -3; i <= 3; i++) c.fillRect(i * 2.2 - 0.8, -20.5, 1.7, 3.4);
    }
  },

  /* ═════════ event wiring ═════════ */
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

    if ('ontouchstart' in window) this.el.touch.classList.remove('hidden');
  },

  startGame: function () {
    var S = PP.Save.data;
    PP.Audio.unlock();
    S.name = (this.el.name.value.trim() || 'New Hire').slice(0, 14);
    PP.Save.flush();
    this.el.menu.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.end.classList.add('hidden');
    this.clearToasts();
    PP.Game.start({ mode: S.mode, role: S.role, monster: S.monster || 'snugglepaw' });
    this.refreshHud(PP.Game);
    var g = PP.Game;
    this.toast(g.mode === 'monster' ? 'Hunt them down. LMB to lunge.'
             : g.mode === 'night' ? 'Torch on. Find five nodes.'
             : 'Take your time. Say hello to people.');
  },

  toMenu: function () {
    PP.Game.running = false; PP.Game.paused = false;
    PP.Audio.stopDrone();
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.add('hidden');
    this.el.menu.classList.remove('hidden');
    this.buildMenu();
  },

  setPause: function (v) {
    PP.Game.paused = v;
    this.el.pause.classList.toggle('hidden', !v);
    PP.Input.block(v);
  },

  /* ═════════ per-frame HUD ═════════ */
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
      document.getElementById('hands').style.display = '';
    } else {
      document.getElementById('hands').style.display = 'none';
    }

    var ab = g.player.ability;
    if (ab && !isMonster) {
      this.abilityPill.style.display = '';
      document.getElementById('ability-name').textContent = g.player.abilityInfo().name;
      document.getElementById('ability-cd').textContent =
        ab.ready ? 'READY' : Math.ceil(ab.cd) + 's';
      document.getElementById('ability-cd').style.color = ab.ready ? '#ffc94d' : '#93a0b8';
    } else {
      this.abilityPill.style.display = 'none';
    }
    PP.Render.minimap(g, this.el.minimap, false);
  },

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
      // nearby staff answer you — cheap, but it sells the roleplay
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

  /* ═════════ big map ═════════ */
  toggleMap: function (open) {
    this.mapOpen = open;
    this.el.bigmap.classList.toggle('hidden', !open);
    if (open) PP.Render.minimap(PP.Game, this.el.bigmapCv, true);
  },

  /* ═════════ end card ═════════ */
  endCard: function (win, reason, rows, g) {
    var self = this;
    document.getElementById('end-title').textContent =
      win ? (g.mode === 'monster' ? 'ALL ACCOUNTED FOR' : 'CLOCKED OUT ALIVE') : 'SHIFT OVER';
    document.getElementById('end-title').style.color = win ? '#49d67f' : '#e6404f';
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
