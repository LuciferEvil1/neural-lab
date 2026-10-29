/* === NL_TONGUE — first-tongue transformer inference, pure JS, KV-cached ===
 * Mirrors TinyGPT (PyTorch): pre-norm blocks, causal multi-head attention,
 * exact-erf GELU (Abramowitz-Stegun erf ~1e-7). Single-sequence, incremental:
 * reset() then step(tokenId) per token; caches hold K/V per layer+head.
 * Weights: tongue.bin (float32 LE) + tongue.json manifest (see tools/tongue_convert.py).
 */
var NL_TONGUE = (function () {
  'use strict';

  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - t * ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * Math.exp(-x * x);
    return s * y;
  }
  function gelu(v) { return 0.5 * v * (1 + erf(v / Math.SQRT2)); }

  function createModel(manifest, binF32) {
    var cfg = manifest.cfg;
    var d = cfg.d, heads = cfg.heads, hs = d / heads;
    var layers = cfg.layers, vocab = cfg.vocab, ctx = cfg.ctx;
    var W = {};
    manifest.tensors.forEach(function (t) {
      var n = t.shape.reduce(function (a, b) { return a * b; }, 1);
      W[t.name] = new Float32Array(binF32.buffer, binF32.byteOffset + t.offset * 4, n);
    });
    var kC = [], vC = [], pos = 0;
    /* === TRINITY — Ahkeem's architecture. This IS the model's code, not a
     * module, not a switch. Three built-in functions of main() itself:
     * ghost()     — when main() fails, its WHOLE run (seed, inner thought,
     *               output, token ids) is checksum-sealed into the ghost
     *               archive. Never a lone output or file: only a dead main
     *               earns a ghost.
     * molecule()  — a failed ghost. When a ghost can't come back (its
     *               recovery is condemned again, or re-integration fails),
     *               it breaks into adaptive fragments that fit the live
     *               session and recycle as steering. Molecules NEVER come
     *               from rejected outputs directly.
     * blackhole() — overflow/collisions merge into evolving gravity.
     * The AI judges its own mains (self-judgment); the human override only
     * condemns. Nothing is ever deleted — failures become structure.
     * All session-memory only. Nothing is ever written to disk. */
    var TRIN_N = 4, TRIN_MAX_LIVE = 8, TRIN_DECAY = 0.97, TRIN_MAX_GRAV = 2000;
    var trinMolecules = [], trinGhosts = [], trinGravity = {}, trinHist = [];
    function trinKey(ids) { return ids.join(','); }
    function trinSeal(text) {
      var h1 = 0xdeadbeef, h2 = 0x41c6ce57, i, ch;
      for (i = 0; i < text.length; i++) {
        ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
      }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
    }
    function trinCollapse() {
      if (trinMolecules.length <= TRIN_MAX_LIVE) return;
      trinMolecules.sort(function (a, b) { return a.mass - b.mass; });
      while (trinMolecules.length > TRIN_MAX_LIVE) {
        var weak = trinMolecules.shift(), k;
        for (k in weak.charges) trinGravity[k] = (trinGravity[k] || 0) + weak.charges[k] * weak.mass;
      }
      var keys = Object.keys(trinGravity);
      if (keys.length > TRIN_MAX_GRAV) {
        for (var j = 0; j < keys.length; j++) {
          trinGravity[keys[j]] *= 0.9;
          if (trinGravity[keys[j]] < 0.01) delete trinGravity[keys[j]];
        }
      }
    }
    /* Seal the WHOLE run — seed + inner thought + text + token ids, in one
     * canonical form. A ghost is a dead main(), never a lone output. */
    function trinSealRun(run) {
      return trinSeal((run.seed || '') + '\n' + (run.thought || '') + '\n' +
                      (run.text || '') + '\n' + trinKey(run.ids || []));
    }
    /* ghost(): condemn a whole failed main(). run = {seed, thought, text,
     * ids, recoveredFrom (optional ghost index)}. Mints a ghost ONLY — no
     * molecule is born here. If this run was recovered from a ghost and is
     * condemned again, that ghost has FAILED → break it into molecules.
     * source: 'auto' (the AI's own self-judgment) or 'condemned' (human). */
    function condemnRun(run, source) {
      run = run || {};
      var ids = run.ids || [];
      var seal = trinSealRun(run);
      trinGhosts.push({ seed: run.seed || '', thought: run.thought || '',
                        text: run.text || '', ids: ids.slice(), seal: seal,
                        source: source || 'condemned',
                        recovered: false, broken: false, at: Date.now() });
      var st = trinStatus();
      st.lastGhost = seal;
      if (run.recoveredFrom !== undefined && run.recoveredFrom !== null) {
        breakGhost(run.recoveredFrom, st);
      }
      return st;
    }
    /* molecule(): a failed ghost breaks into adaptive fragments. Its n-gram
     * charges fit the live session and recycle as steering (trinPenalize).
     * The ghost record stays — nothing is ever deleted — but is flagged
     * broken/consumed. Molecules are ONLY born here. */
    function breakGhost(i, st) {
      var g = trinGhosts[i];
      if (!g || g.broken) return;
      var charges = {}, k, j;
      var ids = g.ids || [];
      for (j = 0; j + TRIN_N <= ids.length; j++) {
        k = trinKey(ids.slice(j, j + TRIN_N));
        charges[k] = (charges[k] || 0) + 1;
      }
      trinMolecules.push({ charges: charges, mass: 1.0, fromGhost: g.seal });
      trinCollapse();
      g.broken = true;
      if (st) { st.brokenGhost = g.seal; st.live = trinMolecules.length; st.broken = trinStatus().broken; }
    }
    /* A ghost gets its second chance. The returned handle lets the caller
     * flag the next run as recoveredFrom, so condemning it breaks the ghost
     * into molecules. Checksum covers the whole sealed run. */
    function trinRecover(i) {
      if (i === undefined || i === null) i = trinGhosts.length - 1;
      var g = trinGhosts[i];
      if (!g) throw new Error('no ghost at index ' + i);
      if (trinSealRun(g) !== g.seal) throw new Error('ghost tampered — rejected');
      g.recovered = true;
      return { text: g.text, ids: (g.ids || []).slice(), ghost: i, seal: g.seal };
    }
    function trinPenalize(logits) {
      if (trinHist.length < TRIN_N - 1) return;
      if (trinMolecules.length === 0 && Object.keys(trinGravity).length === 0) return;
      var tail = trinKey(trinHist.slice(-(TRIN_N - 1))), k, id, i, m, w;
      for (i = 0; i < trinMolecules.length; i++) {
        m = trinMolecules[i]; w = 2.0 * m.mass;
        for (k in m.charges) {
          if (k.lastIndexOf(tail, 0) === 0 && k.charAt(tail.length) === ',') {
            id = parseInt(k.slice(tail.length + 1), 10);
            if (id >= 0 && id < logits.length) logits[id] -= w * m.charges[k];
          }
        }
      }
      for (k in trinGravity) {
        if (k.lastIndexOf(tail, 0) === 0 && k.charAt(tail.length) === ',') {
          id = parseInt(k.slice(tail.length + 1), 10);
          if (id >= 0 && id < logits.length) logits[id] -= 2.0 * trinGravity[k];
        }
      }
    }
    function trinDecay() {
      for (var i = 0; i < trinMolecules.length; i++) trinMolecules[i].mass *= TRIN_DECAY;
    }
    function trinStatus() {
      var broken = 0, b;
      for (b = 0; b < trinGhosts.length; b++) if (trinGhosts[b].broken) broken++;
      return { live: trinMolecules.length, ghosts: trinGhosts.length, broken: broken, gravity: Object.keys(trinGravity).length };
    }
    function alloc() {
      kC = []; vC = [];
      for (var l = 0; l < layers; l++) {
        var kl = [], vl = [];
        for (var h = 0; h < heads; h++) { kl.push(new Float32Array(ctx * hs)); vl.push(new Float32Array(ctx * hs)); }
        kC.push(kl); vC.push(vl);
      }
      pos = 0;
      trinHist = [];
    }
    function ln(x, w, b) {
      var mu = 0, i;
      for (i = 0; i < d; i++) mu += x[i];
      mu /= d;
      var va = 0, dd;
      for (i = 0; i < d; i++) { dd = x[i] - mu; va += dd * dd; }
      var inv = 1 / Math.sqrt(va / d + 1e-5);
      var o = new Float32Array(d);
      for (i = 0; i < d; i++) o[i] = (x[i] - mu) * inv * w[i] + b[i];
      return o;
    }
    function matVecT(Wm, rows, cols, x) {
      var o = new Float32Array(rows), r, c, s;
      for (r = 0; r < rows; r++) { s = 0; for (c = 0; c < cols; c++) s += Wm[r * cols + c] * x[c]; o[r] = s; }
      return o;
    }
    function step(tok) {
      if (pos >= ctx) throw new Error('tongue: context full');
      trinHist.push(tok);
      var t = pos++, h = new Float32Array(d), i, j;
      var te = W['tok.weight'], pe = W['pos.weight'];
      for (i = 0; i < d; i++) h[i] = te[tok * d + i] + pe[t * d + i];
      for (var l = 0; l < layers; l++) {
        var P = 'blocks.' + l + '.';
        var x = ln(h, W[P + 'ln1.weight'], W[P + 'ln1.bias']);
        var qkv = matVecT(W[P + 'qkv.weight'], 3 * d, d, x);
        var ahead = new Float32Array(d);
        for (var hh = 0; hh < heads; hh++) {
          var qb = hh * hs;
          kC[l][hh].set(qkv.subarray(d + qb, d + qb + hs), t * hs);
          vC[l][hh].set(qkv.subarray(2 * d + qb, 2 * d + qb + hs), t * hs);
          var sc = new Float32Array(t + 1), mx = -1e30, s, base;
          var kb = kC[l][hh];
          for (i = 0; i <= t; i++) {
            s = 0; base = i * hs;
            for (j = 0; j < hs; j++) s += qkv[qb + j] * kb[base + j];
            s *= Math.pow(hs, -0.5);
            sc[i] = s; if (s > mx) mx = s;
          }
          var es = 0;
          for (i = 0; i <= t; i++) { sc[i] = Math.exp(sc[i] - mx); es += sc[i]; }
          for (i = 0; i <= t; i++) sc[i] /= es;
          var vb = vC[l][hh], ob = hh * hs;
          for (j = 0; j < hs; j++) {
            var acc = 0;
            for (i = 0; i <= t; i++) acc += sc[i] * vb[i * hs + j];
            ahead[ob + j] = acc;
          }
        }
        var pa = matVecT(W[P + 'proj.weight'], d, d, ahead), pb = W[P + 'proj.bias'];
        for (i = 0; i < d; i++) h[i] += pa[i] + pb[i];
        var x2 = ln(h, W[P + 'ln2.weight'], W[P + 'ln2.bias']);
        var f1 = matVecT(W[P + 'ff.0.weight'], 4 * d, d, x2), b1 = W[P + 'ff.0.bias'];
        for (i = 0; i < 4 * d; i++) f1[i] = gelu(f1[i] + b1[i]);
        var f2 = matVecT(W[P + 'ff.2.weight'], d, 4 * d, f1), b2 = W[P + 'ff.2.bias'];
        for (i = 0; i < d; i++) h[i] += f2[i] + b2[i];
      }
      var out = matVecT(W['head.weight'], vocab, d, ln(h, W['ln.weight'], W['ln.bias']));
      trinPenalize(out);   /* the trinity rides every step — structural, not optional */
      return out;
    }
    alloc();
    return {
      step: step, reset: alloc, cfg: cfg,
      condemnRun: condemnRun, recoverGhost: trinRecover,
      ghostArchive: function () { return trinGhosts; },
      decayMolecules: trinDecay, trinityStatus: trinStatus
    };
  }

  if (typeof module !== 'undefined') module.exports = { createModel: createModel, erf: erf, gelu: gelu };
  return { createModel: createModel };
})();
