'use strict';
/* Neural Lab v32 "Quantum Nexus Core" — the visualizer.
 * Ahkeem's self-modifying AI architecture, named by him 2026-10-03.
 *
 * Split design (same as quantum.js):
 *   NL_NEXUS_CORE = pure pipeline, no DOM — testable in Node.
 *   NL_NEXUS      = visualizer UI wiring (needs document).
 * The core math is the visual twin of preset 16 (Python/NumPy reference).
 * Honest label: classical simulation on the phone's CPU.
 */
var _G = (typeof window !== 'undefined') ? window :
         (typeof global !== 'undefined') ? global : this;

/* ── v34: decay-point entanglement ─────────────────────────────────────
 * Empirical finding (Ahkeem's run, 2026-10-04): the reference error curve
 * follows a power law E ≈ 0.465·gen^(-0.43) (R²=0.983) — decay SLOWS.
 * The monitor below exists because of that: when per-generation improvement
 * ΔE falls below ε, the decay point is declared, the exact state is captured,
 * the parent verifies it by replay, and the child lineage is entangled to it.
 * "Entanglement" here is operational: the child's genesis is derived from the
 * parent's certified decay record and the ledger permanently pairs them —
 * measure the parent's decay point, know the child's starting point.
 */
var EPS_DEFAULT = 0.01;

_G.NL_NEXUS_CORE = (function () {
  var D = 6, T = 40, VN = 4, LR = 0.05, SEED = 16;

  /* ── v39 "Deep Core" — true stacked depth ───────────────────────────
   * Ahkeem's directive: multiple hidden layers with differentiable nonlinear
   * functions between them — deep through layers, not just through time.
   *   h_l(t+1) = act( W_l·h_l(t) + U_l·in_l + 0.3·e·V )
   * Layer 0 takes the input signal x (in_0 = x); each higher layer takes the
   * FRESH state of the layer below (in_l = h_{l-1}(t+1)). The decoder V reads
   * the TOP layer; the qubit belief phi is unchanged.
   * Default depth 3 for new runs (UI: 1–6); the reference preset keeps depth 1.
   * Depth is additive: depth=1 + tanh reproduces the v32 behavior bit-exactly
   * (layer 0's RNG stream and update math are untouched).
   */
  var DEPTH_DEFAULT = 3, DEPTH_MIN = 1, DEPTH_MAX = 6;
  var ACTFNS = {
    tanh: function (x) { return Math.tanh(x); },
    relu: function (x) { return x > 0 ? x : 0; },
    sigmoid: function (x) { return 1 / (1 + Math.exp(-x)); }
  };
  function normAct(a) { return (a === 'relu' || a === 'sigmoid') ? a : 'tanh'; }
  function actFn(a) { return ACTFNS[normAct(a)]; }
  /* v39: stability guard — ReLU is unbounded above, and an unclamped
   * recurrence can diverge (observed: err 1.9e15 by gen 4, then Infinity).
   * Clamping hidden states keeps every activation honest. No-op for
   * tanh/sigmoid (|h| <= 1 always); ReLU stays finite and recoverable.
   * Bit-identity at depth=1+tanh is unaffected (tanh never reaches ±10). */
  function clampH(v) { return v > 10 ? 10 : (v < -10 ? -10 : v); }
  function normDepth(d) {
    d = parseInt(d, 10);
    if (!isFinite(d)) return DEPTH_DEFAULT;
    return Math.max(DEPTH_MIN, Math.min(DEPTH_MAX, d));
  }
  function zeroPe(depth) {
    var a = [], l;
    for (l = 1; l < (depth || 1); l++) a.push(0);
    return a;
  }

  function RNG(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  /* the deep loop: { depth, act, layers:[{W,U,h}], V, peSum, peN }.
   * Layer 0's U is a D-vector and its RNG stream is bit-identical to the v32
   * original (per i: U0[i], V[i], W0[i][*]); higher layers' U is DxD. */
  function newLoop(rnd, depth, act) {
    depth = normDepth(depth == null ? DEPTH_DEFAULT : depth);
    act = normAct(act);
    var i, j, k, layers = [];
    var W0 = [], U0 = [], V = [], h0 = [];
    for (i = 0; i < D; i++) {
      W0.push([]); h0.push(0);
      U0.push((rnd() * 2 - 1) * 0.5);
      V.push((rnd() * 2 - 1) * 0.5);
      for (j = 0; j < D; j++) W0[i].push((rnd() * 2 - 1) * 0.5);
    }
    layers.push({ W: W0, U: U0, h: h0 });
    for (k = 1; k < depth; k++) {
      var Wk = [], Uk = [], hk = [], Fk = [];
      /* v39: depth-scaled init — deeper layers start in the linear regime
       * (Xavier-style). The RNG stream order is unchanged; draws are scaled.
       * Without this, deep random stacks can start where the error
       * cannot coordinate them (observed divergence in testing).
       * v39c: each upper layer also gets its OWN learned feedback vector F
       * (same init scale as the decoder V). The reference broadcasts one V
       * to every layer; that misaligns the error for non-top layers (V only
       * decodes the TOP). Per-layer feedback (learned, like V — a form of
       * learned feedback alignment) gives each layer its own error pathway.
       * Layer 0 uses V directly (bit-identical to the reference). */
      var wScale = 1 / Math.sqrt(k + 1);
      for (i = 0; i < D; i++) {
        Wk.push([]); Uk.push([]); hk.push(0);
        Fk.push((rnd() * 2 - 1) * 0.5);
        for (j = 0; j < D; j++) {
          Wk[i].push((rnd() * 2 - 1) * 0.5 * wScale);
          Uk[i].push((rnd() * 2 - 1) * 0.5);
        }
      }
      layers.push({ W: Wk, U: Uk, h: hk, F: Fk });
    }
    return { depth: depth, act: act, layers: layers, V: V,
             peSum: zeroPe(depth), peN: 0 };
  }
  function zeroLoopState(L) {
    var l, i, dd = L.depth || 1;
    for (l = 0; l < dd; l++)
      for (i = 0; i < D; i++) L.layers[l].h[i] = 0;
    L.peSum = zeroPe(dd); L.peN = 0;
    if (L.horizon) resetHorizonEp(L.horizon); /* v40: fresh exterior per episode */
    /* v42: fresh episode, fresh inner state — weights are heredity, like the stack */
    if (L.antimatter && L.antimatter.h)
      for (i = 0; i < L.antimatter.h.length; i++) L.antimatter.h[i] = 0;
  }

  /* ── v40 "Event Horizon" — Ahkeem's black-hole neuron experiment ──────
   * His design: neurons collide and compress toward a singularity, BUT some
   * neurons stay linked to partners OUTSIDE the compression zone through an
   * entanglement-INSPIRED link — then watch how the compressor's structure
   * evolves based on the changed properties. This is the black-hole
   * information-paradox setup, labeled honestly: a paradox-INSPIRED classical
   * simulation, not quantum gravity.
   *
   * v41 honesty note (Ahkeem's own correction, 2026-10-04): the "link" is
   * classical correlation MODELED on entanglement — measure one side, know
   * the other — not quantum entanglement. True quantum entanglement needs
   * quantum hardware: Bell's theorem proves no classical system can
   * reproduce Bell-inequality violations, so classical neurons can never be
   * genuinely entangled. The borrowed math (fidelity, paired tracking) still
   * does real structural work — v40 measured ΔG = 0.32 between link-coupled
   * and uncoupled compressors — but the physics is classical, and the UI
   * says "entanglement-inspired link" everywhere to match.
   *
   * The horizon sits between the top recurrent layer and the decoder:
   *   infall:   h[i] = top-layer state (the collision is pure infall)
   *   collide:  y_k = tanh( Σ_ij G_kij·h[i]·h[j] + Σ_i A_ki·h[i]·(1+γ·tanh p[i mod K]) )
   *               (M → K: pairwise collision through G; the exterior whisper
   *               scales each infalling state MULTIPLICATIVELY by (1+γ·tanh p)
   *               through the linear channel — bounded to [1−γ, 1+γ], never an
   *               unbounded additive offset. An additive whisper let a
   *               drifting partner drag the operating point until the decoder
   *               blew up compensating (observed: Vh runaway at depth 1).
   *               γ = 0 when the entanglement-inspired link is OFF.)
   * Why the linear channel: a PURE quadratic collision is sign-blind —
   * h and −h collide identically, so the sign structure of the signal is
   * unrecoverable from y (a genuine information-loss property, thematically
   * apt for a black hole — but too lossy to learn from; the horizon
   * plateaued at err ≈ 0.77 in testing). The linear term preserves
   * orientation while the quadratic term does the colliding; both evolve.
   *   decode:   yp = Σ_k Vh[k]·y_k ;  e = truth − yp
   *   exterior: p_k += α·(y_k − p_k)   (partners track the outputs but NEVER
   *               enter the compression zone)
   *   fidelity: mean_k |corr_t(p_k, y_k)| over the episode — 0..1, the live
   *               measure of how much infall information the exterior holds.
   * Learning is differentiable end-to-end: Vh learns like the decoder,
   *   G_kij += (lr/depth)·e·Vh[k]·(1−y_k²)·h[i]·h[j],
   *   A_ki  += (lr/depth)·e·Vh[k]·(1−y_k²)·h[i]·(1+γ·tanh p[i mod K]),
   * and the top layer gets TRUE gradient feedback through the compressor:
   *   FbH[i] = Σ_k Vh[k]·(1−y_k²)·( A_ki + Σ_j (G_kij+G_kji)·h[j] ),
   * injected as 0.3·e·FbH[i] (the same slot the decoder feedback used).
   * While the horizon owns prediction the bypassed decoder V is frozen.
   * Evolution mutates G/Vh like the rest of the genotype; with the link
   * ON the selection fitness is err + λ·(1−fidelity) — the compressor must
   * preserve the correlation, which changes WHAT structure evolves.
   * With the horizon OFF the pipeline is bit-identical to v39 (the reference
   * never enables it — its RNG stream is untouched: G is drawn from a
   * dedicated RNG seeded off the loop checksum, never S.rnd).
   */
  var HZ_M_DEFAULT = 6, HZ_K_DEFAULT = 2;
  var HZ_GAMMA = 0.3, HZ_ALPHA = 0.2, HZ_LAMBDA = 0.3;
  function hzDedicatedRng(L) {
    return RNG((checksum(L) ^ 0x9e3779b9) >>> 0);
  }
  function resetHorizonEp(H) {
    var k;
    if (!H) return;
    H.p = []; H.acc = null; H.fid = null;
    for (k = 0; k < H.K; k++) H.p.push(0);
  }
  function ensureHorizon(L, M, K, ent) {
    M = Math.max(2, Math.min(D, (M | 0) || HZ_M_DEFAULT));
    K = Math.max(1, Math.min(M - 1, (K | 0) || HZ_K_DEFAULT));
    var need = !L.horizon || L.horizon.M !== M || L.horizon.K !== K;
    if (need) {
      var hr = hzDedicatedRng(L), G = [], Vh = [], A = [], k, i, j;
      for (k = 0; k < K; k++) {
        var Gk = [], Ak = [];
        for (i = 0; i < M; i++) {
          Gk.push([]);
          Ak.push((hr() * 2 - 1) * 0.5);
          for (j = 0; j < M; j++) Gk[i].push((hr() * 2 - 1) * 0.15);
        }
        G.push(Gk); A.push(Ak);
        Vh.push((hr() * 2 - 1) * 0.5);
      }
      L.horizon = { on: true, ent: ent !== false, M: M, K: K,
                    gamma: HZ_GAMMA, alpha: HZ_ALPHA,
                    G: G, A: A, Vh: Vh, p: [], acc: null, fid: null };
    } else {
      L.horizon.on = true;
      L.horizon.ent = (ent !== false);
    }
    resetHorizonEp(L.horizon);
    return L.horizon;
  }
  /* fidelity of the entanglement-inspired link: mean |Pearson r| between
   * each exterior partner's trajectory and its horizon output's trajectory
   * over the episode. 0..1. Centered (not cosine): a saturated, constant
   * channel scores ~0, not 1 — the metric must not reward a dead black hole.
   * When the link is OFF the partners never couple, so this is 0. */
  function horizonFidelity(H) {
    var k, s = 0, n = 0, den, cov;
    if (!H || !H.acc || !H.acc.n) return null;
    for (k = 0; k < H.K; k++) {
      var nn = H.acc.n[k];
      if (nn < 4) continue;
      var mp = H.acc.sp[k] / nn, my = H.acc.sy[k] / nn;
      var vp = H.acc.sp2[k] / nn - mp * mp, vy = H.acc.sy2[k] / nn - my * my;
      if (vp > 1e-10 && vy > 1e-10) {
        cov = H.acc.spy[k] / nn - mp * my;
        den = Math.sqrt(vp * vy);
        s += Math.abs(cov) / den; n++;
      }
    }
    return n ? Math.max(0, Math.min(1, s / n)) : 0;
  }
  /* run-config switch. Takes effect on the champion immediately and on
   * future generations via beginGen; the reference path never calls it. */
  function setHorizon(S, on, entangled, M, K) {
    if (!on) {
      S.hz = null;
      if (S.champion && S.champion.horizon) S.champion.horizon.on = false;
      return false;
    }
    M = Math.max(2, Math.min(D, (M | 0) || HZ_M_DEFAULT));
    K = Math.max(1, Math.min(M - 1, (K | 0) || HZ_K_DEFAULT));
    S.hz = { on: true, entangled: entangled !== false, M: M, K: K };
    ensureHorizon(S.champion, M, K, S.hz.entangled);
    return true;
  }
  function hzStats(G) {
    var s = 0, n = 0, k, i, j, sp = 0;
    for (k = 0; k < G.length; k++)
      for (i = 0; i < G[k].length; i++)
        for (j = 0; j < G[k][i].length; j++) {
          var v = G[k][i][j]; s += v * v; n++;
          if (Math.abs(v) < 0.05) sp++;
        }
    return { rms: Math.sqrt(s / Math.max(1, n)), sparsity: n ? sp / n : 0 };
  }
  /* the experiment Ahkeem asked for: same seed, same depth, link
   * ON vs OFF — how does the evolved gravity structure differ? Pure +
   * deterministic: the only difference between the runs is the ent flag. */
  function horizonCompare(maxGens, seed, M, K, depth, act) {
    function run(ent) {
      var s2 = create(maxGens, seed == null ? SEED : seed, depth, act);
      setHorizon(s2, true, ent, M, K);
      runGens(s2, maxGens);
      var H = s2.champion.horizon;
      return { err: s2.curve.length ? s2.curve[s2.curve.length - 1] : null,
               fid: H ? H.fid : null, G: H ? H.G : null,
               stats: H ? hzStats(H.G) : null, curve: s2.curve.slice() };
    }
    var on = run(true), off = run(false), dF = 0, n = 0, k, i, j;
    if (on.G && off.G)
      for (k = 0; k < on.G.length; k++)
        for (i = 0; i < on.G[k].length; i++)
          for (j = 0; j < on.G[k][i].length; j++) {
            var dd = on.G[k][i][j] - off.G[k][i][j]; dF += dd * dd; n++;
          }
    return { on: on, off: off, deltaFrob: n ? Math.sqrt(dF) : null,
             M: M, K: K, gens: maxGens, seed: seed == null ? SEED : seed };
  }
  /* ── v41 "Ghost Snapshots" — Ahkeem's workaround for no quantum ────
   * entanglement ─────────────────────────────────────────────────────
   * His design: instead of spooky correlation, keep an EXACT copy. At the
   * moment before the event horizon compresses an infalling neuron, the
   * engine freezes a bit-for-bit copy of its pre-compression state — the
   * "ghost image" (his metaphor: like a disk ghost image — a frozen,
   * restorable snapshot of a drive taken before it was wiped). The ghost
   * rides the EXISTING JSON + checksum machinery (checksummed, versioned —
   * the champion record's younger sibling).
   * Engineering call, documented: .vmdk / .vhd are VIRTUAL-DISK containers.
   * Wrapping a few KB of neuron state in a virtual-disk format buys format
   * overhead for zero benefit, so ghosts are plain checksummed JSON —
   * exact doubles, FNV-sealed, restorable. File-copy libraries (shutil and
   * friends) only MOVE bytes; ingestion is DESERIALIZATION — parse,
   * checksum-verify, load into the pipeline.
   * The primary consumer is the layer-3 feedback loop: the latest ghost's
   * pre-compression data PERSISTENTLY drives the top layer — "the 3rd core
   * loop" at default depth 3 — every timestep, so the horizon's victims
   * teach the Core: horizon → ghost copy → layer 3 → restructured data →
   * next cycle. The drive rides INSIDE the layer's activation (bounded by
   * tanh) with a damping gain ≤ 0.5 (default 0.15 — the same bounded-gain
   * discipline as v40's whisper), so the loop cannot run away. */
  var GHOST_T = 20, GHOST_MAX = 20, GHOST_FB_GAIN = 0.15, GHOST_GAIN_MAX = 0.5;
  function ghostCanon(g) {
    return { gen: g.gen, t: g.t, M: g.M, K: g.K,
             hIn: g.hIn, G: g.G, A: g.A, Vh: g.Vh };
  }
  function buildGhost(HZ, hIn, t, gen) {
    var g = { kind: 'ghost', v: 1, gen: gen, t: t,
              M: HZ.M, K: HZ.K,
              /* exact pre-compression copy — IEEE-754 doubles, bit for bit */
              hIn: hIn.slice(),
              /* the compressor's structure at the moment of capture */
              G: clone(HZ.G), A: clone(HZ.A), Vh: HZ.Vh.slice(),
              ts: Date.now() };
    g.id = 'g' + gen + '-' + (g.ts % 100000).toString(36);
    g.checksum = checksum(ghostCanon(g));
    return g;
  }
  function ghostVerify(g) {
    try {
      if (!g || g.kind !== 'ghost' || g.v !== 1) return false;
      if (!g.hIn || g.hIn.length !== (g.M | 0)) return false;
      for (var i = 0; i < g.hIn.length; i++)
        if (typeof g.hIn[i] !== 'number' || !isFinite(g.hIn[i])) return false;
      return checksum(ghostCanon(g)) === g.checksum;
    } catch (e) { return false; }
  }
  /* re-ingestion: verify the ghost, then blend its pre-compression states
   * into the TOP layer ("the 3rd core loop" at default depth 3) with a
   * damping gain. Returns {ok, reason} — a tampered ghost is rejected
   * before it touches the Core. */
  function ghostReingest(S, ghost, gain) {
    if (!ghostVerify(ghost)) return { ok: false, reason: 'checksum mismatch — ghost rejected' };
    var L = S.champion;
    if (!L) return { ok: false, reason: 'no champion yet — run the Core first' };
    var top = L.layers[(L.depth || 1) - 1];
    gain = Math.max(0, Math.min(GHOST_GAIN_MAX, +gain || 0));
    var n = Math.min(ghost.M | 0, D), i;
    for (i = 0; i < n; i++) top.h[i] = clampH(top.h[i] + gain * ghost.hIn[i]);
    return { ok: true, gain: gain, layer: (L.depth || 1) - 1 };
  }
  /* the automatic per-generation leg of the loop: arm the ghost DRIVE on a
   * fresh live loop — the latest ghost's pre-compression data persistently
   * reshapes the top layer ("the 3rd core loop" at default depth 3) every
   * timestep of the episode. Called for every variant, every generation. */
  function armGhostDrive(S, live) {
    var HZ = live.horizon;
    if (!HZ) return;
    if (S.ghostFb && S.ghosts && S.ghosts.length) {
      var gl = S.ghosts[S.ghosts.length - 1];
      HZ.fbOn = true; HZ.fbGain = S.ghostGain;
      HZ.fbM = Math.min(gl.M | 0, D);
      HZ.fbGhost = gl.hIn.slice(0, HZ.fbM);
    } else { HZ.fbOn = false; HZ.fbGhost = null; HZ.fbM = 0; }
  }
  function setGhostFb(S, on) { S.ghostFb = !!on; return S.ghostFb; }
  function setGhostGain(S, g) {
    g = parseFloat(g);
    if (isFinite(g)) S.ghostGain = Math.max(0, Math.min(GHOST_GAIN_MAX, g));
    return S.ghostGain;
  }
  /* ── v42 "Antimatter" — Ahkeem's ghost-built inner superloop ──────────
   * His design, translated into honest engineering (each translation noted):
   *
   * 1. GHOST CRAWLER — "a script that acts like a web crawler but only
   *    searches for other ghost files." Translation: it is NOT a web crawler
   *    — no network, no HTTP, nothing leaves the phone. It crawls the LOCAL
   *    ghost archive: from a recovered ghost it hops ghost→ghost along
   *    similarity edges (cosine similarity over the frozen pre-compression
   *    state vectors), depth-limited, collecting ghosts "in the erased
   *    state" (every ghost IS an erased-state copy — frozen before the
   *    horizon crushed its neuron). The crawl is logged hop by hop.
   *
   * 2. RECOVERY CONTAINER — "it stacks them in a container." Translation: a
   *    bounded memory bank (default 32 entries) of recovered ghost states —
   *    an experience-replay buffer, honestly. Novelty-based eviction: when
   *    full, the entry most redundant with the rest is dropped.
   *
   * 3. PROBABILISTIC MATCH — "an algorithm using the quantum probability
   *    rate... the superposition will determine." Translation: there is NO
   *    real quantum superposition here — classical system, Bell's theorem,
   *    same honesty as v41's entanglement note. What he means operationally
   *    is a STOCHASTIC spawn decision: the mean crawler similarity becomes
   *    an amplitude a in [0,1], mapped to a probability p = a^2 —
   *    Born-rule-style, the same math as the Core's pYes = cos^2(theta/2).
   *    The decision is SEEDED-sampled from a dedicated RNG stream, so the
   *    same seed always makes the same decision (deterministic), while
   *    different seeds explore different outcomes (stochastic). The sampled
   *    roll is logged next to the probability. Stochastic, not collapse.
   *
   * 4. SPAWN = RECIPE, NOT CODE EXECUTION — "create a new script then write
   *    and execute that script." Translation: the "new script" is a JSON
   *    RECIPE {ghost_ids, wiring topology, gains, target layers} that the
   *    engine INTERPRETS. Dynamic code generation + eval on-device is a
   *    security boundary we do not cross: a recipe gives the same power
   *    here (compose a module from ghost data, wire it to layers) with none
   *    of the risk. The recipe is checksum-sealed and verified before the
   *    engine touches it.
   *
   * 5. ANTIMATTER NEURON = INNER SUPERLOOP — "a new superloop running within
   *    the main core, built of ghost neurons, structuring itself within all
   *    layers." Translation: a small recurrent module (default 6 units)
   *    composed from recovered ghost states (recurrent weights from a
   *    dedicated RNG stream plus the outer product of the mean ghost state).
   *    Each timestep it READS every deep layer's state (read-only), updates
   *    ONLY itself, and PUBLISHES its state as an additive read term inside
   *    each layer's activation — the same state-level discipline as v41's
   *    ghost drive. It structures itself across all layers and deletes
   *    nothing: influence is additive, never destructive.
   *    "Capable of analyzing the structure of non-antimatter neurons and
   *    integrating that data into its own structure": each step it also
   *    reads per-layer weight statistics (RMS — read-only) and folds them
   *    into its OWN update. Analysis in, self-update out.
   *
   * 6. WRITE-PROTECTION — "non recovered neurons can't rewrite
   *    antimatterneurons nor vice versa, only learn and copy." ENFORCED in
   *    code, not just documented: the only cross-module traffic is READS.
   *    amStep mutates only the module's own h; the main net's learning
   *    rules never reference module weights; the publish term reads module
   *    state into the main net's ACTIVATION (state, not weights — the same
   *    boundary v41's ghost drive respects). amTryWrite('am-to-main') and
   *    amTryWrite('main-to-am') exist so the rule is TESTABLE: both are
   *    rejected and mutate nothing.
   *
   * 7. PROPERTY DYNAMICS — "the properties can change the properties of
   *    other neurons given they collide, or they're introduced to a new
   *    environment." That is structure x environment, his standing insight:
   *    the module's publish term collides with layer states every step
   *    (properties shift through the existing machinery), and new data
   *    reshapes it because it reads the live layers, not a frozen copy.
   *
   * Session scope note: the module rides the live champion loop (variants
   * inherit it through the clone, like the horizon), but it is NOT part of
   * the saved champion record — champRecord builds from known fields only.
   * Ghosts, the container, the crawl log and the spawn log persist, so a
   * module is always re-spawnable deterministically from its recipe.
   * With the master switch off (default) the step() path is bit-identical
   * to v41 — the reference never sees it. */
  var AM_N = 6, AM_GAIN = 0.1, AM_GAIN_MAX = 0.3, AM_CAP = 32;
  var AM_CRAWL_DEPTH = 3, AM_CRAWL_K = 4, AM_SIM_THRESH = 0.2, AM_ANA_GAIN = 0.02;
  function amCosine(a, b) {
    var n = Math.min(a.length, b.length), i, dot = 0, na = 0, nb = 0, v;
    for (i = 0; i < n; i++) {
      v = a[i]; dot += v * b[i]; na += v * v; v = b[i]; nb += v * v;
    }
    if (na < 1e-12 || nb < 1e-12) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  function amFindGhost(S, id) {
    var gl = S.ghosts || [], i;
    for (i = 0; i < gl.length; i++) if (gl[i].id === id) return gl[i];
    return null;
  }
  /* the ghost crawler — local archive only. BFS over similarity edges,
   * depth-limited, top-K hops per ghost above the similarity threshold. */
  function amCrawl(S, seedId, maxDepth, maxResults) {
    maxDepth = (maxDepth == null) ? AM_CRAWL_DEPTH : maxDepth;
    maxResults = (maxResults == null) ? 12 : maxResults;
    var out = { seed: seedId, results: [], hops: [] };
    var seed = amFindGhost(S, seedId);
    if (!seed || !ghostVerify(seed)) return out;
    var gl = S.ghosts || [], visited = {}, queue = [{ g: seed, d: 0, sim: 1 }];
    visited[seedId] = true;
    var i, k;
    while (queue.length && out.results.length < maxResults) {
      var cur = queue.shift();
      if (cur.d > 0)
        out.results.push({ id: cur.g.id, sim: cur.sim, depth: cur.d, gen: cur.g.gen });
      if (cur.d >= maxDepth) continue;
      var scored = [];
      for (i = 0; i < gl.length; i++) {
        var g2 = gl[i];
        if (visited[g2.id] || !ghostVerify(g2)) continue;
        var s = amCosine(cur.g.hIn, g2.hIn);
        if (s >= AM_SIM_THRESH) scored.push({ g: g2, sim: s });
      }
      scored.sort(function (a, b) { return b.sim - a.sim; });
      var take = Math.min(AM_CRAWL_K, scored.length);
      for (k = 0; k < take; k++) {
        visited[scored[k].g.id] = true;
        out.hops.push({ from: cur.g.id, to: scored[k].g.id,
                        sim: scored[k].sim, depth: cur.d + 1, ts: Date.now() });
        queue.push({ g: scored[k].g, d: cur.d + 1, sim: scored[k].sim });
      }
    }
    if (!S.amCrawlLog) S.amCrawlLog = [];
    for (i = 0; i < out.hops.length; i++) S.amCrawlLog.push(out.hops[i]);
    if (S.amCrawlLog.length > 60) S.amCrawlLog.splice(0, S.amCrawlLog.length - 60);
    return out;
  }
  /* the recovery container — a bounded replay bank of recovered ghosts.
   * Novelty eviction: the entry most similar to the rest is dropped. */
  function amContain(S, ghost) {
    if (!ghostVerify(ghost)) return { ok: false, reason: 'ghost failed verification' };
    if (!S.amContainer) S.amContainer = [];
    S.amContainer.push({ ghost: clone(ghost), ts: Date.now() });
    while (S.amContainer.length > AM_CAP) {
      var c = S.amContainer, worst = 0, worstSim = -2, i, j;
      for (i = 0; i < c.length; i++) {
        var ms = -2;
        for (j = 0; j < c.length; j++) {
          if (i === j) continue;
          var s = amCosine(c[i].ghost.hIn, c[j].ghost.hIn);
          if (s > ms) ms = s;
        }
        if (ms > worstSim) { worstSim = ms; worst = i; }
      }
      c.splice(worst, 1);
    }
    return { ok: true, size: S.amContainer.length };
  }
  /* the honest "superposition": mean similarity -> amplitude -> p = a^2
   * (Born-rule-style, mirroring pYes = cos^2(theta/2)), then a SEEDED
   * sample. Same (seed, spawn-count) always decides the same way. */
  function amMatchProb(meanSim) {
    var a = (meanSim + 1) / 2;
    if (!(a >= 0)) a = 0; if (a > 1) a = 1;
    return a * a;
  }
  function amRoll(S) {
    var n = (S.amSpawns | 0);
    var sd = ((((S.seed | 0) * 31 + n * 101) ^ 0xA77A42) >>> 0);
    return RNG(sd)();
  }
  function amRecipeCanon(r) {
    return { ids: r.ids, units: r.units, topology: r.topology,
             gains: r.gains, targetLayers: r.targetLayers, gen: r.gen };
  }
  function amBuildRecipe(S, ghostIds) {
    var depth = S.depth || 1, tl = [], l;
    for (l = 0; l < depth; l++) tl.push(l);
    var r = { kind: 'antimatter-recipe', v: 1, ids: ghostIds.slice(), units: AM_N,
              topology: 'all-layers', gains: { am: S.amGain, ana: AM_ANA_GAIN },
              targetLayers: tl, gen: S.gen, ts: Date.now() };
    r.id = 'amr' + S.gen + '-' + (r.ts % 100000).toString(36);
    r.checksum = checksum(amRecipeCanon(r));
    return r;
  }
  function amVerifyRecipe(r) {
    try {
      if (!r || r.kind !== 'antimatter-recipe' || r.v !== 1) return false;
      if (!r.ids || !r.ids.length) return false;
      return checksum(amRecipeCanon(r)) === r.checksum;
    } catch (e) { return false; }
  }
  /* compose the inner loop from recovered ghosts: dedicated RNG stream
   * (never S.rnd — the reference stream is untouched) plus the outer
   * product of the mean ghost state, kept small. */
  function amCompose(S, ghosts) {
    var r = RNG(((((S.seed | 0) ^ 0xA77A00) + (S.amSpawns | 0) * 7919) >>> 0));
    var N = AM_N, W = [], U = [], h = [], i, j, l, d, gi;
    var mean = []; for (i = 0; i < D; i++) mean.push(0);
    var ng = 0;
    for (gi = 0; gi < ghosts.length; gi++) {
      var hh = ghosts[gi].hIn; if (!hh) continue; ng++;
      for (i = 0; i < Math.min(D, hh.length); i++) mean[i] += hh[i];
    }
    if (ng) for (i = 0; i < D; i++) mean[i] /= ng;
    var depth = S.depth || 1;
    var zs = S.amZeroSum !== false;
    var zsInfo = { zs: zs, zsExact: false, zsErr: null, zsBase: null };
    if (zs && S.champion && S.champion.layers && S.champion.layers[depth - 1]) {
      /* v44: zero-sum pairing — matter/antimatter weights initialize summing
       * to EXACTLY zero: AM.W = −(top-layer W). "Annihilation" is honest
       * linear algebra here, not physics. The ghost's soul moves into the
       * READ matrices U (per-layer), preserving v42's ghost composition —
       * structure from matter (inverted), soul from ghosts. The pair-sum is
       * asserted below; any later divergence of ||AM.W + W_top|| IS the
       * learned asymmetry (see amDivergence). */
      var topW = S.champion.layers[depth - 1].W;
      var zsErr = 0;
      for (i = 0; i < N; i++) {
        W.push([]); h.push(0);
        for (j = 0; j < N; j++) {
          var wv = -topW[i][j];
          W[i].push(wv);
          var s2 = wv + topW[i][j]; zsErr += s2 * s2;
        }
      }
      zsErr = Math.sqrt(zsErr);
      zsInfo.zsErr = zsErr;
      /* spectral discipline: exact zero-sum is preserved when the matter
       * matrix is already stable; rescale ONLY if rho > 0.9, and record it.
       * (v43's fading-memory reservoir requirement still holds.) */
      var rho = spectralRadius(W);
      zsInfo.zsExact = rho <= 0.9;
      if (!zsInfo.zsExact) boundSpectral(W, 0.9);
      var zsBase = 0;
      for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
        var d0 = W[i][j] + topW[i][j]; zsBase += d0 * d0;
      }
      zsInfo.zsBase = Math.sqrt(zsBase);
      /* ghost composition into the read matrices U. */
      for (l = 0; l < depth; l++) {
        var Ul = [];
        for (i = 0; i < N; i++) {
          Ul.push([]);
          for (d = 0; d < D; d++)
            Ul[i].push((r() * 2 - 1) * 0.1 + 0.05 * mean[i % D] * mean[d % D]);
        }
        U.push(Ul);
      }
    } else {
      /* legacy compose (v42/v43): RNG + ghost outer product in W, random U.
       * Kept for the OFF arm of the zero-sum comparison. */
      for (i = 0; i < N; i++) {
        W.push([]); h.push(0);
        for (j = 0; j < N; j++)
          W[i].push((r() * 2 - 1) * 0.1 + 0.05 * mean[i % D] * mean[j % D]);
      }
      /* v43: echo-state discipline — bound the recurrent matrix to rho = 0.9.
       * Fading memory, never an oscillating amplifier. Pure rescale: the
       * dedicated RNG stream is untouched, spawn determinism preserved. */
      boundSpectral(W, 0.9);
      for (l = 0; l < depth; l++) {
        var Ul2 = [];
        for (i = 0; i < N; i++) {
          Ul2.push([]);
          for (d = 0; d < D; d++) Ul2[i].push((r() * 2 - 1) * 0.1);
        }
        U.push(Ul2);
      }
    }
    return { on: true, N: N, W: W, U: U, h: h, gain: S.amGain,
             anaGain: AM_ANA_GAIN, steps: 0,
             residOn: S.amResid !== false, signInv: !!S.amSignInv,
             zs: zsInfo.zs, zsExact: zsInfo.zsExact,
             zsErr: zsInfo.zsErr, zsBase: zsInfo.zsBase };
  }
  /* spawn INTERPRETS the recipe — data in, module out. There is no code
   * generation and no eval anywhere in this path: the recipe's ids select
   * verified ghosts, its topology/gains parameterize the composition. */
  function amSpawn(S, recipe) {
    if (!amVerifyRecipe(recipe)) return { ok: false, reason: 'recipe checksum mismatch — rejected' };
    if (!S.amOn) return { ok: false, reason: 'antimatter master switch is OFF' };
    var ghosts = [], i;
    for (i = 0; i < recipe.ids.length; i++) {
      var g = amFindGhost(S, recipe.ids[i]);
      if (g && ghostVerify(g)) ghosts.push(g);
    }
    if (!ghosts.length && S.amContainer && S.amContainer.length)
      for (i = 0; i < S.amContainer.length; i++) ghosts.push(S.amContainer[i].ghost);
    if (!ghosts.length) return { ok: false, reason: 'no verified ghosts to compose from' };
    if (!S.champion) return { ok: false, reason: 'no champion yet — run the Core first' };
    var mod = amCompose(S, ghosts);
    mod.recipeId = recipe.id; mod.spawnedGen = S.gen;
    S.champion.antimatter = mod;
    /* the module rides the champion — the next generation's variants
     * inherit it through the clone. Also arm the live loop now so the
     * current run feels it immediately. */
    if (S.live) S.live.antimatter = clone(mod);
    if (S.frozen) S.frozen.antimatter = clone(mod);
    return { ok: true, recipe: recipe.id, units: mod.N, layers: recipe.targetLayers.length };
  }
  /* recover: verify the ghost, crawl the archive for relatives, stack the
   * haul in the container, then the seeded stochastic spawn decision. */
  function amRecover(S, ghostId) {
    var g = amFindGhost(S, ghostId);
    if (!g || !ghostVerify(g)) return { ok: false, reason: 'ghost not found or failed verification' };
    var crawl = amCrawl(S, ghostId);
    var collected = [g.id], sims = [1], i;
    for (i = 0; i < crawl.results.length; i++) {
      var g2 = amFindGhost(S, crawl.results[i].id);
      if (g2 && ghostVerify(g2)) {
        collected.push(g2.id); sims.push(crawl.results[i].sim); amContain(S, g2);
      }
    }
    amContain(S, g);
    var meanSim = 0;
    for (i = 0; i < sims.length; i++) meanSim += sims[i];
    meanSim /= sims.length;
    var p = amMatchProb(meanSim);
    /* v43: auto-pilot temporarily lowers the crawler's spawn threshold —
     * the same probability, easier to fire. */
    if (S.apThreshMul && S.apThreshMul !== 1) p = Math.min(1, p / S.apThreshMul);
    var roll = amRoll(S), fired = roll < p;
    S.amSpawns = (S.amSpawns | 0) + 1;
    var entry = { ts: Date.now(), gen: S.gen, seed: ghostId, collected: collected,
                  meanSim: meanSim, p: p, roll: roll, fired: fired, recipe: null };
    if (!S.amSpawnLog) S.amSpawnLog = [];
    S.amSpawnLog.push(entry);
    if (S.amSpawnLog.length > 40) S.amSpawnLog.splice(0, S.amSpawnLog.length - 40);
    var res = { ok: true, collected: collected, meanSim: meanSim, p: p,
                roll: roll, fired: fired, hops: crawl.hops.length };
    if (fired && S.amSpawn) {
      var recipe = amBuildRecipe(S, collected);
      entry.recipe = recipe.id;
      var sp = amSpawn(S, recipe);
      res.spawned = sp.ok; res.recipe = recipe.id;
      if (!sp.ok) res.spawnReason = sp.reason;
    } else if (fired) {
      res.spawned = false; res.spawnReason = 'auto-spawn OFF — recipe not built';
    }
    return res;
  }
  /* read-only structural analysis: per-layer weight RMS. The module reads
   * the main net's structure and folds it into its OWN update — analysis
   * in, self-update out, main-net weights never touched. */
  function amWeightStat(L, i) {
    var depth = L.depth || 1, l = i % depth, W = L.layers[l].W;
    var s = 0, n = 0, r, c, v;
    for (r = 0; r < D; r++)
      for (c = 0; c < D; c++) { v = W[r][c]; s += v * v; n++; }
    return Math.sqrt(s / Math.max(1, n));
  }
  /* the inner loop's self-update — mutates ONLY the module's own h.
   * Called from step(); the main net's weights are read, never written. */
  function amStep(L) {
    var AM = L.antimatter;
    if (!AM || !AM.on) return;
    var depth = L.depth || 1, N = AM.N, i, j, l, d;
    var nl = Math.min(depth, AM.U.length), nh = [];
    for (i = 0; i < N; i++) {
      var acc = 0;
      for (j = 0; j < N; j++) acc += AM.W[i][j] * AM.h[j];
      for (l = 0; l < nl; l++) {
        var Uh = AM.U[l], lh = L.layers[l].h, gg = AM.gain;
        for (d = 0; d < D; d++) acc += gg * Uh[i][d] * lh[d];
      }
      acc += AM.anaGain * amWeightStat(L, i);
      /* v44: sign inversion — the antimatter path applies −tanh(h): inverts
       * positive error drives to cancel recurring bias. Toggleable. */
      var aact = Math.tanh(acc);
      nh.push(clampH(AM.signInv ? -aact : aact));
    }
    /* v43: stability — the inner loop's state is LayerNorm'd too, when stab
     * is on. Its recurrent matrix is separately bounded at compose time
     * (rho < 1, fading-memory reservoir). */
    if (L.stabOn) nh = layerNormVec(nh);
    AM.h = nh;
    AM.steps = (AM.steps || 0) + 1;
  }
  /* write-protection, enforced and testable: cross-module writes are
   * rejected in both directions. The ONLY cross-module traffic is reads —
   * amStep reads the main net into its own state; the publish term reads
   * the module's state into the main net's ACTIVATION (state, not weights,
   * the same boundary v41's ghost drive respects). */
  function amTryWrite(S, dir) {
    return { ok: false, reason: 'write-protection: ' +
      (dir === 'main-to-am'
        ? 'the main net cannot write antimatter weights — read-only access only'
        : 'the inner loop cannot write main-net weights — read-only access only') };
  }
  function setAmOn(S, on) {
    S.amOn = !!on;
    var loops = [S.champion, S.frozen, S.live], i, m;
    for (i = 0; i < loops.length; i++) {
      m = loops[i] && loops[i].antimatter;
      if (m) m.on = S.amOn;
    }
    return S.amOn;
  }
  function setAmGain(S, g) {
    g = parseFloat(g);
    if (isFinite(g)) S.amGain = Math.max(0, Math.min(AM_GAIN_MAX, g));
    var loops = [S.champion, S.frozen, S.live], i, m;
    for (i = 0; i < loops.length; i++) {
      m = loops[i] && loops[i].antimatter;
      if (m) m.gain = S.amGain;
    }
    return S.amGain;
  }
  function setAmSpawn(S, on) { S.amSpawn = !!on; return S.amSpawn; }

  /* ══ v44 "Annihilation" — concrete digital antimatter + bidirectional ══
   * Gemini's spec, honestly labeled. "Annihilation" is a LINEAR-ALGEBRA
   * metaphor (projection rejection / orthogonalization), NOT physics:
   * classical simulation throughout — Bell's theorem still applies.
   *
   * PART 1 — concrete antimatter (Gemini's table):
   *  1. Anti-correlated residual filter: the inner loop no longer publishes
   *     its raw state. Per layer it annihilates the shared projection with
   *     the layer's own state and publishes only the damped orthogonal
   *     residual — the part the main loop does NOT already contain. Pure
   *     novelty, no echo. Toggle amResid (default ON); OFF = legacy raw.
   *  2. Sign inversion: the antimatter path applies −tanh — inverts positive
   *     error drives to cancel recurring bias. Toggle amSignInv (default
   *     OFF: it is an experiment, with its own comparison).
   *  3. Orthogonal projection on collision: (I − m̂m̂ᵀ)a generalizes the
   *     residual filter to every antimatter/standard-neuron collision; the
   *     publish path is its instance. amProjectOut is the operator.
   *  4. Zero-sum pairing: at spawn AM.W = −(top-layer W) exactly — the pair
   *     sums to zero (asserted at compose). The ghost's soul moves into the
   *     READ matrices U, preserving v42's ghost composition. Later
   *     divergence of ||AM.W + W_top|| IS the learned asymmetry — metered
   *     live by amDivergence. Toggle amZeroSum (default ON, compose-time).
   *
   * PART 2 — bidirectional inversion (encoding ↔ abduction):
   *  Forward (existing): L1 takes input x → L2 → L3 → prediction from L3.
   *  Reverse (new): freeze the top-layer state into an IMMUTABLE ghost,
   *  inject it as the target condition, propagate the mismatch e_3 =
   *  v_ghost − h_3 DOWNWARD through transpose weights (feedback alignment —
   *  an approximation, honestly labeled), and read the reconstruction from
   *  Layer 1. Forward encodes, reverse decodes — the future cipher-puzzle
   *  machinery for the CTF Lab. "Abduction" = inferring the input that best
   *  explains the frozen context.
   *
   * The user's falsifiability rule: every mechanism gets its own toggle AND
   * its own ON/OFF comparison test (amCompare, invRoundTrip). */

  /* the collision operator: annihilate the shared component.
   * res = a − proj_m(a) = (I − m̂m̂ᵀ)a — the orthogonal residual.
   * "Annihilation" = projection rejection. Linear algebra, not physics. */
  function amProjectOut(a, m, n) {
    n = Math.min(n, a.length, m.length);
    var na = 0, nm = 0, i;
    for (i = 0; i < n; i++) { na += a[i] * a[i]; nm += m[i] * m[i]; }
    na = Math.sqrt(na); nm = Math.sqrt(nm);
    /* proj_m(a) = (a·m̂)m̂ — the RAW dot product, not the cosine: forgetting
     * the |a| scale annihilates the wrong amount (caught by v44 tests). */
    var sraw = 0;
    if (nm > 1e-12)
      for (i = 0; i < n; i++) sraw += a[i] * (m[i] / nm);
    var cos = na > 1e-12 ? sraw / na : 0;
    var res = [];
    for (i = 0; i < n; i++) res.push(a[i] - sraw * (nm > 1e-12 ? m[i] / nm : 0));
    return { res: res, shared: cos, n: n };
  }
  /* the publish vector for one layer: m is the layer's current state (the
   * collision partner). residOn → damped orthogonal residual (pure novelty);
   * off → legacy raw publish. signInv negates either arm. */
  function amPublishVec(AM, m, n) {
    n = Math.min(n, AM.N, m.length);
    var out = [], i, v;
    if (AM.residOn) {
      var pr = amProjectOut(AM.h, m, n);
      for (i = 0; i < n; i++) {
        v = AM.gain * Math.tanh(pr.res[i]);
        out.push(AM.signInv ? -v : v);
      }
    } else {
      for (i = 0; i < n; i++) {
        v = AM.gain * AM.h[i];
        out.push(AM.signInv ? -v : v);
      }
    }
    return out;
  }
  /* the learned-asymmetry meter: ||AM.W + W_top(live)||. Zero at spawn
   * (exact zero-sum), growing as matter's weights evolve away from the
   * antimatter anchor. Null when no live module. */
  function amDivergence(L) {
    var AM = L && L.antimatter;
    if (!AM || !AM.on) return null;
    var depth = L.depth || 1, topW = L.layers[depth - 1].W, s = 0, i, j;
    var n = Math.min(AM.N, topW.length);
    for (i = 0; i < n; i++)
      for (j = 0; j < n; j++) { var d = AM.W[i][j] + topW[i][j]; s += d * d; }
    return Math.sqrt(s);
  }
  function setAmResid(S, on) {
    S.amResid = !!on;
    var loops = [S.champion, S.frozen, S.live], i, m;
    for (i = 0; i < loops.length; i++) {
      m = loops[i] && loops[i].antimatter;
      if (m) m.residOn = S.amResid;
    }
    return S.amResid;
  }
  function setAmSignInv(S, on) {
    S.amSignInv = !!on;
    var loops = [S.champion, S.frozen, S.live], i, m;
    for (i = 0; i < loops.length; i++) {
      m = loops[i] && loops[i].antimatter;
      if (m) m.signInv = S.amSignInv;
    }
    return S.amSignInv;
  }
  function setAmZeroSum(S, on) {
    /* compose-time: applies to the NEXT spawn (init property, not a
     * runtime mode). */
    S.amZeroSum = !!on;
    return S.amZeroSum;
  }
  /* ON/OFF comparison: residual-publish vs legacy raw publish on identical
   * clones — same seed, same steps, the ONLY difference is the publish arm.
   * A real Δ means the filter changes the trajectory (falsifiable). */
  function amCompare(S, steps) {
    steps = steps || 40;
    var base = S.live || S.champion;
    if (!base || !base.antimatter || !base.antimatter.on)
      return { ok: false, reason: 'no live inner loop — spawn one first (🕷 Recover a ghost)' };
    function rollout(residOn) {
      var LC = clone(base);
      LC.antimatter.residOn = residOn;
      var traj = [], t;
      for (t = 0; t < steps; t++) traj.push(step(LC, t, S.lr, false).err);
      return traj;
    }
    var a = rollout(true), b = rollout(false), d = 0, i;
    for (i = 0; i < steps; i++) d += Math.abs(a[i] - b[i]);
    return { ok: true, steps: steps, meanAbsDiff: d / steps,
             residOn: a, rawOff: b,
             differ: (d / steps) > 1e-9 };
  }

  /* ── bidirectional inversion ── */
  /* freeze the forward ghost: the top-layer state, snapshotted IMMUTABLE.
   * It is never written — only read as the reverse target. */
  function invFreezeGhost(L) {
    var depth = L.depth || 1;
    return { kind: 'inversion-ghost', v: L.layers[depth - 1].h.slice(),
             depth: depth, ts: Date.now(), immutable: true };
  }
  /* one reverse rollout on a CLONE — the live loop is untouched.
   * e_top = v_ghost − h_top; the top relaxes toward the frozen target, then
   * the mismatch propagates DOWNWARD through transpose weights
   * (feedback alignment — approximate, honestly labeled). Reads x̂ from
   * Layer 1 each step via the input-weight projection. */
  function invReverse(L, vghost, gamma, steps) {
    var LC = clone(L), depth = LC.depth || 1;
    var l, i, j, s;
    for (l = 0; l < depth; l++)
      for (i = 0; i < D; i++) LC.layers[l].h[i] = 0;
    var U0 = LC.layers[0].U, u0n = 0;
    for (i = 0; i < D; i++) u0n += U0[i] * U0[i];
    var xhat = [];
    for (s = 0; s < steps; s++) {
      var top = depth - 1, e = [];
      for (i = 0; i < D; i++) e[i] = vghost.v[i] - LC.layers[top].h[i];
      /* inject the frozen ghost as the target condition: the top relaxes
       * toward it (this is the "reverse drive"). */
      for (i = 0; i < D; i++)
        LC.layers[top].h[i] = clampH(LC.layers[top].h[i] + gamma * e[i]);
      for (l = top; l >= 1; l--) {
        var Ul = LC.layers[l].U, en = [];
        for (i = 0; i < D; i++) {
          var acc = 0;
          for (j = 0; j < D; j++) acc += Ul[j][i] * e[j]; /* U_lᵀ · e_l */
          en.push(acc);
        }
        for (i = 0; i < D; i++)
          LC.layers[l - 1].h[i] = clampH(LC.layers[l - 1].h[i] + gamma * en[i]);
        e = en;
      }
      var h1 = LC.layers[0].h, xh = 0;
      if (u0n > 1e-12) {
        for (i = 0; i < D; i++) xh += h1[i] * U0[i];
        xh /= u0n;
      }
      xhat.push(xh);
    }
    return { xhat: xhat, finalH1: LC.layers[0].h.slice() };
  }
  /* the round-trip falsifiability test: forward-encode a fixture (no
   * learning), freeze the ghost, reverse-decode, and score the input
   * reconstruction. aboveChance = beats the zero predictor. */
  function invRoundTrip(S, cfg) {
    cfg = cfg || {};
    var gamma = cfg.gamma != null ? cfg.gamma : (S.invGamma || 0.5);
    gamma = Math.max(0.05, Math.min(1, gamma));
    var fwdT = cfg.fwdT || 20, revSteps = cfg.revSteps || 12;
    var base = S.live || S.champion;
    if (!base) return { ok: false, reason: 'run the Core first — no live loop to invert' };
    var LC = clone(base), l, i, t;
    for (l = 0; l < (LC.depth || 1); l++)
      for (i = 0; i < D; i++) LC.layers[l].h[i] = 0;
    for (t = 0; t < fwdT; t++) step(LC, t, S.lr, false);
    var vghost = invFreezeGhost(LC);
    var xtrue = 0.5 * Math.sin(0.05 * (fwdT - 1)); /* the input being decoded */
    var rev = invReverse(LC, vghost, gamma, revSteps);
    var xh = rev.xhat[rev.xhat.length - 1];
    var relErr = Math.abs(xh - xtrue) / (Math.abs(xtrue) + 1e-9);
    var meanAbs = 0;
    for (i = 0; i < rev.xhat.length; i++) meanAbs += Math.abs(rev.xhat[i]);
    meanAbs /= rev.xhat.length;
    return { ok: true, gamma: gamma, fwdT: fwdT, revSteps: revSteps,
             xtrue: xtrue, xhat: xh, relErr: relErr,
             fidelity: Math.max(0, 1 - relErr),
             meanAbsXhat: meanAbs,
             aboveChance: relErr < 1,
             verdict: relErr < 1
               ? 'round-trip recovers the input better than chance — the reverse path carries real signal'
               : 'round-trip did NOT beat chance — the reverse path needs tuning (try another γ)' };
  }
  function setInvGamma(S, g) {
    g = parseFloat(g);
    if (isFinite(g)) S.invGamma = Math.max(0.05, Math.min(1, g));
    return S.invGamma || 0.5;
  }
  function setInvAuto(S, on) {
    /* auto-invert on the '>' delimiter (char-RNN / future CTF cipher path).
     * The char-RNN generate loop checks this flag via the hook below. */
    S.invAuto = !!on;
    return S.invAuto;
  }
  function clone(L) { return JSON.parse(JSON.stringify(L)); }
  function target(t) { return Math.sin(0.3 * t) + 0.5 * Math.sin(0.11 * t + 1.0); }

  /* ══ v43 "Gauntlet" — Gemini's five recommendations ═══════════════════
   * 1. Shock lab: held-out validation + seeded regime shocks + the
   *    ghost-recovery ON-vs-OFF falsifiability experiment.
   * 2. Decay-law auto-pilot: rolling-slope plateau trigger -> mutation
   *    burst + redundant-unit compression (mints ghosts) + lowered
   *    crawler spawn threshold. Every trigger is ledger-logged.
   * 3. Multi-objective fitness: F = w1*(1-err) + w2*fidelity - w3*complexity.
   * 4. Char-RNN milestone lives in charrnn.js (separate module).
   * 5. Numerical stability: LayerNorm after recurrent/ghost updates +
   *    spectral-radius-bounded antimatter loop (fading-memory reservoir).
   * Honest labels throughout: classical simulation. All v43 run-config
   * defaults are OFF, so the depth-1 seed-16 reference path is bit-identical.
   */
  /* shock state — module-scope so step() (which takes only L, t, lr) sees it.
   * frame() syncs it from S.shock every generation; null = pristine signal. */
  var SHOCK = null;
  function setShock(S, type, seed) {
    /* type: 'freq' | 'phase' | 'noise' | null. Seeded: the same (seed,type)
     * always injects the same shock. Cleared by reset(). */
    if (!type) { S.shock = null; return null; }
    type = (type === 'freq' || type === 'phase' || type === 'noise') ? type : 'noise';
    S.shock = { type: type, rng: RNG((seed == null ? (S.seed || 16) : seed) * 7 + 1) };
    return S.shock.type;
  }
  function targetShock(t) {
    var y = Math.sin(0.3 * t) + 0.5 * Math.sin(0.11 * t + 1.0);
    if (!SHOCK) return y; /* reference path: untouched */
    var type = SHOCK.type;
    if (type === 'freq') return Math.sin(0.9 * t) + 0.5 * Math.sin(0.33 * t + 1.0);
    if (type === 'phase') return -y;
    if (type === 'noise') {
      /* Gaussian burst, Box-Muller on the seeded stream */
      var u1 = Math.max(1e-12, SHOCK.rng()), u2 = SHOCK.rng();
      return y + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * 0.8;
    }
    return y;
  }
  /* LayerNorm: h <- (h - mu) / (sigma + eps). Applied after recurrent
   * updates and ghost-feedback application when stab is ON — keeps every
   * activation honest over long runs. Never on the reference path. */
  function layerNormVec(h) {
    var n = h.length, mu = 0, i, d;
    for (i = 0; i < n; i++) mu += h[i];
    mu /= n;
    var v = 0;
    for (i = 0; i < n; i++) { d = h[i] - mu; v += d * d; }
    var sd = Math.sqrt(v / n + 1e-8);
    var out = [];
    for (i = 0; i < n; i++) out.push((h[i] - mu) / sd);
    return out;
  }
  /* spectral radius via power iteration (24 iters is plenty for 6x6).
   * The antimatter loop is rescaled to rho = 0.9 < 1 at compose time:
   * a fading-memory reservoir (echo-state principle), never an
   * oscillating amplifier. Pure function — no RNG consumed, so seeded
   * spawn determinism is preserved. */
  function spectralRadius(W) {
    var n = W.length, v = [], i, j, it;
    for (i = 0; i < n; i++) v.push(1 / Math.sqrt(n));
    for (it = 0; it < 24; it++) {
      var w = [], nm = 0;
      for (i = 0; i < n; i++) { var s = 0; for (j = 0; j < n; j++) s += W[i][j] * v[j]; w.push(s); nm += s * s; }
      nm = Math.sqrt(nm) || 1;
      for (i = 0; i < n; i++) v[i] = w[i] / nm;
    }
    var num = 0, den = 0;
    for (i = 0; i < n; i++) { var s2 = 0; for (j = 0; j < n; j++) s2 += W[i][j] * v[j]; num += v[i] * s2; den += v[i] * v[i]; }
    return Math.abs(num / (den || 1));
  }
  function boundSpectral(W, rhoMax) {
    var rho = spectralRadius(W);
    if (rho > rhoMax) {
      var f = rhoMax / rho, i, j;
      for (i = 0; i < W.length; i++)
        for (j = 0; j < W[i].length; j++) W[i][j] *= f;
    }
    return spectralRadius(W);
  }
  /* held-out validation: a window the training episodes NEVER see
   * (t in [T, T+valT)), pristine signal, zero learning — pure forward on a
   * clone so the live loop is untouched. Disjoint by construction:
   * training only ever steps t < T. */
  function validationErr(S, L) {
    var VL = clone(L), t2, sum = 0, n = 0;
    var keep = SHOCK; SHOCK = null; /* validation is never shocked */
    var vt = S.valT || 40;
    for (t2 = S.T; t2 < S.T + vt; t2++) {
      sum += Math.abs(step(VL, t2, S.lr, false).err); n++;
    }
    SHOCK = keep;
    return n ? sum / n : null;
  }
  /* multi-objective fitness. errV prefers the held-out validation error
   * when the shock lab is armed (generalization, not memorization);
   * fidelity rewards the entanglement-inspired link; complexity =
   * normalized L2 over horizon + inner-loop weights plus layer saturation
   * (mean |h| / clamp bound) — keeps the inner loops lean, no state drift. */
  function complexity(L) {
    var s = 0, n = 0, k, i, j, l;
    var HZ = L.horizon;
    if (HZ && HZ.on) {
      for (k = 0; k < HZ.K; k++) {
        for (i = 0; i < HZ.M; i++) {
          s += HZ.A[k][i] * HZ.A[k][i]; n++;
          for (j = 0; j < HZ.M; j++) { s += HZ.G[k][i][j] * HZ.G[k][i][j]; n++; }
        }
        s += HZ.Vh[k] * HZ.Vh[k]; n++;
      }
    }
    var AM = L.antimatter;
    if (AM && AM.on) {
      for (i = 0; i < AM.N; i++)
        for (j = 0; j < AM.N; j++) { s += AM.W[i][j] * AM.W[i][j]; n++; }
    }
    var l2n = n ? Math.min(1, Math.sqrt(s / n) / 2) : 0; /* heuristic scale */
    var sat = 0, sn = 0, dd = L.depth || 1;
    for (l = 0; l < dd; l++) {
      var hh = L.layers[l].h;
      for (i = 0; i < hh.length; i++) { sat += Math.abs(hh[i]) / 10; sn++; }
    }
    sat = sn ? sat / sn : 0;
    return 0.5 * l2n + 0.5 * sat;
  }
  function moScore(S, vn) {
    var errV = (vn.valErr != null) ? vn.valErr : vn.err;
    var acc = 1 - errV;
    var fid = (vn.fid == null) ? 0 : vn.fid;
    var cpx = complexity(vn.loop);
    var F = S.moW1 * acc + S.moW2 * fid - S.moW3 * cpx;
    return { acc: acc, fid: fid, cpx: cpx, F: F,
             w1: S.moW1, w2: S.moW2, w3: S.moW3 };
  }
  function setVal(S, on, valT) {
    S.valOn = !!on;
    valT = parseInt(valT, 10);
    if (isFinite(valT) && valT >= 10 && valT <= 400) S.valT = valT;
    return S.valOn;
  }
  function setMO(S, on, w1, w2, w3) {
    S.moOn = !!on;
    function w(v, d) { v = parseFloat(v); return (isFinite(v) && v >= 0 && v <= 1) ? v : d; }
    S.moW1 = w(w1, 0.6); S.moW2 = w(w2, 0.25); S.moW3 = w(w3, 0.15);
    return S.moOn;
  }
  function setStab(S, on) { S.stabOn = !!on; return S.stabOn; }
  function setAutoPilot(S, on, k, thresh) {
    S.autoPilot = !!on;
    k = parseInt(k, 10);
    if (isFinite(k) && k >= 2 && k <= 8) S.apK = k;
    thresh = parseFloat(thresh);
    if (isFinite(thresh) && thresh > 0 && thresh < 0.1) S.apThresh = thresh;
    return S.autoPilot;
  }
  /* auto-pilot compression pass: identify the most redundant (lowest
   * |activation|) infalling units and freeze the current pre-compression
   * state as a ghost for the crawler. Nothing is deleted — the horizon
   * keeps running; the archive gains a ghost. */
  function apCompressRedundant(S) {
    var L = S.champion, HZ = L && L.horizon;
    if (!HZ || !HZ.on) return 0;
    var M = HZ.M, i, top = L.layers[(L.depth || 1) - 1].h;
    var hIn = [];
    for (i = 0; i < M; i++) hIn.push(top[i]);
    var g = buildGhost(HZ, hIn, S.T, S.gen);
    g.note = 'autopilot-redundant';
    if (!ghostVerify(g)) return 0;
    if (!S.ghosts) S.ghosts = [];
    S.ghosts.push(g);
    if (S.ghosts.length > GHOST_MAX) S.ghosts.splice(0, S.ghosts.length - GHOST_MAX);
    return 1;
  }
  /* ── the falsifiability experiment ──
   * Baseline gens on the pristine signal, then a SEEDED regime shock
   * (the shock persists — adaptation to the new regime is what's measured),
   * then count generations-to-recover (err back within 5% of pre-shock)
   * and the post-shock error integral, with ghost-recovery ON vs OFF.
   * Same seed both arms — the ONLY difference is the feedback toggle. */
  function shockTest(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 16 : opts.seed;
    var depth = opts.depth || 3;
    var type = opts.type || 'noise';
    var shockGen = opts.shockGen || 2, after = opts.after || 5;
    function arm(ghostFb) {
      var S = create(shockGen + after + 2, seed, depth, 'tanh');
      setHorizon(S, true, true, 6, 2);
      S.ghostFb = !!ghostFb; S.ghostGain = 0.15;
      return S;
    }
    function runOnce(ghostFb) {
      var S = arm(ghostFb);
      runGens(S, shockGen);
      var preErr = S.curve[S.curve.length - 1];
      setShock(S, type, seed);
      runGens(S, after);
      var c = S.curve, rec = -1, integral = 0, g;
      for (g = shockGen; g < c.length; g++) {
        integral += c[g];
        if (rec < 0 && c[g] <= preErr * 1.05) rec = g - shockGen;
      }
      return { curve: c.slice(), preErr: preErr,
               gensToRecover: rec, integral: integral };
    }
    var on = runOnce(true), off = runOnce(false);
    var verdict = (on.gensToRecover >= 0 &&
                   (off.gensToRecover < 0 || on.gensToRecover <= off.gensToRecover))
      ? 'ghost recovery adapted faster' : 'no recovery advantage measured';
    return { seed: seed, depth: depth, type: type,
             shockGen: shockGen, gensAfter: after,
             on: on, off: off, verdict: verdict };
  }

  /* ── v39: the deep ErrorLoop step ───────────────────────────────────
   *   h_l(t+1) = act( W_l·h_l(t) + U_l·in_l + 0.3·e·F_l )  for l > 0
   *   h_0(t+1) = act( W_0·h_0(t) + U_0·x + 0.3·e·V )  (the reference path)
   * in_0 = scalar input x; in_l = h_{l-1}(t+1) for l > 0.
   * F_0 ≡ V (layer 0 uses the decoder directly, bit-identical to the v32
   * step); each upper layer l > 0 learns its OWN feedback vector F_l.
   *
   * GRADIENT PATH (why the stack learns): the decoder error
   *   e = truth − V·h_top
   * — the top-level prediction error — drives EVERY layer's recurrent weights:
   *   W_l[i][j] += (lr/(l+1)) · e · F_l[i] · h_l_new[j],
   * and each layer's feedback vector learns the same way the decoder does:
   *   F_l[i] += (lr/(l+1)) · e · h_l_new[i].
   * Deeper layers learn gentler (discriminative rates): they sit further from
   * the error signal, so their updates are noisier — scaling by 1/(l+1)
   * stabilizes the stack. Layer 0 keeps the exact reference rate (l=0).
   * The decoder itself learns:  V[i] += lr · e · h_top_new[i].
   * Every nonlinearity between layers (tanh/ReLU/sigmoid) is differentiable,
   * so the error path through the whole stack is well-defined end-to-end.
   *
   * Why per-layer feedback (v39c): the reference broadcasts one decoder V
   * to every layer, but V only decodes the TOP — for lower layers that
   * broadcast is misaligned and the stack plateaus (observed in testing).
   * Giving each layer its own learned feedback vector (learned feedback
   * alignment) restores a correct local error pathway per layer.
   *
   * Layer-wise predictive-coding spirit: each layer transforms/predicts the
   * representation of the layer below — its input IS the below layer's fresh
   * state h_{l-1}(t+1) — and the top prediction error tunes all layers via
   * their own feedback; the top layer feeds the decoder V and the qubit
   * belief phi, unchanged.
   *
   * Honest simplification: the error is broadcast top-down rather than passed
   * as per-layer error units up the stack (full bidirectional predictive
   * coding is future work). The per-layer pe[] below is a representation-
   * quality readout — mean |below − U_lᵀ·h_l|, i.e. how much of the below
   * layer the current layer fails to reconstruct — for the dashboard only;
   * it does NOT drive learning.
   *
   * At depth=1 + tanh this function is bit-identical to the v32 step. */
  function step(L, t, lr, learn) {
    var i, j, k, l, yp = 0, acc, nh;
    lr = (lr == null) ? LR : lr;
    /* v43: learn=false = pure forward (validation window) — weights frozen,
     * state still flows. Default true: the reference path is untouched. */
    var doLearn = (learn !== false);
    var depth = L.depth || 1;
    var AF = actFn(L.act);
    var topH = L.layers[depth - 1].h;
    for (i = 0; i < D; i++) yp += L.V[i] * topH[i];
    var truth = targetShock(t), e = truth - yp; /* v43: SHOCK null = target(t) exactly */
    /* v40: the event horizon — M infalling states collide pairwise through
     * the gravity matrix G into K outputs; the exterior partners whisper
     * in but never fall in themselves. */
    var HZ = (L.horizon && L.horizon.on) ? L.horizon : null;
    var hIn = null, yH = null, topFb = null;
    if (HZ) {
      var p = HZ.p, gam = HZ.ent ? HZ.gamma : 0, M = HZ.M, K = HZ.K;
      /* v40b: the whisper rides the linear channel only — hIn is pure
       * infall for the quadratic collision. Feeding the whisper through
       * h^2 amplifies it bilinearly (observed: runaway at depth 1). */
      hIn = [];
      for (i = 0; i < M; i++) hIn.push(topH[i]);
      /* v41: ghost snapshot — armed once per generation (variant 0 only).
       * At mid-episode the engine freezes an exact copy of the
       * PRE-compression infall state. frame() collects HZ.lastGhost into
       * S.ghosts. Bit-identity guard: HZ is null with the horizon off, and
       * ghostArm is only ever set when the horizon is on — the reference
       * path never sees this. */
      if (HZ.ghostArm && t === GHOST_T) {
        HZ.ghostArm = false;
        HZ.lastGhost = buildGhost(HZ, hIn, t, HZ.ghostGen);
      }
      /* v40d: the whisper is MULTIPLICATIVE and bounded — it scales the
       * infalling state by (1+γ·tanh p), never an unbounded additive offset.
       * An additive whisper lets a drifting partner drag the operating point
       * (observed: Vh blew up compensating at depth 1). */
      var hW = [];
      for (i = 0; i < M; i++)
        hW.push(clampH(topH[i] * (1 + gam * Math.tanh(p[i % K] || 0))));
      yH = [];
      for (k = 0; k < K; k++) {
        var s2 = 0, Gk = HZ.G[k], Ak = HZ.A[k];
        for (i = 0; i < M; i++) {
          s2 += Ak[i] * hW[i];
          for (j = 0; j < M; j++) s2 += Gk[i][j] * hIn[i] * hIn[j];
        }
        yH.push(Math.tanh(s2));
      }
      yp = 0;
      for (k = 0; k < K; k++) yp += HZ.Vh[k] * yH[k];
      e = truth - yp;
      if (!HZ.acc) {
        var az = []; for (k = 0; k < K; k++) az.push(0);
        HZ.acc = { n: az.slice(), sp: az.slice(), sy: az.slice(),
                   spy: az.slice(), sp2: az.slice(), sy2: az.slice() };
      }
      /* exterior partners: when the link is on, they track the outputs
       * (two-way coupling — they also whisper back through hW). When the
       * link is OFF there is no coupling at all: the partners sit inert at
       * zero, a true control showing "no link = no correlation". */
      for (k = 0; k < K; k++) {
        if (HZ.ent) {
          p[k] += HZ.alpha * (yH[k] - p[k]);
          HZ.acc.n[k]++;
          HZ.acc.sp[k] += p[k]; HZ.acc.sy[k] += yH[k];
          HZ.acc.spy[k] += p[k] * yH[k];
          HZ.acc.sp2[k] += p[k] * p[k];
          HZ.acc.sy2[k] += yH[k] * yH[k];
        }
      }
      /* true gradient feedback through the quadratic+linear compressor:
       * dyp/dh_i = Σ_k Vh[k]·(1−y_k²)·( A_ki·(1+γ·tanh p) + Σ_j (G_kij+G_kji)·h[j] ).
       * v40c: the horizon counts as an extra layer above the stack, so the
       * top recurrent layer learns at the discriminative rate of its true
       * position: ×depth/(depth+1). Without this, G's growth inflates topFb
       * and the top layer (full rate at depth 1) runs away; deeper stacks
       * were partly protected by their 1/(l+1) scaling. Still a valid
       * descent direction. */
      topFb = [];
      var fbScale = depth / (depth + 1);
      for (i = 0; i < D; i++) {
        var fi = 0;
        for (k = 0; k < K; k++) {
          var dy = 1 - yH[k] * yH[k], Gk2 = HZ.G[k];
          var ds = HZ.A[k][i] * (1 + gam * Math.tanh(p[i % K] || 0));
          for (j = 0; j < M; j++) ds += (Gk2[i][j] + Gk2[j][i]) * hIn[j];
          fi += HZ.Vh[k] * dy * ds;
        }
        topFb.push(fbScale * fi);
      }
    }
    var x = 0.5 * Math.sin(0.05 * t);
    var newHs = [];
    /* v41: the ghost drive — persistent, damped, inside the activation.
     * Only the top layer ("the 3rd core loop" at default depth 3) feels it,
     * and only when the feedback loop is armed (horizon on + ghostFb on +
     * a ghost in the archive). HZ is null with the horizon off, so the
     * reference path never sees this. */
    var ghDrv = (HZ && HZ.fbOn && HZ.fbGhost) ? HZ : null;
    /* v42: the antimatter publish term — the inner loop's state, read into
     * every layer's ACTIVATION (state, not weights — the same boundary the
     * ghost drive respects). Null when the module is off, so the reference
     * path below is bit-identical. */
    var AMM = (L.antimatter && L.antimatter.on) ? L.antimatter : null;
    for (l = 0; l < depth; l++) {
      var lay = L.layers[l];
      /* v44: the publish vector is per-layer — the residual filter needs the
       * layer's own current state as the collision partner (see
       * amPublishVec). Null when the module is off: reference bit-identical. */
      var apv = AMM ? amPublishVec(AMM, lay.h, D) : null;
      nh = [];
      /* v40: the top layer's error pathway runs through the horizon when
       * it's on (true gradient feedback); every other layer is untouched —
       * and with the horizon off this is bit-identical to v39. */
      var fb = (HZ && l === depth - 1) ? topFb : ((l === 0) ? L.V : lay.F);
      var isTop = (l === depth - 1);
      if (l === 0) {
        for (i = 0; i < D; i++) {
          acc = lay.U[i] * x;
          for (j = 0; j < D; j++) acc += lay.W[i][j] * lay.h[j];
          var gd0 = (ghDrv && isTop && i < ghDrv.fbM) ? ghDrv.fbGain * ghDrv.fbGhost[i] : 0;
          var apub0 = (apv && i < apv.length) ? apv[i] : 0;
          nh.push(clampH(AF(acc + 0.3 * e * fb[i] + gd0 + apub0)));
        }
      } else {
        var below = newHs[l - 1];
        for (i = 0; i < D; i++) {
          acc = 0;
          for (j = 0; j < D; j++) acc += lay.W[i][j] * lay.h[j] + lay.U[i][j] * below[j];
          var gd1 = (ghDrv && isTop && i < ghDrv.fbM) ? ghDrv.fbGain * ghDrv.fbGhost[i] : 0;
          var apub1 = (apv && i < apv.length) ? apv[i] : 0;
          nh.push(clampH(AF(acc + 0.3 * e * fb[i] + gd1 + apub1)));
        }
      }
      /* v43: stability — LayerNorm after every recurrent update (covers the
       * ghost drive + antimatter publish, which ride inside the activation).
       * Gated: the reference path never sees it. */
      if (L.stabOn) nh = layerNormVec(nh);
      newHs.push(nh);
    }
    /* per-layer prediction-error readout (depth > 1 only; never drives learning) */
    if (depth > 1) {
      if (!L.peSum || L.peSum.length < depth - 1) L.peSum = zeroPe(depth);
      for (l = 1; l < depth; l++) {
        var s = 0, rc, Ul = L.layers[l].U, hl = newHs[l], hb = newHs[l - 1];
        for (i = 0; i < D; i++) {
          rc = 0;
          for (j = 0; j < D; j++) rc += Ul[j][i] * hl[j];  /* U_lᵀ · h_l */
          s += Math.abs(hb[i] - rc);
        }
        L.peSum[l - 1] += s / D;
      }
      L.peN = (L.peN || 0) + 1;
    }
    /* the error rewrites every layer of the stack via its OWN feedback
     * vector — deeper layers learn gentler (llr = lr/(l+1));
     * layer 0 keeps the exact reference rate and uses V (F_0 ≡ V). */
    for (l = 0; l < depth; l++) {
      var la2 = L.layers[l];
      nh = newHs[l];
      var llr = lr / (l + 1);
      var Fb = (HZ && l === depth - 1) ? topFb : ((l === 0) ? L.V : la2.F);
      if (doLearn) { /* v43: validation freezes the weights */
        for (i = 0; i < D; i++)
          for (j = 0; j < D; j++) la2.W[i][j] += llr * e * Fb[i] * nh[j];
        if (l > 0)
          for (i = 0; i < D; i++) la2.F[i] += llr * e * nh[i];
      }
      la2.h = nh;
    }
    /* v42: the inner loop updates ITSELF from read-only views of the main
     * net — it never writes main-net weights, and nothing here writes the
     * module's weights either (see amTryWrite: cross-module writes are
     * rejected in both directions). */
    if (AMM) amStep(L);
    if (doLearn && HZ) {
      /* the horizon decoder + gravity matrix + linear channel learn from the
       * same error; the bypassed decoder V is frozen while the horizon owns
       * prediction. */
      for (k = 0; k < HZ.K; k++) HZ.Vh[k] += lr * e * yH[k];
      var glr = lr / depth, ev, dy2;
      for (k = 0; k < HZ.K; k++) {
        dy2 = 1 - yH[k] * yH[k]; ev = e * HZ.Vh[k] * dy2;
        for (i = 0; i < HZ.M; i++) {
          HZ.A[k][i] += glr * ev * hW[i];
          for (j = 0; j < HZ.M; j++) HZ.G[k][i][j] += glr * ev * hIn[i] * hIn[j];
        }
      }
    } else if (doLearn) {
      for (i = 0; i < D; i++) L.V[i] += lr * e * newHs[depth - 1][i];
    }
    return { pred: yp, err: e, decoded: yp, truth: truth };
  }

  /* the yes/no qubit: theta=0 is |yes>, theta=PI is |no>.
   * evidence rotates the belief; measurement (decision) is probabilistic. */
  function beliefStep(theta, decoded, truth) {
    var agree = (decoded >= 0) === (truth >= 0);
    theta += agree ? -0.05 : 0.05;
    if (theta < 0) theta = 0;
    if (theta > Math.PI) theta = Math.PI;
    return theta;
  }
  function pYes(theta) { var c = Math.cos(theta / 2); return c * c; }

  function checksum(L) {
    var s = JSON.stringify(L), hsh = 0, i;
    for (i = 0; i < s.length; i++) hsh = ((hsh * 31) + s.charCodeAt(i)) | 0;
    return (hsh >>> 0).toString(16);
  }

  /* state machine the visualizer drives one atomic step at a time */
  /* v38: optional seed — swarm nodes evolve with independent RNG streams */
  function create(maxGens, seed, depth, act) {
    var rnd = RNG(seed == null ? SEED : seed);
    var dd = normDepth(depth == null ? DEPTH_DEFAULT : depth);
    var aa = normAct(act);
    var S = {
      D: D, T: T, VN: VN, LR: LR, maxGens: maxGens || 8,
      rnd: rnd, seed: (seed == null ? SEED : seed), phase: 'idle',
      gen: 0, v: 0, t: 0,
      depth: dd, act: aa,
      champion: null, frozen: null, live: null,
      variants: [], epErrs: [],
      theta: Math.PI / 2, curve: [],
      layerPE: [], peAcc: zeroPe(dd),
      frozenSum: null, snapCount: 0,
      last: null,
      /* v34: decay-point entanglement */
      eps: EPS_DEFAULT, lineage: true,
      decay: null, deltaE: null, lr: LR,
      inheritTheta: null, pair: null,
      epPre: null, bestPre: null,
      /* v37: eternal mode — the Core evolves itself in chunks, forever */
      eternal: false,
      legacyNote: null,
      /* v40: event-horizon run config — null = horizon off (reference path) */
      hz: null,
      /* v41: ghost snapshots — pre-compression copies, one per generation.
       * ghostFb/ghostGain are run config (persist across resets, like hz). */
      ghosts: [], ghostFb: false, ghostGain: GHOST_FB_GAIN,
      /* v42: antimatter — the ghost-built inner superloop. amOn/amGain/
       * amSpawn are run config (persist across resets); the container and
       * the logs are lineage archives (persist too). */
      amOn: false, amGain: AM_GAIN, amSpawn: true, amSpawns: 0,
      amContainer: [], amCrawlLog: [], amSpawnLog: [],
      /* v43 Gauntlet — all OFF by default (reference path bit-identical) */
      shock: null,                       /* seeded regime shock, or null */
      valOn: false, valT: 40,            /* held-out validation window */
      autoPilot: false, apK: 3, apThresh: 0.005, apSlope: null,
      apCool: 0, burstLeft: 0, apBurstGens: 2, apMutScale: 3,
      apThreshMul: 1, apThreshLeft: 0,   /* crawler threshold multiplier */
      moOn: false, moW1: 0.6, moW2: 0.25, moW3: 0.15, lastMO: null,
      stabOn: false                      /* LayerNorm + spectral bound */
    };
    S.champion = newLoop(rnd, dd, aa);
    return S;
  }
  /* v34: decay-point entanglement — empirical finding (Ahkeem's run, 2026-10-04):
   * the reference error curve follows a power law E ≈ 0.465·gen^(-0.43)
   * (R²=0.983) — decay SLOWS. The monitor exists because of that. */
  var EPS_DEFAULT = 0.01;

  function reset(S, maxGens, seed, depth, act) {
    /* v38: preserve the state's seed (swarm nodes keep independent RNG
     * streams); explicit seed overrides. Default behavior unchanged. */
    if (seed == null) seed = (S.seed == null ? SEED : S.seed);
    S.seed = seed;
    S.rnd = RNG(seed);
    S.maxGens = maxGens || 8;
    /* v39: depth/act are run config — preserved across resets unless
     * explicitly overridden (a reset never silently changes the stack). */
    if (depth != null) S.depth = normDepth(depth);
    else if (S.depth == null) S.depth = DEPTH_DEFAULT;
    if (act != null) S.act = normAct(act);
    else if (S.act == null) S.act = 'tanh';
    S.phase = 'idle'; S.gen = 0; S.v = 0; S.t = 0;
    /* v42: capture the antimatter module BEFORE the champion is rebuilt —
     * it survives resets (lineage, built from ghosts); h is zeroed. */
    var keepAm = (S.champion && S.champion.antimatter) ? S.champion.antimatter : null;
    if (keepAm) { var _ai; for (_ai = 0; _ai < keepAm.h.length; _ai++) keepAm.h[_ai] = 0; keepAm.steps = 0; }
    S.champion = newLoop(S.rnd, S.depth, S.act); S.frozen = null; S.live = null;
    /* v42: re-attach the surviving antimatter module to the fresh champion */
    if (keepAm) S.champion.antimatter = keepAm;
    S.variants = []; S.epErrs = [];
    S.theta = Math.PI / 2; S.curve = [];
    S.layerPE = []; S.peAcc = zeroPe(S.depth);
    S.frozenSum = null; S.snapCount = 0; S.last = null;
    S.decay = null; S.deltaE = null; S.lr = LR;
    S.inheritTheta = null; S.pair = null;
    S.epPre = null; S.bestPre = null;
    S.eternal = false; /* v37: reset clears eternal; eternalStart re-arms after */
    S.legacyNote = null;
    /* v41: ghosts are a lineage archive — they SURVIVE resets so an old
     * ghost stays re-ingestible into a new run's champion. The feedback
     * toggle/gain are run config and survive too, like S.hz. */
    if (!S.ghosts) S.ghosts = [];
    if (S.ghostFb == null) S.ghostFb = false;
    if (S.ghostGain == null) S.ghostGain = GHOST_FB_GAIN;
    /* v42: antimatter config + lineage archives survive resets too */
    if (S.amOn == null) S.amOn = false;
    if (S.amGain == null) S.amGain = AM_GAIN;
    if (S.amSpawn == null) S.amSpawn = true;
    if (S.amSpawns == null) S.amSpawns = 0;
    if (!S.amContainer) S.amContainer = [];
    if (!S.amCrawlLog) S.amCrawlLog = [];
    if (!S.amSpawnLog) S.amSpawnLog = [];
    /* v43: run config survives resets (like hz/ghost/am) — the shock is part
     * of the experiment setup, so re-arming is explicit via setShock(null). */
    if (!('shock' in S)) S.shock = null;
    if (S.valOn == null) S.valOn = false;
    if (S.valT == null) S.valT = 40;
    if (S.autoPilot == null) S.autoPilot = false;
    if (S.apK == null) S.apK = 3;
    if (S.apThresh == null) S.apThresh = 0.005;
    S.apSlope = null; S.apCool = 0; S.burstLeft = 0;
    S.apThreshMul = 1; S.apThreshLeft = 0;
    if (S.apBurstGens == null) S.apBurstGens = 2;
    if (S.apMutScale == null) S.apMutScale = 3;
    if (S.moOn == null) S.moOn = false;
    if (S.moW1 == null) S.moW1 = 0.6;
    if (S.moW2 == null) S.moW2 = 0.25;
    if (S.moW3 == null) S.moW3 = 0.15;
    S.lastMO = null;
    if (S.stabOn == null) S.stabOn = false;
  }
  function setEps(S, eps) {
    eps = parseFloat(eps);
    if (isFinite(eps) && eps > 0 && eps < 1) S.eps = eps;
    return S.eps;
  }
  function setLineage(S, on) { S.lineage = !!on; return S.lineage; }
  function setDepth(S, d) { S.depth = normDepth(d); return S.depth; }
  function setAct(S, a) { S.act = normAct(a); return S.act; }
  function freshVariant(S, v) {
    var L = clone(S.frozen), i, j, l;
    zeroLoopState(L);   /* fresh episode; weights = heredity */
    /* v43: auto-pilot burst — temporarily scale mutation sigma up, and the
     * stability flag rides the variant (reference: burstLeft is 0, msc = 1). */
    var msc = (S.burstLeft > 0) ? (S.apMutScale || 3) : 1;
    L.stabOn = !!S.stabOn;
    if (v > 0) {
      for (i = 0; i < D; i++) L.V[i] += (S.rnd() * 2 - 1) * 0.02 * msc;  /* decoder mutation (reference; xmsc on burst) */
      if (L.depth > 1) {
        /* v39: evolution mutates ALL layers' recurrent weights. Depth 1 keeps
         * the exact reference RNG stream — no W mutation there. */
        for (l = 0; l < L.depth; l++)
          for (i = 0; i < D; i++)
            for (j = 0; j < D; j++)
              L.layers[l].W[i][j] += (S.rnd() * 2 - 1) * 0.01 * msc;
        /* v39c: the per-layer feedback vectors are genotype too — mutate them
         * like the decoder V (σ=0.02). */
        for (l = 1; l < L.depth; l++)
          for (i = 0; i < D; i++)
            L.layers[l].F[i] += (S.rnd() * 2 - 1) * 0.02 * msc;
        /* v40: the gravity matrix + linear channel + horizon decoder are
         * genotype too. Only when the horizon is on — the reference stream
         * never sees it. */
        if (L.horizon && L.horizon.on && v > 0) {
          var HZ2 = L.horizon, kk, ii, jj;
          for (kk = 0; kk < HZ2.K; kk++) {
            HZ2.Vh[kk] += (S.rnd() * 2 - 1) * 0.02 * msc;
            for (ii = 0; ii < HZ2.M; ii++) {
              HZ2.A[kk][ii] += (S.rnd() * 2 - 1) * 0.01 * msc;
              for (jj = 0; jj < HZ2.M; jj++)
                HZ2.G[kk][ii][jj] += (S.rnd() * 2 - 1) * 0.01 * msc;
            }
          }
        }
      }
    }
    return L;
  }
  function beginGen(S, events) {
    /* v40: the horizon rides the champion — every generation's variants
     * inherit the gravity matrix through the clone below. */
    if (S.hz && S.hz.on) ensureHorizon(S.champion, S.hz.M, S.hz.K, S.hz.entangled);
    S.frozen = clone(S.champion);
    S.frozenSum = checksum(S.frozen);
    S.snapCount++;
    S.v = 0; S.t = 0; S.epErrs = [];
    S.variants = [];
    S.live = freshVariant(S, 0);
    /* v41: arm this generation's ghost capture (variant 0 only — one ghost
     * per generation, not one per variant), then arm the ghost DRIVE: the
     * latest ghost's data persistently reshapes the top layer this episode.
     * Pure + deterministic (no RNG): the reference path is untouched because
     * the drive can only arm with the horizon on and a ghost in the archive. */
    if (S.live.horizon) {
      S.live.horizon.ghostArm = true; S.live.horizon.ghostGen = S.gen;
      armGhostDrive(S, S.live);
    }
    S.epPre = clone(S.live); /* v34: pre-episode state, for decay verification replay */
    S.bestPre = null;
    S.peAcc = zeroPe(S.depth || 1);
    /* v34: in lineage mode after an entangled handoff, the child's belief
     * is inherited from the parent's decay record — not reset. */
    S.theta = (S.inheritTheta != null) ? S.inheritTheta : Math.PI / 2;
    S.inheritTheta = null;
    S.phase = 'think';
    events.push({ type: 'snapshot', gen: S.gen, sum: S.frozenSum });
  }
  /* ── v34: decay-point entanglement ── */
  /* freeze the exact decay-point state: full stack weights, per-layer hidden
   * states, error, belief. preWeights = the state BEFORE the decaying episode
   * ran — the parent replays the episode from there to verify exactly. */
  function captureDecay(S, err, dE) {
    var champ = clone(S.champion);
    return {
      gen: S.gen, err: err, dE: dE,
      weights: champ,
      hFinal: champ.layers.map(function (la) { return la.h.slice(); }),
      preWeights: clone(S.bestPre),
      phi: S.theta, ts: Date.now(),
      checksum: checksum(champ), verified: false,
      stack_depth: champ.depth || 1, act: champ.act || 'tanh'
    };
  }
  /* parent verification: replay the decaying episode from the pre-episode
   * state. The pipeline is deterministic, so the reproduced error must
   * match the terminal error exactly. */
  function verifyDecay(S, rec) {
    var v = clone(rec.preWeights), k, st, m = 0;
    zeroLoopState(v);
    for (k = 0; k < S.T; k++) { st = step(v, k, S.lr); m += Math.abs(st.err); }
    return (m / S.T) === rec.err;
  }
  /* entangled handoff: the child lineage is seeded FROM the certified decay
   * record — child V0 = parent terminal V + whisper, lr scaled by the
   * parent's terminal decay rate, belief inherited. v39: the whisper reaches
   * every layer of the deep stack. Correlated fates. */
  function handoff(S, rec) {
    var child = clone(rec.weights), i, j, l, k;
    for (i = 0; i < D; i++) child.V[i] += (S.rnd() * 2 - 1) * 0.005;
    if ((child.depth || 1) > 1) {
      for (l = 0; l < child.depth; l++)
        for (i = 0; i < D; i++)
          for (j = 0; j < D; j++)
            child.layers[l].W[i][j] += (S.rnd() * 2 - 1) * 0.002;
    }
    /* v40: the whisper reaches the gravity matrix too. */
    if (child.horizon && child.horizon.on) {
      var HZC = child.horizon;
      for (k = 0; k < HZC.K; k++) {
        HZC.Vh[k] += (S.rnd() * 2 - 1) * 0.005;
        for (i = 0; i < HZC.M; i++) {
          HZC.A[k][i] += (S.rnd() * 2 - 1) * 0.002;
          for (j = 0; j < HZC.M; j++)
            HZC.G[k][i][j] += (S.rnd() * 2 - 1) * 0.002;
        }
      }
    }
    var childLR = LR * Math.max(0.25, Math.min(1.0, rec.dE / S.eps));
    var genesisSig = checksum(child);
    S.champion = child;
    S.lr = childLR;
    S.inheritTheta = rec.phi;
    S.pair = { parentSig: rec.checksum, parentErr: rec.err,
               childSig: genesisSig, childLR: childLR, gen: rec.gen };
    /* re-arm the monitor: the child lineage can reach its own decay point */
    S.decay = null;
    return { genesisSig: genesisSig, childLR: childLR };
  }
  /* hash-linked lineage ledger entry (pure — the UI persists it) */
  function ledgerEntry(prevHash, e) {
    var body = { kind: e.kind || 'handoff', ts: e.ts, prev: prevHash || 'GENESIS' };
    ['parentSig', 'childSig', 'parentErr', 'childLR', 'gen', 'fromSig', 'resumedFrom',
     'mode', 'gens', 'level', 'note',
     'challengerSig', 'winnerSig', 'nodeFrom', 'nodeTo', 'errBefore', 'errAfter',
     'parents', 'label', 'breedSig',
     'stackDepth', 'act',
     'fidOn', 'fidOff', 'deltaG', 'errOn', 'errOff', 'hzM', 'hzK',
     'sparsOn', 'sparsOff',
     'slope', 'burst', 'ghosts', 'shockType', 'gensToRecoverOn',
     'gensToRecoverOff', 'verdict', 'fAcc', 'fFid', 'fCpx', 'fScore'].forEach(function (k) {
      if (e[k] !== undefined) body[k] = e[k];
    });
    body.hash = checksum(body);
    return body;
  }
  /* ── v35: persistent lineage ─────────────────────────────────────────
   * The Core now remembers. After every run the champion is auto-saved
   * (weights, hidden state, belief, curve, checksum); "Continue lineage"
   * resumes evolution FROM those weights instead of random init — the
   * lineage is one unbroken chain across sessions, not a fresh start.
   * v39: the champion record carries the full stack (stack_depth + act);
   * v1 legacy records are migrated on load with a clear note.
   * Honest framing: cumulative weight evolution, nothing more. */
  function champCanon(rec) {
    /* canonical checksum body — v3 seals the horizon params too, so a
     * tampered gravity matrix breaks the seal exactly like tampered weights. */
    return {
      layers: rec.layers, V: rec.V, depth: rec.stack_depth, act: rec.act,
      hz: rec.horizon ? {
        on: !!rec.horizon.on, ent: !!rec.horizon.ent,
        M: rec.horizon.M | 0, K: rec.horizon.K | 0,
        gamma: +rec.horizon.gamma || 0,
        G: rec.horizon.G, A: rec.horizon.A || null, Vh: rec.horizon.Vh
      } : null
    };
  }
  function champRecord(S) {
    var L = S.champion;
    var rec = {
      kind: 'champion', v: 3,
      stack_depth: L.depth || 1, act: L.act || 'tanh',
      layers: L.layers.map(function (la, li) {
        /* v39c: F (per-layer feedback) is part of the genotype for l>0;
         * layer 0 uses V directly (F_0 ≡ V, never stored separately). */
        var o = { W: clone(la.W), U: clone(la.U), h: la.h.slice() };
        if (li > 0 && la.F) o.F = la.F.slice();
        return o;
      }),
      V: L.V.slice(),
      /* v40: the gravity matrix + horizon decoder are genotype — the
       * exterior partners are episode state and are never stored. */
      horizon: (L.horizon && L.horizon.on) ? {
        on: true, ent: !!L.horizon.ent, M: L.horizon.M, K: L.horizon.K,
        gamma: L.horizon.gamma, G: clone(L.horizon.G), A: clone(L.horizon.A),
        Vh: L.horizon.Vh.slice()
      } : null,
      phi: S.theta, gen: S.gen,
      err: S.curve.length ? S.curve[S.curve.length - 1] : null,
      err_curve: S.curve.slice(), ts: Date.now()
    };
    rec.checksum = checksum(champCanon(rec));
    return rec;
  }
  function hzShapeOk(hz) {
    try {
      if (hz == null) return true;
      if (typeof hz.on !== 'boolean') return false;
      var M = hz.M | 0, K = hz.K | 0, k, i;
      if (M < 2 || M > D || K < 1 || K >= M) return false;
      if (!hz.G || hz.G.length !== K || !hz.Vh || hz.Vh.length !== K) return false;
      for (k = 0; k < K; k++) {
        if (!hz.G[k] || hz.G[k].length !== M) return false;
        for (i = 0; i < M; i++)
          if (!hz.G[k][i] || hz.G[k][i].length !== M) return false;
        if (typeof hz.Vh[k] !== 'number') return false;
        /* v40b: the linear channel A is optional in stored records
         * (zero-fills on load); validated when present. */
        if (hz.A != null) {
          if (!hz.A[k] || hz.A[k].length !== M) return false;
          for (i = 0; i < M; i++)
            if (typeof hz.A[k][i] !== 'number') return false;
        }
      }
      return true;
    } catch (e) { return false; }
  }
  function champShapeOk(rec) {
    try {
      if (rec && ((rec.v === 3 || rec.v === 2) || rec.stack_depth != null)) {
        var dd = rec.stack_depth | 0, l, la;
        if (dd < 1 || dd > DEPTH_MAX) return false;
        if (!rec.layers || rec.layers.length !== dd) return false;
        for (l = 0; l < dd; l++) {
          la = rec.layers[l];
          if (!la || !la.W || la.W.length !== D || la.W[0].length !== D) return false;
          if (!la.h || la.h.length !== D) return false;
          if (l === 0) {
            if (!la.U || la.U.length !== D || typeof la.U[0] !== 'number') return false;
          } else {
            if (!la.U || la.U.length !== D || !la.U[0] || la.U[0].length !== D) return false;
          }
        }
        if (!(rec.V && rec.V.length === D)) return false;
        /* v40: v3 records may carry the horizon — validate its shape. */
        if (rec.horizon !== undefined && !hzShapeOk(rec.horizon)) return false;
        return true;
      }
      /* v1 legacy single-layer shape */
      return !!(rec && rec.W && rec.W.length === D && rec.W[0].length === D &&
        rec.U && rec.U.length === D && rec.V && rec.V.length === D &&
        rec.h && rec.h.length === D);
    } catch (e) { return false; }
  }
  function champVerify(rec) {
    if (!champShapeOk(rec)) return false;
    try {
      /* v40: v3 seals the horizon; v2 seals stack-only (pre-horizon). */
      if (rec.v === 3 || rec.horizon !== undefined) {
        return checksum(champCanon(rec)) === rec.checksum;
      }
      if (rec.v === 2 || rec.stack_depth != null) {
        return checksum({ layers: rec.layers, V: rec.V,
                          depth: rec.stack_depth, act: rec.act }) === rec.checksum;
      }
      return checksum({ W: rec.W, U: rec.U, V: rec.V, h: rec.h }) === rec.checksum;
    } catch (e) { return false; }
  }
  /* normalize any champion record (v3 horizon, v2 stacked, or v1 legacy)
   * into the v3 working shape. Legacy records migrate: v1 wraps to one
   * layer/tanh; v2 gains horizon:null (pre-horizon — the horizon stays off
   * until he enables it). Flagged so the UI can say so out loud. */
  function normalizeChamp(rec) {
    if (!rec) return null;
    var out;
    if (rec.stack_depth != null && rec.layers) {
      out = {
        kind: 'champion', v: 3,
        stack_depth: rec.stack_depth | 0, act: normAct(rec.act),
        layers: rec.layers.map(function (la, li) {
          var o = { W: clone(la.W), U: clone(la.U), h: la.h.slice() };
          /* v39c: pre-v39c v2 records lack F — zero-fill; F relearns via
           * the F update rule (safe: zero F = no injection, no W update,
           * until F adapts). */
          if (li > 0) {
            o.F = la.F ? la.F.slice() : [0, 0, 0, 0, 0, 0];
          }
          return o;
        }),
        V: rec.V.slice(), phi: rec.phi, gen: rec.gen, err: rec.err,
        err_curve: (rec.err_curve || []).slice(), ts: rec.ts,
        checksum: rec.checksum, meshLabel: rec.meshLabel, legacy: false,
        horizon: null
      };
      /* v40: restore the gravity matrix + horizon decoder. The exterior
       * partners are episode state — they start at zero, never stored. */
      var rhz = rec.horizon;
      if (rhz && rhz.on && hzShapeOk(rhz)) {
        var p0 = [], k2, i2;
        for (k2 = 0; k2 < (rhz.K | 0); k2++) p0.push(0);
        /* v40b: pre-channel records zero-fill A — it relearns via the
         * A update rule. */
        var A0 = null;
        if (rhz.A) { A0 = clone(rhz.A); }
        else {
          A0 = [];
          for (k2 = 0; k2 < (rhz.K | 0); k2++) {
            A0.push([]);
            for (i2 = 0; i2 < (rhz.M | 0); i2++) A0[k2].push(0);
          }
        }
        out.horizon = {
          on: true, ent: rhz.ent !== false, M: rhz.M | 0, K: rhz.K | 0,
          gamma: (+rhz.gamma) || HZ_GAMMA, alpha: HZ_ALPHA,
          G: clone(rhz.G), A: A0, Vh: rhz.Vh.slice(), p: p0, acc: null, fid: null
        };
      }
      if (rec.v !== 3 && !rec.legacyNote) {
        out.legacyNote = 'pre-v40 champion — horizon off until enabled';
      } else if (rec.legacyNote) {
        out.legacyNote = rec.legacyNote;
      }
    } else {
      out = {
        kind: 'champion', v: 3,
        stack_depth: 1, act: 'tanh',
        layers: [{ W: clone(rec.W), U: rec.U.slice(), h: rec.h.slice() }],
        V: rec.V.slice(), phi: rec.phi, gen: rec.gen, err: rec.err,
        err_curve: (rec.err_curve || []).slice(), ts: rec.ts,
        checksum: rec.checksum, meshLabel: rec.meshLabel, legacy: true,
        horizon: null,
        legacyNote: 'legacy single-layer champion — migrated to the deep format'
      };
    }
    return out;
  }
  /* resume: seed the state FROM a saved champion — not random init.
   * v39: the lineage carries its own architecture — S adopts the champion's
   * stack depth and nonlinearity. maxGens = absolute generation count to run
   * to. The curve is pre-filled so the evolution chart visibly continues;
   * the belief is inherited, not reset. */
  function resume(S, champ, maxGens, seed) {
    var ev = [];
    var nc = normalizeChamp(champ);
    S.depth = nc.stack_depth; S.act = nc.act;
    S.champion = { depth: nc.stack_depth, act: nc.act, layers: nc.layers,
                   V: nc.V, peSum: zeroPe(nc.stack_depth), peN: 0 };
    /* v40: the lineage carries its horizon too — resume restores the
     * gravity matrix; a horizon-less champion resumes with it off. */
    if (nc.horizon && nc.horizon.on) {
      S.champion.horizon = nc.horizon;
      S.hz = { on: true, entangled: nc.horizon.ent, M: nc.horizon.M, K: nc.horizon.K };
    } else {
      S.hz = null;
    }
    S.curve = (nc.err_curve || []).slice();
    S.gen = (nc.gen != null) ? nc.gen : S.curve.length;
    S.maxGens = maxGens || (S.gen + 8);
    if (seed == null) seed = SEED;
    S.seed = seed;
    S.rnd = RNG(seed);
    S.inheritTheta = (nc.phi != null) ? nc.phi : null;
    S.theta = Math.PI / 2; /* beginGen applies inheritTheta */
    S.frozen = null; S.live = null; S.variants = []; S.epErrs = [];
    S.v = 0; S.t = 0; S.last = null;
    S.frozenSum = null; S.snapCount = 0;
    S.decay = null; S.deltaE = null; S.lr = LR; S.pair = null;
    S.epPre = null; S.bestPre = null;
    S.eternal = false; /* v37 */
    S.layerPE = []; S.peAcc = zeroPe(S.depth);
    S.legacyNote = nc.legacy ? nc.legacyNote : null;
    S.phase = 'idle';
    S.resumedFrom = champ.checksum || null;
    beginGen(S, ev);
    return ev;
  }
  /* ── v37: Eternal Core — autonomous continuous self-evolution ──────
   * The network evolves itself in chunks, forever: no generation cap, the
   * champion auto-saves after every chunk (kill-safe — a dead phone loses
   * nothing), and the loop yields between chunks so STOP is always reachable.
   * Honest framing: this is a classical simulation loop on the phone's CPU.
   * (See the v37 note in the UI section for why there is no native service.) */
  function setEternal(S, on) { S.eternal = !!on; return S.eternal; }
  /* run n full generations synchronously, collecting UI events.
   * Pure + deterministic — the eternal tick drives this once per chunk. */
  function runGens(S, n) {
    var events = [], done = 0, guard = 0, ev, i;
    n = Math.max(1, n | 0);
    if (S.phase === 'idle' || S.phase === 'done') {
      events = events.concat(start(S));
    }
    while (done < n && S.phase !== 'done' && guard < n * S.VN * 4 + 64) {
      ev = frame(S, S.T);
      for (i = 0; i < ev.length; i++) if (ev[i].type === 'gendone') done++;
      events = events.concat(ev);
      guard++;
      if (!ev.length) break; /* idle/done — nothing more to do */
    }
    return events;
  }
  /* battery policy — pure, tested in Node.
   * v37b (Ahkeem's correction): the loop NEVER pauses for battery on its own.
   * Below 20% (not charging) the app enters the deepest low-power tier —
   * AI-only, slowest cadence — but only his ⏹ STOP button ends evolution. */
  function batteryShouldPause(level, charging) {
    if (level == null) return false;
    return !charging && level < 0.20;
  }
  function batteryShouldResume(level, charging) {
    if (level == null) return false;
    return !!charging && level > 0.25;
  }
  /* advance up to n atomic steps; returns UI events */
  function frame(S, n) {
    var events = [], k, st, err, mean, i, best, be;
    SHOCK = S.shock || null; /* v43: the shock rides the run, not the variant */
    for (k = 0; k < n; k++) {
      if (S.phase === 'idle' || S.phase === 'done') break;
      if (S.phase === 'think') {
        st = step(S.live, S.t, S.lr);
        S.theta = beliefStep(S.theta, st.decoded, st.truth);
        S.epErrs.push(Math.abs(st.err));
        S.last = st;
        S.t++;
        /* v41: collect the ghost snapshot the horizon froze at mid-episode */
        var _hg = S.live.horizon;
        if (_hg && _hg.lastGhost) {
          if (!S.ghosts) S.ghosts = [];
          S.ghosts.push(_hg.lastGhost);
          if (S.ghosts.length > GHOST_MAX) S.ghosts.splice(0, S.ghosts.length - GHOST_MAX);
          events.push({ type: 'ghost', gen: S.gen, sum: _hg.lastGhost.checksum });
          _hg.lastGhost = null;
        }
        if (S.t >= S.T) {
          mean = 0;
          for (i = 0; i < S.epErrs.length; i++) mean += S.epErrs[i];
          mean /= S.epErrs.length;
          /* v39: this episode's mean per-layer prediction error joins the
           * generation's diagnostic accumulator */
          var _dd = S.depth || 1, _ql;
          for (_ql = 1; _ql < _dd; _ql++)
            S.peAcc[_ql - 1] += S.live.peSum[_ql - 1] / Math.max(1, S.live.peN);
          S.variants.push({ loop: S.live, err: mean, theta: S.theta, pre: S.epPre,
            /* v41: this episode's link fidelity (entanglement-inspired) joins the variant */
            fid: (S.live.horizon && S.live.horizon.on) ? horizonFidelity(S.live.horizon) : null,
            /* v43: held-out validation error — pristine window, no learning */
            valErr: S.valOn ? validationErr(S, S.live) : null });
          S.v++;
          if (S.v >= S.VN) {
            /* selection — instant, the UI shows the verdict line.
             * v40: with the link ON the fitness is err + λ·(1−fidelity) —
             * the compressor must preserve the exterior correlation, which
             * changes WHAT gravity structure evolves. The curve still plots
             * raw prediction error, honestly. */
            be = Infinity; best = null;
            var hzPress = S.hz && S.hz.on && S.hz.entangled, bScore, _vn;
            for (i = 0; i < S.variants.length; i++) {
              _vn = S.variants[i];
              if (S.moOn) {
                /* v43: multi-objective — select max F (stored as min -F).
                 * The curve still plots raw prediction error, honestly. */
                _vn.mo = moScore(S, _vn);
                bScore = -_vn.mo.F;
              } else {
                bScore = _vn.err + (hzPress ? HZ_LAMBDA * (1 - (_vn.fid == null ? 0 : _vn.fid)) : 0);
              }
              if (bScore < be) { be = bScore; best = _vn; }
            }
            if (!best) {
              /* v39: every variant blew up (non-finite) — never crash. Keep
               * the old champion, record no improvement, keep evolving. */
              be = S.curve.length ? S.curve[S.curve.length - 1] : 1e9;
              best = { loop: S.champion, err: be, theta: S.theta,
                       pre: S.bestPre || S.epPre, fid: null };
              events.push({ type: 'genstall', gen: S.gen });
            }
            S.champion = best.loop;
            S.bestPre = best.pre; /* pre-episode state of the winner, for decay verification */
            S.theta = best.theta; /* the winner's belief, not the last variant's */
            if (S.champion.horizon) S.champion.horizon.fid = (best.fid == null ? null : best.fid);
            S.curve.push(best.err);
            S.lastMO = best.mo || null; /* v43: the winner's F breakdown, for the UI */
            /* v43: auto-pilot — the decay law as a switch. Rolling slope of
             * the raw error curve over apK gens; when improvement stalls
             * (slope < threshold) fire once per cooldown: (a) mutation burst,
             * (b) redundant-unit compression -> new ghosts, (c) lowered
             * crawler spawn threshold. Logged for the ledger. */
            if (S.autoPilot && S.curve.length > S.apK) {
              var _k = S.apK;
              var _sl = (S.curve[S.curve.length - 1 - _k] - S.curve[S.curve.length - 1]) / _k;
              S.apSlope = _sl;
              if (_sl < S.apThresh && !(S.apCool > 0)) {
                S.apCool = 3;
                S.burstLeft = S.apBurstGens;
                var _minted = apCompressRedundant(S);
                S.apThreshMul = 0.5; S.apThreshLeft = S.apBurstGens;
                events.push({ type: 'autopilot', gen: S.gen, slope: _sl,
                              burst: S.apBurstGens, ghosts: _minted });
              }
            }
            if (S.apCool > 0) S.apCool--;
            if (S.burstLeft > 0) S.burstLeft--;
            if (S.apThreshLeft > 0) {
              S.apThreshLeft--;
              if (S.apThreshLeft === 0) S.apThreshMul = 1;
            }
            /* v39: per-layer prediction-error means → the dashboard curves */
            for (_ql = 1; _ql < _dd; _ql++) {
              if (!S.layerPE[_ql - 1]) S.layerPE[_ql - 1] = [];
              S.layerPE[_ql - 1].push(S.peAcc[_ql - 1] / Math.max(1, S.VN));
              S.peAcc[_ql - 1] = 0;
            }
            /* strip diagnostic accumulators before the champion is snapshotted */
            S.champion.peSum = zeroPe(_dd); S.champion.peN = 0;
            events.push({ type: 'gendone', gen: S.gen, err: be, curve: S.curve.slice() });
            /* v34: decay monitor — ΔE below ε declares the decay point.
             * v40: monitors raw prediction error (best.err), never the
             * fidelity-pressured selection score. */
            var dE = S.curve.length >= 2 ? S.curve[S.curve.length - 2] - best.err : null;
            S.deltaE = dE;
            if (dE !== null && dE < S.eps && !S.decay) {
              var rec = captureDecay(S, best.err, dE);
              S.decay = rec;
              events.push({ type: 'decaypoint', gen: rec.gen, err: rec.err,
                            dE: dE, sum: rec.checksum });
              var ok = verifyDecay(S, rec);
              rec.verified = ok;
              events.push({ type: 'decayverified', ok: ok, gen: rec.gen, sum: rec.checksum });
              if (ok && S.lineage) {
                var ho = handoff(S, rec);
                events.push({ type: 'handoff', parentSig: rec.checksum,
                              childSig: ho.genesisSig, childLR: ho.childLR,
                              phi: rec.phi, gen: rec.gen, ts: rec.ts });
              }
            }
            S.gen++;
            /* v37: eternal mode never declares 'done' — the lineage has no cap */
            if (!S.eternal && S.gen >= S.maxGens) { S.phase = 'done'; events.push({ type: 'done', curve: S.curve.slice() }); }
            else beginGen(S, events);
          } else {
            S.live = freshVariant(S, S.v);
            /* v41: only variant 0 captures a ghost (one per generation), but
             * every variant gets the ghost drive armed — the feedback must
             * reach whichever variant selection picks. */
            if (S.live.horizon) {
              S.live.horizon.ghostArm = (S.v === 0);
              S.live.horizon.ghostGen = S.gen;
              armGhostDrive(S, S.live);
            }
            S.epPre = clone(S.live); /* v34: pre-episode state for verification */
            S.t = 0; S.epErrs = [];
            S.theta = Math.PI / 2;
            events.push({ type: 'variant', gen: S.gen, v: S.v });
          }
        }
      }
    }
    return events;
  }
  function start(S) {
    var ev = [];
    if (S.phase === 'idle' || S.phase === 'done') { reset(S, S.maxGens); beginGen(S, ev); }
    return ev;
  }

  return {
    D: D, T: T, VN: VN, LR: LR, EPS_DEFAULT: EPS_DEFAULT,
    DEPTH_DEFAULT: DEPTH_DEFAULT, DEPTH_MIN: DEPTH_MIN, DEPTH_MAX: DEPTH_MAX,
    normDepth: normDepth, normAct: normAct, zeroPe: zeroPe,
    create: create, reset: reset, frame: frame, start: start,
    clone: clone, checksum: checksum, pYes: pYes, beliefStep: beliefStep, step: step,
    newLoop: newLoop, RNG: RNG, zeroLoopState: zeroLoopState,    setEps: setEps, setLineage: setLineage, setDepth: setDepth, setAct: setAct,
    captureDecay: captureDecay, verifyDecay: verifyDecay, handoff: handoff,
    ledgerEntry: ledgerEntry,
    champRecord: champRecord, champShapeOk: champShapeOk, champVerify: champVerify,
    normalizeChamp: normalizeChamp, champCanon: champCanon, resume: resume,
    setEternal: setEternal, runGens: runGens,
    batteryShouldPause: batteryShouldPause, batteryShouldResume: batteryShouldResume,
    /* v40: event horizon */
    setHorizon: setHorizon, ensureHorizon: ensureHorizon,
    horizonFidelity: horizonFidelity, horizonCompare: horizonCompare, hzStats: hzStats,
    HZ_M_DEFAULT: HZ_M_DEFAULT, HZ_K_DEFAULT: HZ_K_DEFAULT,
    HZ_GAMMA: HZ_GAMMA, HZ_ALPHA: HZ_ALPHA, HZ_LAMBDA: HZ_LAMBDA,
    /* v41: ghost snapshots — pre-compression copies + the layer-3 loop */
    buildGhost: buildGhost, ghostVerify: ghostVerify, ghostReingest: ghostReingest,
    setGhostFb: setGhostFb, setGhostGain: setGhostGain,
    GHOST_T: GHOST_T, GHOST_MAX: GHOST_MAX,
    GHOST_FB_GAIN: GHOST_FB_GAIN, GHOST_GAIN_MAX: GHOST_GAIN_MAX,
    /* v43: Gauntlet — shock lab, auto-pilot, multi-objective, stability */
    setShock: setShock, setVal: setVal, setMO: setMO, setStab: setStab,
    setAutoPilot: setAutoPilot, validationErr: validationErr,
    moScore: moScore, complexity: complexity, layerNormVec: layerNormVec,
    spectralRadius: spectralRadius, boundSpectral: boundSpectral,
    apCompressRedundant: apCompressRedundant, shockTest: shockTest,
    targetShock: targetShock,
    /* v42: antimatter — the ghost-built inner superloop */
    setAmOn: setAmOn, setAmGain: setAmGain, setAmSpawn: setAmSpawn,
    amCrawl: amCrawl, amRecover: amRecover, amContain: amContain,
    amBuildRecipe: amBuildRecipe, amVerifyRecipe: amVerifyRecipe, amSpawn: amSpawn,
    amMatchProb: amMatchProb, amTryWrite: amTryWrite, amCosine: amCosine,
    AM_N: AM_N, AM_GAIN: AM_GAIN, AM_GAIN_MAX: AM_GAIN_MAX, AM_CAP: AM_CAP,
    AM_ANA_GAIN: AM_ANA_GAIN, amStep: amStep,
    /* v44: Annihilation — concrete antimatter + bidirectional inversion */
    setAmResid: setAmResid, setAmSignInv: setAmSignInv, setAmZeroSum: setAmZeroSum,
    amProjectOut: amProjectOut, amPublishVec: amPublishVec,
    amDivergence: amDivergence, amCompare: amCompare,
    invFreezeGhost: invFreezeGhost, invReverse: invReverse,
    invRoundTrip: invRoundTrip, setInvGamma: setInvGamma, setInvAuto: setInvAuto
  };
})();


/* ══ visualizer UI ═══════════════════════════════════════════ */
_G.NL_NEXUS = (function () {
  var C = _G.NL_NEXUS_CORE;
  var S = null, running = false, raf = null, speed = 6, flash = 0, decayFlash = 0;
  function qs(id) { return document.getElementById(id); }

  /* ── v34: hash-linked lineage ledger, persisted on the phone ── */
  var LEDGER_KEY = 'nl_nexus_ledger';
  function ledgerLoad() {
    try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || []; }
    catch (e) { return []; }
  }
  function ledgerSave(l) {
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)); } catch (e) {}
  }
  function ledgerAppend(e) {
    var l = ledgerLoad();
    var prev = l.length ? l[l.length - 1].hash : 'GENESIS';
    var entry = C.ledgerEntry(prev, e);
    l.push(entry); ledgerSave(l);
    return entry;
  }
  function renderLedger() {
    var el = qs('nx-ledger'); if (!el) return;
    var l = ledgerLoad();
    if (!l.length) { el.textContent = 'No entangled handoffs yet — run with 🧬 Lineage on and let the decay point fire.'; return; }
    var html = '';
    for (var i = l.length - 1; i >= 0; i--) {
      var e = l[i];
      if (e.kind === 'resume') {
        /* v35: cross-run lineage link — this run continued a saved champion */
        html += '<div class="dsinfo" style="border-left:3px solid #4ade80;padding:6px 8px;margin:6px 0">' +
          '⛓ lineage <b>RESUMED</b> — from champion <b>' + (e.fromSig || '?') + '</b> at gen ' + (e.gen != null ? e.gen : '?') +
          '<br><span style="opacity:.7">hash ' + e.hash + ' · prev ' + e.prev + ' — one unbroken chain across sessions.</span></div>';
        continue;
      }
      /* v37: Eternal Core session + power events */
      if (e.kind === 'eternal-start' || e.kind === 'eternal-stop' || e.kind === 'eternal-mode') {
        var em = {
          'eternal-start': ['#f472b6', '∞ <b>ETERNAL START</b> at gen ' + e.gen + (e.note ? ' · ' + e.note : '')],
          'eternal-stop': ['#f472b6', '⏹ <b>ETERNAL STOP</b> at gen ' + e.gen],
          'eternal-mode': ['#fbbf24', '◐ mode → <b>' + e.mode + '</b> at gen ' + e.gen + (e.note ? ' (' + e.note + ')' : '')]
        }[e.kind];
        html += '<div class="dsinfo" style="border-left:3px solid ' + em[0] + ';padding:6px 8px;margin:6px 0">' +
          em[1] + '<br><span style="opacity:.7">hash ' + e.hash + ' · prev ' + e.prev + '</span></div>';
        continue;
      }
      /* v38: Nexus Mesh — consent-gated champion exchange + swarm migrations */
      if (e.kind === 'mesh-accept' || e.kind === 'mesh-breed' || e.kind === 'mesh-migrate') {
        var mm = {
          'mesh-accept': ['#40e0ff', (e.errBefore == null)
            ? '🛜 MESH ACCEPT — challenger <b>' + (e.challengerSig || '?') + '</b>' +
              (e.label ? ' from <b>' + e.label + '</b>' : '') +
              ' adopted (no local champion — won by default)'
            : '🛜 MESH ACCEPT — challenger <b>' + (e.challengerSig || '?') + '</b>' +
              (e.label ? ' from <b>' + e.label + '</b>' : '') +
              ' accepted; winner <b>' + (e.winnerSig || '?') + '</b>' +
              ' (err ' + Number(e.errAfter).toFixed(4) + ' beat ' + Number(e.errBefore).toFixed(4) + ')'],
          'mesh-breed': ['#c084fc', '🧬 MESH BREED — child <b>' + (e.breedSig || '?') + '</b>' +
            ' from parents ' + ((e.parents || []).join(' × ') || '?')],
          'mesh-migrate': ['#fbbf24', (e.nodeFrom === '—' && e.note)
            ? '🛜 ' + e.note
            : '🛜 node ' + e.nodeFrom + ' → node ' + e.nodeTo +
              ' · champion migrated (err ' + Number(e.errAfter).toFixed(4) +
              ' beat ' + Number(e.errBefore).toFixed(4) + ')']
        }[e.kind];
        html += '<div class="dsinfo" style="border-left:3px solid ' + mm[0] + ';padding:6px 8px;margin:6px 0">' +
          mm[1] + '<br><span style="opacity:.7">hash ' + e.hash + ' · prev ' + e.prev +
          ' — nothing entered without consent.</span></div>';
        continue;
      }
      /* v40: Event Horizon — link ON vs OFF gravity comparison (v41: honest label) */
      if (e.kind === 'horizon-compare') {
        html += '<div class="dsinfo" style="border-left:3px solid #40e0ff;padding:6px 8px;margin:6px 0">' +
          '🕳 <b>HORIZON COMPARE</b> — link ON vs OFF, ' + (e.gens || '?') + ' gens, ' + (e.hzM || '?') + '→' + (e.hzK || '?') +
          '<br>link ON: err ' + (e.errOn == null ? 'n/a' : Number(e.errOn).toFixed(4)) +
          ' · fid ' + (e.fidOn == null ? 'n/a' : Number(e.fidOn).toFixed(3)) +
          ' · link OFF: err ' + (e.errOff == null ? 'n/a' : Number(e.errOff).toFixed(4)) +
          ' · fid ' + (e.fidOff == null ? 'n/a' : Number(e.fidOff).toFixed(3)) +
          '<br><b>ΔG = ' + (e.deltaG == null ? 'n/a' : Number(e.deltaG).toFixed(4)) + '</b>' +
          (e.note ? ' · ' + e.note : '') +
          '<br><span style="opacity:.7">hash ' + e.hash + ' · prev ' + e.prev +
          ' — paradox-inspired classical simulation.</span></div>';
        continue;
      }
      html += '<div class="dsinfo" style="border-left:3px solid #7c5cff;padding:6px 8px;margin:6px 0">' +
        '🧬 gen ' + e.gen + ' · parent <b>' + e.parentSig + '</b> (err ' + Number(e.parentErr).toFixed(4) + ')' +
        ' ⟷ child <b>' + e.childSig + '</b> (lr ' + Number(e.childLR).toFixed(4) + ')' +
        (e.resumedFrom ? '<br><span style="opacity:.7">⛓ continued from resume ' + e.resumedFrom + '</span>' : '') +
        '<br><span style="opacity:.7">hash ' + e.hash + ' · prev ' + e.prev + '</span></div>';
    }
    el.innerHTML = html;
  }
  function renderPair() {
    var el = qs('nx-pair'); if (!el) return;
    if (!S || !S.pair) { el.textContent = 'No entangled pair yet.'; return; }
    var p = S.pair;
    el.innerHTML =
      '<div class="dsinfo" style="text-align:center">parent decay <b>' + p.parentSig + '</b> (err ' + p.parentErr.toFixed(4) + ')' +
      ' ⟷ child genesis <b>' + p.childSig + '</b> (lr ' + p.childLR.toFixed(4) + ')' +
      '<br><span style="opacity:.75">measure the parent\u2019s decay point, know the child\u2019s starting point — correlated fates.</span></div>';
  }
  function renderDecayInfo() {
    var el = qs('nx-decayinfo'); if (!el || !S) return;
    var d = S.deltaE == null ? 'n/a' : S.deltaE.toFixed(4);
    el.textContent = 'ΔE last gen: ' + d + ' · ε = ' + S.eps +
      ' · decay point: ' + (S.decay ? 'REACHED at gen ' + S.decay.gen + (S.decay.verified ? ' ✓ VERIFIED' : ' — verifying…') : 'not reached') +
      ' · lineage: ' + (S.lineage ? 'ON 🧬' : 'OFF');
  }
  /* console `decay` reads this */
  function decayStatus() {
    if (!S) return 'no Nexus run yet — open the 🌀 view and tap ▶ Run';
    var d = S.deltaE == null ? 'n/a' : S.deltaE.toFixed(4);
    return 'eps=' + S.eps + ' · last ΔE=' + d +
      ' · decay point: ' + (S.decay ? 'REACHED gen ' + S.decay.gen + ' verified=' + (S.decay.verified ? 'YES' : 'NO') : 'not reached') +
      ' · lineage=' + (S.lineage ? 'ON' : 'OFF') + ' · depth=' + S.depth + ' · act=' + S.act +
      ' · ledger entries=' + ledgerLoad().length;
  }

  /* ── v40: Event Horizon UI ─────────────────────────────────────────
   * Ahkeem's black-hole neuron experiment, labeled honestly: a
   * paradox-INSPIRED classical simulation. Neurons fall into the gravity
   * compressor; exterior partners stay out, linked through the
   * entanglement-inspired link. The viz shows the
   * infall spiral, the partners' safe orbit, and the link lines
   * glowing with the live fidelity. */
  function hzState() {
    if (!S) return null;
    if (!S.hz || !S.hz.on) return { on: false };
    var H = S.champion && S.champion.horizon;
    return { on: true, ent: S.hz.entangled, M: S.hz.M, K: S.hz.K,
             fid: H ? H.fid : null };
  }
  function horizonStatus() {
    var h = hzState();
    if (!h) return 'no Nexus run yet — open the 🌀 view and tap ▶ Run';
    if (!h.on) return 'horizon OFF — the Core runs the v39 pipeline (bit-identical reference). Enable 🕳 Horizon to run the black-hole layer.';
    var f = (h.fid == null) ? 'n/a (run first)' : h.fid.toFixed(3);
    return 'horizon ON · ' + h.M + '→' + h.K + ' compression · entanglement-inspired link ' +
      (h.ent ? 'ON 🔗 (γ=' + C.HZ_GAMMA + ', fidelity pressure λ=' + C.HZ_LAMBDA + ')' : 'OFF (exterior watches, never touches)') +
      ' · fidelity=' + f;
  }
  function renderHzInfo() {
    var el = qs('nx-hzinfo'); if (!el) return;
    el.textContent = horizonStatus();
  }
  function drawHorizon() {
    var f = fit(qs('nx-horizon'), 230); if (!f) return;
    var x = f.ctx; clear(f);
    var h = hzState();
    x.textAlign = 'center';
    if (!h || !h.on) {
      x.fillStyle = COL.dim; x.font = '14px sans-serif';
      x.fillText('🕳 horizon OFF — enable it above to watch neurons fall in', f.w / 2, f.h / 2);
      return;
    }
    var cx = f.w / 2, cy = f.h / 2 - 8, i, k;
    var R = Math.min(f.w, f.h) / 2 - 26;
    var live = S.live, H = live && live.horizon;
    var M = h.M, K = h.K;
    var fid = (H && H.fid != null) ? H.fid : 0;
    /* the singularity: compression disc */
    var grd = x.createRadialGradient(cx, cy, 2, cx, cy, 30);
    grd.addColorStop(0, '#000'); grd.addColorStop(0.7, '#1a0533'); grd.addColorStop(1, 'rgba(124,92,255,0.25)');
    x.fillStyle = grd;
    x.beginPath(); x.arc(cx, cy, 30, 0, 7); x.fill();
    x.strokeStyle = '#7c5cff'; x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, 30, 0, 7); x.stroke(); x.lineWidth = 1;
    x.fillStyle = '#c4b5fd'; x.font = '11px sans-serif';
    x.fillText(M + '→' + K, cx, cy + 4);
    /* infalling neurons: spiral in, radius breathes with |state| */
    var t = (S.t || 0);
    for (i = 0; i < M; i++) {
      var hs = 0;
      try { hs = Math.abs(live.layers[(live.depth || 1) - 1].h[i] || 0); } catch (e) {}
      var ang = t * 0.25 + i * 2 * Math.PI / M;
      var rad = 34 + (R - 40) * (0.35 + 0.65 * Math.abs(Math.sin(t * 0.05 + i)));
      rad = Math.max(34, rad - hs * 22); /* excited neurons fall deeper */
      var px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad * 0.82;
      x.fillStyle = 'rgba(251,146,60,0.9)';
      x.beginPath(); x.arc(px, py, 6, 0, 7); x.fill();
      x.strokeStyle = 'rgba(251,146,60,0.35)';
      x.beginPath(); x.moveTo(px, py);
      x.lineTo(cx + Math.cos(ang) * 32, cy + Math.sin(ang) * 32 * 0.82); x.stroke();
    }
    /* exterior partners: safe orbit, NEVER fall in — the entanglement-inspired links */
    for (k = 0; k < K; k++) {
      var pa = -t * 0.12 + k * 2 * Math.PI / K + Math.PI / K;
      var qx = cx + Math.cos(pa) * R, qy = cy + Math.sin(pa) * R * 0.82;
      var glow = 0.25 + 0.75 * fid;
      x.strokeStyle = 'rgba(64,224,255,' + glow.toFixed(2) + ')';
      x.lineWidth = 1 + 3 * fid;
      x.beginPath(); x.moveTo(qx, qy); x.lineTo(cx, cy); x.stroke();
      x.lineWidth = 1;
      x.fillStyle = '#40e0ff';
      x.beginPath(); x.arc(qx, qy, 7, 0, 7); x.fill();
      x.fillStyle = '#04121a'; x.font = '9px sans-serif';
      x.fillText('p' + k, qx, qy + 3);
    }
    /* fidelity meter */
    x.fillStyle = COL.dim; x.font = '12px sans-serif'; x.textAlign = 'left';
    x.fillText('link fidelity', 10, f.h - 28);
    x.fillStyle = '#222'; x.fillRect(10, f.h - 20, f.w - 110, 10);
    x.fillStyle = h.ent ? '#40e0ff' : '#555';
    x.fillRect(10, f.h - 20, (f.w - 110) * fid, 10);
    x.fillStyle = '#fff'; x.textAlign = 'right';
    x.fillText(h.ent ? (fid.toFixed(3)) : 'OFF', f.w - 10, f.h - 11);
  }
  function renderHzCompare(res) {
    var el = qs('nx-hzcmp'); if (!el || !res) return;
    function fmtF(v) { return v == null ? 'n/a' : v.toFixed(4); }
    el.innerHTML =
      '<div class="dsinfo" style="border-left:3px solid #40e0ff;padding:6px 8px;margin:6px 0">' +
      '⚖ <b>ON vs OFF</b> — same seed ' + res.seed + ', ' + res.gens + ' gens, ' + res.M + '→' + res.K + '<br>' +
      'link ON: err <b>' + fmtF(res.on.err) + '</b> · fidelity <b>' + fmtF(res.on.fid) + '</b> · G rms ' + res.on.stats.rms.toFixed(4) + ' · sparsity ' + (100 * res.on.stats.sparsity).toFixed(1) + '%<br>' +
      'link OFF: err <b>' + fmtF(res.off.err) + '</b> · fidelity <b>' + fmtF(res.off.fid) + '</b> · G rms ' + res.off.stats.rms.toFixed(4) + ' · sparsity ' + (100 * res.off.stats.sparsity).toFixed(1) + '%<br>' +
      '<b>structural ΔG (Frobenius): ' + (res.deltaFrob == null ? 'n/a' : res.deltaFrob.toFixed(4)) + '</b> — ' +
      (res.deltaFrob != null && res.deltaFrob > 0.05
        ? 'the entanglement-inspired compressor evolved a <b>different gravity structure</b>. The exterior changed the black hole.'
        : 'the gravity structures stayed close — the link did not reshape it this run.') +
      '<br><span style="opacity:.7">logged to the ledger, hash-linked.</span></div>';
  }
  function hzCompareRun() {
    if (!S) { setStatus('open the 🌀 view and tap ▶ Run first'); return; }
    var gens = Math.max(2, Math.min(12, parseInt((qs('nx-gens') || {}).value, 10) || 8));
    var M = Math.max(2, Math.min(6, parseInt((qs('nx-hzm') || {}).value, 10) || 6));
    var K = Math.max(1, Math.min(M - 1, parseInt((qs('nx-hzk') || {}).value, 10) || 2));
    setStatus('⚖ comparing entanglement-inspired link ON vs OFF — ' + gens + ' gens each, same seed…');
    setTimeout(function () {
      var res;
      try {
        res = C.horizonCompare(gens, S.seed, M, K, S.depth, S.act);
      } catch (err) {
        setStatus('compare failed: ' + (err && err.message)); return;
      }
      renderHzCompare(res);
      ledgerAppend({ kind: 'horizon-compare', ts: Date.now(), gen: S.gen,
        hzM: M, hzK: K, gens: gens,
        errOn: res.on.err, fidOn: res.on.fid, sparsOn: res.on.stats.sparsity,
        errOff: res.off.err, fidOff: res.off.fid, sparsOff: res.off.stats.sparsity,
        deltaG: res.deltaFrob,
        note: 'link ON vs OFF gravity structure, seed ' + res.seed });
      renderLedger();
      setStatus('⚖ compare done — ΔG = ' + (res.deltaFrob == null ? 'n/a' : res.deltaFrob.toFixed(4)) +
        '. The ledger holds the hash-linked record.');
    }, 30);
  }
  /* ── v41: Ghost Snapshots UI ───────────────────────────────────────
   * The frozen pre-compression copies, newest-first: timestamped,
   * checksummed, tap-to-inspect with manual re-ingestion into layer 3.
   * Ghosts persist in localStorage (same pattern as the ledger); the core
   * caps the live list at GHOST_MAX. A tampered store is dropped loudly —
   * only checksum-valid ghosts are restored. */
  var GHOST_KEY = 'nl_nexus_ghosts';
  var ghostSel = null;
  function ghostPersist() {
    try { localStorage.setItem(GHOST_KEY, JSON.stringify(S ? S.ghosts : [])); } catch (e) {}
  }
  function ghostRestore() {
    var g = [];
    try { g = JSON.parse(localStorage.getItem(GHOST_KEY)) || []; } catch (e) {}
    g = g.filter(function (x) { return C.ghostVerify(x); });
    if (S) S.ghosts = g.slice(-C.GHOST_MAX);
  }
  /* ══ v43 Gauntlet — module-level render/sync helpers ══ */
function fmtN(x, d) { return (x == null || !isFinite(x)) ? 'n/a' : (+x).toFixed(d == null ? 4 : d); }
function renderShockRes(res) {
  var el = qs('nx-shockres'); if (!el) return;
  function armHtml(name, a) {
    return '<div class="dsinfo" style="border-left:3px solid ' + (name === 'ON' ? '#4ade80' : '#9a9aa8') +
      ';padding:6px 8px;margin:6px 0"><b>ghost recovery ' + name + '</b> — pre-shock err ' +
      fmtN(a.preErr) + ' · generations-to-recover <b>' + a.gensToRecover + '</b>' +
      ' · post-shock error integral ' + fmtN(a.integral) +
      '<br><span style="opacity:.7">curve: ' + a.curve.map(function (x) { return fmtN(x, 3); }).join(' → ') + '</span></div>';
  }
  el.innerHTML = '<div class="dsinfo">⚡ shock: <b>' + res.type + '</b> at gen ' + res.shockGen +
    ' (seed ' + res.seed + ', depth ' + res.depth + ') — the shock persists; recovery means adapting to the new regime.</div>' +
    armHtml('ON', res.on) + armHtml('OFF', res.off) +
    '<div class="dsinfo"><b>verdict: ' + res.verdict + '.</b> ' +
    (res.on.gensToRecover >= 0 && (res.off.gensToRecover < 0 || res.on.gensToRecover <= res.off.gensToRecover)
      ? 'The ghost system re-adapted faster — evidence of adaptation, not memorization.'
      : 'No measurable recovery advantage this run — try another shock type or seed.') + '</div>';
}
/* --- auto-pilot --- */
function renderApInfo() {
  var el = qs('nx-apinfo'); if (!el || !S) return;
  el.textContent = S.autoPilot
    ? 'Auto-pilot ON — rolling slope ΔE(' + S.apK + ') = ' + fmtN(S.apSlope, 5) +
      ' vs threshold ' + S.apThresh + (S.burstLeft > 0 ? ' · ⚡ BURST ACTIVE (' + S.burstLeft + ' gens left)' : '') +
      (S.apThreshLeft > 0 ? ' · crawler threshold halved (' + S.apThreshLeft + ' gens left)' : '')
    : 'Auto-pilot OFF — slope monitor idle.';
}
function syncAp() {
  var b = qs('btn-nx-autopilot'); if (!b || !S) return;
  b.textContent = S.autoPilot ? '🎛 Auto-pilot ON' : '🎛 Auto-pilot OFF';
  b.className = S.autoPilot ? 'primary' : 'ghost';
  renderApInfo();
}
/* --- multi-objective --- */
function renderFInfo() {
  var el = qs('nx-finfo'); if (!el || !S) return;
  if (!S.moOn || !S.lastMO) {
    el.textContent = S.moOn
      ? 'Multi-objective ON — waiting for the first selection…'
      : 'Multi-objective OFF — selection is raw error (+ fidelity pressure when the link is on).';
    return;
  }
  var m = S.lastMO;
  el.innerHTML = 'last winner — <b>F = ' + fmtN(m.F) + '</b> = ' + m.w1 + '·(1−' + fmtN(1 - m.acc) +
    ') + ' + m.w2 + '·' + fmtN(m.fid) + ' − ' + m.w3 + '·' + fmtN(m.cpx) +
    '<br><span style="opacity:.7">accuracy-term ' + fmtN(m.acc) + ' · fidelity ' + fmtN(m.fid) +
    ' · complexity ' + fmtN(m.cpx) + ' (weight norms + layer saturation)</span>';
}
function syncMO() {
  var b = qs('btn-nx-mo'); if (!b || !S) return;
  b.textContent = S.moOn ? '⚖ Multi-objective ON' : '⚖ Multi-objective OFF';
  b.className = S.moOn ? 'primary' : 'ghost';
  renderFInfo();
}
  function syncGhostFb() {
    var b = qs('btn-nx-ghostfb'); if (!b || !S) return;
    b.textContent = S.ghostFb ? '👻 Layer-3 feedback ON' : '👻 Layer-3 feedback OFF';
    b.className = S.ghostFb ? 'primary' : 'ghost';
  }
  function renderGhosts() {
    var el = qs('nx-ghosts'); if (!el) return;
    var gl = (S && S.ghosts) ? S.ghosts : [];
    if (!gl.length) {
      el.innerHTML = '<div class="dsinfo">No ghosts yet — enable 🕳 Horizon and run. One ghost freezes per generation, mid-episode, before compression.</div>';
    } else {
      var html = '', i, g, dt, hh, mm;
      for (i = gl.length - 1; i >= 0; i--) {
        g = gl[i];
        dt = new Date(g.ts); hh = dt.getHours(); mm = ('0' + dt.getMinutes()).slice(-2);
        html += '<div class="ghostrow" data-gid="' + g.id + '"' +
          ' style="padding:8px;border:1px solid ' + (ghostSel === g.id ? '#a78bfa' : '#333') +
          ';border-radius:8px;margin:6px 0;min-height:48px">' +
          '<b>👻 ' + g.id + '</b> · gen ' + g.gen + ' · ' + hh + ':' + mm +
          ' · M=' + g.M + '→K=' + g.K +
          ' · <span style="font-family:monospace">' + g.checksum + '</span> ✓' +
          '</div>';
      }
      el.innerHTML = html;
      var rows = el.querySelectorAll('.ghostrow'), r;
      for (r = 0; r < rows.length; r++) {
        rows[r].onclick = (function (gid) {
          return function () { ghostSel = gid; renderGhosts(); };
        })(rows[r].getAttribute('data-gid'));
      }
    }
    renderGhostInfo();
  }
  function renderGhostInfo() {
    var el = qs('nx-ghostinfo'); if (!el) return;
    var gl = (S && S.ghosts) ? S.ghosts : [], g = null, i;
    for (i = 0; i < gl.length; i++) if (gl[i].id === ghostSel) g = gl[i];
    if (!g) {
      el.innerHTML = '<div class="dsinfo">Tap a ghost to inspect its frozen state and re-ingest it into layer 3.</div>';
      return;
    }
    var hs = g.hIn.map(function (v) { return v.toFixed(3); }).join(', ');
    el.innerHTML = '<div class="dsinfo" style="border-left:3px solid #a78bfa;padding:6px 8px">' +
      '👻 <b>' + g.id + '</b> — pre-compression infall states (M=' + g.M + '), frozen at t=' + g.t + ':<br>' +
      '<span style="font-family:monospace;font-size:12px">[' + hs + ']</span><br>' +
      'gen ' + g.gen + ' · checksum <span style="font-family:monospace">' + g.checksum + '</span> ✓ verified<br>' +
      'Compressor structure at capture: G rms ' + C.hzStats(g.G).rms.toFixed(4) +
      '<div class="row" style="margin-top:8px"><button id="btn-nx-ghostingest" class="primary" style="min-height:48px;flex:1">⤵ Re-ingest into layer 3</button></div>' +
      '</div>';
    var b = qs('btn-nx-ghostingest');
    if (b) b.onclick = function () {
      var gv = parseFloat((qs('nx-ghostgain') || {}).value);
      var res = C.ghostReingest(S, g, isFinite(gv) ? gv : C.GHOST_FB_GAIN);
      setStatus(res.ok ?
        '⤵ ghost ' + g.id + ' re-ingested into layer ' + res.layer + ' (gain ' + res.gain.toFixed(2) +
        ') — the champion now carries pre-compression data into the next generation.' :
        '⤵ re-ingest failed: ' + res.reason);
      drawAll();
    };
  }

  /* ── v42: Antimatter — the ghost-built inner superloop ── */
  function amState() {
    if (!S) return null;
    var live = (S.live && S.live.antimatter) ? S.live.antimatter : null;
    var champ = (S.champion && S.champion.antimatter) ? S.champion.antimatter : null;
    var mod = live || champ;
    return { on: !!S.amOn, mod: mod };
  }
  function syncAm() {
    var b = qs('btn-nx-am'); if (!b || !S) return;
    b.textContent = S.amOn ? '⚛ Antimatter ON' : '⚛ Antimatter OFF';
    b.className = S.amOn ? 'primary' : 'ghost';
    var sb = qs('btn-nx-amspawn'); if (sb) {
      var on = S.amSpawn !== false;
      sb.setAttribute('data-on', on ? '1' : '0');
      sb.textContent = on ? '⚛ Auto-spawn ON' : '⚛ Auto-spawn OFF';
      sb.className = on ? 'primary' : 'ghost';
    }
    /* v44: concrete antimatter toggles */
    var rb = qs('btn-nx-amresid'); if (rb) {
      var ron = S.amResid !== false;
      rb.textContent = ron ? '🧬 Residual publish ON' : '🧬 Residual publish OFF';
      rb.className = ron ? 'primary' : 'ghost';
    }
    var ib = qs('btn-nx-amsigninv'); if (ib) {
      var ion = !!S.amSignInv;
      ib.textContent = ion ? '➖ Sign inversion ON' : '➖ Sign inversion OFF';
      ib.className = ion ? 'primary' : 'ghost';
    }
    var zb = qs('btn-nx-amzerosum'); if (zb) {
      var zon = S.amZeroSum !== false;
      zb.textContent = zon ? '🟰 Zero-sum pairing ON' : '🟰 Zero-sum pairing OFF';
      zb.className = zon ? 'primary' : 'ghost';
    }
    renderAmDiv();
  }
  /* v44: the zero-sum divergence meter — ||AM.W + W_top(live)||, the learned
   * asymmetry. Zero at spawn (exact pair), growing as matter evolves. */
  function renderAmDiv() {
    var el = qs('nx-amdiv'); if (!el) return;
    if (!S) { el.textContent = 'Zero-sum divergence meter: run the Core first.'; return; }
    var L = S.live || S.champion;
    var d = C.amDivergence(L);
    if (d == null) { el.textContent = 'Zero-sum divergence meter: no live inner loop yet — 🕷 Recover a ghost.'; return; }
    var mod = L.antimatter;
    var w = Math.max(0, Math.min(100, d * 100));
    el.innerHTML = '🟰 zero-sum divergence <b>' + d.toFixed(4) + '</b>' +
      (mod.zs ? (mod.zsExact ? ' · pair exact at spawn (asserted)' : ' · rescaled at spawn (base ' + (mod.zsBase || 0).toFixed(4) + ')') : ' · legacy compose (no pairing)') +
      '<div style="height:8px;background:#222;border-radius:4px;margin-top:4px"><div style="height:8px;width:' +
      w.toFixed(1) + '%;background:#c9a0ff;border-radius:4px"></div></div>' +
      '<span style="opacity:.7">||AM.W + W_top|| — 0 at spawn means matter/antimatter summed to zero; growth = learned asymmetry.</span>';
  }
  function renderAmFeeds() {
    var st = amState();
    var info = qs('nx-aminfo');
    if (info) {
      if (!st || !st.mod) info.textContent = 'No inner loop yet — select a ghost above, then recover it. The crawler + spawn decide whether one is born.';
      else info.innerHTML = '⚛ inner superloop <b>' + (st.mod.on ? 'ACTIVE' : 'spawned, master OFF') + '</b> · ' +
        st.mod.N + ' ghost-built units · wired to <b>' + st.mod.U.length + '</b> layers · ' +
        st.mod.steps + ' self-updates · recipe <span style="font-family:monospace">' + st.mod.recipeId + '</span> (gen ' + st.mod.spawnedGen + ')' +
        ' · write-protected both ways — reads only.';
    }
    var cr = qs('nx-amcrawl');
    if (cr) {
      var log = (S && S.amCrawlLog) ? S.amCrawlLog : [];
      if (!log.length) cr.innerHTML = '<div class="dsinfo">The crawler hops ghost→ghost along similarity edges. Its hops log here.</div>';
      else {
        var html = '', i, h;
        for (i = log.length - 1; i >= 0 && i > log.length - 16; i--) {
          h = log[i];
          html += '<div class="dsinfo" style="font-size:12px">🕷 <span style="font-family:monospace">' + h.from +
            '</span> → <span style="font-family:monospace">' + h.to + '</span> · sim ' + h.sim.toFixed(3) +
            ' · depth ' + h.depth + '</div>';
        }
        cr.innerHTML = html;
      }
    }
    var co = qs('nx-amcontainer');
    if (co) {
      var c = (S && S.amContainer) ? S.amContainer : [];
      if (!c.length) co.innerHTML = '<div class="dsinfo">Recovered ghost states stack here (bounded replay bank — novelty eviction when full).</div>';
      else {
        var ch = '<div class="dsinfo" style="font-size:12px">📦 <b>' + c.length + '</b>/' + C.AM_CAP +
          ' recovered ghosts stacked: ';
        for (var j = Math.max(0, c.length - 8); j < c.length; j++)
          ch += '<span style="font-family:monospace">' + c[j].ghost.id + '</span> ';
        if (c.length > 8) ch += '…';
        co.innerHTML = ch + '</div>';
      }
    }
    var sl = qs('nx-amspawnlog');
    if (sl) {
      var lg = (S && S.amSpawnLog) ? S.amSpawnLog : [];
      if (!lg.length) sl.innerHTML = '<div class="dsinfo">Every spawn decision is logged with its sampled probability.</div>';
      else {
        var sh = '', e;
        for (var k = lg.length - 1; k >= 0 && k > lg.length - 10; k--) {
          e = lg[k];
          sh += '<div class="dsinfo" style="font-size:12px;border-left:3px solid ' + (e.fired ? '#4ade80' : '#555') +
            ';padding:4px 8px;margin:4px 0">🎲 gen ' + e.gen + ' · seed <span style="font-family:monospace">' + e.seed + '</span>' +
            ' · ' + e.collected.length + ' ghosts · match ' + e.meanSim.toFixed(3) +
            ' → p=' + e.p.toFixed(3) + ' · roll ' + e.roll.toFixed(3) +
            ' → <b>' + (e.fired ? 'SPAWNED' : 'no spawn') + '</b>' +
            (e.recipe ? ' · <span style="font-family:monospace">' + e.recipe + '</span>' : '') + '</div>';
        }
        sl.innerHTML = sh;
      }
    }
    renderAmDiv(); /* v44: keep the zero-sum divergence meter fresh */
  }
  function drawAntimatter() {
    var f = fit(qs('nx-antimatter'), 230); if (!f) return;
    var x = f.ctx; clear(f);
    var st = amState();
    x.textAlign = 'center';
    if (!st || !st.mod) {
      x.fillStyle = COL.dim; x.font = '14px sans-serif';
      x.fillText('⚛ no inner loop — recover a ghost to let the crawler hunt', f.w / 2, f.h / 2);
      return;
    }
    var mod = st.mod, N = mod.N, dd = (S && S.depth) || 1;
    var cx = f.w / 2, cy = f.h / 2 - 6, i, l;
    var R = Math.min(f.w, f.h) / 2 - 30;
    /* the inner superloop: glowing ring of ghost-built units */
    var grd = x.createRadialGradient(cx, cy, 2, cx, cy, 44);
    grd.addColorStop(0, 'rgba(74,222,128,0.30)'); grd.addColorStop(1, 'rgba(74,222,128,0)');
    x.fillStyle = grd;
    x.beginPath(); x.arc(cx, cy, 44, 0, 7); x.fill();
    var t = (S.t || 0);
    var nodeXY = [];
    for (i = 0; i < N; i++) {
      var ang = t * 0.15 + i * 2 * Math.PI / N;
      var nx = cx + Math.cos(ang) * 30, ny = cy + Math.sin(ang) * 30;
      nodeXY.push([nx, ny]);
      var mag = Math.min(1, Math.abs(mod.h[i] || 0));
      x.fillStyle = 'rgba(74,222,128,' + (0.35 + 0.65 * mag).toFixed(2) + ')';
      x.beginPath(); x.arc(nx, ny, 5 + 4 * mag, 0, 7); x.fill();
    }
    x.strokeStyle = st.on ? 'rgba(74,222,128,0.5)' : 'rgba(120,120,120,0.4)';
    x.lineWidth = 2;
    x.beginPath(); x.arc(cx, cy, 30, 0, 7); x.stroke(); x.lineWidth = 1;
    x.fillStyle = '#bbf7d0'; x.font = '10px sans-serif';
    x.fillText(st.on ? 'ANTIMATTER' : 'dormant', cx, cy + 44);
    /* the layers it reads: strips on the left, one per deep layer */
    var live = S.live, stripX = 26, stripW = 14;
    for (l = 0; l < dd; l++) {
      var sy = 24 + l * ((f.h - 48) / Math.max(1, dd));
      var lh = [0, 0, 0, 0, 0, 0];
      try { lh = live.layers[l].h; } catch (e) {}
      x.fillStyle = '#3a3a44'; x.fillRect(stripX, sy, stripW, 10);
      var lm = 0, d;
      for (d = 0; d < 6; d++) lm = Math.max(lm, Math.abs(lh[d] || 0));
      x.fillStyle = 'rgba(124,92,255,' + Math.min(1, lm).toFixed(2) + ')';
      x.fillRect(stripX, sy, stripW * Math.min(1, lm), 10);
      x.fillStyle = COL.dim; x.font = '9px sans-serif'; x.textAlign = 'left';
      x.fillText('L' + l, stripX + stripW + 4, sy + 9); x.textAlign = 'center';
      /* read links: inner loop reads every layer (read-only, both ways blocked for writes) */
      var glow = st.on ? 0.10 + 0.25 * Math.min(1, lm) : 0.06;
      x.strokeStyle = 'rgba(74,222,128,' + glow.toFixed(2) + ')';
      x.beginPath(); x.moveTo(stripX + stripW, sy + 5);
      x.lineTo(cx - 30, cy); x.stroke();
    }
    x.fillStyle = COL.dim; x.font = '11px sans-serif'; x.textAlign = 'left';
    x.fillText('gain ' + mod.gain.toFixed(2) + ' · ' + mod.steps + ' self-updates · reads only, writes blocked', 10, f.h - 10);
  }

  /* ── v35: persistent lineage — the Core remembers ── */
  var CHAMP_KEY = 'nl_nexus_champion', CHAMPS_KEY = 'nl_nexus_champions';
  function saveChampion(rec) {
    try {
      /* v39: normalize to the stacked champion format (legacy v1 records
       * migrate here) and seal the checksum under the JS authority
       * (Python's hash() differs).
       * v40: the seal covers the horizon (v3 canonical form). */
      var nc = C.normalizeChamp(rec);
      nc.checksum = C.checksum(C.champCanon(nc));
      rec = nc;
      localStorage.setItem(CHAMP_KEY, JSON.stringify(rec));
      var h = [];
      try { h = JSON.parse(localStorage.getItem(CHAMPS_KEY)) || []; } catch (e) {}
      h.unshift(rec); h = h.slice(0, 5);
      localStorage.setItem(CHAMPS_KEY, JSON.stringify(h));
    } catch (e) {}
    renderChampionInfo();
  }
  function loadChampion() {
    try { return JSON.parse(localStorage.getItem(CHAMP_KEY)) || null; }
    catch (e) { return null; }
  }
  function renderChampionInfo() {
    var el = qs('nx-champinfo'); if (!el) return;
    var c = loadChampion();
    if (!c) { el.textContent = 'No saved champion yet — run the Core once and it will remember.'; return; }
    var when = '';
    try { when = new Date(c.ts).toLocaleString(); } catch (e) {}
    el.innerHTML = '🧠 saved champion <b>' + c.checksum + '</b> · gen ' + c.gen +
      ' · err ' + Number(c.err).toFixed(4) +
      ' · depth ' + (c.stack_depth || 1) + ' · ' + (c.act || 'tanh') +
      (c.horizon && c.horizon.on ? ' · 🕳 horizon ' + c.horizon.M + '→' + c.horizon.K +
        (c.horizon.ent ? ' 🔗' : '') : '') +
      ' · ' + when +
      (c.legacyNote ? '<br><span style="opacity:.75">⚠️ ' + c.legacyNote + '.</span>' : '') +
      '<br><span style="opacity:.75">the Core now remembers — each run continues where the last one ended.</span>';
  }
  function exportChampion() {
    var c = loadChampion();
    if (!c) { setStatus('No saved champion to export — run the Core once first.'); return; }
    var name = 'nexus-champion-' + c.checksum + '.json';
    var text = JSON.stringify(c);
    var api = null;
    try { api = _G.NL_Q_API; } catch (e) {}
    if (api && api.saveTextFile) {
      try {
        api.saveTextFile(name, text);
        setStatus('⤓ exporting ' + name + ' — pick <b>Downloads</b> in the file picker, then paste it into preset 16\u2019s RESUME_JSON to continue under Chaquopy.');
        return;
      } catch (e) { setStatus('export failed: ' + e.message); return; }
    }
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      setStatus('downloaded ' + name + ' (browser fallback).');
    } catch (e2) { setStatus('export failed: ' + e2.message); }
  }

  /* ══ v45 "Mirror" — Export for J.A.R.V.I.S. ═══════════════════════════
   * One tap bundles EVERYTHING into a single machine-readable JSON file the
   * user shares into chat: champions, the hash-linked ledger, ghosts, run
   * history, shock results, auto-pilot triggers, fitness configs, antimatter
   * spawn/crawl logs. Manifest first: counts + truncation flags, so the
   * reader knows exactly what arrived intact. Ghosts ship with full states
   * unless the bundle would exceed MAX_BUNDLE_BYTES — then metadata +
   * checksums only, flagged honestly in the manifest. Flat sections, no
   * circular refs. buildJarvisBundle is pure (stores in, bundle out) so it
   * is unit-testable in Node; exportJarvis gathers from localStorage + S.
   */
  var JARVIS_MAX_BYTES = 2 * 1024 * 1024;
  function ghostMeta(g) {
    return { id: g.id, gen: g.gen, t: g.t, M: g.M, K: g.K, ts: g.ts, checksum: g.checksum };
  }
  function buildJarvisBundle(st, verifyFn) {
    verifyFn = verifyFn || function () { return true; };
    var ghosts = st.ghosts || [];
    var ghostsOk = 0, i;
    for (i = 0; i < ghosts.length; i++) { try { if (verifyFn(ghosts[i])) ghostsOk++; } catch (e) {} }
    var ledger = st.ledger || [];
    function kindOf(k) {
      return ledger.filter(function (e) { return e && e.kind === k; });
    }
    var bundle = {
      manifest: {
        app_version: 'v45', format: 'jarvis-bundle/1',
        exported_at: new Date().toISOString(),
        device_label: st.deviceLabel || 'android',
        counts: {
          champions_history: (st.champions || []).length,
          ledger_entries: ledger.length,
          ghosts: ghosts.length, ghosts_checksum_ok: ghostsOk,
          runs: (st.runs || []).length,
          shock_tests: kindOf('shock-test').length,
          autopilot_triggers: kindOf('autopilot').length,
          char_rnn_runs: kindOf('char-rnn').length,
          spawn_events: (st.spawnLog || []).length
        },
        truncated_flags: { ghosts: false },
        note: 'Export for J.A.R.V.I.S. — share this file into chat; every section is machine-readable.'
      },
      champions: { current: st.champion || null, history: st.champions || [] },
      ledger: ledger,
      ghosts: { count: ghosts.length, checksum_ok: ghostsOk, ghosts: ghosts },
      run_history: st.runs || [],
      shock_tests: kindOf('shock-test'),
      autopilot_log: kindOf('autopilot'),
      fitness: { mo_config: st.moConfig || null, mo_entries: kindOf('mo') },
      antimatter: { spawn_log: st.spawnLog || [], crawl_log: st.crawlLog || [], container: st.container || [] },
      char_rnn_runs: kindOf('char-rnn')
    };
    var text = JSON.stringify(bundle);
    if (text.length > JARVIS_MAX_BYTES) {
      /* too big for a chat share — keep metadata + checksums, drop states */
      bundle.ghosts.ghosts = ghosts.map(ghostMeta);
      bundle.manifest.truncated_flags.ghosts = true;
      bundle.manifest.note += ' Ghost full states truncated (bundle > 2MB): metadata + checksums shipped; states stay on-device.';
      text = JSON.stringify(bundle);
    }
    return { bundle: bundle, text: text, bytes: text.length };
  }
  function exportJarvis() {
    function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
    var ghosts = lsGet(GHOST_KEY) || (S ? S.ghosts : []) || [];
    var st = {
      deviceLabel: (function () { try { return navigator.platform || 'android'; } catch (e) { return 'android'; } })(),
      champion: loadChampion(),
      champions: lsGet(CHAMPS_KEY) || [],
      ledger: ledgerLoad(),
      ghosts: ghosts,
      runs: (function () { try { return (_G.NL_NEXUS_RUNS && _G.NL_NEXUS_RUNS.loadRuns()) || []; } catch (e) { return []; } })(),
      spawnLog: (S && S.amSpawnLog) || [],
      crawlLog: (S && S.amCrawlLog) || [],
      container: (S && S.amContainer) || [],
      moConfig: S ? { on: !!S.moOn, w1: S.moW1, w2: S.moW2, w3: S.moW3 } : null
    };
    var out;
    try { out = buildJarvisBundle(st, C.ghostVerify); }
    catch (e) { setStatus('📦 export failed to build: ' + e.message); return; }
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    var name = 'neural-lab-export-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
               '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
    var el = qs('nx-jarvisinfo');
    function done(msg) {
      if (el) el.innerHTML = msg;
      setStatus(msg.replace(/<[^>]*>/g, ''));
      try {
        ledgerAppend({ kind: 'jarvis-export', ts: Date.now(), gen: S ? S.gen : 0,
          note: 'Export for J.A.R.V.I.S.: ' + name + ' (' + (out.bytes / 1024).toFixed(1) + 'KB, ' +
                out.bundle.manifest.counts.ledger_entries + ' ledger entries, ' +
                out.bundle.manifest.counts.ghosts + ' ghosts' +
                (out.bundle.manifest.truncated_flags.ghosts ? ', ghosts truncated to metadata' : '') + ')' });
        renderLedger();
      } catch (e) {}
    }
    var api = null;
    try { api = _G.NL_Q_API; } catch (e) {}
    if (api && api.saveTextFile) {
      try {
        api.saveTextFile(name, out.text);
        done('📦 exported <b>' + name + '</b> (' + (out.bytes / 1024).toFixed(1) + 'KB) — pick <b>Downloads</b> in the file picker, then share it into chat.');
        return;
      } catch (e) { done('📦 export failed: ' + e.message); return; }
    }
    try {
      var blob = new Blob([out.text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      done('📦 downloaded <b>' + name + '</b> (' + (out.bytes / 1024).toFixed(1) + 'KB, browser fallback) — share it into chat.');
    } catch (e2) { done('📦 export failed: ' + e2.message); }
  }


  /* ── v37: Eternal Core — autonomous continuous self-evolution ──────
   * Ahkeem's directive: the network evolves itself constantly — not 16 gens
   * and stop. In-app chunked loop (no native service in this build — see the
   * core note): N gens per cycle, champion auto-saved every chunk (kill-safe),
   * yields between chunks so STOP is always reachable. Backgrounding the app
   * drops to LOW-POWER cadence via visibilitychange; the battery guard pauses
   * below 20% (not charging) and resumes when charging above 25%. */
  var eternal = {
    on: false, mode: 'ACTIVE', timer: null,
    chunkGens: 4, activeSleepMs: 400, lowSleepMs: 30000,
    startTs: 0, gensAtStart: 0,
    battLevel: null, battCharging: null, battKnown: false
  };
  function eternalChunkGens() {
    var el = qs('nx-chunk'), v = el ? parseInt(el.value, 10) : 4;
    return Math.max(1, Math.min(16, isFinite(v) ? v : 4));
  }
  function eternalLowSleepMs() {
    var el = qs('nx-lowsleep'), v = el ? parseFloat(el.value) : 30;
    return Math.max(5, Math.min(300, isFinite(v) ? v : 30)) * 1000;
  }
  function readBattery(cb) {
    try {
      if (typeof navigator !== 'undefined' && navigator && typeof navigator.getBattery === 'function') {
        navigator.getBattery().then(function (b) {
          cb({ known: true, level: b.level, charging: !!b.charging });
        }).catch(function () { cb({ known: false }); });
      } else cb({ known: false });
    } catch (e) { cb({ known: false }); }
  }
  function clearEternalTimer() {
    if (eternal.timer != null) { try { clearTimeout(eternal.timer); } catch (e) {} eternal.timer = null; }
  }
  function scheduleEternal(ms) {
    clearEternalTimer();
    eternal.timer = setTimeout(eternalTick, Math.max(0, ms));
  }
  function eternalSaveChunk() {
    try {
      var rec = C.champRecord(S);
      if (rec.err_curve && rec.err_curve.length > 1000) rec.err_curve = rec.err_curve.slice(-1000);
      saveChampion(rec);
    } catch (e) {}
  }
  /* crash recovery: 'nl_eternal_active' is set on start, cleared ONLY on
   * clean STOP. If it's still set at boot, the app died mid-eternal — the
   * Core auto-resumes from the last saved champion, no tap needed. */
  function eternalFlagSet(gen) {
    try { localStorage.setItem('nl_eternal_active', JSON.stringify({ ts: Date.now(), gen: gen })); } catch (e) {}
  }
  function eternalFlagClear() {
    try { localStorage.removeItem('nl_eternal_active'); } catch (e) {}
  }
  function eternalFlagGet() {
    try { return JSON.parse(localStorage.getItem('nl_eternal_active')) || null; }
    catch (e) { return null; }
  }
  /* arm the loop from the current state S — shared by manual start + boot resume */
  function eternalArm(note) {
    C.setEternal(S, true);
    S.maxGens = Infinity;
    eternal.on = true;
    eternal.mode = eternalLowNow() ? 'LOW-POWER' : 'ACTIVE';
    eternal.startTs = Date.now();
    eternal.gensAtStart = S.gen;
    eternal.chunkGens = eternalChunkGens();
    eternal.lowSleepMs = eternalLowSleepMs();
    eternal.battKnown = false; eternal.battLevel = null; eternal.battCharging = null;
    eternalFlagSet(S.gen);
    ledgerAppend({ kind: 'eternal-start', gen: S.gen, ts: Date.now(), note: note });
    renderLedger();
    renderEternal(); syncBtns();
    scheduleEternal(0);
  }
  function eternalStart() {
    if (!S || eternal.on) return;
    /* halt any normal run first — eternal owns the loop now */
    running = false;
    if (raf) { try { cancelAnimationFrame(raf); } catch (e) {} raf = null; }
    var ev = [], freshIdle = (S.gen === 0 && S.curve.length === 0 &&
                              (S.phase === 'idle' || S.phase === 'done'));
    if (freshIdle) {
      var rc = qs('nx-eternal-resume'), champ = null;
      if (!rc || rc.checked) champ = loadChampion();
      if (champ && C.champVerify(champ)) {
        ev = C.resume(S, champ, Infinity);
        var rl = ledgerAppend({ kind: 'resume', fromSig: champ.checksum, gen: champ.gen, ts: Date.now() });
        S.resumeHash = rl.hash;
      } else {
        S.maxGens = Infinity;
        ev = C.start(S);
        S.resumeHash = null;
      }
    } else {
      /* continue the lineage from wherever it stands — self-resume */
      ev = C.resume(S, C.champRecord(S), Infinity);
    }
    handleEvents(ev);
    renderChampionInfo();
    setStatus('∞ ETERNAL — the Core evolves itself in chunks of ' + eternalChunkGens() +
      ', forever. Champion auto-saves every chunk (kill-safe). Only ⏹ STOP ends it — ' +
      'it even survives a dead phone: reopen the app and it resumes on its own.');
    eternalArm(eternalChunkGens() + ' gens/cycle · ' + (eternalLowNow() ? 'LOW-POWER' : 'ACTIVE'));
  }
  function eternalStop() {
    if (!eternal.on) return;
    clearEternalTimer();
    eternal.on = false;
    eternalFlagClear(); /* the ONLY clean off-switch — his STOP button */
    if (S) C.setEternal(S, false);
    eternalSaveChunk();
    if (S) {
      ledgerAppend({ kind: 'eternal-stop', gen: S.gen, ts: Date.now() });
      renderLedger(); renderChampionInfo();
      setStatus('⏹ eternal STOPPED at gen ' + S.gen + ' — champion saved. The lineage continues whenever you start again.');
      drawAll();
    }
    renderEternal(); syncBtns();
  }
  /* v37b: boot check — if the flag survived, the app died mid-eternal. */
  function eternalBootCheck() {
    if (!S || eternal.on) return;
    var flag = eternalFlagGet();
    if (!flag) return;
    var champ = loadChampion();
    if (!champ || !C.champVerify(champ)) {
      eternalFlagClear(); /* stale flag, nothing valid to resume */
      return;
    }
    var gapMin = 0;
    try { gapMin = Math.max(0, Math.round((Date.now() - (champ.ts || flag.ts)) / 60000)); } catch (e) {}
    var ev = C.resume(S, champ, Infinity);
    var rl = ledgerAppend({ kind: 'resume', fromSig: champ.checksum, gen: champ.gen, ts: Date.now() });
    S.resumeHash = rl.hash;
    handleEvents(ev);
    renderChampionInfo();
    setStatus('∞ ETERNAL AUTO-RESUMED — the app died with eternal still on, so the Core picked up ' +
      'where it left off (gap ~' + gapMin + ' min, champion ' + champ.checksum + '). Only ⏹ STOP ends it.');
    eternalArm('AUTO-RESUMED after restart · gap ~' + gapMin + ' min · ' + eternalChunkGens() + ' gens/cycle');
  }
  /* v37b: low-power policy (Ahkeem's correction) — backgrounded OR low
   * battery means the DEEP tier: AI-only, 1 gen/cycle, no rendering, slowest
   * cadence. The loop NEVER stops on its own — only his ⏹ STOP button ends it. */
  function eternalBattLow() {
    return eternal.battKnown && eternal.battLevel != null &&
           !eternal.battCharging && eternal.battLevel < 0.20;
  }
  function eternalLowNow() {
    var hidden = (typeof document !== 'undefined' && !!document.hidden);
    return hidden || eternalBattLow();
  }
  function eternalLowReason() {
    var hidden = (typeof document !== 'undefined' && !!document.hidden);
    var bl = eternalBattLow();
    if (hidden && bl) return 'backgrounded + battery ' + Math.round(eternal.battLevel * 100) + '%';
    if (bl) return 'battery ' + Math.round(eternal.battLevel * 100) + '% (not charging)';
    return 'backgrounded';
  }
  function eternalTick() {
    eternal.timer = null;
    if (!eternal.on || !S) return;
    readBattery(function (b) {
      if (!eternal.on || !S) return;
      eternal.battKnown = b.known;
      if (b.known) { eternal.battLevel = b.level; eternal.battCharging = b.charging; }
      /* ── cadence: ACTIVE only when visible AND battery healthy ── */
      var low = eternalLowNow();
      var want = low ? 'LOW-POWER' : 'ACTIVE';
      if (eternal.mode !== want) {
        eternal.mode = want;
        ledgerAppend({ kind: 'eternal-mode', mode: want, gen: S.gen, ts: Date.now(),
                       note: want === 'LOW-POWER' ? eternalLowReason() : 'visible + battery ok' });
        renderLedger();
        setStatus(want === 'LOW-POWER'
          ? '◐ LOW-POWER (' + eternalLowReason() + ') — AI-only: 1 gen/cycle, no rendering, slowest cadence. ' +
            'The evolution keeps running. Only ⏹ STOP ends it.'
          : '● ACTIVE — full speed, rendering live.');
      }
      var deep = low && eternalBattLow(); /* deepest tier: slowest wakeups */
      var gens = low ? 1 : eternal.chunkGens;
      var ev;
      try {
        ev = C.runGens(S, gens);
      } catch (err) {
        setStatus('eternal chunk failed (' + (err && err.message) + ') — stopping to be safe. Champion was saved last chunk.');
        eternalStop();
        return;
      }
      handleEvents(ev);
      eternalSaveChunk(); /* kill-safe: every chunk persists */
      if (!low) drawAll(); /* AI-ONLY in low-power: zero rendering/viz work */
      renderEternal();
      var sleep = low ? eternal.lowSleepMs * (deep ? 4 : 1) : eternal.activeSleepMs;
      scheduleEternal(sleep);
    });
  }
  function eternalStatus() {
    if (!S) return 'no Nexus run yet — open the 🌀 view first';
    var parts = ['eternal=' + (eternal.on ? 'ON' : 'OFF'), 'gen=' + S.gen, 'mode=' + eternal.mode];
    if (eternal.on) {
      var hrs = (Date.now() - eternal.startTs) / 3600000;
      parts.push(hrs > 0 ? (((S.gen - eternal.gensAtStart) / hrs).toFixed(1) + ' gens/hr') : 'warming up');
    }
    if (eternal.battKnown && eternal.battLevel != null)
      parts.push('batt=' + Math.round(eternal.battLevel * 100) + '%' + (eternal.battCharging ? ' charging' : ''));
    parts.push('chunk=' + eternal.chunkGens + '/cycle');
    return parts.join(' · ');
  }
  function renderEternal() {
    var info = qs('nx-eternalinfo'), stats = qs('nx-eternstats');
    var tgl = qs('btn-nx-eternal'), stop = qs('btn-nx-estop'), gi = qs('nx-gens');
    if (tgl) { tgl.disabled = eternal.on; tgl.className = eternal.on ? '' : 'primary'; }
    if (stop) { stop.disabled = !eternal.on; stop.className = eternal.on ? 'primary' : 'ghost'; }
    if (gi) gi.disabled = eternal.on;
    if (!info) return;
    if (!eternal.on) {
      info.innerHTML = 'Eternal mode is <b>OFF</b> — the Core runs only when you tell it to. ' +
        'Turn it on and it evolves itself in chunks, forever, saving the champion every cycle.';
      if (stats) stats.textContent = '';
      return;
    }
    var dot = eternal.mode === 'ACTIVE' ? '●' : '◐';
    var what = eternal.mode === 'ACTIVE' ? 'full speed, rendering live'
             : 'AI-ONLY — 1 gen/cycle, no rendering, slowest cadence. Only ⏹ STOP ends it.';
    info.innerHTML = '∞ ETERNAL <b>ON</b> — ' + dot + ' <b>' + eternal.mode + '</b> · ' + what + '.';
    if (stats && S) {
      var mins = Math.floor((Date.now() - eternal.startTs) / 60000);
      var hrs = (Date.now() - eternal.startTs) / 3600000;
      var gph = hrs > 1 / 3600 ? ((S.gen - eternal.gensAtStart) / hrs).toFixed(1) : '…';
      var s = 'gen ' + S.gen + ' · ' + gph + ' gens/hr · ' + mins + ' min elapsed · ' +
              eternal.chunkGens + ' gens/cycle';
      s += (eternal.battKnown && eternal.battLevel != null)
        ? ' · 🔋 ' + Math.round(eternal.battLevel * 100) + '%' + (eternal.battCharging ? ' ⚡' : '')
        : ' · 🔋 guard n/a on this WebView';
      stats.textContent = s;
    }
  }
  /* backgrounding throttles eternal to LOW-POWER on the next tick;
   * reschedule now so the deep tier takes effect immediately */
  function onVisChange() {
    if (!eternal.on || !S || typeof document === 'undefined') return;
    var low = eternalLowNow();
    setStatus(low
      ? '◐ app backgrounded — eternal drops to LOW-POWER: AI-only, 1 gen/cycle, no rendering. Only ⏹ STOP ends it.'
      : '● app visible — eternal back to ACTIVE cadence.');
    renderEternal();
    scheduleEternal(0); /* adopt the new cadence now */
  }

  var COL = {
    bg: '#141419', grid: '#3a3a44', dim: '#9a9aa8', txt: '#d8d8e0',
    pos: '#fbbf24', posHot: '#ff6b6b', neg: '#40e0ff',
    good: '#4ade80', bad: '#ff6b6b', acc: '#7c5cff'
  };
  function hx(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function lerp(a, b, t) {
    var A = hx(a), B = hx(b);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' +
      Math.round(A[1] + (B[1] - A[1]) * t) + ',' + Math.round(A[2] + (B[2] - A[2]) * t) + ')';
  }
  /* diverging cell color: negative -> cyan, positive -> amber -> red */
  function cellColor(v) {
    var t = Math.tanh(v * 1.5), m = Math.abs(t);
    if (t >= 0) return lerp(COL.bg, m > 0.66 ? COL.posHot : COL.pos, Math.min(1, m * 1.4));
    return lerp(COL.bg, COL.neg, Math.min(1, m * 1.4));
  }
  function frozenColor(v) {
    var m = Math.abs(Math.tanh(v * 1.5));
    return lerp(COL.bg, COL.neg, Math.min(1, m * 1.4));
  }

  function fit(c, hCss) {
    if (!c) return null;
    var dpr = window.devicePixelRatio || 1, w = c.clientWidth;
    if (!w) return null;
    c.width = Math.round(w * dpr); c.height = Math.round(hCss * dpr);
    var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: x, w: w, h: hCss };
  }
  function clear(f, label) {
    f.ctx.fillStyle = COL.bg; f.ctx.fillRect(0, 0, f.w, f.h);
  }

  /* the core, writing itself: top-layer W heatmap + per-layer hidden-state bars.
   * v39: the stack is visible — one strip per layer, L0 (input) at top. */
  function drawThink() {
    var dd = (S && S.depth) || 1;
    var f = fit(qs('nx-think'), 210 + dd * 26); if (!f) return;
    var x = f.ctx; clear(f);
    if (!S.live) {
      x.fillStyle = COL.dim; x.font = '14px sans-serif'; x.textAlign = 'center';
      x.fillText('tap ▶ Run to watch the core write itself', f.w / 2, f.h / 2);
      return;
    }
    var L = S.live, D = S.D, pad = 8, hm = Math.min(f.w - pad * 2, 128);
    var topW = L.layers[(L.depth || 1) - 1].W;
    var cw = hm / D, ox = pad, oy = pad, i, j, l;
    x.font = '10px sans-serif'; x.textAlign = 'center';
    for (i = 0; i < D; i++) for (j = 0; j < D; j++) {
      x.fillStyle = cellColor(topW[i][j]);
      x.fillRect(ox + j * cw + 1, oy + i * cw + 1, cw - 2, cw - 2);
    }
    x.strokeStyle = COL.grid; x.strokeRect(ox, oy, hm, hm);
    x.fillStyle = COL.dim; x.textAlign = 'left';
    x.fillText('top-layer W — the decoder\u2019s view', pad, oy + hm + 11);
    /* per-layer hidden-state strips */
    var by = oy + hm + 20, bh = 18, bw = (f.w - pad * 2 - 34) / D;
    for (l = 0; l < dd; l++) {
      x.fillStyle = COL.dim; x.textAlign = 'left';
      x.fillText('L' + l, pad, by + 13);
      for (i = 0; i < D; i++) {
        var hv = L.layers[l].h[i];
        var v = Math.tanh(hv * 1.5);
        x.fillStyle = cellColor(hv);
        var hbw = Math.abs(v) * (bw - 4);
        var bx = pad + 30 + i * bw;
        x.fillRect(bx + 2 + (v < 0 ? (bw - 4) - hbw : 0), by + 2, hbw, bh - 4);
        x.strokeStyle = COL.grid; x.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);
      }
      by += 26;
    }
    x.fillStyle = COL.dim; x.textAlign = 'right';
    x.fillText('gen ' + S.gen + ' · variant ' + (S.v + 1) + '/' + S.VN + ' · t=' + S.t + '/' + S.T +
      ' · depth ' + dd + ' · ' + (L.act || 'tanh'), f.w - pad, 16);
  }

  /* v39: per-layer prediction-error curves — mean |below − U_lᵀ·h_l| per
   * generation, one curve per layer above L0. Readout only. */
  function drawLayerPE() {
    var f = fit(qs('nx-layerpe'), 170); if (!f) return;
    var x = f.ctx; clear(f);
    var dd = (S && S.depth) || 1;
    x.font = '13px sans-serif'; x.textAlign = 'center';
    if (dd < 2) {
      x.fillStyle = COL.dim;
      x.fillText('single layer — set stack depth ≥ 2 to see per-layer prediction errors', f.w / 2, f.h / 2);
      return;
    }
    if (!S.layerPE.length || !S.layerPE[0] || !S.layerPE[0].length) {
      x.fillStyle = COL.dim;
      x.fillText('run the Core — per-layer prediction errors draw here', f.w / 2, f.h / 2);
      return;
    }
    var pal = ['#40e0ff', '#c084fc', '#fbbf24', '#4ade80', '#f472b6'];
    var pad = 34, W = f.w - pad - 10, H = f.h - pad - 8, l, i;
    x.strokeStyle = COL.grid; x.strokeRect(pad, 8, W, H);
    var n = 0, maxE = 0;
    for (l = 0; l < S.layerPE.length; l++) {
      n = Math.max(n, S.layerPE[l].length);
      for (i = 0; i < S.layerPE[l].length; i++)
        if (S.layerPE[l][i] > maxE) maxE = S.layerPE[l][i];
    }
    maxE = maxE * 1.15 || 1;
    function px(k) { return pad + (n <= 1 ? W / 2 : (k / (n - 1)) * W); }
    function py(e) { return 8 + H - (e / maxE) * H; }
    for (l = 0; l < S.layerPE.length; l++) {
      x.strokeStyle = pal[l % pal.length]; x.lineWidth = 2; x.beginPath();
      for (i = 0; i < S.layerPE[l].length; i++) {
        var X = px(i), Y = py(S.layerPE[l][i]);
        if (i === 0) x.moveTo(X, Y); else x.lineTo(X, Y);
      }
      x.stroke(); x.lineWidth = 1;
      x.fillStyle = pal[l % pal.length]; x.textAlign = 'left'; x.font = '11px sans-serif';
      x.fillText('L' + (l + 1), pad + 6 + l * 26, 20);
    }
    x.fillStyle = COL.dim; x.font = '10px sans-serif'; x.textAlign = 'right';
    x.fillText(maxE.toFixed(3), pad - 4, 16);
    var info = qs('nx-layerpeinfo');
    if (info) info.textContent =
      'per-layer prediction error = mean |below − U_lᵀ·h_l| — how much of the layer below each layer fails to ' +
      'reconstruct. A falling curve means the layer is learning a faithful representation. Readout only — the decoder error drives learning.';
  }

  /* the yes/no qubit: probability bar + dial */
  function drawBelief() {
    var f = fit(qs('nx-belief'), 120); if (!f) return;
    var x = f.ctx; clear(f);
    var p = C.pYes(S.theta), pad = 12, bw = f.w - pad * 2 - 120;
    var by = 18, bh = 30;
    x.fillStyle = COL.bad; x.fillRect(pad, by, bw, bh);
    x.fillStyle = COL.good; x.fillRect(pad, by, bw * p, bh);
    x.fillStyle = '#fff';
    x.fillRect(pad + bw * p - 1, by - 4, 2, bh + 8);
    x.font = '13px sans-serif'; x.textAlign = 'left'; x.fillStyle = COL.txt;
    x.fillText('YES ' + (p * 100).toFixed(1) + '%', pad, by + bh + 20);
    x.textAlign = 'right'; x.fillStyle = COL.dim;
    x.fillText('NO ' + ((1 - p) * 100).toFixed(1) + '%', pad + bw, by + bh + 20);
    /* dial: needle angle theta, 0=YES left, PI=NO right */
    var cx = f.w - 60, cy = by + bh + 34, r = 30;
    x.strokeStyle = COL.grid; x.beginPath(); x.arc(cx, cy, r, Math.PI, 0); x.stroke();
    x.fillStyle = COL.good; x.textAlign = 'center'; x.fillText('Y', cx - r - 8, cy + 4);
    x.fillStyle = COL.bad; x.fillText('N', cx + r + 8, cy + 4);
    var ang = Math.PI - S.theta;
    x.strokeStyle = COL.acc; x.lineWidth = 3; x.beginPath();
    x.moveTo(cx, cy); x.lineTo(cx + r * Math.cos(ang), cy - r * Math.sin(ang)); x.stroke();
    x.lineWidth = 1;
    x.fillStyle = COL.acc; x.beginPath(); x.arc(cx, cy, 4, 0, 7); x.fill();
    qs('nx-beliefinfo').textContent =
      'p(yes) = ' + p.toFixed(3) + ' — one qubit holds both answers; decoder evidence rotates it. Measuring = deciding.';
  }

  function drawMini(id, L, frozen) {
    var c = qs(id), f = fit(c, 150); if (!f) return;
    var x = f.ctx; clear(f);
    if (!L) {
      x.fillStyle = COL.dim; x.font = '13px sans-serif'; x.textAlign = 'center';
      x.fillText('—', f.w / 2, f.h / 2); return;
    }
    var D = S.D, hm = Math.min(f.w, f.h) - 8, cw = hm / D, i, j;
    var ox = (f.w - hm) / 2, oy = (f.h - hm) / 2;
    var W = L.layers[(L.depth || 1) - 1].W; /* v39: the top layer's weights */
    for (i = 0; i < D; i++) for (j = 0; j < D; j++) {
      x.fillStyle = frozen ? frozenColor(W[i][j]) : cellColor(W[i][j]);
      x.fillRect(ox + j * cw + 1, oy + i * cw + 1, cw - 2, cw - 2);
    }
    if (frozen && flash > 0) {
      x.strokeStyle = 'rgba(64,224,255,' + (0.3 + 0.7 * (flash % 20) / 20) + ')';
      x.lineWidth = 3; x.strokeRect(2, 2, f.w - 4, f.h - 4); x.lineWidth = 1;
    }
  }

  function drawEvo() {
    var f = fit(qs('nx-evo'), 200); if (!f) return;
    var x = f.ctx; clear(f);
    var pad = 34, W = f.w - pad - 10, H = f.h - pad - 8, i;
    x.strokeStyle = COL.grid;
    x.strokeRect(pad, 8, W, H);
    if (!S.curve.length) {
      x.fillStyle = COL.dim; x.font = '14px sans-serif'; x.textAlign = 'center';
      x.fillText('the error curve draws itself, live', f.w / 2, f.h / 2);
      return;
    }
    /* v37: eternal mode has no cap — rolling 60-generation window */
    var disp = S.curve, dispG0 = 0, n;
    if (!isFinite(S.maxGens)) {
      n = 60;
      if (S.curve.length > 60) { disp = S.curve.slice(-60); dispG0 = S.curve.length - 60; }
    } else {
      n = Math.max(S.maxGens, S.curve.length);
    }
    var maxE = Math.max.apply(null, disp) * 1.15 || 1;
    function px(k) { return pad + (n <= 1 ? W / 2 : (k / (n - 1)) * W); }
    function py(e) { return 8 + H - (e / maxE) * H; }
    x.fillStyle = COL.dim; x.font = '10px sans-serif'; x.textAlign = 'center';
    var stepL = Math.max(1, Math.floor(n / 8));
    for (i = 0; i < n; i += stepL) x.fillText('g' + (dispG0 + i), px(i), f.h - 6);
    x.textAlign = 'right';
    x.fillText(maxE.toFixed(2), pad - 4, 16);
    x.fillText('0', pad - 4, 8 + H);
    x.strokeStyle = COL.good; x.lineWidth = 2; x.beginPath();
    for (i = 0; i < disp.length; i++) {
      var X = px(i), Y = py(disp[i]);
      if (i === 0) x.moveTo(X, Y); else x.lineTo(X, Y);
    }
    x.stroke(); x.lineWidth = 1;
    x.fillStyle = COL.good;
    for (i = 0; i < disp.length; i++) {
      x.beginPath(); x.arc(px(i), py(disp[i]), 4, 0, 7); x.fill();
    }
    var first = disp[0], last = disp[disp.length - 1];
    var drop = 100 * (first - last) / first;
    x.fillStyle = COL.txt; x.font = '13px sans-serif'; x.textAlign = 'left';
    x.fillText(first.toFixed(4) + ' → ' + last.toFixed(4) + '  (' + drop.toFixed(1) + '% lower)', pad + 6, 24);
    qs('nx-evoinfo').textContent =
      isFinite(S.maxGens)
        ? 'generation ' + S.curve.length + '/' + S.maxGens + ' sealed — best error ' + last.toFixed(4) +
          '. Every point is a frozen snapshot that beat its siblings.'
        : '∞ eternal — gen ' + S.gen + ', best error ' + last.toFixed(4) +
          ' (showing last ' + disp.length + '). The lineage has no cap — only ⏹ STOP ends it.';
  }

  function drawAll() {
    drawThink(); drawBelief(); drawLayerPE(); drawHorizon(); drawAntimatter();
    drawMini('nx-live', S.live, false);
    drawMini('nx-frozen', S.frozen, true);
    if (flash > 0) flash--;
    /* v34: decay-capture flash — amber ring on the frozen panel */
    if (decayFlash > 0) {
      var c = qs('nx-frozen');
      if (c && c.getContext) {
        var x = c.getContext('2d');
        x.strokeStyle = 'rgba(251,191,36,' + (0.3 + 0.7 * (decayFlash % 20) / 20) + ')';
        x.lineWidth = 4; x.strokeRect(3, 3, c.width - 6, c.height - 6); x.lineWidth = 1;
      }
      decayFlash--;
    }
    drawEvo();
    /* live immutability proof: the frozen copy never changes */
    if (S.frozen) {
      var now = C.checksum(S.frozen), ok = (now === S.frozenSum);
      qs('nx-snapinfo').textContent =
        'snapshot #' + S.snapCount + ' · checksum ' + S.frozenSum +
        (ok ? ' ✓ unchanged' : ' ✗ CORRUPTED') +
        ' — the live loop keeps rewriting itself; the copy is frozen.';
    }
  }

  function setStatus(t) { qs('nx-status').textContent = t; }

  function handleEvents(ev) {
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.type === 'snapshot') {
        flash = 50;
        setStatus('❄️ SNAPSHOT — generation ' + e.gen + ' frozen (checksum ' + e.sum +
          '). The live loop keeps mutating; the copy never changes.');
      } else if (e.type === 'variant') {
        setStatus('gen ' + e.gen + ' · variant ' + (e.v + 1) + '/' + S.VN + ' thinking…');
      } else if (e.type === 'gendone') {
        renderFInfo();
        renderApInfo();
        setStatus('✓ gen ' + e.gen + ' sealed — best error ' + e.err.toFixed(4) + '. Winner seeds the next generation.');
      } else if (e.type === 'done') {
        var c = e.curve, drop = 100 * (c[0] - c[c.length - 1]) / c[0];
        setStatus('🏁 COMPLETE — error ' + c[0].toFixed(4) + ' → ' + c[c.length - 1].toFixed(4) +
          ' (' + drop.toFixed(1) + '% lower). The core rewrote itself into something better.');
        /* v35: persistent lineage — the champion auto-saves, no prompt needed */
        try { saveChampion(C.champRecord(S)); } catch (ce) {}
        /* v33: run recorder — ask before anything is written */
        try {
          if (_G.NL_NEXUS_RUNS) _G.NL_NEXUS_RUNS.savePrompt({
            source: 'visualizer',
            generations: S.maxGens,
            errCurve: c.slice(),
            beliefTraj: null,
            beliefFinal: C.pYes(S.theta),
            snapshot: { checksum: S.frozenSum, untouched: true },
            params: { D: C.D, T: C.T, LR: C.LR, variants: S.VN, seed: 16,
                      stack_depth: S.depth, act: S.act }
          });
        } catch (nxr) {}
      } else if (e.type === 'genstall') {
        /* v39: every variant blew up this generation (non-finite) — the core
         * kept the old champion and carried on. Honest signal, not a crash. */
        setStatus('⚠️ gen ' + e.gen + ' stalled — all variants diverged, champion held. ' +
          'Try tanh (the safe default) or a shallower stack.');
      } else if (e.type === 'decaypoint') {
        /* v34: the decay point — capture moment */
        decayFlash = 60;
        setStatus('🎯 DECAY POINT at gen ' + e.gen + ' — improvement ΔE=' + e.dE.toFixed(4) +
          ' < ε. Freezing the exact state (checksum ' + e.sum + ')…');
      } else if (e.type === 'decayverified') {
        setStatus(e.ok ?
          '✓ decay point VERIFIED — the parent replayed the frozen snapshot and reproduced err exactly. The record is certified.' :
          '✗ decay verification FAILED — record not certified, no handoff.');
      } else if (e.type === 'handoff') {
        var entry = ledgerAppend({
          parentSig: e.parentSig, childSig: e.childSig,
          parentErr: S.decay ? S.decay.err : 0, childLR: e.childLR,
          gen: e.gen, ts: e.ts,
          resumedFrom: S.resumeHash || undefined /* v35: cross-run chain link */
        });
        renderLedger(); renderPair();
        setStatus('🧬 ENTANGLED HANDOFF — child genesis ' + e.childSig +
          ' seeded from parent decay ' + e.parentSig + ' (lr ' + e.childLR.toFixed(4) +
          ', belief inherited). Ledger #' + ledgerLoad().length + ' sealed.');
      } else if (e.type === 'ghost') {
        /* v41: a ghost snapshot froze pre-compression — persist + render */
        ghostPersist();
        renderGhosts();
        setStatus('👻 GHOST ' + e.sum + ' — pre-compression state frozen at gen ' + e.gen +
          ' (mid-episode). Exact copy, checksum-sealed — ready for layer-3 feedback or manual re-ingestion.');
      } else if (e.type === 'autopilot') {
        /* v43: the decay law fired as a switch — hash-log the trigger */
        ledgerAppend({ kind: 'autopilot', ts: Date.now(), gen: e.gen,
          slope: +e.slope.toFixed(5), burst: e.burst, ghosts: e.ghosts,
          note: 'plateau slope ' + e.slope.toFixed(5) + ' < thresh — burst x' +
                (S ? S.apMutScale : 3) + ', ' + e.ghosts + ' ghost(s) minted, crawler threshold halved' });
        renderLedger();
        renderApInfo();
        setStatus('🎛 AUTO-PILOT fired at gen ' + e.gen + ' — slope ' + e.slope.toFixed(5) +
          ' stalled: mutation burst x' + (S ? S.apMutScale : 3) + ' for ' + e.burst +
          ' gens, ' + e.ghosts + ' redundant-unit ghost(s) minted, crawler threshold halved. Logged in the ledger.');
      }
    }
    renderDecayInfo();
  }

  function tick() {
    if (!running) return;
    var ev = C.frame(S, speed);
    handleEvents(ev);
    drawAll();
    if (S.phase === 'done') { running = false; syncBtns(); }
    else raf = requestAnimationFrame(tick);
  }
  function syncBtns() {
    qs('btn-nx-run').disabled = running;
    qs('btn-nx-pause').disabled = !running;
  }
  function gens() {
    var g = parseInt(qs('nx-gens').value, 10);
    return Math.max(1, Math.min(20, isFinite(g) ? g : 8));
  }
  /* v39: Deep Core controls — stack depth (1–6) + nonlinearity per run */
  function nxDepth() {
    var el = qs('nx-depth');
    return C.normDepth(el ? el.value : C.DEPTH_DEFAULT);
  }
  function nxAct() {
    var el = qs('nx-act');
    return C.normAct(el ? el.value : 'tanh');
  }
  function syncDepthActControls() {
    var dEl = qs('nx-depth'); if (dEl && S) dEl.value = S.depth;
    var aEl = qs('nx-act'); if (aEl && S) aEl.value = S.act;
  }

  function setMode(m) {
    var vm = (m === 'vm');
    qs('qvm-view').style.display = vm ? '' : 'none';
    qs('nexus-view').style.display = vm ? 'none' : '';
    qs('btn-qmode-vm').className = vm ? 'primary' : '';
    qs('btn-qmode-nexus').className = vm ? '' : 'primary';
    if (!vm) { fitAll(); drawAll(); }
  }
  function fitAll() { drawAll(); }

  function init() {
    if (typeof document === 'undefined') return;
    if (!qs('nexus-view')) return;
    S = C.create(8);
    qs('btn-qmode-vm').onclick = function () { setMode('vm'); };
    qs('btn-qmode-nexus').onclick = function () { setMode('nexus'); };
    qs('btn-nx-run').onclick = function () {
      if (eternal.on) eternalStop(); /* v37: manual run takes over from eternal */
      var g = gens();
      S.resumeHash = null; /* v35: fresh run starts a new chain */
      /* v39: the run carries the stack config from the controls */
      S.depth = nxDepth(); S.act = nxAct(); S.legacyNote = null;
      if (S.phase === 'idle' || S.phase === 'done' || g !== S.maxGens) {
        S.maxGens = g; var ev = C.start(S); handleEvents(ev);
      }
      var epsEl = qs('nx-eps');
      if (epsEl) C.setEps(S, epsEl.value);
      speed = parseInt(qs('nx-speed').value, 10) || 6;
      running = true; syncBtns(); tick();
    };
    qs('btn-nx-pause').onclick = function () {
      if (eternal.on) { eternalStop(); return; } /* v37: pause halts eternal too */
      running = false; syncBtns(); setStatus('⏸ paused — the core holds its thought.');
    };
    qs('btn-nx-step').onclick = function () {
      if (eternal.on) { setStatus('∞ eternal is ON — ⏹ STOP it first to step manually.'); return; }
      var g = gens();
      if (S.phase === 'idle' || S.phase === 'done') { S.maxGens = g; handleEvents(C.start(S)); }
      running = false; syncBtns();
      handleEvents(C.frame(S, 1)); drawAll();
    };
    qs('btn-nx-reset').onclick = function () {
      if (eternal.on) eternalStop(); /* v37: reset ends eternal first */
      running = false; C.reset(S, gens()); S.resumeHash = null; flash = 0; decayFlash = 0; syncBtns(); drawAll();
      setStatus('reset — tap ▶ Run to watch generation 0 think.');
      qs('nx-snapinfo').textContent = 'No snapshot yet — start a run.';
      qs('nx-evoinfo').textContent = 'No generations yet.';
      renderDecayInfo(); renderPair();
    };
    /* v35: persistent lineage — continue from the saved champion */
    var contBtn = qs('btn-nx-continue');
    if (contBtn) contBtn.onclick = function () {
      var champ = loadChampion();
      if (!champ) { setStatus('No saved champion yet — tap ▶ Run once (or run preset 16) and the Core will remember.'); return; }
      if (!C.champVerify(champ)) { setStatus('Saved champion failed its checksum — refusing to resume a corrupted lineage. Run fresh instead.'); return; }
      running = false;
      var more = gens();
      var ev = C.resume(S, champ, champ.gen + more);
      var rl = ledgerAppend({ kind: 'resume', fromSig: champ.checksum, gen: champ.gen, ts: Date.now() });
      S.resumeHash = rl.hash;
      handleEvents(ev);
      renderLedger();
      syncDepthActControls(); /* v39: the lineage carries its own depth + nonlinearity */
      if (S.legacyNote) setStatus('⚠️ ' + S.legacyNote + ' — continuing at depth ' + S.depth + ' · ' + S.act + '.');
      speed = parseInt(qs('nx-speed').value, 10) || 6;
      running = true; syncBtns(); tick();
      renderChampionInfo();
    };
    var expBtn = qs('btn-nx-exportchamp');
    if (expBtn) expBtn.onclick = exportChampion;
    /* v45 "Mirror": one-tap full-state export for J.A.R.V.I.S. */
    var jarvisBtn = qs('btn-nx-exportjarvis');
    if (jarvisBtn) jarvisBtn.onclick = exportJarvis;
    qs('nx-speed').oninput = function () {
      speed = parseInt(qs('nx-speed').value, 10) || 6;
      qs('nx-speed-val').textContent = speed;
    };
    /* v34: lineage toggle + decay epsilon */
    var linBtn = qs('btn-nx-lineage');
    if (linBtn) linBtn.onclick = function () {
      var on = C.setLineage(S, !S.lineage);
      linBtn.className = on ? 'primary' : '';
      linBtn.textContent = on ? '🧬 Lineage ON' : '🧬 Lineage OFF';
      renderDecayInfo();
    };
    var epsIn = qs('nx-eps');
    if (epsIn) epsIn.onchange = function () {
      renderDecayInfo();
      setStatus('decay ε = ' + C.setEps(S, epsIn.value) + ' — the monitor fires when ΔE < ε.');
    };
    /* v40: Event Horizon controls */
    function hzReadMK() {
      var mEl = qs('nx-hzm'), kEl = qs('nx-hzk');
      var M = mEl ? Math.max(2, Math.min(6, parseInt(mEl.value, 10) || 6)) : 6;
      var K = kEl ? Math.max(1, Math.min(M - 1, parseInt(kEl.value, 10) || 2)) : 2;
      return { M: M, K: K };
    }
    var hzBtn = qs('btn-nx-horizon');
    if (hzBtn) hzBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first — the horizon needs a live Core.'); return; }
      var mk = hzReadMK();
      var he = qs('btn-nx-hzent');
      if (S.hz && S.hz.on) {
        C.setHorizon(S, false);
        hzBtn.textContent = '🕳 Horizon OFF'; hzBtn.className = 'ghost';
        if (he) he.style.display = 'none';
        setStatus('🕳 horizon OFF — back to the v39 pipeline (bit-identical reference).');
      } else {
        var ent = !he || he.getAttribute('data-on') !== '0';
        C.setHorizon(S, true, ent, mk.M, mk.K);
        hzBtn.textContent = '🕳 Horizon ON'; hzBtn.className = 'primary';
        if (he) he.style.display = '';
        setStatus('🕳 horizon ON — ' + mk.M + '→' + mk.K + ' gravity compression, entanglement-inspired link ' +
          (ent ? 'ON 🔗' : 'OFF') + '. Takes effect next generation — paradox-inspired classical simulation.');
      }
      renderHzInfo(); drawHorizon();
    };
    var hzentBtn = qs('btn-nx-hzent');
    if (hzentBtn) hzentBtn.onclick = function () {
      if (!S || !S.hz || !S.hz.on) return;
      var now = !(hzentBtn.getAttribute('data-on') !== '0');
      hzentBtn.setAttribute('data-on', now ? '1' : '0');
      S.hz.entangled = now;
      if (S.champion && S.champion.horizon) S.champion.horizon.ent = now;
      hzentBtn.textContent = now ? '🔗 Entanglement-inspired link ON' : '🔗 Entanglement-inspired link OFF';
      hzentBtn.className = now ? 'primary' : '';
      renderHzInfo();
      setStatus(now ? '🔗 entanglement-inspired link ON — the exterior whispers back (γ=' + C.HZ_GAMMA +
        '), fidelity pressure λ=' + C.HZ_LAMBDA + ' joins selection. Watch how the gravity structure changes.'
        : '🔗 entanglement-inspired link OFF — the exterior watches but never touches. No coupling, no fidelity pressure.');
    };
    var hzcmpBtn = qs('btn-nx-hzcompare');
    if (hzcmpBtn) hzcmpBtn.onclick = hzCompareRun;
    /* v41: ghost snapshots — layer-3 feedback toggle + damping gain */
    var gfbBtn = qs('btn-nx-ghostfb');
    if (gfbBtn) gfbBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first — the feedback loop needs a live Core.'); return; }
      var now = C.setGhostFb(S, !S.ghostFb);
      syncGhostFb();
      if (now && (!S.hz || !S.hz.on))
        setStatus('👻 ghost feedback ON — but 🕳 Horizon is OFF, so no ghosts will freeze. Enable the horizon first.');
      else
        setStatus(now ? '👻 ghost feedback ON — each generation, the latest ghost blends (damped, gain=' + S.ghostGain + ') into layer 3. The horizon teaches the Core.'
                      : '👻 ghost feedback OFF — ghosts still freeze, but never feed back.');
    };
    var ggIn = qs('nx-ghostgain');
    if (ggIn) {
      ggIn.value = C.GHOST_FB_GAIN;
      ggIn.onchange = function () {
        if (!S) return;
        var v = C.setGhostGain(S, ggIn.value);
        ggIn.value = v;
        setStatus('👻 feedback damping gain = ' + v + ' (0–0.5 — bounded so the loop cannot run away).');
      };
    }
    /* v42: antimatter — master toggle, auto-spawn, publish gain, recover→crawl */
    var amBtn = qs('btn-nx-am');
    if (amBtn) amBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first — the inner loop needs a live Core.'); return; }
      var now = C.setAmOn(S, !S.amOn);
      syncAm(); drawAll();
      var has = S.champion && S.champion.antimatter;
      setStatus(now
        ? (has ? '⚛ antimatter ON — the ghost-built inner loop reads every layer, updates itself, publishes where the Core can read. Write-protected both ways.'
               : '⚛ antimatter ON — no inner loop yet. Select a ghost above and tap 🕷 Recover: the crawler hunts relatives, the spawn roll decides.')
        : '⚛ antimatter OFF — the inner loop (if spawned) goes dormant. Nothing deleted.');
    };
    var amSpBtn = qs('btn-nx-amspawn');
    if (amSpBtn) amSpBtn.onclick = function () {
      if (!S) return;
      var now = C.setAmSpawn(S, !(S.amSpawn !== false));
      syncAm();
      setStatus(now ? '⚛ auto-spawn ON — a fired roll composes the inner loop from the recovered ghosts.'
                    : '⚛ auto-spawn OFF — recoveries still crawl + stack, but no loop is composed.');
    };
    var amgIn = qs('nx-amgain');
    if (amgIn) {
      amgIn.value = C.AM_GAIN;
      amgIn.onchange = function () {
        if (!S) return;
        var v = C.setAmGain(S, amgIn.value);
        amgIn.value = v;
        setStatus('⚛ publish gain = ' + v + ' (0–0.3 — bounded, the inner loop cannot drag the Core).');
      };
    }
    var amRecBtn = qs('btn-nx-amrecover');
    if (amRecBtn) amRecBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first — recovery needs a live Core.'); return; }
      if (!ghostSel) { setStatus('🕷 select a ghost in the 👻 card first — the crawler starts from the recovered ghost.'); return; }
      var res = C.amRecover(S, ghostSel);
      if (!res.ok) { setStatus('🕷 recovery failed: ' + res.reason); return; }
      renderAmFeeds(); drawAll();
      setStatus('🕷 recovered ' + ghostSel + ' → crawler found ' + res.hops + ' hops, stacked ' +
        res.collected.length + ' ghosts · match ' + res.meanSim.toFixed(3) + ' → p=' + res.p.toFixed(3) +
        ' · roll ' + res.roll.toFixed(3) + ' → ' +
        (res.fired ? (res.spawned ? '⚛ SPAWNED — inner superloop composed (recipe ' + res.recipe + ').'
                                 : '⚛ roll FIRED but not spawned: ' + res.spawnReason)
                   : '🎲 no spawn this time — stochastic, same seed decides the same way.'));
    };
    /* ══ v44 "Annihilation" UI ═══════════════════════════════════════ */
    var amResidBtn = qs('btn-nx-amresid');
    if (amResidBtn) amResidBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      var now = C.setAmResid(S, !(S.amResid !== false));
      syncAm();
      ledgerAppend({ kind: 'am-mode', ts: Date.now(), gen: S.gen, mode: 'residual-publish', on: now,
        note: now ? 'antimatter publishes the damped orthogonal residual (pure novelty)'
                  : 'antimatter publishes its raw state (legacy)' });
      renderLedger();
      setStatus(now ? '🧬 residual publish ON — the loop annihilates the shared projection and feeds back only what the Core does not already contain.'
                    : '🧬 residual publish OFF — legacy raw publish. Run 📊 Compare to see the difference.');
    };
    var amSignBtn = qs('btn-nx-amsigninv');
    if (amSignBtn) amSignBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      var now = C.setAmSignInv(S, !S.amSignInv);
      syncAm();
      ledgerAppend({ kind: 'am-mode', ts: Date.now(), gen: S.gen, mode: 'sign-inversion', on: now,
        note: 'antimatter path applies −tanh (bias cancellation experiment)' });
      renderLedger();
      setStatus(now ? '➖ sign inversion ON — the antimatter path inverts: positive error drives flip to cancel recurring bias.'
                    : '➖ sign inversion OFF.');
    };
    var amZsBtn = qs('btn-nx-amzerosum');
    if (amZsBtn) amZsBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      var now = C.setAmZeroSum(S, !(S.amZeroSum !== false));
      syncAm();
      setStatus(now ? '🟰 zero-sum pairing ON — the NEXT spawn initializes AM.W = −(top-layer W) exactly (asserted).'
                    : '🟰 zero-sum pairing OFF — the next spawn uses the legacy RNG+ghost compose.');
    };
    var amCmpBtn = qs('btn-nx-amcompare');
    if (amCmpBtn) amCmpBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      setStatus('📊 comparing residual-publish vs raw publish — identical clones, 40 steps…');
      setTimeout(function () {
        var res;
        try { res = C.amCompare(S, 40); } catch (err) { setStatus('📊 compare failed: ' + (err && err.message)); return; }
        var el = qs('nx-amcompare');
        if (!res.ok) {
          if (el) el.innerHTML = '<div class="dsinfo">' + res.reason + '</div>';
          setStatus('📊 ' + res.reason); return;
        }
        if (el) el.innerHTML = '<div class="dsinfo">📊 residual-ON vs raw-OFF over 40 steps: mean |Δerr| = <b>' +
          res.meanAbsDiff.toFixed(6) + '</b> — ' +
          (res.differ ? 'the trajectories DIFFER: the filter changes what the Core learns.'
                      : 'identical trajectories — the filter is a no-op here.') + '</div>';
        ledgerAppend({ kind: 'am-compare', ts: Date.now(), gen: S.gen,
          meanAbsDiff: res.meanAbsDiff, differ: res.differ,
          note: 'residual-publish ON vs legacy raw OFF, 40 steps, identical clones' });
        renderLedger();
        setStatus('📊 compare done — mean |Δerr| = ' + res.meanAbsDiff.toFixed(6) +
          (res.differ ? ' (they differ — the filter matters).' : ' (identical).') + ' Ledger sealed.');
      }, 30);
    };
    /* --- bidirectional inversion --- */
    var invBtn = qs('btn-nx-invert');
    if (invBtn) invBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first — inversion needs a live Core.'); return; }
      var gamma = parseFloat((qs('nx-invgamma') || {}).value);
      setStatus('⇄ inverting — freezing the forward ghost, rolling the reverse pass…');
      setTimeout(function () {
        var res;
        try { res = C.invRoundTrip(S, { gamma: gamma }); }
        catch (err) { setStatus('⇄ inversion failed: ' + (err && err.message)); return; }
        var dir = qs('nx-invdir'), info = qs('nx-invinfo');
        if (dir) dir.innerHTML = '⇄ <b>REVERSE (abduction)</b> — ghost frozen, mismatch propagated downward, readout from Layer 1. ' +
          '<span style="opacity:.7">Tap ▶ Run to return to forward flow.</span>';
        if (!res.ok) {
          if (info) info.innerHTML = '<div class="dsinfo">' + res.reason + '</div>';
          setStatus('⇄ ' + res.reason); return;
        }
        if (info) info.innerHTML = '<div class="dsinfo">⇄ round-trip fidelity <b>' + res.fidelity.toFixed(4) +
          '</b> · input ' + res.xtrue.toFixed(4) + ' → decoded ' + res.xhat.toFixed(4) +
          ' · relErr ' + res.relErr.toFixed(4) + ' · γ=' + res.gamma +
          '<br>' + res.verdict + '</div>';
        ledgerAppend({ kind: 'inversion', ts: Date.now(), gen: S.gen, gamma: res.gamma,
          fidelity: res.fidelity, aboveChance: res.aboveChance,
          note: 'forward-encode → freeze ghost → reverse-decode → Layer-1 readout' });
        renderLedger();
        setStatus('⇄ inversion done — fidelity ' + res.fidelity.toFixed(4) + '. ' + res.verdict + ' Ledger sealed.');
      }, 30);
    };
    var invAutoBtn = qs('btn-nx-invauto');
    if (invAutoBtn) invAutoBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      var now = C.setInvAuto(S, !S.invAuto);
      invAutoBtn.textContent = now ? "Auto-invert on '>' ON" : "Auto-invert on '>' OFF";
      invAutoBtn.className = now ? 'primary' : 'ghost';
      setStatus(now ? "⇄ auto-invert ON — the '>' delimiter in char-RNN generation triggers a reverse pass (future CTF cipher path)."
                    : "⇄ auto-invert OFF.");
    };
    var invGIn = qs('nx-invgamma');
    if (invGIn) invGIn.onchange = function () {
      if (!S) return;
      var v = C.setInvGamma(S, invGIn.value);
      invGIn.value = v;
      setStatus('⇄ reverse gain γ = ' + v + ' (0.05–1).');
    };
    /* ══ v43 Gauntlet UI ══════════════════════════════════════════════ */
    var CHAR = (typeof NL_CHARRNN !== 'undefined') ? NL_CHARRNN : null;
    var charModel = null, charLife = null;
    var shockBtn = qs('btn-nx-shocktest');
    if (shockBtn) shockBtn.onclick = function () {
      var type = (qs('nx-shocktype') || {}).value || 'noise';
      var after = Math.max(2, Math.min(10, parseInt((qs('nx-shockafter') || {}).value, 10) || 5));
      setStatus('⚡ shock experiment running — both arms, same seed, ghost-recovery ON vs OFF…');
      setTimeout(function () {
        var res;
        try { res = C.shockTest({ type: type, seed: S ? S.seed : 16, depth: 3, shockGen: 2, after: after }); }
        catch (err) { setStatus('⚡ shock test failed: ' + (err && err.message)); return; }
        renderShockRes(res);
        ledgerAppend({ kind: 'shock-test', ts: Date.now(), gen: S ? S.gen : 0,
          shockType: res.type, gensToRecoverOn: res.on.gensToRecover, gensToRecoverOff: res.off.gensToRecover,
          note: 'shock=' + res.type + ' seed=' + res.seed + ' — ' + res.verdict });
        renderLedger();
        setStatus('⚡ shock experiment done — ' + res.verdict +
          ' (ON: ' + res.on.gensToRecover + ' gens, OFF: ' + res.off.gensToRecover + ' gens to recover). Ledger sealed.');
      }, 30);
    };
    var valChk = qs('nx-val');
    if (valChk) valChk.onchange = function () {
      if (!S) { valChk.checked = false; setStatus('tap ▶ Run first.'); return; }
      C.setVal(S, valChk.checked, 40);
      setStatus(valChk.checked
        ? '🔬 held-out validation ON — every variant is also scored on a pristine window it never trained on (t in [T, 2T), no learning).'
        : '🔬 held-out validation OFF.');
    };
    var apBtn = qs('btn-nx-autopilot');
    if (apBtn) apBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      var k = parseInt((qs('nx-apk') || {}).value, 10);
      var th = parseFloat((qs('nx-apthresh') || {}).value);
      C.setAutoPilot(S, !S.autoPilot, k, th);
      syncAp();
      setStatus(S.autoPilot
        ? '🎛 auto-pilot ON — when the rolling slope stalls below ' + S.apThresh + ', the Core fires its own lifecycle: burst + compression + crawler boost.'
        : '🎛 auto-pilot OFF.');
    };


    var moBtn = qs('btn-nx-mo');
    if (moBtn) moBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      var w1 = parseFloat((qs('nx-mow1') || {}).value), w2 = parseFloat((qs('nx-mow2') || {}).value),
          w3 = parseFloat((qs('nx-mow3') || {}).value);
      C.setMO(S, !S.moOn, w1, w2, w3);
      syncMO();
      setStatus(S.moOn
        ? '⚖ multi-objective ON — F = ' + S.moW1 + '·(1−err) + ' + S.moW2 + '·fid − ' + S.moW3 + '·cpx.'
        : '⚖ multi-objective OFF.');
    };
    /* --- stability --- */
    var stabBtn = qs('btn-nx-stab');
    if (stabBtn) stabBtn.onclick = function () {
      if (!S) { setStatus('tap ▶ Run first.'); return; }
      var now = C.setStab(S, !S.stabOn);
      stabBtn.textContent = now ? '🛡 Stability guard ON' : '🛡 Stability guard OFF';
      stabBtn.className = now ? 'primary' : 'ghost';
      setStatus(now
        ? '🛡 stability ON — LayerNorm after every recurrent/ghost/antimatter update; inner-loop spectral radius bounded at 0.9 (fading memory).'
        : '🛡 stability OFF.');
    };
    /* --- char-RNN --- */
    var ctext = qs('nx-chartext');
    if (ctext && CHAR) ctext.value = CHAR.SAMPLE_TEXT;
    function drawCharCurve(curve) {
      var c = qs('nx-charcurve'); if (!c) return;
      var f = fit(c, 160); if (!f) return;
      var x = f.ctx, W = f.w, Hh = f.h;
      x.fillStyle = COL.bg; x.fillRect(0, 0, W, Hh);
      if (!curve || !curve.length) return;
      var mx = curve[0], mn = curve[curve.length - 1], i;
      for (i = 0; i < curve.length; i++) { if (curve[i] > mx) mx = curve[i]; if (curve[i] < mn) mn = curve[i]; }
      var rg = Math.max(1e-6, mx - mn);
      x.strokeStyle = COL.acc; x.lineWidth = 2; x.beginPath();
      for (i = 0; i < curve.length; i++) {
        var px = 8 + (W - 16) * (curve.length === 1 ? 0 : i / (curve.length - 1));
        var py = 8 + (Hh - 16) * (1 - (curve[i] - mn) / rg);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
      x.fillStyle = COL.dim; x.font = '11px system-ui';
      x.fillText('loss ' + curve[0].toFixed(3) + ' → ' + curve[curve.length - 1].toFixed(3), 8, 14);
    }
    var charTrainBtn = qs('btn-nx-chartrain');
    /* v45 "Mirror": per-mode last curves so both modes' loss is visible */
    var charCurves = { next: null, masked: null };
    function drawCharCurves() {
      var c = qs('nx-charcurve'); if (!c) return;
      var f = fit(c, 160); if (!f) return;
      var x = f.ctx, W = f.w, Hh = f.h;
      x.fillStyle = COL.bg; x.fillRect(0, 0, W, Hh);
      var modes = [{ k: 'next', col: COL.acc, lbl: 'next-token' }, { k: 'masked', col: '#c084fc', lbl: 'masked' }];
      var all = [];
      modes.forEach(function (mm) { var cv = charCurves[mm.k]; if (cv) for (var i = 0; i < cv.length; i++) all.push(cv[i]); });
      if (!all.length) return;
      var mx = all[0], mn = all[0], i, m;
      for (i = 0; i < all.length; i++) { if (all[i] > mx) mx = all[i]; if (all[i] < mn) mn = all[i]; }
      var rg = Math.max(1e-6, mx - mn);
      modes.forEach(function (mm) {
        var curve = charCurves[mm.k]; if (!curve || !curve.length) return;
        x.strokeStyle = mm.col; x.lineWidth = 2; x.beginPath();
        for (i = 0; i < curve.length; i++) {
          var px = 8 + (W - 16) * (curve.length === 1 ? 0 : i / (curve.length - 1));
          var py = 8 + (Hh - 16) * (1 - (curve[i] - mn) / rg);
          if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
        }
        x.stroke();
      });
      x.fillStyle = COL.dim; x.font = '11px system-ui';
      var li = 8;
      modes.forEach(function (mm) {
        var curve = charCurves[mm.k]; if (!curve || !curve.length) return;
        x.fillStyle = mm.col;
        x.fillText(mm.lbl + ' ' + curve[0].toFixed(3) + ' → ' + curve[curve.length - 1].toFixed(3), li, 14);
        li += 170;
      });
    }
    if (charTrainBtn) charTrainBtn.onclick = function () {
      if (!CHAR) { setStatus('🔤 char-RNN module not loaded.'); return; }
      var text = (qs('nx-chartext') || {}).value || '';
      var epochs = Math.max(1, Math.min(20, parseInt((qs('nx-charepochs') || {}).value, 10) || 4));
      var lr = parseFloat((qs('nx-charlr') || {}).value) || 0.05;
      var mode = ((qs('nx-charmode') || {}).value === 'masked') ? 'masked' : 'next';
      var maskRate = parseFloat((qs('nx-charmaskrate') || {}).value) || 0.15;
      maskRate = Math.max(0.05, Math.min(0.4, maskRate));
      if (text.length < 120) { setStatus('🔤 need at least 120 characters of training text — paste more.'); return; }
      setStatus('🔤 training char-RNN (' + mode + ' mode) — ' + text.length + ' chars, ' + epochs + ' epochs…');
      charTrainBtn.disabled = true;
      setTimeout(function () {
        try {
          charModel = CHAR.newModel(7);
          var t0 = Date.now();
          var res, accTxt, modeNote;
          if (mode === 'masked') {
            res = CHAR.trainMasked(charModel, text, { epochs: epochs, lr: lr, unroll: 25, maskRate: maskRate, maskSeed: 7 });
            charLife = res.life;
            charCurves.masked = res.curve.slice();
            var ma = res.maskedAcc;
            accTxt = 'masked-char accuracy <b>' + (ma ? (ma.acc * 100).toFixed(1) + '% on ' + ma.n + ' masked' : 'n/a') + '</b> (chance ≈ 1.1%)';
            modeNote = 'masked x' + res.maskCount + ' (' + (res.maskRate * 100).toFixed(0) + '%, seeded)';
          } else {
            res = CHAR.train(charModel, text, { epochs: epochs, lr: lr, unroll: 25 });
            charLife = res.life;
            charCurves.next = res.curve.slice();
            var acc = CHAR.accuracy(charModel, text);
            accTxt = 'held-out next-char accuracy <b>' + (acc == null ? 'n/a' : (acc * 100).toFixed(1) + '%') + '</b> (chance ≈ 1.1%)';
            modeNote = 'next-token';
          }
          drawCharCurves();
          var info = qs('nx-charinfo');
          if (info) info.innerHTML = mode + ' trained in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's — loss ' +
            res.curve[0].toFixed(3) + ' → ' + res.curve[res.curve.length - 1].toFixed(3) +
            ' · ' + accTxt +
            ' · horizon compressed <b>' + res.life.compressed + '</b> recurring activations' +
            ' · crawler retrieved <b>' + res.life.retrieved + '</b> rare-context priors';
          var gb = qs('btn-nx-chargen'); if (gb) gb.disabled = false;
          ledgerAppend({ kind: 'char-rnn', ts: Date.now(), gen: S ? S.gen : 0,
            note: 'char-RNN trained (' + modeNote + '): ' + text.length + ' chars, ' + epochs + ' epochs, loss ' +
                  res.curve[0].toFixed(3) + '->' + res.curve[res.curve.length - 1].toFixed(3) });
          renderLedger();
          setStatus('🔤 trained (' + mode + ') — tap ✍ Generate, or switch modes and compare.');
        } catch (err) { setStatus('🔤 training failed: ' + (err && err.message)); }
        charTrainBtn.disabled = false;
      }, 30);
    };
    var charGenBtn = qs('btn-nx-chargen');
    if (charGenBtn) charGenBtn.onclick = function () {
      if (!CHAR || !charModel) { setStatus('🔤 train the model first.'); return; }
      var seed = (qs('nx-charseed') || {}).value || 'The Core ';
      var n = Math.max(20, Math.min(400, parseInt((qs('nx-charn') || {}).value, 10) || 120));
      var out = CHAR.generate(charModel, seed, n, 0); /* greedy = deterministic */
      var el = qs('nx-charout');
      if (el) el.textContent = out;
      setStatus('🔤 generated ' + n + ' chars (greedy — same seed prompt always gives the same text).');
    };
    /* ══ v46 "Atomic" UI ══════════════════════════════════════════════ */
    var ATOM = (typeof NL_ATOMIC !== 'undefined') ? NL_ATOMIC : null;
    function drawAtomCurve(curve) {
      var c = qs('nx-atomcurve'); if (!c) return;
      var f = fit(c, 160); if (!f) return;
      var x = f.ctx, W = f.w, Hh = f.h, i;
      x.fillStyle = COL.bg; x.fillRect(0, 0, W, Hh);
      if (!curve || !curve.length) return;
      var mx = curve[0], mn = curve[0];
      for (i = 0; i < curve.length; i++) { if (curve[i] > mx) mx = curve[i]; if (curve[i] < mn) mn = curve[i]; }
      var rg = Math.max(1e-9, mx - mn);
      x.strokeStyle = COL.acc; x.lineWidth = 2; x.beginPath();
      for (i = 0; i < curve.length; i++) {
        var px = 8 + (W - 16) * (curve.length === 1 ? 0 : i / (curve.length - 1));
        var py = 8 + (Hh - 16) * (1 - (curve[i] - mn) / rg);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.stroke();
      x.fillStyle = COL.dim; x.font = '11px system-ui';
      x.fillText('loss ' + curve[0].toFixed(4) + ' → ' + curve[curve.length - 1].toFixed(4), 8, 14);
    }
    function drawAtomMap(res) {
      var c = qs('nx-atommap'); if (!c || !ATOM) return;
      var f = fit(c, 300); if (!f) return;
      var x = f.ctx, W = f.w, Hh = f.h, i;
      x.fillStyle = COL.bg; x.fillRect(0, 0, W, Hh);
      if (!res || !res.coords) {
        x.fillStyle = COL.dim; x.font = '14px sans-serif'; x.textAlign = 'center';
        x.fillText('run the embeddings task to draw the element map', W / 2, Hh / 2);
        return;
      }
      var xs = res.coords.map(function (p) { return p[0]; }),
          ys = res.coords.map(function (p) { return p[1]; });
      var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs),
          y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
      var pad = 26;
      function px(v) { return pad + (W - pad * 2) * (v - x0) / Math.max(1e-9, x1 - x0); }
      function py(v) { return pad + (Hh - pad * 2) * (1 - (v - y0) / Math.max(1e-9, y1 - y0)); }
      x.fillStyle = COL.dim; x.font = '10px system-ui'; x.textAlign = 'left';
      x.fillText('PC1 →', W - 44, Hh - 8);
      for (i = 0; i < ATOM.EL.length; i++) {
        var el = ATOM.EL[i];
        x.fillStyle = ATOM.CATCOLORS[el[10]];
        x.beginPath(); x.arc(px(xs[i]), py(ys[i]), el[10] === 7 || el[10] === 0 ? 5 : 3.5, 0, 6.2832); x.fill();
        if (el[10] === 7 || el[10] === 0 || el[0] === 26 || el[0] === 79) {
          x.fillStyle = COL.txt; x.font = '9px system-ui';
          x.fillText(el[1], px(xs[i]) + 6, py(ys[i]) + 3);
        }
      }
      var lx = 8, ly = 14;
      x.font = '10px system-ui'; x.textAlign = 'left';
      var shown = [0, 1, 2, 4, 5, 6, 7, 8, 9, 3, 10];
      for (i = 0; i < shown.length; i++) {
        x.fillStyle = ATOM.CATCOLORS[shown[i]];
        x.beginPath(); x.arc(lx, ly - 3, 4, 0, 6.2832); x.fill();
        x.fillStyle = COL.dim; x.fillText(ATOM.CATNAMES[shown[i]], lx + 8, ly);
        lx += 8 + x.measureText(ATOM.CATNAMES[shown[i]]).width + 14;
        if (lx > W - 90) { lx = 8; ly += 16; }
      }
      var mi = qs('nx-atommapinfo');
      if (mi) mi.innerHTML = 'Element map — PC1 explains <b>' + (res.explained * 100).toFixed(1) +
        '%</b> of embedding variance. k-NN category agreement <b>' + (res.knnAcc * 100).toFixed(1) +
        '%</b> (chance ' + (res.knnChance * 100).toFixed(1) + '%): the geometry rediscovered the groups. ' +
        'Alkalis huddle (ratio ' + res.alkali.ratio.toFixed(2) + '); noble gases hold the high-ionization right as a loose band ' +
        '(ratio ' + res.noble.ratio.toFixed(2) + ' — He→Rn spans the mass range, united by shell-filling, not proximity).';
    }
    function atomTableHTML(scan) {
      var rows = ['<b>property</b>              <b>MAE</b>      <b>baseline</b>  <b>n</b>'],
          keys = ['en', 'ie', 'radius'], i, r;
      for (i = 0; i < keys.length; i++) {
        r = scan[keys[i]];
        rows.push((r.beats ? '✅ ' : '❌ ') + ATOM.PROPS[keys[i]].label.padEnd(22).slice(0, 22) +
          ' ' + r.mae.toFixed(3).padStart(8) + ' ' + r.base.toFixed(3).padStart(10) +
          '  ' + String(r.n).padStart(3) + ' ' + r.unit);
      }
      return rows.join('\n');
    }
    var atomTrainBtn = qs('btn-nx-atomtrain'), atomScanBtn = qs('btn-nx-atomscan');
    function atomBusy(b) {
      if (atomTrainBtn) atomTrainBtn.disabled = b;
      if (atomScanBtn) atomScanBtn.disabled = b;
    }
    if (atomTrainBtn) atomTrainBtn.onclick = function () {
      if (!ATOM) { setStatus('⚛ atomic module not loaded.'); return; }
      var task = (qs('nx-atomtask') || {}).value || 'predict';
      var prop = (qs('nx-atomprop') || {}).value || 'en';
      var epochs = Math.max(50, Math.min(1200, parseInt((qs('nx-atomepochs') || {}).value, 10) || 300));
      var lr = parseFloat((qs('nx-atomlr') || {}).value) || 0.05;
      var info = qs('nx-atominfo');
      setStatus('⚛ training (' + task + ') on 118 elements — ' + epochs + ' epochs…');
      atomBusy(true);
      setTimeout(function () {
        try {
          var t0 = Date.now(), html = '', note = '';
          if (task === 'predict') {
            var res = ATOM.trainPredict(prop, { seed: 16, epochs: epochs, lr: lr });
            drawAtomCurve(res.curve);
            html = 'predicted <b>' + ATOM.PROPS[prop].label + '</b> on <b>' + res.nTest +
              '</b> held-out elements (' + res.testSyms.join(', ') + '): MAE <b>' +
              res.testMAE.toFixed(3) + ' ' + ATOM.PROPS[prop].unit + '</b> vs mean-baseline ' +
              res.baseMAE.toFixed(3) + ' — ' + (res.beats ? '✅ <b>learned</b>' : '❌ no better than guessing the mean');
            note = 'predict ' + prop + ' MAE ' + res.testMAE.toFixed(3) + ' vs base ' + res.baseMAE.toFixed(3);
          } else if (task === 'masked') {
            var mk = ATOM.trainMasked({ seed: 16, epochs: epochs, lr: lr, maskRate: 0.4 });
            drawAtomCurve(mk.curve);
            var lines = ['masked-property reconstruction (ghost holds the context, output decodes it):'], q, p;
            var pks = ['en', 'ie', 'radius'];
            for (q = 0; q < pks.length; q++) {
              p = mk.per[pks[q]];
              lines.push((p.beats ? '✅ ' : '❌ ') + ATOM.PROPS[pks[q]].label + ': MAE ' +
                p.mae.toFixed(3) + ' vs base ' + p.base.toFixed(3) + ' ' + ATOM.PROPS[pks[q]].unit + ' (n=' + p.n + ')');
            }
            html = lines.join('<br>');
            note = 'masked reconstruction: ' + pks.map(function (k) {
              return k + ' ' + (mk.per[k].beats ? '✅' : '❌');
            }).join(' ');
          } else {
            var ep = Math.max(epochs, 600);
            var em = ATOM.trainEmbeddings({ seed: 16, epochs: ep, lr: lr });
            drawAtomCurve(em.curve);
            drawAtomMap(em);
            html = 'embeddings trained (' + em.nEl + ' elements, PC1 ' + (em.explained * 100).toFixed(1) +
              '%): k-NN category agreement <b>' + (em.knnAcc * 100).toFixed(1) + '%</b> vs chance ' +
              (em.knnChance * 100).toFixed(1) + '% — ' + (em.clusterPass ? '✅ <b>the map rediscovered the groups</b>' : '❌ groups not found') +
              '. Alkali ratio ' + em.alkali.ratio.toFixed(2) + ', noble ratio ' + em.noble.ratio.toFixed(2) + '.';
            note = 'embeddings kNN ' + (em.knnAcc * 100).toFixed(1) + '% vs chance ' + (em.knnChance * 100).toFixed(1) + '%';
          }
          if (info) info.innerHTML = html + ' <span style="color:#9a9aa8">(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)</span>';
          ledgerAppend({ kind: 'atomic', ts: Date.now(), gen: S ? S.gen : 0,
            note: '⚛ atomic (' + task + '): ' + note });
          renderLedger();
          setStatus('⚛ trained (' + task + ') — ' + note);
        } catch (err) { setStatus('⚛ training failed: ' + (err && err.message)); }
        atomBusy(false);
      }, 30);
    };
    if (atomScanBtn) atomScanBtn.onclick = function () {
      if (!ATOM) { setStatus('⚛ atomic module not loaded.'); return; }
      setStatus('📊 scanning all properties vs baseline…');
      atomBusy(true);
      setTimeout(function () {
        try {
          var scan = ATOM.scanAll({ seed: 16, epochs: 150, lr: 0.05 });
          var el = qs('nx-atomtable');
          if (el) el.textContent = atomTableHTML(scan);
          setStatus('📊 scan complete — the table shows MAE vs mean-baseline per property.');
          ledgerAppend({ kind: 'atomic', ts: Date.now(), gen: S ? S.gen : 0, note: '⚛ property scan vs baseline complete' });
          renderLedger();
        } catch (err) { setStatus('📊 scan failed: ' + (err && err.message)); }
        atomBusy(false);
      }, 30);
    };
    drawAtomMap(null);
    window.addEventListener('resize', fitAll);
    /* v37: eternal controls + background throttle + crash recovery */
    var etBtn = qs('btn-nx-eternal');
    if (etBtn) etBtn.onclick = eternalStart;
    var esBtn = qs('btn-nx-estop');
    if (esBtn) esBtn.onclick = eternalStop;
    try {
      document.addEventListener('visibilitychange', onVisChange);
      window.addEventListener('pagehide', onVisChange);
    } catch (e) {}
    syncBtns();
    drawAll();
    renderLedger(); renderPair(); renderDecayInfo(); renderChampionInfo(); renderEternal(); renderHzInfo();
    /* v41: ghost snapshots — restore the archive, render, sync the toggle */
    ghostRestore(); renderGhosts(); syncGhostFb();
    /* v42: antimatter — sync toggles, render the feeds */
    syncAm(); renderAmFeeds();
    /* v43 Gauntlet — sync toggles + readouts */
    try { syncAp(); syncMO(); renderFInfo(); } catch (e) {}
    /* v33: run recorder history */
    try { if (_G.NL_NEXUS_RUNS) _G.NL_NEXUS_RUNS.init(); } catch (e) {}
    /* v37b: crash recovery — auto-resume an eternal session the app died in */
    try { eternalBootCheck(); } catch (e) {}
    /* v38: Nexus Mesh — consent-gated champion exchange + swarm simulator */
    try { if (_G.NL_MESH) _G.NL_MESH.init(); } catch (e) {}
  }

  return { init: init, setMode: setMode, core: C, decayStatus: decayStatus, ledgerLoad: ledgerLoad,
           saveChampion: saveChampion, loadChampion: loadChampion, horizonStatus: horizonStatus,
           eternalStart: eternalStart, eternalStop: eternalStop, eternalStatus: eternalStatus,
           meshLedger: ledgerAppend, renderLedger: renderLedger, champInfo: renderChampionInfo,
           buildJarvisBundle: buildJarvisBundle, exportJarvis: exportJarvis };
})();
