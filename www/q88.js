'use strict';
/* Neural Lab v21 — Q8.8 fixed-point export + CNN kernel inspector.
 * Q8.8 = signed 16-bit fixed point: 8 integer bits + 8 fractional bits
 * (scale 1/256). Fits the weights of a trained net into MCU flash as
 * int16_t C arrays, with an integer-only forward pass (no floats in the
 * hot loop — activations via small lookup tables, exactly like firmware).
 * Browser: window.NL_Q88. Node: module.exports (for headless tests).
 */
(function (global) {

  /* ── Q8.8 primitives ───────────────────────────────────────────── */
  function toQ(w) { // float -> int16 Q8.8, saturating
    var q = Math.round(w * 256);
    if (q > 32767) return 32767;
    if (q < -32768) return -32768;
    return q;
  }
  function fromQ(q) { return q / 256; }
  function mulQ(a, b) { return Math.round((a * b) / 256); } // Q8.8 x Q8.8 -> Q8.8

  /* ── integer activations via 256-entry LUTs ──────────────────────
   * The LUTs are built once from Math.tanh / the logistic function, so
   * the hot inference path never touches a float — same trick as on a
   * real MCU, where exp()/tanh() are too expensive per neuron.
   * tanh: 256 entries over [-4, 4] (bin = 8 Q8.8 units); outside -> ±1.
   * sigmoid: 256 entries over [-8, 8] (bin = 16 Q8.8 units); outside -> 0/1.
   */
  var TANH_LUT = null;
  function buildTanhLUT() {
    var t = new Array(256);
    for (var i = 0; i < 256; i++) t[i] = toQ(Math.tanh((i * 8 - 1020) / 256));
    return t;
  }
  function tanhQ(x) {
    if (!TANH_LUT) TANH_LUT = buildTanhLUT();
    var idx = (x + 1024) >> 3;
    if (idx < 0) return -256;
    if (idx > 255) return 256;
    return TANH_LUT[idx];
  }
  var SIG_LUT = null;
  function buildSigLUT() {
    var t = new Array(256);
    for (var i = 0; i < 256; i++) t[i] = toQ(1 / (1 + Math.exp(-((i * 16 - 2040) / 256))));
    return t;
  }
  function sigQ(x) {
    if (!SIG_LUT) SIG_LUT = buildSigLUT();
    var idx = (x + 2048) >> 4;
    if (idx < 0) return 0;
    if (idx > 255) return 256;
    return SIG_LUT[idx];
  }

  /* ── quantization ──────────────────────────────────────────────── */
  function qsat(w, st) { // quantize one float, counting int16 overflows
    var q = Math.round(w * 256);
    if (q > 32767 || q < -32768) { st.overflows++; q = q > 0 ? 32767 : -32768; }
    st.params++;
    return q;
  }
  // MLP: { layers: [{W: rows(out)x cols(in) ints, b: [ints]}], overflows, params }
  function quantizeMLP(model) {
    var st = { overflows: 0, params: 0 };
    var layers = model.W.map(function (Wl, l) {
      var Wq = Wl.map(function (row) { return row.map(function (w) { return qsat(w, st); }); });
      var bq = model.b[l].map(function (w) { return qsat(w, st); });
      return { W: Wq, b: bq };
    });
    return { layers: layers, overflows: st.overflows, params: st.params };
  }
  // CNN: { F: nF x 3 x 3 ints, fb: [ints], W2: nC x (nF*9) ints, b2: [ints], ... }
  function quantizeCNN(model) {
    var st = { overflows: 0, params: 0 };
    var F = model.F.map(function (f) {
      return f.map(function (row) { return row.map(function (w) { return qsat(w, st); }); });
    });
    var fb = model.fb.map(function (w) { return qsat(w, st); });
    var W2 = model.W2.map(function (row) { return row.map(function (w) { return qsat(w, st); }); });
    var b2 = model.b2.map(function (w) { return qsat(w, st); });
    return { F: F, fb: fb, W2: W2, b2: b2, overflows: st.overflows, params: st.params,
      nFilters: model.nFilters, nClasses: model.nClasses };
  }

  /* ── integer-only forward passes (return Q8.8 ints) ─────────────── */
  // mode: 'binary' | 'multiclass' | 'regression'; act: 'tanh' | 'relu'
  function intForwardMLP(q, x, act, mode) {
    var a = x.map(toQ), l, i, j;
    for (l = 0; l < q.layers.length; l++) {
      var Wl = q.layers[l].W, bl = q.layers[l].b;
      var z = new Array(Wl.length);
      for (i = 0; i < Wl.length; i++) {
        var s = bl[i], row = Wl[i];
        for (j = 0; j < row.length; j++) s += mulQ(row[j], a[j]);
        z[i] = s;
      }
      var last = (l === q.layers.length - 1);
      if (last) {
        if (mode === 'regression') a = z;
        else if (mode === 'binary') a = z.map(sigQ);
        else a = z; // multiclass: caller takes argmax over the integer logits
      } else {
        a = (act === 'relu')
          ? z.map(function (v) { return v > 0 ? v : 0; })
          : z.map(tanhQ);
      }
    }
    return a;
  }
  // CNN: conv (Q8.8 MAC) -> ReLU -> 2x2 maxpool -> dense; returns integer logits
  function intForwardCNN(q, x) {
    var X = x.map(toQ), nF = q.nFilters;
    var f, i, j, u, v, pr, pc, dr, dc, c, k;
    var h = [];
    for (f = 0; f < nF; f++) {
      var conv = [];
      for (i = 0; i < 6; i++) {
        var mrow = [];
        for (j = 0; j < 6; j++) {
          var s = q.fb[f], Ff = q.F[f];
          for (u = 0; u < 3; u++)
            for (v = 0; v < 3; v++) s += mulQ(Ff[u][v], X[(i + u) * 8 + (j + v)]);
          mrow.push(s > 0 ? s : 0); // ReLU
        }
        conv.push(mrow);
      }
      for (pr = 0; pr < 3; pr++)
        for (pc = 0; pc < 3; pc++) {
          var best = -Infinity;
          for (dr = 0; dr < 2; dr++)
            for (dc = 0; dc < 2; dc++) {
              var val = conv[pr * 2 + dr][pc * 2 + dc];
              if (val > best) best = val;
            }
          h.push(best);
        }
    }
    var logits = [];
    for (c = 0; c < q.nClasses; c++) {
      var s2 = q.b2[c], Wc = q.W2[c];
      for (k = 0; k < h.length; k++) s2 += mulQ(Wc[k], h[k]);
      logits.push(s2);
    }
    return logits;
  }

  /* ── C header rendering ────────────────────────────────────────── */
  function cComment(dataset, sizes, params) {
    var name = String(dataset).replace(/[^\x20-\x7e]/g, '?');
    return '/* Neural Lab Q8.8 export — dataset: ' + name + '\n' +
      ' * layers: ' + sizes.join(' -> ') + '\n' +
      ' * params: ' + params + ' (' + (2 * params) + ' bytes as int16_t)\n' +
      ' * Q8.8 = signed 16-bit fixed point, 8 int bits + 8 frac bits (x/256).\n' +
      ' */';
  }
  function mat2d(m) {
    return m.map(function (row) { return '  {' + row.join(', ') + '}'; }).join(',\n');
  }
  function renderCHeaderMLP(q, meta) {
    var lines = [cComment(meta.dataset, meta.sizes, q.params)];
    q.layers.forEach(function (L, l) {
      var rows = L.W.length, cols = L.W[0].length;
      lines.push('const int16_t L' + l + '_W_Q88[' + rows + '][' + cols + '] = {\n' +
        mat2d(L.W) + '\n};');
      lines.push('const int16_t L' + l + '_B_Q88[' + L.b.length + '] = {' + L.b.join(', ') + '};');
    });
    return lines.join('\n');
  }
  function renderCHeaderCNN(q, meta) {
    var nF = q.nFilters, nC = q.nClasses, nIn = nF * 9;
    var lines = [cComment(meta.dataset, meta.sizes, q.params)];
    lines.push('const int16_t F_Q88[' + nF + '][3][3] = {');
    for (var f = 0; f < nF; f++)
      lines.push('  { // filter ' + f + '\n' + mat2d(q.F[f]) + '\n  }' + (f < nF - 1 ? ',' : ''));
    lines.push('};');
    lines.push('const int16_t FB_Q88[' + nF + '] = {' + q.fb.join(', ') + '};');
    lines.push('const int16_t W2_Q88[' + nC + '][' + nIn + '] = {\n' + mat2d(q.W2) + '\n};');
    lines.push('const int16_t B2_Q88[' + nC + '] = {' + q.b2.join(', ') + '};');
    return lines.join('\n');
  }

  /* ── CNN kernel ASCII inspector ────────────────────────────────── */
  var DENSITY = ' .:-=+*#%@';
  function asciiKernels(F) {
    var out = ['conv kernels (' + F.length + ' filters, 3x3):'];
    for (var f = 0; f < F.length; f++) {
      var mn = Infinity, mx = -Infinity, sum = 0, n = 0, u, v;
      for (u = 0; u < 3; u++) for (v = 0; v < 3; v++) {
        var w = F[f][u][v];
        if (w < mn) mn = w;
        if (w > mx) mx = w;
        sum += w; n++;
      }
      out.push('filter ' + f + ' (min ' + mn.toFixed(3) + ', max ' + mx.toFixed(3) +
        ', mean ' + (sum / n).toFixed(3) + '):');
      for (u = 0; u < 3; u++) {
        var s = '';
        for (v = 0; v < 3; v++) {
          var t = (mx - mn) < 1e-12 ? 0.5 : (F[f][u][v] - mn) / (mx - mn);
          s += DENSITY[Math.round(t * (DENSITY.length - 1))];
        }
        out.push('  ' + s);
      }
    }
    return out.join('\n');
  }

  /* ── model_q88.js generator (self-contained integer inference) ─── */
  // spec: {kind:'mlp'|'cnn', dataset, sizes, act, mode, layers|{F,fb,W2,b2,nFilters,nClasses},
  //         samples:[{x:[floats], fclass:int} | {x, fprob:float} | {x, fval:float}]}
  function buildModelQ88File(spec) {
    var P = [];
    P.push('/* model_q88.js — integer-only Q8.8 inference for a Neural Lab export');
    P.push(' * dataset: ' + String(spec.dataset).replace(/\*\//g, '* /'));
    P.push(' * layers: ' + spec.sizes.join(' -> '));
    P.push(' *');
    P.push(' * Q8.8 FORMAT: every weight, bias and activation is a signed 16-bit');
    P.push(' * integer holding (float_value * 256). So 1.0 -> 256, -0.5 -> -128,');
    P.push(' * 0.00390625 -> 1. Multiply two Q8.8 numbers and the product is');
    P.push(' * Q16.16 — shift/scale it back down by 256 (mulQ below) to stay in');
    P.push(' * Q8.8. This is the standard fixed-point trick for MCUs with no FPU:');
    P.push(' * the whole forward pass below is integer arithmetic, and tanh /');
    P.push(' * sigmoid come from small lookup tables instead of exp().');
    P.push(' */');
    P.push("'use strict';");
    P.push('');
    P.push('// — Q8.8 helpers —');
    P.push('var toQ = ' + toQ.toString() + ';');
    P.push('var fromQ = ' + fromQ.toString() + ';');
    P.push('var mulQ = ' + mulQ.toString() + ';');
    P.push('');
    P.push('// 256-entry tanh LUT over [-4, 4], built once from Math.tanh.');
    P.push('// Comment: on a real MCU exp() is far too slow per neuron, so the');
    P.push('// hot path stays integer-only and reads the curve from this table.');
    P.push('var buildTanhLUT = ' + buildTanhLUT.toString() + ';');
    P.push('var TANH_LUT = buildTanhLUT();');
    P.push('function tanhQ(x) {');
    P.push('  var idx = (x + 1024) >> 3;');
    P.push('  if (idx < 0) return -256;');
    P.push('  if (idx > 255) return 256;');
    P.push('  return TANH_LUT[idx];');
    P.push('}');
    P.push('var buildSigLUT = ' + buildSigLUT.toString() + ';');
    P.push('var SIG_LUT = buildSigLUT();');
    P.push('function sigQ(x) {');
    P.push('  var idx = (x + 2048) >> 4;');
    P.push('  if (idx < 0) return 0;');
    P.push('  if (idx > 255) return 256;');
    P.push('  return SIG_LUT[idx];');
    P.push('}');
    P.push('');
    if (spec.kind === 'cnn') {
      var q = spec.layers;
      P.push('// — exported weights (plain int arrays, Q8.8) —');
      P.push('var F_Q88 = ' + JSON.stringify(q.F) + ';');
      P.push('var FB_Q88 = ' + JSON.stringify(q.fb) + ';');
      P.push('var W2_Q88 = ' + JSON.stringify(q.W2) + ';');
      P.push('var B2_Q88 = ' + JSON.stringify(q.b2) + ';');
      P.push('var N_FILTERS = ' + q.nFilters + ', N_CLASSES = ' + q.nClasses + ';');
      P.push('');
      P.push('// integer-only CNN forward: conv (Q8.8 MAC) -> ReLU -> 2x2 maxpool');
      P.push('// -> dense. Returns integer logits (argmax == predicted class).');
      P.push('function forwardQ88(x) {');
      P.push('  var X = x.map(toQ), h = [], f, i, j, u, v, pr, pc, dr, dc, c, k;');
      P.push('  for (f = 0; f < N_FILTERS; f++) {');
      P.push('    var conv = [];');
      P.push('    for (i = 0; i < 6; i++) {');
      P.push('      var mrow = [];');
      P.push('      for (j = 0; j < 6; j++) {');
      P.push('        var s = FB_Q88[f], Ff = F_Q88[f];');
      P.push('        for (u = 0; u < 3; u++)');
      P.push('          for (v = 0; v < 3; v++) s += mulQ(Ff[u][v], X[(i + u) * 8 + (j + v)]);');
      P.push('        mrow.push(s > 0 ? s : 0);');
      P.push('      }');
      P.push('      conv.push(mrow);');
      P.push('    }');
      P.push('    for (pr = 0; pr < 3; pr++) for (pc = 0; pc < 3; pc++) {');
      P.push('      var best = -Infinity;');
      P.push('      for (dr = 0; dr < 2; dr++) for (dc = 0; dc < 2; dc++) {');
      P.push('        var val = conv[pr * 2 + dr][pc * 2 + dc];');
      P.push('        if (val > best) best = val;');
      P.push('      }');
      P.push('      h.push(best);');
      P.push('    }');
      P.push('  }');
      P.push('  var logits = [];');
      P.push('  for (c = 0; c < N_CLASSES; c++) {');
      P.push('    var s2 = B2_Q88[c], Wc = W2_Q88[c];');
      P.push('    for (k = 0; k < h.length; k++) s2 += mulQ(Wc[k], h[k]);');
      P.push('    logits.push(s2);');
      P.push('  }');
      P.push('  return logits;');
      P.push('}');
      P.push('function argmax(a) { var bi = 0, k; for (k = 1; k < a.length; k++) if (a[k] > a[bi]) bi = k; return bi; }');
    } else {
      P.push('// — exported weights (plain int arrays, Q8.8) —');
      P.push('var LAYERS = ' + JSON.stringify(spec.layers) + '; // [{W: rows x cols, b: [...]}]');
      P.push("var ACT = '" + spec.act + "', MODE = '" + spec.mode + "';");
      P.push('');
      P.push('// integer-only MLP forward; returns Q8.8 ints.');
      P.push('// hidden: ' + spec.act + '; output: ' +
        (spec.mode === 'binary' ? 'sigmoid LUT' : spec.mode === 'multiclass' ? 'argmax over logits' : 'linear') + '.');
      P.push('function forwardQ88(x) {');
      P.push('  var a = x.map(toQ), l, i, j;');
      P.push('  for (l = 0; l < LAYERS.length; l++) {');
      P.push('    var Wl = LAYERS[l].W, bl = LAYERS[l].b;');
      P.push('    var z = new Array(Wl.length);');
      P.push('    for (i = 0; i < Wl.length; i++) {');
      P.push('      var s = bl[i], row = Wl[i];');
      P.push('      for (j = 0; j < row.length; j++) s += mulQ(row[j], a[j]);');
      P.push('      z[i] = s;');
      P.push('    }');
      P.push('    var last = (l === LAYERS.length - 1);');
      P.push('    if (last) {');
      P.push("      if (MODE === 'regression') a = z;");
      P.push("      else if (MODE === 'binary') a = z.map(sigQ);");
      P.push('      else a = z;');
      P.push('    } else {');
      P.push("      a = (ACT === 'relu') ? z.map(function (v) { return v > 0 ? v : 0; }) : z.map(tanhQ);");
      P.push('    }');
      P.push('  }');
      P.push('  return a;');
      P.push('}');
      P.push('function argmax(a) { var bi = 0, k; for (k = 1; k < a.length; k++) if (a[k] > a[bi]) bi = k; return bi; }');
    }
    P.push('');
    P.push('// — demo: integer inference vs the float net on sample inputs —');
    P.push('var SAMPLES = ' + JSON.stringify(spec.samples) + ';');
    if (spec.mode === 'binary') {
      P.push('var agree = 0, maxDiff = 0;');
      P.push('SAMPLES.forEach(function (sm, i) {');
      P.push('  var ip = fromQ(forwardQ88(sm.x)[0]);           // integer path');
      P.push('  var d = Math.abs(ip - sm.fprob); if (d > maxDiff) maxDiff = d;');
      P.push('  var ic = ip >= 0.5 ? 1 : 0, fc = sm.fprob >= 0.5 ? 1 : 0;');
      P.push('  if (ic === fc) agree++;');
      P.push("  console.log('[' + i + '] int=' + ip.toFixed(4) + ' float=' + sm.fprob.toFixed(4) +");
      P.push("    (ic === fc ? '  OK' : '  MISMATCH'));");
      P.push('});');
      P.push("console.log('int8.8 inference: ' + agree + '/' + SAMPLES.length + ' agree with float (max |int-float| = ' + maxDiff.toFixed(4) + ')');");
    } else if (spec.mode === 'regression') {
      P.push('var maxDiff = 0;');
      P.push('SAMPLES.forEach(function (sm, i) {');
      P.push('  var iv = fromQ(forwardQ88(sm.x)[0]);');
      P.push('  var d = Math.abs(iv - sm.fval); if (d > maxDiff) maxDiff = d;');
      P.push("  console.log('[' + i + '] int=' + iv.toFixed(4) + ' float=' + sm.fval.toFixed(4));");
      P.push('});');
      P.push("console.log('int8.8 inference: ' + SAMPLES.length + '/' + SAMPLES.length + ' evaluated (max |int-float| = ' + maxDiff.toFixed(4) + ')');");
    } else {
      P.push('var agree = 0;');
      P.push('SAMPLES.forEach(function (sm, i) {');
      P.push('  var ic = argmax(forwardQ88(sm.x));');
      P.push("  if (ic === sm.fclass) agree++;");
      P.push("  console.log('[' + i + '] int-class=' + ic + ' float-class=' + sm.fclass +");
      P.push("    (ic === sm.fclass ? '  OK' : '  MISMATCH'));");
      P.push('});');
      P.push("console.log('int8.8 inference: ' + agree + '/' + SAMPLES.length + ' agree with float');");
    }
    return P.join('\n') + '\n';
  }

  var API = {
    toQ: toQ, fromQ: fromQ, mulQ: mulQ,
    tanhQ: tanhQ, sigQ: sigQ,
    quantizeMLP: quantizeMLP, quantizeCNN: quantizeCNN,
    intForwardMLP: intForwardMLP, intForwardCNN: intForwardCNN,
    renderCHeaderMLP: renderCHeaderMLP, renderCHeaderCNN: renderCHeaderCNN,
    asciiKernels: asciiKernels,
    buildModelQ88File: buildModelQ88File
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.NL_Q88 = API;
  }
})(typeof window !== 'undefined' ? window : global);
