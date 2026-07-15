// src/ui/screens/brandSelect.js

import { h, mount } from "../dom.js";
import { BRANDS } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import { navigate } from "../router.js";

function brandButton(brand) {
  return h(
    "button",
    {
      type: "button",
      className: "brand-select-btn",
      onclick: () => {
        brandStore.selectBrand(brand.id);
        navigate("account");
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
