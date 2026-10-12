/**
 * i18n-test.mjs — verifies the localisation layer actually renders Chinese.
 *
 * The dictionary files are data; the risk is in the lookup and fallback logic.
 * This test loads the REAL dictionaries from disk (by stubbing fetch), drives the
 * real i18n.js through its public API, and asserts on rendered output.
 *
 * Run: node web/tests/i18n-test.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');

let pass = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) {
    pass++;
  } else {
    failures.push(`${label}${detail !== undefined ? ` — got ${JSON.stringify(detail)}` : ''}`);
  }
}

/* --------------------------------------------------------------- environment */

// localStorage / navigator stubs, wired to report Chinese so detection is exercised.
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
// navigator is a read-only global in Node 22, so it must be redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  value: { languages: ['zh-CN', 'zh'], language: 'zh-CN' },
  configurable: true,
  writable: true,
});
globalThis.document = {
  documentElement: { lang: 'en' },
  querySelectorAll: () => [],
};

// fetch() reads from web/ so the real dictionary files are used. Installed as a
// function so it can be re-established after installDomShim() replaces the global.
const diskFetch = async (url) => {
  const rel = String(url).replace(/^\.?\//, '');
  try {
    const text = await readFile(path.join(WEB, rel), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch (err) {
    return { ok: false, status: 404, json: async () => { throw err; } };
  }
};
globalThis.fetch = diskFetch;

const i18n = await import(new URL('../js/i18n.js', import.meta.url).href);

/* ------------------------------------------------------------------ tests */

const lang = await i18n.initI18n();
ok(lang === 'zh', 'browser language zh-CN is detected as Chinese', lang);

ok(i18n.isTranslated(), 'translation layer reports active');

// Interface chrome
ok(i18n.t('toolbar.export', 'Export PNG') === '导出 PNG', 'toolbar.export translated', i18n.t('toolbar.export'));
ok(i18n.t('library.title', 'Node Library') === '节点库', 'library.title translated');
ok(i18n.t('inspector.tabParams', 'Parameters') === '参数', 'inspector.tabParams translated');

// t() falls back to the supplied English when a key is absent
ok(i18n.t('no.such.key', 'Fallback') === 'Fallback', 'missing ui key falls back to English');

// Node names
ok(i18n.term('MultiFractal') === '多重分形', 'node name translated', i18n.term('MultiFractal'));
ok(i18n.term('Erosion') === '侵蚀', 'node name Erosion translated', i18n.term('Erosion'));
ok(i18n.term('Warp') === '扭曲', 'node name Warp translated', i18n.term('Warp'));
ok(i18n.term('CLUTer') === '色彩查找表', 'node name CLUTer translated', i18n.term('CLUTer'));

// Unknown node name must pass through unchanged, never blank
ok(i18n.term('NotARealNode') === 'NotARealNode', 'unknown node name passes through', i18n.term('NotARealNode'));
ok(i18n.term('') === '', 'empty node name is safe');

// Parameter labels (separate namespace)
ok(i18n.paramLabel('Rock Softness') === '岩石软度', 'param label translated', i18n.paramLabel('Rock Softness'));
ok(i18n.paramLabel('Downcutting') === '下切', 'param label Downcutting translated');
ok(i18n.paramLabel('Sediment Removal') === '沉积物移除', 'param label Sediment Removal translated');

// The four role-divergent names must differ between the two namespaces
const rolePairs = [
  ['Steps', '阶地', '阶数'],
  ['Peaks', '峰群', '峰数'],
  ['Layers', '图层', '图层数'],
  ['Variation', '变化', '变化量'],
];
for (const [key, nodeVal, paramVal] of rolePairs) {
  ok(i18n.term(key) === nodeVal, `node role: ${key} -> ${nodeVal}`, i18n.term(key));
  ok(i18n.paramLabel(key) === paramVal, `param role: ${key} -> ${paramVal}`, i18n.paramLabel(key));
  ok(i18n.term(key) !== i18n.paramLabel(key), `${key} differs between roles`);
}

// Unknown parameter name passes through
ok(i18n.paramLabel('SomeUnknownParam') === 'SomeUnknownParam', 'unknown param passes through');

// Every vocabulary entry is covered in its own namespace (no silent English holes)
const vocab = JSON.parse(await readFile(path.join(WEB, 'data', 'i18n-vocab.json'), 'utf8'));
const termsDict = JSON.parse(await readFile(path.join(WEB, 'data', 'i18n-terms.zh.json'), 'utf8'));

const missingNodes = vocab.nodeNames.filter((n) => !(n in termsDict.terms));
const missingGroups = vocab.groups.filter((g) => !(g in termsDict.terms));
const missingParams = vocab.paramNames.filter((p) => !(p in termsDict.paramNames));
ok(missingNodes.length === 0, `all ${vocab.nodeNames.length} node names translated`, missingNodes.slice(0, 5));
ok(missingGroups.length === 0, `all ${vocab.groups.length} group names translated`, missingGroups.slice(0, 5));
ok(missingParams.length === 0, `all ${vocab.paramNames.length} param names translated`, missingParams.slice(0, 5));

// No blank translations anywhere
const blanks = [];
for (const [ns, dict] of Object.entries(termsDict)) {
  if (ns.startsWith('_') || typeof dict !== 'object') continue;
  for (const [k, v] of Object.entries(dict)) {
    if (!String(v).trim()) blanks.push(`${ns}.${k}`);
  }
}
ok(blanks.length === 0, 'no blank translations', blanks.slice(0, 5));

// English mode must return the source strings untouched
await i18n.setLang('en');
ok(i18n.term('MultiFractal') === 'MultiFractal', 'English mode leaves node names unchanged', i18n.term('MultiFractal'));
ok(i18n.paramLabel('Rock Softness') === 'Rock Softness', 'English mode leaves params unchanged');
ok(i18n.t('toolbar.export', 'Export PNG') === 'Export PNG', 'English mode leaves ui strings unchanged');

// Switching back must re-translate (cache must not pin the previous language)
await i18n.setLang('zh');
ok(i18n.term('MultiFractal') === '多重分形', 'switching back to zh re-translates', i18n.term('MultiFractal'));

/* ------------------------------------------------- DOM attribute application */

// Regression: applyDocument() must walk real elements carrying data-i18n-* and
// must not use element.dataset for its memo. A property name derived from
// 'aria-label' is not a valid DOMStringMap key, so a dataset-based memo throws
// "Failed to set a named property 'i18nSrcaria-label' on 'DOMStringMap'" and the
// application fails to start. The DOM shim now enforces the real constraint, so
// this test fails loudly if that mistake returns.
const { installDomShim } = await import('./dom-shim.mjs');
const shim = installDomShim({ url: 'http://127.0.0.1:8080/', catalog: { nodes: [] } });
const doc = shim.document;
const host = doc.createElement('div');

// installDomShim() replaces the global fetch with its own router; put the
// disk-backed one back so the dictionaries still load for this section.
globalThis.fetch = diskFetch;

// Ensure Chinese is active for the assertions below.
await i18n.setLang('zh');

const byText = doc.createElement('span');
byText.setAttribute('data-i18n', 'library.title');
byText.textContent = 'Node Library';

const byAria = doc.createElement('div');
byAria.setAttribute('data-i18n-aria', 'library.nodesAria');
byAria.setAttribute('aria-label', 'Nodes');

const byTitle = doc.createElement('button');
byTitle.setAttribute('data-i18n-title', 'toolbar.exportTitle');
byTitle.title = 'Export the evaluated height field as PNG';

const byPlaceholder = doc.createElement('input');
byPlaceholder.setAttribute('data-i18n-placeholder', 'library.searchPlaceholder');
byPlaceholder.placeholder = 'Search 182 nodes…';

for (const el of [byText, byAria, byTitle, byPlaceholder]) host.appendChild(el);

let threw = null;
try {
  i18n.applyDocument(host);
} catch (err) {
  threw = err;
}
ok(threw === null, 'applyDocument does not throw on data-i18n-* elements', threw && threw.message);
ok(byText.textContent === '节点库', 'data-i18n rewrites textContent', byText.textContent);
ok(byAria.getAttribute('aria-label') === '节点列表', 'data-i18n-aria rewrites aria-label', byAria.getAttribute('aria-label'));
ok(byTitle.title === '将求值后的高度场导出为 PNG', 'data-i18n-title rewrites title', byTitle.title);
ok(byPlaceholder.placeholder === '搜索 182 个节点…', 'data-i18n-placeholder rewrites placeholder', byPlaceholder.placeholder);

// A second pass must be stable (the original text is remembered, not re-captured
// from the already-translated value).
i18n.applyDocument(host);
ok(byText.textContent === '节点库', 'second applyDocument pass is stable', byText.textContent);

// Switching to English must restore the authored markup text exactly.
await i18n.setLang('en');
i18n.applyDocument(host);
ok(byText.textContent === 'Node Library', 'English restores authored text', byText.textContent);
ok(byAria.getAttribute('aria-label') === 'Nodes', 'English restores authored aria-label', byAria.getAttribute('aria-label'));
ok(byTitle.title === 'Export the evaluated height field as PNG', 'English restores authored title', byTitle.title);
ok(byPlaceholder.placeholder === 'Search 182 nodes…', 'English restores authored placeholder', byPlaceholder.placeholder);

/* ------------------------------------------------------------------ report */

console.log('');
console.log('='.repeat(64));
console.log(`PASS ${pass}  FAIL ${failures.length}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('all i18n assertions passed');
}
