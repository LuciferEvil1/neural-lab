'use strict';
/* Neural Lab v30 "QuantumVM" — a virtual quantum computer (classical simulation).
 * N-qubit state-vector VM (cap 8 qubits = 256 complex amplitudes; the 2^N cost
 * is shown honestly in the UI). Quantum assembly: H X Y Z S T RX/RY/RZ CNOT CZ
 * SWAP MEASURE RESET. Qubit 0 = least-significant bit (Qiskit convention).
 *
 * Split design: NL_QVM = pure VM core (no DOM — testable in Node);
 *               NL_Q   = tab UI wiring (needs document).
 */
var _G = (typeof window !== 'undefined') ? window :
         (typeof global !== 'undefined') ? global : this;

_G.NL_QVM = (function () {
  var SQRT1_2 = Math.SQRT1_2;

  function cplx(re, im) { return { re: re, im: im || 0 }; }
  function cadd(a, b) { return cplx(a.re + b.re, a.im + b.im); }
  function cmul(a, b) { return cplx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function cscale(a, s) { return cplx(a.re * s, a.im * s); }
  function cneg(a) { return cplx(-a.re, -a.im); }
  function cconj(a) { return cplx(a.re, -a.im); }
  function cnorm2(a) { return a.re * a.re + a.im * a.im; }

  function newState(n) {
    var dim = 1 << n, s = new Array(dim);
    for (var i = 0; i < dim; i++) s[i] = cplx(0, 0);
    s[0] = cplx(1, 0);
    return { n: n, dim: dim, amp: s, measured: [] };
  }
  function cloneState(st) {
    var s = new Array(st.dim);
    for (var i = 0; i < st.dim; i++) s[i] = cplx(st.amp[i].re, st.amp[i].im);
    return { n: st.n, dim: st.dim, amp: s, measured: st.measured.slice() };
  }

  /* single-qubit gate: 2x2 matrix [[m00,m01],[m10,m11]] on qubit q */
  function apply1(st, q, m00, m01, m10, m11) {
    var mask = 1 << q, a = st.amp;
    for (var i = 0; i < st.dim; i++) {
      if ((i & mask) === 0) {
        var j = i | mask;
        var a0 = a[i], a1 = a[j];
        a[i] = cadd(cmul(m00, a0), cmul(m01, a1));
        a[j] = cadd(cmul(m10, a0), cmul(m11, a1));
      }
    }
  }

  var GATES_1Q = {
    H: [[cplx(SQRT1_2, 0), cplx(SQRT1_2, 0)], [cplx(SQRT1_2, 0), cplx(-SQRT1_2, 0)]],
    X: [[cplx(0, 0), cplx(1, 0)], [cplx(1, 0), cplx(0, 0)]],
    Y: [[cplx(0, 0), cplx(0, -1)], [cplx(0, 1), cplx(0, 0)]],
    Z: [[cplx(1, 0), cplx(0, 0)], [cplx(0, 0), cplx(-1, 0)]],
    S: [[cplx(1, 0), cplx(0, 0)], [cplx(0, 0), cplx(0, 1)]],
    T: [[cplx(1, 0), cplx(0, 0)], [cplx(0, 0), cplx(SQRT1_2, SQRT1_2)]]
  };
  function rotX(t) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return [[cplx(c, 0), cplx(0, -s)], [cplx(0, -s), cplx(c, 0)]];
  }
  function rotY(t) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return [[cplx(c, 0), cplx(-s, 0)], [cplx(s, 0), cplx(c, 0)]];
  }
  function rotZ(t) {
    var c = Math.cos(t / 2), s = Math.sin(t / 2);
    return [[cplx(c, -s), cplx(0, 0)], [cplx(0, 0), cplx(c, s)]];
  }

  function applyGate(st, name, q) {
    var m = GATES_1Q[name];
    if (!m) throw new Error('unknown 1q gate ' + name);
    apply1(st, q, m[0][0], m[0][1], m[1][0], m[1][1]);
  }
  function applyRot(st, name, q, theta) {
    var m = name === 'RX' ? rotX(theta) : name === 'RY' ? rotY(theta) : rotZ(theta);
    apply1(st, q, m[0][0], m[0][1], m[1][0], m[1][1]);
  }
  function applyCNOT(st, c, t) {
    var cm = 1 << c, tm = 1 << t, a = st.amp;
    for (var i = 0; i < st.dim; i++) {
      if ((i & cm) !== 0) {
        var j = i ^ tm;
        if (j > i) { var tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
      }
    }
  }
  function applyCZ(st, c, t) {
    var cm = 1 << c, tm = 1 << t, a = st.amp;
    for (var i = 0; i < st.dim; i++) {
      if ((i & cm) !== 0 && (i & tm) !== 0) a[i] = cneg(a[i]);
    }
  }
  function applySWAP(st, p, q) {
    var pm = 1 << p, qm = 1 << q, a = st.amp;
    for (var i = 0; i < st.dim; i++) {
      var bp = (i & pm) !== 0, bq = (i & qm) !== 0;
      if (bp !== bq) {
        var j = i ^ pm ^ qm;
        if (j > i) { var tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
      }
    }
  }
  function measure(st, q, forced) {
    var mask = 1 << q, p0 = 0, a = st.amp;
    for (var i = 0; i < st.dim; i++) if ((i & mask) === 0) p0 += cnorm2(a[i]);
    var r = (forced === 0 || forced === 1) ? forced : (Math.random() < p0 ? 0 : 1);
    var p = r === 0 ? p0 : 1 - p0;
    var norm = p > 1e-12 ? 1 / Math.sqrt(p) : 0;
    for (var k = 0; k < st.dim; k++) {
      var bit = (k & mask) !== 0 ? 1 : 0;
      a[k] = bit === r ? cscale(a[k], norm) : cplx(0, 0);
    }
    st.measured.push({ q: q, bit: r });
    return r;
  }
  function resetQ(st, q) {
    var b = measure(st, q);
    if (b === 1) applyGate(st, 'X', q);
    return b;
  }

  /* ── quantum assembly parser ─────────────────────────────────── */
  function parseTheta(tok, lineNo) {
    var t = String(tok).trim().toLowerCase().replace(/\s+/g, '');
    t = t.replace(/pi/g, 'PI');
    // allow PI, PI/2, 2*PI, 0.6, -PI/4 …
    if (!/^[0-9.\-+*\/PI()]+$/.test(t)) throw new Error('Line ' + lineNo + ': bad angle "' + tok + '"');
    var f;
    try { f = Function('"use strict";var PI=Math.PI;return(' + t + ');')(); }
    catch (e) { throw new Error('Line ' + lineNo + ': bad angle "' + tok + '"'); }
    if (typeof f !== 'number' || !isFinite(f)) throw new Error('Line ' + lineNo + ': bad angle "' + tok + '"');
    return f;
  }
  var ARITY = { H: 1, X: 1, Y: 1, Z: 1, S: 1, T: 1, RX: 2, RY: 2, RZ: 2, CNOT: 2, CX: 2, CZ: 2, SWAP: 2, MEASURE: 1, M: 1, RESET: 1 };
  function parse(src, nQubits) {
    var ops = [], errors = [];
    var lines = String(src == null ? '' : src).split('\n');
    lines.forEach(function (raw, li) {
      var lineNo = li + 1;
      var line = raw.replace(/\/\/.*$/, '').trim();
      var hash = line.indexOf('#');
      if (hash >= 0) line = line.slice(0, hash).trim();
      if (!line) return;
      var parts = line.split(/[\s,;]+/).filter(Boolean);
      var gate = parts[0].toUpperCase();
      if (!(gate in ARITY)) { errors.push('Line ' + lineNo + ': unknown gate "' + parts[0] + '"'); return; }
      var need = ARITY[gate];
      if (parts.length - 1 < need) { errors.push('Line ' + lineNo + ': ' + gate + ' needs ' + need + ' argument(s)'); return; }
      try {
        var op = { gate: gate, line: lineNo, text: raw.trim() };
        var qi = function (tok) {
          var v = parseInt(tok, 10);
          if (String(v) !== String(tok).trim() || v < 0 || v >= nQubits)
            throw new Error('Line ' + lineNo + ': qubit "' + tok + '" out of range (0..' + (nQubits - 1) + ')');
          return v;
        };
        if (gate === 'RX' || gate === 'RY' || gate === 'RZ') {
          op.q = qi(parts[1]); op.theta = parseTheta(parts[2], lineNo);
        } else if (gate === 'CNOT' || gate === 'CX' || gate === 'CZ' || gate === 'SWAP') {
          op.q = qi(parts[1]); op.q2 = qi(parts[2]);
          if (op.q === op.q2) throw new Error('Line ' + lineNo + ': the two qubits must differ');
          if (gate === 'CX') op.gate = 'CNOT';
        } else {
          op.q = qi(parts[1]);
          if (gate === 'M') op.gate = 'MEASURE';
        }
        ops.push(op);
      } catch (e) { errors.push(e.message); }
    });
    return { ops: ops, errors: errors };
  }
  function execOp(st, op) {
    var g = op.gate;
    if (g === 'RX' || g === 'RY' || g === 'RZ') applyRot(st, g, op.q, op.theta);
    else if (g === 'CNOT') applyCNOT(st, op.q, op.q2);
    else if (g === 'CZ') applyCZ(st, op.q, op.q2);
    else if (g === 'SWAP') applySWAP(st, op.q, op.q2);
    else if (g === 'MEASURE') measure(st, op.q);
    else if (g === 'RESET') resetQ(st, op.q);
    else applyGate(st, g, op.q);
  }
  function runAll(src, nQubits) {
    var p = parse(src, nQubits);
    if (p.errors.length) return { errors: p.errors };
    var st = newState(nQubits);
    p.ops.forEach(function (op) { execOp(st, op); });
    return { errors: [], ops: p.ops, state: st };
  }

  /* ── inspection ──────────────────────────────────────────────── */
  function probs(st) {
    var p = new Array(st.dim);
    for (var i = 0; i < st.dim; i++) p[i] = cnorm2(st.amp[i]);
    return p;
  }
  function bitstr(i, n) {
    var s = '';
    for (var q = n - 1; q >= 0; q--) s += ((i >> q) & 1) ? '1' : '0';
    return s;
  }
  /* reduced density matrix of qubit pair (a,b); returns 4x4 + purity */
  function pairRDM(st, a, b) {
    var rho = [];
    for (var r = 0; r < 4; r++) { rho.push([cplx(0, 0), cplx(0, 0), cplx(0, 0), cplx(0, 0)]); }
    for (var i = 0; i < st.dim; i++) {
      var ia = (i >> a) & 1, ib = (i >> b) & 1, ri = (ia << 1) | ib;
      for (var j = 0; j < st.dim; j++) {
        var ja = (j >> a) & 1, jb = (j >> b) & 1, cj = (ja << 1) | jb;
        var restSame = true;
        for (var q = 0; q < st.n; q++) {
          if (q === a || q === b) continue;
          if (((i >> q) & 1) !== ((j >> q) & 1)) { restSame = false; break; }
        }
        if (restSame) rho[ri][cj] = cadd(rho[ri][cj], cmul(st.amp[i], cconj(st.amp[j])));
      }
    }
    var purity = 0;
    for (var m = 0; m < 4; m++) for (var n2 = 0; n2 < 4; n2++) purity += cnorm2(rho[m][n2]);
    return { rho: rho, purity: purity };
  }
  /* single-qubit reduced density matrix + purity.
   * Honest entanglement indicator: purity < 1 means this qubit is entangled
   * with the rest of the system (0.5 = maximally entangled, e.g. Bell pair). */
  function qubitRDM(st, q) {
    var r00 = 0, r11 = 0, r01 = cplx(0, 0), mask = 1 << q;
    for (var i = 0; i < st.dim; i++) {
      for (var j = 0; j < st.dim; j++) {
        var restSame = true;
        for (var r = 0; r < st.n; r++) {
          if (r === q) continue;
          if (((i >> r) & 1) !== ((j >> r) & 1)) { restSame = false; break; }
        }
        if (!restSame) continue;
        var bi = (i & mask) !== 0 ? 1 : 0, bj = (j & mask) !== 0 ? 1 : 0;
        var t = cmul(st.amp[i], cconj(st.amp[j]));
        if (bi === 0 && bj === 0) r00 += t.re;
        else if (bi === 1 && bj === 1) r11 += t.re;
        else if (bi === 0 && bj === 1) r01 = cadd(r01, t);
      }
    }
    var purity = r00 * r00 + r11 * r11 + 2 * cnorm2(r01);
    return { r00: r00, r11: r11, r01: r01, purity: purity };
  }
  /* single-qubit Bloch vector from its reduced 2x2 density matrix */
  function blochVec(st, q) {
    var rd = qubitRDM(st, q);
    return { x: 2 * rd.r01.re, y: -2 * rd.r01.im, z: rd.r00 - rd.r11 };
  }
  /* measurement shots: fresh run per shot; returns {bitstring: count} */
  function shots(src, nQubits, nShots) {
    var p = parse(src, nQubits);
    if (p.errors.length) return { errors: p.errors };
    var counts = {}, hasMeasure = p.ops.some(function (o) { return o.gate === 'MEASURE'; });
    for (var s = 0; s < nShots; s++) {
      var st = newState(nQubits);
      p.ops.forEach(function (op) { execOp(st, op); });
      var bits;
      if (hasMeasure) {
        bits = '';
        for (var q = nQubits - 1; q >= 0; q--) {
          var m = st.measured.filter(function (x) { return x.q === q; }).pop();
          bits += m ? String(m.bit) : '?';
        }
      } else {
        var b = measureAll(st);
        bits = b;
      }
      counts[bits] = (counts[bits] || 0) + 1;
    }
    return { errors: [], counts: counts };
  }
  function measureAll(st) {
    var r = Math.random(), acc = 0, pick = st.dim - 1, p = probs(st);
    for (var i = 0; i < st.dim; i++) { acc += p[i]; if (r < acc) { pick = i; break; } }
    for (var k = 0; k < st.dim; k++) st.amp[k] = cplx(0, 0);
    st.amp[pick] = cplx(1, 0);
    return bitstr(pick, st.n);
  }

  return {
    newState: newState, cloneState: cloneState,
    parse: parse, execOp: execOp, runAll: runAll, shots: shots,
    applyGate: applyGate, applyRot: applyRot, applyCNOT: applyCNOT,
    applyCZ: applyCZ, applySWAP: applySWAP, measure: measure, resetQ: resetQ,
    probs: probs, bitstr: bitstr, pairRDM: pairRDM, qubitRDM: qubitRDM, blochVec: blochVec,
    cplx: cplx
  };
})();

/* ═══════════════ NL_Q — Quantum tab UI ═══════════════ */
_G.NL_Q = (function () {
  var V = _G.NL_QVM;
  function $(id) { return document.getElementById(id); }
  function api() { return _G.NL_Q_API || {}; }
  function log(m, c) { var a = api(); if (a.log) a.log(m, c); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  var nQ = 2, prog = null; // prog = {ops, pc, state}

  var PRESETS = {
    bell: {
      name: 'Bell pair — two qubits, one fate',
      src: 'H 0\nCNOT 0 1',
      narrate: 'H puts qubit 0 into superposition (0 and 1 at once). CNOT ties qubit 1 to it: ' +
        'now neither qubit has its own state — measure one and you instantly know the other. ' +
        'Check the Entanglement panel: purity 0.50 = maximally entangled.'
    },
    ghz3: {
      name: 'GHZ-3 — three-way entanglement',
      src: 'H 0\nCNOT 0 1\nCNOT 1 2',
      narrate: 'The Bell idea stretched over three qubits: (|000⟩+|111⟩)/√2. ' +
        'Measure all three and you only ever see 000 or 111 — never 001. Run the shots to prove it.'
    },
    coin: {
      name: 'Superposition coin flip',
      src: 'H 0\nMEASURE 0',
      narrate: 'H makes a perfect coin: exactly 50/50, from physics, not from a random-number algorithm. ' +
        'Run 1000 shots and watch the histogram converge.'
    }
  };

  /* ── state inspector ───────────────────────────────────── */
  function fmtAmp(a) {
    var r = Math.abs(a.re) < 1e-12 ? 0 : a.re, i = Math.abs(a.im) < 1e-12 ? 0 : a.im;
    if (i === 0) return r.toFixed(4);
    if (r === 0) return i.toFixed(4) + 'i';
    return r.toFixed(4) + (i >= 0 ? '+' : '') + i.toFixed(4) + 'i';
  }
  function renderState(st, hiOp) {
    var el = $('q-state'), p = V.probs(st), html = '';
    for (var i = 0; i < st.dim; i++) {
      if (p[i] < 1e-9) continue;
      var bar = Math.round(p[i] * 40);
      html += '<div>|' + V.bitstr(i, st.n) + '⟩  ' + fmtAmp(st.amp[i]) +
        '   p=' + (p[i] * 100).toFixed(2) + '% ' + new Array(bar + 1).join('█') + '</div>';
    }
    if (!html) html = '<div>(all amplitudes zero — collapsed?)</div>';
    if (st.measured.length) {
      html += '<div style="color:#7dff9a">measured: ' +
        st.measured.map(function (m) { return 'q' + m.q + '→' + m.bit; }).join('  ') + '</div>';
    }
    el.innerHTML = html;
    renderEnt(st);
    drawBloch(st);
    if (hiOp != null) {
      var ops = prog ? prog.ops : [];
      $('q-cur').innerHTML = 'step ' + (prog.pc) + '/' + ops.length +
        (hiOp < ops.length ? ' — next: <b>' + esc(ops[hiOp].text) + '</b>' : ' — done');
    } else $('q-cur').textContent = '';
  }

  /* ── entanglement panel ────────────────────────────────── */
  function renderEnt(st) {
    var el = $('q-ent'), html = '';
    for (var q = 0; q < st.n; q++) {
      var rd = V.qubitRDM(st, q), pur = rd.purity;
      var tag = pur > 0.99 ? '<span style="color:#7dff9a">separable</span>'
        : pur < 0.51 ? '<span style="color:#ff6b9d">MAXIMALLY ENTANGLED</span>'
        : '<span style="color:#ffd040">partially entangled</span>';
      html += '<div>qubit ' + q + ': purity ' + pur.toFixed(3) + ' → ' + tag + '</div>';
    }
    if (st.n >= 2) {
      html += '<div style="color:#9a9aa8;margin-top:4px">pair vs rest (1.00 = pair pure on its own):</div>';
      for (var a = 0; a < st.n; a++) for (var b = a + 1; b < st.n; b++) {
        var pr = V.pairRDM(st, a, b).purity;
        html += '<div>pair (' + a + ',' + b + '): ' + pr.toFixed(3) + '</div>';
      }
    }
    el.innerHTML = html;
  }

  /* ── Bloch sphere ──────────────────────────────────────── */
  function drawBloch(st) {
    var cv = $('q-bloch'); if (!cv) return;
    var w = cv.clientWidth, h = cv.clientHeight;
    if (w < 40 || h < 40) return;
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    var q = parseInt(($('q-bloch-q') || {}).value || '0', 10) || 0;
    if (q >= st.n) q = 0;
    var v = V.blochVec(st, q);
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 24;
    ctx.clearRect(0, 0, w, h);
    // sphere
    ctx.strokeStyle = '#3a3a48'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    // equator (y tilted)
    ctx.strokeStyle = '#26262f';
    ctx.beginPath(); ctx.ellipse(cx, cy, R, R * 0.28, 0, 0, 7); ctx.stroke();
    // axes
    function proj(x, y, z) { return [cx + x * R, cy - z * R + y * R * 0.28]; }
    ctx.fillStyle = '#9a9aa8'; ctx.font = '12px sans-serif';
    var labels = [['|0⟩', 0, 0, 1.12], ['|1⟩', 0, 0, -1.12], ['|+⟩', 1.12, 0, 0], ['|−⟩', -1.12, 0, 0], ['|+i⟩', 0, 1.12, 0]];
    labels.forEach(function (L) {
      var p = proj(L[1], L[2], L[3]);
      ctx.fillText(L[0], p[0] - 8, p[1] + 4);
    });
    // vector
    var tip = proj(v.x, v.y, v.z);
    var len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    ctx.strokeStyle = len < 0.05 ? '#5c5c6a' : '#40e0ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
    ctx.fillStyle = '#40e0ff';
    ctx.beginPath(); ctx.arc(tip[0], tip[1], 5, 0, 7); ctx.fill();
    var info = 'qubit ' + q + ': (' + v.x.toFixed(3) + ', ' + v.y.toFixed(3) + ', ' + v.z.toFixed(3) + ')' +
      (len < 0.05 ? ' — vector vanished: this qubit is maximally entangled (no single-qubit state exists)' : '');
    $('q-blochinfo').textContent = info;
  }

  /* ── histogram ─────────────────────────────────────────── */
  function renderHist(counts, nShots) {
    var el = $('q-hist'), keys = Object.keys(counts).sort();
    var max = 0;
    keys.forEach(function (k) { if (counts[k] > max) max = counts[k]; });
    var html = '';
    keys.forEach(function (k) {
      var pct = (counts[k] / nShots * 100), wpx = Math.round(counts[k] / max * 100);
      html += '<div style="display:flex;align-items:center;gap:8px;margin:3px 0">' +
        '<span style="font-family:monospace;width:90px">|' + esc(k) + '⟩</span>' +
        '<div style="height:22px;background:linear-gradient(90deg,#7a2be0,#40e0ff);width:' + wpx + '%;min-width:2px;border-radius:4px"></div>' +
        '<span style="font-family:monospace">' + counts[k] + ' (' + pct.toFixed(1) + '%)</span></div>';
    });
    el.innerHTML = html || '<div class="dsinfo">no shots yet</div>';
  }

  /* ── actions ───────────────────────────────────────────── */
  function currentSrc() { return $('q-src').value; }
  function readNQ() {
    nQ = parseInt($('q-qubits').value, 10) || 2;
    if (nQ < 1) nQ = 1; if (nQ > 8) nQ = 8;
    return nQ;
  }
  function doRun() {
    var n = readNQ(), p = V.parse(currentSrc(), n);
    if (p.errors.length) { log('qasm errors:\n' + p.errors.join('\n'), 'err'); return null; }
    var st = V.newState(n);
    p.ops.forEach(function (op) { V.execOp(st, op); });
    prog = { ops: p.ops, pc: p.ops.length, state: st };
    renderState(st, null);
    $('q-narrate').textContent = 'Ran ' + p.ops.length + ' ops on ' + n + ' qubit(s) — ' +
      st.dim + ' amplitudes. (Classical simulation: this is exactly why 8 qubits is the cap — 2^8 = 256 numbers; 50 qubits would need a quadrillion.)';
    log('q: ran ' + p.ops.length + ' ops, ' + n + ' qubits', 'ok');
    return st;
  }
  function doStep() {
    var n = readNQ();
    if (!prog || prog.pc >= prog.ops.length || prog.n !== n) {
      var p = V.parse(currentSrc(), n);
      if (p.errors.length) { log('qasm errors:\n' + p.errors.join('\n'), 'err'); return; }
      prog = { ops: p.ops, pc: 0, state: V.newState(n), n: n };
    }
    var op = prog.ops[prog.pc];
    V.execOp(prog.state, op);
    if (op.gate === 'MEASURE') {
      var m = prog.state.measured[prog.state.measured.length - 1];
      log('q: step ' + (prog.pc + 1) + ' MEASURE q' + op.q + ' → ' + m.bit, 'dim');
    }
    prog.pc++;
    renderState(prog.state, prog.pc);
  }
  function doReset() {
    prog = null;
    var n = readNQ();
    renderState(V.newState(n), null);
    $('q-hist').innerHTML = '<div class="dsinfo">no shots yet</div>';
    $('q-narrate').textContent = 'Reset to |' + new Array(n + 1).join('0') + '⟩.';
  }
  function doShots() {
    var n = readNQ();
    var nShots = parseInt(($('q-shots-n') || {}).value || '1000', 10) || 1000;
    if (nShots < 10) nShots = 10; if (nShots > 10000) nShots = 10000;
    var r = V.shots(currentSrc(), n, nShots);
    if (r.errors.length) { log('qasm errors:\n' + r.errors.join('\n'), 'err'); return; }
    renderHist(r.counts, nShots);
    log('q: ' + nShots + ' shots done', 'ok');
  }
  function loadPreset() {
    var key = $('q-preset').value;
    if (key === 'teleport') { runTeleport(); return; }
    var pr = PRESETS[key];
    if (!pr) return;
    $('q-src').value = pr.src;
    $('q-narrate').textContent = pr.name + '. ' + pr.narrate;
    doRun();
  }
  /* teleportation walkthrough — needs classical conditioning, so scripted */
  function runTeleport() {
    var narr = [];
    var st = V.newState(3);
    V.applyRot(st, 'RX', 0, 0.6);
    var psi = V.blochVec(st, 0);
    narr.push('1. Prepared |ψ⟩ on q0 with RX(0.6): bloch (' + psi.x.toFixed(3) + ',' + psi.y.toFixed(3) + ',' + psi.z.toFixed(3) + ').');
    V.applyGate(st, 'H', 1); V.applyCNOT(st, 1, 2);
    narr.push('2. Bell pair on q1–q2 (the entangled link between sender and receiver).');
    V.applyCNOT(st, 0, 1); V.applyGate(st, 'H', 0);
    narr.push('3. Sender entangles q0 with her half and measures both (the Bell measurement).');
    var m0 = V.measure(st, 0), m1 = V.measure(st, 1);
    narr.push('4. Measurement results: q0→' + m0 + ', q1→' + m1 + ' — two classical bits sent to the receiver.');
    if (m1 === 1) { V.applyGate(st, 'X', 2); narr.push('5. Bit 2 was 1 → receiver applies X to q2.'); }
    else narr.push('5. Bit 2 was 0 → no X needed.');
    if (m0 === 1) { V.applyGate(st, 'Z', 2); narr.push('6. Bit 1 was 1 → receiver applies Z to q2.'); }
    else narr.push('6. Bit 1 was 0 → no Z needed.');
    var got = V.blochVec(st, 2);
    var match = Math.abs(psi.x - got.x) < 1e-9 && Math.abs(psi.y - got.y) < 1e-9 && Math.abs(psi.z - got.z) < 1e-9;
    narr.push('7. q2 now reads (' + got.x.toFixed(3) + ',' + got.y.toFixed(3) + ',' + got.z.toFixed(3) + ') — ' +
      (match ? 'identical to |ψ⟩. Teleported. (The original on q0 was destroyed by measurement — no cloning.)'
             : 'MISMATCH — something is wrong, report this.'));
    $('q-narrate').innerHTML = narr.map(esc).join('<br>');
    $('q-src').value = '# Teleportation is scripted (needs classical conditioning)\n# — see the walkthrough below. The QASM equivalent:\nRX 0 0.6\nH 1\nCNOT 1 2\nCNOT 0 1\nH 0\nMEASURE 0\nMEASURE 1\n# then: if m1: X 2 ; if m0: Z 2';
    prog = { ops: [], pc: 0, state: st, n: 3 };
    renderState(st, null);
    log('q: teleportation walkthrough complete — ' + (match ? 'state transferred' : 'MISMATCH'), match ? 'ok' : 'err');
  }

  /* ── console API ───────────────────────────────────────── */
  function cmdQasm(arg) {
    var src = String(arg || '').replace(/;/g, '\n');
    var r = V.runAll(src, nQ);
    if (r.errors.length) { log('qasm errors:\n' + r.errors.join('\n'), 'err'); return; }
    var p = V.probs(r.state), top = [];
    for (var i = 0; i < r.state.dim && top.length < 8; i++)
      if (p[i] > 1e-9) top.push('|' + V.bitstr(i, r.state.n) + '⟩ ' + (p[i] * 100).toFixed(1) + '%');
    log('qasm: ' + r.ops.length + ' ops → ' + top.join('  '), 'ok');
  }
  function cmdQstate() {
    var st = prog && prog.state ? prog.state : V.newState(nQ);
    var p = V.probs(st), top = [];
    for (var i = 0; i < st.dim && top.length < 8; i++)
      if (p[i] > 1e-9) top.push('|' + V.bitstr(i, st.n) + '⟩ ' + (p[i] * 100).toFixed(1) + '%');
    log('qstate (' + st.n + 'q): ' + (top.join('  ') || 'all zero'), 'dim');
  }
  function cmdQmeasure(arg) {
    var nShots = parseInt(arg, 10) || 100;
    var src = prog && prog.ops.length ? prog.ops.map(function (o) { return o.text; }).join('\n') : currentSrcSafe();
    var r = V.shots(src, nQ, nShots);
    if (r.errors.length) { log('qasm errors:\n' + r.errors.join('\n'), 'err'); return; }
    var parts = Object.keys(r.counts).sort().map(function (k) { return '|' + k + '⟩×' + r.counts[k]; });
    log('qmeasure ' + nShots + ' shots: ' + parts.join('  '), 'ok');
  }
  function currentSrcSafe() { var el = $('q-src'); return el ? el.value : 'H 0\nCNOT 0 1'; }

  function fillQubitSelects() {
    var n = readNQ(), bq = $('q-bloch-q');
    if (bq) {
      var cur = bq.value;
      bq.innerHTML = '';
      for (var q = 0; q < n; q++) {
        var o = document.createElement('option');
        o.value = String(q); o.textContent = 'qubit ' + q;
        bq.appendChild(o);
      }
      if (cur && parseInt(cur, 10) < n) bq.value = cur;
      bq.onchange = function () { if (prog && prog.state) drawBloch(prog.state); };
    }
  }

  function init() {
    if (!$('btn-q-run')) return;
    $('btn-q-run').onclick = doRun;
    $('btn-q-step').onclick = doStep;
    $('btn-q-reset').onclick = doReset;
    $('btn-q-shots').onclick = doShots;
    $('q-preset').onchange = loadPreset;
    $('q-qubits').onchange = function () { fillQubitSelects(); doReset(); };
    if (!$('q-src').value) $('q-src').value = PRESETS.bell.src;
    fillQubitSelects();
    doReset();
    $('q-narrate').textContent = 'Welcome to the QuantumVM. Pick a preset or type gates — H 0, CNOT 0 1, RX 0 pi/2, MEASURE 0. ' +
      'This is a classical simulation of quantum mechanics running on your phone — not quantum hardware.';
  }
  function onShow() { fillQubitSelects(); if (prog && prog.state) drawBloch(prog.state); }

  return {
    init: init, onShow: onShow,
    cmdQasm: cmdQasm, cmdQstate: cmdQstate, cmdQmeasure: cmdQmeasure,
    runTeleport: runTeleport, doRun: doRun, doStep: doStep, doReset: doReset,
    doShots: doShots, loadPreset: loadPreset,
    last: function () { return prog; }
  };
})();
