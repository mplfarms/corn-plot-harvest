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
// OpenStreetMap's Overpass API (free, no-key, CORS-enabled) — used for
// "what towns are NEAR here" radius queries, which is the question a
// farm plot actually needs answered (a point reverse-geocode only says
// what unincorporated township the point sits IN). Primary endpoint
// plus one public mirror, tried in order.
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const METERS_PER_MILE = 1609.344;

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
 * Strips rural-place labeling a reverse-geocoder attaches to
 * unincorporated spots ("Township of South Loup" -> "South Loup",
 * "Custer Township" -> "Custer") — in open farm country the nearest
 * NAMED place is often a township, not the town the user would name.
 * The caller only ever accepts a candidate that matches the app's own
 * city list (real postal towns), so this cleanup just gives a township
 * name whose base IS a real town a chance to match.
 * @param {string} name
 * @returns {string}
 */
export function cleanCityCandidate(name) {
  return String(name || "")
    .trim()
    .replace(/^township of\s+/i, "")
    .replace(/\s+township$/i, "")
    .trim();
}

/**
 * Nearest city/town CANDIDATES from BigDataCloud's free client
 * reverse-geocoder, best-first: the primary city/locality fields, then
 * any other place names the response carries (its localityInfo
 * sections). The caller walks this list and keeps the FIRST name that
 * matches the app's own city list for the state — per explicit request,
 * the goal is the nearest incorporated town, not whatever township the
 * point happens to sit in, and the app's city/zip list (built from
 * postal data) is exactly the "real towns" filter for that.
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string[]>}
 */
export async function fetchNearestCityCandidates(lat, lon) {
  try {
    const url = `${REVERSE_GEOCODE_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = await res.json();
    const raw = [];
    if (body) {
      raw.push(body.city, body.locality);
      const info = body.localityInfo || {};
      // administrative entries include state/county levels too — those
      // never match a city list, so including them is harmless, but
      // keep them AFTER the primary fields and the informative names.
      for (const group of [info.informative, info.administrative]) {
        if (Array.isArray(group)) for (const item of group) raw.push(item && item.name);
      }
    }
    const seen = new Set();
    const candidates = [];
    for (const name of raw) {
      const cleaned = cleanCityCandidate(name);
      const key = cleaned.toLowerCase();
      if (!cleaned || seen.has(key)) continue;
      seen.add(key);
      candidates.push(cleaned);
    }
    return candidates;
  } catch (e) {
    return [];
  }
}

/**
 * Great-circle distance in miles (haversine).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number}
 */
export function distanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613; // earth radius, miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Every named city/town/village within `radiusMiles` of the point, from
 * OpenStreetMap via Overpass, sorted nearest-first with distances.
 * These are OSM "place" nodes — real communities, not townships or
 * survey areas — but callers should STILL snap each name against the
 * app's own city list for the state (see snapToKnownName), which is
 * what enforces "incorporated town in the right state" per explicit
 * request. Fails soft to [] like every other lookup in this file.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMiles
 * @returns {Promise<Array<{name: string, distanceMiles: number}>>}
 */
export async function fetchNearbyCityCandidatesByRadius(lat, lon, radiusMiles) {
  const radiusMeters = Math.round(radiusMiles * METERS_PER_MILE);
  const query = `[out:json][timeout:10];node(around:${radiusMeters},${lat},${lon})[place~"^(city|town|village)$"][name];out body 80;`;
  for (const endpoint of OVERPASS_URLS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue;
      const body = await res.json();
      const elements = body && Array.isArray(body.elements) ? body.elements : [];
      const places = [];
      for (const el of elements) {
        const name = el && el.tags && typeof el.tags.name === "string" ? el.tags.name.trim() : "";
        if (!name || typeof el.lat !== "number" || typeof el.lon !== "number") continue;
        places.push({ name, distanceMiles: distanceMiles(lat, lon, el.lat, el.lon) });
      }
      places.sort((a, b) => a.distanceMiles - b.distanceMiles);
      return places;
    } catch (e) {
      // try the next endpoint
    }
  }
  return [];
}

/**
 * Both lookups together, in parallel. `wantCity: false` skips the
 * reverse-geocode call entirely (e.g. the City field already has a
 * manual value, so there's nothing to fill).
 * @param {number} lat
 * @param {number} lon
 * @param {{wantCity?: boolean}} [opts]
 * @returns {Promise<{stateCode: string|null, countyName: string|null, cityCandidates: string[]}>}
 */
export async function fetchRegionForCoordinates(lat, lon, opts) {
  const wantCity = !opts || opts.wantCity !== false;
  const [stateCounty, cityCandidates] = await Promise.all([
    fetchStateCountyForCoordinates(lat, lon),
    wantCity ? fetchNearestCityCandidates(lat, lon) : Promise.resolve([]),
  ]);
  return { ...stateCounty, cityCandidates };
}
