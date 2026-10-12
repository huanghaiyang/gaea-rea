import json, io, os, re, subprocess, sys, time, collections

ROOT = r'D:\sgames\gaea-rea'
EVD = os.path.join(ROOT, 'evidence', 'gdnodes')
ASM = r'D:\Gaea 2\Gaea.Nodes.dll'
EXE = os.path.join(ROOT, 'tools', 'GaeaDump', 'bin', 'Release', 'net8.0', 'GaeaDump.exe')
OUTDIR = os.path.join(EVD, 'decompiled')
os.makedirs(OUTDIR, exist_ok=True)

resolved = json.load(io.open(os.path.join(EVD, 'resolved.json'), encoding='utf-8'))

wanted = set()
for nm, cands in resolved.items():
    for c in cands:
        wanted.add(c)
wanted = sorted(wanted)
print('candidate types to decompile:', len(wanted))

# reuse cache
manifest = {}
mpath = os.path.join(OUTDIR, 'manifest.json')
if os.path.exists(mpath):
    manifest = json.load(io.open(mpath, encoding='utf-8'))

def safe(full):
    return re.sub(r'[^A-Za-z0-9_.]', '_', full) + '.cs'

def run(args):
    """GaeaDump writes `memb`/`types` to stdout but `dump` (decompiled C#) to stderr."""
    p = subprocess.run([EXE] + args, capture_output=True)
    out = p.stdout.decode('utf-8', 'replace')
    err = p.stderr.decode('utf-8', 'replace')
    return out + '\n' + err, err

t0 = time.time()
done = 0
for full in wanted:
    fn = safe(full)
    fp = os.path.join(OUTDIR, fn)
    if os.path.exists(fp) and manifest.get(full, {}).get('ok'):
        continue
    out, err = run(['dump', ASM, full])
    # the filter is a substring match: keep only the exact type's block
    blocks = re.split(r'(?m)^(?==== )', out)
    keep = None
    for b in blocks:
        m = re.match(r'=== (.+?) \((\w+)\) ===', b)
        if m and m.group(1) == full:
            keep = b
            break
    ok = keep is not None
    open(fp, 'w', encoding='utf-8').write(keep if ok else '')
    manifest[full] = dict(ok=ok, file=fn, err=err.strip()[:200])
    done += 1
    if not ok:
        print('  FAIL', full, err.strip()[:120])

json.dump(manifest, open(mpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'decompiled {done} new in {time.time()-t0:.1f}s; total manifest={len(manifest)}')
print('ok:', sum(1 for v in manifest.values() if v['ok']), 'fail:', sum(1 for v in manifest.values() if not v['ok']))
for k, v in manifest.items():
    if not v['ok']:
        print('  FAILED:', k, v['err'][:150])
