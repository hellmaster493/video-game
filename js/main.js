/* ═══════════════════════════════════════════════════════════
   main.js — boot, the frame loop, and global hotkeys
   ═══════════════════════════════════════════════════════════ */
'use strict';

(function () {
  var canvas = document.getElementById('game');

  PP.Save.load();
  PP.Scene.init(canvas);
  PP.Input.init(canvas);
  PP.World.build(1337);          // a world exists before the first shift, for the menu
  PP.UI.init();
  document.getElementById('boot').classList.add('hidden');

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function once() {
      PP.Audio.unlock();
      window.removeEventListener(ev, once);
    });
  });

  var last = performance.now(), hudT = 0;

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    hotkeys();

    var g = PP.Game;
    if (g.running && !g.paused && !g.over) g.update(dt);
    if (g.player && PP.Scene.ready) {
      PP.Scene.update(g, dt);
      PP.Scene.render(dt, g.player.fear || 0);
    }

    if (g.running) {
      hudT -= dt;
      if (hudT <= 0) { hudT = 0.08; PP.UI.refreshHud(g); }
      if (PP.UI.mapOpen) PP.Minimap.draw(g, PP.UI.el.bigmapCv, true);
    }

    PP.Input.endFrame();
    requestAnimationFrame(frame);
  }

  function hotkeys() {
    var In = PP.Input, UI = PP.UI, g = PP.Game;
    var inGame = g.running && !g.over;

    if (In.hit('Escape')) {
      if (UI.wheelOpen) UI.toggleWheel(false);
      else if (UI.mapOpen) UI.toggleMap(false);
      else if (inGame) UI.setPause(!g.paused);
    }
    if (!inGame) return;
    if (In.hit('Tab') && !UI.wheelOpen) UI.toggleMap(!UI.mapOpen);
    if (In.hit('c')) UI.toggleWheel(!UI.wheelOpen);
    if (UI.wheelOpen) {
      for (var i = 0; i < PP.EMOTES.length; i++) {
        if (In.hit(PP.EMOTES[i].key)) { UI.doEmote(i); break; }
      }
    }
  }

  requestAnimationFrame(frame);
  window.PPGame = PP;
})();
