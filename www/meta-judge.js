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

  function buildPrompt(ghost, outcome) {
    var acts = (ghost.acts || []).slice(-6).join(', ');
    var user = 'Objective: ' + clean(outcome.objective, 120) +
      '. Failure: ' + clean(outcome.why || 'no progress', 120) +
      '. Recent actions: ' + clean(acts, 200) + '.';
    return [
      { role: 'system', content: 'You are a terse judge of a tiny on-device AI\'s failed run. Reply with ONE short sentence: what failed and one lesson. No preamble, no extra sentences.' },
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
          text2 = clean(text2, 240);
          if (!text2) {
            brain.events.push({ kind: 'judge', msg: '⚖ Meta judge empty reply — ghost sealed locally.' });
            brain.think('Meta judge bridge empty reply on ghost ' + ghost.seal + ' — raw: ' + rawSnippet + ' — sealed locally.');
            return;
          }
          ghost.judgment = text2;
          ghost.judgedBy = 'meta-spark';
          brain.events.push({ kind: 'judge', msg: '⚖ Meta judge on ghost ' + ghost.seal + ': "' + text2 + '"' });
          brain.think('Meta judge on ghost ' + ghost.seal + ': ' + text2);
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
        text = clean(text, 240);
        if (!text) throw new Error('empty');
        ghost.judgment = text;
        ghost.judgedBy = 'meta-spark';
        brain.events.push({ kind: 'judge', msg: '⚖ Meta judge on ghost ' + ghost.seal + ': "' + text + '"' });
        brain.think('Meta judge on ghost ' + ghost.seal + ': ' + text);
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

  global.MetaJudge = {
    judgeGhost: judgeGhost,
    keyIsSet: function () { return !!getKey(); },
    ENDPOINT: ENDPOINT,
    MODEL: MODEL
  };
})(typeof window !== 'undefined' ? window : this);
