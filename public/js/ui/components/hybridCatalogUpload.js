// src/ui/components/hybridCatalogUpload.js
//
// The admin "Hybrid Catalog" upload section — status line + "Upload
// Hybrid Catalog" button + hidden file input. Originally lived on the
// All Plots (Admin) screen (adminPlots.js); per explicit request it now
// renders inside Settings' Admin card instead (see settings.js), so it
// was extracted here as a self-contained component rather than
// duplicating the parse/canonicalize/upload pipeline.
//
// The pipeline itself is unchanged: read .xlsx/.xls (lazy-loaded
// SheetJS) or .csv (hand-rolled parser) into a plain grid, turn it into
// {company, hybrid, trait, rm} rows (rowsFromAOA — including the
// "MW / NC / CR" house-brand alias expansion, see
// hybridCatalogImport.js), canonicalize company spellings against the
// app's current list (companyMatch.js), POST to
// netlify/functions/hybridCatalog, and reflect the new catalog
// immediately via catalogStore.setCatalog().

import { h } from "../dom.js";
import { showToast } from "./toast.js";
import * as authStore from "../authStore.js";
import * as listsStore from "../stores/listsStore.js";
import * as catalogStore from "../stores/catalogStore.js";
import { canonicalizeCompanyName } from "../../core/companyMatch.js";
import { rowsFromAOA, parseCsvToAOA } from "../../core/hybridCatalogImport.js";
import { loadXlsxLib } from "../xlsxLibLoader.js";

/**
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("couldn't read the file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("couldn't read the file"));
    reader.readAsText(file);
  });
}

/**
 * Reads an uploaded Hybrid Catalog file (.xlsx/.xls via a lazy-loaded
 * SheetJS, or .csv via a small hand-rolled parser — see
 * hybridCatalogImport.js) into a plain grid (array of arrays, header
 * row first) ready for rowsFromAOA().
 * @param {File} file
 * @returns {Promise<Array<Array<any>>>}
 */
async function parseUploadedFileToAOA(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await readFileAsText(file);
    return parseCsvToAOA(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await loadXlsxLib();
    const buffer = await readFileAsArrayBuffer(file);
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  }
  throw new Error("Unsupported file type — please upload a .xlsx or .csv file.");
}

/**
 * @returns {string} a one-line summary of the currently loaded Hybrid
 *   Catalog (see catalogStore.js).
 */
function hybridCatalogStatusText() {
  const { rows, updatedAt } = catalogStore.getState();
  if (!rows || rows.length === 0) return "No Hybrid Catalog uploaded yet.";
  const companyCount = new Set(rows.map((r) => r.company.toLowerCase())).size;
  const dateStr = updatedAt ? new Date(updatedAt).toLocaleDateString() : "unknown date";
  return `${rows.length} hybrids across ${companyCount} brands — last updated ${dateStr}.`;
}

/**
 * Parses, canonicalizes, and uploads a Hybrid Catalog file. Company
 * names are matched against the app's CURRENT company list (before this
 * upload) via companyMatch.js so an "obvious duplicate" spelling (e.g.
 * "AgriGold" vs an existing "Agrigold") is folded into the existing
 * entry rather than creating a visual duplicate in the Brand/Company
 * picker — a genuinely new company name passes through unchanged and is
 * simply added, per explicit request.
 * @param {File} file
 * @param {HTMLButtonElement} btn
 * @param {(text: string) => void} setStatusText
 */
async function runHybridCatalogUpload(file, btn, setStatusText) {
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Uploading…";
  try {
    const creds = authStore.getCredentials();
    if (!creds) throw new Error("Not signed in.");

    const aoa = await parseUploadedFileToAOA(file);
    const { rows: rawRows, skippedCount, headerError } = rowsFromAOA(aoa);
    if (headerError) throw new Error(headerError);
    if (rawRows.length === 0) throw new Error("No usable rows found in the file.");

    const knownCompanies = listsStore.items(listsStore.CATEGORY.BRAND_COMPANY);
    const seenNewCompanies = new Set();
    const rows = rawRows.map((r) => {
      const canonical = canonicalizeCompanyName(r.company, knownCompanies);
      const isKnown = knownCompanies.some((k) => k.toLowerCase() === canonical.toLowerCase());
      if (!isKnown) seenNewCompanies.add(canonical.toLowerCase());
      return { ...r, company: canonical };
    });

    const res = await fetch("/.netlify/functions/hybridCatalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, rows }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);

    catalogStore.setCatalog(rows, body.updatedAt);
    setStatusText(hybridCatalogStatusText());

    const newBrandNote = seenNewCompanies.size > 0 ? `, ${seenNewCompanies.size} new brand${seenNewCompanies.size === 1 ? "" : "s"} added` : "";
    const skippedNote = skippedCount > 0 ? ` (${skippedCount} row${skippedCount === 1 ? "" : "s"} skipped — missing data)` : "";
    showToast(
      `Hybrid Catalog updated: ${body.rowCount} hybrids across ${body.companyCount} brands${newBrandNote}.${skippedNote}`,
      { type: "success" }
    );
  } catch (e) {
    showToast(`Couldn't upload Hybrid Catalog: ${e.message}`, { type: "error" });
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/**
 * Builds the Hybrid Catalog upload UI (status line + upload button +
 * hidden file input) as one node the caller can place wherever it
 * belongs (currently Settings' Admin card — see settings.js). Kicks off
 * catalogStore.ensureLoaded() itself and refreshes the status line once
 * it resolves, so callers don't need to await anything.
 * @returns {HTMLElement}
 */
export function createHybridCatalogUploadSection() {
  const statusEl = h("p", { className: "field-note" }, hybridCatalogStatusText());
  const fileInput = h("input", {
    type: "file",
    accept: ".xlsx,.xls,.csv",
    className: "hidden",
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ""; // allow re-selecting the same filename on a retry
      if (!file) return;
      await runHybridCatalogUpload(file, uploadBtn, (text) => {
        statusEl.textContent = text;
      });
    },
  });
  const uploadBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-secondary btn-block",
      onclick: () => fileInput.click(),
    },
    "Upload Hybrid Catalog"
  );

  catalogStore.ensureLoaded().then(() => {
    statusEl.textContent = hybridCatalogStatusText();
  });

  return h("div", { className: "hybrid-catalog-upload-section" }, [statusEl, uploadBtn, fileInput]);
}
