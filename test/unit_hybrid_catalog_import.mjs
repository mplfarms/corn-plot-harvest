// Unit-tests core/hybridCatalogImport.js's pure spreadsheet-grid parsing
// — rowsFromAOA() (flexible header matching + row validation) and
// parseCsvToAOA() (the hand-rolled CSV parser used for a .csv upload,
// see adminPlots.js). No SheetJS/DOM/network involved — these are
// dependency-free functions by design specifically so they're testable
// like this (see the module's own top comment).

import { rowsFromAOA, parseCsvToAOA, isHouseBrandAlias, isCompanyGroupBrand } from "../public/js/core/hybridCatalogImport.js";

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

// ---- rowsFromAOA: header matching is flexible/keyword-based ----
{
  const aoa = [
    ["Brand", "Hybrid Name", "Maturity (RM/CRM day)", "Trait", "Confidence", "Notes"],
    ["AgriGold", "A616-30", 86, "VT Double PRO", "High", ""],
    ["AgriGold", "A620-99", 90, "SmartStax", "High", ""],
  ];
  const { rows, skippedCount, headerError } = rowsFromAOA(aoa);
  check(headerError === null, `real header row (with extra Confidence/Notes columns) is recognized (got "${headerError}")`);
  check(rows.length === 2, `both data rows parsed (got ${rows.length})`);
  check(
    rows[0].company === "AgriGold" && rows[0].hybrid === "A616-30" && rows[0].trait === "VT Double PRO" && rows[0].rm === 86,
    `first row's fields map correctly (got ${JSON.stringify(rows[0])})`
  );
  check(skippedCount === 0, `no rows skipped (got ${skippedCount})`);
}

// ---- rowsFromAOA: column order doesn't matter ----
{
  const aoa = [
    ["Trait", "RM", "Company", "Hybrid"],
    ["SS", 95, "Wyffels", "W1234"],
  ];
  const { rows, headerError } = rowsFromAOA(aoa);
  check(headerError === null, "reordered columns still recognized");
  check(
    rows.length === 1 && rows[0].company === "Wyffels" && rows[0].hybrid === "W1234" && rows[0].trait === "SS" && rows[0].rm === 95,
    `reordered columns map to the right fields (got ${JSON.stringify(rows[0])})`
  );
}

// ---- rowsFromAOA: missing a required column is a headerError, not a crash ----
{
  const aoa = [
    ["Brand", "Hybrid Name", "Notes"],
    ["AgriGold", "A616-30", ""],
  ];
  const { rows, headerError } = rowsFromAOA(aoa);
  check(typeof headerError === "string" && headerError.length > 0, `missing Trait/RM columns produces a headerError (got "${headerError}")`);
  check(rows.length === 0, "no rows are returned when the header itself is unusable");
}

// ---- rowsFromAOA: an empty file ----
{
  const { headerError } = rowsFromAOA([]);
  check(typeof headerError === "string", `an empty sheet produces a headerError, not a crash (got "${headerError}")`);
}

// ---- rowsFromAOA: a row missing a required field is skipped, not fatal ----
{
  const aoa = [
    ["Brand", "Hybrid", "Trait", "RM"],
    ["Pioneer", "P1234", "Qrome", 100],
    ["Pioneer", "", "Qrome", 101], // blank hybrid — skipped
    ["Pioneer", "P1236", "Qrome", "not a number"], // non-numeric RM — skipped
    ["Pioneer", "P1237", "Qrome", 103],
  ];
  const { rows, skippedCount } = rowsFromAOA(aoa);
  check(rows.length === 2, `2 valid rows survive, 2 invalid rows dropped (got ${rows.length})`);
  check(skippedCount === 2, `skippedCount reports exactly the 2 dropped rows (got ${skippedCount})`);
}

// ---- rowsFromAOA: a fully blank row (e.g. a trailing empty spreadsheet row) is silently ignored, not counted as "skipped" ----
{
  const aoa = [
    ["Brand", "Hybrid", "Trait", "RM"],
    ["Pioneer", "P1234", "Qrome", 100],
    ["", "", "", ""],
  ];
  const { rows, skippedCount } = rowsFromAOA(aoa);
  check(rows.length === 1 && skippedCount === 0, `a fully blank trailing row is ignored, not reported as skipped (rows=${rows.length}, skipped=${skippedCount})`);
}

// ---- parseCsvToAOA: basic + quoted fields with embedded commas ----
{
  const csv = 'Brand,Hybrid,Trait,RM\nWyffels,W1234,"SS, Pro",95\n"Golden Harvest",GH99,VT2P,101\n';
  const aoa = parseCsvToAOA(csv);
  check(aoa.length === 3, `3 CSV rows parsed including header (got ${aoa.length})`);
  check(aoa[1][2] === "SS, Pro", `a quoted field with an embedded comma is kept intact (got "${aoa[1][2]}")`);
  check(aoa[2][0] === "Golden Harvest", `a quoted field without internal commas still parses (got "${aoa[2][0]}")`);
}

// ---- parseCsvToAOA -> rowsFromAOA end-to-end ----
{
  const csv = "Company,Hybrid Name,Trait,Maturity\nStine,9014,Conventional,90\n";
  const aoa = parseCsvToAOA(csv);
  const { rows, headerError } = rowsFromAOA(aoa);
  check(headerError === null && rows.length === 1 && rows[0].company === "Stine", `a CSV file round-trips through both parsers correctly (got ${JSON.stringify(rows)})`);
}

// ---- "MW / NC / CR" house-brand alias expands into all 3 Brand Views ----
// (per explicit request — see HOUSE_BRAND_EXPANSION's comment in
// hybridCatalogImport.js; SuperCrost, by the same request, is an
// ordinary competitor and must NOT expand.)
{
  const aoa = [
    ["Brand", "Hybrid Name", "Maturity (RM/CRM day)", "Trait"],
    ["MW / NC / CR", "83-31 VT2PRIB", 83, "VT2P RIB"],
    ["SuperCrost", "10T84 VT2PRIB", 84, "VT2P RIB"],
  ];
  const { rows, skippedCount, headerError } = rowsFromAOA(aoa);
  check(headerError === null && skippedCount === 0, `house-alias file parses cleanly (headerError=${headerError}, skipped=${skippedCount})`);
  check(rows.length === 4, `1 house row + 1 SuperCrost row -> 3 expanded + 1 (got ${rows.length})`);
  const companies = rows.filter((r) => r.hybrid === "83-31 VT2PRIB").map((r) => r.company).sort();
  check(
    JSON.stringify(companies) === JSON.stringify(["Crow's", "Midwest Seed Genetics", "NC+ Hybrids"]),
    `the house row lands under all 3 Brand Views' exact catalog names (got ${JSON.stringify(companies)})`
  );
  check(
    rows.filter((r) => r.hybrid === "83-31 VT2PRIB").every((r) => r.trait === "VT2P RIB" && r.rm === 83),
    "every expanded copy keeps the source row's trait and RM"
  );
  const superCrost = rows.filter((r) => r.company === "SuperCrost");
  check(superCrost.length === 1 && superCrost[0].hybrid === "10T84 VT2PRIB", `SuperCrost stays a single ordinary competitor row (got ${superCrost.length})`);
}

// ---- alias matching is tolerant of separators, and specific ----
{
  check(isHouseBrandAlias("MW / NC / CR"), `"MW / NC / CR" matches the alias`);
  check(isHouseBrandAlias("MW/NC/CR"), `"MW/NC/CR" (no spaces) matches`);
  check(isHouseBrandAlias("mw - nc - cr"), `"mw - nc - cr" (dashes, lowercase) matches`);
  check(!isHouseBrandAlias("Mustang"), "an ordinary brand doesn't match");
  check(!isHouseBrandAlias("SuperCrost"), "SuperCrost doesn't match");
  check(!isHouseBrandAlias("Midwest Seed Genetics"), "a real house brand name itself doesn't match (only the combined alias expands)");
}

// ---- upload-group split: Company Hybrids vs Alt. Variety Hybrids ----
// Per explicit request: MW / NC / CR (the three house brands and their
// alias) AND SuperCrost belong to the "Company Hybrids" upload; every
// other brand belongs to "Alt. Variety Hybrids".
{
  check(isCompanyGroupBrand("Midwest Seed Genetics"), "Midwest Seed Genetics is a Company-group brand");
  check(isCompanyGroupBrand("NC+ Hybrids"), "NC+ Hybrids is a Company-group brand");
  check(isCompanyGroupBrand("Crow's"), "Crow's is a Company-group brand");
  check(isCompanyGroupBrand("Crows"), "Crows (no apostrophe) still matches the Company group");
  check(isCompanyGroupBrand("SuperCrost"), "SuperCrost moved to the Company group (per explicit request)");
  check(isCompanyGroupBrand("supercrost"), "supercrost (lowercase) still matches");
  check(isCompanyGroupBrand("MW / NC / CR"), "the un-expanded house alias itself counts as Company group");
  check(!isCompanyGroupBrand("Pioneer"), "Pioneer is an Alt.-Variety brand");
  check(!isCompanyGroupBrand("AgriGold"), "AgriGold is an Alt.-Variety brand");
  check(!isCompanyGroupBrand("Some Brand New Seed Co"), "an unknown brand defaults to the Alt. Variety group");
  check(!isCompanyGroupBrand(""), "a blank brand is not a Company-group brand");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
