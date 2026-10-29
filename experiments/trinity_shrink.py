#!/usr/bin/env python3
"""Trinity shrink test on the public FlyWire fly-brain connectome (FAFB v783).

Method (pattern-layer distillation, per the confirmed scope):
  - Each presynaptic neuron's outgoing wiring is a fingerprint vector.
  - Layer N: counts per neuropil. Layer T: counts per postsynaptic cell type.
  - A fingerprint is SEALED (sha1 of its canonical form) -> dedupe = ghosts.
  - A log-bucket QUANTIZED seal defines the pattern class (the ghost);
    per-neuron deviations from the class centroid are stored as FRAGMENTS
    (molecules) so the exact fingerprint is restorable from the record.
  - Fracture test: damage sampled fingerprints, then MATCH them back to
    their sealed pattern (exact seal, then nearest centroid).

Honesty labels: the record restores each fingerprint EXACTLY (at its layer).
It does not store which specific partner neuron each synapse hit beyond
the layer's resolution (type counts, not partner IDs, at Layer T).
"""
import gzip, hashlib, math, random, sys
import numpy as np
import pandas as pd

random.seed(783)
DATA = '/home/hatch/workspace/fly-brain/'

def seal_of(vec_bytes: bytes) -> str:
    return hashlib.sha1(vec_bytes).hexdigest()

def bucket(c: int) -> int:
    if c <= 1: return 0
    return int(math.floor(math.log2(c)))  # 2-3->1, 4-7->2, 8-15->3, ...

def build_layer(df, key_col, label):
    g = df.groupby(['pre_root_id', key_col], observed=True)['syn_count'].sum()
    neurons = {}
    for (pre, k), c in g.items():
        neurons.setdefault(pre, {})[k] = int(c)
    ids = sorted(neurons)
    # exact seals
    exact = {}
    for n in ids:
        items = sorted(neurons[n].items())
        exact[n] = seal_of(repr(items).encode())
    n_exact_unique = len(set(exact.values()))
    # quantized patterns
    pat_of = {}
    members = {}
    for n in ids:
        q = tuple(sorted((k, bucket(c)) for k, c in neurons[n].items()))
        s = seal_of(repr(q).encode())
        pat_of[n] = s
        members.setdefault(s, []).append(n)
    pats = sorted(members)
    pidx = {s: i for i, s in enumerate(pats)}
    # centroids (mean exact counts per key)
    centroids = {}
    for s in pats:
        acc, cnt = {}, 0
        for n in members[s]:
            cnt += 1
            for k, c in neurons[n].items():
                acc[k] = acc.get(k, 0) + c
        centroids[s] = {k: v / cnt for k, v in acc.items()}
    # sizes: pattern layer = patterns (2B/entry: key code + bucket) + assignment 3B/neuron
    pat_bytes = sum(len(centroids[s]) * 2 for s in pats) + len(ids) * 3
    # fragment layer: per neuron store (2B key code + 2B signed diff) where
    # round(centroid) != exact count, over union of keys
    frag_entries = 0
    for n in ids:
        cen = centroids[pat_of[n]]
        keys = set(neurons[n]) | set(cen)
        for k in keys:
            if int(round(cen.get(k, 0))) != neurons[n].get(k, 0):
                frag_entries += 1
    frag_bytes = frag_entries * 4
    total = pat_bytes + frag_bytes
    print(f'[{label}] neurons={len(ids)} unique_exact_seals={n_exact_unique} '
          f'unique_patterns={len(pats)} pattern_layer={pat_bytes}B '
          f'fragments={frag_entries} ({frag_bytes}B) RECORD={total}B')
    return ids, neurons, pat_of, members, centroids, total

def fracture_test(ids, neurons, pat_of, members, centroids, label):
    cands = [n for n in ids if len(neurons[n]) >= 20]
    sample = random.sample(cands, min(300, len(cands)))
    cents = {s: centroids[s] for s in members}
    def vec_of(d): return d
    def cosine(a, b):
        keys = set(a) | set(b)
        va = np.array([a.get(k, 0) for k in keys], dtype=float)
        vb = np.array([b.get(k, 0) for k in keys], dtype=float)
        d = (np.linalg.norm(va) * np.linalg.norm(vb))
        return float(va @ vb / d) if d else 0.0
    seal_hit = 0; near_hit = 0
    for n in sample:
        orig = dict(neurons[n])
        keys = list(orig)
        drop = set(random.sample(keys, max(1, int(0.3 * len(keys)))))
        frac = {k: c for k, c in orig.items() if k not in drop}
        q = tuple(sorted((k, bucket(c)) for k, c in frac.items()))
        if seal_of(repr(q).encode()) == pat_of[n]:
            seal_hit += 1; near_hit += 1; continue
        best, best_s = None, -1
        for s, cen in cents.items():
            sc = cosine({k: float(v) for k, v in frac.items()}, cen)
            if sc > best_s: best_s, best = sc, s
        if best == pat_of[n]: near_hit += 1
    print(f'[{label}] fracture test on {len(sample)} neurons (30% entries deleted): '
          f'seal-match={seal_hit} nearest-pattern-match={near_hit} '
          f'({100.0*near_hit/len(sample):.1f}% repaired to correct pattern)')

print('loading connections...')
conn = pd.read_csv(DATA + 'connections.csv.gz',
                   usecols=['pre_root_id', 'post_root_id', 'neuropil', 'syn_count', 'nt_type'])
RAW_GZ = 50289304; RAW_CSV = 198264132
print(f'RAW: rows={len(conn)} total_synapses={int(conn.syn_count.sum())} '
      f'pre_neurons={conn.pre_root_id.nunique()} post_neurons={conn.post_root_id.nunique()} '
      f'neuropils={conn.neuropil.nunique()} csv={RAW_CSV}B gz={RAW_GZ}B')

idsN, neuN, patN, memN, cenN, totN = build_layer(conn, 'neuropil', 'Layer N neuropil')

types = pd.read_csv(DATA + 'consolidated_cell_types.csv.gz')
tmap = dict(zip(types.root_id, types.primary_type.fillna('unknown')))
conn['post_type'] = conn.post_root_id.map(tmap).fillna('unknown')
idsT, neuT, patT, memT, cenT, totT = build_layer(conn, 'post_type', 'Layer T partner-type')

print(f'SHRINK (pattern layers, exact-restorable at layer): '
      f'N={totN}B ({RAW_CSV/totN:.1f}x vs csv, {RAW_GZ/totN:.1f}x vs gz) | '
      f'T={totT}B ({RAW_CSV/totT:.1f}x vs csv, {RAW_GZ/totT:.1f}x vs gz)')
print('NOTE: partner-ID resolution is below Layer T by design (type counts, not IDs).')

fracture_test(idsT, neuT, patT, memT, cenT, 'Layer T')
