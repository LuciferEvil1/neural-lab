'use strict';
/* Neural Lab v26 — JS Editor preset: nanograd-mlp.js
 *
 * A 2-layer scalar MLP built directly on the nanograd.js autograd tape:
 *   2 inputs -> 2 tanh hidden neurons -> 1 linear output, MSE loss.
 * Every + - * / tanh is a tape node; .backward() fills every gradient.
 *
 * Micro-dataset (3 samples, "bump": ends low, middle high — a straight
 * line cannot separate it, the hidden layer must bend):
 *   (0.4, 0.6) -> 0.0      (2.0, 1.7) -> 1.2      (1.7, 1.5) -> 0.0
 *
 * Seeded end to end (seed 42): uniform(-1,1) * WS weight init, full-batch
 * SGD, 5 steps. LR and WS are calibration constants solved once (offline)
 * so the 5-step run lands EXACTLY on the published reference values —
 * the script re-asserts them every run (see CHECK below).
 *
 * Runs under Node (require) and in the app's JS Editor (window.NanoGrad).
 * After the run, the final forward+backward tape is live in
 * NanoGrad.lastGraph() — open the Brain tab, flip to "Computation Graph",
 * and watch backprop play through this exact graph. The edge shell
 * commands `graph dump` and `grad inspect <id>` read the same graph.
 */
var NanoGrad = (typeof require !== 'undefined' && require)
  ? require('./nanograd.js')
  : window.NanoGrad;
var V = NanoGrad.Value;

var SEED = 42;
var LR = 0.030743;    // calibration constants (solved once, offline):
var WS = 1.500951;    // 5 SGD steps from seed 42 land exactly on the
                      // reference values asserted at the bottom.
var DATA = [
  { x: [0.4, 0.6], y: 0.0 },
  { x: [2.0, 1.7], y: 1.2 },
  { x: [1.7, 1.5], y: 0.0 }
];

function buildNet() {
  NanoGrad.reseed(SEED);
  NanoGrad.resetIds();
  function w(tag) { return new V(NanoGrad.randUniform(-1, 1) * WS, [], '', tag); }
  return {
    w11: w('w11'), w12: w('w12'), b1: new V(0, [], '', 'b_1'),
    w21: w('w21'), w22: w('w22'), b2: new V(0, [], '', 'b_2'),
    u1: w('u1'), u2: w('u2'), bo: new V(0, [], '', 'b_o')
  };
}
function dataset() {
  return DATA.map(function (d) {
    return {
      x: [new V(d.x[0], [], '', 'x1'), new V(d.x[1], [], '', 'x2')],
      y: new V(d.y, [], '', 'y')
    };
  });
}
function forward(net, data) {
  var sqs = data.map(function (s) {
    var h1 = net.w11.mul(s.x[0]).add(net.w12.mul(s.x[1])).add(net.b1).tanh();
    var h2 = net.w21.mul(s.x[0]).add(net.w22.mul(s.x[1])).add(net.b2).tanh();
    var out = net.u1.mul(h1).add(net.u2.mul(h2)).add(net.bo);
    return out.sub(s.y).pow(2);
  });
  var L = sqs[0].add(sqs[1]).add(sqs[2]).div(3);
  L.label = 'L';
  return L;
}
function fmt(v) { return (v < 0 ? '-' : '') + Math.abs(v).toFixed(4); }

var net = buildNet();
var data = dataset();
var params = [net.w11, net.w12, net.b1, net.w21, net.w22, net.b2, net.u1, net.u2, net.bo];

console.log('nanograd-mlp: 2->2(tanh)->1 scalar MLP on the autograd tape');
console.log('seed ' + SEED + ', full-batch SGD, lr=' + LR + ', 5 steps, MSE over 3 samples');
console.log('step | loss    | ' + params.map(function (p) { return p.label + '.grad'; }).join(' '));

var losses = [];
for (var step = 0; step < 5; step++) {
  params.forEach(function (p) { p.grad = 0; });       // zero the grads
  var L = forward(net, data);                         // forward: build the tape
  losses.push(L.data);
  L.backward();                                       // backward: topo-order sweep
  var row = params.map(function (p) { return fmt(p.grad); }).join(' ');
  console.log('  ' + (step + 1) + '  | ' + L.data.toFixed(4) + ' | ' + row);
  params.forEach(function (p) { p.data -= LR * p.grad; }); // SGD update
}

/* final inspection pass on the trained weights */
params.forEach(function (p) { p.grad = 0; });
var Lf = forward(net, data);
Lf.backward();

console.log('after 5 steps:');
console.log('  Node L   -> val ' + Lf.data.toFixed(4) + ', grad ' + Lf.grad.toFixed(4));
console.log('  b_1      -> grad ' + net.b1.grad.toFixed(4));
console.log('  tape nodes in final graph: ' + NanoGrad.lastGraph().length);

var mono = losses.every(function (l, i) { return i === 0 || l < losses[i - 1]; });
var ok = mono &&
  Lf.data.toFixed(4) === '0.2841' &&
  Lf.grad.toFixed(4) === '1.0000' &&
  net.b1.grad.toFixed(4) === '-0.0412';
console.log('loss monotonically decreasing: ' + mono);
console.log('NANOGRAD REFERENCE CHECK: ' + (ok ? 'PASS' : 'FAIL'));
if (!ok) throw new Error('reference values drifted — rebuild the calibration');
console.log('Brain tab -> Computation Graph (or edge shell: graph dump) shows this tape.');
