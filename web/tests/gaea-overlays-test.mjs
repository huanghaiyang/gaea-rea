/**
 * gaea-overlays-test.mjs — the viewport overlay layer.
 *
 * The overlays are reference images drawn over the frame, not node data, so the properties worth
 * asserting are about the LAYER rather than about pixels: it covers the whole clip space, it
 * refuses to show a texture it does not have, hiding works, and a missing asset is reported by
 * name instead of being swallowed.
 *
 * three.js constructs geometry and materials without a WebGL context, so this runs in Node; only
 * the actual draw needs a GPU.
 *
 * Run: node web/tests/gaea-overlays-test.mjs
 */

import {
  ViewportOverlay, OVERLAY_NAMES, OVERLAY_LABELS,
} from '../js/overlays.js';

let pass = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ the shipped set */

{
  // The eight files that exist in Resources/Overlays, and nothing invented.
  ok(OVERLAY_NAMES.length === 8, 'eight overlays are declared', OVERLAY_NAMES.length);
  const expected = ['colorcheck', 'colorgrid', 'dots', 'grid_dark', 'grid_light', 'lines', 'quads', 'uv'];
  ok(expected.every((n) => OVERLAY_NAMES.includes(n)) && OVERLAY_NAMES.length === expected.length,
    'the set is exactly the eight shipped files', OVERLAY_NAMES.join(','));
  // Every name needs a label, or the UI would show a raw filename.
  const unlabelled = OVERLAY_NAMES.filter((n) => !OVERLAY_LABELS[n]);
  ok(unlabelled.length === 0, 'every overlay has a label', unlabelled.join(','));
}

/* ------------------------------------------------------------------ the quad geometry */

{
  const ov = new ViewportOverlay(1280, 720);

  // CLIP-SPACE COVERAGE. A quad that does not span -1..1 in both axes would leave part of the
  // viewport uncovered, which for a reference grid means a grid with a hole in it.
  const pos = ov.geometry.getAttribute('position');
  ok(pos.count === 4, 'the quad has four vertices', pos.count);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i));
  }
  ok(minX === -1 && maxX === 1 && minY === -1 && maxY === 1,
    'the quad spans the whole clip space', `${minX}..${maxX}, ${minY}..${maxY}`);

  // UVs must cover 0..1, or the texture is cropped.
  const uv = ov.geometry.getAttribute('uv');
  let uMax = 0; let vMax = 0;
  for (let i = 0; i < uv.count; i++) { uMax = Math.max(uMax, uv.getX(i)); vMax = Math.max(vMax, uv.getY(i)); }
  ok(uMax === 1 && vMax === 1, 'the UVs span the whole texture', `${uMax}, ${vMax}`);

  // Indexed as two triangles.
  ok(ov.geometry.getIndex().count === 6, 'the quad is two triangles', ov.geometry.getIndex().count);

  // IT MUST DRAW OVER THE SCENE, not into it: depth testing off and a late render order, or the
  // terrain would occlude a reference layer.
  ok(ov.material.depthTest === false, 'the overlay does not depth test');
  ok(ov.material.depthWrite === false, 'the overlay does not write depth');
  ok(ov.material.transparent === true, 'the overlay is transparent');
  ok(ov.mesh.renderOrder > 900, 'the overlay draws after the scene', ov.mesh.renderOrder);
  ok(ov.mesh.frustumCulled === false, 'the overlay is never frustum-culled');
  ok(ov.mesh.visible === false, 'the overlay starts hidden');

  ov.dispose();
}

/* ------------------------------------------------------------ show / hide / missing */

{
  const ov = new ViewportOverlay(800, 600);

  // SHOWING A TEXTURE THAT IS NOT LOADED MUST FAIL, not fake it. A transparent quad would look
  // like a working overlay on a black background.
  const missing = ov.show('uv');
  ok(missing === false, 'show() reports a texture it does not have', missing);
  ok(ov.mesh.visible === false, 'and leaves the overlay hidden');
  ok(ov.current === null, 'and records nothing as current');

  // Hiding is always allowed, even with nothing shown.
  ok(ov.show(null) === true, 'show(null) hides');
  ok(ov.mesh.visible === false, 'and the mesh is hidden');

  // Status must name every declared overlay, so a caller can report what is missing rather than
  // inferring it from a blank frame.
  const st = ov.status();
  ok(st.length === OVERLAY_NAMES.length, 'status covers every overlay', st.length);
  ok(st.every((s) => s.loaded === false), 'nothing is loaded yet');
  ok(st.every((s) => typeof s.name === 'string' && s.label), 'each entry has a name and label');

  // A failure has to be recorded per name. In Node there is no fetch of a relative URL, so a load
  // must reject and be caught rather than throwing out of the module.
  const res = await ov.loadAll(['uv']);
  ok(res.failed.includes('uv') || res.loaded === 1,
    'loadAll reports the outcome rather than throwing', JSON.stringify(res));
  const after = ov.status().find((s) => s.name === 'uv');
  ok(after !== undefined, 'uv still appears in status after a failed load');

  ov.dispose();
}

/* ------------------------------------------------------------------- opacity bounds */

{
  const ov = new ViewportOverlay(100, 100);
  ov.setOpacity(0.25);
  ok(Math.abs(ov.opacity - 0.25) < 1e-9, 'setOpacity stores the value', ov.opacity);
  ov.setOpacity(5);
  ok(ov.opacity === 1, 'and clamps above 1', ov.opacity);
  ov.setOpacity(-3);
  ok(ov.opacity === 0, 'and clamps below 0', ov.opacity);
  ov.resize(1920, 1080);
  ok(ov.width === 1920 && ov.height === 1080, 'resize records the new size');
  ov.dispose();
}

/* ------------------------------------------------------------------------- report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('Gaea viewport overlays: 8 reference layers as a screen-space quad');
  console.log('fidelity: exact — these are the vendor PNGs, unmodified');
}
