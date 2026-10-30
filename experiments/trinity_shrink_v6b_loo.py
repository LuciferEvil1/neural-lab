#!/usr/bin/env python3
"""v6b — LEAVE-ONE-OUT verification of the v6 matcher result.
v6's M6 (cheapest-encoding) scored 300/300. Fair challenge: each target
class centroid is an average that INCLUDES the sampled neuron itself.
This check rebuilds each sampled neuron's class centroid WITHOUT that
neuron and re-scores only the target row (all other classes untouched).
A singleton class vanishes under LOO -> automatic miss, counted.
Also re-runs standard M6/M2 in-script as anchors (must read 300 / 297).
"""
import hashlib, math, random
import numpy as np
import pandas as pd
import scipy.sparse as sp

DATA = '/home/hatch/workspace/fly-brain/'
def seal_of(b): return hashlib.sha1(b).hexdigest()
def bucket(c):
    if c <= 1: return 0
    return int(math.floor(math.log2(c)))

conn = pd.read_csv(DATA + 'connections.csv.gz',
                   usecols=['pre_root_id', 'post_root_id', 'neuropil', 'syn_count', 'nt_type'])
types = pd.read_csv(DATA + 'consolidated_cell_types.csv.gz')
tmap = dict(zip(types.root_id, types.primary_type.fillna('unknown')))
conn['post_type'] = conn.post_root_id.map(tmap).fillna('unknown')

g = conn.groupby(['pre_root_id', 'post_type'], observed=True)['syn_count'].sum()
neurons = {}
for (pre, k), c in g.items():
    neurons.setdefault(pre, {})[k] = int(c)
ids = sorted(neurons)
pat_of, members = {}, {}
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
print(f'Layer T rebuilt: patterns={len(pats)}', flush=True)

random.seed(783)
cands = [n for n in ids if len(neurons[n]) >= 20]
sample = random.sample(cands, min(300, len(cands)))
fracs, targets = [], []
for n in sample:
    orig = dict(neurons[n])
    ks = list(orig)
    drop = set(random.sample(ks, max(1, int(0.3 * len(ks)))))
    fracs.append({k: c for k, c in orig.items() if k not in drop})
    targets.append(pat_of[n])

pidx = {s: i for i, s in enumerate(pats)}
keys = sorted({k for s in pats for k in centroids[s]})
kidx = {k: i for i, k in enumerate(keys)}
rows, cols, data = [], [], []
for r, s in enumerate(pats):
    for k, v in centroids[s].items():
        rows.append(r); cols.append(kidx[k]); data.append(float(int(round(v))))
M_rnd = sp.csr_matrix((data, (rows, cols)), shape=(len(pats), len(keys)))
rows2, data2 = [], []
for r, s in enumerate(pats):
    for k, v in centroids[s].items():
        rows2.append(r); data2.append(float(v))
M_raw = sp.csr_matrix((data2, (rows, cols)), shape=(len(pats), len(keys)))
Mc_rnd = M_rnd.tocsc(); Mc_raw = M_raw.tocsc()
class_key_count = np.asarray((M_rnd >= 1).sum(axis=1)).ravel()
tvec = np.array([pidx[t] for t in targets])

def scores(frac):
    cols_ = [kidx[k] for k in frac if k in kidx]
    qv = np.array([frac[keys[c]] for c in cols_], dtype=np.float64)
    subr = Mc_rnd[:, cols_].toarray()
    cost = (subr != qv[None, :]).sum(axis=1) + class_key_count - (subr >= 1).sum(axis=1)
    sub = Mc_raw[:, cols_].toarray()
    cont = np.minimum(sub, qv[None, :]).sum(axis=1) / max(qv.sum(), 1.0)
    return cost, cont, cols_, qv

hit6 = hit2 = hit6_loo = hit2_loo = singletons = 0
for r, n in enumerate(sample):
    f = fracs[r]; t = tvec[r]; s = targets[r]
    cost, cont, cols_, qv = scores(f)
    if int(np.argmin(cost)) == t: hit6 += 1
    if int(np.argmax(cont)) == t: hit2 += 1
    mem = members[s]
    if len(mem) <= 1:
        singletons += 1
        continue  # class vanishes under LOO: automatic miss
    acc, cnt = {}, 0
    for m in mem:
        if m == n: continue
        cnt += 1
        for k, c in neurons[m].items():
            acc[k] = acc.get(k, 0) + c
    loo = {k: v / cnt for k, v in acc.items()}
    loo_r = {k: int(round(v)) for k, v in loo.items()}
    A_ = sum(1 for c in cols_ if loo_r.get(keys[c], 0) != int(qv[list(cols_).index(c)])) if False else None
    # A_/B_ vs LOO centroid over frac keys
    A_ = 0
    for ci, c in enumerate(cols_):
        if loo_r.get(keys[c], 0) != int(qv[ci]): A_ += 1
    loo_key_count = sum(1 for v in loo_r.values() if v >= 1)
    B_ = loo_key_count - sum(1 for c in cols_ if loo_r.get(keys[c], 0) >= 1)
    cost_loo = cost.copy(); cost_loo[t] = A_ + B_
    if int(np.argmin(cost_loo)) == t: hit6_loo += 1
    cont_t = sum(min(loo.get(k, 0.0), float(f[k])) for k in f) / max(sum(f.values()), 1.0)
    cont_loo = cont.copy(); cont_loo[t] = cont_t
    if int(np.argmax(cont_loo)) == t: hit2_loo += 1

N = len(sample)
print(f'anchors: M6={hit6}/{N} M2={hit2}/{N} (expect 300 / 297)')
print(f'singleton targets in sample: {singletons} (auto-miss under LOO)')
print(f'LOO: M6 cheapest-encoding = {hit6_loo}/{N} = {100.0*hit6_loo/N:.1f}%')
print(f'LOO: M2 containment-raw   = {hit2_loo}/{N} = {100.0*hit2_loo/N:.1f}%')
print('DONE', flush=True)
