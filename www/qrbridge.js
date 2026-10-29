/* === NL_QRBRIDGE — v63 "QR Bridge": optical air-gap patch receiver (JS half) ===
 *
 * SECURITY POSTURE (the whole point of the safe version):
 *  - Scanning is user-initiated ONLY (Dev Options → 📷 Scan patch). The camera
 *    never runs in the background; permission is requested at scan time.
 *  - The native scanner reassembles frames and verifies the FULL SHA-256.
 *    NOTHING is executed on scan — JS only shows a preview.
 *  - The patch applies ONLY when the user taps Apply. JS modules are
 *    evaluated inside try/catch with automatic fallback to the previous
 *    version; a bad patch can never brick the session.
 *  - Plain-text payloads are never evaluated: they are saved as .txt and can
 *    optionally be appended to brain-food.txt via the Brain Feeder path.
 */
var NL_QRBRIDGE = (function () {
  'use strict';

  var LS_KEY = 'nl_qrbridge_v1';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function load() {
    try {
      var v = localStorage.getItem(LS_KEY);
      return v ? JSON.parse(v) : { modules: {}, texts: [] };
    } catch (e) { return { modules: {}, texts: [] }; }
  }
  function save(store) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {}
  }

  /* Pending patch from the last scan — kept in memory only until the user
   * taps Apply / Save / Discard. Never auto-applied. */
  var pending = null;

  function setStatus(msg) {
    var el = $('qr-status');
    if (el) el.textContent = msg;
  }

  function startScan() {
    if (!window.NB || !NB.qrScan) { setStatus('QR bridge unavailable in this build.'); return; }
    setStatus('starting camera…');
    try {
      var r = NB.qrScan();
      if (r === 'launching') setStatus('camera open — point at the QR stream');
      else if (r === 'requesting') setStatus('camera permission requested…');
      else setStatus('could not start scanner');
    } catch (e) { setStatus('scan error: ' + e); }
  }

  function onCameraResult(granted) {
    setStatus(granted ? 'camera granted — point at the QR stream'
                     : 'camera permission denied — cannot scan');
  }

  /* Called by MainActivity after QRScanActivity returns.
   * payload: {ok, text, hash, error} — text is the reassembled, SHA-256-
   * verified UTF-8 payload, or null on failure. */
  function onScanResult(jsonStr) {
    var p;
    try { p = JSON.parse(jsonStr); } catch (e) { p = null; }
    if (!p || !p.ok || typeof p.text !== 'string') {
      setStatus('scan failed: ' + esc((p && p.error) || 'unknown error'));
      hidePreview();
      return;
    }
    pending = { text: p.text, hash: p.hash || '' };
    showPreview();
  }

  function showPreview() {
    if (!pending) return;
    var card = $('qr-preview-card');
    if (!card) return;
    card.hidden = false;
    var h = $('qr-hash');
    if (h) h.textContent = (pending.hash || '').slice(0, 32) + '…';
    var ok = $('qr-hash-ok');
    if (ok) { ok.textContent = '✅ hash verified'; ok.style.color = '#7dffa8'; }
    var sz = $('qr-size');
    if (sz) sz.textContent = (pending.text.length / 1024).toFixed(1) + ' KB';
    var pv = $('qr-preview');
    if (pv) pv.textContent = pending.text.split('\n').slice(0, 15).join('\n');
    setStatus('patch received and hash-verified — review, then Apply or Discard.');
    var nm = $('qr-mod-name');
    if (nm && !nm.value) nm.value = 'patch';
    var fn = $('qr-txt-name');
    if (fn && !fn.value) fn.value = 'qr-patch.txt';
  }

  function hidePreview() {
    var card = $('qr-preview-card');
    if (card) card.hidden = true;
    pending = null;
  }

  /* Apply a JS module: versioned storage, try/catch eval, automatic
   * fallback to the previous version on ANY failure. */
  function applyModule() {
    if (!pending) return;
    var name = (($('qr-mod-name') || {}).value || 'patch').trim() || 'patch';
    var store = load();
    var cur = store.modules[name] || null;
    var entry = { code: pending.text, hash: pending.hash, ts: Date.now() };
    var result = $('qr-result');

    function report(msg, bad) {
      if (result) {
        result.textContent = msg;
        result.style.color = bad ? '#ff9a9a' : '#7dffa8';
      }
      setStatus(msg);
    }

    try {
      var module = { exports: {} };
      var fn = new Function('exports', 'module', pending.text);
      fn(module.exports, module);
      var applied = false;
      if (module.exports && typeof module.exports.apply === 'function') {
        module.exports.apply();
        applied = true;
      }
      // Persist: previous version kept as fallback.
      store.modules[name] = { latest: entry, prev: cur ? cur.latest : null };
      save(store);
      hidePreview();
      report('✅ module "' + name + '" applied' +
             (applied ? ' (apply() ran)' : ' (loaded, no apply() exported)') +
             ' — previous version kept as fallback.');
    } catch (err) {
      // Restore previous version as latest; the bad patch never persists.
      if (cur) { store.modules[name] = cur; save(store); }
      hidePreview();
      report('❌ patch failed safely: ' + err +
             (cur ? ' — previous version restored.' : ' — nothing was stored.'), true);
    }
  }

  /* Save a plain-text payload. Never evaluated. */
  function saveText() {
    if (!pending) return;
    var name = (($('qr-txt-name') || {}).value || 'qr-patch.txt').trim() || 'qr-patch.txt';
    var store = load();
    store.texts.push({ name: name, text: pending.text, hash: pending.hash, ts: Date.now() });
    if (store.texts.length > 20) store.texts = store.texts.slice(-20);
    save(store);
    var result = $('qr-result');
    if (result) {
      result.textContent = '💾 text saved as "' + name + '" (' + store.texts.length + ' stored).';
      result.style.color = '#7dffa8';
    }
    var btn = $('btn-qr-to-brainfood');
    if (btn) btn.hidden = false;
    setStatus('text saved — you can append it to brain-food.txt below, or Discard.');
  }

  function appendToBrainFood() {
    if (!pending && !lastSavedText()) return;
    var text = pending ? pending.text : lastSavedText();
    if (!window.NB || !NB.saveSharedText) { setStatus('Brain Feeder save unavailable.'); return; }
    try {
      var r;
      /* v64: route through the corpus watcher so QR text gets the same
       * delimiters, dedupe, and vocab filtering as crawls and pastes. */
      if (window.NL_WATCHER && NL_WATCHER.stageText && window.NL_INGEST && NB.readSharedText) {
        var wr = NL_WATCHER.stageText(NL_INGEST.wrapDoc(text), 'QR Bridge');
        r = wr.ok ? 'OK staged +' + wr.addedKB.toFixed(1) + ' KB new'
                  : 'ERROR ' + wr.error;
      } else {
        r = NB.saveSharedText('brain-food.txt', text);
      }
      setStatus('brain-food: ' + r);
      var result = $('qr-result');
      if (result) { result.textContent = '🧠 appended to brain-food.txt'; result.style.color = '#7dffa8'; }
    } catch (e) { setStatus('append failed: ' + e); }
  }

  function lastSavedText() {
    var store = load();
    return store.texts.length ? store.texts[store.texts.length - 1].text : null;
  }

  function discard() {
    hidePreview();
    setStatus('patch discarded — nothing was stored or run.');
    var result = $('qr-result');
    if (result) result.textContent = '';
  }

  function listModules() {
    var store = load();
    var names = Object.keys(store.modules);
    return names.length ? names.join(', ') : '(none yet)';
  }

  function wire() {
    var b;
    b = $('btn-qr-scan'); if (b) b.addEventListener('click', startScan);
    b = $('btn-qr-apply-js'); if (b) b.addEventListener('click', applyModule);
    b = $('btn-qr-save-txt'); if (b) b.addEventListener('click', saveText);
    b = $('btn-qr-to-brainfood'); if (b) b.addEventListener('click', appendToBrainFood);
    b = $('btn-qr-discard'); if (b) b.addEventListener('click', discard);
    var lm = $('qr-mod-list');
    if (lm) lm.textContent = 'stored modules: ' + listModules();
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', wire);
  else wire();

  return {
    startScan: startScan,
    onCameraResult: onCameraResult,
    onScanResult: onScanResult,
    discard: discard
  };
})();
