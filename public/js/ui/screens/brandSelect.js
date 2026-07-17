// src/ui/screens/brandSelect.js
//
// The manual Brand View picker — "the screen where they select brand
// view" that the launch screen (accountScreen.js) sends signed-in users
// to when their email's domain isn't recognized as belonging to a
// specific brand (see brand.js's brandIdForEmail()). Also still directly
// reachable any time from Settings' Brand View control.

import { h, mount } from "../dom.js";
import { BRANDS } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as authStore from "../authStore.js";
import { navigate } from "../router.js";

function brandButton(brand) {
  return h(
    "button",
    {
      type: "button",
      className: "brand-select-btn",
      onclick: () => {
        brandStore.selectBrand(brand.id);
        // Reached either already signed in (from the launch screen, for
        // an unrecognized email domain) or not signed in at all (a
        // direct/legacy visit) — either way, a brand is now known, so
        // head to the Home Screen.
        navigate(authStore.getUser() ? "plot-chooser" : "account");
      },
    },
    [
      h("img", { className: "brand-select-logo", src: brand.logo, alt: brand.displayName }),
      h("span", { className: "brand-select-name" }, brand.displayName),
    ]
  );
}

export function render(container) {
  const screen = h("div", { className: "screen brand-select-screen" }, [
    h("div", { className: "brand-select-content" }, [
      authStore.getUser()
        ? h(
            "button",
            { type: "button", className: "brand-select-back-link", onclick: () => navigate("account", { force: true }) },
            "‹ Back"
          )
        : null,
      h("h1", { className: "brand-select-title" }, "Corn Plot Harvest"),
      h("p", { className: "brand-select-subtitle" }, "Select Brand"),
      h("div", { className: "brand-select-buttons" }, [
        brandButton(BRANDS.midwestSeedGenetics),
        brandButton(BRANDS.ncPlus),
      ]),
    ]),
    h(
      "p",
      { className: "brand-select-footer" },
      "You can switch brands anytime from the main menu — your plots and trials are shared between both."
    ),
  ]);

  mount(container, screen);
}
