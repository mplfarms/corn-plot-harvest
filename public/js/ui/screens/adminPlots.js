// src/ui/screens/adminPlots.js
//
// Admin-only screen (requires the caller's own stored user record to have
// isAdmin === true — see authStore.isAdmin(); admins are promoted/demoted
// in-app via the Manage Users screen, see manageUsers.js) listing every
// REGISTERED user's saved plots via GET /.netlify/functions/plots?
// scope=all — every signed-in account gets its own card here, even one
// that hasn't saved a plot of its own yet (see plots.js's handleGetAll),
// sorted admin(s)-first then alphabetically by last name (server-side,
// via _shared.js's sortUsersAdminFirst()) so this screen and Manage Users
// read the same way. Each card's header shows that user's name above
// their email, with a "☰" button on the far right that pops up their
// First Name, Last Name, Email, and Phone (openUserDetailModal() below).
//
// Tapping a plot row starts a full admin-edit session (see
// adminEditStore.js) and lands on the Plot Workspace menu, where Plot
// Details / Plot Hybrids / Plot Summary all work exactly as normal (the
// trial is loaded into the same trialStore draft slot real editing
// always uses) — full read/write, not a read-only view. Before swapping
// the draft, the admin's OWN in-progress draft (if any) is flushed to
// their own local library first so it's never at risk even if the
// browser closes mid admin-edit; adminEditStore then restores it exactly
// once the admin-edit session ends (Save or Discard, both in
// workspaceMenu.js). Reachable from the Home Screen's "All Plots
// (Admin)" button (plotChooser.js) and from the Plot Workspace menu's
// own row (workspaceMenu.js), both of which only render when
// authStore.isAdmin() is true — but this screen re-checks independently
// since the server is the real authority (a stale client-side role check
// should never be trusted alone; the function itself also re-checks the
// caller's own isAdmin flag, returning 403 if it isn't set — see
// netlify/functions/plots.js).
//
// Since it's reachable from BOTH of those places, its own Back button
// returns to whichever one it was actually opened from (see router.js's
// rememberedOriginFor()) rather than always Home — the Plot Workspace
// menu's Save Changes/Discard Admin Edit handlers also land back here
// when an admin-edit session ends, but pass _skipOriginTracking so that
// internal round-trip doesn't overwrite the real origin recorded when
// this screen was first opened.
//
// Also hosts the "Upload Hybrid Catalog" button — the only place the
// shared Company/Hybrid/Trait/RM reference data (see catalogStore.js /
// hybridCatalogImport.js / companyMatch.js / netlify/functions/
// hybridCatalog.js) can be updated. Admin-only for the same reason
// every other cross-user/shared-data action on this screen is: it
// affects every signed-in device's pickers, not just the uploader's own.

import { h, mount, clear } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { showCustomModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import * as authStore from "../authStore.js";
import * as listsStore from "../stores/listsStore.js";
import * as catalogStore from "../stores/catalogStore.js";
import { canonicalizeCompanyName } from "../../core/companyMatch.js";
import { rowsFromAOA, parseCsvToAOA } from "../../core/hybridCatalogImport.js";
import { loadXlsxLib } from "../xlsxLibLoader.js";
import * as libraryStore from "../stores/libraryStore.js";
import * as adminEditStore from "../stores/adminEditStore.js";
import { navigate, rememberedOriginFor } from "../router.js";

function detailRow(label, value) {
  return h("p", { className: "admin-user-detail-row" }, [h("strong", {}, `${label}: `), value]);
}

/**
 * The "☰" button's popover: First Name, Last Name, Email, Phone for one
 * user. Falls back to splitting the combined `name` field for accounts
 * that predate firstName/lastName (see auth.js), and "—" for anything
 * still missing (most commonly Phone, since it's the one optional field
 * in the Welcome! form — see newUserDetailsModal.js).
 * @param {{name?: string, email: string, firstName?: string, lastName?: string, mobileNumber?: string}} u
 */
function openUserDetailModal(u) {
  const hasSeparateName = u.name && u.name !== u.email;
  const nameParts = hasSeparateName ? u.name.trim().split(/\s+/) : [];
  const firstName = u.firstName || (nameParts.length ? nameParts[0] : "") || "—";
  const lastName = u.lastName || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "") || "—";

  const body = h("div", { className: "admin-user-detail-body" }, [
    detailRow("First Name", firstName),
    detailRow("Last Name", lastName),
    detailRow("Email", u.email),
    detailRow("Phone", u.mobileNumber || "—"),
  ]);
  showCustomModal({ title: "User Details", bodyNode: body });
}

/**
 * One-time (safely repeatable) admin action — see
 * netlify/functions/backfillFormIds.js's top comment — that assigns a
 * Form ID to every existing plot, across every user, that doesn't
 * already have one. Only ever needs to actually DO anything once (the
 * button stays available afterward purely as a "catch anything that
 * slipped through" sanity sweep — running it again on a fully-backfilled
 * system just reports 0 assigned).
 * @param {HTMLButtonElement} btn
 * @param {() => void} onDone re-renders the screen after a successful run
 *   so the newly assigned IDs show up on each plot row without a manual reload.
 */
async function runBackfillFormIds(btn, onDone) {
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Assigning…";
  try {
    const creds = authStore.getCredentials();
    if (!creds) throw new Error("Not signed in.");
    const res = await fetch("/.netlify/functions/backfillFormIds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);

    const { assignedCount, updatedUserCount, totalTrialCount } = body;
    showToast(
      assignedCount > 0
        ? `Assigned ${assignedCount} new Form ID${assignedCount === 1 ? "" : "s"} across ${updatedUserCount} user${
            updatedUserCount === 1 ? "" : "s"
          } (${totalTrialCount} plots checked).`
        : `Every plot already has a Form ID — nothing to assign (${totalTrialCount} plots checked).`,
      { type: "success" }
    );
    onDone();
  } catch (e) {
    showToast(`Couldn't assign Form IDs: ${e.message}`, { type: "error" });
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

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
 *   Catalog for display on this screen (see catalogStore.js).
 */
function hybridCatalogStatusText() {
  const { rows, updatedAt } = catalogStore.getState();
  if (!rows || rows.length === 0) return "No Hybrid Catalog uploaded yet.";
  const companyCount = new Set(rows.map((r) => r.company.toLowerCase())).size;
  const dateStr = updatedAt ? new Date(updatedAt).toLocaleDateString() : "unknown date";
  return `${rows.length} hybrids across ${companyCount} brands — last updated ${dateStr}.`;
}

/**
 * Parses, canonicalizes, and uploads a Hybrid Catalog file — see this
 * file's "Hybrid Catalog" section in render() for the button/input that
 * triggers this. Company names are matched against the app's CURRENT
 * company list (before this upload) via companyMatch.js so an "obvious
 * duplicate" spelling (e.g. "AgriGold" vs an existing "Agrigold") is
 * folded into the existing entry rather than creating a visual
 * duplicate in the Brand/Company picker — a genuinely new company name
 * passes through unchanged and is simply added, per explicit request.
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

export async function render(container) {
  const topBar = createTopBar({
    title: "All Plots (Admin)",
    onBack: () => navigate(rememberedOriginFor("admin-plots") || "plot-chooser"),
  });
  const bodyEl = h("div", { className: "screen-body" }, [h("p", { className: "empty-state" }, "Loading…")]);
  mount(container, h("div", { className: "screen admin-plots-screen" }, [topBar, bodyEl]));

  if (!authStore.isAdmin()) {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, "Admin access required."));
    return;
  }

  try {
    const creds = authStore.getCredentials();
    if (!creds) throw new Error("Not signed in.");
    const url = `/.netlify/functions/plots?scope=all&email=${encodeURIComponent(creds.email)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const { users } = await res.json();

    clear(bodyEl);
    bodyEl.appendChild(h("h2", { className: "screen-heading" }, "All Plots (Admin)"));

    const backfillBtn = h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-block",
        onclick: (e) => runBackfillFormIds(e.target, () => render(container)),
      },
      "Assign Form IDs to All Plots"
    );
    bodyEl.appendChild(backfillBtn);

    // ---- Hybrid Catalog upload (see hybridCatalogImport.js /
    // companyMatch.js / catalogStore.js / netlify/functions/
    // hybridCatalog.js) — lets an admin update the shared Company /
    // Hybrid / Trait / RM reference data behind entryEditor.js's
    // cascading pickers at any time, without a new app build.
    await catalogStore.ensureLoaded();
    const catalogStatusEl = h("p", { className: "field-note" }, hybridCatalogStatusText());
    const catalogFileInput = h("input", {
      type: "file",
      accept: ".xlsx,.xls,.csv",
      className: "hidden",
      onchange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = ""; // allow re-selecting the same filename on a retry
        if (!file) return;
        await runHybridCatalogUpload(file, catalogUploadBtn, (text) => {
          catalogStatusEl.textContent = text;
        });
      },
    });
    const catalogUploadBtn = h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-block",
        onclick: () => catalogFileInput.click(),
      },
      "Upload Hybrid Catalog"
    );
    bodyEl.appendChild(
      // Deliberately NOT className: "card" — see styles.css's comment on
      // .admin-hybrid-catalog-section for why (this screen's own
      // e2e test counts ".card" elements as "one per registered user").
      h("section", { className: "admin-hybrid-catalog-section" }, [
        h("h3", { className: "section-header" }, "Hybrid Catalog"),
        catalogStatusEl,
        catalogUploadBtn,
        catalogFileInput,
      ])
    );

    if (!users || users.length === 0) {
      bodyEl.appendChild(h("p", { className: "empty-state" }, "No cloud-synced plots yet."));
      return;
    }

    for (const u of users) {
      const ownerLabel = u.name || u.email;
      // Only show a separate name line when there actually IS a name on
      // file that differs from the email — otherwise the header would
      // show the email twice (once as "the name", once as "the email").
      const hasSeparateName = Boolean(u.name && u.name.trim() && u.name !== u.email);
      const headerText = h("div", { className: "admin-user-header-text" }, [
        h("p", { className: "admin-user-header-name" }, hasSeparateName ? u.name : u.email),
        hasSeparateName ? h("p", { className: "admin-user-header-email" }, u.email) : null,
      ]);
      const menuBtn = h(
        "button",
        {
          type: "button",
          className: "admin-user-menu-btn",
          "aria-label": `${ownerLabel} details`,
          title: "View user details",
          onclick: () => openUserDetailModal(u),
        },
        "☰"
      );
      const rows =
        u.trials.length === 0
          ? [h("p", { className: "empty-state" }, "No saved plots.")]
          : u.trials.map((t) =>
              h("li", { className: "brand-average-row" }, [
                h(
                  "button",
                  {
                    type: "button",
                    className: "admin-plot-row",
                    onclick: () => {
                      libraryStore.flushDraftToLibrary();
                      adminEditStore.begin({
                        ownerEmail: u.email,
                        ownerName: u.name,
                        ownerUser: u,
                        allTrials: u.trials,
                        editingTrial: t,
                      });
                      navigate("workspace");
                    },
                  },
                  [
                    h("span", { className: "brand-average-name" }, (t.header.cooperatorName || "").trim() || "Untitled Plot"),
                    h(
                      "span",
                      { className: "brand-average-value" },
                      `${t.header.formId ? `${t.header.formId} • ` : ""}${t.entries.length} ${
                        t.entries.length === 1 ? "entry" : "entries"
                      } ›`
                    ),
                  ]
                ),
              ])
            );
      bodyEl.appendChild(
        h("section", { className: "card" }, [
          h("div", { className: "section-header admin-user-header" }, [headerText, menuBtn]),
          u.trials.length === 0 ? rows[0] : h("ul", { className: "brand-average-list" }, rows),
        ])
      );
    }
  } catch (e) {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, `Couldn't load: ${e.message}`));
  }
}
