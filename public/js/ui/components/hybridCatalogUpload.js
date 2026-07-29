// src/ui/components/hybridCatalogUpload.js
//
// The admin "Hybrid Catalog" upload section in Settings' Admin card —
// per explicit request the catalog is maintained as TWO separate
// upload files with their own buttons:
//
//   "Upload Company Hybrids"      — Midwest Seed Genetics / NC+ Hybrids /
//                                   Crow's (incl. the MW / NC / CR
//                                   alias) plus SuperCrost
//   "Upload Alt. Variety Hybrids" — every other brand
//
// Each upload replaces ONLY its own half of the catalog (server-side —
// see netlify/functions/hybridCatalog.js's group mode) and leaves the
// other half untouched, so the company lineup can be refreshed without
// re-uploading the competitive list and vice versa. Rows that belong to
// the OTHER upload are ignored with a notice (never silently routed or
// uploaded), so a mixed or mistaken file can't overwrite the half it
// wasn't meant for — per explicit request ("ignore with notice").
//
// The per-file pipeline is unchanged: read .xlsx/.xls (lazy-loaded
// SheetJS) or .csv (hand-rolled parser) into a plain grid, turn it into
// {company, hybrid, trait, rm} rows (rowsFromAOA — including the
// "MW / NC / CR" house-brand alias expansion, see
// hybridCatalogImport.js), canonicalize company spellings against the
// app's current list (companyMatch.js), POST to
// netlify/functions/hybridCatalog, and reflect the returned merged
// catalog immediately via catalogStore.setCatalog().

import { h } from "../dom.js";
import { showToast } from "./toast.js";
import * as authStore from "../authStore.js";
import * as listsStore from "../stores/listsStore.js";
import * as catalogStore from "../stores/catalogStore.js";
import { canonicalizeCompanyName } from "../../core/companyMatch.js";
import { rowsFromAOA, parseCsvToAOA, isCompanyGroupBrand, CATALOG_GROUP } from "../../core/hybridCatalogImport.js";
import { loadXlsxLib } from "../xlsxLibLoader.js";

const GROUP_LABELS = {
  [CATALOG_GROUP.COMPANY]: "Company Hybrids",
  [CATALOG_GROUP.ALT]: "Alt. Variety Hybrids",
};

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
  const companyGroupCount = rows.filter((r) => isCompanyGroupBrand(r.company)).length;
  const altGroupCount = rows.length - companyGroupCount;
  const brandCount = new Set(rows.map((r) => r.company.toLowerCase())).size;
  const dateStr = updatedAt ? new Date(updatedAt).toLocaleDateString() : "unknown date";
  return `${companyGroupCount} company + ${altGroupCount} alt. variety hybrids across ${brandCount} brands — last updated ${dateStr}.`;
}

/**
 * Parses, canonicalizes, and uploads ONE group's Hybrid Catalog file
 * ("company" or "alt" — see the top comment). Company names are matched
 * against the app's CURRENT company list (before this upload) via
 * companyMatch.js so an "obvious duplicate" spelling (e.g. "AgriGold"
 * vs an existing "Agrigold") is folded into the existing entry rather
 * than creating a visual duplicate in the Brand/Company picker — a
 * genuinely new company name passes through unchanged and is simply
 * added, per explicit request. Rows belonging to the OTHER group are
 * ignored and reported in the success toast, never uploaded.
 * @param {File} file
 * @param {HTMLButtonElement} btn
 * @param {"company"|"alt"} group
 * @param {(text: string) => void} setStatusText
 */
async function runHybridCatalogUpload(file, btn, group, setStatusText) {
  const groupLabel = GROUP_LABELS[group];
  const otherLabel = GROUP_LABELS[group === CATALOG_GROUP.COMPANY ? CATALOG_GROUP.ALT : CATALOG_GROUP.COMPANY];
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
    const canonicalRows = rawRows.map((r) => {
      const canonical = canonicalizeCompanyName(r.company, knownCompanies);
      return { ...r, company: canonical };
    });

    // Keep only this upload's own group — rows for the other side are
    // ignored with a notice ("ignore with notice", per explicit
    // request), so a mixed or mistaken file can't touch the other half.
    // Skips are counted in SOURCE-spreadsheet rows (via sourceLine —
    // one MW/NC/CR alias row expands to 3 catalog rows but is still 1
    // row to the person who typed it).
    const wantCompany = group === CATALOG_GROUP.COMPANY;
    const kept = canonicalRows.filter((r) => isCompanyGroupBrand(r.company) === wantCompany);
    const dropped = canonicalRows.filter((r) => isCompanyGroupBrand(r.company) !== wantCompany);
    const otherGroupCount = new Set(dropped.map((r) => r.sourceLine)).size;
    const rows = kept.map(({ sourceLine, ...r }) => r);
    if (rows.length === 0) {
      throw new Error(
        `No ${groupLabel} rows found in this file${otherGroupCount > 0 ? ` (all ${otherGroupCount} row${otherGroupCount === 1 ? "" : "s"} belong in the "${otherLabel}" upload)` : ""}.`
      );
    }
    for (const r of rows) {
      const isKnown = knownCompanies.some((k) => k.toLowerCase() === r.company.toLowerCase());
      if (!isKnown) seenNewCompanies.add(r.company.toLowerCase());
    }

    const res = await fetch("/.netlify/functions/hybridCatalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, rows, group }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);

    // The server returns the complete merged catalog (this group's new
    // rows + the other group's untouched rows) — reflect it locally.
    catalogStore.setCatalog(Array.isArray(body.rows) ? body.rows : rows, body.updatedAt);
    setStatusText(hybridCatalogStatusText());

    const newBrandNote = seenNewCompanies.size > 0 ? `, ${seenNewCompanies.size} new brand${seenNewCompanies.size === 1 ? "" : "s"} added` : "";
    const otherGroupNote =
      otherGroupCount > 0
        ? ` Skipped ${otherGroupCount} row${otherGroupCount === 1 ? "" : "s"} that belong${otherGroupCount === 1 ? "s" : ""} in the "${otherLabel}" upload.`
        : "";
    const skippedNote = skippedCount > 0 ? ` (${skippedCount} row${skippedCount === 1 ? "" : "s"} skipped — missing data)` : "";
    showToast(
      `${groupLabel} updated: ${body.rowCount || rows.length} hybrids across ${body.companyCount || "?"} brands${newBrandNote}.${otherGroupNote}${skippedNote}`,
      { type: "success" }
    );
  } catch (e) {
    showToast(`Couldn't upload ${groupLabel}: ${e.message}`, { type: "error" });
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
  const setStatusText = (text) => {
    statusEl.textContent = text;
  };

  // One upload block (hidden file input + button) per catalog group.
  function uploadBlock(group, buttonLabel) {
    const fileInput = h("input", {
      type: "file",
      accept: ".xlsx,.xls,.csv",
      className: "hidden",
      onchange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = ""; // allow re-selecting the same filename on a retry
        if (!file) return;
        await runHybridCatalogUpload(file, uploadBtn, group, setStatusText);
      },
    });
    const uploadBtn = h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-block",
        onclick: () => fileInput.click(),
      },
      buttonLabel
    );
    return h("div", { className: `hybrid-catalog-upload-block hybrid-catalog-upload-${group}` }, [uploadBtn, fileInput]);
  }

  catalogStore.ensureLoaded().then(() => {
    setStatusText(hybridCatalogStatusText());
  });

  return h("div", { className: "hybrid-catalog-upload-section" }, [
    statusEl,
    uploadBlock(CATALOG_GROUP.COMPANY, "Upload Company Hybrids"),
    uploadBlock(CATALOG_GROUP.ALT, "Upload Alt. Variety Hybrids"),
    h(
      "p",
      { className: "field-note hybrid-catalog-upload-split-note" },
      "Company = MW / NC / CR and SuperCrost; Alt. Variety = every other brand. Each upload replaces only its own half of the catalog — rows that belong in the other upload are skipped with a notice."
    ),
  ]);
}
