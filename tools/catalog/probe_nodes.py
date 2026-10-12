import json, io, collections

p = r'D:\Gaea 2\Resources\Nodes.json'
nodes = json.load(io.open(p, encoding='utf-8'))
print('nodes:', len(nodes))

# Collect every distinct key across the whole tree and every (Type -> key-set) combo
keysets = collections.Counter()
types = collections.Counter()
depth_max = 0
leaf_examples = {}
type_leaf_examples = {}

def walk(params, depth, path):
    global depth_max
    depth_max = max(depth_max, depth)
    for prm in params:
        ks = tuple(sorted(prm.keys()))
        keysets[ks] += 1
        t = prm.get('Type', '<MISSING>')
        types[t] += 1
        leaf_examples.setdefault(t, (path + '/' + prm['Name'], ks))
        if 'Flubs' in prm and prm['Flubs']:
            walk(prm['Flubs'], depth + 1, path + '/' + prm['Name'])

for n in nodes:
    walk(n.get('Flubs', []), 0, n['Name'])

print('\nmax depth:', depth_max)
print('\n--- distinct parameter key-sets ---')
for ks, c in keysets.most_common():
    print(c, ks)
print('\n--- Type counts ---')
for t, c in types.most_common():
    print(f'{c:6d}  {t!r}')
print('\n--- first example per Type ---')
for t, ex in sorted(leaf_examples.items(), key=lambda kv: str(kv[0])):
    print(f'{t!r:14} {ex}')
print('\nnode name sample:', [n['Name'] for n in nodes][:20])
print('\nall node names:')
print(json.dumps([n['Name'] for n in nodes], ensure_ascii=False))
print('\ntop-level key sets:')
print(collections.Counter(tuple(sorted(n.keys())) for n in nodes))
