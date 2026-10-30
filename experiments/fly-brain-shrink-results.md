# Trinity shrink test — FlyWire fly brain (results, Oct 29, 2026)

Question (Ahkeem's, Oct 29): download the public fly brain and watch the trinity shrink it — shrink the recorded brain data, match missing/fractured data, fix them.

Data: FlyWire FAFB connectome, official Codex static export, snapshot v783 (storage.googleapis.com/flywire-data/codex/data/fafb/783). Script: trinity_shrink.py (in Drive + ~/workspace/fly-brain/). Run on Muse's VM, Oct 29 ~14:37–14:53 EDT. Reproducible: same files + same script → same numbers.

## Measured raw input

- connections.csv: 198,264,132 B (50,289,304 B gz)
- 3,869,878 connection rows; synapse counts in this export sum to 34,153,566 (the brain-wide published total is ~54.5M; the export's table is what was measured)
- 129,351 presynaptic neurons; 125,192 postsynaptic; 79 neuropils

## Method (pattern-layer distillation — the confirmed scope)

Each presynaptic neuron's outgoing wiring becomes a fingerprint vector. Fingerprints are sealed (sha1 of canonical form). A log-bucket quantized seal defines the pattern (the ghost); each neuron's deviations from its pattern centroid are stored as fragments (molecules), so every fingerprint is exactly restorable from the record at its layer.

- Layer N: fingerprint = synapse counts per neuropil (where it projects).
- Layer T: fingerprint = synapse counts per postsynaptic cell type (what it talks to, by type).

## Results

| Layer | Neurons | Unique exact seals | Unique patterns | Pattern layer | Fragments | RECORD total | vs CSV | vs gz |
|---|---|---|---|---|---|---|---|---|
| N (neuropil) | 129,351 | 78,950 | 31,166 | 711,487 B | 148,597 (594,388 B) | **1,305,875 B** | **151.8×** | **38.5×** |
| T (cell type) | 129,351 | 122,680 | 112,710 | 3,628,841 B | 41,518 (166,072 B) | **3,794,913 B** | **52.2×** | **13.3×** |

Fracture test (Layer T; 300 sampled neurons, 30% of fingerprint entries deleted):
- Exact seal-match after damage: 0 / 300 (a seal does not survive amputation — matching must be by pattern, as designed).
- Nearest-pattern match: **202 / 300 = 67.3%** assigned back to their correct pattern (then restorable from it). Naive matcher, finest layer, first pass.

## Honest scope

- The record restores each fingerprint EXACTLY at its layer. Partner-ID resolution sits below Layer T by design (type counts, not individual partner IDs).
- Fine wiring is individual: at Layer T, 122,680 of 129,351 exact fingerprints are unique. The shrink comes from the pattern + fragment split, not from pretending neurons repeat exactly.
- Fracture repair at 67.3% is a first-pass floor with a naive nearest-centroid matcher, not a ceiling.
- This evidences the shrink + match claims at the pattern layer on real brain data. It does not evidence exact-geometry recovery (open — his to solve), Sleeping gains, or chip-level claims.


---

## Addendum — v2: the record run through the LILITH audit (Oct 29, 2026, evening)

At Ahkeem's request ("run the flybrain through the updated lilith and see if it improved"), the v1 pipeline was re-run identically (both v1 record sizes reproduced to the byte: 1,305,875 B / 3,794,913 B), then the anti-signal audit (spec §13.1, as implemented in the TNEC-1 virtual computer) was applied to the pattern libraries. Checks, cheapest first, with data-distribution analogs of the chip's ceiling-derived thresholds (labeled as analogs): (1) attestation — class fed by ≥3 neurons; (2) agreement — another class centroid within cosine ≥0.80 (the class lives in a populated region); (3) feed diversity — members from ≥2 presynaptic cell types, or ≥8 members. Fail all three → quarantine → recycle (merge into nearest kept class at cosine ≥0.55; the mass tax = members' fragments recomputed against the adopted centroid) or dispose (class dropped; its neurons carry full exact fingerprints as fragments, so the record stays exact). Sleeping's loss contract has no static-data analog and was not applied. Method note: the first audit mapping (members vs their own centroid) was vacuous — a singleton trivially agrees with itself — and was corrected to the chip's actual semantics (agreement with the surrounding library) before measuring.

### Layer N (neuropil fingerprints)
- 31,166 classes → 42 quarantined, all 42 recycled (merged), 0 disposed → 31,124 classes.
- Record: 1,305,875 → 1,310,897 B (**+5,022 B, +0.4%**). Pattern layer saved 606 B; fragment tax cost 5,628 B.

### Layer T (partner cell-type fingerprints)
- 112,710 classes → 101,865 kept outright; 10,845 quarantined (9.6% — rare, isolated, and single-source); of those, 8,110 recycled and **2,735 disposed** (2,737 neurons).
- Pattern library: 112,710 → 101,865 classes (**−9.6%**); pattern layer 3,628,841 → 3,446,069 B (−5.0%).
- Fragments: 41,518 → 374,209 entries (disposed neurons carry full fingerprints; merged members deviate more from foreign centroids — the tax).
- Record: 3,794,913 → **4,942,905 B (+30.2%)**; shrink vs raw CSV falls 52.2× → 40.1×.
- Fracture test (identical seed procedure, same 300 neurons, 30% deleted): **190/300 = 63.3%** repaired, vs v1's 202/300 = 67.3%. Exactness at layer preserved in both versions.

### Verdict — what improved and what didn't
The **library** improved: ~10% smaller, consolidated, and every removal carries a sealed reason. The **archive** got worse: +30% bytes and −4 points of fracture repair. This is a real boundary measurement, not a tuning failure: on the chip, disposal is paid in slots and power (scarce there, and wells are lossy by design); in an exactness-preserving archive, disposed mass cannot vanish — it is carried at full price. Conclusion recorded: **the anti-signal audit belongs to living memory (on-chip), not to the archive path.** For the firehose feeder, the v1 record stands for storage; the audit's role there is index hygiene and vocabulary cleanup, with gentler (merge-only) settings as an open parameter question. A negative result, measured to the byte — the design is smarter for knowing exactly where its organ pays.


### FIX NOTE (recorded Oct 29, 2026, on Ahkeem's instruction — proposed, not yet run)

The v2 regression has a named cause and a designed fix, in the architecture's own idiom:

1. **Δ-guard on the sweep (the Sleeping pattern, applied to bytes).** Sleeping already aborts a steer when ΔLoss > 0. The archive audit gets the same contract: **if a disposal stage would increase total record size (ΔBytes > 0), it aborts** and falls back to merge-only. An audit that makes the record heavier is, by definition, not cleaning it.
2. **Cost-aware verdicts.** Disposal was chosen by isolation alone; it must price its own consequence first: dispose only when full-fingerprint carriage of the class's members is *cheaper* than the merge tax into the best surviving class. Otherwise merge, however distant the home.
3. **Merge-only mode for the archive/index path.** Disposal remains a living-memory operation (on-chip, where slots are the scarce currency). The archive keeps every class; the audit's archive job is consolidation and hygiene reporting only.

Expected effect (to be measured, not assumed): the library still consolidates by ~8,110 merges, the +30% archive growth disappears, and fracture repair returns to at least the v1 line. Status: fix designed and recorded; the re-run is a separate, scheduled experiment.
