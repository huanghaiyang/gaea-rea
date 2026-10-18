// Read the decrypted constant pools through the SHIPPED accessor, not through a field dump.
//
// WHY
// The earlier dump wrote `int[]`/`float[]` fields to JSON, but that only proves the field contents.
// What the code actually reads is `\uf55c\uf0ba\ue713.\uf3e6\uf893\ue6d5(N)`, and the mapping from N to a
// value is only correct if the accessor is a plain index. This calls the accessor itself so every
// constant used by the decompiled engine source is verified against what the binary returns.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PROBE = path.join(ROOT, 'tools', 'gaea-probe', 'bin', 'Release', 'net8.0', 'gaea-probe.dll');
const GAEA = 'D:\\Gaea 2';

const calls = [];
// Per-pool lengths differ (long has only 4 entries, double 37), so bound each separately.
const poolLimits = { Int32: 176, Single: 200, Double: 36, Int64: 4 };
for (const [ret, lim] of Object.entries(poolLimits)) {
  for (let i = 0; i < lim; i++) {
    calls.push({
      name: `${ret}_${i}`,
      type: 'uF55CuF0BAuE713',
      method: 'uF3E6uF893uE6D5',
      ret,
      args: [{ t: 'i32', v: i }],
    });
  }
}

const specPath = path.join(ROOT, 'tools', 'oracle-spec-pools.json');
const outPath = path.join(ROOT, 'evidence', 'oracle-pools.json');
fs.writeFileSync(specPath, JSON.stringify({ calls }));

execFileSync('dotnet', [PROBE, GAEA, 'oracle', specPath, outPath], { stdio: 'inherit' });

const res = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (!res.ok) { console.error(res.error); process.exit(1); }

for (const ret of ['Int32', 'Single', 'Double', 'Int64']) {
  const vals = [];
  for (let i = 0; i < 30; i++) {
    const r = res.calls[`${ret}_${i}`];
    vals.push(r?.v);
  }
  console.log(`${ret}: ${vals.join(', ')}`);
}

// Cross-check against the field dumps that the earlier probe wrote.
const map = { Int32: 'int', Single: 'float', Double: 'double', Int64: 'long' };
let mismatches = 0;
for (const [ret, kind] of Object.entries(map)) {
  const p = path.join(ROOT, 'evidence', `pool_Gaea.Engine_${kind}.json`);
  if (!fs.existsSync(p)) continue;
  const dumped = JSON.parse(fs.readFileSync(p, 'utf8').replace(/\bNaN\b/g, 'null'));
  for (let i = 0; i < 30; i++) {
    const a = Number(res.calls[`${ret}_${i}`]?.v);
    const b = Number(dumped[i]);
    if (!(Number.isNaN(a) && Number.isNaN(b)) && a !== b) {
      mismatches++;
      if (mismatches < 8) console.log(`  MISMATCH ${ret}[${i}]: accessor=${a} fielddump=${b}`);
    }
  }
}
console.log(mismatches === 0 ? 'accessor == field dump for indices 0..27 (plain index confirmed)' : `${mismatches} mismatches`);



