import os, sys, json, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *

cat = json.load(io.open(os.path.join(DOCS, 'nodes-catalog.json'), encoding='utf-8'))
by = {n['name']: n for n in cat['nodes']}

for nm in ('MultiFractal', 'Erosion2', 'WaveShine', 'Perlin'):
    n = by[nm]
    print('=' * 78)
    print(nm)
    print('  -- impl properties (declaration order, effective group) --')
    for p in n['implProperties']:
        print(f"    {p['name']:34} {p['csType']:16} disp={p['displayName']!r:26} "
              f"grp={p['group']!r:16} declHere={p['groupDeclaredHere']}")
    print('  -- Nodes.json entries (order, positional group) --')
    for p in n['parameters']:
        tag = '[GROUP]' if p['isGroup'] else p['type']
        m = p['implProperty']
        print(f"    {p['index']:3d} {p['name']!r:36} {str(tag):10} grp={p['group']!r:16} "
              f"link={m.get('match')} {m.get('propertyName') or m.get('ambiguousCandidates') or ''}")
