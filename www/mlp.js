'use strict';
/* Neural Lab — vanilla JS multilayer perceptron. No dependencies.
 * Binary output (1 unit): sigmoid + binary cross-entropy.
 * Multi-class output (N>1 units): softmax + categorical cross-entropy.
 * Regression (opts.task === 'regression'): linear output unit + MSE loss.
 * Works in the browser (window.NL_MLP) and in Node (module.exports).
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

  function MLP(sizes, opts) {
    opts = opts || {};
    this.sizes = sizes.slice();
    this.actName = opts.activation === 'relu' ? 'relu' : 'tanh';
    this.task = opts.task === 'regression' ? 'regression' : 'classification';
    this.regression = this.task === 'regression';
    var seed = (opts.seed == null) ? ((Math.random() * 1e9) | 0) : opts.seed;
    this.rng = mulberry32(seed);
    this.W = [];
    this.b = [];
    for (var l = 0; l < sizes.length - 1; l++) {
      var nIn = sizes[l], nOut = sizes[l + 1];
      var lim = Math.sqrt(6 / (nIn + nOut)); // Xavier uniform
      var w = [];
      for (var i = 0; i < nOut; i++) {
        var row = [];
        for (var j = 0; j < nIn; j++) row.push((this.rng() * 2 - 1) * lim);
        w.push(row);
      }
      this.W.push(w);
      var bb = [];
      for (var k = 0; k < nOut; k++) bb.push(0);
      this.b.push(bb);
    }
    this.binary = sizes[sizes.length - 1] === 1;
    // v19 deep trainer: optimizer ('sgd' | 'adam') + inverted dropout.
    // Defaults reproduce v18 exactly (SGD, no dropout, no optimizer state).
    this.optimizer = opts.optimizer === 'adam' ? 'adam' : 'sgd';
    var dp = (opts.dropout == null) ? 0 : +opts.dropout;
    this.dropout = isFinite(dp) ? Math.min(0.9, Math.max(0, dp)) : 0;
    this._t = 0;                 // adam step counter
    this._mW = null; this._vW = null; this._mb = null; this._vb = null;
  }

  MLP.prototype._act = function (x) {
    return this.actName === 'relu' ? (x > 0 ? x : 0) : Math.tanh(x);
  };
  // derivative w.r.t. the ACTIVATED value y = act(x)
  MLP.prototype._actD = function (y) {
    return this.actName === 'relu' ? (y > 0 ? 1 : 0) : (1 - y * y);
  };

  // train=true enables inverted dropout on hidden layers (v19) and reports
  // the per-layer masks in the result so backprop can route around dropped
  // units. With dropout === 0 the mask branch never runs and every float
  // op is identical to the plain forward pass.
  MLP.prototype.forward = function (x, train) {
    var acts = [x.slice()];
    var masks = [null];
    var a = x.slice();
    for (var l = 0; l < this.W.length; l++) {
      var Wl = this.W[l], bl = this.b[l];
      var z = new Array(Wl.length);
      for (var i = 0; i < Wl.length; i++) {
        var s = bl[i], row = Wl[i];
        for (var j = 0; j < row.length; j++) s += row[j] * a[j];
        z[i] = s;
      }
      var last = (l === this.W.length - 1);
      if (last) {
        if (this.regression) {
          a = z.slice(); // linear output unit: raw score IS the prediction
        } else if (this.binary) {
          a = z.map(function (v) { return 1 / (1 + Math.exp(-v)); });
        } else {
          var m = Math.max.apply(null, z);
          var e = z.map(function (v) { return Math.exp(v - m); });
          var sum = e.reduce(function (p, q) { return p + q; }, 0);
          a = e.map(function (v) { return v / sum; });
        }
        masks.push(null);
      } else {
        var self = this;
        a = z.map(function (v) { return self._act(v); });
        if (train && this.dropout > 0) {
          // inverted dropout: keep with prob (1-p), scale survivors by
          // 1/(1-p) so predict-time needs no rescaling
          var keep = 1 - this.dropout, mask = new Array(a.length);
          for (var u = 0; u < a.length; u++) {
            mask[u] = (this.rng() < keep) ? (1 / keep) : 0;
            a[u] *= mask[u];
          }
          masks.push(mask);
        } else {
          masks.push(null);
        }
      }
      acts.push(a);
    }
    return { acts: acts, output: acts[acts.length - 1], masks: masks };
  };

  MLP.prototype.lossOf = function (out, y) {
    var eps = 1e-12, loss = 0;
    if (this.regression) {
      var s = 0;
      for (var r = 0; r < out.length; r++) { var d = out[r] - y[r]; s += d * d; }
      return s / out.length; // mean squared error
    }
    if (this.binary) {
      var p = Math.min(1 - eps, Math.max(eps, out[0]));
      loss = -(y[0] * Math.log(p) + (1 - y[0]) * Math.log(1 - p));
    } else {
      for (var i = 0; i < out.length; i++) {
        var q = Math.min(1 - eps, Math.max(eps, out[i]));
        loss -= y[i] * Math.log(q);
      }
    }
    return loss;
  };

  // One full-batch gradient step. Returns mean loss over the batch.
  MLP.prototype.trainBatch = function (X, Y, lr) {
    var L = this.W.length;
    var gW = [], gb = [];
    for (var l = 0; l < L; l++) {
      gW.push(this.W[l].map(function (row) { return row.map(function () { return 0; }); }));
      gb.push(this.b[l].map(function () { return 0; }));
    }
    var totalLoss = 0;
    for (var n = 0; n < X.length; n++) {
      var fw = this.forward(X[n], true);
      var acts = fw.acts, out = fw.output;
      totalLoss += this.lossOf(out, Y[n]);
      // deltas per layer
      var deltas = new Array(L);
      var dOut = new Array(out.length);
      if (this.regression) {
        // d(MSE)/dz for a linear output unit
        for (var ri = 0; ri < out.length; ri++) dOut[ri] = 2 * (out[ri] - Y[n][ri]) / out.length;
      } else {
        for (var i = 0; i < out.length; i++) dOut[i] = out[i] - Y[n][i];
      }
      deltas[L - 1] = dOut;
      for (var ll = L - 2; ll >= 0; ll--) {
        var dNext = deltas[ll + 1], Wn = this.W[ll + 1], aL = acts[ll + 1];
        var mk = fw.masks ? fw.masks[ll + 1] : null;
        var d = new Array(aL.length);
        for (var j = 0; j < aL.length; j++) {
          var s = 0;
          for (var k = 0; k < dNext.length; k++) s += Wn[k][j] * dNext[k];
          d[j] = s * this._actD(aL[j]);
          if (mk) d[j] *= mk[j]; // dropped units get no gradient
        }
        deltas[ll] = d;
      }
      for (var q = 0; q < L; q++) {
        var dl = deltas[q], aPrev = acts[q];
        for (var ii = 0; ii < dl.length; ii++) {
          gb[q][ii] += dl[ii];
          for (var jj = 0; jj < aPrev.length; jj++) gW[q][ii][jj] += dl[ii] * aPrev[jj];
        }
      }
    }
    if (this.optimizer === 'adam') {
      // Adam (Kingma & Ba): per-parameter adaptive step from the MEAN
      // gradient, with bias correction. State lives on the model.
      this._adamInit();
      this._t++;
      var B1 = 0.9, B2 = 0.999, EPS = 1e-8;
      var c1 = 1 - Math.pow(B1, this._t), c2 = 1 - Math.pow(B2, this._t);
      var invN = 1 / X.length;
      for (var a2 = 0; a2 < L; a2++) {
        for (var i2 = 0; i2 < this.W[a2].length; i2++) {
          var gbM = gb[a2][i2] * invN;
          this._mb[a2][i2] = B1 * this._mb[a2][i2] + (1 - B1) * gbM;
          this._vb[a2][i2] = B2 * this._vb[a2][i2] + (1 - B2) * gbM * gbM;
          this.b[a2][i2] -= lr * (this._mb[a2][i2] / c1) /
            (Math.sqrt(this._vb[a2][i2] / c2) + EPS);
          for (var j2 = 0; j2 < this.W[a2][i2].length; j2++) {
            var g = gW[a2][i2][j2] * invN;
            this._mW[a2][i2][j2] = B1 * this._mW[a2][i2][j2] + (1 - B1) * g;
            this._vW[a2][i2][j2] = B2 * this._vW[a2][i2][j2] + (1 - B2) * g * g;
            this.W[a2][i2][j2] -= lr * (this._mW[a2][i2][j2] / c1) /
              (Math.sqrt(this._vW[a2][i2][j2] / c2) + EPS);
          }
        }
      }
      return totalLoss / X.length;
    }
    var inv = lr / X.length;
    for (var m = 0; m < L; m++) {
      for (var ii2 = 0; ii2 < this.W[m].length; ii2++) {
        this.b[m][ii2] -= inv * gb[m][ii2];
        for (var jj2 = 0; jj2 < this.W[m][ii2].length; jj2++) {
          this.W[m][ii2][jj2] -= inv * gW[m][ii2][jj2];
        }
      }
    }
    return totalLoss / X.length;
  };

  // lazily zero-init the Adam moment buffers (shaped exactly like W/b)
  MLP.prototype._adamInit = function () {
    if (this._mW) return;
    function zeros(mat) {
      return mat.map(function (row) {
        return row.map(function () { return 0; });
      });
    }
    this._mW = this.W.map(zeros);
    this._vW = this.W.map(zeros);
    this._mb = this.b.map(function (bb) { return bb.map(function () { return 0; }); });
    this._vb = this.b.map(function (bb) { return bb.map(function () { return 0; }); });
    this._t = 0;
  };

  MLP.prototype.predict = function (x) {
    return this.forward(x).output.slice();
  };

  MLP.prototype.accuracy = function (X, Y) {
    var correct = 0;
    for (var n = 0; n < X.length; n++) {
      var out = this.predict(X[n]);
      var pred, truth;
      if (this.binary) {
        pred = out[0] >= 0.5 ? 1 : 0;
        truth = Y[n][0] >= 0.5 ? 1 : 0;
      } else {
        pred = argmax(out); truth = argmax(Y[n]);
      }
      if (pred === truth) correct++;
    }
    return X.length ? correct / X.length : 0;
  };

  // Root-mean-square error (regression metric).
  MLP.prototype.rmse = function (X, Y) {
    if (!X.length || !Y.length) return NaN;
    var s = 0;
    for (var n = 0; n < X.length; n++) {
      var out = this.predict(X[n]);
      for (var i = 0; i < out.length; i++) { var d = out[i] - Y[n][i]; s += d * d; }
    }
    return Math.sqrt(s / (X.length * Y[0].length));
  };

  function argmax(a) {
    var bi = 0;
    for (var i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
    return bi;
  }

  MLP.prototype.shapes = function () {
    var s = [];
    for (var l = 0; l < this.W.length; l++) {
      s.push('L' + l + ': W[' + this.W[l].length + 'x' + this.W[l][0].length +
             '] b[' + this.b[l].length + ']');
    }
    return s;
  };

  MLP.prototype.toJSON = function () {
    var j = { sizes: this.sizes, actName: this.actName, binary: this.binary,
      task: this.task, optimizer: this.optimizer, dropout: this.dropout,
      W: this.W, b: this.b };
    if (this._mW) { // persist Adam moments so a loaded model resumes smoothly
      j.adam = { t: this._t, mW: this._mW, vW: this._vW, mb: this._mb, vb: this._vb };
    }
    return j;
  };
  MLP.fromJSON = function (j) {
    // pre-v19 saves have no optimizer/dropout/adam fields -> SGD, 0, fresh
    var m = new MLP(j.sizes, {
      activation: j.actName, task: j.task, seed: 1,
      optimizer: j.optimizer, dropout: j.dropout
    });
    m.W = j.W; m.b = j.b; m.task = j.task === 'regression' ? 'regression' : 'classification'; m.regression = m.task === 'regression';
    if (j.adam && j.adam.mW) {
      m._mW = j.adam.mW; m._vW = j.adam.vW; m._mb = j.adam.mb; m._vb = j.adam.vb;
      m._t = j.adam.t | 0;
    }
    return m;
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MLP: MLP, mulberry32: mulberry32 };
  } else {
    global.NL_MLP = { MLP: MLP, mulberry32: mulberry32 };
  }
})(typeof window !== 'undefined' ? window : global);
