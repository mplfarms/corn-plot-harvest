// src/ui/screens/plotChooser.js

import { h, mount } from "../dom.js";
import { getBrand } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as trialStore from "../stores/trialStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import { createTopBar } from "../components/topBar.js";
import { navigate } from "../router.js";

export function render(container) {
  const brand = getBrand(brandStore.getState().selectedBrand);
  const savedCount = libraryStore.getState().trials.length;

  const topBar = createTopBar({
    title: brand ? brand.displayName : "Corn Plot Harvest",
  });

  const savedRow = h(
    "button",
    {
      type: "button",
      className: "chooser-row",
      onclick: () => navigate("saved-plots", { enterWorkspaceOnSelect: true }),
    },
    [
      h("span", { className: "chooser-row-title" }, "Saved Plots"),
      h("span", { className: "chooser-row-badge" }, String(savedCount)),
      h("span", { className: "chooser-row-chevron" }, "›"),
    ]
  );

  const newRow = h(
    "button",
    {
      type: "button",
      className: "chooser-row chooser-row-primary",
      onclick: () => {
        libraryStore.flushDraftToLibrary();
        trialStore.startNewTrial();
        navigate("trial-details");
      },
    },
    [h("span", { className: "chooser-row-title" }, "Enter a New Plot"), h("span", { className: "chooser-row-chevron" }, "›")]
  );

  const screen = h("div", { className: "screen plot-chooser-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      h("h2", { className: "screen-heading" }, "Plot Chooser"),
      h("div", { className: "chooser-list" }, [savedRow, newRow]),
    ]),
  ]);

  mount(container, screen);
}
