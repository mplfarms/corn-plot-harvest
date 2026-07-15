// src/ui/screens/settings.js
//
// Settings screen, reachable from the workspace ("Home") menu. Currently
// holds a single setting: appearance (Light / Dark / System), using the
// same segmented-control look as plotSummary.js's metric switcher.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { getBrand } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import * as themeStore from "../stores/themeStore.js";
import * as authStore from "../authStore.js";
import { navigate } from "../router.js";

const MODES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function render(container) {
  const topBar = createTopBar({
    title: "Settings",
    onBack: () => navigate("workspace"),
  });

  const mode = themeStore.getState().mode;

  const segmented = h(
    "div",
    { className: "segmented-control" },
    MODES.map((m) =>
      h(
        "button",
        {
          type: "button",
          className: "segmented-btn" + (m.value === mode ? " segmented-btn-active" : ""),
          "aria-pressed": m.value === mode ? "true" : "false",
          onclick: () => {
            themeStore.setMode(m.value);
            render(container);
          },
        },
        m.label
      )
    )
  );

  const appearanceCard = h("section", { className: "card" }, [
    h("h3", { className: "section-header" }, "Appearance"),
    h(
      "p",
      { className: "field-note" },
      "System follows your device's light/dark setting automatically."
    ),
    segmented,
  ]);

  // ---- Brand ----
  const brand = getBrand(brandStore.getState().selectedBrand);
  const brandCard = h("section", { className: "card" }, [
    h("h3", { className: "section-header" }, "Brand"),
    h(
      "p",
      { className: "field-note" },
      brand ? `Currently using ${brand.displayName}.` : "No brand selected."
    ),
    h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary",
        onclick: () => {
          libraryStore.flushDraftToLibrary();
          brandStore.clearBrand();
          navigate("brand-select");
        },
      },
      "Switch Brand"
    ),
  ]);

  // ---- Account ----
  const user = authStore.getUser();
  const accountCard = h(
    "section",
    { className: "card account-card" },
    user
      ? [
          h("h3", { className: "section-header" }, "Account"),
          h("p", { className: "account-status-text" }, `Signed in as ${user.email}`),
          h(
            "button",
            {
              type: "button",
              className: "btn btn-secondary",
              onclick: () => {
                authStore.logout();
                render(container);
              },
            },
            "Sign Out"
          ),
        ]
      : [
          h("h3", { className: "section-header" }, "Account"),
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

  const screen = h("div", { className: "screen settings-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      h("h2", { className: "screen-heading" }, "Settings"),
      appearanceCard,
      brandCard,
      accountCard,
    ]),
  ]);

  mount(container, screen);
}
