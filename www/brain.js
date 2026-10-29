'use strict';
/* Neural Lab v2 — Brain tab: live concentric-ring view of the MLP.
 * Neurons are dots on slowly revolving rings (one ring per layer).
 * Node brightness/color comes from a LIVE forward pass on the selected
 * sample; edge thickness/color comes from the LIVE weight matrices.
 * Rotation is presentation only — every activation and weight is real.
 */
window.NL_BRAIN = (function () {
  var $ = function (id) { return document.getElementById(id); };
  var cv = null, ctx = null;
  var P = null; // provider: {model,nSamples,sampleX,sampleLabel,predictX,featureName,onNodeSelect}
  var Wpx = 700, Hpx = 460;

  var running = true;                 // rotation pause/play
  var orbitHold = false;              // v36: node tap freezes the orbit until dismissed
  var speed = 0.6;                    // slider 0..200 -> /100
  var showLabels = true, showEdges = true;

  var rots = [];                      // per-ring rotation angle (presentation)
  var actsCache = null;               // last live forward-pass activations
  var wMaxCache = [];                 // per-layer max |weight| for edge scaling
  var actsDirty = true;
  var pulse = 0, lastAcc = null;      // output-node glow pulse on accuracy gain
  var selMode = 'sample', selIdx = 0; // sample selector state
  var selNode = null;                 // clicked node {l,i}
  var inited = false;

  function setProvider(p) { P = p; }
  function model() { return P ? P.model() : null; }

  function ensureCanvas() {
    cv = $('brain-canvas');
    if (!cv) return false;
    ctx = cv.getContext('2d');
    return !!ctx;
  }

  // fit the drawing buffer to the CSS box so the canvas fills the viewport
  function fit() {
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (w > 40 && h > 40 && (Math.abs(cv.width - w) > 2 || Math.abs(cv.height - h) > 2)) {
      Wpx = Math.round(w); Hpx = Math.round(h);
      cv.width = Wpx; cv.height = Hpx;
      actsDirty = true;
    }
  }

  function layout(m) {
    var nRings = m.sizes.length;
    var maxR = Math.min(Wpx, Hpx) / 2 - 48;
    var minR = 36;
    return {
      cx: Wpx / 2, cy: Hpx / 2 - 6, minR: minR,
      step: nRings > 1 ? (maxR - minR) / (nRings - 1) : 0
    };
  }

  function nodeXY(L, m, l, i) {
    var n = m.sizes[l];
    var r = L.minR + l * L.step;
    var a = (rots[l] || 0) + i * (Math.PI * 2 / n);
    return { x: L.cx + r * Math.cos(a), y: L.cy + r * Math.sin(a) };
  }

  function nodeR(n) {
    if (n > 96) return 2.5;
    if (n > 32) return 4;
    return 6;
  }

  function currentX() {
    if (selMode === 'predict' && P.predictX) {
      var px = P.predictX();
      if (px) return px;
    }
    var n = P.nSamples();
    if (n > 0) return P.sampleX(Math.min(selIdx, n - 1));
    return null;
  }

  function refreshActs() {
    var m = model();
    actsCache = null;
    wMaxCache = [];
    if (!m) { actsDirty = false; return; }
    var x = currentX();
    if (!x) { actsDirty = false; return; }
    try { actsCache = m.forward(x).acts; } catch (e) { actsCache = null; }
    // CNN models have no dense .W — they just get nodes, no weight edges
    wMaxCache = (m.W || []).map(function (Wl) {
      var mx = 1e-9;
      for (var i = 0; i < Wl.length; i++)
        for (var j = 0; j < Wl[i].length; j++) {
          var a = Math.abs(Wl[i][j]);
          if (a > mx) mx = a;
        }
      return mx;
    });
    actsDirty = false;
  }

  // cyan = positive, magenta = negative (matches edge coloring)
  function actFill(v, alpha) {
    var pos = v >= 0;
    var c = pos ? '64,224,255' : '255,92,220';
    return 'rgba(' + c + ',' + alpha.toFixed(3) + ')';
  }

  function sampleDesc() {
    var m = model();
    if (!m) return 'no model';
    if (selMode === 'predict') {
      var px = (P.predictX && P.predictX()) ? true : false;
      return px ? 'predict-panel inputs' : 'predict inputs incomplete — showing sample';
    }
    var n = P.nSamples();
    if (!n) return 'no samples';
    var i = Math.min(selIdx, n - 1);
    return 'sample ' + (i + 1) + '/' + n + (P.sampleLabel ? ' → ' + P.sampleLabel(i) : '');
  }

  /* ── drawing ── */
  function drawEdges(m, L) {
    if (!m.W || m.isTransformer) return; // CNN: no dense weights; transformer: attention isn't edges
    var total = 0;
    for (var l = 0; l < m.W.length; l++) total += m.sizes[l] * m.sizes[l + 1];
    var stride = Math.max(1, Math.ceil(total / 5000));
    var k = 0;
    for (var l2 = 0; l2 < m.W.length; l2++) {
      var Wl = m.W[l2], wm = wMaxCache[l2] || 1, nA = m.sizes[l2];
      for (var j = 0; j < Wl.length; j++) {
        for (var i = 0; i < nA; i++) {
          if ((k++ % stride) !== 0) continue;
          var w = Wl[j][i];
          var mag = Math.min(1, Math.abs(w) / wm);
          var p1 = nodeXY(L, m, l2, i), p2 = nodeXY(L, m, l2 + 1, j);
          ctx.strokeStyle = w >= 0
            ? 'rgba(64,224,255,' + (0.04 + 0.30 * mag).toFixed(3) + ')'
            : 'rgba(255,92,220,' + (0.04 + 0.30 * mag).toFixed(3) + ')';
          ctx.lineWidth = 0.6 + 2.2 * mag;
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
      }
    }
  }

  function drawNodes(m, L) {
    var nLayers = m.sizes.length;
    for (var l = 0; l < nLayers; l++) {
      var n = m.sizes[l], r = nodeR(n);
      var acts = actsCache && actsCache[l];
      var isOut = (l === nLayers - 1);
      // faint orbit guide
      ctx.strokeStyle = 'rgba(90,90,110,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(L.cx, L.cy, L.minR + l * L.step, 0, 6.2832); ctx.stroke();
      for (var i = 0; i < n; i++) {
        var p = nodeXY(L, m, l, i);
        var v = acts ? acts[i] : 0;
        var inten = Math.min(1, Math.abs(v) * 1.4);
        if (isOut && pulse > 0.02) {
          ctx.fillStyle = 'rgba(124,92,255,' + (0.28 * pulse).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 12 * pulse, 0, 6.2832); ctx.fill();
        }
        ctx.fillStyle = actFill(v, 0.22 + 0.78 * inten);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
        ctx.fillStyle = actFill(v, Math.min(1, 0.35 + 0.65 * inten));
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.45, 0, 6.2832); ctx.fill();
        if (selNode && selNode.l === l && selNode.i === i) {
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, 6.2832); ctx.stroke();
        }
      }
    }
  }

  function drawLabels(m, L) {
    ctx.fillStyle = '#9a9aa8';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    for (var l = 0; l < m.sizes.length; l++) {
      var name = l === 0 ? 'in' : (l === m.sizes.length - 1 ? 'out' : 'h' + l);
      ctx.fillText(name + '·' + m.sizes[l], L.cx, L.cy - (L.minR + l * L.step) - 8);
    }
    ctx.textAlign = 'left';
  }

  function draw() {
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, Wpx, Hpx);
    var m = model();
    if (!m) {
      ctx.fillStyle = '#5c5c6a'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No model yet — build one on the Train tab.', Wpx / 2, Hpx / 2);
      ctx.textAlign = 'left';
      return;
    }
    var L = layout(m);
    if (showEdges) drawEdges(m, L);
    drawNodes(m, L);
    if (showLabels) drawLabels(m, L);
    ctx.fillStyle = '#5c5c6a'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(sampleDesc(), 10, Hpx - 10);
    ctx.textAlign = 'right';
    ctx.fillText(m.sizes.join('-'), Wpx - 10, 18);
    ctx.textAlign = 'left';
  }

  var lastT = 0, lastDrawn = -1000, rafOn = false;
  // v64.1 "Smooth Spin": the loop is no longer immortal. frame() schedules the
  // next frame ONLY while the Brain panel is active and the rings view shows.
  // Leaving the tab (or switching to dag/attn) kills the loop outright;
  // startLoop() restarts it (guarded — never double-schedules). Draws are
  // capped at 30fps: frames arriving <33ms after the last draw skip the draw
  // but keep the loop alive, halving CPU + GC churn on 90Hz displays.
  function frame(t) {
    var panel = $('panel-brain');
    if (!panel || !panel.classList.contains('active')) { if (dagTimer) dagStop(); rafOn = false; return; }
    if (brainView !== 'rings') { rafOn = false; return; } // dag/attn views are static DOM — no per-frame canvas work
    rafOn = true;
    if (t - lastDrawn < 33) { requestAnimationFrame(frame); return; } // 30fps cap
    lastDrawn = t;
    requestAnimationFrame(frame);
    if (!ctx && !ensureCanvas()) return;
    var dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0.016;
    lastT = t;
    var m = model();
    if (running && m && !orbitHold) {
      for (var l = 0; l < m.sizes.length; l++) {
        rots[l] = (rots[l] || 0) + dt * speed * (0.25 + 0.12 * l) * (l % 2 ? -1 : 1);
      }
      pulse = pulse > 0.02 ? pulse * Math.pow(0.05, dt) : 0;
    }
    if (actsDirty) refreshActs();
    draw();
  }
  function startLoop() { // v64.1: guarded starter — schedules exactly one loop
    if (!rafOn) { rafOn = true; lastDrawn = -1000; requestAnimationFrame(frame); }
  }

  /* ── node picking ── */
  function nodeInfo(m, l, i) {
    var acts = actsCache && actsCache[l];
    var info = {
      layer: l, idx: i,
      ring: l === 0 ? 'input' : (l === m.sizes.length - 1 ? 'output' : 'hidden'),
      activation: acts ? acts[i] : null,
      feature: (l === 0 && P.featureName) ? P.featureName(i) : null,
      bias: (l > 0 && m.b) ? m.b[l - 1][i] : null,
      incoming: []
    };
    if (l > 0 && m.W) {
      var row = m.W[l - 1][i], arr = [];
      for (var j = 0; j < row.length; j++) arr.push({ from: j, w: row[j] });
      arr.sort(function (a, b) { return Math.abs(b.w) - Math.abs(a.w); });
      info.incoming = arr.slice(0, 5);
    }
    return info;
  }

  function onClick(e) {
    var m = model();
    if (!m || !ctx) return;
    var rect = cv.getBoundingClientRect();
    var sx = rect.width ? Wpx / rect.width : 1;
    var sy = rect.height ? Hpx / rect.height : 1;
    var mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
    var L = layout(m);
    var best = null, bestD = 1e9;
    for (var l = 0; l < m.sizes.length; l++) {
      var n = m.sizes[l], rr = Math.max(nodeR(n) + 7, 24); // v36: ≥48px touch diameter
      for (var i = 0; i < n; i++) {
        var p = nodeXY(L, m, l, i);
        var d = Math.sqrt((p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my));
        if (d < rr && d < bestD) { bestD = d; best = { l: l, i: i }; }
      }
    }
    selNode = best;
    orbitHold = !!best; // v36: touching a node freezes the orbit; empty space resumes it
    if (!best) { var pr = $('props'); if (pr) pr.classList.remove('open'); }
    else if (P.onNodeSelect) P.onNodeSelect(nodeInfo(m, best.l, best.i));
  }

  /* ══ v26 — Computation Graph mode (autograd DAG) ════════════════
   * Toggle at the top of the Brain tab flips between the revolving rings
   * and a DAG of the current nanograd.js tape: each node shows its forward
   * value v (top half) and accumulated gradient dL/dv (bottom half).
   * "Backprop" walks the tape in reverse topological order, highlighting
   * each node as its gradient is (re)computed — the sweep .backward()
   * performs. Read-only: never touches model weights or checkpoints.
   * Zoom/pan is viewBox-based inside a fixed-height box (touch-action:none)
   * so it can't fight the page scroll or the Android nav bars. */
  var dagMode = false; // (legacy alias — the view state now lives in brainView)
  var brainView = 'rings'; // 'rings' | 'dag' | 'attn'  (v28: attn = attention heatmap)
  var dagNodes = null;      // laid-out graph snapshot
  var dagTimer = null;       // backprop playback interval
  var dagPlayIdx = -1;
  var dagVB = null;          // viewBox {x,y,w,h}
  var dagBaseVB = null;

  function dagGraph() {
    if (P && P.nanoGraph) { try { return P.nanoGraph(); } catch (e) { return null; } }
    return null;
  }

  function dagLayout(g) {
    // depth = longest path from a source; x by depth, y stacked per column
    var byId = {}, i, n;
    for (i = 0; i < g.length; i++) byId[g[i].id] = g[i];
    var depth = {};
    function dep(id) {
      if (depth[id] !== undefined) return depth[id];
      var nd = byId[id], d = 0, k;
      for (k = 0; k < nd.parents.length; k++) d = Math.max(d, dep(nd.parents[k]) + 1);
      depth[id] = d;
      return d;
    }
    for (i = 0; i < g.length; i++) dep(g[i].id);
    var cols = {};
    for (i = 0; i < g.length; i++) {
      var d = depth[g[i].id];
      (cols[d] = cols[d] || []).push(g[i]);
    }
    var NW = 138, NH = 56, CW = 168, CH = 76, maxD = 0;
    for (var k in cols) maxD = Math.max(maxD, +k);
    var nodes = [], r = 0;
    for (var dd = 0; dd <= maxD; dd++) {
      var col = cols[dd] || [];
      for (var j = 0; j < col.length; j++) {
        nodes.push({ n: col[j], x: 24 + dd * CW, y: 20 + j * CH, w: NW, h: NH, order: r++ });
      }
    }
    var W = 24 + maxD * CW + NW + 24;
    var maxCol = 0;
    for (var k2 in cols) maxCol = Math.max(maxCol, cols[k2].length);
    var H = 20 + maxCol * CH + 20;
    return { nodes: nodes, W: W, H: H, byId: byId };
  }

  function dagFmt(v) {
    if (!isFinite(v)) return String(v);
    var a = Math.abs(v);
    return (v < 0 ? '-' : '') + (a >= 100 ? a.toFixed(1) : a >= 10 ? a.toFixed(2) : a.toFixed(3));
  }

  function dagEl(tag, attrs, parent) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function dagStop() {
    if (dagTimer) { clearInterval(dagTimer); dagTimer = null; }
    dagPlayIdx = -1;
    var b = $('dag-play');
    if (b) b.textContent = '▶ Backprop';
    if (dagNodes) dagHighlight(-1);
  }

  function dagHighlight(idx) {
    if (!dagNodes) return;
    for (var i = 0; i < dagNodes.nodes.length; i++) {
      var r = dagNodes.nodes[i].rect;
      if (!r) continue;
      if (i === idx) { r.setAttribute('stroke', '#ffd166'); r.setAttribute('stroke-width', '3'); }
      else { r.setAttribute('stroke', '#3a3a4e'); r.setAttribute('stroke-width', '1.5'); }
    }
  }

  function dagRender() {
    var svg = $('brain-dag'), cap = $('dag-cap');
    if (!svg) return;
    dagStop();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var g = dagGraph();
    if (!g || !g.length) {
      if (cap) cap.textContent = 'nanograd.js not loaded — no tape to show.';
      dagNodes = null;
      return;
    }
    dagNodes = dagLayout(g);
    var W = dagNodes.W, H = dagNodes.H;
    dagBaseVB = { x: 0, y: 0, w: W, h: H };
    dagVB = { x: 0, y: 0, w: W, h: H };
    dagApplyVB();
    // edges first (under nodes)
    var i, j;
    var id2xy = {};
    for (i = 0; i < dagNodes.nodes.length; i++) {
      var nd = dagNodes.nodes[i];
      id2xy[nd.n.id] = nd;
    }
    for (i = 0; i < dagNodes.nodes.length; i++) {
      var c = dagNodes.nodes[i];
      for (j = 0; j < c.n.parents.length; j++) {
        var p = id2xy[c.n.parents[j]];
        if (!p) continue;
        dagEl('line', {
          x1: p.x + p.w, y1: p.y + p.h / 2, x2: c.x, y2: c.y + c.h / 2,
          stroke: '#2e2e40', 'stroke-width': 1.4
        }, svg);
      }
    }
    // nodes: label + v on top half, grad on bottom half
    for (i = 0; i < dagNodes.nodes.length; i++) {
      var dn = dagNodes.nodes[i], nn = dn.n;
      var grp = dagEl('g', {}, svg);
      var rect = dagEl('rect', {
        x: dn.x, y: dn.y, width: dn.w, height: dn.h, rx: 9,
        fill: '#14141c', stroke: '#3a3a4e', 'stroke-width': 1.5
      }, grp);
      dn.rect = rect;
      var t1 = dagEl('text', { x: dn.x + 8, y: dn.y + 16, fill: '#cfcfdd', 'font-size': 11 }, grp);
      t1.textContent = nn.label + (nn.op && nn.op !== 'input' ? '  [' + nn.op + ']' : '');
      var tv = dagEl('text', {
        x: dn.x + 8, y: dn.y + 32, fill: nn.v >= 0 ? '#40e0ff' : '#ff5cdc',
        'font-size': 12, 'font-family': 'monospace'
      }, grp);
      tv.textContent = 'v=' + dagFmt(nn.v);
      dagEl('line', { x1: dn.x + 6, y1: dn.y + dn.h / 2 + 2, x2: dn.x + dn.w - 6, y2: dn.y + dn.h / 2 + 2, stroke: '#2a2a38', 'stroke-width': 1 }, grp);
      var tg = dagEl('text', {
        x: dn.x + 8, y: dn.y + dn.h - 8, fill: nn.grad >= 0 ? '#8be89b' : '#ff9d6b',
        'font-size': 11, 'font-family': 'monospace'
      }, grp);
      tg.textContent = '∂=' + dagFmt(nn.grad);
    }
    if (cap) cap.textContent = g.length + ' tape nodes · drag to pan · +/− to zoom · ▶ Backprop walks the sweep';
  }

  function dagApplyVB() {
    var svg = $('brain-dag');
    if (svg && dagVB) svg.setAttribute('viewBox', dagVB.x + ' ' + dagVB.y + ' ' + dagVB.w + ' ' + dagVB.h);
  }

  function dagZoom(f) {
    if (!dagVB || !dagBaseVB) return;
    var nw = Math.min(dagBaseVB.w * 3, Math.max(dagBaseVB.w / 6, dagVB.w * f));
    var cx = dagVB.x + dagVB.w / 2, cy = dagVB.y + dagVB.h / 2;
    var nh = nw * dagVB.h / dagVB.w;
    dagVB = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    dagApplyVB();
  }

  function dagPlay() {
    if (!dagNodes) return;
    if (dagTimer) { dagStop(); return; }
    var order = dagNodes.nodes.slice().sort(function (a, b) { return b.order - a.order; }); // reverse topo
    var k = 0, cap = $('dag-cap'), total = order.length;
    var b = $('dag-play');
    if (b) b.textContent = '■ Stop';
    dagTimer = setInterval(function () {
      if (k >= total) { dagStop(); if (cap) cap.textContent = 'sweep complete — every node now holds dL/dv'; return; }
      var idx = dagNodes.nodes.indexOf(order[k]);
      dagHighlight(idx);
      var nn = order[k].n;
      if (cap) cap.textContent = 'backprop ' + (k + 1) + '/' + total + ': ' + nn.label +
        '  [op ' + (nn.op || 'input') + ']  v=' + dagFmt(nn.v) + '  ∂=' + dagFmt(nn.grad);
      k++;
    }, 450);
  }

  function setView(v) {
    // v28: three views — rings (MLP/CNN), dag (nanograd tape), attn (transformer heatmap)
    brainView = v;
    dagStop();
    var c = $('brain-canvas'), w = $('brain-dag-wrap'), a = $('brain-attn-wrap'), t = $('brain-mode');
    if (c) c.style.display = v === 'rings' ? '' : 'none';
    if (w) w.hidden = v !== 'dag';
    if (a) a.hidden = v !== 'attn';
    if (t) t.textContent = v === 'rings' ? '📊 Computation Graph' : v === 'dag' ? '🔥 Attention Heatmap' : '🌀 Revolving Network';
    if (v === 'dag') dagRender();
    if (v === 'attn') attnRender();
    if (v === 'rings') startLoop(); // v64.1: the loop dies when leaving rings — restart it
  }
  // (v26 name kept for the button wiring below)
  function setDagMode(on) { setView(on ? 'dag' : 'rings'); }

  function wireDag() {
    var t = $('brain-mode');
    if (t) t.addEventListener('click', function () {
      // v28: cycle rings → dag → attention heatmap → rings
      setView(brainView === 'rings' ? 'dag' : brainView === 'dag' ? 'attn' : 'rings');
    });
    var p = $('dag-play');
    if (p) p.addEventListener('click', dagPlay);
    var zi = $('dag-zin'), zo = $('dag-zout'), zr = $('dag-zreset');
    if (zi) zi.addEventListener('click', function () { dagZoom(0.8); });
    if (zo) zo.addEventListener('click', function () { dagZoom(1.25); });
    if (zr) zr.addEventListener('click', function () {
      if (dagBaseVB) { dagVB = { x: dagBaseVB.x, y: dagBaseVB.y, w: dagBaseVB.w, h: dagBaseVB.h }; dagApplyVB(); }
    });
    var svg = $('brain-dag');
    if (svg) {
      var drag = null;
      svg.addEventListener('pointerdown', function (e) {
        drag = { x: e.clientX, y: e.clientY, vx: dagVB.x, vy: dagVB.y };
        try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      });
      svg.addEventListener('pointermove', function (e) {
        if (!drag || !dagVB) return;
        var r = svg.getBoundingClientRect();
        var sx = dagVB.w / r.width, sy = dagVB.h / r.height;
        dagVB.x = drag.vx - (e.clientX - drag.x) * sx;
        dagVB.y = drag.vy - (e.clientY - drag.y) * sy;
        dagApplyVB();
      });
      var end = function () { drag = null; };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
    }
  }

  /* ══ v28 — Attention Heatmap mode ═══════════════════════════════════
   * When the Train tab builds the MicroFormer transformer, the Brain tab
   * opens this view: a live T×T causal attention heatmap (rows = query
   * positions, cols = key positions). Masked future cells (upper triangle,
   * −Infinity pre-softmax) render strictly inactive/zeroed. Tapping a cell
   * shows its query–key dot-product score and the query row's post-softmax
   * weight distribution. Cells are 52px — comfortably tappable on a phone;
   * wider matrices scroll horizontally inside .attn-scroll so the layout
   * stays phone-width safe. */
  var attnIds = [0, 1, 2];
  var attnSel = null;       // {i, j} tapped cell
  var attnDetail = null;    // last computed {ids, labels, scores, weights, ...}
  var ATTN_CELL = 52, ATTN_LAB = 52;

  function attnModel() {
    if (P && P.attnModel) { try { return P.attnModel(); } catch (e) { return null; } }
    return null;
  }

  function attnIdsFromSample() {
    attnIds = [0, 1, 2];
    var m = attnModel();
    if (!m || !P || !P.nSamples || !P.nSamples()) return;
    try {
      var x = P.sampleX(Math.min(selIdx, P.nSamples() - 1));
      if (x && x.length) {
        attnIds = x.slice(0, 8).map(function (v) { return Math.max(0, Math.min(7, Math.round(v))); });
      }
    } catch (e) { /* keep default */ }
  }

  function attnRender() {
    var cvA = $('brain-attn'), cap = $('attn-cap'), read = $('attn-read');
    if (!cvA) return;
    var m = attnModel();
    var g = cvA.getContext('2d');
    if (!m) {
      cvA.style.width = '100%'; cvA.style.height = '110px';
      cvA.width = 600; cvA.height = 220;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0d0d12'; g.fillRect(0, 0, 600, 220);
      g.fillStyle = '#5c5c6a'; g.font = '13px sans-serif'; g.textAlign = 'center';
      g.fillText('No transformer model — build one on the Train tab:', 300, 96);
      g.fillText('Dataset → Sequences (attention), Architecture → Transformer.', 300, 120);
      g.textAlign = 'left';
      if (cap) cap.textContent = 'the attention heatmap needs the MicroFormer model';
      if (read) read.innerHTML = '';
      attnDetail = null;
      return;
    }
    var det = m.attentionDetail(attnIds);
    attnDetail = det;
    var T = det.ids.length;
    var W = ATTN_LAB + T * ATTN_CELL, H = ATTN_LAB + T * ATTN_CELL;
    var DPR = 2;
    cvA.width = W * DPR; cvA.height = H * DPR;
    cvA.style.width = W + 'px'; cvA.style.height = H + 'px';
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = '#0d0d12'; g.fillRect(0, 0, W, H);
    var i, j;
    g.fillStyle = '#9a9aa8'; g.font = '13px sans-serif'; g.textAlign = 'center';
    for (j = 0; j < T; j++) g.fillText(det.labels[j], ATTN_LAB + j * ATTN_CELL + ATTN_CELL / 2, ATTN_LAB - 14);
    g.textAlign = 'right';
    for (i = 0; i < T; i++) g.fillText(det.labels[i], ATTN_LAB - 12, ATTN_LAB + i * ATTN_CELL + ATTN_CELL / 2 + 5);
    g.textAlign = 'left'; g.font = '11px sans-serif';
    for (i = 0; i < T; i++) {
      for (j = 0; j < T; j++) {
        var x0 = ATTN_LAB + j * ATTN_CELL, y0 = ATTN_LAB + i * ATTN_CELL;
        var masked = j > i;
        var wgt = det.weights[i][j];
        g.fillStyle = masked ? '#08080c' : 'rgba(64,224,255,' + (0.05 + 0.95 * wgt).toFixed(3) + ')';
        g.fillRect(x0 + 1, y0 + 1, ATTN_CELL - 2, ATTN_CELL - 2);
        if (attnSel && attnSel.i === i && attnSel.j === j) {
          g.strokeStyle = '#ffd166'; g.lineWidth = 3;
          g.strokeRect(x0 + 2, y0 + 2, ATTN_CELL - 4, ATTN_CELL - 4);
        }
        g.textAlign = 'center';
        if (!masked && wgt >= 0.01) {
          g.fillStyle = wgt > 0.5 ? '#06121a' : '#cfcfdd';
          g.fillText(wgt.toFixed(2), x0 + ATTN_CELL / 2, y0 + ATTN_CELL / 2 + 4);
        } else if (masked) {
          g.fillStyle = '#2a2a38';
          g.fillText('–', x0 + ATTN_CELL / 2, y0 + ATTN_CELL / 2 + 4);
        }
        g.textAlign = 'left';
      }
    }
    if (cap) cap.textContent = T + '×' + T + ' causal attention — rows query, cols key · ' +
      'upper triangle = −∞ pre-softmax (strictly zero) · tap a cell for its q·k score';
    attnReadout();
  }

  function attnReadout() {
    var read = $('attn-read');
    if (!read) return;
    if (!attnDetail || !attnSel) {
      read.innerHTML = 'tap a cell to inspect its query–key score and weight distribution';
      return;
    }
    var d = attnDetail, i = attnSel.i, j = attnSel.j;
    var sc = d.scores[i][j], wgt = d.weights[i][j];
    var h = 'q=<b>' + d.labels[i] + '</b> (pos ' + i + ') → k=<b>' + d.labels[j] + '</b> (pos ' + j + ')<br>' +
      'q·k / √d = <b>' + (sc === -Infinity ? '−∞ (masked — future token)' : sc.toFixed(4)) + '</b>' +
      ' · post-softmax weight = <b>' + wgt.toFixed(4) + '</b><br>' +
      'weight distribution of query ' + d.labels[i] + ':<br>';
    for (var k = 0; k < d.ids.length; k++) {
      var v = d.weights[i][k];
      h += d.labels[k] + ' ' + new Array(Math.round(v * 14) + 1).join('█') + ' ' + v.toFixed(3) + '<br>';
    }
    read.innerHTML = h;
  }

  function attnTap(e) {
    var cvA = $('brain-attn');
    if (!cvA || !attnDetail) return;
    var T = attnDetail.ids.length;
    var rect = cvA.getBoundingClientRect();
    var full = ATTN_LAB + T * ATTN_CELL;
    var s = rect.width ? full / rect.width : 1;
    var mx = (e.clientX - rect.left) * s, my = (e.clientY - rect.top) * s;
    var j = Math.floor((mx - ATTN_LAB) / ATTN_CELL), i = Math.floor((my - ATTN_LAB) / ATTN_CELL);
    if (i < 0 || i >= T || j < 0 || j >= T) return;
    attnSel = { i: i, j: j };
    attnRender();
  }

  function attnApplySeq() {
    var inp = $('attn-seq');
    var s = inp ? String(inp.value).toUpperCase().replace(/[^A-H]/g, '') : '';
    if (!s.length || s.length > 8) {
      if ($('attn-cap')) $('attn-cap').textContent = 'type 1–8 tokens from A–H (e.g. ABCD), then Apply';
      return;
    }
    attnIds = s.split('').map(function (ch) { return 'ABCDEFGH'.indexOf(ch); });
    attnSel = null;
    attnRender();
  }

  function wireAttn() {
    var cvA = $('brain-attn');
    if (cvA) cvA.addEventListener('click', attnTap);
    var ap = $('attn-apply');
    if (ap) ap.addEventListener('click', attnApplySeq);
    var si = $('attn-seq');
    if (si) si.addEventListener('keydown', function (e) { if (e.key === 'Enter') attnApplySeq(); });
  }

  /* ── controls ── */
  function syncSampleUI() {
    var s = $('brain-sample');
    if (s) s.value = selMode === 'predict' ? 'predict' : 's' + Math.min(selIdx, Math.max(0, P.nSamples() - 1));
  }

  function refreshSampleList() {
    var s = $('brain-sample');
    if (!s || !P) return;
    s.innerHTML = '';
    var o0 = document.createElement('option');
    o0.value = 'predict'; o0.textContent = '⎇ Predict-panel inputs';
    s.appendChild(o0);
    var n = P.nSamples(), cap = Math.min(n, 100);
    for (var i = 0; i < cap; i++) {
      var o = document.createElement('option');
      o.value = 's' + i;
      o.textContent = 'sample ' + (i + 1) + (P.sampleLabel ? ' → ' + P.sampleLabel(i) : '');
      s.appendChild(o);
    }
    if (n > cap) {
      var om = document.createElement('option');
      om.value = 's' + (n - 1);
      om.textContent = 'sample ' + n + ' (last)';
      s.appendChild(om);
    }
    syncSampleUI();
  }

  function stepSample(d) {
    var n = P ? P.nSamples() : 0;
    if (selMode === 'predict' || n === 0) { selMode = 'sample'; selIdx = 0; }
    else selIdx = ((selIdx + d) % n + n) % n;
    selNode = null; actsDirty = true; syncSampleUI();
  }

  function wireControls() {
    $('brain-play').addEventListener('click', function () {
      running = !running;
      $('brain-play').textContent = running ? '⏸ Pause' : '▶ Spin';
    });
    $('brain-speed').addEventListener('input', function (e) {
      speed = parseFloat(e.target.value) / 100;
    });
    $('brain-labels').addEventListener('change', function (e) { showLabels = e.target.checked; });
    $('brain-edges').addEventListener('change', function (e) { showEdges = e.target.checked; });
    $('brain-sample').addEventListener('change', function (e) {
      var v = e.target.value;
      if (v === 'predict') selMode = 'predict';
      else { selMode = 'sample'; selIdx = parseInt(v.slice(1), 10) || 0; }
      selNode = null; actsDirty = true; syncSampleUI();
    });
    $('brain-prev').addEventListener('click', function () { stepSample(-1); });
    $('brain-next').addEventListener('click', function () { stepSample(1); });
  }

  /* ── public API ── */
  return {
    setProvider: setProvider,
    init: function () {
      if (inited) return;
      inited = true;
      if (!ensureCanvas()) return;
      fit();
      // v36: pointer-based tap (touch + mouse), 12px slop / 500ms — reliable on touch WebViews
      var tapPt = null;
      cv.addEventListener('pointerdown', function (e) { tapPt = { x: e.clientX, y: e.clientY, t: Date.now() }; });
      cv.addEventListener('pointerup', function (e) {
        if (!tapPt) return;
        var dx = e.clientX - tapPt.x, dy = e.clientY - tapPt.y, dt = Date.now() - tapPt.t;
        tapPt = null;
        if (dx * dx + dy * dy <= 144 && dt <= 500) onClick(e);
      });
      cv.addEventListener('pointercancel', function () { tapPt = null; });
      wireControls();
      wireDag();
      wireAttn(); // v28
      refreshSampleList();
      startLoop(); // v64.1: was a bare requestAnimationFrame(frame)
    },
    onShow: function () { fit(); actsDirty = true; refreshSampleList(); if (brainView === 'dag') dagRender(); else if (brainView === 'attn') attnRender(); else if (brainView === 'rings') startLoop(); },
    onResize: function () { fit(); },
    onModelChanged: function () {
      rots = []; selNode = null; orbitHold = false; actsDirty = true; refreshSampleList();
      // v28: a fresh transformer opens straight into its attention heatmap
      var m = model();
      if (m && m.isTransformer) { attnIdsFromSample(); attnSel = null; setView('attn'); }
      else if (brainView === 'attn') setView('rings');
    },
    onDatasetChanged: function () { selIdx = 0; selMode = 'sample'; selNode = null; orbitHold = false; actsDirty = true; refreshSampleList(); },
    onEpoch: function () {
      actsDirty = true;
      if (brainView === 'attn') attnRender(); // live heatmap while training
    },
    onPredict: function () { selMode = 'predict'; selNode = null; orbitHold = false; actsDirty = true; syncSampleUI(); },
    clearNodeSel: function () { selNode = null; orbitHold = false; }, // v36: drawer close / back button
    onAccuracy: function (acc) {
      if (lastAcc !== null && acc > lastAcc + 1e-9) pulse = 1;
      lastAcc = acc;
    }
  };
})();
