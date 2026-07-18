// src/ui/screens/savedPlots.js
//
// Searchable (by cooperator/state/year), sorted by lastModified desc.
// "Current" badge on the trial that is currently open in the workspace.
// Tapping a row opens it into the workspace: from PlotChooser this lands
// on Plot Summary (params.enterWorkspaceOnSelect === true); from inside
// the workspace menu it just navigates in place (also to Plot Summary,
// since that's "opening a different saved plot" per the spec).
//
// A plot that moved here from a deleted/merged-away account (see
// adminUsers.js's handleMerge() and deleteAccount.js) carries a
// transferredFrom field and shows a "From {name}" badge, rather than
// silently blending into whoever's library it landed in — deliberately
// NOT re-sorted into its own group, so the list stays in its normal
// most-recently-touched order regardless of where each plot came from.

import { h, mount, clear } from "../dom.js";
import * as trialStore from "../stores/trialStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import { createTopBar } from "../components/topBar.js";
import { showConfirm } from "../components/modal.js";
import { navigate } from "../router.js";
import { filenameYear } from "../../core/models.js";

function matchesQuery(trial, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const h = trial.header;
  return (
    (h.cooperatorName || "").toLowerCase().includes(q) ||
    (h.state || "").toLowerCase().includes(q) ||
    String(filenameYear(h)).includes(q)
  );
}

export function render(container, params) {
  let query = "";
  const currentDraftId = trialStore.getState().id;

  const topBar = createTopBar({
    title: "Saved Plots",
    onBack: () => navigate(params && params.enterWorkspaceOnSelect ? "plot-chooser" : "workspace"),
    backLabel: "Back",
  });

  const searchInput = h("input", {
    type: "search",
    className: "text-input saved-plots-search",
    placeholder: "Search by cooperator, state, or year…",
    oninput: (e) => {
      query = e.target.value;
      renderList();
    },
  });

  const listEl = h("div", { className: "entries-list" });

  function renderList() {
    clear(listEl);
    const trials = libraryStore
      .getState()
      .trials.filter((t) => matchesQuery(t, query))
      .slice()
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

    if (trials.length === 0) {
      listEl.appendChild(h("p", { className: "empty-state" }, "No saved plots yet."));
      return;
    }

    for (const trial of trials) {
      const isCurrent = trial.id === currentDraftId;
      const subtitleParts = [String(filenameYear(trial.header))];
      if (trial.header.state) subtitleParts.push(trial.header.state);
      subtitleParts.push(`${trial.entries.length} ${trial.entries.length === 1 ? "entry" : "entries"}`);

      // Set once, server-side, whenever a plot moves accounts — either an
      // admin's "Merge Into…" (adminUsers.js's handleMerge()) or a user's
      // own "Delete My Account" (deleteAccount.js) — so it's still
      // identifiable as having belonged to a teammate rather than being
      // silently absorbed into whoever's library it landed in.
      const transferredFrom = trial.transferredFrom;

      const row = h("div", { className: "entry-row" }, [
        h(
          "button",
          {
            type: "button",
            className: "entry-row-main",
            onclick: () => {
              trialStore.loadTrial(trial);
              navigate("plot-summary");
            },
          },
          [
            h("span", { className: "entry-row-text" }, [
              h("span", { className: "entry-row-title" }, [
                trial.header.cooperatorName.trim() || "Untitled Plot",
                isCurrent ? h("span", { className: "badge-current" }, "Current") : null,
                transferredFrom
                  ? h(
                      "span",
                      { className: "badge-transferred", title: `Transferred from ${transferredFrom.email}` },
                      `From ${transferredFrom.name || transferredFrom.email}`
                    )
                  : null,
              ]),
              h("span", { className: "entry-row-subtitle" }, subtitleParts.join(" • ")),
            ]),
          ]
        ),
        h("div", { className: "entry-row-actions" }, [
          h(
            "button",
            {
              type: "button",
              className: "icon-btn icon-btn-danger",
              "aria-label": "Delete saved plot",
              onclick: async () => {
                const ok = await showConfirm({
                  title: "Delete Saved Plot?",
                  message: `This permanently removes "${trial.header.cooperatorName.trim() || "Untitled Plot"}" from your library.`,
                  confirmLabel: "Delete",
                  destructive: true,
                });
                if (!ok) return;
                libraryStore.deleteTrial(trial.id);
                renderList();
              },
            },
            "🗑"
          ),
        ]),
      ]);

      listEl.appendChild(row);
    }
  }

  renderList();

  const screen = h("div", { className: "screen saved-plots-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [h("h2", { className: "screen-heading" }, "Saved Plots"), searchInput, listEl]),
  ]);

  mount(container, screen);
}
