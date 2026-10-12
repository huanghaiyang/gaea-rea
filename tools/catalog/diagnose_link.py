import os, sys, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *
from build_catalog import *

cat = json.load(io.open(os.path.join(DOCS, 'nodes-catalog.json'), encoding='utf-8'))
un = collections.Counter()
extras = collections.Counter()
amb = []
for n in cat['nodes']:
    for p in n['parameters']:
        if p['isGroup']:
            continue
        m = p['implProperty']
        if m.get('match') == 'no-matching-property':
            un[(p['name'], p['type'])] += 1
        elif m.get('match') == 'ambiguous':
            amb.append((n['name'], p['name'], m['ambiguousCandidates']))
    for e in n['coverage']['implPropertiesNotReferencedByNodesJson']:
        pr = next(x for x in n['implProperties'] if x['name'] == e)
        extras[(e, pr['csType'], bool(pr.get('parameterAttribute')))] += 1

print('=== unmatched Nodes.json params (top 45) ===')
for (nm, t), c in un.most_common(45):
    print(f'{c:4d}  {nm!r:44} type={t!r}')
print('distinct unmatched names:', len(un), 'total:', sum(un.values()))

print('\n=== ambiguous ===', len(amb))
for a in amb[:20]:
    print('  ', a)

print('\n=== impl properties NOT referenced by Nodes.json (top 45) ===')
for (nm, t, haspar), c in extras.most_common(45):
    print(f'{c:4d}  {nm!r:38} {t:16} hasParameter={haspar}')
print('distinct extras:', len(extras), 'total:', sum(extras.values()))
