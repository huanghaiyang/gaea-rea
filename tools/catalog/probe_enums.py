import os, sys, json, io, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *

CAT = json.load(io.open(os.path.join(DOCS, 'nodes-catalog.json'), encoding='utf-8'))
rows = []
for n in CAT['nodes']:
    idx = {x['name']: x for x in n['implProperties']}
    for p in n['parameters']:
        if p['isGroup'] or p['type'] != 'Enum':
            continue
        ip = p.get('implProperty') or {}
        impl = idx.get(ip.get('propertyName'))
        if not impl or not impl.get('enumTypeFull'):
            continue
        jc = len(p.get('enumValues') or [])
        rows.append((n['name'], p['name'], impl['enumTypeFull'], jc, impl['enumMemberCount'],
                     impl['csType'], ip.get('propertyName')))

diffs = collections.Counter()
for r in rows:
    diffs[r[4] - r[3]] += 1
print('resolved enums:', len(rows))
print('distribution of (assembly_count - json_count):', dict(diffs))
print()
print('sample 25:')
for r in rows[:25]:
    print(f'  {r[0]:<16} {r[1]:<26} {r[2]:<56} json={r[3]:3d} asm={r[4]:3d} prop={r[6]}')
print()
# unresolved
unres = [(n['name'], p['name'], (p.get('implProperty') or {}))
         for n in CAT['nodes'] for p in n['parameters']
         if not p['isGroup'] and p['type'] == 'Enum'
         and not (next((x for x in n['implProperties']
                        if x['name'] == (p.get('implProperty') or {}).get('propertyName')), {}) or {}).get('enumTypeFull')]
print('enum params WITHOUT resolved enum type:', len(unres))
for u in unres[:12]:
    print('   ', u[0], '/', u[1], u[2].get('propertyName'), u[2].get('match'))
