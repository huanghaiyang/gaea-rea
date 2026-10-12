import re, sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import *

txt = readtext(os.path.join(EVD, 'Gaea.Nodes.whole.cs'))
lines = txt.splitlines()
print('lines:', len(lines))

# how are namespaces emitted?
for pat in (r'^namespace ', r'^internal ', r'^public ', r'^\[', r'^\}'):
    n = sum(1 for l in lines if re.match(pat, l))
    print(f'{pat!r:16} {n}')

print()
print('--- sample top-level declaration lines ---')
for i, l in enumerate(lines):
    if re.match(r'^(public|internal)\s+(sealed\s+|abstract\s+|static\s+|unsafe\s+)*(class|struct|enum|interface|delegate)\s', l):
        print(i, l[:110])
        if i > 3000:
            break
