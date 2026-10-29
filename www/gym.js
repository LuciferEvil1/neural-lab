/* === NL_GYM — v65 "Game Gym": the arena lobby ===
 * The Gym tab is the lobby + review room. The actual arena (game WebView +
 * agent loop) lives in the native GymActivity, opened via NB.openGym().
 * This module:
 *  - reuses the v60 Observer tab's Gemini key (localStorage nl_observer_key)
 *    so the user never pastes twice,
 *  - renders the attempt log + ghost archive via NB.gymArchive().
 */
var NL_GYM = (function () {
  'use strict';

  var LS_KEY = 'nl_observer_key';
  var LS_MODEL = 'nl_observer_model';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function tstr(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function getKey() {
    try { return (localStorage.getItem(LS_KEY) || '').trim(); } catch (e) { return ''; }
  }
  function getModel() {
    try { return (localStorage.getItem(LS_MODEL) || 'gemini-2.0-flash').trim() || 'gemini-2.0-flash'; }
    catch (e) { return 'gemini-2.0-flash'; }
  }

  function refreshKey() {
    var el = $('gym-key-state');
    if (!el) return;
    var k = getKey();
    var openBtn = $('gym-open');
    if (k) {
      el.textContent = '✅ Gemini key on file (from the 👁 Observer tab)';
      el.className = '';
      if (openBtn) openBtn.disabled = false;
    } else {
      el.textContent = '❌ no Gemini key — paste one in the 👁 Observer tab first';
      el.className = 'dim';
      if (openBtn) openBtn.disabled = true;
    }
  }

  function renderArchive() {
    var logBox = $('gym-log'), ghostBox = $('gym-ghosts');
    var data = { log: [], ghosts: [] };
    try {
      if (window.NB && NB.gymArchive) {
        data = JSON.parse(NB.gymArchive() || '{}');
      }
    } catch (e) { /* not on device / bridge missing */ }
    if (logBox) {
      var log = data.log || [];
      if (!log.length) {
        logBox.innerHTML = '<div class="dim">No attempts yet. Open the arena and tap ▶ Start run.</div>';
      } else {
        var html = '';
        log.slice(-60).reverse().forEach(function (e) {
          html += '<div class="card" style="margin:6px 0;padding:8px">'
            + '<div class="dim" style="font-size:12px">' + esc(tstr(e.ts)) + ' · ' + esc(e.kind) + '</div>'
            + '<div style="white-space:pre-wrap;font-size:13px">' + esc(e.text) + '</div></div>';
        });
        logBox.innerHTML = html;
      }
    }
    if (ghostBox) {
      var ghosts = data.ghosts || [];
      if (!ghosts.length) {
        ghostBox.innerHTML = '<div class="dim">No ghosts sealed yet. Failed attempts become ghosts here.</div>';
      } else {
        var ghtml = '';
        ghosts.slice().reverse().forEach(function (g) {
          var a = g.attempt || {};
          ghtml += '<div class="card" style="margin:6px 0;padding:8px">'
            + '<div class="dim" style="font-size:12px">👻 seal ' + esc(g.seal) + ' · ' + esc(tstr(g.ts)) + '</div>'
            + '<div style="font-size:13px">level ' + esc(a.level) + ' · outcome: <b>' + esc(a.outcome) + '</b></div>'
            + '<div class="dim" style="font-size:13px;white-space:pre-wrap">' + esc(a.reasoning || '') + '</div></div>';
        });
        ghostBox.innerHTML = ghtml;
      }
    }
    var count = $('gym-counts');
    if (count) {
      count.textContent = (data.log || []).length + ' log entries · ' + (data.ghosts || []).length + ' ghosts sealed';
    }
  }

  function onShow() {
    refreshKey();
    renderArchive();
  }

  function init() {
    var openBtn = $('gym-open');
    if (openBtn) openBtn.addEventListener('click', function () {
      try {
        if (window.NB && NB.openGym) NB.openGym(getKey(), getModel());
      } catch (e) { /* bridge missing (desktop preview) */ }
    });
    var refBtn = $('gym-refresh');
    if (refBtn) refBtn.addEventListener('click', function () { onShow(); });
    onShow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { onShow: onShow };
})();
