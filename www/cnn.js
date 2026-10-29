'use strict';
/* Neural Lab v19 — tiny from-scratch CNN for 8x8 digit images.
 * conv (4 filters, 3x3, ReLU) -> 2x2 max-pool -> dense -> softmax.
 * Mini-batch training with hand-rolled backprop (SGD or Adam), seeded init.
 * Also owns the deterministic digit-dataset generator (3x5 pixel font
 * upscaled onto an 8x8 canvas with seeded offset + pixel noise), so the
 * exact same dataset is produced on any machine. No dependencies.
 * Browser: window.NL_CNN. Node: module.exports (for headless tests).
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

  /* ── dataset generator ─────────────────────────────────────────── */
  // 3x5 pixel font, one entry per digit 0..9 (rows top->bottom)
  var FONT = [
    ['111', '101', '101', '101', '111'],
    ['010', '110', '010', '010', '111'],
    ['111', '001', '111', '100', '111'],
    ['111', '001', '111', '001', '111'],
    ['101', '101', '111', '001', '001'],
    ['111', '100', '111', '001', '111'],
    ['111', '100', '111', '101', '111'],
    ['111', '001', '010', '010', '010'],
    ['111', '101', '111', '101', '111'],
    ['111', '101', '111', '001', '111']
  ];

  // Deterministic: mulberry32(seed) drives offsets, noise and shuffling.
  // Returns {X: [[64] 0/1 floats], y: [class 0..9]}.
  function makeDigits(seed, perClass) {
    var rng = mulberry32(seed == null ? 42 : seed);
    var X = [], y = [];
    var total = (perClass || 40) * 10;
    for (var n = 0; n < total; n++) {
      var d = (n / (perClass || 40)) | 0;
      var img = new Array(64);
      for (var z = 0; z < 64; z++) img[z] = 0;
      var ox = 1 + ((rng() * 3) | 0);   // glyph x offset 1..3 (3px glyph)
      var oy = ((rng() * 3) | 0);       // glyph y offset 0..2 (5px glyph)
      var glyph = FONT[d];
      for (var r = 0; r < 5; r++) {
        for (var c = 0; c < 3; c++) {
          if (glyph[r].charAt(c) === '1') img[(oy + r) * 8 + (ox + c)] = 1;
        }
      }
      // seeded pixel noise: lit pixels die at 2%, dark pixels spark at 1%
      // (kept gentle: the 3/9/8 glyphs differ by single pixels, so heavy
      // noise would make some digits genuinely unrecognizable)
      for (var p = 0; p < 64; p++) {
        var roll = rng();
        if (img[p] === 1 && roll < 0.02) img[p] = 0;
        else if (img[p] === 0 && roll < 0.01) img[p] = 1;
      }
      X.push(img);
      y.push(d);
    }
    // Fisher-Yates shuffle on the same stream -> class-mixed order
    for (var i = X.length - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var tx = X[i]; X[i] = X[j]; X[j] = tx;
      var ty = y[i]; y[i] = y[j]; y[j] = ty;
    }
    return { X: X, y: y };
  }

  // 8 rows of ASCII for an 8x8 image (handy in the console)
  function render8(img) {
    var lines = [];
    for (var r = 0; r < 8; r++) {
      var s = '';
      for (var c = 0; c < 8; c++) s += img[r * 8 + c] > 0.5 ? '#' : '.';
      lines.push(s);
    }
    return lines.join('\n');
  }

  /* ── the CNN ───────────────────────────────────────────────────── */
  // sizes [64, 36, 10] mirrors the MLP interface so the Brain tab rings
  // (input / pooled features / classes) and metrics code keep working.
  function CNN(opts) {
    opts = opts || {};
    this.cnn = true;
    this.regression = false;
    this.binary = false;
    this.task = 'classification';
    this.nFilters = opts.filters || 4;
    this.nClasses = opts.classes || 10;
    this.optimizer = opts.optimizer === 'adam' ? 'adam' : 'sgd';
    this._t = 0; // Adam step counter; moment state lazily built by _adamInit
    this.sizes = [64, this.nFilters * 9, this.nClasses];
    this.actName = 'relu';
    var rng = mulberry32(opts.seed == null ? 42 : opts.seed);
    this.rng = rng;
    // conv filters: nFilters x 3x3, Xavier-style uniform
    var limF = Math.sqrt(6 / (9 + 36));
    this.F = [];
    this.fb = [];
    for (var f = 0; f < this.nFilters; f++) {
      var filt = [];
      for (var u = 0; u < 3; u++) {
        var row = [];
        for (var v = 0; v < 3; v++) row.push((rng() * 2 - 1) * limF);
        filt.push(row);
      }
      this.F.push(filt);
      this.fb.push(0);
    }
    // dense: (nFilters*9) -> nClasses
    var nIn = this.nFilters * 9;
    var limD = Math.sqrt(6 / (nIn + this.nClasses));
    this.W2 = [];
    this.b2 = [];
    for (var i = 0; i < this.nClasses; i++) {
      var wr = [];
      for (var j = 0; j < nIn; j++) wr.push((rng() * 2 - 1) * limD);
      this.W2.push(wr);
      this.b2.push(0);
    }
  }

  // full forward with the caches backprop needs
  CNN.prototype._fwd = function (x) {
    var nF = this.nFilters;
    // conv 3x3 valid on 8x8 -> 6x6 per filter, then ReLU
    var conv = [], poolMax = [], pooled = [];
    for (var f = 0; f < nF; f++) {
      var map = [], pm = [], prow = [];
      for (var i = 0; i < 6; i++) {
        var mrow = [], prowMax = [], pRow = [];
        for (var j = 0; j < 6; j++) {
          var s = this.fb[f], Ff = this.F[f];
          for (var u = 0; u < 3; u++)
            for (var v = 0; v < 3; v++) s += Ff[u][v] * x[(i + u) * 8 + (j + v)];
          mrow.push(s > 0 ? s : 0);
        }
        map.push(mrow);
      }
      // 2x2 max-pool -> 3x3, remembering argmax (flat idx inside the 6x6)
      for (var pr = 0; pr < 3; pr++) {
        var pmRow = [], pRow2 = [];
        for (var pc = 0; pc < 3; pc++) {
          var bi = 0, bj = 0, best = -Infinity;
          for (var dr = 0; dr < 2; dr++)
            for (var dc = 0; dc < 2; dc++) {
              var val = map[pr * 2 + dr][pc * 2 + dc];
              if (val > best) { best = val; bi = pr * 2 + dr; bj = pc * 2 + dc; }
            }
          pmRow.push(bi * 6 + bj);
          pRow2.push(best);
        }
        pm.push(pmRow);
        prow.push(pRow2);
      }
      conv.push(map);
      poolMax.push(pm);
      pooled.push(prow);
    }
    // flatten pooled maps (filter-major), dense -> softmax
    var h = [];
    for (var f2 = 0; f2 < nF; f2++)
      for (var r2 = 0; r2 < 3; r2++)
        for (var c2 = 0; c2 < 3; c2++) h.push(pooled[f2][r2][c2]);
    var z = new Array(this.nClasses);
    for (var i2 = 0; i2 < this.nClasses; i2++) {
      var s2 = this.b2[i2], W2i = this.W2[i2];
      for (var j2 = 0; j2 < h.length; j2++) s2 += W2i[j2] * h[j2];
      z[i2] = s2;
    }
    var mx = Math.max.apply(null, z);
    var e = z.map(function (v) { return Math.exp(v - mx); });
    var sum = e.reduce(function (p, q) { return p + q; }, 0);
    var probs = e.map(function (v) { return v / sum; });
    return {
      conv: conv, poolMax: poolMax, h: h, probs: probs,
      acts: [x.slice(), h.slice(), probs.slice()]
    };
  };

  CNN.prototype.forward = function (x) {
    var fc = this._fwd(x);
    return { acts: fc.acts, output: fc.probs };
  };

  CNN.prototype.predict = function (x) {
    return this._fwd(x).probs.slice();
  };

  CNN.prototype.lossOf = function (out, y) {
    var eps = 1e-12, loss = 0;
    for (var i = 0; i < out.length; i++) {
      var q = Math.min(1 - eps, Math.max(eps, out[i]));
      loss -= y[i] * Math.log(q);
    }
    return loss;
  };

  // Adam moment state, lazily built on first Adam step (same standard
  // constants as the Train-tab MLP: beta1 .9, beta2 .999, eps 1e-8).
  CNN.prototype._adamInit = function () {
    var nF = this.nFilters, nIn = nF * 9, nC = this.nClasses;
    var f, u, v, i;
    this._mF = []; this._vF = []; this._mfb = []; this._vfb = [];
    for (f = 0; f < nF; f++) {
      var mf = [], vf = [];
      for (u = 0; u < 3; u++) { mf.push([0, 0, 0]); vf.push([0, 0, 0]); }
      this._mF.push(mf); this._vF.push(vf);
      this._mfb.push(0); this._vfb.push(0);
    }
    this._mW2 = []; this._vW2 = []; this._mb2 = []; this._vb2 = [];
    for (i = 0; i < nC; i++) {
      this._mW2.push(new Array(nIn).fill(0));
      this._vW2.push(new Array(nIn).fill(0));
      this._mb2.push(0); this._vb2.push(0);
    }
  };
  function adamStep(w, m, v, g, lr, bc1, bc2) {
    var mm = 0.9 * m + 0.1 * g;
    var vv = 0.999 * v + 0.001 * g * g;
    return [w - lr * (mm / bc1) / (Math.sqrt(vv / bc2) + 1e-8), mm, vv];
  }

  // One epoch: mini-batch SGD (batch 32, seeded shuffle off the model's
  // own rng stream, mean gradient per batch). Returns mean loss over the
  // epoch's pre-update forward passes. Fixed rng stream -> byte-identical
  // runs for identical configs.
  CNN.prototype.trainBatch = function (X, Y, lr) {
    var totalLoss = 0, seen = 0;
    var idx = X.map(function (_, i) { return i; });
    for (var i = idx.length - 1; i > 0; i--) {
      var j = (this.rng() * (i + 1)) | 0;
      var t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    }
    var BS = 32;
    for (var s = 0; s < idx.length; s += BS) {
      var batch = idx.slice(s, s + BS);
      var bx = batch.map(function (k) { return X[k]; });
      var by = batch.map(function (k) { return Y[k]; });
      totalLoss += this._stepBatch(bx, by, lr) * bx.length;
      seen += bx.length;
    }
    return seen ? totalLoss / seen : 0;
  };

  // One SGD step on a mini-batch: accumulate mean gradients, then update.
  CNN.prototype._stepBatch = function (X, Y, lr) {
    var nF = this.nFilters, nIn = nF * 9, nC = this.nClasses;
    var gF = [], gfb = [], gW2 = [], gb2 = [];
    var f, u, v, i, j;
    for (f = 0; f < nF; f++) {
      var gf = [];
      for (u = 0; u < 3; u++) gf.push([0, 0, 0]);
      gF.push(gf); gfb.push(0);
    }
    for (i = 0; i < nC; i++) { gW2.push(new Array(nIn).fill(0)); gb2.push(0); }
    var totalLoss = 0;
    for (var n = 0; n < X.length; n++) {
      var x = X[n], y = Y[n];
      var fc = this._fwd(x);
      totalLoss += this.lossOf(fc.probs, y);
      // output delta (softmax + cross-entropy)
      var delta = new Array(nC);
      for (i = 0; i < nC; i++) delta[i] = fc.probs[i] - y[i];
      // dense grads
      for (i = 0; i < nC; i++) {
        gb2[i] += delta[i];
        var gWi = gW2[i];
        for (j = 0; j < nIn; j++) gWi[j] += delta[i] * fc.h[j];
      }
      // back into pooled features
      var dh = new Array(nIn).fill(0);
      for (i = 0; i < nC; i++) {
        var W2i = this.W2[i], di = delta[i];
        for (j = 0; j < nIn; j++) dh[j] += W2i[j] * di;
      }
      // unpool (argmax routing) + ReLU gate -> dconv per filter (6x6)
      for (f = 0; f < nF; f++) {
        var dconv = [];
        for (var r0 = 0; r0 < 6; r0++) dconv.push([0, 0, 0, 0, 0, 0]);
        for (var pr = 0; pr < 3; pr++) {
          for (var pc = 0; pc < 3; pc++) {
            var flat = fc.poolMax[f][pr][pc];
            var ci = (flat / 6) | 0, cj = flat % 6;
            if (fc.conv[f][ci][cj] > 0) dconv[ci][cj] += dh[f * 9 + pr * 3 + pc];
          }
        }
        // filter grads: cross-correlate dconv with the input image
        for (u = 0; u < 3; u++) {
          for (v = 0; v < 3; v++) {
            var acc = 0;
            for (var ii = 0; ii < 6; ii++)
              for (var jj = 0; jj < 6; jj++) acc += dconv[ii][jj] * x[(ii + u) * 8 + (jj + v)];
            gF[f][u][v] += acc;
          }
        }
        var bs = 0;
        for (var r1 = 0; r1 < 6; r1++)
          for (var c1 = 0; c1 < 6; c1++) bs += dconv[r1][c1];
        gfb[f] += bs;
      }
    }
    var inv = lr / X.length;
    if (this.optimizer === 'adam') {
      // Adam on the batch mean gradient — far steadier than plain SGD
      // across the app's random train/test shuffles.
      if (!this._mF) this._adamInit();
      var t = ++this._t;
      var bc1 = 1 - Math.pow(0.9, t), bc2 = 1 - Math.pow(0.999, t);
      var r;
      for (f = 0; f < nF; f++) {
        r = adamStep(this.fb[f], this._mfb[f], this._vfb[f], gfb[f] / X.length, lr, bc1, bc2);
        this.fb[f] = r[0]; this._mfb[f] = r[1]; this._vfb[f] = r[2];
        for (u = 0; u < 3; u++)
          for (v = 0; v < 3; v++) {
            r = adamStep(this.F[f][u][v], this._mF[f][u][v], this._vF[f][u][v], gF[f][u][v] / X.length, lr, bc1, bc2);
            this.F[f][u][v] = r[0]; this._mF[f][u][v] = r[1]; this._vF[f][u][v] = r[2];
          }
      }
      for (i = 0; i < nC; i++) {
        r = adamStep(this.b2[i], this._mb2[i], this._vb2[i], gb2[i] / X.length, lr, bc1, bc2);
        this.b2[i] = r[0]; this._mb2[i] = r[1]; this._vb2[i] = r[2];
        for (j = 0; j < nIn; j++) {
          r = adamStep(this.W2[i][j], this._mW2[i][j], this._vW2[i][j], gW2[i][j] / X.length, lr, bc1, bc2);
          this.W2[i][j] = r[0]; this._mW2[i][j] = r[1]; this._vW2[i][j] = r[2];
        }
      }
    } else {
      for (f = 0; f < nF; f++) {
        this.fb[f] -= inv * gfb[f];
        for (u = 0; u < 3; u++)
          for (v = 0; v < 3; v++) this.F[f][u][v] -= inv * gF[f][u][v];
      }
      for (i = 0; i < nC; i++) {
        this.b2[i] -= inv * gb2[i];
        for (j = 0; j < nIn; j++) this.W2[i][j] -= inv * gW2[i][j];
      }
    }
    return totalLoss / X.length;
  };

  CNN.prototype.accuracy = function (X, Y) {
    var correct = 0;
    for (var n = 0; n < X.length; n++) {
      var out = this.predict(X[n]);
      if (argmax(out) === argmax(Y[n])) correct++;
    }
    return X.length ? correct / X.length : 0;
  };

  CNN.prototype.params = function () {
    return this.nFilters * 9 + this.nFilters +
      (this.nFilters * 9) * this.nClasses + this.nClasses;
  };

  CNN.prototype.shapes = function () {
    return [
      'conv: ' + this.nFilters + ' filters 3x3 on 8x8 -> 6x6 (ReLU)',
      'maxpool 2x2 -> 3x3 x' + this.nFilters + ' = ' + (this.nFilters * 9),
      'dense: ' + (this.nFilters * 9) + ' -> ' + this.nClasses + ' softmax'
    ];
  };

  CNN.prototype.weightsFinite = function () {
    var f, u, v, i, j;
    for (f = 0; f < this.nFilters; f++) {
      if (!isFinite(this.fb[f])) return false;
      for (u = 0; u < 3; u++)
        for (v = 0; v < 3; v++) if (!isFinite(this.F[f][u][v])) return false;
    }
    for (i = 0; i < this.nClasses; i++) {
      if (!isFinite(this.b2[i])) return false;
      for (j = 0; j < this.W2[i].length; j++) if (!isFinite(this.W2[i][j])) return false;
    }
    return true;
  };

  CNN.prototype.toJSON = function () {
    var j = { kind: 'cnn8', nFilters: this.nFilters, nClasses: this.nClasses,
      optimizer: this.optimizer,
      sizes: this.sizes, F: this.F, fb: this.fb, W2: this.W2, b2: this.b2 };
    if (this._mF) j.adam = { t: this._t, mF: this._mF, vF: this._vF, mfb: this._mfb,
      vfb: this._vfb, mW2: this._mW2, vW2: this._vW2, mb2: this._mb2, vb2: this._vb2 };
    return j;
  };
  CNN.fromJSON = function (j) {
    var c = new CNN({ filters: j.nFilters, classes: j.nClasses, seed: 1,
      optimizer: j.optimizer });
    c.F = j.F; c.fb = j.fb; c.W2 = j.W2; c.b2 = j.b2;
    if (j.adam) {
      c._t = j.adam.t; c._mF = j.adam.mF; c._vF = j.adam.vF; c._mfb = j.adam.mfb;
      c._vfb = j.adam.vfb; c._mW2 = j.adam.mW2; c._vW2 = j.adam.vW2;
      c._mb2 = j.adam.mb2; c._vb2 = j.adam.vb2;
    }
    return c;
  };

  function argmax(a) {
    var bi = 0;
    for (var i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
    return bi;
  }

  var API = { CNN: CNN, makeDigits: makeDigits, render8: render8, mulberry32: mulberry32 };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.NL_CNN = API;
  }
})(typeof window !== 'undefined' ? window : global);
