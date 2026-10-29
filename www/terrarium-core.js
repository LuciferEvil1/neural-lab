'use strict';
/* ════════════════════════════════════════════════════════════════
   Neural Lab v68 — TERRARIUM CORE (pure logic, no DOM, no THREE).
   Safe to run in Node for headless tests.

   THE DESIGN (Ahkeem, 2026-10-20): the Dish is no longer a flock
   doing a cipher curriculum. It is ONE bot carrying the FULL
   trinity brain, living in an open-ended terrarium — an
   OBSERVATORY. The bot gets NO assigned job: it forms its own
   objectives, acts, and judges its own outcomes. Failed runs are
   sealed as ghosts (checksum); a ghost whose appeal fails breaks
   into molecules (recycled biases); overflow merges into black
   hole gravity. The brain is SUBSTRATE-AWARE: it probes the host
   it is running on, derives a parameter budget, and GROWS toward
   that ceiling on plateau/stuck signals (Net2Net widening, which
   preserves the network's function exactly while adding units).

   v69 — PHYSICS + WORLD PASS: velocity locomotion (accel/decel
   ramps, smooth turns, slope tilt), collide-and-slide, light-prop
   pushing with momentum, physical black-hole gravity (capped),
   pond physics shared with the renderer (groundVis/POND): thrown
   orbs splash + FLOAT instead of sinking into the pond dip, spin
   and rolling friction, throwable→prop knocks. Brain untouched.

   Brain interface (same socket as the Dish): sense / decide / learn.
   ════════════════════════════════════════════════════════════════ */
var NL_TERCORE = (function () {

/* ---------- utils ---------- */
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fnv1a(str) {
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ---------- substrate probe ----------
 * Honest signals only: what a WebView actually exposes.
 *  - navigator.hardwareConcurrency (core count)
 *  - navigator.deviceMemory (GB, coarse, Android Chrome/WebView)
 *  - performance.memory.jsHeapSizeLimit (Chrome-family only)
 *  - a timed micro-benchmark: real measured math throughput.
 * Budget derivation is deliberately simple and explainable:
 * every signal contributes a factor; ceiling lands in the
 * single-digit-thousands..~2M range — phone-class hosts sit low,
 * desktops high. The brain NEVER exceeds the derived ceiling. */
function benchmarkOps(ms) {
  ms = ms || 24;
  var x = 1.0000001, n = 0;
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var now = t0;
  while (now - t0 < ms) {
    for (var i = 0; i < 2000; i++) { x = Math.sin(x) * 1.0000001 + Math.sqrt(x + i % 7); }
    n += 2000;
    now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }
  var dt = Math.max(1, now - t0);
  return Math.round(n / dt * 1000); // ops per second
}
function probeSubstrate(env) {
  env = env || {};
  var nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
  var cores = (nav.hardwareConcurrency | 0) || 2;
  var memGB = (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) ? nav.deviceMemory : null;
  var heapGB = null;
  try {
    var pm = env.performanceMemory || (typeof performance !== 'undefined' ? performance.memory : null);
    if (pm && pm.jsHeapSizeLimit) heapGB = pm.jsHeapSizeLimit / 1073741824;
  } catch (e) {}
  var ops = env.opsPerSec || benchmarkOps(env.benchMs || 24);
  // factor model (v1, documented in the HUD's substrate panel)
  var coreF = clamp(cores / 4, 0.5, 3);              // 8-core phone → 2
  var memF = memGB ? clamp(memGB / 2, 0.4, 4) : (heapGB ? clamp(heapGB, 0.4, 3) : 0.8);
  var benchF = clamp(ops / 4e7, 0.35, 3);            // 40 Mops/s ≈ factor 1
  var base = 26000;                                  // params at factor 1
  var ceiling = Math.round(base * coreF * memF * benchF);
  ceiling = clamp(ceiling, 12000, 2000000);
  var profile = ceiling < 60000 ? 'phone-class' : (ceiling < 300000 ? 'tablet / laptop-class' : 'desktop-class');
  return {
    cores: cores, memGB: memGB, heapGB: heapGB, opsPerSec: ops,
    coreF: +coreF.toFixed(2), memF: +memF.toFixed(2), benchF: +benchF.toFixed(2),
    ceilingParams: ceiling,
    ghostCap: clamp(Math.round(ceiling / 9000), 4, 28),
    moleculeCap: clamp(Math.round(ceiling / 4500), 8, 56),
    profile: profile
  };
}

/* ---------- growable MLP (Net2Net widening) ----------
 * W[l] is [out][in]. growNeuron(l, j): duplicate neuron j of
 * layer l — the copy gets j's incoming weights and bias; j's
 * outgoing weights are split in half between j and the copy.
 * The function computed by the network is EXACTLY preserved
 * (Net2Net, Chen et al. 2015) — growth never forgets. */
function GrowMLP(sizes, rng) {
  this.sizes = sizes.slice();
  this.rng = rng || Math.random;
  this.W = []; this.b = [];
  for (var l = 0; l < sizes.length - 1; l++) {
    var nIn = sizes[l], nOut = sizes[l + 1];
    var scale = Math.sqrt(2 / (nIn + nOut));
    var Wl = [];
    for (var o = 0; o < nOut; o++) {
      var row = [];
      for (var i = 0; i < nIn; i++) row.push((this.rng() * 2 - 1) * scale);
      Wl.push(row);
    }
    this.W.push(Wl);
    this.b.push(new Array(nOut).fill(0));
  }
  this.lastActs = null;
}
GrowMLP.prototype.paramCount = function () {
  var n = 0;
  for (var l = 0; l < this.W.length; l++) n += this.W[l].length * this.W[l][0].length + this.b[l].length;
  return n;
};
GrowMLP.prototype.forward = function (x) {
  var acts = [x.slice()];
  var a = x;
  for (var l = 0; l < this.W.length; l++) {
    var out = [];
    for (var o = 0; o < this.W[l].length; o++) {
      var s = this.b[l][o], row = this.W[l][o];
      for (var i = 0; i < row.length; i++) s += row[i] * a[i];
      out.push(Math.tanh(s));
    }
    acts.push(out); a = out;
  }
  this.lastActs = acts;
  return a;
};
/* one REINFORCE step: push the taken action's log-prob by advantage */
GrowMLP.prototype.reinforce = function (x, action, advantage, lr) {
  var out = this.forward(x);
  var acts = this.lastActs;
  var L = this.W.length - 1;
  // softmax over outputs for a proper policy gradient
  var mx = Math.max.apply(null, out), exps = out.map(function (v) { return Math.exp(v - mx); });
  var sum = exps.reduce(function (a, b) { return a + b; }, 0);
  var gradOut = exps.map(function (e, i) { return (e / sum - (i === action ? 1 : 0)) * -advantage; });
  // tanh derivative chain, full backprop, single sample
  var delta = gradOut.map(function (g, i) { return g * (1 - out[i] * out[i]); });
  for (var l = L; l >= 0; l--) {
    var aPrev = acts[l];
    var newDelta = new Array(aPrev.length).fill(0);
    for (var o = 0; o < this.W[l].length; o++) {
      for (var i = 0; i < aPrev.length; i++) {
        newDelta[i] += this.W[l][o][i] * delta[o];
        this.W[l][o][i] -= lr * delta[o] * aPrev[i];
      }
      this.b[l][o] -= lr * delta[o];
    }
    if (l > 0) delta = newDelta.map(function (g, i) { return g * (1 - aPrev[i] * aPrev[i]); });
  }
};
GrowMLP.prototype.growNeuron = function (l, j) {
  // duplicate neuron j in layer l (0-based weight layer index l: sizes[l+1] neurons)
  var Wl = this.W[l];
  Wl.push(Wl[j].slice());
  this.b[l].push(this.b[l][j]);
  this.sizes[l + 1]++;
  if (l + 1 < this.W.length) {
    var Wn = this.W[l + 1];
    for (var o = 0; o < Wn.length; o++) {
      var half = Wn[o][j] / 2;
      Wn[o][j] = half;
      Wn[o].push(half);
    }
  }
};
GrowMLP.prototype.growLayer = function (l, k) {
  var before = this.paramCount();
  for (var n = 0; n < k; n++) {
    var j = (this.rng() * this.sizes[l + 1]) | 0;
    this.growNeuron(l, j);
  }
  return this.paramCount() - before;
};

/* ---------- trinity brain (the bot's mind) ---------- */
var ACTIONS = ['seek orb', 'seek food', 'explore', 'wander', 'rest', 'inspect', 'return center', 'retreat'];
var SENSE_DIM = 24;

function TrinityBrain(opts) {
  opts = opts || {};
  this.rng = opts.rng || mulberry32((Math.random() * 1e9) | 0);
  this.substrate = opts.substrate || probeSubstrate(opts.probeEnv);
  this.ceiling = this.substrate.ceilingParams;
  this.ghostCap = opts.ghostCap || this.substrate.ghostCap;
  this.moleculeCap = opts.moleculeCap || this.substrate.moleculeCap;
  this.net = new GrowMLP([SENSE_DIM, 16, 16, ACTIONS.length], this.rng);
  this.ghosts = [];        // sealed failed runs {seal, objective, acts, t, status}
  this.molecules = [];     // failed-ghost fragments {bias[8], mass, ox, oz}
  this.gravity = [];       // black hole points {x, z, strength}
  this.events = [];        // lifecycle event stream (drained by UI)
  this.log = [];           // thought log lines (capped)
  this.episodes = 0;
  this.returns = [];       // recent episode rewards (for plateau detection)
  this.valueBase = 0;      // EMA baseline
  this.predErrEMA = 0.5;
  this.lastOutcome = 0;
  this.failStreak = 0;
  this.episodesSinceGrowth = 0;
  this.growthEvents = 0;
  this.currentGhostAppeal = -1; // ghost index the current run is appealing
  this.trace = [];         // current run trace (for ghost sealing)
  this.think('I wake in the terrarium. Host: ' + this.substrate.profile +
    ' — budget ' + this.ceiling.toLocaleString() + ' params. No orders. I will look around.');
  this.events.push({ kind: 'substrate', msg: 'substrate probed: ' + this.substrate.profile +
    ', ' + this.substrate.cores + ' cores, ceiling ' + this.ceiling.toLocaleString() + ' params' });
}
TrinityBrain.prototype.think = function (line) {
  this.log.push(line);
  if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
};
TrinityBrain.prototype.moleculeBias = function () {
  var bias = new Array(ACTIONS.length).fill(0);
  for (var m = 0; m < this.molecules.length; m++) {
    var mol = this.molecules[m];
    for (var a = 0; a < ACTIONS.length; a++) bias[a] += mol.bias[a] * mol.mass;
  }
  return bias;
};
TrinityBrain.prototype.sense = function (s) {
  // s = world snapshot (see TerWorld.snapshot) → fixed 24-vector
  var v = new Array(SENSE_DIM).fill(0);
  v[0] = s.energy / 100;
  v[1] = s.charge / 100;
  v[2] = Math.sin(s.dayPhase * Math.PI * 2);
  v[3] = Math.cos(s.dayPhase * Math.PI * 2);
  v[4] = clamp(s.orbDist / s.arenaR, 0, 1);
  v[5] = Math.sin(s.orbBear || 0); v[6] = Math.cos(s.orbBear || 0);
  v[7] = clamp(s.foodDist / s.arenaR, 0, 1);
  v[8] = Math.sin(s.foodBear || 0); v[9] = Math.cos(s.foodBear || 0);
  v[10] = clamp(s.novelty, 0, 1);
  v[11] = s.inSludge ? 1 : 0;
  v[12] = s.inCurrent ? 1 : 0;
  v[13] = clamp(s.centerDist / s.arenaR, 0, 1);
  v[14] = Math.sin(s.heading); v[15] = Math.cos(s.heading);
  v[16] = s.speedFactor;
  v[17] = clamp(s.gravityPull, 0, 1);
  v[18] = Math.sin(s.gravityBear || 0); v[19] = Math.cos(s.gravityBear || 0);
  var mb = this.moleculeBias(), mm = 0;
  for (var i = 0; i < mb.length; i++) mm = Math.max(mm, Math.abs(mb[i]));
  v[20] = clamp(mm, 0, 1);
  v[21] = this.lastOutcome;
  v[22] = clamp(this.predErrEMA, 0, 1);
  v[23] = 1;
  return v;
};
TrinityBrain.prototype.decide = function (percept) {
  var out = this.net.forward(percept);
  var bias = this.moleculeBias();
  var scored = out.map(function (v, a) { return v + bias[a] * 0.35; });
  // drives: a starving bot leans to food; a drained one leans to orbs/rest.
  if (percept[0] < 0.18) { scored[1] += 0.9; if (this.log[this.log.length - 1] !== 'Energy low — finding food matters now.') this.think('Energy low — finding food matters now.'); }
  if (percept[1] < 0.15) scored[0] += 0.4;
  // mild exploration noise so behavior doesn't lock into one loop
  for (var a = 0; a < scored.length; a++) scored[a] += (this.rng() - 0.5) * 0.12;
  var best = 0;
  for (var i = 1; i < scored.length; i++) if (scored[i] > scored[best]) best = i;
  this.trace = [];
  // appeal bookkeeping: if a sealed ghost shares this objective, this run appeals it
  this.currentGhostAppeal = -1;
  for (var g = 0; g < this.ghosts.length; g++) {
    if (this.ghosts[g].status === 'sealed' && this.ghosts[g].objective === ACTIONS[best]) { this.currentGhostAppeal = g; break; }
  }
  return { action: best, name: ACTIONS[best], scores: scored };
};
TrinityBrain.prototype.noteStep = function (cellKey, action) {
  this.trace.push(cellKey + ':' + action);
  if (this.trace.length > 400) this.trace.shift();
};
TrinityBrain.prototype.learn = function (outcome) {
  // outcome: {success, reward, objective, percept, action, ox, oz, why}
  this.episodes++;
  this.episodesSinceGrowth++;
  var r = outcome.reward;
  var adv = r - this.valueBase;
  this.valueBase += 0.08 * adv;
  this.predErrEMA = 0.92 * this.predErrEMA + 0.08 * Math.min(1, Math.abs(adv));
  this.lastOutcome = outcome.success ? 1 : -1;
  if (outcome.percept && outcome.action !== undefined)
    this.net.reinforce(outcome.percept, outcome.action, clamp(adv, -1.5, 1.5), 0.05);
  this.returns.push(r);
  if (this.returns.length > 24) this.returns.shift();
  if (outcome.success) {
    this.failStreak = 0;
    if (this.currentGhostAppeal >= 0 && this.ghosts[this.currentGhostAppeal]) {
      this.ghosts[this.currentGhostAppeal].status = 'redeemed';
      this.events.push({ kind: 'appeal-won', msg: '⚖ appeal won — ghost ' + this.ghosts[this.currentGhostAppeal].seal + ' redeemed, kept in archive' });
      this.think('I retried "' + outcome.objective + '" and it worked. That ghost is redeemed.');
    }
    this.think('That worked ("' + outcome.objective + '"). Keeping the pattern.');
  } else {
    this.failStreak++;
    this._sealGhost(outcome);
  }
  this.currentGhostAppeal = -1;
  this._maybeCollapse();
  this._maybeGrow();
};
TrinityBrain.prototype._sealGhost = function (outcome) {
  var seal = fnv1a(this.trace.join('|') + '#' + outcome.objective + '#' + this.episodes);
  var ghost = { seal: seal, objective: outcome.objective, acts: this.trace.slice(0, 40), t: this.episodes, status: 'sealed', ox: outcome.ox || 0, oz: outcome.oz || 0, judgment: null, judgedBy: null };
  // was this run an appeal of an older ghost? then THAT ghost failed → molecules
  if (outcome.appealOf !== undefined && outcome.appealOf >= 0 && this.ghosts[outcome.appealOf]) {
    this._breakGhost(outcome.appealOf);
  }
  this.ghosts.push(ghost);
  this.events.push({ kind: 'ghost', msg: '👻 ghost sealed ' + seal + ' — failed run: "' + outcome.objective + '" (' + (outcome.why || 'no progress') + ')' });
  this.think('Run failed ("' + outcome.objective + '"). I seal it as ghost ' + seal + ' — the whole run, not just the end.');
  /* Hackathon Days 1–2: Meta API judge. Fire-and-forget — the seal above
   * already happened, so the judge can never block or break it. In Node
   * (tests) MetaJudge is undefined and this is skipped entirely. */
  try {
    if (typeof MetaJudge !== 'undefined' && MetaJudge && typeof MetaJudge.judgeGhost === 'function') {
      MetaJudge.judgeGhost(this, ghost, outcome);
    }
  } catch (e) { /* judge must never break the seal */ }
};
TrinityBrain.prototype._breakGhost = function (gi) {
  var g = this.ghosts[gi];
  if (!g || g.status === 'broken') return;
  g.status = 'broken';
  // fragments: bias AWAY from the actions the failed run leaned on
  var hist = new Array(ACTIONS.length).fill(0);
  for (var i = 0; i < g.acts.length; i++) { var a = parseInt(g.acts[i].split(':')[1], 10); if (a >= 0 && a < ACTIONS.length) hist[a]++; }
  var tot = Math.max(1, g.acts.length);
  for (var f = 0; f < 3; f++) {
    var bias = hist.map(function (h) { return -(h / tot) * 0.8 + (Math.random() - 0.5) * 0.1; });
    this.molecules.push({ bias: bias, mass: 0.5 + f * 0.2, ox: g.ox, oz: g.oz });
  }
  this.events.push({ kind: 'molecule', msg: '🧬 ghost ' + g.seal + ' FAILED its appeal → broke into 3 molecules (living bias fragments)' });
  this.think('Ghost ' + g.seal + ' could not come back. It breaks into molecules — I will lean away from how it thought.');
};
/* v81 — the Meta judge's verdict can now settle into the brain: when a
 * verdict names a blamed action + severity, the core mints ONE molecule
 * fragment from it — same mass ladder (0.5/0.7/0.9), same −0.8 bias depth,
 * same molecule cap and black-hole overflow as ghost fragments. The judge
 * is bounded by the exact rules every other fragment lives by. Only for
 * ghosts still sealed when the verdict lands; the seal never waits on it. */
TrinityBrain.prototype.addJudgeFragment = function (ghost, actionIdx, severity) {
  if (!ghost || ghost.status !== 'sealed') return null;
  var a = parseInt(actionIdx, 10), s = parseInt(severity, 10);
  if (!(a >= 0 && a < ACTIONS.length)) return null;
  if (!(s >= 1 && s <= 3)) s = 2;
  var bias = [];
  for (var i = 0; i < ACTIONS.length; i++) bias.push((i === a ? -0.8 : 0) + (Math.random() - 0.5) * 0.1);
  var mol = { bias: bias, mass: 0.5 + (s - 1) * 0.2, ox: ghost.ox || 0, oz: ghost.oz || 0, src: 'judge', seal: ghost.seal };
  this.molecules.push(mol);
  this.events.push({ kind: 'judge', msg: '⚖🧬 judge fragment minted from ghost ' + ghost.seal + ' — leans away from "' + ACTIONS[a] + '" (severity ' + s + '/3)' });
  this.think('The judge\'s verdict on ghost ' + ghost.seal + ' settles into a molecule — I lean away from "' + ACTIONS[a] + '" now.');
  this._maybeCollapse();
  return mol;
};
TrinityBrain.prototype._maybeCollapse = function () {
  var merged = 0;
  while (this.ghosts.length > this.ghostCap) {
    var g = this.ghosts.shift();
    this._addGravity(g.ox, g.oz, 0.6); merged++;
  }
  while (this.molecules.length > this.moleculeCap) {
    var m = this.molecules.shift();
    this._addGravity(m.ox, m.oz, 0.4); merged++;
  }
  if (merged) {
    this.events.push({ kind: 'blackhole', msg: '🕳 black hole: ' + merged + ' overflow record(s) merged into gravity (now ' + this.gravity.length + ' gravity well(s))' });
    this.think('Too many dead runs to hold. The black hole takes the overflow — their pull stays, their weight becomes gravity.');
  }
};
TrinityBrain.prototype._addGravity = function (x, z, s) {
  for (var i = 0; i < this.gravity.length; i++) {
    var g = this.gravity[i];
    if (Math.hypot(g.x - x, g.z - z) < 3) { g.strength = Math.min(2.5, g.strength + s); return; }
  }
  this.gravity.push({ x: x, z: z, strength: s });
};
TrinityBrain.prototype._maybeGrow = function () {
  if (this.net.paramCount() >= this.ceiling) return;
  if (this.episodesSinceGrowth < 8 || this.returns.length < 12) return;
  var recent = this.returns.slice(-8), prev = this.returns.slice(-16, -8);
  if (prev.length < 8) return;
  var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
  var sd = function (a, m) { return Math.sqrt(a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / a.length); };
  var mr = mean(recent), mp = mean(prev);
  var plateau = Math.abs(mr - mp) < 0.03 && sd(recent, mr) < 0.35;
  var stuck = this.failStreak >= 4;
  if (!plateau && !stuck) return;
  // grow the smaller hidden layer by 4 neurons (Net2Net — function preserved)
  var l = this.net.sizes[1] <= this.net.sizes[2] ? 0 : 1;
  var before = this.net.paramCount();
  var added = this.net.growLayer(l, 4);
  if (this.net.paramCount() > this.ceiling) { /* growth is capped by construction of small steps; note honestly */ }
  this.episodesSinceGrowth = 0;
  this.growthEvents++;
  this.events.push({ kind: 'growth', msg: '🌱 auto-expansion: hidden layer ' + (l + 1) + ' grew +4 neurons (' + before.toLocaleString() + ' → ' + this.net.paramCount().toLocaleString() + ' params, ceiling ' + this.ceiling.toLocaleString() + ') — Net2Net widening, function preserved' });
  this.think((stuck ? 'I keep failing the same way. ' : 'My results have plateaued. ') + 'Growing toward this host\'s ceiling: +' + added + ' params. Same mind, more room.');
};
TrinityBrain.prototype.status = function () {
  return {
    params: this.net.paramCount(), ceiling: this.ceiling,
    sizes: this.net.sizes.slice(),
    ghosts: this.ghosts.length, molecules: this.molecules.length,
    gravity: this.gravity.length, episodes: this.episodes,
    growthEvents: this.growthEvents, predErr: +this.predErrEMA.toFixed(3),
    profile: this.substrate.profile
  };
};
TrinityBrain.prototype.drainEvents = function () { var e = this.events; this.events = []; return e; };

/* ---------- terrarium world ---------- */
var WORLD_R = 16;
var MOD_KINDS = {
  tree:          { label: 'Tree',        emoji: '🌲' },
  pine:          { label: 'Pine',        emoji: '🎄' },
  rock:          { label: 'Rock',        emoji: '🪨' },
  orb:           { label: 'Glow orb',    emoji: '🔮' },
  food:          { label: 'Food',        emoji: '🍎' },
  crystal:       { label: 'Crystal',     emoji: '💎' },
  flower:        { label: 'Flowers',     emoji: '🌸' },
  wall:          { label: 'Wall block',  emoji: '🧱' },
  'zone-sludge': { label: 'Sludge zone', emoji: '🟤' },
  'zone-current':{ label: 'Current zone',emoji: '🌀' },
  'throw':       { label: 'Throw orb',   emoji: '🪀', ephemeral: true }
};
/* v68 — solid-body radius per prop kind for bot↔prop collision.
 * Zones are walkable (0). Flowers/food are small but solid. */
var PROP_RADIUS = {
  tree: 0.45, pine: 0.45, rock: 0.55, orb: 0.35, food: 0.25,
  crystal: 0.5, flower: 0.15, wall: 1.05, 'zone-sludge': 0, 'zone-current': 0
};
/* v68 — sandbox throwable physics constants (world units) */
var THROW = { gravity: 9.8, restitution: 0.55, airDrag: 0.12, groundFriction: 0.82, restSpeed: 0.35, maxAlive: 24 };
function groundH(x, z) {
  return Math.sin(x * 0.32) * Math.cos(z * 0.27) * 0.55 + Math.sin((x + z) * 0.13) * 0.4;
}
/* v69 -- pond geometry lives in core so physics (floating) and the
 * renderer share ONE definition of the water and the dipped ground. */
var POND = { x: -5.2, z: 4.2, r: 3.6, waterY: -0.12 };
function groundVis(x, z) {
  var h = groundH(x, z);
  var d = Math.hypot(x - POND.x, z - POND.z);
  if (d < POND.r + 1.6) {
    var t = Math.max(0, (d - (POND.r - 0.6)) / 2.2); // 0 deep in pond -> 1 at shore
    h = h * (0.25 + 0.75 * t) - (1 - t) * 0.5;
  }
  return h;
}
/* v69 -- locomotion / interaction physics constants */
var PHYS = {
  maxSpeed: 1.9, accel: 5.0, decel: 7.0, turnRate: 3.2,
  gravRange: 6.5, gravPropAccel: 2.4, gravPropMaxV: 2.8, gravBotMax: 0.5,
  propFriction: 3.2, ballRadius: 0.18, floatY: POND.waterY + 0.06
};
var LIGHT_KINDS = { orb: true, food: true };
function isLightProp(p) {
  if (!p) return false;
  if (LIGHT_KINDS[p.kind]) return true;
  if (p.kind === 'rock' && (p.scale || 1) < 1.0) return true; // small rocks only
  return false;
}
function defaultProps(rng) {
  var props = [], id = 1;
  function put(kind, x, z, extra) {
    var p = { id: 'p' + (id++), kind: kind, x: +x.toFixed(2), z: +z.toFixed(2), scale: 0.85 + rng() * 0.5 };
    if (extra) for (var k in extra) p[k] = extra[k];
    props.push(p);
  }
  var i, a, d;
  for (i = 0; i < 12; i++) { a = rng() * 6.283; d = 4 + rng() * 11; put(rng() < 0.5 ? 'tree' : 'pine', Math.cos(a) * d, Math.sin(a) * d); }
  for (i = 0; i < 6; i++) { a = rng() * 6.283; d = 3 + rng() * 12; put('rock', Math.cos(a) * d, Math.sin(a) * d); }
  for (i = 0; i < 8; i++) { a = rng() * 6.283; d = 2 + rng() * 13; put('flower', Math.cos(a) * d, Math.sin(a) * d); }
  for (i = 0; i < 3; i++) { a = rng() * 6.283; d = 5 + rng() * 9; put('orb', Math.cos(a) * d, Math.sin(a) * d); }
  for (i = 0; i < 4; i++) { a = rng() * 6.283; d = 3 + rng() * 11; put('food', Math.cos(a) * d, Math.sin(a) * d); }
  for (i = 0; i < 2; i++) { a = rng() * 6.283; d = 7 + rng() * 7; put('crystal', Math.cos(a) * d, Math.sin(a) * d); }
  put('zone-sludge', 6.5, -5.5, { radius: 3.2 });
  put('zone-current', -7, 5, { radius: 3.6, flow: 0.8 });
  return props;
}
function TerWorld(opts) {
  opts = opts || {};
  this.rng = opts.rng || mulberry32(1337);
  this.brain = opts.brain;
  this.props = opts.props || defaultProps(this.rng);
  this.time = 0;
  this.dayPhase = 0.32; // 0..1, starts mid-morning
  this.bot = { x: 0, z: 2, heading: 0, speed: 0, energy: 82, charge: 40, moving: false,
    vx: 0, vz: 0, tiltP: 0, tiltR: 0 };
  this.visits = {};     // "cx,cz" -> count (10x10 grid)
  this.run = null;      // active run {name, action, tx, tz, tLeft, lastDist, stuckT, percept, appealOf}
  this.decideAcc = 0;
  this.events = [];
  this.lastGoalText = 'waking up';
  this.throwables = [];  // v68: sandbox physics bodies {id,x,y,z,vx,vy,vz,rest,bounces,evBounce}
  this.throwSeq = 0;
}
/* v68 — spawn a throwable orb. y is height above the physics ground. */
TerWorld.prototype.spawnThrowable = function (x, y, z, vx, vy, vz) {
  while (this.throwables.length >= THROW.maxAlive) this.throwables.shift();
  var t = {
    id: 't' + (++this.throwSeq), x: x, y: y, z: z,
    vx: vx, vy: vy, vz: vz, rest: false, bounces: 0, evBounce: 0,
    spin: 0, spinAx: 1, spinAz: 0, floating: false, evSplash: 0,
    bobPh: (this.throwSeq * 1.71) % 6.283
  };
  this.throwables.push(t);
  return t;
};
/* v69 -- ballistic flight + terrain bounce + rolling spin + pond
 * float + light-prop knocks. Pure math, no DOM. */
TerWorld.prototype._knockProps = function (t) {
  var hs = Math.hypot(t.vx, t.vz);
  if (hs < 0.6) return;
  for (var i = 0; i < this.props.length; i++) {
    var p = this.props[i];
    if (!isLightProp(p)) continue;
    var pr = (PROP_RADIUS[p.kind] || 0.25) * (p.scale || 1);
    var dx = p.x - t.x, dz = p.z - t.z;
    var d = Math.hypot(dx, dz), min = PHYS.ballRadius + pr;
    if (d < min && d > 1e-6) {
      if (p.vx === undefined) { p.vx = 0; p.vz = 0; }
      p.vx += t.vx * 0.55 + (dx / d) * 0.5;
      p.vz += t.vz * 0.55 + (dz / d) * 0.5;
      t.vx *= 0.55; t.vz *= 0.55; // the ball pays for the hit
    }
  }
};
TerWorld.prototype.stepThrowables = function (dt) {
  for (var i = 0; i < this.throwables.length; i++) {
    var t = this.throwables[i];
    if (t.rest) continue;
    var pd = Math.hypot(t.x - POND.x, t.z - POND.z);
    var overWater = pd < POND.r && (groundVis(t.x, t.z) + PHYS.ballRadius < POND.waterY - 0.02);
    if (overWater && t.y <= POND.waterY + PHYS.ballRadius) {
      // -- water: splash on entry, then a damped spring to the float line --
      if (!t.floating) {
        t.floating = true;
        if (t.vy < -1.1) t.evSplash++;
        t.vy = 0; t.vx *= 0.35; t.vz *= 0.35;
      }
      t.vy += ((PHYS.floatY - t.y) * 26 - t.vy * 7) * dt;
      t.y += t.vy * dt;
      var wd = Math.max(0, 1 - 1.7 * dt);
      t.vx *= wd; t.vz *= wd;
      t.x += t.vx * dt; t.z += t.vz * dt;
      t.spin *= Math.max(0, 1 - 2 * dt);
      this._knockProps(t);
      if (Math.hypot(t.vx, t.vz) < 0.22 && Math.abs(t.y - PHYS.floatY) < 0.05 && Math.abs(t.vy) < 0.25) {
        t.vx = 0; t.vz = 0; t.vy = 0; t.y = PHYS.floatY; t.spin = 0; t.rest = true;
      }
      continue;
    }
    t.floating = false;
    t.vy -= THROW.gravity * dt;
    var drag = 1 - THROW.airDrag * dt;
    t.vx *= drag; t.vz *= drag;
    t.x += t.vx * dt; t.y += t.vy * dt; t.z += t.vz * dt;
    // world-edge bounce (dish wall)
    var rr = Math.hypot(t.x, t.z), wallR = WORLD_R - 0.4;
    if (rr > wallR) {
      var nx = t.x / rr, nz = t.z / rr;
      t.x = nx * wallR; t.z = nz * wallR;
      var vn = t.vx * nx + t.vz * nz;
      if (vn > 0) { t.vx -= (1 + THROW.restitution) * vn * nx; t.vz -= (1 + THROW.restitution) * vn * nz; }
    }
    this._knockProps(t);
    // terrain bounce
    var gy = groundH(t.x, t.z) + PHYS.ballRadius; // ball radius above physics ground
    if (t.y <= gy && t.vy < 0) {
      t.y = gy;
      t.vy = -t.vy * THROW.restitution;
      t.vx *= THROW.groundFriction; t.vz *= THROW.groundFriction;
      t.bounces++; t.evBounce++;
      if (Math.abs(t.vy) < 0.9) t.vy = 0;
    }
    // rolling with friction / spin
    var sp = Math.hypot(t.vx, t.vz);
    if (t.vy === 0 && t.y <= gy + 0.001) {
      t.vx *= (1 - 2.2 * dt); t.vz *= (1 - 2.2 * dt);
      if (sp > 0.05) { t.spin = sp / PHYS.ballRadius; t.spinAx = t.vz / sp; t.spinAz = -t.vx / sp; }
      else t.spin *= Math.max(0, 1 - 3 * dt);
      if (sp < THROW.restSpeed) { t.vx = 0; t.vz = 0; t.spin = 0; t.rest = true; }
    } else if (t.y > gy + 0.01) {
      t.spin *= Math.max(0, 1 - 0.15 * dt); // airborne spin persists, barely damped
    }
    if (t.y < -4) { t.rest = true; t.y = gy; } // safety net, never lose one under the world
  }
};
/* v69 -- black-hole gravity as a physical force. Capped hard: wells
 * tug loose props and lean on the bot, they can NEVER trap it (bot
 * accel is 10x the max pull) or slingshot anything. */
TerWorld.prototype._gravityAccel = function (x, z, forBot) {
  var ax = 0, az = 0;
  if (this.brain) for (var i = 0; i < this.brain.gravity.length; i++) {
    var g = this.brain.gravity[i];
    var dx = g.x - x, dz = g.z - z, d = Math.hypot(dx, dz);
    if (d < 0.7 || d > PHYS.gravRange) continue; // dead zone at the core: no jitter orbit
    var a = g.strength * 1.5 * (1 - d / PHYS.gravRange);
    if (forBot) a *= 0.34;
    ax += dx / d * a; az += dz / d * a;
  }
  var m = Math.hypot(ax, az), cap = forBot ? PHYS.gravBotMax : PHYS.gravPropAccel;
  if (m > cap) { ax *= cap / m; az *= cap / m; }
  return { ax: ax, az: az };
};
/* v69 -- loose light props: momentum, friction, gravity creep,
 * stop at solid props and the dish edge. */
TerWorld.prototype.stepProps = function (dt) {
  for (var i = 0; i < this.props.length; i++) {
    var p = this.props[i];
    if (!isLightProp(p)) continue;
    if (p.vx === undefined) { p.vx = 0; p.vz = 0; }
    if (p.vx === 0 && p.vz === 0 && !this._gravityAccel(p.x, p.z, false).ax && !this._gravityAccel(p.x, p.z, false).az) continue;
    var ga = this._gravityAccel(p.x, p.z, false);
    p.vx += ga.ax * dt; p.vz += ga.az * dt;
    var sp = Math.hypot(p.vx, p.vz);
    if (sp > PHYS.gravPropMaxV) { p.vx *= PHYS.gravPropMaxV / sp; p.vz *= PHYS.gravPropMaxV / sp; }
    p.x += p.vx * dt; p.z += p.vz * dt;
    var fr = Math.max(0, 1 - PHYS.propFriction * dt);
    p.vx *= fr; p.vz *= fr;
    if (Math.hypot(p.vx, p.vz) < 0.02) { p.vx = 0; p.vz = 0; }
    var rr = Math.hypot(p.x, p.z), maxR = WORLD_R - 0.6;
    if (rr > maxR) { p.x *= maxR / rr; p.z *= maxR / rr; p.vx = 0; p.vz = 0; }
    for (var j = 0; j < this.props.length; j++) {
      var q = this.props[j];
      if (q === p || isLightProp(q)) continue;
      var qr = (PROP_RADIUS[q.kind] || 0) * (q.scale || 1);
      if (!qr) continue;
      var pr = (PROP_RADIUS[p.kind] || 0.25) * (p.scale || 1);
      var dx = p.x - q.x, dz = p.z - q.z, min = qr + pr, d = Math.hypot(dx, dz);
      if (d < min && d > 1e-6) {
        p.x = q.x + dx / d * min; p.z = q.z + dz / d * min;
        var vn = p.vx * (dx / d) + p.vz * (dz / d);
        if (vn < 0) { p.vx -= vn * (dx / d); p.vz -= vn * (dz / d); }
      }
    }
    // the bot is solid too -- a creeping or knocked prop yields to it
    // (stepProps runs after bot collision in tick, so props must
    // resolve against the bot here or gravity creep can re-clip)
    var bo = this.bot;
    var bpr = (PROP_RADIUS[p.kind] || 0.25) * (p.scale || 1) + 0.30;
    var bdx = p.x - bo.x, bdz = p.z - bo.z, bd = Math.hypot(bdx, bdz);
    if (bd < bpr && bd > 1e-6) {
      p.x = bo.x + bdx / bd * bpr; p.z = bo.z + bdz / bd * bpr;
      var bvn = p.vx * (bdx / bd) + p.vz * (bdz / bd);
      if (bvn < 0) { p.vx -= bvn * (bdx / bd); p.vz -= bvn * (bdz / bd); }
    }
  }
};
/* v68 — keep the bot out of solid props. Returns true if a push happened.
 * Combined displacement: all overlapping props push at once along
 * their own normals, applied in one move — no sequential oscillation.
 * Repeated to convergence (max 12 passes; wedged-between-props
 * cases converge geometrically). */
TerWorld.prototype.resolvePropCollision = function () {
  var b = this.bot, pushed = false;
  for (var pass = 0; pass < 12; pass++) {
    var px = 0, pz = 0, any = false;
    for (var i = 0; i < this.props.length; i++) {
      var p = this.props[i];
      var pr = PROP_RADIUS[p.kind] || 0;
      if (!pr) continue;
      var dx = b.x - p.x, dz = b.z - p.z;
      var min = pr * (p.scale || 1) + 0.32; // bot body radius
      var d = Math.hypot(dx, dz);
      if (d < min) {
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        var overlap = min - d;
        var nx = dx / d, nz = dz / d;
        px += nx * overlap; pz += nz * overlap;
        any = true;
        if (pass === 0 && b.vx !== undefined) {
          var vn = b.vx * nx + b.vz * nz;
          if (vn < 0) {
            b.vx -= vn * nx; b.vz -= vn * nz; // collide-and-slide: keep the tangential part
            if (isLightProp(p) && -vn > 0.4) { // shove light props, momentum transfer
              if (p.vx === undefined) { p.vx = 0; p.vz = 0; }
              p.vx += -nx * (-vn * 0.85 + 0.2);
              p.vz += -nz * (-vn * 0.85 + 0.2);
            }
          }
        }
      }
    }
    if (!any) break;
    b.x += px; b.z += pz;
    pushed = true;
  }
  return pushed;
};
TerWorld.prototype.propById = function (id) {
  for (var i = 0; i < this.props.length; i++) if (this.props[i].id === id) return this.props[i];
  return null;
};
TerWorld.prototype.nearest = function (kind) {
  var best = null, bd = 1e9;
  for (var i = 0; i < this.props.length; i++) {
    var p = this.props[i];
    if (p.kind !== kind) continue;
    var d = Math.hypot(p.x - this.bot.x, p.z - this.bot.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { prop: best, dist: bd } : null;
};
TerWorld.prototype.zoneAt = function (x, z) {
  var sludge = false, current = null;
  for (var i = 0; i < this.props.length; i++) {
    var p = this.props[i];
    if (p.kind !== 'zone-sludge' && p.kind !== 'zone-current') continue;
    var r = p.radius || 3;
    if (Math.hypot(p.x - x, p.z - z) < r) {
      if (p.kind === 'zone-sludge') sludge = true; else current = p;
    }
  }
  return { sludge: sludge, current: current };
};
TerWorld.prototype.cellKey = function (x, z) {
  var c = 5 + Math.floor(((x + WORLD_R) / (2 * WORLD_R)) * 10);
  var d = 5 + Math.floor(((z + WORLD_R) / (2 * WORLD_R)) * 10);
  return clamp(c, 0, 9) + ',' + clamp(d, 0, 9);
};
TerWorld.prototype.noveltyHere = function () {
  var total = 0, k;
  for (k in this.visits) total += this.visits[k];
  var mine = this.visits[this.cellKey(this.bot.x, this.bot.z)] || 0;
  return total ? clamp(1 - (mine / total) * 6, 0, 1) : 1;
};
TerWorld.prototype.snapshot = function () {
  var b = this.bot;
  var orb = this.nearest('orb'), food = this.nearest('food');
  var zn = this.zoneAt(b.x, b.z);
  var grav = null, gd = 1e9;
  if (this.brain) for (var i = 0; i < this.brain.gravity.length; i++) {
    var g = this.brain.gravity[i], d = Math.hypot(g.x - b.x, g.z - b.z);
    if (d < gd) { gd = d; grav = g; }
  }
  return {
    energy: b.energy, charge: b.charge, dayPhase: this.dayPhase, arenaR: WORLD_R,
    orbDist: orb ? orb.dist : WORLD_R * 1.5, orbBear: orb ? Math.atan2(orb.prop.x - b.x, orb.prop.z - b.z) - b.heading : 0,
    foodDist: food ? food.dist : WORLD_R * 1.5, foodBear: food ? Math.atan2(food.prop.x - b.x, food.prop.z - b.z) - b.heading : 0,
    novelty: this.noveltyHere(), inSludge: zn.sludge, inCurrent: !!zn.current,
    centerDist: Math.hypot(b.x, b.z), heading: b.heading,
    speedFactor: zn.sludge ? 0.45 : 1,
    gravityPull: grav ? clamp(grav.strength * (1 - gd / (WORLD_R * 1.6)), 0, 1) : 0,
    gravityBear: grav ? Math.atan2(grav.x - b.x, grav.z - b.z) - b.heading : 0
  };
};
TerWorld.prototype._startRun = function () {
  var snap = this.snapshot();
  var percept = this.brain.sense(snap);
  var dec = this.brain.decide(percept);
  var b = this.bot, tx = b.x, tz = b.z, goal = dec.name;
  var appealOf = this.brain.currentGhostAppeal;
  if (dec.name === 'seek orb') { var o = this.nearest('orb'); if (o) { tx = o.prop.x; tz = o.prop.z; goal = 'reach the glowing orb'; } }
  else if (dec.name === 'seek food') { var f = this.nearest('food'); if (f) { tx = f.prop.x; tz = f.prop.z; goal = 'find food (energy ' + Math.round(b.energy) + '%)'; } }
  else if (dec.name === 'inspect') {
    var kinds = ['crystal', 'orb', 'rock', 'tree', 'flower'], best = null, bd = 1e9;
    for (var i = 0; i < this.props.length; i++) { var p = this.props[i]; if (kinds.indexOf(p.kind) < 0) continue; var d = Math.hypot(p.x - b.x, p.z - b.z); if (d < bd) { bd = d; best = p; } }
    if (best) { tx = best.x; tz = best.z; goal = 'inspect the ' + best.kind; }
  }
  else if (dec.name === 'explore') {
    // least-visited reachable cell, repelled by black-hole gravity wells
    var bestScore = -1e9, bc = null;
    for (var cx = 0; cx < 10; cx++) for (var cz = 0; cz < 10; cz++) {
      var wx = -WORLD_R + (cx + 0.5) * (2 * WORLD_R / 10), wz = -WORLD_R + (cz + 0.5) * (2 * WORLD_R / 10);
      if (Math.hypot(wx, wz) > WORLD_R - 1.5) continue;
      var vis = this.visits[cx + ',' + cz] || 0;
      var score = -vis * 2 - Math.hypot(wx - b.x, wz - b.z) * 0.06 + this.rng() * 0.7;
      if (this.brain) for (var gi = 0; gi < this.brain.gravity.length; gi++) {
        var gp = this.brain.gravity[gi];
        var gd2 = Math.hypot(gp.x - wx, gp.z - wz);
        if (gd2 < 4) score -= gp.strength * (4 - gd2) * 1.4; // gravity repels exploration
      }
      if (score > bestScore) { bestScore = score; bc = { x: wx, z: wz }; }
    }
    if (bc) { tx = bc.x; tz = bc.z; goal = 'explore unvisited ground'; }
  }
  else if (dec.name === 'wander') { var a = this.rng() * 6.283, dd = 3 + this.rng() * 8; tx = clamp(b.x + Math.cos(a) * dd, -WORLD_R + 1, WORLD_R - 1); tz = clamp(b.z + Math.sin(a) * dd, -WORLD_R + 1, WORLD_R - 1); goal = 'wander and see'; }
  else if (dec.name === 'return center') { tx = 0; tz = 0; goal = 'drift back to center'; }
  else if (dec.name === 'retreat') {
    var zn = this.zoneAt(b.x, b.z);
    var zx = zn.current ? zn.current.x : (zn.sludge ? 6.5 : 0), zz = zn.current ? zn.current.z : -5.5;
    tx = b.x + (b.x - zx) * 1.4; tz = b.z + (b.z - zz) * 1.4; goal = 'leave the bad ground';
  }
  else if (dec.name === 'rest') { tx = b.x; tz = b.z; goal = 'rest and recharge'; }
  this.run = { name: dec.name, action: dec.action, tx: tx, tz: tz, goalText: goal, tLeft: dec.name === 'rest' ? 3.5 : 16, lastDist: Math.hypot(tx - b.x, tz - b.z), stuckT: 0, percept: percept, appealOf: appealOf, restT: 0 };
  this.lastGoalText = goal;
  this.brain.think('Goal: ' + goal + '.');
};
TerWorld.prototype._finishRun = function (success, why) {
  var run = this.run; if (!run) return;
  var b = this.bot;
  var reward = 0, note = '';
  if (success) {
    if (run.name === 'seek orb') { b.charge = clamp(b.charge + 26, 0, 100); reward = 0.9; note = 'orb charge absorbed'; }
    else if (run.name === 'seek food') { b.energy = clamp(b.energy + 30, 0, 100); reward = 0.95; note = 'ate — energy restored'; }
    else if (run.name === 'inspect') { reward = 0.75; note = 'studied it up close'; }
    else if (run.name === 'explore') { reward = 0.55 + this.noveltyHere() * 0.3; note = 'new ground'; }
    else if (run.name === 'rest') { b.energy = clamp(b.energy + 14, 0, 100); reward = 0.5; note = 'rested'; }
    else { reward = 0.55; note = 'arrived'; }
    if (this.noveltyHere() > 0.6) reward += 0.15;
  } else {
    reward = -0.55;
  }
  this.brain.learn({ success: success, reward: reward, objective: run.name, percept: run.percept, action: run.action, ox: run.tx, oz: run.tz, why: why, appealOf: run.appealOf });
  this.events.push({ kind: success ? 'outcome' : 'fail', msg: (success ? '✓ ' : '✗ ') + run.goalText + ' — ' + (success ? note : (why || 'failed')) });
  this.run = null;
};
TerWorld.prototype.tick = function (dt) {
  this.time += dt;
  this.dayPhase = (this.dayPhase + dt / 240) % 1; // full day = 4 minutes
  var b = this.bot;
  if (!this.run) this._startRun();
  var run = this.run;
  if (!run) return;
  run.tLeft -= dt;
  var zn = this.zoneAt(b.x, b.z);
  var speedF = zn.sludge ? 0.45 : 1;
  if (run.name === 'rest') {
    var rDec = Math.max(0, 1 - PHYS.decel * dt);
    b.vx *= rDec; b.vz *= rDec;
    b.x += b.vx * dt; b.z += b.vz * dt;
    var znR = this.zoneAt(b.x, b.z);
    if (znR.current) { b.x += Math.sin(znR.current.flow || 0.8) * 0.55 * dt; b.z += Math.cos(znR.current.flow || 0.8) * 0.55 * dt; }
    b.speed = Math.hypot(b.vx, b.vz);
    b.moving = false;
    run.restT += dt;
    b.energy = clamp(b.energy + 5 * dt, 0, 100);
    if (run.restT >= 3.2) this._finishRun(true);
  } else {
    var dx = run.tx - b.x, dz = run.tz - b.z;
    var dist = Math.hypot(dx, dz);
    if (dist < 0.9) { this._finishRun(true); }
    else {
      // -- v69 locomotion: capped turn rate, accel/decel ramps,
      //    velocity steering (collision slide falls out of the
      //    velocity model), sludge drag, physical gravity tug --
      var targetH = Math.atan2(dx, dz);
      var dh = targetH - b.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      b.heading += clamp(dh, -PHYS.turnRate * dt, PHYS.turnRate * dt);
      var align = Math.max(0.22, Math.cos(dh)); // slow down for sharp turns
      var desSpd = PHYS.maxSpeed * speedF * align;
      var desVx = Math.sin(b.heading) * desSpd, desVz = Math.cos(b.heading) * desSpd;
      var dvx = desVx - b.vx, dvz = desVz - b.vz;
      var dv = Math.hypot(dvx, dvz);
      var maxDv = (desSpd > b.speed ? PHYS.accel : PHYS.decel) * dt;
      if (dv > maxDv && dv > 1e-6) { dvx *= maxDv / dv; dvz *= maxDv / dv; }
      b.vx += dvx; b.vz += dvz;
      if (zn.sludge) { var sdr = Math.max(0, 1 - 1.8 * dt); b.vx *= sdr; b.vz *= sdr; }
      var ga = this._gravityAccel(b.x, b.z, true);
      b.vx += ga.ax * dt; b.vz += ga.az * dt;
      b.x += b.vx * dt; b.z += b.vz * dt;
      var zn2 = this.zoneAt(b.x, b.z);
      if (zn2.current) { b.x += Math.sin(zn2.current.flow || 0.8) * 0.55 * dt; b.z += Math.cos(zn2.current.flow || 0.8) * 0.55 * dt; }
      var rr = Math.hypot(b.x, b.z);
      if (rr > WORLD_R - 0.5) { b.x *= (WORLD_R - 0.5) / rr; b.z *= (WORLD_R - 0.5) / rr; }
      b.speed = Math.hypot(b.vx, b.vz);
      b.moving = b.speed > 0.15;
      b.energy = clamp(b.energy - (zn.sludge ? 0.55 : 0.3) * dt, 0, 100);
      if (run.lastDist - dist < 0.04) run.stuckT += dt; else run.stuckT = 0;
      run.lastDist = dist;
      if (run.stuckT > 3) this._finishRun(false, 'stuck -- no progress');
      else if (run.tLeft <= 0) this._finishRun(false, 'gave up (timeout)');
    }
  }
  // v69 -- slope tilt from the physics ground, smoothed for the renderer
  var sAhead = groundH(b.x + Math.sin(b.heading) * 0.5, b.z + Math.cos(b.heading) * 0.5);
  var sBehind = groundH(b.x - Math.sin(b.heading) * 0.5, b.z - Math.cos(b.heading) * 0.5);
  var sRight = groundH(b.x + Math.cos(b.heading) * 0.5, b.z - Math.sin(b.heading) * 0.5);
  var sLeft = groundH(b.x - Math.cos(b.heading) * 0.5, b.z + Math.sin(b.heading) * 0.5);
  var tiltK = Math.min(1, 8 * dt);
  b.tiltP += (clamp(Math.atan2(sBehind - sAhead, 1.0), -0.3, 0.3) - b.tiltP) * tiltK;
  b.tiltR += (clamp(Math.atan2(sLeft - sRight, 1.0), -0.3, 0.3) - b.tiltR) * tiltK;
  var ck = this.cellKey(b.x, b.z);
  this.visits[ck] = (this.visits[ck] || 0) + dt;
  if (this.brain && run) this.brain.noteStep(ck, run.action);
  b.charge = clamp(b.charge - 0.12 * dt, 0, 100);
  if (b.energy <= 0) { b.energy = 4; this.events.push({ kind: 'fail', msg: '⚠ bot fully drained — emergency trickle charge' }); }
  // v68+v69 — sandbox physics pass
  if (this.resolvePropCollision() && typeof run.stuckT === 'number') run.stuckT = Math.max(0, run.stuckT - dt * 2); // don't punish detours
  this.stepProps(dt);
  this.stepThrowables(dt);
};
TerWorld.prototype.drainEvents = function () { var e = this.events; this.events = []; return e; };

/* ---------- mod store (spawn / remove / move / persist) ---------- */
function createModStore(storage, key) {
  key = key || 'nl-terrarium-mods-v1';
  var mem = null;
  function read() {
    try { var s = storage && storage.getItem(key); if (s) return s; } catch (e) {}
    return mem;
  }
  function write(s) { mem = s; try { if (storage) storage.setItem(key, s); } catch (e) {} }
  return {
    load: function (defaults) {
      var raw = read();
      if (raw) {
        try {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr)) return arr.filter(function (p) { return p && MOD_KINDS[p.kind] && isFinite(p.x) && isFinite(p.z); });
        } catch (e) {}
      }
      return JSON.parse(JSON.stringify(defaults));
    },
    save: function (props) { write(JSON.stringify(props)); },
    spawn: function (props, kind, x, z, rng) {
      if (!MOD_KINDS[kind]) return null;
      var n = 1; props.forEach(function (p) { var m = /^m(\d+)$/.exec(p.id); if (m) n = Math.max(n, parseInt(m[1], 10) + 1); });
      var p = { id: 'm' + n, kind: kind, x: +x.toFixed(2), z: +z.toFixed(2), scale: 0.9 + (rng ? rng() : Math.random()) * 0.4, modded: true };
      if (kind === 'zone-sludge') p.radius = 3.2;
      if (kind === 'zone-current') { p.radius = 3.6; p.flow = (rng ? rng() : Math.random()) * 6.28; }
      props.push(p);
      return p;
    },
    remove: function (props, id) {
      for (var i = 0; i < props.length; i++) if (props[i].id === id) { props.splice(i, 1); return true; }
      return false;
    },
    move: function (props, id, x, z) {
      for (var i = 0; i < props.length; i++) if (props[i].id === id) { props[i].x = +x.toFixed(2); props[i].z = +z.toFixed(2); return true; }
      return false;
    },
    clear: function () { write(null); }
  };
}

/* ---------- gamepad mapping (standard HID layout) ----------
 * Returns normalized intents; edge detection via state.prev[]. */
function mapPad(gp, state) {
  state = state || { prev: [] };
  var dz = function (v) { return Math.abs(v || 0) < 0.18 ? 0 : (v || 0); };
  var axes = gp.axes || [], btns = gp.buttons || [];
  function held(i) { return !!(btns[i] && btns[i].pressed); }
  function just(i) { var h = held(i), was = !!state.prev[i]; state.prev[i] = h; return h && !was; }
  var out = {
    connected: !!gp.connected,
    pan: { x: dz(axes[0]), y: dz(axes[1]) },       // left stick: move camera focus
    orbit: { x: dz(axes[2]), y: dz(axes[3]) },     // right stick: orbit camera
    zoom: ((btns[5] && btns[5].value) || 0) - ((btns[4] && btns[4].value) || 0), // RB - LB
    justPressed: {
      interact: just(0),   // A — focus/select bot
      brain: just(1),      // B — brain view
      thoughts: just(2),   // X — thoughts panel
      mod: just(3) || just(9) // Y or Start — mod menu
    },
    held: { a: held(0) }
  };
  // keep prev[] fresh for buttons we didn't sample via just()
  for (var i = 0; i < btns.length; i++) if (state.prev[i] === undefined) state.prev[i] = held(i);
  return out;
}

return {
  mulberry32: mulberry32, fnv1a: fnv1a, clamp: clamp,
  benchmarkOps: benchmarkOps, probeSubstrate: probeSubstrate,
  GrowMLP: GrowMLP, TrinityBrain: TrinityBrain, TerWorld: TerWorld,
  ACTIONS: ACTIONS, SENSE_DIM: SENSE_DIM, WORLD_R: WORLD_R,
  MOD_KINDS: MOD_KINDS, defaultProps: defaultProps, groundH: groundH,
  PROP_RADIUS: PROP_RADIUS, THROW: THROW,
  POND: POND, groundVis: groundVis, PHYS: PHYS, isLightProp: isLightProp,
  createModStore: createModStore, mapPad: mapPad
};
})();
if (typeof window !== 'undefined') window.NL_TERCORE = NL_TERCORE;
if (typeof module !== 'undefined' && module.exports) module.exports = NL_TERCORE;
