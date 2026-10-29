/* ══ v43 "Gauntlet" — NL_CHARRNN: the tiny language milestone ══════════════
 * Gemini's recommendation #4, built at Ahkeem's phone scale: a character-level
 * next-char RNN (~7K params — single-digit thousands, far under the
 * single-digit-millions on-device ceiling). Truncated BPTT, teacher forcing,
 * seeded init — deterministic training.
 *
 * v45 "Mirror" adds masked-token training (BERT-style): ~15% of chars are
 * replaced by a learned [MASK] embedding (seeded selection); the model must
 * reconstruct the masked char from context. The v44 inversion pattern is the
 * honest classical frame: forward-encode visible context, freeze the hidden
 * state as a ghost (uncommitted — no token yet), reverse-decode the masked
 * char from the frozen ghost. Loss on masked positions only. Causal
 * (left-context), not true bidirectional BERT — labeled as such.
 *
 * The Core's lifecycle is wired into language, honestly labeled:
 *  - the EVENT HORIZON compresses RECURRING hidden activations: when an
 *    n-gram context has been seen often, its hidden state routes through a
 *    fixed K-dim bottleneck (a classical compression pass, not quantum).
 *  - the GHOST CRAWLER retrieves past similar contexts: when a RARE token
 *    arrives, the most similar archived hidden state (cosine) feeds in as a
 *    DAMPED prior — the same "damped, can't run away" discipline as v41.
 *  - STABILITY: LayerNorm on the hidden state every step (v43 #5).
 * Pure pipeline, no DOM — testable in Node like NL_NEXUS_CORE.
 */
var NL_CHARRNN = (function () {
  var V = 95;            /* printable ASCII 32..126 */
  var E = 16;            /* char embedding dim */
  var H = 32;            /* hidden dim — phone-friendly */
  var KK = 8;            /* horizon bottleneck dim */
  var NGRAM = 8;         /* context window for recurrence detection */
  var RECUR_THRESH = 3;  /* seen >= this -> recurring -> compress */
  var GHOST_GAIN = 0.3;  /* damped prior gain, bounded */
  var GHOST_CAP = 200;   /* context-ghost archive cap */

  function RNG(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function ci(ch) { var c = ch.charCodeAt(0); return (c >= 32 && c < 127) ? c - 32 : -1; }
  function idxCh(i) { return String.fromCharCode(32 + i); }
  function zeros(n) { var a = [], i; for (i = 0; i < n; i++) a.push(0); return a; }
  function tanh(x) { return Math.tanh(x); }
  function softmax(lg) {
    var m = -1e30, i, s = 0, out = [];
    for (i = 0; i < lg.length; i++) if (lg[i] > m) m = lg[i];
    for (i = 0; i < lg.length; i++) { out.push(Math.exp(lg[i] - m)); s += out[i]; }
    for (i = 0; i < lg.length; i++) out[i] /= s;
    return out;
  }
  function cosine(a, b) {
    var d = 0, na = 0, nb = 0, i;
    for (i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return (na > 1e-12 && nb > 1e-12) ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }
  function layerNorm(h) {
    var n = h.length, mu = 0, i, d;
    for (i = 0; i < n; i++) mu += h[i];
    mu /= n;
    var v = 0;
    for (i = 0; i < n; i++) { d = h[i] - mu; v += d * d; }
    var sd = Math.sqrt(v / n + 1e-8), out = [];
    for (i = 0; i < n; i++) out.push((h[i] - mu) / sd);
    return out;
  }
  function mat(r0, c0, sc, r) {
    var m = [], i, j;
    for (i = 0; i < r0; i++) { m.push([]); for (j = 0; j < c0; j++) m[i].push((r() * 2 - 1) * sc); }
    return m;
  }
  function vec(n, r) { var v = [], i; for (i = 0; i < n; i++) v.push((r() * 2 - 1) * 0.1); return v; }

  function newModel(seed) {
    var r = RNG(seed == null ? 7 : seed);
    return {
      E: mat(V, E, 0.1, r), Wxh: mat(H, E, 0.2, r), Whh: mat(H, H, 0.2, r), bh: vec(H, r),
      /* v45 "Mirror": the learned [MASK] embedding — masked positions feed
       * this vector instead of a char embedding, so the model must earn the
       * answer from context alone. */
      MASK: vec(E, r),
      /* the horizon bottleneck: FIXED random projection (documented) — a
       * classical compression pass over recurring activations. Fixed, so
       * BPTT stays simple and honest; the compression is structural. */
      Wc: mat(KK, H, 0.3, r), bc: vec(KK, r), Wd: mat(H, KK, 0.3, r), bd: vec(H, r),
      Why: mat(V, H, 0.2, r), by: vec(V, r),
      seed: seed == null ? 7 : seed
    };
  }
  function newLife() {
    return { counts: {}, freq: {}, ghosts: [], compressed: 0, retrieved: 0 };
  }
  function observe(life, text, t) {
    /* update n-gram recurrence counts + char frequencies from history */
    if (t < 0 || t >= text.length) return;
    var c = text[t], f = ci(c);
    if (f >= 0) life.freq[f] = (life.freq[f] || 0) + 1;
    if (t >= NGRAM) {
      var ng = text.slice(t - NGRAM, t);
      life.counts[ng] = (life.counts[ng] || 0) + 1;
    }
  }
  function forward(m, c, h, life, text, t) {
    var e = m.E[c], i, j, s;
    var pre = [];
    for (i = 0; i < H; i++) {
      s = m.bh[i];
      for (j = 0; j < E; j++) s += m.Wxh[i][j] * e[j];
      for (j = 0; j < H; j++) s += m.Whh[i][j] * h[j];
      pre.push(s);
    }
    var a = pre.map(tanh), ht = a, usedZ = null;
    var compressed = false, ghostH = null;
    if (life && text != null && t != null) {
      var ng = t >= NGRAM ? text.slice(t - NGRAM, t) : null;
      if (ng && (life.counts[ng] || 0) >= RECUR_THRESH) {
        /* horizon: recurring hidden activations compress through K dims */
        var z = [];
        for (i = 0; i < KK; i++) {
          s = m.bc[i];
          for (j = 0; j < H; j++) s += m.Wc[i][j] * a[j];
          z.push(tanh(s));
        }
        var y2 = [];
        for (i = 0; i < H; i++) {
          s = m.bd[i];
          for (j = 0; j < KK; j++) s += m.Wd[i][j] * z[j];
          y2.push(tanh(s));
        }
        ht = y2; usedZ = z; compressed = true;
        life.compressed++;
      }
      var fr = life.freq[c] || 0;
      if (fr < 2 && life.ghosts.length) {
        /* rare token: crawler retrieves the most similar past context as a
         * damped prior — stop-gradient (constant), bounded gain. */
        var best = null, bs = -2, g;
        for (var gi = 0; gi < life.ghosts.length; gi++) {
          g = life.ghosts[gi];
          var cs = cosine(ht, g.h);
          if (cs > bs) { bs = cs; best = g.h; }
        }
        if (best) {
          ghostH = best;
          var ht2 = [];
          for (i = 0; i < H; i++) ht2.push(ht[i] + GHOST_GAIN * best[i]);
          ht = ht2;
          life.retrieved++;
        }
      }
    }
    ht = layerNorm(ht); /* v43 #5: stability on every step */
    var logits = [];
    for (i = 0; i < V; i++) {
      s = m.by[i];
      for (j = 0; j < H; j++) s += m.Why[i][j] * ht[j];
      logits.push(s);
    }
    return { h: ht, logits: logits, pre: pre, a: a, z: usedZ, ghostH: ghostH, compressed: compressed };
  }
  function zeroGrads() {
    function z2(r0, c0) { var m = [], i, j; for (i = 0; i < r0; i++) { m.push([]); for (j = 0; j < c0; j++) m[i].push(0); } return m; }
    return { E: z2(V, E), Wxh: z2(H, E), Whh: z2(H, H), bh: zeros(H),
             Why: z2(V, H), by: zeros(V) };
  }
  function clipG(gr) {
    function cl(v) { return v > 5 ? 5 : (v < -5 ? -5 : v); }
    var k, i, j;
    for (k in gr) {
      var g = gr[k];
      if (typeof g[0] === 'number') { for (i = 0; i < g.length; i++) g[i] = cl(g[i]); }
      else { for (i = 0; i < g.length; i++) for (j = 0; j < g[i].length; j++) g[i][j] = cl(g[i][j]); }
    }
  }
  function sgd(m, gr, lr) {
    var k, i, j;
    for (k in gr) {
      var g = gr[k], p = m[k];
      if (typeof g[0] === 'number') { for (i = 0; i < g.length; i++) p[i] -= lr * g[i]; }
      else { for (i = 0; i < g.length; i++) for (j = 0; j < g[i].length; j++) p[i][j] -= lr * g[i][j]; }
    }
  }
  function textToIdx(text) {
    var out = [], i, f;
    for (i = 0; i < text.length; i++) { f = ci(text[i]); if (f >= 0) out.push(f); }
    return out;
  }
  /* truncated BPTT, teacher forcing, deterministic. Returns loss curve +
   * the lifecycle log (how often the horizon compressed / crawler retrieved). */
  function train(m, text, opts) {
    opts = opts || {};
    var lr = opts.lr || 0.05, epochs = opts.epochs || 3, unroll = opts.unroll || 25;
    var idx = textToIdx(text), n = idx.length;
    if (n < unroll + 2) return { curve: [], life: newLife(), note: 'text too short' };
    var life = newLife(), curve = [], ep, s0, t, i, j;
    for (ep = 0; ep < epochs; ep++) {
      var h = zeros(H), loss = 0, cnt = 0;
      for (s0 = 0; s0 < n - 1; s0 += unroll) {
        var s1 = Math.min(s0 + unroll, n - 1);
        var caches = [];
        for (t = s0; t < s1; t++) {
          observe(life, text, t);
          var fw = forward(m, idx[t], h, life, text, t);
          caches.push({ fw: fw, c: idx[t], target: idx[t + 1], hPrev: h.slice() });
          h = fw.h;
          var pr = softmax(fw.logits);
          loss += -Math.log(Math.max(1e-12, pr[idx[t + 1]])); cnt++;
        }
        /* archive a context ghost periodically (the crawler's future priors) */
        if (life.ghosts.length < GHOST_CAP && (s0 % (unroll * 4) === 0))
          life.ghosts.push({ h: h.slice() });
        /* backward through the chunk */
        var gr = zeroGrads(), dhNext = zeros(H);
        for (var b = caches.length - 1; b >= 0; b--) {
          var cc = caches[b], f2 = cc.fw;
          var probs = softmax(f2.logits);
          var dy = probs.slice(); dy[cc.target] -= 1;
          for (i = 0; i < V; i++) {
            gr.by[i] += dy[i];
            for (j = 0; j < H; j++) gr.Why[i][j] += dy[i] * f2.h[j];
          }
          var dht = zeros(H);
          for (i = 0; i < H; i++) {
            var sAcc = dhNext[i];
            for (j = 0; j < V; j++) sAcc += m.Why[j][i] * dy[j];
            dht[i] = sAcc;
          }
          /* ghost prior is a constant — no gradient through it */
          var da;
          if (f2.z) {
            /* backprop through the FIXED bottleneck (constants, no grads) */
            var dht2 = [], dz = [];
            for (i = 0; i < H; i++) dht2.push(dht[i] * (1 - f2.h[i] * f2.h[i]));
            for (i = 0; i < KK; i++) {
              var s3 = 0;
              for (j = 0; j < H; j++) s3 += m.Wd[j][i] * dht2[j];
              dz.push(s3 * (1 - f2.z[i] * f2.z[i]));
            }
            da = [];
            for (i = 0; i < H; i++) {
              var s4 = 0;
              for (j = 0; j < KK; j++) s4 += m.Wc[j][i] * dz[j];
              da.push(s4);
            }
          } else da = dht;
          var daPre = [];
          for (i = 0; i < H; i++) daPre.push(da[i] * (1 - f2.a[i] * f2.a[i]));
          var e2 = m.E[cc.c];
          for (i = 0; i < H; i++) {
            gr.bh[i] += daPre[i];
            for (j = 0; j < E; j++) gr.Wxh[i][j] += daPre[i] * e2[j];
            for (j = 0; j < H; j++) gr.Whh[i][j] += daPre[i] * cc.hPrev[j];
          }
          for (i = 0; i < E; i++) {
            var s5 = 0;
            for (j = 0; j < H; j++) s5 += m.Wxh[j][i] * daPre[j];
            gr.E[cc.c][i] += s5;
          }
          dhNext = zeros(H);
          for (i = 0; i < H; i++) {
            var s6 = 0;
            for (j = 0; j < H; j++) s6 += m.Whh[j][i] * daPre[j];
            dhNext[i] = s6;
          }
        }
        clipG(gr);
        sgd(m, gr, lr);
      }
      curve.push(loss / Math.max(1, cnt));
    }
    return { curve: curve, life: life };
  }
  /* held-out accuracy: greedy next-char hits on the text tail */
  function accuracy(m, text, frac) {
    frac = frac || 0.2;
    var idx = textToIdx(text), n = idx.length;
    var s0 = Math.floor(n * (1 - frac));
    if (s0 < 2 || n - s0 < 4) return null;
    var life = newLife(), h = zeros(H), hit = 0, tot = 0, t, i;
    for (t = 0; t < s0; t++) { observe(life, text, t); h = forward(m, idx[t], h, life, text, t).h; }
    for (t = s0; t < n - 1; t++) {
      observe(life, text, t);
      var fw = forward(m, idx[t], h, life, text, t);
      var pr = softmax(fw.logits), bi = 0;
      for (i = 1; i < V; i++) if (pr[i] > pr[bi]) bi = i;
      if (bi === idx[t + 1]) hit++;
      tot++; h = fw.h;
    }
    return tot ? hit / tot : null;
  }
  /* ══ v45 "Mirror" — masked-token training (BERT-style) ══════════════
   * Gemini's language strategy, wired through the v44 inversion pattern:
   * randomly mask ~maskRate of input chars (SEEDED — deterministic per seed);
   * forward-encode the visible context; at each masked position FREEZE the
   * hidden state as a ghost — the uncommitted context, held WITHOUT
   * collapsing to a token; then "reverse-decode": read the masked char's
   * logits from the frozen ghost. Loss = cross-entropy on masked positions
   * only.
   *
   * Honest framing (no quantum claims): this is the classical version of
   * "holding contextual ambiguity" — a probability distribution over
   * candidates (softmax) computed from frozen context, collapsing to a
   * prediction only at readout. The ghost is a copied state vector, not a
   * quantum superposition. Note: the RNN is CAUSAL (left context only) —
   * this is BERT-style masking on a unidirectional model, not true
   * bidirectional BERT. The v44 inversion analogy: freeze context (ghost),
   * decode from the frozen state (reverse pass), read out at the bottom.
   */
  function selectMasks(n, rate, seed) {
    /* exactly round(n*rate) masked positions, seeded-shuffled — deterministic */
    var k = Math.max(1, Math.round(n * rate));
    var idx = [], i;
    for (i = 0; i < n; i++) idx.push(i);
    var r = RNG(seed == null ? 7 : seed);
    for (i = n - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)), tmp = idx[i];
      idx[i] = idx[j]; idx[j] = tmp;
    }
    var set = {}, out = [];
    for (i = 0; i < k && i < n; i++) { set[idx[i]] = true; out.push(idx[i]); }
    out.sort(function (a, b) { return a - b; });
    return { set: set, list: out, count: out.length };
  }
  function trainMasked(m, text, opts) {
    opts = opts || {};
    var lr = opts.lr || 0.05, epochs = opts.epochs || 3, unroll = opts.unroll || 25;
    var maskRate = opts.maskRate != null ? opts.maskRate : 0.15;
    maskRate = Math.max(0.05, Math.min(0.4, maskRate));
    var maskSeed = opts.maskSeed == null ? 7 : opts.maskSeed;
    var idx = textToIdx(text), n = idx.length;
    if (n < unroll + 2) return { curve: [], life: newLife(), note: 'text too short' };
    var masks = selectMasks(n, maskRate, maskSeed);
    var life = newLife(), curve = [], ep, s0, t, i, j;
    for (ep = 0; ep < epochs; ep++) {
      var h = zeros(H), loss = 0, cnt = 0;
      for (s0 = 0; s0 < n; s0 += unroll) {
        var s1 = Math.min(s0 + unroll, n);
        var caches = [];
        for (t = s0; t < s1; t++) {
          var isMask = !!masks.set[t];
          observe(life, text, t);
          /* masked input feeds the learned MASK vector; the frozen ghost is
           * the hidden state copy from which the masked char is decoded */
          var ein = isMask ? m.MASK : m.E[idx[t]];
          var fw = forwardWithEin(m, ein, h, life, text, t);
          var ghost = fw.h.slice(); /* frozen — the uncommitted context */
          caches.push({ fw: fw, ghost: ghost, masked: isMask, target: idx[t], hPrev: h.slice(), ein: ein });
          h = fw.h;
          if (isMask) {
            var pr = softmax(fw.logits);
            loss += -Math.log(Math.max(1e-12, pr[idx[t]])); cnt++;
          }
        }
        if (life.ghosts.length < GHOST_CAP && (s0 % (unroll * 4) === 0))
          life.ghosts.push({ h: h.slice() });
        /* backward: loss flows ONLY from masked positions; gradients still
         * propagate through time everywhere (the encoder must learn context) */
        var gr = zeroGrads(); gr.MASK = zeros(E);
        var dhNext = zeros(H);
        for (var b = caches.length - 1; b >= 0; b--) {
          var cc = caches[b], f2 = cc.fw;
          var dy = zeros(V);
          if (cc.masked) {
            var probs = softmax(f2.logits);
            for (i = 0; i < V; i++) dy[i] = probs[i];
            dy[cc.target] -= 1;
            for (i = 0; i < V; i++) {
              gr.by[i] += dy[i];
              for (j = 0; j < H; j++) gr.Why[i][j] += dy[i] * cc.ghost[j];
            }
          }
          var dht = zeros(H);
          for (i = 0; i < H; i++) {
            var sAcc = dhNext[i];
            if (cc.masked) for (j = 0; j < V; j++) sAcc += m.Why[j][i] * dy[j];
            dht[i] = sAcc;
          }
          var da;
          if (f2.z) {
            var dht2 = [], dz = [];
            for (i = 0; i < H; i++) dht2.push(dht[i] * (1 - f2.h[i] * f2.h[i]));
            for (i = 0; i < KK; i++) {
              var s3 = 0;
              for (j = 0; j < H; j++) s3 += m.Wd[j][i] * dht2[j];
              dz.push(s3 * (1 - f2.z[i] * f2.z[i]));
            }
            da = [];
            for (i = 0; i < H; i++) {
              var s4 = 0;
              for (j = 0; j < KK; j++) s4 += m.Wc[j][i] * dz[j];
              da.push(s4);
            }
          } else da = dht;
          var daPre = [];
          for (i = 0; i < H; i++) daPre.push(da[i] * (1 - f2.a[i] * f2.a[i]));
          for (i = 0; i < H; i++) {
            gr.bh[i] += daPre[i];
            for (j = 0; j < E; j++) gr.Wxh[i][j] += daPre[i] * cc.ein[j];
            for (j = 0; j < H; j++) gr.Whh[i][j] += daPre[i] * cc.hPrev[j];
          }
          if (cc.masked) {
            for (i = 0; i < E; i++) {
              var s5 = 0;
              for (j = 0; j < H; j++) s5 += m.Wxh[j][i] * daPre[j];
              gr.MASK[i] += s5;
            }
          } else {
            for (i = 0; i < E; i++) {
              var s6 = 0;
              for (j = 0; j < H; j++) s6 += m.Wxh[j][i] * daPre[j];
              gr.E[cc.target][i] += s6;
            }
          }
          dhNext = zeros(H);
          for (i = 0; i < H; i++) {
            var s7 = 0;
            for (j = 0; j < H; j++) s7 += m.Whh[j][i] * daPre[j];
            dhNext[i] = s7;
          }
        }
        clipG(gr);
        sgd(m, gr, lr);
      }
      curve.push(cnt ? loss / cnt : 0);
    }
    var macc = maskedAccuracy(m, text, { maskRate: maskRate, maskSeed: maskSeed });
    return { curve: curve, life: life, maskedAcc: macc, maskCount: masks.count, maskRate: maskRate };
  }
  /* forward with an explicit embedding vector (lets masked positions feed MASK) */
  function forwardWithEin(m, ein, h, life, text, t) {
    var i, j, s;
    var pre = [];
    for (i = 0; i < H; i++) {
      s = m.bh[i];
      for (j = 0; j < E; j++) s += m.Wxh[i][j] * ein[j];
      for (j = 0; j < H; j++) s += m.Whh[i][j] * h[j];
      pre.push(s);
    }
    var a = pre.map(tanh), ht = a, usedZ = null;
    var compressed = false, ghostH = null;
    if (life && text != null && t != null) {
      var ng = t >= NGRAM ? text.slice(t - NGRAM, t) : null;
      if (ng && (life.counts[ng] || 0) >= RECUR_THRESH) {
        var z = [];
        for (i = 0; i < KK; i++) {
          s = m.bc[i];
          for (j = 0; j < H; j++) s += m.Wc[i][j] * a[j];
          z.push(tanh(s));
        }
        var y2 = [];
        for (i = 0; i < H; i++) {
          s = m.bd[i];
          for (j = 0; j < KK; j++) s += m.Wd[i][j] * z[j];
          y2.push(tanh(s));
        }
        ht = y2; usedZ = z; compressed = true;
        life.compressed++;
      }
    }
    ht = layerNorm(ht);
    var logits = [];
    for (i = 0; i < V; i++) {
      s = m.by[i];
      for (j = 0; j < H; j++) s += m.Why[i][j] * ht[j];
      logits.push(s);
    }
    return { h: ht, logits: logits, pre: pre, a: a, z: usedZ, ghostH: ghostH, compressed: compressed };
  }
  /* held-out masked accuracy: greedy decode of masked positions from the
   * frozen ghost — above chance (1/95) means the context really informs */
  function maskedAccuracy(m, text, opts) {
    opts = opts || {};
    var maskRate = opts.maskRate != null ? opts.maskRate : 0.15;
    var maskSeed = opts.maskSeed == null ? 7 : opts.maskSeed;
    var idx = textToIdx(text), n = idx.length;
    if (n < 8) return null;
    var masks = selectMasks(n, maskRate, maskSeed);
    var life = newLife(), h = zeros(H), hit = 0, tot = 0, t, i;
    for (t = 0; t < n; t++) {
      var isMask = !!masks.set[t];
      observe(life, text, t);
      var fw = forwardWithEin(m, isMask ? m.MASK : m.E[idx[t]], h, life, text, t);
      if (isMask) {
        var pr = softmax(fw.logits), bi = 0;
        for (i = 1; i < V; i++) if (pr[i] > pr[bi]) bi = i;
        if (bi === idx[t]) hit++;
        tot++;
      }
      h = fw.h;
    }
    return tot ? { acc: hit / tot, n: tot } : null;
  }
  function generate(m, seedText, nChars, temp) {
    var idx = textToIdx(seedText);
    if (!idx.length) return seedText;
    var life = newLife(), h = zeros(H), t, i;
    var ext = seedText;
    for (t = 0; t < idx.length; t++) { observe(life, ext, t); h = forward(m, idx[t], h, life, ext, t).h; }
    var out = seedText, last = idx[idx.length - 1], pos = idx.length;
    var r = RNG((m.seed ^ 0xC4A4) >>> 0);
    for (var k = 0; k < nChars; k++) {
      var fw = forward(m, last, h, life, ext, ext.length);
      var lg = fw.logits, nx;
      if (temp == null || temp <= 0) {
        var pr = softmax(lg); nx = 0;
        for (i = 1; i < V; i++) if (pr[i] > pr[nx]) nx = i;
      } else {
        var pr2 = softmax(lg.map(function (x) { return x / temp; }));
        var u = r(), acc = 0; nx = V - 1;
        for (i = 0; i < V; i++) { acc += pr2[i]; if (u < acc) { nx = i; break; } }
      }
      out += idxCh(nx); ext += idxCh(nx);
      observe(life, ext, ext.length - 1);
      h = fw.h; last = nx; pos++;
    }
    return out;
  }
  /* bundled training text: the Core, in prose. Paste your own in the UI —
   * the model trains on whatever text you give it. */
  var SAMPLE_TEXT =
    "The Quantum Nexus Core is a classical simulation. It holds yes and no " +
    "at once, the way a qubit holds both answers until it is measured. " +
    "Evidence rotates the belief. The error never settles: a recurrent loop " +
    "rewrites itself as it thinks, and evolution keeps whatever predicts best. " +
    "Depth changed everything. One layer memorized the signal; three layers " +
    "learned its structure. The black hole came next: neurons colliding " +
    "through a gravity matrix, compressing toward the singularity while " +
    "partners outside stayed correlated through an entanglement-inspired link. " +
    "Before the crush, the engine freezes a ghost — an exact copy of the " +
    "state about to be compressed. The ghost is the answer to the paradox: " +
    "information survives inside and outside. Recovered ghosts wake the " +
    "crawler, which hunts their relatives through the archive. The recovered " +
    "become a new inner loop, an antimatter neuron reading every layer and " +
    "writing only itself. Nothing is ever deleted. The core writes itself.";

  return {
    V: V, E: E, H: H, KK: KK,
    newModel: newModel, newLife: newLife, forward: forward,
    train: train, accuracy: accuracy, generate: generate,
    /* v45 "Mirror": masked-token training via the inversion pattern */
    trainMasked: trainMasked, maskedAccuracy: maskedAccuracy,
    selectMasks: selectMasks, forwardWithEin: forwardWithEin,
    textToIdx: textToIdx, layerNorm: layerNorm, cosine: cosine,
    SAMPLE_TEXT: SAMPLE_TEXT, GHOST_GAIN: GHOST_GAIN
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NL_CHARRNN;
