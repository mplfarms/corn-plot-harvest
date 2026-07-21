// src/ui/xlsxLibLoader.js
//
// Lazy-loads SheetJS (window.XLSX) from a CDN the moment it's actually
// needed — the only caller is adminPlots.js's "Upload Hybrid Catalog"
// button, an occasional admin-only action, so there's no reason to
// bundle this (a few hundred KB) into the app shell or precache it for
// every visitor. Mirrors pdfBuilder.js's own lazy-reference-a-CDN-global
// pattern for jsPDF, except this one is fetched on demand rather than
// opportunistically cached by the service worker for offline use (see
// sw.js) — uploading a new catalog inherently needs a live connection
// to POST the result anyway, so there's no offline use case to support.

const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

let loadPromise = null;

/**
 * @returns {Promise<any>} resolves to the global `XLSX` object.
 */
export function loadXlsxLib() {
  if (typeof window !== "undefined" && window.XLSX) return Promise.resolve(window.XLSX);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = XLSX_URL;
    script.onload = () => {
      if (window.XLSX) resolve(window.XLSX);
      else reject(new Error("the .xlsx reader loaded but isn't available — try again"));
    };
    script.onerror = () => reject(new Error("couldn't load the .xlsx reader — check your connection"));
    document.head.appendChild(script);
  }).catch((e) => {
    loadPromise = null; // let a later upload attempt retry the load
    throw e;
  });
  return loadPromise;
}
