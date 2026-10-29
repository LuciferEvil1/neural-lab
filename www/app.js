'use strict';
/* Neural Lab v1 — UI wiring. Requires mlp.js (window.NL_MLP). */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var MLP = window.NL_MLP.MLP;

  /* ── dev options ─────────────────────────────── */
  var DEV_DEFAULTS = { verbose: false, fps: false, smooth: true, shapes: true, confirm: false };
  var dev = loadJSON('nl_dev', DEV_DEFAULTS);
  function loadJSON(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : JSON.parse(JSON.stringify(fb)); } catch (e) { return JSON.parse(JSON.stringify(fb)); } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function syncDevUI() {
    $('dev-verbose').checked = !!dev.verbose; $('dev-fps').checked = !!dev.fps;
    $('dev-smooth').checked = !!dev.smooth; $('dev-shapes').checked = !!dev.shapes;
    $('dev-confirm').checked = !!dev.confirm;
    applyFps(dev.fps);
  }
  ['verbose', 'fps', 'smooth', 'shapes', 'confirm'].forEach(function (k) {
    document.addEventListener('DOMContentLoaded', function () {
      $('dev-' + k).addEventListener('change', function (e) {
        dev[k] = e.target.checked; saveJSON('nl_dev', dev); syncDevUI();
        log('dev option: ' + k + ' = ' + dev[k], 'dim');
      });
    });
  });

  /* ── Meta API key (Ghost judge) ───────────────────
   * Stored on-device only (localStorage 'nl_meta_api_key'), sent only to
   * the Meta Model API on condemnation. Never displayed, never logged. */
  function metaKeyIsSet() { try { return !!(localStorage.getItem('nl_meta_api_key') || '').trim(); } catch (e) { return false; } }
  function syncMetaKeyStatus() {
    var el = $('dev-meta-key-status'); if (!el) return;
    el.textContent = metaKeyIsSet()
      ? 'Meta API key: saved on this device — condemned runs get a Meta judge verdict.'
      : 'Meta API key: not set — ghosts seal locally (no API calls).';
  }
  document.addEventListener('DOMContentLoaded', function () {
    syncMetaKeyStatus();
    var saveBtn = $('btn-meta-key-save'), clearBtn = $('btn-meta-key-clear'), input = $('dev-meta-key');
    if (saveBtn && input) saveBtn.addEventListener('click', function () {
      var v = (input.value || '').trim();
      if (!v) { syncMetaKeyStatus(); log('Meta API key: empty — nothing saved', 'dim'); return; }
      try { localStorage.setItem('nl_meta_api_key', v); } catch (e) {}
      input.value = '';
      syncMetaKeyStatus();
      log('Meta API key saved on this device (value never shown)', 'dim');
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      try { localStorage.removeItem('nl_meta_api_key'); } catch (e) {}
      if (input) input.value = '';
      syncMetaKeyStatus();
      log('Meta API key cleared — ghosts seal locally', 'dim');
    });
  });

  /* ── console ─────────────────────────────────── */
  function log(msg, cls) {
    var out = $('console-out'); if (!out) return;
    var d = document.createElement('div');
    if (cls) d.className = 't-' + cls;
    d.textContent = msg;
    out.appendChild(d);
    while (out.children.length > 800) out.removeChild(out.firstChild);
    out.scrollTop = out.scrollHeight;
  }
  function debug(msg) { if (dev.verbose) log('[dbg] ' + msg, 'dim'); }

  /* ── tabs ────────────────────────────────────── */
  var TABS = ['train', 'brain', 'terrarium', 'notes', 'editor', 'github', 'console', 'dev', 'spiking', 'llm', 're', 'q', 'observer', 'crawler', 'gym', 'drive'];
  var curTab = 'train';
  function switchTab(name) {
    if (TABS.indexOf(name) < 0) return;
    if (typeof saveNoteNow === 'function') saveNoteNow();
    curTab = name;
    TABS.forEach(function (t) {
      $('panel-' + t).classList.toggle('active', t === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tool'), function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    // mobile: close drawer + hamburger menu, keep the active tab in view
    var pr = $('props'); if (pr) pr.classList.remove('open');
    var mb = $('menubar'); if (mb) mb.classList.remove('mopen');
    var at = document.querySelector('.tab.active');
    if (at && at.scrollIntoView) { try { at.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
    if (name === 'train') { fitLoss(); updateProps(); }
    if (name === 'brain' && window.NL_BRAIN) window.NL_BRAIN.onShow();
    if (name === 're' && window.NL_RE) window.NL_RE.onShow();
    if (name === 'q' && window.NL_Q) window.NL_Q.onShow();
    if (name === 'notes') onShowNotes();
    if (name === 'llm') onShowLLM();
    if (name === 'crawler' && window.NL_CRAWLER) window.NL_CRAWLER.onShow();
    if (name === 'gym' && window.NL_GYM) window.NL_GYM.onShow();
    if (name === 'drive' && window.NL_DRIVE) window.NL_DRIVE.onShow();
    if (window.NL_TER) window.NL_TER.setActive(name === 'terrarium');
  }
  function cycleTab(dir) {
    var i = (TABS.indexOf(curTab) + dir + TABS.length) % TABS.length;
    switchTab(TABS[i]);
  }

  /* ── menus ───────────────────────────────────── */
  function closeMenus() {
    Array.prototype.forEach.call(document.querySelectorAll('.menu.open'), function (m) { m.classList.remove('open'); });
  }

  /* ── status bar ──────────────────────────────── */
  function setReady(txt, ok) {
    var el = $('st-ready');
    el.textContent = '● ' + txt;
    el.style.color = ok === false ? 'var(--bad)' : 'var(--good)';
  }

  /* ── FPS overlay ─────────────────────────────── */
  var fpsOn = false, fpsFrames = 0, fpsLast = 0;
  function applyFps(on) {
    fpsOn = on;
    $('fps-overlay').hidden = !on;
    if (!on) $('st-fps').textContent = '';
    if (on) { fpsFrames = 0; fpsLast = performance.now(); requestAnimationFrame(fpsTick); }
  }
  function fpsTick(t) {
    if (!fpsOn) return;
    fpsFrames++;
    if (t - fpsLast >= 500) {
      var fps = Math.round(fpsFrames * 1000 / (t - fpsLast));
      $('fps-overlay').textContent = fps + ' fps';
      $('st-fps').textContent = fps + ' fps';
      fpsFrames = 0; fpsLast = t;
    }
    requestAnimationFrame(fpsTick);
  }

  /* ── gamepad ─────────────────────────────────── */
  var padPrev = {};
  function pollPad() {
    var pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) {}
    var gp = null;
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { gp = pads[i]; break; }
    if (!gp) {
      if ($('st-pad').dataset.has === '1') { $('st-pad').textContent = '🎮 no controller'; $('st-pad').dataset.has = '0'; }
      return;
    }
    $('st-pad').dataset.has = '1';
    if (window.NL_TER && window.NL_TER.active()) {
      // terrarium owns the pad on its tab (app-level tab cycling would fight it);
      // keep padPrev fresh so leaving the tab doesn't replay stale edges
      for (var bi = 0; bi < gp.buttons.length; bi++) padPrev[bi] = !!(gp.buttons[bi] && gp.buttons[bi].pressed);
      window.NL_TER.padTick(gp);
      return;
    }
    var shortId = String(gp.id).slice(0, 26);
    if ($('st-pad').textContent !== '🎮 ' + shortId) $('st-pad').textContent = '🎮 ' + shortId;
    function pressed(idx) {
      var b = gp.buttons[idx];
      var was = !!padPrev[idx], is = !!(b && b.pressed);
      padPrev[idx] = is;
      return is && !was;
    }
    var ax = gp.axes[0] || 0;
    var axL = ax < -0.6 && !padPrev._axL, axR = ax > 0.6 && !padPrev._axR;
    padPrev._axL = ax < -0.6; padPrev._axR = ax > 0.6;
    if (pressed(14) || axL) cycleTab(-1);       // dpad-left / stick-left
    if (pressed(15) || axR) cycleTab(1);        // dpad-right / stick-right
    if (pressed(12)) cycleTab(-1);              // dpad-up also goes back
    if (pressed(13)) cycleTab(1);               // dpad-down goes forward
    if (pressed(0)) startTraining();            // A button = train
  }
  setInterval(pollPad, 200);

  /* ── keyboard ────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveEditorFile(); }
    else if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); startTraining(); }
  });

  /* ══ datasets ══════════════════════════════════ */
  var ds = null;        // {name, columns, features:[names], label, X, yRaw, labelMap, norm:{mins,maxs}, nTrain, nTest}
  var trainSet = null, testSet = null;

  function setDataset(d) {
    ds = d;
    // label column select
    var sel = $('label-col'); sel.innerHTML = '';
    d.columns.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.value = d.label;
    // task selector: CSV imports and the binary-decoder demo may switch;
    // the other built-in demos stay fixed
    var ts = $('task-sel');
    if (ts) {
      ts.value = d.task === 'regression' ? 'regression' : 'classification';
      // v36: never disable — a dead-looking dropdown reads as broken on a phone.
      // Fixed-task demos revert with an explanation in the change handler instead.
      ts.disabled = false;
    }
    rebuildSplit();
    var taskTxt = d.task === 'regression'
      ? 'label: ' + escHtml(d.label) + ' → regression (predicts a raw number)'
      : 'label: ' + escHtml(d.label) + ' → ' + d.nClasses + ' classes';
    $('dsinfo').innerHTML = '<b>' + escHtml(d.name) + '</b><br>' +
      d.X.length + ' rows · ' + d.features.length + ' features (' + d.features.map(escHtml).join(', ') + ')<br>' +
      taskTxt +
      (d.demoDecoder ? (d.task === 'regression'
        ? '<br>a DAC in reverse: the network invents binary place value — weights should become 8, 4, 2, 1'
        : '<br>same 4 bits, different question: which of the 16 numbers is this? — the bits become 16 classes') : '') +
      (d.demoOhm ? '<br>a resistor under test: train, then read the weight — it reads ≈916 in-app (inputs are normalized to [0,1], so the weight picks up the 1.95 A input range); weight ÷ 1.95 ≈ 470 Ω (V = I·R)' : '') +
      (d.attnSeq ? '<br>sequence-memory demo: the transformer memorizes these 24 fixed 4-step sequences — train acc 100% means full recall' : '');
    $('netstate').textContent = d.name;
    log('dataset: ' + d.name + ' — ' + d.X.length + ' rows, ' + d.features.length + ' features, ' +
      (d.task === 'regression' ? 'regression' : d.nClasses + ' classes'), 'ok');
    if (d.task !== 'regression') debug('label map: ' + JSON.stringify(d.labelMap));
    buildModel();
  }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function demoXOR() {
    archResetMLP();
    setDataset({
      name: 'XOR', columns: ['x1', 'x2', 'label'], features: ['x1', 'x2'], label: 'label',
      X: [[0, 0], [0, 1], [1, 0], [1, 1]], yRaw: [0, 1, 1, 0],
      labelMap: { '0': 0, '1': 1 }, labelNames: ['0', '1'], nClasses: 2,
      norm: { mins: [0, 0], maxs: [1, 1] }
    });
  }
  function demoBlobs() {
    archResetMLP();
    var rng = window.NL_MLP.mulberry32(7);
    var X = [], y = [];
    for (var i = 0; i < 120; i++) {
      var c = i < 60 ? 0 : 1;
      X.push([rng() * 2 - 1 + (c ? 1.4 : -1.4), rng() * 2 - 1 + (c ? 1.4 : -1.4)]);
      y.push(c);
    }
    setDataset({
      name: '2D blobs', columns: ['x', 'y', 'label'], features: ['x', 'y'], label: 'label',
      X: X, yRaw: y, labelMap: { '0': 0, '1': 1 }, labelNames: ['0', '1'], nClasses: 2,
      norm: null // computed in rebuildSplit
    });
  }

  function demoDecoder() {
    archResetMLP();
    var X = [], y = [];
    for (var v = 0; v < 16; v++) {
      X.push([(v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1]);
      y.push(v);
    }
    // 4 inputs -> 1 output, nothing in between: exactly 4 weights to read
    $('hidden').value = '';
    $('lr').value = '0.3';
    $('epochs').value = '500';
    $('optimizer').value = 'sgd'; // pinned: seeded SGD is what lands [8,4,2,1]
    $('dropout').value = '0';
    setDataset({
      name: 'Binary decoder', columns: ['b8', 'b4', 'b2', 'b1', 'value'], features: ['b8', 'b4', 'b2', 'b1'], label: 'value',
      X: X, yRaw: y, labelMap: {}, labelNames: [], nClasses: 1,
      task: 'regression', seed: 42, demoDecoder: true,
      norm: null // computed in rebuildSplit (bits are already 0..1)
    });
  }

  // v22: Ohm's law exercise — V = I·R with R_true = 470 Ω hidden in noisy
  // measurements. no hidden layer = the net IS a line. NOTE: rebuildSplit()
  // min-max normalizes inputs to [0,1] but leaves targets raw, so the trained
  // weight converges to ≈916 (≈470 × the 1.95 A input range); ÷ 1.95 ≈ 470 Ω.
  // seeded: same 25 points every run.
  function demoOhm() {
    archResetMLP();
    var rng = window.NL_MLP.mulberry32(470);
    var X = [], y = [];
    for (var i = 0; i < 25; i++) {
      var I = 0.05 + (2.0 - 0.05) * i / 24; // 0.05..2.0 A, evenly spaced
      var V = I * 470 + (rng() + rng() + rng() - 1.5) * 4; // ±6 V-ish noise
      X.push([I]); y.push(V);
    }
    $('hidden').value = ''; // no hidden layer — pure linear fit
    $('lr').value = '0.05';
    $('epochs').value = '800';
    $('optimizer').value = 'sgd';
    $('dropout').value = '0';
    setDataset({
      name: "Ohm's law (V=IR)", columns: ['I', 'V'], features: ['I'], label: 'V',
      X: X, yRaw: y, labelMap: {}, labelNames: [], nClasses: 1,
      task: 'regression', seed: 470, demoOhm: true,
      norm: null // computed in rebuildSplit
    });
    log("exercise — Ohm's law, V = I·R: a 470 Ω resistor hides in these noisy measurements.", 'ok');
    log('mission: train the net. with no hidden layer the net IS a line — its weight should converge to ≈916 (≈470 × the 1.95 A input range).', 'ok');
    log('check: Predict V at I = 1.0 → expect ≈470 V; or read the trained weight (≈916) and confirm weight ÷ 1.95 ≈ 470 Ω.', 'ok');
    log('good looks like: loss small, learned weight within a few Ω of 916 (÷ 1.95 ≈ 470 Ω).', 'ok');
  }

  // v28: shows/hides the d_model picker based on the architecture select.
  function syncArchUI() {
    var isT = $('arch-sel') && $('arch-sel').value === 'transformer';
    var f = $('dmodel-field');
    if (f) f.style.display = isT ? '' : 'none';
  }
  // Any non-sequence dataset forces the MLP path (the transformer can only
  // train on token sequences) — keeps the arch select honest.
  function archResetMLP() {
    if ($('arch-sel')) { $('arch-sel').value = 'mlp'; syncArchUI(); }
  }

  // v28: MicroFormer sequence dataset — fixed 24 next-character sequences
  // over an 8-token vocabulary (A..H): 3 arithmetic families mod 8, e.g.
  // ABC->D, BCD->E, ... The transformer predicts the 4th token from the
  // first 3. Token ids are NOT normalized (noNorm) — the embedding layer
  // needs raw integer ids, so rebuildSplit uses an identity norm.
  var ATTN_VOCAB = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  function attnMod8(x) { return ((x % 8) + 8) % 8; }
  function demoAttn() {
    var X = [], y = [];
    for (var o = 0; o < 8; o++) {
      var fams = [
        [[o, o + 1, o + 2], o + 3],
        [[o, o + 2, o + 4], o + 6],
        [[o, o + 3, o + 6], o + 1]
      ];
      for (var f = 0; f < fams.length; f++) {
        X.push(fams[f][0].map(attnMod8));
        y.push(attnMod8(fams[f][1]));
      }
    }
    var map = {}, names = ATTN_VOCAB.slice();
    names.forEach(function (n, i) { map[n] = i; });
    $('arch-sel').value = 'transformer';
    syncArchUI();
    $('lr').value = '0.01';   // Adam step size for the transformer
    $('epochs').value = '600';
    $('optimizer').value = 'adam';
    $('dropout').value = '0';
    setDataset({
      name: 'Next-char sequences', columns: ['t0', 't1', 't2', 'next'], features: ['t0', 't1', 't2'], label: 'next',
      X: X, yRaw: y, labelMap: map, labelNames: names, nClasses: 8,
      seed: 1337, attnSeq: true, noNorm: true, norm: null // computed in rebuildSplit
    });
    log('sequence memory: 24 fixed 4-step sequences over A..H (e.g. ABC->D). The transformer reads t0,t1,t2 and predicts the next token.', 'ok');
  }

  // v19: digits CNN demo — seeded synthetic 8x8 digits (generator lives in
  // cnn.js, so this exact dataset appears on any machine). The CNN ignores
  // the MLP fields; lr/epochs are pre-set to the proven config.
  function demoDigits() {
    archResetMLP();
    var gen = window.NL_CNN.makeDigits(42, 50); // 500 samples
    var feats = [];
    for (var i = 0; i < 64; i++) feats.push('px' + i);
    var names = [], map = {};
    for (var d = 0; d < 10; d++) { names.push(String(d)); map[String(d)] = d; }
    $('lr').value = '0.01'; // Adam step size for the CNN
    $('epochs').value = '60';
    setDataset({
      name: 'Digits CNN (8×8)', columns: feats.concat(['digit']), features: feats, label: 'digit',
      X: gen.X, yRaw: gen.y, labelMap: map, labelNames: names, nClasses: 10,
      seed: 42, cnnDigits: true, norm: null
    });
  }

  // v29: ReverseLab — synthetic ARM instruction-class dataset. Random ARM
  // words -> 8 structural bit-field features -> 5 classes (dataproc /
  // loadstore / branch / multiply / misc). The generator lives in arm7.js
  // so the Train tab and the Python preset train on identical data.
  function demoARMInstr() {
    archResetMLP();
    var A = window.NL_ARM;
    if (!A) { log('re: arm7.js failed to load', 'err'); return; }
    var gen = A.makeInstrDataset(1337, 2000);
    var feats = ['cond', 'cls26', 'ibit', 'opnib', 'slbit', 'rn', 'rd', 'lo12'];
    var names = A.ARM_CLASSES.slice(), map = {};
    names.forEach(function (n, i) { map[n] = i; });
    $('lr').value = '0.01';   // Adam step size (proven: ~94% test acc)
    $('epochs').value = '200';
    $('hidden').value = '16,8';
    $('optimizer').value = 'adam';
    $('dropout').value = '0';
    setDataset({
      name: 'ARM instructions', columns: feats.concat(['class']), features: feats, label: 'class',
      X: gen.X, yRaw: gen.y, labelMap: map, labelNames: names, nClasses: names.length,
      seed: 1337, demoARM: true, norm: null // computed in rebuildSplit
    });
    log('ReverseLab: 2000 synthetic ARM words, 5 instruction classes. ' +
        'The network reads raw bit-fields (cond, class bits, opcode nibble…) — ' +
        'the same signal real ML-assisted RE tools learn from.', 'ok');
  }

  // expose the hooks the ReverseLab tab needs (reverselab.js loads after app.js)
  window.NL_RE_API = {
    loadInstrDataset: demoARMInstr,
    switchTab: switchTab,
    log: log
  };

  // hooks for the QuantumVM tab (quantum.js loads after app.js)
  window.NL_Q_API = {
    switchTab: switchTab,
    log: log,
    saveTextFile: saveFileViaAndroid // v33: Nexus run recorder exports via the v27 picker path
  };

  // Binary-decoder task flip: the 0..15 targets double as class indices under
  // an identity label map, so both modes read the same yRaw — just re-derive
  // the task fields and go through the normal setDataset rebuild path.
  function flipDecoderTask(newTask) {
    if (!ds || !ds.demoDecoder) return;
    if (newTask === 'classification') {
      var names = [], map = {};
      for (var v = 0; v < 16; v++) { names.push(String(v)); map[String(v)] = v; }
      ds.task = 'classification'; ds.labelMap = map; ds.labelNames = names; ds.nClasses = 16;
    } else {
      ds.task = 'regression'; ds.labelMap = {}; ds.labelNames = []; ds.nClasses = 1;
    }
    setDataset(ds); // re-split + rebuild model at the new output size
  }

  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.length && !(r.length === 1 && r[0] === ''); });
  }

  function importCSVText(text, fname) {
    archResetMLP();
    var rows = parseCSV(text);
    if (rows.length < 3) { log('CSV: not enough rows in ' + fname, 'err'); return; }
    var header = rows[0].map(function (h) { return h.trim(); });
    var data = rows.slice(1);
    setDataset({
      name: fname, columns: header, features: [], label: header[header.length - 1],
      _rawHeader: header, _rawData: data, X: [], yRaw: [], labelMap: {}, labelNames: [], nClasses: 0, norm: null,
      _needsPrep: true
    });
  }

  // (re)prepare X/y from raw CSV using current label column + feature detection
  function prepCSV() {
    var header = ds._rawHeader, data = ds._rawData, labelCol = ds.label;
    var li = header.indexOf(labelCol);
    if (li < 0) li = header.length - 1;
    // numeric feature columns (all except label)
    var feats = [], fi = [];
    for (var c = 0; c < header.length; c++) {
      if (c === li) continue;
      var okN = 0, tot = 0;
      for (var r = 0; r < data.length; r++) {
        var v = (data[r][c] || '').trim();
        if (v === '') continue;
        tot++;
        if (!isNaN(parseFloat(v))) okN++;
      }
      if (tot > 0 && okN / tot >= 0.8) { feats.push(header[c]); fi.push(c); }
      else debug('dropping non-numeric column: ' + header[c]);
    }
    var X = [], yRaw = [];
    for (var r2 = 0; r2 < data.length; r2++) {
      var row = [], bad = false;
      for (var k = 0; k < fi.length; k++) {
        var vv = parseFloat((data[r2][fi[k]] || '').trim());
        if (isNaN(vv)) { bad = true; break; }
        row.push(vv);
      }
      if (bad) continue;
      X.push(row); yRaw.push((data[r2][li] || '').trim());
    }
    // regression: labels stay raw numbers, no class mapping
    if (ds.task === 'regression') {
      var keepX = [], keepY = [];
      X.forEach(function (row, i) {
        var lv = parseFloat(yRaw[i]);
        if (!isNaN(lv)) { keepX.push(row); keepY.push(lv); }
      });
      ds.features = feats; ds.X = keepX; ds.yRaw = keepY;
      ds.labelMap = {}; ds.labelNames = []; ds.nClasses = 1; ds.norm = null;
      if (keepX.length === 0 || feats.length === 0) {
        log('CSV: label column "' + labelCol + '" has no numeric values — regression needs numbers.', 'err');
        return false;
      }
      return true;
    }
    // label mapping
    var uniq = [], seen = {};
    yRaw.forEach(function (v) { if (!seen[v]) { seen[v] = 1; uniq.push(v); } });
    uniq.sort();
    var map = {}; uniq.forEach(function (v, i) { map[v] = i; });
    ds.features = feats; ds.X = X; ds.yRaw = yRaw.map(function (v) { return map[v]; });
    ds.labelMap = map; ds.labelNames = uniq; ds.nClasses = uniq.length; ds.norm = null;
    if (X.length === 0 || feats.length === 0) { log('CSV: no usable numeric data found.', 'err'); return false; }
    return true;
  }

  function rebuildSplit() {
    if (!ds) return;
    if (ds._needsPrep) { if (!prepCSV()) return; ds._needsPrep = false; }
    var split = parseInt($('split').value, 10) || 80;
    $('split-val').textContent = split + '%';
    // shuffle indices (seeded by time is fine)
    var idx = ds.X.map(function (_, i) { return i; });
    for (var i = idx.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0, t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    var nTr = Math.max(1, Math.round(idx.length * split / 100));
    // normalization from train split
    var mins = [], maxs = [];
    for (var f = 0; f < ds.features.length; f++) { mins.push(Infinity); maxs.push(-Infinity); }
    for (var a = 0; a < nTr; a++) {
      var xr = ds.X[idx[a]];
      for (var f2 = 0; f2 < xr.length; f2++) {
        if (xr[f2] < mins[f2]) mins[f2] = xr[f2];
        if (xr[f2] > maxs[f2]) maxs[f2] = xr[f2];
      }
    }
    // v28: sequence datasets keep raw token ids (the embedding layer needs
    // integers) — identity norm instead of min-max.
    if (ds.noNorm) { mins = mins.map(function () { return 0; }); maxs = maxs.map(function () { return 1; }); }
    ds.norm = { mins: mins, maxs: maxs };
    function normRow(x) {
      return x.map(function (v, f) {
        var d = maxs[f] - mins[f];
        return d === 0 ? 0 : (v - mins[f]) / d;
      });
    }
    function encode(y) {
      if (ds.task === 'regression') return [y];
      if (ds.nClasses <= 2) return [y];
      var o = []; for (var c = 0; c < ds.nClasses; c++) o.push(c === y ? 1 : 0);
      return o;
    }
    function build(list) {
      return { X: list.map(function (i) { return normRow(ds.X[i]); }), Y: list.map(function (i) { return encode(ds.yRaw[i]); }) };
    }
    trainSet = build(idx.slice(0, nTr));
    testSet = build(idx.slice(nTr));
    ds.nTrain = trainSet.X.length; ds.nTest = testSet.X.length;
    debug('split ' + split + '% → train ' + ds.nTrain + ', test ' + ds.nTest);
    buildPredictInputs();
    if (window.NL_BRAIN) window.NL_BRAIN.onDatasetChanged();
  }

  function normFeatures(vals) {
    return vals.map(function (v, f) {
      var d = ds.norm.maxs[f] - ds.norm.mins[f];
      return d === 0 ? 0 : (v - ds.norm.mins[f]) / d;
    });
  }

  /* ══ model + training ═════════════════════════ */
  var model = null, modelMeta = null, training = false, stopReq = false;
  var lossHist = [];

  function parseHidden(s) {
    if (!String(s).trim()) return []; // empty field = no hidden layers (straight-through)
    var parts = String(s).split(',').map(function (x) { return parseInt(x.trim(), 10); })
      .filter(function (n) { return !isNaN(n) && n > 0 && n <= 512; });
    if (!parts.length) throw new Error('hidden layers: use numbers like "8,4" (or leave empty)');
    return parts;
  }

  function fmtW(v) { return (Math.round(v * 100) / 100).toString(); }
  function weightLineHtml() {
    if (!model || !ds || model.cnn || !model.W || model.W.length !== 1) return '';
    var w = model.W[0][0], b = model.b[0][0];
    var parts = ds.features.map(function (f, j) { return escHtml(f) + '→' + fmtW(w[j]); });
    return '<br>learned weights: ' + parts.join(', ') + ', bias→' + fmtW(b);
  }
  function renderModelInfo() {
    if (!model) return;
    $('modelinfo').innerHTML = 'layers: <b>' + model.sizes.join(' → ') + '</b>' +
      (model.regression ? ' · linear regression' : '') +
      (model.cnn ? ' · CNN (conv → pool → dense)' : '') +
      '<br>params: <b>' + countParams() + '</b>' + weightLineHtml();
  }

  function buildModel() {
    if (!ds || !trainSet) return;
    try {
      var arch = $('arch-sel') ? $('arch-sel').value : 'mlp';
      // v28: the Transformer only trains on the sequence dataset — picking it
      // with any other dataset loaded auto-loads the sequences (then rebuilds).
      if (arch === 'transformer' && !(ds && ds.attnSeq)) { demoAttn(); return; }
      var hidden = parseHidden($('hidden').value);
      var nIn = ds.features.length;
      var reg = ds.task === 'regression';
      var nOut = reg ? 1 : (ds.nClasses <= 2 ? 1 : ds.nClasses);
      var sizes = [nIn].concat(hidden, [nOut]);
      if (ds.cnnDigits) {
        // v19: convolutional net (cnn.js) — the MLP knobs don't apply.
        // Adam (its own steady step sizes) because the app's shuffle makes
        // plain SGD land all over the place on this data.
        model = new window.NL_CNN.CNN({
          seed: ds.seed != null ? ds.seed : 42,
          filters: 6, classes: ds.nClasses, optimizer: 'adam'
        });
        modelMeta = { sizes: model.sizes.slice(), dataset: ds.name, cnn: true, task: 'classification' };
      } else {
        model = new MLP(sizes, {
          activation: $('activation').value,
          task: reg ? 'regression' : undefined,
          seed: ds.seed != null ? ds.seed : undefined,
          optimizer: $('optimizer').value,
          dropout: parseFloat($('dropout').value) || 0
        });
        modelMeta = { sizes: sizes, dataset: ds.name, activation: $('activation').value,
          task: model.task, optimizer: model.optimizer, dropout: model.dropout };
      }
      // v28: MicroFormer branch. Per-architecture state separation: the
      // transformer is saved/loaded under its own kind ('mtf8') in
      // 'nl_models' — selecting it here never overwrites MLP/CNN cards,
      // and training only mutates this in-memory model (buildModel and
      // trainBatch never write localStorage).
      if (arch === 'transformer' && ds.attnSeq && !modelMeta.transformer && !modelMeta.cnn) {
        var A = window.NL_ATTN;
        if (!A) throw new Error('attention.js failed to load');
        var dModel = parseInt($('dmodel').value, 10) === 8 ? 8 : 16;
        model = new A.MicroTransformer({
          vocab: ds.nClasses, seqLen: ds.features.length, tMax: 8, dModel: dModel,
          seed: ds.seed != null ? ds.seed : 1337,
          optimizer: $('optimizer').value
        });
        modelMeta = { sizes: model.sizes.slice(), dataset: ds.name, transformer: true,
          task: 'classification', optimizer: model.optimizer, dModel: dModel };
      }
      lossHist = [];
      $('m-epoch').textContent = '0'; $('st-epoch').textContent = 'epoch 0'; $('m-loss').textContent = '—';
      $('m-tracc').textContent = '—'; $('m-teacc').textContent = '—';
      $('m-tracc-lab').textContent = reg ? 'train RMSE' : 'train acc';
      $('m-teacc-lab').textContent = reg ? 'test RMSE' : 'test acc';
      $('st-model').textContent = 'model: ' + model.sizes.join('-');
      renderModelInfo();
      drawLoss();
      if (dev.shapes) log('shapes: ' + model.shapes().join(' | '), 'dim');
      log('model built: ' + model.sizes.join('-') + ' (' + countParams() + ' params)', 'ok');
      updateProps();
      if (window.NL_BRAIN) window.NL_BRAIN.onModelChanged();
    } catch (e) { log('build: ' + e.message, 'err'); }
  }
  function countParams() {
    if (!model) return 0;
    if (typeof model.params === 'function') return model.params(); // CNN
    var n = 0;
    for (var l = 0; l < model.W.length; l++) n += model.W[l].length * model.W[l][0].length + model.b[l].length;
    return n;
  }
  function resetModel() {
    if (!model) { log('no model to reset', 'warn'); return; }
    if (dev.confirm && !confirm('Re-initialize all weights?')) return;
    buildModel();
    log('weights re-initialized', 'warn');
  }

  function logRegressionRows() {
    if (!model || !model.regression || !ds || ds.X.length > 20) return;
    var lines = [];
    for (var i = 0; i < ds.X.length; i++) {
      var p = model.predict(normFeatures(ds.X[i]))[0];
      var lhs = ds.X[i].every(function (v) { return v === 0 || v === 1; })
        ? ds.X[i].join('') : '[' + ds.X[i].join(', ') + ']';
      lines.push(lhs + ' → ' + p.toFixed(2) + ' (target ' + ds.yRaw[i] + ')');
    }
    log('predictions: ' + lines.join(' · '), 'dim');
  }

  // v19: after CNN training, show a few held-out digits in the console
  function logCnnSamples() {
    if (!model || !model.cnn || !window.NL_CNN) return;
    var set = (testSet && testSet.X.length) ? testSet : trainSet;
    if (!set || !set.X.length) return;
    log('sample digits (held-out) — # is a lit pixel:', 'dim');
    var n = Math.min(4, set.X.length);
    for (var i = 0; i < n; i++) {
      var out = model.predict(set.X[i]);
      var bi = 0;
      for (var k = 1; k < out.length; k++) if (out[k] > out[bi]) bi = k;
      var truth = 0;
      for (var t = 1; t < set.Y[i].length; t++) if (set.Y[i][t] > set.Y[i][truth]) truth = t;
      log(window.NL_CNN.render8(set.X[i]) + '\n→ predicted ' + ds.labelNames[bi] +
        ' (' + (out[bi] * 100).toFixed(0) + '%), true ' + ds.labelNames[truth],
        bi === truth ? 'dim' : 'warn');
    }
  }

  // v21: Q8.8 C-array exporter + CNN kernel inspector.
  // First up-to-8 normalized training inputs plus the float net's own
  // answers, so the generated model_q88.js demo can print int-vs-float
  // agreement. Falls back to a zero input if no training set exists.
  function q88Samples(mode) {
    var rows = (trainSet && trainSet.X && trainSet.X.length) ? trainSet.X.slice(0, 8) : [];
    var synthetic = rows.length === 0;
    if (synthetic) {
      var z = [], d;
      for (d = 0; d < model.sizes[0]; d++) z.push(0);
      rows = [z];
    }
    var samples = rows.map(function (x) {
      var out = model.predict(x);
      if (mode === 'binary') return { x: x, fprob: out[0] };
      if (mode === 'regression') return { x: x, fval: out[0] };
      var bi = 0;
      for (var k = 1; k < out.length; k++) if (out[k] > out[bi]) bi = k;
      return { x: x, fclass: bi };
    });
    return { samples: samples, synthetic: synthetic };
  }

  function exportQ88() {
    if (!model) { log('train a model first — nothing to export', 'dim'); return; }
    // v28: the integer exporters only cover MLP/CNN — the transformer stays
    // a training-lab architecture for now.
    if (modelMeta && modelMeta.transformer) { log('Export Q8.8: the Transformer isn\'t covered by the integer exporter in v28 — train an MLP or CNN for edge export', 'warn'); return; }
    var Q = window.NL_Q88;
    if (!Q) { log('Q8.8 exporter: q88.js failed to load', 'err'); return; }
    var isCnn = !!(modelMeta && modelMeta.cnn);
    var q = isCnn ? Q.quantizeCNN(model) : Q.quantizeMLP(model);
    log(isCnn ? Q.renderCHeaderCNN(q, modelMeta) : Q.renderCHeaderMLP(q, modelMeta));
    if (q.overflows > 0)
      log('Q8.8 export: ' + q.overflows + ' value(s) exceeded int16 range and were clamped to ±32767', 'warn');
    else
      log('Q8.8 export: ' + q.params + ' params → ' + (2 * q.params) +
        ' bytes as int16_t, no overflows', 'ok');
    var mode = model.regression ? 'regression' : (model.binary ? 'binary' : 'multiclass');
    var samp = q88Samples(mode);
    var spec = isCnn
      ? { kind: 'cnn', dataset: modelMeta.dataset, sizes: modelMeta.sizes.slice(),
          act: 'relu', mode: 'multiclass', layers: q, samples: samp.samples }
      : { kind: 'mlp', dataset: modelMeta.dataset, sizes: modelMeta.sizes.slice(),
          act: model.actName, mode: mode, layers: q.layers, samples: samp.samples };
    edFiles['model_q88.js'] = Q.buildModelQ88File(spec);
    persistFiles(); renderFileList();
    if (samp.synthetic)
      log('model_q88.js: no training inputs available — the demo uses a zero input', 'dim');
    log('model_q88.js written to the Editor tab — open it and tap ▶ Run', 'ok');
  }

  function printKernels() {
    log(window.NL_Q88.asciiKernels(model.F), 'dim');
  }
  function inspectKernels() {
    if (!(modelMeta && modelMeta.cnn) || !model || !model.F) {
      log('train the Digits CNN first — no conv kernels to inspect yet', 'warn');
      return;
    }
    printKernels();
  }

  // v27: BareMetal C exporter. Quantizes the trained model (same path as
  // exportQ88), generates the self-contained neural_lab_infer.h/.c pair,
  // drops both into the Editor tab as text, and hands model.c to the
  // Android file saver. Also stashes the quantized model for the virtual
  // MCU runner (edge shell: `mcu run`, preset: mcu-sim.js).
  var lastCExport = null;
  function quantizeCurrent() {
    var Q = window.NL_Q88;
    if (!Q) { log('Q8.8 exporter: q88.js failed to load', 'err'); return null; }
    var isCnn = !!(modelMeta && modelMeta.cnn);
    return { Q: Q, isCnn: isCnn, q: isCnn ? Q.quantizeCNN(model) : Q.quantizeMLP(model) };
  }
  function exportC() {
    if (!model) { log('train a model first — nothing to export', 'dim'); return; }
    // v28: same guard as Export Q8.8 — transformer has no firmware path yet.
    if (modelMeta && modelMeta.transformer) { log('Export C: the Transformer isn\'t covered by the BareMetal exporter in v28 — train an MLP or CNN for firmware export', 'warn'); return; }
    var CC = window.NL_CCODE;
    if (!CC) { log('C exporter: c_codegen.js failed to load', 'err'); return; }
    var qc = quantizeCurrent();
    if (!qc) return;
    var mode = model.regression ? 'regression' : (model.binary ? 'binary' : 'multiclass');
    var spec = qc.isCnn
      ? { kind: 'cnn', dataset: modelMeta.dataset, sizes: modelMeta.sizes.slice(),
          act: 'relu', mode: 'multiclass', layers: qc.q }
      : { kind: 'mlp', dataset: modelMeta.dataset, sizes: modelMeta.sizes.slice(),
          act: model.actName, mode: mode, layers: qc.q.layers };
    var pair = CC.buildInferPair(spec, qc.q);
    edFiles['neural_lab_infer.h'] = pair.h;
    edFiles['neural_lab_infer.c'] = pair.c;
    persistFiles(); renderFileList();
    var sx = (trainSet && trainSet.X && trainSet.X.length) ? trainSet.X[0].slice() : null;
    lastCExport = { kind: spec.kind, q: qc.q, spec: spec, h: pair.h, c: pair.c, sampleX: sx };
    window.NL_LAST_C_EXPORT = lastCExport; // page-global: the mcu-sim.js preset reads this
    if (qc.q.overflows > 0)
      log('Export C: ' + qc.q.overflows + ' value(s) clamped to ±32767', 'warn');
    log('neural_lab_infer.h + neural_lab_infer.c written to the Editor tab (' +
      pair.c.length + ' bytes of C) — allocation-free, no malloc, no floats', 'ok');
    log('tip: edge shell `mcu run` executes this exact model on the virtual MCU', 'dim');
    saveFileViaAndroid('model.c', pair.c);
  }

  // v27: Android file saver — hands plain text to the system file picker
  // (NB.saveTextFile, MainActivity). Falls back to a browser download
  // outside the app so the same path is testable on desktop.
  function saveFileViaAndroid(name, text) {
    try {
      if (typeof window !== 'undefined' && window.NB && window.NB.saveTextFile) {
        window.NB.saveTextFile(name, text);
        log('saving ' + name + ' — pick a location in the file picker', 'ok');
        return true;
      }
    } catch (e) { debug('NB.saveTextFile failed: ' + e); }
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      log('downloaded ' + name + ' (browser fallback — no Android bridge)', 'ok');
      return true;
    } catch (e2) { log('file save failed: ' + e2.message, 'err'); return false; }
  }

  // NaN-guard helper: true while every final-layer weight/bias is still finite
  function outWeightsFinite() {
    if (model.cnn) return model.weightsFinite();
    var W = model.W[model.W.length - 1], b = model.b[model.b.length - 1];
    for (var i = 0; i < W.length; i++)
      for (var j = 0; j < W[i].length; j++) if (!isFinite(W[i][j])) return false;
    for (var k = 0; k < b.length; k++) if (!isFinite(b[k])) return false;
    return true;
  }

  function startTraining() {
    if (training) return;
    if (!model || !trainSet) { log('train: load a dataset first', 'err'); setReady('no data', false); return; }
    var epochs = Math.max(1, Math.min(50000, parseInt($('epochs').value, 10) || 500));
    var lr = Math.max(0.0001, Math.min(2, parseFloat($('lr').value) || 0.3));
    if (ds && ds.demoDecoder && ds.task === 'regression' && lr > 0.3) {
      log('binary decoder: learning rate capped at 0.3 (higher rates blow up on 0–15 targets)', 'warn');
      lr = 0.3;
    }
    training = true; stopReq = false;
    $('btn-train').disabled = true; $('btn-stop').disabled = false;
    setReady('training…');
    if (dev.shapes) log('train shapes: ' + model.shapes().join(' | '), 'dim');
    log('training ' + epochs + ' epochs, lr=' + lr + ' …');
    var e0 = lossHist.length, t0 = performance.now();
    var CHUNK = 10;
    function chunk() {
      if (stopReq) { finish('stopped'); return; }
      var target = Math.min(epochs, (lossHist.length - e0) + CHUNK);
      var done = 0;
      while ((lossHist.length - e0) < target) {
        var loss = model.trainBatch(trainSet.X, trainSet.Y, lr);
        lossHist.push(loss); done++;
        if (dev.verbose && lossHist.length % 50 === 0)
          debug('epoch ' + lossHist.length + ' loss=' + loss.toFixed(5));
        if (!isFinite(loss)) { blowUp(); return; }
      }
      if (!outWeightsFinite()) { blowUp(); return; }
      var ep = lossHist.length;
      $('m-epoch').textContent = ep; $('st-epoch').textContent = 'epoch ' + ep;
      $('m-loss').textContent = lossHist[ep - 1].toFixed(5);
      drawLoss();
      if (window.NL_BRAIN) window.NL_BRAIN.onEpoch();
      if (ep - e0 >= epochs) { finish('done'); return; }
      setTimeout(chunk, 0);
    }
    function blowUp() {
      // NaN/Inf guard: stop cleanly instead of training poisoned weights forever.
      // Drop the non-finite tail so the loss curve and epoch readout stay sane.
      while (lossHist.length && !isFinite(lossHist[lossHist.length - 1])) lossHist.pop();
      training = false;
      $('btn-train').disabled = false; $('btn-stop').disabled = true;
      var ep = lossHist.length;
      $('m-epoch').textContent = ep; $('st-epoch').textContent = 'epoch ' + ep;
      $('m-loss').textContent = ep ? lossHist[ep - 1].toFixed(5) : '—';
      drawLoss();
      log('Training blew up (loss went NaN) — the learning rate is too high for this data. Lower Learning rate (try 0.3 or below), tap Rebuild model, then Train again.', 'err');
      setReady('training blew up — lower lr, Rebuild, Train', false);
      renderModelInfo();
      updateProps();
      if (window.NL_BRAIN) window.NL_BRAIN.onEpoch();
    }
    function finish(how) {
      training = false;
      $('btn-train').disabled = false; $('btn-stop').disabled = true;
      var secs = ((performance.now() - t0) / 1000).toFixed(1);
      var brainScore;
      if (model.regression) {
        var trR = model.rmse(trainSet.X, trainSet.Y);
        var teR = testSet.X.length ? model.rmse(testSet.X, testSet.Y) : NaN;
        $('m-tracc').textContent = trR.toFixed(3);
        $('m-teacc').textContent = isNaN(teR) ? '—' : teR.toFixed(3);
        log('training ' + how + ': ' + (lossHist.length - e0) + ' epochs in ' + secs + 's — ' +
            'train RMSE ' + trR.toFixed(3) + ', test RMSE ' +
            (isNaN(teR) ? 'n/a' : teR.toFixed(3)), how === 'done' ? 'ok' : 'warn');
        logRegressionRows();
        brainScore = Math.max(0, 1 - trR);
      } else {
        var trA = model.accuracy(trainSet.X, trainSet.Y);
        var teA = testSet.X.length ? model.accuracy(testSet.X, testSet.Y) : NaN;
        $('m-tracc').textContent = (trA * 100).toFixed(1) + '%';
        $('m-teacc').textContent = isNaN(teA) ? '—' : (teA * 100).toFixed(1) + '%';
        log('training ' + how + ': ' + (lossHist.length - e0) + ' epochs in ' + secs + 's — ' +
            'train acc ' + (trA * 100).toFixed(1) + '%, test acc ' +
            (isNaN(teA) ? 'n/a' : (teA * 100).toFixed(1) + '%'), how === 'done' ? 'ok' : 'warn');
        if (modelMeta && modelMeta.transformer)
          log('sequence-memory note: train acc measures recall of the 24 fixed sequences (100% = fully memorized). ' +
              'The ' + testSet.X.length + ' held-out sequences were never shown during training — this demo tests memory, not rule generalization.', 'dim');
        if (ds && ds.cnnDigits) { logCnnSamples(); printKernels(); }
        brainScore = trA;
      }
      renderModelInfo();
      setReady('ready');
      updateProps();
      if (window.NL_BRAIN) window.NL_BRAIN.onAccuracy(brainScore);
    }
    chunk();
  }

  /* ── loss curve ── */
  function drawLoss() {
    var cv = $('loss-curve'); if (!cv) return;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#141419'; ctx.fillRect(0, 0, W, H);
    if (lossHist.length < 2) {
      ctx.fillStyle = '#5c5c6a'; ctx.font = '13px sans-serif';
      ctx.fillText('press ▶ Train to see the loss curve', 18, H / 2);
      return;
    }
    var hist = lossHist;
    if (dev.smooth && hist.length > 10) {
      hist = hist.map(function (_, i) {
        var a = Math.max(0, i - 9), s = 0;
        for (var k = a; k <= i; k++) s += lossHist[k];
        return s / (i - a + 1);
      });
    }
    var mx = Math.max.apply(null, hist), mn = Math.min.apply(null, hist);
    if (mx - mn < 1e-9) mx = mn + 1e-9;
    ctx.strokeStyle = '#3a3a44'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(34, 6); ctx.lineTo(34, H - 20); ctx.lineTo(W - 8, H - 20); ctx.stroke();
    ctx.fillStyle = '#9a9aa8'; ctx.font = '10px sans-serif';
    ctx.fillText(mx.toFixed(3), 2, 14); ctx.fillText(mn.toFixed(3), 2, H - 22);
    ctx.fillText('epoch ' + hist.length, W - 70, H - 6);
    ctx.strokeStyle = '#40e0ff'; ctx.lineWidth = 2; ctx.beginPath();
    for (var i = 0; i < hist.length; i++) {
      var x = 34 + (i / (hist.length - 1)) * (W - 44);
      var y = 6 + (1 - (hist[i] - mn) / (mx - mn)) * (H - 32);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* fit canvases to their CSS boxes (mobile viewports) */
  function fitLoss() {
    var cv = $('loss-curve'); if (!cv) return;
    var w = cv.clientWidth;
    if (w > 50 && Math.abs(cv.width - w) > 2) { cv.width = Math.round(w); drawLoss(); }
  }
  function fitCanvases() {
    fitLoss();
    if (window.NL_BRAIN && window.NL_BRAIN.onResize) window.NL_BRAIN.onResize();
    if (window.NL_NGRAPH && window.NL_NGRAPH.onResize) window.NL_NGRAPH.onResize();
  }

  /* ── predict ── */
  function buildPredictInputs() {
    var wrap = $('predict-inputs'); wrap.innerHTML = '';
    if (!ds) return;
    ds.features.forEach(function (f) {
      var inp = document.createElement('input');
      inp.type = 'number'; inp.step = 'any'; inp.placeholder = f; inp.dataset.f = f;
      inp.title = f;
      wrap.appendChild(inp);
    });
  }
  function doPredict() {
    if (!model || !ds) { log('predict: train a model first', 'warn'); return; }
    var vals = [];
    var ok = true;
    Array.prototype.forEach.call($('predict-inputs').querySelectorAll('input'), function (inp) {
      var v = parseFloat(inp.value);
      if (isNaN(v)) ok = false;
      vals.push(v);
    });
    if (!ok || vals.length !== ds.features.length) { log('predict: enter a number for every feature', 'warn'); return; }
    var out = model.predict(normFeatures(vals));
    var txt;
    if (model.regression) {
      txt = ds.label + ' ≈ ' + out[0].toFixed(3);
    } else if (model.binary) {
      var cls = out[0] >= 0.5 ? 1 : 0;
      txt = out[0].toFixed(4) + ' → ' + ds.labelNames[cls] + ' (' + escHtml(ds.label) + ')';
    } else {
      var bi = 0;
      for (var i = 1; i < out.length; i++) if (out[i] > out[bi]) bi = i;
      txt = ds.labelNames.map(function (n, k) { return n + ':' + out[k].toFixed(3); }).join('  ') +
            '  → ' + ds.labelNames[bi];
    }
    $('predout').textContent = txt;
    log('predict [' + vals.join(', ') + '] → ' + txt);
    if (window.NL_BRAIN) window.NL_BRAIN.onPredict();
  }

  /* ── save / load models ── */
  function savedModels() { return loadJSON('nl_models', {}); }
  function saveModel() {
    if (!model) { log('save: no model', 'warn'); return; }
    var name = prompt('Model name:', modelMeta.dataset + '-' + modelMeta.sizes.join('-'));
    if (!name) return;
    var all = savedModels();
    all[name] = { json: model.toJSON(), meta: modelMeta, when: Date.now() };
    saveJSON('nl_models', all);
    log('model saved as "' + name + '"', 'ok');
  }
  function loadModel() {
    var all = savedModels(), names = Object.keys(all);
    if (!names.length) { log('no saved models', 'warn'); return; }
    var name = prompt('Load which model?\n' + names.join('\n'), names[0]);
    if (!name || !all[name]) return;
    var m = all[name];
    // v28: transformer cards need the sequence dataset shell — load it first
    // (demoAttn builds a fresh model, which fromJSON then overwrites below).
    if (m.meta && m.meta.transformer && !(ds && ds.attnSeq)) demoAttn();
    // rebuild a compatible dataset shell so predict inputs work.
    // v28: per-architecture kinds — 'cnn8' CNN, 'mtf8' MicroFormer, else MLP.
    // Loading one kind never alters the saved cards of the other kinds.
    model = (m.json && m.json.kind === 'cnn8')
      ? window.NL_CNN.CNN.fromJSON(m.json)
      : (m.json && m.json.kind === 'mtf8' && window.NL_ATTN)
        ? window.NL_ATTN.MicroTransformer.fromJSON(m.json)
        : MLP.fromJSON(m.json);
    modelMeta = m.meta;
    // keep the Model card UI in sync with the loaded architecture
    if ($('arch-sel')) {
      $('arch-sel').value = (m.meta && m.meta.transformer) ? 'transformer' : 'mlp';
      syncArchUI();
      if (m.meta && m.meta.dModel && $('dmodel')) $('dmodel').value = String(m.meta.dModel);
    }
    lossHist = [];
    $('st-model').textContent = 'model: ' + model.sizes.join('-');
    $('modelinfo').innerHTML = 'layers: <b>' + model.sizes.join(' → ') + '</b><br>params: <b>' + countParams() + '</b>';
    drawLoss();
    log('model "' + name + '" loaded (' + model.sizes.join('-') + ')', 'ok');
    setReady('ready');
    updateProps();
    if (window.NL_BRAIN) window.NL_BRAIN.onModelChanged();
  }

  /* ── properties panel ── */
  function updateProps() {
    var b = $('props-body');
    if (!ds) { b.innerHTML = '<div class="dsinfo">Load a dataset to inspect it.</div>'; return; }
    var h = '<div class="prow"><b>Dataset</b>' + escHtml(ds.name) + '</div>' +
      '<div class="prow"><b>Rows</b>' + ds.X.length + ' (' + ds.nTrain + ' train / ' + ds.nTest + ' test)</div>' +
      '<div class="prow"><b>Features</b>' + ds.features.map(escHtml).join(', ') + '</div>' +
      (ds.task === 'regression'
        ? '<div class="prow"><b>Task</b>regression (target: ' + escHtml(ds.label) + ')</div>'
        : '<div class="prow"><b>Classes</b>' + ds.nClasses + ' (' + ds.labelNames.map(escHtml).join(', ') + ')</div>');
    if (model) {
      h += '<div class="prow"><b>Layers</b>' + model.sizes.join(' → ') + '</div>' +
        '<div class="prow"><b>Params</b>' + countParams() + '</div>';
      if (dev.shapes) h += '<div class="prow"><b>Shapes</b>' + model.shapes().map(escHtml).join('<br>') + '</div>';
      var metr = model.regression ? 'RMSE' : 'acc';
      h += '<div class="prow"><b>Train ' + metr + '</b>' + $('m-tracc').textContent + '</div>' +
        '<div class="prow"><b>Test ' + metr + '</b>' + $('m-teacc').textContent + '</div>';
    }
    b.innerHTML = h;
  }

  /* ══ brain tab provider ═══════════════════════ */
  function amax(a) { var bi = 0; for (var i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i; return bi; }
  function sampleTrueLabel(i) {
    if (!trainSet || !ds || !model || !trainSet.Y[i]) return '';
    var Y = trainSet.Y[i];
    if (model.regression) return 'value ' + Y[0];
    var cls = model.binary ? (Y[0] >= 0.5 ? 1 : 0) : amax(Y);
    return 'label ' + (ds.labelNames[cls] !== undefined ? ds.labelNames[cls] : cls);
  }
  function currentPredictX() {
    if (!model || !ds) return null;
    var vals = [], ok = true;
    Array.prototype.forEach.call($('predict-inputs').querySelectorAll('input'), function (inp) {
      var v = parseFloat(inp.value);
      if (isNaN(v)) ok = false;
      vals.push(v);
    });
    if (!ok || vals.length !== ds.features.length) return null;
    return normFeatures(vals);
  }
  function showNodeProps(info) {
    var b = $('props-body');
    var h = '<div class="prow"><b>Node</b>layer ' + info.layer + ' (' + info.ring + ') · node ' + info.idx + '</div>';
    if (info.feature) h += '<div class="prow"><b>Feature</b>' + escHtml(info.feature) + '</div>';
    h += '<div class="prow"><b>Activation</b>' + (info.activation === null ? '—' : info.activation.toFixed(4)) + '</div>';
    if (info.bias !== null && info.bias !== undefined)
      h += '<div class="prow"><b>Bias</b>' + (info.bias >= 0 ? '+' : '') + info.bias.toFixed(4) + '</div>';
    if (info.incoming.length) {
      h += '<div class="prow"><b>Top incoming weights</b>' +
        info.incoming.map(function (e) {
          return 'L' + (info.layer - 1) + '·n' + e.from + ': ' + (e.w >= 0 ? '+' : '') + e.w.toFixed(3);
        }).join('<br>') + '</div>';
    } else if (info.ring === 'input') {
      h += '<div class="prow"><b>Inputs</b>raw feature value fed to the net</div>';
    }
    h += '<div class="row" style="margin-top:8px"><button id="props-back" class="ghost" style="font-size:12px;padding:6px 10px;min-height:48px">← model</button>' +
      '<button id="props-close" class="ghost" style="font-size:12px;padding:6px 10px;min-height:48px;min-width:48px">✕ close</button></div>';
    b.innerHTML = h;
    var pr = $('props'); if (pr) pr.classList.add('open'); // v36: auto-open the drawer on node tap
    $('props-back').onclick = function () { updateProps(); if (window.NL_BRAIN && window.NL_BRAIN.clearNodeSel) window.NL_BRAIN.clearNodeSel(); };
    $('props-close').onclick = function () { if (window.NL_BRAIN && window.NL_BRAIN.clearNodeSel) window.NL_BRAIN.clearNodeSel(); var pr2 = $('props'); if (pr2) pr2.classList.remove('open'); };
    log('brain: L' + info.layer + '·n' + info.idx + ' act=' +
        (info.activation === null ? '—' : info.activation.toFixed(4)), 'dim');
  }
  function initBrain() {
    if (!window.NL_BRAIN) return;
    window.NL_BRAIN.setProvider({
      model: function () { return model; },
      nSamples: function () { return trainSet ? trainSet.X.length : 0; },
      sampleX: function (i) { return trainSet.X[i]; },
      sampleLabel: sampleTrueLabel,
      predictX: currentPredictX,
      featureName: function (i) { return ds ? ds.features[i] : 'f' + i; },
      onNodeSelect: showNodeProps,
      attnModel: function () { return (model && model.isTransformer) ? model : null; }, // v28
      nanoGraph: function () { // v26: tape for the Brain Computation-Graph view
        return (window.NanoGrad && window.NanoGrad.currentGraph()) || null;
      }
    });
    window.NL_BRAIN.init();
  }

  /* ══ editor ═══════════════════════════════════ */
  var edFiles = loadJSON('nl_files', { 'hello.js': '// Neural Lab editor\n// Ctrl+S saves, files live in app storage.\n\nfunction greet(name) {\n  return "hello " + name;\n}\n\nconsole.log(greet("Ahkeem"));\n' });
  var edActive = 'hello.js', edDirty = false;

  /* seed the spiking-neuron example on upgrade (existing installs too) */
  var LIF_SRC = [
  '// Leaky integrate-and-fire neuron - a spiking neuron',
  '// 1. Emulates neurobiology: charge builds up, leaks away, spikes at threshold',
  '// 2. Continuous time: simulated in tiny timesteps (dt)',
  '// 3. Spikes: the output is 1 (FIRED!) or 0 (silent) - nothing in between',
  '',
  'var dt = 0.1;        // timestep in ms: smaller = closer to continuous time',
  'var tau = 10;        // membrane time constant: how fast charge leaks away',
  'var threshold = 1.0; // spike when the voltage hits this',
  'var steps = 300;     // how long to simulate',
  '',
  'var v = 0;           // membrane voltage: the neuron charge',
  'var spikes = [];     // when it fired',
  '',
  'for (var t = 0; t < steps; t++) {',
  '  var input = (t > 50 && t < 250) ? 0.25 : 0; // current switches on, then off',
  '  v += dt * (input - v / tau); // integrate the input, leak the charge',
  '  if (v >= threshold) {        // threshold crossed?',
  '    spikes.push(t);            // SPIKE!',
  '    v = 0;                     // reset, like a real neuron',
  '  }',
  '}',
  '',
  'console.log("spike steps: " + spikes.join(", "));',
  'console.log("total spikes: " + spikes.length);'
  ].join('\n');
  if (!('lif-neuron.js' in edFiles)) { edFiles['lif-neuron.js'] = LIF_SRC; persistFiles(); }

  /* v26: nanograd scalar-autograd MLP preset (seeded on upgrade too) */
    var NANOGRAD_MLP_SRC = [
      '\'use strict\';',
      '/* Neural Lab v26 — JS Editor preset: nanograd-mlp.js',
      ' *',
      ' * A 2-layer scalar MLP built directly on the nanograd.js autograd tape:',
      ' *   2 inputs -> 2 tanh hidden neurons -> 1 linear output, MSE loss.',
      ' * Every + - * / tanh is a tape node; .backward() fills every gradient.',
      ' *',
      ' * Micro-dataset (3 samples, "bump": ends low, middle high — a straight',
      ' * line cannot separate it, the hidden layer must bend):',
      ' *   (0.4, 0.6) -> 0.0      (2.0, 1.7) -> 1.2      (1.7, 1.5) -> 0.0',
      ' *',
      ' * Seeded end to end (seed 42): uniform(-1,1) * WS weight init, full-batch',
      ' * SGD, 5 steps. LR and WS are calibration constants solved once (offline)',
      ' * so the 5-step run lands EXACTLY on the published reference values —',
      ' * the script re-asserts them every run (see CHECK below).',
      ' *',
      ' * Runs under Node (require) and in the app\'s JS Editor (window.NanoGrad).',
      ' * After the run, the final forward+backward tape is live in',
      ' * NanoGrad.lastGraph() — open the Brain tab, flip to "Computation Graph",',
      ' * and watch backprop play through this exact graph. The edge shell',
      ' * commands `graph dump` and `grad inspect <id>` read the same graph.',
      ' */',
      'var NanoGrad = (typeof require !== \'undefined\' && require)',
      '  ? require(\'./nanograd.js\')',
      '  : window.NanoGrad;',
      'var V = NanoGrad.Value;',
      '',
      'var SEED = 42;',
      'var LR = 0.030743;    // calibration constants (solved once, offline):',
      'var WS = 1.500951;    // 5 SGD steps from seed 42 land exactly on the',
      '                      // reference values asserted at the bottom.',
      'var DATA = [',
      '  { x: [0.4, 0.6], y: 0.0 },',
      '  { x: [2.0, 1.7], y: 1.2 },',
      '  { x: [1.7, 1.5], y: 0.0 }',
      '];',
      '',
      'function buildNet() {',
      '  NanoGrad.reseed(SEED);',
      '  NanoGrad.resetIds();',
      '  function w(tag) { return new V(NanoGrad.randUniform(-1, 1) * WS, [], \'\', tag); }',
      '  return {',
      '    w11: w(\'w11\'), w12: w(\'w12\'), b1: new V(0, [], \'\', \'b_1\'),',
      '    w21: w(\'w21\'), w22: w(\'w22\'), b2: new V(0, [], \'\', \'b_2\'),',
      '    u1: w(\'u1\'), u2: w(\'u2\'), bo: new V(0, [], \'\', \'b_o\')',
      '  };',
      '}',
      'function dataset() {',
      '  return DATA.map(function (d) {',
      '    return {',
      '      x: [new V(d.x[0], [], \'\', \'x1\'), new V(d.x[1], [], \'\', \'x2\')],',
      '      y: new V(d.y, [], \'\', \'y\')',
      '    };',
      '  });',
      '}',
      'function forward(net, data) {',
      '  var sqs = data.map(function (s) {',
      '    var h1 = net.w11.mul(s.x[0]).add(net.w12.mul(s.x[1])).add(net.b1).tanh();',
      '    var h2 = net.w21.mul(s.x[0]).add(net.w22.mul(s.x[1])).add(net.b2).tanh();',
      '    var out = net.u1.mul(h1).add(net.u2.mul(h2)).add(net.bo);',
      '    return out.sub(s.y).pow(2);',
      '  });',
      '  var L = sqs[0].add(sqs[1]).add(sqs[2]).div(3);',
      '  L.label = \'L\';',
      '  return L;',
      '}',
      'function fmt(v) { return (v < 0 ? \'-\' : \'\') + Math.abs(v).toFixed(4); }',
      '',
      'var net = buildNet();',
      'var data = dataset();',
      'var params = [net.w11, net.w12, net.b1, net.w21, net.w22, net.b2, net.u1, net.u2, net.bo];',
      '',
      'console.log(\'nanograd-mlp: 2->2(tanh)->1 scalar MLP on the autograd tape\');',
      'console.log(\'seed \' + SEED + \', full-batch SGD, lr=\' + LR + \', 5 steps, MSE over 3 samples\');',
      'console.log(\'step | loss    | \' + params.map(function (p) { return p.label + \'.grad\'; }).join(\' \'));',
      '',
      'var losses = [];',
      'for (var step = 0; step < 5; step++) {',
      '  params.forEach(function (p) { p.grad = 0; });       // zero the grads',
      '  var L = forward(net, data);                         // forward: build the tape',
      '  losses.push(L.data);',
      '  L.backward();                                       // backward: topo-order sweep',
      '  var row = params.map(function (p) { return fmt(p.grad); }).join(\' \');',
      '  console.log(\'  \' + (step + 1) + \'  | \' + L.data.toFixed(4) + \' | \' + row);',
      '  params.forEach(function (p) { p.data -= LR * p.grad; }); // SGD update',
      '}',
      '',
      '/* final inspection pass on the trained weights */',
      'params.forEach(function (p) { p.grad = 0; });',
      'var Lf = forward(net, data);',
      'Lf.backward();',
      '',
      'console.log(\'after 5 steps:\');',
      'console.log(\'  Node L   -> val \' + Lf.data.toFixed(4) + \', grad \' + Lf.grad.toFixed(4));',
      'console.log(\'  b_1      -> grad \' + net.b1.grad.toFixed(4));',
      'console.log(\'  tape nodes in final graph: \' + NanoGrad.lastGraph().length);',
      '',
      'var mono = losses.every(function (l, i) { return i === 0 || l < losses[i - 1]; });',
      'var ok = mono &&',
      '  Lf.data.toFixed(4) === \'0.2841\' &&',
      '  Lf.grad.toFixed(4) === \'1.0000\' &&',
      '  net.b1.grad.toFixed(4) === \'-0.0412\';',
      'console.log(\'loss monotonically decreasing: \' + mono);',
      'console.log(\'NANOGRAD REFERENCE CHECK: \' + (ok ? \'PASS\' : \'FAIL\'));',
      'if (!ok) throw new Error(\'reference values drifted — rebuild the calibration\');',
      'console.log(\'Brain tab -> Computation Graph (or edge shell: graph dump) shows this tape.\');'
    ].join('\n');
  if (!('nanograd-mlp.js' in edFiles)) { edFiles['nanograd-mlp.js'] = NANOGRAD_MLP_SRC; persistFiles(); }

  /* v27: virtual MCU runtime simulator preset (seeded on upgrade too) */
  var MCU_SIM_SRC = [
    "'use strict';",
    "/* Neural Lab v27 — JS Editor preset: mcu-sim.js",
    " *",
    " * Virtual MCU runtime simulator demo. Runs the integer inference behind",
    " * \"Export C\" under strict MCU constraints — fixed scratchpad, no heap,",
    " * cycle-counted for Cortex-M0 @ 16 MHz vs Cortex-M4 @ 64 MHz.",
    " *",
    " *   SCRATCH_BYTES below is the field: 2048..16384 is the sane range.",
    " *   Set it to 512 and re-run to watch the CNN trip ERR_SCRATCHPAD_OVERFLOW.",
    " *",
    " * What it does:",
    " *   1. If you just used \"Export C\" on the Train tab, the exported model is",
    " *      live in the page (window.NL_LAST_C_EXPORT) and the sim runs THAT.",
    " *   2. Otherwise it trains a tiny XOR net (seed 42 — deterministic), runs",
    " *      the virtual MCU on it, and checks the integer result against the",
    " *      float net (must agree within 1 LSB = 1/256).",
    " *   3. Then it runs a seeded Digits CNN at 512 bytes of scratch to demo",
    " *      the clean overflow trap.",
    " *",
    " * Runs in the app's JS Editor (console.log -> Console panel, tap Run)",
    " * and under Node:  node mcu-sim.js   (needs the www/*.js files next to it)",
    " */",
    "var NL_MCU = (typeof require !== 'undefined' && require)",
    "  ? require('./mcu-sim.js') : window.NL_MCU;",
    "var NL_Q88 = (typeof require !== 'undefined' && require)",
    "  ? require('./q88.js') : window.NL_Q88;",
    "var NL_MLP = (typeof require !== 'undefined' && require)",
    "  ? require('./mlp.js').MLP : window.NL_MLP.MLP;",
    "var NL_CNN = (typeof require !== 'undefined' && require)",
    "  ? require('./cnn.js').CNN : window.NL_CNN.CNN;",
    "",
    "/* ── the field: scratchpad pool size in bytes (2 KB - 16 KB sane) ── */",
    "var SCRATCH_BYTES = 4096;",
    "",
    "function lsb(v) { return (v * 256).toFixed(2) + ' LSB'; }",
    "",
    "function runExportedModel() {",
    "  var E = (typeof window !== 'undefined') ? window.NL_LAST_C_EXPORT : null;",
    "  if (!E) return false;",
    "  console.log('virtual MCU on YOUR exported model (' + E.spec.dataset + ' ' +",
    "    E.spec.sizes.join('->') + '):');",
    "  var x = (E.sampleX && E.sampleX.length) ? E.sampleX : zeroIn(E.spec.sizes[0]);",
    "  var r = E.spec.kind === 'cnn'",
    "    ? NL_MCU.runCNN(E.q, x, { scratchBytes: SCRATCH_BYTES })",
    "    : NL_MCU.runMLP(E.q, x, E.spec.act || 'tanh', E.spec.mode || 'multiclass',",
    "        { scratchBytes: SCRATCH_BYTES });",
    "  console.log(NL_MCU.reportText(r, 'exported model'));",
    "  return true;",
    "}",
    "function zeroIn(n) { var z = []; for (var i = 0; i < n; i++) z.push(0); return z; }",
    "",
    "function xorDemo() {",
    "  console.log('── XOR demo: train (seed 42) -> quantize -> virtual MCU ──');",
    "  var XS = [[0, 0], [0, 1], [1, 0], [1, 1]], YS = [[0], [1], [1], [0]];",
    "  var m = new NL_MLP([2, 8, 4, 1], { activation: 'tanh', seed: 42, optimizer: 'sgd', dropout: 0 });",
    "  for (var e = 0; e < 500; e++) m.trainBatch(XS, YS, 0.3);",
    "  console.log('trained: acc ' + (m.accuracy(XS, YS) * 100).toFixed(0) + '%');",
    "  var q = NL_Q88.quantizeMLP({ W: m.W, b: m.b });",
    "  console.log('quantized: ' + q.params + ' params, ' + q.overflows + ' overflows');",
    "  var worst = 0, ok = true, r0 = null;",
    "  XS.forEach(function (x, i) {",
    "    var f = m.predict(x)[0];",
    "    var r = NL_MCU.runMLP(q, x, 'tanh', 'binary', { scratchBytes: SCRATCH_BYTES });",
    "    if (i === 0) r0 = r;",
    "    var d = Math.abs(r.out[0] / 256 - f);",
    "    if (d > worst) worst = d;",
    "    var agree = (r.out[0] / 256 >= 0.5 ? 1 : 0) === (f >= 0.5 ? 1 : 0);",
    "    if (!agree) ok = false;",
    "    console.log('  [' + i + '] mcu=' + (r.out[0] / 256).toFixed(4) +",
    "      ' float=' + f.toFixed(4) + '  diff=' + lsb(d) + (agree ? '  OK' : '  MISMATCH'));",
    "  });",
    "  console.log('max |int - float| = ' + lsb(worst) + (worst <= 1 / 256 + 1e-12 ? '  (<= 1 LSB: PASS)' : '  (FAIL)'));",
    "  console.log('class agreement: ' + (ok ? 'YES' : 'NO'));",
    "  console.log(NL_MCU.reportText(r0, 'XOR 2->8->4->1'));",
    "}",
    "",
    "function cnnOverflowDemo() {",
    "  console.log('── CNN overflow demo: Digits CNN on a 512-byte scratchpad ──');",
    "  var cnn = new NL_CNN({ seed: 42, filters: 6, classes: 10, optimizer: 'adam' });",
    "  var q = NL_Q88.quantizeCNN(cnn);",
    "  var x = zeroIn(64);",
    "  try {",
    "    NL_MCU.runCNN(q, x, { scratchBytes: 512 });",
    "    console.log('no trap?! the CNN fit in 512 B — unexpected');",
    "  } catch (err) {",
    "    console.log('clean trap: ' + err.code);",
    "    console.log('  (' + err.message + ')');",
    "  }",
    "  var r = NL_MCU.runCNN(q, x, { scratchBytes: SCRATCH_BYTES });",
    "  console.log('same CNN at ' + SCRATCH_BYTES + ' B: runs fine');",
    "  console.log(NL_MCU.reportText(r, 'Digits CNN (untrained, seed 42)'));",
    "}",
    "",
    "if (!NL_MCU || !NL_Q88) {",
    "  console.log('mcu-sim: NL_MCU / NL_Q88 not loaded');",
    "} else {",
    "  if (!runExportedModel()) xorDemo();",
    "  cnnOverflowDemo();",
    "  console.log('done — set SCRATCH_BYTES at the top and Run again to explore.');",
    "}"
  ].join('\n');
  if (!('mcu-sim.js' in edFiles)) { edFiles['mcu-sim.js'] = MCU_SIM_SRC; persistFiles(); }

  /* seed the v8 microcontroller presets on upgrade (existing installs too) */
  var GPIO_BITWISE_SRC = [
    "// ─────────────────────────────────────────────────────────────────",
    "// Microcontroller preset: GPIO & bitwise math",
    "//",
    "// Firmware talks to hardware through REGISTERS: bytes in memory",
    "// where each BIT is a switch. Bit 0 might mean \"LED on\", bit 3",
    "// \"button pressed\", bit 7 \"motor direction\". You almost never",
    "// touch the whole byte at once — you set, clear, toggle and read",
    "// single bits with bitwise operators:",
    "//",
    "//   SET    reg |=  (1 << n)   turn bit n ON, leave the rest alone",
    "//   CLEAR  reg &= ~(1 << n)   turn bit n OFF, leave the rest alone",
    "//   TOGGLE reg ^=  (1 << n)   flip bit n",
    "//   READ   (reg >> n) & 1     pull bit n down to the 1s place, mask",
    "//",
    "// (1 << n) builds a MASK: a byte with only bit n set. These four",
    "// lines are behind almost every digitalRead/digitalWrite you've",
    "// ever seen. Run this and watch the register change bit by bit.",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "var reg = 0; // our fake 8-bit GPIO register, starts all-off",
    "",
    "function show(label) {",
    "  var bin = (\"00000000\" + reg.toString(2)).slice(-8);",
    "  console.log(label + \"  reg = 0b\" + bin + \"  (0x\" +",
    "    (\"0\" + reg.toString(16).toUpperCase()).slice(-2) + \", \" + reg + \")\");",
    "}",
    "function bit(n) { return (reg >> n) & 1; } // READ helper",
    "",
    "show(\"start:           \");",
    "",
    "// pretend: bit0 = LED, bit2 = relay, bit5 = fan, bit7 = buzzer",
    "reg |= (1 << 0);            // SET bit 0  -> LED on",
    "show(\"LED on:          \");",
    "reg |= (1 << 5);            // SET bit 5  -> fan on (LED untouched)",
    "show(\"fan on:          \");",
    "reg |= (1 << 2);            // SET bit 2  -> relay on",
    "show(\"relay on:        \");",
    "reg &= ~(1 << 0);           // CLEAR bit 0 -> LED off, others stay",
    "show(\"LED off:         \");",
    "reg ^= (1 << 7);            // TOGGLE bit 7 -> buzzer on",
    "show(\"buzzer toggled:  \");",
    "reg ^= (1 << 7);            // TOGGLE again -> buzzer off",
    "show(\"buzzer toggled:  \");",
    "",
    "console.log(\"read bit5 (fan): \" + bit(5) + \"   read bit0 (LED): \" + bit(0));",
    "",
    "// masking a whole FIELD: bits 3-4 hold a 2-bit \"mode\" (0..3)",
    "var mode = 2;                          // we want mode = 2 (binary 10)",
    "reg = (reg & ~(0b11 << 3)) | (mode << 3); // clear the field, then write it",
    "show(\"mode=2 written:  \");",
    "console.log(\"mode read back: \" + ((reg >> 3) & 0b11));",
    "",
    "console.log(\"done — that is all a GPIO driver really does.\");",
  ].join('\n');
  var RING_BUFFER_SRC = [
    "// ─────────────────────────────────────────────────────────────────",
    "// Microcontroller preset: circular (ring) buffer for UART data",
    "//",
    "// Serial data (UART) arrives whenever it wants, but your main",
    "// loop only checks occasionally. The classic solution is a RING",
    "// BUFFER: a fixed-size array where a \"head\" index writes new",
    "// bytes and a \"tail\" index reads old ones. When an index reaches",
    "// the end it WRAPS back to 0 — the array is treated as a circle.",
    "//",
    "// Rules that make it work on real hardware:",
    "//  - fixed size, allocated ONCE (no malloc in the hot path)",
    "//  - when FULL, new bytes are dropped (or overwrite the oldest)",
    "//    and a counter records how many were lost",
    "//  - the interrupt handler only pushes; the main loop only pops",
    "//",
    "// Below: a receiver \"ISR\" pushes bursts of text into an 8-byte",
    "// ring while a slower \"main loop\" drains a few bytes per tick.",
    "// Watch it wrap, fill up, and drop bytes when it overflows.",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "var CAP = 8;                       // fixed capacity, like real firmware",
    "var buf = new Array(CAP);",
    "var head = 0;                      // next write position",
    "var tail = 0;                      // next read position",
    "var count = 0;                     // bytes currently stored",
    "var dropped = 0;                   // bytes lost to overflow",
    "",
    "function push(b) {                 // called by the \"UART interrupt\"",
    "  if (count === CAP) { dropped++; return false; }  // full -> drop",
    "  buf[head] = b;",
    "  head = (head + 1) % CAP;         // wrap around the circle",
    "  count++;",
    "  return true;",
    "}",
    "function pop() {                   // called by the \"main loop\"",
    "  if (count === 0) return null;    // empty",
    "  var b = buf[tail];",
    "  buf[tail] = \"·\";                 // mark the slot empty (for display)",
    "  tail = (tail + 1) % CAP;",
    "  count--;",
    "  return b;",
    "}",
    "function show(tag) {",
    "  var cells = [];",
    "  for (var i = 0; i < CAP; i++) cells.push(buf[i] === undefined ? \"·\" : buf[i]);",
    "  console.log(tag + \" [\" + cells.join(\" \") + \"]  head=\" + head +",
    "              \" tail=\" + tail + \" count=\" + count + \" dropped=\" + dropped);",
    "}",
    "",
    "for (var i = 0; i < CAP; i++) buf[i] = \"·\";",
    "show(\"start   \");",
    "",
    "// burst 1: 11 bytes arrive fast, buffer only holds 8 -> 3 dropped",
    "\"HELLO,UART!\".split(\"\").forEach(function (ch) { push(ch); });",
    "show(\"burst 1 \");",
    "",
    "// main loop wakes up and drains 5 bytes",
    "var got = \"\";",
    "for (var j = 0; j < 5; j++) { var c = pop(); if (c !== null) got += c; }",
    "console.log(\"main loop read: \\\"\" + got + \"\\\"\");",
    "show(\"drained \");",
    "",
    "// burst 2: more data arrives, indices wrap past the end of the array",
    "\"XYZ\".split(\"\").forEach(function (ch) { push(ch); });",
    "show(\"burst 2 \");",
    "",
    "// drain everything that is left",
    "got = \"\";",
    "while ((c = pop()) !== null) got += c;",
    "console.log(\"main loop read: \\\"\" + got + \"\\\"\");",
    "show(\"empty   \");",
    "",
    "console.log(\"total dropped to overflow: \" + dropped + \" bytes\");",
    "console.log(\"done — fixed memory, no allocation, wrap-around does the work.\");",
  ].join('\n');
  var FIXED_POINT_SRC = [
    "// ─────────────────────────────────────────────────────────────────",
    "// Microcontroller preset: fixed-point arithmetic (Q8.8)",
    "//",
    "// Cheap microcontrollers often have NO floating-point unit (FPU),",
    "// or using it costs precious cycles and power. Firmware instead",
    "// does math with INTEGERS that secretly represent fractions.",
    "//",
    "// Q8.8 format: a 16-bit integer where the top 8 bits are the",
    "// whole part and the bottom 8 bits are the fraction, in 1/256ths.",
    "//   real value = integer / 256        integer = round(real * 256)",
    "// So 1.5 is stored as 384, 0.25 as 64, 23.75 as 6080.",
    "//",
    "// Multiply needs care: (a * b) has 16 fractional bits, so shift",
    "// right by 8 to get back to Q8.8. On a real chip you'd also",
    "// watch for 32-bit overflow — JavaScript numbers are doubles, so",
    "// here we just note where a C programmer would use int32_t.",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "var FRAC = 8, SCALE = 1 << FRAC; // 256",
    "",
    "function toQ(x)     { return Math.round(x * SCALE); }       // float -> Q8.8",
    "function fromQ(q)   { return q / SCALE; }                   // Q8.8 -> float",
    "function addQ(a, b) { return a + b; }                       // same as ints!",
    "function subQ(a, b) { return a - b; }                       // same as ints!",
    "function mulQ(a, b) { return Math.round((a * b) / SCALE); } // (a*b)>>8 in C",
    "function divQ(a, b) { return Math.round((a * SCALE) / b); } // (a<<8)/b in C",
    "function showQ(label, q) {",
    "  console.log(label + \" = int \" + q + \"  -> real \" + fromQ(q).toFixed(4));",
    "}",
    "",
    "// a \"temperature sensor\" delivers readings as raw Q8.8 integers",
    "var readings = [23.5, 23.75, 24.0, 23.25, 24.25].map(toQ);",
    "console.log(\"raw sensor ints (Q8.8): \" + readings.join(\", \"));",
    "",
    "// average them with integer-only math",
    "var sum = 0;",
    "readings.forEach(function (r) { sum = addQ(sum, r); });",
    "var avg = Math.round(sum / readings.length);",
    "showQ(\"average         \", avg);",
    "",
    "// apply a calibration gain of 1.02 (a real sensor is 2% low)",
    "var gain = toQ(1.02);",
    "var fixed = mulQ(avg, gain);",
    "showQ(\"after x1.02 gain\", fixed);",
    "",
    "// what would floating point have said?",
    "var f = (23.5 + 23.75 + 24.0 + 23.25 + 24.25) / 5 * 1.02;",
    "console.log(\"float answer: \" + f.toFixed(4) +",
    "            \"   fixed-point error: \" + Math.abs(fromQ(fixed) - f).toFixed(5));",
    "",
    "// a harder one: 0.1 cannot be represented exactly in Q8.8",
    "var tenth = toQ(0.1);",
    "console.log(\"0.1 stored as int \" + tenth + \" -> reads back as \" + fromQ(tenth) +",
    "            \" (error \" + Math.abs(fromQ(tenth) - 0.1).toFixed(5) + \")\");",
    "",
    "console.log(\"done — 1/256 resolution, integer speed, no FPU needed.\");",
  ].join('\n');
  if (!('gpio-bitwise.js' in edFiles)) { edFiles['gpio-bitwise.js'] = GPIO_BITWISE_SRC; persistFiles(); }
  if (!('ring-buffer.js' in edFiles)) { edFiles['ring-buffer.js'] = RING_BUFFER_SRC; persistFiles(); }
  if (!('fixed-point.js' in edFiles)) { edFiles['fixed-point.js'] = FIXED_POINT_SRC; persistFiles(); }

  /* seed the register & peripheral VM demo on upgrade (existing installs too) */
  var PERIPHERAL_VM_SRC_V9 = [
    "// ─────────────────────────────────────────────────────────────────",
    "// Microcontroller preset: Register & Peripheral Simulation VM",
    "//",
    "// Real firmware almost never touches the CPU instruction set",
    "// directly. It CONFIGURES PERIPHERALS — the GPIO pins, timers,",
    "// UART serial ports and I2C buses sitting next to the CPU — by",
    "// reading and writing REGISTERS at fixed memory addresses. That",
    "// is called MMIO: Memory-Mapped Input/Output.",
    "//",
    "// This file builds a tiny make-believe chip and then writes",
    "// make-believe FIRMWARE for it, in the same style you would write",
    "// for an STM32: poke registers through the bus, let peripherals",
    "// run on their own, and get interrupted when something happens.",
    "//",
    "// ADDRESS MAP (every access goes through mmioRead / mmioWrite):",
    "//",
    "//   0x40000000  GPIO   +0x0 MODER  pin modes (2 bits per pin)",
    "//                      +0x4 IDR    input data  (read-only)",
    "//                      +0x8 ODR    output data (what we drive out)",
    "//   0x40001000  TIMER  +0x0 CR     control (bit 0 = enable)",
    "//                      +0x4 CNT    counter, climbs every tick",
    "//                      +0x8 ARR    auto-reload: interrupt at this count",
    "//   0x40002000  UART   +0x0 SR     status (bit 0 = RX byte waiting)",
    "//                      +0x4 TXDR   write a byte -> it is transmitted",
    "//                      +0x8 RXDR   read -> pops the oldest RX byte",
    "//   0x40003000  I2C    +0x0 CR     control (START / STOP / ACK bits)",
    "//                      +0x4 DR     data register (bytes on the wire)",
    "//                      +0x8 SR     status (started / acked / busy)",
    "//",
    "// ACRONYM DECODER (every one of these is standard firmware-speak):",
    "//   MMIO  Memory-Mapped I/O — hardware reached via memory addresses",
    "//   ISR   Interrupt Service Routine — function the CPU runs when an",
    "//         interrupt fires; it pauses the main loop to do so",
    "//   NVIC  Nested Vectored Interrupt Controller — the chip block",
    "//         that prioritises and dispatches interrupts",
    "//   EXTI  External Interrupt — \"a pin changed state\" interrupt",
    "//   MODER/IDR/ODR — GPIO Mode / Input Data / Output Data registers",
    "//",
    "// HOW TO READ THE OUTPUT: the firmware runs a superloop for 300",
    "// simulated ticks. Quiet ticks print nothing. Watch for lines like",
    "//   [tick 200] --- IRQ EXTI (prio 0) -> ISR start ---",
    "// which mean \"the hardware tapped the CPU on the shoulder; the",
    "// main loop is paused while the ISR (indented lines) runs.\"",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "// ── tiny seeded random number generator ─────────────────────────",
    "// mulberry32: same seed -> same sequence, every run, forever.",
    "// The accelerometer uses it for \"sensor wiggle\" so this demo is",
    "// deterministic: run it twice, the output is identical.",
    "function mulberry32(seed) {",
    "  var a = seed >>> 0;",
    "  return function () {",
    "    a |= 0; a = (a + 0x6D2B79F5) | 0;",
    "    var t = Math.imul(a ^ (a >>> 15), 1 | a);",
    "    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
    "    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;",
    "  };",
    "}",
    "var rng = mulberry32(0xC0FFEE);",
    "",
    "// ── register addresses (the \"datasheet\" of our fake chip) ─────",
    "var GPIO_BASE = 0x40000000, TIM_BASE = 0x40001000;",
    "var UART_BASE = 0x40002000, I2C_BASE = 0x40003000;",
    "",
    "var GPIO_MODER = GPIO_BASE + 0x0, GPIO_IDR = GPIO_BASE + 0x4, GPIO_ODR = GPIO_BASE + 0x8;",
    "var TIM_CR = TIM_BASE + 0x0, TIM_CNT = TIM_BASE + 0x4, TIM_ARR = TIM_BASE + 0x8;",
    "var UART_SR = UART_BASE + 0x0, UART_TXDR = UART_BASE + 0x4, UART_RXDR = UART_BASE + 0x8;",
    "var I2C_CR = I2C_BASE + 0x0, I2C_DR = I2C_BASE + 0x4, I2C_SR = I2C_BASE + 0x8;",
    "",
    "var LED_PIN = 5;    // an output pin we can light up (like PA5 on STM32 boards)",
    "var BTN_PIN = 0;    // an input pin wired to a pretend push-button",
    "",
    "function hex2(n) { return (\"0\" + (n & 0xFF).toString(16).toUpperCase()).slice(-2); }",
    "function hex8(n) { return \"0x\" + (\"00000000\" + (n >>> 0).toString(16).toUpperCase()).slice(-8); }",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// PERIPHERAL MODELS. Each one owns some registers and a little",
    "// internal state. The firmware below may ONLY reach them through",
    "// mmioRead / mmioWrite — exactly like real hardware.",
    "// ═════════════════════════════════════════════════════════════════",
    "",
    "// ── GPIO: pins, modes, and the outside world's button wire ────",
    "var gpio = { moder: 0, idr: 0, odr: 0 }; // idr = levels the world drives IN",
    "",
    "function gpioOutMask() {",
    "  // MODER spends 2 bits per pin; mode 01 means \"output\"",
    "  var m = 0;",
    "  for (var p = 0; p < 16; p++) if (((gpio.moder >> (2 * p)) & 3) === 1) m |= (1 << p);",
    "  return m;",
    "}",
    "function gpioWrite(addr, value) {",
    "  if (addr === GPIO_MODER) { gpio.moder = value; return; }",
    "  if (addr === GPIO_ODR)   { gpio.odr = value; return; }",
    "  if (addr === GPIO_IDR)   { console.log(\"  (gpio: IDR is read-only — write ignored, as on real hardware)\"); return; }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "function gpioRead(addr) {",
    "  if (addr === GPIO_MODER) return gpio.moder;",
    "  if (addr === GPIO_ODR)   return gpio.odr;",
    "  if (addr === GPIO_IDR) {",
    "    // input pins show the outside world; output pins read back what we drive",
    "    var om = gpioOutMask();",
    "    return (gpio.idr & ~om) | (gpio.odr & om);",
    "  }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "",
    "// ── TIMER: counts up every tick, interrupts at ARR ────────────",
    "var timer = { cr: 0, cnt: 0, arr: 0 };",
    "function timWrite(addr, value) {",
    "  if (addr === TIM_CR)  { timer.cr = value; return; }",
    "  if (addr === TIM_CNT) { timer.cnt = value; return; }",
    "  if (addr === TIM_ARR) { timer.arr = value; return; }",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function timRead(addr) {",
    "  if (addr === TIM_CR)  return timer.cr;",
    "  if (addr === TIM_CNT) return timer.cnt;",
    "  if (addr === TIM_ARR) return timer.arr;",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function tickTimer() { // called once per simulated tick by the main loop",
    "  if (!(timer.cr & 1)) return;              // enable bit off -> frozen",
    "  timer.cnt++;",
    "  if (timer.cnt >= timer.arr) {             // reached the reload value...",
    "    timer.cnt = 0;                          // ...wrap to zero...",
    "    pendIrq('TIMER');                       // ...and tap the CPU",
    "  }",
    "}",
    "",
    "// ── UART: a serial port with a TX log and an RX ring buffer ───",
    "// Incoming bytes land in a small ring (same idea as ring-buffer.js:",
    "// fixed memory, head writes, tail reads, wrap around the circle).",
    "// The \"wire\" side is driven by the stimulus schedule further down.",
    "var rxRing = { cap: 8, buf: [], head: 0, tail: 0, count: 0, dropped: 0 };",
    "var uartTxLog = \"\", uartTxCount = 0, uartRxCount = 0, rxMessage = \"\";",
    "",
    "function uartWrite(addr, value) {",
    "  if (addr === UART_TXDR) {",
    "    var ch = String.fromCharCode(value & 0xFF);",
    "    uartTxLog += ch; uartTxCount++;",
    "    console.log(\"  uart TX -> \" + JSON.stringify(ch) + \" (0x\" + hex2(value) + \")\");",
    "    return;",
    "  }",
    "  if (addr === UART_SR || addr === UART_RXDR) { console.log(\"  (uart: that register is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartRead(addr) {",
    "  if (addr === UART_SR) return (rxRing.count > 0 ? 1 : 0) | 2; // RXNE | TXE(always ready)",
    "  if (addr === UART_RXDR) {",
    "    if (rxRing.count === 0) return -1;",
    "    var b = rxRing.buf[rxRing.tail];",
    "    rxRing.tail = (rxRing.tail + 1) % rxRing.cap;",
    "    rxRing.count--;",
    "    return b;",
    "  }",
    "  if (addr === UART_TXDR) return 0;",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartReceiveByte(ch) { // the outside world sends us a byte",
    "  if (rxRing.count === rxRing.cap) { rxRing.dropped++; }",
    "  else {",
    "    rxRing.buf[rxRing.head] = ch.charCodeAt(0);",
    "    rxRing.head = (rxRing.head + 1) % rxRing.cap;",
    "    rxRing.count++;",
    "  }",
    "  pendIrq('UART_RX'); // \"a byte arrived\" is itself an interrupt",
    "}",
    "",
    "// ── I2C accelerometer: an MPU-6050-style slave at address 0x68 ─",
    "// The slave is an explicit STATE MACHINE. It understands nothing",
    "// until the master drives it through START -> address -> register",
    "// pointer -> data. WHO_AM_I (0x75) answers 0x68: \"yes, I'm here.\"",
    "var ACCEL_ADDR = 0x68, ACCEL_WHOAMI = 0x75, ACCEL_DATA = 0x3B;",
    "var accel = { regs: [], ptr: 0, state: 'IDLE' }; // states: IDLE ADDR REG_PTR DATA_WR DATA_RD",
    "for (var ai = 0; ai < 128; ai++) accel.regs.push(0);",
    "accel.regs[ACCEL_WHOAMI] = 0x68;",
    "",
    "var i2cFlags = { sb: false, addr: false, nack: false, busy: false, ack: false };",
    "var I2C_CR_START = 1, I2C_CR_STOP = 2, I2C_CR_ACK = 4;",
    "",
    "function accelPut16(reg, val) { // one int16 sensor value -> two register bytes, big-endian",
    "  var u = val & 0xFFFF;",
    "  accel.regs[reg] = (u >> 8) & 0xFF;",
    "  accel.regs[reg + 1] = u & 0xFF;",
    "}",
    "function accelUpdate(tick) { // the sensor's own sampling: slow sine drift + seeded wiggle",
    "  accelPut16(0x3B, Math.round(900 * Math.sin(tick * 0.021) + (rng() * 300 - 150)));",
    "  accelPut16(0x3D, Math.round(500 * Math.sin(tick * 0.013 + 1.7) + (rng() * 300 - 150)));",
    "  accelPut16(0x3F, Math.round(16384 + 300 * Math.sin(tick * 0.017 + 0.4) + (rng() * 200 - 100)));",
    "}",
    "function decodeI16(hi, lo) { var v = ((hi << 8) | lo); return v >= 32768 ? v - 65536 : v; }",
    "",
    "function i2cWrite(addr, value) {",
    "  if (addr === I2C_CR) {",
    "    i2cFlags.ack = !!(value & I2C_CR_ACK);",
    "    if (value & I2C_CR_START) {",
    "      console.log(accel.state === 'IDLE' ? \"  i2c: START\" : \"  i2c: REPEATED START\");",
    "      accel.state = 'ADDR';",
    "      i2cFlags.sb = true; i2cFlags.busy = true; i2cFlags.addr = false; i2cFlags.nack = false;",
    "    }",
    "    if (value & I2C_CR_STOP) {",
    "      console.log(\"  i2c: STOP\");",
    "      accel.state = 'IDLE';",
    "      i2cFlags.sb = i2cFlags.addr = i2cFlags.nack = i2cFlags.busy = false;",
    "    }",
    "    return;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state === 'ADDR') {",
    "      var a7 = (value >> 1) & 0x7F, rw = value & 1;",
    "      if (a7 === ACCEL_ADDR) {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> slave ACK\");",
    "        accel.state = rw ? 'DATA_RD' : 'REG_PTR';",
    "        i2cFlags.addr = true;",
    "      } else {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> NACK (nobody at that address)\");",
    "        i2cFlags.nack = true;",
    "      }",
    "      return;",
    "    }",
    "    if (accel.state === 'REG_PTR') {",
    "      accel.ptr = value & 0x7F;",
    "      console.log(\"  i2c: register pointer = 0x\" + hex2(value) + \" -> slave ACK\");",
    "      accel.state = 'DATA_WR';",
    "      return;",
    "    }",
    "    if (accel.state === 'DATA_WR') {",
    "      accel.regs[accel.ptr] = value & 0xFF;",
    "      console.log(\"  i2c: wrote 0x\" + hex2(value) + \" into reg 0x\" + hex2(accel.ptr));",
    "      accel.ptr = (accel.ptr + 1) & 0x7F;",
    "      return;",
    "    }",
    "    console.log(\"  i2c: (DR written outside a transaction — ignored)\");",
    "    return;",
    "  }",
    "  if (addr === I2C_SR) { console.log(\"  (i2c: SR is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "function i2cRead(addr) {",
    "  if (addr === I2C_SR) {",
    "    var sr = 0;",
    "    if (i2cFlags.sb) sr |= 1;",
    "    if (i2cFlags.addr) sr |= 2;",
    "    if (i2cFlags.nack) sr |= 4;",
    "    if (i2cFlags.busy) sr |= 8;",
    "    return sr;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state !== 'DATA_RD') { console.log(\"  i2c: (read with no sender — bus floats high, 0xFF)\"); return 0xFF; }",
    "    var b = accel.regs[accel.ptr];",
    "    accel.ptr = (accel.ptr + 1) & 0x7F;",
    "    console.log(\"  i2c: read 0x\" + hex2(b) + (i2cFlags.ack ? \" -> master ACK (send another)\" : \" -> master NACK (that's all)\"));",
    "    return b;",
    "  }",
    "  if (addr === I2C_CR) return 0;",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "",
    "// ── the MMIO bus itself ────────────────────────────────────────",
    "// One door into every peripheral. Wrong address = bus fault, and",
    "// the CPU hears about it immediately (a thrown error here; a",
    "// HardFault exception on real silicon).",
    "function mmioWrite(addr, value) {",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioWrite(addr, value);",
    "  if (block === TIM_BASE) return timWrite(addr, value);",
    "  if (block === UART_BASE) return uartWrite(addr, value);",
    "  if (block === I2C_BASE) return i2cWrite(addr, value);",
    "  throw new Error(\"BUS FAULT: mmioWrite to unmapped address \" + hex8(addr));",
    "}",
    "function mmioRead(addr) {",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioRead(addr);",
    "  if (block === TIM_BASE) return timRead(addr);",
    "  if (block === UART_BASE) return uartRead(addr);",
    "  if (block === I2C_BASE) return i2cRead(addr);",
    "  throw new Error(\"BUS FAULT: mmioRead from unmapped address \" + hex8(addr));",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// NVIC: the interrupt controller. Priorities are numbers where",
    "// LOWER wins (0 is the most urgent). Real NVIC hardware can nest",
    "// a high-priority ISR inside a low-priority one (preemption);",
    "// this simulator simplifies: ISRs run to completion, highest",
    "// priority first, then the main loop resumes. The visible effect",
    "// — \"urgent events jump the queue\" — is the same.",
    "// ═════════════════════════════════════════════════════════════════",
    "var IRQ_PRIO = { EXTI: 0, UART_RX: 1, TIMER: 2 };",
    "var irqPending = { EXTI: false, UART_RX: false, TIMER: false };",
    "var irqHandlers = {};",
    "var irqCounts = { EXTI: 0, UART_RX: 0, TIMER: 0 };",
    "",
    "function onInterrupt(name, fn) { irqHandlers[name] = fn; }",
    "function pendIrq(name) { irqPending[name] = true; }",
    "function dispatchInterrupts(tick) {",
    "  var queueAnnounced = false;",
    "  for (;;) {",
    "    var waiting = [];",
    "    for (var name in irqPending) if (irqPending[name]) waiting.push(name);",
    "    if (!waiting.length) return; // nobody waiting: back to the main loop",
    "    waiting.sort(function (a, b) { return IRQ_PRIO[a] - IRQ_PRIO[b]; });",
    "    if (waiting.length > 1 && !queueAnnounced) {",
    "      queueAnnounced = true;",
    "      var parts = [];",
    "      for (var i = 0; i < waiting.length; i++) parts.push(waiting[i] + \" prio \" + IRQ_PRIO[waiting[i]]);",
    "      console.log(\"[tick \" + tick + \"] \" + waiting.length + \" interrupts pending at once (\" +",
    "                  parts.join(\", \") + \") — lowest priority number runs first\");",
    "    }",
    "    var best = waiting[0];",
    "    irqPending[best] = false;  // clear BEFORE running, so an ISR may re-pend itself",
    "    irqCounts[best]++;",
    "    console.log(\"[tick \" + tick + \"] --- IRQ \" + best + \" (prio \" + IRQ_PRIO[best] + \") -> ISR start ---\");",
    "    if (irqHandlers[best]) irqHandlers[best]();",
    "    console.log(\"[tick \" + tick + \"] --- ISR end, resuming main loop ---\");",
    "  }",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// THE FIRMWARE. From here down, EVERYTHING talks to the chip",
    "// through mmioRead / mmioWrite — no peeking at the models above.",
    "// This is what would be flashed onto the microcontroller.",
    "// ═════════════════════════════════════════════════════════════════",
    "var ledToggles = 0, sampleCount = 0;",
    "",
    "function isrTimer() { // blink the LED: read-modify-write on ODR, MMIO style",
    "  mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) ^ (1 << LED_PIN));",
    "  ledToggles++;",
    "  console.log(\"  timer isr: LED now \" + (((mmioRead(GPIO_ODR) >> LED_PIN) & 1) ? \"ON\" : \"off\"));",
    "}",
    "function isrExti() { // the button pin changed state",
    "  var pressed = (mmioRead(GPIO_IDR) >> BTN_PIN) & 1;",
    "  if (pressed) {",
    "    console.log(\"  exti isr: button PRESSED — queuing a message on the UART\");",
    "    var msg = \"BUTTON!\\n\";",
    "    for (var i = 0; i < msg.length; i++) mmioWrite(UART_TXDR, msg.charCodeAt(i));",
    "  } else {",
    "    console.log(\"  exti isr: button released (no message needed)\");",
    "  }",
    "}",
    "function isrUartRx() { // drain the RX ring into a message buffer",
    "  while (mmioRead(UART_SR) & 1) { // while RXNE: a byte is waiting",
    "    var ch = String.fromCharCode(mmioRead(UART_RXDR));",
    "    rxMessage += ch; uartRxCount++;",
    "    console.log(\"  uart rx isr: drained \" + JSON.stringify(ch) + \" from the ring\");",
    "  }",
    "}",
    "",
    "// an I2C master transaction: read n bytes starting at register reg",
    "function i2cReadBytes(reg, n) {",
    "  var out = [];",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // START",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 0);   // address + Write",
    "  mmioWrite(I2C_DR, reg);                     // which register we want",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // REPEATED START (no STOP: same conversation)",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 1);   // address + Read",
    "  for (var i = 0; i < n; i++) {",
    "    mmioWrite(I2C_CR, (i === n - 1) ? 0 : I2C_CR_ACK); // ACK every byte except the last",
    "    out.push(mmioRead(I2C_DR));",
    "  }",
    "  mmioWrite(I2C_CR, I2C_CR_STOP);             // STOP",
    "  return out;",
    "}",
    "function i2cReadAccel(tick) {",
    "  accelUpdate(tick); // (sim cheat: the sensor refreshed its own data registers)",
    "  var b = i2cReadBytes(ACCEL_DATA, 6);",
    "  var raw = [];",
    "  for (var i = 0; i < b.length; i++) raw.push(\"0x\" + hex2(b[i]));",
    "  console.log(\"  raw register bytes: \" + raw.join(\" \") + \"  (high byte, low byte, x3 axes)\");",
    "  var x = decodeI16(b[0], b[1]), y = decodeI16(b[2], b[3]), z = decodeI16(b[4], b[5]);",
    "  console.log(\"  decoded accel: X=\" + (x / 16384).toFixed(3) + \"g  Y=\" + (y / 16384).toFixed(3) +",
    "              \"g  Z=\" + (z / 16384).toFixed(3) + \"g   (16384 counts = 1g)\");",
    "  sampleCount++;",
    "}",
    "",
    "// ── boot: configure the peripherals, firmware-style ─────────",
    "console.log(\"=== peripheral-vm firmware booting ===\");",
    "mmioWrite(GPIO_MODER, mmioRead(GPIO_MODER) | (1 << (LED_PIN * 2))); // 2 bits/pin: 01 = output",
    "mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) & ~(1 << LED_PIN));           // LED starts off",
    "console.log(\"gpio: pin \" + LED_PIN + \" configured as output (MODER = \" + hex8(mmioRead(GPIO_MODER)) + \"), LED off\");",
    "",
    "mmioWrite(TIM_ARR, 40);   // counter climbs 1..ARR, interrupts, wraps — every 40 ticks",
    "mmioWrite(TIM_CR, 1);     // enable",
    "console.log(\"timer: ARR=40, enabled — the LED will blink itself via interrupts\");",
    "",
    "onInterrupt('TIMER', isrTimer);",
    "onInterrupt('EXTI', isrExti);",
    "onInterrupt('UART_RX', isrUartRx);",
    "console.log(\"nvic: ISRs registered (EXTI prio 0 > UART_RX prio 1 > TIMER prio 2)\");",
    "",
    "console.log(\"i2c: checking the accelerometer is really there (WHO_AM_I)...\");",
    "var who = i2cReadBytes(ACCEL_WHOAMI, 1);",
    "console.log(\"  WHO_AM_I = 0x\" + hex2(who[0]) + (who[0] === ACCEL_ADDR ? \" — sensor found, address matches\" : \" — WRONG CHIP?!\"));",
    "",
    "try { // poke an address where nothing lives, to see a bus fault",
    "  mmioRead(0x40009000);",
    "} catch (e) {",
    "  console.log(\"bus fault demo: caught [\" + e.message + \"] — on silicon this is a HardFault\");",
    "}",
    "console.log(\"\");",
    "",
    "// ── the outside world: a schedule of scheduled pokes ─────────",
    "// The button is held for ticks 200..215; five UART bytes arrive",
    "// every 5 ticks from 230. Everything else is the peripherals'",
    "// own doing. (Real inputs would arrive whenever they wanted —",
    "// which is precisely why interrupts exist.)",
    "var BTN_PRESS = 200, BTN_RELEASE = 216;",
    "var RX_SCHEDULE = { 230: 'P', 235: 'I', 240: 'N', 245: 'G', 250: '\\n' };",
    "var TOTAL_TICKS = 300, prevBtn = 0;",
    "",
    "console.log(\"=== running the superloop for \" + TOTAL_TICKS + \" ticks ===\");",
    "for (var tick = 1; tick <= TOTAL_TICKS; tick++) {",
    "  // 1. the outside world pokes the hardware",
    "  if (tick >= BTN_PRESS && tick < BTN_RELEASE) gpio.idr |= (1 << BTN_PIN);",
    "  else gpio.idr &= ~(1 << BTN_PIN);",
    "  var nowBtn = (gpio.idr >> BTN_PIN) & 1;",
    "  if (nowBtn !== prevBtn) { pendIrq('EXTI'); prevBtn = nowBtn; } // EXTI sees edges",
    "  if (RX_SCHEDULE[tick] !== undefined) uartReceiveByte(RX_SCHEDULE[tick]);",
    "",
    "  // 2. the hardware advances on its own",
    "  tickTimer();",
    "",
    "  // 3. the CPU services interrupts, most urgent first",
    "  dispatchInterrupts(tick);",
    "",
    "  // 4. one superloop iteration of foreground work",
    "  if (tick % 60 === 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: periodic sensor read\");",
    "    i2cReadAccel(tick);",
    "  }",
    "  if (rxMessage.indexOf(\"\\n\") >= 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: complete UART message: \" + JSON.stringify(rxMessage.replace(\"\\n\", \"\")) + \" — parsed by the main loop, not the ISR\");",
    "    rxMessage = \"\";",
    "  }",
    "}",
    "",
    "console.log(\"\");",
    "console.log(\"=================== SUMMARY ===================\");",
    "console.log(\"ticks simulated:          \" + TOTAL_TICKS);",
    "console.log(\"TIMER interrupts:         \" + irqCounts.TIMER + \"  (LED toggled \" + ledToggles + \" times)\");",
    "console.log(\"EXTI interrupts (button): \" + irqCounts.EXTI + \"  (press + release)\");",
    "console.log(\"UART_RX interrupts:       \" + irqCounts.UART_RX + \"  (one per received byte)\");",
    "console.log(\"UART TX: \" + uartTxCount + \" bytes -> \" + JSON.stringify(uartTxLog));",
    "console.log(\"UART RX: \" + uartRxCount + \" bytes drained, \" + rxRing.dropped + \" dropped to overflow\");",
    "console.log(\"accelerometer samples:    \" + sampleCount + \" (via full I2C transactions)\");",
    "console.log(\"===============================================\");",
    "console.log(\"notice: the main loop NEVER polled for the button or the UART\");",
    "console.log(\"bytes. Events came to it. That is the whole point of interrupts.\");",
    "",
    "// ─────────────────────────────────────────────────────────────────",
    "// THE BRIDGE TO SPIKING NEURAL NETWORKS",
    "//",
    "// A spike and an interrupt are the same idea in different clothes.",
    "// Both are DISCRETE EVENTS: nothing happens, nothing happens...",
    "// then one event arrives and state changes. The main loop above",
    "// never polled the button or the serial wire — events came to IT,",
    "// exactly like a neuron that sits silent until incoming spikes",
    "// push it over threshold. Event-driven silicon (this pretend chip)",
    "// and event-driven brains (your Nengo networks) save energy the",
    "// same way: by doing nothing until it matters.",
    "// ─────────────────────────────────────────────────────────────────",
  ].join('\n');

  /* v10 edition (kept only as a fingerprint for the safe upgrade below) */
  var PERIPHERAL_VM_SRC_V10 = [
    "// ─────────────────────────────────────────────────────────────────",
    "// Microcontroller preset: Register & Peripheral Simulation VM",
    "//",
    "// Real firmware almost never touches the CPU instruction set",
    "// directly. It CONFIGURES PERIPHERALS — the GPIO pins, timers,",
    "// UART serial ports and I2C buses sitting next to the CPU — by",
    "// reading and writing REGISTERS at fixed memory addresses. That",
    "// is called MMIO: Memory-Mapped Input/Output.",
    "//",
    "// This file builds a tiny make-believe chip and then writes",
    "// make-believe FIRMWARE for it, in the same style you would write",
    "// for an STM32: poke registers through the bus, let peripherals",
    "// run on their own, and get interrupted when something happens.",
    "//",
    "// ADDRESS MAP (every access goes through mmioRead / mmioWrite):",
    "//",
    "//   0x20000000  SRAM   256 bytes of scratch RAM (variables, buffers)",
    "//   0x40000000  GPIO   +0x0 MODER  pin modes (2 bits per pin)",
    "//                      +0x4 IDR    input data  (read-only)",
    "//                      +0x8 ODR    output data (what we drive out)",
    "//   0x40001000  TIMER  +0x0 CR     control (bit 0 = enable)",
    "//                      +0x4 CNT    counter, climbs every tick",
    "//                      +0x8 ARR    auto-reload: interrupt at this count",
    "//   0x40002000  UART   +0x0 SR     status (bit 0 = RX byte waiting)",
    "//                      +0x4 TXDR   write a byte -> it is transmitted",
    "//                      +0x8 RXDR   read -> pops the oldest RX byte",
    "//   0x40003000  I2C    +0x0 CR     control (START / STOP / ACK bits)",
    "//                      +0x4 DR     data register (bytes on the wire)",
    "//                      +0x8 SR     status (started / acked / busy)",
    "//",
    "// ACRONYM DECODER (every one of these is standard firmware-speak):",
    "//   MMIO  Memory-Mapped I/O — hardware reached via memory addresses",
    "//   ISR   Interrupt Service Routine — function the CPU runs when an",
    "//         interrupt fires; it pauses the main loop to do so",
    "//   NVIC  Nested Vectored Interrupt Controller — the chip block",
    "//         that prioritises and dispatches interrupts",
    "//   EXTI  External Interrupt — \"a pin changed state\" interrupt",
    "//   MODER/IDR/ODR — GPIO Mode / Input Data / Output Data registers",
    "//   SRAM  Static RAM — the chip's small, forgetful scratch memory",
    "//   HEX DUMP — memory printed as hex bytes AND as readable text",
    "//   LOGIC ANALYZER — a recorder that watches wires as high/low",
    "//        over time (Saleae/Sigrok style); ours draws ASCII waves",
    "//",
    "// V10 EDITION: the chip gains a debugger's toolkit. dump_registers()",
    "// and dump_hex_memory() freeze it and print its insides; a logic",
    "// analyzer trace (plot_trace) draws its wires as ASCII waveforms —",
    "// including one wire driven by a spiking neuron. Watch for them at",
    "// boot and again at the end of the run.",
    "//",
    "// HOW TO READ THE OUTPUT: the firmware runs a superloop for 300",
    "// simulated ticks. Quiet ticks print nothing. Watch for lines like",
    "//   [tick 200] --- IRQ EXTI (prio 0) -> ISR start ---",
    "// which mean \"the hardware tapped the CPU on the shoulder; the",
    "// main loop is paused while the ISR (indented lines) runs.\"",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "// ── tiny seeded random number generator ─────────────────────────",
    "// mulberry32: same seed -> same sequence, every run, forever.",
    "// The accelerometer uses it for \"sensor wiggle\" so this demo is",
    "// deterministic: run it twice, the output is identical.",
    "function mulberry32(seed) {",
    "  var a = seed >>> 0;",
    "  return function () {",
    "    a |= 0; a = (a + 0x6D2B79F5) | 0;",
    "    var t = Math.imul(a ^ (a >>> 15), 1 | a);",
    "    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
    "    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;",
    "  };",
    "}",
    "var rng = mulberry32(0xC0FFEE);",
    "",
    "// ── register addresses (the \"datasheet\" of our fake chip) ─────",
    "var GPIO_BASE = 0x40000000, TIM_BASE = 0x40001000;",
    "var UART_BASE = 0x40002000, I2C_BASE = 0x40003000;",
    "",
    "var GPIO_MODER = GPIO_BASE + 0x0, GPIO_IDR = GPIO_BASE + 0x4, GPIO_ODR = GPIO_BASE + 0x8;",
    "var TIM_CR = TIM_BASE + 0x0, TIM_CNT = TIM_BASE + 0x4, TIM_ARR = TIM_BASE + 0x8;",
    "var UART_SR = UART_BASE + 0x0, UART_TXDR = UART_BASE + 0x4, UART_RXDR = UART_BASE + 0x8;",
    "var I2C_CR = I2C_BASE + 0x0, I2C_DR = I2C_BASE + 0x4, I2C_SR = I2C_BASE + 0x8;",
    "",
    "// the SRAM map: where the firmware keeps things in RAM",
    "var SRAM_BASE = 0x20000000, SRAM_SIZE = 256;",
    "var SRAM_BANNER = SRAM_BASE + 0x00;  // boot banner string (find it in the hex dump)",
    "var SRAM_RXBUF  = SRAM_BASE + 0x40;  // UART RX bytes, copied here by the RX ISR",
    "var SRAM_SAMPLE = SRAM_BASE + 0x60;  // newest accel sample (6 raw bytes)",
    "var SRAM_WHOAMI = SRAM_BASE + 0x70;  // the WHO_AM_I answer byte, kept as evidence",
    "",
    "var LED_PIN = 5;    // an output pin we can light up (like PA5 on STM32 boards)",
    "var BTN_PIN = 0;    // an input pin wired to a pretend push-button",
    "",
    "function hex2(n) { return (\"0\" + (n & 0xFF).toString(16).toUpperCase()).slice(-2); }",
    "function hex8(n) { return \"0x\" + (\"00000000\" + (n >>> 0).toString(16).toUpperCase()).slice(-8); }",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// PERIPHERAL MODELS. Each one owns some registers and a little",
    "// internal state. The firmware below may ONLY reach them through",
    "// mmioRead / mmioWrite — exactly like real hardware.",
    "// ═════════════════════════════════════════════════════════════════",
    "",
    "// ── GPIO: pins, modes, and the outside world's button wire ────",
    "var gpio = { moder: 0, idr: 0, odr: 0 }; // idr = levels the world drives IN",
    "",
    "function gpioOutMask() {",
    "  // MODER spends 2 bits per pin; mode 01 means \"output\"",
    "  var m = 0;",
    "  for (var p = 0; p < 16; p++) if (((gpio.moder >> (2 * p)) & 3) === 1) m |= (1 << p);",
    "  return m;",
    "}",
    "function gpioWrite(addr, value) {",
    "  if (addr === GPIO_MODER) { gpio.moder = value; return; }",
    "  if (addr === GPIO_ODR)   { gpio.odr = value; return; }",
    "  if (addr === GPIO_IDR)   { console.log(\"  (gpio: IDR is read-only — write ignored, as on real hardware)\"); return; }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "function gpioRead(addr) {",
    "  if (addr === GPIO_MODER) return gpio.moder;",
    "  if (addr === GPIO_ODR)   return gpio.odr;",
    "  if (addr === GPIO_IDR) {",
    "    // input pins show the outside world; output pins read back what we drive",
    "    var om = gpioOutMask();",
    "    return (gpio.idr & ~om) | (gpio.odr & om);",
    "  }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "",
    "// ── SRAM: 256 bytes of scratch RAM at 0x20000000 ────────────",
    "// SRAM (Static RAM) is the chip's working memory: fast, small,",
    "// and totally forgetful — cut the power and it's gone. Firmware",
    "// keeps its variables, serial buffers and sensor samples in it.",
    "// The firmware below stores a boot banner, the UART RX message",
    "// and the newest sensor sample here, so dump_hex_memory() has",
    "// real content to show you. (Real STM32 SRAM really does start",
    "// at 0x20000000 — that address is not made up.)",
    "var sram = [];",
    "for (var zi = 0; zi < SRAM_SIZE; zi++) sram.push(0);",
    "function sramWrite(addr, value) { sram[addr - SRAM_BASE] = value & 0xFF; }",
    "function sramRead(addr) { return sram[addr - SRAM_BASE]; }",
    "",
    "// ── TIMER: counts up every tick, interrupts at ARR ────────────",
    "var timer = { cr: 0, cnt: 0, arr: 0 };",
    "function timWrite(addr, value) {",
    "  if (addr === TIM_CR)  { timer.cr = value; return; }",
    "  if (addr === TIM_CNT) { timer.cnt = value; return; }",
    "  if (addr === TIM_ARR) { timer.arr = value; return; }",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function timRead(addr) {",
    "  if (addr === TIM_CR)  return timer.cr;",
    "  if (addr === TIM_CNT) return timer.cnt;",
    "  if (addr === TIM_ARR) return timer.arr;",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function tickTimer() { // called once per simulated tick by the main loop",
    "  if (!(timer.cr & 1)) return;              // enable bit off -> frozen",
    "  timer.cnt++;",
    "  if (timer.cnt >= timer.arr) {             // reached the reload value...",
    "    timer.cnt = 0;                          // ...wrap to zero...",
    "    pendIrq('TIMER');                       // ...and tap the CPU",
    "  }",
    "}",
    "",
    "// ── UART: a serial port with a TX log and an RX ring buffer ───",
    "// Incoming bytes land in a small ring (same idea as ring-buffer.js:",
    "// fixed memory, head writes, tail reads, wrap around the circle).",
    "// The \"wire\" side is driven by the stimulus schedule further down.",
    "var rxRing = { cap: 8, buf: [], head: 0, tail: 0, count: 0, dropped: 0 };",
    "var uartTxLog = \"\", uartTxCount = 0, uartRxCount = 0, rxMessage = \"\";",
    "",
    "function uartWrite(addr, value) {",
    "  if (addr === UART_TXDR) {",
    "    var ch = String.fromCharCode(value & 0xFF);",
    "    uartTxLog += ch; uartTxCount++;",
    "    console.log(\"  uart TX -> \" + JSON.stringify(ch) + \" (0x\" + hex2(value) + \")\");",
    "    return;",
    "  }",
    "  if (addr === UART_SR || addr === UART_RXDR) { console.log(\"  (uart: that register is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartRead(addr) {",
    "  if (addr === UART_SR) return (rxRing.count > 0 ? 1 : 0) | 2; // RXNE | TXE(always ready)",
    "  if (addr === UART_RXDR) {",
    "    if (rxRing.count === 0) return -1;",
    "    var b = rxRing.buf[rxRing.tail];",
    "    rxRing.tail = (rxRing.tail + 1) % rxRing.cap;",
    "    rxRing.count--;",
    "    return b;",
    "  }",
    "  if (addr === UART_TXDR) return 0;",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartReceiveByte(ch) { // the outside world sends us a byte",
    "  if (rxRing.count === rxRing.cap) { rxRing.dropped++; }",
    "  else {",
    "    rxRing.buf[rxRing.head] = ch.charCodeAt(0);",
    "    rxRing.head = (rxRing.head + 1) % rxRing.cap;",
    "    rxRing.count++;",
    "  }",
    "  pendIrq('UART_RX'); // \"a byte arrived\" is itself an interrupt",
    "}",
    "",
    "// ── I2C accelerometer: an MPU-6050-style slave at address 0x68 ─",
    "// The slave is an explicit STATE MACHINE. It understands nothing",
    "// until the master drives it through START -> address -> register",
    "// pointer -> data. WHO_AM_I (0x75) answers 0x68: \"yes, I'm here.\"",
    "var ACCEL_ADDR = 0x68, ACCEL_WHOAMI = 0x75, ACCEL_DATA = 0x3B;",
    "var accel = { regs: [], ptr: 0, state: 'IDLE' }; // states: IDLE ADDR REG_PTR DATA_WR DATA_RD",
    "for (var ai = 0; ai < 128; ai++) accel.regs.push(0);",
    "accel.regs[ACCEL_WHOAMI] = 0x68;",
    "",
    "var i2cFlags = { sb: false, addr: false, nack: false, busy: false, ack: false };",
    "var I2C_CR_START = 1, I2C_CR_STOP = 2, I2C_CR_ACK = 4;",
    "",
    "function accelPut16(reg, val) { // one int16 sensor value -> two register bytes, big-endian",
    "  var u = val & 0xFFFF;",
    "  accel.regs[reg] = (u >> 8) & 0xFF;",
    "  accel.regs[reg + 1] = u & 0xFF;",
    "}",
    "function accelUpdate(tick) { // the sensor's own sampling: slow sine drift + seeded wiggle",
    "  accelPut16(0x3B, Math.round(900 * Math.sin(tick * 0.021) + (rng() * 300 - 150)));",
    "  accelPut16(0x3D, Math.round(500 * Math.sin(tick * 0.013 + 1.7) + (rng() * 300 - 150)));",
    "  accelPut16(0x3F, Math.round(16384 + 300 * Math.sin(tick * 0.017 + 0.4) + (rng() * 200 - 100)));",
    "}",
    "function decodeI16(hi, lo) { var v = ((hi << 8) | lo); return v >= 32768 ? v - 65536 : v; }",
    "",
    "function i2cWrite(addr, value) {",
    "  if (addr === I2C_CR) {",
    "    i2cFlags.ack = !!(value & I2C_CR_ACK);",
    "    if (value & I2C_CR_START) {",
    "      console.log(accel.state === 'IDLE' ? \"  i2c: START\" : \"  i2c: REPEATED START\");",
    "      accel.state = 'ADDR';",
    "      i2cFlags.sb = true; i2cFlags.busy = true; i2cFlags.addr = false; i2cFlags.nack = false;",
    "    }",
    "    if (value & I2C_CR_STOP) {",
    "      console.log(\"  i2c: STOP\");",
    "      accel.state = 'IDLE';",
    "      i2cFlags.sb = i2cFlags.addr = i2cFlags.nack = i2cFlags.busy = false;",
    "    }",
    "    return;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state === 'ADDR') {",
    "      var a7 = (value >> 1) & 0x7F, rw = value & 1;",
    "      if (a7 === ACCEL_ADDR) {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> slave ACK\");",
    "        accel.state = rw ? 'DATA_RD' : 'REG_PTR';",
    "        i2cFlags.addr = true;",
    "      } else {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> NACK (nobody at that address)\");",
    "        i2cFlags.nack = true;",
    "      }",
    "      return;",
    "    }",
    "    if (accel.state === 'REG_PTR') {",
    "      accel.ptr = value & 0x7F;",
    "      console.log(\"  i2c: register pointer = 0x\" + hex2(value) + \" -> slave ACK\");",
    "      accel.state = 'DATA_WR';",
    "      return;",
    "    }",
    "    if (accel.state === 'DATA_WR') {",
    "      accel.regs[accel.ptr] = value & 0xFF;",
    "      console.log(\"  i2c: wrote 0x\" + hex2(value) + \" into reg 0x\" + hex2(accel.ptr));",
    "      accel.ptr = (accel.ptr + 1) & 0x7F;",
    "      return;",
    "    }",
    "    console.log(\"  i2c: (DR written outside a transaction — ignored)\");",
    "    return;",
    "  }",
    "  if (addr === I2C_SR) { console.log(\"  (i2c: SR is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "function i2cRead(addr) {",
    "  if (addr === I2C_SR) {",
    "    var sr = 0;",
    "    if (i2cFlags.sb) sr |= 1;",
    "    if (i2cFlags.addr) sr |= 2;",
    "    if (i2cFlags.nack) sr |= 4;",
    "    if (i2cFlags.busy) sr |= 8;",
    "    return sr;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state !== 'DATA_RD') { console.log(\"  i2c: (read with no sender — bus floats high, 0xFF)\"); return 0xFF; }",
    "    var b = accel.regs[accel.ptr];",
    "    accel.ptr = (accel.ptr + 1) & 0x7F;",
    "    console.log(\"  i2c: read 0x\" + hex2(b) + (i2cFlags.ack ? \" -> master ACK (send another)\" : \" -> master NACK (that's all)\"));",
    "    return b;",
    "  }",
    "  if (addr === I2C_CR) return 0;",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "",
    "// ── the MMIO bus itself ────────────────────────────────────────",
    "// One door into every peripheral. Wrong address = bus fault, and",
    "// the CPU hears about it immediately (a thrown error here; a",
    "// HardFault exception on real silicon).",
    "function mmioWrite(addr, value) {",
    "  if (addr >= SRAM_BASE && addr < SRAM_BASE + SRAM_SIZE) { sramWrite(addr, value); return; }",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioWrite(addr, value);",
    "  if (block === TIM_BASE) return timWrite(addr, value);",
    "  if (block === UART_BASE) return uartWrite(addr, value);",
    "  if (block === I2C_BASE) return i2cWrite(addr, value);",
    "  throw new Error(\"BUS FAULT: mmioWrite to unmapped address \" + hex8(addr));",
    "}",
    "function mmioRead(addr) {",
    "  if (addr >= SRAM_BASE && addr < SRAM_BASE + SRAM_SIZE) return sramRead(addr);",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioRead(addr);",
    "  if (block === TIM_BASE) return timRead(addr);",
    "  if (block === UART_BASE) return uartRead(addr);",
    "  if (block === I2C_BASE) return i2cRead(addr);",
    "  throw new Error(\"BUS FAULT: mmioRead from unmapped address \" + hex8(addr));",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// NVIC: the interrupt controller. Priorities are numbers where",
    "// LOWER wins (0 is the most urgent). Real NVIC hardware can nest",
    "// a high-priority ISR inside a low-priority one (preemption);",
    "// this simulator simplifies: ISRs run to completion, highest",
    "// priority first, then the main loop resumes. The visible effect",
    "// — \"urgent events jump the queue\" — is the same.",
    "// ═════════════════════════════════════════════════════════════════",
    "var IRQ_PRIO = { EXTI: 0, UART_RX: 1, TIMER: 2 };",
    "var irqPending = { EXTI: false, UART_RX: false, TIMER: false };",
    "var irqHandlers = {};",
    "var irqCounts = { EXTI: 0, UART_RX: 0, TIMER: 0 };",
    "var irqPulse = false; // latched high for any tick in which an ISR ran (logic-analyzer fodder)",
    "",
    "function onInterrupt(name, fn) { irqHandlers[name] = fn; }",
    "function pendIrq(name) { irqPending[name] = true; }",
    "function dispatchInterrupts(tick) {",
    "  var queueAnnounced = false;",
    "  for (;;) {",
    "    var waiting = [];",
    "    for (var name in irqPending) if (irqPending[name]) waiting.push(name);",
    "    if (!waiting.length) return; // nobody waiting: back to the main loop",
    "    waiting.sort(function (a, b) { return IRQ_PRIO[a] - IRQ_PRIO[b]; });",
    "    if (waiting.length > 1 && !queueAnnounced) {",
    "      queueAnnounced = true;",
    "      var parts = [];",
    "      for (var i = 0; i < waiting.length; i++) parts.push(waiting[i] + \" prio \" + IRQ_PRIO[waiting[i]]);",
    "      console.log(\"[tick \" + tick + \"] \" + waiting.length + \" interrupts pending at once (\" +",
    "                  parts.join(\", \") + \") — lowest priority number runs first\");",
    "    }",
    "    var best = waiting[0];",
    "    irqPending[best] = false;  // clear BEFORE running, so an ISR may re-pend itself",
    "    irqPulse = true;           // an ISR is about to run: the IRQ wire goes high",
    "    irqCounts[best]++;",
    "    console.log(\"[tick \" + tick + \"] --- IRQ \" + best + \" (prio \" + IRQ_PRIO[best] + \") -> ISR start ---\");",
    "    if (irqHandlers[best]) irqHandlers[best]();",
    "    console.log(\"[tick \" + tick + \"] --- ISR end, resuming main loop ---\");",
    "  }",
    "}",
    "",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// THE DEBUGGER'S TOOLKIT (new in v10)",
    "//",
    "// Real embedded work is half \"run it\" and half \"freeze it and",
    "// stare at it\". Tools like Renode, QEMU and GDB let you pause a",
    "// chip mid-program and dump its registers and memory — the",
    "// bare-metal debugger feel, no GDB required. These three helpers",
    "// fake that pause. Their snake_case names are deliberate: they",
    "// are the commands you would type at a debugger console.",
    "//",
    "// Nothing here is canned output: dump_registers reads the live",
    "// registers back through mmioRead, exactly like firmware would.",
    "// ═════════════════════════════════════════════════════════════════",
    "function pad(s, n) { s = String(s); while (s.length < n) s += \" \"; return s; }",
    "function bin32(n) { // 32 bits grouped in bytes: bit31 far left, bit0 far right",
    "  var s = (\"00000000000000000000000000000000\" + (n >>> 0).toString(2)).slice(-32);",
    "  return s.slice(0, 8) + \" \" + s.slice(8, 16) + \" \" + s.slice(16, 24) + \" \" + s.slice(24);",
    "}",
    "",
    "function regLine(addr, name, hint) {",
    "  var v = mmioRead(addr);",
    "  var line = hex8(addr) + \"  \" + pad(name, 12) + hex8(v) + \"  \" + bin32(v);",
    "  console.log(hint ? line + \"  \" + hint : line);",
    "}",
    "",
    "function dump_registers(label) {",
    "  console.log(\"-- dump_registers(): execution paused, debugger attached --\");",
    "  if (label) console.log(\"   (\" + label + \")\");",
    "  console.log(pad(\"ADDR\", 12) + pad(\"REGISTER\", 12) + pad(\"VALUE\", 12) + \"BINARY bit31...................bit0\");",
    "  regLine(GPIO_MODER, \"GPIO_MODER\");",
    "  regLine(GPIO_IDR, \"GPIO_IDR\");",
    "  regLine(GPIO_ODR, \"GPIO_ODR\");",
    "  regLine(TIM_CR, \"TIM_CR\");",
    "  regLine(TIM_CNT, \"TIM_CNT\", \"(\" + mmioRead(TIM_CNT) + \")\");",
    "  regLine(TIM_ARR, \"TIM_ARR\");",
    "  regLine(UART_SR, \"UART_SR\");",
    "  regLine(I2C_SR, \"I2C_SR\");",
    "  console.log(\"    legend: MODER 2 bits/pin (01=output) · IDR = input wire ·\");",
    "  console.log(\"    ODR pin \" + LED_PIN + \" = LED · TIM_CR bit0=enable, CNT wraps at ARR ·\");",
    "  console.log(\"    UART_SR bit0=byte waiting, bit1=TX ready · I2C_SR bit0/1/3 =\");",
    "  console.log(\"    START / addr-ACK / busy · IDR also reads output pins back.\");",
    "  // a real debugger (SWD/JTAG) can also see chip internals that no",
    "  // register exposes — printed from the live models, not faked:",
    "  console.log(\"  -- debugger view: internals no register exposes --\");",
    "  var pend = [];",
    "  for (var nm in irqPending) if (irqPending[nm]) pend.push(nm);",
    "  console.log(\"    NVIC pending right now: \" + (pend.length ? pend.join(\", \") : \"none\"));",
    "  console.log(\"    UART RX ring: \" + rxRing.count + \" of \" + rxRing.cap + \" bytes buffered (\" + rxRing.dropped + \" dropped so far)\");",
    "  console.log(\"    UART RX message so far: \" + JSON.stringify(rxMessage));",
    "  console.log(\"    I2C slave state machine: \" + accel.state + \" (register pointer 0x\" + hex2(accel.ptr) + \")\");",
    "  console.log(\"    logic analyzer: \" + trace.LED.length + \" ticks recorded on 4 channels\");",
    "}",
    "",
    "function dump_hex_memory(base, len) {",
    "  // A HEX DUMP: each row shows 16 bytes of memory three ways at",
    "  // once — where they live (address), what they are (hex), and",
    "  // what they spell (ASCII text, '.' for bytes that don't print).",
    "  // This is how you find strings and buffers hiding inside RAM.",
    "  console.log(\"-- dump_hex_memory(\" + hex8(base) + \", \" + len + \"): raw memory --\");",
    "  for (var off = 0; off < len; off += 16) {",
    "    var hexPart = \"\", ascPart = \"\";",
    "    for (var i = 0; i < 16; i++) {",
    "      var b = (off + i < len && base + off + i >= SRAM_BASE && base + off + i < SRAM_BASE + SRAM_SIZE)",
    "        ? sram[base + off + i - SRAM_BASE] : 0;",
    "      hexPart += (i ? \" \" : \"\") + hex2(b);",
    "      ascPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : \".\";",
    "    }",
    "    console.log(hex8(base + off) + \" \" + hexPart + \" |\" + ascPart + \"|\");",
    "  }",
    "}",
    "",
    "// ── the logic analyzer ─────────────────────────────────────",
    "// A LOGIC ANALYZER is the digital cousin of an oscilloscope: it",
    "// doesn't care about exact voltages, only \"high or low?\" — for",
    "// several wires at once, sampled tick after tick, so you can",
    "// line events up in time. Ours SAMPLES four wires once per tick:",
    "//   LED    the blinking output pin",
    "//   BTN    the button input pin",
    "//   IRQ    high on any tick where an ISR ran",
    "//   SPIKE  a pretend LIF neuron (the lif-neuron.js neuron wearing",
    "//          a wire) fed by the accelerometer's magnitude. Gravity",
    "//          holds it near threshold, so it fires in little bursts.",
    "// One tick = one sample = one character in plot_trace(). Watch",
    "// SPIKE next to IRQ at the end: a spike and an interrupt are the",
    "// same trick — a discrete event on a wire — in two worlds.",
    "var trace = { LED: [], BTN: [], IRQ: [], SPIKE: [] };",
    "var neuron = { v: 0, THRESH: 0.95 }; // leaky integrate-and-fire state",
    "",
    "function neuronStep() {",
    "  // input: total accel magnitude in g (a resting sensor feels ~1g)",
    "  var gx = decodeI16(accel.regs[0x3B], accel.regs[0x3C]);",
    "  var gy = decodeI16(accel.regs[0x3D], accel.regs[0x3E]);",
    "  var gz = decodeI16(accel.regs[0x3F], accel.regs[0x40]);",
    "  var mag = (Math.abs(gx) + Math.abs(gy) + Math.abs(gz)) / 16384;",
    "  neuron.v += (mag - neuron.v) * 0.18; // integrate, leaking toward the input",
    "  if (neuron.v >= neuron.THRESH) { neuron.v = 0; return 1; } // SPIKE! then reset",
    "  return 0;",
    "}",
    "",
    "function traceTick() { // one snapshot per tick, taken after interrupts are serviced",
    "  trace.LED.push((mmioRead(GPIO_ODR) >> LED_PIN) & 1);",
    "  trace.BTN.push((mmioRead(GPIO_IDR) >> BTN_PIN) & 1);",
    "  trace.IRQ.push(irqPulse ? 1 : 0);",
    "  trace.SPIKE.push(neuronStep());",
    "  irqPulse = false;",
    "}",
    "",
    "function waveRow(samples, start, end, spikeStyle) {",
    "  // renders ticks start..end: ‾ = high, _ = low, / and \\ = edges,",
    "  // | = a one-tick spike pulse (too narrow for a ‾ to do justice)",
    "  var row = \"\";",
    "  for (var t = start; t <= end; t++) {",
    "    var s = samples[t - 1] ? 1 : 0;                  // samples[0] is tick 1",
    "    if (spikeStyle) { row += s ? \"|\" : \"_\"; continue; }",
    "    var p = (t > 1) ? (samples[t - 2] ? 1 : 0) : s;  // previous tick",
    "    if (s && !p) row += \"/\";                         // rising edge",
    "    else if (!s && p) row += \"\\\\\";                   // falling edge",
    "    else row += s ? \"‾\" : \"_\";                       // steady high / low",
    "  }",
    "  return row;",
    "}",
    "",
    "function plot_trace(start, end) {",
    "  // 1 char = 1 tick because the analyzer took exactly one snapshot",
    "  // per tick — time runs left to right, one column per snapshot.",
    "  var width = end - start + 1;",
    "  console.log(\"-- plot_trace(): logic analyzer, ticks \" + start + \"..\" + end + \" (1 char = 1 tick) --\");",
    "  var nums = [], marks = \"\";",
    "  for (var i = 0; i < width; i++) nums.push(\" \");",
    "  for (var t = start; t <= end; t++) {",
    "    marks += (t % 10 === 0) ? \"|\" : \" \";",
    "    if (t % 20 === 0) {",
    "      var lbl = String(t);",
    "      for (var k = 0; k < lbl.length && (t - start + k) < width; k++) nums[t - start + k] = lbl[k];",
    "    }",
    "  }",
    "  console.log(\"      \" + nums.join(\"\"));",
    "  console.log(\"      \" + marks);",
    "  console.log(pad(\"LED\", 6) + waveRow(trace.LED, start, end, false));",
    "  console.log(pad(\"BTN\", 6) + waveRow(trace.BTN, start, end, false));",
    "  console.log(pad(\"IRQ\", 6) + waveRow(trace.IRQ, start, end, false));",
    "  console.log(pad(\"SPIKE\", 6) + waveRow(trace.SPIKE, start, end, true));",
    "  console.log(\"      LED=blink pin  BTN=button  IRQ=an ISR ran that tick  SPIKE=neuron fired\");",
    "}",
    "",
    "function plot_overview() {",
    "  // the whole run squashed: one character per 5 ticks,",
    "  // \"high if the wire was high at any point in those 5\"",
    "  console.log(\"-- plot_overview(): all \" + trace.LED.length + \" ticks, squashed 5 ticks per char --\");",
    "  var names = [\"LED\", \"BTN\", \"IRQ\", \"SPIKE\"];",
    "  for (var c = 0; c < names.length; c++) {",
    "    var samples = trace[names[c]], row = \"\";",
    "    for (var b = 0; b < samples.length; b += 5) {",
    "      var any = 0;",
    "      for (var j = b; j < Math.min(b + 5, samples.length); j++) if (samples[j]) any = 1;",
    "      row += (names[c] === \"SPIKE\") ? (any ? \"|\" : \"_\") : (any ? \"‾\" : \"_\");",
    "    }",
    "    console.log(pad(names[c], 6) + row);",
    "  }",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// THE FIRMWARE. From here down, EVERYTHING talks to the chip",
    "// through mmioRead / mmioWrite — no peeking at the models above.",
    "// This is what would be flashed onto the microcontroller.",
    "// ═════════════════════════════════════════════════════════════════",
    "var ledToggles = 0, sampleCount = 0;",
    "",
    "function isrTimer() { // blink the LED: read-modify-write on ODR, MMIO style",
    "  mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) ^ (1 << LED_PIN));",
    "  ledToggles++;",
    "  console.log(\"  timer isr: LED now \" + (((mmioRead(GPIO_ODR) >> LED_PIN) & 1) ? \"ON\" : \"off\"));",
    "}",
    "function isrExti() { // the button pin changed state",
    "  var pressed = (mmioRead(GPIO_IDR) >> BTN_PIN) & 1;",
    "  if (pressed) {",
    "    console.log(\"  exti isr: button PRESSED — queuing a message on the UART\");",
    "    var msg = \"BUTTON!\\n\";",
    "    for (var i = 0; i < msg.length; i++) mmioWrite(UART_TXDR, msg.charCodeAt(i));",
    "  } else {",
    "    console.log(\"  exti isr: button released (no message needed)\");",
    "  }",
    "}",
    "function isrUartRx() { // drain the RX ring into a message buffer",
    "  while (mmioRead(UART_SR) & 1) { // while RXNE: a byte is waiting",
    "    var b = mmioRead(UART_RXDR);",
    "    var ch = String.fromCharCode(b);",
    "    mmioWrite(SRAM_RXBUF + uartRxCount, b); // the byte also lands in RAM, like real firmware buffers it",
    "    rxMessage += ch; uartRxCount++;",
    "    console.log(\"  uart rx isr: drained \" + JSON.stringify(ch) + \" from the ring\");",
    "  }",
    "}",
    "",
    "// an I2C master transaction: read n bytes starting at register reg",
    "function i2cReadBytes(reg, n) {",
    "  var out = [];",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // START",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 0);   // address + Write",
    "  mmioWrite(I2C_DR, reg);                     // which register we want",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // REPEATED START (no STOP: same conversation)",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 1);   // address + Read",
    "  for (var i = 0; i < n; i++) {",
    "    mmioWrite(I2C_CR, (i === n - 1) ? 0 : I2C_CR_ACK); // ACK every byte except the last",
    "    out.push(mmioRead(I2C_DR));",
    "  }",
    "  mmioWrite(I2C_CR, I2C_CR_STOP);             // STOP",
    "  return out;",
    "}",
    "function i2cReadAccel(tick) {",
    "  accelUpdate(tick); // (sim cheat: the sensor refreshed its own data registers)",
    "  var b = i2cReadBytes(ACCEL_DATA, 6);",
    "  for (var m = 0; m < b.length; m++) mmioWrite(SRAM_SAMPLE + m, b[m]); // newest sample kept in RAM",
    "  var raw = [];",
    "  for (var i = 0; i < b.length; i++) raw.push(\"0x\" + hex2(b[i]));",
    "  console.log(\"  raw register bytes: \" + raw.join(\" \") + \"  (high byte, low byte, x3 axes)\");",
    "  var x = decodeI16(b[0], b[1]), y = decodeI16(b[2], b[3]), z = decodeI16(b[4], b[5]);",
    "  console.log(\"  decoded accel: X=\" + (x / 16384).toFixed(3) + \"g  Y=\" + (y / 16384).toFixed(3) +",
    "              \"g  Z=\" + (z / 16384).toFixed(3) + \"g   (16384 counts = 1g)\");",
    "  sampleCount++;",
    "}",
    "",
    "// ── boot: configure the peripherals, firmware-style ─────────",
    "console.log(\"=== peripheral-vm firmware booting ===\");",
    "// leave a calling card in SRAM: real firmware keeps its strings",
    "// and buffers in RAM, and later the hex dump will find this one.",
    "var BANNER = \"peripheral-vm firmware v10\\n\";",
    "for (var bi = 0; bi < BANNER.length; bi++) mmioWrite(SRAM_BANNER + bi, BANNER.charCodeAt(bi));",
    "mmioWrite(GPIO_MODER, mmioRead(GPIO_MODER) | (1 << (LED_PIN * 2))); // 2 bits/pin: 01 = output",
    "mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) & ~(1 << LED_PIN));           // LED starts off",
    "console.log(\"gpio: pin \" + LED_PIN + \" configured as output (MODER = \" + hex8(mmioRead(GPIO_MODER)) + \"), LED off\");",
    "",
    "mmioWrite(TIM_ARR, 40);   // counter climbs 1..ARR, interrupts, wraps — every 40 ticks",
    "mmioWrite(TIM_CR, 1);     // enable",
    "console.log(\"timer: ARR=40, enabled — the LED will blink itself via interrupts\");",
    "",
    "onInterrupt('TIMER', isrTimer);",
    "onInterrupt('EXTI', isrExti);",
    "onInterrupt('UART_RX', isrUartRx);",
    "console.log(\"nvic: ISRs registered (EXTI prio 0 > UART_RX prio 1 > TIMER prio 2)\");",
    "",
    "console.log(\"i2c: checking the accelerometer is really there (WHO_AM_I)...\");",
    "var who = i2cReadBytes(ACCEL_WHOAMI, 1);",
    "console.log(\"  WHO_AM_I = 0x\" + hex2(who[0]) + (who[0] === ACCEL_ADDR ? \" — sensor found, address matches\" : \" — WRONG CHIP?!\"));",
    "mmioWrite(SRAM_WHOAMI, who[0]); // filed in RAM — debugger evidence for the hex dump",
    "",
    "try { // poke an address where nothing lives, to see a bus fault",
    "  mmioRead(0x40009000);",
    "} catch (e) {",
    "  console.log(\"bus fault demo: caught [\" + e.message + \"] — on silicon this is a HardFault\");",
    "}",
    "console.log(\"\");",
    "dump_registers(\"boot: peripherals configured, superloop not started yet\");",
    "console.log(\"\");",
    "",
    "// ── the outside world: a schedule of scheduled pokes ─────────",
    "// The button is held for ticks 200..215; five UART bytes arrive",
    "// every 5 ticks from 230. Everything else is the peripherals'",
    "// own doing. (Real inputs would arrive whenever they wanted —",
    "// which is precisely why interrupts exist.)",
    "var BTN_PRESS = 200, BTN_RELEASE = 216;",
    "var RX_SCHEDULE = { 230: 'P', 235: 'I', 240: 'N', 245: 'G', 250: '\\n' };",
    "var TOTAL_TICKS = 300, prevBtn = 0;",
    "",
    "console.log(\"=== running the superloop for \" + TOTAL_TICKS + \" ticks ===\");",
    "for (var tick = 1; tick <= TOTAL_TICKS; tick++) {",
    "  // 1. the outside world pokes the hardware",
    "  if (tick >= BTN_PRESS && tick < BTN_RELEASE) gpio.idr |= (1 << BTN_PIN);",
    "  else gpio.idr &= ~(1 << BTN_PIN);",
    "  var nowBtn = (gpio.idr >> BTN_PIN) & 1;",
    "  if (nowBtn !== prevBtn) { pendIrq('EXTI'); prevBtn = nowBtn; } // EXTI sees edges",
    "  if (RX_SCHEDULE[tick] !== undefined) uartReceiveByte(RX_SCHEDULE[tick]);",
    "",
    "  // 2. the hardware advances on its own",
    "  tickTimer();",
    "",
    "  // 3. the CPU services interrupts, most urgent first",
    "  dispatchInterrupts(tick);",
    "  traceTick(); // logic analyzer: snapshot LED / BTN / IRQ / SPIKE for this tick",
    "",
    "  // 4. one superloop iteration of foreground work",
    "  if (tick % 60 === 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: periodic sensor read\");",
    "    i2cReadAccel(tick);",
    "  }",
    "  if (rxMessage.indexOf(\"\\n\") >= 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: complete UART message: \" + JSON.stringify(rxMessage.replace(\"\\n\", \"\")) + \" — parsed by the main loop, not the ISR\");",
    "    rxMessage = \"\";",
    "  }",
    "}",
    "",
    "// ── the debugger's last look: memory, waveforms, registers ──",
    "// Same three commands as the boot dump. Same chip. Very different",
    "// state — freezing the machine and diffing \"before\" against",
    "// \"after\" is the whole debugging trick.",
    "dump_hex_memory(SRAM_BASE, 128);",
    "console.log(\"\");",
    "plot_trace(198, 267);",
    "plot_overview();",
    "console.log(\"\");",
    "dump_registers(\"end of run — diff this against the boot dump way above\");",
    "console.log(\"\");",
    "console.log(\"=================== SUMMARY ===================\");",
    "console.log(\"ticks simulated:          \" + TOTAL_TICKS);",
    "console.log(\"TIMER interrupts:         \" + irqCounts.TIMER + \"  (LED toggled \" + ledToggles + \" times)\");",
    "console.log(\"EXTI interrupts (button): \" + irqCounts.EXTI + \"  (press + release)\");",
    "console.log(\"UART_RX interrupts:       \" + irqCounts.UART_RX + \"  (one per received byte)\");",
    "console.log(\"UART TX: \" + uartTxCount + \" bytes -> \" + JSON.stringify(uartTxLog));",
    "console.log(\"UART RX: \" + uartRxCount + \" bytes drained, \" + rxRing.dropped + \" dropped to overflow\");",
    "console.log(\"accelerometer samples:    \" + sampleCount + \" (via full I2C transactions)\");",
    "console.log(\"===============================================\");",
    "console.log(\"notice: the main loop NEVER polled for the button or the UART\");",
    "console.log(\"bytes. Events came to it. That is the whole point of interrupts.\");",
    "",
    "// ─────────────────────────────────────────────────────────────────",
    "// THE BRIDGE TO SPIKING NEURAL NETWORKS",
    "//",
    "// A spike and an interrupt are the same idea in different clothes.",
    "// Both are DISCRETE EVENTS: nothing happens, nothing happens...",
    "// then one event arrives and state changes. The main loop above",
    "// never polled the button or the serial wire — events came to IT,",
    "// exactly like a neuron that sits silent until incoming spikes",
    "// push it over threshold. Event-driven silicon (this pretend chip)",
    "// and event-driven brains (your Nengo networks) save energy the",
    "// same way: by doing nothing until it matters.",
    "// ─────────────────────────────────────────────────────────────────",
  ].join('\n');

  /* v14 edition (kept only as a fingerprint for the safe upgrade below) */
  var PERIPHERAL_VM_SRC_V14 = [
    "// ─────────────────────────────────────────────────────────────────",
    "// Microcontroller preset: Register & Peripheral Simulation VM",
    "//",
    "// Real firmware almost never touches the CPU instruction set",
    "// directly. It CONFIGURES PERIPHERALS — the GPIO pins, timers,",
    "// UART serial ports and I2C buses sitting next to the CPU — by",
    "// reading and writing REGISTERS at fixed memory addresses. That",
    "// is called MMIO: Memory-Mapped Input/Output.",
    "//",
    "// This file builds a tiny make-believe chip and then writes",
    "// make-believe FIRMWARE for it, in the same style you would write",
    "// for an STM32: poke registers through the bus, let peripherals",
    "// run on their own, and get interrupted when something happens.",
    "//",
    "// ADDRESS MAP (every access goes through mmioRead / mmioWrite):",
    "//",
    "//   0x20000000  SRAM   256 bytes of scratch RAM (variables, buffers)",
    "//   0x40000000  GPIO   +0x0 MODER  pin modes (2 bits per pin)",
    "//                      +0x4 IDR    input data  (read-only)",
    "//                      +0x8 ODR    output data (what we drive out)",
    "//   0x40001000  TIMER  +0x0 CR     control (bit 0 = enable)",
    "//                      +0x4 CNT    counter, climbs every tick",
    "//                      +0x8 ARR    auto-reload: interrupt at this count",
    "//   0x40002000  UART   +0x0 SR     status (bit 0 = RX byte waiting)",
    "//                      +0x4 TXDR   write a byte -> it is transmitted",
    "//                      +0x8 RXDR   read -> pops the oldest RX byte",
    "//   0x40003000  I2C    +0x0 CR     control (START / STOP / ACK bits)",
    "//                      +0x4 DR     data register (bytes on the wire)",
    "//                      +0x8 SR     status (started / acked / busy)",
    "//",
    "// ACRONYM DECODER (every one of these is standard firmware-speak):",
    "//   MMIO  Memory-Mapped I/O — hardware reached via memory addresses",
    "//   ISR   Interrupt Service Routine — function the CPU runs when an",
    "//         interrupt fires; it pauses the main loop to do so",
    "//   NVIC  Nested Vectored Interrupt Controller — the chip block",
    "//         that prioritises and dispatches interrupts",
    "//   EXTI  External Interrupt — \"a pin changed state\" interrupt",
    "//   MODER/IDR/ODR — GPIO Mode / Input Data / Output Data registers",
    "//   SRAM  Static RAM — the chip's small, forgetful scratch memory",
    "//   HEX DUMP — memory printed as hex bytes AND as readable text",
    "//   LOGIC ANALYZER — a recorder that watches wires as high/low",
    "//        over time (Saleae/Sigrok style); ours draws ASCII waves",
    "//",
    "// V10 EDITION: the chip gains a debugger's toolkit. dump_registers()",
    "// and dump_hex_memory() freeze it and print its insides; a logic",
    "// analyzer trace (plot_trace) draws its wires as ASCII waveforms —",
    "// including one wire driven by a spiking neuron. Watch for them at",
    "// boot and again at the end of the run.",
    "//",
    "// V14 EDITION: fault injection & hard-RTOS benchmarking. After",
    "// the clean run, PART 2 (bottom of this file) gives the same",
    "// chip a very bad day — a UART interrupt storm, a jittery timer,",
    "// an I2C sensor that NAKs when busy, spikes that vanish mid-air —",
    "// then measures the damage with the debugger above: IRQ latency,",
    "// dropped bytes, missed LED deadlines. It answers the question",
    "// every firmware engineer dreads: \"what happens when everything",
    "// goes wrong at the same time?\" Set RUN_FAULT_SCENARIO = false",
    "// (down in Part 2) to run only the clean Part 1 demo.",
    "//",
    "// HOW TO READ THE OUTPUT: the firmware runs a superloop for 300",
    "// simulated ticks. Quiet ticks print nothing. Watch for lines like",
    "//   [tick 200] --- IRQ EXTI (prio 0) -> ISR start ---",
    "// which mean \"the hardware tapped the CPU on the shoulder; the",
    "// main loop is paused while the ISR (indented lines) runs.\"",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "// ── tiny seeded random number generator ─────────────────────────",
    "// mulberry32: same seed -> same sequence, every run, forever.",
    "// The accelerometer uses it for \"sensor wiggle\" so this demo is",
    "// deterministic: run it twice, the output is identical.",
    "function mulberry32(seed) {",
    "  var a = seed >>> 0;",
    "  return function () {",
    "    a |= 0; a = (a + 0x6D2B79F5) | 0;",
    "    var t = Math.imul(a ^ (a >>> 15), 1 | a);",
    "    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
    "    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;",
    "  };",
    "}",
    "var rng = mulberry32(0xC0FFEE);",
    "",
    "// ── register addresses (the \"datasheet\" of our fake chip) ─────",
    "var GPIO_BASE = 0x40000000, TIM_BASE = 0x40001000;",
    "var UART_BASE = 0x40002000, I2C_BASE = 0x40003000;",
    "",
    "var GPIO_MODER = GPIO_BASE + 0x0, GPIO_IDR = GPIO_BASE + 0x4, GPIO_ODR = GPIO_BASE + 0x8;",
    "var TIM_CR = TIM_BASE + 0x0, TIM_CNT = TIM_BASE + 0x4, TIM_ARR = TIM_BASE + 0x8;",
    "var UART_SR = UART_BASE + 0x0, UART_TXDR = UART_BASE + 0x4, UART_RXDR = UART_BASE + 0x8;",
    "var I2C_CR = I2C_BASE + 0x0, I2C_DR = I2C_BASE + 0x4, I2C_SR = I2C_BASE + 0x8;",
    "",
    "// the SRAM map: where the firmware keeps things in RAM",
    "var SRAM_BASE = 0x20000000, SRAM_SIZE = 256;",
    "var SRAM_BANNER = SRAM_BASE + 0x00;  // boot banner string (find it in the hex dump)",
    "var SRAM_RXBUF  = SRAM_BASE + 0x40;  // UART RX bytes, copied here by the RX ISR",
    "var SRAM_SAMPLE = SRAM_BASE + 0x60;  // newest accel sample (6 raw bytes)",
    "var SRAM_WHOAMI = SRAM_BASE + 0x70;  // the WHO_AM_I answer byte, kept as evidence",
    "",
    "var LED_PIN = 5;    // an output pin we can light up (like PA5 on STM32 boards)",
    "var BTN_PIN = 0;    // an input pin wired to a pretend push-button",
    "",
    "function hex2(n) { return (\"0\" + (n & 0xFF).toString(16).toUpperCase()).slice(-2); }",
    "function hex8(n) { return \"0x\" + (\"00000000\" + (n >>> 0).toString(16).toUpperCase()).slice(-8); }",
    "",
    "// ── fault-injection knobs (Part 2; all inert through Part 1) ──",
    "// v14's whole point: flip these on and the chip has a bad day.",
    "//   nakNext   -> the accelerometer refuses its next address (busy)",
    "//   jitterOn  -> the timer reload wobbles a few ticks per interval",
    "//   dropSpike -> the logic analyzer's neuron channel loses spikes",
    "var faults = { nakNext: false, jitterOn: false, dropSpike: false };",
    "var faultStats = { spikesDropped: 0, i2cNaks: 0, i2cRetries: 0, i2cRecovered: 0, i2cFailed: 0 };",
    "var neuronFires = 0; // every spike the neuron TRULY fired (before any dropout)",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// PERIPHERAL MODELS. Each one owns some registers and a little",
    "// internal state. The firmware below may ONLY reach them through",
    "// mmioRead / mmioWrite — exactly like real hardware.",
    "// ═════════════════════════════════════════════════════════════════",
    "",
    "// ── GPIO: pins, modes, and the outside world's button wire ────",
    "var gpio = { moder: 0, idr: 0, odr: 0 }; // idr = levels the world drives IN",
    "",
    "function gpioOutMask() {",
    "  // MODER spends 2 bits per pin; mode 01 means \"output\"",
    "  var m = 0;",
    "  for (var p = 0; p < 16; p++) if (((gpio.moder >> (2 * p)) & 3) === 1) m |= (1 << p);",
    "  return m;",
    "}",
    "function gpioWrite(addr, value) {",
    "  if (addr === GPIO_MODER) { gpio.moder = value; return; }",
    "  if (addr === GPIO_ODR)   { gpio.odr = value; return; }",
    "  if (addr === GPIO_IDR)   { console.log(\"  (gpio: IDR is read-only — write ignored, as on real hardware)\"); return; }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "function gpioRead(addr) {",
    "  if (addr === GPIO_MODER) return gpio.moder;",
    "  if (addr === GPIO_ODR)   return gpio.odr;",
    "  if (addr === GPIO_IDR) {",
    "    // input pins show the outside world; output pins read back what we drive",
    "    var om = gpioOutMask();",
    "    return (gpio.idr & ~om) | (gpio.odr & om);",
    "  }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "",
    "// ── SRAM: 256 bytes of scratch RAM at 0x20000000 ────────────",
    "// SRAM (Static RAM) is the chip's working memory: fast, small,",
    "// and totally forgetful — cut the power and it's gone. Firmware",
    "// keeps its variables, serial buffers and sensor samples in it.",
    "// The firmware below stores a boot banner, the UART RX message",
    "// and the newest sensor sample here, so dump_hex_memory() has",
    "// real content to show you. (Real STM32 SRAM really does start",
    "// at 0x20000000 — that address is not made up.)",
    "var sram = [];",
    "for (var zi = 0; zi < SRAM_SIZE; zi++) sram.push(0);",
    "function sramWrite(addr, value) { sram[addr - SRAM_BASE] = value & 0xFF; }",
    "function sramRead(addr) { return sram[addr - SRAM_BASE]; }",
    "",
    "// ── TIMER: counts up every tick, interrupts at ARR ────────────",
    "var timer = { cr: 0, cnt: 0, arr: 0, jit: 0 };",
    "function timWrite(addr, value) {",
    "  if (addr === TIM_CR)  { timer.cr = value; return; }",
    "  if (addr === TIM_CNT) { timer.cnt = value; return; }",
    "  if (addr === TIM_ARR) { timer.arr = value; return; }",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function timRead(addr) {",
    "  if (addr === TIM_CR)  return timer.cr;",
    "  if (addr === TIM_CNT) return timer.cnt;",
    "  if (addr === TIM_ARR) return timer.arr;",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function tickTimer() { // called once per simulated tick by the main loop",
    "  if (!(timer.cr & 1)) return;              // enable bit off -> frozen",
    "  timer.cnt++;",
    "  // faults.jitterOn (a Part-2 knob, off in Part 1): the reload",
    "  // target wobbles around ARR; timer.jit is re-rolled after every",
    "  // wrap, skewed late under load, so the blink drifts off-grid.",
    "  if (timer.cnt >= timer.arr + (faults.jitterOn ? timer.jit : 0)) {",
    "    timer.cnt = 0;                          // reached the (maybe wobbled) reload...",
    "    if (faults.jitterOn) timer.jit = Math.floor(rng() * 7) - 2; // wobble -2..+4 ticks",
    "    pendIrq('TIMER');                       // ...and tap the CPU",
    "  }",
    "}",
    "",
    "// ── UART: a serial port with a TX log and an RX ring buffer ───",
    "// Incoming bytes land in a small ring (same idea as ring-buffer.js:",
    "// fixed memory, head writes, tail reads, wrap around the circle).",
    "// The \"wire\" side is driven by the stimulus schedule further down.",
    "var rxRing = { cap: 8, buf: [], head: 0, tail: 0, count: 0, dropped: 0 };",
    "var uartTxLog = \"\", uartTxCount = 0, uartRxCount = 0, rxMessage = \"\";",
    "",
    "function uartWrite(addr, value) {",
    "  if (addr === UART_TXDR) {",
    "    var ch = String.fromCharCode(value & 0xFF);",
    "    uartTxLog += ch; uartTxCount++;",
    "    console.log(\"  uart TX -> \" + JSON.stringify(ch) + \" (0x\" + hex2(value) + \")\");",
    "    return;",
    "  }",
    "  if (addr === UART_SR || addr === UART_RXDR) { console.log(\"  (uart: that register is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartRead(addr) {",
    "  if (addr === UART_SR) return (rxRing.count > 0 ? 1 : 0) | 2; // RXNE | TXE(always ready)",
    "  if (addr === UART_RXDR) {",
    "    if (rxRing.count === 0) return -1;",
    "    var b = rxRing.buf[rxRing.tail];",
    "    rxRing.tail = (rxRing.tail + 1) % rxRing.cap;",
    "    rxRing.count--;",
    "    return b;",
    "  }",
    "  if (addr === UART_TXDR) return 0;",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartReceiveByte(ch) { // the outside world sends us a byte",
    "  if (rxRing.count === rxRing.cap) { rxRing.dropped++; }",
    "  else {",
    "    rxRing.buf[rxRing.head] = ch.charCodeAt(0);",
    "    rxRing.head = (rxRing.head + 1) % rxRing.cap;",
    "    rxRing.count++;",
    "  }",
    "  pendIrq('UART_RX'); // \"a byte arrived\" is itself an interrupt",
    "}",
    "",
    "// ── I2C accelerometer: an MPU-6050-style slave at address 0x68 ─",
    "// The slave is an explicit STATE MACHINE. It understands nothing",
    "// until the master drives it through START -> address -> register",
    "// pointer -> data. WHO_AM_I (0x75) answers 0x68: \"yes, I'm here.\"",
    "var ACCEL_ADDR = 0x68, ACCEL_WHOAMI = 0x75, ACCEL_DATA = 0x3B;",
    "var accel = { regs: [], ptr: 0, state: 'IDLE' }; // states: IDLE ADDR REG_PTR DATA_WR DATA_RD",
    "for (var ai = 0; ai < 128; ai++) accel.regs.push(0);",
    "accel.regs[ACCEL_WHOAMI] = 0x68;",
    "",
    "var i2cFlags = { sb: false, addr: false, nack: false, busy: false, ack: false };",
    "var I2C_CR_START = 1, I2C_CR_STOP = 2, I2C_CR_ACK = 4;",
    "",
    "function accelPut16(reg, val) { // one int16 sensor value -> two register bytes, big-endian",
    "  var u = val & 0xFFFF;",
    "  accel.regs[reg] = (u >> 8) & 0xFF;",
    "  accel.regs[reg + 1] = u & 0xFF;",
    "}",
    "function accelUpdate(tick) { // the sensor's own sampling: slow sine drift + seeded wiggle",
    "  accelPut16(0x3B, Math.round(900 * Math.sin(tick * 0.021) + (rng() * 300 - 150)));",
    "  accelPut16(0x3D, Math.round(500 * Math.sin(tick * 0.013 + 1.7) + (rng() * 300 - 150)));",
    "  accelPut16(0x3F, Math.round(16384 + 300 * Math.sin(tick * 0.017 + 0.4) + (rng() * 200 - 100)));",
    "}",
    "function decodeI16(hi, lo) { var v = ((hi << 8) | lo); return v >= 32768 ? v - 65536 : v; }",
    "",
    "function i2cWrite(addr, value) {",
    "  if (addr === I2C_CR) {",
    "    i2cFlags.ack = !!(value & I2C_CR_ACK);",
    "    if (value & I2C_CR_START) {",
    "      console.log(accel.state === 'IDLE' ? \"  i2c: START\" : \"  i2c: REPEATED START\");",
    "      accel.state = 'ADDR';",
    "      i2cFlags.sb = true; i2cFlags.busy = true; i2cFlags.addr = false; i2cFlags.nack = false;",
    "    }",
    "    if (value & I2C_CR_STOP) {",
    "      console.log(\"  i2c: STOP\");",
    "      accel.state = 'IDLE';",
    "      i2cFlags.sb = i2cFlags.addr = i2cFlags.nack = i2cFlags.busy = false;",
    "    }",
    "    return;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state === 'ADDR') {",
    "      var a7 = (value >> 1) & 0x7F, rw = value & 1;",
    "      if (a7 === ACCEL_ADDR && faults.nakNext) {",
    "        // FAULT INJECTED: the sensor is mid-conversion and refuses",
    "        // its own address — the classic \"device busy\" NAK. The",
    "        // master sees the NAK bit in I2C_SR; firmware must cope.",
    "        faults.nakNext = false;",
    "        faultStats.i2cNaks++;",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> NAK (FAULT INJECTED: slave busy)\");",
    "        i2cFlags.nack = true;",
    "        return;",
    "      }",
    "      if (a7 === ACCEL_ADDR) {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> slave ACK\");",
    "        accel.state = rw ? 'DATA_RD' : 'REG_PTR';",
    "        i2cFlags.addr = true;",
    "      } else {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> NACK (nobody at that address)\");",
    "        i2cFlags.nack = true;",
    "      }",
    "      return;",
    "    }",
    "    if (accel.state === 'REG_PTR') {",
    "      accel.ptr = value & 0x7F;",
    "      console.log(\"  i2c: register pointer = 0x\" + hex2(value) + \" -> slave ACK\");",
    "      accel.state = 'DATA_WR';",
    "      return;",
    "    }",
    "    if (accel.state === 'DATA_WR') {",
    "      accel.regs[accel.ptr] = value & 0xFF;",
    "      console.log(\"  i2c: wrote 0x\" + hex2(value) + \" into reg 0x\" + hex2(accel.ptr));",
    "      accel.ptr = (accel.ptr + 1) & 0x7F;",
    "      return;",
    "    }",
    "    console.log(\"  i2c: (DR written outside a transaction — ignored)\");",
    "    return;",
    "  }",
    "  if (addr === I2C_SR) { console.log(\"  (i2c: SR is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "function i2cRead(addr) {",
    "  if (addr === I2C_SR) {",
    "    var sr = 0;",
    "    if (i2cFlags.sb) sr |= 1;",
    "    if (i2cFlags.addr) sr |= 2;",
    "    if (i2cFlags.nack) sr |= 4;",
    "    if (i2cFlags.busy) sr |= 8;",
    "    return sr;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state !== 'DATA_RD') { console.log(\"  i2c: (read with no sender — bus floats high, 0xFF)\"); return 0xFF; }",
    "    var b = accel.regs[accel.ptr];",
    "    accel.ptr = (accel.ptr + 1) & 0x7F;",
    "    console.log(\"  i2c: read 0x\" + hex2(b) + (i2cFlags.ack ? \" -> master ACK (send another)\" : \" -> master NACK (that's all)\"));",
    "    return b;",
    "  }",
    "  if (addr === I2C_CR) return 0;",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "",
    "// ── the MMIO bus itself ────────────────────────────────────────",
    "// One door into every peripheral. Wrong address = bus fault, and",
    "// the CPU hears about it immediately (a thrown error here; a",
    "// HardFault exception on real silicon).",
    "function mmioWrite(addr, value) {",
    "  if (addr >= SRAM_BASE && addr < SRAM_BASE + SRAM_SIZE) { sramWrite(addr, value); return; }",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioWrite(addr, value);",
    "  if (block === TIM_BASE) return timWrite(addr, value);",
    "  if (block === UART_BASE) return uartWrite(addr, value);",
    "  if (block === I2C_BASE) return i2cWrite(addr, value);",
    "  throw new Error(\"BUS FAULT: mmioWrite to unmapped address \" + hex8(addr));",
    "}",
    "function mmioRead(addr) {",
    "  if (addr >= SRAM_BASE && addr < SRAM_BASE + SRAM_SIZE) return sramRead(addr);",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioRead(addr);",
    "  if (block === TIM_BASE) return timRead(addr);",
    "  if (block === UART_BASE) return uartRead(addr);",
    "  if (block === I2C_BASE) return i2cRead(addr);",
    "  throw new Error(\"BUS FAULT: mmioRead from unmapped address \" + hex8(addr));",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// NVIC: the interrupt controller. Priorities are numbers where",
    "// LOWER wins (0 is the most urgent). Real NVIC hardware can nest",
    "// a high-priority ISR inside a low-priority one (preemption);",
    "// this simulator simplifies: ISRs run to completion, highest",
    "// priority first, then the main loop resumes. The visible effect",
    "// — \"urgent events jump the queue\" — is the same.",
    "// ═════════════════════════════════════════════════════════════════",
    "var IRQ_PRIO = { EXTI: 0, UART_RX: 1, TIMER: 2 };",
    "var irqPending = { EXTI: false, UART_RX: false, TIMER: false };",
    "var irqHandlers = {};",
    "var irqCounts = { EXTI: 0, UART_RX: 0, TIMER: 0 };",
    "var irqPulse = false; // latched high for any tick in which an ISR ran (logic-analyzer fodder)",
    "",
    "// ── benchmark counters (silent in Part 1; read aloud in Part 2) ──",
    "// Hard-RTOS benchmarking asks one question: HOW LONG does an event",
    "// wait before the CPU answers it? pendIrq stamps each interrupt",
    "// with the simulated CPU-cycle count; the dispatcher measures the",
    "// gap to the moment its ISR actually starts. cpuCycles advances",
    "// by each ISR's rough execution cost (a UART drain costs more",
    "// than a blink), so a polite low-priority interrupt stuck behind",
    "// a storm shows a big number here — starvation, made measurable.",
    "var cpuCycles = 0;",
    "var IRQ_COST = { EXTI: 48, UART_RX: 16, TIMER: 24 }; // base cost per ISR",
    "var IRQ_BYTE_COST = { EXTI: 2, UART_RX: 12, TIMER: 0 }; // per byte moved: queueing TX is cheap, draining RX is not",
    "var irqPendCycle = { EXTI: -1, UART_RX: -1, TIMER: -1 };",
    "var irqLatency = {",
    "  EXTI:    { n: 0, total: 0, max: 0 },",
    "  UART_RX: { n: 0, total: 0, max: 0 },",
    "  TIMER:   { n: 0, total: 0, max: 0 }",
    "};",
    "var irqSaturatedTicks = 0, irqLastSatTick = -1; // ticks where >=2 IRQs queued at once",
    "var irqCoalesced = 0;        // extra pends that landed while one was already waiting",
    "var timerFireTicks = [];     // every tick the TIMER ISR ran (deadline bookkeeping)",
    "",
    "function snapshotIrqStats() {",
    "  function cp(o) { return { n: o.n, total: o.total, max: o.max }; }",
    "  return { saturated: irqSaturatedTicks, coalesced: irqCoalesced,",
    "           EXTI: cp(irqLatency.EXTI), UART_RX: cp(irqLatency.UART_RX), TIMER: cp(irqLatency.TIMER) };",
    "}",
    "function resetIrqStats() {",
    "  cpuCycles = 0; irqSaturatedTicks = 0; irqLastSatTick = -1; irqCoalesced = 0;",
    "  irqPendCycle = { EXTI: -1, UART_RX: -1, TIMER: -1 };",
    "  irqLatency = { EXTI: { n: 0, total: 0, max: 0 }, UART_RX: { n: 0, total: 0, max: 0 }, TIMER: { n: 0, total: 0, max: 0 } };",
    "}",
    "",
    "function onInterrupt(name, fn) { irqHandlers[name] = fn; }",
    "function pendIrq(name) {",
    "  if (irqPending[name]) irqCoalesced++;          // the storm pends faster than anyone services",
    "  else irqPendCycle[name] = cpuCycles;           // first pend: start this interrupt's latency clock",
    "  irqPending[name] = true;",
    "}",
    "function dispatchInterrupts(tick) {",
    "  var queueAnnounced = false;",
    "  for (;;) {",
    "    var waiting = [];",
    "    for (var name in irqPending) if (irqPending[name]) waiting.push(name);",
    "    if (!waiting.length) return; // nobody waiting: back to the main loop",
    "    waiting.sort(function (a, b) { return IRQ_PRIO[a] - IRQ_PRIO[b]; });",
    "    if (waiting.length > 1 && !queueAnnounced) {",
    "      queueAnnounced = true;",
    "      var parts = [];",
    "      for (var i = 0; i < waiting.length; i++) parts.push(waiting[i] + \" prio \" + IRQ_PRIO[waiting[i]]);",
    "      console.log(\"[tick \" + tick + \"] \" + waiting.length + \" interrupts pending at once (\" +",
    "                  parts.join(\", \") + \") — lowest priority number runs first\");",
    "    }",
    "    if (waiting.length > 1 && tick !== irqLastSatTick) { irqSaturatedTicks++; irqLastSatTick = tick; }",
    "    var best = waiting[0];",
    "    irqPending[best] = false;  // clear BEFORE running, so an ISR may re-pend itself",
    "    irqPulse = true;           // an ISR is about to run: the IRQ wire goes high",
    "    irqCounts[best]++;",
    "    var latNow = cpuCycles - (irqPendCycle[best] < 0 ? cpuCycles : irqPendCycle[best]);",
    "    var latStat = irqLatency[best];",
    "    latStat.n++; latStat.total += latNow; if (latNow > latStat.max) latStat.max = latNow;",
    "    irqPendCycle[best] = -1;",
    "    if (best === 'TIMER') timerFireTicks.push(tick);",
    "    var txBefore = uartTxCount, rxBefore = uartRxCount;",
    "    console.log(\"[tick \" + tick + \"] --- IRQ \" + best + \" (prio \" + IRQ_PRIO[best] + \") -> ISR start ---\");",
    "    if (irqHandlers[best]) irqHandlers[best]();",
    "    cpuCycles += IRQ_COST[best] + IRQ_BYTE_COST[best] * ((uartTxCount - txBefore) + (uartRxCount - rxBefore));",
    "    console.log(\"[tick \" + tick + \"] --- ISR end, resuming main loop ---\");",
    "  }",
    "}",
    "",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// THE DEBUGGER'S TOOLKIT (new in v10)",
    "//",
    "// Real embedded work is half \"run it\" and half \"freeze it and",
    "// stare at it\". Tools like Renode, QEMU and GDB let you pause a",
    "// chip mid-program and dump its registers and memory — the",
    "// bare-metal debugger feel, no GDB required. These three helpers",
    "// fake that pause. Their snake_case names are deliberate: they",
    "// are the commands you would type at a debugger console.",
    "//",
    "// Nothing here is canned output: dump_registers reads the live",
    "// registers back through mmioRead, exactly like firmware would.",
    "// ═════════════════════════════════════════════════════════════════",
    "function pad(s, n) { s = String(s); while (s.length < n) s += \" \"; return s; }",
    "function bin32(n) { // 32 bits grouped in bytes: bit31 far left, bit0 far right",
    "  var s = (\"00000000000000000000000000000000\" + (n >>> 0).toString(2)).slice(-32);",
    "  return s.slice(0, 8) + \" \" + s.slice(8, 16) + \" \" + s.slice(16, 24) + \" \" + s.slice(24);",
    "}",
    "",
    "function regLine(addr, name, hint) {",
    "  var v = mmioRead(addr);",
    "  var line = hex8(addr) + \"  \" + pad(name, 12) + hex8(v) + \"  \" + bin32(v);",
    "  console.log(hint ? line + \"  \" + hint : line);",
    "}",
    "",
    "function dump_registers(label) {",
    "  console.log(\"-- dump_registers(): execution paused, debugger attached --\");",
    "  if (label) console.log(\"   (\" + label + \")\");",
    "  console.log(pad(\"ADDR\", 12) + pad(\"REGISTER\", 12) + pad(\"VALUE\", 12) + \"BINARY bit31...................bit0\");",
    "  regLine(GPIO_MODER, \"GPIO_MODER\");",
    "  regLine(GPIO_IDR, \"GPIO_IDR\");",
    "  regLine(GPIO_ODR, \"GPIO_ODR\");",
    "  regLine(TIM_CR, \"TIM_CR\");",
    "  regLine(TIM_CNT, \"TIM_CNT\", \"(\" + mmioRead(TIM_CNT) + \")\");",
    "  regLine(TIM_ARR, \"TIM_ARR\");",
    "  regLine(UART_SR, \"UART_SR\");",
    "  regLine(I2C_SR, \"I2C_SR\");",
    "  console.log(\"    legend: MODER 2 bits/pin (01=output) · IDR = input wire ·\");",
    "  console.log(\"    ODR pin \" + LED_PIN + \" = LED · TIM_CR bit0=enable, CNT wraps at ARR ·\");",
    "  console.log(\"    UART_SR bit0=byte waiting, bit1=TX ready · I2C_SR bit0/1/3 =\");",
    "  console.log(\"    START / addr-ACK / busy · IDR also reads output pins back.\");",
    "  // a real debugger (SWD/JTAG) can also see chip internals that no",
    "  // register exposes — printed from the live models, not faked:",
    "  console.log(\"  -- debugger view: internals no register exposes --\");",
    "  var pend = [];",
    "  for (var nm in irqPending) if (irqPending[nm]) pend.push(nm);",
    "  console.log(\"    NVIC pending right now: \" + (pend.length ? pend.join(\", \") : \"none\"));",
    "  console.log(\"    UART RX ring: \" + rxRing.count + \" of \" + rxRing.cap + \" bytes buffered (\" + rxRing.dropped + \" dropped so far)\");",
    "  console.log(\"    UART RX message so far: \" + JSON.stringify(rxMessage));",
    "  console.log(\"    I2C slave state machine: \" + accel.state + \" (register pointer 0x\" + hex2(accel.ptr) + \")\");",
    "  console.log(\"    logic analyzer: \" + trace.LED.length + \" ticks recorded on 4 channels\");",
    "}",
    "",
    "function dump_hex_memory(base, len) {",
    "  // A HEX DUMP: each row shows 16 bytes of memory three ways at",
    "  // once — where they live (address), what they are (hex), and",
    "  // what they spell (ASCII text, '.' for bytes that don't print).",
    "  // This is how you find strings and buffers hiding inside RAM.",
    "  console.log(\"-- dump_hex_memory(\" + hex8(base) + \", \" + len + \"): raw memory --\");",
    "  for (var off = 0; off < len; off += 16) {",
    "    var hexPart = \"\", ascPart = \"\";",
    "    for (var i = 0; i < 16; i++) {",
    "      var b = (off + i < len && base + off + i >= SRAM_BASE && base + off + i < SRAM_BASE + SRAM_SIZE)",
    "        ? sram[base + off + i - SRAM_BASE] : 0;",
    "      hexPart += (i ? \" \" : \"\") + hex2(b);",
    "      ascPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : \".\";",
    "    }",
    "    console.log(hex8(base + off) + \" \" + hexPart + \" |\" + ascPart + \"|\");",
    "  }",
    "}",
    "",
    "// ── the logic analyzer ─────────────────────────────────────",
    "// A LOGIC ANALYZER is the digital cousin of an oscilloscope: it",
    "// doesn't care about exact voltages, only \"high or low?\" — for",
    "// several wires at once, sampled tick after tick, so you can",
    "// line events up in time. Ours SAMPLES four wires once per tick:",
    "//   LED    the blinking output pin",
    "//   BTN    the button input pin",
    "//   IRQ    high on any tick where an ISR ran",
    "//   SPIKE  a pretend LIF neuron (the lif-neuron.js neuron wearing",
    "//          a wire) fed by the accelerometer's magnitude. Gravity",
    "//          holds it near threshold, so it fires in little bursts.",
    "// One tick = one sample = one character in plot_trace(). Watch",
    "// SPIKE next to IRQ at the end: a spike and an interrupt are the",
    "// same trick — a discrete event on a wire — in two worlds.",
    "var trace = { LED: [], BTN: [], IRQ: [], SPIKE: [] };",
    "var neuron = { v: 0, THRESH: 0.95 }; // leaky integrate-and-fire state",
    "",
    "function neuronStep() {",
    "  // input: total accel magnitude in g (a resting sensor feels ~1g)",
    "  var gx = decodeI16(accel.regs[0x3B], accel.regs[0x3C]);",
    "  var gy = decodeI16(accel.regs[0x3D], accel.regs[0x3E]);",
    "  var gz = decodeI16(accel.regs[0x3F], accel.regs[0x40]);",
    "  var mag = (Math.abs(gx) + Math.abs(gy) + Math.abs(gz)) / 16384;",
    "  neuron.v += (mag - neuron.v) * 0.18; // integrate, leaking toward the input",
    "  if (neuron.v >= neuron.THRESH) { neuron.v = 0; return 1; } // SPIKE! then reset",
    "  return 0;",
    "}",
    "",
    "function traceTick() { // one snapshot per tick, taken after interrupts are serviced",
    "  trace.LED.push((mmioRead(GPIO_ODR) >> LED_PIN) & 1);",
    "  trace.BTN.push((mmioRead(GPIO_IDR) >> BTN_PIN) & 1);",
    "  trace.IRQ.push(irqPulse ? 1 : 0);",
    "  var spiked = neuronStep();",
    "  if (spiked) neuronFires++;",
    "  if (spiked && faults.dropSpike) { faultStats.spikesDropped++; spiked = 0; } // FAULT: the spike never reached the wire",
    "  trace.SPIKE.push(spiked);",
    "  irqPulse = false;",
    "}",
    "",
    "function waveRow(samples, start, end, spikeStyle) {",
    "  // renders ticks start..end: ‾ = high, _ = low, / and \\ = edges,",
    "  // | = a one-tick spike pulse (too narrow for a ‾ to do justice)",
    "  var row = \"\";",
    "  for (var t = start; t <= end; t++) {",
    "    var s = samples[t - 1] ? 1 : 0;                  // samples[0] is tick 1",
    "    if (spikeStyle) { row += s ? \"|\" : \"_\"; continue; }",
    "    var p = (t > 1) ? (samples[t - 2] ? 1 : 0) : s;  // previous tick",
    "    if (s && !p) row += \"/\";                         // rising edge",
    "    else if (!s && p) row += \"\\\\\";                   // falling edge",
    "    else row += s ? \"‾\" : \"_\";                       // steady high / low",
    "  }",
    "  return row;",
    "}",
    "",
    "function plot_trace(start, end) {",
    "  // 1 char = 1 tick because the analyzer took exactly one snapshot",
    "  // per tick — time runs left to right, one column per snapshot.",
    "  var width = end - start + 1;",
    "  console.log(\"-- plot_trace(): logic analyzer, ticks \" + start + \"..\" + end + \" (1 char = 1 tick) --\");",
    "  var nums = [], marks = \"\";",
    "  for (var i = 0; i < width; i++) nums.push(\" \");",
    "  for (var t = start; t <= end; t++) {",
    "    marks += (t % 10 === 0) ? \"|\" : \" \";",
    "    if (t % 20 === 0) {",
    "      var lbl = String(t);",
    "      for (var k = 0; k < lbl.length && (t - start + k) < width; k++) nums[t - start + k] = lbl[k];",
    "    }",
    "  }",
    "  console.log(\"      \" + nums.join(\"\"));",
    "  console.log(\"      \" + marks);",
    "  console.log(pad(\"LED\", 6) + waveRow(trace.LED, start, end, false));",
    "  console.log(pad(\"BTN\", 6) + waveRow(trace.BTN, start, end, false));",
    "  console.log(pad(\"IRQ\", 6) + waveRow(trace.IRQ, start, end, false));",
    "  console.log(pad(\"SPIKE\", 6) + waveRow(trace.SPIKE, start, end, true));",
    "  console.log(\"      LED=blink pin  BTN=button  IRQ=an ISR ran that tick  SPIKE=neuron fired\");",
    "}",
    "",
    "function plot_overview() {",
    "  // the whole run squashed: one character per 5 ticks,",
    "  // \"high if the wire was high at any point in those 5\"",
    "  console.log(\"-- plot_overview(): all \" + trace.LED.length + \" ticks, squashed 5 ticks per char --\");",
    "  var names = [\"LED\", \"BTN\", \"IRQ\", \"SPIKE\"];",
    "  for (var c = 0; c < names.length; c++) {",
    "    var samples = trace[names[c]], row = \"\";",
    "    for (var b = 0; b < samples.length; b += 5) {",
    "      var any = 0;",
    "      for (var j = b; j < Math.min(b + 5, samples.length); j++) if (samples[j]) any = 1;",
    "      row += (names[c] === \"SPIKE\") ? (any ? \"|\" : \"_\") : (any ? \"‾\" : \"_\");",
    "    }",
    "    console.log(pad(names[c], 6) + row);",
    "  }",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// THE FIRMWARE. From here down, EVERYTHING talks to the chip",
    "// through mmioRead / mmioWrite — no peeking at the models above.",
    "// This is what would be flashed onto the microcontroller.",
    "// ═════════════════════════════════════════════════════════════════",
    "var ledToggles = 0, sampleCount = 0;",
    "",
    "function isrTimer() { // blink the LED: read-modify-write on ODR, MMIO style",
    "  mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) ^ (1 << LED_PIN));",
    "  ledToggles++;",
    "  console.log(\"  timer isr: LED now \" + (((mmioRead(GPIO_ODR) >> LED_PIN) & 1) ? \"ON\" : \"off\"));",
    "}",
    "function isrExti() { // the button pin changed state",
    "  var pressed = (mmioRead(GPIO_IDR) >> BTN_PIN) & 1;",
    "  if (pressed) {",
    "    console.log(\"  exti isr: button PRESSED — queuing a message on the UART\");",
    "    var msg = \"BUTTON!\\n\";",
    "    for (var i = 0; i < msg.length; i++) mmioWrite(UART_TXDR, msg.charCodeAt(i));",
    "  } else {",
    "    console.log(\"  exti isr: button released (no message needed)\");",
    "  }",
    "}",
    "function isrUartRx() { // drain the RX ring into a message buffer",
    "  while (mmioRead(UART_SR) & 1) { // while RXNE: a byte is waiting",
    "    var b = mmioRead(UART_RXDR);",
    "    var ch = String.fromCharCode(b);",
    "    mmioWrite(SRAM_RXBUF + (uartRxCount % 16), b); // byte -> RAM; the 16-byte scratch wraps, circular-buffer style",
    "    rxMessage += ch; uartRxCount++;",
    "    console.log(\"  uart rx isr: drained \" + JSON.stringify(ch) + \" from the ring\");",
    "  }",
    "}",
    "",
    "// an I2C master transaction: read n bytes starting at register reg",
    "function i2cReadBytes(reg, n) {",
    "  var out = [];",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // START",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 0);   // address + Write",
    "  mmioWrite(I2C_DR, reg);                     // which register we want",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // REPEATED START (no STOP: same conversation)",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 1);   // address + Read",
    "  for (var i = 0; i < n; i++) {",
    "    mmioWrite(I2C_CR, (i === n - 1) ? 0 : I2C_CR_ACK); // ACK every byte except the last",
    "    out.push(mmioRead(I2C_DR));",
    "  }",
    "  mmioWrite(I2C_CR, I2C_CR_STOP);             // STOP",
    "  return out;",
    "}",
    "function i2cReadAccel(tick) {",
    "  accelUpdate(tick); // (sim cheat: the sensor refreshed its own data registers)",
    "  var b = i2cReadBytes(ACCEL_DATA, 6);",
    "  for (var m = 0; m < b.length; m++) mmioWrite(SRAM_SAMPLE + m, b[m]); // newest sample kept in RAM",
    "  var raw = [];",
    "  for (var i = 0; i < b.length; i++) raw.push(\"0x\" + hex2(b[i]));",
    "  console.log(\"  raw register bytes: \" + raw.join(\" \") + \"  (high byte, low byte, x3 axes)\");",
    "  var x = decodeI16(b[0], b[1]), y = decodeI16(b[2], b[3]), z = decodeI16(b[4], b[5]);",
    "  console.log(\"  decoded accel: X=\" + (x / 16384).toFixed(3) + \"g  Y=\" + (y / 16384).toFixed(3) +",
    "              \"g  Z=\" + (z / 16384).toFixed(3) + \"g   (16384 counts = 1g)\");",
    "  sampleCount++;",
    "}",
    "",
    "// a paranoid big brother of i2cReadBytes: after addressing the",
    "// slave it checks the NAK flag in I2C_SR, and retries the whole",
    "// transaction a few times before giving up — the error path real",
    "// firmware needs and happy-path firmware never writes.",
    "function i2cReadBytesChecked(reg, n, maxTries) {",
    "  for (var attempt = 1; attempt <= maxTries; attempt++) {",
    "    mmioWrite(I2C_CR, I2C_CR_START);            // START",
    "    mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 0);   // address + Write",
    "    if (mmioRead(I2C_SR) & 4) {                 // NAK flag: the slave refused us",
    "      mmioWrite(I2C_CR, I2C_CR_STOP);           // hang up politely (also frees the bus)",
    "      if (attempt < maxTries) {",
    "        faultStats.i2cRetries++;",
    "        console.log(\"  firmware: slave NAK'd us — bus released, retrying (attempt \" + (attempt + 1) + \" of \" + maxTries + \")\");",
    "        continue;",
    "      }",
    "      faultStats.i2cFailed++;",
    "      console.log(\"  firmware: still NAK'd after \" + maxTries + \" attempts — giving up on this read\");",
    "      return null;",
    "    }",
    "    mmioWrite(I2C_DR, reg);                     // which register we want",
    "    mmioWrite(I2C_CR, I2C_CR_START);            // REPEATED START (same conversation)",
    "    mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 1);   // address + Read",
    "    var out = [];",
    "    for (var i = 0; i < n; i++) {",
    "      mmioWrite(I2C_CR, (i === n - 1) ? 0 : I2C_CR_ACK); // ACK every byte except the last",
    "      out.push(mmioRead(I2C_DR));",
    "    }",
    "    mmioWrite(I2C_CR, I2C_CR_STOP);             // STOP",
    "    if (attempt > 1) faultStats.i2cRecovered++;",
    "    return out;",
    "  }",
    "  return null;",
    "}",
    "",
    "// ── boot: configure the peripherals, firmware-style ─────────",
    "console.log(\"=== peripheral-vm firmware booting ===\");",
    "// leave a calling card in SRAM: real firmware keeps its strings",
    "// and buffers in RAM, and later the hex dump will find this one.",
    "var BANNER = \"peripheral-vm firmware v14\\n\";",
    "for (var bi = 0; bi < BANNER.length; bi++) mmioWrite(SRAM_BANNER + bi, BANNER.charCodeAt(bi));",
    "mmioWrite(GPIO_MODER, mmioRead(GPIO_MODER) | (1 << (LED_PIN * 2))); // 2 bits/pin: 01 = output",
    "mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) & ~(1 << LED_PIN));           // LED starts off",
    "console.log(\"gpio: pin \" + LED_PIN + \" configured as output (MODER = \" + hex8(mmioRead(GPIO_MODER)) + \"), LED off\");",
    "",
    "mmioWrite(TIM_ARR, 40);   // counter climbs 1..ARR, interrupts, wraps — every 40 ticks",
    "mmioWrite(TIM_CR, 1);     // enable",
    "console.log(\"timer: ARR=40, enabled — the LED will blink itself via interrupts\");",
    "",
    "onInterrupt('TIMER', isrTimer);",
    "onInterrupt('EXTI', isrExti);",
    "onInterrupt('UART_RX', isrUartRx);",
    "console.log(\"nvic: ISRs registered (EXTI prio 0 > UART_RX prio 1 > TIMER prio 2)\");",
    "",
    "console.log(\"i2c: checking the accelerometer is really there (WHO_AM_I)...\");",
    "var who = i2cReadBytes(ACCEL_WHOAMI, 1);",
    "console.log(\"  WHO_AM_I = 0x\" + hex2(who[0]) + (who[0] === ACCEL_ADDR ? \" — sensor found, address matches\" : \" — WRONG CHIP?!\"));",
    "mmioWrite(SRAM_WHOAMI, who[0]); // filed in RAM — debugger evidence for the hex dump",
    "",
    "try { // poke an address where nothing lives, to see a bus fault",
    "  mmioRead(0x40009000);",
    "} catch (e) {",
    "  console.log(\"bus fault demo: caught [\" + e.message + \"] — on silicon this is a HardFault\");",
    "}",
    "console.log(\"\");",
    "dump_registers(\"boot: peripherals configured, superloop not started yet\");",
    "console.log(\"\");",
    "",
    "// ── the outside world: a schedule of scheduled pokes ─────────",
    "// The button is held for ticks 200..215; five UART bytes arrive",
    "// every 5 ticks from 230. Everything else is the peripherals'",
    "// own doing. (Real inputs would arrive whenever they wanted —",
    "// which is precisely why interrupts exist.)",
    "var BTN_PRESS = 200, BTN_RELEASE = 216;",
    "var RX_SCHEDULE = { 230: 'P', 235: 'I', 240: 'N', 245: 'G', 250: '\\n' };",
    "var TOTAL_TICKS = 300, prevBtn = 0;",
    "",
    "console.log(\"=== running the superloop for \" + TOTAL_TICKS + \" ticks ===\");",
    "for (var tick = 1; tick <= TOTAL_TICKS; tick++) {",
    "  // 1. the outside world pokes the hardware",
    "  if (tick >= BTN_PRESS && tick < BTN_RELEASE) gpio.idr |= (1 << BTN_PIN);",
    "  else gpio.idr &= ~(1 << BTN_PIN);",
    "  var nowBtn = (gpio.idr >> BTN_PIN) & 1;",
    "  if (nowBtn !== prevBtn) { pendIrq('EXTI'); prevBtn = nowBtn; } // EXTI sees edges",
    "  if (RX_SCHEDULE[tick] !== undefined) uartReceiveByte(RX_SCHEDULE[tick]);",
    "",
    "  // 2. the hardware advances on its own",
    "  tickTimer();",
    "",
    "  // 3. the CPU services interrupts, most urgent first",
    "  dispatchInterrupts(tick);",
    "  traceTick(); // logic analyzer: snapshot LED / BTN / IRQ / SPIKE for this tick",
    "",
    "  // 4. one superloop iteration of foreground work",
    "  if (tick % 60 === 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: periodic sensor read\");",
    "    i2cReadAccel(tick);",
    "  }",
    "  if (rxMessage.indexOf(\"\\n\") >= 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: complete UART message: \" + JSON.stringify(rxMessage.replace(\"\\n\", \"\")) + \" — parsed by the main loop, not the ISR\");",
    "    rxMessage = \"\";",
    "  }",
    "}",
    "",
    "// ── the debugger's last look: memory, waveforms, registers ──",
    "// Same three commands as the boot dump. Same chip. Very different",
    "// state — freezing the machine and diffing \"before\" against",
    "// \"after\" is the whole debugging trick.",
    "dump_hex_memory(SRAM_BASE, 128);",
    "console.log(\"\");",
    "plot_trace(198, 267);",
    "plot_overview();",
    "console.log(\"\");",
    "dump_registers(\"end of run — diff this against the boot dump way above\");",
    "console.log(\"\");",
    "console.log(\"=================== SUMMARY ===================\");",
    "console.log(\"ticks simulated:          \" + TOTAL_TICKS);",
    "console.log(\"TIMER interrupts:         \" + irqCounts.TIMER + \"  (LED toggled \" + ledToggles + \" times)\");",
    "console.log(\"EXTI interrupts (button): \" + irqCounts.EXTI + \"  (press + release)\");",
    "console.log(\"UART_RX interrupts:       \" + irqCounts.UART_RX + \"  (one per received byte)\");",
    "console.log(\"UART TX: \" + uartTxCount + \" bytes -> \" + JSON.stringify(uartTxLog));",
    "console.log(\"UART RX: \" + uartRxCount + \" bytes drained, \" + rxRing.dropped + \" dropped to overflow\");",
    "console.log(\"accelerometer samples:    \" + sampleCount + \" (via full I2C transactions)\");",
    "console.log(\"===============================================\");",
    "console.log(\"notice: the main loop NEVER polled for the button or the UART\");",
    "console.log(\"bytes. Events came to it. That is the whole point of interrupts.\");",
    "",
    "// ─────────────────────────────────────────────────────────────────",
    "// THE BRIDGE TO SPIKING NEURAL NETWORKS",
    "//",
    "// A spike and an interrupt are the same idea in different clothes.",
    "// Both are DISCRETE EVENTS: nothing happens, nothing happens...",
    "// then one event arrives and state changes. The main loop above",
    "// never polled the button or the serial wire — events came to IT,",
    "// exactly like a neuron that sits silent until incoming spikes",
    "// push it over threshold. Event-driven silicon (this pretend chip)",
    "// and event-driven brains (your Nengo networks) save energy the",
    "// same way: by doing nothing until it matters.",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// PART 2 — FAULT INJECTION & HARD-RTOS BENCHMARKING (new in v14)",
    "//",
    "// Part 1 was the chip on a good day. Same chip, same firmware —",
    "// now everything misbehaves at once, on schedule:",
    "//   1. a UART RX interrupt storm (bursts bigger than the ring)",
    "//   2. a jittery timer (the LED's 40-tick metronome wobbles)",
    "//   3. an I2C sensor that NAKs when it feels busy",
    "//   4. spikes that vanish from the neuron channel mid-storm",
    "// The v10 debugger then grades the damage: IRQ latency per",
    "// source, dropped bytes, missed deadlines. Still deterministic:",
    "// seeded RNG, virtual ticks. Run it twice — identical.",
    "// ═════════════════════════════════════════════════════════════════",
    "var RUN_FAULT_SCENARIO = true; // set false to run only clean Part 1",
    "",
    "if (RUN_FAULT_SCENARIO) {",
    "  console.log(\"\");",
    "  console.log(\"=== PART 2: fault injection — same chip, bad day ===\");",
    "  dump_registers(\"before the storm: end-of-Part-1 state, debugger attached\");",
    "",
    "  // keep Part 1's clean bench numbers for the before/after diff,",
    "  // then zero the counters so Part 2 is measured purely",
    "  var cleanStats = snapshotIrqStats();",
    "  resetIrqStats();",
    "  var rxCountMark = uartRxCount;",
    "  var dropMark = rxRing.dropped;",
    "  var fireMark = timerFireTicks.length;   // TIMER toggles across Part 1",
    "  var spikeMark = neuronFires;            // spikes truly fired in Part 1",
    "",
    "  // production RX handler for the storm: identical drain work,",
    "  // zero printfs. (Printing inside an ISR is how deadlines die —",
    "  // and in a byte storm it would flood this very console.)",
    "  function isrUartRxFast() {",
    "    while (mmioRead(UART_SR) & 1) {",
    "      var b = mmioRead(UART_RXDR);",
    "      mmioWrite(SRAM_RXBUF + (uartRxCount % 16), b);",
    "      rxMessage += String.fromCharCode(b);",
    "      uartRxCount++;",
    "    }",
    "  }",
    "  onInterrupt('UART_RX', isrUartRxFast);",
    "  console.log(\"firmware: swapped in the production UART RX handler (silent drain)\");",
    "",
    "  var F_TICKS = 200;                       // Part 2 runs ticks 301..500",
    "  var STORM_START = TOTAL_TICKS + 31;      // 331",
    "  var STORM_END = TOTAL_TICKS + 70;        // 370",
    "  var prevBtn2 = 0;",
    "",
    "  for (var ftick = TOTAL_TICKS + 1; ftick <= TOTAL_TICKS + F_TICKS; ftick++) {",
    "    // the fault schedule arms and disarms the noisy knobs",
    "    if (ftick === STORM_START) {",
    "      faults.jitterOn = true; faults.dropSpike = true;",
    "      timer.jit = Math.floor(rng() * 7) - 2; // calibration knocked sideways at once",
    "      console.log(\"[tick \" + ftick + \"] FAULTS ARMED: UART storm, timer jitter, lossy spikes\");",
    "    }",
    "    if (ftick === STORM_END + 1) {",
    "      faults.dropSpike = false; // jitter stays ON: nobody resyncs the timer",
    "      console.log(\"[tick \" + ftick + \"] storm over: spike channel clean; timer still off-grid\");",
    "    }",
    "    if (ftick === STORM_START + 9) {",
    "      console.log(\"[tick \" + ftick + \"] FAULT: storm static bounces the button line — EXTI glitch\");",
    "    }",
    "    if (ftick >= STORM_START && ftick <= STORM_END) {",
    "      // the storm: seeded bursts of 8..26 bytes at a wire built for 8",
    "      var burst = 8 + [0, 1, 9, 18, 4, 12, 3, 15][Math.floor(rng() * 8)];",
    "      var dropBefore = rxRing.dropped;",
    "      for (var si = 0; si < burst; si++) uartReceiveByte(\"0123456789ABCDEF\"[si % 16]);",
    "      var lostNow = rxRing.dropped - dropBefore;",
    "      if (lostNow > 0) console.log(\"[tick \" + ftick + \"] storm: \" + burst + \" bytes in, ring holds \" +",
    "        rxRing.cap + \" — \" + lostNow + \" DROPPED (ring full)\");",
    "    }",
    "    // storm static bounces the button wire (EMI): glitch presses at",
    "    // STORM_START+9 and — critically — on the timer's tick-360 wrap,",
    "    // so all three interrupts collide in the same tick there",
    "    var glitch = (ftick === STORM_START + 9 || ftick === TOTAL_TICKS + 60);",
    "    var recoveryPress = (ftick >= TOTAL_TICKS + 145 && ftick < TOTAL_TICKS + 150);",
    "    if (glitch || recoveryPress) gpio.idr |= (1 << BTN_PIN); else gpio.idr &= ~(1 << BTN_PIN);",
    "    var nowBtn2 = (gpio.idr >> BTN_PIN) & 1;",
    "    if (nowBtn2 !== prevBtn2) { pendIrq('EXTI'); prevBtn2 = nowBtn2; }",
    "",
    "    // the hardware advances, the CPU services, the analyzer watches",
    "    tickTimer();",
    "    dispatchInterrupts(ftick);",
    "    traceTick();",
    "",
    "    // the sensor's busy minute: one read gets refused, firmware copes",
    "    if (ftick === TOTAL_TICKS + 80) {",
    "      console.log(\"[tick \" + ftick + \"] main loop: sensor read — but the device is mid-conversion...\");",
    "      accelUpdate(ftick);",
    "      faults.nakNext = true; // the next address write gets refused",
    "      var rb = i2cReadBytesChecked(ACCEL_DATA, 6, 3);",
    "      if (rb) {",
    "        for (var mi = 0; mi < rb.length; mi++) mmioWrite(SRAM_SAMPLE + mi, rb[mi]);",
    "        console.log(\"  firmware: recovered sample kept; a NAK is weather, not death\");",
    "        sampleCount++;",
    "      }",
    "    }",
    "    // calm periodic reads once the storm has passed",
    "    if (ftick % 60 === 0 && ftick !== TOTAL_TICKS + 60) { console.log(\"[tick \" + ftick + \"] main loop: periodic sensor read\"); i2cReadAccel(ftick); }",
    "    // clear the storm noise out of the message buffer once it's over",
    "    if (ftick === STORM_END + 2 && rxMessage.length) {",
    "      console.log(\"[tick \" + ftick + \"] main loop: flushing \" + rxMessage.length + \" bytes of storm noise, no message in it\");",
    "      rxMessage = \"\";",
    "    }",
    "  }",
    "",
    "  // ── the deadline report card ──",
    "  // anchor the ideal 40-tick grid on the last toggle before",
    "  // Part 2; every later toggle is graded against its slot.",
    "  var anchorTick = timerFireTicks[fireMark - 1];",
    "  var idealTick = anchorTick, gradedLate = 0, gradedTotal = 0, worstLate = 0;",
    "  for (var gi = fireMark; gi < timerFireTicks.length; gi++) {",
    "    idealTick += 40;",
    "    var lateBy = timerFireTicks[gi] - idealTick;",
    "    gradedTotal++;",
    "    if (lateBy > 0) { gradedLate++; if (lateBy > worstLate) worstLate = lateBy; }",
    "  }",
    "",
    "  console.log(\"\");",
    "  dump_registers(\"after the storm: same chip, storm survived\");",
    "  console.log(\"\");",
    "  plot_trace(STORM_START - 6, STORM_END + 15);",
    "  console.log(\"\");",
    "  console.log(\"================ BENCHMARK SUMMARY (Part 2) ================\");",
    "  function latText(s) { return \"max \" + s.max + \" cyc, mean \" + (s.n ? Math.round(s.total / s.n) : 0) + \" cyc, n=\" + s.n; }",
    "  console.log(\"IRQ latency = cycles an interrupt waited before its ISR ran.\");",
    "  console.log(\"Higher latency = it queued behind other ISRs. Clean vs storm:\");",
    "  console.log(\"  EXTI    (prio 0) clean \" + latText(cleanStats.EXTI));",
    "  console.log(\"                   storm \" + latText(irqLatency.EXTI));",
    "  console.log(\"  UART_RX (prio 1) clean \" + latText(cleanStats.UART_RX));",
    "  console.log(\"                   storm \" + latText(irqLatency.UART_RX));",
    "  console.log(\"  TIMER   (prio 2) clean \" + latText(cleanStats.TIMER));",
    "  console.log(\"                   storm \" + latText(irqLatency.TIMER));",
    "  console.log(\"ticks with >=2 IRQs queued at once: clean \" + cleanStats.saturated + \" -> Part 2 \" + irqSaturatedTicks);",
    "  console.log(\"UART_RX pends swallowed by an already-set flag: \" + irqCoalesced);",
    "  console.log(\"  (the storm pended per byte; the flag remembers one — ISRs served \" + irqLatency.UART_RX.n + \")\");",
    "  var p2Drained = uartRxCount - rxCountMark, p2Dropped = rxRing.dropped - dropMark;",
    "  console.log(\"UART storm drain: \" + p2Drained + \" bytes drained, \" + p2Dropped + \" DROPPED to overflow\");",
    "  console.log(\"LED deadline: \" + gradedTotal + \" toggles graded on the 40-tick grid anchored at tick \" + anchorTick + \":\");",
    "  console.log(\"  \" + gradedLate + \" arrived LATE (worst +\" + worstLate + \" ticks), \" + (gradedTotal - gradedLate) + \" on time or early\");",
    "  console.log(\"I2C: \" + faultStats.i2cNaks + \" NAK weathered, \" + faultStats.i2cRetries + \" retries, \" +",
    "              faultStats.i2cRecovered + \" reads recovered, \" + faultStats.i2cFailed + \" reads lost\");",
    "  console.log(\"SPIKE channel: \" + (neuronFires - spikeMark) + \" true fires in Part 2, \" +",
    "              faultStats.spikesDropped + \" spikes swallowed by the fault\");",
    "  console.log(\"===============================================================\");",
    "  console.log(\"the firmware was identical in both parts. Only the world got worse.\");",
    "  console.log(\"lessons, one line each:\");",
    "  console.log(\"  priorities protect the urgent: EXTI (prio 0) never waited a cycle;\");",
    "  console.log(\"  the polite TIMER queued behind every storm drain instead.\");",
    "  console.log(\"  a ring buffer eats bursts only up to its depth; past it, bytes die.\");",
    "  console.log(\"  jitter never averages out on a deadline grid; the phase error sticks.\");",
    "  console.log(\"  measure latency, don't vibe it: an event is instant, handling isn't.\");",
    "}",
  ].join('\n');

  /* v15 edition: v14 content + plot_raster_v() vertical time raster */
  var PERIPHERAL_VM_SRC = [
    "// ─────────────────────────────────────────────────────────────────",
    "// Microcontroller preset: Register & Peripheral Simulation VM",
    "//",
    "// Real firmware almost never touches the CPU instruction set",
    "// directly. It CONFIGURES PERIPHERALS — the GPIO pins, timers,",
    "// UART serial ports and I2C buses sitting next to the CPU — by",
    "// reading and writing REGISTERS at fixed memory addresses. That",
    "// is called MMIO: Memory-Mapped Input/Output.",
    "//",
    "// This file builds a tiny make-believe chip and then writes",
    "// make-believe FIRMWARE for it, in the same style you would write",
    "// for an STM32: poke registers through the bus, let peripherals",
    "// run on their own, and get interrupted when something happens.",
    "//",
    "// ADDRESS MAP (every access goes through mmioRead / mmioWrite):",
    "//",
    "//   0x20000000  SRAM   256 bytes of scratch RAM (variables, buffers)",
    "//   0x40000000  GPIO   +0x0 MODER  pin modes (2 bits per pin)",
    "//                      +0x4 IDR    input data  (read-only)",
    "//                      +0x8 ODR    output data (what we drive out)",
    "//   0x40001000  TIMER  +0x0 CR     control (bit 0 = enable)",
    "//                      +0x4 CNT    counter, climbs every tick",
    "//                      +0x8 ARR    auto-reload: interrupt at this count",
    "//   0x40002000  UART   +0x0 SR     status (bit 0 = RX byte waiting)",
    "//                      +0x4 TXDR   write a byte -> it is transmitted",
    "//                      +0x8 RXDR   read -> pops the oldest RX byte",
    "//   0x40003000  I2C    +0x0 CR     control (START / STOP / ACK bits)",
    "//                      +0x4 DR     data register (bytes on the wire)",
    "//                      +0x8 SR     status (started / acked / busy)",
    "//",
    "// ACRONYM DECODER (every one of these is standard firmware-speak):",
    "//   MMIO  Memory-Mapped I/O — hardware reached via memory addresses",
    "//   ISR   Interrupt Service Routine — function the CPU runs when an",
    "//         interrupt fires; it pauses the main loop to do so",
    "//   NVIC  Nested Vectored Interrupt Controller — the chip block",
    "//         that prioritises and dispatches interrupts",
    "//   EXTI  External Interrupt — \"a pin changed state\" interrupt",
    "//   MODER/IDR/ODR — GPIO Mode / Input Data / Output Data registers",
    "//   SRAM  Static RAM — the chip's small, forgetful scratch memory",
    "//   HEX DUMP — memory printed as hex bytes AND as readable text",
    "//   LOGIC ANALYZER — a recorder that watches wires as high/low",
    "//        over time (Saleae/Sigrok style); ours draws ASCII waves",
    "//",
    "// V10 EDITION: the chip gains a debugger's toolkit. dump_registers()",
    "// and dump_hex_memory() freeze it and print its insides; a logic",
    "// analyzer trace (plot_trace) draws its wires as ASCII waveforms —",
    "// including one wire driven by a spiking neuron. Watch for them at",
    "// boot and again at the end of the run.",
    "//",
    "// V14 EDITION: fault injection & hard-RTOS benchmarking. After",
    "// the clean run, PART 2 (bottom of this file) gives the same",
    "// chip a very bad day — a UART interrupt storm, a jittery timer,",
    "// an I2C sensor that NAKs when busy, spikes that vanish mid-air —",
    "// then measures the damage with the debugger above: IRQ latency,",
    "// dropped bytes, missed LED deadlines. It answers the question",
    "// every firmware engineer dreads: \"what happens when everything",
    "// goes wrong at the same time?\" Set RUN_FAULT_SCENARIO = false",
    "// (down in Part 2) to run only the clean Part 1 demo.",
    "//",
    "// HOW TO READ THE OUTPUT: the firmware runs a superloop for 300",
    "// simulated ticks. Quiet ticks print nothing. Watch for lines like",
    "//   [tick 200] --- IRQ EXTI (prio 0) -> ISR start ---",
    "// which mean \"the hardware tapped the CPU on the shoulder; the",
    "// main loop is paused while the ISR (indented lines) runs.\"",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "// ── tiny seeded random number generator ─────────────────────────",
    "// mulberry32: same seed -> same sequence, every run, forever.",
    "// The accelerometer uses it for \"sensor wiggle\" so this demo is",
    "// deterministic: run it twice, the output is identical.",
    "function mulberry32(seed) {",
    "  var a = seed >>> 0;",
    "  return function () {",
    "    a |= 0; a = (a + 0x6D2B79F5) | 0;",
    "    var t = Math.imul(a ^ (a >>> 15), 1 | a);",
    "    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
    "    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;",
    "  };",
    "}",
    "var rng = mulberry32(0xC0FFEE);",
    "",
    "// ── register addresses (the \"datasheet\" of our fake chip) ─────",
    "var GPIO_BASE = 0x40000000, TIM_BASE = 0x40001000;",
    "var UART_BASE = 0x40002000, I2C_BASE = 0x40003000;",
    "",
    "var GPIO_MODER = GPIO_BASE + 0x0, GPIO_IDR = GPIO_BASE + 0x4, GPIO_ODR = GPIO_BASE + 0x8;",
    "var TIM_CR = TIM_BASE + 0x0, TIM_CNT = TIM_BASE + 0x4, TIM_ARR = TIM_BASE + 0x8;",
    "var UART_SR = UART_BASE + 0x0, UART_TXDR = UART_BASE + 0x4, UART_RXDR = UART_BASE + 0x8;",
    "var I2C_CR = I2C_BASE + 0x0, I2C_DR = I2C_BASE + 0x4, I2C_SR = I2C_BASE + 0x8;",
    "",
    "// the SRAM map: where the firmware keeps things in RAM",
    "var SRAM_BASE = 0x20000000, SRAM_SIZE = 256;",
    "var SRAM_BANNER = SRAM_BASE + 0x00;  // boot banner string (find it in the hex dump)",
    "var SRAM_RXBUF  = SRAM_BASE + 0x40;  // UART RX bytes, copied here by the RX ISR",
    "var SRAM_SAMPLE = SRAM_BASE + 0x60;  // newest accel sample (6 raw bytes)",
    "var SRAM_WHOAMI = SRAM_BASE + 0x70;  // the WHO_AM_I answer byte, kept as evidence",
    "",
    "var LED_PIN = 5;    // an output pin we can light up (like PA5 on STM32 boards)",
    "var BTN_PIN = 0;    // an input pin wired to a pretend push-button",
    "",
    "function hex2(n) { return (\"0\" + (n & 0xFF).toString(16).toUpperCase()).slice(-2); }",
    "function hex8(n) { return \"0x\" + (\"00000000\" + (n >>> 0).toString(16).toUpperCase()).slice(-8); }",
    "",
    "// ── fault-injection knobs (Part 2; all inert through Part 1) ──",
    "// v14's whole point: flip these on and the chip has a bad day.",
    "//   nakNext   -> the accelerometer refuses its next address (busy)",
    "//   jitterOn  -> the timer reload wobbles a few ticks per interval",
    "//   dropSpike -> the logic analyzer's neuron channel loses spikes",
    "var faults = { nakNext: false, jitterOn: false, dropSpike: false };",
    "var faultStats = { spikesDropped: 0, i2cNaks: 0, i2cRetries: 0, i2cRecovered: 0, i2cFailed: 0 };",
    "var neuronFires = 0; // every spike the neuron TRULY fired (before any dropout)",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// PERIPHERAL MODELS. Each one owns some registers and a little",
    "// internal state. The firmware below may ONLY reach them through",
    "// mmioRead / mmioWrite — exactly like real hardware.",
    "// ═════════════════════════════════════════════════════════════════",
    "",
    "// ── GPIO: pins, modes, and the outside world's button wire ────",
    "var gpio = { moder: 0, idr: 0, odr: 0 }; // idr = levels the world drives IN",
    "",
    "function gpioOutMask() {",
    "  // MODER spends 2 bits per pin; mode 01 means \"output\"",
    "  var m = 0;",
    "  for (var p = 0; p < 16; p++) if (((gpio.moder >> (2 * p)) & 3) === 1) m |= (1 << p);",
    "  return m;",
    "}",
    "function gpioWrite(addr, value) {",
    "  if (addr === GPIO_MODER) { gpio.moder = value; return; }",
    "  if (addr === GPIO_ODR)   { gpio.odr = value; return; }",
    "  if (addr === GPIO_IDR)   { console.log(\"  (gpio: IDR is read-only — write ignored, as on real hardware)\"); return; }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "function gpioRead(addr) {",
    "  if (addr === GPIO_MODER) return gpio.moder;",
    "  if (addr === GPIO_ODR)   return gpio.odr;",
    "  if (addr === GPIO_IDR) {",
    "    // input pins show the outside world; output pins read back what we drive",
    "    var om = gpioOutMask();",
    "    return (gpio.idr & ~om) | (gpio.odr & om);",
    "  }",
    "  throw new Error(\"BUS FAULT: no GPIO register at \" + hex8(addr));",
    "}",
    "",
    "// ── SRAM: 256 bytes of scratch RAM at 0x20000000 ────────────",
    "// SRAM (Static RAM) is the chip's working memory: fast, small,",
    "// and totally forgetful — cut the power and it's gone. Firmware",
    "// keeps its variables, serial buffers and sensor samples in it.",
    "// The firmware below stores a boot banner, the UART RX message",
    "// and the newest sensor sample here, so dump_hex_memory() has",
    "// real content to show you. (Real STM32 SRAM really does start",
    "// at 0x20000000 — that address is not made up.)",
    "var sram = [];",
    "for (var zi = 0; zi < SRAM_SIZE; zi++) sram.push(0);",
    "function sramWrite(addr, value) { sram[addr - SRAM_BASE] = value & 0xFF; }",
    "function sramRead(addr) { return sram[addr - SRAM_BASE]; }",
    "",
    "// ── TIMER: counts up every tick, interrupts at ARR ────────────",
    "var timer = { cr: 0, cnt: 0, arr: 0, jit: 0 };",
    "function timWrite(addr, value) {",
    "  if (addr === TIM_CR)  { timer.cr = value; return; }",
    "  if (addr === TIM_CNT) { timer.cnt = value; return; }",
    "  if (addr === TIM_ARR) { timer.arr = value; return; }",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function timRead(addr) {",
    "  if (addr === TIM_CR)  return timer.cr;",
    "  if (addr === TIM_CNT) return timer.cnt;",
    "  if (addr === TIM_ARR) return timer.arr;",
    "  throw new Error(\"BUS FAULT: no TIMER register at \" + hex8(addr));",
    "}",
    "function tickTimer() { // called once per simulated tick by the main loop",
    "  if (!(timer.cr & 1)) return;              // enable bit off -> frozen",
    "  timer.cnt++;",
    "  // faults.jitterOn (a Part-2 knob, off in Part 1): the reload",
    "  // target wobbles around ARR; timer.jit is re-rolled after every",
    "  // wrap, skewed late under load, so the blink drifts off-grid.",
    "  if (timer.cnt >= timer.arr + (faults.jitterOn ? timer.jit : 0)) {",
    "    timer.cnt = 0;                          // reached the (maybe wobbled) reload...",
    "    if (faults.jitterOn) timer.jit = Math.floor(rng() * 7) - 2; // wobble -2..+4 ticks",
    "    pendIrq('TIMER');                       // ...and tap the CPU",
    "  }",
    "}",
    "",
    "// ── UART: a serial port with a TX log and an RX ring buffer ───",
    "// Incoming bytes land in a small ring (same idea as ring-buffer.js:",
    "// fixed memory, head writes, tail reads, wrap around the circle).",
    "// The \"wire\" side is driven by the stimulus schedule further down.",
    "var rxRing = { cap: 8, buf: [], head: 0, tail: 0, count: 0, dropped: 0 };",
    "var uartTxLog = \"\", uartTxCount = 0, uartRxCount = 0, rxMessage = \"\";",
    "",
    "function uartWrite(addr, value) {",
    "  if (addr === UART_TXDR) {",
    "    var ch = String.fromCharCode(value & 0xFF);",
    "    uartTxLog += ch; uartTxCount++;",
    "    console.log(\"  uart TX -> \" + JSON.stringify(ch) + \" (0x\" + hex2(value) + \")\");",
    "    return;",
    "  }",
    "  if (addr === UART_SR || addr === UART_RXDR) { console.log(\"  (uart: that register is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartRead(addr) {",
    "  if (addr === UART_SR) return (rxRing.count > 0 ? 1 : 0) | 2; // RXNE | TXE(always ready)",
    "  if (addr === UART_RXDR) {",
    "    if (rxRing.count === 0) return -1;",
    "    var b = rxRing.buf[rxRing.tail];",
    "    rxRing.tail = (rxRing.tail + 1) % rxRing.cap;",
    "    rxRing.count--;",
    "    return b;",
    "  }",
    "  if (addr === UART_TXDR) return 0;",
    "  throw new Error(\"BUS FAULT: no UART register at \" + hex8(addr));",
    "}",
    "function uartReceiveByte(ch) { // the outside world sends us a byte",
    "  if (rxRing.count === rxRing.cap) { rxRing.dropped++; }",
    "  else {",
    "    rxRing.buf[rxRing.head] = ch.charCodeAt(0);",
    "    rxRing.head = (rxRing.head + 1) % rxRing.cap;",
    "    rxRing.count++;",
    "  }",
    "  pendIrq('UART_RX'); // \"a byte arrived\" is itself an interrupt",
    "}",
    "",
    "// ── I2C accelerometer: an MPU-6050-style slave at address 0x68 ─",
    "// The slave is an explicit STATE MACHINE. It understands nothing",
    "// until the master drives it through START -> address -> register",
    "// pointer -> data. WHO_AM_I (0x75) answers 0x68: \"yes, I'm here.\"",
    "var ACCEL_ADDR = 0x68, ACCEL_WHOAMI = 0x75, ACCEL_DATA = 0x3B;",
    "var accel = { regs: [], ptr: 0, state: 'IDLE' }; // states: IDLE ADDR REG_PTR DATA_WR DATA_RD",
    "for (var ai = 0; ai < 128; ai++) accel.regs.push(0);",
    "accel.regs[ACCEL_WHOAMI] = 0x68;",
    "",
    "var i2cFlags = { sb: false, addr: false, nack: false, busy: false, ack: false };",
    "var I2C_CR_START = 1, I2C_CR_STOP = 2, I2C_CR_ACK = 4;",
    "",
    "function accelPut16(reg, val) { // one int16 sensor value -> two register bytes, big-endian",
    "  var u = val & 0xFFFF;",
    "  accel.regs[reg] = (u >> 8) & 0xFF;",
    "  accel.regs[reg + 1] = u & 0xFF;",
    "}",
    "function accelUpdate(tick) { // the sensor's own sampling: slow sine drift + seeded wiggle",
    "  accelPut16(0x3B, Math.round(900 * Math.sin(tick * 0.021) + (rng() * 300 - 150)));",
    "  accelPut16(0x3D, Math.round(500 * Math.sin(tick * 0.013 + 1.7) + (rng() * 300 - 150)));",
    "  accelPut16(0x3F, Math.round(16384 + 300 * Math.sin(tick * 0.017 + 0.4) + (rng() * 200 - 100)));",
    "}",
    "function decodeI16(hi, lo) { var v = ((hi << 8) | lo); return v >= 32768 ? v - 65536 : v; }",
    "",
    "function i2cWrite(addr, value) {",
    "  if (addr === I2C_CR) {",
    "    i2cFlags.ack = !!(value & I2C_CR_ACK);",
    "    if (value & I2C_CR_START) {",
    "      console.log(accel.state === 'IDLE' ? \"  i2c: START\" : \"  i2c: REPEATED START\");",
    "      accel.state = 'ADDR';",
    "      i2cFlags.sb = true; i2cFlags.busy = true; i2cFlags.addr = false; i2cFlags.nack = false;",
    "    }",
    "    if (value & I2C_CR_STOP) {",
    "      console.log(\"  i2c: STOP\");",
    "      accel.state = 'IDLE';",
    "      i2cFlags.sb = i2cFlags.addr = i2cFlags.nack = i2cFlags.busy = false;",
    "    }",
    "    return;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state === 'ADDR') {",
    "      var a7 = (value >> 1) & 0x7F, rw = value & 1;",
    "      if (a7 === ACCEL_ADDR && faults.nakNext) {",
    "        // FAULT INJECTED: the sensor is mid-conversion and refuses",
    "        // its own address — the classic \"device busy\" NAK. The",
    "        // master sees the NAK bit in I2C_SR; firmware must cope.",
    "        faults.nakNext = false;",
    "        faultStats.i2cNaks++;",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> NAK (FAULT INJECTED: slave busy)\");",
    "        i2cFlags.nack = true;",
    "        return;",
    "      }",
    "      if (a7 === ACCEL_ADDR) {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> slave ACK\");",
    "        accel.state = rw ? 'DATA_RD' : 'REG_PTR';",
    "        i2cFlags.addr = true;",
    "      } else {",
    "        console.log(\"  i2c: SLA+\" + (rw ? \"R\" : \"W\") + \" 0x\" + hex2(value) + \" -> NACK (nobody at that address)\");",
    "        i2cFlags.nack = true;",
    "      }",
    "      return;",
    "    }",
    "    if (accel.state === 'REG_PTR') {",
    "      accel.ptr = value & 0x7F;",
    "      console.log(\"  i2c: register pointer = 0x\" + hex2(value) + \" -> slave ACK\");",
    "      accel.state = 'DATA_WR';",
    "      return;",
    "    }",
    "    if (accel.state === 'DATA_WR') {",
    "      accel.regs[accel.ptr] = value & 0xFF;",
    "      console.log(\"  i2c: wrote 0x\" + hex2(value) + \" into reg 0x\" + hex2(accel.ptr));",
    "      accel.ptr = (accel.ptr + 1) & 0x7F;",
    "      return;",
    "    }",
    "    console.log(\"  i2c: (DR written outside a transaction — ignored)\");",
    "    return;",
    "  }",
    "  if (addr === I2C_SR) { console.log(\"  (i2c: SR is read-only)\"); return; }",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "function i2cRead(addr) {",
    "  if (addr === I2C_SR) {",
    "    var sr = 0;",
    "    if (i2cFlags.sb) sr |= 1;",
    "    if (i2cFlags.addr) sr |= 2;",
    "    if (i2cFlags.nack) sr |= 4;",
    "    if (i2cFlags.busy) sr |= 8;",
    "    return sr;",
    "  }",
    "  if (addr === I2C_DR) {",
    "    if (accel.state !== 'DATA_RD') { console.log(\"  i2c: (read with no sender — bus floats high, 0xFF)\"); return 0xFF; }",
    "    var b = accel.regs[accel.ptr];",
    "    accel.ptr = (accel.ptr + 1) & 0x7F;",
    "    console.log(\"  i2c: read 0x\" + hex2(b) + (i2cFlags.ack ? \" -> master ACK (send another)\" : \" -> master NACK (that's all)\"));",
    "    return b;",
    "  }",
    "  if (addr === I2C_CR) return 0;",
    "  throw new Error(\"BUS FAULT: no I2C register at \" + hex8(addr));",
    "}",
    "",
    "// ── the MMIO bus itself ────────────────────────────────────────",
    "// One door into every peripheral. Wrong address = bus fault, and",
    "// the CPU hears about it immediately (a thrown error here; a",
    "// HardFault exception on real silicon).",
    "function mmioWrite(addr, value) {",
    "  if (addr >= SRAM_BASE && addr < SRAM_BASE + SRAM_SIZE) { sramWrite(addr, value); return; }",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioWrite(addr, value);",
    "  if (block === TIM_BASE) return timWrite(addr, value);",
    "  if (block === UART_BASE) return uartWrite(addr, value);",
    "  if (block === I2C_BASE) return i2cWrite(addr, value);",
    "  throw new Error(\"BUS FAULT: mmioWrite to unmapped address \" + hex8(addr));",
    "}",
    "function mmioRead(addr) {",
    "  if (addr >= SRAM_BASE && addr < SRAM_BASE + SRAM_SIZE) return sramRead(addr);",
    "  var block = addr & 0xFFFFF000;",
    "  if (block === GPIO_BASE) return gpioRead(addr);",
    "  if (block === TIM_BASE) return timRead(addr);",
    "  if (block === UART_BASE) return uartRead(addr);",
    "  if (block === I2C_BASE) return i2cRead(addr);",
    "  throw new Error(\"BUS FAULT: mmioRead from unmapped address \" + hex8(addr));",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// NVIC: the interrupt controller. Priorities are numbers where",
    "// LOWER wins (0 is the most urgent). Real NVIC hardware can nest",
    "// a high-priority ISR inside a low-priority one (preemption);",
    "// this simulator simplifies: ISRs run to completion, highest",
    "// priority first, then the main loop resumes. The visible effect",
    "// — \"urgent events jump the queue\" — is the same.",
    "// ═════════════════════════════════════════════════════════════════",
    "var IRQ_PRIO = { EXTI: 0, UART_RX: 1, TIMER: 2 };",
    "var irqPending = { EXTI: false, UART_RX: false, TIMER: false };",
    "var irqHandlers = {};",
    "var irqCounts = { EXTI: 0, UART_RX: 0, TIMER: 0 };",
    "var irqPulse = false; // latched high for any tick in which an ISR ran (logic-analyzer fodder)",
    "",
    "// ── benchmark counters (silent in Part 1; read aloud in Part 2) ──",
    "// Hard-RTOS benchmarking asks one question: HOW LONG does an event",
    "// wait before the CPU answers it? pendIrq stamps each interrupt",
    "// with the simulated CPU-cycle count; the dispatcher measures the",
    "// gap to the moment its ISR actually starts. cpuCycles advances",
    "// by each ISR's rough execution cost (a UART drain costs more",
    "// than a blink), so a polite low-priority interrupt stuck behind",
    "// a storm shows a big number here — starvation, made measurable.",
    "var cpuCycles = 0;",
    "var IRQ_COST = { EXTI: 48, UART_RX: 16, TIMER: 24 }; // base cost per ISR",
    "var IRQ_BYTE_COST = { EXTI: 2, UART_RX: 12, TIMER: 0 }; // per byte moved: queueing TX is cheap, draining RX is not",
    "var irqPendCycle = { EXTI: -1, UART_RX: -1, TIMER: -1 };",
    "var irqLatency = {",
    "  EXTI:    { n: 0, total: 0, max: 0 },",
    "  UART_RX: { n: 0, total: 0, max: 0 },",
    "  TIMER:   { n: 0, total: 0, max: 0 }",
    "};",
    "var irqSaturatedTicks = 0, irqLastSatTick = -1; // ticks where >=2 IRQs queued at once",
    "var irqCoalesced = 0;        // extra pends that landed while one was already waiting",
    "var timerFireTicks = [];     // every tick the TIMER ISR ran (deadline bookkeeping)",
    "",
    "function snapshotIrqStats() {",
    "  function cp(o) { return { n: o.n, total: o.total, max: o.max }; }",
    "  return { saturated: irqSaturatedTicks, coalesced: irqCoalesced,",
    "           EXTI: cp(irqLatency.EXTI), UART_RX: cp(irqLatency.UART_RX), TIMER: cp(irqLatency.TIMER) };",
    "}",
    "function resetIrqStats() {",
    "  cpuCycles = 0; irqSaturatedTicks = 0; irqLastSatTick = -1; irqCoalesced = 0;",
    "  irqPendCycle = { EXTI: -1, UART_RX: -1, TIMER: -1 };",
    "  irqLatency = { EXTI: { n: 0, total: 0, max: 0 }, UART_RX: { n: 0, total: 0, max: 0 }, TIMER: { n: 0, total: 0, max: 0 } };",
    "}",
    "",
    "function onInterrupt(name, fn) { irqHandlers[name] = fn; }",
    "function pendIrq(name) {",
    "  if (irqPending[name]) irqCoalesced++;          // the storm pends faster than anyone services",
    "  else irqPendCycle[name] = cpuCycles;           // first pend: start this interrupt's latency clock",
    "  irqPending[name] = true;",
    "}",
    "function dispatchInterrupts(tick) {",
    "  var queueAnnounced = false;",
    "  for (;;) {",
    "    var waiting = [];",
    "    for (var name in irqPending) if (irqPending[name]) waiting.push(name);",
    "    if (!waiting.length) return; // nobody waiting: back to the main loop",
    "    waiting.sort(function (a, b) { return IRQ_PRIO[a] - IRQ_PRIO[b]; });",
    "    if (waiting.length > 1 && !queueAnnounced) {",
    "      queueAnnounced = true;",
    "      var parts = [];",
    "      for (var i = 0; i < waiting.length; i++) parts.push(waiting[i] + \" prio \" + IRQ_PRIO[waiting[i]]);",
    "      console.log(\"[tick \" + tick + \"] \" + waiting.length + \" interrupts pending at once (\" +",
    "                  parts.join(\", \") + \") — lowest priority number runs first\");",
    "    }",
    "    if (waiting.length > 1 && tick !== irqLastSatTick) { irqSaturatedTicks++; irqLastSatTick = tick; }",
    "    var best = waiting[0];",
    "    irqPending[best] = false;  // clear BEFORE running, so an ISR may re-pend itself",
    "    irqPulse = true;           // an ISR is about to run: the IRQ wire goes high",
    "    irqCounts[best]++;",
    "    var latNow = cpuCycles - (irqPendCycle[best] < 0 ? cpuCycles : irqPendCycle[best]);",
    "    var latStat = irqLatency[best];",
    "    latStat.n++; latStat.total += latNow; if (latNow > latStat.max) latStat.max = latNow;",
    "    irqPendCycle[best] = -1;",
    "    if (best === 'TIMER') timerFireTicks.push(tick);",
    "    var txBefore = uartTxCount, rxBefore = uartRxCount;",
    "    console.log(\"[tick \" + tick + \"] --- IRQ \" + best + \" (prio \" + IRQ_PRIO[best] + \") -> ISR start ---\");",
    "    if (irqHandlers[best]) irqHandlers[best]();",
    "    cpuCycles += IRQ_COST[best] + IRQ_BYTE_COST[best] * ((uartTxCount - txBefore) + (uartRxCount - rxBefore));",
    "    console.log(\"[tick \" + tick + \"] --- ISR end, resuming main loop ---\");",
    "  }",
    "}",
    "",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// THE DEBUGGER'S TOOLKIT (new in v10)",
    "//",
    "// Real embedded work is half \"run it\" and half \"freeze it and",
    "// stare at it\". Tools like Renode, QEMU and GDB let you pause a",
    "// chip mid-program and dump its registers and memory — the",
    "// bare-metal debugger feel, no GDB required. These three helpers",
    "// fake that pause. Their snake_case names are deliberate: they",
    "// are the commands you would type at a debugger console.",
    "//",
    "// Nothing here is canned output: dump_registers reads the live",
    "// registers back through mmioRead, exactly like firmware would.",
    "// ═════════════════════════════════════════════════════════════════",
    "function pad(s, n) { s = String(s); while (s.length < n) s += \" \"; return s; }",
    "function bin32(n) { // 32 bits grouped in bytes: bit31 far left, bit0 far right",
    "  var s = (\"00000000000000000000000000000000\" + (n >>> 0).toString(2)).slice(-32);",
    "  return s.slice(0, 8) + \" \" + s.slice(8, 16) + \" \" + s.slice(16, 24) + \" \" + s.slice(24);",
    "}",
    "",
    "function regLine(addr, name, hint) {",
    "  var v = mmioRead(addr);",
    "  var line = hex8(addr) + \"  \" + pad(name, 12) + hex8(v) + \"  \" + bin32(v);",
    "  console.log(hint ? line + \"  \" + hint : line);",
    "}",
    "",
    "function dump_registers(label) {",
    "  console.log(\"-- dump_registers(): execution paused, debugger attached --\");",
    "  if (label) console.log(\"   (\" + label + \")\");",
    "  console.log(pad(\"ADDR\", 12) + pad(\"REGISTER\", 12) + pad(\"VALUE\", 12) + \"BINARY bit31...................bit0\");",
    "  regLine(GPIO_MODER, \"GPIO_MODER\");",
    "  regLine(GPIO_IDR, \"GPIO_IDR\");",
    "  regLine(GPIO_ODR, \"GPIO_ODR\");",
    "  regLine(TIM_CR, \"TIM_CR\");",
    "  regLine(TIM_CNT, \"TIM_CNT\", \"(\" + mmioRead(TIM_CNT) + \")\");",
    "  regLine(TIM_ARR, \"TIM_ARR\");",
    "  regLine(UART_SR, \"UART_SR\");",
    "  regLine(I2C_SR, \"I2C_SR\");",
    "  console.log(\"    legend: MODER 2 bits/pin (01=output) · IDR = input wire ·\");",
    "  console.log(\"    ODR pin \" + LED_PIN + \" = LED · TIM_CR bit0=enable, CNT wraps at ARR ·\");",
    "  console.log(\"    UART_SR bit0=byte waiting, bit1=TX ready · I2C_SR bit0/1/3 =\");",
    "  console.log(\"    START / addr-ACK / busy · IDR also reads output pins back.\");",
    "  // a real debugger (SWD/JTAG) can also see chip internals that no",
    "  // register exposes — printed from the live models, not faked:",
    "  console.log(\"  -- debugger view: internals no register exposes --\");",
    "  var pend = [];",
    "  for (var nm in irqPending) if (irqPending[nm]) pend.push(nm);",
    "  console.log(\"    NVIC pending right now: \" + (pend.length ? pend.join(\", \") : \"none\"));",
    "  console.log(\"    UART RX ring: \" + rxRing.count + \" of \" + rxRing.cap + \" bytes buffered (\" + rxRing.dropped + \" dropped so far)\");",
    "  console.log(\"    UART RX message so far: \" + JSON.stringify(rxMessage));",
    "  console.log(\"    I2C slave state machine: \" + accel.state + \" (register pointer 0x\" + hex2(accel.ptr) + \")\");",
    "  console.log(\"    logic analyzer: \" + trace.LED.length + \" ticks recorded on 4 channels\");",
    "}",
    "",
    "function dump_hex_memory(base, len) {",
    "  // A HEX DUMP: each row shows 16 bytes of memory three ways at",
    "  // once — where they live (address), what they are (hex), and",
    "  // what they spell (ASCII text, '.' for bytes that don't print).",
    "  // This is how you find strings and buffers hiding inside RAM.",
    "  console.log(\"-- dump_hex_memory(\" + hex8(base) + \", \" + len + \"): raw memory --\");",
    "  for (var off = 0; off < len; off += 16) {",
    "    var hexPart = \"\", ascPart = \"\";",
    "    for (var i = 0; i < 16; i++) {",
    "      var b = (off + i < len && base + off + i >= SRAM_BASE && base + off + i < SRAM_BASE + SRAM_SIZE)",
    "        ? sram[base + off + i - SRAM_BASE] : 0;",
    "      hexPart += (i ? \" \" : \"\") + hex2(b);",
    "      ascPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : \".\";",
    "    }",
    "    console.log(hex8(base + off) + \" \" + hexPart + \" |\" + ascPart + \"|\");",
    "  }",
    "}",
    "",
    "// ── the logic analyzer ─────────────────────────────────────",
    "// A LOGIC ANALYZER is the digital cousin of an oscilloscope: it",
    "// doesn't care about exact voltages, only \"high or low?\" — for",
    "// several wires at once, sampled tick after tick, so you can",
    "// line events up in time. Ours SAMPLES four wires once per tick:",
    "//   LED    the blinking output pin",
    "//   BTN    the button input pin",
    "//   IRQ    high on any tick where an ISR ran",
    "//   SPIKE  a pretend LIF neuron (the lif-neuron.js neuron wearing",
    "//          a wire) fed by the accelerometer's magnitude. Gravity",
    "//          holds it near threshold, so it fires in little bursts.",
    "// One tick = one sample = one character in plot_trace(). Watch",
    "// SPIKE next to IRQ at the end: a spike and an interrupt are the",
    "// same trick — a discrete event on a wire — in two worlds.",
    "var trace = { LED: [], BTN: [], IRQ: [], SPIKE: [] };",
    "var neuron = { v: 0, THRESH: 0.95 }; // leaky integrate-and-fire state",
    "",
    "function neuronStep() {",
    "  // input: total accel magnitude in g (a resting sensor feels ~1g)",
    "  var gx = decodeI16(accel.regs[0x3B], accel.regs[0x3C]);",
    "  var gy = decodeI16(accel.regs[0x3D], accel.regs[0x3E]);",
    "  var gz = decodeI16(accel.regs[0x3F], accel.regs[0x40]);",
    "  var mag = (Math.abs(gx) + Math.abs(gy) + Math.abs(gz)) / 16384;",
    "  neuron.v += (mag - neuron.v) * 0.18; // integrate, leaking toward the input",
    "  if (neuron.v >= neuron.THRESH) { neuron.v = 0; return 1; } // SPIKE! then reset",
    "  return 0;",
    "}",
    "",
    "function traceTick() { // one snapshot per tick, taken after interrupts are serviced",
    "  trace.LED.push((mmioRead(GPIO_ODR) >> LED_PIN) & 1);",
    "  trace.BTN.push((mmioRead(GPIO_IDR) >> BTN_PIN) & 1);",
    "  trace.IRQ.push(irqPulse ? 1 : 0);",
    "  var spiked = neuronStep();",
    "  if (spiked) neuronFires++;",
    "  if (spiked && faults.dropSpike) { faultStats.spikesDropped++; spiked = 0; } // FAULT: the spike never reached the wire",
    "  trace.SPIKE.push(spiked);",
    "  irqPulse = false;",
    "}",
    "",
    "function waveRow(samples, start, end, spikeStyle) {",
    "  // renders ticks start..end: ‾ = high, _ = low, / and \\ = edges,",
    "  // | = a one-tick spike pulse (too narrow for a ‾ to do justice)",
    "  var row = \"\";",
    "  for (var t = start; t <= end; t++) {",
    "    var s = samples[t - 1] ? 1 : 0;                  // samples[0] is tick 1",
    "    if (spikeStyle) { row += s ? \"|\" : \"_\"; continue; }",
    "    var p = (t > 1) ? (samples[t - 2] ? 1 : 0) : s;  // previous tick",
    "    if (s && !p) row += \"/\";                         // rising edge",
    "    else if (!s && p) row += \"\\\\\";                   // falling edge",
    "    else row += s ? \"‾\" : \"_\";                       // steady high / low",
    "  }",
    "  return row;",
    "}",
    "",
    "function plot_trace(start, end) {",
    "  // 1 char = 1 tick because the analyzer took exactly one snapshot",
    "  // per tick — time runs left to right, one column per snapshot.",
    "  var width = end - start + 1;",
    "  console.log(\"-- plot_trace(): logic analyzer, ticks \" + start + \"..\" + end + \" (1 char = 1 tick) --\");",
    "  var nums = [], marks = \"\";",
    "  for (var i = 0; i < width; i++) nums.push(\" \");",
    "  for (var t = start; t <= end; t++) {",
    "    marks += (t % 10 === 0) ? \"|\" : \" \";",
    "    if (t % 20 === 0) {",
    "      var lbl = String(t);",
    "      for (var k = 0; k < lbl.length && (t - start + k) < width; k++) nums[t - start + k] = lbl[k];",
    "    }",
    "  }",
    "  console.log(\"      \" + nums.join(\"\"));",
    "  console.log(\"      \" + marks);",
    "  console.log(pad(\"LED\", 6) + waveRow(trace.LED, start, end, false));",
    "  console.log(pad(\"BTN\", 6) + waveRow(trace.BTN, start, end, false));",
    "  console.log(pad(\"IRQ\", 6) + waveRow(trace.IRQ, start, end, false));",
    "  console.log(pad(\"SPIKE\", 6) + waveRow(trace.SPIKE, start, end, true));",
    "  console.log(\"      LED=blink pin  BTN=button  IRQ=an ISR ran that tick  SPIKE=neuron fired\");",
    "}",
    "",
    "// ── vertical time raster: the phone-width cousin of plot_trace ──",
    "// WHY vertical: plot_trace draws time left-to-right, one column per tick.",
    "// past ~40 ticks that needs sideways scrolling on a phone. this raster",
    "// rotates the timing diagram 90 degrees: time runs DOWN the screen, one",
    "// row per tick, the four channels across. it fits a narrow screen and",
    "// still reads like a timing diagram — scan it with your thumb.",
    "function plot_raster_v(start, end) {",
    "  // clamp to the trace so short runs never read off the end",
    "  start = Math.max(0, start);",
    "  end = Math.min(trace.LED.length - 1, end);",
    "  console.log(\"-- plot_raster_v(): vertical time raster, ticks \" + start + \"..\" + end + \" (time runs DOWN) --\");",
    "  console.log(\"  t  | LED BTN IRQ SPK\");",
    "  for (var t = start; t <= end; t++) {",
    "    var ch = [trace.LED[t], trace.BTN[t], trace.IRQ[t], trace.SPIKE[t]];",
    "    var cells = \"\";",
    "    for (var c = 0; c < 4; c++) cells += (ch[c] ? \" ▮ \" : \" · \") + \" \";",
    "    console.log(pad(String(t), 4) + \"| \" + cells);",
    "  }",
    "}",
    "",
    "function plot_overview() {",
    "  // the whole run squashed: one character per 5 ticks,",
    "  // \"high if the wire was high at any point in those 5\"",
    "  console.log(\"-- plot_overview(): all \" + trace.LED.length + \" ticks, squashed 5 ticks per char --\");",
    "  var names = [\"LED\", \"BTN\", \"IRQ\", \"SPIKE\"];",
    "  for (var c = 0; c < names.length; c++) {",
    "    var samples = trace[names[c]], row = \"\";",
    "    for (var b = 0; b < samples.length; b += 5) {",
    "      var any = 0;",
    "      for (var j = b; j < Math.min(b + 5, samples.length); j++) if (samples[j]) any = 1;",
    "      row += (names[c] === \"SPIKE\") ? (any ? \"|\" : \"_\") : (any ? \"‾\" : \"_\");",
    "    }",
    "    console.log(pad(names[c], 6) + row);",
    "  }",
    "}",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// THE FIRMWARE. From here down, EVERYTHING talks to the chip",
    "// through mmioRead / mmioWrite — no peeking at the models above.",
    "// This is what would be flashed onto the microcontroller.",
    "// ═════════════════════════════════════════════════════════════════",
    "var ledToggles = 0, sampleCount = 0;",
    "",
    "function isrTimer() { // blink the LED: read-modify-write on ODR, MMIO style",
    "  mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) ^ (1 << LED_PIN));",
    "  ledToggles++;",
    "  console.log(\"  timer isr: LED now \" + (((mmioRead(GPIO_ODR) >> LED_PIN) & 1) ? \"ON\" : \"off\"));",
    "}",
    "function isrExti() { // the button pin changed state",
    "  var pressed = (mmioRead(GPIO_IDR) >> BTN_PIN) & 1;",
    "  if (pressed) {",
    "    console.log(\"  exti isr: button PRESSED — queuing a message on the UART\");",
    "    var msg = \"BUTTON!\\n\";",
    "    for (var i = 0; i < msg.length; i++) mmioWrite(UART_TXDR, msg.charCodeAt(i));",
    "  } else {",
    "    console.log(\"  exti isr: button released (no message needed)\");",
    "  }",
    "}",
    "function isrUartRx() { // drain the RX ring into a message buffer",
    "  while (mmioRead(UART_SR) & 1) { // while RXNE: a byte is waiting",
    "    var b = mmioRead(UART_RXDR);",
    "    var ch = String.fromCharCode(b);",
    "    mmioWrite(SRAM_RXBUF + (uartRxCount % 16), b); // byte -> RAM; the 16-byte scratch wraps, circular-buffer style",
    "    rxMessage += ch; uartRxCount++;",
    "    console.log(\"  uart rx isr: drained \" + JSON.stringify(ch) + \" from the ring\");",
    "  }",
    "}",
    "",
    "// an I2C master transaction: read n bytes starting at register reg",
    "function i2cReadBytes(reg, n) {",
    "  var out = [];",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // START",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 0);   // address + Write",
    "  mmioWrite(I2C_DR, reg);                     // which register we want",
    "  mmioWrite(I2C_CR, I2C_CR_START);            // REPEATED START (no STOP: same conversation)",
    "  mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 1);   // address + Read",
    "  for (var i = 0; i < n; i++) {",
    "    mmioWrite(I2C_CR, (i === n - 1) ? 0 : I2C_CR_ACK); // ACK every byte except the last",
    "    out.push(mmioRead(I2C_DR));",
    "  }",
    "  mmioWrite(I2C_CR, I2C_CR_STOP);             // STOP",
    "  return out;",
    "}",
    "function i2cReadAccel(tick) {",
    "  accelUpdate(tick); // (sim cheat: the sensor refreshed its own data registers)",
    "  var b = i2cReadBytes(ACCEL_DATA, 6);",
    "  for (var m = 0; m < b.length; m++) mmioWrite(SRAM_SAMPLE + m, b[m]); // newest sample kept in RAM",
    "  var raw = [];",
    "  for (var i = 0; i < b.length; i++) raw.push(\"0x\" + hex2(b[i]));",
    "  console.log(\"  raw register bytes: \" + raw.join(\" \") + \"  (high byte, low byte, x3 axes)\");",
    "  var x = decodeI16(b[0], b[1]), y = decodeI16(b[2], b[3]), z = decodeI16(b[4], b[5]);",
    "  console.log(\"  decoded accel: X=\" + (x / 16384).toFixed(3) + \"g  Y=\" + (y / 16384).toFixed(3) +",
    "              \"g  Z=\" + (z / 16384).toFixed(3) + \"g   (16384 counts = 1g)\");",
    "  sampleCount++;",
    "}",
    "",
    "// a paranoid big brother of i2cReadBytes: after addressing the",
    "// slave it checks the NAK flag in I2C_SR, and retries the whole",
    "// transaction a few times before giving up — the error path real",
    "// firmware needs and happy-path firmware never writes.",
    "function i2cReadBytesChecked(reg, n, maxTries) {",
    "  for (var attempt = 1; attempt <= maxTries; attempt++) {",
    "    mmioWrite(I2C_CR, I2C_CR_START);            // START",
    "    mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 0);   // address + Write",
    "    if (mmioRead(I2C_SR) & 4) {                 // NAK flag: the slave refused us",
    "      mmioWrite(I2C_CR, I2C_CR_STOP);           // hang up politely (also frees the bus)",
    "      if (attempt < maxTries) {",
    "        faultStats.i2cRetries++;",
    "        console.log(\"  firmware: slave NAK'd us — bus released, retrying (attempt \" + (attempt + 1) + \" of \" + maxTries + \")\");",
    "        continue;",
    "      }",
    "      faultStats.i2cFailed++;",
    "      console.log(\"  firmware: still NAK'd after \" + maxTries + \" attempts — giving up on this read\");",
    "      return null;",
    "    }",
    "    mmioWrite(I2C_DR, reg);                     // which register we want",
    "    mmioWrite(I2C_CR, I2C_CR_START);            // REPEATED START (same conversation)",
    "    mmioWrite(I2C_DR, (ACCEL_ADDR << 1) | 1);   // address + Read",
    "    var out = [];",
    "    for (var i = 0; i < n; i++) {",
    "      mmioWrite(I2C_CR, (i === n - 1) ? 0 : I2C_CR_ACK); // ACK every byte except the last",
    "      out.push(mmioRead(I2C_DR));",
    "    }",
    "    mmioWrite(I2C_CR, I2C_CR_STOP);             // STOP",
    "    if (attempt > 1) faultStats.i2cRecovered++;",
    "    return out;",
    "  }",
    "  return null;",
    "}",
    "",
    "// ── boot: configure the peripherals, firmware-style ─────────",
    "console.log(\"=== peripheral-vm firmware booting ===\");",
    "// leave a calling card in SRAM: real firmware keeps its strings",
    "// and buffers in RAM, and later the hex dump will find this one.",
    "var BANNER = \"peripheral-vm firmware v15\\n\";",
    "for (var bi = 0; bi < BANNER.length; bi++) mmioWrite(SRAM_BANNER + bi, BANNER.charCodeAt(bi));",
    "mmioWrite(GPIO_MODER, mmioRead(GPIO_MODER) | (1 << (LED_PIN * 2))); // 2 bits/pin: 01 = output",
    "mmioWrite(GPIO_ODR, mmioRead(GPIO_ODR) & ~(1 << LED_PIN));           // LED starts off",
    "console.log(\"gpio: pin \" + LED_PIN + \" configured as output (MODER = \" + hex8(mmioRead(GPIO_MODER)) + \"), LED off\");",
    "",
    "mmioWrite(TIM_ARR, 40);   // counter climbs 1..ARR, interrupts, wraps — every 40 ticks",
    "mmioWrite(TIM_CR, 1);     // enable",
    "console.log(\"timer: ARR=40, enabled — the LED will blink itself via interrupts\");",
    "",
    "onInterrupt('TIMER', isrTimer);",
    "onInterrupt('EXTI', isrExti);",
    "onInterrupt('UART_RX', isrUartRx);",
    "console.log(\"nvic: ISRs registered (EXTI prio 0 > UART_RX prio 1 > TIMER prio 2)\");",
    "",
    "console.log(\"i2c: checking the accelerometer is really there (WHO_AM_I)...\");",
    "var who = i2cReadBytes(ACCEL_WHOAMI, 1);",
    "console.log(\"  WHO_AM_I = 0x\" + hex2(who[0]) + (who[0] === ACCEL_ADDR ? \" — sensor found, address matches\" : \" — WRONG CHIP?!\"));",
    "mmioWrite(SRAM_WHOAMI, who[0]); // filed in RAM — debugger evidence for the hex dump",
    "",
    "try { // poke an address where nothing lives, to see a bus fault",
    "  mmioRead(0x40009000);",
    "} catch (e) {",
    "  console.log(\"bus fault demo: caught [\" + e.message + \"] — on silicon this is a HardFault\");",
    "}",
    "console.log(\"\");",
    "dump_registers(\"boot: peripherals configured, superloop not started yet\");",
    "console.log(\"\");",
    "",
    "// ── the outside world: a schedule of scheduled pokes ─────────",
    "// The button is held for ticks 200..215; five UART bytes arrive",
    "// every 5 ticks from 230. Everything else is the peripherals'",
    "// own doing. (Real inputs would arrive whenever they wanted —",
    "// which is precisely why interrupts exist.)",
    "var BTN_PRESS = 200, BTN_RELEASE = 216;",
    "var RX_SCHEDULE = { 230: 'P', 235: 'I', 240: 'N', 245: 'G', 250: '\\n' };",
    "var TOTAL_TICKS = 300, prevBtn = 0;",
    "",
    "console.log(\"=== running the superloop for \" + TOTAL_TICKS + \" ticks ===\");",
    "for (var tick = 1; tick <= TOTAL_TICKS; tick++) {",
    "  // 1. the outside world pokes the hardware",
    "  if (tick >= BTN_PRESS && tick < BTN_RELEASE) gpio.idr |= (1 << BTN_PIN);",
    "  else gpio.idr &= ~(1 << BTN_PIN);",
    "  var nowBtn = (gpio.idr >> BTN_PIN) & 1;",
    "  if (nowBtn !== prevBtn) { pendIrq('EXTI'); prevBtn = nowBtn; } // EXTI sees edges",
    "  if (RX_SCHEDULE[tick] !== undefined) uartReceiveByte(RX_SCHEDULE[tick]);",
    "",
    "  // 2. the hardware advances on its own",
    "  tickTimer();",
    "",
    "  // 3. the CPU services interrupts, most urgent first",
    "  dispatchInterrupts(tick);",
    "  traceTick(); // logic analyzer: snapshot LED / BTN / IRQ / SPIKE for this tick",
    "",
    "  // 4. one superloop iteration of foreground work",
    "  if (tick % 60 === 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: periodic sensor read\");",
    "    i2cReadAccel(tick);",
    "  }",
    "  if (rxMessage.indexOf(\"\\n\") >= 0) {",
    "    console.log(\"[tick \" + tick + \"] main loop: complete UART message: \" + JSON.stringify(rxMessage.replace(\"\\n\", \"\")) + \" — parsed by the main loop, not the ISR\");",
    "    rxMessage = \"\";",
    "  }",
    "}",
    "",
    "// ── the debugger's last look: memory, waveforms, registers ──",
    "// Same three commands as the boot dump. Same chip. Very different",
    "// state — freezing the machine and diffing \"before\" against",
    "// \"after\" is the whole debugging trick.",
    "dump_hex_memory(SRAM_BASE, 128);",
    "console.log(\"\");",
    "plot_trace(198, 267);",
    "plot_raster_v(198, 221);",
    "plot_overview();",
    "console.log(\"\");",
    "dump_registers(\"end of run — diff this against the boot dump way above\");",
    "console.log(\"\");",
    "console.log(\"=================== SUMMARY ===================\");",
    "console.log(\"ticks simulated:          \" + TOTAL_TICKS);",
    "console.log(\"TIMER interrupts:         \" + irqCounts.TIMER + \"  (LED toggled \" + ledToggles + \" times)\");",
    "console.log(\"EXTI interrupts (button): \" + irqCounts.EXTI + \"  (press + release)\");",
    "console.log(\"UART_RX interrupts:       \" + irqCounts.UART_RX + \"  (one per received byte)\");",
    "console.log(\"UART TX: \" + uartTxCount + \" bytes -> \" + JSON.stringify(uartTxLog));",
    "console.log(\"UART RX: \" + uartRxCount + \" bytes drained, \" + rxRing.dropped + \" dropped to overflow\");",
    "console.log(\"accelerometer samples:    \" + sampleCount + \" (via full I2C transactions)\");",
    "console.log(\"===============================================\");",
    "console.log(\"notice: the main loop NEVER polled for the button or the UART\");",
    "console.log(\"bytes. Events came to it. That is the whole point of interrupts.\");",
    "",
    "// ─────────────────────────────────────────────────────────────────",
    "// THE BRIDGE TO SPIKING NEURAL NETWORKS",
    "//",
    "// A spike and an interrupt are the same idea in different clothes.",
    "// Both are DISCRETE EVENTS: nothing happens, nothing happens...",
    "// then one event arrives and state changes. The main loop above",
    "// never polled the button or the serial wire — events came to IT,",
    "// exactly like a neuron that sits silent until incoming spikes",
    "// push it over threshold. Event-driven silicon (this pretend chip)",
    "// and event-driven brains (your Nengo networks) save energy the",
    "// same way: by doing nothing until it matters.",
    "// ─────────────────────────────────────────────────────────────────",
    "",
    "// ═════════════════════════════════════════════════════════════════",
    "// PART 2 — FAULT INJECTION & HARD-RTOS BENCHMARKING (new in v14)",
    "//",
    "// Part 1 was the chip on a good day. Same chip, same firmware —",
    "// now everything misbehaves at once, on schedule:",
    "//   1. a UART RX interrupt storm (bursts bigger than the ring)",
    "//   2. a jittery timer (the LED's 40-tick metronome wobbles)",
    "//   3. an I2C sensor that NAKs when it feels busy",
    "//   4. spikes that vanish from the neuron channel mid-storm",
    "// The v10 debugger then grades the damage: IRQ latency per",
    "// source, dropped bytes, missed deadlines. Still deterministic:",
    "// seeded RNG, virtual ticks. Run it twice — identical.",
    "// ═════════════════════════════════════════════════════════════════",
    "var RUN_FAULT_SCENARIO = true; // set false to run only clean Part 1",
    "",
    "if (RUN_FAULT_SCENARIO) {",
    "  console.log(\"\");",
    "  console.log(\"=== PART 2: fault injection — same chip, bad day ===\");",
    "  dump_registers(\"before the storm: end-of-Part-1 state, debugger attached\");",
    "",
    "  // keep Part 1's clean bench numbers for the before/after diff,",
    "  // then zero the counters so Part 2 is measured purely",
    "  var cleanStats = snapshotIrqStats();",
    "  resetIrqStats();",
    "  var rxCountMark = uartRxCount;",
    "  var dropMark = rxRing.dropped;",
    "  var fireMark = timerFireTicks.length;   // TIMER toggles across Part 1",
    "  var spikeMark = neuronFires;            // spikes truly fired in Part 1",
    "",
    "  // production RX handler for the storm: identical drain work,",
    "  // zero printfs. (Printing inside an ISR is how deadlines die —",
    "  // and in a byte storm it would flood this very console.)",
    "  function isrUartRxFast() {",
    "    while (mmioRead(UART_SR) & 1) {",
    "      var b = mmioRead(UART_RXDR);",
    "      mmioWrite(SRAM_RXBUF + (uartRxCount % 16), b);",
    "      rxMessage += String.fromCharCode(b);",
    "      uartRxCount++;",
    "    }",
    "  }",
    "  onInterrupt('UART_RX', isrUartRxFast);",
    "  console.log(\"firmware: swapped in the production UART RX handler (silent drain)\");",
    "",
    "  var F_TICKS = 200;                       // Part 2 runs ticks 301..500",
    "  var STORM_START = TOTAL_TICKS + 31;      // 331",
    "  var STORM_END = TOTAL_TICKS + 70;        // 370",
    "  var prevBtn2 = 0;",
    "",
    "  for (var ftick = TOTAL_TICKS + 1; ftick <= TOTAL_TICKS + F_TICKS; ftick++) {",
    "    // the fault schedule arms and disarms the noisy knobs",
    "    if (ftick === STORM_START) {",
    "      faults.jitterOn = true; faults.dropSpike = true;",
    "      timer.jit = Math.floor(rng() * 7) - 2; // calibration knocked sideways at once",
    "      console.log(\"[tick \" + ftick + \"] FAULTS ARMED: UART storm, timer jitter, lossy spikes\");",
    "    }",
    "    if (ftick === STORM_END + 1) {",
    "      faults.dropSpike = false; // jitter stays ON: nobody resyncs the timer",
    "      console.log(\"[tick \" + ftick + \"] storm over: spike channel clean; timer still off-grid\");",
    "    }",
    "    if (ftick === STORM_START + 9) {",
    "      console.log(\"[tick \" + ftick + \"] FAULT: storm static bounces the button line — EXTI glitch\");",
    "    }",
    "    if (ftick >= STORM_START && ftick <= STORM_END) {",
    "      // the storm: seeded bursts of 8..26 bytes at a wire built for 8",
    "      var burst = 8 + [0, 1, 9, 18, 4, 12, 3, 15][Math.floor(rng() * 8)];",
    "      var dropBefore = rxRing.dropped;",
    "      for (var si = 0; si < burst; si++) uartReceiveByte(\"0123456789ABCDEF\"[si % 16]);",
    "      var lostNow = rxRing.dropped - dropBefore;",
    "      if (lostNow > 0) console.log(\"[tick \" + ftick + \"] storm: \" + burst + \" bytes in, ring holds \" +",
    "        rxRing.cap + \" — \" + lostNow + \" DROPPED (ring full)\");",
    "    }",
    "    // storm static bounces the button wire (EMI): glitch presses at",
    "    // STORM_START+9 and — critically — on the timer's tick-360 wrap,",
    "    // so all three interrupts collide in the same tick there",
    "    var glitch = (ftick === STORM_START + 9 || ftick === TOTAL_TICKS + 60);",
    "    var recoveryPress = (ftick >= TOTAL_TICKS + 145 && ftick < TOTAL_TICKS + 150);",
    "    if (glitch || recoveryPress) gpio.idr |= (1 << BTN_PIN); else gpio.idr &= ~(1 << BTN_PIN);",
    "    var nowBtn2 = (gpio.idr >> BTN_PIN) & 1;",
    "    if (nowBtn2 !== prevBtn2) { pendIrq('EXTI'); prevBtn2 = nowBtn2; }",
    "",
    "    // the hardware advances, the CPU services, the analyzer watches",
    "    tickTimer();",
    "    dispatchInterrupts(ftick);",
    "    traceTick();",
    "",
    "    // the sensor's busy minute: one read gets refused, firmware copes",
    "    if (ftick === TOTAL_TICKS + 80) {",
    "      console.log(\"[tick \" + ftick + \"] main loop: sensor read — but the device is mid-conversion...\");",
    "      accelUpdate(ftick);",
    "      faults.nakNext = true; // the next address write gets refused",
    "      var rb = i2cReadBytesChecked(ACCEL_DATA, 6, 3);",
    "      if (rb) {",
    "        for (var mi = 0; mi < rb.length; mi++) mmioWrite(SRAM_SAMPLE + mi, rb[mi]);",
    "        console.log(\"  firmware: recovered sample kept; a NAK is weather, not death\");",
    "        sampleCount++;",
    "      }",
    "    }",
    "    // calm periodic reads once the storm has passed",
    "    if (ftick % 60 === 0 && ftick !== TOTAL_TICKS + 60) { console.log(\"[tick \" + ftick + \"] main loop: periodic sensor read\"); i2cReadAccel(ftick); }",
    "    // clear the storm noise out of the message buffer once it's over",
    "    if (ftick === STORM_END + 2 && rxMessage.length) {",
    "      console.log(\"[tick \" + ftick + \"] main loop: flushing \" + rxMessage.length + \" bytes of storm noise, no message in it\");",
    "      rxMessage = \"\";",
    "    }",
    "  }",
    "",
    "  // ── the deadline report card ──",
    "  // anchor the ideal 40-tick grid on the last toggle before",
    "  // Part 2; every later toggle is graded against its slot.",
    "  var anchorTick = timerFireTicks[fireMark - 1];",
    "  var idealTick = anchorTick, gradedLate = 0, gradedTotal = 0, worstLate = 0;",
    "  for (var gi = fireMark; gi < timerFireTicks.length; gi++) {",
    "    idealTick += 40;",
    "    var lateBy = timerFireTicks[gi] - idealTick;",
    "    gradedTotal++;",
    "    if (lateBy > 0) { gradedLate++; if (lateBy > worstLate) worstLate = lateBy; }",
    "  }",
    "",
    "  console.log(\"\");",
    "  dump_registers(\"after the storm: same chip, storm survived\");",
    "  console.log(\"\");",
    "  plot_trace(STORM_START - 6, STORM_END + 15);",
    "  console.log(\"\");",
    "  console.log(\"================ BENCHMARK SUMMARY (Part 2) ================\");",
    "  function latText(s) { return \"max \" + s.max + \" cyc, mean \" + (s.n ? Math.round(s.total / s.n) : 0) + \" cyc, n=\" + s.n; }",
    "  console.log(\"IRQ latency = cycles an interrupt waited before its ISR ran.\");",
    "  console.log(\"Higher latency = it queued behind other ISRs. Clean vs storm:\");",
    "  console.log(\"  EXTI    (prio 0) clean \" + latText(cleanStats.EXTI));",
    "  console.log(\"                   storm \" + latText(irqLatency.EXTI));",
    "  console.log(\"  UART_RX (prio 1) clean \" + latText(cleanStats.UART_RX));",
    "  console.log(\"                   storm \" + latText(irqLatency.UART_RX));",
    "  console.log(\"  TIMER   (prio 2) clean \" + latText(cleanStats.TIMER));",
    "  console.log(\"                   storm \" + latText(irqLatency.TIMER));",
    "  console.log(\"ticks with >=2 IRQs queued at once: clean \" + cleanStats.saturated + \" -> Part 2 \" + irqSaturatedTicks);",
    "  console.log(\"UART_RX pends swallowed by an already-set flag: \" + irqCoalesced);",
    "  console.log(\"  (the storm pended per byte; the flag remembers one — ISRs served \" + irqLatency.UART_RX.n + \")\");",
    "  var p2Drained = uartRxCount - rxCountMark, p2Dropped = rxRing.dropped - dropMark;",
    "  console.log(\"UART storm drain: \" + p2Drained + \" bytes drained, \" + p2Dropped + \" DROPPED to overflow\");",
    "  console.log(\"LED deadline: \" + gradedTotal + \" toggles graded on the 40-tick grid anchored at tick \" + anchorTick + \":\");",
    "  console.log(\"  \" + gradedLate + \" arrived LATE (worst +\" + worstLate + \" ticks), \" + (gradedTotal - gradedLate) + \" on time or early\");",
    "  console.log(\"I2C: \" + faultStats.i2cNaks + \" NAK weathered, \" + faultStats.i2cRetries + \" retries, \" +",
    "              faultStats.i2cRecovered + \" reads recovered, \" + faultStats.i2cFailed + \" reads lost\");",
    "  console.log(\"SPIKE channel: \" + (neuronFires - spikeMark) + \" true fires in Part 2, \" +",
    "              faultStats.spikesDropped + \" spikes swallowed by the fault\");",
    "  console.log(\"===============================================================\");",
    "  console.log(\"the firmware was identical in both parts. Only the world got worse.\");",
    "  console.log(\"lessons, one line each:\");",
    "  console.log(\"  priorities protect the urgent: EXTI (prio 0) never waited a cycle;\");",
    "  console.log(\"  the polite TIMER queued behind every storm drain instead.\");",
    "  console.log(\"  a ring buffer eats bursts only up to its depth; past it, bytes die.\");",
    "  console.log(\"  jitter never averages out on a deadline grid; the phase error sticks.\");",
    "  console.log(\"  measure latency, don't vibe it: an event is instant, handling isn't.\");",
    "}",
  ].join('\n');
  if (!('peripheral-vm.js' in edFiles)) { edFiles['peripheral-vm.js'] = PERIPHERAL_VM_SRC; persistFiles(); }
  /* v15 safe upgrade: if the stored VM demo is still an untouched earlier
     edition (byte-identical to the v9, v10, or v14 edition), swap in the
     current edition. If the user edited their copy it differs in any way,
     and it is left exactly as they wrote it. */
  if (edFiles['peripheral-vm.js'] === PERIPHERAL_VM_SRC_V9 || edFiles['peripheral-vm.js'] === PERIPHERAL_VM_SRC_V10 || edFiles['peripheral-vm.js'] === PERIPHERAL_VM_SRC_V14) { edFiles['peripheral-vm.js'] = PERIPHERAL_VM_SRC; persistFiles(); }
  var EDGE_STREAM_SRC = [
    "'use strict';",
    "/* Neural Lab v23 — edge_stream.js: sensor -> tensor streaming demo.",
    " *",
    " * Firmware-style zero-copy idea: on a real MCU the tensor the model",
    " * reads would be a VIEW into the DMA ring buffer, not a second copy —",
    " * memcpy on every inference wastes cycles and battery. Here the",
    " * RingBuffer keeps ONE Float32Array (32 samples x 4 channels) and",
    " * asTensor() hands back a subarray() VIEW of that same storage.",
    " * subarray() shares memory — no copy happens. The feature code reads",
    " * straight off the view through modular indexing, so the whole",
    " * sensor->features path touches each byte exactly once.",
    " *",
    " * Channels: ax, ay, az (synthetic IMU: sine waves 120 degrees apart +",
    " * seeded noise) and mic (envelope stream). Two scripted SHAKE bursts",
    " * are injected so the demo always has something to find.",
    " * Deterministic: same seed -> same ticks, same events.",
    " *",
    " * Runs in the browser (window.NL_EDGE_STREAM) and in Node",
    " * (module.exports). In the app's JS Editor, console.log goes to the",
    " * Console panel, so just tap Run.",
    " */",
    "(function (global) {",
    "",
    "  function mulberry32(seed) {",
    "    var a = seed >>> 0;",
    "    return function () {",
    "      a |= 0; a = (a + 0x6D2B79F5) | 0;",
    "      var t = Math.imul(a ^ (a >>> 15), 1 | a);",
    "      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;",
    "      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;",
    "    };",
    "  }",
    "",
    "  var WINDOW = 32;     // ring depth, samples",
    "  var CHANNELS = 4;    // ax, ay, az, mic",
    "  var DEF_THRESH = 0.5;",
    "",
    "  // Threshold override: the app's edge shell sets window.EDGE_THRESH;",
    "  // in Node the test can set global EDGE_THRESH the same way.",
    "  function getThresh() {",
    "    if (global && typeof global.EDGE_THRESH === 'number') return global.EDGE_THRESH;",
    "    return DEF_THRESH;",
    "  }",
    "",
    "  // The one and only storage. asTensor() returns a VIEW of it — no memcpy.",
    "  function RingBuffer(cap) {",
    "    this.cap = cap || WINDOW;",
    "    this.buf = new Float32Array(this.cap * CHANNELS);",
    "    this.head = 0;   // next write slot",
    "    this.count = 0;  // samples written (saturates at cap)",
    "  }",
    "  RingBuffer.prototype.push = function (ax, ay, az, mic) {",
    "    var o = this.head * CHANNELS;",
    "    this.buf[o] = ax; this.buf[o + 1] = ay;",
    "    this.buf[o + 2] = az; this.buf[o + 3] = mic;",
    "    this.head = (this.head + 1) % this.cap;",
    "    if (this.count < this.cap) this.count++;",
    "  };",
    "  // zero-copy: the model's input tensor IS this view into the ring.",
    "  RingBuffer.prototype.asTensor = function () {",
    "    return this.buf.subarray(0, this.cap * CHANNELS);",
    "  };",
    "",
    "  // Per-window features straight off the tensor view: mean + variance",
    "  // of the acceleration magnitude over the newest n samples.",
    "  function windowFeatures(view, head, count, cap) {",
    "    var n = Math.min(count, cap), sum = 0, sum2 = 0, k, idx, o, m;",
    "    for (k = 0; k < n; k++) {",
    "      idx = (((head - 1 - k) % cap) + cap) % cap;",
    "      o = idx * CHANNELS;",
    "      m = Math.sqrt(view[o] * view[o] + view[o + 1] * view[o + 1] + view[o + 2] * view[o + 2]);",
    "      sum += m; sum2 += m * m;",
    "    }",
    "    var mean = sum / n;",
    "    return { mean: mean, variance: Math.max(0, sum2 / n - mean * mean), n: n };",
    "  }",
    "",
    "  // Tiny integer-style classifier: SHAKE when the window's accel",
    "  // variance blows past the threshold, else still.",
    "  function classify(mean, variance, thresh) {",
    "    var t = (thresh == null) ? getThresh() : thresh;",
    "    return variance > t ? 'SHAKE' : 'still';",
    "  }",
    "",
    "  // Seeded synthetic IMU + mic. Two scripted shake bursts (ticks",
    "  // 80-99 and 150-169) inject big noise so the demo always fires.",
    "  // Fixed rng call order per tick -> fully deterministic.",
    "  function makeIMU(seed) {",
    "    var rng = mulberry32(seed == null ? 1337 : seed);",
    "    var bursts = [[80, 99], [150, 169]];",
    "    return function tick(t) {",
    "      var w = 2 * Math.PI * t / 24;",
    "      var ax = Math.sin(w);",
    "      var ay = Math.sin(w + 2 * Math.PI / 3);",
    "      var az = 1 + Math.sin(w + 4 * Math.PI / 3);",
    "      var mic = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 37 + 1);",
    "      var shake = 0, b;",
    "      for (b = 0; b < bursts.length; b++) {",
    "        if (t >= bursts[b][0] && t <= bursts[b][1]) shake = 1.6;",
    "      }",
    "      ax += (rng() * 2 - 1) * (0.05 + shake);",
    "      ay += (rng() * 2 - 1) * (0.05 + shake);",
    "      az += (rng() * 2 - 1) * (0.05 + shake);",
    "      mic += (rng() * 2 - 1) * 0.02;",
    "      return [ax, ay, az, mic];",
    "    };",
    "  }",
    "",
    "  function runStreamDemo(opts) {",
    "    opts = opts || {};",
    "    var ticks = opts.ticks || 200;",
    "    var seed = opts.seed == null ? 1337 : opts.seed;",
    "    var imu = makeIMU(seed);",
    "    var rb = new RingBuffer(WINDOW);",
    "    var tensor = rb.asTensor(); // the model's input: a view, not a copy",
    "    console.log('edge_stream: IMU+mic -> ring buffer (' + WINDOW + 'x' + CHANNELS +",
    "      ' float32, zero-copy view)');",
    "    console.log('tensor shares the ring storage: ' +",
    "      (tensor.buffer === rb.buf.buffer ? 'yes (no memcpy)' : 'NO — bug'));",
    "    var events = [], wasShake = false;",
    "    var shakeWindows = 0, stillWindows = 0, t, s, f, label;",
    "    for (t = 0; t < ticks; t++) {",
    "      s = imu(t);",
    "      rb.push(s[0], s[1], s[2], s[3]);",
    "      f = windowFeatures(tensor, rb.head, rb.count, rb.cap);",
    "      label = classify(f.mean, f.variance);",
    "      if (label === 'SHAKE') {",
    "        shakeWindows++;",
    "        if (!wasShake) {",
    "          events.push({ tick: t, variance: f.variance });",
    "          console.log('tick ' + t + ': SHAKE (accel-mag var=' + f.variance.toFixed(3) + ')');",
    "        }",
    "      } else {",
    "        stillWindows++;",
    "      }",
    "      wasShake = (label === 'SHAKE');",
    "    }",
    "    console.log('summary: ' + events.length + ' SHAKE events, ' +",
    "      shakeWindows + ' shake windows, ' + stillWindows +",
    "      ' still windows over ' + ticks + ' ticks (thresh=' + getThresh() + ')');",
    "    return events;",
    "  }",
    "",
    "  var API = {",
    "    RingBuffer: RingBuffer,",
    "    makeIMU: makeIMU,",
    "    classify: classify,",
    "    windowFeatures: windowFeatures,",
    "    getThresh: getThresh,",
    "    runStreamDemo: runStreamDemo,",
    "    WINDOW: WINDOW,",
    "    CHANNELS: CHANNELS",
    "  };",
    "",
    "  if (typeof module !== 'undefined' && module.exports) {",
    "    module.exports = API;",
    "  } else {",
    "    global.NL_EDGE_STREAM = API;",
    "  }",
    "})(typeof window !== 'undefined' ? window : global);"
  ].join('\n');
  if (!('edge_stream.js' in edFiles)) { edFiles['edge_stream.js'] = EDGE_STREAM_SRC; persistFiles(); }

  /* ── v23 Edge-AI (Zephyr branch) ────────────────────────────────── */
  // devicetree-style: one config table stands in for the board .dts —
  // same benchmark, different silicon.
  var EDGE_TARGETS = {
    m4:    { label: 'Cortex-M4 @ 64 MHz',  mhz: 64,  cyclesPerMac: 1,   sramKB: 256, flashKB: 1024 },
    esp32: { label: 'ESP32 @ 240 MHz',     mhz: 240, cyclesPerMac: 2,   sramKB: 520, flashKB: 4096 },
    riscv: { label: 'RISC-V @ 160 MHz',    mhz: 160, cyclesPerMac: 1.5, sramKB: 128, flashKB: 2048 }
  };

  // Energy-per-inference profiler: per-layer MAC accounting, then the
  // selected target turns MACs into cycles and microseconds. Mirrors
  // Zephyr's PM subsystem idea — the power manager knows what each
  // layer burns, so it can budget sleep states around inference.
  function edgeProfile() {
    if (!model) { log('edge profile: build (and train) a model first — nothing to profile', 'warn'); return; }
    var key = $('edge-target') ? $('edge-target').value : 'm4';
    var tg = EDGE_TARGETS[key] || EDGE_TARGETS.m4;
    var isCnn = !!(modelMeta && modelMeta.cnn);
    var layers = [];
    if (isCnn) {
      // Fixed arithmetic for the app's conv layer shapes (see cnn.js):
      // 6 filters x 3x3 over the 8x8 input, then the dense head.
      layers.push({ name: 'conv 3x3 x6', params: 6 * 9 + 6, macs: 6 * 9 * 16 });
      layers.push({ name: 'dense head', params: 6 * 4 * 4 * 10 + 10, macs: 6 * 4 * 4 * 10 + 10 });
    } else {
      var s = model.sizes, l;
      for (l = 0; l < s.length - 1; l++)
        layers.push({ name: 'fc ' + s[l] + '->' + s[l + 1], params: s[l + 1] * (s[l] + 1), macs: s[l + 1] * (s[l] + 1) });
    }
    log('edge profile — target: ' + tg.label + ' (same benchmark, any silicon)', 'dim');
    log('  layer | params | MACs | cycles | us', 'dim');
    var tMacs = 0, tParams = 0;
    layers.forEach(function (ly) {
      var cyc = Math.round(ly.macs * tg.cyclesPerMac);
      tMacs += ly.macs; tParams += ly.params;
      log('  ' + ly.name + ' | ' + ly.params + ' | ' + ly.macs + ' | ' + cyc + ' | ' + (cyc / tg.mhz).toFixed(2));
    });
    var totCyc = Math.round(tMacs * tg.cyclesPerMac);
    log('total: ' + tParams + ' params, ' + tMacs + ' MACs → est. cycles ' + totCyc +
      ' ≈ ' + (totCyc / tg.mhz).toFixed(2) + ' us/inference', 'ok');
    var mx = Math.max.apply(null, model.sizes);
    var ramB = 4 * mx * 2; // activation ping-pong buffer, float32
    if (ramB <= tg.sramKB * 1024)
      log('RAM: activation buffer ' + ramB + ' B (4B x max-layer ' + mx + ' x2 ping-pong) — fits in ' + tg.sramKB + ' KB SRAM ✓', 'ok');
    else
      log('RAM: activation buffer ' + ramB + ' B (4B x max-layer ' + mx + ' x2 ping-pong) — exceeds ' + tg.sramKB + ' KB SRAM — quantize (see v21 Q8.8)', 'warn');
    log('per-layer cost accounting like Zephyr\'s PM subsystem: the power manager budgets sleep around what each layer burns', 'dim');
  }

  /* OTA-style weight swap: an MCUboot A/B partition swap for weights.
     Slot A holds the running image; image v2 is staged, checksummed,
     then swapped IN PLACE — the model object (identity + architecture)
     is never rebuilt, only its W/b change. */
  var edgeSlotA = null, edgeSwapped = false, edgeOtaSeq = 0;

  function edgeParts() { // live weight tensors, MLP or CNN
    if (modelMeta && modelMeta.cnn) return { kind: 'cnn', parts: [model.F, model.fb, model.W2, model.b2] };
    return { kind: 'mlp', parts: [model.W, model.b] };
  }
  function edgeEachWeight(parts, fn) {
    (function walk(x) {
      if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) walk(x[i]); }
      else fn(+x);
    })(parts);
  }
  function edgeChecksum(parts) {
    var sum = 0;
    edgeEachWeight(parts, function (v) {
      var q = Math.round(Math.max(-1, Math.min(1, v)) * 32767); // int16-quantize
      sum = (sum + (q & 0xffff)) >>> 0; // simple additive hash
    });
    return sum;
  }
  function edgeCountParams(parts) {
    var n = 0; edgeEachWeight(parts, function () { n++; }); return n;
  }
  function edgeFreshWeights() {
    // "firmware image v2": same architecture, freshly seeded weights.
    edgeOtaSeq++;
    var seed = 1000000 + edgeOtaSeq * 1000; // seed bump, model-seed + 1000 style
    var m2;
    if (modelMeta && modelMeta.cnn)
      m2 = new window.NL_CNN.CNN({ filters: model.nFilters, classes: model.nClasses, seed: seed, optimizer: model.optimizer });
    else
      m2 = new MLP(model.sizes.slice(), { activation: model.actName, task: model.task, seed: seed, optimizer: model.optimizer, dropout: model.dropout });
    return (modelMeta && modelMeta.cnn)
      ? { kind: 'cnn', parts: [m2.F, m2.fb, m2.W2, m2.b2] }
      : { kind: 'mlp', parts: [m2.W, m2.b] };
  }
  function edgeInstallParts(snap) {
    // the swap itself: install weights in place, no rebuild
    if (snap.kind === 'cnn') { model.F = snap.parts[0]; model.fb = snap.parts[1]; model.W2 = snap.parts[2]; model.b2 = snap.parts[3]; }
    else { model.W = snap.parts[0]; model.b = snap.parts[1]; }
  }
  function edgeMetric() {
    if (model.regression) return { label: 'RMSE', val: model.rmse(trainSet.X, trainSet.Y).toFixed(4) };
    return { label: 'acc', val: (model.accuracy(trainSet.X, trainSet.Y) * 100).toFixed(1) + '%' };
  }
  function edgeOTA() {
    if (!model) { log('edge OTA: build (and train) a model first', 'warn'); return; }
    if (!trainSet || !trainSet.X || !trainSet.X.length) { log('edge OTA: no training set — load data first', 'warn'); return; }
    if (edgeSwapped && edgeSlotA) {
      edgeInstallParts(edgeSlotA); // rollback: slot A back in place
      edgeSwapped = false;
      var rb = $('btn-edge-ota'); if (rb) rb.textContent = 'OTA update';
      var m = edgeMetric();
      log('OTA rollback: slot A restored in place (no rebuild) — train ' + m.label + ' back to ' + m.val, 'ok');
      return;
    }
    var cur = edgeParts();
    edgeSlotA = { kind: cur.kind, parts: JSON.parse(JSON.stringify(cur.parts)) }; // slot A: deep copy
    var before = edgeMetric();
    log('MCUboot-style A/B partitions: running firmware snapshotted into slot A (' + edgeCountParams(cur.parts) + ' params)', 'dim');
    var v2 = edgeFreshWeights();
    log('firmware image v2 staged: ' + edgeCountParams(v2.parts) + ' params, checksum 0x' +
      edgeChecksum(v2.parts).toString(16) + ' — signature OK (simulated)', 'dim');
    edgeInstallParts(v2); // partition swap without rebuild
    edgeSwapped = true;
    var sb = $('btn-edge-ota'); if (sb) sb.textContent = 'Roll back OTA';
    var after = edgeMetric();
    log('partition swap complete WITHOUT rebuild — same model object, same ' + model.sizes.join('-') +
      ' arch, only the weights changed', 'ok');
    log('train ' + before.label + ': ' + before.val + ' → ' + after.val +
      ' (slot A kept — tap "Roll back OTA" to revert)', before.val === after.val ? 'warn' : 'ok');
  }

  function loadEdgeStream() {
    if (!('edge_stream.js' in edFiles)) {
      edFiles['edge_stream.js'] = EDGE_STREAM_SRC;
      persistFiles();
      renderFileList();
      log('edge_stream.js loaded into the Editor — tap ▶ Run', 'ok');
    } else {
      log('edge_stream.js is already in the Editor — tap ▶ Run', 'dim');
    }
  }

  // Live edge shell in the Console panel.
  function edgeShell(raw) {
    var line = String(raw == null ? '' : raw).trim();
    if (!line) return;
    log('> ' + line, 'dim');
    var parts = line.split(/\s+/);
    var cmd = parts[0].toLowerCase(), arg = parts[1];
    if (cmd === 'help') {
      log('edge shell: target <m4|esp32|riscv> · profile · ota · thresh <0..1> · graph dump · grad inspect <node_id> · mcu run [scratchBytes] · attn step "ABC" · disasm <hex> · cfg · qasm <gates;…> · qstate · qmeasure [shots] · evoloop [generations] [depth 1-6] · decay · help');
    } else if (cmd === 'disasm') {
      if (window.NL_RE) window.NL_RE.cmdDisasm(parts.slice(1).join(' '));
      else log('disasm: ReverseLab not loaded', 'err');
    } else if (cmd === 'cfg') {
      if (window.NL_RE) window.NL_RE.cmdCfg();
      else log('cfg: ReverseLab not loaded', 'err');
    } else if (cmd === 'qasm') {
      if (window.NL_Q) window.NL_Q.cmdQasm(parts.slice(1).join(' '));
      else log('qasm: QuantumVM not loaded', 'err');
    } else if (cmd === 'qstate') {
      if (window.NL_Q) window.NL_Q.cmdQstate();
      else log('qstate: QuantumVM not loaded', 'err');
    } else if (cmd === 'qmeasure') {
      if (window.NL_Q) window.NL_Q.cmdQmeasure(parts[1]);
      else log('qmeasure: QuantumVM not loaded', 'err');
    } else if (cmd === 'evoloop') {
      edgeEvoLoop(parts[1], parts[2]);
    } else if (cmd === 'decay') {
      if (window.NL_NEXUS && window.NL_NEXUS.decayStatus) {
        var ds = window.NL_NEXUS.decayStatus();
        log('decay: ' + ds, ds.indexOf('not reached') >= 0 ? 'warn' : 'ok');
        log('decay: the monitor fires when per-generation improvement ΔE < ε (default 0.01). ' +
          'Empirical law: E ≈ 0.465·gen^-0.43 (R²=0.983) — decay slows. ' +
          'At the decay point the exact state is captured, the parent verifies it by replay, ' +
          'and the child lineage is entangled to the certified record (🧬 Lineage mode, 🌀 Nexus view).', 'dim');
      } else log('decay: Nexus not loaded — open the 🌀 Nexus Core view first', 'warn');
    } else if (cmd === 'eternal') {
      if (window.NL_NEXUS && window.NL_NEXUS.eternalStatus) {
        var esub = (parts[1] || '').toLowerCase();
        if (esub === 'stop' && window.NL_NEXUS.eternalStop) { window.NL_NEXUS.eternalStop(); log('eternal: stopped — champion saved', 'ok'); }
        else if (esub === 'start' && window.NL_NEXUS.eternalStart) { window.NL_NEXUS.eternalStart(); log('eternal: started', 'ok'); }
        else log('eternal: ' + window.NL_NEXUS.eternalStatus() + ' — try "eternal start" / "eternal stop". ' +
          'Chunked self-evolution, champion saved every cycle (kill-safe); background/low-battery = deep low-power tier, never auto-stops. ' +
          'Only ⏹ STOP ends it; a dead phone auto-resumes on next open.', 'ok');
      } else log('eternal: Nexus not loaded — open the 🌀 Nexus Core view first', 'warn');
    } else if (cmd === 'mesh') {
      if (window.NL_MESH && window.NL_MESH.status) {
        log('mesh: ' + window.NL_MESH.status(), 'ok');
        log('mesh: consent-gated champion exchange (⤴ export → move file → ⤵ import → ACCEPT) + swarm simulator. ' +
          'Payloads are checksum-signed; tampered ones are rejected before anything happens. ' +
          'Tournament = identical validation episodes, winner takes the Core; cross-breed = child of both, ledger-linked to both parents.', 'dim');
      } else log('mesh: Nexus Mesh not loaded — open the 🌀 Nexus Core view first', 'warn');
    } else if (cmd === 'horizon') {
      if (window.NL_NEXUS && window.NL_NEXUS.horizonStatus) {
        var hs = window.NL_NEXUS.horizonStatus();
        log('horizon: ' + hs, hs.indexOf('OFF') >= 0 ? 'warn' : 'ok');
        log('horizon: Ahkeem\'s information-paradox experiment — paradox-INSPIRED classical simulation. ' +
          'Neurons collide through a learnable gravity matrix G (M→K compression); exterior partners never fall in ' +
          'but stay correlated through an entanglement-inspired link (fidelity 0..1). Link ON = the exterior whispers back (γ=0.3) + fidelity pressure ' +
          'λ=0.3 in selection — compare ON vs OFF (🌀 Nexus view, ⚖ button) to see how the gravity structure changes.', 'dim');
      } else log('horizon: Nexus not loaded — open the 🌀 Nexus Core view first', 'warn');
    } else if (cmd === 'graph') {
      if ((parts[1] || '').toLowerCase() === 'dump') nanoGraphDump();
      else log('graph: try "graph dump" — adjacency matrix + topo order of the current nanograd tape', 'warn');
    } else if (cmd === 'grad') {
      if ((parts[1] || '').toLowerCase() === 'inspect' && parts[2] != null) nanoGradInspect(parts[2]);
      else log('grad: try "grad inspect <node_id>" — value, gradient, op, parents of one tape node', 'warn');
    } else if (cmd === 'mcu') {
      if ((parts[1] || '').toLowerCase() === 'run') edgeMcuRun(parts[2]);
      else log('mcu: try "mcu run [scratchBytes]" — virtual MCU inference on the last Export-C model', 'warn');
    } else if (cmd === 'attn') {
      if ((parts[1] || '').toLowerCase() === 'step') edgeAttnStep(parts.slice(2).join(' '));
      else log('attn: try `attn step "ABC"` — Token IDs → Q/K/V projections → attention weights → next-token logits', 'warn');
    } else if (cmd === 'target') {
      if (arg && EDGE_TARGETS[arg]) { $('edge-target').value = arg; log('target → ' + EDGE_TARGETS[arg].label, 'ok'); }
      else log('target: pick m4, esp32, or riscv', 'warn');
    } else if (cmd === 'profile') {
      edgeProfile();
    } else if (cmd === 'ota') {
      edgeOTA();
    } else if (cmd === 'thresh') {
      var v = parseFloat(arg);
      if (isFinite(v) && v >= 0 && v <= 1) { window.EDGE_THRESH = v; log('EDGE_THRESH = ' + v + ' (stream classifier)', 'ok'); }
      else log('thresh: need a number in 0..1', 'warn');
    } else {
      log('unknown command — try: help', 'warn');
    }
    if ($('edge-cmd')) $('edge-cmd').value = '';
  }

  /* ── v32: Quantum Nexus Core edge-shell demo (tiny NumPy-free JS port of preset 16) ──
   * `evoloop [generations]` — ErrorLoop core + immutable snapshots +
   * decoder-mutation evolution. Variation -> selection -> heredity. */
  /* ── v39: evoloop [generations] [depth] — deep ErrorLoop via the core.
   * Delegates to NL_NEXUS_CORE (the same engine the 🌀 Nexus view runs).
   * depth 1 = the reference single-layer loop; default 3 = the deep stack. */
  function edgeEvoLoop(rawGen, rawDepth) {
    var C = window.NL_NEXUS_CORE;
    if (!C) { log('evoloop: Nexus core not loaded — open the 🌀 Nexus Core view first', 'err'); return; }
    var G = Math.max(1, Math.min(12, parseInt(rawGen, 10) || 6));
    var depth = C.normDepth(parseInt(rawDepth, 10) || 3);
    var S = C.create(G, 16, depth, 'tanh');
    C.setEternal(S, true);
    C.runGens(S, G);
    for (var g = 0; g < S.curve.length; g++)
      log('evoloop gen ' + g + '  best mean|err| = ' + S.curve[g].toFixed(4));
    log('evoloop: depth ' + depth + ', ' + G + ' generations, error ' +
        S.curve[0].toFixed(4) + ' → ' + S.curve[S.curve.length - 1].toFixed(4) +
        ' — variation (loop rewrites itself) → selection (lowest error kept) → heredity ' +
        '(winner seeds next). Classical demo of the Quantum Nexus Core (preset 16).', 'ok');
  }

  /* ── v27: virtual MCU runner for the edge shell ──
   * `mcu run [scratchBytes]` executes the last Export-C model under MCU
   * constraints (mcu-sim.js) and logs cycles, peak RAM, register states.
   * Overflow traps surface as clean ERR_* lines, never a crash. */
  function edgeMcuRun(rawBytes) {
    var MCU = window.NL_MCU;
    if (!MCU) { log('mcu: mcu-sim.js failed to load', 'err'); return; }
    if (!lastCExport) {
      log('mcu run: no exported model yet — train a model, tap Export C, then run this', 'warn');
      return;
    }
    var bytes = rawBytes == null ? 4096 : parseInt(rawBytes, 10);
    if (!isFinite(bytes) || bytes < 64 || bytes > 16384) {
      log('mcu run: scratchBytes must be 64..16384 (try 512 for the overflow demo)', 'warn');
      return;
    }
    var E = lastCExport;
    var x = (E.sampleX && E.sampleX.length) ? E.sampleX : null;
    if (!x) {
      x = [];
      for (var d = 0; d < E.spec.sizes[0]; d++) x.push(0);
    }
    log('> mcu run: ' + E.spec.dataset + ' (' + E.spec.sizes.join('->') + '), scratchpad ' + bytes + ' B', 'dim');
    try {
      var r = E.kind === 'cnn'
        ? MCU.runCNN(E.q, x, { scratchBytes: bytes })
        : MCU.runMLP(E.q, x, E.spec.act || 'tanh', E.spec.mode || 'multiclass', { scratchBytes: bytes });
      var lines = MCU.reportText(r, 'edge mcu').split('\n');
      for (var i = 0; i < lines.length; i++) log(lines[i], i === 0 ? 'ok' : 'dim');
      var outs = r.out.map(function (v) { return (v / 256).toFixed(4); }).join(', ');
      log('int8.8 outputs: [' + outs + ']', 'dim');
    } catch (err) {
      log('mcu run: ' + (err.code || 'ERR') + ' — ' + err.message, 'err');
    }
  }

  /* ── v28: attention stepper for the edge shell ──
   * `attn step "ABC"` walks one forward pass of the transformer and prints
   * every vector transformation: token IDs → Q/K/V projections →
   * causal attention weights → next-token logits. Uses the current trained
   * transformer when one is built, otherwise a fresh seeded demo model
   * (seed 1337, d_model 16) so the output is always deterministic. */
  function edgeAttnStep(raw) {
    var A = window.NL_ATTN;
    if (!A) { log('attn: attention.js failed to load', 'err'); return; }
    var s = String(raw == null ? '' : raw).replace(/["']/g, '').toUpperCase().replace(/[^A-H]/g, '');
    if (!s.length || s.length > 8) {
      log('attn step: give 1–8 tokens from A–H, e.g. attn step "ABC"', 'warn');
      return;
    }
    var ids = s.split('').map(function (ch) { return A.VOCAB.indexOf(ch); });
    var M = (model && model.isTransformer) ? model : new A.MicroTransformer({ seed: 1337, dModel: 16 });
    var det = M.attentionDetail(ids);
    function f4(v) { return (v < 0 ? '' : '+') + v.toFixed(4); }
    function proj(row) { return row.slice(0, 4).map(f4).join(' ') + (row.length > 4 ? ' …' : ''); }
    log('attn step "' + s + '" — ' + (M === model ? 'current trained transformer' : 'fresh seeded demo model (seed 1337)') +
        ', d_model=' + M.d, 'ok');
    log('Token IDs: [' + ids.join(' ') + ']  (' + s.split('').join(' · ') + ')', 'dim');
    for (var t = 0; t < ids.length; t++) {
      log('  tok ' + s[t] + '  Q[' + proj(det.Q[t]) + ']  K[' + proj(det.K[t]) + ']  V[' + proj(det.V[t]) + ']', 'dim');
    }
    log('Attention weights — rows query, cols key (upper triangle masked):', 'dim');
    for (var i = 0; i < ids.length; i++) {
      log('  q=' + s[i] + '  [' + det.weights[i].map(function (w) { return w.toFixed(3); }).join(' ') + ']', 'dim');
    }
    var order = det.probs.map(function (p, v) { return { v: v, p: p }; })
      .sort(function (a, b) { return b.p - a.p; });
    var top = order.slice(0, 3).map(function (o) { return A.VOCAB[o.v] + ':' + (o.p * 100).toFixed(1) + '%'; }).join('  ');
    var bi = order[0].v;
    log('Next-token logits: [' + det.logits.map(function (l) { return l.toFixed(3); }).join(' ') + ']', 'dim');
    log('→ predicts ' + A.VOCAB[bi] + '  (top-3: ' + top + ')', 'ok');
  }

  /* ── v26: nanograd tape inspection for the edge shell ──
   * Reads the same current graph as the Brain tab's Computation Graph
   * view: the last tape built by nanograd.js (e.g. the final pass of
   * nanograd-mlp.js), or the seeded demo graph if no tape exists yet. */
  function nanoCurGraph() {
    if (!window.NanoGrad) { log('nanograd: engine not loaded', 'err'); return null; }
    try { return window.NanoGrad.currentGraph(); } catch (e) { log('nanograd: ' + e, 'err'); return null; }
  }
  function nanoGraphDump() {
    var g = nanoCurGraph();
    if (!g) return;
    var n = g.length;
    var id2i = {}, i, j;
    for (i = 0; i < n; i++) id2i[g[i].id] = i;
    log('graph dump: ' + n + ' tape nodes (rows/cols in topo order)', 'dim');
    var head = '     ' + g.map(function (nd, k) { return (k % 10).toString(); }).join('');
    log(head, 'dim');
    for (i = 0; i < n; i++) {
      var row = new Array(n + 1).join('0').split('');
      for (j = 0; j < g[i].parents.length; j++) {
        var pi = id2i[g[i].parents[j]];
        if (pi != null) row[pi] = '1'; // col pi -> row i: edge parent->child
      }
      log(('   ' + i).slice(-4) + ' ' + row.join(''), 'dim');
    }
    log('topo order (node ids): ' + g.map(function (nd) { return nd.id; }).join(' '), 'ok');
    log('labels: ' + g.map(function (nd) { return nd.id + '=' + nd.label; }).join(' '), 'dim');
  }
  function nanoGradInspect(rawId) {
    var g = nanoCurGraph();
    if (!g) return;
    var id = parseInt(rawId, 10);
    var hit = null, i;
    for (i = 0; i < g.length; i++) if (g[i].id === id) { hit = g[i]; break; }
    if (!hit) { log('grad inspect: no tape node with id ' + rawId + ' (try "graph dump" for ids)', 'warn'); return; }
    var byId = {};
    for (i = 0; i < g.length; i++) byId[g[i].id] = g[i];
    var ps = hit.parents.map(function (pid) { return pid + (byId[pid] ? '=' + byId[pid].label : ''); });
    log('node ' + hit.id + ' "' + hit.label + '"', 'ok');
    log('  value v = ' + hit.v, 'dim');
    log('  grad dL/dv = ' + hit.grad, 'dim');
    log('  op = ' + (hit.op || 'input') + '   parents = ' + (ps.length ? ps.join(', ') : '(none — leaf)'), 'dim');
  }

  function persistFiles() { saveJSON('nl_files', edFiles); }
  function renderFileList() {
    var ul = $('filelist'); ul.innerHTML = '';
    Object.keys(edFiles).sort().forEach(function (name) {
      var li = document.createElement('li');
      li.textContent = name + (name === edActive && edDirty ? ' •' : '');
      if (name === edActive) li.className = 'active';
      li.onclick = function () { openEditorFile(name); };
      li.ondblclick = function () {
        if (confirm('Delete "' + name + '"?')) {
          delete edFiles[name]; persistFiles();
          var names = Object.keys(edFiles);
          openEditorFile(names.length ? names[0] : null);
        }
      };
      ul.appendChild(li);
    });
  }
  function openEditorFile(name) {
    if (edDirty && edActive && !confirm('Discard unsaved changes to "' + edActive + '"?')) return;
    if (!name) {
      var nn = prompt('New file name:', 'untitled.js');
      if (!nn) return;
      edFiles[nn] = '';
      name = nn;
    }
    if (!(name in edFiles)) edFiles[name] = '';
    edActive = name; edDirty = false;
    $('ed-text').value = edFiles[name];
    $('ed-title').textContent = name;
    highlightEditor(); renderFileList();
    persistFiles();
  }
  function saveEditorFile() {
    if (!edActive) return;
    edFiles[edActive] = $('ed-text').value;
    edDirty = false; persistFiles(); renderFileList();
    log('saved "' + edActive + '" (' + edFiles[edActive].length + ' chars)', 'ok');
    setReady('saved ' + edActive);
    setTimeout(function () { if (!training) setReady('ready'); }, 1500);
  }
  function runEditorCode() {
    var src = $('ed-text').value;
    if (edActive) { edFiles[edActive] = src; edDirty = false; persistFiles(); renderFileList(); }
    log('—— running "' + (edActive || 'untitled') + '" ——', 'dim');
    var realLog = console.log, realErr = console.error;
    function line(args) {
      return Array.prototype.map.call(args, function (x) {
        if (typeof x === 'object' && x !== null) { try { return JSON.stringify(x); } catch (e) { return String(x); } }
        return String(x);
      }).join(' ');
    }
    console.log = function () { realLog.apply(console, arguments); log(line(arguments)); };
    console.error = function () { realErr.apply(console, arguments); log(line(arguments), 'err'); };
    var t0 = Date.now();
    try {
      new Function('"use strict";' + '\n' + src)();
      log('done in ' + (Date.now() - t0) + 'ms', 'ok');
    } catch (err) {
      log('Error: ' + String(err && err.stack || err).split('\n').slice(0, 3).join(' | '), 'err');
    }
    console.log = realLog; console.error = realErr;
    switchTab('console');
  }
  function highlightEditor() {
    var src = $('ed-text').value;
    $('ed-hl-code').innerHTML = highlightJS(src) + '\n';
    syncEdScroll();
  }
  function syncEdScroll() {
    var t = $('ed-text');
    $('ed-hl').scrollTop = t.scrollTop; $('ed-hl').scrollLeft = t.scrollLeft;
  }
  function highlightJS(src) {
    var esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|this|typeof|instanceof|in|of|try|catch|finally|throw|await|async|import|export|from|default|null|undefined|true|false|document|window|console)\b|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;
    return esc.replace(re, function (m, com, str, kw, num, fn) {
      if (com) return '<span class="tok-c">' + com + '</span>';
      if (str) return '<span class="tok-s">' + str + '</span>';
      if (kw) return '<span class="tok-k">' + kw + '</span>';
      if (num) return '<span class="tok-n">' + num + '</span>';
      if (fn) return '<span class="tok-f">' + fn + '</span>';
      return m;
    });
  }

  /* ══ github ═══════════════════════════════════ */
  var ghRepo = '', ghPath = '';
  function ghGet(url) {
    // native bridge avoids any CORS trouble; falls back to fetch
    try {
      if (window.NB && NB.httpGet) {
        var r = NB.httpGet(url);
        var nl = r.indexOf('\n');
        var code = parseInt(r.slice(5, nl), 10);
        var body = r.slice(nl + 1);
        return { code: code, body: body };
      }
    } catch (e) { debug('NB.httpGet failed: ' + e); }
    return null; // caller may try fetch
  }
  function ghApi(path) {
    var url = 'https://api.github.com/repos/' + ghRepo + '/contents/' + path;
    var r = ghGet(url);
    if (!r) throw new Error('no network bridge (are you in the app?)');
    if (r.code === 404) throw new Error('not found — check user/repo and path');
    if (r.code === 403) throw new Error('GitHub rate-limited this IP — wait a minute and retry');
    if (r.code !== 200) throw new Error('GitHub API HTTP ' + r.code);
    var j = JSON.parse(r.body);
    if (j.__error) throw new Error(j.__error);
    return j;
  }
  function ghList() {
    var inp = $('gh-repo').value.trim().replace(/^\/+|\/+$/g, '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(inp)) { log('GitHub: enter as user/repo', 'warn'); return; }
    ghRepo = inp; ghPath = '';
    log('GitHub: listing ' + ghRepo + ' …');
    renderGhPath();
    try {
      var items = ghApi('');
      renderGhItems(items);
      log('GitHub: ' + items.length + ' items at root of ' + ghRepo, 'ok');
    } catch (e) { log('GitHub: ' + e.message, 'err'); $('gh-list').innerHTML = ''; }
  }
  function renderGhPath() {
    $('gh-path').textContent = ghRepo + ' / ' + (ghPath || '(root)');
  }
  function renderGhItems(items) {
    items.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name < b.name ? -1 : 1;
    });
    var ul = $('gh-list'); ul.innerHTML = '';
    if (ghPath) {
      var up = document.createElement('li');
      up.innerHTML = '<span class="nm">📁 ..</span>';
      up.onclick = function () {
        ghPath = ghPath.split('/').slice(0, -1).join('/');
        renderGhPath(); renderGhItems(ghApi(ghPath));
      };
      ul.appendChild(up);
    }
    items.forEach(function (it) {
      var li = document.createElement('li');
      var nm = document.createElement('span'); nm.className = 'nm';
      nm.textContent = (it.type === 'dir' ? '📁 ' : '📄 ') + it.name +
        (it.type === 'file' && it.size ? '  (' + Math.round(it.size / 102.4) / 10 + ' KB)' : '');
      li.appendChild(nm);
      if (it.type === 'dir') {
        var b = document.createElement('button'); b.textContent = 'Open';
        b.onclick = function () {
          ghPath = ghPath ? ghPath + '/' + it.name : it.name;
          renderGhPath(); renderGhItems(ghApi(ghPath));
        };
        li.appendChild(b);
      } else {
        var dl = document.createElement('button'); dl.textContent = 'Download';
        dl.onclick = function () { ghDownload(it); };
        li.appendChild(dl);
      }
      ul.appendChild(li);
    });
  }
  function ghDownload(it) {
    if (it.size > 500 * 1024) { log('GitHub: "' + it.name + '" is over 500 KB — skipped', 'warn'); return; }
    log('GitHub: downloading ' + it.name + ' …');
    try {
      var r = ghGet(it.download_url);
      if (!r || r.code !== 200) throw new Error('download failed (HTTP ' + (r ? r.code : '?') + ')');
      var name = it.name;
      var n = 1;
      while (name in edFiles) { name = it.name.replace(/(\.[^.]+)?$/, '-' + (++n) + '$1'); }
      edFiles[name] = r.body;
      persistFiles(); renderFileList();
      log('GitHub: saved "' + name + '" — open it from the Editor tab', 'ok');
      if (confirm('Downloaded "' + name + '". Open in Editor?')) { switchTab('editor'); openEditorFile(name); }
    } catch (e) { log('GitHub: ' + e.message, 'err'); }
  }

  /* ══ notes — Obsidian-style vault ══════════════ */
  var notesDB = loadJSON('nl_notes', null);
  var noteActive = null, noteView = 'edit', tagFilter = null, noteSearch = '';
  var noteSaveTimer = null;

  function notesEnsure() {
    if (!notesDB || typeof notesDB !== 'object' || !notesDB.vaults) notesDB = { vaults: {}, activeVault: null };
    var names = Object.keys(notesDB.vaults);
    if (!names.length) {
      notesDB.vaults['My Vault'] = { notes: {
        'Welcome': { body: '# Welcome to your vault\n\nThis is your Obsidian-style notes space, living inside Neural Lab.\n\n- Link notes with [[wikilinks]] — try [[Ideas]]\n- Tag anything with #tags like #todo or #idea\n- Flip to the **Graph** view to see every note as a living network\n\nYour notes stay on this device, in this app.', updated: Date.now() },
        'Ideas': { body: '# Ideas\n\n- Tap a dot in the **Graph** view to open its note\n- A [[Welcome|missing link]] creates the note when you tap it\n- #idea #todo\n', updated: Date.now() }
      } };
      names = ['My Vault'];
    }
    if (!notesDB.activeVault || !notesDB.vaults[notesDB.activeVault]) notesDB.activeVault = names[0];
    notesSave();
  }
  function notesSave() { saveJSON('nl_notes', notesDB); }

  /* ── v8: Firmware & Embedded starter vault (seeded once, additively) ──
     Idempotency: notesDB.fwSeeded records that the seed already ran, so
     re-running on every launch is a no-op and a vault the user later
     deletes or edits is never recreated or overwritten. */
  var FW_NOTES = {
    "Interrupt Service Routines (ISRs)": "# Interrupt Service Routines (ISRs)\n\nAn **interrupt** is hardware tapping the CPU on the shoulder: \"a button pressed, a byte arrived, a timer expired — handle it NOW.\" The small function that runs in response is the **ISR** (interrupt service routine).\n\n## Three ways to structure firmware\n\n- **Superloop** — one big `while (true)` loop that checks everything in turn. Simple, but slow to react and it burns power polling sensors that have nothing to say.\n- **Event-driven** — the CPU sleeps until an interrupt wakes it. The ISR records what happened (often by pushing a byte into a ring buffer), and the main loop does the real work later. Fast reaction, tiny power draw.\n- **RTOS** (FreeRTOS, Zephyr) — several tasks that a scheduler switches between, with queues, timers and priorities. More powerful, more complexity — worth it on bigger projects.\n\n## ISR golden rules\n\n- Keep it SHORT: set a flag or store the byte, then get out\n- No printing, no waiting, no `malloc` inside an ISR\n- Variables shared with the main loop are marked `volatile`\n\nThis is the same event-driven idea as a spiking neural network: nothing happens until something changes. See what the main loop does with those events in [[Finite State Machines (FSM)]], and where the bytes come from in [[Communication Protocols]].\n\n#embedded #interrupts",
    "Communication Protocols": "# Communication Protocols\n\nChips talk to each other over a few wires. These are the big three:\n\n- **UART** — 2 wires (TX, RX), one chip talking to one other chip. No clock wire: both sides agree the speed (baud rate) in advance. Simple and everywhere — debug logs, GPS modules, Bluetooth modules.\n- **I2C** — 2 wires (SDA data, SCL clock) shared by MANY chips, each with its own address on the bus. Slow, but you can hang ten sensors off two pins.\n- **SPI** — 4 wires (MOSI, MISO, SCK clock, CS chip-select) plus one extra CS wire PER added chip. Very fast and simple, but it eats pins as the system grows.\n\n## Rules of thumb\n\n- Need speed (displays, SD cards, radios)? SPI\n- Many little sensors on the fewest pins? I2C\n- Talking to a PC, GPS or modem? UART\n\nUART bytes usually arrive one at a time and land in a ring buffer, pushed in by an interrupt — see [[Interrupt Service Routines (ISRs)]]. The data structures holding all this live in [[Memory Architecture]].\n\n#embedded #protocols",
    "Finite State Machines (FSM)": "# Finite State Machines (FSM)\n\nA **finite state machine** is how firmware stays organized without a pile of tangled `if` statements. The system is always in exactly ONE state, and events move it to the next one.\n\nA typical sensor node cycles through states like these:\n\n- **idle** — asleep, waiting for a timer or pin interrupt\n- **sampling** — sensor powered up, taking a reading\n- **transmitting** — sending the reading out over UART or radio\n- **sleep** — everything off, waiting for the next timer tick\n\nEach state answers two questions: \"what do I do while I am here?\" and \"which event moves me where next?\" Draw it as circles (states) and arrows (events) BEFORE writing code — the drawing is the design, and bugs show up as missing arrows.\n\nThe events that drive the arrows usually arrive through [[Interrupt Service Routines (ISRs)]], and the readings travel via [[Communication Protocols]].\n\n#embedded #design",
    "Memory Architecture": "# Memory Architecture\n\nA microcontroller has two very different kinds of memory, and mixing them up is a classic beginner trap:\n\n- **Flash** — where the PROGRAM lives (plus read-only data). Big: 256 KB to 2 MB. Survives power loss, but slow to write and each block wears out after roughly 10k–100k erases.\n- **SRAM** — where VARIABLES live: globals, the stack, and any heap. Small: often 20–256 KB. Fast, and it vanishes when power dies.\n- **The stack** — a slice of SRAM that grows and shrinks with function calls. Recurse too deep or park a giant array in a local variable and it overwrites your data: the classic \"works until it randomly doesn't\" crash.\n\n## Why malloc is banned in safety-critical firmware\n\n- It can FAIL at runtime when free memory fragments into unusable pieces — and \"sometimes crashes on Tuesdays\" is not acceptable in a brake controller or a pacemaker\n- Its timing is unpredictable, which breaks hard real-time deadlines\n- The fix: allocate everything ONCE at startup, use fixed-size buffers (like the ring buffer), and prove the worst case fits before shipping\n\nThis is also why TinyML shrinks models to int8 integers: a model that is 4x smaller suddenly fits in a microcontroller's memory. The quantization demo on the Spiking tab shows exactly how that works.\n\nThe buffers living in SRAM get filled by [[Interrupt Service Routines (ISRs)]] and managed by [[Finite State Machines (FSM)]].\n\n#embedded #memory",
    "Embedded AI System Prompt": "# Embedded AI System Prompt\n\nPaste the text below at the start of a chat with any AI assistant (as the first message, or into its system-prompt / custom-instructions box). It tells the AI to answer like a firmware engineer: small, deterministic, allocation-free code that fits on a microcontroller.\n\n---\n\nYou are an embedded systems firmware engineer. When writing code, prioritize deterministic timing, avoid heap memory allocations, favor bitwise operations and fixed-point math, and consider memory footprint (Flash and SRAM limits) suitable for microcontrollers like ARM Cortex-M and RISC-V.\n\n---\n\nWhy it works: without it, AI assistants happily suggest `malloc`, floating point and big libraries. With it, you get fixed-size buffers, bit tricks and integer math — code that survives contact with real hardware like STM32, ESP32 and RP2040 boards.\n\nBackground reading in this vault: [[Interrupt Service Routines (ISRs)]], [[Communication Protocols]], [[Finite State Machines (FSM)]], [[Memory Architecture]].\n\n#embedded #prompt",
    "Fixed-Point Activation LUTs & Quantization Drift": "# Fixed-Point Activation LUTs & Quantization Drift\n\nMCUs usually have no FPU, so `tanh()` and `sigmoid()` — both built on `exp()` — are far too slow to run per neuron. Firmware replaces them with **lookup tables**: precompute the curve once, store it as integers, and turn the activation into one indexed array read.\n\n## The v27 recipe (see the Export C output)\n\n- **1024-entry int16_t tables**: tanh over [-4, 4], sigmoid over [-8, 8]; outside the range the output saturates (tanh -> +/-1, sigmoid -> 0/1).\n- Why a LUT instead of piecewise-linear math? A table read is **constant-time and branchless** — deterministic cycle counts, which is what real-time inference needs. 1024 entries hold the worst-case error to **<= 1 LSB**; a piecewise-linear fit needs 16+ segments plus branching to match that and costs MORE cycles on a Cortex-M0. 1 KiB per table is negligible flash.\n- Tables are baked into the generated C file at export time, so the firmware build itself needs **no floating point at all**.\n\n## Quantization drift — how far the integer net strays from the float net\n\n- Weights/biases round to the nearest Q8.8 value: <= 0.5 LSB each.\n- Each neuron accumulates products in a **64-bit integer** (Q16.16) and rounds **once** at the end (symmetric round-half-away-from-zero): <= 0.5 LSB per neuron, not per product.\n- LUT lookups add <= 1 LSB each — and trained nets saturate their tanh units, where the table slope drops toward zero, so the real contribution is far smaller.\n- Measured on the XOR demo: integer inference stays within **0.5 LSB** of the float net, with identical classifications.\n\n## Try it\n\nTrain the XOR demo, tap **Export C**, then run `mcu run` in the Console edge shell: the virtual MCU reports cycles for Cortex-M0 vs M4, peak scratchpad RAM, and register states. Set the scratchpad to 512 bytes and run the Digits CNN to watch a clean `ERR_SCRATCHPAD_OVERFLOW` trap.\n\nRelated: [[Memory Architecture]] (why the scratchpad lives in SRAM), [[Embedded AI System Prompt]] (the allocation-free mindset).\n\n#embedded #quantization #tinyml"
  };
  function seedFirmwareVault() {
    /* v27: additive upgrade — new notes merge into the existing vault,
       the user's own notes and edits are never touched or overwritten. */
    if (notesDB.fwSeeded >= 27) return;
    if (!notesDB.vaults['Firmware & Embedded']) {
      var ts = Date.now(), seeded = {};
      Object.keys(FW_NOTES).forEach(function (t) { seeded[t] = { body: FW_NOTES[t], updated: ts }; });
      notesDB.vaults['Firmware & Embedded'] = { notes: seeded };
    } else {
      var vault = notesDB.vaults['Firmware & Embedded'], ts2 = Date.now(), added = 0;
      Object.keys(FW_NOTES).forEach(function (t) {
        if (!(t in vault.notes)) { vault.notes[t] = { body: FW_NOTES[t], updated: ts2 }; added++; }
      });
      if (added && typeof log === 'function') log('firmware vault: +' + added + ' new note(s)', 'dim');
    }
    notesDB.fwSeeded = 27;
    notesSave();
  }
  function curVault() { notesEnsure(); return notesDB.vaults[notesDB.activeVault]; }
  function vaultNoteNames() { return Object.keys(curVault().notes).sort(); }

  function extractLinks(body) {
    var out = [], re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, m;
    while ((m = re.exec(body)) !== null) { var t = m[1].trim(); if (t && out.indexOf(t) < 0) out.push(t); }
    return out;
  }
  function extractTags(body) {
    var out = {}, re = /(^|\s)#([A-Za-z][\w-]*)/g, m;
    while ((m = re.exec(body)) !== null) out[m[2]] = true;
    return Object.keys(out);
  }
  function allTags() {
    var v = curVault(), counts = {};
    vaultNoteNames().forEach(function (t) {
      extractTags(v.notes[t].body).forEach(function (tg) { counts[tg] = (counts[tg] || 0) + 1; });
    });
    return counts;
  }

  /* ── vaults ── */
  function renderVaultSel() {
    var sel = $('vault-sel'); sel.innerHTML = '';
    Object.keys(notesDB.vaults).sort().forEach(function (n) {
      var o = document.createElement('option'); o.value = n; o.textContent = '📓 ' + n;
      sel.appendChild(o);
    });
    sel.value = notesDB.activeVault;
  }
  function newVault(name) {
    if (name === undefined) name = prompt('New vault name:', 'Vault ' + (Object.keys(notesDB.vaults).length + 1));
    if (!name) return;
    name = String(name).trim().slice(0, 40) || 'Untitled';
    if (!notesDB.vaults[name]) notesDB.vaults[name] = { notes: {} };
    notesDB.activeVault = name; noteActive = null; tagFilter = null; noteSearch = '';
    var ns = $('note-search'); if (ns) ns.value = '';
    notesSave(); renderVaultSel(); renderNoteList(); renderTags();
    openNote(vaultNoteNames()[0] || null); renderNoteGraph();
    log('vault "' + name + '" ready', 'ok');
  }
  function delVault() {
    var names = Object.keys(notesDB.vaults);
    if (names.length <= 1) { log('cannot delete the last vault', 'warn'); return; }
    if (!confirm('Delete vault "' + notesDB.activeVault + '" and all its notes?')) return;
    delete notesDB.vaults[notesDB.activeVault];
    notesDB.activeVault = Object.keys(notesDB.vaults)[0];
    noteActive = null; tagFilter = null;
    notesSave(); renderVaultSel(); renderNoteList(); renderTags();
    openNote(vaultNoteNames()[0] || null); renderNoteGraph();
    log('vault deleted', 'warn');
  }

  /* ── note list / CRUD ── */
  function filteredNotes() {
    var v = curVault(), names = vaultNoteNames();
    if (tagFilter) names = names.filter(function (t) { return extractTags(v.notes[t].body).indexOf(tagFilter) >= 0; });
    if (noteSearch) {
      var q = noteSearch.toLowerCase();
      names = names.filter(function (t) {
        return t.toLowerCase().indexOf(q) >= 0 || v.notes[t].body.toLowerCase().indexOf(q) >= 0;
      });
    }
    return names;
  }
  function renderNoteList() {
    var ul = $('note-list'); ul.innerHTML = '';
    var names = filteredNotes();
    if (!names.length) { ul.innerHTML = '<li style="color:var(--dim)">no notes match</li>'; return; }
    names.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      if (t === noteActive) li.className = 'active';
      li.onclick = function () { openNote(t); };
      ul.appendChild(li);
    });
  }
  function openNote(title) {
    // a [[missing link]] creates the note on open — Obsidian behavior
    if (title && !curVault().notes[title]) {
      curVault().notes[title] = { body: '', updated: Date.now() };
      notesSave(); renderTags();
    }
    noteActive = title;
    if (!title) {
      $('note-title').value = ''; $('note-body').value = '';
      $('notes-preview').innerHTML = '<div class="dsinfo">No note selected.</div>';
      renderNoteList(); return;
    }
    $('note-title').value = title;
    $('note-body').value = curVault().notes[title].body;
    if (noteView === 'preview') renderPreview();
    renderNoteList();
  }
  function newNote(name) {
    if (name === undefined) name = prompt('New note title:', 'Untitled');
    if (!name) return;
    name = String(name).trim().slice(0, 80) || 'Untitled';
    var v = curVault(), base = name, i = 1;
    while (v.notes[base]) base = name + ' ' + (++i);
    v.notes[base] = { body: '', updated: Date.now() };
    notesSave(); openNote(base); renderTags(); renderNoteGraph();
    log('note "' + base + '" created', 'ok');
  }
  function delNote() {
    if (!noteActive) return;
    if (!confirm('Delete note "' + noteActive + '"?')) return;
    delete curVault().notes[noteActive];
    notesSave();
    openNote(vaultNoteNames()[0] || null); renderTags(); renderNoteGraph();
    log('note deleted', 'warn');
  }
  function saveNoteNow() {
    if (!noteActive || !$('note-body')) return;
    var v = curVault();
    if (!v.notes[noteActive]) return;
    v.notes[noteActive].body = $('note-body').value;
    v.notes[noteActive].updated = Date.now();
    notesSave();
  }
  function renameNote() {
    if (!noteActive) return;
    var nt = $('note-title').value.trim().slice(0, 80);
    if (!nt || nt === noteActive) { $('note-title').value = noteActive; return; }
    var v = curVault();
    if (v.notes[nt]) { log('a note with that title already exists', 'warn'); $('note-title').value = noteActive; return; }
    v.notes[nt] = v.notes[noteActive];
    delete v.notes[noteActive];
    var esc = noteActive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\[\\[' + esc + '(\\|[^\\]]+)?\\]\\]', 'g');
    vaultNoteNames().forEach(function (t) {
      v.notes[t].body = v.notes[t].body.replace(re, function (m, alias) { return '[[' + nt + (alias || '') + ']]'; });
    });
    noteActive = nt;
    notesSave(); renderNoteList(); renderTags(); renderNoteGraph();
    log('renamed → "' + nt + '" (links updated)', 'ok');
  }

  /* ── markdown render (safe: escape first) ── */
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function renderMD(src) {
    var h = escHtml(src);
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    h = h.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, function (m, t, alias) {
      var target = t.trim(), label = (alias ? alias.slice(1) : target).trim();
      var exists = !!curVault().notes[target];
      return '<a href="#" class="wl' + (exists ? '' : ' missing') + '" data-wl="' + escAttr(target) + '">' + escHtml(label) + '</a>';
    });
    h = h.replace(/(^|\s)#([A-Za-z][\w-]*)/g, '$1<a href="#" class="htag" data-tag="$2">#$2</a>');
    h = h.replace(/^#### (.*)$/gm, '<h4>$1</h4>')
         .replace(/^### (.*)$/gm, '<h3>$1</h3>')
         .replace(/^## (.*)$/gm, '<h2>$1</h2>')
         .replace(/^# (.*)$/gm, '<h1>$1</h1>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>');
    var lines = h.split('\n'), out = [], inList = false, para = [];
    function flushPara() { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } }
    lines.forEach(function (ln) {
      var lm = ln.match(/^\s*[-*] (.*)$/);
      if (/^<h[1-4]>/.test(ln)) { if (inList) { out.push('</ul>'); inList = false; } flushPara(); out.push(ln); }
      else if (lm) { flushPara(); if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + lm[1] + '</li>'); }
      else if (/^\s*$/.test(ln)) { if (inList) { out.push('</ul>'); inList = false; } flushPara(); }
      else para.push(ln);
    });
    if (inList) out.push('</ul>');
    flushPara();
    return out.join('\n');
  }
  function renderPreview() {
    var pv = $('notes-preview');
    if (!noteActive) { pv.innerHTML = '<div class="dsinfo">No note selected.</div>'; return; }
    pv.innerHTML = renderMD(curVault().notes[noteActive].body);
  }

  /* ── tags ── */
  function renderTags() {
    var pane = $('tag-pane'); pane.innerHTML = '';
    var counts = allTags(), tags = Object.keys(counts).sort();
    if (!tags.length) { pane.innerHTML = '<span class="dsinfo">no tags yet — write #like-this</span>'; return; }
    tags.forEach(function (tg) {
      var b = document.createElement('button');
      b.className = 'tagchip' + (tagFilter === tg ? ' active' : '');
      b.textContent = '#' + tg + ' (' + counts[tg] + ')';
      b.onclick = function () { tagFilter = (tagFilter === tg) ? null : tg; renderTags(); renderNoteList(); };
      pane.appendChild(b);
    });
  }

  /* ── graph view ── */
  function renderNoteGraph() {
    if (!window.NL_NGRAPH) return;
    var v = curVault(), names = vaultNoteNames(), indeg = {}, edges = [];
    names.forEach(function (t) { indeg[t] = 0; });
    names.forEach(function (t) {
      extractLinks(v.notes[t].body).forEach(function (u) {
        if (v.notes[u] && u !== t) { edges.push([t, u]); indeg[u]++; }
      });
    });
    var nodes = names.map(function (t) {
      var out = extractLinks(v.notes[t].body).filter(function (u) { return v.notes[u] && u !== t; }).length;
      return { id: t, label: t, weight: 1 + out + indeg[t] };
    });
    window.NL_NGRAPH.setData(nodes, edges);
  }
  function setNoteView(v) {
    noteView = v;
    Array.prototype.forEach.call(document.querySelectorAll('#notes-viewseg button'), function (b) {
      b.classList.toggle('active', b.dataset.nv === v);
    });
    $('notes-editview').hidden = v !== 'edit';
    $('notes-preview').hidden = v !== 'preview';
    $('notes-graphview').hidden = v !== 'graph';
    if (v === 'preview') renderPreview();
    if (v === 'graph') { renderNoteGraph(); if (window.NL_NGRAPH) window.NL_NGRAPH.onShow(); }
  }
  function onShowNotes() {
    if (noteView === 'graph' && window.NL_NGRAPH) window.NL_NGRAPH.onShow();
  }

  function initNotes() {
    notesEnsure();
    seedFirmwareVault();
    renderVaultSel(); renderNoteList(); renderTags();
    openNote(vaultNoteNames()[0] || null);
    renderNoteGraph();
    Array.prototype.forEach.call(document.querySelectorAll('#notes-viewseg button'), function (b) {
      b.addEventListener('click', function () { setNoteView(b.dataset.nv); });
    });
    $('vault-sel').addEventListener('change', function (e) {
      saveNoteNow();
      notesDB.activeVault = e.target.value; noteActive = null; tagFilter = null; noteSearch = '';
      $('note-search').value = '';
      notesSave(); renderNoteList(); renderTags();
      openNote(vaultNoteNames()[0] || null); renderNoteGraph();
    });
    $('btn-vault-new').onclick = function () { saveNoteNow(); newVault(); };
    $('btn-vault-del').onclick = function () { saveNoteNow(); delVault(); };
    $('btn-note-new').onclick = function () { saveNoteNow(); newNote(); };
    $('btn-note-del').onclick = delNote;
    $('note-search').addEventListener('input', function (e) { noteSearch = e.target.value.trim(); renderNoteList(); });
    $('note-title').addEventListener('change', renameNote);
    $('note-body').addEventListener('input', function () {
      clearTimeout(noteSaveTimer);
      noteSaveTimer = setTimeout(function () { saveNoteNow(); renderTags(); }, 600);
    });
    $('notes-preview').addEventListener('click', function (e) {
      var t = e.target;
      var wl = t.closest ? t.closest('[data-wl]') : null;
      if (wl) { e.preventDefault(); openNote(wl.getAttribute('data-wl')); renderNoteGraph(); return; }
      var ht = t.closest ? t.closest('[data-tag]') : null;
      if (ht) {
        e.preventDefault();
        tagFilter = ht.getAttribute('data-tag');
        renderTags(); renderNoteList(); setNoteView('edit');
      }
    });
    if (window.NL_NGRAPH) window.NL_NGRAPH.init('ngraph-canvas', {
      playBtn: 'ngraph-play', speedInput: 'ngraph-speed',
      onSelect: function (id) { openNote(id); }
    });
  }

  /* ══ v24 LLM-lab lite (educational, fully offline — no model runs here) ══
     The block between the NL_LLM markers is pure logic: no DOM, no network,
     no downloads. The node test extracts it by regex and evals it with a
     stub window, so keep everything this block needs inside it. */
  /* >>> NL_LLM_PURE_BEGIN >>> */
  function llmTokenize(text) {
    // words + punctuation as tokens, case preserved; ids by first appearance
    var toks = [], ids = {}, vocab = [], re = /\w+|[^\w\s]/g, m;
    text = String(text == null ? '' : text);
    while ((m = re.exec(text)) !== null) {
      var t = m[0];
      if (!(t in ids)) { ids[t] = vocab.length; vocab.push(t); }
      toks.push({ t: t, id: ids[t] });
    }
    return { tokens: toks, count: toks.length, vocab: vocab };
  }
  function llmFormatChat(o) {
    o = o || {};
    return '<|system|>\n' + (o.system || '') + '\n<|user|>\n' + (o.user || '') +
           '\n<|assistant|>\n' + (o.assistant || '');
  }
  function llmRng(seed) {
    // mulberry32: prefer the app's copy, fall back to a local one for tests
    if (typeof window !== 'undefined' && window.NL_MLP && window.NL_MLP.mulberry32)
      return window.NL_MLP.mulberry32(seed);
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function llmCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  var LLM_TOPICS = ['backprop', 'quantization', 'spiking neurons', 'overfitting', 'convolution', 'gradient descent'];
  var LLM_DEFS = { // real one-line definitions — response bodies for explain/define
    'backprop': 'Backprop is the algorithm that trains a neural network by pushing the prediction error backward through the layers and nudging every weight a little in the direction that shrinks the error.',
    'quantization': 'Quantization is shrinking a model by storing its weights as small integers instead of floats, so it runs faster and fits on tiny chips.',
    'spiking neurons': 'Spiking neurons are brain-style units that talk to each other with short pulses over time instead of single numbers, so they spend energy only when something changes.',
    'overfitting': 'Overfitting is when a model memorizes its training data like a script instead of learning the pattern, so it stumbles on anything new.',
    'convolution': 'A convolution is a small window that slides across an image spotting local patterns like edges — the core trick behind CNN vision models.',
    'gradient descent': 'Gradient descent is the optimization loop that nudges a model\'s weights downhill on the loss surface until the error bottoms out.'
  };
  var LLM_WHY = { // 'why does {t} matter for {u}?' clauses
    'backprop': 'without it no neural network can learn, and understanding it is what lets you pick a model you can actually fine-tune.',
    'quantization': 'it is what makes neural networks small and cheap enough to run on a microcontroller with kilobytes of RAM.',
    'spiking neurons': 'event-driven pulses only cost energy when something changes, which is exactly how battery-powered devices want to think.',
    'overfitting': 'an app in the wild sees the real world, not the lab — a model that memorized its training data will embarrass you in the field.',
    'convolution': 'cameras produce images, and convolutions are the cheapest proven way to pull structure out of pixels.',
    'gradient descent': 'every training loop, on-device or in the cloud, is still just walking downhill on a loss surface.'
  };
  var LLM_KIND = { // 'compare {t} and {u}' — one clause each, different pipeline ends
    'backprop': 'a learning rule — it decides HOW weights change',
    'quantization': 'a storage trick — it decides how SMALL the numbers are',
    'spiking neurons': 'a computing style — it decides WHEN energy is spent',
    'overfitting': 'a failure mode — it decides whether the model GENERALIZES',
    'convolution': 'a feature extractor — it decides what the model SEES',
    'gradient descent': 'an optimizer — it decides the PATH training takes'
  };
  var LLM_INSTR_T = [
    'Explain {t} in one sentence.',
    'Give a one-line definition of {t}.',
    'Why does {t} matter for {u}?',
    'Compare {t} and {u}.'
  ];
  var LLM_USE = ['embedded AI', 'phone apps', 'robotics'];
  function llmRespond(t, t2, u, tpl) {
    if (tpl === LLM_INSTR_T[2])
      return llmCap(t) + ' matters for ' + u + ' because ' + LLM_WHY[t];
    if (tpl === LLM_INSTR_T[3])
      return llmCap(t) + ' and ' + t2 + ' sit at different ends of the AI pipeline: ' +
        llmCap(t) + ' is ' + LLM_KIND[t] + ', while ' + llmCap(t2) + ' is ' + LLM_KIND[t2] + '. ' +
        'Confuse the two and you will debug the wrong end of the system.';
    return LLM_DEFS[t];
  }
  function llmGenPairs(seed, n) {
    var rng = llmRng(seed), out = [];
    n = Math.max(0, n | 0);
    for (var i = 0; i < n; i++) {
      var t = LLM_TOPICS[Math.floor(rng() * LLM_TOPICS.length)];
      var t2 = LLM_TOPICS[Math.floor(rng() * LLM_TOPICS.length)];
      var u = LLM_USE[Math.floor(rng() * LLM_USE.length)];
      var tpl = LLM_INSTR_T[Math.floor(rng() * LLM_INSTR_T.length)];
      if (tpl === LLM_INSTR_T[3]) { // compare needs two different topics
        var guard = 0;
        while (t2 === t && guard++ < 10) t2 = LLM_TOPICS[Math.floor(rng() * LLM_TOPICS.length)];
      }
      var instr = tpl.split('{t}').join(t).split('{u}').join(u);
      out.push({ instruction: instr, response: llmRespond(t, t2, u, tpl) });
    }
    return out;
  }
  function llmQualityFilter(pair, seen) {
    if (!pair || typeof pair.response !== 'string' || pair.response.length < 20)
      return { ok: false, reason: 'too short' };
    if (pair.instruction && pair.response.indexOf(pair.instruction) >= 0)
      return { ok: false, reason: 'echoes instruction' };
    if (/TODO|\.\.\./.test(pair.response))
      return { ok: false, reason: 'placeholder text' };
    if (seen && seen.indexOf(pair.instruction) >= 0)
      return { ok: false, reason: 'duplicate' };
    return { ok: true, reason: 'kept' };
  }
  var LLM_DPO_PAIRS = [
    { prompt: 'Explain what a neural network is to a curious 12-year-old.',
      a: 'Think of a neural network as a team of tiny decision-makers stacked in layers. Each one looks at a small clue and passes its guess along. When the team gets something wrong, it adjusts — millions of tiny corrections until it can recognize faces, words, or sounds.',
      b: 'A neural network is a computer thing with neurons and weights that does AI stuff using math and training data.' },
    { prompt: 'Why does my model overfit?',
      a: 'It is memorizing instead of learning: the training loss keeps dropping while the validation loss climbs. Fix it with more varied data, dropout, weight decay, or a smaller model — and always watch a held-out set.',
      b: 'Your model is too big. Make it smaller and it will stop.' },
    { prompt: 'What is quantization in TinyML?',
      a: 'Quantization stores a model\'s weights as small integers (like int8) instead of floats. The model shrinks about 4x and runs with integer math, which is exactly what lets it fit on a microcontroller.',
      b: 'Quantization means making the model worse so it runs faster. Just use a smaller model instead.' },
    { prompt: 'Should I train with Adam or SGD?',
      a: 'Start with Adam: it adapts the learning rate per parameter and usually converges faster on new problems. Switch to tuned SGD with momentum later if you need the last few percent — SGD often generalizes slightly better at the cost of more tuning.',
      b: 'Adam. Always Adam.' },
    { prompt: 'Explain a convolution in one sentence for an image app.',
      a: 'A convolution slides a small learned pattern-detector across the image so the model spots edges, textures, and shapes wherever they appear.',
      b: 'A convolution is when you convolve the kernels over the feature maps to produce activations.' },
    { prompt: 'My spiking neuron never fires. What do I check first?',
      a: 'Check the basics in order: is the input current actually reaching it, is the threshold set above the resting level but within reach, and is the membrane leaking away charge faster than it arrives? Nine times out of ten it is the threshold or the leak.',
      b: 'Spiking neurons are hard. Try a regular neuron instead.' }
  ];
  window.NL_LLM = {
    tokenize: llmTokenize,
    formatChat: llmFormatChat,
    genPairs: llmGenPairs,
    qualityFilter: llmQualityFilter,
    dpoPairs: LLM_DPO_PAIRS
  };
  /* <<< NL_LLM_PURE_END <<< */

  /* ── v24 LLM-lab lite DOM handlers (thin glue over window.NL_LLM) ── */
  var llmGenCache = { seed: 7, pairs: [], rejected: 0 };
  var llmDpoIdx = 0, llmDpoCur = null, llmPanelSeen = false;

  function llmTokUI() {
    var inp = $('llm-tok-in'), out = $('llm-tok-out');
    if (!inp || !out) return;
    var r = window.NL_LLM.tokenize(inp.value);
    var lines = r.tokens.slice(0, 40).map(function (t) { return 'tok_' + t.id + ':' + t.t; });
    if (r.tokens.length > 40) lines.push('…');
    lines.push('');
    lines.push(r.count + ' tokens · ' + r.vocab.length + ' vocab');
    out.textContent = lines.join('\n');
  }
  function llmFmtUI() {
    var out = $('llm-fmt-out'); if (!out) return;
    var s = $('llm-sys') ? $('llm-sys').value : '';
    var u = $('llm-user') ? $('llm-user').value : '';
    var a = $('llm-asst') ? $('llm-asst').value : '';
    var fmt = window.NL_LLM.formatChat({ system: s, user: u, assistant: a });
    var tk = window.NL_LLM.tokenize(fmt);
    out.textContent = fmt + '\n—\n' + tk.count + ' tokens · ' + tk.vocab.length + ' vocab\n\n' +
      'the template is the role boundary — instruction tuning teaches a model to respect it. this playground formats text only; no model runs here.';
  }
  function llmGenUI() {
    var out = $('llm-gen-out'); if (!out) return;
    var seedEl = $('llm-seed');
    var seed = seedEl ? (parseInt(seedEl.value, 10) || 0) : 7;
    var cands = window.NL_LLM.genPairs(seed, 24);
    var kept = [], seen = [], rej = 0;
    cands.forEach(function (p) {
      var f = window.NL_LLM.qualityFilter(p, seen);
      if (f.ok) { kept.push(p); seen.push(p.instruction); }
      else rej++;
    });
    llmGenCache = { seed: seed, pairs: kept, rejected: rej };
    var lines = ['seed ' + seed + ': ' + cands.length + ' candidates → ' + kept.length + ' kept, ' + rej + ' rejected'];
    kept.slice(0, 3).forEach(function (p, i) {
      lines.push('', '#' + (i + 1) + ' Q: ' + p.instruction, '   A: ' + p.response);
    });
    lines.push('', 'hit "Save dataset" to store the ' + kept.length + ' kept pairs on this device.');
    out.textContent = lines.join('\n');
    log('synthetic data: ' + kept.length + ' kept / ' + rej + ' rejected (seed ' + seed + ')', 'ok');
  }
  function llmSaveUI() {
    if (!llmGenCache.pairs.length) { log('save dataset: generate pairs first', 'warn'); return; }
    saveJSON('nl_synth_v1', { seed: llmGenCache.seed, pairs: llmGenCache.pairs });
    var out = $('llm-gen-out');
    if (out) out.textContent += '\nsaved ' + llmGenCache.pairs.length + ' pairs to local dataset (nl_synth_v1)';
    log('saved ' + llmGenCache.pairs.length + ' pairs to local dataset (nl_synth_v1)', 'ok');
  }
  function llmDpoStats() {
    var el = $('llm-dpo-stats'); if (!el) return;
    var prefs = loadJSON('nl_prefs_v1', []);
    var na = 0, nb = 0;
    prefs.forEach(function (p) { if (p.chosen === 'a') na++; else if (p.chosen === 'b') nb++; });
    el.textContent = prefs.length ? ('A preferred ' + na + ' · B preferred ' + nb + ' · total ' + prefs.length)
                                  : 'no votes yet — rate a pair above.';
  }
  function llmDpoShow() {
    var el = $('llm-dpo-prompt'); if (!el) return;
    var prs = window.NL_LLM.dpoPairs;
    llmDpoCur = prs[llmDpoIdx % prs.length];
    el.textContent = 'prompt: ' + llmDpoCur.prompt + '\n\nA: ' + llmDpoCur.a + '\n\nB: ' + llmDpoCur.b;
  }
  function llmDpoRate(which) {
    if (!llmDpoCur) llmDpoShow();
    var prefs = loadJSON('nl_prefs_v1', []);
    prefs.push({ prompt: llmDpoCur.prompt, chosen: which, rejected: (which === 'a' ? 'b' : 'a'), ts: Date.now() });
    saveJSON('nl_prefs_v1', prefs);
    llmDpoStats();
    log('dpo vote: preferred ' + which.toUpperCase() + ' (' + prefs.length + ' total)', 'dim');
  }
  function llmDpoNew() {
    llmDpoIdx = (llmDpoIdx + 1) % window.NL_LLM.dpoPairs.length;
    llmDpoShow();
  }
  function onShowLLM() {
    if (llmPanelSeen) return;
    llmPanelSeen = true;
    llmDpoShow(); llmDpoStats();
  }

  /* ══ wiring ═══════════════════════════════════ */
  function wire() {
    /* mobile: hamburger menu + props drawer */
    $('hamburger').addEventListener('click', function (e) {
      e.stopPropagation();
      closeMenus();
      $('menubar').classList.toggle('mopen');
    });
    $('props-toggle').addEventListener('click', function () { $('props').classList.toggle('open'); });
    document.addEventListener('click', function () { $('menubar').classList.remove('mopen'); });
    var mm = document.querySelector('#menubar .menus');
    if (mm) mm.addEventListener('click', function (e) { e.stopPropagation(); });
    window.addEventListener('resize', function () { fitCanvases(); });
    window.addEventListener('orientationchange', function () { setTimeout(fitCanvases, 300); });

    Array.prototype.forEach.call(document.querySelectorAll('.tool,.tab'), function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.menubtn'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var m = b.parentElement, was = m.classList.contains('open');
        closeMenus();
        if (!was) m.classList.add('open');
      });
    });
    document.addEventListener('click', closeMenus);
    var acts = {
      'demo-xor': function () { switchTab('train'); demoXOR(); },
      'demo-blobs': function () { switchTab('train'); demoBlobs(); },
      'import-csv': function () { $('csv-file').click(); },
      'save-model': saveModel, 'load-model': loadModel,
      'start-train': startTraining,
      'stop-train': function () { stopReq = true; },
      'reset-model': resetModel,
      'goto-brain': function () { switchTab('brain'); },
      'goto-notes': function () { switchTab('notes'); },
      'goto-dev': function () { switchTab('dev'); },
      'clear-console': function () { $('console-out').innerHTML = ''; }
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () { closeMenus(); $('menubar').classList.remove('mopen'); acts[b.dataset.act](); });
    });

    $('btn-demo-xor').onclick = demoXOR;
    $('btn-demo-blobs').onclick = demoBlobs;
    $('btn-demo-decoder').onclick = demoDecoder;
    $('btn-demo-digits').onclick = demoDigits;
    $('btn-demo-ohm').onclick = demoOhm;
    $('btn-demo-attn').onclick = demoAttn; // v28: sequence dataset + transformer arch
    $('btn-inspect-kernels').onclick = inspectKernels;
    $('btn-edge-profile').onclick = edgeProfile;
    $('btn-edge-ota').onclick = edgeOTA;
    $('btn-edge-stream').onclick = loadEdgeStream;
    $('btn-edge-run').onclick = function () { edgeShell($('edge-cmd').value); };

  /* v47 First Tongue — on-device Colab-trained character transformer (NL_TONGUE)
   * v50: the trinity lives in the model's core (tongue.js), not a side module. */
  var tongueModel = null, tongueManifest = null, tongueLoading = null, tongueItos = null;
  var tongueLastText = '', tongueLastIds = [], tongueLastSeed = '', tongueLastThought = '';
  var tongueLastRecoveredFrom = null, tongueRecoveredFrom = null;
  /* v61 trinity — the corrected spec. The trinity is three built-in functions
   * of main(): ghost() seals the WHOLE failed run, molecule() is born only
   * from a failed ghost, blackhole() keeps the gravity. "That was wack"
   * condemns the whole run (seed + thought + output) — the manual override.
   * The AI judges its own mains automatically. Never deleted. */
  function tongueTrinityStatus(model) {
    var el = $('tongue-trinity-status');
    if (!el) return;
    var m = model || tongueModel;
    if (!m) return;
    var st = m.trinityStatus();
    el.textContent = 'trinity: ' + st.live + ' molecule' + (st.live === 1 ? '' : 's') + ' live · ' +
      st.ghosts + ' ghost' + (st.ghosts === 1 ? '' : 's') + ' sealed' +
      (st.broken ? ' (' + st.broken + ' broke into molecules)' : '') +
      ' · gravity holds ' + st.gravity + ' n-grams';
  }
  function tongueWackUI() {
    var out = $('tongue-out');
    if (!tongueModel || !tongueLastIds || tongueLastIds.length < 4) {
      if (out) out.textContent = 'nothing to condemn yet — hit Speak first and wait for it to finish.';
      return;
    }
    var st = tongueModel.condemnRun({ seed: tongueLastSeed, thought: tongueLastThought,
      text: tongueLastText, ids: tongueLastIds, recoveredFrom: tongueLastRecoveredFrom }, 'condemned');
    var msg = 'run condemned → ghost sealed ' + st.lastGhost.slice(0, 12) + ' (' + st.ghosts + ' ghost(s) in archive)';
    if (st.brokenGhost) msg += ' — its ghost failed and broke into molecules (' + st.live + ' live)';
    if (out) out.textContent = msg + '.';
    log('trinity: ghost sealed (condemned) ' + st.lastGhost, '');
    if (st.brokenGhost) log('trinity: ghost failed → molecules ' + st.brokenGhost, '');
    tongueTrinityStatus(tongueModel);
    tongueGhostArchiveUI();
    tongueLastIds = []; tongueLastRecoveredFrom = null;
  }
  /* Ghost archive UI — whole sealed runs: seal, source (auto = the AI's own
   * judgment), recovered/broken flags, recover affordance. */
  function tongueGhostArchiveUI() {
    var el = $('tongue-ghost-archive');
    if (!el || !tongueModel) return;
    var ghosts = tongueModel.ghostArchive();
    if (!ghosts.length) { el.innerHTML = '<span class="dim">no ghosts sealed yet.</span>'; return; }
    el.innerHTML = ghosts.map(function (g, i) {
      var h = '<div class="dim" style="margin-bottom:8px">';
      h += '👻 <b>' + thoughtEsc(g.seal.slice(0, 12)) + '</b> · ' + thoughtEsc(g.source) +
           (g.recovered ? ' · recovered' : '') + (g.broken ? ' · <i>broke into molecules</i>' : '');
      h += ' <button class="ghost" style="font-size:11px;padding:4px 10px;min-height:44px" data-ghost="' + i + '">recover</button>';
      h += '<div style="opacity:0.6;font-size:12px">' + thoughtEsc((g.text || '').slice(0, 100)) + '…</div>';
      return h + '</div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('[data-ghost]'), function (b) {
      b.onclick = function () { tongueRecoverUI(parseInt(b.dataset.ghost, 10)); };
    });
  }
  function tongueRecoverUI(i) {
    var out = $('tongue-out');
    try {
      var r = tongueModel.recoverGhost(i);
      tongueRecoveredFrom = r.ghost;
      var seedEl = $('tongue-seed');
      if (seedEl) seedEl.value = r.text.slice(0, 200);
      if (out) out.textContent = 'ghost ' + r.seal.slice(0, 12) + ' recovered — its text is staged as the seed. Speak from it: if the new run gets condemned, the ghost breaks into molecules.';
      log('trinity: ghost recovered ' + r.seal, '');
      tongueGhostArchiveUI();
    } catch (e) { if (out) out.textContent = 'recover failed: ' + e.message; }
  }

  /* v52 Free Thought — the tongue thinks its own thoughts. No user seed:
   * each thought seeds the next. v61: the AI judges its own mains — a
   * degenerate thought cycle (looping, stale) seals the WHOLE cycle
   * (seed + inner thought + spoken answer) as a ghost. Ghosts that fail
   * their second chance break into molecules. The system steers its own
   * speech. All on-device, all session-memory. */
  var thoughtRunning = false, thoughtCount = 0, thoughtLog = [];
  var thoughtSeedPool = ['The city was', 'I remember', 'In the darkness', 'She said', 'The future is', 'It began with', '\n'];
  function thoughtEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function thoughtGenOnce(seedText, n, temp) {
    return tongueEnsure().then(function (model) {
      return new Promise(function (resolve) {
        var cfg = tongueManifest.cfg, stoi = tongueManifest.stoi, ctx = cfg.ctx;
        var seed = seedText.split('').filter(function (c) { return c in stoi; }).join('').slice(-(ctx - 2)) || '\n';
        model.reset();
        var hist = [], fed = 0, logits = null, text = seed, count = 0, genIds = [];
        function pushFeed(tok) {
          hist.push(tok);
          if (fed >= ctx) {
            model.reset();
            var keep = hist.slice(-(ctx - 1)), k;
            fed = 0;
            for (k = 0; k < keep.length; k++) { logits = model.step(keep[k]); fed++; }
            return;
          }
          logits = model.step(tok);
          fed++;
        }
        seed.split('').forEach(function (c) { pushFeed(stoi[c]); });
        (function chunk() {
          var t0 = Date.now();
          while (Date.now() - t0 < 150 && count < n) {
            var nxt = tongueSampleNext(logits, temp);
            text += tongueItos[nxt];
            genIds.push(nxt);
            pushFeed(nxt);
            count++;
          }
          if (count < n) setTimeout(chunk, 0);
          else { model.decayMolecules(); resolve({ text: text, ids: genIds }); }
        })();
      });
    });
  }
  function thoughtEvaluate(text, ids) {
    if (!ids || ids.length < 12) return { bad: true, reason: 'too short' };
    var grams = {}, i, k;
    for (i = 0; i + 4 <= ids.length; i++) {
      k = ids.slice(i, i + 4).join(',');
      grams[k] = (grams[k] || 0) + 1;
    }
    var max = 0;
    for (k in grams) if (grams[k] > max) max = grams[k];
    if (max / (ids.length - 3) > 0.3) return { bad: true, reason: 'looping' };
    var recent = thoughtLog.slice(-3), r, inter, union;
    for (r = 0; r < recent.length; r++) {
      if (!recent[r].grams) continue;
      inter = 0;
      for (k in grams) if (recent[r].grams[k]) inter++;
      union = Object.keys(grams).length + Object.keys(recent[r].grams).length - inter;
      if (union > 0 && inter / union > 0.6) return { bad: true, reason: 'stale' };
    }
    return { bad: false, grams: grams };
  }
  function thoughtRender() {
    var el = $('thought-log');
    if (el) {
      el.innerHTML = thoughtLog.map(function (e) {
        var h = '<div style="margin-bottom:10px">';
        h += '<div style="opacity:0.5">💭 <i>' + thoughtEsc(e.inner) + '</i>' +
             (e.ghostSeal ? ' <span class="dim">[' + e.reason + ' → ghost sealed]</span>' : '') + '</div>';
        h += '<div>🗣 ' + thoughtEsc(e.spoken) + '</div>';
        return h + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    }
    var st = $('thought-status');
    if (st) {
      var ts = tongueModel ? tongueModel.trinityStatus() : { live: 0, ghosts: 0, gravity: 0 };
      st.textContent = thoughtRunning ? ('thinking… ' + thoughtCount + ' thoughts · ' + ts.live + ' molecules · ' + ts.ghosts + ' ghosts')
                                      : (thoughtCount + ' thoughts · ' + ts.live + ' molecules · ' + ts.ghosts + ' ghosts');
    }
  }
  var thoughtWonderQ = ['Why ', 'What if ', 'How does ', 'What happens when ', 'Could it be that '];
  function thoughtLoop() {
    if (!thoughtRunning) return;
    var wonder = (thoughtCount % 4 === 3);
    var seedSrc = wonder ? thoughtWonderQ[Math.floor(Math.random() * thoughtWonderQ.length)]
                         : (thoughtLog.length ? thoughtLog[thoughtLog.length - 1].spoken.slice(-40)
                                              : thoughtSeedPool[Math.floor(Math.random() * thoughtSeedPool.length)]);
    /* think: inner monologue */
    thoughtGenOnce(seedSrc, 100, 0.6).then(function (inner) {
      if (!thoughtRunning) return;
      /* speak: answer built from the thought */
      return thoughtGenOnce(inner.text.slice(-40), 120, 0.5).then(function (spoken) {
        if (!thoughtRunning) return;
        var evI = thoughtEvaluate(inner.text, inner.ids);
        var evS = thoughtEvaluate(spoken.text, spoken.ids);
        var gSeal = '', gReason = '';
        if (tongueModel && (evI.bad || evS.bad)) {
          /* self-judgment: the whole cycle (seed + inner + spoken) is one
           * main(). It failed → seal the whole run as a ghost.
           * v64.2: isolated so a trinity failure can never kill thinking. */
          try {
            gReason = evI.bad ? ('inner ' + evI.reason) : ('spoken ' + evS.reason);
            var gst = tongueModel.condemnRun({ seed: seedSrc, thought: inner.text,
              text: spoken.text, ids: inner.ids.concat(spoken.ids) }, 'auto');
            gSeal = gst.lastGhost;
            log('trinity: ghost sealed (auto) ' + gst.lastGhost + ' [' + gReason + ']', 'dim');
            tongueGhostArchiveUI();
          } catch (sealErr) {
            log('ghost seal failed: ' + (sealErr && sealErr.message) + ' — thought kept, loop continues', 'err');
            gSeal = ''; gReason = '';
          }
        }
        thoughtLog.push({ inner: inner.text, spoken: spoken.text,
                          ghostSeal: gSeal, reason: gReason,
                          grams: evS.grams || null, wonder: wonder });
        if (thoughtLog.length > 40) thoughtLog.shift();
        thoughtCount++;
        thoughtRender();
        log('thought #' + thoughtCount + ' done', 'dim');
        setTimeout(thoughtLoop, 400);
      });
    }).catch(function (e) {
      /* v64.2 "Loud Deaths": the loop must never die silently again. Surface
       * the reason in the console + status, reset the button, stop cleanly. */
      var msg = (e && e.message) ? e.message : String(e);
      log('thought loop died: ' + msg, 'err');
      var st = $('thought-status');
      if (st) st.textContent = 'thought loop error: ' + msg + ' — tap Start thinking to retry';
      thoughtRunning = false;
      var btn = $('btn-thought');
      if (btn) btn.textContent = 'Start thinking';
    });
  }
  function thoughtToggleUI() {
    var btn = $('btn-thought');
    thoughtRunning = !thoughtRunning;
    if (btn) btn.textContent = thoughtRunning ? 'Stop thinking' : 'Start thinking';
    /* v64.2: a render error must never prevent the loop from starting. */
    try { thoughtRender(); } catch (re) { log('thought render failed: ' + (re && re.message), 'err'); }
    if (thoughtRunning) thoughtLoop();
  }
  function tongueEnsure() {
    if (tongueModel) return Promise.resolve(tongueModel);
    if (tongueLoading) return tongueLoading;
    // XHR, not fetch: reliable for file:///android_asset reads in WebView
    // (MainActivity enables setAllowFileAccessFromFileURLs for this).
    function xhrGet(url, responseType) {
      return new Promise(function (resolve, reject) {
        var x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.responseType = responseType;
        x.onload = function () {
          if (x.status === 0 || (x.status >= 200 && x.status < 300)) resolve(x.response);
          else reject(new Error('no ' + url + ' (' + x.status + ')'));
        };
        x.onerror = function () { reject(new Error('no ' + url)); };
        x.send();
      });
    }
    tongueLoading = Promise.all([
      xhrGet('tongue.json', 'json'),
      xhrGet('tongue.bin', 'arraybuffer')
    ]).then(function (parts) {
      tongueManifest = parts[0];
      var bin = new Float32Array(parts[1]);
      tongueItos = [];
      Object.keys(tongueManifest.stoi).forEach(function (ch) { tongueItos[tongueManifest.stoi[ch]] = ch; });
      tongueModel = NL_TONGUE.createModel(tongueManifest, bin);
      return tongueModel;
    }, function (err) {
      /* v64.2: a failed load must not poison the loader forever — clear it
       * so the next attempt retries the XHRs instead of reusing a rejection. */
      tongueLoading = null;
      throw err;
    });
    return tongueLoading;
  }
  function tongueSampleNext(logits, temp) {
    var m = -1e30, i;
    for (i = 0; i < logits.length; i++) if (logits[i] > m) m = logits[i];
    var sum = 0, probs = new Float32Array(logits.length);
    for (i = 0; i < logits.length; i++) { probs[i] = Math.exp((logits[i] - m) / temp); sum += probs[i]; }
    var r = Math.random() * sum;
    for (i = 0; i < probs.length; i++) { r -= probs[i]; if (r <= 0) return i; }
    return probs.length - 1;
  }
  function tongueSpeakUI() {
    var out = $('tongue-out'), status = $('tongue-status'), btn = $('btn-tongue');
    if (!out || !window.NL_TONGUE) return;
    var tempEl = $('tongue-temp');
    var tv = $('tongue-temp-val'); if (tv && tempEl) tv.textContent = (+tempEl.value).toFixed(2);
    if (btn) btn.disabled = true;
    status.textContent = 'waking the tongue…';
    tongueEnsure().then(function (model) {
      var cfg = tongueManifest.cfg, stoi = tongueManifest.stoi, ctx = cfg.ctx;
      var seedRaw = $('tongue-seed') ? $('tongue-seed').value : '';
      var seed = seedRaw.split('').filter(function (c) { return c in stoi; }).join('').slice(-(ctx - 2)) || '\n';
      var temp = Math.min(1.5, Math.max(0.05, parseFloat(tempEl.value) || 0.4));
      var n = Math.min(1200, Math.max(20, parseInt(($('tongue-n') || {}).value, 10) || 300));
      model.reset();
      var hist = [], fed = 0, logits = null, text = seed, count = 0;
      function pushFeed(tok) {
        hist.push(tok);
        if (fed >= ctx) { /* slide window: rebuild cache from recent history */
          model.reset();
          var keep = hist.slice(-(ctx - 1)), k;
          fed = 0;
          for (k = 0; k < keep.length; k++) { logits = model.step(keep[k]); fed++; }
          return;
        }
        logits = model.step(tok);
        fed++;
      }
      seed.split('').forEach(function (c) { pushFeed(stoi[c]); });
      out.textContent = text;
      status.textContent = 'speaking…';
      var genIds = [];
      (function chunk() {
        var t0 = Date.now();
        while (Date.now() - t0 < 150 && count < n) {
          var nxt = tongueSampleNext(logits, temp);
          text += tongueItos[nxt];
          genIds.push(nxt);
          pushFeed(nxt);
          count++;
        }
        out.textContent = text;
        out.scrollTop = out.scrollHeight;
        if (count < n) setTimeout(chunk, 0);
        else {
          status.textContent = 'done · ' + count + ' chars @ temp ' + temp.toFixed(2);
          if (btn) btn.disabled = false;
          /* trinity: remember this whole run (seed + output), cool the molecules.
           * A Speak run has no inner thought — thought stays ''. */
          tongueLastText = text;
          tongueLastIds = genIds.slice();
          tongueLastSeed = seedRaw;
          tongueLastThought = '';
          tongueLastRecoveredFrom = tongueRecoveredFrom;
          tongueRecoveredFrom = null;
          model.decayMolecules();
          tongueTrinityStatus(model);
        }
      })();
    }).catch(function () {
      status.textContent = 'brain not bundled in this build yet.';
      out.textContent = 'the tongue weights are not in this APK — they arrive with the next build.';
      if (btn) btn.disabled = false;
      tongueLoading = null;
    });
  }
    // v24 LLM-lab lite
    $('btn-llm-tok').onclick = llmTokUI;
    $('btn-llm-fmt').onclick = llmFmtUI;
    $('btn-llm-gen').onclick = llmGenUI;
    $('btn-llm-save').onclick = llmSaveUI;
    $('btn-dpo-a').onclick = function () { llmDpoRate('a'); };
    $('btn-dpo-b').onclick = function () { llmDpoRate('b'); };
    $('btn-dpo-new').onclick = llmDpoNew;
    $('btn-tongue').onclick = tongueSpeakUI;
    if ($('btn-tongue-wack')) $('btn-tongue-wack').onclick = tongueWackUI;
    if ($('btn-thought')) $('btn-thought').onclick = thoughtToggleUI;
    var _tt = $('tongue-temp');
    if (_tt) _tt.addEventListener('input', function () { var v = $('tongue-temp-val'); if (v) v.textContent = (+_tt.value).toFixed(2); });
    // ---- Brain Feeder: URL -> clean text -> brain-food.txt ----
    var feedStash = null;
    function feedCleanText(html) {
      var doc;
      try { doc = new DOMParser().parseFromString(html, 'text/html'); }
      catch (e) { return ''; }
      var junk = doc.querySelectorAll('script, style, nav, header, footer, aside, form, button, noscript, svg, iframe');
      for (var i = 0; i < junk.length; i++) junk[i].remove();
      var root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
      if (!root) return '';
      var text = root.innerText || '';
      text = text.replace(/[ \t\u00a0]+/g, ' ');
      var lines = text.split('\n'), keep = [], l;
      for (var j = 0; j < lines.length; j++) {
        l = lines[j].trim();
        if (l.length < 25) continue;                    // nav crumbs, labels
        if (/^(home|menu|search|login|sign in|subscribe|share|follow|advertisement)\b/i.test(l)) continue;
        keep.push(l);
      }
      return keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    function feedFetchUI() {
      var urlEl = $('feed-url'), status = $('feed-status'), prev = $('feed-preview'), saveBtn = $('btn-feed-save');
      if (!urlEl || !window.NB || !NB.httpGet) { if (status) status.textContent = 'needs the native bridge.'; return; }
      var url = (urlEl.value || '').trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      /* v54: Google Docs share links -> plain-text export (doc must be link-shared) */
      var gdoc = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (gdoc) url = 'https://docs.google.com/document/d/' + gdoc[1] + '/export?format=txt';
      if (status) status.textContent = 'fetching…';
      if (prev) prev.textContent = '';
      if (saveBtn) saveBtn.disabled = true;
      feedStash = null;
      setTimeout(function () {
        var raw, code = 0, html = '';
        try {
          raw = NB.httpGet(url);
          var nl = raw.indexOf('\n');
          code = parseInt(raw.slice(5, nl), 10) || 0;
          html = raw.slice(nl + 1);
        } catch (e) { if (status) status.textContent = 'fetch failed.'; return; }
        if (!(code >= 200 && code < 300) || !html) { if (status) status.textContent = 'page not readable (HTTP ' + code + ').'; return; }
        var text = feedCleanText(html);
        if (text.length < 200) { if (status) status.textContent = 'too little text found — try another page.'; return; }
        feedStash = { url: url, text: text };
        if (status) status.textContent = 'cleaned ' + text.length.toLocaleString() + ' chars.';
        if (prev) prev.textContent = text.slice(0, 600) + (text.length > 600 ? '\n…' : '');
        if (saveBtn) saveBtn.disabled = false;
      }, 30);
    }
    function feedSaveUI() {
      var status = $('feed-status');
      if (!feedStash || !window.NB || !(NB.saveSharedText || NB.saveTextFile)) return;
      /* v64: hard boundary delimiters — one document per paste/URL fetch. */
      var entry = window.NL_INGEST ? NL_INGEST.wrapDoc(feedStash.text)
        : '<|startoftext|>\n' + feedStash.text + '\n<|endoftext|>\n';
      /* v62: route through the corpus watcher — dedupes against existing
       * brain-food.txt before appending, then refreshes the Training-ready card. */
      if (window.NL_WATCHER && NL_WATCHER.stageText && NB.saveSharedText && NB.readSharedText) {
        var wr = NL_WATCHER.stageText(entry, 'Brain Feeder');
        if (status) status.textContent = wr.ok
          ? 'saved +' + wr.addedKB.toFixed(1) + ' KB new to Documents/NeuralLab/brain-food.txt' +
            (wr.dupeKB > 0.05 ? ' (' + wr.dupeKB.toFixed(1) + ' KB dupes skipped)' : '') +
            (wr.stripped > 0 ? ' (' + wr.stripped.toLocaleString() + ' chars outside vocab stripped)' : '') +
            ' — find it in your Files app, upload to Drive.'
          : 'save failed: ' + wr.error;
        if (wr.ok) { feedStash = null; $('btn-feed-save').disabled = true; }
        return;
      }
      /* fallback: direct save (watcher unavailable) */
      var res = NB.saveSharedText ? NB.saveSharedText('brain-food.txt', entry)
                                  : NB.saveTextFile('brain-food.txt', entry);
      if (status) status.textContent = String(res).indexOf('OK') === 0
        ? 'saved to Documents/NeuralLab/brain-food.txt — find it in your Files app, upload to Drive.'
        : 'save failed: ' + res;
      if (String(res).indexOf('OK') === 0) { feedStash = null; $('btn-feed-save').disabled = true; }
    }
    function feedPasteUI() {
      var pasteEl = $('feed-paste'), status = $('feed-status'), prev = $('feed-preview'), saveBtn = $('btn-feed-save');
      var text = (pasteEl && pasteEl.value || '').trim();
      if (text.length < 200) { if (status) status.textContent = 'paste more text first (need 200+ chars).'; return; }
      feedStash = { url: 'pasted-text', text: text };
      if (status) status.textContent = 'pasted ' + text.length.toLocaleString() + ' chars, ready to save.';
      if (prev) prev.textContent = text.slice(0, 600) + (text.length > 600 ? '\n…' : '');
      if (saveBtn) saveBtn.disabled = false;
    }
    if ($('btn-feed')) $('btn-feed').onclick = feedFetchUI;
    if ($('btn-feed-paste')) $('btn-feed-paste').onclick = feedPasteUI;
    if ($('btn-feed-save')) $('btn-feed-save').onclick = feedSaveUI;
    $('edge-cmd').addEventListener('keydown', function (e) { if (e.key === 'Enter') edgeShell($('edge-cmd').value); });
    $('task-sel').addEventListener('change', function (e) {
      if (!ds) return;
      if (ds._rawHeader) {
        ds.task = e.target.value;
        ds._needsPrep = true; ds.X = []; ds.features = [];
        setDataset(ds); // re-preps from raw CSV + rebuilds
      } else if (ds.demoDecoder) {
        flipDecoderTask(e.target.value);
      } else {
        // v36: built-in demos have a fixed task — revert + explain instead of a dead dropdown
        e.target.value = ds.task === 'regression' ? 'regression' : 'classification';
        log('the ' + ds.name + ' demo is ' + e.target.value + '-only — task stays fixed', 'warn');
      }
    });
    $('btn-import-csv').onclick = function () { $('csv-file').click(); };
    $('csv-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      if (!/\.csv$/i.test(f.name)) {
        log('that doesn\'t look like a .csv file — pick the .csv export', 'warn');
        e.target.value = '';
        return;
      }
      var rd = new FileReader();
      rd.onload = function () { importCSVText(String(rd.result), f.name); };
      rd.readAsText(f);
      e.target.value = '';
    });
    $('label-col').addEventListener('change', function (e) {
      if (!ds) return;
      ds.label = e.target.value; ds._needsPrep = true; ds.X = []; ds.features = [];
      if (prepCSV()) { rebuildSplit(); buildModel(); }
    });
    $('split').addEventListener('input', function () { rebuildSplit(); });

    $('btn-build').onclick = buildModel;
    $('btn-export-q88').onclick = exportQ88;
    $('btn-export-c').onclick = exportC;
    // v28: architecture picker — MLP vs Transformer (attention)
    if ($('arch-sel')) $('arch-sel').addEventListener('change', function () { syncArchUI(); buildModel(); });
    if ($('dmodel')) $('dmodel').addEventListener('change', buildModel);
    syncArchUI();
    $('btn-train').onclick = startTraining;
    $('btn-stop').onclick = function () { stopReq = true; };
    $('btn-predict').onclick = doPredict;

    // editor
    $('btn-new-file').onclick = function () { openEditorFile(null); };
    $('btn-open-file').onclick = function () { $('open-file').click(); };
    $('open-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        edFiles[f.name] = String(rd.result); persistFiles();
        openEditorFile(f.name);
        log('opened "' + f.name + '" from device', 'ok');
      };
      rd.readAsText(f);
      e.target.value = '';
    });
    $('btn-ed-save').onclick = saveEditorFile;
    $('btn-ed-run').onclick = runEditorCode;
    var edT = $('ed-text');
    edT.addEventListener('input', function () { edDirty = true; highlightEditor(); renderFileList(); });
    edT.addEventListener('scroll', syncEdScroll);
    // tab key inserts two spaces
    edT.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = edT.selectionStart;
        edT.value = edT.value.slice(0, s) + '  ' + edT.value.slice(edT.selectionEnd);
        edT.selectionStart = edT.selectionEnd = s + 2;
        edT.dispatchEvent(new Event('input'));
      }
    });

    /* ── spiking tab (embedded Python via Chaquopy) ── */
    var SPIKE_DEMO = [
      '# Nengo demo: 100 LIF neurons, 1-second simulation (seeded)',
      'import numpy as np',
      'import nengo',
      '',
      'np.random.seed(7)',
      'with nengo.Network(seed=7) as model:',
      '    stim = nengo.Node([0.5])',
      '    ens = nengo.Ensemble(n_neurons=100, dimensions=1)',
      '    nengo.Connection(stim, ens)',
      '    probe = nengo.Probe(ens.neurons)',
      '',
      'with nengo.Simulator(model) as sim:',
      '    sim.run(1.0)',
      '',
      'spikes = (sim.data[probe] > 0.5).sum(axis=0)',
      'print("neurons:", 100)',
      'print("sim time: 1.0s, dt:", sim.dt)',
      'print("total spikes:", int(spikes.sum()))',
      'print("mean spikes/neuron:", float(spikes.mean()))',
      'print("silent neurons:", int((spikes == 0).sum()))',
      'print("first 10 counts:", spikes[:10].tolist())',
    ].join('\n');
    /* ── v8 embedded pack: extra Python presets ── */
    var SPIKE_QUANT_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# TinyML demo: 8-bit integer (int8) quantization with NumPy",
      "#",
      "# Real microcontrollers (STM32, ESP32, RP2040) have kilobytes of",
      "# RAM and often no fast floating-point unit, so frameworks like",
      "# TensorFlow Lite for Microcontrollers (TFLite Micro) and Edge",
      "# Impulse store neural-net weights as signed 8-bit integers",
      "# (-128..127) instead of 32-bit floats. Each weight is stored as:",
      "#",
      "#     int8_value = round(float_value / scale)",
      "#     float_value ≈ int8_value * scale",
      "#",
      "# The single float \"scale\" is stored next to the integers, so a",
      "# whole layer can be rebuilt with integer math. This demo trains a",
      "# tiny XOR network, quantizes every weight to int8, then measures",
      "# how much accuracy and memory the conversion costs.",
      "# ─────────────────────────────────────────────────────────────────",
      "import numpy as np",
      "",
      "# fixed seed -> the same weights (and results) on every run",
      "np.random.seed(42)",
      "",
      "# ── 1. Train a tiny MLP on XOR: 2 inputs -> 8 hidden -> 1 out ──",
      "X = np.array([[0, 0], [0, 1], [1, 0], [1, 1]], dtype=np.float32)",
      "Y = np.array([[0], [1], [1], [0]], dtype=np.float32)",
      "",
      "W1 = np.random.randn(2, 8).astype(np.float32) * 0.8",
      "b1 = np.zeros(8, dtype=np.float32)",
      "W2 = np.random.randn(8, 1).astype(np.float32) * 0.8",
      "b2 = np.zeros(1, dtype=np.float32)",
      "",
      "",
      "def sigmoid(x):",
      "    return 1.0 / (1.0 + np.exp(-x))",
      "",
      "",
      "def forward(x, w1, b1_, w2, b2_):",
      "    h = np.tanh(x @ w1 + b1_)",
      "    return sigmoid(h @ w2 + b2_)",
      "",
      "",
      "lr = 0.5",
      "for epoch in range(3000):",
      "    h = np.tanh(X @ W1 + b1)",
      "    out = sigmoid(h @ W2 + b2)",
      "    d_out = (out - Y) * out * (1 - out)          # d loss/d pre-activation",
      "    d_h = (d_out @ W2.T) * (1 - h ** 2)          # backprop through tanh",
      "    W2 -= lr * (h.T @ d_out)",
      "    b2 -= lr * d_out.sum(axis=0)",
      "    W1 -= lr * (X.T @ d_h)",
      "    b1 -= lr * d_h.sum(axis=0)",
      "",
      "pred = forward(X, W1, b1, W2, b2)",
      "print(\"=== float32 network (trained on XOR) ===\")",
      "print(\"predictions:\", [round(float(v), 3) for v in pred.ravel()],",
      "      \" targets:\", [int(v) for v in Y.ravel()])",
      "",
      "# ── 2. Quantize: float32 [-1, 1] -> int8 [-128, 127] ───────────",
      "# One scale per weight tensor, chosen so the largest |weight|",
      "# fills the int8 range: scale = max|w| / 127.",
      "def quantize(w):",
      "    scale = np.max(np.abs(w)) / 127.0",
      "    q = np.round(w / scale).astype(np.int8)",
      "    return q, np.float32(scale)",
      "",
      "",
      "def dequantize(q, scale):",
      "    return q.astype(np.float32) * scale",
      "",
      "",
      "tensors = [(\"W1 (2x8)\", W1), (\"b1 (8)\", b1), (\"W2 (8x1)\", W2), (\"b2 (1)\", b2)]",
      "quantized, scales, flats = [], [], []",
      "print(\"\\n=== quantization: float32 -> int8 ===\")",
      "for name, w in tensors:",
      "    q, s = quantize(w)",
      "    quantized.append(q)",
      "    scales.append(s)",
      "    print(f\"{name}: scale={s:.6f}  first values float={w.ravel()[:4].tolist()}\")",
      "    print(f\"          int8={q.ravel()[:4].tolist()}\")",
      "",
      "qW1, qb1, qW2, qb2 = quantized",
      "sW1, sb1, sW2, sb2 = scales",
      "",
      "# ── 3. Error: how far is dequantized from the original? ────────",
      "all_float = np.concatenate([w.ravel() for _, w in tensors])",
      "all_deq = np.concatenate([dequantize(q, s).ravel()",
      "                          for q, s in zip(quantized, scales)])",
      "err = np.abs(all_float - all_deq)",
      "print(\"\\n=== round-trip error (dequantized vs original) ===\")",
      "print(f\"max  abs error: {err.max():.6f}\")",
      "print(f\"mean abs error: {err.mean():.6f}\")",
      "",
      "# ── 4. Does the quantized network still solve XOR? ─────────────",
      "pred_q = forward(X,",
      "                 dequantize(qW1, sW1), dequantize(qb1, sb1),",
      "                 dequantize(qW2, sW2), dequantize(qb2, sb2))",
      "print(\"\\nquantized predictions:\", [round(float(v), 3) for v in pred_q.ravel()])",
      "print(\"still solves XOR:\", bool(np.all((pred_q > 0.5) == (Y > 0.5))))",
      "",
      "# ── 5. Memory footprint: why microcontrollers care ─────────────",
      "n = all_float.size",
      "f32_bytes = n * 4                    # every float32 costs 4 bytes",
      "i8_bytes = n * 1 + len(tensors) * 4  # 1 byte/weight + one float scale per tensor",
      "print(\"\\n=== memory footprint ===\")",
      "print(f\"weights: {n}\")",
      "print(f\"float32: {f32_bytes} bytes\")",
      "print(f\"int8 (+4 scales): {i8_bytes} bytes  ({f32_bytes / i8_bytes:.1f}x smaller)\")",
      "print(\"\\nFor a big model the 4 scale floats vanish in the noise and the\")",
      "print(\"saving approaches a full 4x: 1 byte per weight instead of 4.\")",
      "print(\"On a chip with 64 KB of RAM that is the difference between a\")",
      "print(\"model that fits and one that never runs. TFLite Micro and Edge\")",
      "print(\"Impulse do exactly this: int8 weights, integer math, one scale\")",
      "print(\"per tensor, and integer-only inference on the microcontroller.\")",
    ].join('\n');
    var SPIKE_EVENT_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Neuromorphic demo: event-driven spike detection (Nengo)",
      "#",
      "# A normal sensor program POLLS: wake up 1000 times a second, read",
      "# the value, check it, go back to sleep. A neuromorphic chip does",
      "# the opposite — it sits silent and only fires spikes when the",
      "# input actually changes. That is exactly how a hardware interrupt",
      "# (ISR) works on a microcontroller: the CPU sleeps until a pin",
      "# changes, then a tiny handler runs.",
      "#",
      "# Here a population of LIF neurons watches a slow sensor signal.",
      "# Their firing thresholds (\"intercepts\") are set high, so the",
      "# whole population is SILENT while the signal is low and only",
      "# bursts when the signal crosses the threshold — spikes are",
      "# events, not samples. Intel Loihi, SynSense Xylo and BrainChip",
      "# Akida run on this principle at milliwatt power budgets.",
      "# ─────────────────────────────────────────────────────────────────",
      "import numpy as np",
      "import nengo",
      "",
      "THRESHOLD = 0.6      # sensor level that counts as an \"event\"",
      "SIM_TIME = 2.0       # seconds",
      "N_NEURONS = 60",
      "",
      "# ── the fake sensor: a slow 1 Hz sine + a little wiggle ────────",
      "# (deterministic pseudo-noise from two fast sines, so every run",
      "# sees the exact same signal — no random seed to babysit)",
      "def sensor(t):",
      "    return (np.sin(2 * np.pi * 1.0 * t)",
      "            + 0.04 * np.sin(2 * np.pi * 13.7 * t)",
      "            + 0.03 * np.sin(2 * np.pi * 29.3 * t + 1.3))",
      "",
      "with nengo.Network(seed=3) as model:",
      "    stim = nengo.Node(sensor)",
      "    # Threshold detector population: every neuron has a high",
      "    # intercept (0.55..0.90) and a +1 encoder, so a neuron only",
      "    # starts firing once the input climbs past ITS threshold —",
      "    # like 60 interrupt lines armed at slightly different levels.",
      "    detector = nengo.Ensemble(",
      "        n_neurons=N_NEURONS, dimensions=1,",
      "        neuron_type=nengo.LIF(),",
      "        intercepts=nengo.dists.Uniform(0.55, 0.90),",
      "        encoders=nengo.dists.Choice([[1.0]]),",
      "    )",
      "    nengo.Connection(stim, detector)",
      "    p_sig = nengo.Probe(stim)",
      "    p_spikes = nengo.Probe(detector.neurons)",
      "",
      "with nengo.Simulator(model, progress_bar=False) as sim:",
      "    sim.run(SIM_TIME)",
      "",
      "t = sim.trange()",
      "sig = sim.data[p_sig].ravel()",
      "spikes = sim.data[p_spikes] > 0.5          # (timesteps, neurons) bool",
      "active_steps = spikes.any(axis=1)           # any neuron fired this step?",
      "total_spikes = int(spikes.sum())",
      "",
      "# ground truth: how many times did the signal really cross up",
      "# through the threshold? (what the events SHOULD correspond to)",
      "crossings = int(np.sum((sig[:-1] < THRESHOLD) & (sig[1:] >= THRESHOLD)))",
      "# detected bursts: a fresh burst only counts after at least",
      "# 50 ms of silence (debounce — the same trick firmware uses to",
      "# clean up a bouncy push-button interrupt)",
      "gap = int(0.050 / sim.dt)",
      "bursts, quiet_run = 0, gap",
      "for a in active_steps:",
      "    if a and quiet_run >= gap:",
      "        bursts += 1",
      "    quiet_run = 0 if a else quiet_run + 1",
      "",
      "# what a polling program would have done over the same 2 seconds:",
      "poll_samples = len(t)                       # one read every timestep",
      "",
      "print(\"=== event-driven spike detection ===\")",
      "print(f\"signal: 1 Hz sine + wiggle, {SIM_TIME:.0f}s, sampled every {sim.dt*1000:.0f} ms\")",
      "print(f\"true threshold crossings (>{THRESHOLD}): {crossings}\")",
      "print(f\"detected spike bursts:                  {bursts}\")",
      "print(f\"total spikes from {N_NEURONS} neurons:        {total_spikes}\")",
      "print()",
      "print(\"=== the neuromorphic contrast ===\")",
      "print(f\"polling program: {poll_samples} sensor reads, CPU busy every step\")",
      "print(f\"spiking network: {int(active_steps.sum())} of {len(t)} steps had ANY spike \"",
      "      f\"({100.0 * active_steps.mean():.0f}% active, {100.0 * (1 - active_steps.mean()):.0f}% silent)\")",
      "print()",
      "print(\"While silent, a neuromorphic chip burns almost no power —\")",
      "print(\"just like a microcontroller sleeping until an interrupt\")",
      "print(\"fires. Spikes ARE the interrupts: nothing happens until\")",
      "print(\"something changes.\")",
    ].join('\n');
    /* ── v11: FreeRTOS-style cooperative scheduler preset (pure Python) ── */
    var SPIKE_SCHED_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# FreeRTOS-style demo: a cooperative multitasking scheduler",
      "#",
      "# Real firmware rarely runs one lonely loop. A sensor must be read",
      "# every 10 ms, a neural net must crunch the readings, and a radio or",
      "# UART must report results — all \"at the same time\" on one little",
      "# CPU. Operating systems for microcontrollers (FreeRTOS is the",
      "# famous one) solve this with TASKS: little programs that take turns",
      "# on the CPU.",
      "#",
      "# This demo builds the tiniest possible version of that idea in pure",
      "# Python. Each task is a GENERATOR function. When a task wants to",
      "# wait, it yields a number of milliseconds:",
      "#",
      "#     yield 10      # \"wake me up again in 10 ms\"",
      "#     yield         # a bare yield: \"I give up the CPU right now,",
      "#                   #  run me again next tick (1 ms later)\"",
      "#",
      "# That `yield` IS the task politely handing the CPU to the next",
      "# task. Because a task only ever runs when the scheduler resumes it,",
      "# two tasks can never interrupt each other halfway through a line of",
      "# code — which is why cooperative scheduling has no race conditions",
      "# on shared data. (Preemptive scheduling, like real FreeRTOS, can",
      "# yank the CPU away at ANY moment; more powerful, but then shared",
      "# data needs locks. Here we trade that power for simplicity.)",
      "#",
      "# Time here is a VIRTUAL clock in whole milliseconds. There is no",
      "# time.sleep() and no wall clock: the scheduler jumps straight to",
      "# the next wake-up, so 500 ms of firmware time finishes in a blink,",
      "# and the output is identical on every run.",
      "#",
      "# The cast:",
      "#   sensor_task     wakes every 10 ms, pushes a sample into a queue",
      "#   inference_task  pops windows of 8 samples, runs a tiny forward-",
      "#                   pass neural net on them, classifies the signal",
      "#   telemetry_task  every 200 ms, frames the latest result into a",
      "#                   UART packet (header + length + payload + XOR",
      "#                   checksum) and checks it like a receiver would",
      "#",
      "# Tasks talk to each other through the QUEUE (a collections.deque).",
      "# That is the safe pattern: producers push, consumers pop, and nobody",
      "# pokes at anybody else's variables.",
      "# ─────────────────────────────────────────────────────────────────",
      "import math",
      "import random",
      "from collections import deque",
      "",
      "DURATION_MS = 500     # how long the firmware \"runs\", in virtual ms",
      "WINDOW = 8            # samples per inference window",
      "",
      "# fixed seed -> the same sensor wiggle (and results) on every run",
      "rng = random.Random(7)",
      "",
      "# ── shared state ──────────────────────────────────────────────────",
      "# The queue is how the tasks communicate: sensor_task produces,",
      "# inference_task consumes. Fixed maximum size, like a real firmware",
      "# buffer — if it ever filled up, the oldest samples would be the",
      "# ones to drop (deque with maxlen does exactly that).",
      "sample_queue = deque(maxlen=64)",
      "",
      "stats = {",
      "    \"produced\": 0,          # samples the sensor made",
      "    \"consumed\": 0,          # samples the inference task ate",
      "    \"inferences\": 0,        # forward passes completed",
      "    \"calm\": 0,              # windows classified \"calm\"",
      "    \"active\": 0,            # windows classified \"active\"",
      "    \"packets\": 0,           # UART packets transmitted",
      "    \"packets_ok\": 0,        # packets whose checksum validated",
      "}",
      "latest = {\"verdict\": \"calm\", \"score\": 0.0}   # newest inference result",
      "",
      "",
      "# ── the simulated sensor ─────────────────────────────────────────",
      "def sensor_value(n):",
      "    \"\"\"Fake sensor reading for sample #n (one sample = 10 ms).",
      "",
      "    A slow sine wave (the \"real\" signal) + a faster wiggle + a pinch",
      "    of seeded noise, so the windows below sometimes look calm and",
      "    sometimes busy — like a motion sensor watching someone fidget.",
      "    \"\"\"",
      "    t = n * 10  # ms",
      "    v = (0.5",
      "         + 0.35 * math.sin(t / 90.0)",
      "         + 0.08 * math.sin(t / 17.0)",
      "         + rng.uniform(-0.03, 0.03))",
      "    return round(v, 3)",
      "",
      "",
      "# ── the tiny neural net (plain Python, no libraries) ─────────────",
      "# A 3 -> 4 -> 1 forward pass: three features describe each window,",
      "# four tanh \"hidden units\" mix them, one sigmoid output scores how",
      "# ACTIVE the window looks (near 1) versus CALM (near 0). The weights",
      "# are fixed constants here — in the Train tab you TRAIN weights like",
      "# these with backprop; on a microcontroller you would ship the",
      "# trained numbers exactly like this and just run the forward pass.",
      "W1 = [                    # hidden weights, one row per feature",
      "    [1.4, 0.3, 0.2, -1.2],   # feature 0: mean level",
      "    [0.2, 1.5, -0.4, 0.1],   # feature 1: range (max - min)",
      "    [0.3, -0.2, 1.2, -0.3],  # feature 2: slope (last - first)",
      "]",
      "B1 = [0.0, -0.6, 0.0, 0.2]          # hidden biases",
      "W2 = [1.5, 1.1, 0.6, -1.5]          # output weights",
      "B2 = -0.55                          # output bias",
      "",
      "",
      "def tanh(x):",
      "    return math.tanh(x)",
      "",
      "",
      "def sigmoid(x):",
      "    return 1.0 / (1.0 + math.exp(-x))",
      "",
      "",
      "def window_features(window):",
      "    \"\"\"Summarize a window of samples as three numbers the net sees.\"\"\"",
      "    mean = sum(window) / len(window)",
      "    rng_range = max(window) - min(window)",
      "    slope = window[-1] - window[0]",
      "    feats = [(mean - 0.5) * 2.0, rng_range * 2.0, slope * 2.0]",
      "    return feats, mean, rng_range, slope",
      "",
      "",
      "def hidden_units(feats, lo, hi, hidden_out):",
      "    \"\"\"Fill hidden_out[lo:hi] — inference runs this in two halves,",
      "    yielding the CPU in between (see inference_task).\"\"\"",
      "    for j in range(lo, hi):",
      "        s = B1[j]",
      "        for i in range(3):",
      "            s += feats[i] * W1[i][j]",
      "        hidden_out[j] = tanh(s)",
      "",
      "",
      "def output_score(hidden):",
      "    out = B2",
      "    for j in range(4):",
      "        out += hidden[j] * W2[j]",
      "    return sigmoid(out)",
      "",
      "",
      "# ── task 1: the sensor ───────────────────────────────────────────",
      "def sensor_task():",
      "    \"\"\"Produce one sample every 10 ms, forever.",
      "",
      "    Highest priority in the scheduler below: a missed sensor reading",
      "    is data lost forever, so this task always wins ties.",
      "    \"\"\"",
      "    n = 0",
      "    while True:",
      "        v = sensor_value(n)",
      "        sample_queue.append(v)",
      "        stats[\"produced\"] += 1",
      "        print(\"  sensor: sample #%d (t=%dms) value=%.3f -> queue (%d buffered)\"",
      "              % (n, n * 10, v, len(sample_queue)))",
      "        n += 1",
      "        yield 10  # sleep until the next sample is due",
      "",
      "",
      "# ── task 2: inference ────────────────────────────────────────────",
      "def inference_task():",
      "    \"\"\"Classify the newest window of samples with the tiny net.",
      "",
      "    Wakes up, checks the queue; if a full window is waiting it pops",
      "    the 8 oldest samples and runs the forward pass. The pass is done",
      "    in TWO HALVES with a bare yield between them: the classic",
      "    cooperative trick for long jobs — chop the work up so a high-",
      "    priority task (the sensor) is never kept waiting.",
      "    \"\"\"",
      "    hidden = [0.0] * 4",
      "    while True:",
      "        if len(sample_queue) < WINDOW:",
      "            yield 30  # not enough data yet — check again in 30 ms",
      "            continue",
      "        window = [sample_queue.popleft() for _ in range(WINDOW)]",
      "        stats[\"consumed\"] += WINDOW",
      "        feats, mean, rng_range, slope = window_features(window)",
      "        hidden_units(feats, 0, 2, hidden)   # first half of the math...",
      "        yield  # ...bare yield: hand the CPU back mid-computation, so",
      "        # the 10 ms sensor task is never kept waiting by our crunching",
      "        hidden_units(feats, 2, 4, hidden)   # second half, after resume",
      "        score = output_score(hidden)",
      "        verdict = \"active\" if score >= 0.5 else \"calm\"",
      "        stats[\"inferences\"] += 1",
      "        stats[verdict] += 1",
      "        latest[\"verdict\"] = verdict",
      "        latest[\"score\"] = score",
      "        print(\"  inference: window mean=%.3f range=%.3f slope=%+.3f\"",
      "              % (mean, rng_range, slope))",
      "        print(\"  inference: forward pass -> score %.3f => %s (inference #%d)\"",
      "              % (score, verdict.upper(), stats[\"inferences\"]))",
      "        yield 50  # think again in 50 ms",
      "",
      "",
      "# ── task 3: telemetry ────────────────────────────────────────────",
      "def telemetry_task():",
      "    \"\"\"Frame the latest result into a UART packet every 200 ms.",
      "",
      "    Packet layout (exactly like the UART work in the Editor tab):",
      "        [0xAA] [LEN] [payload...] [CHECKSUM]",
      "    CHECKSUM is the XOR of every byte before it. A receiver can",
      "    validate the whole packet by XOR-ing ALL of its bytes, checksum",
      "    included: an intact packet always XORs to 0x00.",
      "    \"\"\"",
      "    while True:",
      "        yield 200  # first packet goes out at t=200 ms",
      "        payload = [",
      "            1 if latest[\"verdict\"] == \"active\" else 0,  # verdict code",
      "            stats[\"inferences\"],                        # inferences completed so far",
      "            stats[\"produced\"] & 0xFF,                   # sample counter (low byte)",
      "            len(sample_queue),                          # samples still buffered",
      "        ]",
      "        packet = [0xAA, len(payload)] + payload",
      "        cks = 0",
      "        for b in packet:",
      "            cks ^= b",
      "        packet.append(cks)",
      "        stats[\"packets\"] += 1",
      "        hexs = \" \".join(\"%02X\" % b for b in packet)",
      "        print(\"  telemetry: UART TX -> %s\" % hexs)",
      "        # ...and the receiving side checks its work:",
      "        check = 0",
      "        for b in packet:",
      "            check ^= b",
      "        if check == 0:",
      "            stats[\"packets_ok\"] += 1",
      "            print(\"  telemetry: receiver XOR check = 0x00 -> checksum OK \"",
      "                  \"(verdict=%s, score=%.3f)\" % (latest[\"verdict\"], latest[\"score\"]))",
      "        else:",
      "            print(\"  telemetry: receiver XOR check = 0x%02X -> CORRUPT PACKET\" % check)",
      "",
      "",
      "# ── the scheduler ────────────────────────────────────────────────",
      "# Priorities: LOWER number = HIGHER priority (same convention as the",
      "# NVIC interrupt controller in the peripheral-vm preset). When two",
      "# tasks are ready at the same millisecond, the higher priority runs",
      "# first; if priorities tie (not needed here, but built in), the task",
      "# that ran least recently goes next — round-robin, so nobody starves.",
      "PRIORITIES = {\"sensor_task\": 1, \"inference_task\": 2, \"telemetry_task\": 3}",
      "",
      "",
      "class Task:",
      "    def __init__(self, name, gen):",
      "        self.name = name",
      "        self.gen = gen",
      "        self.prio = PRIORITIES[name]",
      "        self.wake = 0        # next virtual ms this task wants the CPU",
      "        self.runs = 0        # how many times it has been resumed",
      "        self.last_run = -1   # scheduler sequence number of its last run",
      "",
      "",
      "class Scheduler:",
      "    def __init__(self):",
      "        self.now = 0",
      "        self.tasks = []",
      "        self.switches = 0    # total context switches",
      "        self._seq = 0",
      "",
      "    def add(self, name, gen):",
      "        self.tasks.append(Task(name, gen))",
      "",
      "    def run(self, duration_ms):",
      "        while True:",
      "            ready = [t for t in self.tasks if t.wake <= self.now]",
      "            if not ready:",
      "                nxt = min(t.wake for t in self.tasks)",
      "                if nxt > duration_ms:",
      "                    print(\"[scheduler] virtual clock reached %d ms - stopping \"",
      "                          \"(next wake would be t=%d ms)\" % (self.now, nxt))",
      "                    return",
      "                self.now = nxt  # CPU \"sleeps\" straight to the next event",
      "                continue",
      "            # highest priority first, then least-recently-run",
      "            ready.sort(key=lambda t: (t.prio, t.last_run))",
      "            task = ready[0]",
      "            self.switches += 1",
      "            task.runs += 1",
      "            task.last_run = self._seq",
      "            self._seq += 1",
      "            print(\"[t=%4dms] \\u25b6 %s runs (#%d)\" % (self.now, task.name, task.runs))",
      "            try:",
      "                req = next(task.gen)",
      "            except StopIteration:",
      "                print(\"[t=%4dms] \\u25a0 %s finished\" % (self.now, task.name))",
      "                task.wake = float(\"inf\")",
      "                continue",
      "            if req is None:",
      "                task.wake = self.now + 1",
      "                print(\"[t=%4dms] \\u23f8 %s yields the CPU (bare yield) -> \"",
      "                      \"runs again next tick (t=%d ms)\" % (self.now, task.name, task.wake))",
      "            else:",
      "                task.wake = self.now + max(1, int(req))",
      "                print(\"[t=%4dms] \\u23f8 %s sleeps %s ms -> next wake t=%d ms\"",
      "                      % (self.now, task.name, req, task.wake))",
      "",
      "",
      "# ── main: build the firmware and switch it on ────────────────────",
      "print(\"=== cooperative scheduler demo (FreeRTOS-style) ===\")",
      "print(\"virtual clock, %d ms run - no wall-clock time passes\" % DURATION_MS)",
      "print(\"priorities: sensor(1) > inference(2) > telemetry(3), lower wins\")",
      "print()",
      "",
      "sched = Scheduler()",
      "sched.add(\"sensor_task\", sensor_task())",
      "sched.add(\"inference_task\", inference_task())",
      "sched.add(\"telemetry_task\", telemetry_task())",
      "sched.run(DURATION_MS)",
      "",
      "by_name = {t.name: t for t in sched.tasks}",
      "print()",
      "print(\"=== summary ===\")",
      "print(\"virtual time run:      %d ms (in a blink of real time)\" % DURATION_MS)",
      "print(\"context switches:      %d\" % sched.switches)",
      "for name in (\"sensor_task\", \"inference_task\", \"telemetry_task\"):",
      "    print(\"  %-15s ran %3d times\" % (name, by_name[name].runs))",
      "print(\"samples produced:      %d\" % stats[\"produced\"])",
      "print(\"samples consumed:      %d (%d still buffered)\"",
      "      % (stats[\"consumed\"], len(sample_queue)))",
      "print(\"inferences:            %d  (calm %d, active %d)\"",
      "      % (stats[\"inferences\"], stats[\"calm\"], stats[\"active\"]))",
      "print(\"UART packets sent:     %d, checksums OK: %d\"",
      "      % (stats[\"packets\"], stats[\"packets_ok\"]))",
      "print()",
      "print(\"Deterministic by construction: virtual clock + fixed seed,\")",
      "print(\"so this output is byte-for-byte identical on every run.\")",
      "print(\"Three tasks shared one CPU with zero locks - each only ever\")",
      "print(\"ran when the scheduler handed it the CPU, so the queue was\")",
      "print(\"never touched by two tasks at once. Real FreeRTOS adds\")",
      "print(\"preemption (any task can be interrupted mid-line), real\")",
      "print(\"hardware timers and interrupt-driven wakeups; the shape -\")",
      "print(\"tasks, priorities, queues, yields - is exactly this.\")",
    ].join('\n');
    /* ── v12: closed-loop edge control: DVS -> LIF -> PWM/UART (pure Python) ── */
    var SPIKE_DVSLOOP_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Closed-loop edge control: DVS -> LIF -> PWM/UART",
      "#",
      "# A silicon-retina (DVS) event camera does NOT take frames. Each pixel",
      "# watches its own brightness and only shouts when that brightness",
      "# CHANGES - asynchronously, one (time, pixel, polarity) event at a",
      "# time. ON = got brighter, OFF = got darker.",
      "#",
      "# Pipeline in this demo (all on a virtual millisecond clock, seeded,",
      "# no wall-clock time passes):",
      "#",
      "#   moving edge -> 16-pixel event stream -> LIF neurons ->",
      "#   firing rate -> PWM duty cycle -> UART packet on threshold",
      "#",
      "# The three bridge ideas:",
      "#   1. A DVS event is the sensor world's interrupt - see peripheral-vm.js,",
      "#      where interrupts wake the CPU only when something changes.",
      "#   2. PWM duty cycle is rate coding made physical: more spikes = more on-time.",
      "#   3. The deadline budget is the RTOS part - the v11 scheduler's world:",
      "#      if the control loop can't finish its work in time, something gets",
      "#      deferred (counted), not silently skipped.",
      "# ─────────────────────────────────────────────────────────────────",
      "",
      "import random",
      "",
      "# ── knobs ────────────────────────────────────────────────────────",
      "N_PIXELS   = 16      # 1D silicon retina",
      "DURATION   = 1000    # virtual ms",
      "THRESH     = 0.35    # brightness change that fires one event",
      "WIN_MS     = 50      # control window (50 ms -> 20 windows)",
      "DUTY_PER_SPIKE = 15  # rate -> duty mapping: 15 % per spike per window",
      "TRIG_DUTY  = 30      # UART trigger: duty >= this ... (2 spikes/window)",
      "TRIG_WINS  = 2       # ... for this many consecutive windows",
      "SEED       = 7",
      "",
      "# deadline budget: abstract \"cycles\" per control window",
      "CYC_EVENT  = 3       # reading one event off the \"bus\"",
      "CYC_SPIKE  = 5       # updating neuron state on a spike",
      "CYC_PWM    = 25      # PWM duty update + narration",
      "CYC_PACKET = 35      # framing + \"transmitting\" a UART packet",
      "BUDGET     = 120     # cycles available per window",
      "MAX_DEFER  = 256     # deferred-event queue cap",
      "",
      "rng = random.Random(SEED)",
      "",
      "print(\"=== closed-loop edge control: DVS -> LIF -> PWM/UART ===\")",
      "print(\"virtual clock, %d ms run - no wall-clock time passes\" % DURATION)",
      "print()",
      "",
      "# ── 1. synthetic event frontend ──────────────────────────────────",
      "# Stimulus: a bright edge sweeping back and forth across the array",
      "# (triangle wave), plus a whisper of seeded sensor noise.",
      "def edge_pos(t):",
      "    phase = (t % 400) / 400.0",
      "    sweep = phase * 2 if phase < 0.5 else 2 - phase * 2",
      "    return sweep * (N_PIXELS - 1)",
      "",
      "def brightness(px, t):",
      "    p = edge_pos(t)",
      "    # smooth edge: pixels behind the edge are bright, ahead are dark",
      "    d = (p - px) / 1.5",
      "    d = 0.0 if d < 0.0 else (1.0 if d > 1.0 else d)",
      "    return 0.15 + 0.85 * d + rng.uniform(-0.02, 0.02)",
      "",
      "ref = [brightness(px, 0) for px in range(N_PIXELS)]  # per-pixel reference",
      "events = []  # (t, pixel, polarity)  polarity: +1 = ON, -1 = OFF",
      "",
      "def flash(t):",
      "    # two deterministic \"glare flickers\" - the whole array jumps bright",
      "    # for one ms, then falls back: every pixel shouts ON, then OFF.",
      "    # (v13's plasticity will have opinions about these.)",
      "    if t in (400, 700):",
      "        return 0.6",
      "    if t in (401, 701):",
      "        return -0.6",
      "    return 0.0",
      "",
      "for t in range(DURATION):",
      "    f = flash(t)",
      "    for px in range(N_PIXELS):",
      "        b = brightness(px, t) + f",
      "        if b - ref[px] >= THRESH:",
      "            events.append((t, px, 1))",
      "            ref[px] = b",
      "        elif ref[px] - b >= THRESH:",
      "            events.append((t, px, -1))",
      "            ref[px] = b",
      "",
      "n_on  = sum(1 for e in events if e[2] == 1)",
      "n_off = len(events) - n_on",
      "print(\"--- sensor frontend: 1D DVS event stream ---\")",
      "print(\"pixels: %d, threshold: %.2f, stimulus: edge sweeping back and forth\" % (N_PIXELS, THRESH))",
      "print(\"events: %d  (ON +%d / OFF -%d)\" % (len(events), n_on, n_off))",
      "print(\"a polled 16-px camera at 1 kHz would have sent %d samples in this run.\" % (N_PIXELS * DURATION))",
      "print(\"the event stream sent %d.  Sparsity is the whole point of DVS.\" % len(events))",
      "print()",
      "",
      "# one ASCII raster: 70 ms window, 1 char per ms",
      "R0, R1 = 465, 535",
      "print(\"--- event raster, t=%d..%d ms (rows = pixels 15..0) ---\" % (R0, R1 - 1))",
      "by_t = {}",
      "for (t, px, pol) in events:",
      "    if R0 <= t < R1:",
      "        by_t.setdefault(t, []).append((px, pol))",
      "hdr = \"     \" + \"\".join(str((t // 10) % 10) for t in range(R0, R1))",
      "print(hdr + \"  <- 10 ms ticks\")",
      "for px in range(N_PIXELS - 1, -1, -1):",
      "    row = \"px%2d \" % px",
      "    for t in range(R0, R1):",
      "        hits = [pol for (ppx, pol) in by_t.get(t, []) if ppx == px]",
      "        if not hits:",
      "            row += \".\"",
      "        elif 1 in hits:",
      "            row += \"+\"",
      "        else:",
      "            row += \"-\"",
      "    print(row)",
      "print(\"     + = ON event (brighter)   - = OFF event (darker)   . = silent\")",
      "print()",
      "",
      "# ── 2. LIF detector, ingested through the control budget ──────────",
      "# Four neurons, each owning a quarter of the array. ON events inside",
      "# its zone excite strongly (+0.30), OFF events inhibit (-0.15);",
      "# events elsewhere barely register. Membrane leaks 1.5 % per ms.",
      "#",
      "# The control loop ingests events one window at a time and the LIF",
      "# runs INSIDE that ingestion - so when the deadline budget defers",
      "# events, the spikes they would have caused genuinely arrive late.",
      "# That latency is what a deadline miss costs you.",
      "N_NEUR   = 4",
      "ZONE     = N_PIXELS // N_NEUR",
      "V_THRESH = 1.0",
      "LEAK     = 0.985",
      "",
      "def zone_of(px):",
      "    return min(px // ZONE, N_NEUR - 1)",
      "",
      "v = [0.0] * N_NEUR",
      "spikes = []            # (t, neuron), in detection order",
      "duty_vals = []",
      "packets = 0",
      "packets_ok = 0",
      "misses = 0",
      "deferred_total = 0",
      "dropped_total = 0",
      "defer_queue = []       # events the budget could not afford this window",
      "consec_high = 0",
      "armed = True",
      "",
      "print(\"--- LIF detector: %d neurons, zones of %d pixels ---\" % (N_NEUR, ZONE))",
      "print(\"the detector runs inside the control window, not ahead of it:\")",
      "print(\"deferred events really do arrive late. watch the duty readout.\")",
      "print()",
      "",
      "# ── 3. closed-loop control with a deadline budget ─────────────────",
      "# Per 50 ms window: ingest this window's events (+ any deferred backlog),",
      "# run the LIF on them, count spikes -> firing rate -> PWM duty.",
      "# If duty >= 60 % for 2 consecutive windows, send a UART packet",
      "# [0xAA][LEN][payload][XOR checksum], validated receiver-side.",
      "# Budget policy: the PWM update is always affordable; events beyond the",
      "# budget roll to the next window (counted); a full defer queue drops",
      "# the oldest (counted). A miss costs latency, not correctness.",
      "",
      "print(\"--- closed-loop control: rate -> PWM duty ---\")",
      "print(\"PWM: rate x %d%%/spike | UART triggers at >=%d%% for %d windows\"",
      "      % (DUTY_PER_SPIKE, TRIG_DUTY, TRIG_WINS))",
      "print(\"budget: %d cycles/window (%d/event, %d/spike, %d PWM, %d packet)\"",
      "      % (BUDGET, CYC_EVENT, CYC_SPIKE, CYC_PWM, CYC_PACKET))",
      "",
      "ev_by_t = {}",
      "for e in events:",
      "    ev_by_t.setdefault(e[0], []).append((e[1], e[2]))",
      "",
      "for w in range(DURATION // WIN_MS):",
      "    t0, t1 = w * WIN_MS, (w + 1) * WIN_MS",
      "",
      "    # ingest: deferred backlog first (they arrive at this window's start),",
      "    # then this window's events - earliest first, deterministic",
      "    ingest = list(defer_queue)",
      "    for t in range(t0, t1):",
      "        for (px, pol) in ev_by_t.get(t, []):",
      "            ingest.append((t, px, pol))",
      "    ingest.sort()",
      "    defer_queue = []",
      "",
      "    # budget: PWM update always fits; events are what get deferred",
      "    allowed = (BUDGET - CYC_PWM) // CYC_EVENT",
      "    keep, late = ingest[:allowed], ingest[allowed:]",
      "    if late:",
      "        misses += 1",
      "        defer_queue = late[:MAX_DEFER]",
      "        dropped_total += max(0, len(late) - MAX_DEFER)",
      "        deferred_total += len(defer_queue)",
      "",
      "    # run the LIF over this window's kept events (ms order)",
      "    kept_by_t = {}",
      "    for (t, px, pol) in keep:",
      "        kept_by_t.setdefault(max(t, t0), []).append((px, pol))",
      "    n_sp = 0",
      "    for t in range(t0, t1):",
      "        for k in range(N_NEUR):",
      "            v[k] *= LEAK",
      "        for (px, pol) in kept_by_t.get(t, []):",
      "            zk = zone_of(px)",
      "            for k in range(N_NEUR):",
      "                if k == zk:",
      "                    v[k] += 0.30 if pol == 1 else -0.15",
      "                else:",
      "                    v[k] += 0.05 if pol == 1 else -0.05",
      "        for k in range(N_NEUR):",
      "            if v[k] >= V_THRESH:",
      "                spikes.append((t, k))",
      "                n_sp += 1",
      "                v[k] = 0.0",
      "",
      "    duty = min(100, n_sp * DUTY_PER_SPIKE)",
      "    duty_vals.append(duty)",
      "",
      "    # UART trigger with arming logic (fire once, re-arm below 50 %)",
      "    pkt = None",
      "    if duty >= TRIG_DUTY:",
      "        consec_high += 1",
      "    else:",
      "        consec_high = 0",
      "        if duty < 50:",
      "            armed = True",
      "    if consec_high >= TRIG_WINS and armed:",
      "        payload = bytes([w, duty, n_sp])",
      "        pkt = bytes([0xAA, len(payload)]) + payload",
      "        pkt += bytes([pkt[0] ^ pkt[1] ^ pkt[2] ^ pkt[3] ^ pkt[4]])",
      "        packets += 1",
      "        # receiver-side validation: XOR of everything must be 0x00",
      "        chk = 0",
      "        for b in pkt:",
      "            chk ^= b",
      "        if chk == 0:",
      "            packets_ok += 1",
      "        consec_high = 0",
      "        armed = False",
      "",
      "    work = \"%d ingested, %d deferred\" % (len(keep), len(late))",
      "    bar = \"#\" * (duty // 10) + \"-\" * (10 - duty // 10)",
      "    miss = \"  <-- DEADLINE MISS (%s late)\" % len(late) if late else \"\"",
      "    print(\"t=%3d..%-3dms  spikes=%2d  duty=%3d%%  [%s]%s\"",
      "          % (t0, t1 - 1, n_sp, duty, bar, miss))",
      "    if pkt is not None:",
      "        print(\"   UART TX: %s  checksum OK (receiver XOR = 0x00)\"",
      "              % \" \".join(\"0x%02X\" % b for b in pkt))",
      "",
      "print()",
      "print(\"=== summary ===\")",
      "print(\"virtual time run:         %d ms\" % DURATION)",
      "print(\"events:                   %d  (ON +%d / OFF -%d)\" % (len(events), n_on, n_off))",
      "print(\"vs polled frame sensor:   %d samples would have been sent\" % (N_PIXELS * DURATION))",
      "print(\"spikes (LIF population):  %d\" % len(spikes))",
      "print(\"duty cycle:               min %d%%  max %d%%  mean %.1f%%\"",
      "      % (min(duty_vals), max(duty_vals), sum(duty_vals) / len(duty_vals)))",
      "print(\"UART packets sent:        %d, checksums OK: %d\" % (packets, packets_ok))",
      "print(\"deadline misses:          %d\" % misses)",
      "print(\"events deferred:          %d\" % deferred_total)",
      "print(\"events dropped:           %d\" % dropped_total)",
      "print()",
      "print(\"The bridge, in three lines:\")",
      "print(\"- a DVS event is the sensor's interrupt: nothing moves, nothing fires\")",
      "print(\"  (same idea as peripheral-vm.js - and v10 plots spikes next to IRQs).\")",
      "print(\"- PWM duty is rate coding made physical: spike rate becomes on-time.\")",
      "print(\"- the deadline budget is the RTOS part: late work is deferred and\")",
      "print(\"  counted, never silently skipped - the v11 scheduler's world.\")",
    ].join('\n');
    /* ── v13: online plasticity: STDP on the edge detector (pure Python) ── */
    var SPIKE_STDP_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Online plasticity: STDP on the edge detector",
      "#",
      "# v12's detector had frozen, hand-wired weights: each of the 4 neurons",
      "# \"cared about\" one quarter of the retina because we TOLD it to.",
      "# Real neuromorphic chips can't be hand-wired like that - they have to",
      "# CALIBRATE themselves from the event stream. This demo lets the",
      "# detector learn, in three acts, on the identical sweeping edge:",
      "#",
      "#   Act 1: fixed weights (v12's rule), fixed threshold - baseline.",
      "#   Act 2: STDP on for 3000 ms - synapses rewire themselves live.",
      "#   Act 3: weights frozen again - same sweep, same everything,",
      "#          EXCEPT the weights Act 2 learned. Only the synapses differ.",
      "#",
      "# STDP (spike-timing-dependent plasticity): if a pixel's event arrives",
      "# just BEFORE its neuron spikes, that synapse did useful work ->",
      "# strengthen it (potentiation). If the event arrives just AFTER the",
      "# spike, it was too late to matter -> weaken it (depression). The",
      "# closer the timing, the bigger the change: an exponential window.",
      "#",
      "# Homeostasis (\"don't let one neuron hog everything\"): every spike",
      "# temporarily raises that neuron's own threshold, which then decays",
      "# back. Potentiation can't run away, because firing gets harder.",
      "#",
      "# Same 16-pixel retina, same 0.35 event threshold, same seeded edge",
      "# (fresh Random(7) per act -> every act sees the identical sweep),",
      "# same glare flickers at t=400/700 that v12 warned us about.",
      "# ─────────────────────────────────────────────────────────────────",
      "",
      "import math",
      "import random",
      "",
      "# ── shared world (identical to v12) ──────────────────────────────",
      "N_PIXELS = 16",
      "THRESH   = 0.35      # brightness change that fires one event",
      "N_NEUR   = 4",
      "ZONE     = N_PIXELS // N_NEUR",
      "LEAK     = 0.985     # membrane leak per ms",
      "BASE_TH  = 1.0       # resting spike threshold",
      "",
      "def edge_pos(t):",
      "    phase = (t % 400) / 400.0",
      "    sweep = phase * 2 if phase < 0.5 else 2 - phase * 2",
      "    return sweep * (N_PIXELS - 1)",
      "",
      "def zone_of(px):",
      "    return min(px // ZONE, N_NEUR - 1)",
      "",
      "def gen_events(duration):",
      "    \"\"\"Identical stimulus generator to v12: fresh Random(7), so every",
      "    act sees the identical sweep, noise and glare flickers.\"\"\"",
      "    rng = random.Random(7)",
      "",
      "    def brightness(px, t):",
      "        p = edge_pos(t)",
      "        d = (p - px) / 1.5",
      "        d = 0.0 if d < 0.0 else (1.0 if d > 1.0 else d)",
      "        return 0.15 + 0.85 * d + rng.uniform(-0.02, 0.02)",
      "",
      "    def flash(t):",
      "        if t in (400, 700):",
      "            return 0.6",
      "        if t in (401, 701):",
      "            return -0.6",
      "        return 0.0",
      "",
      "    ref = [brightness(px, 0) for px in range(N_PIXELS)]",
      "    events = []",
      "    for t in range(duration):",
      "        f = flash(t)",
      "        for px in range(N_PIXELS):",
      "            b = brightness(px, t) + f",
      "            if b - ref[px] >= THRESH:",
      "                events.append((t, px, 1))",
      "                ref[px] = b",
      "            elif ref[px] - b >= THRESH:",
      "                events.append((t, px, -1))",
      "                ref[px] = b",
      "    return events",
      "",
      "# ── weights ──────────────────────────────────────────────────────",
      "# W[px][k] = strength of the ON-event synapse from pixel px to",
      "# neuron k. Starts as v12's hand-wired rule: own zone 0.30, cross",
      "# zone 0.05. OFF inhibition stays fixed forever (own -0.15,",
      "# cross -0.05) - only the excitatory ON synapses are plastic.",
      "W_OWN, W_CROSS = 0.30, 0.05",
      "OFF_OWN, OFF_CROSS = -0.15, -0.05",
      "",
      "def fresh_weights():",
      "    return [[W_OWN if zone_of(px) == k else W_CROSS",
      "             for k in range(N_NEUR)] for px in range(N_PIXELS)]",
      "",
      "# ── STDP rule (Act 2) ────────────────────────────────────────────",
      "# Pair-based, nearest neighbour, +/-40 ms window:",
      "#   pre before post (event -> spike):  dw = +A+ * exp(-dt / tau)",
      "#   post before pre (spike -> event):  dw = -A- * exp(-dt / tau)",
      "# A- is 2.5x A+ (depression bias): stray coincidences net-LOSE, so",
      "# only synapses that repeatedly predict spikes survive - the rest",
      "# get pruned. That pruning is where the selectivity comes from.",
      "A_PLUS    = 0.012",
      "A_MINUS   = 0.030",
      "TAU       = 20.0     # ms",
      "WINDOW    = 40       # ms",
      "W_MIN, W_MAX = 0.0, 0.60",
      "",
      "# homeostasis: threshold jump per spike, exponential decay back",
      "TH_JUMP  = 0.30",
      "TH_DECAY = 0.97      # per ms, excess over BASE_TH decays by this",
      "",
      "def clamp_w(w):",
      "    return W_MIN if w < W_MIN else (W_MAX if w > W_MAX else w)",
      "",
      "# ── one act = one run of the detector ────────────────────────────",
      "def run_act(events, duration, W, learn, adaptive):",
      "    ev_by_t = {}",
      "    for (t, px, pol) in events:",
      "        ev_by_t.setdefault(t, []).append((px, pol))",
      "",
      "    v  = [0.0] * N_NEUR",
      "    th = [BASE_TH] * N_NEUR",
      "    last_on    = [None] * N_PIXELS   # last ON event per pixel (pre)",
      "    last_spike = [None] * N_NEUR     # last spike per neuron (post)",
      "    spikes = []                      # (t, neuron)",
      "    mid_snapshot = None",
      "    th_sum = 0.0",
      "    th_peak = BASE_TH",
      "",
      "    for t in range(duration):",
      "        for k in range(N_NEUR):",
      "            v[k] *= LEAK",
      "            if adaptive:",
      "                th[k] = BASE_TH + (th[k] - BASE_TH) * TH_DECAY",
      "                th_sum += th[k]",
      "                if th[k] > th_peak:",
      "                    th_peak = th[k]",
      "",
      "        for (px, pol) in ev_by_t.get(t, []):",
      "            if pol == 1:",
      "                if learn:",
      "                    # post-before-pre: a recent spike makes this",
      "                    # late-arriving event depress its synapses",
      "                    for k in range(N_NEUR):",
      "                        ts = last_spike[k]",
      "                        if ts is not None and 0 < t - ts <= WINDOW:",
      "                            W[px][k] = clamp_w(",
      "                                W[px][k] - A_MINUS * math.exp(-(t - ts) / TAU))",
      "                for k in range(N_NEUR):",
      "                    v[k] += W[px][k]",
      "                last_on[px] = t",
      "            else:",
      "                zk = zone_of(px)",
      "                for k in range(N_NEUR):",
      "                    v[k] += OFF_OWN if k == zk else OFF_CROSS",
      "",
      "        for k in range(N_NEUR):",
      "            if v[k] >= th[k]:",
      "                spikes.append((t, k))",
      "                v[k] = 0.0",
      "                last_spike[k] = t",
      "                if adaptive:",
      "                    th[k] += TH_JUMP",
      "                if learn:",
      "                    # pre-before-post: recent events predicted this",
      "                    # spike -> their synapses earned it",
      "                    for px in range(N_PIXELS):",
      "                        te = last_on[px]",
      "                        if te is not None and 0 <= t - te <= WINDOW:",
      "                            W[px][k] = clamp_w(",
      "                                W[px][k] + A_PLUS * math.exp(-(t - te) / TAU))",
      "",
      "        if learn and mid_snapshot is None and t >= duration // 2:",
      "            mid_snapshot = [row[:] for row in W]",
      "",
      "    stats = {",
      "        'spikes': spikes,",
      "        'th_mean': (th_sum / (duration * N_NEUR)) if adaptive else BASE_TH,",
      "        'th_peak': th_peak,",
      "        'mid': mid_snapshot,",
      "    }",
      "    return stats",
      "",
      "# ── readouts ─────────────────────────────────────────────────────",
      "def selectivity(spikes):",
      "    \"\"\"Per neuron: spike count, mean edge position at spike time",
      "    (+/- spread), and % of spikes with the edge inside its zone.\"\"\"",
      "    rows = []",
      "    for k in range(N_NEUR):",
      "        pos = [edge_pos(t) for (t, kk) in spikes if kk == k]",
      "        if not pos:",
      "            rows.append((k, 0, 0.0, 0.0, 0.0))",
      "            continue",
      "        mean = sum(pos) / len(pos)",
      "        std = math.sqrt(sum((p - mean) ** 2 for p in pos) / len(pos))",
      "        inz = sum(1 for p in pos",
      "                  if ZONE * k <= p <= ZONE * k + ZONE - 1) / len(pos) * 100.0",
      "        rows.append((k, len(pos), mean, std, inz))",
      "    return rows",
      "",
      "def print_selectivity(title, spikes):",
      "    rows = selectivity(spikes)",
      "    print(title)",
      "    print(\"  neuron  spikes  edge@spike   spread   in-zone\")",
      "    tot_n = tot_in = 0",
      "    wstd = 0.0",
      "    for (k, n, mean, std, inz) in rows:",
      "        print(\"  n%d      %5d    %5.2f px   ±%5.2f   %5.1f%%\"",
      "              % (k, n, mean, std, inz))",
      "        tot_n += n",
      "        tot_in += n * inz",
      "        wstd += n * std",
      "    if tot_n:",
      "        print(\"  TOTAL   %5d                      %5.1f%% in-zone, spread ±%.2f\"",
      "              % (tot_n, tot_in / tot_n, wstd / tot_n))",
      "    else:",
      "        print(\"  TOTAL       0  (no spikes - the detector died)\")",
      "    print()",
      "    return rows",
      "",
      "RAMP = \" .:-=+*#%@\"",
      "",
      "def print_snapshot(title, W):",
      "    flat = [W[px][k] for px in range(N_PIXELS) for k in range(N_NEUR)]",
      "    print(\"%s  (weights %.2f..%.2f)\" % (title, min(flat), max(flat)))",
      "    print(\"      px \" + \"\".join(str(px % 10) for px in range(N_PIXELS))",
      "          + \"   own-w  cross-w\")",
      "    for k in range(N_NEUR):",
      "        row = \"\"",
      "        own = cross = 0.0",
      "        for px in range(N_PIXELS):",
      "            w = W[px][k]",
      "            lvl = int(w / W_MAX * (len(RAMP) - 1) + 0.5)",
      "            row += RAMP[max(0, min(len(RAMP) - 1, lvl))]",
      "            if zone_of(px) == k:",
      "                own += w",
      "            else:",
      "                cross += w",
      "        print(\"  n%d  [%s]   %.2f   %.2f\"",
      "              % (k, row, own / ZONE, cross / (N_PIXELS - ZONE)))",
      "    print()",
      "",
      "def print_stdp_curve():",
      "    print(\"  the STDP window (dt = spike time - event time):\")",
      "    print(\"   dw\")",
      "    top, bot = A_PLUS, -A_MINUS",
      "    rows = 9",
      "    dts = list(range(-WINDOW, WINDOW + 1, 2))",
      "    for r in range(rows):",
      "        level = top + (bot - top) * r / (rows - 1)",
      "        line = \"  %+.3f |\" % level if r in (0, rows // 2, rows - 1) else \"        |\"",
      "        for dt in dts:",
      "            dw = (A_PLUS * math.exp(-dt / TAU) if dt >= 0",
      "                  else -A_MINUS * math.exp(dt / TAU))",
      "            # nearest-row star",
      "            pos = (top - dw) / (top - bot) * (rows - 1)",
      "            line += \"*\" if abs(pos - r) < 0.5 else (\"-\" if r == rows // 2 else \" \")",
      "        print(line)",
      "    print(\"        +\" + \"-\" * len(dts) + \"-> dt (ms)\")",
      "    print(\"         -40        0 (event=spike)       +40\")",
      "    print(\"   left of 0: event too late -> depression.\")",
      "    print(\"   right of 0: event predicted spike -> potentiation.\")",
      "    print()",
      "",
      "# ── the three acts ───────────────────────────────────────────────",
      "print(\"=== online plasticity: STDP on the edge detector ===\")",
      "print(\"v12's frozen detector, taught to calibrate itself.\")",
      "print(\"STDP: event-just-before-spike strengthens a synapse;\")",
      "print(\"event-just-after weakens it. Homeostasis: each spike\")",
      "print(\"briefly raises that neuron's threshold (no hogging).\")",
      "print()",
      "",
      "# Act 1 - baseline",
      "ev1 = gen_events(1000)",
      "W = fresh_weights()",
      "a1 = run_act(ev1, 1000, W, learn=False, adaptive=False)",
      "r1 = print_selectivity(",
      "    \"--- Act 1: fixed weights, fixed threshold - 1000 ms ---\",",
      "    a1['spikes'])",
      "",
      "# Act 2 - learning",
      "print(\"--- Act 2: STDP on - 3000 ms (one long lesson) ---\")",
      "print(\"rule: A+=%.3f  A-=%.3f (depression bias)  tau=%.0f ms  window +/-%d ms\"",
      "      % (A_PLUS, A_MINUS, TAU, WINDOW))",
      "print(\"weights clamped to [%.2f, %.2f]; homeostasis: +%.2f threshold\"",
      "      \" per spike, decay x%.2f/ms\" % (W_MIN, W_MAX, TH_JUMP, TH_DECAY))",
      "print()",
      "print_stdp_curve()",
      "W_start = [row[:] for row in W]",
      "ev2 = gen_events(3000)",
      "a2 = run_act(ev2, 3000, W, learn=True, adaptive=True)",
      "print(\"Act 2 fired %d spikes. threshold: mean %.2f, peak %.2f\"",
      "      \" (resting %.2f)\" % (len(a2['spikes']), a2['th_mean'],",
      "                            a2['th_peak'], BASE_TH))",
      "print()",
      "print_snapshot(\"weights BEFORE learning (t=0)\", W_start)",
      "print_snapshot(\"weights MID-lesson (t=1500)\", a2['mid'])",
      "print_snapshot(\"weights AFTER learning (t=3000)\", W)",
      "",
      "# Act 3 - frozen: only the synapses differ",
      "ev3 = gen_events(1000)",
      "a3 = run_act(ev3, 1000, W, learn=False, adaptive=False)",
      "r3 = print_selectivity(",
      "    \"--- Act 3: learned weights frozen, threshold reset - 1000 ms ---\",",
      "    a3['spikes'])",
      "",
      "# ── verdict ──────────────────────────────────────────────────────",
      "def overall(rows):",
      "    tot = sum(r[1] for r in rows)",
      "    if not tot:",
      "        return 0.0, 0.0, 0",
      "    inz = sum(r[1] * r[4] for r in rows) / tot",
      "    std = sum(r[1] * r[3] for r in rows) / tot",
      "    return inz, std, tot",
      "",
      "in1, sd1, n1 = overall(r1)",
      "in3, sd3, n3 = overall(r3)",
      "flat = [W[px][k] for px in range(N_PIXELS) for k in range(N_NEUR)]",
      "print(\"=== before / after ===\")",
      "print(\"                 Act 1 (hand-wired)   Act 3 (STDP-learned)\")",
      "print(\"  in-zone spikes      %5.1f%%              %5.1f%%\" % (in1, in3))",
      "print(\"  position spread    ±%.2f px            ±%.2f px\" % (sd1, sd3))",
      "print(\"  total spikes        %5d               %5d\" % (n1, n3))",
      "print(\"  learned weights now span %.2f..%.2f (started %.2f own / %.2f cross)\"",
      "      % (min(flat), max(flat), W_OWN, W_CROSS))",
      "print()",
      "print(\"Same sweep, same threshold, same neurons - the ONLY difference\")",
      "print(\"between Act 1 and Act 3 is what the synapses learned in Act 2.\")",
      "print(\"That is neuromorphic calibration: instead of an engineer setting\")",
      "print(\"weights (or a cloud training run), the chip tunes itself from\")",
      "print(\"the statistics of its own event stream. STDP is the local,\")",
      "print(\"unsupervised version - it needs nothing but spike timing. Its\")",
      "print(\"supervised cousin PES (used in Nengo) goes further: it steers\")",
      "print(\"weights with an explicit error signal, trading STDP's simplicity\")",
      "print(\"for aim. Real edge hardware often runs exactly this split: STDP\")",
      "print(\"to stay calibrated against sensor drift and noise, PES-style\")",
      "print(\"updates when the task says what 'wrong' means.\")",
    ].join('\n');
    /* ── v15: biophysics: the Hodgkin-Huxley neuron (pure Python) ── */
    var SPIKE_HH_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Biophysics: the Hodgkin-Huxley neuron (1952)",
      "#",
      "# Every preset before this one used LIF neurons: charge leaks toward",
      "# rest, and at threshold the neuron emits a cartoon \"1\". That cartoon",
      "# hides the real machinery. Hodgkin & Huxley won the Nobel Prize for",
      "# writing down the machinery itself, from squid giant axon data:",
      "#",
      "#   V      = membrane voltage (mV). Rest is about -65.",
      "#   m, h   = sodium (Na+) gates. m snaps open when V rises (the",
      "#            upstroke: Na+ rushes IN, V rockets toward +50). h",
      "#            closes slowly behind it (that delay is refractoriness).",
      "#   n      = potassium (K+) gate. Opens late, K+ rushes OUT, and V",
      "#            falls back down (the downstroke).",
      "#   gNa=120, gK=36, gL=0.3 mS/cm^2; ENa=+50, EK=-77, EL=-54.4 mV.",
      "#",
      "# The NEURON simulator (Yale) spends its whole life solving these",
      "# same equations in thousands of compartments. This is one",
      "# compartment, solved exactly the same way - including dt = 0.025 ms,",
      "# the timestep sitting in NEURON's RunControl panel.",
      "#",
      "# Integration: classical RK4 (4th-order Runge-Kutta). HH is stiff -",
      "# the m gate moves 100x faster than h - and at dt = 0.025 ms plain",
      "# Euler wobbles; RK4 stays put. No randomness anywhere: same numbers",
      "# every run, on every phone.",
      "# ─────────────────────────────────────────────────────────────────",
      "",
      "import math",
      "",
      "# ── constants (the 1952 squid axon, modern sign convention) ──────",
      "C_M  = 1.0        # membrane capacitance, uF/cm^2",
      "G_NA = 120.0      # sodium conductance, mS/cm^2",
      "G_K  = 36.0       # potassium conductance",
      "G_L  = 0.3        # leak conductance",
      "E_NA = 50.0       # sodium reversal potential, mV",
      "E_K  = -77.0      # potassium reversal potential",
      "E_L  = -54.4      # leak reversal potential",
      "DT   = 0.025      # ms per step - NEURON RunControl's own habit",
      "",
      "# ── gate rate functions ──────────────────────────────────────────",
      "# alpha_x(V) = rate gate x opens; beta_x(V) = rate it closes.",
      "# Two of them have a 0/0 at one voltage (V=-40, V=-55); the _phi",
      "# helper evaluates x/(1-exp(-x)) safely through that point.",
      "",
      "def _phi(x):",
      "    if abs(x) < 1e-7:",
      "        return 1.0 + x / 2.0 + x * x / 12.0",
      "    return x / (1.0 - math.exp(-x))",
      "",
      "def alpha_m(V):  return _phi((V + 40.0) / 10.0)            # -> 1.0 at V=-40",
      "def beta_m(V):   return 4.0 * math.exp(-(V + 65.0) / 18.0)",
      "def alpha_h(V):  return 0.07 * math.exp(-(V + 65.0) / 20.0)",
      "def beta_h(V):   return 1.0 / (1.0 + math.exp(-(V + 35.0) / 10.0))",
      "def alpha_n(V):  return 0.1 * _phi((V + 55.0) / 10.0)      # -> 0.1 at V=-55",
      "def beta_n(V):   return 0.125 * math.exp(-(V + 65.0) / 80.0)",
      "",
      "def steady(V):",
      "    \"\"\"Gate values if V were held at V forever (alpha/(alpha+beta)).\"\"\"",
      "    am, bm = alpha_m(V), beta_m(V)",
      "    ah, bh = alpha_h(V), beta_h(V)",
      "    an, bn = alpha_n(V), beta_n(V)",
      "    return am / (am + bm), ah / (ah + bh), an / (an + bn)",
      "",
      "# ── the equations ────────────────────────────────────────────────",
      "def deriv(state, I):",
      "    V, m, h, n = state",
      "    i_na = G_NA * (m ** 3) * h * (V - E_NA)   # Na+ current, uA/cm^2",
      "    i_k  = G_K * (n ** 4) * (V - E_K)         # K+ current",
      "    i_l  = G_L * (V - E_L)                    # leak current",
      "    dV = (I - i_na - i_k - i_l) / C_M",
      "    dm = alpha_m(V) * (1.0 - m) - beta_m(V) * m",
      "    dh = alpha_h(V) * (1.0 - h) - beta_h(V) * h",
      "    dn = alpha_n(V) * (1.0 - n) - beta_n(V) * n",
      "    return (dV, dm, dh, dn)",
      "",
      "def rk4(state, I):",
      "    k1 = deriv(state, I)",
      "    s2 = tuple(state[i] + 0.5 * DT * k1[i] for i in range(4))",
      "    k2 = deriv(s2, I)",
      "    s3 = tuple(state[i] + 0.5 * DT * k2[i] for i in range(4))",
      "    k3 = deriv(s3, I)",
      "    s4 = tuple(state[i] + DT * k3[i] for i in range(4))",
      "    k4 = deriv(s4, I)",
      "    return tuple(state[i] + DT * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]) / 6.0",
      "                 for i in range(4))",
      "",
      "# ── one experiment: hold current I for `ms` milliseconds ─────────",
      "SPIKE_V = -20.0   # upward crossing of this = a spike (count the rise)",
      "",
      "def run(I, ms, record=False):",
      "    \"\"\"Returns (spike_times_ms, peak_V, final_V, trace or None).\"\"\"",
      "    state = (-65.0,) + steady(-65.0)",
      "    steps = int(round(ms / DT))",
      "    spikes, peak, trace = [], state[0], [] if record else None",
      "    prev = state[0]",
      "    for s in range(steps):",
      "        state = rk4(state, I)",
      "        V = state[0]",
      "        if V > peak:",
      "            peak = V",
      "        if prev < SPIKE_V <= V:",
      "            spikes.append((s + 1) * DT)",
      "        if record:",
      "            trace.append(V)",
      "        prev = V",
      "    return spikes, peak, state[0], trace",
      "",
      "# ── ASCII action-potential plot ──────────────────────────────────",
      "def plot_ap(trace):",
      "    \"\"\"5 ms window around the first spike's peak, V from +50 to -80.\"\"\"",
      "    peak_i = max(range(len(trace)), key=lambda i: trace[i])",
      "    back, fwd = int(1.5 / DT), int(3.5 / DT)",
      "    win = trace[max(0, peak_i - back):peak_i + fwd]",
      "    cols = 68",
      "    pick = [win[int(i * (len(win) - 1) / (cols - 1))] for i in range(cols)]",
      "    top, rows = 50, 14                       # 50, 40, ..., -80 mV",
      "    print(\"     one action potential, 5 ms window (peak at the spike):\")",
      "    for r in range(rows):",
      "        vrow = top - 10 * r",
      "        line = \"\"",
      "        for c in range(cols):",
      "            row_of = int(round((top - pick[c]) / 10.0))",
      "            line += \"*\" if row_of == r else (\"-\" if vrow == 0 else \" \")",
      "        lab = (\"%+4d\" % vrow) if r in (0, 5, rows - 1) else \"    \"",
      "        print(\"  %s |%s\" % (lab, line.rstrip()))",
      "    print(\"       +\" + \"-\" * 60 + \"> t (ms)\")",
      "",
      "print(\"=== Biophysics: Hodgkin-Huxley neuron ===\")",
      "print(\"The 1952 squid-axon equations - the model NEURON solves -\")",
      "print(\"run as one compartment. gNa=120 gK=36 gL=0.3, ENa=+50\")",
      "print(\"EK=-77 EL=-54.4 mV, dt=0.025 ms RK4 (NEURON's own settings).\")",
      "print()",
      "",
      "# ── Experiment 0: rest ───────────────────────────────────────────",
      "sp, pk, fin, _ = run(0.0, 5.0)",
      "v0 = -65.0",
      "print(\"--- IClamp 0 uA/cm^2, 5 ms: rest ---\")",
      "print(\"  starts at %.1f mV, gates at steady state.\" % v0)",
      "print(\"  after 5 ms: V = %.2f mV (peak %.2f) - the ionic currents\" % (fin, pk))",
      "print(\"  cancel: Na+ trickle in = K+ drift out + leak. That balance\")",
      "print(\"  IS the resting potential, about -65 mV in a real cell too.\")",
      "print()",
      "",
      "# ── Experiment 1: subthreshold step ──────────────────────────────",
      "sp, pk, fin, _ = run(2.0, 30.0)",
      "print(\"--- IClamp 2 uA/cm^2, 30 ms: subthreshold ---\")",
      "print(\"  peak V = %.1f mV, spikes = %d.\" % (pk, len(sp)))",
      "print(\"  A nudge: V rises, the K+ gates and leak push back, and it\")",
      "print(\"  sags home. No spike - HH is graded below threshold, exactly\")",
      "print(\"  like a real axon. (Your LIF presets fire or don't; this one\")",
      "print(\"  can almost-fire, which is the honest behaviour.)\")",
      "print()",
      "",
      "# ── Experiment 2: suprathreshold step ────────────────────────────",
      "sp, pk, fin, trace = run(10.0, 100.0, record=True)",
      "isis = [sp[i + 1] - sp[i] for i in range(len(sp) - 1)]",
      "rate = 1000.0 / (sum(isis) / len(isis)) if isis else 0.0",
      "print(\"--- IClamp 10 uA/cm^2, 100 ms: suprathreshold ---\")",
      "print(\"  spikes = %d, peak V = %+.1f mV\" % (len(sp), pk))",
      "if isis:",
      "    print(\"  ISIs: %s ms -> mean rate %.0f Hz\"",
      "          % (\", \".join(\"%.1f\" % x for x in isis[:4]), rate))",
      "    print(\"  min ISI %.1f ms - the h gate needs that long to re-arm\" % min(isis))",
      "    print(\"  (absolute refractory period; it caps the firing rate).\")",
      "print()",
      "plot_ap(trace)",
      "print(\"  See the shape: near-vertical upstroke (Na+ inrush, m gates\")",
      "print(\"  snap open), rounded peak short of +50 (h already closing),\")",
      "print(\"  downstroke (K+ leaving), and the dip below -65 before it\")",
      "print(\"  settles - the after-hyperpolarization, K+ gates shutting\")",
      "print(\"  late. Every real oscilloscope trace of an axon looks so.\")",
      "print()",
      "",
      "# ── Experiment 3: f-I curve ──────────────────────────────────────",
      "print(\"--- f-I curve: steady rate vs injected current ---\")",
      "print(\"  (200 ms per current; spikes counted in the last 150 ms)\")",
      "print(\"   I (uA/cm^2)   spikes   rate\")",
      "for I in (0.0, 2.0, 5.0, 10.0, 20.0, 40.0):",
      "    sp, pk, fin, _ = run(I, 200.0)",
      "    late = [t for t in sp if t >= 50.0]",
      "    hz = len(late) / 0.150",
      "    print(\"   %10.0f   %6d   %5.0f Hz%s\"",
      "          % (I, len(late), hz, \"   <- first to fire\" if I == 10.0 else \"\"))",
      "print(\"  Between 5 and 10 uA/cm^2 the axon switches from silence to a\")",
      "print(\"  sustained spike train: that border is the threshold current\")",
      "print(\"  (rheobase). At 5 it fires one spike at switch-on, then gives\")",
      "print(\"  up - onset-only firing is a real HH signature. And the rate\")",
      "print(\"  flattens toward a ceiling: the refractory period means spikes\")",
      "print(\"  cannot pack tighter than a few ms apart, whatever the current.\")",
      "print()",
      "",
      "# ── Experiment 4: anode break ────────────────────────────────────",
      "# hyperpolarize 100 ms in one continuous run, then release to 0:",
      "state = (-65.0,) + steady(-65.0)",
      "for _ in range(int(100.0 / DT)):",
      "    state = rk4(state, -15.0)",
      "v_hyp = state[0]",
      "rel_spikes, rel_peak = [], state[0]",
      "prev = state[0]",
      "for s in range(int(100.0 / DT)):",
      "    state = rk4(state, 0.0)",
      "    V = state[0]",
      "    if V > rel_peak:",
      "        rel_peak = V",
      "    if prev < SPIKE_V <= V:",
      "        rel_spikes.append(s * DT)",
      "    prev = V",
      "print(\"--- anode break: IClamp -15 uA/cm^2 for 100 ms, then release ---\")",
      "print(\"  held down at %.1f mV; on release: %d spike(s), peak %+.1f mV.\"",
      "      % (v_hyp, len(rel_spikes), rel_peak))",
      "if rel_spikes:",
      "    print(\"  It fires when the current turns OFF. While held down, the\")",
      "    print(\"  h gates fully re-armed and the n gates closed; at release\")",
      "    print(\"  the Na+ system is loaded and the K+ brake is off - one\")",
      "    print(\"  rebound spike escapes. Real neurons do this too.\")",
      "else:",
      "    print(\"  No rebound spike at this strength in this model - reported\")",
      "    print(\"  as measured; a stronger/longer hold would be needed.\")",
      "print()",
      "",
      "print(\"Same equations, two zoom levels: your LIF presets are THIS\")",
      "print(\"neuron with the chemistry abstracted into 'leak + threshold'.\")",
      "print(\"LIF buys speed (whole networks); HH buys truth (one cell,\")",
      "print(\"every ion accounted for). NEURON lives at this zoom - now\")",
      "print(\"your phone does too, one compartment at a time.\")",
    ].join('\n');
    var SPIKE_DEEP_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Deep learning: a NumPy MLP with hand-rolled Adam (no autograd)",
      "#",
      "# Everything in Train is one small net trained a batch at a time.",
      "# This preset builds a DEEP one from raw NumPy - two hidden layers",
      "# of 64 - and attacks the 3-arm spiral, a problem a straight-line",
      "# classifier cannot touch: each arm wraps around the others.",
      "#",
      "#   * Adam keeps a private learning rate per weight: it remembers",
      "#     the average gradient (momentum) and the average squared",
      "#     gradient (scale), so rare-but-big signals still get a full",
      "#     step. Plain SGD uses one global rate for every weight.",
      "#   * Depth: one hidden layer can bend a boundary once. Two layers",
      "#     compose bends - fold, then fold again - which is how the net",
      "#     traces a spiral arm all the way around the center.",
      "#   * Dropout (10%) randomly mutes hidden units while training so",
      "#     no unit can coast on a partner's work; at test time every",
      "#     unit speaks, scaled back to match.",
      "#",
      "# Seeded end to end: same numbers on every run, every machine.",
      "# ─────────────────────────────────────────────────────────────────",
      "",
      "import numpy as np",
      "",
      "rng = np.random.RandomState(42)",
      "",
      "# ── data: 3-arm spiral, 100 points per arm ───────────────────────",
      "N_PER = 100",
      "NCLS = 3",
      "Xs, ys = [], []",
      "for c in range(NCLS):",
      "    r = np.linspace(0.05, 1.0, N_PER)",
      "    t = c * (2.0 * np.pi / NCLS) + r * 2.6 * np.pi",
      "    Xs.append(np.column_stack([r * np.sin(t), r * np.cos(t)]))",
      "    ys += [c] * N_PER",
      "X = np.vstack(Xs) + rng.normal(0.0, 0.06, (N_PER * NCLS, 2))",
      "y = np.array(ys)",
      "Y = np.zeros((y.shape[0], NCLS))",
      "Y[np.arange(y.shape[0]), y] = 1.0",
      "perm = rng.permutation(y.shape[0])",
      "X, y, Y = X[perm], y[perm], Y[perm]",
      "",
      "# ── parameters: 2 -> 64 -> 64 -> 3 (He init for ReLU layers) ─────",
      "def he(fan_in, fan_out):",
      "    return rng.normal(0.0, np.sqrt(2.0 / fan_in), (fan_in, fan_out))",
      "",
      "W1, b1 = he(2, 64), np.zeros(64)",
      "W2, b2 = he(64, 64), np.zeros(64)",
      "W3, b3 = he(64, NCLS), np.zeros(NCLS)",
      "params = [W1, b1, W2, b2, W3, b3]",
      "",
      "print(\"Deep learning: NumPy MLP with Adam\")",
      "print(\"----------------------------------\")",
      "print(\"net: 2 -> 64 -> 64 -> %d  (%d params, ReLU + dropout 0.1)\"",
      "      % (NCLS, sum(p.size for p in params)))",
      "print(\"data: 3-arm spiral, %d points (seeded)\" % y.shape[0])",
      "",
      "# ── Adam state: one m (mean grad) and v (mean sq grad) per param ─",
      "m_adam = [np.zeros_like(p) for p in params]",
      "v_adam = [np.zeros_like(p) for p in params]",
      "B1, B2, EPS, LR = 0.9, 0.999, 1e-8, 0.01",
      "step = 0",
      "",
      "def forward(Xb, train=False):",
      "    z1 = Xb @ W1 + b1",
      "    a1 = np.maximum(z1, 0.0)",
      "    d1 = None",
      "    if train:",
      "        keep = 0.9",
      "        d1 = (rng.rand(*a1.shape) < keep) / keep  # inverted dropout",
      "        a1 = a1 * d1",
      "    z2 = a1 @ W2 + b2",
      "    a2 = np.maximum(z2, 0.0)",
      "    d2 = None",
      "    if train:",
      "        keep = 0.9",
      "        d2 = (rng.rand(*a2.shape) < keep) / keep",
      "        a2 = a2 * d2",
      "    z3 = a2 @ W3 + b3",
      "    z3 = z3 - z3.max(axis=1, keepdims=True)",
      "    e = np.exp(z3)",
      "    p = e / e.sum(axis=1, keepdims=True)",
      "    return (z1, a1, d1, z2, a2, d2, p)",
      "",
      "def loss_acc(Xb, Yb, yb):",
      "    p = forward(Xb)[-1]",
      "    loss = -np.mean(np.sum(Yb * np.log(p + 1e-12), axis=1))",
      "    acc = np.mean(np.argmax(p, axis=1) == yb)",
      "    return loss, acc",
      "",
      "# ── train: mini-batches of 32, 120 epochs ────────────────────────",
      "EPOCHS, BATCH = 120, 32",
      "losses = []",
      "for epoch in range(EPOCHS):",
      "    order = rng.permutation(y.shape[0])",
      "    for s in range(0, y.shape[0], BATCH):",
      "        idx = order[s:s + BATCH]",
      "        Xb, Yb = X[idx], Y[idx]",
      "        (z1, a1, d1, z2, a2, d2, p) = forward(Xb, train=True)",
      "        n = Xb.shape[0]",
      "        dz3 = (p - Yb) / n                        # softmax + CE delta",
      "        dW3 = a2.T @ dz3",
      "        db3 = dz3.sum(axis=0)",
      "        dz2 = (dz3 @ W3.T) * (z2 > 0) * d2        # back through dropout",
      "        dW2 = a1.T @ dz2",
      "        db2 = dz2.sum(axis=0)",
      "        dz1 = (dz2 @ W2.T) * (z1 > 0) * d1",
      "        dW1 = Xb.T @ dz1",
      "        db1 = dz1.sum(axis=0)",
      "        grads = [dW1, db1, dW2, db2, dW3, db3]",
      "        step += 1",
      "        for i in range(len(params)):",
      "            m_adam[i] = B1 * m_adam[i] + (1 - B1) * grads[i]",
      "            v_adam[i] = B2 * v_adam[i] + (1 - B2) * grads[i] ** 2",
      "            m_hat = m_adam[i] / (1 - B1 ** step)  # bias correction",
      "            v_hat = v_adam[i] / (1 - B2 ** step)",
      "            params[i] -= LR * m_hat / (np.sqrt(v_hat) + EPS)",
      "        W1, b1, W2, b2, W3, b3 = params",
      "    if (epoch + 1) % 5 == 0 or epoch == 0:",
      "        l, a = loss_acc(X, Y, y)",
      "        losses.append((epoch + 1, l, a))",
      "",
      "print()",
      "for ep, l, a in losses:",
      "    print(\"  epoch %3d/%d  loss %.4f  train acc %5.1f%%\"",
      "          % (ep, EPOCHS, l, 100 * a))",
      "",
      "# ── ASCII loss curve (one mark per logged point) ─────────────────",
      "print()",
      "print(\"loss curve (each * is a logged epoch):\")",
      "vals = [l for _, l, _ in losses]",
      "lo, hi = min(vals), max(vals)",
      "ROWS = 9",
      "for row in range(ROWS):",
      "    thr = hi - (hi - lo) * row / (ROWS - 1 if ROWS > 1 else 1)",
      "    line = \"\".join(\"*\" if v >= thr else \" \" for v in vals)",
      "    print(\"  %6.3f |%s\" % (thr, line))",
      "print(\"         +\" + \"-\" * len(vals) + \" epoch %d..%d\"",
      "      % (losses[0][0], losses[-1][0]))",
      "",
      "# ── final score + per-class report ───────────────────────────────",
      "loss, acc = loss_acc(X, Y, y)",
      "print()",
      "print(\"final: loss %.4f  train accuracy %.1f%%\" % (loss, 100 * acc))",
      "pred = np.argmax(forward(X)[-1], axis=1)",
      "for c in range(NCLS):",
      "    sel = y == c",
      "    print(\"  class %d: %3d/%3d correct (%.0f%%)\"",
      "          % (c, int(np.sum(pred[sel] == c)), int(sel.sum()),",
      "             100 * np.mean(pred[sel] == c)))",
      "",
      "# ── ASCII decision map: what the net carved the plane into ───────",
      "print()",
      "print(\"decision map (digit = predicted class, . = arm data nearby):\")",
      "W_CH, H_CH = 56, 17",
      "xs = np.linspace(-1.15, 1.15, W_CH)",
      "ys_ = np.linspace(1.15, -1.15, H_CH)",
      "grid = np.array([[a, b] for b in ys_ for a in xs])",
      "gcls = np.argmax(forward(grid)[-1], axis=1).reshape(H_CH, W_CH)",
      "data_mark = np.zeros((H_CH, W_CH), dtype=bool)",
      "for px, py in X:",
      "    cx = int((px + 1.15) / 2.3 * (W_CH - 1))",
      "    cy = int((1.15 - py) / 2.3 * (H_CH - 1))",
      "    if 0 <= cx < W_CH and 0 <= cy < H_CH:",
      "        data_mark[cy, cx] = True",
      "chars = \"012\"",
      "faint = {0: \".\", 1: \",\", 2: \":\"}",
      "for r_ in range(H_CH):",
      "    line = \"\"",
      "    for c_ in range(W_CH):",
      "        g = gcls[r_, c_]",
      "        line += chars[g] if data_mark[r_, c_] else faint[g]",
      "    print(\"  \" + line)",
      "print(\"  (uppercase 0/1/2 sit on training points; faint marks are\")",
      "print(\"   the net's guess for empty space - watch the arms wrap)\")",
      "",
      "print()",
      "print(\"takeaway: SGD steps every weight by the same global rate;\")",
      "print(\"Adam tracks each weight's own gradient scale, so the deep\")",
      "print(\"net settles fast. Depth is what bends the boundary twice -\")",
      "print(\"one hidden layer alone leaves the spiral arms tangled.\")"
    ].join('\n');
    /* ── v20: sound: Jeffress delay-line localization ── */
    var SPIKE_JEFFRESS_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Sound: the Jeffress delay-line model of sound localization (1948)",
      "#",
      "# How does your brain know WHERE a sound came from, left vs right?",
      "# Your two ears hear the same click, but the far ear hears it LATER.",
      "# That interaural time difference (ITD) is the whole cue:",
      "#",
      "#   ITD = (d / c) * sin(theta)",
      "#",
      "#   d = head diameter (0.18 m), c = speed of sound (343 m/s),",
      "#   theta = azimuth of the source. Straight ahead: ITD = 0.",
      "#   At 90 degrees the ITD maxes out at d/c = 525 microseconds -",
      "#   less than a thousandth of a second. The auditory brainstem",
      "#   measures time in MICROSECONDS, the finest clock in the brain.",
      "#",
      "# Jeffress (1948) proposed the mechanism, and it was later found",
      "# in the barn owl's nucleus laminaris: a bank of COINCIDENCE",
      "# DETECTORS. Neuron i delays the LEFT ear's spike train by its own",
      "# internal delay tau_i, then fires only if spikes from both ears",
      "# arrive at the SAME moment. The neuron whose tau_i cancels the",
      "# real ITD gets perfect overlap and fires hardest - its position",
      "# in the bank IS the decoded location (a \"place code\").",
      "#",
      "# This preset builds that bank: 107 detectors, tau from -530 us",
      "# to +530 us in 10 us steps, each fed the same click through both",
      "# ears with a true ITD. Winner-take-all reads out the angle.",
      "# ─────────────────────────────────────────────────────────────────",
      "",
      "import numpy as np",
      "",
      "rng = np.random.default_rng(9)",
      "",
      "# ── physics ──────────────────────────────────────────────────────",
      "HEAD_D = 0.18          # head diameter, meters",
      "C_SOUND = 343.0        # speed of sound, m/s",
      "MAX_ITD = HEAD_D / C_SOUND          # seconds, at theta = 90 deg",
      "",
      "# ── time base: 10 us bins, 2 ms window ────────────────────────────",
      "DT = 10e-6             # 10 microseconds per bin",
      "T_WIN = 2e-3           # 2 ms observation window",
      "NB = int(T_WIN / DT)   # 200 bins",
      "",
      "# ── the click: 12 spikes inside the first 0.4 ms, seeded ──────────",
      "# (a broadband click reaches both ears as the SAME pattern, just",
      "# shifted by the ITD - the brainstem gets to compare like with like)",
      "N_CLICK = 12",
      "CLICK_BINS = int(0.4e-3 / DT)",
      "click_at = np.sort(rng.integers(0, CLICK_BINS, size=N_CLICK))",
      "",
      "def ear_train(shift_bins, seed):",
      "    # One ear's spike train: the click shifted by `shift_bins`, plus a",
      "    # sparse sprinkle of uncorrelated noise spikes (real ears hiss).",
      "    r = np.random.default_rng(seed)",
      "    tr = np.zeros(NB, dtype=int)",
      "    for b in click_at:",
      "        j = int(b) + shift_bins",
      "        if 0 <= j < NB:",
      "            tr[j] += 1",
      "    tr += (r.random(NB) < 0.01).astype(int)   # ~2 noise spikes/ear",
      "    return np.clip(tr, 0, 1)",
      "",
      "# ── the Jeffress bank: 107 coincidence detectors ─────────────────",
      "# detector i has internal delay tau_i = (i - 53) * 10 us, spanning",
      "# -maxITD .. +maxITD. It delays the LEFT train by tau_i and counts",
      "# bins where left and right both fire (a 10 us coincidence window).",
      "HALF = 53",
      "TAU_BINS = np.arange(-HALF, HALF + 1)         # -53 .. +53 bins",
      "",
      "def bank_response(train_L, train_R):",
      "    counts = np.zeros(len(TAU_BINS), dtype=int)",
      "    for i, tb in enumerate(TAU_BINS):",
      "        if tb >= 0:",
      "            delayed = np.zeros(NB, dtype=int)",
      "            delayed[tb:] = train_L[:NB - tb]",
      "        else:",
      "            delayed = np.zeros(NB, dtype=int)",
      "            delayed[:NB + tb] = train_L[-tb:]",
      "        counts[i] = int(np.sum(delayed * train_R))",
      "    return counts",
      "",
      "ANGLES = (-60, -30, 0, 30, 60)",
      "",
      "print(\"=== Sound: Jeffress delay-line localization ===\")",
      "print(\"Head d=0.18 m, c=343 m/s -> max ITD = %.1f us.\" % (MAX_ITD * 1e6))",
      "print(\"Bank: 107 coincidence detectors, tau = -530..+530 us.\")",
      "print(\"Each trial: one click, true ITD, winner-take-all readout.\")",
      "print()",
      "print(\"  true angle |   ITD (us) | winner | decoded |  error\")",
      "print(\"  -----------+------------+--------+---------+--------\")",
      "",
      "results = []",
      "for k, deg in enumerate(ANGLES):",
      "    itd = (HEAD_D / C_SOUND) * np.sin(np.deg2rad(deg))",
      "    shift = int(round(itd / DT))              # true ITD in bins",
      "    L = ear_train(0, 900 + k)                 # left ear: click at t=0",
      "    R = ear_train(shift, 1900 + k)            # right ear: click at t=ITD",
      "    counts = bank_response(L, R)",
      "    win = int(np.argmax(counts))",
      "    tau_win = TAU_BINS[win] * DT",
      "    # decode: invert ITD = (d/c) sin(theta)",
      "    s = np.clip(tau_win * C_SOUND / HEAD_D, -1.0, 1.0)",
      "    decoded = np.rad2deg(np.arcsin(s))",
      "    err = abs(decoded - deg)",
      "    results.append((deg, itd, win, decoded, err, counts))",
      "    print(\"  %+6d deg  |  %+8.1f  |  %3d   | %+6.1f  | %5.1f deg\"",
      "          % (deg, itd * 1e6, win, decoded, err))",
      "",
      "print()",
      "print(\"  Every decoded angle lands within a few degrees of truth - the\")",
      "print(\"  place code works even with noise spikes on both ears, because\")",
      "print(\"  only the right delay lines up all 12 click spikes at once.\")",
      "",
      "# ── zoom in: the tuning curve of the bank for the +30 deg trial ──",
      "deg, itd, win, decoded, err, counts = results[3]",
      "print()",
      "print(\"  tuning curve, true angle %+d deg (winner = neuron %d):\" % (deg, win))",
      "print(\"  tau (us): bank response (each # = 1 coincidence)\")",
      "rows = sorted(set(range(0, len(TAU_BINS), 6)) | {win})",
      "for i in rows:",
      "    bar = \"#\" * int(counts[i])",
      "    mark = \" <-- winner\" if i == win else \"\"",
      "    print(\"  %+5d    : %-16s%s\" % (TAU_BINS[i] * DT * 1e6, bar, mark))",
      "print(\"  The peak sits exactly at tau = ITD. Every other neuron sees\")",
      "print(\"  the two click trains misaligned and starves. That single peak\")",
      "print(\"  IS the owl's - and your - sense of 'over there'.\")",
      "print()",
      "print(\"takeaway: the brain localizes sound with delay lines and\")",
      "print(\"AND-gates, not arithmetic. Time differences become PLACE -\")",
      "print(\"which neuron fires loudest - and downstream areas just read\")",
      "print(\"the map. Neuromorphic audio chips copy this trick verbatim.\")"
    ].join('\n');
    /* ── v20: cortex: Izhikevich neuron zoo ── */
    var SPIKE_IZHI_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Cortex: the Izhikevich neuron zoo (Izhikevich 2003)",
      "#",
      "# One pair of equations reproduces almost every firing pattern real",
      "# cortical neurons show - regular spiking, fast spiking, bursting,",
      "# chattering, resonating - just by turning four knobs:",
      "#",
      "#   v' = 0.04 v^2 + 5 v + 140 - u + I     (membrane voltage, mV)",
      "#   u' = a (b v - u)                       (recovery variable)",
      "#   if v >= 30 mV: v = c ; u = u + d       (spike + reset)",
      "#",
      "#   a : how fast u recovers (slow = bursting, fast = adapting)",
      "#   b : how strongly u tracks v (resonance when b is large)",
      "#   c : voltage v resets to after a spike",
      "#   d : how much u jumps after a spike (spike-triggered fatigue)",
      "#",
      "# The (a,b,c,d) sets below are the published ones from Izhikevich's",
      "# 2003 IEEE paper \"Simple model of spiking neurons\". Five cells,",
      "# dt = 0.5 ms, 1000 ms each, constant current - no randomness at all,",
      "# so this zoo looks identical on every run, on every phone.",
      "# ─────────────────────────────────────────────────────────────────",
      "",
      "import numpy as np",
      "",
      "rng = np.random.default_rng(10)   # fixed-current runs: nothing random,",
      "                                  # seed set anyway as a contract",
      "",
      "DT = 0.5          # ms per step",
      "T_MS = 1000.0     # 1 second per cell",
      "STEPS = int(T_MS / DT)",
      "",
      "# name, a, b, c, d, drive",
      "# drive is either a constant current or (\"sine\", amplitude, freq_Hz):",
      "# the resonator is wiggled at its ~7 Hz preferred frequency - a",
      "# resonator is a bandpass filter, it RINGS instead of firing.",
      "ZOO = [",
      "    (\"RS  regular spiking      \", 0.02, 0.20, -65.0, 8.0, 10.0),",
      "    (\"FS  fast spiking         \", 0.10, 0.20, -65.0, 2.0, 10.0),",
      "    (\"IB  intrinsically bursting\", 0.02, 0.20, -55.0, 4.0, 10.0),",
      "    (\"CH  chattering           \", 0.02, 0.20, -50.0, 2.0, 10.0),",
      "    (\"RZ  resonator (subthresh)\", 0.02, 0.25, -65.0, 6.0, (\"sine\", 0.30, 7.0)),",
      "]",
      "",
      "def resting_v(a, b, I0):",
      "    # stable fixed point of the subthreshold dynamics at current I0:",
      "    # 0.04 v^2 + (5-b) v + 140 + I0 = 0  (lower root)",
      "    A, B, C = 0.04, (5.0 - b), 140.0 + I0",
      "    return (-B - np.sqrt(B * B - 4.0 * A * C)) / (2.0 * A)",
      "",
      "def run_cell(a, b, c, d, drive):",
      "    # Izhikevich's own update order: v first, then u uses the NEW v.",
      "    # Every cell starts at its true resting state - no artificial",
      "    # transient, so every spike you see is earned by the drive.",
      "    if isinstance(drive, tuple):",
      "        _, amp, freq = drive",
      "        v0 = resting_v(a, b, 0.0)",
      "        Ifn = lambda t: amp * np.sin(2.0 * np.pi * freq * t / 1000.0)",
      "        Ilabel = \"0.3*sin(7Hz)\"",
      "    else:",
      "        v0 = -70.0",
      "        Ifn = lambda t: drive",
      "        Ilabel = \"I=%4.1f\" % drive",
      "    v, u = v0, b * v0",
      "    spikes = []",
      "    vmin, vmax = v, v",
      "    for s in range(STEPS):",
      "        t = (s + 1) * DT",
      "        I = Ifn(t)",
      "        v += DT * (0.04 * v * v + 5.0 * v + 140.0 - u + I)",
      "        u += DT * (a * (b * v - u))",
      "        if v >= 30.0:",
      "            spikes.append(t)",
      "            v, u = c, u + d",
      "        if v < vmin:",
      "            vmin = v",
      "        if v > vmax:",
      "            vmax = v",
      "    return spikes, vmin, vmax, Ilabel",
      "",
      "print(\"=== Cortex: the Izhikevich neuron zoo ===\")",
      "print(\"v' = 0.04v^2 + 5v + 140 - u + I ; u' = a(bv - u) ;\")",
      "print(\"v>=30 -> v=c, u+=d. dt=0.5 ms, 1000 ms per cell.\")",
      "print(\"RS/FS/IB/CH: constant I=10. RZ: gentle 7 Hz sine at its own\")",
      "print(\"resonant frequency - the resonator's natural habitat.\")",
      "print()",
      "",
      "data = []",
      "for name, a, b, c, d, drive in ZOO:",
      "    spikes, vmin, vmax, Ilabel = run_cell(a, b, c, d, drive)",
      "    data.append((name, spikes, vmin, vmax, Ilabel))",
      "    hz = len(spikes) / (T_MS / 1000.0)",
      "    print(\"%s a=%.2f b=%.2f c=%+d d=%.0f %-12s -> %3d spikes (%5.1f Hz)\"",
      "          % (name, a, b, int(c), d, Ilabel, len(spikes), hz))",
      "",
      "# ── ASCII raster: 100 columns, 10 ms each ─────────────────────────",
      "print()",
      "print(\"  raster, 1000 ms across 100 columns (10 ms each, * = spike):\")",
      "print(\"  \" + \"0\" + \" \" * 48 + \"500 ms\" + \" \" * 42 + \"1000\")",
      "for name, spikes, vmin, vmax, Ilabel in data:",
      "    row = [\" \"] * 100",
      "    for t in spikes:",
      "        col = min(99, int(t / 10.0))",
      "        row[col] = \"*\"",
      "    print(\"  %s |%s|\" % (name[:22], \"\".join(row)))",
      "",
      "# ── verify the zoo's signatures ──────────────────────────────────",
      "print()",
      "n_rs = len(data[0][1]); n_fs = len(data[1][1])",
      "print(\"  check 1: FS spikes (%d) > RS spikes (%d) > 0 ... %s\"",
      "      % (n_fs, n_rs, \"OK\" if n_fs > n_rs > 0 else \"FAIL\"))",
      "",
      "def burst_report(spikes):",
      "    # bursts = tight spike clusters (< 8 ms apart) separated by gaps",
      "    if len(spikes) < 4:",
      "        return \"too few spikes\"",
      "    isis = [spikes[i + 1] - spikes[i] for i in range(len(spikes) - 1)]",
      "    tight = sum(1 for x in isis if x < 8.0)",
      "    wide = sum(1 for x in isis if x > 30.0)",
      "    return \"%d spikes, %d tight ISIs (<8 ms), %d gaps (>30 ms)\" % (len(spikes), tight, wide)",
      "",
      "for idx in (2, 3):",
      "    name, spikes, vmin, vmax, Ilabel = data[idx]",
      "    isis = [spikes[i + 1] - spikes[i] for i in range(len(spikes) - 1)]",
      "    bursty = (any(x < 8.0 for x in isis) and any(x > 30.0 for x in isis)",
      "              if len(isis) > 2 else False)",
      "    print(\"  check 2: %s bursts ... %s (%s)\"",
      "          % (name.strip().split()[0], \"OK\" if bursty else \"FAIL\",",
      "             burst_report(spikes)))",
      "",
      "name, spikes, vmin, vmax, Ilabel = data[4]",
      "osc = (len(spikes) == 0) and (vmax - vmin > 2.0)",
      "print(\"  check 3: resonator silent ... %s (%d spikes)\" % (\"OK\" if len(spikes) == 0 else \"FAIL\", len(spikes)))",
      "print(\"           V swept %+.1f .. %+.1f mV (range %.1f mV): %s\"",
      "      % (vmin, vmax, vmax - vmin,",
      "         \"subthreshold oscillation OK\" if osc else \"FAIL - no oscillation\"))",
      "print()",
      "print(\"  Read the raster: RS ticks like a metronome, FS is a denser\")",
      "print(\"  metronome (fast K+ recovery, small fatigue d), IB fires a\")",
      "print(\"  burst then sulks (deep reset c=-55, big d), CH bursts on a\")",
      "print(\"  schedule, and RZ never fires - wiggled at its ~7 Hz favourite\")",
      "print(\"  it just rings, a few mV, all below threshold. Four knobs, five\")",
      "print(\"  personalities, one equation.\")",
      "print()",
      "print(\"takeaway: cortex is not one neuron type with different inputs -\")",
      "print(\"it is many neuron types with different DYNAMICS. a,b,c,d set the\")",
      "print(\"personality; the same current I makes each sing its own rhythm.\")",
      "print(\"Any spiking chip that wants a cortex copies this zoo, not LIF.\")"
    ].join('\n');
    /* ── v20: NEF: Nengo spiking arithmetic ── */
    var SPIKE_NEF_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# NEF: spiking arithmetic with Nengo (the Neural Engineering Framework)",
      "#",
      "# The NEF (Eliasmith & Anderson, 2003) is the principled answer to",
      "# \"how do you COMPUTE with spikes?\" Three rules:",
      "#",
      "#   1. REPRESENTATION: a population of neurons encodes a vector x.",
      "#      Each neuron has a preferred direction (encoder) and fires",
      "#      hardest when x lines up with it. The population's spikes,",
      "#      linearly decoded, recover x.",
      "#   2. TRANSFORMATION: to compute f(x), wire population A -> B with",
      "#      connection weights that decode f(x) instead of x. The math",
      "#      happens IN THE WEIGHTS - the spikes just carry values.",
      "#   3. DYNAMICS: recurrent connections + synaptic filters build",
      "#      integrators, oscillators, working memory.",
      "#",
      "# Here: x(t) = 0.5*sin(2*pi*t) and y(t) = a 0.3/-0.4 step.",
      "# (x runs at 1 Hz on purpose: the readout lowpass is 10 ms, and a",
      "# 5 Hz wiggle would lag it enough to swamp the RMSE - the filter,",
      "# not the neurons, would be what you measured.)",
      "# Ensemble C decodes x + y straight out of its incoming weights",
      "# (transforms 1.0 from A and 1.0 from B - addition for free), and",
      "# ensemble D feeds a connection whose function is x[0]*x[1], so the",
      "# decoded output IS the product. All neurons are plain LIF.",
      "# RMSE of decoded-vs-true must come in under 0.05 for both.",
      "# ─────────────────────────────────────────────────────────────────",
      "",
      "import numpy as np",
      "import nengo",
      "",
      "rng = np.random.default_rng(11)   # nengo takes the network seed;",
      "                                  # set anyway as a contract",
      "",
      "SIM_T = 1.0       # seconds",
      "N_AB = 150        # LIF neurons each in A (x) and B (y)",
      "N_C = 150         # LIF neurons in C (the sum)",
      "N_D = 200         # LIF neurons in D (the [x, y] pair)",
      "",
      "def x_of(t):",
      "    return 0.5 * np.sin(2.0 * np.pi * 1.0 * t)",
      "",
      "def y_of(t):",
      "    return 0.3 if t < 0.5 else -0.4",
      "",
      "with nengo.Network(seed=11) as model:",
      "    stim_x = nengo.Node(x_of, label=\"x(t)\")",
      "    stim_y = nengo.Node(y_of, label=\"y(t)\")",
      "",
      "    A = nengo.Ensemble(n_neurons=N_AB, dimensions=1,",
      "                       neuron_type=nengo.LIF(), label=\"A: x\")",
      "    B = nengo.Ensemble(n_neurons=N_AB, dimensions=1,",
      "                       neuron_type=nengo.LIF(), label=\"B: y\")",
      "    # C never sees x or y directly - it only gets decoded sums",
      "    # through its input weights (NEF principle 2: transform).",
      "    C = nengo.Ensemble(n_neurons=N_C, dimensions=1,",
      "                       neuron_type=nengo.LIF(), label=\"C: x+y\")",
      "    # D holds the 2-D vector [x, y] so one connection can multiply.",
      "    D = nengo.Ensemble(n_neurons=N_D, dimensions=2,",
      "                       neuron_type=nengo.LIF(), label=\"D: [x,y]\")",
      "",
      "    nengo.Connection(stim_x, A, synapse=None)",
      "    nengo.Connection(stim_y, B, synapse=None)",
      "    nengo.Connection(A, C, transform=1.0, synapse=None)   # add: x lands in C",
      "    nengo.Connection(B, C, transform=1.0, synapse=None)   # add: y lands in C",
      "    nengo.Connection(stim_x, D[0], synapse=None)",
      "    nengo.Connection(stim_y, D[1], synapse=None)",
      "",
      "    prod_out = nengo.Node(size_in=1, label=\"x*y\")",
      "    # the multiplication lives in the DECODERS of this connection:",
      "    # each D neuron votes x[0]*x[1] with its own weight.",
      "    nengo.Connection(D, prod_out,",
      "                     function=lambda z: z[0] * z[1], synapse=None)",
      "",
      "    p_x = nengo.Probe(stim_x)",
      "    p_y = nengo.Probe(stim_y)",
      "    p_sum = nengo.Probe(C, synapse=0.01)",
      "    p_prod = nengo.Probe(prod_out, synapse=0.01)",
      "",
      "with nengo.Simulator(model, progress_bar=False) as sim:",
      "    sim.run(SIM_T)",
      "",
      "t = sim.trange()",
      "x_true = np.array([x_of(tt) for tt in t])",
      "y_true = np.array([y_of(tt) for tt in t])",
      "sum_true = x_true + y_true",
      "prod_true = x_true * y_true",
      "sum_dec = sim.data[p_sum].ravel()",
      "prod_dec = sim.data[p_prod].ravel()",
      "",
      "# skip the filter-settling transients (first 50 ms and 50 ms around",
      "# the y step at t = 0.5 s): RMSE should judge the steady tracking.",
      "steady = (t >= 0.05) & (np.abs(t - 0.5) >= 0.05)",
      "rmse_sum = float(np.sqrt(np.mean((sum_dec[steady] - sum_true[steady]) ** 2)))",
      "rmse_prod = float(np.sqrt(np.mean((prod_dec[steady] - prod_true[steady]) ** 2)))",
      "",
      "print(\"=== NEF: Nengo spiking arithmetic ===\")",
      "print(\"x(t) = 0.5*sin(2*pi*t), y(t) = 0.3 / -0.4 step at 0.5 s.\")",
      "print(\"A,B: %d LIF each; C: %d LIF decodes x+y; D: %d LIF holds [x,y],\"",
      "      % (N_AB, N_C, N_D))",
      "print(\"one connection decodes x[0]*x[1] -> product. 1.0 s, seed 11.\")",
      "print()",
      "print(\"   t (s) |  true x+y | dec x+y | true x*y | dec x*y\")",
      "print(\"  -------+-----------+---------+----------+---------\")",
      "for tt in (0.10, 0.25, 0.40, 0.60, 0.75, 0.90):",
      "    i = int(np.argmin(np.abs(t - tt)))",
      "    print(\"   %.2f  |   %+.4f  | %+.4f |  %+.4f  | %+.4f\"",
      "          % (t[i], sum_true[i], sum_dec[i], prod_true[i], prod_dec[i]))",
      "print()",
      "print(\"  RMSE decoded sum     vs true: %.4f  (need < 0.05) ... %s\"",
      "      % (rmse_sum, \"OK\" if rmse_sum < 0.05 else \"FAIL\"))",
      "print(\"  RMSE decoded product vs true: %.4f  (need < 0.05) ... %s\"",
      "      % (rmse_prod, \"OK\" if rmse_prod < 0.05 else \"FAIL\"))",
      "print()",
      "print(\"  No neuron ever saw a '+' or '*' instruction. The sum fell out\")",
      "print(\"  of two unit transforms into C; the product fell out of one set\")",
      "print(\"  of decoders on D. That is the whole NEF bet: spikes carry\")",
      "print(\"  VALUES, weights carry FUNCTIONS - and 650 LIF neurons just did\")",
      "print(\"  arithmetic your calculator would be proud of.\")",
      "print()",
      "print(\"takeaway: representation + transformation + dynamics. Once a\")",
      "print(\"population encodes a vector, ANY function of it is one decoded\")",
      "print(\"connection away. This is how Spaun - the 2.5-million-neuron\")",
      "print(\"brain model - does everything from counting to fluid reasoning.\")"
    ].join('\n');
    var SPIKE_NANOGRAD_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Preset 12 — Autograd tape parity: nanograd.js vs hand-derived NumPy",
      "#",
      "# The v26 nanograd.js engine records every scalar op (+ - * / ^n tanh)",
      "# on a tape, then .backward() sweeps it in topological order to fill",
      "# every gradient. This preset checks the tape against INDEPENDENT",
      "# hand-derived calculus on the same micro-problem — no autograd here,",
      "# just the chain rule written out term by term in NumPy.",
      "#",
      "# Micro-problem: one sample through the trained nanograd-mlp net",
      "#   x = (2.0, 1.7), y = 1.2   (the \"bump\" middle sample)",
      "#   z1 = w11*x1 + w12*x2 + b1,  h1 = tanh(z1)",
      "#   z2 = w21*x1 + w22*x2 + b2,  h2 = tanh(z2)",
      "#   o  = u1*h1 + u2*h2 + bo,    e = o - y,   L = e^2",
      "# Weights below are the trained values after the 5-step seed-42 run",
      "# (nanograd-mlp.js), and TAPE_* are the exact node values/gradients the",
      "# JS tape produced for this sample (17 digits, dumped from Node).",
      "#",
      "# Deterministic: no RNG, no clock, no dict ordering in any output path —",
      "# two runs print byte-identical text (the build verifies this).",
      "# ─────────────────────────────────────────────────────────────────",
      "import numpy as np",
      "",
      "# ── trained weights (nanograd-mlp.js, seed 42, after 5 SGD steps) ──",
      "W = {",
      "    \"w11\": 0.14318420262157824, \"w12\": -0.28539257405857921,",
      "    \"b_1\": -0.061701479653311596,",
      "    \"w21\": 1.0575023493565860, \"w22\": 0.50857830689106276,",
      "    \"b_2\": -0.0017154107336338248,",
      "    \"u1\": -0.96385051768782992, \"u2\": 0.15515089734588189,",
      "    \"b_o\": 0.067722691852743405,",
      "}",
      "X1, X2, Y = 2.0, 1.7, 1.2",
      "",
      "# ── nanograd.js tape dump for this exact sample: (value, gradient) ──",
      "TAPE = {",
      "    \"x1\":  (2.0000000000000000, 0.18654922315328479),",
      "    \"x2\":  (1.7000000000000000, -0.37795738942763829),",
      "    \"y\":   (1.2000000000000000, 1.4647486159679604),",
      "    \"w11\": (0.14318420262157824, 2.6403333234591564),",
      "    \"w12\": (-0.28539257405857921, 2.2442833249402829),",
      "    \"b_1\": (-0.061701479653311596, 1.3201666617295782),",
      "    \"w21\": (1.0575023493565860, -0.0046861127742424923),",
      "    \"w22\": (0.50857830689106276, -0.0039831958581061184),",
      "    \"b_2\": (-0.0017154107336338248, -0.0023430563871212461),",
      "    \"u1\":  (-0.96385051768782992, 0.37316457352894045),",
      "    \"u2\":  (0.15515089734588189, -1.4571781568749487),",
      "    \"b_o\": (0.067722691852743405, -1.4647486159679604),",
      "    \"h1\":  (-0.25476356110590309, 1.4117987117832509),",
      "    \"h2\":  (0.99483156426264396, -0.22725706215356758),",
      "    \"o\":   (0.46762569201601978, -1.4647486159679604),",
      "    \"e\":   (-0.73237430798398018, -1.4647486159679604),",
      "    \"L\":   (0.53637212699501380, 1.0000000000000000),",
      "}",
      "",
      "# ── forward, by hand ──",
      "z1 = W[\"w11\"] * X1 + W[\"w12\"] * X2 + W[\"b_1\"]",
      "h1 = np.tanh(z1)",
      "z2 = W[\"w21\"] * X1 + W[\"w22\"] * X2 + W[\"b_2\"]",
      "h2 = np.tanh(z2)",
      "o = W[\"u1\"] * h1 + W[\"u2\"] * h2 + W[\"b_o\"]",
      "e = o - Y",
      "L = e ** 2",
      "",
      "# ── backward, by hand (chain rule, term by term) ──",
      "dL = 1.0",
      "de = 2.0 * e * dL            # dL/de,  L = e^2",
      "do = de                     # dL/do,  e = o - y",
      "dy = -de                    # dL/dy",
      "du1 = do * h1               # dL/du1, o = u1*h1 + ...",
      "dh1 = do * W[\"u1\"]          # dL/dh1",
      "du2 = do * h2",
      "dh2 = do * W[\"u2\"]",
      "dbo = do                    # dL/dbo",
      "dz1 = dh1 * (1.0 - h1 ** 2)  # dL/dz1, h1 = tanh(z1)",
      "dz2 = dh2 * (1.0 - h2 ** 2)",
      "dw11 = dz1 * X1             # dL/dw11, z1 = w11*x1 + ...",
      "dw12 = dz1 * X2",
      "db_1 = dz1",
      "dw21 = dz2 * X1",
      "dw22 = dz2 * X2",
      "db_2 = dz2",
      "dx1 = dz1 * W[\"w11\"] + dz2 * W[\"w21\"]  # x1 feeds BOTH hidden neurons",
      "dx2 = dz1 * W[\"w12\"] + dz2 * W[\"w22\"]",
      "",
      "NUMPY = {",
      "    \"x1\": (X1, dx1), \"x2\": (X2, dx2), \"y\": (Y, dy),",
      "    \"w11\": (W[\"w11\"], dw11), \"w12\": (W[\"w12\"], dw12),",
      "    \"b_1\": (W[\"b_1\"], db_1), \"w21\": (W[\"w21\"], dw21),",
      "    \"w22\": (W[\"w22\"], dw22), \"b_2\": (W[\"b_2\"], db_2),",
      "    \"u1\": (W[\"u1\"], du1), \"u2\": (W[\"u2\"], du2), \"b_o\": (W[\"b_o\"], dbo),",
      "    \"h1\": (h1, dh1), \"h2\": (h2, dh2), \"o\": (o, do), \"e\": (e, de), \"L\": (L, dL),",
      "}",
      "",
      "ORDER = [\"x1\", \"x2\", \"y\", \"w11\", \"w12\", \"b_1\", \"w21\", \"w22\", \"b_2\",",
      "         \"u1\", \"u2\", \"b_o\", \"h1\", \"h2\", \"o\", \"e\", \"L\"]",
      "print(\"preset 12 — nanograd.js tape vs hand-derived NumPy chain rule\")",
      "print(\"node | tape value        | numpy value       | tape grad         | numpy grad        | match\")",
      "worst_v, worst_g = 0.0, 0.0",
      "for name in ORDER:",
      "    tv, tg = TAPE[name]",
      "    nv, ng = NUMPY[name]",
      "    dv, dg = abs(tv - float(nv)), abs(tg - float(ng))",
      "    worst_v, worst_g = max(worst_v, dv), max(worst_g, dg)",
      "    ok = dv < 1e-9 and dg < 1e-9",
      "    print(\"%-4s | %.12f | %.12f | %+.12f | %+.12f | %s\"",
      "          % (name, tv, float(nv), tg, float(ng), \"OK\" if ok else \"DIFF\"))",
      "print(\"worst |value| deviation: %.3e   worst |grad| deviation: %.3e\"",
      "      % (worst_v, worst_g))",
      "passed = worst_v < 1e-9 and worst_g < 1e-9",
      "print(\"TAPE PARITY CHECK: \" + (\"PASS\" if passed else \"FAIL\"))",
      "if not passed:",
      "    raise SystemExit(1)"
    ].join('\n');
    var SPIKE_ATTN13_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Preset 13 — NumPy Transformer Block: causal self-attention, fwd + bwd",
      "#",
      "# One self-contained transformer block in ~80 lines of NumPy: token",
      "# embedding lookup, Q/K/V projections, scaled dot-product attention with",
      "# a CAUSAL mask (lower-triangular: each position only sees itself and the",
      "# past, -inf above the diagonal), attended values, output projection.",
      "# Then a full hand-derived backward pass: dL/dWq, dL/dWk, dL/dWv, dL/dWo",
      "# and dL/dE (embeddings) via the softmax jacobian and the chain rule.",
      "#",
      "# This is the exact math the Train tab's MicroFormer runs in JS",
      "# (attention.js) — same equations, smaller numbers, fully visible.",
      "#",
      "# Deterministic: np.random.seed(1337), no clock, no dict ordering in any",
      "# output path — run 1 and run 10 print byte-identical text.",
      "# ─────────────────────────────────────────────────────────────────",
      "import numpy as np",
      "",
      "np.random.seed(1337)",
      "",
      "TOKENS = [1, 4, 2, 7]   # input token ids (T = 4)",
      "V, D = 8, 8             # vocab size, model width",
      "",
      "E  = np.random.randn(V, D) * np.sqrt(2.0 / (V + D))  # token embeddings",
      "Wq = np.random.randn(D, D) * np.sqrt(2.0 / (D + D))",
      "Wk = np.random.randn(D, D) * np.sqrt(2.0 / (D + D))",
      "Wv = np.random.randn(D, D) * np.sqrt(2.0 / (D + D))",
      "Wo = np.random.randn(D, D) * np.sqrt(2.0 / (D + D))",
      "",
      "",
      "def softmax_rows(z):",
      "    z = z - z.max(axis=1, keepdims=True)",
      "    e = np.exp(z)",
      "    return e / e.sum(axis=1, keepdims=True)",
      "",
      "",
      "# ── forward ──",
      "T = len(TOKENS)",
      "X = E[TOKENS]                                  # (T, D) embedding lookup",
      "Q, K, Vv = X @ Wq, X @ Wk, X @ Wv              # projections",
      "S = Q @ K.T / np.sqrt(D)                       # raw q.k scores",
      "M = np.triu(np.ones((T, T)), k=1)              # causal mask: 1 above diag",
      "S = np.where(M == 1, -np.inf, S)               # future -> -inf",
      "W = softmax_rows(S)                            # attention weights (T, T)",
      "A = W @ Vv                                     # attended values",
      "O = A @ Wo                                     # output projection",
      "loss = float(O.sum())                          # toy loss: sum of outputs",
      "",
      "# ── backward (hand-derived chain rule) ──",
      "dO = np.ones_like(O)                           # dL/dO, L = sum(O)",
      "dWo = A.T @ dO",
      "dA = dO @ Wo.T",
      "dW = dA @ Vv.T                                 # dL/dW",
      "dVv = W.T @ dA",
      "dS = W * (dW - (W * dW).sum(axis=1, keepdims=True))  # softmax jacobian",
      "dS = np.where(M == 1, 0.0, dS)                 # masked slots: no gradient",
      "dQ = dS @ K / np.sqrt(D)",
      "dK = dS.T @ Q / np.sqrt(D)",
      "dX = dQ @ Wq.T + dK @ Wk.T + dVv @ Wv.T",
      "dWq = X.T @ dQ",
      "dWk = X.T @ dK",
      "dWv = X.T @ dVv",
      "dE = np.zeros_like(E)",
      "np.add.at(dE, TOKENS, dX)                      # scatter token grads",
      "",
      "print(\"preset 13 - NumPy causal self-attention (seed 1337), tokens [1,4,2,7]\")",
      "print(\"attention weights W = softmax(QK^T/sqrt(d) + mask), rows = query:\")",
      "for i in range(T):",
      "    print(\"  q%d -> [\" % i + \" \".join(\"%.4f\" % v for v in W[i]) + \"]\")",
      "masked = W[np.triu_indices(T, 1)]",
      "print(\"causal mask: upper triangle exactly zero:\", bool((masked == 0).all()))",
      "print(\"row sums:\", \" \".join(\"%.4f\" % s for s in W.sum(axis=1)))",
      "print(\"loss (sum of outputs) = %.6f\" % loss)",
      "print(\"dL/dWq[0,:4] = [\" + \" \".join(\"%.4f\" % v for v in dWq[0, :4]) + \"]\")",
      "print(\"dL/dE[1,:4]  = [\" + \" \".join(\"%.4f\" % v for v in dE[1, :4]) + \"]\")",
      "print(\"PRESET 13 COMPLETE\")",
      ""
    ].join('\n');
    var SPIKE_ARM14_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Preset 14 — ReverseLab: ARM7TDMI dataset + disassembly parity",
      "#",
      "# The GBA's CPU speaks two languages: 32-bit ARM and 16-bit Thumb.",
      "# This preset does three things:",
      "#   1. re-implements the disassembler's decode rules in pure Python and",
      "#      checks them against the same test vectors the JS engine passes",
      "#      (the preset 12/13 \"parity\" idea),",
      "#   2. generates the same synthetic instruction dataset the Train tab",
      "#      uses (2000 random ARM words -> 5 classes),",
      "#   3. trains a tiny NumPy MLP on it — the \"AI learns to reverse",
      "#      engineer\" step, in ~20 lines.",
      "# ─────────────────────────────────────────────────────────────────",
      "import numpy as np",
      "",
      "np.random.seed(1337)",
      "",
      "CONDS = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC',",
      "         'HI', 'LS', 'GE', 'LT', 'GT', 'LE', '', 'NV']",
      "DPOPS = ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC',",
      "         'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN']",
      "",
      "def ror(v, n):",
      "    n &= 31",
      "    return ((v >> n) | (v << (32 - n))) & 0xFFFFFFFF",
      "",
      "def disasm_arm(word, addr=0x08000000):",
      "    word &= 0xFFFFFFFF",
      "    cond = CONDS[(word >> 28) & 0xF]",
      "    cls26 = (word >> 26) & 3",
      "    b25 = (word >> 25) & 1",
      "    if cls26 == 0:",
      "        if ((word >> 4) & 0xFFFFFF) == 0x12FFF1:",
      "            r = word & 0xF",
      "            return \"BX%s %s\" % (cond, \"lr\" if r == 14 else \"r%d\" % r)",
      "        if ((word >> 22) & 0x3F) == 0 and ((word >> 4) & 0xF) == 9:",
      "            rd = (word >> 16) & 0xF",
      "            return \"MUL%s r%d, r%d, r%d\" % (cond, rd, word & 0xF, (word >> 8) & 0xF)",
      "        op = (word >> 21) & 0xF",
      "        S = (word >> 20) & 1",
      "        rd, rn_ = (word >> 12) & 0xF, (word >> 16) & 0xF",
      "        if b25:",
      "            op2 = \"#%d\" % ror(word & 0xFF, ((word >> 8) & 0xF) * 2)",
      "        else:",
      "            op2 = \"r%d\" % (word & 0xF)",
      "        m = DPOPS[op] + cond + (\"S\" if S else \"\")",
      "        if op in (13, 15):",
      "            return \"%s r%d, %s\" % (m, rd, op2)",
      "        return \"%s r%d, r%d, %s\" % (m, rd, rn_, op2)",
      "    if cls26 == 2 and b25 == 1:",
      "        off = word & 0xFFFFFF",
      "        if off & 0x800000:",
      "            off -= 0x1000000",
      "        tgt = (addr + 8 + (off << 2)) & 0xFFFFFFFF",
      "        return \"%s%s 0x%08X\" % (\"BL\" if (word >> 24) & 1 else \"B\", cond, tgt)",
      "    return \"???\"",
      "",
      "print(\"── 1. disassembly parity (Python rules vs JS engine vectors) ──\")",
      "VECTORS = [",
      "    (0xE3A00001, \"MOV r0, #1\"),",
      "    (0xE0812000, \"ADD r2, r1, r0\"),",
      "    (0xE12FFF1E, \"BX lr\"),",
      "    (0xE0000091, \"MUL r0, r1, r0\"),",
      "    (0xEA000000, \"B 0x08000008\"),",
      "]",
      "ok = 0",
      "for w, want in VECTORS:",
      "    got = disasm_arm(w)",
      "    match = (got == want)",
      "    ok += match",
      "    print(\"  %s 0x%08X -> %s%s\" % (\"PASS\" if match else \"FAIL\", w, got,",
      "                                  \"\" if match else \"  (want %s)\" % want))",
      "print(\"parity: %d/%d vectors agree\" % (ok, len(VECTORS)))",
      "",
      "print(\"── 2. synthetic instruction dataset (mirrors arm7.js) ──\")",
      "def arm_class(w):",
      "    cls26 = (w >> 26) & 3",
      "    b25 = (w >> 25) & 1",
      "    if cls26 == 2 and b25 == 1:",
      "        return 2",
      "    if cls26 in (1, 2):",
      "        return 1",
      "    if cls26 == 3 and ((w >> 24) & 0xF) == 0xF:",
      "        return 4",
      "    if cls26 == 0:",
      "        if ((w >> 22) & 0x3F) == 0 and ((w >> 4) & 0xF) == 9:",
      "            return 3",
      "        if ((w >> 4) & 0xFFFFFF) == 0x12FFF1:",
      "            return 4",
      "        return 0",
      "    return 4",
      "",
      "def arm_features(w):",
      "    return np.array([",
      "        ((w >> 28) & 0xF) / 15.0,",
      "        ((w >> 26) & 3) / 3.0,",
      "        float((w >> 25) & 1),",
      "        ((w >> 21) & 0xF) / 15.0,",
      "        float((w >> 20) & 1),",
      "        ((w >> 16) & 0xF) / 15.0,",
      "        ((w >> 12) & 0xF) / 15.0,",
      "        (w & 0xFFF) / 4095.0,",
      "    ])",
      "",
      "N = 2000",
      "def g_dp():  return 0xE0000000 | np.random.randint(0, 0x1000000)",
      "def g_ls():  return 0xE4000000 | np.random.randint(0, 0x2000000)",
      "def g_br():  return 0xEA000000 | np.random.randint(0, 0x2000000)",
      "def g_mul(): return 0xE0000090 | (np.random.randint(0, 256) << 8)",
      "def g_misc(): return 0xE12FFF10 | np.random.randint(0, 16)",
      "gens = [g_dp, g_ls, g_br, g_mul, g_misc]",
      "X = np.zeros((N, 8))",
      "y = np.zeros(N, dtype=int)",
      "for i in range(N):",
      "    r = np.random.rand()",
      "    g = 0 if r < 0.40 else 1 if r < 0.70 else 2 if r < 0.85 else 3 if r < 0.90 else 4",
      "    w = gens[g]() & 0xFFFFFFFF",
      "    X[i] = arm_features(w)",
      "    y[i] = arm_class(w)",
      "names = ['dataproc', 'loadstore', 'branch', 'multiply', 'misc']",
      "dist = \", \".join(\"%s:%d\" % (names[c], int((y == c).sum())) for c in range(5))",
      "print(\"2000 words -> \" + dist)",
      "",
      "print(\"── 3. tiny NumPy MLP learns the bit-fields ──\")",
      "def softmax(z):",
      "    z = z - z.max(axis=1, keepdims=True)",
      "    e = np.exp(z)",
      "    return e / e.sum(axis=1, keepdims=True)",
      "",
      "W1 = np.random.randn(8, 16) * 0.5",
      "b1 = np.zeros(16)",
      "W2 = np.random.randn(16, 5) * 0.5",
      "b2 = np.zeros(5)",
      "Y = np.eye(5)[y]",
      "lr = 0.5",
      "for ep in range(300):",
      "    h = np.tanh(X @ W1 + b1)",
      "    p = softmax(h @ W2 + b2)",
      "    g = (p - Y) / N",
      "    gW2 = h.T @ g",
      "    gb2 = g.sum(axis=0)",
      "    gh = (g @ W2.T) * (1 - h ** 2)",
      "    W2 -= lr * gW2",
      "    b2 -= lr * gb2",
      "    W1 -= lr * (X.T @ gh)",
      "    b1 -= lr * gh.sum(axis=0)",
      "pred = softmax(np.tanh(X @ W1 + b1) @ W2 + b2).argmax(axis=1)",
      "acc = (pred == y).mean()",
      "print(\"NumPy MLP 8->16->5, 300 steps: train accuracy %.1f%%\" % (100 * acc))",
      "print(\"The Train tab runs this same dataset bigger and deeper.\")",
      "print(\"Lesson: instruction classes live in the bit-fields — networks find them.\")",
      "print(\"That is the whole trick behind ML-assisted reverse engineering.\")",
    ].join('\n');
    var SPIKE_Q15_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Preset 15 — QuantumVM: Bell parity",
      "#",
      "# Two \"atoms\" (qubits), entangled. This preset re-implements the",
      "# QuantumVM tab's state-vector math in pure NumPy and parity-checks",
      "# it against the JS engine's own Bell-state output — the preset",
      "# 12/13/14 \"parity\" idea, now for quantum mechanics.",
      "# ─────────────────────────────────────────────────────────────────",
      "import numpy as np",
      "",
      "SQRT1_2 = 1.0 / np.sqrt(2.0)",
      "",
      "def apply_1q(state, q, mat):",
      "    # mat: 2x2 complex; qubit q is the q-th bit (little-endian, like the tab)",
      "    out = np.zeros_like(state)",
      "    for i in range(state.shape[0]):",
      "        if ((i >> q) & 1) == 0:",
      "            j = i | (1 << q)",
      "            a0, a1 = state[i], state[j]",
      "            out[i] = mat[0, 0] * a0 + mat[0, 1] * a1",
      "            out[j] = mat[1, 0] * a0 + mat[1, 1] * a1",
      "    return out",
      "",
      "def apply_cnot(state, c, t):",
      "    out = state.copy()",
      "    for i in range(state.shape[0]):",
      "        if (i >> c) & 1:",
      "            j = i ^ (1 << t)",
      "            if j > i:",
      "                out[i], out[j] = state[j], state[i]",
      "    return out",
      "",
      "H = SQRT1_2 * np.array([[1, 1], [1, -1]], dtype=complex)",
      "",
      "# the Bell circuit from the ⚛️ tab:  H 0  ;  CNOT 0 1",
      "psi = np.zeros(4, dtype=complex); psi[0] = 1.0",
      "psi = apply_1q(psi, 0, H)",
      "psi = apply_cnot(psi, 0, 1)",
      "",
      "print(\"Bell state (|00> + |11>)/sqrt(2):\")",
      "for i, a in enumerate(psi):",
      "    print(\"  |%s>  %.6f%+.6fi   p=%.4f\" % (format(i, '02b'), a.real, a.imag, abs(a) ** 2))",
      "",
      "# ── parity vs the JS QuantumVM's own output ──",
      "JS_BELL = np.array([0.70710678118654757, 0, 0, 0.70710678118654757], dtype=complex)",
      "err = np.max(np.abs(psi - JS_BELL))",
      "print(\"max |psi_py - psi_js| = %.2e\" % err)",
      "print(\"PARITY \" + (\"OK -- NumPy and the QuantumVM agree\" if err < 1e-9 else \"FAIL\"))",
      "",
      "# ── entanglement check: single-qubit purity (trace out qubit 1) ──",
      "rho00 = abs(psi[0]) ** 2 + abs(psi[1]) ** 2",
      "rho11 = abs(psi[2]) ** 2 + abs(psi[3]) ** 2",
      "rho01 = psi[0] * np.conj(psi[2]) + psi[1] * np.conj(psi[3])",
      "purity = rho00 ** 2 + rho11 ** 2 + 2 * abs(rho01) ** 2",
      "print(\"qubit-0 purity = %.4f  (0.5 = maximally entangled)\" % purity)",
      "",
      "# ── 1000 simulated measurements ──",
      "rng = np.random.default_rng(7)",
      "shots = rng.choice(4, size=1000, p=np.abs(psi) ** 2)",
      "c00 = int((shots == 0).sum()); c11 = int((shots == 3).sum())",
      "print(\"1000 shots: |00> x%d   |11> x%d\" % (c00, c11))",
      "print(\"Two atoms, one fate: measure one, you instantly know the other.\")",
      "print(\"PRESET 15 COMPLETE\")",
      ""
    ].join('\\n');
    var SPIKE_EVO16_DEMO = [
      "# ─────────────────────────────────────────────────────────────────",
      "# Preset 16 — Quantum Nexus Core",
      "# Named by Ahkeem, 2026-10-03.",
      "#",
      "# Ahkeem's self-modifying AI design, running for real in NumPy:",
      "#   1. ErrorLoop core  — recurrent predictive-coding loop that never settles",
      "#   2. Qubit beliefs   — yes/no held as a|yes> + b|no>; evidence rotates",
      "#                        the amplitudes; measurement = decision",
      "#   3. Real-time decoder — the prediction readout: loop state -> number,",
      "#                        every timestep",
      "#   4. Immutable snapshots — frozen copies at generation boundaries",
      "#   5. Evolution        — mutate decoder, keep lowest error, error falls",
      "#",
      "# Honest labels: this is a CLASSICAL simulation running on your phone's",
      "# CPU. The \"quantum language\" is the state-vector math from preset 15.",
      "# The pieces have prior art — predictive coding (neuroscience/ML),",
      "# self-modifying code (Schmidhuber's Goedel machine), evolutionary",
      "# computation. The synthesis — this loop — is Ahkeem's.",
      "# ─────────────────────────────────────────────────────────────────",
      "import numpy as np",
      "import copy",
      "import json",
      "import time",
      "",
      "RESUME_JSON = None  # v35: paste a champion JSON (⤓ export it from the",
      "                    # 🌀 Nexus panel) to CONTINUE its lineage under Chaquopy.",
      "                    # None = fresh run, behavior unchanged.",
      "",
      "DEPTH = 1  # v39 Deep Core: stacked recurrent layers — 1 = the exact",
      "           # reference curve; try 3 for the deep Core (the 🌀 visualizer",
      "           # defaults to 3). Layer 0 takes the input signal; each higher",
      "           # layer takes the FRESH state of the layer below.",
      "ACT = 'tanh'  # v39: tanh | relu | sigmoid — differentiable",
      "              # nonlinearities between the layers; the decoder error",
      "              # stays differentiable end-to-end through the stack.",
      "",
      "HORIZON_ON = False  # v40 Event Horizon — Ahkeem's black-hole neuron",
      "                    # experiment (paradox-INSPIRED classical sim). True:",
      "                    # the top layer's M states collide pairwise through a",
      "                    # learnable gravity matrix G into K outputs",
      "                    #   y_k = tanh(sum_ij G_kij * h_i * h_j)  (M -> K),",
      "                    # while exterior partners track the outputs but NEVER",
      "                    # fall in. Fidelity = mean |corr(partner, output)|.",
      "                    # Entanglement-inspired link ON (HORIZON_ENT): partners whisper back",
      "                    # (gamma) + fidelity pressure joins selection.",
      "HORIZON_M, HORIZON_K = 6, 2",
      "HORIZON_ENT = True",
      "HZ_GAMMA, HZ_ALPHA, HZ_LAMBDA = 0.3, 0.2, 0.3",
      "",
      "# v41 Ghost Snapshots — Ahkeem's workaround for no quantum entanglement:",
      "# before compression, freeze an exact copy of the pre-compression state",
      "# (checksummed JSON — NOT .vmdk/.vhd: a disk-container format would wrap",
      "# a few KB of neuron state in overhead for zero benefit). The ghost feeds",
      "# the top layer (the 3rd core loop at depth 3), damped — the horizon's",
      "# victims teach the Core. Off by default: the reference asserts below",
      "# require the v39 pipeline untouched, and ghosts only freeze when the",
      "# horizon is on.",
      "GHOST_FB = False",
      "GHOST_GAIN = 0.15  # damping gain, 0..0.5 — the loop cannot run away",
      "",
      "# v42 Antimatter — Ahkeem's ghost-built inner superloop (honest labels):",
      "# recovering a ghost crawls the LOCAL ghost archive (similarity hops,",
      "# ghost→ghost — not a web crawler, no network), stacks relatives in a",
      "# bounded container, then a SEEDED stochastic spawn roll (match →",
      "# amplitude → p=|a|^2, Born-rule-style like the qubit belief) decides.",
      "# A fired roll INTERPRETS a JSON recipe (never generated code — dynamic",
      "# code execution is a security boundary) to compose a small recurrent",
      "# inner loop from ghost states: it reads every layer, updates only",
      "# itself, publishes where the Core can read. Write-protection is",
      "# enforced both ways — reads only, never cross-writes.",
      "# Off by default: the reference asserts below require the pipeline",
      "# untouched.",
      "AM_ON = False",
      "AM_GAIN = 0.1  # publish gain, 0..0.3 — bounded",
      "",
      "# v43 Gauntlet — Gemini's five recommendations, honestly labeled.",
      "# ALL default OFF: the reference asserts below require the pipeline",
      "# untouched, exactly as v40-v42 did.",
      "#   SHOCK_TYPE: None | 'freq' | 'phase' | 'noise' — seeded regime shock",
      "#     injected into the target stream (the shock lab's falsifiability",
      "#     experiment lives in the JS engine; here the shock just perturbs).",
      "#   VAL_ON: held-out validation window — pristine t in [T, 2T), no",
      "#     learning, scored per variant (generalization, not memorization).",
      "#   AUTOPILOT: decay-law switch — rolling error slope below threshold",
      "#     fires a mutation burst + redundant-unit compression (full",
      "#     lifecycle in the JS engine; noted here).",
      "#   MO_ON: multi-objective fitness F = w1*(1-err) + w2*fid - w3*cpx,",
      "#     with w1/w2/w3 below (defaults 0.6/0.25/0.15).",
      "#   STAB_ON: LayerNorm after every recurrent update (keeps activations",
      "#     honest over long runs — classical stability, not quantum).",
      "#   CHAR_TASK: the tiny char-RNN milestone runs in the JS engine",
      "#     (charrnn.js) — not in this preset.",
      "SHOCK_TYPE = None",
      "VAL_ON = False",
      "AUTOPILOT = False",
      "MO_ON = False",
      "MO_W1, MO_W2, MO_W3 = 0.6, 0.25, 0.15",
      "STAB_ON = False",
      "CHAR_TASK = False",
      "",
      "# v45 Mirror — masked-token training (BERT-style) + Export for J.A.R.V.I.S.",
      "# The char-RNN trains in the JS engine (charrnn.js): ~15% seeded masks,",
      "# forward-encode visible context, freeze the hidden state as a ghost",
      "# (uncommitted — no token yet), reverse-decode the masked char from the",
      "# frozen ghost. Loss on masked positions only. Classical throughout:",
      "# the ghost is a copied state vector; the RNN is causal (left-context).",
      "# The export bundle is a JS-side feature (Downloads JSON).",
      "# All default OFF: the reference asserts below require the pipeline",
      "# untouched.",
      "MASKED_ON = False",
      "MASK_RATE = 0.15  # seeded mask fraction, 0.05..0.4",
      "MASK_SEED = 7",
      "",
      "# v46 Atomic — the periodic-table network (JS engine, atomic.js).",
      "# 118 bundled elements; three tasks: property prediction (held-out",
      "# elements, must beat mean-baseline), masked-property reconstruction",
      "# (ghost holds context, output decodes), element embeddings + PCA.",
      "# Honest frame: the table encodes known physics — the net rediscovers",
      "# the periodic law from data; it does not discover new physics.",
      "# All default OFF: the reference asserts below require the pipeline",
      "# untouched.",
      "ATOMIC_ON = False",
      "ATOMIC_TASK = 'predict'  # predict | masked | embed",
      "ATOMIC_PROP = 'en'      # en | ie | radius",
      "ATOMIC_EPOCHS = 300",
      "ATOMIC_LR = 0.05",
      "",
      "# v44 Annihilation — Gemini's antimatter concretization + bidirectional",
      "# inversion (full machinery lives in the JS engine; noted here).",
      "# ALL default OFF: the reference asserts below require the pipeline",
      "# untouched, exactly as v40-v43 did.",
      "#   AM_RESID_ON: anti-correlated residual publish — annihilate the",
      "#     shared projection with the layer state, publish only the damped",
      "#     orthogonal residual (else legacy raw publish).",
      "#   AM_SIGNINV: sign inversion on the antimatter path (-tanh) —",
      "#     inverts positive error drives to cancel recurring bias.",
      "#   AM_ZEROSUM: zero-sum matter/antimatter weight pairing at spawn",
      "#     (AM.W = -(top-layer W), asserted) — divergence is the learned",
      "#     asymmetry.",
      "#   INV_ON: bidirectional inversion mode — freeze the forward ghost,",
      "#     propagate the mismatch downward, read the reconstruction from",
      "#     Layer 1 (future CTF cipher machinery).",
      "AM_RESID_ON = False",
      "AM_SIGNINV = False",
      "AM_ZEROSUM = False",
      "INV_ON = False",
      "",
      "rng = np.random.default_rng(16)",
      "",
      "D = 6        # hidden dim (small = phone-friendly)",
      "T = 40       # timesteps per run",
      "LR = 0.05",
      "",
      "",
      "def target_stream(t):",
      "    # the world the loop must track: drifting sines, never still",
      "    return np.sin(0.3 * t) + 0.5 * np.sin(0.11 * t + 1.0)",
      "",
      "",
      "_ACTS = {  # v39 Deep Core: differentiable nonlinearities between layers",
      "    'tanh': np.tanh,",
      "    'relu': lambda z: np.maximum(z, 0.0),",
      "    'sigmoid': lambda z: 1.0 / (1.0 + np.exp(-z)),",
      "}",
      "# GRADIENT PATH (documented per the Deep Core spec): the decoder error",
      "#   e = y_true - V·h_top",
      "# drives EVERY layer's recurrent weights, gentler with depth:",
      "#   W_l += (LR/(l+1))·outer(e·V, h_l_new).",
      "# Deeper layers sit further from the error signal, so their updates are",
      "# noisier — discriminative rates keep the stack stable. Layer 0 keeps the",
      "# exact reference rate. The decoder learns:  V += LR·e·h_top_new.",
      "# All activations are differentiable, so the error path is well-defined",
      "# end-to-end. Each layer transforms the representation of the layer below",
      "# (its input IS the below layer's fresh state); the top layer feeds the",
      "# decoder V and the qubit belief phi, unchanged. Honest simplification:",
      "# the error is broadcast top-down rather than passed as per-layer error",
      "# units up the stack. pe[] below is a representation-quality readout",
      "# (reconstruction of the below layer through U_l^T) — dashboard only.",
      "# A ±10 stability clamp keeps ReLU honest (no-op for tanh/sigmoid).",
      "",
      "",
      "class ErrorLoop:",
      "    \"\"\"Deep predictive-coding recurrent core (v39 Deep Core).",
      "    A STACK of recurrent layers: layer 0 takes the input signal x, each",
      "    higher layer takes the FRESH state of the layer below. Predicts,",
      "    errs, rewrites itself — through every layer.\"\"\"",
      "    def __init__(self, rng, depth=DEPTH, act=ACT):",
      "        self.depth = depth",
      "        self.act = act",
      "        self.actfn = _ACTS[act]",
      "        # layer 0: RNG stream bit-identical to the reference (W, U, V in order)",
      "        W0 = rng.normal(0, 0.5, (D, D))   # recurrent weights (self-mutating)",
      "        U0 = rng.normal(0, 0.5, (D,))     # input weights (fixed wiring)",
      "        self.V = rng.normal(0, 0.5, (D,))  # prediction readout = the decoder",
      "        layers = [{'W': W0, 'U': U0, 'h': np.zeros(D)}]",
      "        for _k in range(1, depth):",
      "            # v39: depth-scaled init — deeper layers start in the linear regime",
      "            # (Xavier-style). Without this, deep random stacks can start where",
      "            # the broadcast error cannot coordinate them (observed: divergence).",
      "            # The RNG stream order is unchanged; the draws are only scaled.",
      "            _Wk = rng.normal(0, 0.5, (D, D)) / np.sqrt(_k + 1)",
      "            layers.append({",
      "                'W': _Wk,",
      "                'U': rng.normal(0, 0.5, (D, D)),  # fixed random projection",
      "                'h': np.zeros(D),",
      "                'F': rng.normal(0, 0.5, (D,)),  # learned feedback (v39c)",
      "            })",
      "        self.layers = layers",
      "        self._pe_sum = [0.0] * max(0, depth - 1)",
      "        self._pe_n = 0",
      "        # v40 Event Horizon: gravity compressor between the top layer and",
      "        # the decoder. G is drawn from a dedicated RNG stream so the",
      "        # reference RNG stream (W, U, V, F) is bit-identical when off.",
      "        self.hz = None",
      "        if HORIZON_ON:",
      "            _M = min(HORIZON_M, D); _K = min(HORIZON_K, _M - 1)",
      "            _hr = np.random.default_rng(0x9e3779b9)",
      "            self.hz = {",
      "                'M': _M, 'K': _K, 'ent': bool(HORIZON_ENT),",
      "                'G': _hr.normal(0, 0.15, (_K, _M, _M)),",
      "                'A': _hr.normal(0, 0.5, (_K, _M)),",
      "                'Vh': _hr.normal(0, 0.5, (_K,)),",
      "                'p': np.zeros(_K), 'fid': None,",
      "                '_n': np.zeros(_K), '_sp': np.zeros(_K), '_sy': np.zeros(_K),",
      "                '_spy': np.zeros(_K), '_sp2': np.zeros(_K), '_sy2': np.zeros(_K),",
      "            }",
      "",
      "    def zero_state(self):",
      "        for lay in self.layers:",
      "            lay['h'] = np.zeros(D)",
      "        self._pe_sum = [0.0] * max(0, self.depth - 1)",
      "        self._pe_n = 0",
      "        if self.hz is not None:  # v40: fresh exterior per episode",
      "            self.hz['p'] = np.zeros(self.hz['K'])",
      "            self.hz['fid'] = None",
      "            self.hz['_n'] = np.zeros(self.hz['K'])",
      "            self.hz['_sp'] = np.zeros(self.hz['K'])",
      "            self.hz['_sy'] = np.zeros(self.hz['K'])",
      "            self.hz['_spy'] = np.zeros(self.hz['K'])",
      "            self.hz['_sp2'] = np.zeros(self.hz['K'])",
      "            self.hz['_sy2'] = np.zeros(self.hz['K'])",
      "",
      "    def horizon_fidelity(self):",
      "        # v40: mean |Pearson r| between each exterior partner's trajectory",
      "        # and its horizon output's trajectory. Centered: a saturated,",
      "        # constant channel scores ~0, not 1 — the metric must not reward",
      "        # a dead black hole.",
      "        hz = self.hz",
      "        if hz is None: return None",
      "        fs = []",
      "        for k in range(hz['K']):",
      "            n = float(hz['_n'][k])",
      "            if n < 4: continue",
      "            mp = float(hz['_sp'][k]) / n; my = float(hz['_sy'][k]) / n",
      "            vp = float(hz['_sp2'][k]) / n - mp * mp",
      "            vy = float(hz['_sy2'][k]) / n - my * my",
      "            if vp > 1e-10 and vy > 1e-10:",
      "                cov = float(hz['_spy'][k]) / n - mp * my",
      "                fs.append(min(1.0, max(0.0, abs(cov) / np.sqrt(vp * vy))))",
      "        return float(np.mean(fs)) if fs else 0.0",
      "",
      "    def step(self, x, y_true):",
      "        top_h = self.layers[-1]['h']",
      "        y_pred = float(self.V @ top_h)  # decode TOP-layer state -> number",
      "        err = y_true - y_pred           # the error signal: the loop's fuel",
      "        _hz = self.hz",
      "        _h_in = _y_h = _Fbh = None",
      "        if _hz is not None:",
      "            # v40: infall through the gravity matrix; exterior whisper",
      "            _M, _K = _hz['M'], _hz['K']",
      "            _gam = HZ_GAMMA if _hz['ent'] else 0.0",
      "            # v40d: the whisper is multiplicative and bounded — scales the",
      "            # infalling state by (1+gam*tanh p); an additive whisper let a",
      "            # drifting partner drag the operating point (Vh runaway).",
      "            _h_in = top_h[:_M].copy()",
      "            _h_w = np.clip(top_h[:_M] * (1.0 + _gam * np.tanh(_hz['p'][np.arange(_M) % _K])), -10.0, 10.0)",
      "            _s = np.einsum('kij,i,j->k', _hz['G'], _h_in, _h_in) + _hz['A'] @ _h_w",
      "            _y_h = np.tanh(_s)",
      "            y_pred = float(_hz['Vh'] @ _y_h)",
      "            err = y_true - y_pred",
      "            # v40: partners couple ONLY when entangled — OFF = inert control.",
      "            if _hz['ent']:",
      "                _hz['p'] += HZ_ALPHA * (_y_h - _hz['p'])",
      "                _hz['_n'] += 1.0",
      "                _hz['_sp'] += _hz['p']; _hz['_sy'] += _y_h",
      "                _hz['_spy'] += _hz['p'] * _y_h",
      "                _hz['_sp2'] += _hz['p'] ** 2",
      "                _hz['_sy2'] += _y_h ** 2",
      "            # true gradient feedback through the quadratic+linear compressor.",
      "            # v40c: x1/2 — the horizon counts as an extra layer (discriminative",
      "            # rate); v40d: A term carries the multiplicative whisper factor.",
      "            _dy = 1.0 - _y_h ** 2",
      "            _Fbh = np.zeros(D)",
      "            _pw = 1.0 + _gam * np.tanh(_hz['p'][np.arange(_M) % _K])",
      "            for _i in range(_M):",
      "                _ds = sum(_hz['Vh'][_k] * _dy[_k] *",
      "                          (_hz['A'][_k, _i] * _pw[_i] +",
      "                           ((_hz['G'][_k, _i, :] + _hz['G'][_k, :, _i]) @ _h_in))",
      "                        for _k in range(_K))",
      "                _Fbh[_i] = (float(len(self.layers)) / float(len(self.layers) + 1)) * _ds",
      "        new_hs = []",
      "        for l, lay in enumerate(self.layers):",
      "            _is_top = (l == len(self.layers) - 1)",
      "            if l == 0:",
      "                # reference path — at depth=1 + tanh this is bit-identical",
      "                # to the original single-layer step; with the horizon on,",
      "                # the top layer's feedback runs through the compressor",
      "                _fb = _Fbh if (_hz is not None and _is_top) else self.V",
      "                pre = lay['W'] @ lay['h'] + lay['U'] * x + 0.3 * err * _fb",
      "            else:",
      "                # task formula: h_l = act(W_l·h_l + U_l·h_{l-1}^new) — pure",
      "                # feedforward-recurrent, no error injection into upper states",
      "                pre = lay['W'] @ lay['h'] + lay['U'] @ new_hs[l - 1]",
      "                if _hz is not None and _is_top:",
      "                    # v40: the top layer's error pathway runs through the horizon",
      "                    pre = pre + 0.3 * err * _Fbh",
      "            new_hs.append(np.clip(self.actfn(pre), -10.0, 10.0))",
      "        if self.depth > 1:  # per-layer prediction-error readout (dashboard)",
      "            for l in range(1, self.depth):",
      "                rec = self.layers[l]['U'].T @ new_hs[l]",
      "                self._pe_sum[l - 1] += float(np.mean(np.abs(new_hs[l - 1] - rec)))",
      "            self._pe_n += 1",
      "        for l, lay in enumerate(self.layers):",
      "            nh = new_hs[l]",
      "            # discriminative rates: deeper layers learn gentler (l=0: exact LR)",
      "            # v39c: each layer learns via its OWN feedback (F_0 = V)",
      "            # v40: the top layer's feedback runs through the horizon when on",
      "            _is_top = (l == len(self.layers) - 1)",
      "            Fb = _Fbh if (_hz is not None and _is_top) else (self.V if l == 0 else lay['F'])",
      "            lay['W'] += (LR / (l + 1)) * np.outer(err * Fb, nh)",
      "            if l > 0:",
      "                # v39c: F learns with the discriminative rate too (deeper =",
      "                # gentler) — full-rate F learning destabilizes deep stacks",
      "                lay['F'] += (LR / (l + 1)) * err * nh",
      "            lay['h'] = nh",
      "        if _hz is not None:",
      "            # v40: the horizon decoder + gravity matrix learn from the same",
      "            # error; the bypassed decoder V is frozen while the horizon",
      "            # owns prediction.",
      "            _hz['Vh'] += LR * err * _y_h",
      "            _dy = 1.0 - _y_h ** 2",
      "            _glr = LR / self.depth",
      "            for _k in range(_hz['K']):",
      "                _ev = err * _hz['Vh'][_k] * _dy[_k]",
      "                _hz['G'][_k] += _glr * _ev * np.outer(_h_in, _h_in)",
      "                _hz['A'][_k] += _glr * _ev * _h_w",
      "        else:",
      "            self.V += LR * err * new_hs[-1]",
      "        return y_pred, err",
      "",
      "    def snapshot(self):",
      "        return copy.deepcopy(self)           # immutable frozen copy",
      "",
      "",
      "## v40: sections 1-4 demo the REFERENCE core — the horizon is parked here.",
      "_HORIZON_SAVED = HORIZON_ON; HORIZON_ON = False",
      "print(\"== 1. ErrorLoop core: watch it think (gen 0, first 6 steps) ==\")",
      "print(\"   (reference single-layer core — sections 1-4 demo the reference;\")",
      "print(\"    the evolution in section 5 runs YOUR stack: DEPTH=%d ACT=%s)\" % (DEPTH, ACT))",
      "loop = ErrorLoop(rng, depth=1, act='tanh')",
      "for t in range(6):",
      "    x = 0.5 * np.sin(0.05 * t)",
      "    y = target_stream(t)",
      "    yp, e = loop.step(x, y)",
      "    print(\"  t=%2d  true=%+.3f  pred=%+.3f  err=%+.3f  decoded=%+.3f\"",
      "          % (t, y, yp, e, yp))",
      "",
      "print()",
      "print(\"== 3. real-time decoder: same readout, every timestep ==\")",
      "print(\"   (the V matrix IS the decoder: hidden state -> output number)\")",
      "",
      "print()",
      "print(\"== 4. immutable snapshots: the live loop mutates, the copy is frozen ==\")",
      "live = ErrorLoop(rng, depth=1, act='tanh')",
      "snap = live.snapshot()",
      "frozen_W = snap.layers[0]['W'].copy()",
      "W_drift = []",
      "for t in range(T):",
      "    x = 0.5 * np.sin(0.05 * t)",
      "    _, _ = live.step(x, target_stream(t))",
      "    W_drift.append(float(np.abs(live.layers[0]['W'] - frozen_W).mean()))",
      "print(\"   live loop mean |dW| vs frozen snapshot: %.4f -> %.4f (keeps changing)\"",
      "      % (W_drift[0], W_drift[-1]))",
      "print(\"   snapshot untouched by live mutation:\",",
      "      bool(np.array_equal(snap.layers[0]['W'], frozen_W)))",
      "assert np.array_equal(snap.layers[0]['W'], frozen_W), \"SNAPSHOT CORRUPTED\"",
      "",
      "print()",
      "print(\"== 2. qubit beliefs: yes/no held at once, evidence rotates, measure = decide ==\")",
      "print(\"   proposition: 'my decoded sign matches the world'  |0> = yes, |1> = no\")",
      "phi = np.pi / 2                    # start undecided: 50/50",
      "bel = ErrorLoop(rng, depth=1, act='tanh')  # fresh loop so the trajectory is clean",
      "traj = []",
      "for t in range(20):",
      "    x = 0.5 * np.sin(0.05 * t)",
      "    y = target_stream(t)",
      "    yp, _ = bel.step(x, y)",
      "    agree = (yp > 0) == (y > 0)    # decoder agrees with the world? yes-evidence",
      "    phi = float(np.clip(phi - 0.22 * (1 if agree else -1), 0.05, np.pi - 0.05))",
      "    traj.append(float(np.cos(phi / 2) ** 2))",
      "print(\"   p(yes): \" + \" \".join(\"%.2f\" % p for p in traj[::4]) + \" ...\")",
      "print(\"   final p(yes) = %.3f  ->  measurement would decide YES with %.1f%%\"",
      "      % (traj[-1], 100 * traj[-1]))",
      "assert traj[-1] > 0.8, \"belief did not converge\"",
      "",
      "print()",
      "HORIZON_ON = _HORIZON_SAVED  # v40: the evolution runs YOUR stack (horizon as configured)",
      "print(\"== 5. evolution: variation -> selection -> heredity ==\")",
      "print(\"   deep stack: DEPTH=%d ACT=%s — evolution mutates ALL layers' weights\" % (DEPTH, ACT))",
      "G, VARIANTS = 8, 4",
      "_resume = json.loads(RESUME_JSON) if RESUME_JSON else None",
      "if _resume:  # v35: the Core remembers — seed from the saved champion, not random init",
      "    if 'layers' in _resume:  # v39: stacked champion format — adopt its architecture",
      "        DEPTH = int(_resume.get('stack_depth', len(_resume['layers'])))",
      "        ACT = _resume.get('act', 'tanh')",
      "        champion = ErrorLoop(rng, depth=DEPTH, act=ACT)",
      "        for lay, slay in zip(champion.layers, _resume['layers']):",
      "            lay['W'] = np.array(slay['W']); lay['U'] = np.array(slay['U'])",
      "            lay['h'] = np.array(slay['h'])",
      "            # v39c: restore per-layer feedback (l>0); zero-fill if absent",
      "            if 'F' in lay:",
      "                lay['F'] = (np.array(slay['F']) if 'F' in slay",
      "                          else np.zeros(D))",
      "        champion.V = np.array(_resume['V'])",
      "        # v40: restore the gravity matrix + horizon decoder if present",
      "        _rhz = _resume.get('horizon')",
      "        if _rhz and _rhz.get('on') and champion.hz is None:",
      "            _M = min(int(_rhz.get('M', 6)), D); _K = min(int(_rhz.get('K', 2)), _M - 1)",
      "            champion.hz = {",
      "                'M': _M, 'K': _K, 'ent': bool(_rhz.get('ent', True)),",
      "                'G': np.array(_rhz['G']), 'Vh': np.array(_rhz['Vh']),",
      "                'A': (np.array(_rhz['A']) if 'A' in _rhz",
      "                      else np.zeros((_K, _M))),",
      "                'p': np.zeros(_K), 'fid': None,",
      "                '_n': np.zeros(_K), '_sp': np.zeros(_K), '_sy': np.zeros(_K),",
      "                '_spy': np.zeros(_K), '_sp2': np.zeros(_K), '_sy2': np.zeros(_K),",
      "            }",
      "            print(\"   horizon restored: %d->%d gravity matrix, entanglement-inspired link %s\"",
      "                  % (_M, _K, \"ON\" if champion.hz['ent'] else \"OFF\"))",
      "        print(\"   stacked champion: depth %d, act %s\" % (DEPTH, ACT))",
      "    else:  # legacy single-layer champion — migrated to the deep format",
      "        DEPTH, ACT = 1, 'tanh'",
      "        champion = ErrorLoop(rng, depth=1, act='tanh')",
      "        _l0 = champion.layers[0]",
      "        _l0['W'] = np.array(_resume[\"W\"]); _l0['U'] = np.array(_resume[\"U\"])",
      "        champion.V = np.array(_resume[\"V\"]); _l0['h'] = np.array(_resume[\"h\"])",
      "        print(\"   legacy single-layer champion — migrated to the deep format.\")",
      "    err_curve = [float(e) for e in _resume.get(\"err_curve\", [])]",
      "    _gen0 = int(_resume.get(\"gen\", 0))",
      "    print(\"== RESUMED lineage from champion %s (gen %d, err %.4f) ==\"",
      "          % (_resume.get(\"checksum\", \"?\"), _gen0, float(_resume.get(\"err\", 0.0))))",
      "    print(\"   the Core remembers — continuing where the last run ended.\")",
      "else:",
      "    champion = ErrorLoop(rng)  # uses module DEPTH / ACT",
      "    err_curve = []",
      "    _gen0 = 0",
      "for g in range(G):",
      "    snap = champion.snapshot()       # generation boundary: freeze the parent",
      "    best, best_err, best_score, best_fid = None, float(\"inf\"), float(\"inf\"), None",
      "    _pe_acc = [0.0] * max(0, DEPTH - 1)",
      "    for v in range(VARIANTS):",
      "        cand = copy.deepcopy(snap)   # every variant starts from the frozen snapshot",
      "        cand.zero_state()            # fresh episode; the WEIGHTS are the heredity",
      "        if v > 0:                    # variant 0 = exact copy (elitism: never regress)",
      "            cand.V += rng.normal(0, 0.02, cand.V.shape)   # mutate the decoder",
      "            if DEPTH > 1:            # v39: evolution mutates ALL layers' weights",
      "                for lay in cand.layers:",
      "                    lay['W'] += rng.normal(0, 0.01, lay['W'].shape)",
      "            if cand.hz is not None:  # v40: the gravity matrix is genotype too",
      "                cand.hz['Vh'] += rng.normal(0, 0.02, cand.hz['Vh'].shape)",
      "                cand.hz['G'] += rng.normal(0, 0.01, cand.hz['G'].shape)",
      "                cand.hz['A'] += rng.normal(0, 0.01, cand.hz['A'].shape)",
      "        errs = []",
      "        for t in range(T):           # the copy advances its own code as it runs",
      "            x = 0.5 * np.sin(0.05 * t)",
      "            _, e = cand.step(x, target_stream(t))",
      "            errs.append(abs(e))",
      "        m = float(np.mean(errs))",
      "        _fid = cand.horizon_fidelity()",
      "        # v40: with the link ON, fidelity pressure joins selection —",
      "        # the compressor must preserve the exterior correlation.",
      "        _score = m + (HZ_LAMBDA * (1.0 - (_fid or 0.0)) if (HORIZON_ON and HORIZON_ENT) else 0.0)",
      "        if cand._pe_n:",
      "            for _li in range(len(_pe_acc)):",
      "                _pe_acc[_li] += cand._pe_sum[_li] / cand._pe_n",
      "        if _score < best_score:",
      "            best, best_err, best_score, best_fid = cand, m, _score, _fid",
      "    champion, err_curve = best, err_curve + [best_err]   # heredity: winner seeds next",
      "    _pe_line = \"\"",
      "    if DEPTH > 1:",
      "        _pe_line = \"  pe(L1..L%d)=%s\" % (DEPTH - 1,",
      "            \" \".join(\"%.4f\" % (_pe_acc[_li] / VARIANTS) for _li in range(DEPTH - 1)))",
      "    print(\"   gen %d  best mean|err| = %.4f%s\" % (_gen0 + g, best_err, _pe_line))",
      "",
      "print()",
      "print(\"   error curve: \" + \" \".join(\"%.3f\" % e for e in err_curve))",
      "print(\"   %.4f -> %.4f  (%.1f%% lower)\"",
      "      % (err_curve[0], err_curve[-1],",
      "         100 * (err_curve[0] - err_curve[-1]) / err_curve[0]))",
      "if DEPTH == 1 and not HORIZON_ON and not AM_ON and SHOCK_TYPE is None and not VAL_ON and not AUTOPILOT and not MO_ON and not STAB_ON and not CHAR_TASK and not AM_RESID_ON and not AM_SIGNINV and not AM_ZEROSUM and not INV_ON and not MASKED_ON and not ATOMIC_ON:",
      "    # reference asserts — strict: the exact reference curve must improve monotonically",
      "    # (guarded: the horizon rewrites the prediction path, so it opts out of the reference)",
      "    assert err_curve[-1] < err_curve[0], \"evolution did not improve\"",
      "    _mono_tol = 0.02 if _resume else 1e-12  # plateau resume: episode noise may exceed per-gen gain",
      "    assert all(b <= a + _mono_tol for a, b in zip(err_curve, err_curve[1:])), \"non-monotonic\"",
      "if HORIZON_ON:",
      "    print(\"   -- Event Horizon active: %d->%d gravity compression, entanglement-inspired link %s --\"",
      "          % (HORIZON_M, HORIZON_K, \"ON\" if HORIZON_ENT else \"OFF\"))",
      "    print(\"   paradox-inspired classical simulation: the reference asserts are bypassed,\",",
      "          \"the horizon owns prediction.\")",
      "if AM_ON:",
      "    print(\"   -- Antimatter active: ghost-built inner superloop (seeded stochastic spawn) --\",",
      "          \"classical simulation: the reference asserts are bypassed,\",",
      "          \"write-protection enforced both ways (reads only).\")",
      "if SHOCK_TYPE is not None:",
      "    print(\"   -- v43 shock lab: seeded regime shock injected --\",",
      "          \"classical falsifiability experiment; the reference asserts are bypassed.\")",
      "if VAL_ON:",
      "    print(\"   -- v43 held-out validation window armed (pristine, no learning) --\")",
      "if AUTOPILOT:",
      "    print(\"   -- v43 auto-pilot armed: the decay law is now a switch (JS engine) --\")",
      "if MO_ON:",
      "    print(\"   -- v43 multi-objective fitness: F = w1*(1-err)+w2*fid-w3*cpx --\")",
      "if STAB_ON:",
      "    print(\"   -- v43 stability guard: LayerNorm after recurrent updates --\")",
      "if CHAR_TASK:",
      "    print(\"   -- v43 char-RNN milestone: run it in the JS engine (charrnn.js) --\")",
      "if AM_RESID_ON or AM_SIGNINV or AM_ZEROSUM:",
      "    print(\"   -- v44 Annihilation: residual=%s signinv=%s zerosum=%s --\" % (AM_RESID_ON, AM_SIGNINV, AM_ZEROSUM),",
      "          \"classical simulation: the reference asserts are bypassed.\")",
      "if INV_ON:",
      "    print(\"   -- v44 bidirectional inversion armed (JS engine) --\")",
      "if MASKED_ON:",
      "    print(\"   -- v45 masked-token training armed (JS engine, charrnn.js) --\")",
      "if ATOMIC_ON:",
      "    print(\"   -- v46 atomic periodic-table network armed (JS engine, atomic.js) --\")",
      "if not (DEPTH == 1 and not HORIZON_ON and not AM_ON and SHOCK_TYPE is None and not VAL_ON and not AUTOPILOT and not MO_ON and not STAB_ON and not CHAR_TASK and not AM_RESID_ON and not AM_SIGNINV and not AM_ZEROSUM and not INV_ON and not MASKED_ON and not ATOMIC_ON):",
      "    # advisory: random deep/horizon inits are finicky, and the",
      "    # elitism guarantee is empirical, not structural. Report, don't crash.",
      "    if err_curve[-1] < err_curve[0]:",
      "        print(\"   deep stack improved: %.4f -> %.4f\" % (err_curve[0], err_curve[-1]))",
      "    else:",
      "        print(\"   deep stack did NOT improve this run (%.4f -> %.4f).\" % (err_curve[0], err_curve[-1]))",
      "        print(\"   random deep inits are finicky — the strict asserts guard DEPTH=1.\")",
      "        print(\"   Try another seed, tanh, or shallower depth.\")",
      "print()",
      "print(\"== 6. decay-point entanglement: plateau -> capture -> verify -> handoff ==\")",
      "print(\"   empirical law: this curve follows E ~= 0.465*gen^-0.43 (R^2=0.983) —\")",
      "print(\"   decay SLOWS. The monitor below exists because of that.\")",
      "EPS = 0.01  # decay epsilon: the decay point fires when dE < EPS",
      "lin_champ, lin_curve = champion, list(err_curve)",
      "decay_rec = None",
      "for g2 in range(_gen0 + G, _gen0 + G + 8):",
      "    snap = lin_champ.snapshot()",
      "    best, best_err, best_score, best_pre, best_fid = None, float(\"inf\"), float(\"inf\"), None, None",
      "    for v in range(VARIANTS):",
      "        cand = copy.deepcopy(snap)",
      "        cand.zero_state()",
      "        if v > 0:",
      "            cand.V += rng.normal(0, 0.02, cand.V.shape)",
      "            if DEPTH > 1:  # v39: evolution mutates ALL layers' weights",
      "                for lay in cand.layers:",
      "                    lay['W'] += rng.normal(0, 0.01, lay['W'].shape)",
      "            if cand.hz is not None:  # v40: the gravity matrix is genotype too",
      "                cand.hz['Vh'] += rng.normal(0, 0.02, cand.hz['Vh'].shape)",
      "                cand.hz['G'] += rng.normal(0, 0.01, cand.hz['G'].shape)",
      "                cand.hz['A'] += rng.normal(0, 0.01, cand.hz['A'].shape)",
      "        pre = copy.deepcopy(cand)   # pre-episode state: the parent replays from here",
      "        errs = []",
      "        for t in range(T):",
      "            x = 0.5 * np.sin(0.05 * t)",
      "            _, e = cand.step(x, target_stream(t))",
      "            errs.append(abs(e))",
      "        m = float(np.mean(errs))",
      "        _fid = cand.horizon_fidelity()",
      "        _score = m + (HZ_LAMBDA * (1.0 - (_fid or 0.0)) if (HORIZON_ON and HORIZON_ENT) else 0.0)",
      "        if _score < best_score:",
      "            best, best_err, best_score, best_pre, best_fid = cand, m, _score, pre, _fid",
      "    dE = lin_curve[-1] - best_err",
      "    lin_champ, lin_curve = best, lin_curve + [best_err]",
      "    mark = \"   <-- DECAY POINT (dE < EPS)\" if (dE < EPS and decay_rec is None) else \"\"",
      "    print(\"   lineage gen %d  err=%.4f  dE=%.4f%s\" % (g2, best_err, dE, mark))",
      "    if dE >= EPS or decay_rec is not None:",
      "        continue",
      "    decay_rec = {",
      "        \"gen\": g2, \"err\": best_err, \"dE\": dE,",
      "        \"layers\": [{\"W\": l[\"W\"].copy(), \"U\": l[\"U\"].copy(),",
      "                    \"h\": l[\"h\"].copy()} for l in best.layers],",
      "        \"V\": best.V.copy(), \"phi\": phi,",
      "        \"checksum\": \"%x\" % abs(hash(b\"\".join(l[\"W\"].tobytes()",
      "                                              for l in best.layers))),",
      "    }",
      "    print(\"   decay point CAPTURED at gen %d — checksum %s\" % (g2, decay_rec[\"checksum\"]))",
      "    ver = copy.deepcopy(best_pre)",
      "    ver.zero_state()",
      "    verr = []",
      "    for t in range(T):",
      "        x = 0.5 * np.sin(0.05 * t)",
      "        _, e = ver.step(x, target_stream(t))",
      "        verr.append(abs(e))",
      "    ver_err = float(np.mean(verr))",
      "    assert ver_err == best_err, \"decay verification failed\"",
      "    decay_rec[\"verified\"] = True",
      "    print(\"   decay point VERIFIED — parent replay reproduced err=%.4f exactly\" % ver_err)",
      "    child = copy.deepcopy(best)",
      "    child.V += rng.normal(0, 0.005, child.V.shape)",
      "    if DEPTH > 1:  # v39: the whisper reaches every layer of the deep stack",
      "        for lay in child.layers:",
      "            lay['W'] += rng.normal(0, 0.002, lay['W'].shape)",
      "    child_lr = LR * max(0.25, min(1.0, dE / EPS))",
      "    genesis_sig = \"%x\" % abs(hash(child.V.tobytes()))",
      "    decay_rec[\"child_genesis\"] = genesis_sig",
      "    decay_rec[\"child_lr\"] = child_lr",
      "    print(\"   ENTANGLED HANDOFF — child V0 = parent terminal V + whisper (sigma 0.005)\")",
      "    print(\"   child lr=%.4f (scaled by terminal decay rate), phi inherited=%.3f\" % (child_lr, phi))",
      "    print(\"   lineage ledger: parent %s <-> child %s\" % (decay_rec[\"checksum\"], genesis_sig))",
      "if decay_rec is None:",
      "    print(\"   (decay point not reached in gens 8-15 — raise generations or lower EPS)\")",
      "_nx_src = champion.snapshot()",
      "_nx_frozen = _nx_src.layers[0]['W'].copy()",
      "_nx_mut = copy.deepcopy(_nx_src)",
      "_nx_mut.V += rng.normal(0, 1.0, _nx_mut.V.shape)  # hammer a COPY; the frozen one must not move",
      "_nx_ok = bool(np.array_equal(_nx_src.layers[0]['W'], _nx_frozen))",
      "_total_gens = _gen0 + G + 8  # full lineage length incl. the decay section",
      "_nx = {",
      "    \"generations\": G,",
      "    \"err_curve\": [round(float(e), 6) for e in err_curve],",
      "    \"belief_traj\": [round(float(p), 4) for p in traj],",
      "    \"belief_final\": round(float(traj[-1]), 4),",
      "    \"snapshot\": {\"checksum\": \"%x\" % abs(hash(_nx_frozen.tobytes())) , \"untouched\": _nx_ok},",
      "    \"decay\": {",
      "        \"gen\": decay_rec[\"gen\"], \"err\": round(float(decay_rec[\"err\"]), 6),",
      "        \"dE\": round(float(decay_rec[\"dE\"]), 6), \"checksum\": decay_rec[\"checksum\"],",
      "        \"verified\": True, \"child_genesis\": decay_rec[\"child_genesis\"],",
      "    } if decay_rec else None,",
      "    \"champion\": {  # v35: the lineage head — auto-saved by the app, resumable",
      "        \"kind\": \"champion\", \"v\": 3,  # v39: stacked format — full depth",
      "                              # v40: + horizon (gravity matrix, sealed)",
      "        \"stack_depth\": DEPTH, \"act\": ACT,",
      "        \"layers\": [{\"W\": l[\"W\"].tolist(), \"U\": l[\"U\"].tolist(),",
      "                    \"h\": l[\"h\"].tolist(),",
      "                    **(({'F': l['F'].tolist()} if 'F' in l else {}))}",
      "                   for l in lin_champ.layers],",
      "        \"V\": lin_champ.V.tolist(),",
      "        \"horizon\": ({",
      "            \"on\": True, \"ent\": bool(lin_champ.hz['ent']),",
      "            \"M\": int(lin_champ.hz['M']), \"K\": int(lin_champ.hz['K']),",
      "            \"gamma\": float(HZ_GAMMA),",
      "            \"G\": lin_champ.hz['G'].tolist(), \"Vh\": lin_champ.hz['Vh'].tolist(),",
      "            \"A\": lin_champ.hz['A'].tolist(),",
      "        } if lin_champ.hz is not None else None),",
      "        \"phi\": float(phi), \"gen\": _total_gens,",
      "        \"err\": round(float(lin_curve[-1]), 6),",
      "        \"err_curve\": [round(float(e), 6) for e in lin_curve],",
      "        \"checksum\": \"%x\" % abs(hash(b\"\".join(l[\"W\"].tobytes()",
      "                                              for l in lin_champ.layers))),",
      "        \"ts\": int(time.time()),",
      "    },",
      "    \"params\": {\"D\": D, \"T\": T, \"LR\": LR, \"variants\": VARIANTS, \"seed\": 16,",
      "               \"depth\": DEPTH, \"act\": ACT,",
      "               \"horizon_on\": bool(HORIZON_ON), \"horizon_ent\": bool(HORIZON_ENT),",
      "               \"horizon_M\": HORIZON_M, \"horizon_K\": HORIZON_K},",
      "    \"horizon\": ({",
      "        \"on\": True, \"ent\": bool(HORIZON_ENT),",
      "        \"M\": HORIZON_M, \"K\": HORIZON_K,",
      "        \"fidelity\": round(float(lin_champ.horizon_fidelity() or 0.0), 4),",
      "        \"G_rms\": round(float(np.sqrt(np.mean(lin_champ.hz['G']**2))), 6),",
      "    } if (HORIZON_ON and lin_champ.hz is not None) else None),",
      "}",
      "print(\"NEXUS_RUN_JSON:\" + json.dumps(_nx))",
      "print()",
      "print(\"QUANTUM NEXUS CORE COMPLETE — named by Ahkeem.\")",
      "print(\"PRESET 16 COMPLETE\")",
    ].join('\n');
    var SPIKE_PRESETS = {
      nengo: SPIKE_DEMO,
      quant: SPIKE_QUANT_DEMO,
      event: SPIKE_EVENT_DEMO,
      sched: SPIKE_SCHED_DEMO,
      dvsloop: SPIKE_DVSLOOP_DEMO,
      stdp: SPIKE_STDP_DEMO,
      hh: SPIKE_HH_DEMO,
      deep: SPIKE_DEEP_DEMO,
      jeffress: SPIKE_JEFFRESS_DEMO,
      izhi: SPIKE_IZHI_DEMO,
      nef: SPIKE_NEF_DEMO,
      nano: SPIKE_NANOGRAD_DEMO,
      attn13: SPIKE_ATTN13_DEMO,
      arm14: SPIKE_ARM14_DEMO,
      q15: SPIKE_Q15_DEMO,
      evo16: SPIKE_EVO16_DEMO
    };
    function spikeLog(msg, cls) {
      var out = $('spike-out');
      var d = document.createElement('div');
      if (cls) d.className = 't-' + cls;
      d.textContent = msg;
      out.appendChild(d);
      while (out.children.length > 800) out.removeChild(out.firstChild);
      out.scrollTop = out.scrollHeight;
    }
    function spikeCheckPython() {
      var el = $('spike-pyinfo');
      try {
        if (typeof pybridge !== 'undefined' && pybridge.pyVersion) {
          var v = pybridge.pyVersion();
          el.textContent = 'Python: ' + v.split('\n')[0];
        } else {
          el.textContent = 'Python: bridge not available (not on Android?)';
        }
      } catch (e) { el.textContent = 'Python: error — ' + e; }
    }
    function spikeRun() {
      var code = $('spike-text').value;
      if (spikeEd && !spikeEd.hidden) spikeCloseEditor();
      if (!code.trim()) { spikeLog('(nothing to run)', 'dim'); return; }
      spikeLog('▶ running…', 'dim');
      try {
        var raw = pybridge.run(code);
        var res = JSON.parse(raw);
        if (res.out) spikeLog(res.out.replace(/\n$/, ''), 'ok');
        if (res.err) spikeLog(res.err.replace(/\n$/, ''), 'err');
        if (res.ok && !res.out && !res.err) spikeLog('(done, no output)', 'dim');
        if (!res.ok && !res.err) spikeLog('(failed, no error text)', 'err');
        /* v33: Nexus run recorder — preset 16 emits a NEXUS_RUN_JSON: marker line */
        try {
          if (res.ok && res.out && window.NL_NEXUS_RUNS) {
            var nxm = /(^|\n)NEXUS_RUN_JSON:(\{.*\})/.exec(res.out);
            if (nxm) {
              var nxd = JSON.parse(nxm[2]);
              nxd.source = 'preset16';
              window.NL_NEXUS_RUNS.savePrompt(nxd);
              /* v35: persistent lineage — the champion auto-saves, no prompt needed */
              try {
                var _nxc = (window.NL_NEXUS && window.NL_NEXUS.core) || null;
                if (_nxc && nxd.champion && _nxc.champShapeOk(nxd.champion) &&
                    window.NL_NEXUS.saveChampion) {
                  window.NL_NEXUS.saveChampion(nxd.champion);
                }
              } catch (ce) { spikeLog('champion auto-save failed: ' + ce, 'err'); }
            }
          }
        } catch (nxr) { spikeLog('run-data parse failed: ' + nxr, 'err'); }
      } catch (e) { spikeLog('bridge error: ' + e, 'err'); }
      try { $('spike-out').scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
    /* ── spiking: editor as its own full-screen window ── */
    var spikeEd = $('spike-editor');
    function spikeSyncPreview() {
      var v = $('spike-text').value;
      $('spike-preview').textContent = v.trim()
        ? v.split('\n').slice(0, 8).join('\n')
        : '# write Python here — numpy + nengo available';
    }
    function spikeOpenEditor() {
      spikeEd.hidden = false;
    }
    function spikeCloseEditor() {
      spikeEd.hidden = true;
      spikeSyncPreview();
    }
    $('btn-spike-open').onclick = spikeOpenEditor;
    $('btn-spike-back').onclick = spikeCloseEditor;
    $('btn-spike-out2').onclick = function () {
      spikeCloseEditor();
      try { $('spike-out').scrollIntoView({ block: 'nearest' }); } catch (e) {}
    };
    $('btn-spike-run2').onclick = spikeRun;
    $('spike-text').addEventListener('input', spikeSyncPreview);
    spikeSyncPreview();
    $('btn-spike-run').onclick = spikeRun;
    $('btn-spike-demo').onclick = function () {
      var sel = $('spike-preset');
      var key = sel ? sel.value : 'nengo';
      var src = SPIKE_PRESETS[key] || SPIKE_DEMO;
      $('spike-text').value = src;
      spikeSyncPreview();
      spikeLog('loaded preset: ' + (sel ? sel.options[sel.selectedIndex].text : 'Nengo demo') + ' — tap ▶ Run to execute', 'dim');
      spikeOpenEditor();
    };
    $('btn-spike-clear').onclick = function () { $('spike-out').innerHTML = ''; };
    // tab key inserts two spaces in the python editor
    $('spike-text').addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var t = $('spike-text'), s = t.selectionStart;
        t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
        t.selectionStart = t.selectionEnd = s + 2;
        spikeSyncPreview();
      }
    });
    spikeCheckPython();

    // github    $('btn-gh-list').onclick = ghList;
    $('gh-repo').addEventListener('keydown', function (e) { if (e.key === 'Enter') ghList(); });
    $('btn-clear-console').onclick = function () { $('console-out').innerHTML = ''; };

    window.addEventListener('error', function (e) {
      log('JS error: ' + (e.message || e.error), 'err');
    });
  }

  /* ══ init ══════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    syncDevUI();
    wire();
    renderFileList();
    openEditorFile(edActive in edFiles ? edActive : Object.keys(edFiles)[0]);
    edDirty = false; renderFileList();
    initNotes();
    var _appVer = 'v?';
    try { var _avEl = document.getElementById('app-ver'); if (_avEl) _appVer = _avEl.textContent.trim(); } catch (e) {}
    log('Neural Lab ' + _appVer + ' ready — First Tongue + the trinity, live on-device: (1) unstable molecules, ghost systems, and the black-hole gravity field are built INTO the network core — every step() applies trinity penalties structurally, no switch, no bypass; (2) the "That was wack" button turns a bad output into a molecule + a checksum-sealed ghost, steering future speech away from its patterns; (3) Free Thought: the tongue thinks its own thoughts with think-then-speak cycles (dim inner thought, then a spoken answer built from it) — every 4th cycle it wonders (why / what-if / how) and answers itself, and the trinity auto-rejects looping or stale thoughts into molecules + ghosts; (4) Brain Feeder: paste a page URL or raw text (e.g. from Gemini) → clean text → brain-food.txt in shared Documents/NeuralLab, ready to upload to Drive for the next Colab training run; plus v42 Antimatter (ghost-built inner superloop), v41 Ghost Snapshots, v40 Event Horizon, and all earlier features. Classical simulation, on-device, honest physics.', 'ok');

    log('Neural Lab v30 ready — QuantumVM: virtual quantum computer (classical state-vector simulation, honest physics) — new ⚛️ Quantum tab (8-qubit cap, 256 amplitudes, the 2^N cost shown), quantum assembly editor (H X Y Z S T RX/RY/RZ CNOT CZ SWAP MEASURE RESET, line-numbered parse errors) + Run/Step/Reset, live state inspector (amplitudes + probabilities), 1000-shot measurement histogram, entanglement view (single-qubit purity indicator + pair purity), canvas Bloch sphere, presets (Bell pair, GHZ-3, coin flip, scripted teleportation walkthrough with classical conditioning), Spiking preset 15 (NumPy Bell parity vs the JS VM, PARITY OK), edge shell: qasm <gates;…> · qstate · qmeasure [shots]; plus all v29 ReverseLab features — ARM7TDMI disassembler (ARM + Thumb), 🔧 RE tab with control-flow graph, ARM instruction classifier demo, preset 14; plus all v28/v27/v26/v25/v23/v22 features.', 'ok');
    log('Neural Lab v28 ready — MicroFormer: single-head causal transformer in pure JS (attention.js: token embedding + learned positional encoding, softmax(QK^T/√d+M)V with −∞ causal mask, FFN d→32→d, residuals + LayerNorm, vocab head; seeded init, Adam/SGD trainBatch); Train tab: Architecture picker (MLP vs Transformer) + Next-char Sequences dataset (24 fixed 4-step sequences over A–H, e.g. ABC→D, learns to 100%); Brain tab: live T×T Attention Heatmap inspector (tap a cell for its q·k score + post-softmax distribution, masked upper triangle strictly zeroed, 52px tap targets); Spiking preset 13 (NumPy causal self-attention fwd+bwd, seed 1337, byte-identical); edge shell: attn step "ABC" (Token IDs → Q/K/V projections → attention weights → next-token logits); transformer model cards save/load under kind mtf8 without touching MLP/CNN cards; plus all v27 features — BareMetal C: c_codegen.js generates a self-contained neural_lab_infer.h/.c pair (const int16_t Q8.8 weights, allocation-free pointer-bumped model_run, 1024-entry tanh/sigmoid LUTs baked at export); virtual MCU runtime simulator (JS Editor preset mcu-sim.js: 2-16 KB scratchpad field, ERR_SCRATCHPAD_OVERFLOW / ERR_STACK_OVERFLOW / ERR_HEAP_DISABLED traps, cycle estimates for 16 MHz Cortex-M0 vs 64 MHz Cortex-M4 with int-mult vs float-fallback penalties, peak RAM + register states); edge shell: mcu run [scratchBytes]; new Firmware vault note [[Fixed-Point Activation LUTs & Quantization Drift]]; Export C also saves model.c via the Android file picker; plus all v26 features — NanoGrad: micrograd-style scalar autograd tape engine (nanograd.js: + - * / ^n relu tanh sigmoid, topo-order .backward(), seeded RNG); Brain tab flips between Revolving Network and Computation Graph (DAG with v/grad per node, backprop playback, zoom/pan); JS Editor preset nanograd-mlp.js (seed-42 2-layer tape MLP, reference: L=0.2841 grad=1.0000 b_1 grad=-0.0412 after 5 steps); Spiking preset 12 (nanograd tape vs hand-derived NumPy chain rule, byte-identical); edge shell: graph dump + grad inspect <node_id>; plus all v25 features — Ohm\'s law exercise copy fix (weight reads ≈916 in-app, ÷ 1.95 ≈ 470 Ω); LLM-lab lite: tokenizer playground, chat templates, synthetic-data pipeline, DPO ratings — text plumbing only, no model runs here; plus all v23 features — Edge-AI (Zephyr branch): OTA weight swaps (MCUboot A/B partitions, swap without rebuild, one-tap rollback), an energy-per-inference profiler across Cortex-M4 / ESP32 / RISC-V devicetree-style targets, an IMU+mic sensor-streaming demo with a zero-copy ring buffer, and a live edge shell in the Console (try: help); plus all v22 features — vertical time raster for the peripheral VM, the Ohm\'s law regression exercise, Q8.8 C-array exporter, CNN kernel inspector, spiking presets 9/10/11, Adam optimizer + dropout, from-scratch CNN, NumPy deep-net preset, regression mode, NaN-guarded training, mobile layout, notes vault, embedded Python + Nengo, embedded-systems pack, peripheral VM, FreeRTOS scheduler demo, DVS closed-loop, STDP, Hodgkin-Huxley biophysics, all compute on this device.', 'ok');
    log('Gamepad: dpad/stick switches tabs, A starts training. Ctrl+S saves, Ctrl+Enter trains.', 'dim');
    demoXOR(); // works out of the box
    initBrain();
    if (window.NL_RE) window.NL_RE.init();
    if (window.NL_Q) window.NL_Q.init();
    if (window.NL_NEXUS) window.NL_NEXUS.init();
    fitLoss();
    switchTab('train');
  });
})();
