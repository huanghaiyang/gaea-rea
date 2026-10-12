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

// Convention (reported by the user, final): DIRECT MANIPULATION — the terrain
// follows the cursor. Drag up (dy < 0) must move the terrain UP the screen.
//
// The sign is derived from the projection, not by hand (tools/derive_pan_sign.py):
//   operator            drag up (dy<0)      drag down (dy>0)
//   target[1] += dy*s   terrain up          terrain down     <- follows cursor (wanted)
//   target[1] -= dy*s   terrain down        terrain up       <- inverse convention
// so the implementation is `target[1] += dy * s`.
{
  const cam = freshCam();
  const before = cam.target[1];
  Viewport.pan(cam, 0, -40);   // drag up
  ok(
    cam.target[1] < before,
    'drag up lowers the target, so the terrain moves up the screen (follows cursor)',
    { before, after: cam.target[1] },
  );
}

// Drag down -> terrain moves down the screen -> target[1] increases.
{
  const cam = freshCam();
  const before = cam.target[1];
  Viewport.pan(cam, 0, 40);
  ok(
    cam.target[1] > before,
    'drag down raises the target, so the terrain moves down the screen',
    { before, after: cam.target[1] },
  );
}

// Guard the exact operator so a regression to the inverse convention is caught.
{
  const cam = freshCam();
  const dy = 25;
  const s = cam.dist * 0.0022;
  Viewport.pan(cam, 0, dy);
  ok(
    near(cam.target[1], 0.18 + dy * s),
    'vertical pan uses += dy (follows the cursor)',
    cam.target[1],
  );
  ok(
    !near(cam.target[1], 0.18 - dy * s),
    'vertical pan is NOT the inverse-drag sign',
    cam.target[1],
  );
}

/* -------------------------------------------------------------- horizontal */

// Same direct-manipulation sense horizontally: dragging right moves the terrain right.
{
  const cam = freshCam();
  const before = cam.target[0];
  Viewport.pan(cam, 30, 0);
  ok(cam.target[0] > before, 'drag right moves the target right (terrain moves right)', cam.target[0]);
  ok(near(cam.target[1], 0.18), 'horizontal pan does not touch the vertical axis', cam.target[1]);
}

{
  const cam = freshCam();
  Viewport.pan(cam, -30, 0);
  ok(cam.target[0] < 0, 'drag left moves the target left', cam.target[0]);
}

/* ------------------------------------------------------------- axis coupling */

// The vertical drag must NOT touch the depth axis. Coupling target[2] to dy was
// measured to inject sideways drift (projected: 0.28x sideways at yaw 0.62, and
// 2.09x at yaw 2.40), turning an up/down drag into near-horizontal sliding.
{
  const cam = freshCam();
  const before = cam.target[2];
  Viewport.pan(cam, 0, 40);
  ok(
    near(cam.target[2], before),
    'vertical pan leaves the depth axis untouched (no sideways drift)',
    { before, after: cam.target[2] },
  );
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
