import os, subprocess, io, sys

ROOT = r'D:\sgames\gaea-rea'
EXE = os.path.join(ROOT, 'tools', 'GaeaDump', 'bin', 'Release', 'net8.0', 'GaeaDump.exe')
ASM = r'D:\Gaea 2\Gaea.Nodes.dll'
OUT = os.path.join(ROOT, 'evidence', 'gdnodes', 'constclasses')
os.makedirs(OUT, exist_ok=True)

targets = {'\ue0002': 'str_lookup', '\ue0003': 'num_lookup', '\ue0000' if False else '\ue000': 'root0'}

for tname, label in targets.items():
    p = subprocess.run([EXE, 'dump', ASM, tname], capture_output=True)
    txt = (p.stdout + b'\n' + p.stderr).decode('utf-8', 'replace')
    fp = os.path.join(OUT, label + '.cs')
    open(fp, 'w', encoding='utf-8').write(txt)
    print('=' * 70)
    print(label, repr(tname), '->', len(txt), 'chars')
    print('\n'.join(txt.splitlines()[:60]))
