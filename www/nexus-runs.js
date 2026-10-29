'use strict';
/* Neural Lab v33 — Nexus run recorder.
 *
 * After every Quantum Nexus Core run (preset 16 on the Spiking tab, or the
 * 🌀 visualizer in the Quantum tab), the app asks "Save this run?" with a
 * summary. NOTHING is written unless Ahkeem taps Save — no silent auto-saves.
 * Saved runs are timestamped, so re-saving the same run twice is impossible
 * by construction (each save is a new timestamped record).
 *
 * Saved runs live in localStorage under 'nl_nexus_runs' — the in-app
 * 📂 nexus-runs folder (newest first), with view / export / delete.
 * Export hands timestamped .json + .txt pairs to the system file picker
 * (the existing NB.saveTextFile path from v27 — no new native bridge).
 *
 * Split design (same as nexus.js):
 *   pure helpers (stamp, summarize, runToJSON/TXT) — no DOM, Node-testable.
 *   UI (dialog, history) — needs document.
 */
var _G = (typeof window !== 'undefined') ? window :
         (typeof global !== 'undefined') ? global : this;

_G.NL_NEXUS_RUNS = (function () {
  var LS_KEY = 'nl_nexus_runs';
  var MAX_RUNS = 50;

  /* ── pure helpers ─────────────────────────────────────────── */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function stampOf(d) {
    d = d || new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
           pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }
  function makeId(d) { return 'nexus-run-' + stampOf(d || new Date()); }
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fmtLocal(ts) {
    var d = new Date(ts), h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
           ' ' + h + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' + ap;
  }
  function summarize(run) {
    var c = run.errCurve || [], n = c.length;
    var e0 = n ? c[0] : NaN, e1 = n ? c[n - 1] : NaN;
    var drop = (n && e0 > 0) ? 100 * (e0 - e1) / e0 : NaN;
    var b = (typeof run.beliefFinal === 'number') ? run.beliefFinal : NaN;
    var beliefTxt = isNaN(b) ? 'n/a'
      : (b >= 0.5 ? 'YES at ' : 'NO at ') + (100 * (b >= 0.5 ? b : 1 - b)).toFixed(1) + '%';
    return {
      gens: run.generations || n || 0,
      err0: e0, err1: e1, dropPct: drop,
      beliefTxt: beliefTxt,
      snapTxt: run.snapshot && run.snapshot.checksum
        ? run.snapshot.checksum + (run.snapshot.untouched ? ' · untouched ✓' : ' · MUTATED ✗')
        : 'n/a'
    };
  }
  function srcLabel(s) { return s === 'preset16' ? '🐍 preset 16 (Python)' : '🌀 visualizer'; }
  function runToJSON(run) { return JSON.stringify(run, null, 2); }
  function runToTXT(run) {
    var s = summarize(run), p = run.params || {};
    var L = [];
    L.push('Quantum Nexus Core — run record');
    L.push('Named by Ahkeem, 2026. Classical simulation on the phone CPU.');
    L.push('');
    L.push('run id   : ' + run.id);
    L.push('saved    : ' + fmtLocal(run.savedAt));
    L.push('source   : ' + srcLabel(run.source));
    L.push('generations : ' + s.gens);
    L.push('error    : ' + (isNaN(s.err0) ? 'n/a' : s.err0.toFixed(4) + ' → ' + s.err1.toFixed(4) +
           ' (' + s.dropPct.toFixed(1) + '% lower)'));
    L.push('belief   : ' + s.beliefTxt + '  (measurement = decision)');
    L.push('snapshot : ' + s.snapTxt);
    L.push('params   : D=' + p.D + ' T=' + p.T + ' LR=' + p.LR +
           ' variants=' + p.variants + ' seed=' + p.seed +
           (p.depth != null ? ' depth=' + p.depth + ' act=' + (p.act || 'tanh') : ''));
    L.push('');
    L.push('error curve per generation:');
    L.push('  ' + (run.errCurve || []).map(function (e) { return e.toFixed(4); }).join('  '));
    if (run.beliefTraj && run.beliefTraj.length) {
      L.push('');
      L.push('belief trajectory p(yes):');
      L.push('  ' + run.beliefTraj.map(function (b) { return b.toFixed(3); }).join('  '));
    }
    L.push('');
    L.push('— end of run record —');
    return L.join('\n');
  }

  /* ── storage (localStorage = the on-phone nexus-runs folder) ── */
  function ls() { try { return _G.localStorage; } catch (e) { return null; } }
  function loadRuns() {
    var s = ls(), out = [];
    if (!s) return out;
    try { out = JSON.parse(s.getItem(LS_KEY) || '[]'); } catch (e) { out = []; }
    return Array.isArray(out) ? out : [];
  }
  function persist(runs) {
    var s = ls(); if (!s) return false;
    try { s.setItem(LS_KEY, JSON.stringify(runs)); return true; }
    catch (e) { return false; }
  }
  /* data: {source, generations, errCurve, beliefTraj, beliefFinal, snapshot, params} */
  function storeRun(data) {
    var runs = loadRuns();
    var id = makeId(), n = 2;
    // timestamped ids are unique in practice (a run takes seconds), but guard
    // anyway: same-second saves get -2, -3… — never overwritten, no duplicates.
    var taken = {};
    for (var i = 0; i < runs.length; i++) taken[runs[i].id] = true;
    while (taken[id]) { id = makeId() + '-' + (n++); }
    var run = {
      id: id,
      savedAt: Date.now(),
      source: data.source || 'visualizer',
      generations: data.generations || 0,
      errCurve: (data.errCurve || []).slice(),
      beliefTraj: data.beliefTraj ? data.beliefTraj.slice() : null,
      beliefFinal: (typeof data.beliefFinal === 'number') ? data.beliefFinal : null,
      snapshot: data.snapshot ? { checksum: data.snapshot.checksum,
                                  untouched: !!data.snapshot.untouched } : null,
      params: data.params || {}
    };
    runs.unshift(run);
    runs = runs.slice(0, MAX_RUNS);
    persist(runs);
    return run;
  }
  function deleteRun(id) {
    var runs = loadRuns().filter(function (r) { return r.id !== id; });
    persist(runs);
    return runs;
  }
  function findRun(id) {
    var rs = loadRuns();
    for (var i = 0; i < rs.length; i++) if (rs[i].id === id) return rs[i];
    return null;
  }

  /* ── save dialog: explicit yes/no, nothing writes on Discard ── */
  var dlgBack = null, pendingData = null;
  function el(id) { return document.getElementById(id); }
  function ensureCSS() {
    if (el('nxr-css')) return;
    var st = document.createElement('style');
    st.id = 'nxr-css';
    st.textContent =
      '#nxr-back{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:20px}' +
      '#nxr-dlg{background:#14141c;border:1px solid #3a3a52;border-radius:14px;' +
      'max-width:520px;width:100%;padding:18px;color:#e8e8f2}' +
      '#nxr-dlg h3{margin:0 0 10px;font-size:19px}' +
      '#nxr-dlg .sum{font-size:14px;line-height:1.65;background:#0e0e14;' +
      'border-radius:10px;padding:10px 12px;margin-bottom:12px}' +
      '#nxr-dlg .row{display:flex;gap:10px}' +
      '#nxr-dlg button{flex:1;min-height:52px;font-size:16px;border-radius:10px;border:0}' +
      '#nxr-save{background:#7c3aed;color:#fff;font-weight:700}' +
      '#nxr-discard{background:#2a2a3a;color:#cfcfe0}' +
      '#nxr-note{font-size:12px;color:#8a8aa0;margin-top:10px;line-height:1.5}' +
      '.nxr-row{display:flex;align-items:center;gap:8px;padding:10px 8px;' +
      'border-bottom:1px solid #26263a;min-height:56px}' +
      '.nxr-row .meta{flex:1;min-width:0;font-size:13px;line-height:1.5}' +
      '.nxr-row .t{color:#e8e8f2;font-weight:600}' +
      '.nxr-row .d{color:#9a9ab5}' +
      '.nxr-del{background:#3a1622;color:#ff8aa0;border:0;border-radius:8px;' +
      'min-width:48px;min-height:48px;font-size:16px}' +
      '.nxr-detail{background:#0e0e14;border-radius:10px;padding:10px 12px;' +
      'margin:4px 0 8px;font-size:13px;line-height:1.6;color:#d8d8ea}' +
      '.nxr-detail .row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}' +
      '.nxr-detail button{min-height:48px;padding:0 14px;border-radius:9px;border:0;' +
      'font-size:14px;background:#2a2a3a;color:#e8e8f2}' +
      '.nxr-detail button.armed{background:#7c2d12;color:#ffd9a0}' +
      '#nx-history:empty{display:none}';
    document.head.appendChild(st);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
  function savePrompt(data) {
    if (typeof document === 'undefined') return; // Node: no UI
    pendingData = data;
    ensureCSS();
    if (!dlgBack) {
      dlgBack = document.createElement('div');
      dlgBack.id = 'nxr-back';
      dlgBack.innerHTML =
        '<div id="nxr-dlg" role="dialog" aria-label="Save this run?">' +
        '<h3>🌀 Save this run?</h3>' +
        '<div class="sum" id="nxr-sum"></div>' +
        '<div class="row">' +
        '<button id="nxr-save">💾 Save</button>' +
        '<button id="nxr-discard">Discard</button>' +
        '</div>' +
        '<div id="nxr-note">Nothing saves unless you tap <b>Save</b>. ' +
        'Each save is timestamped — the same run can never save twice.</div>' +
        '</div>';
      document.body.appendChild(dlgBack);
      el('nxr-save').onclick = function () {
        if (pendingData) {
          var run = storeRun(pendingData);
          qlog('💾 saved ' + run.id + ' — see 📂 run history in the 🌀 Nexus panel', 'ok');
          pendingData = null;
          renderHistory();
        }
        dlgBack.style.display = 'none';
      };
      el('nxr-discard').onclick = function () {
        pendingData = null;
        qlog('run discarded — nothing was saved', 'dim');
        dlgBack.style.display = 'none';
      };
      // backdrop tap does NOT dismiss: the choice must be explicit.
    }
    var s = summarize({
      generations: data.generations, errCurve: data.errCurve,
      beliefFinal: data.beliefFinal, snapshot: data.snapshot
    });
    el('nxr-sum').innerHTML =
      '📅 ' + esc(fmtLocal(Date.now())) + ' · ' + esc(srcLabel(data.source)) + '<br>' +
      '🧬 ' + esc(s.gens) + ' generations<br>' +
      '📉 error ' + (isNaN(s.err0) ? 'n/a' : esc(s.err0.toFixed(4)) + ' → ' + esc(s.err1.toFixed(4)) +
        ' (' + esc(s.dropPct.toFixed(1)) + '% lower)') + '<br>' +
      '🎯 belief: ' + esc(s.beliefTxt) + '<br>' +
      '❄️ snapshot ' + esc(s.snapTxt);
    dlgBack.style.display = 'flex';
  }
  function qlog(msg, cls) {
    try {
      var api = _G.NL_Q_API;
      if (api && api.log) { api.log(msg, cls); return; }
    } catch (e) {}
    try { console.log(msg); } catch (e2) {}
  }

  /* ── history UI ───────────────────────────────────────────── */
  var armedDel = null, armedTimer = null;
  function renderHistory() {
    if (typeof document === 'undefined') return;
    var host = el('nx-history');
    if (!host) return;
    var runs = loadRuns();
    if (!runs.length) {
      host.innerHTML = '<div class="dsinfo">No saved runs yet — finish a Nexus Core run and tap <b>Save</b>.</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < runs.length; i++) {
      (function (r) {
        var s = summarize(r);
        h += '<div class="nxr-row" data-id="' + esc(r.id) + '">' +
          '<div class="meta nxr-view" style="cursor:pointer">' +
          '<div class="t">📅 ' + esc(fmtLocal(r.savedAt)) + ' · ' + esc(srcLabel(r.source)) + '</div>' +
          '<div class="d">📉 ' + (isNaN(s.err0) ? 'n/a' : esc(s.err0.toFixed(4)) + ' → ' + esc(s.err1.toFixed(4)) +
            ' (' + esc(s.dropPct.toFixed(1)) + '%)') + ' · 🧬 ' + esc(s.gens) + ' gens · 🎯 ' + esc(s.beliefTxt) + '</div>' +
          '</div>' +
          '<button class="nxr-del" title="Delete this run">🗑</button>' +
          '</div>' +
          '<div class="nxr-detail" data-detail="' + esc(r.id) + '" style="display:none"></div>';
      })(runs[i]);
    }
    host.innerHTML = h;
    var rows = host.querySelectorAll('.nxr-row');
    for (var j = 0; j < rows.length; j++) {
      (function (row) {
        var id = row.getAttribute('data-id');
        row.querySelector('.nxr-view').onclick = function () { toggleDetail(id); };
        row.querySelector('.nxr-del').onclick = function (ev) {
          ev.stopPropagation();
          armDelete(id, ev.target);
        };
      })(rows[j]);
    }
  }
  function toggleDetail(id) {
    var d = document.querySelector('[data-detail="' + id + '"]');
    if (!d) return;
    if (d.style.display !== 'none') { d.style.display = 'none'; return; }
    var r = findRun(id);
    if (!r) return;
    var s = summarize(r);
    d.innerHTML =
      '<div>📅 <b>' + esc(fmtLocal(r.savedAt)) + '</b> · ' + esc(srcLabel(r.source)) + '</div>' +
      '<div>🧬 generations: ' + esc(s.gens) + '</div>' +
      '<div>📉 error: ' + (isNaN(s.err0) ? 'n/a' : esc(s.err0.toFixed(4)) + ' → ' + esc(s.err1.toFixed(4)) +
        ' (' + esc(s.dropPct.toFixed(1)) + '% lower)') + '</div>' +
      '<div>🎯 belief: ' + esc(s.beliefTxt) + ' <span style="color:#8a8aa0">(measurement = decision)</span></div>' +
      '<div>❄️ snapshot: ' + esc(s.snapTxt) + '</div>' +
      '<canvas class="nxr-curve" width="600" height="180" style="width:100%;height:120px;margin-top:6px"></canvas>' +
      '<div class="row">' +
      '<button data-x="json">⤓ .json</button>' +
      '<button data-x="txt">⤓ .txt</button>' +
      '<button data-x="del">🗑 Delete</button>' +
      '</div>' +
      '<div class="dsinfo" style="margin-top:6px">Export hands the file to the system file picker — choose <b>Downloads</b> to find it in your file manager.</div>';
    d.style.display = '';
    drawCurve(d.querySelector('.nxr-curve'), r.errCurve || []);
    var btns = d.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        var k = b.getAttribute('data-x');
        b.onclick = function (ev) {
          ev.stopPropagation();
          if (k === 'json') exportFile(id, 'json');
          else if (k === 'txt') exportFile(id, 'txt');
          else armDelete(id, b);
        };
      })(btns[i]);
    }
  }
  function drawCurve(cv, curve) {
    if (!cv || !curve.length) return;
    var ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    var n = curve.length, mx = 0, i;
    for (i = 0; i < n; i++) if (curve[i] > mx) mx = curve[i];
    if (mx <= 0) mx = 1;
    var px = function (g) { return 14 + (n <= 1 ? W / 2 - 14 : (g / (n - 1)) * (W - 28)); };
    var py = function (e) { return 10 + H - 20 - (e / mx) * (H - 30); };
    ctx.strokeStyle = '#3a3a52'; ctx.lineWidth = 1;
    ctx.strokeRect(14, 10, W - 28, H - 30);
    ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 3; ctx.beginPath();
    for (i = 0; i < n; i++) { var X = px(i), Y = py(curve[i]); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.stroke();
    ctx.fillStyle = '#7c3aed';
    for (i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(px(i), py(curve[i]), 5, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#9a9ab5'; ctx.font = '20px sans-serif';
    ctx.fillText(curve[0].toFixed(3), 16, 30);
    ctx.fillText(curve[n - 1].toFixed(3), W - 90, H - 14);
  }
  function armDelete(id, btn) {
    if (armedDel === id) {
      deleteRun(id);
      armedDel = null;
      if (armedTimer) { clearTimeout(armedTimer); armedTimer = null; }
      qlog('🗑 run deleted', 'dim');
      renderHistory();
      return;
    }
    armedDel = id;
    btn.classList.add('armed');
    var old = btn.textContent;
    btn.textContent = 'Sure?';
    qlog('tap Delete again to confirm', 'warn');
    armedTimer = setTimeout(function () {
      armedDel = null; armedTimer = null;
      try { btn.classList.remove('armed'); btn.textContent = old; } catch (e) {}
    }, 4000);
  }
  function exportFile(id, kind) {
    var r = findRun(id);
    if (!r) { qlog('run not found', 'err'); return; }
    var api = null;
    try { api = _G.NL_Q_API; } catch (e) {}
    var name = r.id + '.' + kind;
    var text = kind === 'json' ? runToJSON(r) : runToTXT(r);
    if (api && api.saveTextFile) {
      try {
        api.saveTextFile(name, text);
        qlog('⤓ exporting ' + name + ' — pick <b>Downloads</b> in the file picker', 'ok');
        return;
      } catch (e) { qlog('export failed: ' + e.message, 'err'); return; }
    }
    // browser fallback (desktop testing): direct download
    try {
      var blob = new Blob([text], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      qlog('downloaded ' + name + ' (browser fallback)', 'ok');
    } catch (e2) { qlog('export failed: ' + e2.message, 'err'); }
  }

  function init() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('nx-history')) return;
    renderHistory();
  }

  return {
    LS_KEY: LS_KEY, MAX_RUNS: MAX_RUNS,
    makeId: makeId, stampOf: stampOf, fmtLocal: fmtLocal,
    summarize: summarize, runToJSON: runToJSON, runToTXT: runToTXT,
    loadRuns: loadRuns, storeRun: storeRun, deleteRun: deleteRun,
    savePrompt: savePrompt, renderHistory: renderHistory, exportFile: exportFile,
    init: init
  };
})();
