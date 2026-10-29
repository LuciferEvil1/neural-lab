'use strict';
/* Neural Lab v27 — mcu-sim.js: virtual MCU runtime simulator.
 *
 * A lightweight interpreter that runs the integer inference behind
 * "Export C" (c_codegen.js) under strict MCU constraints, in plain JS:
 *
 *   - fixed scratchpad pool (bump allocator, default 4096 bytes,
 *     configurable 64..16384; the preset/UI field targets 2 KB-16 KB);
 *   - stack-depth watchdog and a heap that does not exist: clean
 *     ERR_STACK_OVERFLOW / ERR_HEAP_DISABLED / ERR_SCRATCHPAD_OVERFLOW
 *     traps, never a WebView crash;
 *   - cycle estimation for 16 MHz Cortex-M0 vs 64 MHz Cortex-M4, with
 *     integer-multiply and float-fallback penalties tracked separately;
 *   - after a run: total cycles (+ microseconds), peak RAM, register file.
 *
 * CYCLE MODEL (documented estimates, not measured silicon):
 *   M0 (no FPU, slow 32-bit multiply): mac16 (16x16->64 acc) = 6 cycles,
 *     add/shift = 1, load/store = 2, LUT read = 3, branch = 2,
 *     float fallback (soft-float) = 48.
 *   M4 (single-cycle 32-bit MAC, single-precision FPU): mac16 = 2,
 *     add/shift = 1, load/store = 1, LUT read = 2, branch = 1, float = 2.
 *
 * NUMERICS: bit-exact with the generated neural_lab_infer.c — same
 * symmetric round-half-away-from-zero, same 64-bit accumulate-then-round,
 * same 1024-entry LUTs (borrowed from NL_CCODE when available, with an
 * identical local fallback). So: sim output == compiled-C output, exactly.
 *
 * Browser: window.NL_MCU (needs NL_CCODE on the page, falls back
 * gracefully). Node: module.exports. JS Editor: window.* globals.
 */
(function (global) {

  function CC() {
    if (typeof window !== 'undefined' && window.NL_CCODE) return window.NL_CCODE;
    if (typeof global !== 'undefined' && global.NL_CCODE) return global.NL_CCODE;
    try {
      if (typeof require !== 'undefined') return require('./c_codegen.js');
    } catch (e) { /* standalone fallback below */ }
    return null;
  }
  /* identical-math fallback if c_codegen.js is somehow absent */
  function toQsym(v) {
    var q = v >= 0 ? Math.floor(v * 256 + 0.5) : Math.ceil(v * 256 - 0.5);
    if (q > 32767) return 32767;
    if (q < -32768) return -32768;
    return q;
  }
  var FT = null, FS = null;
  function tanh1024() {
    if (FT) return FT;
    FT = [];
    for (var i = 0; i < 1024; i++) FT.push(toQsym(Math.tanh((i * 2 - 1022) / 256)));
    return FT;
  }
  function sig1024() {
    if (FS) return FS;
    FS = [];
    for (var i = 0; i < 1024; i++) FS.push(toQsym(1 / (1 + Math.exp(-((i * 4 - 2046) / 256)))));
    return FS;
  }
  function tanhQ(x) {
    var cc = CC();
    if (cc) return cc.tanhQ1024(x);
    var T = tanh1024(), idx = (x + 1024) >> 1;
    if (idx < 0) return -256;
    if (idx > 1023) return 256;
    return T[idx];
  }
  function sigQ(x) {
    var cc = CC();
    if (cc) return cc.sigQ1024(x);
    var S = sig1024(), idx = (x + 2048) >> 2;
    if (idx < 0) return 0;
    if (idx > 1023) return 256;
    return S[idx];
  }
  function neuronQ8(biasQ, wRowQ, aQ) {
    var cc = CC();
    if (cc) return cc.neuronQ8(biasQ, wRowQ, aQ);
    var acc = biasQ * 256;
    for (var j = 0; j < wRowQ.length; j++) acc += wRowQ[j] * aQ[j];
    var adj = acc >= 0 ? 128 : -128;
    var v = Math.floor((acc + adj) / 256);
    if (v > 32767) return 32767;
    if (v < -32768) return -32768;
    return v;
  }

  /* cycle costs: [m0, m4] */
  var COST = {
    mac: [6, 2],    // 16x16 -> 64-bit accumulate
    add: [1, 1],
    shift: [1, 1],
    load: [2, 1],
    store: [2, 1],
    lut: [3, 2],    // table read + index math
    branch: [2, 1],
    float: [48, 2]  // soft-float on M0 vs FPU on M4
  };
  var TARGETS = {
    m0: { label: 'Cortex-M0 @ 16 MHz', mhz: 16 },
    m4: { label: 'Cortex-M4 @ 64 MHz', mhz: 64 }
  };

  function mcuError(code, msg) {
    var e = new Error(code + ': ' + msg);
    e.code = code;
    return e;
  }

  function createSim(opts) {
    opts = opts || {};
    var size = opts.scratchBytes == null ? 4096 : opts.scratchBytes;
    if (!(size >= 64 && size <= 16384)) throw mcuError('ERR_BAD_SCRATCH', 'scratchBytes must be 64..16384, got ' + size);
    var sim = {
      size: size, bump: 0, peak: 0,
      depth: 0, maxDepth: 64,
      c0: 0, c4: 0,          // cycles m0 / m4
      intMults: 0, floatFallbacks: 0,
      regs: { r0: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, sp: 0, pc: 0 }
    };
    function cyc(kind, n) {
      n = n || 1;
      sim.c0 += COST[kind][0] * n;
      sim.c4 += COST[kind][1] * n;
    }
    sim.alloc = function (bytes) {
      var n = (bytes + 1) & ~1; // 16-bit align
      if (sim.bump + n > sim.size)
        throw mcuError('ERR_SCRATCHPAD_OVERFLOW',
          'bump allocator needs ' + (sim.bump + n) + ' B, pool is ' + sim.size + ' B');
      var off = sim.bump;
      sim.bump += n;
      if (sim.bump > sim.peak) sim.peak = sim.bump;
      cyc('add'); // bump-pointer arithmetic
      return off;
    };
    sim.enter = function () {
      sim.depth++;
      if (sim.depth > sim.maxDepth)
        throw mcuError('ERR_STACK_OVERFLOW', 'call depth ' + sim.depth + ' > ' + sim.maxDepth);
      cyc('branch');
    };
    sim.exit = function () { if (sim.depth > 0) sim.depth--; cyc('branch'); };
    sim.heapAlloc = function () {
      throw mcuError('ERR_HEAP_DISABLED',
        'model_run is allocation-free by design — malloc has no place in the hot loop');
    };
    sim.mac = function (n) { sim.intMults += (n || 1); cyc('mac', n || 1); };
    sim.add = function (n) { cyc('add', n || 1); };
    sim.shift = function (n) { cyc('shift', n || 1); };
    sim.load = function (n) { cyc('load', n || 1); };
    sim.store = function (n) { cyc('store', n || 1); };
    sim.lut = function (n) { cyc('lut', n || 1); };
    sim.branch = function (n) { cyc('branch', n || 1); };
    sim.floatOp = function (n) { sim.floatFallbacks += (n || 1); cyc('float', n || 1); };
    sim.us = function () {
      return { m0: sim.c0 / TARGETS.m0.mhz, m4: sim.c4 / TARGETS.m4.mhz };
    };
    return sim;
  }

  /* register-file snapshot after a run (deterministic, documented mapping) */
  function snapRegs(sim, extra) {
    var r = sim.regs;
    return {
      r0: 'acc_lo=' + r.r0,          // low 16 bits of the last neuron accumulator
      r1: 'out_ptr=0x' + r.r1.toString(16), // output buffer offset in scratch
      r2: 'macs=' + r.r2,            // total integer multiplies retired
      r3: 'peak_ram=' + r.r3 + 'B',  // high-water mark of the bump allocator
      r4: 'layers=' + r.r4,          // layers executed
      sp: 'sp=0x' + sim.bump.toString(16),  // bump pointer == simulated stack pointer
      pc: 'pc=model_run+ret'
    };
  }

  /* one instrumented neuron: mirrors neuron_q8() in the generated C exactly */
  function simNeuron(sim, biasQ, wRowQ, aQ) {
    var n = wRowQ.length;
    sim.load(n + 1);       // weights + bias
    sim.load(n);           // activations
    sim.mac(n);            // acc += w*x (64-bit)
    sim.add(1); sim.shift(1); // bias<<8 folded in, final >>8
    sim.branch(1);         // saturation checks
    var z = neuronQ8(biasQ, wRowQ, aQ); // bit-exact integer core
    sim.store(1);
    sim.regs.r0 = ((z % 65536) + 65536) % 65536;
    sim.regs.r2 += n;
    return z;
  }

  /* MLP inference under MCU constraints. q = NL_Q88.quantizeMLP(model).
   * x: float input vector (quantized here, counted as float fallbacks).
   * Returns {out:[q8], cyclesM0, cyclesM4, usM0, usM4, peakRAM,
   *          intMults, floatFallbacks, regs}. */
  function runMLP(q, x, act, mode, opts) {
    var sim = createSim(opts);
    sim.enter();
    try {
      var nIn = q.layers[0].W[0].length;
      var inOff = sim.alloc(2 * nIn);
      var a = new Array(nIn), i, j, l;
      for (i = 0; i < nIn; i++) {           // sensor floats -> Q8.8 (the one
        sim.floatOp(1);                      // float fallback in the pipeline)
        a[i] = toQsym(x[i] == null ? 0 : x[i]);
      }
      sim.load(nIn);
      for (l = 0; l < q.layers.length; l++) {
        var L = q.layers[l], nOut = L.W.length, last = (l === q.layers.length - 1);
        var dstOff = last ? -1 : sim.alloc(2 * nOut); // final layer writes out[]
        var z = new Array(nOut);
        for (i = 0; i < nOut; i++) z[i] = simNeuron(sim, L.b[i], L.W[i], a);
        if (last) {
          if (mode === 'binary') { for (i = 0; i < nOut; i++) { sim.lut(1); z[i] = sigQ(z[i]); } }
          /* regression / multiclass: raw linear output, nothing to do */
          sim.regs.r1 = 0;
        } else {
          if (act === 'relu') { for (i = 0; i < nOut; i++) { sim.branch(1); z[i] = z[i] > 0 ? z[i] : 0; } }
          else { for (i = 0; i < nOut; i++) { sim.lut(1); z[i] = tanhQ(z[i]); } }
          a = z;
        }
        sim.regs.r4 = l + 1;
        if (last) a = z;
      }
      sim.regs.r3 = sim.peak;
      var us = sim.us();
      var res = {
        out: a, cyclesM0: sim.c0, cyclesM4: sim.c4,
        usM0: us.m0, usM4: us.m4, peakRAM: sim.peak,
        intMults: sim.intMults, floatFallbacks: sim.floatFallbacks,
        regs: snapRegs(sim)
      };
      sim.exit();
      return res;
    } catch (e) { sim.exit(); throw e; }
  }

  /* CNN inference under MCU constraints (digits CNN: 6x3x3 conv, relu,
   * 2x2 maxpool, dense). Allocates the FULL conv volume up front (216
   * words = 432 B + 128 B input = 560 B live) the way naive firmware does —
   * so a 512-byte scratchpad traps ERR_SCRATCHPAD_OVERFLOW here. */
  function runCNN(q, x, opts) {
    var sim = createSim(opts);
    sim.enter();
    try {
      var nF = q.nFilters, nC = q.nClasses, f, i, j, u, v;
      var inOff = sim.alloc(128); // 64 px x 2 B
      var X = new Array(64);
      for (i = 0; i < 64; i++) { sim.floatOp(1); X[i] = toQsym(x[i] == null ? 0 : x[i]); }
      sim.load(64);
      var convOff = sim.alloc(nF * 36 * 2); // full conv volume — the 512 B tripwire
      var conv = new Array(nF * 36);
      for (f = 0; f < nF; f++) {
        for (i = 0; i < 6; i++) for (j = 0; j < 6; j++) {
          var acc = q.fb[f] * 256, Ff = q.F[f];
          sim.load(10); sim.mac(9); sim.add(1); sim.shift(1);
          for (u = 0; u < 3; u++) for (v = 0; v < 3; v++) acc += Ff[u][v] * X[(i + u) * 8 + (j + v)];
          var adj = acc >= 0 ? 128 : -128;
          var z = Math.floor((acc + adj) / 256);
          if (z > 32767) z = 32767; else if (z < -32768) z = -32768;
          sim.branch(2); // sat + relu
          conv[f * 36 + i * 6 + j] = z > 0 ? z : 0;
          sim.store(1);
        }
      }
      var hOff = sim.alloc(nF * 9 * 2);
      var h = [];
      for (f = 0; f < nF; f++)
        for (var pr = 0; pr < 3; pr++) for (var pc = 0; pc < 3; pc++) {
          var best = -32768;
          sim.load(4); sim.branch(3);
          for (var dr = 0; dr < 2; dr++) for (var dc = 0; dc < 2; dc++) {
            var vv = conv[f * 36 + (pr * 2 + dr) * 6 + (pc * 2 + dc)];
            if (vv > best) best = vv;
          }
          h.push(best); sim.store(1);
        }
      var logits = [];
      for (var c = 0; c < nC; c++) { logits.push(simNeuron(sim, q.b2[c], q.W2[c], h)); }
      sim.regs.r2 = sim.intMults; sim.regs.r3 = sim.peak; sim.regs.r4 = 3;
      sim.regs.r0 = ((logits[0] % 65536) + 65536) % 65536;
      var us = sim.us();
      var res = {
        out: logits, cyclesM0: sim.c0, cyclesM4: sim.c4,
        usM0: us.m0, usM4: us.m4, peakRAM: sim.peak,
        intMults: sim.intMults, floatFallbacks: sim.floatFallbacks,
        regs: snapRegs(sim)
      };
      sim.exit();
      return res;
    } catch (e) { sim.exit(); throw e; }
  }

  function reportText(res, label) {
    var L = [];
    L.push('── virtual MCU run' + (label ? ': ' + label : '') + ' ──');
    L.push('M0 (16 MHz) : ' + res.cyclesM0 + ' cycles = ' + res.usM0.toFixed(1) + ' µs');
    L.push('M4 (64 MHz) : ' + res.cyclesM4 + ' cycles = ' + res.usM4.toFixed(1) + ' µs');
    L.push('integer multiplies: ' + res.intMults + '   float fallbacks: ' + res.floatFallbacks);
    L.push('peak scratch RAM: ' + res.peakRAM + ' B');
    L.push('registers: ' + Object.keys(res.regs).map(function (k) { return k + '=' + res.regs[k]; }).join(' '));
    return L.join('\n');
  }

  var API = {
    TARGETS: TARGETS, COST: COST,
    createSim: createSim, runMLP: runMLP, runCNN: runCNN,
    reportText: reportText, mcuError: mcuError,
    toQsym: toQsym, tanhQ1024: tanhQ, sigQ1024: sigQ, neuronQ8: neuronQ8
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.NL_MCU = API;
  }
})(typeof window !== 'undefined' ? window : global);
