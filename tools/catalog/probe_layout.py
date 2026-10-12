import json, io

p = r'D:\Gaea 2\Resources\Nodes.json'
nodes = json.load(io.open(p, encoding='utf-8'))
byname = {n['Name']: n for n in nodes}

for name in ('Erosion', 'Blur', 'Canyon'):
    n = byname[name]
    print('=' * 70)
    print(name, '|', n['Description'])
    for i, prm in enumerate(n['Flubs']):
        t = prm.get('Type')
        g = ' [GROUP]' if prm.get('IsGroup') else ''
        nv = ''
        if t == 'Enum':
            nv = ' values=' + str(len(prm.get('Flubs', [])))
        print(f'  {i:3d} {prm["Name"]!r:42} type={t!r}{g}{nv}')

# exact key order of a param that is a group vs a leaf
print()
print('group raw:', json.dumps(byname['Blur']['Flubs'][0], ensure_ascii=False))
print('leaf raw :', json.dumps(byname['Blur']['Flubs'][1], ensure_ascii=False))

# Does any node have >1 group and do groups look like they alternate?
gc = [(n['Name'], sum(1 for x in n['Flubs'] if x.get('IsGroup'))) for n in nodes]
print()
print('nodes with groups:', sum(1 for _, c in gc if c))
print('max groups in a node:', max(c for _, c in gc))
print('distribution:', sorted(((c, [nm for nm, cc in gc if cc == c]) for c in set(x for _, x in gc)), key=lambda t: -t[0])[:12])
