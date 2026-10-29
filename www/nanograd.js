'use strict';
/* Neural Lab v26 — nanograd.js: micrograd-style scalar autograd tape engine.
 *
 * Zero dependencies. Every Value records its parent pointers and an op code;
 * .backward() runs a topological-order reverse sweep that fills in every
 * node's grad (dL/dv). All randomness flows through a seeded mulberry32
 * stream (default seed 42), so every graph is bit-identical across runs.
 *
 * Ops: + - * / ^n (pow) relu tanh sigmoid.
 * Runs in the page (window.NanoGrad), under Node (module.exports), and in
 * the app's JS Editor (console.log goes to the Console panel — just tap Run).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.NanoGrad = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  /* ── seeded RNG: mulberry32 ── */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(42);
  function reseed(seed) { rng = mulberry32(seed == null ? 42 : seed); }
  function randUniform(lo, hi) { return lo + (hi - lo) * rng(); }

  /* ── node id counter (session-monotonic; stable within one graph build) ── */
  var nextId = 0;
  function resetIds() { nextId = 0; }

  /* ── Value: one scalar on the tape ── */
  function Value(data, children, op, label) {
    this.id = nextId++;
    this.data = data;
    this.grad = 0;
    this._prev = children || [];
    this._op = op || '';
    this.label = label || '';
    this._backward = function () {};
  }
  function wrap(v) { return (v instanceof Value) ? v : new Value(v); }

  Value.prototype.add = function (o) {
    o = wrap(o);
    var a = this;
    var out = new Value(a.data + o.data, [a, o], '+');
    out._backward = function () { a.grad += out.grad; o.grad += out.grad; };
    return out;
  };
  Value.prototype.sub = function (o) {
    o = wrap(o);
    var a = this;
    var out = new Value(a.data - o.data, [a, o], '-');
    out._backward = function () { a.grad += out.grad; o.grad -= out.grad; };
    return out;
  };
  Value.prototype.mul = function (o) {
    o = wrap(o);
    var a = this;
    var out = new Value(a.data * o.data, [a, o], '*');
    out._backward = function () { a.grad += o.data * out.grad; o.grad += a.data * out.grad; };
    return out;
  };
  Value.prototype.div = function (o) {
    o = wrap(o);
    var a = this;
    var out = new Value(a.data / o.data, [a, o], '/');
    out._backward = function () {
      a.grad += out.grad / o.data;
      o.grad += out.grad * (-a.data / (o.data * o.data));
    };
    return out;
  };
  Value.prototype.pow = function (n) {
    var a = this;
    var out = new Value(Math.pow(a.data, n), [a], '^' + n);
    out._backward = function () { a.grad += n * Math.pow(a.data, n - 1) * out.grad; };
    return out;
  };
  Value.prototype.neg = function () { return this.mul(-1); };
  Value.prototype.relu = function () {
    var a = this;
    var out = new Value(a.data > 0 ? a.data : 0, [a], 'relu');
    out._backward = function () { a.grad += (out.data > 0 ? out.grad : 0); };
    return out;
  };
  Value.prototype.tanh = function () {
    var a = this;
    var t = Math.tanh(a.data);
    var out = new Value(t, [a], 'tanh');
    out._backward = function () { a.grad += (1 - t * t) * out.grad; };
    return out;
  };
  Value.prototype.sigmoid = function () {
    var a = this;
    var s = 1 / (1 + Math.exp(-a.data));
    var out = new Value(s, [a], 'sigmoid');
    out._backward = function () { a.grad += s * (1 - s) * out.grad; };
    return out;
  };

  /* topological order (DFS) then reverse sweep */
  Value.prototype.backward = function () {
    var topo = [], visited = {};
    (function build(v) {
      if (visited[v.id]) return;
      visited[v.id] = 1;
      for (var i = 0; i < v._prev.length; i++) build(v._prev[i]);
      topo.push(v);
    })(this);
    this.grad = 1;
    for (var i = topo.length - 1; i >= 0; i--) topo[i]._backward();
    recordGraph(topo);
    return topo;
  };

  /* ── graph registry: the most recent backward() snapshot ──
   * lastGraph: array of {id,label,op,v,grad,parents:[ids]} in topo order.
   * The Brain tab DAG view and the `graph`/`grad` edge-shell commands
   * read through currentGraph(). */
  var lastGraph = null;
  function recordGraph(topo) {
    lastGraph = topo.map(function (v) {
      return {
        id: v.id,
        label: v.label || ('v' + v.id),
        op: v._op || 'input',
        v: v.data,
        grad: v.grad,
        parents: v._prev.map(function (p) { return p.id; })
      };
    });
  }
  function currentGraph() {
    if (lastGraph && lastGraph.length) return lastGraph;
    return demoGraph();
  }

  /* ── tiny MLP on top of Value (micrograd-style) ── */
  function Neuron(nin, opts) {
    opts = opts || {};
    var tag = opts.tag || 'n';
    this.w = [];
    for (var i = 0; i < nin; i++) {
      var wv = new Value(randUniform(-1, 1), [], '', tag + '_w' + (i + 1));
      this.w.push(wv);
    }
    this.b = new Value(0, [], '', tag + '_b');
  }
  Neuron.prototype.forward = function (x) {
    var act = this.b;
    for (var i = 0; i < this.w.length; i++) act = act.add(this.w[i].mul(x[i]));
    return act.tanh();
  };
  Neuron.prototype.parameters = function () { return this.w.concat([this.b]); };

  function Layer(nin, nout, tag) {
    this.neurons = [];
    for (var i = 0; i < nout; i++) this.neurons.push(new Neuron(nin, { tag: tag + (i + 1) }));
  }
  Layer.prototype.forward = function (x) {
    var out = [];
    for (var i = 0; i < this.neurons.length; i++) out.push(this.neurons[i].forward(x));
    return out;
  };
  Layer.prototype.parameters = function () {
    var ps = [];
    for (var i = 0; i < this.neurons.length; i++) ps = ps.concat(this.neurons[i].parameters());
    return ps;
  };

  function MLP(nin, nouts, tag) {
    this.layers = [];
    var sz = [nin].concat(nouts);
    for (var i = 0; i < nouts.length; i++) this.layers.push(new Layer(sz[i], sz[i + 1], (tag || 'h') + (i + 1) + '_'));
  }
  MLP.prototype.forward = function (x) {
    var xs = x.map(function (v) { return (v instanceof Value) ? v : new Value(v); });
    for (var i = 0; i < this.layers.length; i++) xs = this.layers[i].forward(xs);
    return xs;
  };
  MLP.prototype.parameters = function () {
    var ps = [];
    for (var i = 0; i < this.layers.length; i++) ps = ps.concat(this.layers[i].parameters());
    return ps;
  };
  MLP.prototype.zeroGrad = function () {
    var ps = this.parameters();
    for (var i = 0; i < ps.length; i++) ps[i].grad = 0;
  };

  /* ── canonical demo graph: 2->2->1 tanh MLP, one sample, MSE, backward ──
   * Small (~19 nodes) so the Brain DAG view and `graph dump` stay readable
   * on a phone. Seeded — identical every run. */
  function demoGraph() {
    reseed(42); resetIds();
    var net = new MLP(2, [2, 1], 'd');
    var x = [new Value(0.5, [], '', 'x1'), new Value(-0.3, [], '', 'x2')];
    var ys = net.forward(x);
    var y = new Value(1.0, [], '', 'y');
    var L = ys[0].sub(y).pow(2);
    L.label = 'L';
    L.backward();
    return lastGraph;
  }

  return {
    Value: Value,
    Neuron: Neuron, Layer: Layer, MLP: MLP,
    reseed: reseed, resetIds: resetIds, randUniform: randUniform,
    lastGraph: function () { return lastGraph; },
    currentGraph: currentGraph,
    demoGraph: demoGraph
  };
}));
