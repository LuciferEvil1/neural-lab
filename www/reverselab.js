'use strict';
/* Neural Lab v29 "ReverseLab" — RE workbench UI.
 * Disassembler front-end (arm7.js) + control-flow graph canvas
 * (zoom/pan/tap, Brain-DAG visual language) + ML demos wiring.
 */
window.NL_RE = (function () {
  function $(id) { return document.getElementById(id); }
  var A = null; // window.NL_ARM
  var lastListing = [], lastCFG = null, lastMode = 'arm';
  var selBlock = -1;

  function api() { return window.NL_RE_API || {}; }
  function log(m, c) { var a = api(); if (a.log) a.log(m, c); }

  /* ── disassembly ─────────────────────────────────────────── */
  function cleanHex(s) { return String(s || '').replace(/[^0-9a-fA-F]/g, ''); }
  function parseBase(s) {
    var v = parseInt(String(s || '').replace(/[^0-9a-fA-Fx]/gi, ''), 16);
    return isFinite(v) ? (v >>> 0) : 0x08000000;
  }
  function disassemble() {
    if (!A) { log('re: arm7.js failed to load', 'err'); return; }
    var hex = cleanHex($('re-hex').value);
    var step = lastMode === 'thumb' ? 4 : 8;
    if (hex.length < step) { log('re: paste some hex first (or tap "Load function demo")', 'warn'); return; }
    var base = parseBase($('re-base').value);
    lastListing = A.disasmStream(hex, base, lastMode);
    lastCFG = A.buildCFG(lastListing, lastMode);
    selBlock = -1;
    renderListing();
    drawCFG();
    log('re: disassembled ' + lastListing.length + ' ' + lastMode + ' instructions @ ' +
        A.hex(base, 8) + ' → ' + lastCFG.blocks.length + ' basic blocks', 'ok');
  }

  var CLS_COLOR = { dp: '#40e0ff', ls: '#ffd040', br: '#ff6b9d', mul: '#b48cff', misc: '#7dff9a', unk: '#5c5c6a' };
  function renderListing() {
    var el = $('re-listing');
    el.innerHTML = '';
    lastListing.forEach(function (ins) {
      var d = document.createElement('div');
      d.className = 're-ins';
      var col = CLS_COLOR[ins.cls] || '#9a9aa8';
      d.innerHTML = '<span class="re-addr">' + A.hex(ins.addr, 8) + '</span> ' +
        '<span class="re-bytes">' + ins.bytes + '</span> ' +
        '<span class="re-text" style="color:' + col + '">' + escHtml(ins.text) + '</span>';
      el.appendChild(d);
    });
  }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  var DEMO_ARM = 'E92D4FF0 E3A00001 E0812000 E3510005 1A000000 E3A0200A E8BD8FF0';
  var DEMO_THUMB = 'B5F0 2001 2105 2A05 D101 220A BDF0';
  function loadDemo() {
    $('re-hex').value = lastMode === 'thumb' ? DEMO_THUMB : DEMO_ARM;
    $('re-base').value = '08000000';
    disassemble();
    log('re: demo loaded — a tiny compiled function (prologue, loop-branch, epilogue). ' +
        'Branch instructions link their targets in the graph below.', 'dim');
  }

  /* ── control-flow graph canvas (zoom / pan / tap) ─────────── */
  var cv = null, ctx = null, W = 600, H = 300;
  var zoom = 1, panX = 0, panY = 0, nodePos = {};
  function fitCanvas() {
    if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (w > 40 && h > 40 && (Math.abs(cv.width - w) > 2 || Math.abs(cv.height - h) > 2)) {
      W = Math.round(w); H = Math.round(h);
      cv.width = W; cv.height = H;
      layoutCFG();
    }
  }
  function layoutCFG() {
    nodePos = {};
    if (!lastCFG || !lastCFG.blocks.length) return;
    // depth = longest path from entry; rows stack blocks at same depth
    var n = lastCFG.blocks.length, depth = new Array(n).fill(0);
    var changed = true, guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      lastCFG.edges.forEach(function (e) {
        if (depth[e[1]] < depth[e[0]] + 1) { depth[e[1]] = depth[e[0]] + 1; changed = true; }
      });
    }
    var maxD = Math.max.apply(null, depth.concat([0]));
    var cols = {};
    for (var b = 0; b < n; b++) { (cols[depth[b]] = cols[depth[b]] || []).push(b); }
    var colW = 190, rowH = 64;
    for (var d = 0; d <= maxD; d++) {
      var arr = cols[d] || [];
      for (var r = 0; r < arr.length; r++) {
        nodePos[arr[r]] = { x: 90 + d * colW, y: 40 + r * rowH };
      }
    }
  }
  function drawCFG() {
    if (!cv) return;
    fitCanvas();
    ctx.fillStyle = '#0d0d12';
    ctx.fillRect(0, 0, W, H);
    if (!lastCFG || !lastCFG.blocks.length) {
      ctx.fillStyle = '#5c5c6a'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Disassemble something with branches to see its graph.', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    var e, a, b;
    // edges
    lastCFG.edges.forEach(function (ed) {
      a = nodePos[ed[0]]; b = nodePos[ed[1]];
      if (!a || !b) return;
      var jump = ed[2] === 'jump';
      ctx.strokeStyle = jump ? 'rgba(64,224,255,0.75)' : 'rgba(124,92,255,0.40)';
      ctx.lineWidth = jump ? 2 : 1.2;
      ctx.beginPath();
      if (a.x === b.x) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      else {
        var mx = (a.x + b.x) / 2;
        ctx.moveTo(a.x + 62, a.y);
        ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x - 62, b.y);
      }
      ctx.stroke();
      // arrowhead
      var hx = a.x === b.x ? b.x : b.x - 62, hy = b.y;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(hx, hy); ctx.lineTo(hx - 7, hy - 4); ctx.lineTo(hx - 7, hy + 4);
      ctx.fill();
    });
    // nodes
    lastCFG.blocks.forEach(function (blk, bi) {
      var p = nodePos[bi];
      if (!p) return;
      var w = 124, h = 40, x = p.x - w / 2, y = p.y - h / 2;
      var hasBr = blk.ins.some(function (ins) { return ins.cls === 'br'; });
      var g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 60);
      var base = hasBr ? '255,107,157' : '64,224,255';
      g.addColorStop(0, 'rgba(' + base + ',0.30)');
      g.addColorStop(1, 'rgba(' + base + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 14, y - 14, w + 28, h + 28);
      ctx.fillStyle = '#16161d';
      ctx.strokeStyle = selBlock === bi ? '#ffffff' : 'rgba(' + base + ',0.8)';
      ctx.lineWidth = selBlock === bi ? 2.5 : 1.5;
      roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8e8f0'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('block ' + bi, p.x, p.y - 4);
      ctx.fillStyle = '#9a9aa8'; ctx.font = '10px sans-serif';
      ctx.fillText(A.hex(blk.start, 8) + ' · ' + blk.ins.length + ' ins', p.x, p.y + 12);
    });
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5c5c6a'; ctx.font = '12px sans-serif';
    ctx.fillText(lastCFG.blocks.length + ' blocks · ' + lastCFG.edges.length + ' edges  (drag=pan · wheel=zoom · tap=inspect)',
      10, H - 10);
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function cfgTap(ev) {
    if (!lastCFG) return;
    var rect = cv.getBoundingClientRect();
    var sx = rect.width ? W / rect.width : 1, sy = rect.height ? H / rect.height : 1;
    var mx = ((ev.clientX - rect.left) * sx - panX) / zoom;
    var my = ((ev.clientY - rect.top) * sy - panY) / zoom;
    var best = -1, bestD = 1e9;
    lastCFG.blocks.forEach(function (blk, bi) {
      var p = nodePos[bi];
      if (!p) return;
      var d = Math.hypot(p.x - mx, p.y - my);
      if (d < 70 && d < bestD) { bestD = d; best = bi; }
    });
    selBlock = best;
    drawCFG();
    var info = $('re-cfginfo');
    if (best >= 0) {
      var blk = lastCFG.blocks[best];
      info.innerHTML = '<b>block ' + best + '</b> @ ' + A.hex(blk.start, 8) + '<br>' +
        blk.ins.map(function (ins) {
          return A.hex(ins.addr, 8) + '  ' + escHtml(ins.text);
        }).join('<br>');
    } else {
      info.textContent = 'Disassemble something with branches to see its graph.';
    }
  }

  /* ── ML: instruction classifier ──────────────────────────── */
  function trainClassifier() {
    var a = api();
    if (!a.loadInstrDataset) { log('re: train wiring not ready', 'err'); return; }
    a.loadInstrDataset();
    if (a.switchTab) a.switchTab('train');
    log('re: synthetic ARM dataset loaded — 2000 random instructions → 5 classes ' +
        '(dataproc / loadstore / branch / multiply / misc). Tap ▶ Train and watch it learn ' +
        'the bit-fields, the same way real RE tools learn instruction shapes.', 'ok');
  }

  /* ── ML: function-boundary detection demo ────────────────── */
  // Honest teaching demo: prologue-signature scan (how the pros bootstrap)
  // scored against ground truth, then the ML framing.
  function boundaryDemo() {
    if (!A) return;
    var rng = (function (s) {
      return function () {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        var t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })(2026);
    var PRO = [0xE92D4FF0, 0xE92D40F0, 0xE92D4070]; // STMDB sp!, {r4-r11,lr} family
    var EPI = 0xE8BD8FF0;                          // LDMIA sp!, {r4-r11,pc}
    var stream = [], truth = [];
    var i = 0;
    while (i < 48) {
      if (rng() < 0.28 && i + 6 < 48) {
        // plant a function: prologue + body + epilogue
        stream.push(PRO[(rng() * PRO.length) >>> 0]); truth.push(1); i++;
        var body = 2 + ((rng() * 3) >>> 0);
        for (var k = 0; k < body; k++) {
          stream.push((0xE0000000 | ((rng() * 0x1000000) >>> 0)) >>> 0); truth.push(0); i++;
        }
        stream.push(EPI); truth.push(0); i++;
      } else {
        stream.push((0xE0000000 | ((rng() * 0x1000000) >>> 0)) >>> 0); truth.push(0); i++;
      }
    }
    var tp = 0, fp = 0, fn = 0;
    for (var j = 0; j < stream.length; j++) {
      var isPro = PRO.indexOf(stream[j] >>> 0) >= 0;
      if (isPro && truth[j]) tp++;
      else if (isPro) fp++;
      else if (truth[j]) fn++;
    }
    var prec = tp + fp ? (100 * tp / (tp + fp)) : 0;
    var rec = tp + fn ? (100 * tp / (tp + fn)) : 0;
    log('re: function-boundary demo — 48-word stream, ' + truth.reduce(function (a, b) { return a + b; }, 0) +
        ' true function starts planted', 'dim');
    log('re: prologue-signature scan (STMDB sp!,{r4-…,lr} — the "push" every ARM function opens with):', 'dim');
    log('re:   precision ' + prec.toFixed(1) + '% · recall ' + rec.toFixed(1) + '%  (tp=' + tp + ' fp=' + fp + ' fn=' + fn + ')',
      prec > 90 && rec > 90 ? 'ok' : 'warn');
    log('re: this is how real tools bootstrap — signatures first, then a classifier (like the one ' +
        'on the Train tab) learns the fuzzy cases signatures miss: inlined prologues, Thumb, stripped binaries.', 'dim');
    // show the stream with markers in the listing pane
    lastListing = stream.map(function (w, k) {
      var d = A.disARM(w, 0x08000000 + k * 4);
      if (truth[k]) d.text = '▶ FUNC START — ' + d.text;
      return d;
    });
    lastCFG = null; selBlock = -1;
    renderListing();
    drawCFG();
  }

  /* ── console commands ────────────────────────────────────── */
  function cmdDisasm(argStr) {
    if (!A) { log('disasm: arm7.js failed to load', 'err'); return; }
    var hex = cleanHex(argStr);
    if (hex.length < 8) { log('disasm: give hex bytes, e.g. disasm E3A00001 E0812000', 'warn'); return; }
    var mode = hex.length % 8 === 0 ? 'arm' : 'thumb';
    lastMode = mode;
    lastListing = A.disasmStream(hex, 0x08000000, mode);
    lastCFG = A.buildCFG(lastListing, mode);
    selBlock = -1;
    lastListing.forEach(function (ins) {
      log(A.hex(ins.addr, 8) + '  ' + ins.bytes + '  ' + ins.text, ins.cls === 'br' ? 'ok' : 'dim');
    });
    log('disasm: ' + lastListing.length + ' ' + mode + ' instructions → ' +
        lastCFG.blocks.length + ' blocks (try: cfg)', 'ok');
  }
  function cmdCfg() {
    if (!lastCFG || !lastCFG.blocks.length) { log('cfg: disassemble something first (try: disasm E3A00001)', 'warn'); return; }
    lastCFG.blocks.forEach(function (blk, bi) {
      log('block ' + bi + ' @ ' + A.hex(blk.start, 8) + ' (' + blk.ins.length + ' ins)', 'dim');
    });
    lastCFG.edges.forEach(function (e) {
      log('  block ' + e[0] + ' ─' + (e[2] === 'jump' ? 'jump' : 'fall') + '─▶ block ' + e[1],
        e[2] === 'jump' ? 'ok' : 'dim');
    });
    var a = api();
    if (a.switchTab) { a.switchTab('re'); drawCFG(); }
  }

  /* ── init ────────────────────────────────────────────────── */
  function init() {
    A = window.NL_ARM;
    cv = $('re-cfg');
    if (cv) {
      ctx = cv.getContext('2d');
      wirePanZoom();
      cv.addEventListener('click', cfgTap);
    }
    var seg = $('re-modeseg');
    if (seg) Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(seg.querySelectorAll('button'), function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        lastMode = b.dataset.rmode;
      });
    });
    if ($('btn-re-disasm')) $('btn-re-disasm').onclick = disassemble;
    if ($('btn-re-demo')) $('btn-re-demo').onclick = loadDemo;
    if ($('btn-re-train')) $('btn-re-train').onclick = trainClassifier;
    if ($('btn-re-bound')) $('btn-re-bound').onclick = boundaryDemo;
    drawCFG();
  }
  function wirePanZoom() {
    var dragging = false, lx = 0, ly = 0, pinchD = 0;
    cv.addEventListener('pointerdown', function (e) { dragging = true; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      panX += e.clientX - lx; panY += e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      drawCFG();
    });
    cv.addEventListener('pointerup', function () { dragging = false; });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoom = Math.min(3, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      drawCFG();
    }, { passive: false });
    cv.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                           e.touches[0].clientY - e.touches[1].clientY);
        if (pinchD > 0) zoom = Math.min(3, Math.max(0.4, zoom * d / pinchD));
        pinchD = d;
        drawCFG();
      }
    }, { passive: false });
    cv.addEventListener('touchend', function () { pinchD = 0; });
  }
  function onShow() { fitCanvas(); drawCFG(); }

  return {
    init: init, onShow: onShow,
    cmdDisasm: cmdDisasm, cmdCfg: cmdCfg,
    disassemble: disassemble, loadDemo: loadDemo,
    trainClassifier: trainClassifier, boundaryDemo: boundaryDemo,
    last: function () { return { listing: lastListing, cfg: lastCFG, mode: lastMode }; }
  };
})();
