/* === NL_INGEST — v64 "Clean Feed" shared ingestion helpers (file scope) ===
 * wrapDoc: hard boundary delimiters — one document per crawled page / paste.
 * densityOk: alphanumeric-ratio gate that kills nav-bar/garbage pages.
 * Whitelist: the deployed v6 brain's own vocab (tongue.json stoi), loaded at
 * startup — never hardcoded. stripToVocab filters text to that vocab and
 * counts what it removed so the Training-ready card can report it.
 * (Pre-chunking was deliberately skipped: the trainer samples random crops,
 * so fixed windows would be redundant — delimiters are the real payload.)
 */
var NL_INGEST = (function () {
  'use strict';
  var DOC_START = '<|startoftext|>';
  var DOC_END = '<|endoftext|>';
  var READY_KB = 500;

  function wrapDoc(text) {
    return DOC_START + '\n' + text + '\n' + DOC_END + '\n';
  }

  function densityOk(text) {
    if (!text) return false;
    var m = text.match(/[A-Za-z0-9]/g);
    var alnum = m ? m.length : 0;
    return (alnum / text.length) >= 0.60;
  }

  /* Whitelist state: the exact char set the deployed brain can read. */
  var WL = { set: null, ready: false, loading: false };

  function loadWhitelist() {
    if (WL.ready || WL.loading) return;
    if (typeof XMLHttpRequest === 'undefined') return;
    WL.loading = true;
    try {
      var x = new XMLHttpRequest();
      x.open('GET', 'tongue.json', true);
      x.responseType = 'json';
      x.onload = function () {
        try {
          var resp = x.response;
          if (typeof resp === 'string') resp = JSON.parse(resp);
          var stoi = resp && resp.stoi;
          if (stoi) {
            WL.set = {};
            var keys = Object.keys(stoi), i;
            for (i = 0; i < keys.length; i++) WL.set[keys[i]] = 1;
            WL.ready = true;
            /* Startup assertion: the delimiter alphabet must survive the
             * whitelist, or staged documents would corrupt their boundaries. */
            var d = DOC_START + '\n' + DOC_END, missing = [];
            for (i = 0; i < d.length; i++) {
              if (!WL.set[d[i]]) missing.push(d[i]);
            }
            if (missing.length) {
              console.log('v64 whitelist: DELIMITER CHARS MISSING FROM VOCAB: ' +
                JSON.stringify(missing));
            } else {
              console.log('v64 whitelist: ready (' + keys.length +
                ' chars), delimiters intact.');
            }
          }
        } catch (e) { /* fall through: staging continues unfiltered */ }
        WL.loading = false;
      };
      x.onerror = function () { WL.loading = false; };
      x.send();
    } catch (e) { WL.loading = false; }
  }

  /* Strip to vocab, code-point aware (astral chars counted whole, not as
   * surrogate halves). set=null (whitelist not ready) => pass-through. */
  function stripToVocab(text, set) {
    var counts = {}, stripped = 0, out = '', i, cp, ch;
    text = String(text);
    if (!set) return { text: text, stripped: 0, counts: counts };
    for (i = 0; i < text.length; i++) {
      cp = text.codePointAt(i);
      ch = String.fromCodePoint(cp);
      if (cp > 0xFFFF) i++; /* skip the low surrogate */
      if (set[ch]) { out += ch; }
      else { stripped++; counts[ch] = (counts[ch] || 0) + 1; }
    }
    return { text: out, stripped: stripped, counts: counts };
  }

  function topCounts(counts, n) {
    var arr = Object.keys(counts).map(function (ch) { return [ch, counts[ch]]; });
    arr.sort(function (a, b) { return b[1] - a[1]; });
    return arr.slice(0, n);
  }

  function fmtChar(ch) {
    var cp = ch.codePointAt(0);
    if (cp < 32 || cp === 127 || cp === 0x00a0) {
      return 'U+' + cp.toString(16).toUpperCase();
    }
    return ch;
  }

  function isReady(kb) { return kb >= READY_KB; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Kick off the async vocab load as early as possible. */
  loadWhitelist();

  /* Node harness hook (browser: module is undefined, no-op). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      wrapDoc: wrapDoc, densityOk: densityOk,
      stripToVocab: stripToVocab, topCounts: topCounts, fmtChar: fmtChar,
      isReady: isReady,
      DOC_START: DOC_START, DOC_END: DOC_END, READY_KB: READY_KB, WL: WL
    };
  }

  return {
    wrapDoc: wrapDoc, densityOk: densityOk,
    loadWhitelist: loadWhitelist, stripToVocab: stripToVocab,
    topCounts: topCounts, fmtChar: fmtChar, esc: esc, isReady: isReady,
    DOC_START: DOC_START, DOC_END: DOC_END, READY_KB: READY_KB, WL: WL
  };
})();

/* === NL_CRAWLER + NL_WATCHER — v62 "Crawler" ===
 * NL_CRAWLER: in-app web crawler. BFS, depth-limited, polite (~1s between
 * pages). Fetches via the NB.httpGet native bridge (no CORS issues), extracts
 * clean text + links with DOMParser, streams new text into brain-food.txt.
 * The visible "browser" is an iframe (best-effort embed) + live URL/preview.
 * NL_WATCHER: corpus watcher. Runs automatically after every crawl and every
 * Brain Feeder save: paragraph-level dedupe against the existing brain-food.txt,
 * appends only new text, and refreshes the Training-ready card with corpus stats.
 * The phone GATHERS — training happens on Colab. No Drive upload in this build.
 */
var NL_CRAWLER = (function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var S = {
    running: false, queue: [], visited: {}, collected: '',
    pages: 0, kbNew: 0, t0: 0, timer: null,
    maxDepth: 2, maxPages: 50, sameDomain: true, wifiOnly: true,
    keywords: [], startHost: ''
  };

  function normUrl(u) {
    try { var x = new URL(u); x.hash = ''; return x.href; }
    catch (e) { return null; }
  }

  /* Clean text — same recipe as the Brain Feeder's feedCleanText. */
  function cleanText(doc) {
    var junk = doc.querySelectorAll('script, style, nav, header, footer, aside, form, button, noscript, svg, iframe');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    var root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
    if (!root) return '';
    var text = root.innerText || '';
    text = text.replace(/[ \t\u00a0]+/g, ' ');
    var lines = text.split('\n'), keep = [], l, j;
    for (j = 0; j < lines.length; j++) {
      l = lines[j].trim();
      if (l.length < 25) continue;
      if (/^(home|menu|search|login|sign in|subscribe|share|follow|advertisement)\b/i.test(l)) continue;
      keep.push(l);
    }
    return keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function extractLinks(doc, base) {
    var out = [], seen = {}, anchors = doc.getElementsByTagName('a'), i, href, abs;
    for (i = 0; i < anchors.length; i++) {
      href = anchors[i].getAttribute('href');
      if (!href) continue;
      try {
        abs = new URL(href, base).href.split('#')[0];
        if (!/^https?:\/\//i.test(abs)) continue;
        if (seen[abs]) continue;
        seen[abs] = 1;
        out.push(abs);
      } catch (e) { /* bad href */ }
    }
    return out;
  }

  function pageTitle(doc, url) {
    var t = (doc.querySelector('title') || {}).textContent;
    t = (t || '').trim().replace(/\s+/g, ' ');
    return t ? t.slice(0, 80) : url.slice(0, 80);
  }

  function log(msg, cls) {
    var box = $('crawl-log');
    if (!box) return;
    var d = document.createElement('div');
    d.innerHTML = esc(msg);
    if (cls) d.style.color = cls;
    box.appendChild(d);
    while (box.children.length > 80) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function setStatus(msg) {
    var el = $('crawl-cururl');
    if (el) el.textContent = msg;
  }

  function updateStats() {
    var el = $('crawl-stats');
    if (!el) return;
    var secs = Math.round((Date.now() - S.t0) / 1000);
    el.textContent = S.pages + ' pages kept · ' + S.queue.length + ' queued · ' +
      Object.keys(S.visited).length + ' visited · ' +
      S.kbNew.toFixed(1) + ' KB collected · ' + secs + 's elapsed';
  }

  function setButtons(running) {
    var a = $('btn-crawl-start'), b = $('btn-crawl-stop');
    if (a) a.disabled = running;
    if (b) b.disabled = !running;
  }

  function start() {
    if (S.running) return;
    if (!window.NB || !NB.httpGet) { setStatus('needs the native bridge (v62+).'); return; }
    var urlEl = $('crawl-url');
    var url = (urlEl && urlEl.value || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    var nu = normUrl(url);
    if (!nu) { setStatus('bad start URL.'); return; }
    S.maxDepth = Math.min(3, Math.max(1, parseInt(($('crawl-depth') || {}).value, 10) || 2));
    S.maxPages = Math.min(200, Math.max(1, parseInt(($('crawl-pages') || {}).value, 10) || 50));
    S.sameDomain = !!($('crawl-samedomain') || {}).checked;
    S.wifiOnly = !!($('crawl-wifionly') || {}).checked;
    var kw = (($('crawl-keys') || {}).value || '').toLowerCase();
    S.keywords = kw.split(',').map(function (k) { return k.trim(); }).filter(Boolean);
    S.startHost = new URL(nu).hostname;
    S.running = true; S.queue = [{ url: nu, depth: 0 }]; S.visited = {};
    S.collected = ''; S.pages = 0; S.kbNew = 0; S.t0 = Date.now();
    var box = $('crawl-log'); if (box) box.innerHTML = '';
    var pv = $('crawl-preview'); if (pv) pv.textContent = '';
    setButtons(true);
    log('🕷 crawling from ' + nu + ' (depth ≤' + S.maxDepth + ', ≤' + S.maxPages + ' pages' +
        (S.keywords.length ? ', keywords: ' + S.keywords.join(', ') : '') + ')');
    updateStats();
    step();
  }

  function stop() {
    if (!S.running) return;
    S.running = false;
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    log('■ stopped by user.');
    finish(false);
  }

  function step() {
    if (!S.running) return;
    if (S.queue.length === 0 || S.pages >= S.maxPages) { finish(true); return; }
    if (S.wifiOnly && window.NB && NB.isWifiConnected && !NB.isWifiConnected()) {
      setStatus('paused — waiting for Wi-Fi…');
      S.timer = setTimeout(step, 5000);
      return;
    }
    var item = S.queue.shift();
    var nu = normUrl(item.url);
    if (!nu || S.visited[nu]) { S.timer = setTimeout(step, 0); return; }
    try {
      if (S.sameDomain && new URL(nu).hostname !== S.startHost) { S.timer = setTimeout(step, 0); return; }
    } catch (e) { S.timer = setTimeout(step, 0); return; }
    S.visited[nu] = 1;
    fetchPage(item, nu);
  }

  function fetchPage(item, nu) {
    setStatus('loading: ' + nu);
    var frame = $('crawl-frame');
    if (frame) { try { frame.src = nu; } catch (e) { /* embed blocked */ } }
    var raw;
    try { raw = NB.httpGet(nu); }
    catch (e) { log('✗ ' + nu + ' (fetch error)', '#f88'); return next(); }
    var nl = raw.indexOf('\n');
    var code = parseInt(raw.slice(5, nl), 10) || 0;
    var html = raw.slice(nl + 1);
    if (!(code >= 200 && code < 300) || !html) {
      log('✗ ' + nu + ' (HTTP ' + code + ')', '#f88');
      return next();
    }
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); }
    catch (e) { log('✗ ' + nu + ' (parse error)', '#f88'); return next(); }
    /* Follow links regardless of whether we keep the text. */
    var links = extractLinks(doc, nu), i;
    for (i = 0; i < links.length; i++) {
      if (item.depth < S.maxDepth && !S.visited[normUrl(links[i]) || '']) {
        S.queue.push({ url: links[i], depth: item.depth + 1 });
      }
    }
    var text = cleanText(doc);
    var kwOk = !S.keywords.length ||
      S.keywords.some(function (k) { return text.toLowerCase().indexOf(k) >= 0; });
    /* v64: density check — drop nav-bar/garbage pages before anything else. */
    var dense = NL_INGEST.densityOk(text);
    if (text.length >= 200 && kwOk && dense) {
      /* v64: hard boundary delimiters — one document per page. */
      S.collected += NL_INGEST.wrapDoc(text);
      S.pages++;
      S.kbNew += text.length / 1024;
      var pv = $('crawl-preview');
      if (pv) pv.textContent = text.slice(0, 400) + (text.length > 400 ? '\n…' : '');
      log('✓ ' + pageTitle(doc, nu) + ' (' + (text.length / 1024).toFixed(1) + ' KB)', '#8f8');
    } else if (text.length >= 200 && kwOk) {
      log('– skipped ' + pageTitle(doc, nu) + ' (low-density page, likely nav/garbage)');
    } else {
      log('– skipped ' + pageTitle(doc, nu) + ' (too short / no keyword match)');
    }
    updateStats();
    next();
  }

  function next() {
    if (!S.running) return;
    S.timer = setTimeout(step, 1000); /* politeness */
  }

  function finish(natural) {
    S.running = false;
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    setButtons(false);
    updateStats();
    if (S.collected && window.NL_WATCHER) {
      var r = NL_WATCHER.stageText(S.collected, 'Crawler');
      if (r.ok) {
        log('🎓 staged +' + r.addedKB.toFixed(1) + ' KB new (' + r.dupeKB.toFixed(1) + ' KB dupes skipped).', '#8af');
        setStatus((natural ? 'done' : 'stopped') + ': ' + S.pages + ' pages → +' + r.addedKB.toFixed(1) + ' KB new in brain-food.txt');
      } else {
        log('save failed: ' + r.error, '#f88');
        setStatus('crawl done, staging failed: ' + r.error);
      }
    } else if (!S.collected) {
      setStatus((natural ? 'done' : 'stopped') + ': nothing new collected.');
    }
  }

  function onShow() {
    if (window.NL_WATCHER) NL_WATCHER.refresh();
  }

  /* Wire buttons once the DOM is ready (script loads at end of body). */
  function wire() {
    var a = $('btn-crawl-start'), b = $('btn-crawl-stop');
    if (a) a.onclick = start;
    if (b) b.onclick = stop;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else { wire(); }

  return { onShow: onShow };
})();

/* === NL_WATCHER — corpus watcher ===
 * stageText(text, source): dedupe paragraphs against the existing brain-food.txt,
 * append only new text via the Brain Feeder's MediaStore save path, and refresh
 * the Training-ready card. Called automatically after crawls and Brain Feeder saves.
 * refresh(): re-read the corpus and re-render the card (no staging).
 */
var NL_WATCHER = (function () {
  'use strict';
  function $(id) { return document.getElementById(id); }

  function hash(s) {
    var h = 5381, i;
    for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function paras(text) {
    return String(text).split(/\n\s*\n/)
      .map(function (p) { return p.replace(/\s+/g, ' ').trim(); })
      .filter(function (p) { return p.length > 0; });
  }

  function readCorpus() {
    if (!window.NB || !NB.readSharedText) return { text: '', noBridge: true };
    var r;
    try { r = NB.readSharedText('brain-food.txt'); }
    catch (e) { return { error: String(e) }; }
    if (r && r.indexOf('ERROR') === 0) return { error: r };
    return { text: r || '' };
  }

  function fmtKB(b) { return (b / 1024).toFixed(1); }

  function stageText(text, source) {
    var result = { ok: false, addedKB: 0, dupeKB: 0, totalKB: 0, lines: 0, chars: 0,
                   stripped: 0, strippedTop: [], whitelistOk: false, error: '' };
    NL_INGEST.loadWhitelist(); /* ensure the async vocab load is underway */
    var incoming = paras(text);
    if (!incoming.length) { result.error = 'nothing to stage'; return result; }
    /* v64: strip to the deployed brain's vocab BEFORE hashing, so stored and
     * incoming forms hash identically; count stripped chars for the report. */
    var ING = NL_INGEST, set = ING.WL.set;
    result.whitelistOk = ING.WL.ready;
    var stripCounts = {}, strippedTotal = 0, cleaned = [], i, k, s;
    for (i = 0; i < incoming.length; i++) {
      s = ING.stripToVocab(incoming[i], set);
      strippedTotal += s.stripped;
      for (k in s.counts) stripCounts[k] = (stripCounts[k] || 0) + s.counts[k];
      if (s.text.length > 0) cleaned.push(s.text);
    }
    result.stripped = strippedTotal;
    result.strippedTop = ING.topCounts(stripCounts, 5);
    incoming = cleaned;
    if (!incoming.length) { result.error = 'nothing left after vocab filtering'; return result; }
    var ex = readCorpus();
    if (ex.error) { result.error = ex.error; return result; }
    var have = {};
    var oldParas = paras(ex.text);
    for (i = 0; i < oldParas.length; i++) {
      /* v64: hash the stripped form so dedupe stays consistent with the
       * pre-whitelist corpus already on disk. */
      have[hash(ING.stripToVocab(oldParas[i], set).text)] = 1;
    }
    var fresh = [], dupeBytes = 0;
    for (i = 0; i < incoming.length; i++) {
      var h = hash(incoming[i]);
      if (have[h]) { dupeBytes += incoming[i].length; }
      else { have[h] = 1; fresh.push(incoming[i]); }
    }
    result.dupeKB = dupeBytes / 1024;
    var addedBytes = 0;
    if (fresh.length) {
      if (!window.NB || !NB.saveSharedText) { result.error = 'no save bridge'; return result; }
      /* Leading blank line: keeps the new block's paragraphs distinct from the
       * file's last paragraph so dedupe hashes stay stable across appends. */
      var block = '\n' + fresh.join('\n\n') + '\n';
      var res;
      try { res = NB.saveSharedText('brain-food.txt', block); }
      catch (e) { result.error = String(e); return result; }
      if (String(res).indexOf('OK') !== 0) { result.error = String(res); return result; }
      addedBytes = block.length;
    }
    result.addedKB = addedBytes / 1024;
    var totalBytes = ex.text.length + addedBytes;
    result.totalKB = totalBytes / 1024;
    result.chars = totalBytes;
    result.lines = (ex.text + (fresh.length ? fresh.join('\n\n') + '\n' : '')).split('\n').length;
    result.ok = true;
    renderCard(source, result);
    return result;
  }

  function refresh() {
    var ex = readCorpus();
    if (ex.error || ex.noBridge) { renderEmpty(ex.error); return; }
    if (!ex.text) { renderEmpty(''); return; }
    /* v64: scan the whole corpus for out-of-vocab chars (older unfiltered
     * stages) so the card doubles as the vocab-growth decision aid. */
    NL_INGEST.loadWhitelist();
    var st = {
      ok: true, addedKB: 0, dupeKB: 0,
      totalKB: ex.text.length / 1024, chars: ex.text.length,
      lines: ex.text.split('\n').length,
      stripped: 0, strippedTop: [], whitelistOk: NL_INGEST.WL.ready,
      corpusStripped: 0
    };
    if (NL_INGEST.WL.ready) {
      var s = NL_INGEST.stripToVocab(ex.text, NL_INGEST.WL.set);
      st.corpusStripped = s.stripped;
      st.strippedTop = NL_INGEST.topCounts(s.counts, 5);
    }
    renderCard('', st);
  }

  function renderEmpty(err) {
    var el = $('train-ready-stats');
    if (!el) return;
    el.textContent = err
      ? 'Could not read brain-food.txt: ' + err
      : 'No corpus data yet — run a crawl or use the Brain Feeder.';
  }

  function renderCard(source, st) {
    var el = $('train-ready-stats');
    if (!el) return;
    var ING = NL_INGEST, kb = st.totalKB;
    /* v64: explicit readiness indicator against the 500 KB training target. */
    var html = ING.isReady(kb)
      ? '🎓 <b>READY ✓</b> — ' + kb.toFixed(0) + ' KB staged for training'
      : '🎓 growing… <b>' + kb.toFixed(1) + ' KB / ' + ING.READY_KB + ' KB</b> to training-ready';
    html += '<br>Corpus: <b>' + fmtKB(st.chars) + ' KB</b> · ' +
      st.lines.toLocaleString() + ' lines · ~' + st.chars.toLocaleString() + ' chars';
    if (source) {
      html += '<br>This ' + esc(source) + ' run: <b>+' + st.addedKB.toFixed(1) +
        ' KB</b> new' + (st.dupeKB > 0.05 ? ' (' + st.dupeKB.toFixed(1) + ' KB dupes skipped)' : '');
    }
    /* v64: stripped-character report — the vocab-growth decision aid. */
    if (st.stripped > 0) {
      html += '<br>🧹 stripped ' + st.stripped.toLocaleString() + ' chars outside the v6 vocab' +
        (st.strippedTop && st.strippedTop.length ? ' — top: ' + st.strippedTop.map(function (t) {
          return ING.esc(ING.fmtChar(t[0])) + ' ×' + t[1];
        }).join(', ') : '');
    } else if (source && !st.whitelistOk) {
      html += '<br>🧹 vocab whitelist unavailable — staged unfiltered';
    }
    if (st.corpusStripped > 0) {
      html += '<br>🧹 corpus holds ' + st.corpusStripped.toLocaleString() +
        ' out-of-vocab chars from older unfiltered stages' +
        (st.strippedTop && st.strippedTop.length && !source ? ' — top: ' + st.strippedTop.map(function (t) {
          return ING.esc(ING.fmtChar(t[0])) + ' ×' + t[1];
        }).join(', ') : '');
    }
    html += '<br>✅ staged in <b>Documents/NeuralLab/brain-food.txt</b> — the Colab notebook picks it up once uploaded to Drive.';
    el.innerHTML = html;
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { stageText: stageText, refresh: refresh };
})();
