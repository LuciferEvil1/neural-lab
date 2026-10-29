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
 * v83: ONE transport (callJudge) for both calls, with retry-on-empty.
 * muse-spark-1.3 reasons before it speaks; when the reasoning uses the
 * whole max_tokens budget the API returns finish_reason "length" with
 * content null (the v74 mode — seen live again on v82 once the v81
 * prompts grew). An empty 2xx reply now retries ONCE at an escalated
 * budget (verdict 1024 → 3072; review 1200 → 3600). The v74 raw-reply
 * dumps in the think log are gone: failure lines name the reason only,
 * so the demo's thought log stays readable.
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

  /* v83 — ONE transport for both judge calls, with retry-on-empty.
   * Native NB bridge first (Java HTTPS bypasses the WebView file-URL
   * block from v70/v71), fetch fallback; the key travels only as the
   * bridge argument / Authorization header. When a 2xx reply carries
   * no content (the reasoning ate the budget — finish_reason "length",
   * content null), retry ONCE at an escalated budget. cb(text, info)
   * always fires exactly once and never throws; info = { code, finish,
   * transport, attempts }. */
  function escalated(maxTokens) { return Math.min(4096, Math.max(maxTokens * 3, 2048)); }

  function callJudge(key, messages, maxTokens, cb) {
    var info = { code: 0, finish: '', transport: '', attempts: 0 };
    var fired = false;
    function finish(text) { if (!fired) { fired = true; cb(text || null, info); } }
    try {
      if (typeof NB !== 'undefined' && NB && typeof NB.metaJudgePost === 'function') {
        info.transport = 'bridge';
        var budget = maxTokens;
        for (var attempt = 0; attempt < 2; attempt++) {
          info.attempts++;
          var body = JSON.stringify({ model: MODEL, messages: messages, max_tokens: budget, temperature: 0.2 });
          var res = null;
          try { res = NB.metaJudgePost(key, body); } catch (e) { finish(null); return; }
          var nl = res.indexOf('\n');
          var code = 0, payload = '';
          if (nl >= 0) { code = parseInt(res.slice(5, nl), 10) || 0; payload = res.slice(nl + 1); }
          info.code = code;
          if (code < 200 || code >= 300 || !payload) { finish(null); return; }
          var data = null;
          try { data = JSON.parse(payload); } catch (e) { finish(null); return; }
          var text = '';
          try { text = data.choices[0].message.content; } catch (e) { text = ''; }
          try { info.finish = data.choices[0].finish_reason || ''; } catch (e) { info.finish = ''; }
          if (text) { finish(String(text)); return; }
          if (attempt === 0) { budget = escalated(budget); continue; }
          finish(null); return;
        }
        return;
      }
    } catch (e) { finish(null); return; }
    info.transport = 'fetch';
    if (typeof fetch === 'undefined') { finish(null); return; }
    function attemptFetch(budget, isRetry) {
      info.attempts++;
      var controller = null;
      try { if (typeof AbortController !== 'undefined') controller = new AbortController(); } catch (e) { controller = null; }
      var timer = null;
      if (controller) timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, TIMEOUT_MS);
      var fbody = JSON.stringify({ model: MODEL, messages: messages, max_tokens: budget, temperature: 0.2 });
      var opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: fbody };
      if (controller) opts.signal = controller.signal;
      fetch(ENDPOINT, opts).then(function (resp) {
        info.code = resp.status || 0;
        if (!resp.ok) throw new Error('http');
        return resp.json();
      }).then(function (data) {
        if (timer) clearTimeout(timer);
        var text = '';
        try { text = data.choices[0].message.content; } catch (e) { text = ''; }
        try { info.finish = data.choices[0].finish_reason || ''; } catch (e) { info.finish = ''; }
        if (text) { finish(String(text)); return; }
        if (!isRetry) { attemptFetch(escalated(budget), true); return; }
        finish(null);
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && err.name === 'AbortError') info.finish = 'timeout';
        finish(null);
      });
    }
    attemptFetch(maxTokens, false);
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
      callJudge(key, buildPrompt(ghost, outcome), MAX_TOKENS, function (text, info) {
        try {
          if (!text) {
            var reason = 'empty reply';
            if (info && info.code && (info.code < 200 || info.code >= 300)) reason = 'HTTP ' + info.code;
            else if (info && info.finish === 'timeout') reason = 'timeout';
            else if (info && info.transport === 'fetch' && !info.code) reason = 'unreachable';
            brain.events.push({ kind: 'judge', msg: '⚖ Meta judge ' + reason + ' — ghost sealed locally.' });
            brain.think('Meta judge ' + reason + ' on ghost ' + ghost.seal +
              (info && info.attempts > 1 ? ' (retried at a larger budget)' : '') + ' — sealed locally.');
            return;
          }
          var frag = parseFrag(text);
          var judgment = clean(stripFrag(text), 240);
          if (!judgment) {
            brain.events.push({ kind: 'judge', msg: '⚖ Meta judge empty reply — ghost sealed locally.' });
            brain.think('Meta judge empty reply on ghost ' + ghost.seal + ' — sealed locally.');
            return;
          }
          ghost.judgment = judgment;
          ghost.judgedBy = 'meta-spark';
          brain.events.push({ kind: 'judge', msg: '⚖ Meta judge on ghost ' + ghost.seal + ': "' + judgment + '"' });
          brain.think('Meta judge on ghost ' + ghost.seal + ': ' + judgment);
          mintFragment(brain, ghost, frag);
        } catch (e) { /* the judge must never break the brain */ }
      });
    } catch (e) {
      /* The judge must never break the seal or the app. */
      try { brain.events.push({ kind: 'judge', msg: '⚖ Meta judge error — ghost sealed locally.' }); } catch (e2) {}
    }
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
      callJudge(key, messages, 1200, function (raw) {
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
