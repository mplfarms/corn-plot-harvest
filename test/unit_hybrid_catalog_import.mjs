// Unit-tests core/hybridCatalogImport.js's pure spreadsheet-grid parsing
// — rowsFromAOA() (flexible header matching + row validation) and
// parseCsvToAOA() (the hand-rolled CSV parser used for a .csv upload,
// see adminPlots.js). No SheetJS/DOM/network involved — these are
// dependency-free functions by design specifically so they're testable
// like this (see the module's own top comment).

import { rowsFromAOA, parseCsvToAOA } from "../public/js/core/hybridCatalogImport.js";

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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
