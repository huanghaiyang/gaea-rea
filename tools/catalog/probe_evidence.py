import json, io, sys

p = r'D:\sgames\gaea-rea\evidence\managed-artifact-Gaea.Nodes.json'
raw = open(p, 'rb').read()
print('first bytes:', raw[:4])
for enc in ('utf-8-sig', 'utf-16', 'utf-16-le', 'utf-8'):
    try:
        d = json.loads(raw.decode(enc))
        print('decoded with', enc)
        break
    except Exception as e:
        print(enc, 'failed', e)
else:
    sys.exit(1)

def shape(o, depth=0, key=''):
    pad = '  ' * depth
    if isinstance(o, dict):
        print(f'{pad}{key} dict({len(o)}) keys={list(o)[:14]}')
        if depth < 2:
            for k, v in list(o.items())[:14]:
                shape(v, depth + 1, k + ': ')
    elif isinstance(o, list):
        print(f'{pad}{key} list({len(o)})')
        if o and depth < 2:
            shape(o[0], depth + 1, '[0] ')
    else:
        print(f'{pad}{key} {type(o).__name__} {str(o)[:70]}')

shape(d)
