// src/core/locationLookup.js
//
// Given a GPS coordinate, looks up the State + County (FCC Area API — a
// free, no-API-key US government service that returns the state and
// county containing a lat/lon point) and the nearest city/town
// (BigDataCloud's free client-side reverse-geocode endpoint, also
// no-key). Used by trialDetails.js's location capture to pre-fill the
// State / County / City fields alongside the existing GPS + soil-type
// lookups — per explicit request, filling ONLY fields that are still
// blank, never overwriting a manual entry (GPS reflects where the
// PHONE is standing, which isn't necessarily the plot being entered).
//
// Like soilLookup.js (see its top comment — same situation), these
// endpoints were written against their documented response shapes but
// couldn't be exercised live from the sandbox this was built in, so
// every network/parsing step fails soft (null), never throws — a failed
// lookup just leaves the fields for manual entry, exactly as before
// this feature existed.

const FCC_AREA_URL = "https://geo.fcc.gov/api/census/block/find";
const REVERSE_GEOCODE_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

/**
 * Case-insensitive, whitespace-trimmed exact match of `value` against a
 * list of known option names, returning the LIST's own spelling on a
 * hit — so an auto-filled County/City always matches what the app's own
 * picker would have offered. A trailing " County" is ignored on both
 * sides (the FCC service can include it; this app's county list
 * doesn't). Returns null when nothing matches — deliberately not fuzzy,
 * same reasoning as geoData.getZipsForCity().
 * @param {string} value
 * @param {string[]} options
 * @returns {string|null}
 */
export function snapToKnownName(value, options) {
  const normalize = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+county$/, "");
  const key = normalize(value);
  if (!key) return null;
  const found = (options || []).find((o) => normalize(o) === key);
  return found || null;
}

/**
 * State + County from the FCC Area API.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{stateCode: string|null, countyName: string|null}>}
 */
export async function fetchStateCountyForCoordinates(lat, lon) {
  try {
    const url = `${FCC_AREA_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return { stateCode: null, countyName: null };
    const body = await res.json();
    const stateCode = body && body.State && typeof body.State.code === "string" ? body.State.code.trim().toUpperCase() : null;
    const countyName = body && body.County && typeof body.County.name === "string" ? body.County.name.trim() : null;
    return { stateCode: stateCode || null, countyName: countyName || null };
  } catch (e) {
    return { stateCode: null, countyName: null };
  }
}

/**
 * Nearest city/town from BigDataCloud's free client reverse-geocoder.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string|null>}
 */
export async function fetchNearestCityForCoordinates(lat, lon) {
  try {
    const url = `${REVERSE_GEOCODE_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    const city = (body && (body.city || body.locality)) || "";
    const trimmed = String(city).trim();
    return trimmed || null;
  } catch (e) {
    return null;
  }
}

/**
 * Both lookups together, in parallel. `wantCity: false` skips the
 * reverse-geocode call entirely (e.g. the City field already has a
 * manual value, so there's nothing to fill).
 * @param {number} lat
 * @param {number} lon
 * @param {{wantCity?: boolean}} [opts]
 * @returns {Promise<{stateCode: string|null, countyName: string|null, cityName: string|null}>}
 */
export async function fetchRegionForCoordinates(lat, lon, opts) {
  const wantCity = !opts || opts.wantCity !== false;
  const [stateCounty, cityName] = await Promise.all([
    fetchStateCountyForCoordinates(lat, lon),
    wantCity ? fetchNearestCityForCoordinates(lat, lon) : Promise.resolve(null),
  ]);
  return { ...stateCounty, cityName };
}
