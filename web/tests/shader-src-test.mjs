/**
 * shader-src-test.mjs — static checks on the GLSL used by the 3D preview.
 *
 * A browser is the only real GLSL compiler, and it is not available here. But most
 * mistakes that make a WebGL2 shader fail to compile are structural, and a failed
 * compile means no 3D at all — the highest-severity outcome. So this asserts the
 * invariants that a driver would reject:
 *
 *   - `#version 300 es` is the first token (a preceding newline or comment is an error)
 *   - braces and parentheses balance
 *   - every identifier used as a function is one GLSL ES 3.0 actually provides, and
 *     the constructors used are real types
 *   - every uniform/attribute set from JS is declared, and every declared uniform is set
 *   - vertex outputs and fragment inputs agree in name and type
 *   - no built-in is referenced that does not exist in the fragment stage
 *     (cameraPosition was exactly this mistake)
 *
 * Run: node web/tests/shader-src-test.mjs
 */

import { SHADER_VERT, SHADER_FRAG } from '../js/viewport.js';

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) pass++;
  else failures.push(`${label}${detail !== undefined ? ` — ${detail}` : ''}`);
}

/* ------------------------------------------------------------------ helpers */

/**
 * Strip comments in one pass. A regex per comment kind would corrupt the source:
 * removing `//` to end-of-line first would also eat the `//` inside a block comment,
 * and vice versa. Comments matter here because prose like "normals (see below)"
 * otherwise looks like a function call.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== '*/') i++;
      i += 2;
      continue;
    }
    out += src[i++];
  }
  return out;
}

function body(src) {
  const version = src.match(/^#version\s+300\s+es\b/);
  return { hasVersionFirst: !!version, rest: version ? src.slice(version[0].length) : src };
}

const declared = (src, kind) => {
  const out = new Map();
  const re = new RegExp(`^\\s*${kind}\\s+([a-zA-Z0-9_]+)\\s+([a-zA-Z0-9_]+)\\s*;`, 'gm');
  let m;
  while ((m = re.exec(src))) out.set(m[2], m[1]);
  return out;
};

const usedFunctions = (src) => {
  const names = new Set();
  const re = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) names.add(m[1]);
  // Keywords and casts that are types, not functions.
  for (const kw of ['if', 'for', 'while', 'return', 'switch', 'layout', 'vec2', 'vec3', 'vec4',
    'mat2', 'mat3', 'mat4', 'float', 'int', 'uint', 'bool', 'main']) {
    names.delete(kw);
  }
  return names;
};

// Built-ins this shader is allowed to call in GLSL ES 3.00.
const ALLOWED = new Set([
  'normalize', 'max', 'min', 'clamp', 'mix', 'step', 'smoothstep', 'pow', 'sqrt',
  'abs', 'floor', 'ceil', 'fract', 'sin', 'cos', 'tan', 'atan', 'exp', 'log',
  'texture', 'textureLod', 'dot', 'cross', 'length', 'distance', 'reflect', 'refract',
  'sign', 'mod', 'radians', 'degrees', 'inversesqrt',
]);

// Names declared as functions anywhere in the source (helpers the shader defines).
function declaredFunctions(src) {
  const out = new Set();
  const re = /^\s*(?:vec[234]|float|int|void|bool|mat[234])\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/* --------------------------------------------------------------- both stages */

for (const [name, rawSrc] of [['VERT', SHADER_VERT], ['FRAG', SHADER_FRAG]]) {
  const { hasVersionFirst } = body(rawSrc);
  ok(hasVersionFirst, `${name}: #version 300 es is the very first token`);

  const src = stripComments(rawSrc);
  const open = (src.match(/\{/g) || []).length;
  const close = (src.match(/\}/g) || []).length;
  ok(open === close, `${name}: braces balance`, `${open} vs ${close}`);

  const po = (src.match(/\(/g) || []).length;
  const pc = (src.match(/\)/g) || []).length;
  ok(po === pc, `${name}: parentheses balance`, `${po} vs ${pc}`);

  ok(/\bvoid\s+main\s*\(\s*\)/.test(src), `${name}: defines void main()`);
  ok(/precision\s+(highp|mediump|lowp)\s+float\s*;/.test(src), `${name}: declares float precision`);

  // `in`/`out` declarations must be complete statements.
  const bareInOut = /\b(in|out)\s*;/.test(src);
  ok(!bareInOut, `${name}: no dangling in/out declaration`);

  // Function calls must be built-ins, local helpers, or type constructors.
  const fns = usedFunctions(src);
  const local = declaredFunctions(src);
  const unknown = [...fns].filter((f) => !ALLOWED.has(f) && !local.has(f));
  ok(unknown.length === 0, `${name}: every called function exists in GLSL ES 3.00`, unknown.join(', '));
}

/* ------------------------------------------- stage interface must agree */

const vOut = declared(SHADER_VERT, 'out');
const fIn = declared(SHADER_FRAG, 'in');

for (const [n, type] of vOut) {
  ok(fIn.has(n), `FRAG declares an input for VERT output ${n}`, [...fIn.keys()].join(', '));
  if (fIn.has(n)) ok(fIn.get(n) === type, `${n} has the same type in both stages`, `${type} vs ${fIn.get(n)}`);
}
for (const [n] of fIn) {
  ok(vOut.has(n), `VERT declares an output for FRAG input ${n}`, [...vOut.keys()].join(', '));
}

/* --------------------------------------- uniforms: declared, located, and set */

const vUniforms = declared(SHADER_VERT, 'uniform');
const fUniforms = declared(SHADER_FRAG, 'uniform');
const allUniforms = new Map([...vUniforms, ...fUniforms]);

// Names the JS actually looks up, read back out of the setter calls.
import { readFile } from 'node:fs/promises';
const vpSrc = await readFile(new URL('../js/viewport.js', import.meta.url), 'utf8');

/**
 * Uniform locations are collected as (shader name -> JS key) pairs, because the JS
 * object uses shorter keys (`uEye` -> `eye`). Pairing them lets both directions be
 * checked: a declared uniform must be looked up, and a looked-up uniform must be
 * assigned in draw().
 */
const locPairs = [...vpSrc.matchAll(/getUniformLocation\(prog,\s*'([^']+)'\)/g)]
  .map((m) => ({ shader: m[1], jsKey: null }));
// Re-derive the JS key from the object literal around each call.
{
  const block = vpSrc.slice(vpSrc.indexOf('this.loc = {'), vpSrc.indexOf('};', vpSrc.indexOf('this.loc = {')));
  for (const m of block.matchAll(/([a-zA-Z0-9_]+)\s*:\s*gl\.getUniformLocation\(prog,\s*'([^']+)'\)/g)) {
    const entry = locPairs.find((p) => p.shader === m[2]);
    if (entry) entry.jsKey = m[1];
  }
}

for (const p of locPairs) {
  ok(
    allUniforms.has(p.shader),
    `JS looks up ${p.shader}, which the shader declares`,
    [...allUniforms.keys()].join(', '),
  );
  ok(!!p.jsKey, `${p.shader} is stored under a loc key`);
  if (p.jsKey) {
    // Assigned somewhere in the class, not merely declared in the loc object.
    const assign = new RegExp(`this\\.loc\\.${p.jsKey}\\b`);
    ok(assign.test(vpSrc), `loc.${p.jsKey} is used when setting uniforms`);
  }
}

for (const n of allUniforms.keys()) {
  ok(
    locPairs.some((p) => p.shader === n),
    `uniform ${n} is looked up from JS`,
    locPairs.map((p) => p.shader).join(', '),
  );
}

/* -------------------------------------- uniform declarations vs actual use */

for (const [n] of allUniforms) {
  const uses = (SHADER_VERT + SHADER_FRAG).split(new RegExp(`\\b${n}\\b`)).length - 1;
  // One occurrence is the declaration itself; anything more means it is read.
  ok(uses >= 2, `uniform ${n} is actually used, not just declared`, `mentions: ${uses}`);
}

/* ---------------------------------------------- fragment-stage built-in misuse */

// GLSL ES 3.0 fragment stage exposes gl_FragCoord, gl_FrontFacing and gl_PointCoord.
// Anything else that looks like a built-in is a bug, and cameraPosition was exactly
// such a mistake (it is a three.js uniform, not a GLSL built-in).
const BAD_BUILTINS = ['cameraPosition', 'modelMatrix', 'viewMatrix', 'projectionMatrix',
  'modelViewMatrix', 'normalMatrix', 'cameraWorldMatrix'];
// Comments must be stripped first: this file's own explanatory comment about
// cameraPosition would otherwise trip the check it documents.
const FRAG_CODE = stripComments(SHADER_FRAG);
const VERT_CODE = stripComments(SHADER_VERT);
for (const b of BAD_BUILTINS) {
  ok(!new RegExp(`\\b${b}\\b`).test(FRAG_CODE), `FRAG does not use ${b} (not a GLSL built-in)`);
  ok(!new RegExp(`\\b${b}\\b`).test(VERT_CODE), `VERT does not use ${b} (not a GLSL built-in)`);
}

/* --------------------------------------------------- per-pixel normal contract */

// The whole point of the change: normals must come from the height texture when it is
// available, and the fallback must still exist.
ok(/uniform\s+sampler2D\s+uHeight/.test(SHADER_FRAG), 'FRAG samples a height texture');
ok(/uNormalRes\s*>\s*0\.0/.test(SHADER_FRAG), 'FRAG branches on texture availability');
ok(/normalize\(vNormal\)/.test(SHADER_FRAG), 'FRAG keeps an interpolated-normal fallback');
ok(/uniform\s+float\s+uNormalRes/.test(SHADER_FRAG), 'FRAG exposes the fallback switch');

// The fragment stage must not depend on a per-vertex normal alone.
ok(
  (SHADER_FRAG.match(/texture\(uHeight/g) || []).length >= 4,
  'FRAG derives the normal from at least four texel taps',
  (SHADER_FRAG.match(/texture\(uHeight/g) || []).length,
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
