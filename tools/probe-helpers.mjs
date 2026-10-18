// Probe the obfuscated engine helpers with controlled arrays.
//
// WHY
// `\uf55c\uf0ba\ue6e5.\ue2b3` has two overloads -- `(float[], float[], int)` and `(float[], float, int)` --
// and its IL is Eazfuscator-mangled, so the body cannot be read reliably. This runs the real
// method on ramps/impulses and prints the exact outputs; the transfer function is then data, not
// inference. Same for the blur and the distinct `\ue2b4` blend.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PROBE = path.join(ROOT, 'tools', 'gaea-probe', 'bin', 'Release', 'net8.0', 'gaea-probe.dll');
const GAEA = 'D:\\Gaea 2';

const ramp = (n, lo = 0, hi = 1) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / Math.max(1, n - 1));
const f32arr = (v) => ({ t: 'f32arr', v });
const f32 = (v) => ({ t: 'f32', v });
const i32 = (v) => ({ t: 'i32', v });

const calls = [];
const add = (name, method, args) => calls.push({ name, type: 'uF55CuF0BAuE6E5', new: true, method, args });

// Curve application (single array, in place). `shape` reaches this method already multiplied by -10
// by Shaper, so probe both the raw values and the implied ones.
for (const shape of [-10, -5, -2, -1, -0.5, 0.5, 1, 2, 5, 10]) {
  add(`curve_${shape}`, 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32(shape), i32(4)]);
}
// Does the int matter? Same curve with a bogus n.
add('curve_n0', 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32(-5), i32(0)]);
add('curve_n1', 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32(-5), i32(1)]);

// Pair operation: (a, b, n) -> new array.
add('pair_ramp_ramp', 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32arr(ramp(16)), i32(4)]);
add('pair_ramp_inv', 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32arr(ramp(16, 1, 0)), i32(4)]);
add('pair_ramp_half', 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32arr(ramp(16, 0, 0.5)), i32(4)]);
add('pair_ramp_mean', 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32arr(Array(16).fill(0.5)), i32(4)]);
add('pair_ramp_far', 'uF70FuE6C9uE2B3', [f32arr(ramp(16)), f32arr(ramp(16, 0.3, 0.9)), i32(4)]);

// Blend: (a, b, n) -> new array.
add('blend_ramp_ramp', 'uF70FuE6C9uE2B4', [f32arr(ramp(16)), f32arr(ramp(16)), i32(4)]);
add('blend_ramp_inv', 'uF70FuE6C9uE2B4', [f32arr(ramp(16)), f32arr(ramp(16, 1, 0)), i32(4)]);
add('blend_ramp_mean', 'uF70FuE6C9uE2B4', [f32arr(ramp(16)), f32arr(Array(16).fill(0.5)), i32(4)]);

// Blur: impulse in the middle of a 7x7 field.
const impulse = Array(49).fill(0);
impulse[24] = 1;
calls.push({
  name: 'blur_imp_r2',
  type: 'uF55CuF0BAuE6DC',
  new: true,
  method: 'uF4C9uF065uF4E7',
  args: [f32arr(impulse), i32(7), f32(2), i32(5)],
});
calls.push({
  name: 'blur_imp_r1',
  type: 'uF55CuF0BAuE6DC',
  new: true,
  method: 'uF4C9uF065uF4E7',
  args: [f32arr(impulse), i32(7), f32(1), i32(5)],
});
calls.push({
  name: 'blur_ramp',
  type: 'uF55CuF0BAuE6DC',
  new: true,
  method: 'uF4C9uF065uF4E7',
  args: [f32arr(ramp(49)), i32(7), f32(2), i32(5)],
});

const specPath = path.join(ROOT, 'tools', 'oracle-spec-helpers.json');
const outPath = path.join(ROOT, 'evidence', 'oracle-helpers.json');
fs.writeFileSync(specPath, JSON.stringify({ calls }, null, 1));

execFileSync('dotnet', [PROBE, GAEA, 'oracle', specPath, outPath], { stdio: 'inherit' });

const res = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (!res.ok) { console.error(res.error); process.exit(1); }
const fmt = (a) => a.map((x) => x.toFixed(5)).join(' ');
for (const [name, r] of Object.entries(res.calls)) {
  if (r?.t === 'f32arr') console.log(`${name}:\n  ${fmt(r.data)}`);
  else if (r?.t === 'map') console.log(`${name}: ${r.w}x${r.h} ${fmt(r.data.slice(0, 32))} ...`);
  else console.log(name, JSON.stringify(r));
}
