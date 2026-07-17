// src/core/__selftest__.mjs
//
// Plain Node self-test for the pure-logic core modules. No DOM, no
// JSZip, no jsPDF — just Node built-ins + our own ES modules. Run with:
//   node src/core/__selftest__.mjs
// (package.json sets "type": "module" so plain `node file.js` treats
// it as ESM.)

import assert from "node:assert/strict";

import {
  calculatedDryYield,
  dryYield,
  gross,
  dryYieldSummary,
  parseNumber,
} from "./yieldCalculator.js";
import { escapeXml, cellInline, cellNum, formatNumber } from "./xmlHelpers.js";
import { CONTENT_TYPES, WORKBOOK_XML } from "./xlsxTemplateParts.js";
import { ZipWriter } from "./zipWriter.js";
import { createPlotEntry, createTrialHeader, formatHeaderDate, gpsCellText, filenameYear } from "./models.js";

let failures = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok  - ${label}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  - ${label}`);
    console.error(err);
  }
}

console.log("== yieldCalculator ==");

// -----------------------------------------------------------------
// Entry 1: h=20, g=100, l=10, k=4, j=25  =>  l*k*j = 1000 (chosen so
// the division is exact and easy to hand-verify).
//   calculatedDryYield = (100-20) * (100*110.465) / 1000
//                      = 80 * 11046.5 / 1000
//                      = 883720 / 1000
//                      = 883.72
// header: base=15.5, price=3.5, drying=0.06
//   h=20 > base+0.01=15.51, so r = h-base = 4.5
//   gross = m*price - (r*drying)*m = m*(price - r*drying)
//         = 883.72 * (3.5 - 4.5*0.06) = 883.72 * (3.5 - 0.27) = 883.72 * 3.23
//         = 2854.4156
// -----------------------------------------------------------------
const entry1 = createPlotEntry();
entry1.brand = "AgriCo";
entry1.hybrid = "H1";
entry1.moisturePercent = "20";
entry1.sampleNetWeightLbs = "100";
entry1.widthInches = "10";
entry1.numberOfRows = "4";
entry1.stripLengthFeet = "25";

const header = createTrialHeader(); // base=15.5, price=3.5, drying=0.06 by default

await check("calculatedDryYield entry1 == 883.72", () => {
  const y = calculatedDryYield(entry1);
  assert.ok(y !== null, "expected non-null");
  assert.ok(Math.abs(y - 883.72) < 1e-9, `got ${y}`);
});

await check("gross entry1 == 2854.4156", () => {
  const g = gross(entry1, header);
  assert.ok(g !== null, "expected non-null");
  assert.ok(Math.abs(g - 2854.4156) < 1e-6, `got ${g}`);
});

// -----------------------------------------------------------------
// Entry 2: h=10 (below base 15.5), g=50, l*k*j=1000
//   calculatedDryYield = (100-10) * (50*110.465) / 1000
//                      = 90 * 5523.25 / 1000
//                      = 497092.5 / 1000
//                      = 497.0925
//   h=10 <= base+0.01, so gross = m*price = 497.0925 * 3.5 = 1739.82375
// -----------------------------------------------------------------
const entry2 = createPlotEntry();
entry2.brand = "AgriCo";
entry2.hybrid = "H2";
entry2.moisturePercent = "10";
entry2.sampleNetWeightLbs = "50";
entry2.widthInches = "10";
entry2.numberOfRows = "4";
entry2.stripLengthFeet = "25";

await check("calculatedDryYield entry2 == 497.0925", () => {
  const y = calculatedDryYield(entry2);
  assert.ok(Math.abs(y - 497.0925) < 1e-9, `got ${y}`);
});

await check("gross entry2 == 1739.82375", () => {
  const g = gross(entry2, header);
  assert.ok(Math.abs(g - 1739.82375) < 1e-6, `got ${g}`);
});

// -----------------------------------------------------------------
// Entry 3: manualDryYield overrides calculated. h=12 (below base) so
// gross = manual * price = 123.4 * 3.5 = 431.9. Blank brand -> groups
// under "Unlisted Brand" in dryYieldSummary.
// -----------------------------------------------------------------
const entry3 = createPlotEntry();
entry3.brand = "   ";
entry3.hybrid = "H3";
entry3.moisturePercent = "12";
entry3.manualDryYield = "123.4";
// intentionally leave sampleNetWeightLbs/width/rows/strip blank — manual
// override means calculatedDryYield's null-guard is irrelevant here.

await check("dryYield entry3 uses manual override == 123.4", () => {
  const y = dryYield(entry3);
  assert.ok(Math.abs(y - 123.4) < 1e-9, `got ${y}`);
});

await check("gross entry3 == 431.9", () => {
  const g = gross(entry3, header);
  assert.ok(Math.abs(g - 431.9) < 1e-6, `got ${g}`);
});

// Null-guard checks
await check("calculatedDryYield returns null when moisture is 0", () => {
  const e = createPlotEntry();
  e.moisturePercent = "0";
  e.sampleNetWeightLbs = "100";
  e.widthInches = "10";
  e.numberOfRows = "4";
  e.stripLengthFeet = "25";
  assert.equal(calculatedDryYield(e), null);
});

await check("gross returns null when moisture is empty", () => {
  const e = createPlotEntry();
  e.moisturePercent = "";
  assert.equal(gross(e, header), null);
});

// -----------------------------------------------------------------
// dryYieldSummary: independent re-computation of mean/variance/cv from
// the three dry-yield values above (883.72, 497.0925, 123.4), used to
// cross-check the module's grouping + statistics logic.
// -----------------------------------------------------------------
await check("dryYieldSummary groups by brand and computes stats", () => {
  const values = [883.72, 497.0925, 123.4];
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / (n - 1);
  const cv = (Math.sqrt(variance) / mean) * 100;

  const summary = dryYieldSummary([entry1, entry2, entry3]);

  assert.ok(Math.abs(summary.mean - mean) < 1e-9, `mean got ${summary.mean}, want ${mean}`);
  assert.equal(summary.sampleCount, 3);
  assert.ok(
    Math.abs(summary.coefficientOfVariation - cv) < 1e-9,
    `cv got ${summary.coefficientOfVariation}, want ${cv}`
  );

  // byBrand: AgriCo (avg of entry1,entry2) should rank first (higher avg)
  // over Unlisted Brand (just entry3).
  const agriAvg = (883.72 + 497.0925) / 2; // 690.40625
  assert.equal(summary.byBrand.length, 2);
  assert.equal(summary.byBrand[0].brand, "AgriCo");
  assert.ok(Math.abs(summary.byBrand[0].average - agriAvg) < 1e-9);
  assert.equal(summary.byBrand[0].count, 2);
  assert.equal(summary.byBrand[1].brand, "Unlisted Brand");
  assert.ok(Math.abs(summary.byBrand[1].average - 123.4) < 1e-9);
  assert.equal(summary.byBrand[1].count, 1);
});

await check("dryYieldSummary returns null mean/cv for empty input", () => {
  const summary = dryYieldSummary([]);
  assert.equal(summary.mean, null);
  assert.equal(summary.coefficientOfVariation, null);
  assert.equal(summary.sampleCount, 0);
  assert.deepEqual(summary.byBrand, []);
});

await check("dryYieldSummary cv is null with only 1 sample", () => {
  const summary = dryYieldSummary([entry3]);
  assert.notEqual(summary.mean, null);
  assert.equal(summary.coefficientOfVariation, null);
});

await check("parseNumber trims and rejects non-finite/empty", () => {
  assert.equal(parseNumber("  42.5 "), 42.5);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("   "), null);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber(undefined), null);
});

console.log("== models ==");

await check("formatHeaderDate formats YYYY-MM-DD to MM/DD/YYYY", () => {
  assert.equal(formatHeaderDate("2026-07-13"), "07/13/2026");
  assert.equal(formatHeaderDate(null), "");
  assert.equal(formatHeaderDate(""), "");
});

await check("gpsCellText formats lat/lon to 6 decimals", () => {
  const h = createTrialHeader();
  h.gpsLatitude = 41.5;
  h.gpsLongitude = -93.123456789;
  assert.equal(gpsCellText(h), "41.500000 -93.123457");
  h.gpsLongitude = null;
  assert.equal(gpsCellText(h), "");
});

await check("filenameYear parses leading 4 digits without timezone shifting", () => {
  const h = createTrialHeader();
  h.datePlanted = "2025-12-31";
  assert.equal(filenameYear(h), 2025);
  h.datePlanted = null;
  assert.equal(filenameYear(h), new Date().getFullYear());
});

console.log("== xmlHelpers ==");

await check("escapeXml escapes & first, then < > \", normalizes newlines", () => {
  assert.equal(escapeXml('A & B < C > D "E"'), "A &amp; B &lt; C &gt; D &quot;E&quot;");
  assert.equal(escapeXml("line1\r\nline2\rline3"), "line1\nline2\nline3");
  // Ensure & is escaped first so "&lt;" in source text isn't double-escaped
  // into "&amp;lt;" incorrectly relative to spec order (escape & first is
  // still correct: raw "<" becomes "&lt;", not double escaped).
  assert.equal(escapeXml("<"), "&lt;");
  assert.equal(escapeXml("&"), "&amp;");
});

await check("formatNumber: integers have no decimal point", () => {
  assert.equal(formatNumber(5), "5");
  assert.equal(formatNumber(-5), "-5");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(100), "100");
});

await check("formatNumber: decimals trimmed of trailing zeros", () => {
  assert.equal(formatNumber(3.5), "3.5");
  assert.equal(formatNumber(3.140000), "3.14");
  assert.equal(formatNumber(0.06), "0.06");
  assert.equal(formatNumber(1 / 3), (1 / 3).toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));
  assert.equal(formatNumber(-2.5), "-2.5");
});

await check("cellInline: blank text yields self-closing cell, non-blank wraps inlineStr", () => {
  assert.equal(cellInline("B2", 81, "   "), '<c r="B2" s="81"/>');
  assert.equal(cellInline("B2", 81, ""), '<c r="B2" s="81"/>');
  assert.equal(
    cellInline("B2", 81, "Hello & <World>"),
    '<c r="B2" s="81" t="inlineStr"><is><t xml:space="preserve">Hello &amp; &lt;World&gt;</t></is></c>'
  );
  assert.equal(
    cellInline("B2", 81, "  Trimmed  "),
    '<c r="B2" s="81" t="inlineStr"><is><t xml:space="preserve">Trimmed</t></is></c>'
  );
});

await check("cellNum: null/undefined yields self-closing cell, numbers formatted", () => {
  assert.equal(cellNum("A1", 47, null), '<c r="A1" s="47"/>');
  assert.equal(cellNum("A1", 47, undefined), '<c r="A1" s="47"/>');
  assert.equal(cellNum("A1", 47, 5), '<c r="A1" s="47"><v>5</v></c>');
  assert.equal(cellNum("A1", 47, 3.5), '<c r="A1" s="47"><v>3.5</v></c>');
});

console.log("== xlsxTemplateParts (constants only) ==");

await check("static XML constants are non-empty and well-formed at a glance", () => {
  assert.ok(CONTENT_TYPES.startsWith("<?xml"));
  assert.ok(CONTENT_TYPES.includes("[Content_Types]") === false); // sanity: no literal filename inside
  assert.ok(CONTENT_TYPES.includes("<Types "));
  assert.ok(WORKBOOK_XML.includes('sheetId="1"'));
  assert.ok(WORKBOOK_XML.includes('sheetId="2"'));
});

console.log("== zipWriter ==");

await check("ZipWriter produces a non-empty Blob with valid local file header magic", async () => {
  const zip = new ZipWriter();
  zip.addFile("hello.txt", "Hello, world!");
  const binary = new Uint8Array([0, 1, 2, 3, 255, 254, 253, 10, 13, 65, 66, 67]);
  zip.addFile("data.bin", binary.buffer);
  const blob = zip.finalize();

  assert.ok(blob instanceof Blob, "finalize() should return a Blob");
  assert.ok(blob.size > 0, "blob should be non-empty");

  const buf = new Uint8Array(await blob.arrayBuffer());

  // Local file header magic PK\x03\x04 must appear at offset 0.
  assert.equal(buf[0], 0x50); // 'P'
  assert.equal(buf[1], 0x4b); // 'K'
  assert.equal(buf[2], 0x03);
  assert.equal(buf[3], 0x04);

  // Filenames should appear verbatim as bytes somewhere in the archive
  // (both in local headers and the central directory).
  const text = Buffer.from(buf).toString("latin1");
  assert.ok(text.includes("hello.txt"), "hello.txt filename not found in zip bytes");
  assert.ok(text.includes("data.bin"), "data.bin filename not found in zip bytes");

  // End of central directory signature PK\x05\x06 must appear.
  assert.ok(text.includes("PK\x05\x06"), "EOCD signature not found");

  // Central directory signature PK\x01\x02 must appear twice (2 entries).
  const centralSig = "PK\x01\x02";
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(centralSig, idx)) !== -1) {
    count++;
    idx += centralSig.length;
  }
  assert.equal(count, 2, `expected 2 central directory records, found ${count}`);
});

console.log("== xlsxBuilder (end-to-end integration smoke test) ==");

// buildXlsx() calls loadTemplateParts(), which does fetch("/template/...").
// There's no server in this sandbox, so we mock global.fetch to read the
// same files straight off disk from public/template/. This exercises the
// full row/formula/footer/suffix string-generation pipeline in xlsxBuilder.js
// (not just the small exported surface), plus the ZipWriter, end to end.
{
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicTemplateDir = path.join(here, "..", "..", "public", "template");

  globalThis.fetch = async (url) => {
    const name = String(url).replace(/^\/template\//, "");
    const filePath = path.join(publicTemplateDir, name);
    if (name.endsWith(".emf")) {
      const buf = await readFile(filePath);
      return { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    }
    const text = await readFile(filePath, "utf8");
    return { text: async () => text };
  };

  const { buildXlsx, exportFilename, createEffectiveLists } = await import("./xlsxBuilder.js");

  const lists = createEffectiveLists({
    companies: ["Acme Seed", "Beta Genetics"],
    hybrids: ["H100", "H200", "H300"],
    traits: ["VT2P", "SS"],
    seedTreatments: ["Poncho", "Cruiser"],
    irrigationOptions: ["Dryland", "Irrigated"],
    tillageOptions: ["No-Till", "Conventional"],
    soilTypeOptions: ["Loam", "Clay"],
    previousCropOptions: ["Soybeans", "Corn"],
  });

  const testHeader = createTrialHeader();
  testHeader.cooperatorName = "O'Brien & Sons";
  testHeader.state = "IA";
  testHeader.datePlanted = "2026-05-01";
  testHeader.gpsLatitude = 41.5;
  testHeader.gpsLongitude = -93.6;

  // Small entry list (fewer than templateLastEntryRow=42 - firstEntryRow=11 + 1 = 32 template rows)
  const testEntries = [entry1, entry2, entry3];

  let zipBytes;
  await check("buildXlsx resolves to a Blob + filename with small entry list", async () => {
    const { blob, filename } = await buildXlsx(testHeader, testEntries, lists);
    assert.ok(blob instanceof Blob);
    assert.ok(blob.size > 0);
    assert.equal(filename, exportFilename(testHeader));
    assert.ok(filename.endsWith(".xlsx"));
    zipBytes = new Uint8Array(await blob.arrayBuffer());
  });

  await check("buildXlsx sheet1.xml has no leftover {{placeholders}} and contains expected rows/formulas", () => {
    const sheet1Xml = extractZipEntryText(zipBytes, "xl/worksheets/sheet1.xml");
    assert.ok(sheet1Xml.length > 0, "sheet1.xml should be non-empty");
    assert.ok(!sheet1Xml.includes("{{"), "no unresolved {{...}} placeholders should remain");
    // 3 entries -> firstEntryRow=11,12,13 should exist as entry rows.
    assert.ok(sheet1Xml.includes('<row r="11" spans="1:30"'));
    assert.ok(sheet1Xml.includes('<row r="12" spans="1:30"'));
    assert.ok(sheet1Xml.includes('<row r="13" spans="1:30"'));
    // Table extends to templateLastEntryRow=42 (padded with blank rows) since
    // 3 entries < 32 template rows, so delta=0 and footer starts at row 43.
    assert.ok(sheet1Xml.includes('<row r="42" spans="1:30"'));
    assert.ok(sheet1Xml.includes('<row r="43"'));
    // Cooperator name (inline string, XML-escaped &; escapeXml does not
    // touch apostrophes per spec) should appear.
    assert.ok(sheet1Xml.includes("O'Brien &amp; Sons"), "expected escaped cooperator name in sheet1.xml");
    // Dry-yield formula for the first entry row.
    assert.ok(sheet1Xml.includes('<f>IF(H11=0,"",+(100-H11)*(G11*110.465)/(L11*K11*J11))</f>'));
    // Entry3 has manualDryYield=123.4 -> literal <v>123.4</v> on row 13 (M13), no formula.
    assert.ok(sheet1Xml.includes('<c r="M13" s="34"><v>123.4</v></c>'));
    // GPS cell text on row 6.
    assert.ok(sheet1Xml.includes("41.500000 -93.600000"));
    // dimension ref should have a concrete row number, not the placeholder.
    assert.ok(/<dimension ref="A1:AD\d+"\/>/.test(sheet1Xml));
  });

  await check("buildXlsx sheet2.xml (Lists) contains the effective lists data", () => {
    const sheet2Xml = extractZipEntryText(zipBytes, "xl/worksheets/sheet2.xml");
    assert.ok(sheet2Xml.includes("H100"));
    assert.ok(sheet2Xml.includes("Acme Seed"));
    assert.ok(sheet2Xml.includes("Poncho"));
  });

  await check("buildXlsx pads entries beyond templateLastEntryRow (delta > 0) and shifts footer/suffix refs", async () => {
    // 35 entries -> lastDataRow = 11 + 35 - 1 = 45 > templateLastEntryRow(42) -> delta = 3.
    const manyEntries = [];
    for (let i = 0; i < 35; i++) {
      const e = createPlotEntry();
      e.brand = `Brand${i}`;
      e.hybrid = `Hyb${i}`;
      e.moisturePercent = "18";
      e.sampleNetWeightLbs = "60";
      e.widthInches = "10";
      e.numberOfRows = "4";
      e.stripLengthFeet = "25";
      manyEntries.push(e);
    }
    const { blob } = await buildXlsx(testHeader, manyEntries, lists);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sheet1Xml = extractZipEntryText(bytes, "xl/worksheets/sheet1.xml");
    assert.ok(!sheet1Xml.includes("{{"));
    // tableLastRow = max(45,42) = 45; last entry row should be 45, footer avg row = 43+delta(3)=46.
    assert.ok(sheet1Xml.includes('<row r="45" spans="1:30"'));
    assert.ok(sheet1Xml.includes('<row r="46" spans="1:29" ht="19.5"'));
    // C-refs used in formulas should point at shifted base-moisture/drying/price rows (47,48,49).
    assert.ok(sheet1Xml.includes("$C$47"));
    assert.ok(sheet1Xml.includes("$C$48"));
    assert.ok(sheet1Xml.includes("$C$49"));
  });
}

console.log("");
if (failures > 0) {
  console.error(`${failures} SELFTEST(S) FAILED`);
  process.exit(1);
} else {
  console.log("ALL SELFTESTS PASSED");
}

// -----------------------------------------------------------------
// Minimal STORED-zip reader used only by the integration smoke test above,
// to pull a single entry's text content back out of a ZipWriter-produced
// archive via its central directory (no external zip library).
// -----------------------------------------------------------------
function extractZipEntryText(bytes, entryPath) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Find End Of Central Directory record (search from the end).
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("EOCD not found");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  let ptr = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("bad central dir signature");
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const nameBytes = bytes.slice(ptr + 46, ptr + 46 + nameLen);
    const name = Buffer.from(nameBytes).toString("utf8");

    if (name === entryPath) {
      const lv = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset, 30);
      const localNameLen = lv.getUint16(26, true);
      const localExtraLen = lv.getUint16(28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataBytes = bytes.slice(dataStart, dataStart + compressedSize);
      return Buffer.from(dataBytes).toString("utf8");
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry not found: ${entryPath}`);
}
