// src/ui/stores/listsStore.js
//
// Mirrors ListsStore.swift: the locked DefaultLists.json merged with
// user-added custom items (cph.customLists in localStorage). Categories:
// "brandCompany", "hybrid", "trait", "seedTreatment". Hybrids are also
// scoped per-brand via hybridItems(forBrand).
//
// BRAND_COMPANY and hybridItems(forBrand) ALSO merge in the admin-
// uploaded Hybrid Catalog (see catalogStore.js / hybridCatalog.js) —
// so a company/hybrid from a spreadsheet upload shows up in these
// pickers exactly like a hand-typed custom entry does, just sourced
// from the shared catalog instead of cph.customLists. Trait/RM
// cascading FROM a catalog hybrid selection (auto-fill/narrow) is
// handled in entryEditor.js itself, not here — this module only
// answers "what are the valid options," not "what should happen when
// one is picked."
//
// BRAND_COMPANY is additionally reordered (see COMPANY_PRIORITY_ORDER /
// orderCompaniesForBrandView below) so the picker always leads with the
// currently-selected Brand View's own catalog name, then a requested
// fixed sequence of the most-used companies, with everything else
// (custom-added companies, brand-new catalog uploads not in that fixed
// list) falling after, in whatever order it already had.

import { createPubSub, readJson, writeJson } from "./pubsub.js";
import * as catalogStore from "./catalogStore.js";
import * as brandStore from "./brandStore.js";
import { getBrand } from "../brand.js";

const CUSTOM_KEY = "cph.customLists";
const DEFAULTS_URL = "/DefaultLists.json";

export const CATEGORY = {
  BRAND_COMPANY: "brandCompany",
  HYBRID: "hybrid",
  TRAIT: "trait",
  SEED_TREATMENT: "seedTreatment",
  COLLECTED_BY: "collectedBy",
};

// The shared hybrid catalog (DefaultLists.json's "hybrids") mixes a few
// different in-house numbering schemes; only these two brands' lists get
// the noisy non-RM-coded entries filtered out (see hybridItems() below) —
// other hybridDefaultBrands (e.g. Crow's) are left as-is.
const HYBRID_HYPHEN_ONLY_BRANDS = ["Midwest Seed Genetics", "NC+ Hybrids"];

// Requested fixed display order for the Brand / Company picker: whichever
// Brand View is currently selected (Midwest Seed Genetics or NC+ Hybrids)
// always comes first, then this list, in this order. Anything not in
// either place (a custom-added company, a brand-new catalog upload not on
// this list, etc.) falls after all of it, in whatever order it already
// had. Kept as one flat list (not split per Brand View) since the list
// itself doesn't change based on which brand is selected — only whether
// Midwest or NC+ Hybrids is prepended ahead of it.
const COMPANY_PRIORITY_ORDER = [
  "Dekalb",
  "Pioneer",
  "Golden Harvest",
  "Channel",
  "Agrigold",
  "LG Seed",
  "Brevant Seeds",
  "Hoegemeyer",
  "Becks",
  "Dyna-Gro",
  "Mustang Seeds",
  "NuTech Seed",
  "Croplan",
  "Innvictis",
  "Republic",
  "Dairyland Seed",
  "Rob See Co",
  "Crow's",
  "AgVenture",
  "Wyffels",
  "Latham Hi-Tech Seeds",
  "NK Brand",
  "Stine",
  "Thunder Seed",
  "Jacobsen Seeds",
  "Legend Seeds",
  "Champion Seed",
  "Ohlde",
  "Integra",
  "Prairie Valley",
  "AP Select",
  "Renk Seed",
  "Peterson Farms Seed",
  "Legacy Seeds",
  "Enestvedt",
  "FS InVISION",
  "Frontiersman",
  "Super Crost",
  "Hefty Seed",
  "Enogen",
];

/**
 * Sorts `companies` so the currently-selected Brand View's catalog name
 * comes first, then COMPANY_PRIORITY_ORDER's fixed sequence, then
 * everything else in its original relative order (a stable sort — see
 * MDN, Array.prototype.sort has been guaranteed stable since ES2019).
 * Matching is case-insensitive so it still works regardless of exactly
 * how a name was capitalized when it was added (default list, custom
 * entry, or catalog upload).
 * @param {string[]} companies
 * @returns {string[]}
 */
function orderCompaniesForBrandView(companies) {
  const selected = getBrand(brandStore.getState().selectedBrand);
  const priorityNames = [selected ? selected.catalogBrandName : null, ...COMPANY_PRIORITY_ORDER].filter(
    Boolean
  );
  const priorityIndex = new Map();
  priorityNames.forEach((name, i) => {
    const key = name.toLowerCase();
    if (!priorityIndex.has(key)) priorityIndex.set(key, i);
  });
  return companies
    .map((name, originalIndex) => ({ name, originalIndex }))
    .sort((a, b) => {
      const ai = priorityIndex.has(a.name.toLowerCase()) ? priorityIndex.get(a.name.toLowerCase()) : Infinity;
      const bi = priorityIndex.has(b.name.toLowerCase()) ? priorityIndex.get(b.name.toLowerCase()) : Infinity;
      if (ai !== bi) return ai - bi;
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.name);
}

const pubsub = createPubSub();

function blankCustom() {
  return { companies: [], hybridsByBrand: {}, traits: [], seedTreatments: [], collectionMethods: [] };
}

function loadCustom() {
  const c = readJson(CUSTOM_KEY, null);
  if (!c || typeof c !== "object") return blankCustom();
  return {
    companies: Array.isArray(c.companies) ? c.companies : [],
    hybridsByBrand: c.hybridsByBrand && typeof c.hybridsByBrand === "object" ? c.hybridsByBrand : {},
    traits: Array.isArray(c.traits) ? c.traits : [],
    seedTreatments: Array.isArray(c.seedTreatments) ? c.seedTreatments : [],
    collectionMethods: Array.isArray(c.collectionMethods) ? c.collectionMethods : [],
  };
}

let state = {
  ready: false,
  defaults: {
    hybridDefaultBrands: [],
    companies: [],
    hybrids: [],
    traits: [],
    seedTreatments: [],
    irrigationOptions: [],
    tillageOptions: [],
    soilTypeOptions: [],
    previousCropOptions: [],
    collectionMethods: [],
  },
  custom: loadCustom(),
};

let loadPromise = null;

/**
 * Case-insensitive de-dupe, keeping the FIRST spelling seen for a given
 * value — used wherever the Hybrid Catalog (see catalogStore.js) is
 * merged into an existing list, since a catalog upload's company names
 * are already canonicalized against this app's existing spellings at
 * upload time (see companyMatch.js) but a belt-and-suspenders check
 * here means a stray near-duplicate can never show up twice in a
 * picker regardless.
 * @param {string[]} values
 * @returns {string[]}
 */
function dedupeCaseInsensitive(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/**
 * Fetches DefaultLists.json once (module-level singleton promise). Safe
 * to call multiple times from multiple screens.
 * @returns {Promise<void>}
 */
export function ensureLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(DEFAULTS_URL)
    .then((r) => r.json())
    .then((json) => {
      state = { ...state, ready: true, defaults: { ...state.defaults, ...json } };
      pubsub.notify();
    })
    .catch((e) => {
      console.error("[listsStore] failed to load DefaultLists.json", e);
    });
  return loadPromise;
}

function persistCustom() {
  writeJson(CUSTOM_KEY, state.custom);
}

function setCustom(next) {
  state = { ...state, custom: next };
  persistCustom();
  pubsub.notify();
}

/**
 * @param {string} category one of CATEGORY values
 * @returns {string[]}
 */
export function items(category) {
  const d = state.defaults;
  const c = state.custom;
  switch (category) {
    case CATEGORY.BRAND_COMPANY:
      return orderCompaniesForBrandView(
        dedupeCaseInsensitive([...d.companies, ...c.companies, ...catalogStore.companies()])
      );
    case CATEGORY.HYBRID: {
      const allCustomHybrids = Object.values(c.hybridsByBrand).flat();
      return [...d.hybrids, ...allCustomHybrids];
    }
    case CATEGORY.TRAIT:
      return [...d.traits, ...c.traits];
    case CATEGORY.SEED_TREATMENT:
      return [...d.seedTreatments, ...c.seedTreatments];
    case CATEGORY.COLLECTED_BY:
      return [...d.collectionMethods, ...c.collectionMethods];
    default:
      return [];
  }
}

/**
 * @param {string} forBrand
 * @returns {string[]}
 */
export function hybridItems(forBrand) {
  const brand = (forBrand || "").trim();
  if (brand === "") return [];
  const d = state.defaults;
  const c = state.custom;
  const isDefaultBrand = (d.hybridDefaultBrands || []).some(
    (b) => b.toLowerCase() === brand.toLowerCase()
  );
  let base = isDefaultBrand ? d.hybrids : [];
  // Midwest Seed Genetics / NC+ Hybrids' shared catalog mixes a few
  // different in-house numbering schemes; only the "<RM>-<sequence>"
  // coded entries are kept for these two brands (see
  // HYBRID_HYPHEN_ONLY_BRANDS and parseHybridRelativeMaturity below) so
  // the list — and RM defaulting — only surfaces hybrids whose RM is
  // actually known.
  const hyphenOnly = HYBRID_HYPHEN_ONLY_BRANDS.some((b) => b.toLowerCase() === brand.toLowerCase());
  if (hyphenOnly) base = base.filter((h) => h.includes("-"));
  const custom = c.hybridsByBrand[brand] || c.hybridsByBrand[forBrand] || [];
  const fromCatalog = catalogStore.hybridsForCompany(brand);
  return dedupeCaseInsensitive([...base, ...custom, ...fromCatalog]);
}

/**
 * Parses a hybrid's Relative Maturity from its catalog name, following
 * this catalog's numbering convention: a 2-digit prefix before the first
 * hyphen is the RM directly for 75-99 ("82-22 VT2PRIB" -> 82), and for
 * RM 100-120 the catalog drops the leading "1" ("00-31 SSRIB" -> 100,
 * "18-88 TRERIB" -> 118). Returns null for names that don't follow this
 * pattern.
 * @param {string} hybridLabel
 * @returns {number|null}
 */
export function parseHybridRelativeMaturity(hybridLabel) {
  const m = /^(\d{2,3})-/.exec(String(hybridLabel || "").trim());
  if (!m) return null;
  const prefix = parseInt(m[1], 10);
  if (prefix >= 75 && prefix <= 99) return prefix;
  if (prefix >= 0 && prefix <= 20) return 100 + prefix;
  return null;
}

/**
 * @param {string} forBrand
 * @param {number} rm
 * @returns {string|null} the first hybrid (in catalog order) with this
 *   parsed RM, or null if none match (e.g. a competitor brand with no
 *   default catalog at all).
 */
export function firstHybridWithRm(forBrand, rm) {
  return hybridItems(forBrand).find((h) => parseHybridRelativeMaturity(h) === rm) || null;
}

/**
 * Used by trialStore.addEntryCarryingMeasurements() to step a new plot
 * entry up to the next-maturity product on the just-added entry's Brand
 * View catalog, instead of repeating the previous entry's exact hybrid —
 * see that function's comment for why.
 * @param {string} forBrand
 * @param {number} afterRm
 * @returns {string|null} the hybrid (in catalog order) with the lowest
 *   parsed RM that's still strictly greater than afterRm, or null if
 *   there isn't one (afterRm is already at/above this brand's highest
 *   catalog RM, or forBrand has no RM-coded hybrids at all).
 */
export function nextHybridAboveRm(forBrand, afterRm) {
  let best = null;
  let bestRm = Infinity;
  for (const h of hybridItems(forBrand)) {
    const rm = parseHybridRelativeMaturity(h);
    if (rm === null || rm <= afterRm) continue;
    if (rm < bestRm) {
      best = h;
      bestRm = rm;
    }
  }
  return best;
}

/**
 * @param {string} raw
 * @param {string} category
 * @returns {string} the trimmed value that ended up selected ("" if raw was blank)
 */
export function addCustomItem(raw, category) {
  const trimmed = (raw || "").trim();
  if (trimmed === "") return "";
  const existing = items(category);
  const alreadyPresent = existing.some((v) => v.toLowerCase() === trimmed.toLowerCase());
  if (!alreadyPresent) {
    const c = state.custom;
    let next;
    switch (category) {
      case CATEGORY.BRAND_COMPANY:
        next = { ...c, companies: [...c.companies, trimmed] };
        break;
      case CATEGORY.TRAIT:
        next = { ...c, traits: [...c.traits, trimmed] };
        break;
      case CATEGORY.SEED_TREATMENT:
        next = { ...c, seedTreatments: [...c.seedTreatments, trimmed] };
        break;
      case CATEGORY.COLLECTED_BY:
        next = { ...c, collectionMethods: [...c.collectionMethods, trimmed] };
        break;
      default:
        next = c;
    }
    setCustom(next);
  }
  return trimmed;
}

/**
 * @param {string} raw
 * @param {string} brand
 * @returns {string} the trimmed value that ended up selected ("" if raw or brand was blank)
 */
export function addCustomHybrid(raw, brand) {
  const trimmed = (raw || "").trim();
  const brandTrimmed = (brand || "").trim();
  if (trimmed === "" || brandTrimmed === "") return "";
  const existing = hybridItems(brandTrimmed);
  const alreadyPresent = existing.some((v) => v.toLowerCase() === trimmed.toLowerCase());
  if (!alreadyPresent) {
    const c = state.custom;
    const currentForBrand = c.hybridsByBrand[brandTrimmed] || [];
    const next = {
      ...c,
      hybridsByBrand: { ...c.hybridsByBrand, [brandTrimmed]: [...currentForBrand, trimmed] },
    };
    setCustom(next);
  }
  return trimmed;
}

/**
 * @param {string} value
 * @param {string} category
 */
export function removeCustomItem(value, category) {
  const c = state.custom;
  let next;
  switch (category) {
    case CATEGORY.BRAND_COMPANY:
      next = { ...c, companies: c.companies.filter((v) => v !== value) };
      break;
    case CATEGORY.TRAIT:
      next = { ...c, traits: c.traits.filter((v) => v !== value) };
      break;
    case CATEGORY.SEED_TREATMENT:
      next = { ...c, seedTreatments: c.seedTreatments.filter((v) => v !== value) };
      break;
    case CATEGORY.COLLECTED_BY:
      next = { ...c, collectionMethods: c.collectionMethods.filter((v) => v !== value) };
      break;
    default:
      next = c;
  }
  setCustom(next);
}

/**
 * @param {string} value
 * @param {string} brand
 */
export function removeCustomHybrid(value, brand) {
  const c = state.custom;
  const brandTrimmed = (brand || "").trim();
  const currentForBrand = c.hybridsByBrand[brandTrimmed] || [];
  const next = {
    ...c,
    hybridsByBrand: { ...c.hybridsByBrand, [brandTrimmed]: currentForBrand.filter((v) => v !== value) },
  };
  setCustom(next);
}

/**
 * Fixed (non-customizable) lists, straight from DefaultLists.json.
 * @returns {{tillageOptions:string[], irrigationOptions:string[], soilTypeOptions:string[], previousCropOptions:string[]}}
 */
export function fixedLists() {
  const d = state.defaults;
  return {
    tillageOptions: d.tillageOptions,
    irrigationOptions: d.irrigationOptions,
    soilTypeOptions: d.soilTypeOptions,
    previousCropOptions: d.previousCropOptions,
  };
}

/**
 * Builds the plain-object "effective lists" shape consumed by
 * xlsxBuilder.createEffectiveLists — merged defaults + custom items for
 * the customizable categories, plus the fixed lists as-is.
 */
export function getEffectiveLists() {
  const d = state.defaults;
  return {
    companies: items(CATEGORY.BRAND_COMPANY),
    hybrids: items(CATEGORY.HYBRID),
    traits: items(CATEGORY.TRAIT),
    seedTreatments: items(CATEGORY.SEED_TREATMENT),
    irrigationOptions: d.irrigationOptions,
    tillageOptions: d.tillageOptions,
    soilTypeOptions: d.soilTypeOptions,
    previousCropOptions: d.previousCropOptions,
  };
}
