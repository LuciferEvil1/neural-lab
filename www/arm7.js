'use strict';
/* Neural Lab v29 "ReverseLab" — ARM7TDMI disassembler (ARM + Thumb).
 * The CPU in the Game Boy Advance. Decodes real 32-bit ARM and 16-bit
 * Thumb encodings into {addr, bytes, text, cls, target}.
 * cls: 'dp' data-processing · 'ls' load/store · 'br' branch ·
 *      'mul' multiply · 'misc' misc (bx/swi/…) · 'unk' unknown.
 * branch target (if any) goes in .target for the CFG builder.
 */
window.NL_ARM = (function () {
  var CONDS = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC',
               'HI', 'LS', 'GE', 'LT', 'GT', 'LE', '', 'NV'];
  var DPOPS = ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC',
               'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN'];
  var SHIFT = ['LSL', 'LSR', 'ASR', 'ROR'];
  var TALU = ['AND', 'EOR', 'LSL', 'LSR', 'ASR', 'ADC', 'SBC', 'ROR',
              'TST', 'NEG', 'CMP', 'CMN', 'ORR', 'MUL', 'BIC', 'MVN'];

  function rn(n) { return n === 13 ? 'sp' : n === 14 ? 'lr' : n === 15 ? 'pc' : 'r' + n; }
  function hex(v, w) {
    v = v >>> 0;
    var s = v.toString(16).toUpperCase();
    while (s.length < w) s = '0' + s;
    return '0x' + s;
  }
  function sext(v, bits) { // sign-extend a `bits`-wide value
    var m = 1 << (bits - 1);
    return (v & (m - 1)) - (v & m);
  }
  function ror(v, n) {
    n &= 31;
    v = v >>> 0;
    return ((v >>> n) | (v << (32 - n))) >>> 0;
  }
  function regList(bits) {
    var parts = [], start = -1, i;
    for (i = 0; i <= 16; i++) {
      var on = i < 16 && (bits & (1 << i));
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        parts.push(start === i - 1 ? rn(start) : rn(start) + '-' + rn(i - 1));
        start = -1;
      }
    }
    return '{' + parts.join(', ') + '}';
  }

  /* ── ARM (32-bit) ─────────────────────────────────────────── */
  function armOp2(word, I) {
    if (I) {
      var imm = word & 0xFF, rot = ((word >>> 8) & 0xF) * 2;
      return '#' + ror(imm, rot);
    }
    var rm = word & 0xF, st = (word >>> 5) & 3, amt = (word >>> 7) & 0x1F;
    var s = rn(rm);
    if ((word & 0x10) === 0 && amt === 0 && st === 0) return s; // plain register
    if (word & 0x10) return s + ', ' + SHIFT[st] + ' ' + rn((word >>> 8) & 0xF);
    return s + ', ' + SHIFT[st] + ' #' + (st === 3 && amt === 0 ? 32 : amt === 0 && st !== 0 ? 32 : amt);
  }

  function disARM(word, addr) {
    word = word >>> 0;
    var cond = CONDS[(word >>> 28) & 0xF];
    var cls26 = (word >>> 26) & 3, b25 = (word >>> 25) & 1;
    var out = { addr: addr, bytes: hex(word, 8), text: '', cls: 'unk', target: null };

    if (cls26 === 0) {
      // BX: 0001 0010 xxxx xxxx xxxx 0001 xxxx — check before data-processing
      if (((word >>> 4) & 0xFFFFFF) === 0x12FFF1) {
        out.text = 'BX' + cond + ' ' + rn(word & 0xF);
        out.cls = 'br'; // ends the block — no fall-through
        return out;
      }
      // multiply: bits[27:22]=000000, bits[7:4]=1001 — also before DP
      if (((word >>> 22) & 0x3F) === 0 && ((word >>> 4) & 0xF) === 9) {
        var A = (word >>> 21) & 1, S2 = (word >>> 20) & 1;
        var Rdd = (word >>> 16) & 0xF, Rnn2 = (word >>> 12) & 0xF,
            Rs = (word >>> 8) & 0xF, Rm = word & 0xF;
        out.text = (A ? 'MLA' : 'MUL') + cond + (S2 ? 'S' : '') + ' ' +
          rn(Rdd) + ', ' + rn(Rm) + ', ' + rn(Rs) + (A ? ', ' + rn(Rnn2) : '');
        out.cls = 'mul';
        return out;
      }
      if (b25 === 1 || ((word >>> 4) & 0xF) !== 9) {
        // data processing (immediate or register)
        var op = (word >>> 21) & 0xF, S = (word >>> 20) & 1;
        var Rdn = (word >>> 12) & 0xF, Rnn = (word >>> 16) & 0xF;
        var m = DPOPS[op] + cond + (S ? 'S' : '');
        var op2 = armOp2(word, b25);
        if (op >= 8 && op <= 11) out.text = m + ' ' + rn(Rnn) + ', ' + op2;       // TST/TEQ/CMP/CMN: no Rd
        else if (op === 13 || op === 15) out.text = m + ' ' + rn(Rdn) + ', ' + op2; // MOV/MVN: no Rn
        else out.text = m + ' ' + rn(Rdn) + ', ' + rn(Rnn) + ', ' + op2;
        out.cls = 'dp';
        return out;
      }
      out.text = '??? ' + hex(word, 8);
      return out;
    }
    if (cls26 === 1) {
      // single data transfer LDR/STR
      var I = b25, P = (word >>> 24) & 1, U = (word >>> 23) & 1,
          B = (word >>> 22) & 1, W = (word >>> 21) & 1, L = (word >>> 20) & 1;
      var Rnn3 = (word >>> 16) & 0xF, Rdd3 = (word >>> 12) & 0xF;
      var off = I ? armOp2(word & 0xFFF | ((word & 0xF) ), 0) : '#' + (word & 0xFFF);
      // rebuild register-offset form properly
      if (I) {
        var Rm2 = word & 0xF;
        off = (U ? '' : '-') + rn(Rm2);
      } else {
        off = (U ? '#' : '#-') + (word & 0xFFF);
      }
      var ea;
      if (P) ea = '[' + rn(Rnn3) + ', ' + off + ']' + (W ? '!' : '');
      else ea = '[' + rn(Rnn3) + '], ' + off;
      out.text = (L ? 'LDR' : 'STR') + cond + (B ? 'B' : '') + ' ' + rn(Rdd3) + ', ' + ea;
      out.cls = 'ls';
      return out;
    }
    if (cls26 === 2 && b25 === 0) {
      // block data transfer LDM/STM
      var P2 = (word >>> 24) & 1, U2 = (word >>> 23) & 1, W2 = (word >>> 21) & 1, L2 = (word >>> 20) & 1;
      var Rnn4 = (word >>> 16) & 0xF, list = word & 0xFFFF;
      var mode = (U2 ? 'I' : 'D') + (P2 ? 'B' : 'A'); // IA/IB/DA/DB
      out.text = (L2 ? 'LDM' : 'STM') + cond + mode + ' ' +
        rn(Rnn4) + (W2 ? '!' : '') + ', ' + regList(list);
      out.cls = 'ls';
      return out;
    }
    if (cls26 === 2 && b25 === 1) {
      // branch B / BL
      var L3 = (word >>> 24) & 1;
      var off24 = sext(word & 0xFFFFFF, 24) << 2;
      var tgt = (addr + 8 + off24) >>> 0;
      out.text = (L3 ? 'BL' : 'B') + cond + ' ' + hex(tgt, 8);
      out.cls = 'br';
      out.target = tgt;
      out.uncond = cond === '' && !L3; // plain B (AL) — no fall-through
      return out;
    }
    if (((word >>> 24) & 0xF) === 0xF) {
      out.text = 'SWI' + cond + ' ' + hex(word & 0xFFFFFF, 6);
      out.cls = 'misc';
      return out;
    }
    out.text = '??? ' + hex(word, 8);
    return out;
  }

  /* ── Thumb (16-bit) ───────────────────────────────────────── */
  function disThumb(hw, addr) {
    hw &= 0xFFFF;
    var out = { addr: addr, bytes: hex(hw, 4), text: '', cls: 'unk', target: null };
    var top3 = hw >>> 13, i;
    if (top3 === 0) {
      if (((hw >>> 10) & 7) === 3) {
        // format 2: add/subtract
        var sub = (hw >>> 9) & 1, imm3 = (hw >>> 6) & 7, Rs = (hw >>> 3) & 7, Rd = hw & 7;
        if ((hw >>> 10) & 1) out.text = (sub ? 'SUB' : 'ADD') + ' ' + rn(Rd) + ', ' + rn(Rs) + ', #' + imm3;
        else out.text = (sub ? 'SUB' : 'ADD') + ' ' + rn(Rd) + ', ' + rn(Rs) + ', ' + rn(imm3);
        out.cls = 'dp';
      } else {
        // format 1: move shifted register
        var op = (hw >>> 11) & 3, off5 = (hw >>> 6) & 0x1F, Rs2 = (hw >>> 3) & 7, Rd2 = hw & 7;
        var sop = ['LSL', 'LSR', 'ASR'][op];
        out.text = sop + ' ' + rn(Rd2) + ', ' + rn(Rs2) + ', #' + (off5 === 0 && op !== 0 ? 32 : off5);
        out.cls = 'dp';
      }
      return out;
    }
    if (top3 === 1) {
      // format 3: mov/cmp/add/sub immediate
      var op3 = (hw >>> 11) & 3, Rd3 = (hw >>> 8) & 7, imm8 = hw & 0xFF;
      out.text = ['MOV', 'CMP', 'ADD', 'SUB'][op3] + ' ' + rn(Rd3) + ', #' + imm8;
      out.cls = 'dp';
      return out;
    }
    if ((hw >>> 10) === 0x10) {
      // format 4: ALU ops
      var op4 = (hw >>> 6) & 0xF, Rs4 = (hw >>> 3) & 7, Rd4 = hw & 7;
      var t = TALU[op4];
      out.text = t === 'NEG' ? 'NEG ' + rn(Rd4) + ', ' + rn(Rs4)
        : (t === 'TST' || t === 'CMP' || t === 'CMN') ? t + ' ' + rn(Rd4) + ', ' + rn(Rs4)
        : (t === 'LSL' || t === 'LSR' || t === 'ASR' || t === 'ROR') ? t + ' ' + rn(Rd4) + ', ' + rn(Rs4)
        : t + ' ' + rn(Rd4) + ', ' + rn(Rs4);
      out.cls = 'dp';
      return out;
    }
    if ((hw >>> 10) === 0x11) {
      // format 5: hi-reg ops / BX
      var op5 = (hw >>> 8) & 3, H1 = (hw >>> 7) & 1, H2 = (hw >>> 6) & 1;
      var Rs5 = ((hw >>> 3) & 7) + (H2 ? 8 : 0), Rd5 = (hw & 7) + (H1 ? 8 : 0);
      if (op5 === 3) { out.text = 'BX ' + rn(Rs5); out.cls = 'br'; }
      else { out.text = ['ADD', 'CMP', 'MOV'][op5] + ' ' + rn(Rd5) + ', ' + rn(Rs5); out.cls = 'dp'; }
      return out;
    }
    if ((hw >>> 11) === 0x09) {
      // format 6: PC-relative load
      var Rd6 = (hw >>> 8) & 7, off8 = (hw & 0xFF) * 4;
      out.text = 'LDR ' + rn(Rd6) + ', [PC, #' + off8 + ']';
      out.cls = 'ls';
      return out;
    }
    if ((hw >>> 12) === 0x5) {
      // formats 7/8/9: load/store with register offset
      var lb = (hw >>> 10) & 3, Ro = (hw >>> 6) & 7, Rb = (hw >>> 3) & 7, Rd7 = hw & 7;
      out.text = ['STR', 'STRB', 'LDR', 'LDRB'][lb] + ' ' + rn(Rd7) + ', [' + rn(Rb) + ', ' + rn(Ro) + ']';
      out.cls = 'ls';
      return out;
    }
    if ((hw >>> 12) === 0x8) {
      // format 10: load/store halfword
      var lh = (hw >>> 11) & 1, off5b = ((hw >>> 6) & 0x1F) * 2, Rb2 = (hw >>> 3) & 7, Rd8 = hw & 7;
      out.text = (lh ? 'LDRH ' : 'STRH ') + rn(Rd8) + ', [' + rn(Rb2) + ', #' + off5b + ']';
      out.cls = 'ls';
      return out;
    }
    if ((hw >>> 12) === 0x9) {
      // format 11: SP-relative load/store
      var ls = (hw >>> 11) & 1, Rd9 = (hw >>> 8) & 7, off8b = (hw & 0xFF) * 4;
      out.text = (ls ? 'LDR ' : 'STR ') + rn(Rd9) + ', [SP, #' + off8b + ']';
      out.cls = 'ls';
      return out;
    }
    if ((hw >>> 12) === 0xA) {
      // format 12: add PC/SP to register
      var sp2 = (hw >>> 11) & 1, Rd10 = (hw >>> 8) & 7, off8c = (hw & 0xFF) * 4;
      out.text = 'ADD ' + rn(Rd10) + ', ' + (sp2 ? 'SP' : 'PC') + ', #' + off8c;
      out.cls = 'dp';
      return out;
    }
    if ((hw >>> 8) === 0xB0) {
      // format 13: adjust SP
      var sub2 = (hw >>> 7) & 1, imm7 = (hw & 0x7F) * 4;
      out.text = (sub2 ? 'SUB SP, SP, #' : 'ADD SP, SP, #') + imm7;
      out.cls = 'dp';
      return out;
    }
    if ((hw & 0xF600) === 0xB400 || (hw & 0xF600) === 0xB000) {
      // format 14: PUSH / POP — 0xB4xx push, 0xBCxx pop
      var isPop = (hw & 0x0800) !== 0; // bit 11: 0xB4xx vs 0xBCxx
      var rlist = hw & 0xFF, R = (hw >>> 8) & 1;
      var bits = rlist | (R && !isPop ? (1 << 14) : 0) | (R && isPop ? (1 << 15) : 0);
      out.text = (isPop ? 'POP ' : 'PUSH ') + regList(bits);
      out.cls = 'ls';
      return out;
    }
    if ((hw >>> 12) === 0xD) {
      // format 16: conditional branch
      var c = (hw >>> 8) & 0xF;
      if (c === 0xF) { out.text = 'SWI #' + (hw & 0xFF); out.cls = 'misc'; return out; }
      var off8d = sext(hw & 0xFF, 8) << 1;
      var tgt = (addr + 4 + off8d) >>> 0;
      out.text = 'B' + CONDS[c] + ' ' + hex(tgt, 8);
      out.cls = 'br'; out.target = tgt;
      return out;
    }
    if ((hw >>> 11) === 0x1C) {
      // format 18: unconditional branch
      var off11 = sext(hw & 0x7FF, 11) << 1;
      var tgt2 = (addr + 4 + off11) >>> 0;
      out.text = 'B ' + hex(tgt2, 8);
      out.cls = 'br'; out.target = tgt2; out.uncond = true;
      return out;
    }
    if ((hw >>> 11) === 0x1E || (hw >>> 11) === 0x1F) {
      // format 19: long branch with link (two halfwords — handled at stream level)
      out.text = 'BL? (halfword ' + (((hw >>> 11) & 1) ? 'lo' : 'hi') + ')';
      out.cls = 'br';
      return out;
    }
    out.text = '??? ' + hex(hw, 4);
    return out;
  }

  /* ── stream decode ────────────────────────────────────────── */
  // hexStr: "E3A00001 E59F1004 …" (spaces optional). mode: 'arm' | 'thumb'.
  function disasmStream(hexStr, base, mode) {
    base = (base == null ? 0x08000000 : base) >>> 0; // GBA ROM default
    var clean = String(hexStr || '').replace(/[^0-9a-fA-F]/g, '');
    var step = mode === 'thumb' ? 4 : 8;
    var out = [], addr = base, i;
    for (i = 0; i + step <= clean.length; i += step) {
      var chunk = clean.substr(i, step);
      if (mode === 'thumb') {
        var hw = parseInt(chunk, 16) & 0xFFFF;
        // BL pair: 0xFxxx followed by 0xF8xx-0xFFxx
        if ((hw >>> 11) === 0x1E && i + 8 <= clean.length) {
          var lo = parseInt(clean.substr(i + 4, 4), 16) & 0xFFFF;
          if ((lo >>> 11) === 0x1F) {
            var raw = (((hw & 0x7FF) << 11) | (lo & 0x7FF));
            if (raw & 0x200000) raw -= 0x400000;
            var tgt = (addr + 4 + (raw << 1)) >>> 0;
            out.push({ addr: addr, bytes: chunk.toUpperCase() + ' ' + clean.substr(i + 4, 4).toUpperCase(),
                       text: 'BL ' + hex(tgt, 8), cls: 'br', target: tgt });
            addr += 4; i += 4;
            continue;
          }
        }
        var d = disThumb(hw, addr);
        d.bytes = chunk.toUpperCase();
        out.push(d);
        addr += 2;
      } else {
        var w = parseInt(chunk, 16) >>> 0;
        out.push(disARM(w, addr));
        addr += 4;
      }
    }
    return out;
  }

  /* ── control-flow graph ───────────────────────────────────── */
  // Splits a listing into basic blocks; edges = fall-through + branch targets.
  function buildCFG(listing, mode) {
    var step = mode === 'thumb' ? 2 : 4;
    var addr2i = {}, i;
    for (i = 0; i < listing.length; i++) addr2i[listing[i].addr] = i;
    var leaders = {};
    if (listing.length) leaders[0] = true;
    for (i = 0; i < listing.length; i++) {
      var ins = listing[i];
      if (ins.cls === 'br') {
        if (ins.target != null && addr2i[ins.target] != null) leaders[addr2i[ins.target]] = true;
        if (i + 1 < listing.length) leaders[i + 1] = true;
      }
    }
    var order = Object.keys(leaders).map(Number).sort(function (a, b) { return a - b; });
    var blocks = [];
    for (var b = 0; b < order.length; b++) {
      var s = order[b], e = b + 1 < order.length ? order[b + 1] : listing.length;
      blocks.push({ id: b, start: listing[s].addr, ins: listing.slice(s, e) });
    }
    var edges = [];
    for (b = 0; b < blocks.length; b++) {
      var last = blocks[b].ins[blocks[b].ins.length - 1];
      if (last.cls === 'br') {
        if (last.target != null && addr2i[last.target] != null) {
          var tb = blockAt(blocks, addr2i[last.target]);
          if (tb !== b) edges.push([b, tb, 'jump']);
        }
        if (!last.uncond && last.text.indexOf('BX') !== 0 && b + 1 < blocks.length) {
          edges.push([b, b + 1, 'fall']);
        }
      } else if (b + 1 < blocks.length) {
        edges.push([b, b + 1, 'fall']);
      }
    }
    return { blocks: blocks, edges: edges };
  }
  function blockAt(blocks, insIdx) {
    // which block contains listing instruction `insIdx`?
    var seen = 0;
    for (var b = 0; b < blocks.length; b++) {
      if (insIdx >= seen && insIdx < seen + blocks[b].ins.length) return b;
      seen += blocks[b].ins.length;
    }
    return null;
  }

  /* ── synthetic data for the ML pieces ─────────────────────── */
  // Instruction-class dataset: random ARM words → features → class label.
  var ARM_CLASSES = ['dataproc', 'loadstore', 'branch', 'multiply', 'misc'];
  function armClassOf(word) {
    word = word >>> 0;
    var cls26 = (word >>> 26) & 3, b25 = (word >>> 25) & 1;
    if (cls26 === 2 && b25 === 1) return 2;                       // branch
    if (cls26 === 2) return 1;                                    // LDM/STM
    if (cls26 === 1) return 1;                                    // LDR/STR
    if (cls26 === 3 && ((word >>> 24) & 0xF) === 0xF) return 4;   // SWI
    if (cls26 === 0) {
      if (((word >>> 22) & 0x3F) === 0 && ((word >>> 4) & 0xF) === 9) return 3; // multiply
      if (((word >>> 4) & 0xFFFFFF) === 0x12FFF1) return 4;       // BX
      if (b25 === 1 || ((word >>> 4) & 0xF) !== 9) return 0;      // data processing
      return 4;
    }
    return 4;
  }
  // Features a network can actually learn from: raw structural bit fields.
  function armFeatures(word) {
    word = word >>> 0;
    return [
      (word >>> 28) / 15,                    // cond 0..1
      ((word >>> 26) & 3) / 3,               // class bits
      (word >>> 25) & 1,                     // I bit
      ((word >>> 21) & 0xF) / 15,            // opcode-ish nibble
      ((word >>> 20) & 1),                   // S/L bit
      ((word >>> 16) & 0xF) / 15,            // Rn
      ((word >>> 12) & 0xF) / 15,            // Rd
      (word & 0xFFF) / 4095                  // low 12 bits
    ];
  }
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeInstrDataset(seed, n) {
    var rng = mulberry(seed == null ? 1337 : seed);
    var X = [], y = [];
    // Bias toward realistic mixes: dataproc 40%, loadstore 30%, branch 15%, mul 5%, misc 10%
    var gen = [
      function () { // dataproc: 0xE--- ----
        return (0xE0000000 | ((rng() * 0x1000000) >>> 0)) >>> 0;
      },
      function () { // load/store: 0xE5-- / 0xE4--
        return (0xE4000000 | ((rng() * 0x2000000) >>> 0)) >>> 0;
      },
      function () { // branch: 0xEA-- / 0xEB--
        return (0xEA000000 | ((rng() * 0x2000000) >>> 0)) >>> 0;
      },
      function () { // multiply: 0xE00---90
        return (0xE0000090 | ((rng() * 0xFF) << 8) | ((rng() * 0xF) << 16) | ((rng() * 0xF) << 12)) >>> 0;
      },
      function () { // misc: BX / SWI
        return rng() < 0.5 ? (0xE12FFF10 | ((rng() * 0xF)) >>> 0) : (0xEF000000 | ((rng() * 0xFFFFFF) >>> 0)) >>> 0;
      }
    ];
    var mix = [0.40, 0.30, 0.15, 0.05, 0.10];
    for (var i = 0; i < n; i++) {
      var r = rng(), g = 0, acc = 0;
      for (var k = 0; k < mix.length; k++) { acc += mix[k]; if (r < acc) { g = k; break; } }
      var w = gen[g]();
      X.push(armFeatures(w));
      y.push(armClassOf(w));
    }
    return { X: X, y: y, classes: ARM_CLASSES };
  }

  return {
    disARM: disARM, disThumb: disThumb, disasmStream: disasmStream,
    buildCFG: buildCFG, armClassOf: armClassOf, armFeatures: armFeatures,
    makeInstrDataset: makeInstrDataset, ARM_CLASSES: ARM_CLASSES,
    hex: hex, rn: rn
  };
})();
