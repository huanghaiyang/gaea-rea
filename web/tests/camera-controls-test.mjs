/**
 * camera-controls-test.mjs — sign conventions for the 3D preview controls.
 *
 * The preview camera sits above its target and looks down, because
 *   ey = target[1] + dist * sin(pitch)
 * Panning is direct manipulation, so the terrain must follow the cursor: a
 * downward drag has to move the target DOWN. The original code did the opposite
 * for the vertical axis, which made right-drag (and shift-drag) feel inverted.
 *
 * These functions are pure and exported, so the conventions are asserted here
 * rather than only being visible in a browser.
 *
 * Run: node web/tests/camera-controls-test.mjs
 */

import { installDomShim } from './dom-shim.mjs';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) {
    pass++;
  } else {
    failures.push(`${label}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`);
  }
}

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

function freshCam() {
  return { yaw: 0.62, pitch: 0.72, dist: 2.45, target: [0, 0.18, 0] };
}

// The viewport module reaches for DOM globals on import, so install the shim first.
installDomShim({ url: 'http://127.0.0.1:8080/', catalog: { nodes: [] } });
const { Viewport } = await import('../js/viewport.js');

/* ---------------------------------------------------------------- vertical */

// Drag DOWN (cursor moves down the screen, dy > 0) -> terrain follows the cursor
// down -> the target must move down, i.e. target[1] decreases.
{
  const cam = freshCam();
  const before = cam.target[1];
  Viewport.pan(cam, 0, 40);
  ok(
    cam.target[1] < before,
    'drag down lowers the target (terrain follows the cursor)',
    { before, after: cam.target[1] },
  );
}

// Drag UP -> target[1] increases.
{
  const cam = freshCam();
  const before = cam.target[1];
  Viewport.pan(cam, 0, -40);
  ok(
    cam.target[1] > before,
    'drag up raises the target',
    { before, after: cam.target[1] },
  );
}

// The defect in one assertion: vertical pan must be the OPPOSITE sign to the old
// `+= dy` behaviour. Guard against a silent regression to it.
{
  const cam = freshCam();
  const dy = 25;
  const s = cam.dist * 0.0022;
  Viewport.pan(cam, 0, dy);
  ok(
    !near(cam.target[1], 0.18 + dy * s),
    'vertical pan is NOT the old inverted `+= dy` behaviour',
    cam.target[1],
  );
  ok(
    near(cam.target[1], 0.18 - dy * s),
    'vertical pan magnitude is unchanged, only the sign',
    cam.target[1],
  );
}

/* -------------------------------------------------------------- horizontal */

{
  const cam = freshCam();
  const before = cam.target[0];
  Viewport.pan(cam, 30, 0);
  ok(cam.target[0] < before, 'drag right moves the target left (terrain follows)', cam.target[0]);
  ok(near(cam.target[1], 0.18), 'horizontal pan does not touch the vertical axis', cam.target[1]);
}

{
  const cam = freshCam();
  Viewport.pan(cam, -30, 0);
  ok(cam.target[0] > 0, 'drag left moves the target right', cam.target[0]);
}

/* ------------------------------------------------------------- axis coupling */

// target[2] previously received the vertical delta and keeps that role.
{
  const cam = freshCam();
  const before = cam.target[2];
  Viewport.pan(cam, 0, 40);
  ok(cam.target[2] !== before, 'vertical pan still advances the depth axis', cam.target[2]);
}

// Pan scale follows zoom distance, so panning stays proportional when zoomed out.
{
  const near1 = freshCam();
  const far1 = freshCam();
  far1.dist = 6;
  Viewport.pan(near1, 0, 10);
  Viewport.pan(far1, 0, 10);
  ok(
    Math.abs(far1.target[1] - 0.18) > Math.abs(near1.target[1] - 0.18),
    'pan magnitude scales with camera distance',
    { near: near1.target[1], far: far1.target[1] },
  );
}

/* ---------------------------------------------------------------- orbit */

{
  const cam = freshCam();
  const before = cam.pitch;
  Viewport.orbit(cam, 0, 20);
  ok(cam.pitch > before, 'orbit: drag down raises the camera (pitch increases)', cam.pitch);
}

{
  const cam = freshCam();
  const before = cam.yaw;
  Viewport.orbit(cam, 20, 0);
  ok(cam.yaw < before, 'orbit: drag right rotates the view', cam.yaw);
  ok(near(cam.pitch, 0.72), 'orbit horizontal drag does not move pitch', cam.pitch);
}

// Pitch is clamped so the camera can never pass through the ground plane or flip.
{
  const low = freshCam();
  for (let i = 0; i < 200; i++) Viewport.orbit(low, 0, -10);
  ok(low.pitch >= 0.05 && low.pitch <= 1.52, 'pitch clamps low', low.pitch);

  const high = freshCam();
  for (let i = 0; i < 200; i++) Viewport.orbit(high, 0, 10);
  ok(high.pitch >= 0.05 && high.pitch <= 1.52, 'pitch clamps high', high.pitch);
}

// Panning must not alter the camera orientation.
{
  const cam = freshCam();
  const yaw = cam.yaw, pitch = cam.pitch;
  Viewport.pan(cam, 37, -21);
  ok(near(cam.yaw, yaw) && near(cam.pitch, pitch), 'pan leaves yaw and pitch untouched', [cam.yaw, cam.pitch]);
}

/* ----------------------------------------------------------------- zoom */

{
  const cam = freshCam();
  const before = cam.dist;
  Viewport.zoom(cam, 100);
  ok(cam.dist > before, 'wheel down zooms out', cam.dist);

  const cam2 = freshCam();
  Viewport.zoom(cam2, -100);
  ok(cam2.dist < before, 'wheel up zooms in', cam2.dist);
}

{
  const cam = freshCam();
  for (let i = 0; i < 200; i++) Viewport.zoom(cam, 100);
  ok(cam.dist <= 9 && cam.dist >= 0.75, 'zoom clamps far', cam.dist);

  const cam2 = freshCam();
  for (let i = 0; i < 200; i++) Viewport.zoom(cam2, -100);
  ok(cam2.dist <= 9 && cam2.dist >= 0.75, 'zoom clamps near', cam2.dist);
}

/* ------------------------------------------------------- camera position */

// Sanity: the camera really is above the target at the default pitch, which is the
// premise the pan sign derivation rests on.
{
  const cam = freshCam();
  const ey = cam.target[1] + cam.dist * Math.sin(cam.pitch);
  ok(ey > cam.target[1], 'camera eye sits above the target at the default pitch', ey);
}

/* ------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('all camera control assertions passed');
}
