/**
 * i18n.js — display-layer localisation.
 *
 * Design rule: the application keeps using the real Gaea identifiers internally
 * (node names, parameter names, group names). Translation happens only where a
 * string is rendered. That keeps evaluation, caching and graph logic completely
 * unaffected by language.
 *
 * Two dictionaries:
 *   i18n-ui.json    interface chrome, keyed by a stable string id
 *   i18n-terms.json node / parameter / group / enum names and descriptions
 *
 * Lookup order for any translated string:
 *   requested language -> English -> the source string itself
 * so a missing translation degrades to readable text, never to a blank.
 */

const DEFAULT_LANG = 'en';
const SUPPORTED = ['en', 'zh'];

/** @type {{lang: string, ui: Record<string,string>, terms: Record<string,string>}} */
const store = {
  lang: DEFAULT_LANG,
  /** English baseline, always present (the source strings themselves). */
  ui: {},
  terms: {},
};

/** Cached term dictionaries per language. */
const termCache = new Map();
let ready = false;

/* ------------------------------------------------------------------ language */

/** Detect the initial language: explicit choice > browser preference > English. */
function detectLang() {
  try {
    const saved = localStorage.getItem('gaea.lang');
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch {
    /* storage unavailable (private mode) — fall through */
  }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return /^zh\b/i.test(nav) ? 'zh' : DEFAULT_LANG;
}

/* -------------------------------------------------------------------- loading */

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Load the interface dictionary for a language. Missing files are tolerated so
 * the app still runs if a translation has not been authored yet.
 */
async function loadUi(lang) {
  if (lang === DEFAULT_LANG) return {};
  try {
    return await fetchJson(`data/i18n-ui.${lang}.json`);
  } catch (err) {
    console.warn(`i18n: ui dictionary for "${lang}" unavailable`, err.message);
    return {};
  }
}

async function loadTerms(lang) {
  if (termCache.has(lang)) return termCache.get(lang);
  let raw = {};
  if (lang !== DEFAULT_LANG) {
    try {
      raw = await fetchJson(`data/i18n-terms.${lang}.json`);
    } catch (err) {
      console.warn(`i18n: term dictionary for "${lang}" unavailable`, err.message);
      raw = {};
    }
  }
  // Keep node/group names and parameter names in separate namespaces. A handful
  // of terms are both (Steps, Peaks, Layers), and they need different renderings
  // in the two roles, so one flat table would force a wrong choice.
  const dict = {
    terms: raw.terms ?? {},
    params: raw.paramNames ?? raw.params ?? {},
    descriptions: raw.descriptions ?? {},
    options: raw.options ?? {},
  };
  termCache.set(lang, dict);
  return dict;
}

/**
 * Initialise i18n. Safe to call before the first render; every lookup still
 * works (returning source strings) if the dictionaries are absent.
 */
export async function initI18n() {
  store.lang = detectLang();
  store.ui = await loadUi(store.lang);
  store.terms = await loadTerms(store.lang);
  ready = true;
  applyDocument();
  return store.lang;
}

/* --------------------------------------------------------------------- lookup */

/**
 * Translate an interface string by id.
 * @param {string} id stable key, e.g. 'toolbar.new'
 * @param {string} [fallback] English text used when no translation exists
 */
export function t(id, fallback) {
  if (!ready || store.lang === DEFAULT_LANG) return fallback ?? id;
  return store.ui[id] ?? fallback ?? id;
}

/**
 * Translate a node or group name.
 *
 * Technical identifiers deliberately fall back to English when no translation is
 * authored, because a wrong or invented rendering is worse than the original:
 * the user must still be able to match what they see against Gaea itself.
 */
export function term(name) {
  if (!name) return name;
  if (!ready || store.lang === DEFAULT_LANG) return name;
  return store.terms.terms?.[name] ?? name;
}

/**
 * Translate a parameter label. Separate from term() because some names exist in
 * both roles with different meanings (Steps is a node "阶地" but a parameter "阶数").
 *
 * Named paramLabel rather than param so importing modules can keep using `param`
 * as a local variable without shadowing this function.
 */
export function paramLabel(name) {
  if (!name) return name;
  if (!ready || store.lang === DEFAULT_LANG) return name;
  return store.terms.params?.[name] ?? store.terms.terms?.[name] ?? name;
}

/** Translate a description string (node / parameter / enum option). */
export function desc(text) {
  if (!text) return text;
  if (!ready || store.lang === DEFAULT_LANG) return text;
  return store.terms.descriptions?.[text] ?? text;
}

/** Translate an enum option value, which may also be a display label. */
export function option(value) {
  if (!value) return value;
  if (!ready || store.lang === DEFAULT_LANG) return value;
  return store.terms.options?.[value] ?? value;
}

export function currentLang() {
  return store.lang;
}

export function isTranslated() {
  return ready && store.lang !== DEFAULT_LANG;
}

/* --------------------------------------------------------------- DOM plumbing */

/**
 * Apply dictionary entries to elements carrying data-i18n attributes:
 *   data-i18n="key"            -> textContent
 *   data-i18n-title="key"      -> title
 *   data-i18n-placeholder="key"-> placeholder
 *   data-i18n-aria="key"       -> aria-label
 * The element's original text is used as the English fallback, so the markup
 * stays readable and a missing key is harmless.
 */
export function applyDocument(root = document) {
  const attrMap = [
    ['data-i18n', 'textContent'],
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria', 'aria-label'],
  ];
  for (const [attr, prop] of attrMap) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = el.getAttribute(attr);
      // Remember the authored English text once, so switching back is exact.
      const memo = `i18nSrc${prop}`;
      if (el.dataset[memo] === undefined) {
        el.dataset[memo] = el[prop] ?? '';
      }
      const fallback = el.dataset[memo];
      el[prop] = t(key, fallback);
    }
  }
  document.documentElement.lang = store.lang === 'zh' ? 'zh-CN' : 'en';
}

/**
 * Switch language and persist the choice.
 *
 * Reloading is deliberate: labels are generated in several places, and
 * re-rendering every panel through a translation pass is more error-prone than
 * rebuilding the view from the same state.
 */
export async function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  try {
    localStorage.setItem('gaea.lang', lang);
  } catch {
    /* ignore */
  }
  store.lang = lang;
  store.ui = await loadUi(lang);
  store.terms = await loadTerms(lang);
  ready = true;
}
