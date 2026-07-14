// src/core/xlsxBuilder.js
//
// Line-for-line port of Export/XLSXBuilder.swift. Cell styles, row
// numbers, formulas, and the footer/spacer-row logic must match the
// original exactly, since real Excel files must open without a repair
// prompt. Do not "clean up" or restructure this algorithm.

import { cellInline, cellNum, formatNumber, parseNumber } from "./xmlHelpers.js";
import { formatHeaderDate, gpsCellText, filenameYear } from "./models.js";
import { loadTemplateParts, CONTENT_TYPES, ROOT_RELS, WORKBOOK_XML, WORKBOOK_RELS, SHEET1_RELS, coreProperties, APP_PROPERTIES } from "./xlsxTemplateParts.js";
import { ZipWriter } from "./zipWriter.js";

// Mirrors the Swift `Style` enum's numeric style indices (into styles.xml).
const Style = {
  b2: 81, b3: 82, b4: 83, f4: 81, i4: 31, b5: 84, b6: 85,
  m1: 88, m2: 90, m3: 91, m4: 83, m5: 83, m6: 93, m7: 88,
  b8: 81, f8: 81, l8: 14,
  entryA: 47, entryBrandD: 32, entryHybrid: 33,
  entryMid: 7, entryBoundaryG: 8, entryBoundaryHI: 9,
  entryJK: 13,
  m: 34, n: 35, o: 36, p: 35, q: 18, r: 12, s: 11, t: 24, w: 19, y: 1, aa: 19, ab: 21, ac: 20,
  comments: 1,
  footerAvgLabel: 37, footerAvgG: 38, footerAvgJKL: 39, footerAvgN: 40, footerAvgO: 41, footerAvgP: 42,
  footerConstLabel: 43, footerBaseMoistureVal: 44, footerDryingVal: 47, footerPriceVal: 48,
  footerNotesLabel: 45, footerNotesBlank: 46, footerPriceRowO: 49,
};

const firstEntryRow = 11;
const templateLastEntryRow = 42;

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow1(h) {
  return (
    `<row r="1" spans="1:29" s="2" customFormat="1" ht="23"><c r="A1" s="69"/><c r="B1" s="86" t="s"><v>294</v></c><c r="C1" s="86"/><c r="D1" s="86"/><c r="E1" s="86"/><c r="F1" s="50"/><c r="G1" s="51"/><c r="H1" s="51"/><c r="I1" s="51"/><c r="J1" s="52"/><c r="K1" s="87" t="s"><v>6</v></c><c r="L1" s="87"/>` +
    cellInline("M1", Style.m1, formatHeaderDate(h.datePlanted)) +
    `<c r="N1" s="88"/><c r="O1" s="88"/><c r="P1" s="53"/><c r="Q1" s="16"/><c r="T1" s="22"/></row>`
  );
}

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow2(h) {
  return (
    `<row r="2" spans="1:29" s="2" customFormat="1" ht="30" customHeight="1"><c r="A2" s="74" t="s"><v>0</v></c>` +
    cellInline("B2", Style.b2, h.cooperatorName) +
    `<c r="C2" s="81"/><c r="D2" s="81"/><c r="E2" s="81"/><c r="F2" s="81"/><c r="G2" s="81"/><c r="H2" s="1"/><c r="I2" s="1"/><c r="K2" s="89" t="s"><v>30</v></c><c r="L2" s="89"/>` +
    cellInline("M2", Style.m2, h.tillage) +
    `<c r="N2" s="90"/><c r="O2" s="90"/><c r="P2" s="68"/><c r="Q2" s="16"/><c r="T2" s="22"/></row>`
  );
}

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow3(h) {
  return (
    `<row r="3" spans="1:29" s="2" customFormat="1" ht="30" customHeight="1"><c r="A3" s="74" t="s"><v>19</v></c>` +
    cellInline("B3", Style.b3, h.address) +
    `<c r="C3" s="82"/><c r="D3" s="82"/><c r="E3" s="82"/><c r="F3" s="82"/><c r="G3" s="82"/><c r="H3" s="1"/><c r="I3" s="1"/><c r="K3" s="89" t="s"><v>31</v></c><c r="L3" s="89"/>` +
    cellInline("M3", Style.m3, h.irrigation) +
    `<c r="N3" s="91"/><c r="O3" s="91"/><c r="P3" s="55"/><c r="Q3" s="16"/><c r="T3" s="22"/></row>`
  );
}

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow4(h) {
  return (
    `<row r="4" spans="1:29" s="2" customFormat="1" ht="30" customHeight="1"><c r="A4" s="74" t="s"><v>2</v></c>` +
    cellInline("B4", Style.b4, h.city) +
    `<c r="C4" s="83"/><c r="D4" s="83"/><c r="E4" s="56" t="s"><v>34</v></c>` +
    cellInline("F4", Style.f4, h.state) +
    `<c r="G4" s="81"/><c r="H4" s="56" t="s"><v>18</v></c>` +
    cellInline("I4", Style.i4, h.zip) +
    `<c r="K4" s="92" t="s"><v>32</v></c><c r="L4" s="92"/>` +
    cellInline("M4", Style.m4, h.soilType) +
    `<c r="N4" s="83"/><c r="O4" s="83"/><c r="P4" s="57"/><c r="Q4" s="16"/><c r="T4" s="22"/></row>`
  );
}

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow5(h) {
  return (
    `<row r="5" spans="1:29" s="2" customFormat="1" ht="30" customHeight="1"><c r="A5" s="74" t="s"><v>1</v></c>` +
    cellInline("B5", Style.b5, h.county) +
    `<c r="C5" s="84"/><c r="D5" s="84"/><c r="E5" s="84"/><c r="F5" s="84"/><c r="G5" s="84"/><c r="H5" s="58"/><c r="I5" s="58"/><c r="K5" s="89" t="s"><v>8</v></c><c r="L5" s="89"/>` +
    cellInline("M5", Style.m5, h.previousCrop) +
    `<c r="N5" s="83"/><c r="O5" s="83"/><c r="P5" s="57"/><c r="Q5" s="16"/><c r="T5" s="22"/></row>`
  );
}

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow6(h) {
  return (
    `<row r="6" spans="1:29" s="2" customFormat="1" ht="30" customHeight="1"><c r="A6" s="75" t="s"><v>173</v></c>` +
    cellInline("B6", Style.b6, gpsCellText(h)) +
    `<c r="C6" s="85"/><c r="D6" s="85"/><c r="E6" s="85"/><c r="F6" s="85"/><c r="G6" s="85"/><c r="H6" s="58"/><c r="I6" s="58"/><c r="L6" s="54" t="s"><v>33</v></c>` +
    cellInline("M6", Style.m6, h.plantingPopulation) +
    `<c r="N6" s="93"/><c r="O6" s="93"/><c r="P6" s="53"/><c r="Q6" s="16"/><c r="T6" s="22"/></row>`
  );
}

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow7(h) {
  return (
    `<row r="7" spans="1:29" ht="30" customHeight="1"><c r="A7" s="70"/><c r="K7" s="89" t="s"><v>7</v></c><c r="L7" s="89"/>` +
    cellInline("M7", Style.m7, formatHeaderDate(h.dateHarvested)) +
    `<c r="N7" s="88"/><c r="O7" s="88"/><c r="P7" s="59"/></row>`
  );
}

/**
 * @param {import('./models.js').TrialHeader} h
 * @returns {string}
 */
function headerRow8(h) {
  return (
    `<row r="8" spans="1:29" ht="30" customHeight="1"><c r="A8" s="73" t="s"><v>13</v></c>` +
    cellInline("B8", Style.b8, h.collectedBy) +
    `<c r="C8" s="81"/><c r="D8" s="81"/><c r="E8" s="56" t="s"><v>14</v></c>` +
    cellInline("F8", Style.f8, h.phone) +
    `<c r="G8" s="81"/><c r="H8" s="81"/><c r="I8" s="81"/><c r="J8" s="81"/><c r="K8" s="56" t="s"><v>17</v></c>` +
    cellInline("L8", Style.l8, h.email) +
    `<c r="M8" s="14"/><c r="N8" s="14"/><c r="O8" s="14"/><c r="P8" s="60"/></row>`
  );
}

/**
 * @param {number} r
 * @param {string} c44Ref
 * @param {string} c45Ref
 * @param {string} c46Ref
 * @param {string} mRange
 * @param {string} oRange
 * @param {number|null} manualDryYield
 * @returns {string}
 */
function formulaCells(r, c44Ref, c45Ref, c46Ref, mRange, oRange, manualDryYield) {
  let out = "";
  if (manualDryYield !== null && manualDryYield !== undefined) {
    out += `<c r="M${r}" s="34"><v>${formatNumber(manualDryYield)}</v></c>`;
  } else {
    out += `<c r="M${r}" s="34" t="str"><f>IF(H${r}=0,"",+(100-H${r})*(G${r}*110.465)/(L${r}*K${r}*J${r}))</f><v/></c>`;
  }
  out += `<c r="N${r}" s="35" t="str"><f>IF(H${r}=0,"",RANK(M${r},${mRange},0))</f><v/></c>`;
  out += `<c r="O${r}" s="36" t="str"><f>IF(H${r}=0,"",T${r})</f><v/></c>`;
  out += `<c r="P${r}" s="35" t="str"><f>IF(O${r}=0,"",RANK(O${r},${oRange},0))</f><v/></c>`;
  out += `<c r="Q${r}" s="18" t="b"><f>(+H${r}&gt;${c44Ref}+0.01)</f><v>0</v></c>`;
  out += `<c r="R${r}" s="12"><f>+H${r}-${c44Ref}</f></c>`;
  out += `<c r="S${r}" s="11"><f>IF(Q${r},+((M${r}*${c46Ref})-((R${r}*${c45Ref})*M${r})),+H${r}*${c46Ref})</f></c>`;
  out += `<c r="T${r}" s="24" t="str"><f>IF((H${r}&gt;${c44Ref}+0.01),((M${r}*${c46Ref})-((R${r}*${c45Ref})*M${r})),((M${r}*${c46Ref})))</f><v/></c>`;
  out += `<c r="W${r}" s="19" t="str"><f>M${r}*${c46Ref}</f><v/></c>`;
  out += `<c r="Y${r}" s="1"><f>IF(H${r}&lt;=15.5,0,((H${r}-${c44Ref})*${c45Ref}))</f></c>`;
  out += `<c r="AA${r}" s="19" t="str"><f>Y${r}*M${r}</f><v/></c>`;
  out += `<c r="AB${r}" s="21" t="str"><f>W${r}-AA${r}</f><v/></c>`;
  out += `<c r="AC${r}" s="20"/>`;
  return out;
}

/**
 * @param {number} rowNum
 * @param {import('./models.js').PlotEntry} entry
 * @param {number} entryIndex
 * @param {boolean} isBoundary
 * @param {string} c44Ref
 * @param {string} c45Ref
 * @param {string} c46Ref
 * @param {string} mRange
 * @param {string} oRange
 * @param {number|null} manualDryYield
 * @returns {string}
 */
function entryRowXML(rowNum, entry, entryIndex, isBoundary, c44Ref, c45Ref, c46Ref, mRange, oRange, manualDryYield) {
  const gs = isBoundary ? Style.entryBoundaryG : Style.entryMid;
  const hs = isBoundary ? Style.entryBoundaryHI : Style.entryMid;
  const is_ = isBoundary ? Style.entryBoundaryHI : Style.entryMid;
  const r = rowNum;
  let cells = "";
  cells += cellNum(`A${r}`, Style.entryA, entryIndex + 1);
  cells += cellInline(`B${r}`, Style.entryBrandD, entry.brand);
  cells += cellInline(`C${r}`, Style.entryHybrid, entry.hybrid);
  cells += cellInline(`D${r}`, Style.entryBrandD, entry.trait);
  cells += cellNum(`E${r}`, Style.entryMid, parseNumber(entry.relativeMaturity));
  cells += cellInline(`F${r}`, Style.entryMid, entry.seedTreatment);
  cells += cellNum(`G${r}`, gs, parseNumber(entry.sampleNetWeightLbs));
  cells += cellNum(`H${r}`, hs, parseNumber(entry.moisturePercent));
  cells += cellNum(`I${r}`, is_, parseNumber(entry.testWeight));
  cells += cellNum(`J${r}`, Style.entryJK, parseNumber(entry.stripLengthFeet));
  cells += cellNum(`K${r}`, Style.entryJK, parseNumber(entry.numberOfRows));
  cells += cellNum(`L${r}`, Style.entryMid, parseNumber(entry.widthInches));
  cells += formulaCells(r, c44Ref, c45Ref, c46Ref, mRange, oRange, manualDryYield);
  cells += cellInline(`AD${r}`, Style.comments, entry.comments);
  return `<row r="${r}" spans="1:30" ht="19.5" customHeight="1">${cells}</row>`;
}

/**
 * @param {number} rowNum
 * @param {boolean} isBoundary
 * @param {string} c44Ref
 * @param {string} c45Ref
 * @param {string} c46Ref
 * @param {string} mRange
 * @param {string} oRange
 * @returns {string}
 */
function blankRowXML(rowNum, isBoundary, c44Ref, c45Ref, c46Ref, mRange, oRange) {
  const gs = isBoundary ? Style.entryBoundaryG : Style.entryMid;
  const hs = isBoundary ? Style.entryBoundaryHI : Style.entryMid;
  const is_ = isBoundary ? Style.entryBoundaryHI : Style.entryMid;
  const r = rowNum;
  let cells = "";
  cells += cellNum(`A${r}`, Style.entryA, null);
  cells += cellInline(`B${r}`, Style.entryBrandD, "");
  cells += cellInline(`C${r}`, Style.entryHybrid, "");
  cells += cellInline(`D${r}`, Style.entryBrandD, "");
  cells += cellNum(`E${r}`, Style.entryMid, null);
  cells += cellInline(`F${r}`, Style.entryMid, "");
  cells += cellNum(`G${r}`, gs, null);
  cells += cellNum(`H${r}`, hs, null);
  cells += cellNum(`I${r}`, is_, null);
  cells += cellNum(`J${r}`, Style.entryJK, null);
  cells += cellNum(`K${r}`, Style.entryJK, null);
  cells += cellNum(`L${r}`, Style.entryMid, null);
  cells += formulaCells(r, c44Ref, c45Ref, c46Ref, mRange, oRange, null);
  cells += cellInline(`AD${r}`, Style.comments, "");
  return `<row r="${r}" spans="1:30" ht="19.5" customHeight="1">${cells}</row>`;
}

/**
 * @param {number} startRow
 * @param {number} dataLastRow
 * @param {import('./models.js').TrialHeader} header
 * @returns {string}
 */
function footerRows(startRow, dataLastRow, header) {
  const avg = startRow;
  const baseMoistureRow = startRow + 1;
  const dryingRow = startRow + 2;
  const priceRow = startRow + 3;

  let out = "";

  out += `<row r="${avg}" spans="1:29" ht="19.5" customHeight="1"><c r="A${avg}" s="47"/><c r="B${avg}" s="37" t="s"><v>23</v></c><c r="C${avg}" s="37"/><c r="D${avg}" s="37"/><c r="E${avg}" s="37"/><c r="F${avg}" s="37"/><c r="G${avg}" s="38"/><c r="H${avg}" s="38"><f>AVERAGE(H11:H${dataLastRow})</f></c><c r="I${avg}" s="38"><f>AVERAGE(I11:I${dataLastRow})</f></c><c r="J${avg}" s="39"/><c r="K${avg}" s="39"/><c r="L${avg}" s="39"/><c r="M${avg}" s="39"><f>AVERAGE(M11:M${dataLastRow})</f></c><c r="N${avg}" s="40"/><c r="O${avg}" s="41"><f>AVERAGE(O11:O${dataLastRow})</f></c><c r="P${avg}" s="42"/><c r="S${avg}" s="11"><f>IF(Q${avg},+((M${avg}*$C$${priceRow})-((R${avg}*$C$${dryingRow})*H${avg})),+H${avg}*$C$${priceRow})</f></c></row>`;

  out += `<row r="${baseMoistureRow}" spans="1:29"><c r="A${baseMoistureRow}" s="47"/><c r="B${baseMoistureRow}" s="43" t="s"><v>3</v></c>${cellNum(
    "C" + baseMoistureRow,
    44,
    header.baseMoisturePercent
  )}<c r="D${baseMoistureRow}" s="45" t="s"><v>109</v></c>${cellInline(
    "E" + baseMoistureRow,
    46,
    header.trialNotes
  )}<c r="F${baseMoistureRow}" s="46"/><c r="G${baseMoistureRow}" s="45"/><c r="H${baseMoistureRow}" s="45"/><c r="I${baseMoistureRow}" s="45"/><c r="J${baseMoistureRow}" s="45"/><c r="K${baseMoistureRow}" s="45"/><c r="L${baseMoistureRow}" s="46"/><c r="M${baseMoistureRow}" s="46"/><c r="N${baseMoistureRow}" s="46"/><c r="O${baseMoistureRow}" s="46"/><c r="P${baseMoistureRow}" s="46"/></row>`;

  out += `<row r="${dryingRow}" spans="1:29"><c r="A${dryingRow}" s="47"/><c r="B${dryingRow}" s="43" t="s"><v>4</v></c>${cellNum(
    "C" + dryingRow,
    47,
    header.dryingShrinkRate
  )}<c r="D${dryingRow}" s="45"/><c r="E${dryingRow}" s="46"/><c r="F${dryingRow}" s="46"/><c r="G${dryingRow}" s="45"/><c r="H${dryingRow}" s="45"/><c r="I${dryingRow}" s="45"/><c r="J${dryingRow}" s="45"/><c r="K${dryingRow}" s="45"/><c r="L${dryingRow}" s="46"/><c r="M${dryingRow}" s="46"/><c r="N${dryingRow}" s="46"/><c r="O${dryingRow}" s="46"/><c r="P${dryingRow}" s="46"/></row>`;

  out += `<row r="${priceRow}" spans="1:29"><c r="A${priceRow}" s="47"/><c r="B${priceRow}" s="43" t="s"><v>5</v></c>${cellNum(
    "C" + priceRow,
    48,
    header.pricePerBushel
  )}<c r="D${priceRow}" s="45"/><c r="E${priceRow}" s="46"/><c r="F${priceRow}" s="46"/><c r="G${priceRow}" s="45"/><c r="H${priceRow}" s="45"/><c r="I${priceRow}" s="45"/><c r="J${priceRow}" s="45"/><c r="K${priceRow}" s="45"/><c r="L${priceRow}" s="46"/><c r="M${priceRow}" s="46"/><c r="N${priceRow}" s="46"/><c r="O${priceRow}" s="49"/><c r="P${priceRow}" s="46"/></row>`;

  const tallOffsets = new Set([8, 11]);
  const wideSpanOffsets = new Set([4, 5]);

  for (let offset = 4; offset <= 11; offset++) {
    const rn = startRow + offset;
    const htAttr = tallOffsets.has(offset) ? ' ht="13.5" customHeight="1"' : ' ht="12.75" customHeight="1"';
    const spans = wideSpanOffsets.has(offset) ? "1:29" : "1:28";

    let variant;
    if (offset <= 8) {
      variant = { bStyle: 3, cStyle: 5, dStyle: 5, efStyle: 3, ghijkStyle: 5, lmStyle: 3, nopStyle: 3 };
    } else if (offset === 9) {
      variant = { bStyle: 1, cStyle: 4, dStyle: 5, efStyle: 3, ghijkStyle: 5, lmStyle: 3, nopStyle: 3 };
    } else {
      variant = { bStyle: 1, cStyle: 4, dStyle: 4, efStyle: 1, ghijkStyle: 4, lmStyle: 1, nopStyle: 6 };
    }

    const { bStyle, cStyle, dStyle, efStyle, ghijkStyle, lmStyle, nopStyle } = variant;

    out +=
      `<row r="${rn}" spans="${spans}" s="17" customFormat="1"${htAttr}>` +
      `<c r="A${rn}" s="72"/><c r="B${rn}" s="${bStyle}"/><c r="C${rn}" s="${cStyle}"/><c r="D${rn}" s="${dStyle}"/>` +
      `<c r="E${rn}" s="${efStyle}"/><c r="F${rn}" s="${efStyle}"/>` +
      `<c r="G${rn}" s="${ghijkStyle}"/><c r="H${rn}" s="${ghijkStyle}"/><c r="I${rn}" s="${ghijkStyle}"/><c r="J${rn}" s="${ghijkStyle}"/><c r="K${rn}" s="${ghijkStyle}"/>` +
      `<c r="L${rn}" s="${lmStyle}"/><c r="M${rn}" s="${lmStyle}"/>` +
      `<c r="N${rn}" s="${nopStyle}"/><c r="O${rn}" s="${nopStyle}"/><c r="P${rn}" s="${nopStyle}"/>` +
      `<c r="R${rn}" s="1"/><c r="S${rn}" s="1"/><c r="T${rn}" s="21"/><c r="U${rn}" s="1"/><c r="V${rn}" s="1"/><c r="W${rn}" s="1"/><c r="X${rn}" s="1"/><c r="Y${rn}" s="1"/><c r="Z${rn}" s="1"/><c r="AA${rn}" s="1"/><c r="AB${rn}" s="1"/></row>`;
  }

  return out;
}

/**
 * @param {string} suffix
 * @param {number} delta
 * @param {number} tableLastRow
 * @param {ReturnType<typeof createEffectiveLists>} lists
 * @returns {string}
 */
function resolvedSuffix(suffix, delta, tableLastRow, lists) {
  let s = suffix;
  s = s.split("{{PROTECTED_RANGE_LAST_ROW}}").join(String(43 + delta));
  s = s.split("{{COMPANY_LAST_ROW}}").join(String(1 + lists.companies.length));
  s = s.split("{{HYBRID_LAST_ROW_MINUS_ONE}}").join(String(lists.hybrids.length));
  s = s.split("{{HYBRID_LAST_ROW}}").join(String(1 + lists.hybrids.length));
  s = s.split("{{TRAIT_LAST_ROW}}").join(String(1 + lists.traits.length));
  s = s.split("{{SEEDTREATMENT_LAST_ROW}}").join(String(1 + lists.seedTreatments.length));
  s = s.split("{{LAST_TABLE_ROW}}").join(String(tableLastRow));
  return s;
}

/**
 * @param {ReturnType<typeof createEffectiveLists>} lists
 * @returns {string}
 */
function buildListsSheet(lists) {
  const columns = [
    ["A", "Hybrids", lists.hybrids],
    ["B", "Traits", lists.traits],
    ["C", "Irrigation", lists.irrigationOptions],
    ["D", "Tillage", lists.tillageOptions],
    ["E", "Soil Types", lists.soilTypeOptions],
    ["F", "Previous Crop", lists.previousCropOptions],
    ["G", "Company", lists.companies],
    ["H", "Seed Treatment", lists.seedTreatments],
  ];

  let maxLen = 0;
  for (const [, , values] of columns) {
    if (values.length > maxLen) maxLen = values.length;
  }

  let rows = "";
  let headerCells = "";
  for (const [letter, title] of columns) {
    headerCells += cellInline(`${letter}1`, 0, title);
  }
  rows += `<row r="1">${headerCells}</row>`;

  for (let i = 0; i < maxLen; i++) {
    const rowNum = i + 2;
    let cells = "";
    for (const [letter, , values] of columns) {
      if (i < values.length) {
        cells += cellInline(`${letter}${rowNum}`, 0, values[i]);
      }
    }
    rows += `<row r="${rowNum}">${cells}</row>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:H${maxLen + 1}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr baseColWidth="10" defaultColWidth="8.83203125" defaultRowHeight="13"/><sheetData>${rows}</sheetData></worksheet>`;
}

/**
 * @param {string} sheet1
 * @param {string} sheet2
 * @param {Awaited<ReturnType<typeof loadTemplateParts>>} templateParts
 * @returns {Blob}
 */
function assembleWorkbook(sheet1, sheet2, templateParts) {
  let highest = 0;
  const re = /<row r="(\d+)"/g;
  let m;
  while ((m = re.exec(sheet1)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > highest) highest = n;
  }
  const dimensionLastRow = highest > 0 ? String(highest) : "54";
  const finalSheet1 = sheet1.split("{{DIMENSION_LAST_ROW}}").join(dimensionLastRow);

  const zip = new ZipWriter();
  zip.addFile("[Content_Types].xml", CONTENT_TYPES);
  zip.addFile("_rels/.rels", ROOT_RELS);
  zip.addFile("docProps/core.xml", coreProperties(new Date().toISOString()));
  zip.addFile("docProps/app.xml", APP_PROPERTIES);
  zip.addFile("xl/workbook.xml", WORKBOOK_XML);
  zip.addFile("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
  zip.addFile("xl/styles.xml", templateParts.styles);
  zip.addFile("xl/sharedStrings.xml", templateParts.sharedStrings);
  zip.addFile("xl/theme/theme1.xml", templateParts.theme1);
  zip.addFile("xl/worksheets/sheet1.xml", finalSheet1);
  zip.addFile("xl/worksheets/_rels/sheet1.xml.rels", SHEET1_RELS);
  zip.addFile("xl/worksheets/sheet2.xml", sheet2);
  zip.addFile("xl/drawings/drawing1.xml", templateParts.drawing1);
  zip.addFile("xl/drawings/_rels/drawing1.xml.rels", templateParts.drawing1Rels);
  zip.addFile("xl/media/image1.emf", templateParts.image1Emf);

  const zipBlob = zip.finalize();
  return new Blob([zipBlob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/**
 * @param {string} s
 * @returns {string}
 */
function sanitizeFilenamePart(s) {
  let out = String(s).replace(/[^A-Za-z0-9]/g, "_");
  out = out.replace(/_+/g, "_");
  out = out.replace(/^_+/, "").replace(/_+$/, "");
  return out;
}

/**
 * @param {import('./models.js').TrialHeader} header
 * @returns {string}
 */
export function exportFilename(header) {
  const state = sanitizeFilenamePart(header.state || "State");
  const year = String(filenameYear(header));
  const coop = sanitizeFilenamePart(header.cooperatorName || "Cooperator");
  return `${state}_${year}_${coop}.xlsx`;
}

/**
 * Plain passthrough/validator for the "effective lists" shape used
 * throughout the XLSX builder (the merged default + user-added lists).
 * @param {{
 *   companies: string[], hybrids: string[], traits: string[], seedTreatments: string[],
 *   irrigationOptions: string[], tillageOptions: string[], soilTypeOptions: string[], previousCropOptions: string[]
 * }} lists
 */
export function createEffectiveLists(lists) {
  return {
    companies: lists.companies || [],
    hybrids: lists.hybrids || [],
    traits: lists.traits || [],
    seedTreatments: lists.seedTreatments || [],
    irrigationOptions: lists.irrigationOptions || [],
    tillageOptions: lists.tillageOptions || [],
    soilTypeOptions: lists.soilTypeOptions || [],
    previousCropOptions: lists.previousCropOptions || [],
  };
}

/**
 * @param {import('./models.js').TrialHeader} header
 * @param {import('./models.js').PlotEntry[]} entries
 * @param {ReturnType<typeof createEffectiveLists>} effectiveLists
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
export async function buildXlsx(header, entries, effectiveLists) {
  const templateParts = await loadTemplateParts();
  const lists = effectiveLists;

  const entryCount = entries.length;
  const lastDataRow = entryCount > 0 ? firstEntryRow + entryCount - 1 : firstEntryRow - 1;
  const tableLastRow = Math.max(lastDataRow, templateLastEntryRow);
  const delta = tableLastRow - templateLastEntryRow;

  const c44Ref = `$C$${44 + delta}`;
  const c45Ref = `$C$${45 + delta}`;
  const c46Ref = `$C$${46 + delta}`;
  const mRange = `$M$${firstEntryRow}:$M$${Math.max(lastDataRow, firstEntryRow)}`;
  const oRange = `$O$${firstEntryRow}:$O$${Math.max(lastDataRow, firstEntryRow)}`;

  let sheetDataRows = "";
  sheetDataRows += headerRow1(header);
  sheetDataRows += headerRow2(header);
  sheetDataRows += headerRow3(header);
  sheetDataRows += headerRow4(header);
  sheetDataRows += headerRow5(header);
  sheetDataRows += headerRow6(header);
  sheetDataRows += headerRow7(header);
  sheetDataRows += headerRow8(header);
  sheetDataRows += templateParts.sheet1Rows9And10;

  for (let i = 0; i < tableLastRow - firstEntryRow + 1; i++) {
    const rowNum = firstEntryRow + i;
    const isBoundary = rowNum === firstEntryRow || rowNum === tableLastRow;
    if (i < entryCount) {
      const entry = entries[i];
      sheetDataRows += entryRowXML(
        rowNum,
        entry,
        i,
        isBoundary,
        c44Ref,
        c45Ref,
        c46Ref,
        mRange,
        oRange,
        parseNumber(entry.manualDryYield)
      );
    } else {
      sheetDataRows += blankRowXML(rowNum, isBoundary, c44Ref, c45Ref, c46Ref, mRange, oRange);
    }
  }

  sheetDataRows += footerRows(43 + delta, Math.max(lastDataRow, firstEntryRow), header);

  let sheet1 = templateParts.sheet1Prefix;
  sheet1 += sheetDataRows;
  sheet1 += "</sheetData>";
  sheet1 += resolvedSuffix(templateParts.sheet1Suffix, delta, tableLastRow, lists);

  const sheet2 = buildListsSheet(lists);
  const blob = assembleWorkbook(sheet1, sheet2, templateParts);
  const filename = exportFilename(header);
  return { blob, filename };
}
