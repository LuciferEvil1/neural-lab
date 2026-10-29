/* Neural Lab — Meta Model API Ghost judge (hackathon Days 1–2 wiring).
 *
 * When the Terrarium brain condemns a run and seals a ghost, this module
 * asks Muse Spark (via the Meta Model API, Chat Completions format) for a
 * one-sentence judgment of the failure, and attaches it to the ghost.
 * The judgment surfaces in the EXISTING event/thought log — no new panels.
 *
 * HARD RULES (do not relax):
 *  - The API key is NEVER baked into this file or any build. The user
 *    pastes it on their own phone in Dev Options; it lives only in that
 *    device's localStorage (key 'nl_meta_api_key') and is sent ONLY to
 *    the Meta Model API endpoint below, in the Authorization header.
 *  - The key is NEVER logged, displayed, or included in any event/log
 *    message. Status messages say only whether a key is set.
 *  - The judge NEVER blocks or breaks the seal: _sealGhost runs first
 *    (local seal, as before) and this call is fire-and-forget. Every
 *    failure path resolves to a short log note, never a throw.
 *  - The API is called ONLY on run condemnation (one short call per
 *    sealed ghost), with a timeout, so the $150 free-credit budget is
 *    spent on judgments, not ticks.
 *
 * Endpoint (Meta Model API, OpenAI-compatible Chat Completions):
 *   POST https://api.meta.ai/v1/chat/completions
 *   { model: "muse-spark-1.3",
 *     messages: [{role:"system",...},{role:"user",...}],
 *     max_tokens: 1024, temperature: 0.2 }
 *   → choices[0].message.content
 * v73 diagnostic: every judge outcome below ALSO posts a visible think()
 * line, so a blocked/failed call shows in the live overlay instead of
 * living only in the events log (which the overlay never renders).
 * v74 diagnostic: the bridge error/empty think lines also carry the first
 * 200 chars of the API's raw reply body, so the exact server response
 * (error message, empty body, or odd envelope) is visible in the overlay.
 * v81: the verdict prompt now asks for a machine-readable tail line
 * (FRAG:<actionIndex>:<severity>) alongside the human sentence. When it
 * parses, the brain mints ONE bounded molecule fragment from the verdict
 * (brain.addJudgeFragment — same caps/ladder/overflow as ghost fragments),
 * so the judge participates in steering instead of only commenting. The
 * FRAG tail is stripped from the displayed judgment. Malformed or missing
 * tail → behavior is exactly the pre-v81 verdict-only path.
 * v81 also adds judgeReview(): one bundled-history call that writes a
 * short review paragraph over the brain's recent ghosts, shown on the
 * Instruments "Judge's Review" card. Same key/transport rules.
 */
(function (global) {
  'use strict';
  var ENDPOINT = 'https://api.meta.ai/v1/chat/completions';
  var MODEL = 'muse-spark-1.3';
  var TIMEOUT_MS = 20000;
  var MAX_TOKENS = 1024;
  var KEY_STORAGE = 'nl_meta_api_key';

  function getKey() {
    try {
      var k = global.localStorage && global.localStorage.getItem(KEY_STORAGE);
      return k ? String(k).trim() : '';
    } catch (e) { return ''; }
  }

  function clean(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) : s;
  }

  function actionNames() {
    try { if (global.NL_TERCORE && global.NL_TERCORE.ACTIONS) return global.NL_TERCORE.ACTIONS; } catch (e) {}
    return ['seek orb', 'seek food', 'explore', 'wander', 'rest', 'inspect', 'return center', 'retreat'];
  }

  /* v81 — the verdict's machine-readable tail: FRAG:<action 0-7>:<severity 1-3>. */
  function parseFrag(raw) {
    var m = /FRAG\s*:\s*([0-7])\s*:\s*([1-3])\b/.exec(String(raw == null ? '' : raw));
    if (!m) return null;
    return { action: parseInt(m[1], 10), severity: parseInt(m[2], 10) };
  }
  function stripFrag(raw) {
    return String(raw == null ? '' : raw).replace(/FRAG\s*:\s*\d+\s*:\s*\d+/gi, ' ');
  }
  /* Mint the bounded judge fragment for a parsed verdict tail. Never throws. */
  function mintFragment(brain, ghost, frag) {
    if (!frag) return;
    try {
      if (brain && typeof brain.addJudgeFragment === 'function') brain.addJudgeFragment(ghost, frag.action, frag.severity);
    } catch (e) { /* the judge must never break the brain */ }
  }

  function buildPrompt(ghost, outcome) {
    var names = actionNames();
    var acts = (ghost.acts || []).slice(-6).join(', ');
    var user = 'Objective: ' + clean(outcome.objective, 120) +
      '. Failure: ' + clean(outcome.why || 'no progress', 120) +
      '. Recent actions: ' + clean(acts, 200) + '.';
    if (typeof outcome.action === 'number' && names[outcome.action]) {
      user += ' Run action: ' + outcome.action + ' (' + names[outcome.action] + ').';
    }
    user += ' Actions: ' + names.map(function (n, i) { return i + '=' + n; }).join(', ') + '.';
    return [
      { role: 'system', content: 'You are a terse judge of a tiny on-device AI\'s failed run. Reply with ONE short sentence: what failed and one lesson. No preamble, no extra sentences. Then on a NEW line output exactly FRAG:<a>:<s> where <a> is the index of the single action most to blame from the action list and <s> is severity 1 (minor), 2 (clear) or 3 (severe). Example tail: FRAG:6:2' },
      { role: 'user', content: user }
    ];
  }

  /* Fire-and-forget: always resolves, never throws. */
  function judgeGhost(brain, ghost, outcome) {
    try {
      var key = getKey();
      if (!key) {
        brain.events.push({ kind: 'judge', msg: '⚖ Meta judge skipped — no API key set (Dev Options → Meta API key). Ghost sealed locally.' });
        brain.think('Meta judge skipped on ghost ' + ghost.seal + ' — no API key set.');
        return;
      }
      if (typeof fetch === 'undefined') {
        brain.events.push({ kind: 'judge', msg: '⚖ Meta judge unavailable in this build — ghost sealed locally.' });
        brain.think('Meta judge unavailable on ghost ' + ghost.seal + ' — sealed locally.');
        return;
      }
      var controller = null;
      try { if (typeof AbortController !== 'undefined') controller = new AbortController(); } catch (e) { controller = null; }
      var timer = null;
      if (controller) {
        timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, TIMEOUT_MS);
      }
      var body = JSON.stringify({
        model: MODEL,
        messages: buildPrompt(ghost, outcome),
        max_tokens: MAX_TOKENS,
        temperature: 0.2
      });
      /* v72: prefer the native bridge (NB.metaJudgePost) — Java HTTPS has
       * no file-URL restrictions, so it bypasses the WebView block that
       * kept Requests at 0 in v70/v71 even with a key saved. The key
       * travels only as the bridge argument and only leaves in the
       * Authorization header, exactly as with fetch. Falls through to
       * fetch if the bridge is absent (older builds, Node tests). */
      try {
        if (typeof NB !== 'undefined' && NB && typeof NB.metaJudgePost === 'function') {
          if (timer) clearTimeout(timer);
          var res = NB.metaJudgePost(key, body);
          var nl = res.indexOf('\n');
          var code = 0;
          var payload = '';
          if (nl >= 0) {
            code = parseInt(res.slice(5, nl), 10) || 0;
            payload = res.slice(nl + 1);
          }
          var rawSnippet = payload ? payload.replace(/[\r\n]+/g, ' ').slice(0, 200) : '(empty body)';
          if (code < 200 || code >= 300) {
            brain.events.push({ kind: 'judge', msg: '⚖ Meta judge HTTP ' + (code || 0) + ' — ghost sealed locally.' });
            brain.think('Meta judge bridge HTTP ' + (code || 0) + ' on ghost ' + ghost.seal + ' — reply: ' + rawSnippet + ' — sealed locally.');
            return;
          }
          var data = JSON.parse(payload);
          var text2 = '';
          try { text2 = data.choices[0].message.content; } catch (e) { text2 = ''; }
          var frag2 = parseFrag(text2);
          text2 = clean(stripFrag(text2), 240);
          if (!text2) {
            brain.events.push({ kind: 'judge', msg: '⚖ Meta judge empty reply — ghost sealed locally.' });
            brain.think('Meta judge bridge empty reply on ghost ' + ghost.seal + ' — raw: ' + rawSnippet + ' — sealed locally.');
            return;
          }
          ghost.judgment = text2;
          ghost.judgedBy = 'meta-spark';
          brain.events.push({ kind: 'judge', msg: '⚖ Meta judge on ghost ' + ghost.seal + ': "' + text2 + '"' });
          brain.think('Meta judge on ghost ' + ghost.seal + ': ' + text2);
          mintFragment(brain, ghost, frag2);
          return;
        }
      } catch (e) {
        if (timer) clearTimeout(timer);
        brain.events.push({ kind: 'judge', msg: '⚖ Meta judge error — ghost sealed locally.' });
        brain.think('Meta judge bridge error on ghost ' + ghost.seal + ' — sealed locally.');
        return;
      }
      /* v73 diagnostic: reaching here means the bridge did not run at all
       * (NB absent) — say so visibly before the fetch fallback. */
      try { brain.think('Meta judge: no native bridge on ghost ' + ghost.seal + ' — fetch fallback.'); } catch (e) {}
      /* The key travels ONLY here, in the Authorization header. */
      var opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: body };
      if (controller) opts.signal = controller.signal;
      fetch(ENDPOINT, opts).then(function (resp) {
        if (!resp.ok) {
          var err = new Error('http');
          err.status = resp.status;
          throw err;
        }
        return resp.json();
      }).then(function (data) {
        if (timer) clearTimeout(timer);
        var text = '';
        try { text = data.choices[0].message.content; } catch (e) { text = ''; }
        var frag = parseFrag(text);
        text = clean(stripFrag(text), 240);
        if (!text) throw new Error('empty');
        ghost.judgment = text;
        ghost.judgedBy = 'meta-spark';
        brain.events.push({ kind: 'judge', msg: '⚖ Meta judge on ghost ' + ghost.seal + ': "' + text + '"' });
        brain.think('Meta judge on ghost ' + ghost.seal + ': ' + text);
        mintFragment(brain, ghost, frag);
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        var reason = 'unreachable';
        if (err && err.name === 'AbortError') reason = 'timeout';
        else if (err && err.status) reason = 'HTTP ' + err.status;
        else if (err && err.message === 'empty') reason = 'empty reply';
        brain.events.push({ kind: 'judge', msg: '⚖ Meta judge ' + reason + ' — ghost sealed locally.' });
        brain.think('Meta judge fetch ' + reason + ' on ghost ' + ghost.seal + ' — sealed locally.');
      });
    } catch (e) {
      /* The judge must never break the seal or the app. */
      try { brain.events.push({ kind: 'judge', msg: '⚖ Meta judge error — ghost sealed locally.' }); } catch (e2) {}
    }
  }

  /* v81 — transport for the review call only (judgeGhost keeps its own
   * battle-tested paths untouched). Same rules: native NB bridge first,
   * fetch fallback, key only in the Authorization header / bridge arg,
   * always calls back, never throws. cb(text) on success, cb(null) else. */
  function postChat(key, messages, maxTokens, cb) {
    var body = JSON.stringify({ model: MODEL, messages: messages, max_tokens: maxTokens, temperature: 0.2 });
    try {
      if (typeof NB !== 'undefined' && NB && typeof NB.metaJudgePost === 'function') {
        var res = NB.metaJudgePost(key, body);
        var nl = res.indexOf('\n');
        var code = 0, payload = '';
        if (nl >= 0) { code = parseInt(res.slice(5, nl), 10) || 0; payload = res.slice(nl + 1); }
        if (code < 200 || code >= 300 || !payload) { cb(null); return; }
        var data = JSON.parse(payload);
        var t = '';
        try { t = data.choices[0].message.content; } catch (e) { t = ''; }
        cb(t ? String(t) : null);
        return;
      }
    } catch (e) { cb(null); return; }
    if (typeof fetch === 'undefined') { cb(null); return; }
    var controller = null;
    try { if (typeof AbortController !== 'undefined') controller = new AbortController(); } catch (e) { controller = null; }
    var timer = null;
    if (controller) timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, TIMEOUT_MS);
    var opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: body };
    if (controller) opts.signal = controller.signal;
    fetch(ENDPOINT, opts).then(function (resp) {
      if (!resp.ok) throw new Error('http');
      return resp.json();
    }).then(function (data) {
      if (timer) clearTimeout(timer);
      var t = '';
      try { t = data.choices[0].message.content; } catch (e) { t = ''; }
      cb(t ? String(t) : null);
    }).catch(function () { if (timer) clearTimeout(timer); cb(null); });
  }

  /* v81 — Judge's Review: ONE call over the brain's recent ghost history.
   * Read-only: it never seals, breaks, or steers anything. The paragraph
   * is stored on brain.lastJudgeReview for the Instruments card, and the
   * full text also lands in the events stream. onDone(textOrNull) always
   * fires exactly once. */
  function judgeReview(brain, onDone) {
    var done = typeof onDone === 'function' ? onDone : function () {};
    try {
      var key = getKey();
      if (!key) {
        brain.events.push({ kind: 'judge', msg: '⚖ Judge\'s Review skipped — no API key set (Dev Options → Meta API key).' });
        brain.think('Judge\'s Review skipped — no API key set.');
        done(null);
        return;
      }
      var ghosts = (brain.ghosts || []).slice(-8);
      if (!ghosts.length) {
        brain.events.push({ kind: 'judge', msg: '⚖ Judge\'s Review skipped — no sealed ghosts yet, nothing to review.' });
        brain.think('Judge\'s Review skipped — no ghosts yet.');
        done(null);
        return;
      }
      var st = brain.status();
      var lines = ghosts.map(function (g) {
        return 'ghost ' + g.seal + ' · objective "' + clean(g.objective, 60) + '" · status ' + g.status +
          ' · verdict: ' + (g.judgment ? clean(g.judgment, 200) : 'none');
      });
      var user = 'Brain state: ' + st.ghosts + ' ghosts (cap ' + brain.ghostCap + '), ' + st.molecules +
        ' molecules, ' + st.gravity + ' gravity wells, ' + st.episodes + ' episodes, ' +
        st.params + '/' + st.ceiling + ' params. Recent ghosts:\n' + lines.join('\n');
      var messages = [
        { role: 'system', content: 'You are the Meta judge reviewing a tiny on-device AI that seals its failed runs as ghosts, retries them on appeal, and recycles the hopeless ones into steering molecules. Write ONE short paragraph (3-4 sentences): the pattern across these failures, the one habit it most needs to break, and one concrete piece of advice. Plain text, no lists, no preamble.' },
        { role: 'user', content: user }
      ];
      brain.think('Asking the Meta judge to review my recent ghosts…');
      postChat(key, messages, 600, function (raw) {
        try {
          var txt = clean(raw, 600);
          if (!txt) {
            brain.events.push({ kind: 'judge', msg: '⚖ Judge\'s Review failed — empty or unreachable. Nothing changed.' });
            brain.think('Judge\'s Review came back empty — nothing changed.');
            done(null);
            return;
          }
          brain.lastJudgeReview = { text: txt, episodes: brain.episodes };
          brain.events.push({ kind: 'judge', msg: '⚖ Judge\'s Review: "' + txt + '"' });
          brain.think('The Meta judge reviewed my ghosts — its review is on the Instruments card.');
          done(txt);
        } catch (e) { done(null); }
      });
    } catch (e) {
      try { brain.events.push({ kind: 'judge', msg: '⚖ Judge\'s Review error — nothing changed.' }); } catch (e2) {}
      done(null);
    }
  }

  global.MetaJudge = {
    judgeGhost: judgeGhost,
    judgeReview: judgeReview,
    parseFrag: parseFrag,
    stripFrag: stripFrag,
    keyIsSet: function () { return !!getKey(); },
    ENDPOINT: ENDPOINT,
    MODEL: MODEL
  };
})(typeof window !== 'undefined' ? window : this);
