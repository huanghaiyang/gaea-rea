import io, re, os

def readtext(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'utf-16', 'latin-1'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', 'replace')

P = r'D:\sgames\gaea-rea\evidence\gdnodes\engine-attr-members.txt'
txt = readtext(P)
blocks = {}
for b in re.split(r'(?m)^(?==== )', txt):
    m = re.match(r'=== (.+?) \((\w+)\) ===', b)
    if m:
        blocks[m.group(1)] = b

want = [
    'QuadSpinner.Gaea.Engine.Fx.NodeCategory',
    'QuadSpinner.Gaea.Engine.Fx.GroupType',
    'QuadSpinner.Gaea.Engine.Fx.Classification',
    'QuadSpinner.Gaea.Engine.Fx.PortType',
    'QuadSpinner.Gaea.Engine.Fx.ParameterAttribute',
    'QuadSpinner.Gaea.Engine.Fx.GroupAttribute',
    'QuadSpinner.Gaea.Engine.Fx.Parameters',
    'QuadSpinner.Gaea.Engine.Fx.OutputType',
    'QuadSpinner.Gaea.Engine.Fx.CommandAttribute',
]
for w in want:
    print('=' * 72)
    if w in blocks:
        print(blocks[w].strip())
    else:
        print('NOT FOUND', w)

print('=' * 72)
print('--- all types containing Toolbox ---')
for k in sorted(blocks):
    if 'Toolbox' in k:
        print(blocks[k].strip())
