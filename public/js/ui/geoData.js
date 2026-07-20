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

const COUNTIES_URL = "/data/counties.json";
const CITY_ZIPS_URL = "/data/cityZips.json";

/** @type {Object<string, string[]>} state code -> sorted county names */
let countiesByState = {};

/** @type {Object<string, Array<{city:string, zips:string[]}>>} state code -> city/zips entries */
let cityZipsByState = {};

let loadPromise = null;

/**
 * Fetches both datasets once. Safe to call multiple times/from multiple
 * screens — subsequent calls return the same in-flight/settled promise.
 * @returns {Promise<void>}
 */
export function ensureLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all([
    fetch(COUNTIES_URL).then((r) => r.json()),
    fetch(CITY_ZIPS_URL).then((r) => r.json()),
  ])
    .then(([counties, cityZips]) => {
      countiesByState = counties || {};
      cityZipsByState = cityZips || {};
    })
    .catch((e) => {
      console.error("[geoData] failed to load county/city-zip data", e);
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
