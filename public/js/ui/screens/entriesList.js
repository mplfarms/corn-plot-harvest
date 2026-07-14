// src/ui/screens/entriesList.js
//
// List of plot entries. Tap a row to edit; trash icon deletes (the web
// substitute for native swipe-to-delete); up/down arrow buttons are the
// substitute for native drag-reorder. "+" adds a new blank entry and
// jumps straight into editing it.

import { h, mount } from "../dom.js";
import * as trialStore from "../stores/trialStore.js";
import { createTopBar } from "../components/topBar.js";
import { navigate } from "../router.js";
import { entryDisplayTitle } from "../../core/models.js";
import { dryYield } from "../../core/yieldCalculator.js";

export function render(container) {
  const draft = trialStore.getState();
  const entries = draft.entries;

  const topBar = createTopBar({
    title: "Plot Entries",
    onBack: () => navigate("workspace"),
    backLabel: "Menu",
  });

  const listEl = h("div", { className: "entries-list" });

  if (entries.length === 0) {
    listEl.appendChild(h("p", { className: "empty-state" }, "No entries yet. Tap + to add your first plot entry."));
  }

  entries.forEach((entry, index) => {
    const yieldVal = dryYield(entry);
    const subtitleParts = [];
    if (entry.brand.trim()) subtitleParts.push(entry.brand.trim());
    if (entry.trait.trim()) subtitleParts.push(entry.trait.trim());
    if (yieldVal !== null) subtitleParts.push(`${yieldVal.toFixed(1)} bu/ac`);

    const row = h("div", { className: "entry-row" }, [
      h(
        "button",
        {
          type: "button",
          className: "entry-row-main",
          onclick: () => navigate("entry-editor", { entryId: entry.id }),
        },
        [
          h("span", { className: "entry-row-number" }, String(index + 1)),
          h("span", { className: "entry-row-text" }, [
            h("span", { className: "entry-row-title" }, entryDisplayTitle(entry)),
            subtitleParts.length ? h("span", { className: "entry-row-subtitle" }, subtitleParts.join(" • ")) : null,
          ]),
        ]
      ),
      h("div", { className: "entry-row-actions" }, [
        h(
          "button",
          {
            type: "button",
            className: "icon-btn",
            "aria-label": "Move up",
            disabled: index === 0,
            onclick: () => {
              trialStore.moveEntry(index, -1);
              render(container);
            },
          },
          "↑"
        ),
        h(
          "button",
          {
            type: "button",
            className: "icon-btn",
            "aria-label": "Move down",
            disabled: index === entries.length - 1,
            onclick: () => {
              trialStore.moveEntry(index, 1);
              render(container);
            },
          },
          "↓"
        ),
        h(
          "button",
          {
            type: "button",
            className: "icon-btn icon-btn-danger",
            "aria-label": "Delete entry",
            onclick: () => {
              trialStore.removeEntry(entry.id);
              render(container);
            },
          },
          "🗑"
        ),
      ]),
    ]);

    listEl.appendChild(row);
  });

  const addBtn = h(
    "button",
    {
      type: "button",
      className: "fab",
      "aria-label": "Add entry",
      onclick: () => {
        const entry = trialStore.addEntryCarryingMeasurements();
        navigate("entry-editor", { entryId: entry.id });
      },
    },
    "+"
  );

  const screen = h("div", { className: "screen entries-list-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [h("h2", { className: "screen-heading" }, "Plot Entries"), listEl]),
    addBtn,
  ]);

  mount(container, screen);
}
