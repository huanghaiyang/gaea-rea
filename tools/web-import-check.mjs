#!/usr/bin/env node
// Static import checker for the zero-build web app.
//
// The web implementation is plain ES modules with no bundler, so a missing or
// misspelled named export only surfaces at runtime in the browser. This script
// dynamically imports every module under web/js and reports failures, which
// catches exactly that class of defect from the command line.
//
// Usage: node web-import-check.mjs [webRoot]

import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const webRoot = path.resolve(process.argv[2] ?? "D:/sgames/gaea-rea/web");

async function collect(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collect(full)));
    else if (e.name.endsWith(".js") || e.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const files = (await collect(webRoot)).sort();
let ok = 0;
const failures = [];

for (const f of files) {
  try {
    await import(pathToFileURL(f).href);
    ok++;
  } catch (err) {
    failures.push({ file: path.relative(webRoot, f), error: `${err.constructor.name}: ${err.message}` });
  }
}

console.log(`imported ok : ${ok}/${files.length}`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  ${f.file}\n      ${f.error}`);
  process.exitCode = 1;
} else {
  console.log("all modules import cleanly");
}
