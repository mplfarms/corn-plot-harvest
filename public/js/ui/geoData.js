// src/ui/geoData.js
//
// County-by-state and city-to-zip lookup data, fetched once (module-level
// singleton promises, mirroring listsStore.js's DefaultLists.json load)
// from static JSON assets built from a public US zip/city/county dataset
// (github.com/millbj92/US-Zip-Codes-JSON). Kept as static assets rather
// than a runtime API call so lookups work offline in the field — this is
// a farm data-entry app, and cell coverage in a field is not a given.
// Both files are in the service worker's precache list, so after the
// first successful load they're available offline indefinitely.
//
// Also loads countyFips.json — 2-digit State FIPS codes and 3-digit
// County FIPS codes (keyed by the exact same state-code/county-name
// strings as counties.json above, sourced from the Census Bureau's
// standard reference list and cross-verified against several known
// real-world FIPS codes) — used to build the "Form Number" identifier
// (see core/formNumber.js) as soon as a plot's State and County are both
// selected. Same offline-first reasoning applies: a static, precached
// asset rather than a runtime lookup.

const COUNTIES_URL = "/data/counties.json";
const CITY_ZIPS_URL = "/data/cityZips.json";
const COUNTY_FIPS_URL = "/data/countyFips.json";

/** @type {Object<string, string[]>} state code -> sorted county names */
let countiesByState = {};

/** @type {Object<string, Array<{city:string, zips:string[]}>>} state code -> city/zips entries */
let cityZipsByState = {};

/** @type {Object<string, string>} state code -> 2-digit State FIPS code */
let stateFipsByCode = {};

/** @type {Object<string, Object<string, string>>} state code -> {countyName: 3-digit County FIPS code} */
let countyFipsByState = {};

let loadPromise = null;

/**
 * Fetches all three datasets once. Safe to call multiple times/from
 * multiple screens — subsequent calls return the same in-flight/settled
 * promise.
 * @returns {Promise<void>}
 */
export function ensureLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all([
    fetch(COUNTIES_URL).then((r) => r.json()),
    fetch(CITY_ZIPS_URL).then((r) => r.json()),
    fetch(COUNTY_FIPS_URL).then((r) => r.json()),
  ])
    .then(([counties, cityZips, countyFips]) => {
      countiesByState = counties || {};
      cityZipsByState = cityZips || {};
      stateFipsByCode = (countyFips && countyFips.stateFips) || {};
      countyFipsByState = (countyFips && countyFips.countyFips) || {};
    })
    .catch((e) => {
      console.error("[geoData] failed to load county/city-zip/FIPS data", e);
    });
  return loadPromise;
}

/**
 * @param {string} stateCode e.g. "IA"
 * @returns {string[]} sorted county names, [] if not loaded or unknown state
 */
export function getCountiesForState(stateCode) {
  if (!stateCode) return [];
  return countiesByState[stateCode] || [];
}

/**
 * Looks up ZIP codes for a given city name within a state. Exact,
 * case-insensitive, whitespace-trimmed match against the known city
 * names for that state — deliberately not fuzzy, since a false-positive
 * ZIP prepopulation would be worse than no match (the caller always
 * allows manual entry as a fallback either way).
 * @param {string} stateCode
 * @param {string} cityName
 * @returns {string[]} matching ZIP codes, [] if no match/not loaded
 */
export function getZipsForCity(stateCode, cityName) {
  if (!stateCode || !cityName) return [];
  const entries = cityZipsByState[stateCode];
  if (!entries) return [];
  const key = cityName.trim().toLowerCase();
  if (key === "") return [];
  const found = entries.find((e) => e.city.toLowerCase() === key);
  return found ? found.zips : [];
}

/**
 * @param {string} stateCode e.g. "IA"
 * @returns {string|null} 2-digit State FIPS code, or null if unknown/not loaded
 */
export function getStateFips(stateCode) {
  if (!stateCode) return null;
  return stateFipsByCode[stateCode] || null;
}

/**
 * Exact, case-insensitive match against the same county-name strings
 * counties.json uses for that state (see ensureLoaded's top comment) —
 * deliberately not fuzzy, matching getZipsForCity's reasoning. A county
 * typed in manually via the County wheel's "add new" option (see
 * createExtendableWheelSelect in trialDetails.js) that isn't in the
 * standard FIPS table returns null; callers fall back to a placeholder
 * code rather than failing outright — see core/formNumber.js.
 * @param {string} stateCode e.g. "IA"
 * @param {string} countyName e.g. "Polk"
 * @returns {string|null} 3-digit County FIPS code, or null if unknown/not loaded
 */
export function getCountyFips(stateCode, countyName) {
  if (!stateCode || !countyName) return null;
  const forState = countyFipsByState[stateCode];
  if (!forState) return null;
  const key = countyName.trim().toLowerCase();
  if (key === "") return null;
  const foundKey = Object.keys(forState).find((k) => k.toLowerCase() === key);
  return foundKey ? forState[foundKey] : null;
}
