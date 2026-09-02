/* ═══════════════════════════════════════════════════════════
   minimap.js — the 2D floor plan, drawn on a plain canvas over
   the 3D view. Rooms fog in as you walk them.
   ═══════════════════════════════════════════════════════════ */
'use strict';

PP.Minimap = {
  /** Floorplan thumbnail for the map picker, drawn straight from map data. */
  preview: function (map, canvas) {
    var c = canvas.getContext('2d'), T = PP.TILE;
    var pad = 6;
    var sc = Math.min((canvas.width - pad * 2) / (map.W * T),
                      (canvas.height - pad * 2) / (map.H * T));
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    c.translate(pad, pad); c.scale(sc, sc);

    var byId = {};
    map.rooms.forEach(function (r) { byId[r.id] = r; });
    var mid = function (r) { return { x: (r.r[0] + r.r[2] / 2) * T, y: (r.r[1] + r.r[3] / 2) * T }; };

    c.strokeStyle = 'rgba(150,170,205,.35)';
    c.lineWidth = 9 / sc;
    (map.links || []).forEach(function (l) {
      var a = byId[l[0]], b = byId[l[1]];
      if (!a || !b) return;
      var p = mid(a), q = mid(b);
      c.beginPath(); c.moveTo(p.x, p.y);
      if (Math.abs(q.x - p.x) >= Math.abs(q.y - p.y)) { c.lineTo(q.x, p.y); }
      else { c.lineTo(p.x, q.y); }
      c.lineTo(q.x, q.y); c.stroke();
    });
    c.fillStyle = 'rgba(150,170,205,.30)';
    (map.halls || []).forEach(function (h) {
      c.fillRect(h[0] * T, h[1] * T, h[2] * T, h[3] * T);
    });

    map.rooms.forEach(function (r) {
      var tags = r.tags || [];
      var spawn = tags.indexOf('spawn') >= 0, exit = tags.indexOf('exit') >= 0;
      c.fillStyle = spawn ? 'rgba(255,201,77,.42)' : exit ? 'rgba(73,214,127,.40)'
                                                   : 'rgba(150,170,205,.28)';
      c.fillRect(r.r[0] * T, r.r[1] * T, r.r[2] * T, r.r[3] * T);
      c.strokeStyle = spawn ? 'rgba(255,201,77,.9)' : exit ? 'rgba(73,214,127,.85)'
                                                    : 'rgba(180,200,235,.45)';
      c.lineWidth = 3 / sc;
      c.strokeRect(r.r[0] * T, r.r[1] * T, r.r[2] * T, r.r[3] * T);
    });
    c.strokeStyle = 'rgba(255,201,77,.5)';
    c.lineWidth = 5 / sc;
    c.setLineDash([14 / sc, 10 / sc]);
    (map.vents || []).forEach(function (v) {
      c.beginPath();
      c.moveTo(v[0] * T, v[1] * T); c.lineTo(v[2] * T, v[3] * T); c.stroke();
    });
    c.setLineDash([]);
    c.restore();
  },

  draw: function (game, canvas, big) {
    var c = canvas.getContext('2d'), W = PP.World, T = PP.TILE;
    var pad = big ? 10 : 5;
    var sc = Math.min((canvas.width - pad * 2) / (W.W * T),
                      (canvas.height - pad * 2) / (W.H * T));
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.save();
    c.translate(pad, pad); c.scale(sc, sc);

    for (var h = 0; h < W.halls.length; h++) {
      var hh = W.halls[h];
      c.fillStyle = 'rgba(110,128,160,.22)';
      c.fillRect(hh[0] * T, hh[1] * T, hh[2] * T, hh[3] * T);
    }
    for (var i = 0; i < W.rooms.length; i++) {
      var r = W.rooms[i], seen = game.seen[r.id];
      c.fillStyle = seen ? 'rgba(120,140,180,.36)' : 'rgba(70,80,102,.14)';
      c.fillRect(r.x * T, r.y * T, r.w * T, r.h * T);
      c.strokeStyle = seen ? 'rgba(180,200,235,.5)' : 'rgba(120,135,165,.2)';
      c.lineWidth = 3 / sc;
      c.strokeRect(r.x * T, r.y * T, r.w * T, r.h * T);
      if (big && seen) {
        c.fillStyle = '#c9d4e8';
        c.font = (12 / sc) + 'px Trebuchet MS';
        c.textAlign = 'center';
        c.fillText(r.name, r.cx, r.cy);
        c.textAlign = 'left';
      }
    }
    // vent shortcuts
    c.strokeStyle = 'rgba(255,201,77,.42)';
    c.lineWidth = 6 / sc;
    c.setLineDash([16 / sc, 12 / sc]);
    for (var v = 0; v < W.ventLines.length; v++) {
      var vv = W.ventLines[v];
      c.beginPath();
      c.moveTo(vv[0] * T + T / 2, vv[1] * T + T / 2);
      c.lineTo(vv[2] * T + T / 2, vv[3] * T + T / 2);
      c.stroke();
    }
    c.setLineDash([]);

    for (var p = 0; p < W.props.length; p++) {
      var pr = W.props[p];
      if (pr.kind === 'node') {
        c.fillStyle = pr.done ? '#49d67f' : '#ffc94d';
        c.beginPath(); c.arc(pr.x, pr.y, 15 / sc, 0, 6.2832); c.fill();
      } else if (pr.kind === 'lift' && pr.armed) {
        c.fillStyle = '#49d67f';
        c.fillRect(pr.x - 24, pr.y - 24, 48, 48);
      }
    }
    for (var n = 0; n < game.npcs.length; n++) {
      var npc = game.npcs[n];
      if (npc.caught) continue;
      var revealed = game.reveal > 0;
      c.fillStyle = revealed ? '#ffe066' : 'rgba(120,220,255,.75)';
      c.beginPath(); c.arc(npc.x, npc.y, (revealed ? 14 : 11) / sc, 0, 6.2832); c.fill();
    }
    if (game.showMonsterOnMap()) {
      for (var m = 0; m < game.monsters.length; m++) {
        var mo = game.monsters[m];
        c.fillStyle = '#e6404f';
        c.beginPath(); c.arc(mo.x, mo.y, 16 / sc, 0, 6.2832); c.fill();
      }
    }
    if (game.player) {
      var pl = game.player;
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(pl.x, pl.y, 15 / sc, 0, 6.2832); c.fill();
      c.strokeStyle = '#ffc94d'; c.lineWidth = 5 / sc;
      c.beginPath();
      c.moveTo(pl.x, pl.y);
      c.lineTo(pl.x + Math.cos(pl.face) * 46, pl.y + Math.sin(pl.face) * 46);
      c.stroke();
    }
    c.restore();
  }
};
