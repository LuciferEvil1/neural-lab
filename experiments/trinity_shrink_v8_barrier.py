#!/usr/bin/env python3
"""v8 — BARRIER + TRACKER measurement (Ahkeem's refinement, Oct 30:
barriers recorded lightly, a tracker embedded, the system RECOGNIZES,
then strips the recognized thing of its charge).

Question 1 (uniqueness): is the barrier itself a tracker? Signature of a
record = its sealed extent. Measured across all 129,351 neuron records
and all 112,710 pattern classes:
  SIG-A: (entry count, total charge)
  SIG-B: SIG-A + quark share profile (Q=4 contiguous charge bands,
         shares rounded to 3 decimals)
Question 2 (recognition): a fracture arrives WITH its barrier (kept in
the light registry, per his design — identification no longer computed
from content alone). Candidates = records whose signature matches the
barrier; recognition = exactly one candidate whose full fingerprint
contains the fracture exactly. Same seed-783 sample + fracture draws as
the v6c sweep; severities 30/50/70/90%.
The charge-strip on recognition is a state operation, not a statistic —
recorded as design, not measured here.
"""
import hashlib, math, random
from collections import defaultdict
import numpy as np
import pandas as pd

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

def sig_of(fp, with_shares):
    n = len(fp)
    tot = sum(fp.values())
    if not with_shares:
        return (n, tot)
    order = sorted(fp.items(), key=lambda kv: -kv[1])
    qs = [0, 0, 0, 0]
    for rank, (k, v) in enumerate(order):
        qs[min(3, (rank * 4) // max(n, 1))] += v
    return (n, tot, tuple(round(x / tot, 3) if tot else 0.0 for x in qs))

for with_shares, name in ((False, 'SIG-A (entries, total charge)'),
                          (True, 'SIG-B (+ quark shares)')):
    cnt = defaultdict(int)
    for n in ids:
        cnt[sig_of(neurons[n], with_shares)] += 1
    uniq = sum(1 for n in ids if cnt[sig_of(neurons[n], with_shares)] == 1)
    print(f'NEURON records {name}: unique for {uniq}/{len(ids)} = {100.0*uniq/len(ids):.2f}% of records', flush=True)
    ccnt = defaultdict(int)
    cents = {}
    for s in pats:
        acc = {}
        for n in members[s]:
            for k, c in neurons[n].items():
                acc[k] = acc.get(k, 0) + c
        cents[s] = {k: v / len(members[s]) for k, v in acc.items()}
        ccnt[sig_of(cents[s], with_shares)] += 1
    cuniq = sum(1 for s in pats if ccnt[sig_of(cents[s], with_shares)] == 1)
    print(f'CLASS records  {name}: unique for {cuniq}/{len(pats)} = {100.0*cuniq/len(pats):.2f}% of classes', flush=True)

# recognition index on SIG-B (the fuller tracker)
index = defaultdict(list)
for n in ids:
    index[sig_of(neurons[n], True)].append(n)

random.seed(783)
cands = [n for n in ids if len(neurons[n]) >= 20]
sampleA = random.sample(cands, 300)

def make_fracs(sample, p, seed=783):
    random.seed(seed)
    out = []
    for n in sample:
        orig = dict(neurons[n])
        ks = list(orig)
        drop = set(random.sample(ks, max(1, int(p * len(ks)))))
        out.append({k: c for k, c in orig.items() if k not in drop})
    return out

for p in (0.3, 0.5, 0.7, 0.9):
    fracs = make_fracs(sampleA, p)
    rec = wrong = multi = 0
    cand_counts = []
    for r, n in enumerate(sampleA):
        f = fracs[r]
        cands_ = index[sig_of(neurons[n], True)]
        cand_counts.append(len(cands_))
        consistent = [m for m in cands_
                      if all(neurons[m].get(k) == c for k, c in f.items())]
        if len(consistent) == 1:
            if consistent[0] == n: rec += 1
            else: wrong += 1
        elif len(consistent) > 1:
            multi += 1
    N = len(sampleA)
    print(f'deletion {int(p*100)}%: recognized uniquely+correctly {rec}/{N} = {100.0*rec/N:.1f}%  '
          f'unique-but-wrong {wrong}  still-ambiguous {multi}  mean barrier candidates {np.mean(cand_counts):.2f}', flush=True)
print('DONE', flush=True)
