/* === NL_OBSERVER — v60 "Observer": read-only phone observer ===
 * Eyes + brain, no hands. The native ObserverService (accessibility, zero
 * performAction calls) broadcasts screen summaries; MainActivity forwards
 * them here via NL_OBSERVER.onState(jsonString). This module throttles
 * Gemini narration calls, renders the feed, and logs 👍/👎 votes —
 * the v1 training dataset. No background polling: everything is
 * event-driven from the service.
 */
var NL_OBSERVER = (function () {
  'use strict';

  var LS_KEY = 'nl_observer_key';
  var LS_MODEL = 'nl_observer_model';
  var LS_FEED = 'nl_observer_feed';
  var LS_ON = 'nl_observer_on';
  var MIN_GEMINI_MS = 5000;
  var MAX_FEED = 50;

  var lastCall = 0;
  var lastHash = '';
  var inFlight = false;
  var feed = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function hash(s) {
    var h = 5381, i;
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }
  function now() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function load() {
    try { feed = JSON.parse(localStorage.getItem(LS_FEED) || '[]'); }
    catch (e) { feed = []; }
  }
  function save() {
    try {
      localStorage.setItem(LS_FEED, JSON.stringify(feed.slice(0, MAX_FEED)));
    } catch (e) {}
  }
  function isOn() {
    try { return localStorage.getItem(LS_ON) === '1'; } catch (e) { return false; }
  }

  function statusLine(msg) {
    var el = $('obs-status');
    if (el) el.textContent = msg;
  }

  function renderFeed() {
    var box = $('obs-feed');
    if (!box) return;
    if (!feed.length) {
      box.innerHTML = '<div class="dim">No narrations yet. Enable the service, turn the observer on, and browse your phone.</div>';
      return;
    }
    var html = '';
    feed.forEach(function (e, i) {
      html += '<div class="card" style="margin:8px 0" data-obs="' + i + '">'
        + '<div class="dim" style="font-size:12px">' + esc(e.ts) + ' · ' + esc(e.pkg) + '</div>'
        + '<div style="margin:6px 0;white-space:pre-wrap">' + esc(e.text) + '</div>'
        + '<div class="row">'
        + '<button data-vote="up" data-i="' + i + '"' + (e.vote === 'up' ? ' class="primary"' : '') + '>👍</button>'
        + '<button data-vote="down" data-i="' + i + '"' + (e.vote === 'down' ? ' class="primary"' : '') + '>👎</button>'
        + '</div></div>';
    });
    box.innerHTML = html;
  }

  function addEntry(pkg, text) {
    feed.unshift({ ts: now(), pkg: pkg, text: text, vote: null });
    feed = feed.slice(0, MAX_FEED);
    save();
    renderFeed();
  }

  function addError(msg) {
    addEntry('observer', '⚠️ ' + msg);
  }

  function onState(jsonStr) {
    if (!isOn()) return;
    var st;
    try { st = JSON.parse(jsonStr); } catch (e) { return; }
    var summary = (st.summary || '').trim();
    if (!summary) return;
    var h = hash(st.pkg + '|' + summary);
    if (h === lastHash) return; // same screen, skip
    var t = Date.now();
    if (t - lastCall < MIN_GEMINI_MS || inFlight) return;
    lastHash = h;
    lastCall = t;
    narrate(st.pkg || '?', summary);
  }

  function narrate(pkg, summary) {
    var key = '', model = 'gemini-2.0-flash';
    try {
      key = (localStorage.getItem(LS_KEY) || '').trim();
      model = (localStorage.getItem(LS_MODEL) || 'gemini-2.0-flash').trim() || 'gemini-2.0-flash';
    } catch (e) {}
    if (!key) {
      statusLine('narration paused — paste a Gemini API key above.');
      return;
    }
    inFlight = true;
    statusLine('narrating ' + pkg + '…');
    var prompt = 'You are the read-only observer inside the user\'s phone AI lab. '
      + 'You cannot act — you only narrate. Given this screen state, briefly describe: '
      + '1) what the user is looking at, 2) what they might be trying to do, '
      + '3) what you WOULD do if you had hands. Be concise, plain language, no formatting.';
    var body = JSON.stringify({
      contents: [{
        parts: [{ text: prompt + '\n\n--- screen state ---\nApp: ' + pkg + '\n' + summary }]
      }]
    });
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/'
      + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        inFlight = false;
        if (!res.ok) {
          var msg = (res.j && res.j.error && res.j.error.message) || ('HTTP error');
          addError('Gemini: ' + msg);
          statusLine('Gemini error — check key/model.');
          return;
        }
        var text = '';
        try {
          text = res.j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
        } catch (e) {}
        text = (text || '').trim() || '(empty narration)';
        addEntry(pkg, text);
        statusLine('last narration ' + now());
      })
      .catch(function (e) {
        inFlight = false;
        addError('network: ' + (e && e.message ? e.message : e));
        statusLine('network error.');
      });
  }

  function refreshEnabled() {
    var el = $('obs-svc-state');
    if (!el) return;
    var on = false;
    try { on = !!(window.NB && NB.isObserverEnabled && NB.isObserverEnabled()); }
    catch (e) {}
    el.textContent = on ? '✅ service enabled' : '❌ service not enabled';
    el.className = on ? '' : 'dim';
  }

  function init() {
    load();
    var keyEl = $('obs-key'), modelEl = $('obs-model'), onEl = $('obs-on');
    try {
      if (keyEl) keyEl.value = localStorage.getItem(LS_KEY) || '';
      if (modelEl) modelEl.value = localStorage.getItem(LS_MODEL) || 'gemini-2.0-flash';
      if (onEl) onEl.checked = isOn();
    } catch (e) {}
    if (keyEl) keyEl.addEventListener('change', function () {
      try { localStorage.setItem(LS_KEY, keyEl.value.trim()); } catch (e) {}
      statusLine('key saved.');
    });
    if (modelEl) modelEl.addEventListener('change', function () {
      try { localStorage.setItem(LS_MODEL, modelEl.value.trim()); } catch (e) {}
    });
    if (onEl) onEl.addEventListener('change', function () {
      try { localStorage.setItem(LS_ON, onEl.checked ? '1' : '0'); } catch (e) {}
      statusLine(onEl.checked ? 'observer on — browse your phone.' : 'observer off.');
    });
    var setBtn = $('obs-open-settings');
    if (setBtn) setBtn.addEventListener('click', function () {
      try {
        if (window.NB && NB.openAccessibilitySettings) NB.openAccessibilitySettings();
        else statusLine('needs the native bridge (install the APK).');
      } catch (e) { statusLine('could not open settings.'); }
    });
    var refBtn = $('obs-refresh');
    if (refBtn) refBtn.addEventListener('click', refreshEnabled);
    var feedBox = $('obs-feed');
    if (feedBox) feedBox.addEventListener('click', function (e) {
      var b = e.target;
      if (!b || !b.getAttribute) return;
      var v = b.getAttribute('data-vote'), i = parseInt(b.getAttribute('data-i'), 10);
      if (!v || isNaN(i) || !feed[i]) return;
      feed[i].vote = (feed[i].vote === v) ? null : v; // tap again to clear
      save();
      renderFeed();
    });
    renderFeed();
    refreshEnabled();
    statusLine(isOn() ? 'observer on.' : 'observer off.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { onState: onState, refreshEnabled: refreshEnabled };
})();
