// src/core/seedwareExportBuilder.js (served at public/js/core/seedwareExportBuilder.js)
//
// Builds "Export for Seedware" — a flat, one-row-per-entry .xlsx that
// matches the column layout of Mike's reference file
// ("harvest_data_import_template_v1", Instructions + Import Data tabs)
// so it can be dropped straight into SeedWare's Harvest Data Request
// Widget import. This is a completely separate, much simpler workbook
// than xlsxBuilder.js's full formatted "Trial Outline" export: no
// formulas, no fetched template parts, no second (Lists) sheet — just a
// header row plus one data row per plot entry, assembled fully offline
// from a hand-written minimal styles.xml/workbook.xml (same ZipWriter
// used by xlsxBuilder.js).
//
// Column mapping (see the reference template's Instructions tab for the
// authoritative field list/requiredness) — anything not listed below is
// always left blank because this app simply doesn't collect that data:
//   Form #             -> header.formId (the app's own Form ID, e.g.
//                          "26-1030" — see core/formId.js)
//   Form Type           -> fixed "Corn Observation". The template's
//                          Form Type list is crop-specific ("Corn
//                          Observation" / "Soybean Observation" /
//                          "Sorghum Observation") — every plot this app
//                          produces is corn, per Mike.
//   Test Type            -> fixed "Strip Trial" (per Mike: every export
//                          out of this app is a strip trial for now —
//                          this is the template's "Plot Type" list, "the
//                          Test Type Field").
//   Planting Date / Harvest Date -> header.datePlanted / dateHarvested
//   Previous Crop        -> header.previousCrop
//   Crop                 -> fixed "Corn" (per Mike)
//   City / State / Zip   -> header.city / state / zip. This app has no
//                          "Cooperator Account Number" concept, so per
//                          the template's own conditional rule (city/
//                          state/zip required whenever no account
//                          number is given) these three always carry
//                          the plot's location instead.
//   Latitude / Longitude -> header.gpsLatitude / gpsLongitude, when set
//   Position              -> 1-based sequence within this plot (blank
//                          entries are skipped, same as everywhere else
//                          in the app — see models.js's isEntryBlank())
//   Variety Provider      -> "Request" whenever the entry's Brand /
//                          Company or Hybrid / Variety was typed in
//                          through the picker's "+ Add New…" prompt (see
//                          listsStore.isCustomCompany()/isCustomHybrid()
//                          — this is the ONLY thing that means "Request"
//                          here; an admin-uploaded Hybrid Catalog entry
//                          is a real, already-known variety, not a
//                          request). Otherwise "Company" when
//                          entry.brand is one of the three catalog names
//                          in COMPANY_CATALOG_NAMES below, "Competitor"
//                          for anything else.
//   Variety               -> entry.hybrid, EXCEPT left blank when
//                          Variety Provider is "Request" (the template
//                          requires Variety blank for a Request row —
//                          see Request Variety below instead)
//   Treatment              -> entry.seedTreatment
//   Request Variety / Request Company / Request Trait / Request Maturity
//                            -> only filled when Variety Provider is
//                          "Request": entry.hybrid, entry.brand,
//                          entry.trait, entry.relativeMaturity
//                          respectively — Trait/Maturity aren't required
//                          by the template, but it explicitly says they
//                          help SeedWare's Harvest Data Request Widget
//                          clean up the request later, and this app
//                          already has both, so there's no reason to
//                          leave them blank. Blank on every Company/
//                          Competitor row.
//   Row Length / Row Width / Num Rows -> entry.stripLengthFeet /
//                          widthInches / numberOfRows
//   Moisture                -> entry.moisturePercent
//   Yield                    -> yieldCalculator.dryYield(entry) — the
//                          manually entered Dry Yield if the user set
//                          one, otherwise the app's own calculated Dry
//                          Yield @ 15%, same value shown everywhere else
//                          in the app (Plot Summary, the PDF, the full
//                          XLSX export).
//
// Left blank on every row, because there is nowhere in this app for the
// data to come from: District Account Number, Cooperator Account
// Number.
//
// IMPORTANT — several of these are "Lookup" fields per the template
// (Form Type, Test Type, Previous Crop, Crop, Variety, Treatment): they
// must match an exact code already configured in SeedWare, not just a
// human-readable label. The exact strings used here ("Corn Observation",
// "Strip Trial", "Corn", and whatever's on file for Previous Crop/
// Variety/Treatment) are this app's best-effort guess at those codes —
// they have NOT been confirmed against Mike's actual SeedWare
// configuration. Test-import this file's output before relying on it.

import { formatHeaderDate, filenameYear } from "./models.js";
import { isEntryBlank } from "./models.js";
import { dryYield, parseNumber } from "./yieldCalculator.js";
import { cellInline, cellNum } from "./xmlHelpers.js";
import { coreProperties, APP_PROPERTIES } from "./xlsxTemplateParts.js";
import { sanitizeFilenamePart } from "./xlsxBuilder.js";
import { ZipWriter } from "./zipWriter.js";

// The three Brand/Company catalog names (see ui/brand.js's
// catalogBrandName and DefaultLists.json's "companies" list) that count
// as "Company" (an in-house variety) for SeedWare's Variety Provider
// field — every other brand on an entry is "Competitor". Matched
// trimmed + case-insensitively so stray casing/whitespace on a
// hand-typed custom Brand entry doesn't silently fall through to
// "Competitor".
export const COMPANY_CATALOG_NAMES = ["Midwest Seed Genetics", "NC+ Hybrids", "Super Crost"];

const FORM_TYPE = "Corn Observation";
const TEST_TYPE = "Strip Trial";
const CROP = "Corn";

/**
 * A no-op pair used when the caller doesn't pass real custom-item
 * checks (e.g. a quick script or a test that only cares about the
 * Company/Competitor split) — nothing is ever treated as "Request".
 * @type {{isCustomCompany: (name: string) => boolean, isCustomHybrid: (brand: string, hybrid: string) => boolean}}
 */
const NO_CUSTOM_ITEMS = { isCustomCompany: () => false, isCustomHybrid: () => false };

/**
 * @param {string|null|undefined} brand
 * @param {string|null|undefined} hybrid
 * @param {{isCustomCompany: (name: string) => boolean, isCustomHybrid: (brand: string, hybrid: string) => boolean}} [customChecks]
 *   see listsStore.js's isCustomCompany()/isCustomHybrid() — pass those directly.
 * @returns {"Company"|"Competitor"|"Request"}
 */
export function varietyProviderFor(brand, hybrid, customChecks) {
  const checks = customChecks || NO_CUSTOM_ITEMS;
  if (checks.isCustomCompany(brand) || checks.isCustomHybrid(brand, hybrid)) return "Request";
  const normalized = String(brand || "").trim().toLowerCase();
  const isCompany = COMPANY_CATALOG_NAMES.some((name) => name.toLowerCase() === normalized);
  return isCompany ? "Company" : "Competitor";
}

/**
 * Rounds to at most `digits` decimal places (per the template's
 * "Decimal 3" field-size note) without introducing float noise, or
 * returns null straight through so blank fields stay blank instead of
 * becoming "0".
 * @param {number|null} n
 * @param {number} digits
 * @returns {number|null}
 */
function roundOrNull(n, digits) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

/**
 * One entry per column, in the exact left-to-right order of the
 * reference template's Import Data tab (A=Form # ... AA=Yield) — see
 * this file's top comment for the full field-by-field rationale. `ctx`
 * is computed once per row (see buildSheet1Xml) rather than each column
 * recomputing Variety Provider independently — `ctx.provider` is
 * whichever of "Company"/"Competitor"/"Request" this row resolved to.
 * @type {Array<{header: string, type: "text"|"number", value: (header: import('./models.js').TrialHeader, entry: import('./models.js').PlotEntry, position: number, ctx: {provider: string}) => (string|number|null)}>}
 */
const COLUMNS = [
  { header: "Form #", type: "text", value: (h) => h.formId || "" },
  { header: "Form Type", type: "text", value: () => FORM_TYPE },
  { header: "Test Type", type: "text", value: () => TEST_TYPE },
  { header: "Planting Date", type: "text", value: (h) => formatHeaderDate(h.datePlanted) },
  { header: "Harvest Date", type: "text", value: (h) => formatHeaderDate(h.dateHarvested) },
  { header: "Previous Crop", type: "text", value: (h) => h.previousCrop || "" },
  { header: "Crop", type: "text", value: () => CROP },
  { header: "District Account Number", type: "text", value: () => "" },
  { header: "Cooperator Account Number", type: "text", value: () => "" },
  { header: "City", type: "text", value: (h) => h.city || "" },
  { header: "State", type: "text", value: (h) => h.state || "" },
  { header: "Zip", type: "text", value: (h) => h.zip || "" },
  { header: "Latitude", type: "number", value: (h) => roundOrNull(h.gpsLatitude, 6) },
  { header: "Longitude", type: "number", value: (h) => roundOrNull(h.gpsLongitude, 6) },
  { header: "Position", type: "number", value: (h, e, position) => position },
  { header: "Variety Provider", type: "text", value: (h, e, p, ctx) => ctx.provider },
  { header: "Variety", type: "text", value: (h, e, p, ctx) => (ctx.provider === "Request" ? "" : e.hybrid || "") },
  { header: "Treatment", type: "text", value: (h, e) => e.seedTreatment || "" },
  { header: "Request Variety", type: "text", value: (h, e, p, ctx) => (ctx.provider === "Request" ? e.hybrid || "" : "") },
  { header: "Request Company", type: "text", value: (h, e, p, ctx) => (ctx.provider === "Request" ? e.brand || "" : "") },
  { header: "Request Trait", type: "text", value: (h, e, p, ctx) => (ctx.provider === "Request" ? e.trait || "" : "") },
  {
    header: "Request Maturity",
    type: "number",
    value: (h, e, p, ctx) => (ctx.provider === "Request" ? roundOrNull(parseNumber(e.relativeMaturity), 3) : null),
  },
  { header: "Row Length", type: "number", value: (h, e) => roundOrNull(parseNumber(e.stripLengthFeet), 3) },
  { header: "Row Width", type: "number", value: (h, e) => roundOrNull(parseNumber(e.widthInches), 3) },
  { header: "Num Rows", type: "number", value: (h, e) => roundOrNull(parseNumber(e.numberOfRows), 3) },
  { header: "Moisture", type: "number", value: (h, e) => roundOrNull(parseNumber(e.moisturePercent), 3) },
  { header: "Yield", type: "number", value: (h, e) => roundOrNull(dryYield(e), 3) },
];

/**
 * Converts a 0-based column index into its spreadsheet letter(s) — 0 ->
 * "A", 25 -> "Z", 26 -> "AA", matching COLUMNS' 27 entries (A through AA,
 * same span as the reference template's Import Data tab).
 * @param {number} index
 * @returns {string}
 */
function columnLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * @param {import('./models.js').TrialHeader} header
 * @param {import('./models.js').PlotEntry[]} entries
 * @param {{isCustomCompany: (name: string) => boolean, isCustomHybrid: (brand: string, hybrid: string) => boolean}} customChecks
 * @returns {string}
 */
function buildSheet1Xml(header, entries, customChecks) {
  const nonBlank = entries.filter((e) => !isEntryBlank(e));
  const lastCol = columnLetter(COLUMNS.length - 1);
  const lastRow = nonBlank.length + 1;

  let headerCells = "";
  COLUMNS.forEach((col, i) => {
    headerCells += cellInline(`${columnLetter(i)}1`, 1, col.header);
  });
  let rows = `<row r="1">${headerCells}</row>`;

  nonBlank.forEach((entry, idx) => {
    const r = idx + 2;
    const position = idx + 1;
    const ctx = { provider: varietyProviderFor(entry.brand, entry.hybrid, customChecks) };
    let cells = "";
    COLUMNS.forEach((col, i) => {
      const ref = `${columnLetter(i)}${r}`;
      const val = col.value(header, entry, position, ctx);
      cells += col.type === "number" ? cellNum(ref, 0, val) : cellInline(ref, 0, val || "");
    });
    rows += `<row r="${r}">${cells}</row>`;
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr baseColWidth="10" defaultColWidth="8.83203125" defaultRowHeight="13"/>` +
    `<cols><col min="1" max="${COLUMNS.length}" width="18" customWidth="1"/></cols>` +
    `<sheetData>${rows}</sheetData>` +
    `</worksheet>`
  );
}

// ---- Minimal, self-contained OOXML package parts (no theme, no shared
// strings — every text cell uses inlineStr so nothing needs a shared
// string table). Deliberately separate from xlsxTemplateParts.js's
// constants, which describe the full "Trial Outline" template's
// multi-sheet layout (Lists sheet, drawing/logo image) this export
// doesn't use at all. ----

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Import Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// Style 0 = default (regular). Style 1 = bold, used only for the header
// row so it's easy to tell apart from data when opened for a manual
// spot-check before uploading.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/**
 * @param {string} sheet1Xml
 * @returns {Blob}
 */
function assembleWorkbook(sheet1Xml) {
  const zip = new ZipWriter();
  zip.addFile("[Content_Types].xml", CONTENT_TYPES);
  zip.addFile("_rels/.rels", ROOT_RELS);
  zip.addFile("docProps/core.xml", coreProperties(new Date().toISOString()));
  zip.addFile("docProps/app.xml", APP_PROPERTIES);
  zip.addFile("xl/workbook.xml", WORKBOOK_XML);
  zip.addFile("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
  zip.addFile("xl/styles.xml", STYLES_XML);
  zip.addFile("xl/worksheets/sheet1.xml", sheet1Xml);
  const zipBlob = zip.finalize();
  return new Blob([zipBlob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/**
 * Filename is the plot's Form ID (per explicit request) — e.g.
 * "26-1030_Seedware.xlsx". The "_Seedware" suffix (not just
 * "26-1030.xlsx" on its own) is deliberate: the existing full XLSX
 * export (see xlsxBuilder.js's exportFilename()) already uses the bare
 * "<formId>.xlsx" name, and both files now travel together in the same
 * email/share action (see plotSummary.js's handleEmailXlsx()) — giving
 * them identical filenames would make the two attachments indistinguishable
 * once downloaded. Falls back to the same State_Year_Cooperator scheme
 * xlsxBuilder.js uses for a plot that doesn't have a Form ID yet, so
 * this never blocks on server connectivity either.
 * @param {import('./models.js').TrialHeader} header
 * @returns {string}
 */
export function seedwareExportFilename(header) {
  if (header.formId) return `${header.formId}_Seedware.xlsx`;
  const state = sanitizeFilenamePart(header.state || "State");
  const year = String(filenameYear(header));
  const coop = sanitizeFilenamePart(header.cooperatorName || "Cooperator");
  return `${state}_${year}_${coop}_Seedware.xlsx`;
}

/**
 * @param {import('./models.js').TrialHeader} header
 * @param {import('./models.js').PlotEntry[]} entries
 * @param {{isCustomCompany: (name: string) => boolean, isCustomHybrid: (brand: string, hybrid: string) => boolean}} [customChecks]
 *   Pass listsStore.isCustomCompany/listsStore.isCustomHybrid directly
 *   (see plotSummary.js) — kept as an injected dependency, same pattern
 *   as xlsxBuilder.buildXlsx()'s effectiveLists param, so this module
 *   stays decoupled from listsStore.js's module-level state and easy to
 *   unit-test with plain stub functions. Defaults to "nothing is ever a
 *   Request" if omitted.
 * @returns {{blob: Blob, filename: string}}
 */
export function buildSeedwareExport(header, entries, customChecks) {
  const sheet1Xml = buildSheet1Xml(header, entries, customChecks || NO_CUSTOM_ITEMS);
  const blob = assembleWorkbook(sheet1Xml);
  const filename = seedwareExportFilename(header);
  return { blob, filename };
}
