// src/core/companyMatch.js
//
// Company-name de-duplication for Hybrid Catalog uploads (see
// adminPlots.js's "Upload Hybrid Catalog" button and
// netlify/functions/hybridCatalog.js). A catalog spreadsheet compiled
// from public seed-guide sources will naturally spell a brand slightly
// differently than this app's existing company list already does
// ("AgriGold" vs "Agrigold", "NK" vs "NK Brand", "Brevant" vs "Brevant
// Seeds") — per explicit request, an "obvious duplicate" like that
// should be folded into the EXISTING spelling rather than creating a
// second, visually-duplicate entry in the Brand/Company picker. A
// genuinely new company (no reasonable match) passes through unchanged
// and is simply added, since it's real, new data.
//
// The matching rule: lowercase, strip punctuation, split into words,
// then drop a trailing "filler" word (Seed/Seeds/Hybrid/Hybrids/Brand/
// Genetics/Company/Co) if the name has more than one word — this is
// exactly the pattern behind every mismatch above (a public source
// dropping or adding a generic suffix word a company's own catalog
// name includes, or vice versa). Two names are considered the same
// company when this reduces them to an identical "core key". Verified
// against a real 16-brand upload (Corn_Hybrids_AllBrands_clean_1.xlsx)
// with zero false matches among this app's ~58 existing companies and
// zero false collisions between any two of them.

const FILLER_SUFFIX_WORDS = new Set(["seed", "seeds", "hybrid", "hybrids", "brand", "genetics", "company", "co"]);

/**
 * @param {string} name
 * @returns {string}
 */
export function coreCompanyKey(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && FILLER_SUFFIX_WORDS.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join("");
}

/**
 * @param {string} rawCompany as it appears in an uploaded catalog row
 * @param {string[]} knownCompanies the app's current full company list
 *   (existing defaults + custom + already-in-catalog companies)
 * @returns {string} the matching entry from knownCompanies (preserving
 *   ITS spelling) if this is an obvious duplicate of one; otherwise
 *   rawCompany trimmed as-is (a genuinely new company).
 */
export function canonicalizeCompanyName(rawCompany, knownCompanies) {
  const trimmed = String(rawCompany || "").trim();
  if (trimmed === "") return "";
  const key = coreCompanyKey(trimmed);
  const match = (knownCompanies || []).find((known) => coreCompanyKey(known) === key);
  return match || trimmed;
}
