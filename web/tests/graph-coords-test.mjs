/**
 * graph-coords-test.mjs — regression guard for graph canvas coordinate plumbing.
 *
 * The graph editor sizes its canvas backing store by devicePixelRatio, so the
 * drawing context must be scaled by the same factor. If it is not, everything is
 * drawn into the top-left 1/dpr of the bitmap while hit-testing still assumes CSS
 * pixels — clicks then land off by that factor on any HiDPI display, which is
 * invisible at devicePixelRatio 1. The shim is therefore driven at DPR 2 here.
 *
 * Run: node web/tests/graph-coords-test.mjs
 */

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

/* ------------------------------------------------------------------ harness */

const { installDomShim } = await import('./dom-shim.mjs');

const DPR = 2;
const shim = installDomShim({
  url: 'http://127.0.0.1:8080/',
  catalog: { nodes: [] },
  devicePixelRatio: DPR,
});

const canvas = shim.registry.byId.get('graph-canvas');
ok(!!canvas, 'graph canvas exists in the shim');

// The shim reports canvas geometry in CSS pixels (640x400).
const cssW = canvas.getBoundingClientRect().width;
const cssH = canvas.getBoundingClientRect().height;
ok(cssW > 0 && cssH > 0, 'canvas has a non-zero CSS layout box', [cssW, cssH]);

const ctx = canvas.getContext('2d');
ok(!!ctx, '2D context available');
ok(Array.isArray(ctx.transforms), 'shim context records transforms');

/* ------------------------------------------------------------ construction */

const { GraphEditor } = await import('../js/graph-editor.js');
const editor = new GraphEditor(canvas, {});

/* ------------------------------------------------- backing store vs CSS size */

ok(
  canvas.width === Math.round(cssW * DPR) && canvas.height === Math.round(cssH * DPR),
  `backing store is CSS size × DPR (${canvas.width}x${canvas.height})`,
  [canvas.width, canvas.height],
);
ok(
  editor.dpr === DPR,
  'editor remembers the device pixel ratio',
  editor.dpr,
);
ok(
  near(editor.cssWidth, cssW) && near(editor.cssHeight, cssH),
  'editor records the CSS-pixel surface size',
  [editor.cssWidth, editor.cssHeight],
);

/* ------------------------------------------- drawing must be DPR-scaled */

ctx.transforms.length = 0;
editor.draw();

const scaleOps = ctx.transforms.filter((t) => t[0] === 'scale');
const [sx, sy] = ctx.currentScale;
ok(
  near(sx, DPR) && near(sy, DPR),
  `draw() applies ctx.scale(${DPR}, ${DPR}) so CSS-pixel geometry fills the bitmap`,
  ctx.currentScale,
);
ok(
  scaleOps.length >= 1,
  'at least one scale() call was made while drawing',
  scaleOps.length,
);

// The fillRect that clears the background must cover the CSS surface, not the
// bitmap (covering the bitmap was harmless before, but it encodes the same intent).
ok(
  editor.cssWidth === cssW,
  'draw() clears using CSS-pixel width, not bitmap width',
  editor.cssWidth,
);

/* --------------------------------------------- coordinate round-trip helpers */

const view = { x: 40, y: 30, k: 1 };
editor.view.x = view.x;
editor.view.y = view.y;
editor.view.k = view.k;

for (const [wxp, wyp] of [[0, 0], [10, 20], [-5, 7], [123.5, -48.25]]) {
  const [sxp, syp] = editor.toScreen(wxp, wyp);
  const [rx, ry] = editor.toWorld(sxp, syp);
  ok(
    near(rx, wxp, 1e-9) && near(ry, wyp, 1e-9),
    `toWorld(toScreen()) is identity for (${wxp}, ${wyp})`,
    [rx, ry],
  );
}

// Panning moves the view in the same CSS-pixel units as pointer offsetX/Y, so a
// pointer delta must translate into an equal view delta (no DPR factor involved).
editor.view.x = 40;
editor.view.y = 30;
const before = editor.toWorld(100, 100);
editor.view.x += 25;   // as a pan would
editor.view.y += 10;
const after = editor.toWorld(125, 110);
ok(
  near(after[0], before[0], 1e-9) && near(after[1], before[1], 1e-9),
  'a pointer delta and its view delta cancel out (pan is 1:1 in CSS pixels)',
  [before, after],
);

/* ------------------------------------------------------- hit-test alignment */

// The exact defect: with the old drawing code the visible node sat at half scale,
// so a click at the node's apparent centre missed it. Assert that the world point
// under a screen position equals the world position of a node drawn there.
const { addNode } = await import('../js/graph.js');
const { state } = await import('../js/state.js');

editor.view.x = 0;
editor.view.y = 0;
editor.view.k = 1;

const node = addNode(state.graph, 'Constant', 120, 90);
ok(!!node, 'a node can be added to the graph');

const nodeCentreScreen = (() => {
  const size = editor.nodeSize(node);
  return editor.toScreen(node.x + size.w / 2, node.y + size.h / 2);
})();

const world = editor.toWorld(nodeCentreScreen[0], nodeCentreScreen[1]);
const size = editor.nodeSize(node);
ok(
  near(world[0], node.x + size.w / 2, 1e-9) && near(world[1], node.y + size.h / 2, 1e-9),
  'the world point under a node centre is that node centre',
  world,
);

const hit = editor.hitTest(world[0], world[1]);
ok(
  hit && hit.kind === 'node' && hit.nodeId === node.id,
  'hitTest at the node centre selects that node',
  hit,
);

// And a click at the node's top-left interior must still hit it.
const inset = editor.toWorld(
  editor.toScreen(node.x + 4, node.y + 4)[0],
  editor.toScreen(node.x + 4, node.y + 4)[1],
);
const insetHit = editor.hitTest(inset[0], inset[1]);
ok(
  insetHit && insetHit.kind === 'node' && insetHit.nodeId === node.id,
  'hitTest just inside the node bounds hits it',
  insetHit,
);

/* -------------------------------------------------------------- viewCenter */

const centre = editor.viewCenter();
const [cx, cy] = editor.toWorld(cssW / 2, cssH / 2);
ok(
  near(centre[0], cx, 1e-9) && near(centre[1], cy, 1e-9),
  'viewCenter() matches the world point at the middle of the CSS box',
  [centre, [cx, cy]],
);

/* ------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}  (devicePixelRatio=${DPR})`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('all graph coordinate assertions passed');
}
