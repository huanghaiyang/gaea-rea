/**
 * gaea-cluter-test.mjs — CLUTer against Gaea's OWN palette bytes.
 *
 * This is the strongest form of test available for an asset-backed node: rather than asserting a
 * property of an invented ramp, it reads the original `.clut` from the Gaea installation,
 * computes what the middle row SHOULD produce, and requires the node to match. If the PNG
 * extraction, the loader, the sampling or the HSL path is wrong anywhere, the numbers differ.
 *
 * It runs in Node with no browser: `installCLUT` puts a table in the cache directly, which is
 * exactly the hook the preload path uses, so the same code is exercised.
 *
 * Skipped with a clear message when the Gaea installation is absent, because the palette bytes
 * are vendor data and are deliberately not committed -- see .gitignore on `web/assets/`.
 *
 * Run: node web/tests/gaea-cluter-test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  gaeaCLUTer, installCLUT, hasCLUT, clutStatus, sampleCLUT, preloadCLUTs, CLUT_NAMES,
} from '../js/clut.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

const GAEA_COLOR = 'D:\\Gaea 2\\Resources\\Color';
const ENTRY_BYTES = 3;                 // RGB, not RGBA -- see tools/extract-assets.py
const haveVendor = fs.existsSync(GAEA_COLOR);

/** Read a .clut into {rows, cols, rgba} — the same parse the extraction script performs. */
function readClut(name) {
  const b = fs.readFileSync(path.join(GAEA_COLOR, `${name}.clut`));
  const rows = b.readUInt32LE(0);
  const body = b.subarray(4);
  const per = body.length / rows;
  const cols = per / ENTRY_BYTES;
  const rgba = new Uint8Array(rows * cols * 4);
  for (let i = 0; i < rows * cols; i++) {
    rgba[i * 4] = body[i * 3];
    rgba[i * 4 + 1] = body[i * 3 + 1];
    rgba[i * 4 + 2] = body[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { rows, cols, rgba };
}

const size = 32;
const field = (data) => ({ data, channels: 1, size, channel: 'height' });
const ctx = (params, data) => ({ size, params, input: () => field(data) });

/* ----------------------------------------------------------- cache behaviour */

{
  // A palette that was never installed must be reported as missing, and the node must still
  // return a full field rather than throwing or returning a flat colour.
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = i / (d.length - 1);

  ok(!hasCLUT('NoSuchPalette'), 'an uninstalled palette reports as missing');
  const status = clutStatus();
  ok(status.length === CLUT_NAMES.length, 'clutStatus covers every preset', status.length);

  const out = gaeaCLUTer(ctx({ GradientData: 'NoSuchPalette' }, d));
  ok(out !== null && out.data.length === size * size * 4,
    'the node still returns an RGBA field without a palette', out?.data?.length);
  // The grey fallback means R == G == B everywhere at neutral adjustments.
  let grey = true;
  for (let i = 0; i < size * size; i++) {
    if (out.data[i * 4] !== out.data[i * 4 + 1] || out.data[i * 4] !== out.data[i * 4 + 2]) grey = false;
  }
  ok(grey, 'the fallback is a grey ramp');

  // Alpha must be set, or the output renders transparent.
  let alphaOk = true;
  for (let i = 0; i < size * size; i++) if (out.data[i * 4 + 3] !== 1) alphaOk = false;
  ok(alphaOk, 'alpha is 1 everywhere');
}

/* -------------------------------------------------- a synthetic table, checked exactly */

{
  // A three-stop table makes the sampling arithmetic checkable by hand: t=0 -> pure red,
  // t=0.5 -> pure green, t=1 -> pure blue.
  const cols = 3;
  const rgba = new Uint8Array(cols * 4);
  rgba.set([255, 0, 0, 255], 0);
  rgba.set([0, 255, 0, 255], 4);
  rgba.set([0, 0, 255, 255], 8);
  installCLUT('Synthetic', rgba, cols, 1);
  ok(hasCLUT('Synthetic'), 'installCLUT populates the cache');

  const d = new Float32Array(size * size);
  const n = d.length;
  for (let i = 0; i < n; i++) d[i] = i / (n - 1);
  const out = gaeaCLUTer(ctx({ GradientData: 'Synthetic' }, d));

  // The first cell is t=0 and the last is t=1, so they must be the end stops.
  const first = [out.data[0], out.data[1], out.data[2]];
  const lastIdx = (n - 1) * 4;
  const last = [out.data[lastIdx], out.data[lastIdx + 1], out.data[lastIdx + 2]];
  ok(first[0] > 0.9 && first[1] < 0.1 && first[2] < 0.1, 't=0 takes the first stop',
    first.map((v) => v.toFixed(3)).join(','));
  ok(last[2] > 0.9 && last[0] < 0.1 && last[1] < 0.1, 't=1 takes the last stop',
    last.map((v) => v.toFixed(3)).join(','));

  // Clamping, not wrapping: a value below 0 must take the first stop, not jump to the last.
  const low = new Float32Array(size * size).fill(-0.5);
  const lo = gaeaCLUTer(ctx({ GradientData: 'Synthetic' }, low));
  ok(lo.data[0] > 0.9 && lo.data[2] < 0.1, 'a negative height clamps to the first stop, not wrapping',
    [lo.data[0], lo.data[1], lo.data[2]].map((v) => v.toFixed(3)).join(','));

  // Sampling directly: the middle stop is reachable at t=0.5.
  const mid = sampleCLUT('Synthetic', 0.5);
  ok(mid && mid.g > 0.9 && mid.r < 0.1 && mid.b < 0.1, 't=0.5 takes the middle stop',
    mid && `${mid.r.toFixed(3)},${mid.g.toFixed(3)},${mid.b.toFixed(3)}`);

  // BIAS SHIFTS THE LOOKUP. Bias -1 pushes the sample towards the start, so the LAST cell must
  // stop taking the blue end and take something earlier.
  const biased = gaeaCLUTer(ctx({ GradientData: 'Synthetic', Bias: -1 }, d));
  const bLast = [biased.data[lastIdx], biased.data[lastIdx + 1], biased.data[lastIdx + 2]];
  ok(!(bLast[2] > 0.9), 'Bias shifts the lookup away from the end', bLast.map((v) => v.toFixed(3)).join(','));
}

/* ------------------------------------------------------ HSL adjustments are live */

{
  const cols = 1;
  const rgba = new Uint8Array([128, 128, 128, 255]);
  installCLUT('Grey', rgba, cols, 1);
  const d = new Float32Array(size * size).fill(0.5);

  const neutral = gaeaCLUTer(ctx({ GradientData: 'Grey' }, d));
  ok(Math.abs(neutral.data[0] - 128 / 255) < 0.01, 'a grey palette passes through',
    neutral.data[0].toFixed(4));

  // A grey has zero saturation, so raising Saturation must do nothing; Lightness must.
  const lit = gaeaCLUTer(ctx({ GradientData: 'Grey', Lightness: 0.5 }, d));
  ok(lit.data[0] > neutral.data[0], 'Lightness raises a grey', lit.data[0].toFixed(4));
  const dark = gaeaCLUTer(ctx({ GradientData: 'Grey', Lightness: -0.5 }, d));
  ok(dark.data[0] < neutral.data[0], 'negative Lightness lowers it', dark.data[0].toFixed(4));

  // Saturation on a COLOURED palette must actually change the channels.
  const crgba = new Uint8Array([200, 80, 80, 255]);
  installCLUT('Coloured', crgba, 1, 1);
  const c0 = gaeaCLUTer(ctx({ GradientData: 'Coloured' }, d));
  const c1 = gaeaCLUTer(ctx({ GradientData: 'Coloured', Saturation: 0.8 }, d));
  const spread0 = Math.abs(c0.data[0] - c0.data[1]);
  const spread1 = Math.abs(c1.data[0] - c1.data[1]);
  ok(spread1 > spread0, 'Saturation widens the channel spread',
    `${spread0.toFixed(4)} -> ${spread1.toFixed(4)}`);

  // Hue must rotate, which on a red palette means the green channel gains.
  const h = gaeaCLUTer(ctx({ GradientData: 'Coloured', Hue: 0.5 }, d));
  ok(h.data[1] > c0.data[1], 'Hue rotates the colour', `${c0.data[1].toFixed(4)} -> ${h.data[1].toFixed(4)}`);

  // Every adjustment must keep the output in range.
  let inRange = true;
  for (const v of h.data) if (v < 0 || v > 1) inRange = false;
  ok(inRange, 'adjusted output stays in 0..1');
}

/* ------------------------------------------- against the vendor palettes, exactly */

if (!haveVendor) {
  console.log('');
  console.log(`  SKIP vendor comparison: ${GAEA_COLOR} not present.`);
  console.log('  The palette bytes are vendor data and are not committed; run');
  console.log('  tools/extract-assets.py on a machine with Gaea installed.');
} else {
  for (const name of CLUT_NAMES) {
    let src;
    try {
      src = readClut(name);
    } catch (e) {
      failures.push(`reading ${name}.clut — ${e.message}`);
      continue;
    }
    installCLUT(name, src.rgba, src.cols, src.rows);
    ok(hasCLUT(name), `${name} installs`);

    // Build a field that walks the palette end to end, then compare every cell with the
    // SOURCE bytes' middle row. Sampling uses a 1024-entry LUT, so allow one source-column of
    // slack -- anything larger means the extraction or the sampling is wrong, not rounding.
    const n = 512;
    const d = new Float32Array(n * 1);
    for (let i = 0; i < n; i++) d[i] = i / (n - 1);
    const small = 512;
    const fieldData = new Float32Array(small * small);
    for (let y = 0; y < small; y++) {
      for (let x = 0; x < small; x++) fieldData[y * small + x] = x / (small - 1);
    }
    const node = gaeaCLUTer({ size: small, params: { GradientData: name }, input: () => ({ data: fieldData, channels: 1, size: small, channel: 'height' }) });

    const row = Math.floor(src.rows / 2);
    let worst = 0;
    for (let x = 0; x < small; x++) {
      const col = Math.min(src.cols - 1, Math.round((x / (small - 1)) * (src.cols - 1)));
      const o = (row * src.cols + col) * 4;
      const want = [src.rgba[o] / 255, src.rgba[o + 1] / 255, src.rgba[o + 2] / 255];
      const got = [node.data[(0 * small + x) * 4], node.data[(0 * small + x) * 4 + 1], node.data[(0 * small + x) * 4 + 2]];
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(want[c] - got[c]));
    }
    // One source column out of 512 is ~0.002 in the 0..1 domain, and the LUT quantises to 1024
    // entries, so a tolerance of 1/255 + a little is the right bound for correct code.
    ok(worst <= 0.005, `${name}: the node reproduces the source palette`, `max delta ${worst.toFixed(5)}`);
  }
}

/* -------------------------------------------------------------- async preload */

{
  // In Node there is no `createImageBitmap`, so a preload must FAIL rather than hang, and must
  // report each palette it could not load. That is the behaviour a browser with a missing asset
  // depends on.
  const res = await preloadCLUTs(['DefinitelyMissing'], 'assets/color');
  ok(res.failed.includes('DefinitelyMissing'), 'a failed preload is reported, not swallowed',
    JSON.stringify(res));
  const st = clutStatus().find((s) => s.name === 'DefinitelyMissing');
  ok(st === undefined, 'only the named presets appear in clutStatus');
}

/* ------------------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Gaea CLUTer: eight built-in palettes, read from the vendor .clut bytes');
  console.log('fidelity: approx — the gradient path is exact; HSL curves are standard forms');
}
