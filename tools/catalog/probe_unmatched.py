import os, sys, json, io, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *
from parse_module import parse_module
from build_catalog import RECS, attr_map, one as _one

cat = json.load(io.open(os.path.join(DOCS, 'nodes-catalog.json'), encoding='utf-8'))
un = ['Version', 'Q 0', 'Q 1', 'ExtraDepositionBoost', 'Accuracy', 'Convert']
for n in cat['nodes']:
    for p in n['parameters']:
        if not p['isGroup'] and p['name'] in un and p['implProperty'].get('match') == 'no-matching-property':
            print('=' * 74)
            print(f"node={n['name']}  impl={n['implType']}  param={p['name']!r} type={p['type']} grp={p['group']!r}")
            print('  desc:', p['description'][:100])
            rec = RECS[n['implType']]
            print('  fields:', [f['name'] for f in rec['fields']])
            print('  properties:', [(x['name'], x['csType']) for x in rec['properties']])
            print('  class attrs:', [(a[0], a[1]) for a in rec['attributes']])
            # any method with Command attribute?
            for ln in range(rec['line'], rec['line'] + 400):
                pass
