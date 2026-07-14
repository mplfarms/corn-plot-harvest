// src/core/xlsxTemplateParts.js
//
// Loads the static Excel-template XML fragments (fetched from /template/...
// at the site root) and exposes the fixed, verbatim XML string constants
// needed to assemble a full .xlsx package.

const TEMPLATE_BASE = "/template";

let loadPromise = null;

/**
 * Fetches and caches all template parts. Safe to call multiple times —
 * only fetches once (module-level singleton promise).
 * @returns {Promise<{
 *   styles: string,
 *   sharedStrings: string,
 *   theme1: string,
 *   drawing1: string,
 *   drawing1Rels: string,
 *   image1Emf: ArrayBuffer,
 *   sheet1Prefix: string,
 *   sheet1Rows9And10: string,
 *   sheet1Suffix: string,
 * }>}
 */
export function loadTemplateParts() {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const [
      styles,
      sharedStrings,
      theme1,
      drawing1,
      drawing1Rels,
      image1Emf,
      sheet1Prefix,
      sheet1Rows9And10,
      sheet1Suffix,
    ] = await Promise.all([
      fetch(`${TEMPLATE_BASE}/styles.xml`).then((r) => r.text()),
      fetch(`${TEMPLATE_BASE}/sharedStrings.xml`).then((r) => r.text()),
      fetch(`${TEMPLATE_BASE}/theme1.xml`).then((r) => r.text()),
      fetch(`${TEMPLATE_BASE}/drawing1.xml`).then((r) => r.text()),
      fetch(`${TEMPLATE_BASE}/drawing1.xml.rels`).then((r) => r.text()),
      fetch(`${TEMPLATE_BASE}/image1.emf`).then((r) => r.arrayBuffer()),
      fetch(`${TEMPLATE_BASE}/sheet1_prefix.xml`).then((r) => r.text()),
      fetch(`${TEMPLATE_BASE}/sheet1_rows_9_10.xml`).then((r) => r.text()),
      fetch(`${TEMPLATE_BASE}/sheet1_suffix.xml`).then((r) => r.text()),
    ]);

    return {
      styles,
      sharedStrings,
      theme1,
      drawing1,
      drawing1Rels,
      image1Emf,
      sheet1Prefix,
      sheet1Rows9And10,
      sheet1Suffix,
    };
  })();

  return loadPromise;
}

export const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="emf" ContentType="image/x-emf"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

export const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;

export const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Trial Outline" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`;

export const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

export const SHEET1_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;

/**
 * @param {string} createdISO
 * @returns {string}
 */
export function coreProperties(createdISO) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Corn Plot Harvest App</dc:creator><cp:lastModifiedBy>Corn Plot Harvest App</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdISO}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdISO}</dcterms:modified></cp:coreProperties>`;
}

export const APP_PROPERTIES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Corn Plot Harvest</Application></Properties>`;
