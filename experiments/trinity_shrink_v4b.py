#!/usr/bin/env python3
"""Trinity shrink v4b — v3 + DELTA-GUARD variant B (literal abort).

Variant B: the disposal stage ABORTS for any class that would be
disposed — that class is KEPT as-is (its own centroid, its own
members), not force-merged. Merges that were cost-cheaper stay merged.
This is the literal reading of "abort disposal if it grows the record":
disposal is the stage being aborted, merging is a separate verdict.
Compare against v4a (merge-only fallback) and v3/v1 totals.

v3 changes (his hypothesis, Oct 29 22:14 — the v2 audit "stripped states
mapped as partially active... without properly reading the nodes charge
status"; plus the fix note's cost-aware verdicts):
  check 1b CHARGE: a class whose total syn_count (its wiring strength —
           the nodes' charge) reaches the median charge of attested
           classes is PROTECTED, however rare it is. Rare-but-strong is
           critical mass, not buildup. (This is candidate check #5, the
           age x strength profile, from the section 13.1 candidate list.)
  verdicts COST-AWARE: for each quarantined class, price both outcomes —
           merge tax (members' fragment entries against the adopted
           centroid) vs disposal carriage (full fingerprints) — and take
           the cheaper. Disposal is no longer chosen by isolation alone.

Base method (the v2 Lilith pass): runs the v1 pattern-layer pipeline
(same seals, buckets, accounting), then
applies the anti-signal audit (spec section 13.1, as implemented in the
TNEC-1 virtual computer) to the pattern library — the accumulated classes
are the "wells" of the record:

  check 1  ATTESTATION (recency analog for a static record): a class fed
           by >= 3 neurons is live -> keep
  check 2  AGREEMENT: another class centroid within cosine >= 0.80 (the
           class lives in a populated region, as a well with live molecule
           traffic nearby) -> keep. (v2.1 fix: the first pass measured
           members against their OWN centroid — a singleton trivially
           agrees with itself, so nothing could ever fail. The chip's
           check is agreement with the surrounding live library.)
  check 3  FEED DIVERSITY (entropy attribution): members arrive from >= 2
           distinct presynaptic cell types, or >= 8 members -> keep
  fail all three -> QUARANTINE -> re-audit verdict:
    RECYCLE: merge into nearest surviving class if centroid cosine >= 0.55
             (the mass tax = members' fragment bytes recomputed against
             the merged centroid)
    DISPOSE: drop the class; its members carry full exact fingerprints as
             fragments (record stays exact; the library slot is freed)

Thresholds are data-distribution analogs of the chip's ceiling-derived
constants — labeled as such. Sleeping's loss contract has no static-data
analog (there are no live links in a file) and is not applied.

Measures: record size before/after (both layers), library size, exactness
spot-check, and the v1 fracture test re-run against the audited library
with the identical seed procedure (seed 783 -> same 300 neurons, same
30% deletions). A repair counts when the matched class equals the
neuron's post-audit assigned class (itself if kept, the merge target if
recycled; disposed-class neurons have no class and count as misses).
"""
import gc, gzip, hashlib, math, random, sys
import numpy as np
import pandas as pd
import scipy.sparse as sp

DATA = '/home/hatch/workspace/fly-brain/'
random.seed(783)

def seal_of(vec_bytes: bytes) -> str:
    return hashlib.sha1(vec_bytes).hexdigest()

def bucket(c: int) -> int:
    if c <= 1: return 0
    return int(math.floor(math.log2(c)))

def cosine(a, b):
    keys = set(a) | set(b)
    if not keys: return 0.0
    va = np.array([a.get(k, 0) for k in keys], dtype=float)
    vb = np.array([b.get(k, 0) for k in keys], dtype=float)
    d = (np.linalg.norm(va) * np.linalg.norm(vb))
    return float(va @ vb / d) if d else 0.0

def build_layer(df, key_col, label):
    g = df.groupby(['pre_root_id', key_col], observed=True)['syn_count'].sum()
    neurons = {}
    for (pre, k), c in g.items():
        neurons.setdefault(pre, {})[k] = int(c)
    ids = sorted(neurons)
    exact = {}
    for n in ids:
        items = sorted(neurons[n].items())
        exact[n] = seal_of(repr(items).encode())
    n_exact_unique = len(set(exact.values()))
    pat_of = {}
    members = {}
    for n in ids:
        q = tuple(sorted((k, bucket(c)) for k, c in neurons[n].items()))
        s = seal_of(repr(q).encode())
        pat_of[n] = s
        members.setdefault(s, []).append(n)
    pats = sorted(members)
    centroids = {}
    for s in pats:
        acc, cnt = {}, 0
        for n in members[s]:
            cnt += 1
            for k, c in neurons[n].items():
                acc[k] = acc.get(k, 0) + c
        centroids[s] = {k: v / cnt for k, v in acc.items()}
    pat_bytes = sum(len(centroids[s]) * 2 for s in pats) + len(ids) * 3
    frag_entries = 0
    for n in ids:
        cen = centroids[pat_of[n]]
        keys = set(neurons[n]) | set(cen)
        for k in keys:
            if int(round(cen.get(k, 0))) != neurons[n].get(k, 0):
                frag_entries += 1
    total = pat_bytes + frag_entries * 4
    print(f'[{label}] v1: neurons={len(ids)} unique_exact={n_exact_unique} '
          f'patterns={len(pats)} pattern_layer={pat_bytes}B fragments={frag_entries} '
          f'RECORD={total}B', flush=True)
    return ids, neurons, pat_of, members, centroids, total

ATTEST_MIN = 3
NEIGHBOR_MIN_COS = 0.80
MERGE_MIN_COS = 0.55

def centroid_matrix(centroids, pats):
    """Row-normalized SPARSE centroid matrix (float64 CSR). Centroids are
    sparse (~14 keys/pattern at Layer T), so this is tens of MB — the dense
    version OOM-killed the v2.1 run on this VM."""
    keys = sorted({k for s in pats for k in centroids[s]})
    kidx = {k: i for i, k in enumerate(keys)}
    rows, cols, data = [], [], []
    for r, s in enumerate(pats):
        for k, v in centroids[s].items():
            rows.append(r); cols.append(kidx[k]); data.append(float(v))
    M = sp.csr_matrix((data, (rows, cols)), shape=(len(pats), len(keys)))
    nrm = np.sqrt(M.multiply(M).sum(axis=1)).A1
    nrm[nrm == 0] = 1.0
    return M.multiply(1.0 / nrm[:, None]).tocsr()

def best_neighbors_all(M, chunk=1024):
    """Exact best cosine to any OTHER row for every row (chunked sparse
    matmul). Same quantity as the v2.0 inverted-index pass, which was
    still running after 90 minutes on Layer T."""
    n = M.shape[0]
    MT = M.T.tocsr()
    bi = np.empty(n, dtype=np.int64); bc = np.empty(n, dtype=np.float64)
    for i in range(0, n, chunk):
        j = min(i + chunk, n)
        S = (M[i:j] @ MT).toarray()
        rows = np.arange(i, j)
        S[np.arange(j - i), rows] = -1.0
        bi[i:j] = np.argmax(S, axis=1)
        bc[i:j] = S[np.arange(j - i), bi[i:j]]
    return bi, bc

def audit(ids, neurons, pat_of, members, centroids, pre_type, label, abort_disposal=False):
    """Anti-signal sweep. Returns (final_members, final_centroids, new_pat_of, stats)."""
    pats = sorted(members)
    pidx = {s: i for i, s in enumerate(pats)}
    M = centroid_matrix(centroids, pats)
    print(f'[{label}] centroid matrix {M.shape} — neighbor search…', flush=True)
    _, nb_c = best_neighbors_all(M)
    # CHARGE (v3, his fix): total syn_count per class — the nodes' wiring
    # strength. Threshold = median charge of attested (>= ATTEST_MIN) classes.
    charge = {s: sum(sum(neurons[n].values()) for n in members[s]) for s in pats}
    attested_charges = [charge[s] for s in pats if len(members[s]) >= ATTEST_MIN]
    CHARGE_MIN = float(np.median(attested_charges)) if attested_charges else float('inf')
    print(f'[{label}] charge: median attested class={CHARGE_MIN:.0f} synapses (protection floor)', flush=True)
    kept, quarantined = [], []
    protected = 0
    for s in pats:
        mem = members[s]
        if len(mem) >= ATTEST_MIN:
            kept.append(s); continue
        if charge[s] >= CHARGE_MIN:
            kept.append(s); protected += 1; continue
        if float(nb_c[pidx[s]]) >= NEIGHBOR_MIN_COS:
            kept.append(s); continue
        types = {pre_type.get(n, 'unknown') for n in mem}
        if len(types) >= 2 or len(mem) >= 8:
            kept.append(s); continue
        quarantined.append(s)
    kept_set = set(kept)
    kept_rows = np.array([pidx[s] for s in kept], dtype=np.int64)
    # re-audit, COST-AWARE (v3): price merge tax vs disposal carriage per
    # class and take the cheaper outcome.
    merge_target = {}
    disposed = []
    kept_disposed = []
    if quarantined:
        q_rows = np.array([pidx[s] for s in quarantined], dtype=np.int64)
        MKT = M[kept_rows].T.tocsr()
        best_home = {}
        for qi in range(0, len(q_rows), 512):
            qj = min(qi + 512, len(q_rows))
            S = (M[q_rows[qi:qj]] @ MKT).toarray()
            am = np.argmax(S, axis=1)
            for off in range(qj - qi):
                best_home[quarantined[qi + off]] = kept[int(am[off])]
        for s in quarantined:
            home = best_home[s]
            cen = centroids[home]
            cost_merge = 0
            for n in members[s]:
                keys = set(neurons[n]) | set(cen)
                for k in keys:
                    if int(round(cen.get(k, 0))) != neurons[n].get(k, 0):
                        cost_merge += 1
            cost_dispose = sum(len(neurons[n]) for n in members[s])
            if cost_merge <= cost_dispose:
                merge_target[s] = home
            elif abort_disposal:
                kept_disposed.append(s)
            else:
                disposed.append(s)
    # final member sets
    final_members = {s: list(members[s]) for s in kept}
    for s in kept_disposed:
        final_members[s] = list(members[s])
    for s, tgt in merge_target.items():
        final_members[tgt].extend(members[s])
    final_centroids = {}
    for s, mem in final_members.items():
        acc, cnt = {}, 0
        for n in mem:
            cnt += 1
            for k, c in neurons[n].items():
                acc[k] = acc.get(k, 0) + c
        final_centroids[s] = {k: v / cnt for k, v in acc.items()}
    new_pat_of = {}
    for s, mem in final_members.items():
        for n in mem: new_pat_of[n] = s
    disposed_set = set(disposed)
    # sizes with v1 accounting; disposed neurons carry full fingerprints
    pat_bytes = sum(len(final_centroids[s]) * 2 for s in final_centroids) + len(ids) * 3
    frag_entries = 0
    for n in ids:
        if pat_of[n] in disposed_set:
            frag_entries += len(neurons[n])  # full fingerprint, no centroid
        else:
            cen = final_centroids[new_pat_of[n]]
            keys = set(neurons[n]) | set(cen)
            for k in keys:
                if int(round(cen.get(k, 0))) != neurons[n].get(k, 0):
                    frag_entries += 1
    total = pat_bytes + frag_entries * 4
    stats = dict(kept=len(kept), kept_disposed=len(kept_disposed), quarantined=len(quarantined),
                 recycled=len(merge_target), disposed=len(disposed),
                 disposed_neurons=sum(len(members[s]) for s in disposed),
                 final_patterns=len(final_centroids),
                 pat_bytes=pat_bytes, frag_entries=frag_entries, total=total)
    print(f'[{label}] AUDIT: kept={stats["kept"]} quarantined={stats["quarantined"]} '
          f'recycled(merged)={stats["recycled"]} disposed={stats["disposed"]} '
          f'(disposed neurons={stats["disposed_neurons"]}) '
          f'final_patterns={stats["final_patterns"]} pattern_layer={pat_bytes}B '
          f'fragments={frag_entries} RECORD={total}B', flush=True)
    return final_members, final_centroids, new_pat_of, stats

def fracture_test_v2(ids, neurons, new_pat_of, final_centroids, label):
    random.seed(783)  # identical sampling to v1
    cands = [n for n in ids if len(neurons[n]) >= 20]
    sample = random.sample(cands, min(300, len(cands)))
    pats = sorted(final_centroids)
    pidx = {s: i for i, s in enumerate(pats)}
    M = centroid_matrix(final_centroids, pats)
    keys = sorted({k for s in pats for k in final_centroids[s]})
    kidx = {k: i for i, k in enumerate(keys)}
    seal_hit = 0; near_hit = 0
    A = np.zeros((len(sample), len(keys)), dtype=np.float32)
    targets = []
    for r, n in enumerate(sample):
        orig = dict(neurons[n])
        ks = list(orig)
        drop = set(random.sample(ks, max(1, int(0.3 * len(ks)))))
        frac = {k: c for k, c in orig.items() if k not in drop}
        q = tuple(sorted((k, bucket(c)) for k, c in frac.items()))
        target = new_pat_of.get(n)  # None if its class was disposed
        targets.append(target)
        if target is not None and seal_of(repr(q).encode()) == target:
            seal_hit += 1; near_hit += 1; targets[r] = 'SEALED'; continue
        for k, v in frac.items():
            if k in kidx: A[r, kidx[k]] = np.float32(v)
    nrm = np.linalg.norm(A, axis=1, keepdims=True); nrm[nrm == 0] = 1.0
    A = (A / nrm).astype(np.float64)
    MT = M.T.tocsr()
    am = np.empty(len(sample), dtype=np.int64)
    for i in range(0, len(sample), 100):
        j = min(i + 100, len(sample))
        am[i:j] = np.argmax(A[i:j] @ MT, axis=1)
    for r in range(len(sample)):
        if targets[r] == 'SEALED': continue
        t = targets[r]
        if t is not None and pats[int(am[r])] == t: near_hit += 1
    print(f'[{label}] fracture v2 on {len(sample)} neurons (30% deleted, seed 783): '
          f'seal-match={seal_hit} nearest-pattern-match={near_hit} '
          f'({100.0*near_hit/len(sample):.1f}% repaired)', flush=True)

print('loading connections...', flush=True)
conn = pd.read_csv(DATA + 'connections.csv.gz',
                   usecols=['pre_root_id', 'post_root_id', 'neuropil', 'syn_count', 'nt_type'])
RAW_GZ = 50289304; RAW_CSV = 198264132
print(f'RAW: rows={len(conn)} synapses={int(conn.syn_count.sum())}', flush=True)

types = pd.read_csv(DATA + 'consolidated_cell_types.csv.gz')
pre_type = dict(zip(types.root_id, types.primary_type.fillna('unknown')))
tmap = pre_type
conn['post_type'] = conn.post_root_id.map(tmap).fillna('unknown')

idsN, neuN, patN, memN, cenN, totN = build_layer(conn, 'neuropil', 'Layer N')
fmN, fcN, npN, stN = audit(idsN, neuN, patN, memN, cenN, pre_type, 'Layer N', abort_disposal=True)
print(f'[Layer N] v1={totN}B -> v2={stN["total"]}B '
      f'({RAW_CSV/stN["total"]:.1f}x vs csv) delta={stN["total"]-totN:+d}B', flush=True)

idsT, neuT, patT, memT, cenT, totT = build_layer(conn, 'post_type', 'Layer T')
del conn, fmN, fcN, npN, memN, cenN, neuN
gc.collect()
fmT, fcT, npT, stT = audit(idsT, neuT, patT, memT, cenT, pre_type, 'Layer T', abort_disposal=True)
print(f'[Layer T] v1={totT}B -> v2={stT["total"]}B '
      f'({RAW_CSV/stT["total"]:.1f}x vs csv) delta={stT["total"]-totT:+d}B', flush=True)

fracture_test_v2(idsT, neuT, npT, fcT, 'Layer T')
print('DONE', flush=True)
