import os, sys, re, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gaea_common import DOCS

pats = {
    'python-None-word': re.compile(r'(?<![A-Za-z_`])None(?![A-Za-z_])'),
    'nan': re.compile(r'\bnan\b', re.I),
    'object-Object': re.compile(r'\[object Object\]'),
    'undefined': re.compile(r'\bundefined\b'),
    'empty-arrow': re.compile(r'→\s*`?\s*`?\s*$'),
    'trailing-tilde': re.compile(r'~$'),
    'always-true-guard': re.compile(r'always'),
}
for fn in ('nodes-reference.md', 'parameter-types.md', 'nodes-crosscheck.md'):
    p = os.path.join(DOCS, fn)
    txt = io.open(p, encoding='utf-8').read()
    lines = txt.splitlines()
    print('=' * 70)
    print(fn, len(lines), 'lines')
    # structural checks
    print('  fenced blocks (```):', sum(1 for l in lines if l.startswith('```')),
          '(must be even)')
    for name, rx in pats.items():
        hits = [i + 1 for i, l in enumerate(lines) if rx.search(l)]
        if hits:
            print(f'  {name}: {len(hits)} lines -> {hits[:6]}')
            for h in hits[:2]:
                print('      ', lines[h - 1][:150])
    # markdown table integrity in reference
    if fn == 'nodes-reference.md':
        bad = [i + 1 for i, l in enumerate(lines)
               if l.startswith('| ') and not l.rstrip().endswith('|')]
        print('  table rows not ending in "|":', len(bad), bad[:5])
        # every node must have a header row + separator + at least 1 data row
        idx = [i for i, l in enumerate(lines) if l.startswith('### ')]
        for k, i in enumerate(idx):
            end = idx[k + 1] if k + 1 < len(idx) else len(lines)
            blk = lines[i:end]
            hdr = [j for j, l in enumerate(blk) if l.startswith('| 参数 |')]
            if not hdr:
                print('  ! no param table in', lines[i])
                continue
            h = hdr[0]
            if not blk[h + 1].startswith('|---'):
                print('  ! missing separator in', lines[i])
            rows = [l for l in blk[h + 2:] if l.startswith('| ') and l.rstrip().endswith('|')]
            if not rows:
                print('  ! zero param rows in', lines[i])
    print('  OK')
