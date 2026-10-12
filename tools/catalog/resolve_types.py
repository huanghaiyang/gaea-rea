import json, io, re, os, subprocess, collections, sys

def readtext(path):
    """Read a text file, tolerating PowerShell redirection (UTF-16LE BOM) and UTF-8."""
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'utf-16', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')


ROOT = r'D:\sgames\gaea-rea'
EVD = os.path.join(ROOT, 'evidence', 'gdnodes')
ASM = r'D:\Gaea 2\Gaea.Nodes.dll'
EXE = os.path.join(ROOT, 'tools', 'GaeaDump', 'bin', 'Release', 'net8.0', 'GaeaDump.exe')
NODES = r'D:\Gaea 2\Resources\Nodes.json'

# ---- parse type inventory -------------------------------------------------
types = {}   # fullname -> dict(kind, methods, fields, props)
for line in readtext(os.path.join(EVD, 'all-types.txt')).splitlines():
    line = line.rstrip('\n')
    if not line.strip():
        continue
    parts = line.split('\t')
    if len(parts) < 5:
        continue
    full, kind, m, f, p = parts[0], parts[1], parts[2], parts[3], parts[4]
    types[full] = dict(
        kind=kind.split('=', 1)[1],
        methods=int(m.split('=', 1)[1]),
        fields=int(f.split('=', 1)[1]),
        props=int(p.split('=', 1)[1]),
    )
print('types parsed:', len(types))
print('kinds:', collections.Counter(t['kind'] for t in types.values()))

nodes = json.load(io.open(NODES, encoding='utf-8'))
node_names = [n['Name'] for n in nodes]

classes = {k: v for k, v in types.items() if v['kind'] in ('Class', 'Struct')}
simple = collections.defaultdict(list)
for full in classes:
    simple[full.rsplit('.', 1)[-1]].append(full)

def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

bynorm = collections.defaultdict(list)
for full in classes:
    bynorm[norm(full.rsplit('.', 1)[-1])].append(full)

resolved = {}
for nm in node_names:
    cands = []
    exact = f'QuadSpinner.Gaea.Nodes.{nm}'
    if nm in simple:
        cands = sorted(simple[nm], key=lambda f: (not f.startswith('QuadSpinner.Gaea.Nodes.'), len(f)))
    if not cands and norm(nm) in bynorm:
        cands = sorted(bynorm[norm(nm)], key=lambda f: (not f.startswith('QuadSpinner.Gaea.Nodes.'), len(f)))
    resolved[nm] = cands

missing = [nm for nm, c in resolved.items() if not c]
multi = {nm: c for nm, c in resolved.items() if len(c) > 1}
print('\nresolved (>=1 candidate):', sum(1 for c in resolved.values() if c))
print('unresolved:', len(missing), missing)
print('\nambiguous:', len(multi))
for nm, c in list(multi.items()):
    print('  ', nm, '->', c)

json.dump(resolved, open(os.path.join(EVD, 'resolved.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print('\nwrote resolved.json')
