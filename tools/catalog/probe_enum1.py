import os, sys, json, io, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *

MEMBERS = parse_members(os.path.join(EVD, 'all-members.txt'))
NODES = {n['Name']: n for n in load_nodes()}

for tn, node, pname in [('QuadSpinner.Gaea.Nodes.AccumulatorType', 'Accumulator', 'Type'),
                        ('QuadSpinner.Gaea.Nodes.BlendMode', 'Combine', 'Mode'),
                        ('QuadSpinner.Gaea.Nodes.ApertureMode', 'Aperture', 'Mode')]:
    print('=' * 70)
    m = MEMBERS[tn]
    print(tn, '-> raw fields:')
    for t, n in m['fields']:
        print(f'    [{t}] {n}')
    print('  methods:', m['methods'])
    p = next(x for x in NODES[node]['Flubs'] if x['Name'] == pname)
    print(f"  Nodes.json {node}/{pname}: {len(p['Flubs'])} values")
    print('   ', [v['Name'] for v in p['Flubs']])
