// Determine two things the decompile cannot: the percent→pixel conversion of `Map.Blur(value)` and
// the border rule of the native blur.
//
// WHY
// `\uf55c\uf0ba\ue6d5.\ueb77\uf21d\ue95c(this Map, float)` divides the argument by a constant that
// overload resolution leaves ambiguous (int 601 vs float 40), then multiplies by the resolution.
// Rather than guess, blur an impulse through both entry points and match profiles. The border rule is
// read off a constant image: normalized blur + replicate/clamp keeps it constant, zero-padding darkens
// the rim.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PROBE = path.join(ROOT, 'tools', 'gaea-probe', 'bin', 'Release', 'net8.0', 'gaea-probe.dll');
const GAEA = 'D:\\Gaea 2';
const N = 128;
const C = N / 2;

const impulse = () => { const d = new Array(N * N).fill(0); d[C * N + C] = 1; return d; };
const constMap = () => new Array(N * N).fill(0.37);

const calls = [];
// percent entry point
for (const v of [0.5, 1, 2, 4, 8, 16]) {
  calls.push({ name: `pct_${v}`, type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95C', ret: 'Map', args: [{ t: 'map', w: N, h: N, data: impulse() }, { t: 'f32', v }] });
}
// direct pixel-radius entry point, fine grid
for (let p = 0.25; p <= 12.001; p += 0.25) {
  const key = p.toFixed(2);
  calls.push({ name: `px_${key}`, type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95D', ret: 'Map', args: [{ t: 'map', w: N, h: N, data: impulse() }, { t: 'f32', v: +p }] });
}
// border rule
calls.push({ name: 'const_blur', type: 'uF55CuF0BAuE6D5', method: 'uEB77uF21DuE95D', ret: 'Map', args: [{ t: 'map', w: N, h: N, data: constMap() }, { t: 'f32', v: 4 }] });

const spec = path.join(ROOT, 'tools', 'oracle-spec-blurpct.json');
const out = path.join(ROOT, 'evidence', 'oracle-blurpct.json');
fs.writeFileSync(spec, JSON.stringify({ calls }));
execFileSync('dotnet', [PROBE, GAEA, 'oracle', spec, out], { stdio: 'inherit' });
const res = JSON.parse(fs.readFileSync(out, 'utf8'));
if (!res.ok) { console.error(res.error); process.exit(1); }

const axis = (d) => { const o = []; for (let k = 0; k <= 24; k++) o.push(d[C * N + C + k]); return o; };
const rowSum = (d) => { let s = 0; for (let k = -40; k <= 40; k++) { const v = d[C * N + C + k]; if (v) s += v; } return s; };
const direct = new Map();
for (let p = 0.25; p <= 12.001; p += 0.25) direct.set(+p.toFixed(2), axis(res.calls[`px_${p.toFixed(2)}`].data));

for (const v of [0.5, 1, 2, 4, 8, 16]) {
  const d = res.calls[`pct_${v}`].data;
  const prof = axis(d).map((x) => x / rowSum(d));
  let best = { p: 0, err: 1e9 };
  for (const [p, ref] of direct.entries()) {
    const rr = ref.map((x) => x / rowSum(res.calls[`px_${p.toFixed(2)}`].data));
    let e = 0;
    for (let k = 0; k < 16; k++) e = Math.max(e, Math.abs(prof[k] - rr[k]));
    if (e < best.err) best = { p, err: e };
  }
  console.log(`percent ${v}: best pixel radius ${best.p} (err ${best.err.toExponential(2)})  -> divisor≈${(best.p / v).toFixed(3)}*N`);
}

const cb = res.calls.const_blur.data;
let mn = Infinity, mx = -Infinity;
for (const v of cb) { if (v < mn) mn = v; if (v > mx) mx = v; }
console.log(`constant map after blur: min=${mn} max=${mx} (edge rule)`);


