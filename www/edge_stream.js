'use strict';
/* Neural Lab v23 — edge_stream.js: sensor -> tensor streaming demo.
 *
 * Firmware-style zero-copy idea: on a real MCU the tensor the model
 * reads would be a VIEW into the DMA ring buffer, not a second copy —
 * memcpy on every inference wastes cycles and battery. Here the
 * RingBuffer keeps ONE Float32Array (32 samples x 4 channels) and
 * asTensor() hands back a subarray() VIEW of that same storage.
 * subarray() shares memory — no copy happens. The feature code reads
 * straight off the view through modular indexing, so the whole
 * sensor->features path touches each byte exactly once.
 *
 * Channels: ax, ay, az (synthetic IMU: sine waves 120 degrees apart +
 * seeded noise) and mic (envelope stream). Two scripted SHAKE bursts
 * are injected so the demo always has something to find.
 * Deterministic: same seed -> same ticks, same events.
 *
 * Runs in the browser (window.NL_EDGE_STREAM) and in Node
 * (module.exports). In the app's JS Editor, console.log goes to the
 * Console panel, so just tap Run.
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

  var WINDOW = 32;     // ring depth, samples
  var CHANNELS = 4;    // ax, ay, az, mic
  var DEF_THRESH = 0.5;

  // Threshold override: the app's edge shell sets window.EDGE_THRESH;
  // in Node the test can set global EDGE_THRESH the same way.
  function getThresh() {
    if (global && typeof global.EDGE_THRESH === 'number') return global.EDGE_THRESH;
    return DEF_THRESH;
  }

  // The one and only storage. asTensor() returns a VIEW of it — no memcpy.
  function RingBuffer(cap) {
    this.cap = cap || WINDOW;
    this.buf = new Float32Array(this.cap * CHANNELS);
    this.head = 0;   // next write slot
    this.count = 0;  // samples written (saturates at cap)
  }
  RingBuffer.prototype.push = function (ax, ay, az, mic) {
    var o = this.head * CHANNELS;
    this.buf[o] = ax; this.buf[o + 1] = ay;
    this.buf[o + 2] = az; this.buf[o + 3] = mic;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  };
  // zero-copy: the model's input tensor IS this view into the ring.
  RingBuffer.prototype.asTensor = function () {
    return this.buf.subarray(0, this.cap * CHANNELS);
  };

  // Per-window features straight off the tensor view: mean + variance
  // of the acceleration magnitude over the newest n samples.
  function windowFeatures(view, head, count, cap) {
    var n = Math.min(count, cap), sum = 0, sum2 = 0, k, idx, o, m;
    for (k = 0; k < n; k++) {
      idx = (((head - 1 - k) % cap) + cap) % cap;
      o = idx * CHANNELS;
      m = Math.sqrt(view[o] * view[o] + view[o + 1] * view[o + 1] + view[o + 2] * view[o + 2]);
      sum += m; sum2 += m * m;
    }
    var mean = sum / n;
    return { mean: mean, variance: Math.max(0, sum2 / n - mean * mean), n: n };
  }

  // Tiny integer-style classifier: SHAKE when the window's accel
  // variance blows past the threshold, else still.
  function classify(mean, variance, thresh) {
    var t = (thresh == null) ? getThresh() : thresh;
    return variance > t ? 'SHAKE' : 'still';
  }

  // Seeded synthetic IMU + mic. Two scripted shake bursts (ticks
  // 80-99 and 150-169) inject big noise so the demo always fires.
  // Fixed rng call order per tick -> fully deterministic.
  function makeIMU(seed) {
    var rng = mulberry32(seed == null ? 1337 : seed);
    var bursts = [[80, 99], [150, 169]];
    return function tick(t) {
      var w = 2 * Math.PI * t / 24;
      var ax = Math.sin(w);
      var ay = Math.sin(w + 2 * Math.PI / 3);
      var az = 1 + Math.sin(w + 4 * Math.PI / 3);
      var mic = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 37 + 1);
      var shake = 0, b;
      for (b = 0; b < bursts.length; b++) {
        if (t >= bursts[b][0] && t <= bursts[b][1]) shake = 1.6;
      }
      ax += (rng() * 2 - 1) * (0.05 + shake);
      ay += (rng() * 2 - 1) * (0.05 + shake);
      az += (rng() * 2 - 1) * (0.05 + shake);
      mic += (rng() * 2 - 1) * 0.02;
      return [ax, ay, az, mic];
    };
  }

  function runStreamDemo(opts) {
    opts = opts || {};
    var ticks = opts.ticks || 200;
    var seed = opts.seed == null ? 1337 : opts.seed;
    var imu = makeIMU(seed);
    var rb = new RingBuffer(WINDOW);
    var tensor = rb.asTensor(); // the model's input: a view, not a copy
    console.log('edge_stream: IMU+mic -> ring buffer (' + WINDOW + 'x' + CHANNELS +
      ' float32, zero-copy view)');
    console.log('tensor shares the ring storage: ' +
      (tensor.buffer === rb.buf.buffer ? 'yes (no memcpy)' : 'NO — bug'));
    var events = [], wasShake = false;
    var shakeWindows = 0, stillWindows = 0, t, s, f, label;
    for (t = 0; t < ticks; t++) {
      s = imu(t);
      rb.push(s[0], s[1], s[2], s[3]);
      f = windowFeatures(tensor, rb.head, rb.count, rb.cap);
      label = classify(f.mean, f.variance);
      if (label === 'SHAKE') {
        shakeWindows++;
        if (!wasShake) {
          events.push({ tick: t, variance: f.variance });
          console.log('tick ' + t + ': SHAKE (accel-mag var=' + f.variance.toFixed(3) + ')');
        }
      } else {
        stillWindows++;
      }
      wasShake = (label === 'SHAKE');
    }
    console.log('summary: ' + events.length + ' SHAKE events, ' +
      shakeWindows + ' shake windows, ' + stillWindows +
      ' still windows over ' + ticks + ' ticks (thresh=' + getThresh() + ')');
    return events;
  }

  var API = {
    RingBuffer: RingBuffer,
    makeIMU: makeIMU,
    classify: classify,
    windowFeatures: windowFeatures,
    getThresh: getThresh,
    runStreamDemo: runStreamDemo,
    WINDOW: WINDOW,
    CHANNELS: CHANNELS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    global.NL_EDGE_STREAM = API;
  }
})(typeof window !== 'undefined' ? window : global);
