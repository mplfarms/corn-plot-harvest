// src/core/soilLookup.js
//
// Given a GPS coordinate, looks up the most prevalent (dominant, by
// representative percentage) surface soil texture at that point from the
// USDA NRCS Soil Data Access (SDA) web service — the same SSURGO soil
// survey data behind Web Soil Survey — and maps it onto this app's own
// 12-class Soil Type list (DefaultLists.json's soilTypeOptions, which is
// exactly the standard USDA soil textural triangle classes, so the two
// vocabularies line up almost 1:1 once texture-description "modifiers"
// like "gravelly" or "very fine" are stripped out).
//
// SDA is a free, public, no-API-key SQL query service over SSURGO/STATSGO
// (https://sdmdataaccess.nrcs.usda.gov/). This module was written against
// its documented schema and query functions, but — like
// netlify/functions/plots.js elsewhere in this project — could not be
// exercised against the live service from the sandbox this was built in
// (no general internet egress there). Every network/parsing step below
// fails soft (returns null) rather than throwing where practical, so a
// bad/unexpected response just means "couldn't determine a soil type,"
// never a broken screen — see fetchSoilTypeForCoordinates()'s caller in
// trialDetails.js for how that's surfaced to the user.

const SDA_URL = "https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest";

/**
 * Builds the SDA SQL query for the dominant surface-horizon texture at a
 * lat/lon point: finds the SSURGO map unit containing the point (via
 * SDA's point-intersection table function), then each of that map unit's
 * soil components' surface horizon (hzdept_r = 0, i.e. the topsoil) texture
 * description, ordered by the component's representative percentage
 * (comppct_r) — the caller picks the top (most prevalent) row with a
 * usable texture description, since the top-ranked component isn't
 * always the one with texture data (e.g. it can be "Water").
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function buildSoilTextureQuery(lat, lon) {
  // WKT point order is (longitude latitude), not (lat, lon).
  const wkt = `point(${lon} ${lat})`;
  return (
    "SELECT c.compname, c.comppct_r, ch.hzdept_r, ctg.texdesc " +
    "FROM component c " +
    "INNER JOIN chorizon ch ON ch.cokey = c.cokey " +
    "INNER JOIN chtexturegrp ctg ON ctg.chkey = ch.chkey " +
    `WHERE c.mukey IN (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}')) ` +
    "AND ch.hzdept_r = 0 " +
    "AND ctg.rvindicator = 'Yes' " +
    "ORDER BY c.comppct_r DESC"
  );
}

/**
 * SDA's post.rest endpoint can return either shape depending on the
 * requested FORMAT: "JSON+COLUMNNAME" gives an array of plain
 * {column: value} objects directly; plain "JSON" gives an array of
 * arrays with the column names as the first row. This app requests
 * "JSON+COLUMNNAME" (see fetchSoilTypeForCoordinates), but handles both
 * here defensively, since the exact response shape couldn't be verified
 * against the live service from this sandbox.
 * @param {any} json - the parsed response body
 * @returns {Array<Object>}
 */
export function parseSdaTableRows(json) {
  const table = json && json.Table;
  if (!Array.isArray(table) || table.length === 0) return [];
  const first = table[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    // Already {column: value} objects.
    return table;
  }
  if (!Array.isArray(first)) return [];
  // Header-row-first shape: zip the remaining rows against that header row.
  const headers = first;
  return table.slice(1).map((row) => {
    const obj = {};
    headers.forEach((key, i) => {
      obj[key] = row[i];
    });
    return obj;
  });
}

/**
 * Picks the dominant (highest comppct_r) row that actually has a texture
 * description — a map unit's top-ranked component by percentage isn't
 * always a soil at all (it can be "Water", a pit, or otherwise missing
 * texture data), so this skips over any that have no texdesc rather than
 * assuming row order alone is enough.
 * @param {Array<Object>} rows
 * @returns {string|null} the raw texdesc string, or null if none usable
 */
export function pickDominantSurfaceTexture(rows) {
  const candidates = (rows || [])
    .filter((r) => r && r.texdesc !== null && r.texdesc !== undefined && String(r.texdesc).trim() !== "")
    .map((r) => ({ texdesc: String(r.texdesc).trim(), comppct_r: Number(r.comppct_r) }));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const bPct = Number.isFinite(b.comppct_r) ? b.comppct_r : -1;
    const aPct = Number.isFinite(a.comppct_r) ? a.comppct_r : -1;
    return bPct - aPct;
  });
  return candidates[0].texdesc;
}

// Descriptive qualifiers SSURGO texture descriptions commonly add that
// this app's plain 12-class textural-triangle list doesn't distinguish
// (coarse-fragment content, organic content, or fine/coarse sand-size
// variants) — stripped out before matching so e.g. "very gravelly silt
// loam" and "fine sandy loam" both still resolve to "Silt Loam" /
// "Sandy Loam" instead of failing to match anything.
const TEXTURE_MODIFIER_WORDS = [
  "very",
  "extremely",
  "slightly",
  "moderately",
  "excessively",
  "somewhat",
  "strongly",
  "gravelly",
  "gravel",
  "cobbly",
  "cobbles",
  "stony",
  "stones",
  "bouldery",
  "boulders",
  "channery",
  "shaly",
  "flaggy",
  "cindery",
  "ashy",
  "mucky",
  "peaty",
  "fine",
  "coarse",
  "paragravelly",
  "high",
  "organic",
  "matter",
];

const MODIFIER_PATTERN = new RegExp(`\\b(${TEXTURE_MODIFIER_WORDS.join("|")})\\b`, "gi");

/**
 * Maps a raw SSURGO texture description (e.g. "Very gravelly silt loam",
 * "Fine sandy loam", "Silt loam, high organic matter") onto the closest
 * option in `canonicalClasses` (this app's soilTypeOptions), or null if
 * nothing usable matches.
 * @param {string|null|undefined} rawTexdesc
 * @param {string[]} canonicalClasses
 * @returns {string|null}
 */
export function normalizeTextureClass(rawTexdesc, canonicalClasses) {
  if (!rawTexdesc || !Array.isArray(canonicalClasses) || canonicalClasses.length === 0) return null;

  // Modifiers are sometimes appended after a comma (e.g. ", high organic
  // matter") rather than as a leading adjective — drop anything after the
  // first comma before stripping the word-level modifiers too.
  let cleaned = String(rawTexdesc).split(",")[0];
  cleaned = cleaned.toLowerCase();
  cleaned = cleaned.replace(MODIFIER_PATTERN, " ").replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;

  const exact = canonicalClasses.find((c) => c.toLowerCase() === cleaned);
  if (exact) return exact;

  // Fallback: does the cleaned description contain one of the canonical
  // class names? Longest-name-first so e.g. "sandy clay loam" is checked
  // (and wins) before the shorter "clay" or "loam" would otherwise match
  // a substring of it.
  const byLengthDesc = [...canonicalClasses].sort((a, b) => b.length - a.length);
  const contains = byLengthDesc.find((c) => cleaned.includes(c.toLowerCase()));
  return contains || null;
}

/**
 * End-to-end: given a GPS coordinate, returns the closest matching Soil
 * Type option, or null if it couldn't be determined (no network, the
 * point falls outside SSURGO's mapped coverage, or nothing in the
 * response matched the app's texture list) — every failure path returns
 * null rather than throwing, so callers can treat "no answer" and "an
 * error occurred" the same way (fall back to manual selection).
 * @param {number} lat
 * @param {number} lon
 * @param {string[]} canonicalClasses - fixed.soilTypeOptions
 * @param {{fetchImpl?: typeof fetch}} [opts] - fetchImpl is injectable for testing
 * @returns {Promise<string|null>}
 */
export async function fetchSoilTypeForCoordinates(lat, lon, canonicalClasses, opts = {}) {
  const fetchImpl = (opts && opts.fetchImpl) || (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchImpl || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  let json;
  try {
    const response = await fetchImpl(SDA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: buildSoilTextureQuery(lat, lon), format: "JSON+COLUMNNAME" }),
    });
    if (!response.ok) return null;
    json = await response.json();
  } catch (e) {
    // Offline, DNS failure, CORS, timeout, malformed response, etc. — all
    // treated the same: no answer, let the caller fall back to manual entry.
    return null;
  }

  const rows = parseSdaTableRows(json);
  const dominantTexdesc = pickDominantSurfaceTexture(rows);
  if (!dominantTexdesc) return null;
  return normalizeTextureClass(dominantTexdesc, canonicalClasses);
}
