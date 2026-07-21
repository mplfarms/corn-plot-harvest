// src/core/hybridCatalogImport.js
//
// Turns a spreadsheet's raw grid (an "AOA" — array of arrays, one per
// row, exactly what SheetJS's sheet_to_json(ws, {header:1}) or a CSV
// parse produces) into the {company, hybrid, trait, rm} rows the
// Hybrid Catalog needs (see netlify/functions/hybridCatalog.js). Kept
// as pure, dependency-free functions — no SheetJS, no DOM, no fetch —
// so this file's parsing/validation logic is unit-testable on its own;
// see adminPlots.js for where the actual .xlsx/.csv file reading and
// SheetJS loading happens before handing off to rowsFromAOA() here.
//
// Column order isn't assumed — headers are matched by flexible keyword
// (case-insensitive "contains"), so a source file's exact column order
// or extra columns (this app's real source file also has "Confidence"
// and "Notes" columns, both ignored here) never matters:
//   Company/Brand -> a header containing "brand" or "company"
//   Hybrid Name   -> a header containing "hybrid"
//   Trait         -> a header containing "trait"
//   Relative Maturity -> a header containing "maturity", "rm", or "crm"
//
// Company names are NOT canonicalized here — that's a separate step
// (see companyMatch.js) applied by the caller after this, since
// canonicalization needs the app's current company list, which this
// module deliberately knows nothing about.

const COMPANY_HEADER_KEYWORDS = ["brand", "company"];
const HYBRID_HEADER_KEYWORDS = ["hybrid"];
const TRAIT_HEADER_KEYWORDS = ["trait"];
const RM_HEADER_KEYWORDS = ["maturity", "rm", "crm"];

function findColumnIndex(headerRow, keywords) {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] || "").trim().toLowerCase();
    if (keywords.some((kw) => cell.includes(kw))) return i;
  }
  return -1;
}

/**
 * @param {Array<Array<any>>} aoa the full sheet, header row first
 * @returns {{
 *   rows: Array<{company:string, hybrid:string, trait:string, rm:number}>,
 *   skippedCount: number,
 *   headerError: string|null,
 * }}
 */
export function rowsFromAOA(aoa) {
  if (!Array.isArray(aoa) || aoa.length === 0) {
    return { rows: [], skippedCount: 0, headerError: "The file appears to be empty." };
  }

  const headerRow = aoa[0] || [];
  const companyIdx = findColumnIndex(headerRow, COMPANY_HEADER_KEYWORDS);
  const hybridIdx = findColumnIndex(headerRow, HYBRID_HEADER_KEYWORDS);
  const traitIdx = findColumnIndex(headerRow, TRAIT_HEADER_KEYWORDS);
  const rmIdx = findColumnIndex(headerRow, RM_HEADER_KEYWORDS);

  const missing = [];
  if (companyIdx === -1) missing.push("a Brand/Company column");
  if (hybridIdx === -1) missing.push("a Hybrid column");
  if (traitIdx === -1) missing.push("a Trait column");
  if (rmIdx === -1) missing.push("a Maturity/RM column");
  if (missing.length > 0) {
    return { rows: [], skippedCount: 0, headerError: `Couldn't find ${missing.join(", ")} in the first row.` };
  }

  const rows = [];
  let skippedCount = 0;
  for (let i = 1; i < aoa.length; i++) {
    const line = aoa[i] || [];
    const company = String(line[companyIdx] || "").trim();
    const hybrid = String(line[hybridIdx] || "").trim();
    const trait = String(line[traitIdx] || "").trim();
    const rmRaw = String(line[rmIdx] || "").trim();
    const rm = Number(rmRaw);
    if (!company && !hybrid && !trait && !rmRaw) continue; // fully blank row — not a real skip
    if (!company || !hybrid || !trait || !Number.isFinite(rm)) {
      skippedCount++;
      continue;
    }
    rows.push({ company, hybrid, trait, rm });
  }

  return { rows, skippedCount, headerError: null };
}

/**
 * Minimal CSV parser (handles quoted fields containing commas, escaped
 * "" quotes, and \r\n or \n line endings) — enough for a spreadsheet
 * export, not a full RFC 4180 implementation.
 * @param {string} text
 * @returns {Array<Array<string>>}
 */
export function parseCsvToAOA(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Final field/row (files not ending in a trailing newline)
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}
