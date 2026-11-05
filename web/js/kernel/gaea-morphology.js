/**
 * gaea-morphology.js — exact port of `Morphology.DilateCross`.
 *
 * The engine uses a van Herk / Gil-Werman style max-filter: the row is split into monotonically
 * decreasing "segments" whose centres and ranges are stored, then the max over a sliding window is
 * read off the segment table. `DilateCross` runs it twice — once transposed in, once transposed out —
 * so the result is a cross (row + column) dilation of the given thickness.
 *
 * Verified against the shipped `Morphology.DilateCross` (instance method) by `tools/verify-exact.mjs`.
 */

function rectangularPass(state, kernelSize, transposeOutput, maxMerge, transposeInput) {
  const { resolution } = state;
  const res1 = resolution + 1;
  const { h0, segCenter, range, h1 } = state;
  const h0new = transposeInput ? new Float32Array(resolution * resolution) : null;
  for (let row = 0; row < resolution; row++) {
    let num = 0;
    segCenter[row * resolution] = 0;
    range[row * res1] = -kernelSize;
    range[row * res1 + 1] = kernelSize;
    for (let i = 1; i < resolution; i++) {
      let num2 = i - kernelSize;
      if (h0[row * resolution + i] <= h0[row * resolution + segCenter[row * resolution + num]]) {
        num2 = range[row * res1 + num + 1];
      }
      while (num2 < range[row * res1 + num]) {
        num -= 1;
        num2 = i - kernelSize;
        if (h0[row * resolution + i] <= h0[row * resolution + segCenter[row * resolution + num]]) {
          num2 = range[row * res1 + num + 1];
        }
      }
      num += 1;
      segCenter[row * resolution + num] = i;
      range[row * res1 + num] = num2;
      range[row * res1 + num + 1] = i + kernelSize;
    }
    num = 0;
    for (let j = 0; j < resolution; j++) {
      while (range[row * res1 + num + 1] < j) num += 1;
      const num3 = transposeOutput ? j * resolution + row : row * resolution + j;
      let num4 = h0[row * resolution + segCenter[resolution * row + num]];
      if (maxMerge) num4 = Math.max(h1[num3], num4);
      h1[num3] = num4;
      if (transposeInput) h0new[j * resolution + row] = h0[row * resolution + j];
    }
  }
  if (transposeInput) state.h0 = h0new;
}

/** `Morphology.DilateCross(float[] h, int resolution, float kernelSize)`. */
export function dilateCross(h, resolution, kernelSize) {
  const state = {
    resolution,
    h0: Float32Array.from(h),
    h1: new Float32Array(resolution * resolution),
    segCenter: new Int32Array(resolution * resolution),
    range: new Float32Array((resolution + 1) * resolution),
  };
  const half = kernelSize * 0.5;
  // first pass reads transposed input, second pass writes transposed output → net cross dilation
  rectangularPass(state, half, false, false, true);
  rectangularPass(state, half, true, true, false);
  return state.h1;
}
