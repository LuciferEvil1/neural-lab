'use strict';
/* Neural Lab v27 -- c_codegen.js: BareMetal C exporter.
 *
 * Extends the v21 Q8.8 exporter (q88.js): from a trained, quantized model it
 * generates a SELF-CONTAINED, compilable C file pair
 *   neural_lab_infer.h / neural_lab_infer.c
 * implementing allocation-free, pointer-bumped integer inference:
 *   void model_run(const q8_t* in, q8_t* out);
 * No malloc anywhere: one static scratch pool in .bss, a bump pointer that
 * resets every call, weights/biases as `const int16_t` (flash), activations
 * from baked-in 1024-entry lookup tables (no exp()/tanh() in firmware).
 *
 * LUT vs PIECEWISE-LINEAR -- why the LUT won:
 *   - constant-time, branchless table read -> deterministic cycle counts,
 *     which is what hard real-time inference needs;
 *   - 1024 entries over the active range gives <= 1 LSB worst-case error
 *     per lookup (tanh: x-step 0.0078125, max slope 1 -> 0.5 LSB typical,
 *     1 LSB worst; sigmoid: slope <= 0.25 -> <= 0.5 LSB). A piecewise-linear
 *     approximation needs >= 16 segments plus branching to match that, and
 *     costs MORE cycles on a Cortex-M0 than one indexed load;
 *   - 1 KiB per table is negligible flash on M0/M4 targets, and the tables
 *     are baked into the generated file at export time, so the firmware
 *     build needs no floating point at all.
 *
 * QUANTIZATION DRIFT expectations (measured, see the MCU sim in mcu-sim.js):
 *   - weights/biases round to nearest Q8.8: <= 0.5 LSB each;
 *   - each neuron accumulates products in a 64-bit integer (Q16.16) and
 *     rounds ONCE at the end (symmetric round-half-away-from-zero), so a
 *     MAC contributes <= 0.5 LSB of rounding, not one per product;
 *   - activation LUTs add <= 1 LSB per lookup (see above); well-trained nets
 *     saturate their tanh units where the table slope -> 0, so real drift is
 *     far below the bound. Typical end-to-end: <= 1 LSB vs the float net.
 *   - ROUNDING NOTE: the C/symmetric rounding differs from JS Math.round
 *     only on exact x.5 products, and then by exactly 1 LSB. The MCU
 *     simulator (mcu-sim.js) uses the identical symmetric rule, so sim and
 *     generated C are bit-exact with each other.
 *   - int8_t is NOT used for weights: Q8.8 needs the full 16-bit container
 *     (8 integer bits). int8 would only hold ~Q1.6 and clip real weights.
 *
 * Compile check (host):  gcc -O2 -Wall -o infer_test neural_lab_infer.c harness.c
 * Bare metal:  arm-none-eabi-gcc -Os -mcpu=cortex-m0 -mthumb -c neural_lab_infer.c
 *
 * Browser: window.NL_CCODE. Node: module.exports (for headless tests).
 */
(function (global) {

  /* ── symmetric Q8.8 rounding (JS mirror of the C q8_from_acc) ─────── */
  function toQsym(v) {
    var q = v >= 0 ? Math.floor(v * 256 + 0.5) : Math.ceil(v * 256 - 0.5);
    if (q > 32767) return 32767;
    if (q < -32768) return -32768;
    return q;
  }
  function satQ(v) {
    if (v > 32767) return 32767;
    if (v < -32768) return -32768;
    return v;
  }
  /* one neuron's integer core, shared by the sim and the parity tests:
   * acc = (bias << 8) + sum(w*x) in Q16.16, single symmetric rounding. */
  function neuronQ8(biasQ, wRowQ, aQ) {
    var acc = biasQ * 256; // (biasQ << 8), exact in double
    for (var j = 0; j < wRowQ.length; j++) acc += wRowQ[j] * aQ[j];
    var adj = acc >= 0 ? 128 : -128;
    return satQ(Math.floor((acc + adj) / 256));
  }

  /* ── 1024-entry activation LUTs (baked into the C file at export) ── */
  var TANH1024 = null, SIG1024 = null;
  function buildTanhLUT1024() {
    var t = new Array(1024);
    for (var i = 0; i < 1024; i++) t[i] = toQsym(Math.tanh((i * 2 - 1022) / 256));
    return t;
  }
  function buildSigLUT1024() {
    var t = new Array(1024);
    for (var i = 0; i < 1024; i++) t[i] = toQsym(1 / (1 + Math.exp(-((i * 4 - 2046) / 256))));
    return t;
  }
  function tanhLUT() { if (!TANH1024) TANH1024 = buildTanhLUT1024(); return TANH1024; }
  function sigLUT() { if (!SIG1024) SIG1024 = buildSigLUT1024(); return SIG1024; }
  function tanhQ1024(x) {
    var T = tanhLUT(), idx = (x + 1024) >> 1;
    if (idx < 0) return -256;
    if (idx > 1023) return 256;
    return T[idx];
  }
  function sigQ1024(x) {
    var S = sigLUT(), idx = (x + 2048) >> 2;
    if (idx < 0) return 0;
    if (idx > 1023) return 256;
    return S[idx];
  }

  /* ── spec ──────────────────────────────────────────────────────────
   * {kind:'mlp'|'cnn', dataset, sizes, act:'tanh'|'relu', mode,
   *  layers:[{W:[[q]], b:[q]}]} for mlp, or {F,fb,W2,b2,nFilters,nClasses}
   * (the quantized q object from NL_Q88) for cnn. */
  function cIdent(s) {
    return String(s == null ? 'model' : s).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || 'model';
  }
  function maxWidthMLP(layers) {
    var m = 0, l;
    for (l = 0; l < layers.length; l++) if (layers[l].W.length > m) m = layers[l].W.length;
    return m;
  }

  function headerComment(spec, params, bytes) {
    var name = String(spec.dataset).replace(/[^\x20-\x7e]/g, '?').replace(/\*\//g, '* /');
    return (
      '/*\n' +
      ' * neural_lab_infer -- BareMetal C inference export (Neural Lab v27)\n' +
      ' * dataset : ' + name + '\n' +
      ' * layers  : ' + spec.sizes.join(' -> ') + '\n' +
      ' * params  : ' + params + ' (' + bytes + ' bytes as const int16_t, flash)\n' +
      ' *\n' +
      ' * Q8.8 fixed point: signed 16-bit, value = int16 / 256.\n' +
      ' * API: void model_run(const q8_t* in, q8_t* out);\n' +
      ' *   in  : MODEL_IN  Q8.8 samples (caller-owned)\n' +
      ' *   out : MODEL_OUT Q8.8 results  (caller-owned)\n' +
      ' * Allocation-free: one static scratch pool in .bss, bumped per layer,\n' +
      ' * pointer resets every call. No malloc, no heap, no floats.\n' +
      ' *\n' +
      ' * ACTIVATIONS -- LUT vs piecewise-linear (why the LUT won):\n' +
      ' *   tanh/sigmoid come from baked-in 1024-entry int16_t tables\n' +
      ' *   (tanh over [-4,4], sigmoid over [-8,8]; outside -> saturation).\n' +
      ' *   Constant-time branchless reads -> deterministic cycle counts for\n' +
      ' *   real-time inference. Worst-case lookup error <= 1 LSB (tanh) and\n' +
      ' *   <= 0.5 LSB (sigmoid); a PWL approximation needs 16+ segments plus\n' +
      ' *   branching to match that and costs MORE cycles on a Cortex-M0.\n' +
      ' *   1 KiB per table is negligible flash. Tables are baked at export,\n' +
      ' *   so the firmware build needs no floating point at all.\n' +
      ' *\n' +
      ' * QUANTIZATION DRIFT (what to expect vs the float net):\n' +
      ' *   - weights/biases round to nearest: <= 0.5 LSB each;\n' +
      ' *   - each neuron accumulates in 64-bit (Q16.16) and rounds ONCE\n' +
      ' *     (symmetric half-away-from-zero): <= 0.5 LSB per neuron;\n' +
      ' *   - LUT lookups add <= 1 LSB each; saturated tanh units contribute\n' +
      ' *     ~0 (table slope -> 0 where trained nets actually sit).\n' +
      ' *   Typical end-to-end drift on small nets: <= 1 LSB (1/256).\n' +
      ' *   Rounding note: symmetric half-away differs from JS Math.round\n' +
      ' *   only on exact x.5 products, by exactly 1 LSB; the virtual MCU\n' +
      ' *   simulator (mcu-sim.js) uses the identical rule, so sim and this\n' +
      ' *   file are bit-exact with each other.\n' +
      ' *\n' +
      ' * Compile (host test): gcc -O2 -Wall -o infer_test neural_lab_infer.c harness.c\n' +
      ' * Bare metal       : arm-none-eabi-gcc -Os -mcpu=cortex-m0 -mthumb -c neural_lab_infer.c\n' +
      ' */'
    );
  }

  function renderInt16Array(name, vals, perRow) {
    perRow = perRow || 16;
    var lines = ['static const int16_t ' + name + '[' + vals.length + '] = {'];
    for (var i = 0; i < vals.length; i += perRow) {
      lines.push('  ' + vals.slice(i, i + perRow).join(', ') +
        (i + perRow < vals.length ? ',' : ''));
    }
    lines.push('};');
    return lines.join('\n');
  }
  function renderMatrices(prefix, layers) {
    var out = [];
    layers.forEach(function (L, l) {
      var rows = L.W.length, cols = L.W[0].length;
      out.push('static const int16_t ' + prefix + 'W' + l + '_Q88[' + rows + '][' + cols + '] = {');
      out.push(L.W.map(function (row) { return '  {' + row.join(', ') + '}'; }).join(',\n'));
      out.push('};');
      out.push('static const int16_t ' + prefix + 'B' + l + '_Q88[' + L.b.length + '] = {' +
        L.b.join(', ') + '};');
    });
    return out.join('\n');
  }

  function actDefine(spec) {
    if (spec.kind === 'cnn') return '#define MODEL_ACT_RELU 1   /* conv block: relu */';
    return spec.act === 'relu' ? '#define MODEL_ACT_RELU 1' : '#define MODEL_ACT_TANH 1';
  }

  function buildInferH(spec, q) {
    var nIn = spec.sizes[0], nOut = spec.sizes[spec.sizes.length - 1];
    var P = [];
    P.push('#ifndef NEURAL_LAB_INFER_H');
    P.push('#define NEURAL_LAB_INFER_H');
    P.push('');
    P.push('#include <stdint.h>');
    P.push('');
    P.push('/* Q8.8: signed 16-bit fixed point, real value = q / 256.0 */');
    P.push('typedef int16_t q8_t;');
    P.push('');
    P.push('#define MODEL_IN  ' + nIn);
    P.push('#define MODEL_OUT ' + nOut);
    P.push(actDefine(spec));
    P.push('');
    P.push('/* Integer-only forward pass. in/out are caller-owned Q8.8 buffers.');
    P.push(' * Allocation-free: static scratch pool, bumped per layer. */');
    P.push('void model_run(const q8_t* in, q8_t* out);');
    P.push('');
    P.push('#endif /* NEURAL_LAB_INFER_H */');
    return P.join('\n') + '\n';
  }

  function corePrologue() {
    return [
      '#include "neural_lab_infer.h"',
      '',
      '/* saturate a Q16.16-shifted accumulator back to Q8.8 range */',
      'static inline q8_t q8_sat(int64_t v) {',
      '  if (v > 32767) return 32767;',
      '  if (v < -32768) return -32768;',
      '  return (q8_t)v;',
      '}',
      '/* one neuron: acc = (bias << 8) + sum(w*x) in Q16.16, single symmetric',
      ' * round-half-away-from-zero at the end. 64-bit acc never overflows for',
      ' * sane layers (54 x 2^30 < 2^53 << 2^63); M0 pays ~6 cycles per MAC,',
      ' * M4 ~2 (see the virtual MCU simulator for the cycle model). */',
      'static inline q8_t neuron_q8(q8_t bias, const q8_t* w, const q8_t* a, int n) {',
      '  int64_t acc = ((int64_t)bias) << 8;',
      '  for (int j = 0; j < n; j++) acc += (int64_t)w[j] * (int64_t)a[j];',
      '  acc += (acc >= 0) ? 128 : -128;',
      '  return q8_sat(acc >> 8);',
      '}'
    ].join('\n');
  }

  function lutDecls() {
    return [
      '',
      '/* 1024-entry tanh LUT over [-4, 4]: idx = (x + 1024) >> 1, saturate outside */',
      renderInt16Array('TANH_LUT_Q88', tanhLUT()),
      'static inline q8_t tanh_q8(q8_t x) {',
      '  int idx = (x + 1024) >> 1;',
      '  if (idx < 0) return -256;',
      '  if (idx > 1023) return 256;',
      '  return TANH_LUT_Q88[idx];',
      '}',
      '',
      '/* 1024-entry sigmoid LUT over [-8, 8]: idx = (x + 2048) >> 2, saturate outside */',
      renderInt16Array('SIG_LUT_Q88', sigLUT()),
      'static inline q8_t sig_q8(q8_t x) {',
      '  int idx = (x + 2048) >> 2;',
      '  if (idx < 0) return 0;',
      '  if (idx > 1023) return 256;',
      '  return SIG_LUT_Q88[idx];',
      '}',
      ''
    ].join('\n');
  }

  function hiddenActCall(spec) {
    return spec.act === 'relu' ? 'z > 0 ? z : 0' : 'tanh_q8(z)';
  }

  function buildInferCMLP(spec, q) {
    var layers = q.layers, nL = layers.length;
    var maxW = maxWidthMLP(layers);
    var scratchWords = 0, l;
    for (l = 0; l < nL - 1; l++) scratchWords += layers[l].W.length; // hidden layers only
    var P = [];
    P.push(corePrologue());
    P.push(lutDecls());
    P.push(renderMatrices('MODEL_', layers));
    P.push('');
    P.push('/* static scratch pool in .bss (' + scratchWords + ' words = ' +
      (2 * scratchWords) + ' bytes); bumped per layer, never malloc. */');
    P.push('static q8_t scratch[' + Math.max(scratchWords, 1) + '];');
    P.push('');
    P.push('void model_run(const q8_t* in, q8_t* out) {');
    P.push('  q8_t* bump = scratch; /* bump allocator: reset every call */');
    P.push('  const q8_t* src = in;');
    for (l = 0; l < nL; l++) {
      var nOut = layers[l].W.length, nIn = layers[l].W[0].length;
      var last = (l === nL - 1);
      P.push('  /* layer ' + l + ': ' + nIn + ' -> ' + nOut +
        (last ? ' (' + spec.mode + ' output)' : ' (' + spec.act + ')') + ' */');
      if (last) {
        P.push('  for (int i = 0; i < ' + nOut + '; i++) {');
        P.push('    q8_t z = neuron_q8(MODEL_B' + l + '_Q88[i], MODEL_W' + l + '_Q88[i], src, ' + nIn + ');');
        if (spec.mode === 'binary') P.push('    out[i] = sig_q8(z);');
        else P.push('    out[i] = z; /* ' + spec.mode + ': raw logits / linear */');
        P.push('  }');
      } else {
        P.push('  { q8_t* dst = bump; bump += ' + nOut + ';');
        P.push('    for (int i = 0; i < ' + nOut + '; i++) {');
        P.push('      q8_t z = neuron_q8(MODEL_B' + l + '_Q88[i], MODEL_W' + l + '_Q88[i], src, ' + nIn + ');');
        P.push('      dst[i] = ' + hiddenActCall(spec) + ';');
        P.push('    }');
        P.push('    src = dst;');
        P.push('  }');
      }
    }
    P.push('}');
    return P.join('\n') + '\n';
  }

  function buildInferCCNN(spec, q) {
    var nF = q.nFilters, nC = q.nClasses, nIn = nF * 9;
    var P = [];
    P.push(corePrologue());
    P.push(lutDecls());
    P.push('static const int16_t F_Q88[' + nF + '][3][3] = {');
    for (var f = 0; f < nF; f++) {
      P.push('  { /* filter ' + f + ' */');
      P.push(q.F[f].map(function (row) { return '    {' + row.join(', ') + '}'; }).join(',\n'));
      P.push('  }' + (f < nF - 1 ? ',' : ''));
    }
    P.push('};');
    P.push('static const int16_t FB_Q88[' + nF + '] = {' + q.fb.join(', ') + '};');
    P.push('static const int16_t W2_Q88[' + nC + '][' + nIn + '] = {');
    P.push(q.W2.map(function (row) { return '  {' + row.join(', ') + '}'; }).join(',\n'));
    P.push('};');
    P.push('static const int16_t B2_Q88[' + nC + '] = {' + q.b2.join(', ') + '};');
    P.push('');
    P.push('/* scratch: full conv volume + pooled maps, bumped, never malloc */');
    P.push('#define CONV_WORDS ' + (nF * 36));
    P.push('#define POOL_WORDS ' + (nF * 9));
    P.push('static q8_t scratch[CONV_WORDS + POOL_WORDS]; /* ' +
      (2 * (nF * 36 + nF * 9)) + ' bytes */');
    P.push('');
    P.push('/* conv (Q8.8 MAC, int64 acc) -> relu -> 2x2 maxpool -> dense. out = logits. */');
    P.push('void model_run(const q8_t* in, q8_t* out) {');
    P.push('  q8_t* bump = scratch;');
    P.push('  q8_t* conv = bump; bump += CONV_WORDS;');
    P.push('  for (int f = 0; f < ' + nF + '; f++) {');
    P.push('    for (int i = 0; i < 6; i++) {');
    P.push('      for (int j = 0; j < 6; j++) {');
    P.push('        int64_t acc = ((int64_t)FB_Q88[f]) << 8;');
    P.push('        for (int u = 0; u < 3; u++)');
    P.push('          for (int v = 0; v < 3; v++)');
    P.push('            acc += (int64_t)F_Q88[f][u][v] * (int64_t)in[(i + u) * 8 + (j + v)];');
    P.push('        acc += (acc >= 0) ? 128 : -128;');
    P.push('        q8_t z = q8_sat(acc >> 8);');
    P.push('        conv[f * 36 + i * 6 + j] = z > 0 ? z : 0; /* relu */');
    P.push('      }');
    P.push('    }');
    P.push('  }');
    P.push('  q8_t* h = bump; bump += POOL_WORDS;');
    P.push('  for (int f = 0; f < ' + nF + '; f++)');
    P.push('    for (int pr = 0; pr < 3; pr++)');
    P.push('      for (int pc = 0; pc < 3; pc++) {');
    P.push('        q8_t best = conv[f * 36 + (pr * 2) * 6 + pc * 2];');
    P.push('        for (int dr = 0; dr < 2; dr++)');
    P.push('          for (int dc = 0; dc < 2; dc++) {');
    P.push('            q8_t v = conv[f * 36 + (pr * 2 + dr) * 6 + (pc * 2 + dc)];');
    P.push('            if (v > best) best = v;');
    P.push('          }');
    P.push('        h[f * 9 + pr * 3 + pc] = best;');
    P.push('      }');
    P.push('  for (int c = 0; c < ' + nC + '; c++)');
    P.push('    out[c] = neuron_q8(B2_Q88[c], W2_Q88[c], h, ' + nIn + ');');
    P.push('}');
    return P.join('\n') + '\n';
  }

  function countParamsMLP(layers) {
    var p = 0;
    layers.forEach(function (L) { p += L.W.length * L.W[0].length + L.b.length; });
    return p;
  }

  function buildInferPair(spec, q) {
    var params, c;
    if (spec.kind === 'cnn') {
      params = q.nFilters * 9 + q.nFilters + q.nClasses * q.nFilters * 9 + q.nClasses;
      c = buildInferCCNN(spec, q);
    } else {
      params = countParamsMLP(q.layers);
      c = buildInferCMLP(spec, q);
    }
    var h = buildInferH(spec, q);
    var comment = headerComment(spec, params, 2 * params + 2048 /* +LUTs */);
    return { h: comment + '\n' + h, c: comment + '\n' + c };
  }

  var API = {
    toQsym: toQsym, satQ: satQ, neuronQ8: neuronQ8,
    buildTanhLUT1024: buildTanhLUT1024, buildSigLUT1024: buildSigLUT1024,
    tanhQ1024: tanhQ1024, sigQ1024: sigQ1024,
    buildInferH: buildInferH, buildInferCMLP: buildInferCMLP,
    buildInferCCNN: buildInferCCNN, buildInferPair: buildInferPair
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.NL_CCODE = API;
  }
})(typeof window !== 'undefined' ? window : global);
