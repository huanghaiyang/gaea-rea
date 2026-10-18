// Reverse-engineer the native `Map.Blur` kernel with impulse responses.
//
// WHY
// `Map.Blur` is a P/Invoke into Gaea.Native.dll, and it feeds ~15 nodes (Profiles.GraphicEQ,
// Texturize.Soil2, FilterCore.FilterProcess, Peaks/Sharpen/Denoise...). Reading IL cannot tell us the
// kernel; an impulse can. Each radius gets a single-pixel spike, and the response profile shows
// whether it is a Gaussian, what sigma it uses, and whether it is separable / normalised.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const PROBE = path.join(ROOT, 'tools', 'gaea-probe', 'bin', 'Release', 'net8.0', 'gaea-probe.dll');
const GAEA = 'D:\\Gaea 2';
const N = 128;
const C = N / 2;

const impulse = () => {
  const d = new Float64Array(N * N);
  d[C * N + C] = 1;
  return Array.from(d);
};
const radii = [0.5, 1, 2, 3, 4, 6, 8, 12];
const calls = radii.map((r) => ({
  name: `blur_${r}`,
  type: 'uF55CuF0BAuE6D5',
  method: 'uEB77uF21DuE95D',
  ret: 'Map',
  args: [{ t: 'map', w: N, h: N, data: impulse() }, { t: 'f32', v: r }],
}));
const spec = path.join(ROOT, 'tools', 'oracle-spec-blur.json');
const out = path.join(ROOT, 'evidence', 'oracle-blur.json');
fs.writeFileSync(spec, JSON.stringify({ calls }));
execFileSync('dotnet', [PROBE, GAEA, 'oracle', spec, out], { stdio: 'inherit' });
const res = JSON.parse(fs.readFileSync(out, 'utf8'));
if (!res.ok) { console.error(res.error); process.exit(1); }

for (const r of radii) {
  const d = res.calls[`blur_${r}`].data;
  const row = [];
  for (let k = -10; k <= 10; k++) row.push(d[C * N + C + k]);
  const col = [];
  for (let k = -10; k <= 10; k++) col.push(d[(C + k) * N + C]);
  const center = d[C * N + C];
  const sep = row.every((v, i) => Math.abs(v - col[i]) < 1e-9);
  const sum = d.reduce((a, b) => a + b, 0);
  // second moment of the 1D profile gives sigma of the separable kernel
  let m0 = 0, m2 = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    m0 += d[y * N + x];
    const dx = x - C, dy = y - C;
    m2 += d[y * N + x] * (dx * dx + dy * dy);
  }
  const sigma2d = Math.sqrt(m2 / (m0 * 2)); // 2D radial second moment / (2*sigma^2)
  const profile = row.map((v) => v.toExponential(3)).join(' ');
  console.log(`radius=${r} center=${center.toExponential(4)} sum=${sum.toFixed(6)} separable=${sep} sigma2D=${sigma2d.toFixed(4)}`);
  console.log(`   h: ${profile}`);
  // support: first offset where the value is exactly 0
  let support = 0;
  for (let k = 1; k < N / 2; k++) { if (d[C * N + C + k] === 0) { support = k; break; } }
  console.log(`   support≈${support}px`);
}
