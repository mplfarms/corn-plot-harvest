// src/ui/fileSave.js
//
// Shared "get this blob out of the browser" helpers used by the Plot
// Summary export/share/print/email actions.

import { showToast } from "./components/toast.js";

/**
 * Triggers a normal browser download via a temporary <a download> click.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Prefers the native Web Share sheet (with a file attachment) when
 * available; falls back to a plain download with an on-screen note.
 * @param {Blob} blob
 * @param {string} filename
 * @param {string} mime
 * @returns {Promise<"shared"|"downloaded"|"cancelled">}
 */
export async function shareOrDownload(blob, filename, mime) {
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelled";
        // fall through to download fallback on any other share failure
      }
    }
  } catch (e) {
    // File/share construction failed — fall through to download.
  }
  downloadBlob(blob, filename);
  showToast("This device doesn't support the native share sheet — the file was downloaded instead.", {
    type: "info",
  });
  return "downloaded";
}

/**
 * Same idea as shareOrDownload() above but for MULTIPLE files handed to
 * the OS share sheet TOGETHER, as one attachment set, rather than
 * popping up a separate share sheet per file — the whole point of a
 * multi-file Web Share call (e.g. "Export for Seedware" now bundles the
 * full Trial Outline xlsx alongside the flat Seedware import file, per
 * explicit request, so both land together whether the destination is
 * AirDrop, a Files app, a cloud-upload picker, or an email compose
 * sheet with two attachments — see plotSummary.js's
 * handleExportSeedware()). Falls back to downloading every file
 * separately (each its own browser download) with one combined
 * on-screen note when Web Share/multi-file share isn't available.
 * @param {Array<{blob: Blob, filename: string, mime: string}>} items
 * @param {string} title used as the Web Share sheet's title
 * @returns {Promise<"shared"|"downloaded"|"cancelled">}
 */
export async function shareOrDownloadFiles(items, title) {
  try {
    const files = items.map((it) => new File([it.blob], it.filename, { type: it.mime }));
    if (navigator.canShare && navigator.share && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title });
        return "shared";
      } catch (e) {
        if (e && e.name === "AbortError") return "cancelled";
        // fall through to download fallback on any other share failure
      }
    }
  } catch (e) {
    // File/share construction failed — fall through to download.
  }
  items.forEach((it) => downloadBlob(it.blob, it.filename));
  showToast("This device doesn't support the native share sheet — the files were downloaded instead.", {
    type: "info",
  });
  return "downloaded";
}

/**
 * Opens a mailto: link (with subject/body) via a temporary anchor click,
 * more reliable across browsers than window.open("mailto:...").
 * @param {string} to
 * @param {string} subject
 * @param {string} body
 */
export function openMailto(to, subject, body) {
  const a = document.createElement("a");
  a.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
