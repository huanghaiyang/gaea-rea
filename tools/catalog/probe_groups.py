import json, io, collections

p = r'D:\Gaea 2\Resources\Nodes.json'
nodes = json.load(io.open(p, encoding='utf-8'))

# 1. Are the 126 Type-missing params exactly the IsGroup ones?
miss = []
groups = []
depth0_leaves = []
enums = []
for n in nodes:
    for prm in n['Flubs']:
        t = prm.get('Type')
        if t is None:
            miss.append((n['Name'], prm['Name'], prm.get('IsGroup')))
        if prm.get('IsGroup'):
            groups.append((n['Name'], prm['Name']))
        if t == 'Enum':
            enums.append((n['Name'], prm['Name'], len(prm.get('Flubs', []))))

print('missing-Type count :', len(miss))
print('IsGroup count       :', len(groups))
print('missing-Type NOT IsGroup:', [m for m in miss if not m[2]])
print('IsGroup NOT missing-Type:', [g for g in groups if not any(m[0] == g[0] and m[1] == g[1] for m in miss)])
print('sample groups:', groups[:25])
print()
print('depth-0 total params:', sum(len(n['Flubs']) for n in nodes))
print('enum params:', len(enums))
print('zero-value enums:', [e for e in enums if e[2] == 0])
print('enum with single value:', [e for e in enums if e[2] == 1][:20])

# 2. Enum name duplicates across nodes? Which enum type name could each map to
print()
print('nodes with zero params:', [n['Name'] for n in nodes if not n.get('Flubs')])
print('nodes with empty Flubs list:', [n['Name'] for n in nodes if n.get('Flubs') == []])
print('nodes missing Flubs key:', [n['Name'] for n in nodes if 'Flubs' not in n])
print()
print('descriptions empty:', sum(1 for n in nodes if not n.get('Description')))
for n in nodes:
    if not n.get('Description'):
        print('   no-desc node:', n['Name'])
