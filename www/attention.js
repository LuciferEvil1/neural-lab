'use strict';
/* Neural Lab v28 — MicroFormer: minimal single-head causal transformer, pure JS.
 *
 * Token embedding (E) + learned positional encoding (P), single-head causal
 * self-attention  softmax(QK^T/√d_k + M)V  where M is the lower-triangular
 * causal mask (-Infinity above the diagonal, so the upper triangle of the
 * attention weights is EXACTLY zero), output projection, residual +
 * LayerNorm, feed-forward d→32→d (ReLU), residual + LayerNorm, final
 * linear + softmax over the vocabulary. The next token is read from the
 * LAST position's representation (standard causal-LM setup).
 *
 * Seeded init (mulberry32). Trains through trainBatch(X, Y, lr) with the
 * app's optimizer machinery (Adam/SGD) — same call shape as the MLP class,
 * so the Train tab's training loop works unchanged.
 *
 * Browser: window.NL_ATTN. Node: module.exports (for headless tests).
 */
(function (global) {

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var VOCAB = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  var FFN_HIDDEN = 32;
  var LN_EPS = 1e-5;

  function tokName(id) { return (id >= 0 && id < VOCAB.length) ? VOCAB[id] : ('t' + id); }

  function zerosLike(a) {
    if (typeof a === 'number') return 0;
    var r = new Array(a.length);
    for (var i = 0; i < a.length; i++) r[i] = zerosLike(a[i]);
    return r;
  }

  function countScalars(a) {
    if (typeof a === 'number') return 1;
    var n = 0;
    for (var i = 0; i < a.length; i++) n += countScalars(a[i]);
    return n;
  }

  function argmax(a) {
    var bi = 0;
    for (var i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
    return bi;
  }

  // rows[i] = M[i] . v
  function matVec(M, v) {
    var r = new Array(M.length);
    for (var i = 0; i < M.length; i++) {
      var s = 0, row = M[i];
      for (var j = 0; j < row.length; j++) s += row[j] * v[j];
      r[i] = s;
    }
    return r;
  }

  function softmaxRows(S) {
    // S: array of rows; -Infinity entries become EXACTLY 0 (causal mask)
    var W = new Array(S.length);
    for (var i = 0; i < S.length; i++) {
      var row = S[i], m = -Infinity, j;
      for (j = 0; j < row.length; j++) if (row[j] > m) m = row[j];
      var e = new Array(row.length), sum = 0;
      for (j = 0; j < row.length; j++) {
        var v = (row[j] === -Infinity) ? 0 : Math.exp(row[j] - m);
        e[j] = v; sum += v;
      }
      for (j = 0; j < row.length; j++) e[j] /= sum;
      W[i] = e;
    }
    return W;
  }

  function MicroTransformer(opts) {
    opts = opts || {};
    this.isTransformer = true;
    this.kind = 'mtf8';
    this.vocab = opts.vocab || 8;
    this.seqLen = opts.seqLen || 3;   // input tokens per training sample
    this.tMax = opts.tMax || 8;       // positional slots (heatmap can show up to 8)
    this.d = opts.dModel || 16;
    this.task = 'classification';
    this.regression = false;
    this.binary = false;
    this.cnn = false;
    this.optimizer = opts.optimizer === 'sgd' ? 'sgd' : 'adam';
    this.seed = (opts.seed == null ? ((Math.random() * 1e9) | 0) : opts.seed) >>> 0;
    var rng = mulberry32(this.seed);
    var d = this.d, V = this.vocab, T = this.tMax;

    function randMat(r, c, lim) {
      var M = new Array(r);
      for (var i = 0; i < r; i++) {
        var row = new Array(c);
        for (var j = 0; j < c; j++) row[j] = (rng() * 2 - 1) * lim;
        M[i] = row;
      }
      return M;
    }
    function xavier(fanIn, fanOut) { return Math.sqrt(6 / (fanIn + fanOut)); }

    var limE = xavier(V, d);
    this.E = randMat(V, d, limE);                 // token embedding
    this.P = randMat(T, d, limE * 0.5);           // learned positional encoding
    var limQ = xavier(d, d);
    this.Wq = randMat(d, d, limQ);
    this.Wk = randMat(d, d, limQ);
    this.Wv = randMat(d, d, limQ);
    this.Wo = randMat(d, d, limQ);                // attention output projection
    this.W1 = randMat(d, FFN_HIDDEN, xavier(d, FFN_HIDDEN));
    this.b1 = new Array(FFN_HIDDEN).fill(0);
    this.W2 = randMat(FFN_HIDDEN, d, xavier(FFN_HIDDEN, d));
    this.b2 = new Array(d).fill(0);
    this.Wh = randMat(d, V, xavier(d, V) * 0.5);  // vocab head
    this.bh = new Array(V).fill(0);
    this.g1 = new Array(d).fill(1); this.bt1 = new Array(d).fill(0); // LN1 gain/bias
    this.g2 = new Array(d).fill(1); this.bt2 = new Array(d).fill(0); // LN2 gain/bias

    // app-compat views: countParams()/outWeightsFinite() walk .W/.b;
    // brain.js ring view indexes m.W[l][i]/m.b[l][i] — shapes chosen crash-safe.
    this.W = [this.Wq, this.Wk, this.Wv, this.Wo, this.W1, this.W2, this.Wh];
    this.b = [this.b1, this.b2, this.bh];
    this.sizes = [this.seqLen, d, d, V];

    // optimizer state: one entry per parameter tensor
    var self = this;
    this._plist = [];
    function reg(name, val) {
      var p = { name: name, val: val, grad: zerosLike(val), m: null, v: null };
      self._plist.push(p);
      return p;
    }
    this._pE = reg('E', this.E); this._pP = reg('P', this.P);
    this._pWq = reg('Wq', this.Wq); this._pWk = reg('Wk', this.Wk);
    this._pWv = reg('Wv', this.Wv); this._pWo = reg('Wo', this.Wo);
    this._pW1 = reg('W1', this.W1); this._pb1 = reg('b1', this.b1);
    this._pW2 = reg('W2', this.W2); this._pb2 = reg('b2', this.b2);
    this._pWh = reg('Wh', this.Wh); this._pbh = reg('bh', this.bh);
    this._pg1 = reg('g1', this.g1); this._pbt1 = reg('bt1', this.bt1);
    this._pg2 = reg('g2', this.g2); this._pbt2 = reg('bt2', this.bt2);
    this._t = 0;
  }

  MicroTransformer.prototype.cleanIds = function (x) {
    var V = this.vocab, ids = [];
    for (var i = 0; i < x.length && ids.length < this.tMax; i++) {
      var v = Math.round(Number(x[i]));
      if (!isFinite(v)) v = 0;
      ids.push(Math.max(0, Math.min(V - 1, v)));
    }
    if (!ids.length) ids.push(0);
    return ids;
  };

  // LayerNorm forward for one row; returns {y, cache}
  function lnFwd(x, g, b) {
    var d = x.length, mu = 0, k;
    for (k = 0; k < d; k++) mu += x[k];
    mu /= d;
    var va = 0;
    for (k = 0; k < d; k++) { var dd = x[k] - mu; va += dd * dd; }
    va /= d;
    var inv = 1 / Math.sqrt(va + LN_EPS);
    var y = new Array(d);
    for (k = 0; k < d; k++) y[k] = g[k] * (x[k] - mu) * inv + b[k];
    return { y: y, x: x, mu: mu, inv: inv, g: g };
  }

  // LayerNorm backward: dy -> {dx}; accumulates dg, db into the given arrays
  function lnBwd(dy, c, dg, db) {
    var d = dy.length, k;
    var dxn = new Array(d);
    for (k = 0; k < d; k++) {
      dg[k] += dy[k] * (c.x[k] - c.mu) * c.inv;
      db[k] += dy[k];
      dxn[k] = dy[k] * c.g[k];
    }
    var dvar = 0, dmu = 0;
    for (k = 0; k < d; k++) {
      var xc = c.x[k] - c.mu;
      dvar += dxn[k] * xc * (-0.5) * c.inv * c.inv * c.inv;
      dmu += dxn[k] * (-c.inv);
    }
    var sumXc = 0;
    for (k = 0; k < d; k++) sumXc += (c.x[k] - c.mu);
    dmu += dvar * (-2 * sumXc / d);
    var dx = new Array(d);
    for (k = 0; k < d; k++) {
      dx[k] = dxn[k] * c.inv + dvar * 2 * (c.x[k] - c.mu) / d + dmu / d;
    }
    return dx;
  }

  // Full forward pass on token ids. Returns a cache with every intermediate.
  MicroTransformer.prototype.forwardIds = function (idsIn) {
    var ids = this.cleanIds(idsIn);
    var T = ids.length, d = this.d, V = this.vocab, t, k, j;
    var sq = Math.sqrt(d);
    // 1. embed + position
    var x = new Array(T);
    for (t = 0; t < T; t++) {
      var row = new Array(d);
      for (k = 0; k < d; k++) row[k] = this.E[ids[t]][k] + this.P[t][k];
      x[t] = row;
    }
    // 2. Q/K/V projections
    var Q = new Array(T), K = new Array(T), Vv = new Array(T);
    for (t = 0; t < T; t++) {
      Q[t] = matVec(this.Wq, x[t]); K[t] = matVec(this.Wk, x[t]); Vv[t] = matVec(this.Wv, x[t]);
    }
    // 3. causal scores + weights
    var scores = new Array(T), i;
    for (i = 0; i < T; i++) {
      var srow = new Array(T);
      for (j = 0; j < T; j++) {
        if (j > i) { srow[j] = -Infinity; continue; }
        var s = 0;
        for (k = 0; k < d; k++) s += Q[i][k] * K[j][k];
        srow[j] = s / sq;
      }
      scores[i] = srow;
    }
    var weights = softmaxRows(scores);
    // 4. attend + output projection
    var A = new Array(T), O = new Array(T);
    for (i = 0; i < T; i++) {
      var arow = new Array(d).fill(0), orow;
      for (j = 0; j < T; j++) {
        var w = weights[i][j];
        if (w === 0) continue;
        for (k = 0; k < d; k++) arow[k] += w * Vv[j][k];
      }
      A[i] = arow;
      O[i] = matVec(this.Wo, arow);
    }
    // 5. residual + LN1
    var y1 = new Array(T), c1 = new Array(T);
    for (t = 0; t < T; t++) {
      var r1 = new Array(d);
      for (k = 0; k < d; k++) r1[k] = x[t][k] + O[t][k];
      var l1 = lnFwd(r1, this.g1, this.bt1);
      y1[t] = l1.y; c1[t] = l1;
    }
    // 6. FFN d -> 32 -> d (ReLU)
    var f1pre = new Array(T), f1 = new Array(T), f2pre = new Array(T);
    for (t = 0; t < T; t++) {
      var p1 = new Array(FFN_HIDDEN), f1r = new Array(FFN_HIDDEN);
      for (j = 0; j < FFN_HIDDEN; j++) {
        var s1 = this.b1[j];
        for (k = 0; k < d; k++) s1 += y1[t][k] * this.W1[k][j];
        p1[j] = s1; f1r[j] = s1 > 0 ? s1 : 0;
      }
      f1pre[t] = p1; f1[t] = f1r;
      var p2 = new Array(d);
      for (k = 0; k < d; k++) {
        var s2 = this.b2[k];
        for (j = 0; j < FFN_HIDDEN; j++) s2 += f1r[j] * this.W2[j][k];
        p2[k] = s2;
      }
      f2pre[t] = p2;
    }
    // 7. residual + LN2
    var y2 = new Array(T), c2 = new Array(T);
    for (t = 0; t < T; t++) {
      var r2 = new Array(d);
      for (k = 0; k < d; k++) r2[k] = y1[t][k] + f2pre[t][k];
      var l2 = lnFwd(r2, this.g2, this.bt2);
      y2[t] = l2.y; c2[t] = l2;
    }
    // 8. vocab head from the LAST position
    var last = T - 1, logits = new Array(V), v;
    for (v = 0; v < V; v++) {
      var s3 = this.bh[v];
      for (k = 0; k < d; k++) s3 += y2[last][k] * this.Wh[k][v];
      logits[v] = s3;
    }
    var m = -Infinity;
    for (v = 0; v < V; v++) if (logits[v] > m) m = logits[v];
    var probs = new Array(V), psum = 0;
    for (v = 0; v < V; v++) { probs[v] = Math.exp(logits[v] - m); psum += probs[v]; }
    for (v = 0; v < V; v++) probs[v] /= psum;
    return {
      ids: ids, T: T, x: x, Q: Q, K: K, Vv: Vv,
      scores: scores, weights: weights, A: A, O: O,
      y1: y1, c1: c1, f1pre: f1pre, f1: f1, f2pre: f2pre,
      y2: y2, c2: c2, logits: logits, probs: probs
    };
  };

  function xentLoss(probs, target) {
    var p = Math.min(1 - 1e-12, Math.max(1e-12, probs[target]));
    return -Math.log(p);
  }

  // Backprop one sample (forward cache + target id); accumulates into .grad.
  MicroTransformer.prototype.backwardIds = function (c, target) {
    var T = c.T, d = this.d, V = this.vocab, i, j, k, v;
    var last = T - 1;
    // 8. head
    var dlog = c.probs.slice();
    dlog[target] -= 1;
    var dy2 = [];
    for (i = 0; i < T; i++) dy2.push(new Array(d).fill(0));
    for (k = 0; k < d; k++) {
      var s = 0;
      for (v = 0; v < V; v++) {
        this._pWh.grad[k][v] += c.y2[last][k] * dlog[v];
        s += this.Wh[k][v] * dlog[v];
      }
      dy2[last][k] = s;
    }
    for (v = 0; v < V; v++) this._pbh.grad[v] += dlog[v];
    // 7. LN2
    var dR2 = [];
    for (i = 0; i < T; i++) dR2.push(lnBwd(dy2[i], c.c2[i], this._pg2.grad, this._pbt2.grad));
    // 6. FFN backward
    var dy1 = [];
    for (i = 0; i < T; i++) dy1.push(dR2[i].slice()); // residual branch
    for (i = 0; i < T; i++) {
      var dF2 = dR2[i]; // dL/d f2pre
      var dF1 = new Array(FFN_HIDDEN).fill(0);
      for (j = 0; j < FFN_HIDDEN; j++) {
        var sj = 0;
        for (k = 0; k < d; k++) {
          this._pW2.grad[j][k] += c.f1[i][j] * dF2[k];
          sj += this.W2[j][k] * dF2[k];
        }
        dF1[j] = sj;
      }
      for (k = 0; k < d; k++) this._pb2.grad[k] += dF2[k];
      for (j = 0; j < FFN_HIDDEN; j++) {
        var dPre = c.f1pre[i][j] > 0 ? dF1[j] : 0;
        if (dPre === 0) continue;
        this._pb1.grad[j] += dPre;
        for (k = 0; k < d; k++) {
          this._pW1.grad[k][j] += c.y1[i][k] * dPre;
          dy1[i][k] += this.W1[k][j] * dPre;
        }
      }
    }
    // 5. LN1
    var dR1 = [];
    for (i = 0; i < T; i++) dR1.push(lnBwd(dy1[i], c.c1[i], this._pg1.grad, this._pbt1.grad));
    // 4. attention backward
    var dx = [];
    for (i = 0; i < T; i++) dx.push(dR1[i].slice()); // residual branch into x
    var dA = [], dO = dR1;
    for (i = 0; i < T; i++) {
      dA.push(new Array(d).fill(0));
      // O[i][k] = sum_j Wo[k][j]*A[i][j]  ->  dWo[k][j] += A[i][j]*dO[i][k]
      for (j = 0; j < d; j++) {
        for (k = 0; k < d; k++) this._pWo.grad[k][j] += c.A[i][j] * dO[i][k];
      }
      // dA[i][j] = sum_k Wo[k][j]*dO[i][k]
      for (j = 0; j < d; j++) {
        var sA = 0;
        for (k = 0; k < d; k++) sA += this.Wo[k][j] * dO[i][k];
        dA[i][j] = sA;
      }
    }
    var dw = [], dVv = [];
    for (i = 0; i < T; i++) { dw.push(new Array(T).fill(0)); dVv.push(new Array(d).fill(0)); }
    for (i = 0; i < T; i++) {
      for (j = 0; j < T; j++) {
        var sw = 0;
        for (k = 0; k < d; k++) sw += dA[i][k] * c.Vv[j][k];
        dw[i][j] = sw;
      }
      for (j = 0; j < T; j++) {
        var wgt = c.weights[i][j];
        if (wgt === 0) continue;
        for (k = 0; k < d; k++) dVv[j][k] += wgt * dA[i][k];
      }
    }
    // 3. softmax jacobian + scores
    var dQ = [], dK = [];
    for (i = 0; i < T; i++) { dQ.push(new Array(d).fill(0)); dK.push(new Array(d).fill(0)); }
    var sq = Math.sqrt(d);
    for (i = 0; i < T; i++) {
      var dot = 0;
      for (j = 0; j < T; j++) dot += c.weights[i][j] * dw[i][j];
      for (j = 0; j <= i; j++) {          // j>i masked: weight 0 -> no gradient
        var ds = c.weights[i][j] * (dw[i][j] - dot);
        if (ds === 0) continue;
        for (k = 0; k < d; k++) {
          dQ[i][k] += ds * c.K[j][k] / sq;
          dK[j][k] += ds * c.Q[i][k] / sq;
        }
      }
    }
    // 2. projections back to x.
    // Q[i][m] = sum_k Wq[m][k]*x[i][k]  ->  dWq[m][k] += x[i][k]*dQ[i][m],
    // dx[i][k] += sum_m Wq[m][k]*dQ[i][m]  (same for K, Vv)
    for (i = 0; i < T; i++) {
      for (k = 0; k < d; k++) {
        var sx = 0;
        for (j = 0; j < d; j++) {
          this._pWq.grad[j][k] += c.x[i][k] * dQ[i][j];
          this._pWk.grad[j][k] += c.x[i][k] * dK[i][j];
          this._pWv.grad[j][k] += c.x[i][k] * dVv[i][j];
          sx += this.Wq[j][k] * dQ[i][j] + this.Wk[j][k] * dK[i][j] + this.Wv[j][k] * dVv[i][j];
        }
        dx[i][k] += sx;
      }
    }
    // 1. embeddings
    for (i = 0; i < T; i++) {
      var id = c.ids[i];
      for (k = 0; k < d; k++) {
        this._pE.grad[id][k] += dx[i][k];
        this._pP.grad[i][k] += dx[i][k];
      }
    }
  };

  // Recursive Adam/SGD step over one parameter tensor. Scalars are replaced
  // in place; nested arrays are mutated by the recursion (never replaced —
  // assigning the array branch's return would null the rows).
  function stepRec(val, grad, m, v, st) {
    if (typeof val === 'number') {
      var g = grad * st.inv;
      if (!st.adam) return [val - st.lr * g, 0, 0];
      var nm = st.B1 * m + (1 - st.B1) * g;
      var nv = st.B2 * v + (1 - st.B2) * g * g;
      return [val - st.lr * (nm / st.c1) / (Math.sqrt(nv / st.c2) + st.EPS), nm, nv];
    }
    var nmA = new Array(val.length), nvA = new Array(val.length);
    for (var i = 0; i < val.length; i++) {
      var r = stepRec(val[i], grad[i], m[i], v[i], st);
      if (typeof val[i] === 'number') val[i] = r[0]; // scalar leaf: swap in
      nmA[i] = r[1]; nvA[i] = r[2];
    }
    return [undefined, nmA, nvA];
  }

  MicroTransformer.prototype.zeroGrads = function () {
    for (var i = 0; i < this._plist.length; i++) this._plist[i].grad = zerosLike(this._plist[i].val);
  };

  MicroTransformer.prototype._step = function (lr, n) {
    var st = {
      inv: 1 / Math.max(1, n),
      lr: lr,
      adam: this.optimizer === 'adam',
      B1: 0.9, B2: 0.999, EPS: 1e-8, c1: 1, c2: 1
    };
    if (st.adam) {
      this._t++;
      st.c1 = 1 - Math.pow(st.B1, this._t);
      st.c2 = 1 - Math.pow(st.B2, this._t);
    }
    for (var i = 0; i < this._plist.length; i++) {
      var p = this._plist[i];
      if (st.adam && !p.m) { p.m = zerosLike(p.val); p.v = zerosLike(p.val); }
      var r = stepRec(p.val, p.grad, p.m || 0, p.v || 0, st);
      p.m = r[1]; p.v = r[2];
    }
  };

  function targetOf(Y) { return argmax(Y); }

  // One full-batch gradient step. Returns mean loss over the batch.
  MicroTransformer.prototype.trainBatch = function (X, Y, lr) {
    this.zeroGrads();
    var total = 0;
    for (var n = 0; n < X.length; n++) {
      var c = this.forwardIds(X[n]);
      var tgt = targetOf(Y[n]);
      total += xentLoss(c.probs, tgt);
      this.backwardIds(c, tgt);
    }
    this._step(lr, X.length);
    return total / Math.max(1, X.length);
  };

  MicroTransformer.prototype.predict = function (x) {
    return this.forwardIds(x).probs.slice();
  };

  MicroTransformer.prototype.accuracy = function (X, Y) {
    var ok = 0;
    for (var n = 0; n < X.length; n++) {
      if (argmax(this.predict(X[n])) === targetOf(Y[n])) ok++;
    }
    return X.length ? ok / X.length : 0;
  };

  // Brain-tab ring view adapter: layers [in, attn-block, ffn-block, logits].
  MicroTransformer.prototype.forward = function (x) {
    var c = this.forwardIds(x);
    var last = c.T - 1;
    return {
      acts: [c.ids.map(function (v) { return v; }), c.y1[last].slice(), c.y2[last].slice(), c.logits.slice()],
      output: c.probs.slice()
    };
  };

  // Attention Heatmap inspector data: scores (pre-softmax, -Inf masked),
  // weights (post-softmax, upper triangle EXACTLY 0), projections.
  MicroTransformer.prototype.attentionDetail = function (idsIn) {
    var c = this.forwardIds(idsIn);
    var self = this;
    return {
      ids: c.ids,
      labels: c.ids.map(tokName),
      scores: c.scores,
      weights: c.weights,
      Q: c.Q, K: c.K, V: c.Vv,
      logits: c.logits, probs: c.probs
    };
  };

  MicroTransformer.prototype.shapes = function () {
    var d = this.d, V = this.vocab, T = this.tMax;
    return ['E:' + V + 'x' + d, 'P:' + T + 'x' + d,
      'Wq/Wk/Wv/Wo:' + d + 'x' + d,
      'W1:' + d + 'x' + FFN_HIDDEN, 'b1:' + FFN_HIDDEN,
      'W2:' + FFN_HIDDEN + 'x' + d, 'b2:' + d,
      'Wh:' + d + 'x' + V, 'bh:' + V,
      'LN g/b:' + d];
  };

  MicroTransformer.prototype.params = function () {
    var n = 0;
    for (var i = 0; i < this._plist.length; i++) n += countScalars(this._plist[i].val);
    return n;
  };

  MicroTransformer.prototype.toJSON = function () {
    var j = {
      kind: 'mtf8', vocab: this.vocab, seqLen: this.seqLen, tMax: this.tMax,
      dModel: this.d, seed: this.seed, optimizer: this.optimizer,
      E: this.E, P: this.P, Wq: this.Wq, Wk: this.Wk, Wv: this.Wv, Wo: this.Wo,
      W1: this.W1, b1: this.b1, W2: this.W2, b2: this.b2,
      Wh: this.Wh, bh: this.bh, g1: this.g1, bt1: this.bt1, g2: this.g2, bt2: this.bt2
    };
    if (this._plist[0].m) {
      j.adam = { t: this._t, m: this._plist.map(function (p) { return p.m; }), v: this._plist.map(function (p) { return p.v; }) };
    }
    return j;
  };

  MicroTransformer.fromJSON = function (j) {
    var m = new MicroTransformer({
      vocab: j.vocab, seqLen: j.seqLen, tMax: j.tMax,
      dModel: j.dModel, seed: j.seed == null ? 1 : j.seed, optimizer: j.optimizer
    });
    m.E = j.E; m.P = j.P; m.Wq = j.Wq; m.Wk = j.Wk; m.Wv = j.Wv; m.Wo = j.Wo;
    m.W1 = j.W1; m.b1 = j.b1; m.W2 = j.W2; m.b2 = j.b2;
    m.Wh = j.Wh; m.bh = j.bh; m.g1 = j.g1; m.bt1 = j.bt1; m.g2 = j.g2; m.bt2 = j.bt2;
    // re-point the compat views and the optimizer registry at the loaded tensors
    m.W = [m.Wq, m.Wk, m.Wv, m.Wo, m.W1, m.W2, m.Wh];
    m.b = [m.b1, m.b2, m.bh];
    var vals = [m.E, m.P, m.Wq, m.Wk, m.Wv, m.Wo, m.W1, m.b1, m.W2, m.b2, m.Wh, m.bh, m.g1, m.bt1, m.g2, m.bt2];
    for (var i = 0; i < m._plist.length; i++) {
      m._plist[i].val = vals[i];
      m._plist[i].grad = zerosLike(vals[i]);
      m._plist[i].m = null; m._plist[i].v = null;
    }
    if (j.adam && j.adam.m) {
      m._t = j.adam.t | 0;
      for (var k = 0; k < m._plist.length; k++) {
        m._plist[k].m = j.adam.m[k]; m._plist[k].v = j.adam.v[k];
      }
    }
    return m;
  };

  var API = { MicroTransformer: MicroTransformer, VOCAB: VOCAB, tokName: tokName, mulberry32: mulberry32 };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.NL_ATTN = API;
  }
})(typeof window !== 'undefined' ? window : global);
