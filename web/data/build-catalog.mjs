/**
 * build-catalog.mjs — regenerates web/data/nodes.json from the Gaea 2 node definition dump.
 *
 * Source : "D:\Gaea 2\Resources\Nodes.json" (UTF-8, 420 KB, 182 node definitions, 1341 parameter entries)
 * Target : web/data/nodes.json  (compact, browser-friendly catalog)
 *
 * Run:  node web/data/build-catalog.mjs "D:\Gaea 2\Resources\Nodes.json"
 *
 * This script is the ONLY place that knows about the vendor JSON shape.  The web app never
 * reads the vendor file; it reads the generated catalog.  Regenerating is idempotent.
 *
 * Vendor shape (verified against the shipped file):
 *   [ { "Name": "Accumulator",
 *       "Description": "...",
 *       "Flubs": [ { "Name": "Type", "Description": "...", "Type": "Enum",
 *                    "Flubs": [ { "Name": "SnowMask", "Description": "...", "Type": "EnumValue" } ] } ] } ]
 *
 * Observed type vocabulary across all 1341 entries:
 *   Single 600, Enum 187, Int32 178, Boolean 158, <missing> 126, Float2 31,
 *   Command 20, String 17, Byte 13, Color 8, List`1 3
 *   The 126 entries with no "Type" are *section headers* (UI groups): every one of them has an
 *   empty/missing "Flubs" child list and its name matches the name of an enclosing group. They are
 *   preserved as groups so the parameter panel can reproduce Gaea's grouping, and are not value params.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = 'D:\\Gaea 2\\Resources\\Nodes.json';
/** Optional, richer sibling evidence: parameter attributes recovered from the assembly IL. */
const DEFAULT_SPECS = resolve(HERE, '..', '..', 'docs', 'node-specs-from-il.json');
const OUT = join(HERE, 'nodes.json');

/** Map a vendor type string to our normalized control kind. */
function controlFor(vendorType, children) {
  switch (vendorType) {
    case 'Single': return 'slider';
    case 'Int32': return 'number';
    case 'Byte': return 'number';
    case 'Boolean': return 'toggle';
    case 'Enum': return 'select';
    case 'EnumValue': return 'option';
    case 'Color': return 'color';
    case 'Float2': return 'vector2';
    case 'String': return 'text';
    case 'Command': return 'command';
    case 'List`1': return 'list';
    default:
      // No type + no children => section header. No type + children => treat as enum-ish group.
      if (!children || children.length === 0) return 'group';
      return 'select';
  }
}

function convertParam(p) {
  const kids = Array.isArray(p.Flubs) ? p.Flubs : [];
  // Enum values are the EnumValue children of an Enum parameter.
  const isEnum = p.Type === 'Enum' || (p.Type === undefined && kids.length > 0);
  const options = isEnum ? kids.filter((k) => k.Type === 'EnumValue' || !k.Type) : [];
  return {
    name: p.Name,
    type: p.Type ?? null,             // exact vendor token, null when the vendor omitted it
    control: controlFor(p.Type, kids),
    description: p.Description || '',
    ...(isEnum ? { options: options.map((o) => o.Name) } : {}),
    ...(isEnum && options.some((o) => o.Description)
      ? { optionDescriptions: options.map((o) => o.Description || '') }
      : {}),
  };
}

/* --------------------------------------------------------------- IL enrichment */

/** Normalise a name for cross-source matching: lowercase, strip everything non-alphanumeric. */
const nrm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Load docs/node-specs-from-il.json when it exists and index it by node name.
 *
 * The IL dump carries the *actual* `[Parameter(default, min, max)]` attribute arguments that
 * Gaea hands its own UI, which is strictly better evidence than a guess. Its values are raw C#
 * literals ("0.3f", "true", "MapGradientStyle.Smooth"), so each one is validated against the
 * catalog's declared type before use: a value that does not fit the type is discarded rather
 * than trusted. This matters because the IL argument order is not reliably (default, min, max)
 * for every parameter kind (enum/boolean entries routinely carry (default, 0f, 1f)).
 */
function loadSpecs(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    process.stderr.write(`  (could not read IL specs: ${err.message})\n`);
    return map;
  }
  for (const n of (parsed.nodes || [])) {
    if (!n || !n.node_name) continue;
    const byName = new Map();
    for (const p of (n.parameters || [])) {
      byName.set(nrm(p.name), p);
      if (p.ui_name) byName.set(nrm(p.ui_name), p);
    }
    map.set(n.node_name, { byName, family: n.family || null, baseClass: n.base_class || null });
  }
  return map;
}

/** Parse a raw C# literal into a JS value. Returns undefined when it is not usable. */
function parseLiteral(raw) {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (/^-?\d+(\.\d+)?[fdmFDM]?$/.test(s)) {
    const v = parseFloat(s.replace(/[fdmFDM]$/, ''));
    return Number.isFinite(v) ? v : undefined;
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  // symbolic enum member such as "MapGradientStyle.Smooth" -> "Smooth"
  const dot = s.lastIndexOf('.');
  if (dot > 0 && /^[A-Za-z_][\w.]*$/.test(s)) return s.slice(dot + 1);
  return undefined;
}

/**
 * Apply IL-derived default/min/max onto one converted parameter, in place.
 * Only values that are consistent with the declared type are accepted.
 */
function enrich(c, spec) {
  const il = spec.byName.get(nrm(c.name));
  if (!il) return null;
  const isBool = c.type === 'Boolean';
  const isEnum = c.type === 'Enum';
  const isNumericish = c.type === 'Single' || c.type === 'Int32' || c.type === 'Byte' || c.type === 'Float2';

  const dflt = parseLiteral(il.default);
  const lo = parseLiteral(il.minimum);
  const hi = parseLiteral(il.maximum);
  const out = {};

  if (isBool) {
    if (typeof dflt === 'boolean') out.default = dflt;
    return out;
  }
  if (isEnum) {
    if (typeof dflt === 'string' && Array.isArray(c.options) && c.options.length) {
      // only accept a symbolic default that is actually one of the declared options
      const hit = c.options.find((o) => nrm(o) === nrm(dflt));
      if (hit) out.default = hit;
    }
    return out;
  }
  if (!isNumericish) return null;

  if (typeof dflt === 'number') out.default = dflt;
  // A range is only used when both ends parsed as numbers and they bracket the default.
  if (typeof lo === 'number' && typeof hi === 'number' && hi > lo) {
    const ref = typeof out.default === 'number' ? out.default : (typeof dflt === 'number' ? dflt : null);
    if (ref === null || (ref >= lo - 1e-6 && ref <= hi + 1e-6)) {
      out.min = lo;
      out.max = hi;
    }
  }
  return out;
}

function main() {
  const src = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SRC;
  const raw = JSON.parse(readFileSync(src, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('expected a top-level array');

  // Optional enrichment: real default/min/max recovered from the assembly IL.
  const specs = loadSpecs(process.argv[3] ? resolve(process.argv[3]) : DEFAULT_SPECS);
  const enrichStats = { nodes: 0, params: 0, defaults: 0, ranges: 0 };

  const nodes = [];
  const typeHistogram = {};
  const controlHistogram = {};
  let paramTotal = 0;
  let groupTotal = 0;

  for (const n of raw) {
    const params = [];
    const groups = [];
    // NOTE: the vendor dump uses PascalCase keys ("Name"), not camelCase.
    const spec = specs.get(n.Name) || null;
    if (spec) enrichStats.nodes++;
    for (const p of (n.Flubs || [])) {
      const c = convertParam(p);
      typeHistogram[c.type ?? '(none)'] = (typeHistogram[c.type ?? '(none)'] || 0) + 1;
      controlHistogram[c.control] = (controlHistogram[c.control] || 0) + 1;
      if (c.control === 'group' || c.control === 'command' || c.control === 'list') {
        // Structural / non-value entries: keep in `groups` for UI fidelity, out of `params`.
        groups.push(c);
        groupTotal++;
      } else {
        if (spec) {
          const e = enrich(c, spec);
          if (e) {
            enrichStats.params++;
            if (e.default !== undefined) { c.ilDefault = e.default; enrichStats.defaults++; }
            if (e.min !== undefined && e.max !== undefined) {
              c.ilMin = e.min;
              c.ilMax = e.max;
              enrichStats.ranges++;
            }
          }
        }
        params.push(c);
        paramTotal++;
      }
    }
    nodes.push({
      name: n.Name,
      description: n.Description || '',
      params,
      groups: groups.map((g) => g.name),
      groupDetails: groups.filter((g) => g.description).map((g) => ({ name: g.name, description: g.description })),
    });
  }

  nodes.sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    $schema: 'gaea-web-nodes/1',
    source: { file: src, nodeCount: raw.length, paramEntries: raw.reduce((a, n) => a + (n.Flubs || []).length, 0) },
    enrichment: specs.size
      ? {
        file: process.argv[3] ? resolve(process.argv[3]) : DEFAULT_SPECS,
        nodesMatched: enrichStats.nodes,
        paramsMatched: enrichStats.params,
        defaultsFromIl: enrichStats.defaults,
        rangesFromIl: enrichStats.ranges,
      }
      : null,
    stats: {
      nodes: nodes.length,
      valueParams: paramTotal,
      structuralEntries: groupTotal,
      allParamEntries: paramTotal + groupTotal,
      typeHistogram,
      controlHistogram,
    },
    nodes,
  };

  writeFileSync(OUT, JSON.stringify(out), 'utf8');
  process.stdout.write(
    `wrote ${OUT}\n  nodes=${out.stats.nodes} valueParams=${paramTotal} structural=${groupTotal}\n` +
    `  types=${JSON.stringify(typeHistogram)}\n  controls=${JSON.stringify(controlHistogram)}\n` +
    (out.enrichment
      ? `  IL enrichment: ${out.enrichment.paramsMatched} params matched, ` +
        `${out.enrichment.defaultsFromIl} defaults, ${out.enrichment.rangesFromIl} min/max pairs\n`
      : '  IL enrichment: no spec file found, using declared types only\n')
  );
}

main();
