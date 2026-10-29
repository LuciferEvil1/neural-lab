/* === NL_DRIVE — v66 "Drive Bridge": the Colab bridge (JS half) ===
 *
 * His training data goes up, his trained weights come down — no
 * library-computer file juggling.
 *  - Upload: one tap pushes Documents/NeuralLab/brain-food.txt to Drive root
 *    (creates or overwrites; drive.file scope — files the app creates).
 *  - Download: lists *.pt / *.json at Drive root (his Colab saves land there;
 *    drive.readonly scope — the app did NOT create those) into
 *    Documents/NeuralLab/weights/. Staging only — no inference changes.
 *  - Auth: system Google-account picker + Google's own consent screen.
 *    Nothing auto-runs; every failure surfaces here AND in the Console.
 */
var NL_DRIVE = (function () {
  'use strict';

  var LS_KEY = 'nl_drive_v1';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmtBytes(n) {
    if (n == null || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function fmtTime(ms) {
    try { return new Date(ms).toLocaleString(); } catch (e) { return ''; }
  }
  function load() {
    try {
      var v = localStorage.getItem(LS_KEY);
      return v ? JSON.parse(v) : {};
    } catch (e) { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }
  /* Console write (Loud Deaths rule: no silent failures). log() lives in
   * app.js's closure, so drive.js appends to #console-out directly. */
  function dlog(msg, cls) {
    try {
      var out = $('console-out');
      if (!out) return;
      var d = document.createElement('div');
      if (cls) d.className = 't-' + cls;
      d.textContent = '[drive] ' + msg;
      out.appendChild(d);
      while (out.children.length > 800) out.removeChild(out.firstChild);
      out.scrollTop = out.scrollHeight;
    } catch (e) {}
  }
  function setStatus(msg) {
    var el = $('drive-status');
    if (el) el.textContent = msg;
  }
  function nd() { return window.ND || null; }

  function refreshAuth() {
    var N = nd();
    if (!N || !N.driveStatus) { setStatus('Drive bridge unavailable in this build.'); return; }
    var st;
    try { st = JSON.parse(N.driveStatus()); } catch (e) { st = null; }
    if (!st) { setStatus('status read failed'); return; }
    var s = load();
    s.email = st.email || null;
    save(s);
    renderAuth(st);
  }

  function renderAuth(st) {
    var state = st.state || 'out';
    var email = st.email || '';
    $('drive-auth-state').textContent =
      state === 'in' ? 'signed in as ' + email :
      state === 'authenticating' ? 'authenticating ' + email + '…' :
      state === 'consent' ? 'Google consent screen open — your tap…' :
      'not signed in';
    $('drive-signin').hidden = (state === 'in');
    $('drive-signout').hidden = (state !== 'in');
    var up = $('drive-upload'), rl = $('drive-refresh-list');
    if (up) up.disabled = (state !== 'in');
    if (rl) rl.disabled = (state !== 'in');
    refreshLocalInfo();
  }

  function refreshLocalInfo() {
    var N = nd();
    var el = $('drive-local');
    if (!el || !N || !N.driveLocalInfo) return;
    try {
      var info = JSON.parse(N.driveLocalInfo());
      el.textContent = info.exists
        ? 'on this phone: ' + fmtBytes(info.bytes)
        : 'on this phone: no brain-food.txt yet — grow it in the LLM tab first';
    } catch (e) { el.textContent = ''; }
    var s = load();
    var lu = $('drive-last-upload');
    if (lu) {
      lu.textContent = s.lastUpload
        ? 'last upload: ' + fmtBytes(s.lastUpload.bytes) + ' → Drive id ' +
          s.lastUpload.id.slice(0, 12) + '… at ' + fmtTime(s.lastUpload.time)
        : 'last upload: never';
    }
  }

  function onShow() { refreshAuth(); }

  /* Called by DriveBridge (native) for every state change. */
  function onDriveEvent(jsonStr) {
    var p;
    try { p = JSON.parse(jsonStr); } catch (e) { p = null; }
    if (!p || !p.kind) return;
    var s = load();
    if (p.kind === 'status') {
      renderAuth({ state: p.state, email: p.email });
      if (p.state === 'in') dlog('signed in as ' + (p.email || '?'));
      return;
    }
    if (p.kind === 'progress') {
      var pct = (p.total > 0 && p.done >= 0)
        ? ' ' + Math.round(100 * p.done / p.total) + '%'
        : '';
      setStatus((p.op === 'upload' ? 'uploading brain-food.txt…'
                                  : 'downloading…') + pct);
      return;
    }
    if (p.kind === 'upload_done') {
      s.lastUpload = { id: p.fileId, bytes: p.bytes, time: p.time };
      save(s);
      setStatus('uploaded ' + fmtBytes(p.bytes) + ' → Drive ✓');
      dlog('upload done: ' + fmtBytes(p.bytes) + ' (Drive id ' + p.fileId + ')');
      refreshLocalInfo();
      return;
    }
    if (p.kind === 'list') {
      renderWeights(p.files || []);
      setStatus((p.files || []).length + ' weight file(s) on Drive');
      return;
    }
    if (p.kind === 'download_done') {
      setStatus('downloaded ' + p.name + ' (' + fmtBytes(p.bytes) + ') → Documents/NeuralLab/weights/ ✓');
      dlog('download done: ' + p.name + ' ' + fmtBytes(p.bytes));
      return;
    }
    if (p.kind === 'error') {
      var msg = 'Drive ' + (p.op || '') + ' error: ' + p.message;
      setStatus(msg);
      dlog(msg, 'err');
      return;
    }
  }

  function renderWeights(files) {
    var box = $('drive-weights');
    if (!box) return;
    box.innerHTML = '';
    if (!files.length) {
      box.innerHTML = '<div class="dim">no .pt / .json files at Drive root yet — train v7 in Colab and they land here</div>';
      return;
    }
    files.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'row';
      var label = document.createElement('span');
      label.innerHTML = '<b>' + esc(f.name) + '</b> <span class="dim">' +
        fmtBytes(f.size) + ' · ' + esc((f.modifiedTime || '').slice(0, 10)) + '</span>';
      label.style.flex = '1';
      var btn = document.createElement('button');
      btn.className = 'ghost';
      btn.style.minHeight = '48px';
      btn.textContent = '⬇ Download';
      btn.onclick = (function (file) {
        return function () {
          var N = nd();
          if (!N) return;
          setStatus('downloading ' + file.name + '…');
          try { N.driveDownloadWeight(file.id, file.name); }
          catch (e) { setStatus('download error: ' + e); }
        };
      })(f);
      row.appendChild(label);
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  function wire() {
    var si = $('drive-signin');
    if (si) si.onclick = function () {
      var N = nd(); if (!N) return;
      setStatus('opening Google account picker…');
      try { N.driveSignIn(); } catch (e) { setStatus('sign-in error: ' + e); }
    };
    var so = $('drive-signout');
    if (so) so.onclick = function () {
      var N = nd(); if (!N) return;
      try { N.driveSignOut(); } catch (e) { setStatus('sign-out error: ' + e); }
    };
    var up = $('drive-upload');
    if (up) up.onclick = function () {
      var N = nd(); if (!N) return;
      setStatus('reading brain-food.txt…');
      try { N.driveUploadBrainFood(); } catch (e) { setStatus('upload error: ' + e); }
    };
    var rl = $('drive-refresh-list');
    if (rl) rl.onclick = function () {
      var N = nd(); if (!N) return;
      setStatus('listing Drive weights…');
      try { N.driveListWeights(); } catch (e) { setStatus('list error: ' + e); }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(); refreshAuth(); });
  } else { wire(); refreshAuth(); }

  return { onDriveEvent: onDriveEvent, onShow: onShow, refreshAuth: refreshAuth };
})();
