/**
 * dump-schema.mjs — print the EFFECTIVE parameter schema for every catalogue node.
 *
 * Why this exists: `tools/param-audit.py` originally scanned the registry SOURCE for
 * `d`/`min`/`max` literals. Once `buildSchema` began applying `param-authority.js` at runtime,
 * the source literals stopped being what the app uses, so the audit kept reporting the same
 * 113 divergences no matter how many were actually fixed — it was measuring the hand-written
 * values that the authority table deliberately overrides.
 *
 * This dumps what a kernel and the UI actually see, which is the only thing worth auditing.
 *
 * Usage:  node tools/dump-schema.mjs [outputPath]
 *
 * The file is written by Node rather than through a shell redirect, because PowerShell's `>`
 * emits UTF-16 and the Python reader in tools/param-audit.py expects UTF-8. Passing the path
 * as an argument also keeps the JSON out of the terminal, where it is 360 KB of noise.
 */

import { buildSchema, resolveEntry } from '../web/js/registry.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  readFileSync(join(here, '..', 'web', 'data', 'nodes.json'), 'utf-8'),
);

const out = {};
for (const node of catalog.nodes) {
  const entry = resolveEntry(node.name);
  const schema = buildSchema(node, entry || {});
  out[node.name] = {};
  for (const p of schema) {
    // `key` is the storage identity; `name` is the label. Record both because the authority
    // table is keyed by the C# property name, which may match neither.
    out[node.name][p.key] = {
      name: p.name,
      d: p.value,
      min: p.min,
      max: p.max,
      step: p.step,
      // Provenance, so the audit can tell an authoritative value from a fallback. The field
      // names come from mergeParam's `source: { default, range }`.
      source: p.source ? p.source.default : null,
      rangeSource: p.source ? p.source.range : null,
    };
  }
}

const json = JSON.stringify(out, null, 2) + '\n';
const target = process.argv[2];
if (target) {
  writeFileSync(target, json, 'utf-8');
  const keys = Object.keys(out).length;
  let params = 0;
  for (const k of Object.keys(out)) params += Object.keys(out[k]).length;
  console.log(`  effective schema: ${keys} nodes, ${params} parameters -> ${target}`);
} else {
  process.stdout.write(json);
}
