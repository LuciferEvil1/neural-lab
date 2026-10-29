/* === NL_GYM_SNIP — v65 "Game Gym": injected JS bridge snippets ===
 * These functions run INSIDE the Untrusted page (untrustedgame.com) via
 * GymActivity's evaluateJavascript. Contract from the 2026-10-10 recon:
 *   window.game (debug bundle) — game.map.getPlayer() -> getX()/getY()
 *   game.display.grid[x][y]  -> drawn cell array [{type,color,bgColor}, ...]
 *   game.editor.internalEditor (CodeMirror 3.1) .getValue()/.setValue()
 *   beforeChange handler MUST be detached before programmatic writes
 *     (mirrors the game's own setCode()); CodeMirror 3.x has .off()
 *   game._evalLevelCode() re-runs the level (Ctrl+5 / #executeButton)
 *   #chapter div text/class signals level change ("death" class = died)
 *   localStorage.levelReached increments per completed level
 * Every function is defensive: a missing field degrades to null, never throws
 * out of the IIFE (evaluateJavascript must always return a string).
 * Node harness hook at the bottom for unit tests with mocked globals.
 */
var GYM_SNIP = (function () {
  'use strict';

  function gameReady() {
    try {
      return (typeof window.game !== 'undefined' && !!window.game && !!window.game.map)
        ? 'ready' : 'wait';
    } catch (e) { return 'wait'; }
  }

  function perceive() {
    var out = { ready: false };
    try {
      var g = window.game;
      if (!g || !g.map) { out.reason = 'no window.game'; return JSON.stringify(out); }
      out.ready = true;

      try {
        var p = g.map.getPlayer();
        out.player = { x: p.getX(), y: p.getY() };
      } catch (e) { out.player = null; }

      /* Maze grid: recon says display.grid[x][y] is a cell array.
       * Fall back to ROT.js-style _data keyed "x,y". Take first drawn char. */
      try {
        var d = g.display;
        var grid = d && (d.grid || d._data);
        var W = (d && (d._width || d.width)) || 50;
        var H = (d && (d._height || d.height)) || 25;
        if (grid) {
          var rows = [], y, x, r, cell, c0, ch;
          for (y = 0; y < H; y++) {
            r = '';
            for (x = 0; x < W; x++) {
              cell = null;
              try { cell = grid[x] ? grid[x][y] : null; } catch (ee) {}
              if (cell == null) {
                try { cell = grid[x + ',' + y]; } catch (ee) {}
              }
              ch = ' ';
              try {
                if (cell) {
                  c0 = (cell.length !== undefined && cell.length) ? cell[0] : cell;
                  if (c0) ch = c0.type || c0.ch || c0.char || ' ';
                }
              } catch (ee) {}
              r += ch;
            }
            rows.push(r);
          }
          out.maze = rows; out.w = W; out.h = H;
        } else { out.maze = null; out.mazeErr = 'no display grid'; }
      } catch (e) { out.maze = null; out.mazeErr = String((e && e.message) || e); }

      try {
        out.inventory = (g.inventory || []).map(function (i) {
          return (i && (i.name || i.title)) || String(i);
        });
      } catch (e) { out.inventory = []; }

      try {
        var chEl = document.getElementById('chapter');
        out.chapter = chEl ? (chEl.textContent || '') : '';
        out.dead = chEl ? ((chEl.className || '').indexOf('death') >= 0) : false;
      } catch (e) { out.chapter = ''; out.dead = false; }

      try { out.code = g.editor.internalEditor.getValue(); }
      catch (e) { out.code = ''; }

      try { out.levelReached = parseInt(localStorage.getItem('levelReached') || '0', 10) || 0; }
      catch (e) { out.levelReached = 0; }

      try {
        out.level = (g._currentLevel != null) ? g._currentLevel
          : ((g._levelReached != null) ? g._levelReached : null);
      } catch (e) { out.level = null; }
    } catch (e) {
      out.ready = false;
      out.reason = 'err: ' + ((e && e.message) || e);
    }
    return JSON.stringify(out);
  }

  function writeCode(code) {
    try {
      var ed = window.game.editor.internalEditor;
      /* Mirror the game's own setCode(): detach the beforeChange guard that
       * restricts typing to editable regions, then write. We leave it
       * detached — the agent is the only writer and detaches every time. */
      try { ed.off('beforeChange'); } catch (e) {}
      ed.setValue(code);
      return 'wrote ' + ed.getValue().length + ' chars';
    } catch (e) { return 'write failed: ' + ((e && e.message) || e); }
  }

  function sendKey(key) {
    try {
      var c = document.querySelector('#screen canvas');
      if (!c) return 'no canvas';
      var codes = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13 };
      var code = codes[key] || 0;
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        var ev;
        try {
          ev = new KeyboardEvent(t, {
            key: key, keyCode: code, which: code,
            bubbles: true, cancelable: true
          });
        } catch (e) {
          ev = document.createEvent('Event');
          ev.initEvent(t, true, true);
          ev.key = key; ev.keyCode = code;
        }
        c.dispatchEvent(ev);
      });
      return 'sent ' + key;
    } catch (e) { return 'key failed: ' + ((e && e.message) || e); }
  }

  function execute() {
    try {
      window.game._evalLevelCode();
      return 'eval called';
    } catch (e) {
      try {
        var b = document.getElementById('executeButton');
        if (b) { b.click(); return 'button clicked'; }
      } catch (ee) {}
      return 'no exec path: ' + ((e && e.message) || e);
    }
  }

  var api = {
    gameReady: gameReady,
    perceive: perceive,
    writeCode: writeCode,
    sendKey: sendKey,
    execute: execute
  };

  /* Node harness hook (browser: module is undefined, no-op). */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  return api;
})();
