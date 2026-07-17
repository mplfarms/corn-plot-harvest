// src/ui/screens/workspaceMenu.js
//
// Mirrors ContentView.swift's workspace menu: Enter Plot Details / Enter
// Plot Hybrids / Plot Summary & Results, plus a Saved Plots row and a
// destructive "Enter a New Plot" action.

import { h, mount } from "../dom.js";
import { getBrand } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as trialStore from "../stores/trialStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import * as authStore from "../authStore.js";
import * as cloudSyncStore from "../stores/cloudSyncStore.js";
import * as adminEditStore from "../stores/adminEditStore.js";
import { createTopBar } from "../components/topBar.js";
import { showConfirm } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { navigate } from "../router.js";

function menuRow(title, subtitle, onClick) {
  return h(
    "button",
    { type: "button", className: "chooser-row", onclick: onClick },
    [
      h("span", { className: "chooser-row-text" }, [
        h("span", { className: "chooser-row-title" }, title),
        subtitle ? h("span", { className: "chooser-row-subtitle" }, subtitle) : null,
      ]),
      h("span", { className: "chooser-row-chevron" }, "›"),
    ]
  );
}

// Double-arrow sync-status icon shown in the top bar next to the Settings
// gear (replaces the old "Synced as {email}" card). Green = signed in and
// the most recent push/pull succeeded; red = anything else (signed out,
// mid-sync, or the last attempt failed). Reflects status as of render
// time — since this screen is rebuilt fresh every time it's navigated to
// (see dom.js's mount()/clear() — no persistent store subscription here),
// coming back to Home after a sync completes elsewhere always shows the
// current state. Tapping it triggers a manual sync (or sends a signed-out
// user to Settings to sign in) and re-renders to reflect the outcome.
function syncStatusIcon(container) {
  const status = cloudSyncStore.getSyncStatus();
  const isSynced = status === cloudSyncStore.SyncStatus.SYNCED;
  const label = {
    [cloudSyncStore.SyncStatus.SYNCED]: "Synced",
    [cloudSyncStore.SyncStatus.SYNCING]: "Syncing…",
    [cloudSyncStore.SyncStatus.ERROR]: "Sync failed — tap to retry",
    [cloudSyncStore.SyncStatus.SIGNED_OUT]: "Not signed in — tap to sign in",
  }[status];

  return h(
    "button",
    {
      type: "button",
      className: "top-bar-btn sync-icon-btn " + (isSynced ? "sync-icon-synced" : "sync-icon-not-synced"),
      "aria-label": label,
      title: label,
      onclick: async () => {
        if (!authStore.getUser()) {
          navigate("account", { force: true });
          return;
        }
        await cloudSyncStore.pullAndMerge();
        await cloudSyncStore.pushNow();
        if (cloudSyncStore.getSyncStatus() === cloudSyncStore.SyncStatus.ERROR) {
          showToast("Couldn't sync right now — check your connection and try again.", { type: "error" });
        }
        render(container);
      },
    },
    "⇄"
  );
}

export function render(container) {
  // See adminEditStore.clearIfStale()'s comment — safe to call unconditionally.
  adminEditStore.clearIfStale();

  const brand = getBrand(brandStore.getState().selectedBrand);
  const draft = trialStore.getState();
  const cooperator = draft.header.cooperatorName.trim();
  const entryCount = draft.entries.length;
  const adminEditing = adminEditStore.isActive();

  const topBar = createTopBar({
    title: brand ? brand.displayName : "Workspace",
    onBack: () => navigate("plot-chooser"),
    right: syncStatusIcon(container),
  });

  const adminEditBanner = adminEditing
    ? h("div", { className: "preview-owner-banner" }, [
        `Admin Edit — editing ${adminEditStore.getOwnerLabel()}'s plot. Use Save Changes below to write back to their account.`,
      ])
    : null;

  const rows = h("div", { className: "chooser-list" }, [
    menuRow("Enter Plot Details", cooperator || "No cooperator set yet", () => navigate("trial-details")),
    menuRow(
      "Enter Plot Hybrids",
      `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`,
      () => navigate("entries")
    ),
    menuRow("Plot Summary & Results", "Ranked results & export", () => navigate("plot-summary")),
    // Both hidden during an admin-edit session — either one swaps
    // trialStore's draft out from under the in-progress edit (Saved
    // Plots loads one of the ADMIN's own trials; All Plots re-enters
    // this same flow for a different one) with no save/discard
    // confirmation, silently abandoning unsaved changes here.
    adminEditing
      ? null
      : menuRow("Saved Plots", `${libraryStore.getState().trials.length} saved`, () =>
          navigate("saved-plots", { enterWorkspaceOnSelect: false })
        ),
    !adminEditing && authStore.isAdmin()
      ? menuRow("All Plots (Admin)", "See every user's saved plots", () => navigate("admin-plots"))
      : null,
  ]);

  const saveAdminEditBtn = adminEditing
    ? h(
        "button",
        {
          type: "button",
          className: "btn btn-primary btn-block",
          onclick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = "Saving…";
            const result = await adminEditStore.saveAndExit();
            if (!result.ok) {
              e.target.disabled = false;
              e.target.textContent = "Save Changes";
              showToast(`Couldn't save: ${result.error}`, { type: "error" });
              return;
            }
            showToast("Saved to their account.", { type: "success" });
            navigate("admin-plots");
          },
        },
        "Save Changes"
      )
    : null;

  const startNewBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-danger btn-block",
      onclick: async () => {
        if (adminEditing) {
          const ok = await showConfirm({
            title: "Discard Admin Edit?",
            message: `This discards your unsaved changes to ${adminEditStore.getOwnerLabel()}'s plot and returns your own workspace to how it was.`,
            confirmLabel: "Discard Changes",
            destructive: true,
          });
          if (!ok) return;
          adminEditStore.discardAndExit();
          navigate("admin-plots");
          return;
        }
        const ok = await showConfirm({
          title: "Enter a New Plot?",
          message:
            "This clears the current plot details and entries from the workspace. If a cooperator name is set, this plot has already been saved to your library.",
          confirmLabel: "Enter a New Plot",
          destructive: true,
        });
        if (!ok) return;
        libraryStore.flushDraftToLibrary();
        trialStore.startNewTrial();
        navigate("trial-details");
      },
    },
    adminEditing ? "Discard Admin Edit" : "Enter a New Plot"
  );

  const screen = h("div", { className: "screen workspace-menu-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      h("h2", { className: "screen-heading" }, "Plot Workspace"),
      adminEditBanner,
      rows,
      h("div", { className: "section-spacer" }),
      saveAdminEditBtn,
      startNewBtn,
    ]),
  ]);

  mount(container, screen);
}
