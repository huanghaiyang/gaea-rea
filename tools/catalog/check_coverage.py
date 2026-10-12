import os, sys, json, collections, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *
from parse_module import parse_module

recs = parse_module(os.path.join(EVD, 'Gaea.Nodes.whole.cs'))
resolved = json.load(io.open(os.path.join(EVD, 'resolved.json'), encoding='utf-8'))

cands = set()
for nm, c in resolved.items():
    cands.update(c)
print('candidate types:', len(cands))
missing = sorted(c for c in cands if c not in recs)
print('candidates NOT in parsed records:', len(missing))
for m in missing:
    print('   ', m)

# which candidates look like real node classes (have [Toolbox])
with_toolbox = [f for f in cands if f in recs and any(a and a[0] == 'Toolbox' for a in recs[f]['attributes'])]
print('\ncandidates WITH [Toolbox]:', len(with_toolbox))

nodes = load_nodes()
names = [n['Name'] for n in nodes]
notb = []
for nm in names:
    ok = [c for c in resolved[nm] if c in with_toolbox]
    if not ok:
        notb.append((nm, resolved[nm]))
print('node names with NO [Toolbox] candidate:', len(notb))
for nm, c in notb:
    print('   ', nm, '->', c)
    for cc in c:
        if cc in recs:
            print('        attrs:', [(a[0], a[1][:2]) for a in recs[cc]['attributes']],
                  'base=', recs[cc]['base'], 'props=', len(recs[cc]['properties']))
