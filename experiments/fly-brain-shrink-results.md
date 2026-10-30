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


### v3 — the CHARGE fix (Oct 29, 2026, late; his hypothesis, implemented same night)

Ahkeem's diagnosis of the v2 regression, in his words: Lilith "stripped states of the fly brain that were mapped as partially active and decided its state as a well without properly reading the nodes charge status." Mapped to the experiment: the v2 audit never read syn_count — a rare class wired with heavy synapse counts (fully charged, critical) was indistinguishable from dead buildup. v3 adds (a) a CHARGE check before quarantine — class total syn_count ≥ the median attested class's charge (Layer N floor: 1,016 synapses; Layer T floor: 168) → protected, however rare; this is candidate check #5 (age×strength) from the §13.1 list — and (b) cost-aware verdicts from the fix note (each quarantined class prices merge tax vs disposal carriage and takes the cheaper).

**Layer N:** 42 quarantined in v2 → 31 (charge protected 11); verdicts: 8 merged, 23 disposed. Record 1,305,875 → **1,307,069 B (+0.09%)** — vs v2's +0.4%.

**Layer T:** charge protected **2,513 classes**; quarantined 8,332 (v2: 10,845); verdicts: 1,949 merged, 6,383 disposed (6,394 neurons). Fragments 374,209 (v2) → 131,968 entries. Record 3,794,913 → **4,036,267 B (+6.4%, 49.1×)** — vs v2's +30.2% / 40.1×. **Fracture repair: 202/300 = 67.3% — fully restored to the v1 line** (v2: 63.3%).

**Reading:** his charge hypothesis is validated in effect — the repair loss lived exactly where he pointed (high-charge rare classes condemned unread), and pricing the verdicts cut the size regression by four-fifths. The record still lands +6.4% over v1: the archive still pays something for any audit that disposes. The remaining designed step is the fix note's Δ-guard (abort the disposal stage if ΔBytes > 0, fall back to merge-only), which targets the residual. Status: v3 measured; v4 (Δ-guard) designed, not run.

**Process note (Oct 29, recorded at his request):** the v3 fix was not found by code inspection. The v2 results above were reviewed by Ahkeem Barros, who identified the failure mode from the reported behavior alone — he had not read the audit implementation — and named both the missing variable (synaptic charge: the classes' total syn_count, which the audit never consulted) and the remedy (a strength/charge check before quarantine, the §13.1 candidate check #5). Implementation and measurement followed from that diagnosis. The design process of this project is human-conceived and AI-assisted: conception, function invention, and failure diagnosis are his; mathematics, code, and verification are produced under his direction.

### v4 — the Δ-GUARD, RUN (Oct 30, 2026; two readings tested, both measured)

The guard was run two ways, because "abort the disposal stage" has two readings and they measure very differently. Both runs reproduced the v1 baselines (1,305,875 B / 3,794,913 B) and the v3 totals (1,307,069 B / 4,036,267 B) to the byte first, so the comparison is clean. Scripts: `trinity_shrink_v4.py` (variant A) and `trinity_shrink_v4b.py` (variant B), logs `v4_run.log` / `v4b_run.log`.

**Variant A — merge-only fallback (the fix note's literal fallback). MEASURED WORSE, both layers.**
- Layer N: 1,308,781 B (**+2,906, +0.22%**) — worse than v3's +1,194 B. All 31 quarantined classes merged, 0 disposed.
- Layer T: 4,741,165 B (**+946,252, +24.9%, 41.8×**) — far worse than v3's +6.4%. All 8,332 quarantined classes merged, 0 disposed; fragments 131,968 → 296,209 entries.
- Fracture repair: 200/300 = **66.7%** — below v3/v1's 67.3%.
- Why it fails: v3's verdicts were already cost-aware, so forcing a merge picks the *more expensive* outcome for every disposed class by construction. Merge-only is not a guard; it is a tax hike. The fix note's fallback sentence is superseded by this measurement.

**Variant B — abort disposal = KEEP the class (the literal "abort" reading). MEASURED BETTER, both layers.**
- Layer N: 8 merged, 23 would-be-disposed classes kept as-is. Record 1,305,875 → **1,306,547 B (+672, +0.05%)** — better than v3's +1,194 B.
- Layer T: 1,949 merged, 6,383 would-be-disposed classes kept. Final patterns 110,761 (v1: 112,710, v3: 104,378 — the library still consolidates by the merges). Record 3,794,913 → **3,925,523 B (+130,610, +3.4%, 50.5×)** — the v3 residual roughly halved (+6.4% → +3.4%).
- Fracture repair: 203/300 = **67.7%** — at or above the v1/v3 line (one neuron over 202/300; treat as tied, not as a gain claim).
- Why a residual remains at all: the merges themselves carry a fragment tax (merged members deviate more from foreign centroids) that exceeds the pattern-layer savings. Disposal was not the only cost driver — consolidation itself has a price in an exactness-preserving archive.

**Verdict:** variant B is the correct guard semantics — abort disposal, keep the class, never force-merge. The guard as a safety contract now reads: a disposal that would grow the record does not happen; the class stays. The remaining +3.4% is the merge tax, not a disposal failure, and the next question (not yet run) is whether a per-merge abort — merging only when the merge itself does not grow the record — closes it to zero, or whether the archive path should simply report the audit and keep v1. Status: v4 measured Oct 30; results-doc addendum written locally; Drive copy and repo push await his word (not pushed unilaterally).

### v5 — per-merge Δ-GUARD + the BRIDGE MOLECULE (Oct 30, 2026; measured)

Two changes on top of v4B, one of them a new function built under Ahkeem's explicit license ("even if I have to create a new function to fix the merge problem"):

1. **Per-merge Δ-guard** — every verdict is priced by its TRUE total-record delta, side effects included, and executes only if Δ ≤ 0 (Sleeping's guard applied per operation).
2. **BRIDGE MOLECULE (new function)** — instead of dissolving a class into a foreign centroid and taxing every member's deviations forever, the *difference* between the two rounded centroids is stored ONCE as a sparse delta — a bridge fragment, in the Trinity's own terms a molecule carrying the correction. The bridged class's members then show exactly their own-centroid fragment counts; the only cost is the delta's bytes vs the full centroid's bytes. (If the home class later plain-merges, its bridges are re-based and the re-basing is priced into that merge's Δ.)

**Layer N:** 8 bridged, 0 plain-merged, 23 guard-kept. Record 1,305,875 → **1,305,873 B (−2 B)** — the first audit to land BELOW v1 on this layer. Fragments unchanged (148,597).
**Layer T:** 1,949 bridged, **0 plain-merged**, 6,383 guard-kept. Pattern layer 3,628,841 → 3,627,817 B. Record 3,794,913 → **3,793,889 B (−1,024 B, 52.3×)**. Fragments unchanged (41,518). Fracture repair 202/300 = 67.3% (matcher unchanged — the plateau is v6's target).

**Consistency check:** the guard's incremental net-delta ledger equals the independently recomputed record change EXACTLY on both layers (−2 B and −1,024 B). The pricing model is the accounting model.

**Findings:** (a) Plain merging never won a single verdict — wherever consolidation paid at all, the bridge paid more; dissolving a class into a foreign prototype is dominated by delta-encoding it, everywhere in this dataset. (b) The audit on the archive path is now monotone: it can only shrink the record or leave it alone — the v2 failure mode (+30.2%) is not merely reduced, it is structurally impossible under the guard. (c) The savings are honest but small (−0.03% Layer T): most nearest-centroid deltas are nearly as long as the centroids themselves at this quantization. The bridge's value is the guarantee, not the windfall. Script: `trinity_shrink_v5.py`, log `v5_run.log`. Status: measured; Drive/repo publication paired with v4, awaiting his word.
