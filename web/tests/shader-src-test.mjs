/**
 * shader-src-test.mjs — static checks on the GLSL used by the 3D preview.
 *
 * A browser is the only real GLSL compiler, and the Dart-side suite has no GPU. But
 * most mistakes that make a WebGL shader fail to compile are structural, and a failed
 * compile means no 3D at all — the highest-severity outcome. So this asserts the
 * invariants a driver would reject.
 *
 * DIALECT: three.js owns the shader preamble. `ShaderMaterial` shaders are therefore
 * written in GLSL ES 1.00 style (`attribute` / `varying` / `gl_FragColor` /
 * `texture2D`), and three.js injects `#version`, `precision` and the built-in matrices
 * itself. Declaring any of those here would be a duplicate-definition error, so this
 * file asserts they are ABSENT rather than present — the previous hand-rolled renderer
 * required them, and that is exactly the kind of assumption worth pinning.
 *
 * Run: node web/tests/shader-src-test.mjs
 */

import { readFile } from 'node:fs/promises';
import { SHADER_VERT, SHADER_FRAG } from '../js/viewport.js';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ helpers */

/**
 * Strip comments in one pass. Removing `//` to end-of-line first would also eat the
 * `//` inside a block comment and vice versa, and prose like "normals (see below)"
 * otherwise looks like a function call.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (two === '/*') { i += 2; while (i < src.length && src.slice(i, i + 2) !== '*/') i++; i += 2; continue; }
    out += src[i++];
  }
  return out;
}

const QUALIFIERS = ['attribute', 'uniform', 'varying'];

function declared(src, kind) {
  const out = new Map();
  const re = new RegExp(`^\\s*${kind}\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*;`, 'gm');
  let m;
  while ((m = re.exec(src))) out.set(m[2], m[1]);
  return out;
}

function declaredFunctions(src) {
  const out = new Set();
  const re = /^\s*(?:vec[234]|float|int|void|bool|mat[234])\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

function usedFunctions(src) {
  const names = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  for (const kw of ['if', 'for', 'while', 'return', 'switch',
    'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4', 'float', 'int', 'uint', 'bool', 'main']) {
    names.delete(kw);
  }
  return names;
}

// GLSL ES 1.00 built-ins this shader is allowed to call.
const ALLOWED = new Set([
  'normalize', 'max', 'min', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'sqrt',
  'abs', 'floor', 'ceil', 'fract', 'sin', 'cos', 'tan', 'atan', 'exp', 'log',
  'texture2D', 'texture2DProj', 'textureCube', 'dot', 'cross', 'length', 'distance',
  'reflect', 'refract', 'sign', 'mod', 'radians', 'degrees', 'inversesqrt',
]);

const VERT_CODE = stripComments(SHADER_VERT);
const FRAG_CODE = stripComments(SHADER_FRAG);

/* --------------------------------------------------------------- both stages */

for (const [name, src] of [['VERT', VERT_CODE], ['FRAG', FRAG_CODE]]) {
  const open = (src.match(/\{/g) || []).length;
  const close = (src.match(/\}/g) || []).length;
  ok(open === close, `${name}: braces balance`, `${open} vs ${close}`);

  const po = (src.match(/\(/g) || []).length;
  const pc = (src.match(/\)/g) || []).length;
  ok(po === pc, `${name}: parentheses balance`, `${po} vs ${pc}`);

  ok(/\bvoid\s+main\s*\(\s*\)/.test(src), `${name}: defines void main()`);

  // three.js prepends these; declaring them here would be a redefinition.
  ok(!/#version/.test(src), `${name}: does NOT declare #version (three.js owns the preamble)`);
  ok(!/precision\s+(highp|mediump|lowp)\s+float\s*;/.test(src),
    `${name}: does NOT redeclare precision (three.js injects it)`);
  for (const builtin of ['projectionMatrix', 'modelViewMatrix', 'normalMatrix']) {
    ok(
      !new RegExp(`^\\s*uniform\\s+\\w+\\s+${builtin}\\s*;`, 'm').test(src),
      `${name}: does NOT redeclare three.js built-in ${builtin}`,
    );
  }
  ok(!/^\s*(?:in|out)\s+\w+\s+\w+\s*;/m.test(src),
    `${name}: uses GLSL ES 1.00 qualifiers, not in/out`);

  const fns = usedFunctions(src);
  const local = declaredFunctions(src);
  const unknown = [...fns].filter((f) => !ALLOWED.has(f) && !local.has(f));
  ok(unknown.length === 0, `${name}: every called function exists in GLSL ES 1.00`, unknown.join(', '));
}

/* ------------------------------------------- stage interface must agree */

const vAttrs = declared(VERT_CODE, 'attribute');
const vVary = declared(VERT_CODE, 'varying');
const fVary = declared(FRAG_CODE, 'varying');

for (const [n, type] of vVary) {
  ok(fVary.has(n), `FRAG declares a varying for VERT output ${n}`, [...fVary.keys()].join(', '));
  if (fVary.has(n)) ok(fVary.get(n) === type, `varying ${n} has the same type in both stages`, `${type} vs ${fVary.get(n)}`);
}
for (const [n] of fVary) {
  ok(vVary.has(n), `VERT declares an output for FRAG varying ${n}`, [...vVary.keys()].join(', '));
}

// The two custom attributes the interleaved mesh buffer provides.
for (const a of ['aNormal', 'aHeight']) {
  ok(vAttrs.has(a), `VERT declares attribute ${a} (from the interleaved buffer)`, [...vAttrs.keys()].join(', '));
}
ok(!vAttrs.has('position'), 'VERT does NOT declare position (three.js provides it)');
ok(/\bposition\b/.test(VERT_CODE), 'VERT uses the three.js-provided position attribute');

/* ---------------------------------------- uniforms: declared, used, and set */

const vUniforms = declared(VERT_CODE, 'uniform');
const fUniforms = declared(FRAG_CODE, 'uniform');
const allUniforms = new Map([...vUniforms, ...fUniforms]);

// Shader-side names are `uXxx`; render3d.js exposes them under the same key.
const r3d = await readFile(new URL('../js/render3d.js', import.meta.url), 'utf8');

for (const n of allUniforms.keys()) {
  // Declared but never read is a bug: it silently does nothing.
  const uses = (VERT_CODE + FRAG_CODE).split(new RegExp(`\\b${n}\\b`)).length - 1;
  ok(uses >= 2, `uniform ${n} is read, not merely declared`, `mentions: ${uses}`);

  // Present in the THREE uniforms object, or it would never be uploaded.
  ok(
    new RegExp(`\\b${n}\\s*:\\s*\\{`).test(r3d),
    `uniform ${n} is present in the three.js uniforms object`,
  );
}

// No stale uniform left in the JS that the shader no longer declares.
const jsUniformKeys = [...r3d.matchAll(/^\s*(u[A-Z][A-Za-z0-9_]*)\s*:\s*\{/gm)].map((m) => m[1]);
const orphans = jsUniformKeys.filter((k) => !allUniforms.has(k));
ok(orphans.length === 0, 'no uniform is uploaded that the shader no longer declares', orphans.join(', '));

// The GLSL1 fragment output.
ok(/gl_FragColor\s*=/.test(FRAG_CODE), 'FRAG writes gl_FragColor');

/* ---------------------------------------------- fragment-stage built-in misuse */

// These are three.js uniforms, not GLSL built-ins; using them without declaring (or
// receiving) them is the mistake that was made once already.
const BAD = ['cameraPosition', 'modelMatrix', 'viewMatrix', 'cameraWorldMatrix'];
for (const b of BAD) {
  ok(!new RegExp(`\\b${b}\\b`).test(FRAG_CODE), `FRAG does not use ${b} (not a GLSL built-in)`);
  ok(!new RegExp(`\\b${b}\\b`).test(VERT_CODE), `VERT does not use ${b} (not a GLSL built-in)`);
}
// `viewMatrix` IS a three.js built-in uniform, but the shader must not redeclare it and
// must not read it unless it is intentional; assert it is not referenced at all.
ok(!/\bviewMatrix\b/.test(FRAG_CODE + VERT_CODE), 'neither stage reads viewMatrix');
// In GLSL ES 1.00 the fragment stage has no camera position; it is passed as uEye.
ok(/uniform\s+vec3\s+uEye/.test(FRAG_CODE), 'FRAG receives the eye position as uEye');
ok(/\buEye\b/.test(VERT_CODE + FRAG_CODE), 'uEye is used');

/* --------------------------------------------------- per-pixel normal contract */

ok(/uniform\s+sampler2D\s+uHeight/.test(FRAG_CODE), 'FRAG samples a height texture');
ok(/uNormalRes\s*>\s*0\.0/.test(FRAG_CODE), 'FRAG branches on texture availability');
ok(/normalize\(vNormal\)/.test(FRAG_CODE), 'FRAG keeps an interpolated-normal fallback');
ok(/uniform\s+float\s+uNormalRes/.test(FRAG_CODE), 'FRAG exposes the fallback switch');
ok(
  (FRAG_CODE.match(/texture2D\(uHeight/g) || []).length >= 4,
  'FRAG derives the normal from at least four texel taps',
  (FRAG_CODE.match(/texture2D\(uHeight/g) || []).length,
);

/* ------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures.slice(0, 30)) console.log(`  - ${f}`);
  if (failures.length > 30) console.log(`  ... and ${failures.length - 30} more`);
  process.exitCode = 1;
} else {
  console.log('shader sources satisfy every static GLSL invariant checked here');
  console.log('(a real driver is still the only true compiler)');
}
