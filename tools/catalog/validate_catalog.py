"""Validate docs/nodes-catalog.json against the task specification."""
import os, sys, json, io, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *

cat = json.load(io.open(os.path.join(DOCS, 'nodes-catalog.json'), encoding='utf-8'))
nodes = cat['nodes']
src = load_nodes()
src_names = [n['Name'] for n in src]

fails = []
ok = []


def need(cond, msg):
    (ok if cond else fails).append(msg)


need(len(nodes) == 182, f'182 node records (got {len(nodes)})')
need([n['name'] for n in nodes] == src_names, 'node names and order match Nodes.json exactly')

REQ = ('name', 'description', 'parameters', 'implType', 'implProperties', 'category',
       'portHint', 'confidence')
for n in nodes:
    for k in REQ:
        if k not in n:
            fails.append(f"{n['name']}: missing key {k}")
    if not n['implType']:
        fails.append(f"{n['name']}: implType is null")
    # parameter shape
    for p in n['parameters']:
        for k in ('name', 'description', 'type', 'isGroup', 'enumValues', 'nested', 'implProperty'):
            if k not in p:
                fails.append(f"{n['name']}/{p.get('name')}: param missing {k}")
        if p['type'] == 'Enum' and not p.get('enumValues'):
            fails.append(f"{n['name']}/{p['name']}: Enum without enumValues")
        if p['type'] != 'Enum' and not p['isGroup'] and p.get('enumValues') is not None:
            fails.append(f"{n['name']}/{p['name']}: non-Enum with enumValues")
    # group nesting closure
    gidx = {g['name'] for g in n['parameters'] if g['isGroup']}
    for g in n['parameters']:
        if g['isGroup'] and g['nested'] is not None:
            for i in g['nested']:
                if i >= len(n['parameters']) or n['parameters'][i]['isGroup']:
                    fails.append(f"{n['name']}/{g['name']}: bad nested index {i}")
    # implProperties shape
    for x in n['implProperties']:
        for k in ('name', 'csType', 'gaeaType', 'displayName', 'group'):
            if k not in x:
                fails.append(f"{n['name']}/{x.get('name')}: implProperty missing {k}")
    # confidence labels
    conf = n['confidence']
    for k in ('name', 'description', 'parameters', 'implType', 'implProperties'):
        if conf.get(k) != 'observed':
            fails.append(f"{n['name']}: confidence.{k} != observed")
    if conf.get('portHint') != 'inferred':
        fails.append(f"{n['name']}: confidence.portHint != inferred")

# totals
tc = collections.Counter()
for n in nodes:
    for p in n['parameters']:
        tc[p['type'] if not p['isGroup'] else '<group>'] += 1
print('top-level census from catalog:')
for k, v in tc.most_common():
    print(f'  {v:6d}  {k}')
print()
print('nodes:', len(nodes))
print('checks passed:', len(ok))
print('FAILURES:', len(fails))
for f in fails[:40]:
    print('  !', f)

# sanity: no markdown/format placeholder leaked
bad = [n['name'] for n in nodes if 'TODO' in json.dumps(n) or 'None' == n['category']]
print('placeholder leaks:', bad[:5])
print('nodes with category:', sum(1 for n in nodes if n['category']))
print('nodes with portHint confidence inferred:',
      sum(1 for n in nodes if n['portHint'].get('confidence') == 'inferred'))
print('nodes with variableInputs:', sum(1 for n in nodes if n['portHint'].get('variableInputs')))
print('nodes with extra ctor ports:', sum(1 for n in nodes if n['portHint'].get('extraInputsInCtor')))
