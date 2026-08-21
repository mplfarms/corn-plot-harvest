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
// shared Company/Hybrid/Trait/RM reference data (see catalogStore.js /
// hybridCatalogImport.js / companyMatch.js / netlify/functions/
// hybridCatalog.js) can be updated. Admin-only for the same reason
// every other cross-user/shared-data action on this screen is: it
// affects every signed-in device's pickers, not just the uploader's own.

import { h, mount, clear } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { showCustomModal, showConfirm } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { copyTrialForAssignment } from "../../core/models.js";
import * as authStore from "../authStore.js";
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

// (The Hybrid Catalog upload section moved to Settings' Admin card —
// per explicit request — see components/hybridCatalogUpload.js.)

/**
 * A short human label for one plot, used in the assign-a-copy dialogs —
 * the cooperator name plus the Form ID when there is one.
 * @param {Object} trial
 * @returns {string}
 */
function plotLabel(trial) {
  const name = (trial.header.cooperatorName || "").trim() || "Untitled Plot";
  return trial.header.formId ? `${name} (${trial.header.formId})` : name;
}

/**
 * True if `recipient` already appears to be holding a copy of this plot,
 * so a second tap of "Copy to…" can warn instead of quietly stacking up
 * duplicates. Matched on Form ID when the source has one (a copy keeps
 * the original's Form ID — see models.copyTrialForAssignment), and
 * otherwise on the cooperator name + harvest date pair, which is the
 * closest thing to an identity a plot has before its Form ID is assigned.
 * @param {{trials?: Object[]}} recipient
 * @param {Object} sourceTrial
 * @returns {boolean}
 */
function alreadyHasCopy(recipient, sourceTrial) {
  const trials = recipient.trials || [];
  const formId = (sourceTrial.header.formId || "").trim();
  if (formId) return trials.some((t) => (t.header.formId || "").trim() === formId);
  const name = (sourceTrial.header.cooperatorName || "").trim().toLowerCase();
  if (!name) return false;
  return trials.some(
    (t) =>
      (t.header.cooperatorName || "").trim().toLowerCase() === name &&
      (t.header.dateHarvested || "") === (sourceTrial.header.dateHarvested || "")
  );
}

/**
 * Writes a copy of `sourceTrial` onto `recipient`'s cloud record, by
 * PUTting their existing trials plus the copy — the same whole-array
 * replace contract every other save in this app uses (see
 * cloudSyncStore.js and adminEditStore.js's saveAndExit), and the same
 * `adminEmail` field that tells the server this is an admin acting on
 * someone else's behalf so it can re-check the caller really is one
 * (netlify/functions/plots.js's requireAdmin).
 *
 * The recipient's `trials` come from the scope=all listing this screen
 * already loaded, which is a point-in-time snapshot — if they saved
 * something on their own device in the seconds since, that save is lost
 * to this replace. Same narrow race adminEditStore.js already documents
 * and accepts for a handful of internal users; the screen re-renders
 * (re-fetching the listing) after every successful assignment, so the
 * window is one dialog wide.
 *
 * @param {{sourceTrial: Object, recipient: Object, adminEmail: string}} args
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function assignCopyToUser({ sourceTrial, recipient, adminEmail }) {
  const copy = copyTrialForAssignment(sourceTrial);
  let res;
  try {
    res = await fetch("/.netlify/functions/plots", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: recipient.email,
        trials: [...(recipient.trials || []), copy],
        adminEmail,
      }),
    });
  } catch (e) {
    return { ok: false, error: "Couldn't reach the server — check your connection and try again." };
  }
  let payload = {};
  try {
    payload = await res.json();
  } catch (e) {
    // Ignore — the status-based message below covers it.
  }
  if (!res.ok) return { ok: false, error: payload.error || `Assign failed (${res.status}).` };
  return { ok: true };
}

/**
 * The "Copy to…" picker: one row per OTHER registered user (the plot's
 * own owner is left out — they already have it). One recipient per
 * assignment, per explicit request.
 * @param {{sourceTrial: Object, owner: Object, users: Object[], onAssigned: () => void}} args
 */
function openAssignCopyModal({ sourceTrial, owner, users, onAssigned }) {
  const others = users.filter((u) => u.email !== owner.email);
  const creds = authStore.getCredentials();
  const reopen = () => openAssignCopyModal({ sourceTrial, owner, users, onAssigned });

  /**
   * Sends the copy and reports the outcome. Assumes the caller has
   * already dealt with the picker's own visual state.
   * @param {Object} recipient
   * @returns {Promise<boolean>} true if it landed
   */
  const performAssign = async (recipient) => {
    const result = await assignCopyToUser({ sourceTrial, recipient, adminEmail: creds && creds.email });
    if (result.ok) {
      showToast(`Copy of ${plotLabel(sourceTrial)} sent to ${recipient.name || recipient.email}.`, { type: "success" });
      onAssigned();
      return true;
    }
    showToast(result.error, { type: "error" });
    return false;
  };

  const list = h(
    "ul",
    { className: "admin-assign-user-list" },
    others.length === 0
      ? [h("li", {}, h("p", { className: "empty-state" }, "There's no one else signed up yet."))]
      : others.map((u) => {
          const hasName = Boolean(u.name && u.name.trim() && u.name !== u.email);
          return h("li", {}, [
            h(
              "button",
              {
                type: "button",
                className: "admin-assign-user-btn",
                onclick: async (e) => {
                  const btn = e.currentTarget;
                  if (alreadyHasCopy(u, sourceTrial)) {
                    // showConfirm reuses the one shared modal overlay, so
                    // it can't sit ON TOP of this picker — close the
                    // picker first, then put it back if they say no.
                    modal.close();
                    const again = await showConfirm({
                      title: "Already Has a Copy",
                      message: `${u.name || u.email} already has this plot. Send another copy anyway?`,
                      confirmLabel: "Send Anyway",
                      cancelLabel: "Cancel",
                    });
                    if (!again || !(await performAssign(u))) reopen();
                    return;
                  }
                  btn.disabled = true;
                  btn.classList.add("is-busy");
                  if (await performAssign(u)) {
                    modal.close();
                  } else {
                    btn.disabled = false;
                    btn.classList.remove("is-busy");
                  }
                },
              },
              [
                h("span", { className: "admin-assign-user-name" }, hasName ? u.name : u.email),
                hasName ? h("span", { className: "admin-assign-user-email" }, u.email) : null,
              ]
            ),
          ]);
        })
  );

  const body = h("div", { className: "admin-assign-body" }, [
    h(
      "p",
      { className: "admin-assign-intro" },
      `Send a copy of ${plotLabel(sourceTrial)} to another user. They get their own editable copy — ${
        owner.name || owner.email
      }'s original stays exactly as it is.`
    ),
    list,
  ]);

  const modal = showCustomModal({ title: "Assign a Copy", bodyNode: body });
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
              h("li", { className: "brand-average-row admin-plot-row-item" }, [
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
                // Second control on the row: hand a copy of this plot to
                // another user. Deliberately its own button rather than
                // something inside the row button — tapping the row
                // itself still opens the plot for admin editing exactly
                // as it always has.
                h(
                  "button",
                  {
                    type: "button",
                    className: "admin-plot-assign-btn",
                    "aria-label": `Assign a copy of ${plotLabel(t)} to another user`,
                    title: "Assign a copy to another user",
                    onclick: () =>
                      openAssignCopyModal({
                        sourceTrial: t,
                        owner: u,
                        users,
                        onAssigned: () => render(container),
                      }),
                  },
                  "Copy to…"
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

    // At the BOTTOM of the page (below every user's plots) — per
    // explicit request; it used to sit at the very top. (The Hybrid
    // Catalog upload that also used to live up there moved to Settings'
    // Admin card — see components/hybridCatalogUpload.js.)
    bodyEl.appendChild(
      h(
        "button",
        {
          type: "button",
          className: "btn btn-secondary btn-block",
          onclick: (e) => runBackfillFormIds(e.target, () => render(container)),
        },
        "Assign Form IDs to All Plots"
      )
    );
  } catch (e) {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, `Couldn't load: ${e.message}`));
  }
}
