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
