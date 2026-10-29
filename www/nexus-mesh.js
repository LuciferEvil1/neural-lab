'use strict';
/* Neural Lab v38 "Nexus Mesh" — opt-in distributed evolution for the
 * Quantum Nexus Core. Ahkeem's consent-based signal: a device that ACCEPTS a
 * champion payload runs it and can forward it. NOTHING enters the Core unless
 * he taps ACCEPT — that gate is the whole point.
 *
 * Split design (same as nexus.js):
 *   NL_MESH_CORE = pure protocol, no DOM — testable in Node.
 *   NL_MESH      = UI wiring (mesh card, challenger flow, swarm simulator).
 *
 * Honest framing: classical simulation; the payload "signature" is an
 * integrity checksum seal (tamper-evident), not cryptographic identity.
 * Transfer between real devices is file-based (export → Bluetooth / Nearby
 * Share / Files → Downloads → import) — no native code in this build.
 */
var _G = (typeof window !== 'undefined') ? window :
         (typeof global !== 'undefined') ? global : this;

_G.NL_MESH_CORE = (function () {
  var THEORY = 'quantum-nexus-core/1';
  function C() { return _G.NL_NEXUS_CORE; }

  /* ── champion exchange protocol ──────────────────────────────── */
  /* signed envelope around a champion record. sig = checksum over the
   * canonical envelope fields — any tampering breaks it.
   * v39: the envelope carries the full stack (stack_depth + act + layers). */
  function signPayload(champRec, label) {
    var c = C();
    var nc = c.normalizeChamp(champRec);
    var body = {
      kind: 'nexus-mesh-payload', v: 3, theory: THEORY,
      label: String(label == null ? 'anonymous' : label).slice(0, 64),
      gen: nc.gen, err: nc.err, phi: nc.phi, ts: Date.now(),
      stack_depth: nc.stack_depth, act: nc.act,
      layers: nc.layers.map(function (la) {
        return { W: c.clone(la.W), U: c.clone(la.U), h: la.h.slice() };
      }),
      V: nc.V.slice(),
      /* v40: the horizon travels — gravity matrix + decoder, sealed.
       * Exterior partners are episode state and never leave the phone. */
      horizon: (nc.horizon && nc.horizon.on) ? {
        on: true, ent: !!nc.horizon.ent, M: nc.horizon.M, K: nc.horizon.K,
        gamma: nc.horizon.gamma, G: c.clone(nc.horizon.G), A: c.clone(nc.horizon.A),
        Vh: nc.horizon.Vh.slice()
      } : null,
      err_curve: (nc.err_curve || []).slice(-32) /* tail only — small payload */
    };
    body.checksum = c.checksum(c.champCanon({
      layers: body.layers, V: body.V, stack_depth: body.stack_depth,
      act: body.act, horizon: body.horizon
    }));
    body.sig = c.checksum({ checksum: body.checksum, label: body.label,
      gen: body.gen, err: body.err, phi: body.phi, ts: body.ts, theory: body.theory,
      stack_depth: body.stack_depth, act: body.act,
      horizon: body.horizon ? [body.horizon.M, body.horizon.K, body.horizon.ent ? 1 : 0].join(',') : '' });
    return body;
  }
  function verifyPayload(p) {
    var c = C();
    if (!p || p.kind !== 'nexus-mesh-payload')
      return { ok: false, reason: 'not a Nexus Mesh payload' };
    if (p.theory !== THEORY)
      return { ok: false, reason: 'theory mismatch: ' + p.theory };
    var chk, sigInput;
    if (p.layers) {
      /* v40 horizon envelope (v3); v39 stacked (v2) still honored */
      var isV3 = (p.v === 3) || (p.horizon !== undefined);
      chk = { v: isV3 ? 3 : 2,
              stack_depth: (p.stack_depth == null ? p.layers.length : p.stack_depth),
              act: p.act || 'tanh', layers: p.layers, V: p.V,
              horizon: p.horizon || null, checksum: p.checksum };
      sigInput = { checksum: p.checksum, label: p.label, gen: p.gen,
        err: p.err, phi: p.phi, ts: p.ts, theory: p.theory,
        stack_depth: chk.stack_depth, act: chk.act,
        horizon: p.horizon ? [p.horizon.M, p.horizon.K, p.horizon.ent ? 1 : 0].join(',') : '' };
    } else {
      /* v38 envelope — legacy single-layer format, still honored */
      chk = { W: p.W, U: p.U, V: p.V, h: p.h, checksum: p.checksum };
      sigInput = { checksum: p.checksum, label: p.label, gen: p.gen,
        err: p.err, phi: p.phi, ts: p.ts, theory: p.theory };
    }
    if (!c.champVerify(chk))
      return { ok: false, reason: 'checksum FAILED — payload tampered or corrupted' };
    if (c.checksum(sigInput) !== p.sig)
      return { ok: false, reason: 'signature mismatch — envelope tampered' };
    return { ok: true };
  }
  /* payload → champion-shaped record (what the Core can adopt).
   * v39: always normalized to the stacked working shape. */
  function payloadToChamp(p) {
    var c = C();
    var raw = p.layers
      ? { stack_depth: (p.stack_depth == null ? p.layers.length : p.stack_depth),
          act: p.act || 'tanh', layers: p.layers, V: p.V,
          phi: p.phi, gen: p.gen, err: p.err, err_curve: p.err_curve,
          ts: p.ts, checksum: p.checksum, horizon: p.horizon || null }
      : { W: p.W, U: p.U, V: p.V, h: p.h,
          phi: p.phi, gen: p.gen, err: p.err, err_curve: p.err_curve,
          ts: p.ts, checksum: p.checksum };
    var n = c.normalizeChamp(raw);
    n.meshLabel = p.label;
    return n;
  }
  /* validation harness: identical episodes, NO learning (lr=0), fresh hidden
   * state every episode. Deterministic — the same champion always scores the
   * same. v39: each champion fights in its OWN architecture (depth + act travel
   * with the weights), so tournaments work across different stack depths —
   * the fair fight is identical *episodes*, not identical bodies. */
  function evalChampion(champ, episodes) {
    var c = C(), e, t, i, m = 0, L, st;
    episodes = episodes || 4;
    var nc = c.normalizeChamp(champ);
    for (e = 0; e < episodes; e++) {
      var layers = [];
      for (i = 0; i < nc.stack_depth; i++) {
        var zh = [];
        for (var k = 0; k < c.D; k++) zh.push(0);
        /* v39c: carry the per-layer feedback F (l>0) into the eval loop. */
        var lo = { W: c.clone(nc.layers[i].W), U: c.clone(nc.layers[i].U), h: zh };
        if (i > 0 && nc.layers[i].F) lo.F = nc.layers[i].F.slice();
        layers.push(lo);
      }
      L = { depth: nc.stack_depth, act: nc.act, layers: layers,
            V: nc.V.slice(), peSum: c.zeroPe(nc.stack_depth), peN: 0 };
      /* v40: a horizon champion fights with its horizon — the gravity
       * matrix travels; the exterior starts fresh (episode state). */
      if (nc.horizon && nc.horizon.on) {
        var hzp = [], _kk;
        for (_kk = 0; _kk < nc.horizon.K; _kk++) hzp.push(0);
        L.horizon = { on: true, ent: !!nc.horizon.ent, M: nc.horizon.M, K: nc.horizon.K,
                      gamma: nc.horizon.gamma || 0.3, alpha: 0.2,
                      G: c.clone(nc.horizon.G), A: c.clone(nc.horizon.A || []),
                      Vh: nc.horizon.Vh.slice(),
                      p: hzp, acc: null, fid: null };
        /* zero-fill A for pre-channel payloads */
        if (!L.horizon.A.length) {
          for (_kk = 0; _kk < L.horizon.K; _kk++) {
            L.horizon.A.push([]);
            for (var _ii = 0; _ii < L.horizon.M; _ii++) L.horizon.A[_kk].push(0);
          }
        }
      }
      for (t = 0; t < c.T; t++) { st = c.step(L, t, 0); m += Math.abs(st.err); }
    }
    return m / (episodes * c.T);
  }
  /* tournament: both champions fight identical validation episodes.
   * Lower error wins. Pure — no side effects; the UI applies the result
   * ONLY after ACCEPT. */
  function tournament(champA, champB, episodes) {
    var ea = evalChampion(champA, episodes), eb = evalChampion(champB, episodes);
    if (eb < ea) return { winner: champB, loser: champA, errW: eb, errL: ea };
    return { winner: champA, loser: champB, errW: ea, errL: eb };
  }
  /* cross-breed: per-element uniform crossover of every layer's W/U/V/h +
   * whisper noise, belief averaged. The child is ledger-linked to BOTH parents.
   * v39: the stack must match — crossover needs identical bodies. Different
   * depths/acts refuse with a clear message (tournament still works). */
  function crossbreed(champA, champB, rnd) {
    var c = C(), i, j, l;
    rnd = rnd || Math.random;
    var na = c.normalizeChamp(champA), nb = c.normalizeChamp(champB);
    if (na.stack_depth !== nb.stack_depth)
      throw new Error('cross-breed needs matching stack depth — yours: ' +
        na.stack_depth + ', challenger: ' + nb.stack_depth +
        '. Tournament still works across depths.');
    if (na.act !== nb.act)
      throw new Error('cross-breed needs matching nonlinearity — yours: ' +
        na.act + ', challenger: ' + nb.act +
        '. Tournament still works across nonlinearities.');
    /* v40: the horizon must match too — crossover needs identical bodies. */
    var ha = (na.horizon && na.horizon.on) ? na.horizon : null;
    var hb = (nb.horizon && nb.horizon.on) ? nb.horizon : null;
    if (!!ha !== !!hb)
      throw new Error('cross-breed needs matching horizon — one champion has the Event Horizon on, the other does not. ' +
        'Tournament still works across horizons.');
    if (ha && (ha.M !== hb.M || ha.K !== hb.K))
      throw new Error('cross-breed needs matching horizon shape — yours: ' +
        ha.M + '→' + ha.K + ', challenger: ' + hb.M + '→' + hb.K +
        '. Tournament still works across shapes.');
    function pick(a, b) { return rnd() < 0.5 ? a : b; }
    function wob(v) { return v + (rnd() * 2 - 1) * 0.005; }
    var layers = [];
    for (l = 0; l < na.stack_depth; l++) {
      var W = [], U = [], h = [], F = null;
      var laA = na.layers[l], laB = nb.layers[l];
      for (i = 0; i < c.D; i++) {
        W.push([]); h.push(0);
        if (l === 0) U.push(wob(pick(laA.U[i], laB.U[i])));
        else {
          U.push([]);
          /* v39c: crossover the per-layer feedback vectors too. */
          if (F === null) F = [];
          F.push(wob(pick(
            laA.F ? laA.F[i] : 0,
            laB.F ? laB.F[i] : 0)));
        }
        for (j = 0; j < c.D; j++) {
          W[i].push(wob(pick(laA.W[i][j], laB.W[i][j])));
          if (l > 0) U[i].push(wob(pick(laA.U[i][j], laB.U[i][j])));
        }
      }
      var lo2 = { W: W, U: U, h: h };
      if (F) lo2.F = F;
      layers.push(lo2);
    }
    var V = [];
    for (i = 0; i < c.D; i++) V.push(wob(pick(na.V[i], nb.V[i])));
    var child = {
      kind: 'champion', v: 3,
      stack_depth: na.stack_depth, act: na.act,
      layers: layers, V: V,
      phi: ((na.phi || 0) + (nb.phi || 0)) / 2,
      gen: Math.max(na.gen || 0, nb.gen || 0),
      err: null, err_curve: [], ts: Date.now(),
      parents: [na.checksum, nb.checksum], bred: true,
      /* v40: crossover the gravity matrix + horizon decoder too. */
      horizon: null
    };
    if (ha) {
      var Gc = [], Ac = [], Vhc = [], kk2, ii2, jj2;
      for (kk2 = 0; kk2 < ha.K; kk2++) {
        Gc.push([]); Ac.push([]); Vhc.push(wob(pick(ha.Vh[kk2], hb.Vh[kk2])));
        for (ii2 = 0; ii2 < ha.M; ii2++) {
          Gc[kk2].push([]);
          Ac[kk2].push(wob(pick(ha.A ? ha.A[kk2][ii2] : 0, (hb.A && hb.A[kk2]) ? hb.A[kk2][ii2] : 0)));
          for (jj2 = 0; jj2 < ha.M; jj2++)
            Gc[kk2][ii2].push(wob(pick(ha.G[kk2][ii2][jj2], hb.G[kk2][ii2][jj2])));
        }
      }
      child.horizon = { on: true, ent: ha.ent && hb.ent, M: ha.M, K: ha.K,
                        gamma: ha.gamma || 0.3, G: Gc, A: Ac, Vh: Vhc };
    }
    child.checksum = c.checksum(c.champCanon({
      layers: child.layers, V: child.V, stack_depth: child.stack_depth,
      act: child.act, horizon: child.horizon
    }));
    return child;
  }
  /* prepareAccept: verify the payload. Pure — the local champion is NEVER
   * touched here. Returns the challenger ready for the ACCEPT gate. */
  function prepareAccept(localChamp, payload) {
    var v = verifyPayload(payload);
    if (!v.ok) return { ok: false, reason: v.reason };
    return { ok: true, challenger: payloadToChamp(payload) };
  }
  /* applyAccept: runs ONLY after the user taps ACCEPT. Returns the outcome
   * the UI then persists (winner or bred child) + ledger facts. */
  function applyAccept(localChamp, challenger, mode, rnd) {
    if (mode === 'breed' && localChamp) {
      var child = crossbreed(localChamp, challenger, rnd);
      return { kind: 'breed', child: child,
               parents: [localChamp.checksum, challenger.checksum] };
    }
    if (!localChamp)
      return { kind: 'adopt', winner: challenger, loser: null,
               errW: challenger.err, errL: null,
               note: 'no local champion — challenger adopted by default' };
    var t = tournament(localChamp, challenger, 4);
    return { kind: 'tournament', winner: t.winner, loser: t.loser,
             errW: t.errW, errL: t.errL };
  }

  /* ── swarm simulator: virtual nodes, gossip, migration ───────── */
  /* a node = its own Core state, own RNG seed, eternal by construction
   * (no generation cap — same chunked spirit as eternal mode). */
  function createNode(id, seed) {
    var c = C();
    var S = c.create(Infinity, seed);
    c.setEternal(S, true);
    return { id: id, S: S, paused: false, seed: seed, best: Infinity };
  }
  /* a node adopts a champion's weights (migration / tournament loss).
   * Belief inherited; the node's own RNG stream and gen count continue.
   * v39: the full stack is adopted — the node takes the champion's depth
   * and nonlinearity too (the lineage carries its architecture). */
  function adoptChampion(node, champ) {
    var c = C();
    var nc = c.normalizeChamp(champ);
    node.S.champion = { depth: nc.stack_depth, act: nc.act, layers: nc.layers,
                        V: nc.V.slice(), peSum: c.zeroPe(nc.stack_depth), peN: 0,
                        /* v40: the horizon migrates with the champion */
                        horizon: nc.horizon ? {
                          on: nc.horizon.on, ent: nc.horizon.ent,
                          M: nc.horizon.M, K: nc.horizon.K,
                          gamma: nc.horizon.gamma, alpha: 0.2,
                          G: c.clone(nc.horizon.G),
                          A: (function () {
                            if (nc.horizon.A) return c.clone(nc.horizon.A);
                            var z = [], _a, _b;
                            for (_a = 0; _a < nc.horizon.K; _a++) {
                              z.push([]);
                              for (_b = 0; _b < nc.horizon.M; _b++) z[_a].push(0);
                            }
                            return z;
                          })(),
                          Vh: nc.horizon.Vh.slice(),
                          p: nc.horizon.p.slice(), acc: null, fid: null
                        } : null };
    if (nc.horizon && nc.horizon.on)
      node.S.hz = { on: true, entangled: nc.horizon.ent, M: nc.horizon.M, K: nc.horizon.K };
    else if (node.S.hz) node.S.hz = null;
    if (node.S.depth !== nc.stack_depth || node.S.act !== nc.act) {
      node.S.depth = nc.stack_depth; node.S.act = nc.act;
      node.S.layerPE = []; node.S.peAcc = c.zeroPe(nc.stack_depth);
    }
    node.S.inheritTheta = (nc.phi != null) ? nc.phi : null;
    node.best = Infinity; /* re-prove from the adopted weights */
  }
  /* one gossip round: shuffle, pair up, champions fight identical
   * validation episodes, the loser node adopts the winner's weights.
   * Returns the migration list (ledger facts). Paused nodes sit out. */
  function gossip(nodes, rnd, evalEps) {
    var c = C(), i, j, a, b, ra, rb, res, migs = [];
    rnd = rnd || Math.random;
    var order = nodes.slice();
    for (i = order.length - 1; i > 0; i--) {
      j = Math.floor(rnd() * (i + 1));
      var t = order[i]; order[i] = order[j]; order[j] = t;
    }
    for (i = 0; i + 1 < order.length; i += 2) {
      a = order[i]; b = order[i + 1];
      if (a.paused || b.paused) continue;
      ra = c.champRecord(a.S); rb = c.champRecord(b.S);
      res = tournament(ra, rb, evalEps || 2);
      var winnerNode = (res.winner === ra) ? a : b;
      var loserNode = (winnerNode === a) ? b : a;
      if (res.winner.checksum !== c.champRecord(loserNode.S).checksum) {
        adoptChampion(loserNode, res.winner);
        migs.push({ from: winnerNode.id, to: loserNode.id,
                    errW: res.errW, errL: res.errL,
                    winnerSig: res.winner.checksum, gen: loserNode.S.gen });
      }
    }
    return migs;
  }
  /* global best across nodes — must never rise across gossip rounds */
  function swarmBest(nodes) {
    var b = Infinity, i, e;
    for (i = 0; i < nodes.length; i++) {
      e = nodeErr(nodes[i]);
      if (e < b) b = e;
    }
    return b;
  }
  function nodeErr(node) {
    var cv = node.S.curve;
    if (cv && cv.length) return cv[cv.length - 1];
    return node.best === Infinity ? Infinity : node.best;
  }

  return {
    THEORY: THEORY,
    signPayload: signPayload, verifyPayload: verifyPayload,
    payloadToChamp: payloadToChamp,
    evalChampion: evalChampion, tournament: tournament, crossbreed: crossbreed,
    prepareAccept: prepareAccept, applyAccept: applyAccept,
    createNode: createNode, adoptChampion: adoptChampion,
    gossip: gossip, swarmBest: swarmBest, nodeErr: nodeErr
  };
})();

/* ══ Nexus Mesh UI ══════════════════════════════════════════════ */
_G.NL_MESH = (function () {
  var MC = _G.NL_MESH_CORE;
  function qs(id) { return document.getElementById(id); }
  function NX() { return _G.NL_NEXUS; }
  var inited = false;
  var pending = null; /* verified challenger awaiting ACCEPT — the consent gate */

  function mstatus(t) { var el = qs('nx-meshstatus'); if (el) el.textContent = t; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── champion exchange ── */
  function exportPayload() {
    var nx = NX(); if (!nx) { mstatus('Nexus not ready.'); return; }
    var champ = nx.loadChampion();
    if (!champ) { mstatus('No saved champion yet — run the Core once (▶ Run or preset 16) so there is something to share.'); return; }
    var labelEl = qs('nx-meshlabel');
    var label = labelEl ? labelEl.value : "Ahkeem's A17";
    var payload = MC.signPayload(champ, label);
    var name = 'nexus-mesh-payload-' + payload.checksum + '.json';
    var text = JSON.stringify(payload);
    var api = null;
    try { api = _G.NL_Q_API; } catch (e) {}
    if (api && api.saveTextFile) {
      try {
        api.saveTextFile(name, text);
        mstatus('⤴ exporting ' + name + ' — pick Downloads in the file picker, then send it to the other device (Bluetooth / Nearby Share). ' +
          'Nothing leaves your phone except this file, and nothing enters the other Core without their ACCEPT.');
        return;
      } catch (e) { mstatus('export failed: ' + e.message); return; }
    }
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      mstatus('downloaded ' + name + ' (browser fallback).');
    } catch (e2) { mstatus('export failed: ' + e2.message); }
  }
  function onFilePicked(e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var p;
      try { p = JSON.parse(String(rd.result)); }
      catch (pe) { mstatus('✕ that file is not valid JSON — pick the nexus-mesh-payload-*.json file.'); return; }
      var prep = MC.prepareAccept(null, p); /* verify only — local champ untouched */
      if (!prep.ok) { mstatus('✕ payload REJECTED before anything happened: ' + prep.reason); return; }
      pending = prep.challenger;
      pending._label = p.label;
      renderChallenger(p);
      mstatus('challenger verified ✓ — checksum + signature intact. It is WAITING. Nothing is applied until you tap ACCEPT.');
    };
    rd.readAsText(f);
  }
  function renderChallenger(p) {
    var el = qs('nx-challenger'); if (!el) return;
    el.style.display = '';
    el.innerHTML =
      '<div class="dsinfo" style="border-left:3px solid #40e0ff">' +
      '🛜 <b>challenger</b> from <b>' + esc(p.label) + '</b> · gen ' + p.gen +
      ' · claimed err ' + Number(p.err).toFixed(4) +
      ' · depth ' + (p.stack_depth || 1) + ' · ' + esc(p.act || 'tanh') +
      (p.horizon && p.horizon.on ? ' · 🕳 horizon ' + p.horizon.M + '→' + p.horizon.K +
        (p.horizon.ent ? ' 🔗' : '') : '') +
      '<br>checksum <b>' + p.checksum + '</b> · sig ✓ VERIFIED · theory ' + esc(p.theory) +
      '<br><span style="opacity:.75">The payload is intact — and it is still outside your Core. ' +
      'Accept runs a fair tournament (or cross-breed) against YOUR champion on identical episodes.</span>' +
      '<div class="row" style="margin-top:8px">' +
      '<label class="dsinfo" style="display:flex;align-items:center;gap:8px;min-height:48px;margin:0;flex:1">' +
      '<input type="radio" name="nx-meshmode" value="tournament" checked style="width:32px;height:32px;flex:none">' +
      '<span>⚔️ tournament — winner takes the Core</span></label>' +
      '<label class="dsinfo" style="display:flex;align-items:center;gap:8px;min-height:48px;margin:0;flex:1">' +
      '<input type="radio" name="nx-meshmode" value="breed" style="width:32px;height:32px;flex:none">' +
      '<span>🧬 cross-breed — child of both</span></label>' +
      '</div>' +
      '<div class="row" style="margin-top:8px">' +
      '<button id="btn-nx-meshaccept" class="primary" style="min-height:48px;flex:1">✓ ACCEPT</button>' +
      '<button id="btn-nx-meshreject" class="ghost" style="min-height:48px;flex:1">✕ REJECT</button>' +
      '</div></div>';
    var ab = document.getElementById('btn-nx-meshaccept');
    var rb = document.getElementById('btn-nx-meshreject');
    if (ab) ab.onclick = acceptChallenger;
    if (rb) rb.onclick = rejectChallenger;
  }
  function clearChallenger() {
    pending = null;
    var el = qs('nx-challenger');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  }
  function meshMode() {
    var r = document.querySelector('input[name="nx-meshmode"]:checked');
    return r ? r.value : 'tournament';
  }
  /* THE gate. Nothing before this line has touched the local champion. */
  function acceptChallenger() {
    var nx = NX();
    if (!pending || !nx) { mstatus('nothing pending.'); return; }
    var challenger = pending, mode = meshMode();
    var local = nx.loadChampion();
    if (local && !_G.NL_NEXUS_CORE.champVerify(local)) {
      mstatus('your saved champion failed its checksum — refusing to fight a corrupted lineage. Run fresh first.');
      return;
    }
    var res;
    try {
      res = MC.applyAccept(local, challenger, mode, Math.random);
    } catch (err) {
      /* v39: cross-breed across different stack depths/acts refuses here */
      mstatus('✕ ' + (err && err.message ? err.message : err));
      return;
    }
    if (res.kind === 'breed') {
      nx.saveChampion(res.child);
      nx.meshLedger({ kind: 'mesh-breed', breedSig: res.child.checksum,
        parents: res.parents, ts: Date.now(),
        note: 'cross-breed of local ' + res.parents[0] + ' × challenger ' + res.parents[1] +
              ' (' + esc(challenger._label || '?') + ')' });
      nx.renderLedger(); nx.champInfo();
      clearChallenger();
      mstatus('🧬 cross-bred — child ' + res.child.checksum + ' now leads your Core, ledger-linked to BOTH parents.');
    } else if (res.kind === 'adopt') {
      nx.saveChampion(challenger);
      nx.meshLedger({ kind: 'mesh-accept', label: challenger._label || '?',
        challengerSig: challenger.checksum, winnerSig: challenger.checksum,
        errBefore: null, errL: null, errAfter: challenger.err, ts: Date.now(),
        note: res.note });
      nx.renderLedger(); nx.champInfo();
      clearChallenger();
      mstatus('✓ ACCEPTED — no local champion existed, so the challenger (' + challenger.checksum + ') was adopted by default.');
    } else {
      /* tournament: archive the loser, crown the winner */
      if (res.loser) nx.saveChampion(res.loser); /* loser archived to history */
      nx.saveChampion(res.winner);
      var won = (res.winner.checksum === (local && local.checksum));
      nx.meshLedger({ kind: 'mesh-accept', label: challenger._label || '?',
        challengerSig: challenger.checksum, winnerSig: res.winner.checksum,
        errBefore: res.errL, errAfter: res.errW, ts: Date.now() });
      nx.renderLedger(); nx.champInfo();
      clearChallenger();
      mstatus(won
        ? '⚔️ tournament done — YOUR champion held (err ' + res.errW.toFixed(4) + ' vs challenger ' + res.errL.toFixed(4) + '). Challenger archived.'
        : '⚔️ tournament done — the CHALLENGER won (err ' + res.errW.toFixed(4) + ' vs yours ' + res.errL.toFixed(4) + ') and now leads your Core. Your old champion is archived in history.');
    }
  }
  function rejectChallenger() {
    clearChallenger();
    mstatus('✕ rejected — nothing entered your Core. The challenger is gone.');
  }

  /* ── swarm simulator ── */
  var mesh = { nodes: [], running: false, timer: null,
               gossipEvery: 4, sinceGossip: 0, flashes: [], best: Infinity };
  function meshCount() {
    var el = qs('nx-meshcount'), v = el ? parseInt(el.value, 10) : 4;
    return Math.max(2, Math.min(8, isFinite(v) ? v : 4));
  }
  function meshGossipK() {
    var el = qs('nx-meshgossip'), v = el ? parseInt(el.value, 10) : 4;
    return Math.max(1, Math.min(20, isFinite(v) ? v : 4));
  }
  function meshStart() {
    var C = _G.NL_NEXUS_CORE, nx = NX();
    meshStop(true);
    var n = meshCount();
    mesh.nodes = [];
    for (var i = 0; i < n; i++) {
      var node = MC.createNode(i, 1000 + i * 77);
      C.runGens(node.S, 1); /* wake the state machine out of idle */
      node.best = MC.nodeErr(node);
      mesh.nodes.push(node);
    }
    mesh.gossipEvery = meshGossipK();
    mesh.sinceGossip = 0; mesh.flashes = []; mesh.best = MC.swarmBest(mesh.nodes);
    mesh.running = true;
    if (nx) {
      nx.meshLedger({ kind: 'mesh-migrate', nodeFrom: '—', nodeTo: 'swarm',
        errBefore: null, errAfter: null, ts: Date.now(),
        note: 'swarm started — ' + n + ' virtual nodes, gossip every ' + mesh.gossipEvery + ' gens' });
      nx.renderLedger();
    }
    mstatus('🛜 swarm live — ' + n + ' nodes evolving independently, gossip every ' + mesh.gossipEvery + ' gens. Champions migrate; the swarm best never rises.');
    syncMeshBtns(); renderMeshNodes();
    mesh.timer = setInterval(meshTick, 500);
  }
  function meshStop(silent) {
    if (mesh.timer != null) { try { clearInterval(mesh.timer); } catch (e) {} mesh.timer = null; }
    mesh.running = false;
    if (!silent) mstatus('swarm stopped at global best err ' +
      (isFinite(mesh.best) ? mesh.best.toFixed(4) : 'n/a') + '.');
    syncMeshBtns();
  }
  function syncMeshBtns() {
    var s = qs('btn-nx-meshstart'), t = qs('btn-nx-meshstop');
    if (s) { s.disabled = mesh.running; s.className = mesh.running ? '' : 'primary'; }
    if (t) { t.disabled = !mesh.running; t.className = mesh.running ? 'primary' : 'ghost'; }
    var c = qs('nx-meshcount'), g = qs('nx-meshgossip');
    if (c) c.disabled = mesh.running;
    if (g) g.disabled = mesh.running;
  }
  function meshTick() {
    var C = _G.NL_NEXUS_CORE, nx = NX();
    if (!mesh.running) return;
    var i, node, e;
    for (i = 0; i < mesh.nodes.length; i++) {
      node = mesh.nodes[i];
      if (node.paused) continue;
      C.runGens(node.S, 1);
      e = MC.nodeErr(node);
      if (e < node.best) node.best = e;
    }
    mesh.sinceGossip++;
    if (mesh.sinceGossip >= mesh.gossipEvery) {
      mesh.sinceGossip = 0;
      var migs = MC.gossip(mesh.nodes, Math.random, 2);
      for (i = 0; i < migs.length; i++) {
        var m = migs[i];
        mesh.flashes.push({ from: m.from, to: m.to, ttl: 6 });
        if (nx) nx.meshLedger({ kind: 'mesh-migrate', nodeFrom: m.from, nodeTo: m.to,
          errBefore: m.errL, errAfter: m.errW, winnerSig: m.winnerSig,
          ts: Date.now() });
      }
      if (migs.length && nx) nx.renderLedger();
    }
    var b = MC.swarmBest(mesh.nodes);
    if (b < mesh.best) mesh.best = b;
    for (i = mesh.flashes.length - 1; i >= 0; i--) {
      mesh.flashes[i].ttl--;
      if (mesh.flashes[i].ttl <= 0) mesh.flashes.splice(i, 1);
    }
    renderMeshNodes(); drawMesh();
  }
  function renderMeshNodes() {
    var el = qs('nx-meshnodes'); if (!el) return;
    var C = _G.NL_NEXUS_CORE, html = '', i, node, e, p;
    for (i = 0; i < mesh.nodes.length; i++) {
      node = mesh.nodes[i];
      e = MC.nodeErr(node);
      p = C.pYes(node.S.theta);
      html += '<div class="dsinfo" style="display:flex;align-items:center;gap:8px;margin:6px 0;' +
        (node.paused ? 'opacity:.55' : '') + '">' +
        '<b>n' + node.id + '</b><span>gen ' + node.S.gen + '</span>' +
        '<span>err ' + (isFinite(e) ? e.toFixed(4) : '…') + '</span>' +
        '<span>p(yes) ' + p.toFixed(2) + '</span>' +
        '<button data-meshpause="' + node.id + '" class="ghost" style="min-height:48px;margin-left:auto">' +
        (node.paused ? '▶ unpause' : '⏸ pause') + '</button></div>';
    }
    if (!mesh.nodes.length)
      html = '<div class="dsinfo">swarm idle — set nodes + gossip interval, then ▶ Start swarm.</div>';
    else
      html += '<div class="dsinfo">swarm best err: <b>' +
        (isFinite(mesh.best) ? mesh.best.toFixed(4) : '…') +
        '</b> — gossip migrates winners; it never rises.</div>';
    el.innerHTML = html;
    var btns = el.querySelectorAll('[data-meshpause]');
    for (i = 0; i < btns.length; i++) {
      (function (b) {
        b.onclick = function () {
          var id = parseInt(b.getAttribute('data-meshpause'), 10);
          if (mesh.nodes[id]) {
            mesh.nodes[id].paused = !mesh.nodes[id].paused;
            renderMeshNodes();
          }
        };
      })(btns[i]);
    }
  }
  function drawMesh() {
    var cv = qs('nx-mesh'); if (!cv || typeof window === 'undefined') return;
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth;
    if (!w) return;
    var H = 220;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    var x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#141419'; x.fillRect(0, 0, w, H);
    var n = mesh.nodes.length;
    x.fillStyle = '#9a9aa8'; x.font = '13px sans-serif'; x.textAlign = 'center';
    if (!n) { x.fillText('▶ Start swarm — virtual nodes appear here', w / 2, H / 2); return; }
    var cx = w / 2, cy = H / 2, r = Math.min(w / 2 - 46, 66), i, j;
    var pos = [];
    for (i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      pos.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    /* faint full-mesh links */
    x.strokeStyle = 'rgba(122,122,140,.25)'; x.lineWidth = 1;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      x.beginPath(); x.moveTo(pos[i][0], pos[i][1]); x.lineTo(pos[j][0], pos[j][1]); x.stroke();
    }
    /* migration flashes */
    for (i = 0; i < mesh.flashes.length; i++) {
      var f = mesh.flashes[i], al = Math.min(1, f.ttl / 6);
      x.strokeStyle = 'rgba(251,191,36,' + al.toFixed(2) + ')'; x.lineWidth = 3;
      x.beginPath(); x.moveTo(pos[f.from][0], pos[f.from][1]);
      x.lineTo(pos[f.to][0], pos[f.to][1]); x.stroke(); x.lineWidth = 1;
    }
    /* nodes — greener = better */
    var errs = mesh.nodes.map(MC.nodeErr);
    var lo = Math.min.apply(null, errs.filter(isFinite).concat([Infinity]));
    var hi = Math.max.apply(null, errs.filter(isFinite).concat([0]));
    for (i = 0; i < n; i++) {
      var node = mesh.nodes[i], e = errs[i];
      var t = (hi > lo && isFinite(e)) ? (e - lo) / (hi - lo) : 0.5;
      x.fillStyle = node.paused ? '#3a3a44'
        : 'rgb(' + Math.round(74 + t * 150) + ',' + Math.round(222 - t * 120) + ',' + Math.round(128 - t * 60) + ')';
      x.beginPath(); x.arc(pos[i][0], pos[i][1], 20, 0, 7); x.fill();
      x.fillStyle = '#0b0b0e'; x.font = 'bold 12px sans-serif';
      x.fillText('n' + node.id, pos[i][0], pos[i][1] + 4);
      x.fillStyle = '#d8d8e0'; x.font = '10px sans-serif';
      x.fillText(isFinite(e) ? e.toFixed(3) : '…', pos[i][0], pos[i][1] + 34);
    }
  }
  function status() {
    var nx = NX();
    var parts = ['swarm=' + (mesh.running ? 'RUNNING(' + mesh.nodes.length + ' nodes)' : 'idle')];
    parts.push('pending challenger=' + (pending ? pending.checksum : 'none'));
    if (nx) {
      var l = nx.ledgerLoad(), mc = 0, i;
      for (i = 0; i < l.length; i++) if (l[i].kind && l[i].kind.indexOf('mesh-') === 0) mc++;
      parts.push('mesh ledger entries=' + mc);
    }
    parts.push('nothing enters your Core without ACCEPT');
    return parts.join(' · ');
  }

  function init() {
    if (typeof document === 'undefined') return;
    if (!qs('nx-mesh') || inited) return;
    inited = true;
    var ex = qs('btn-nx-meshexport'); if (ex) ex.onclick = exportPayload;
    var im = qs('btn-nx-meshimport'); if (im) im.onclick = function () { qs('nx-meshfile').click(); };
    var fi = qs('nx-meshfile'); if (fi) fi.addEventListener('change', onFilePicked);
    var st = qs('btn-nx-meshstart'); if (st) st.onclick = meshStart;
    var sp = qs('btn-nx-meshstop'); if (sp) sp.onclick = function () { meshStop(false); };
    var mc = qs('nx-meshcount'); if (mc) mc.onchange = syncMeshBtns;
    syncMeshBtns(); renderMeshNodes(); drawMesh();
    mstatus('mesh ready — export a payload, or start the swarm to watch gossip dynamics.');
  }

  return { init: init, status: status,
           exportPayload: exportPayload, acceptChallenger: acceptChallenger,
           meshStart: meshStart, meshStop: meshStop };
})();
