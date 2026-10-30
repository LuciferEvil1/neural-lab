#!/usr/bin/env python3
"""v7b — QUARKS matcher, contiguous-band decomposition (Ahkeem's function, named + specified Oct 30 13:36:
Quarks 'store the holes info and glue the charge states together so that
they read the self neglected read of their mass once fused so they dont
miss their own mass simultaneously reading the other half of the fused
charge and mass').

Construction (staff translation, labeled as such):
- Each sealed class is decomposed into Q=4  # v7b: contiguous charge bands (was round-robin in v7) QUARKS: its centroid keys are
  sorted by charge (centroid syn_count) descending and dealt round-robin,
  so every quark carries a representative slice of the pattern's charge.
- The GLUE record per class: each quark's share of the class's total
  charge (s_q). The shares are the stored hole info — they say what the
  fused partners hold, i.e. the shape of the mass that is NOT in a given
  quark.
- A fracture is read FUSED, three scores reported separately:
  Q1 glue-weighted containment: per quark, containment of the surviving
     entries; quarks fused with weights s_q (a fully-holed quark is
     skipped and the weights renormalize — its absence is expected, its
     share is read from the glue, not charged as damage).
  Q2 hole read (share-profile likelihood): sum over quarks of the
     surviving charge mass in that quark times ln(s_q) — how well the
     distribution of what SURVIVED (and therefore the shape of the hole)
     matches the glue's predicted shares.
  Q3 fused: Q1 minus the L1 distance between the observed share profile
     and the glue profile.
Anchors M2 (containment) and M6 (cheapest-encoding) recomputed on the
IDENTICAL fractures as the v6c sweep (same seed procedure), so numbers
compare line-for-line with the sweep table.
"""
import hashlib, math, random
import numpy as np
import pandas as pd
import scipy.sparse as sp

DATA = '/home/hatch/workspace/fly-brain/'
Q = 4
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
P, K = len(pats), len(keys)

# centroid matrices + quark-id matrix + glue shares
rows, cols, dv, dr, dq = [], [], [], [], []
shares = np.zeros((P, Q), dtype=np.float64)
for r, s in enumerate(pats):
    cen = centroids[s]
    order = sorted(cen.items(), key=lambda kv: -kv[1])
    tot = sum(cen.values()) or 1.0
    qsum = np.zeros(Q)
    n_keys = len(order)
    for rank, (k, v) in enumerate(order):
        qq = min(Q - 1, (rank * Q) // max(n_keys, 1))
        rows.append(r); cols.append(kidx[k]); dv.append(float(v)); dr.append(float(int(round(v)))); dq.append(qq)
        qsum[qq] += v
    shares[r] = qsum / tot
M_raw = sp.csr_matrix((dv, (rows, cols)), shape=(P, K))
M_rnd = sp.csr_matrix((dr, (rows, cols)), shape=(P, K))
QID = sp.csr_matrix((np.array(dq, dtype=np.int8), (rows, cols)), shape=(P, K))
Mc_raw = M_raw.tocsc(); Mc_rnd = M_rnd.tocsc(); QIDc = QID.tocsc()
class_key_count = np.asarray((M_rnd >= 1).sum(axis=1)).ravel()
print(f'library + quark decomposition ready: {P} patterns, Q={Q}', flush=True)

def make_fracs(sample, p, seed=783):
    random.seed(seed)
    out = []
    for n in sample:
        orig = dict(neurons[n])
        ks = list(orig)
        drop = set(random.sample(ks, max(1, int(p * len(ks)))))
        out.append({k: c for k, c in orig.items() if k not in drop})
    return out

random.seed(783)
cands = [n for n in ids if len(neurons[n]) >= 20]
sampleA = random.sample(cands, 300)
tvec = np.array([pidx[pat_of[n]] for n in sampleA])
ln_shares = np.log(np.maximum(shares, 1e-9))

for p in (0.3, 0.5, 0.7, 0.9):
    fracs = make_fracs(sampleA, p)
    h = dict(M2=0, M6=0, Q1=0, Q2=0, Q3=0)
    for r, f in enumerate(fracs):
        cols_ = [kidx[k] for k in f if k in kidx]
        qv = np.array([f[keys[c]] for c in cols_], dtype=np.float64)
        sub = Mc_raw[:, cols_].toarray()
        minv = np.minimum(sub, qv[None, :])
        cont = minv.sum(axis=1) / max(qv.sum(), 1.0)
        if int(np.argmax(cont)) == tvec[r]: h['M2'] += 1
        subr = Mc_rnd[:, cols_].toarray()
        cost = (subr != qv[None, :]).sum(axis=1) + class_key_count - (subr >= 1).sum(axis=1)
        if int(np.argmin(cost)) == tvec[r]: h['M6'] += 1
        qid = QIDc[:, cols_].toarray()
        den = np.zeros((P, Q)); num = np.zeros((P, Q))
        for qq in range(Q):
            m = (qid == qq)
            den[:, qq] = (m * qv[None, :]).sum(axis=1)
            num[:, qq] = (m * minv).sum(axis=1)
        tot_frac = max(qv.sum(), 1e-9)
        obs_share = den / tot_frac
        alive = den > 0
        with np.errstate(divide='ignore', invalid='ignore'):
            cont_q = np.where(alive, num / np.maximum(den, 1e-9), 0.0)
        w = np.where(alive, shares, 0.0)
        wsum = w.sum(axis=1); wsum[wsum == 0] = 1.0
        q1 = (w * cont_q).sum(axis=1) / wsum
        q2 = (den * ln_shares).sum(axis=1)
        q3 = q1 - np.abs(obs_share - shares).sum(axis=1)
        if int(np.argmax(q1)) == tvec[r]: h['Q1'] += 1
        if int(np.argmax(q2)) == tvec[r]: h['Q2'] += 1
        if int(np.argmax(q3)) == tvec[r]: h['Q3'] += 1
    N = len(fracs)
    print(f'severity {int(p*100)}%: ' + '  '.join(f'{k}={v} ({100.0*v/N:.1f}%)' for k, v in h.items()), flush=True)
print('DONE', flush=True)
