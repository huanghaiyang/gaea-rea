// Probe the Map range helpers (`Normalize`, `Autolevel`, 2-arg range op) with a known ramp.
//
// WHY
// The decompiled bodies use Eazfuscator control-flow obfuscation (`goto IL_xxxx`, bogus branches), so
// "subtract the low bound, then clamp" is a guess. Running the real methods on a linear ramp shows
// the mapping directly: where 0.0 and 1.0 land, and whether the result is clamped or rescaled.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PROBE = path.join(ROOT, 'tools', 'gaea-probe', 'bin', 'Release', 'net8.0', 'gaea-probe.dll');
const GAEA = 'D:\\Gaea 2';
const N = 16;
const ramp = Array.from({ length: N * N }, (_, i) => i / (N * N - 1)); // 0 .. 1
const mapArg = { t: 'map', w: N, h: N, data: ramp };

const calls = [
  { name: 'normalize_5', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95C', ret: 'Map', args: [mapArg, { t: 'f32', v: 0.2 }, { t: 'f32', v: 0.8 }, { t: 'f32', v: 10 }, { t: 'f32', v: 20 }] },
  { name: 'normalize_5b', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95C', ret: 'Map', args: [mapArg, { t: 'f32', v: 0.8 }, { t: 'f32', v: 0.2 }, { t: 'f32', v: 1 }, { t: 'f32', v: 0 }] },
  { name: 'autolevel', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE961', ret: 'Map', args: [mapArg] },
  { name: 'range_2', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95E', ret: 'Map', args: [mapArg, { t: 'f32', v: 0.3 }, { t: 'f32', v: 0.7 }] },
  { name: 'range_1_default', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95E', ret: 'Map', args: [mapArg] },
  { name: 'drop', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95F', ret: 'Map', args: [mapArg] },
  { name: 'stats_pair', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95F', ret: 'Map', args: [mapArg] },
];

const specPath = path.join(ROOT, 'tools', 'oracle-spec-range.json');
const outPath = path.join(ROOT, 'evidence', 'oracle-range.json');
fs.writeFileSync(specPath, JSON.stringify({ calls }));
execFileSync('dotnet', [PROBE, GAEA, 'oracle', specPath, outPath], { stdio: 'inherit' });
const res = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (!res.ok) { console.error(res.error); process.exit(1); }
console.log('input:', ramp.map((v) => v.toFixed(4)).join(' '));
for (const [name, r] of Object.entries(res.calls)) {
  if (r?.t === 'map') console.log(`${name}:`, r.data.map((v) => v.toFixed(5)).join(' '));
  else console.log(name, JSON.stringify(r));
}
