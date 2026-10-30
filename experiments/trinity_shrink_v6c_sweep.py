#!/usr/bin/env python3
"""v6c — robustness sweep after the v6b discovery (all 300 standard
sample targets are singleton classes). Two questions:
  A) SEVERITY: same 300 neurons, deletion at 30/50/70/90% — where does
     each matcher actually break? (M0 cosine / M2 containment / M6 cost)
  B) GENERALIZATION: neurons whose class has >= 2 members (the fracture
     must be matched to a pattern built from OTHER neurons too), 30%
     deletion, same three matchers.
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
pidx = {s: i for i, s in enumerate(pats)}
keys = sorted({k for s in pats for k in centroids[s]})
kidx = {k: i for i, k in enumerate(keys)}
rows, cols, dr, dv = [], [], [], []
for r, s in enumerate(pats):
    for k, v in centroids[s].items():
        rows.append(r); cols.append(kidx[k]); dr.append(float(int(round(v)))); dv.append(float(v))
M_rnd = sp.csr_matrix((dr, (rows, cols)), shape=(len(pats), len(keys)))
M_raw = sp.csr_matrix((dv, (rows, cols)), shape=(len(pats), len(keys)))
nrm = np.sqrt(M_raw.multiply(M_raw).sum(axis=1)).A1; nrm[nrm == 0] = 1.0
Mn = M_raw.multiply(1.0 / nrm[:, None]).tocsr()
Mc_rnd = M_rnd.tocsc(); Mc_raw = M_raw.tocsc()
class_key_count = np.asarray((M_rnd >= 1).sum(axis=1)).ravel()
print(f'library ready: {len(pats)} patterns', flush=True)

def run(sample, targets, fracs, label):
    tvec = np.array([pidx[t] for t in targets])
    h0 = h2 = h6 = 0
    for r, f in enumerate(fracs):
        cols_ = [kidx[k] for k in f if k in kidx]
        qv = np.array([f[keys[c]] for c in cols_], dtype=np.float64)
        qn = qv / max(np.linalg.norm(qv), 1e-9)
        cos = (Mn[:, cols_] @ qn)
        cos = np.asarray(cos).ravel()
        if int(np.argmax(cos)) == tvec[r]: h0 += 1
        sub = Mc_raw[:, cols_].toarray()
        cont = np.minimum(sub, qv[None, :]).sum(axis=1) / max(qv.sum(), 1.0)
        if int(np.argmax(cont)) == tvec[r]: h2 += 1
        subr = Mc_rnd[:, cols_].toarray()
        cost = (subr != qv[None, :]).sum(axis=1) + class_key_count - (subr >= 1).sum(axis=1)
        if int(np.argmin(cost)) == tvec[r]: h6 += 1
    N = len(sample)
    print(f'{label}: N={N}  M0={h0} ({100.0*h0/N:.1f}%)  M2={h2} ({100.0*h2/N:.1f}%)  M6={h6} ({100.0*h6/N:.1f}%)', flush=True)

def make_fracs(sample, p, seed=783):
    random.seed(seed)
    fracs = []
    for n in sample:
        orig = dict(neurons[n])
        ks = list(orig)
        drop = set(random.sample(ks, max(1, int(p * len(ks)))))
        fracs.append({k: c for k, c in orig.items() if k not in drop})
    return fracs

# A) severity sweep — the standard sample (seed 783 draw)
random.seed(783)
cands = [n for n in ids if len(neurons[n]) >= 20]
sampleA = random.sample(cands, 300)
tgA = [pat_of[n] for n in sampleA]
for p in (0.3, 0.5, 0.7, 0.9):
    run(sampleA, tgA, make_fracs(sampleA, p), f'A severity {int(p*100)}% deletion')

# B) multi-member classes
candsB = [n for n in ids if len(neurons[n]) >= 20 and len(members[pat_of[n]]) >= 2]
print(f'multi-member candidates: {len(candsB)}', flush=True)
random.seed(783)
sampleB = random.sample(candsB, min(300, len(candsB)))
tgB = [pat_of[n] for n in sampleB]
sizes = [len(members[t]) for t in tgB]
print(f'B sample class sizes: min={min(sizes)} median={int(np.median(sizes))} max={max(sizes)}', flush=True)
run(sampleB, tgB, make_fracs(sampleB, 0.3), 'B multi-member 30% deletion')
print('DONE', flush=True)
