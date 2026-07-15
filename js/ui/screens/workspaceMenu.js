// src/ui/screens/workspaceMenu.js
//
// Mirrors ContentView.swift's workspace menu: Plot Details / Plot
// Entries / Plot Summary & Results, plus a Saved Plots row and a
// destructive "Start a New Trial" action.

import { h, mount } from "../dom.js";
import { getBrand } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as trialStore from "../stores/trialStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import * as authStore from "../authStore.js";
import { createTopBar } from "../components/topBar.js";
import { showConfirm } from "../components/modal.js";
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

export function render(container) {
  const brand = getBrand(brandStore.getState().selectedBrand);
  const draft = trialStore.getState();
  const cooperator = draft.header.cooperatorName.trim();
  const entryCount = draft.entries.length;

  const topBar = createTopBar({
    title: brand ? brand.displayName : "Workspace",
    onBack: () => navigate("plot-chooser"),
  });

  const rows = h("div", { className: "chooser-list" }, [
    menuRow("Plot Details", cooperator || "No cooperator set yet", () => navigate("trial-details")),
    menuRow(
      "Plot Entries",
      `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`,
      () => navigate("entries")
    ),
    menuRow("Plot Summary & Results", "Ranked results & export", () => navigate("plot-summary")),
    menuRow("Saved Plots", `${libraryStore.getState().trials.length} saved`, () =>
      navigate("saved-plots", { enterWorkspaceOnSelect: false })
    ),
    authStore.isAdmin() ? menuRow("All Plots (Admin)", "See every user's saved plots", () => navigate("admin-plots")) : null,
  ]);

  // ---- Account / cloud sync status ----
  const user = authStore.getUser();
  const accountCard = h(
    "section",
    { className: "card account-status-card" },
    user
      ? [
          h("p", { className: "account-status-text" }, `Synced as ${user.email}`),
          h("p", { className: "field-note" }, "Manage your account in Settings."),
        ]
      : [
          h("p", { className: "account-status-text" }, "Not signed in — plots are only saved on this device."),
          h(
            "button",
            {
              type: "button",
              className: "btn btn-secondary",
              onclick: () => navigate("account", { force: true }),
            },
            "Sign In to Sync"
          ),
        ]
  );

  const startNewBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-danger btn-block",
      onclick: async () => {
        const ok = await showConfirm({
          title: "Start a New Trial?",
          message:
            "This clears the current plot details and entries from the workspace. If a cooperator name is set, this plot has already been saved to your library.",
          confirmLabel: "Start New Trial",
          destructive: true,
        });
        if (!ok) return;
        libraryStore.flushDraftToLibrary();
        trialStore.startNewTrial();
        navigate("trial-details");
      },
    },
    "Start a New Trial"
  );

  const screen = h("div", { className: "screen workspace-menu-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      h("h2", { className: "screen-heading" }, "Plot Workspace"),
      accountCard,
      rows,
      h("div", { className: "section-spacer" }),
      startNewBtn,
    ]),
  ]);

  mount(container, screen);
}
