// Build a work breakdown for the pending Gaea nodes.
//
// Reads the pending-node list and the constant-resolved decompiled node source, then for every
// pending node extracts its `Build()` body and the static helper methods that body calls
// (Profiles.*, Noises.*, Warps.*, ...). The point is to turn "109 nodes left" into groups that
// share one translated helper, so the work can be scheduled by dependency instead of by node.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'evidence', 'decompiled', 'Gaea.Nodes.resolved.cs');
const PENDING = path.join(ROOT, 'docs', 'node-pending.json');

const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split('\n');
const pending = JSON.parse(fs.readFileSync(PENDING, 'utf8'));

// Index class declarations: `public class X : Node` preceded by [Name("...").
const classes = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^\tpublic class (\w+) : Node|^\tinternal class (\w+) : Node|^\tpublic class (\w+) :/.exec(lines[i]);
  if (!m) continue;
  // look back for [Name("...")]
  let name = null;
  for (let j = i; j >= Math.max(0, i - 12); j--) {
    const nm = /\[Name\("([^"]+)"\)\]/.exec(lines[j]);
    if (nm) { name = nm[1]; break; }
  }
  classes.push({ cls: m[1] || m[2] || m[3], name, line: i });
}

const byName = new Map();
for (const c of classes) if (c.name) byName.set(c.name, c);

const getBuild = (startLine) => {
  // find `internal override void Build()` or `protected override void Build()` after class line
  for (let i = startLine; i < Math.min(lines.length, startLine + 4000); i++) {
    if (/override void Build\(\)/.test(lines[i]) || /override void Build\(/.test(lines[i])) {
      // capture until matching brace depth returns to 0
      let depth = 0, started = false, out = [];
      for (let j = i; j < lines.length; j++) {
        out.push(lines[j]);
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; started = true; }
          else if (ch === '}') depth--;
        }
        if (started && depth === 0) break;
      }
      return out.join('\n');
    }
  }
  return null;
};

const helperCall = /\b(Profiles|Noises|Warps|Masks|Gradients|Waters|Surfaces|Morph|Landscapes|Migrated|Scatters|Simulations|Erosions|Others|RandomNoises|Surfacer|Colors|ColorCore|Cartographer|FilterCore|Mosaic|Patterns|AspectMaps|ClassicCombiner|Combiner|Texturize|ErosionWrapper)\s*\.\s*(\w+)\s*\(/g;

const rows = [];
const helperIndex = new Map(); // "Profiles.Shaper" -> [nodes]
const missing = [];

for (const p of pending) {
  const c = byName.get(p.name);
  if (!c) { missing.push(p.name); continue; }
  const build = getBuild(c.line);
  if (!build) { missing.push(p.name + ' (no Build)'); continue; }
  const helpers = new Set();
  let m;
  helperCall.lastIndex = 0;
  while ((m = helperCall.exec(build))) helpers.add(`${m[1]}.${m[2]}`);
  // Also capture `new X().method(` and direct Profile-less calls are left out on purpose.
  rows.push({ name: p.name, line: c.line, cls: c.cls, helpers: [...helpers], body: build });
  for (const h of helpers) {
    if (!helperIndex.has(h)) helperIndex.set(h, []);
    helperIndex.get(h).push(p.name);
  }
}

rows.sort((a, b) => a.helpers.length - b.helpers.length || a.name.localeCompare(b.name));

const out = {
  generatedFrom: 'docs/node-pending.json + evidence/decompiled/Gaea.Nodes.resolved.cs',
  pendingCount: pending.length,
  matchedCount: rows.length,
  missing,
  helpers: [...helperIndex.entries()]
    .map(([h, nodes]) => ({ helper: h, nodeCount: nodes.length, nodes }))
    .sort((a, b) => b.nodeCount - a.nodeCount || a.helper.localeCompare(b.helper)),
  nodes: rows.map(({ name, cls, helpers, body }) => ({ name, cls, helpers, body })),
};
fs.writeFileSync(path.join(ROOT, 'docs', 'node-workbreakdown.json'), JSON.stringify(out, null, 1));

console.log(`pending=${pending.length} matched=${rows.length} missing=${missing.length}`);
if (missing.length) console.log('missing:', missing.join(', '));
console.log(`\ndistinct shared helpers: ${helperIndex.size}`);
console.log('top helpers by node count:');
for (const h of out.helpers.slice(0, 30)) console.log(`  ${String(h.nodeCount).padStart(3)}  ${h.helper}`);
const standalone = rows.filter((r) => r.helpers.length === 0);
console.log(`\nnodes with NO shared helper (self-contained Build): ${standalone.length}`);
for (const s of standalone.slice(0, 40)) console.log('  ' + s.name);
