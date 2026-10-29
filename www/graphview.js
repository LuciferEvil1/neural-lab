'use strict';
/* Neural Lab v3 — generic revolving-dots graph renderer.
 * Same visual language as the Brain tab (dark canvas, glowing dots,
 * slow rotation, tap-a-node), but for arbitrary graphs: nodes[] + edges[].
 * Used by the Notes tab: notes are dots, [[wikilinks]] are edges.
 */
window.NL_NGRAPH = (function () {
  var cv = null, ctx = null, W = 600, H = 380;
  var nodes = [], edges = [], pos = {};   // id -> {x,y}
  var rot = 0, running = true, speed = 0.5;
  var selId = null, onSelect = null;
  var inited = false;

  function fit() {
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (w > 40 && h > 40 && (Math.abs(cv.width - w) > 2 || Math.abs(cv.height - h) > 2)) {
      W = Math.round(w); H = Math.round(h);
      cv.width = W; cv.height = H;
      layout();
    }
  }

  function layout() {
    pos = {};
    var n = nodes.length;
    if (!n) return;
    var R = Math.max(40, Math.min(W, H) / 2 - 46);
    for (var i = 0; i < n; i++) {
      var a = rot + i * (Math.PI * 2 / n);
      pos[nodes[i].id] = { x: W / 2 + R * Math.cos(a), y: H / 2 + R * Math.sin(a) };
    }
  }

  function nodeR(nd) { return 6 + Math.min(10, (nd.weight || 1) * 1.6); }

  function draw() {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, W, H);
    if (!nodes.length) {
      ctx.fillStyle = '#5c5c6a'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No notes yet — create one to grow the graph.', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }
    var i, p;
    ctx.lineWidth = 1.2;
    for (i = 0; i < edges.length; i++) {
      var a = pos[edges[i][0]], b = pos[edges[i][1]];
      if (!a || !b) continue;
      ctx.strokeStyle = 'rgba(124,92,255,0.38)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      p = pos[nd.id];
      if (!p) continue;
      var r = nodeR(nd);
      var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
      g.addColorStop(0, 'rgba(64,224,255,0.85)');
      g.addColorStop(1, 'rgba(64,224,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#40e0ff';
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.55, 0, 6.2832); ctx.fill();
      if (selId === nd.id) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 6.2832); ctx.stroke();
      }
      ctx.fillStyle = '#9a9aa8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      var label = String(nd.label);
      if (label.length > 18) label = label.slice(0, 17) + '…';
      ctx.fillText(label, p.x, p.y + r + 15);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5c5c6a'; ctx.font = '12px sans-serif';
    ctx.fillText(nodes.length + ' notes · ' + edges.length + ' links', 10, H - 10);
  }

  var lastT = 0, lastDrawn = -1000, rafOn = false;
  // v64.1 "Smooth Spin": same lifecycle fix as brain.js — the loop dies when
  // the view is hidden and restarts via startLoop(); draws capped at 30fps.
  function frame(t) {
    if (!ctx || cv.offsetParent === null) { rafOn = false; return; } // hidden — loop dies
    rafOn = true;
    if (t - lastDrawn < 33) { requestAnimationFrame(frame); return; } // 30fps cap
    lastDrawn = t;
    requestAnimationFrame(frame);
    var dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0.016;
    lastT = t;
    if (running && nodes.length > 1) { rot += dt * speed; layout(); }
    draw();
  }
  function startLoop() { // v64.1: guarded starter — schedules exactly one loop
    if (!rafOn) { rafOn = true; lastDrawn = -1000; requestAnimationFrame(frame); }
  }

  function onClick(e) {
    if (!ctx || !nodes.length) return;
    var rect = cv.getBoundingClientRect();
    var sx = rect.width ? W / rect.width : 1;
    var sy = rect.height ? H / rect.height : 1;
    var mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
    var best = null, bestD = 1e9, i;
    for (i = 0; i < nodes.length; i++) {
      var nd = nodes[i], p = pos[nd.id];
      if (!p) continue;
      var d = Math.sqrt((p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my));
      var rr = nodeR(nd) + 12;
      if (d < rr && d < bestD) { bestD = d; best = nd.id; }
    }
    selId = best;
    if (best && onSelect) onSelect(best);
  }

  return {
    init: function (canvasId, opts) {
      if (inited) return;
      inited = true;
      cv = document.getElementById(canvasId);
      if (!cv) return;
      ctx = cv.getContext('2d');
      if (!ctx) return;
      onSelect = (opts && opts.onSelect) || null;
      fit(); layout();
      cv.addEventListener('click', onClick);
      if (opts && opts.playBtn) {
        var pb = document.getElementById(opts.playBtn);
        if (pb) pb.addEventListener('click', function () {
          running = !running;
          pb.textContent = running ? '⏸ Pause' : '▶ Spin';
        });
      }
      if (opts && opts.speedInput) {
        var sp = document.getElementById(opts.speedInput);
        if (sp) sp.addEventListener('input', function (e) {
          speed = parseFloat(e.target.value) / 100;
        });
      }
      startLoop(); // v64.1: was a bare requestAnimationFrame(frame)
    },
    setData: function (ns, es) { nodes = ns || []; edges = es || []; selId = null; layout(); },
    onShow: function () { fit(); layout(); startLoop(); }, // v64.1: restart the loop when shown
    onResize: function () { fit(); layout(); }
  };
})();
