// src/ui/screens/plotChooser.js
//
// The branded Home Screen — the first real screen a user lands on for a
// given brand (after choosing/skipping the Account step, or immediately
// on return visits once a brand is already remembered — see main.js).
// One solid-color hero per brand: "Corn Plot Entry" and that brand's
// logo sit toward the top, "Enter a New Plot" and "Saved Plots" sit
// toward the bottom. The background color itself is brand-specific
// (var(--chrome) — dark green for Midwest Seed Genetics, blue for NC+)
// and needs no per-brand branching here since applyBrandTheme() (see
// brand.js) already keeps that CSS variable in sync with whichever
// brand is currently selected.
//
// "Quick Start Guide" sits below the other actions, styled as a plain
// link (home-btn-ghost) rather than another bordered button — it's
// informational, not something to weigh equally against "Enter a New
// Plot" — and points to quickStart.js's short getting-started guide.

import { h, mount } from "../dom.js";
import { getBrand } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as trialStore from "../stores/trialStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import * as authStore from "../authStore.js";
import { createTopBar } from "../components/topBar.js";
import { navigate } from "../router.js";

export function render(container) {
  const brand = getBrand(brandStore.getState().selectedBrand);
  const savedCount = libraryStore.getState().trials.length;

  const topBar = createTopBar({
    title: brand ? brand.displayName : "Corn Plot Harvest",
  });

  const heroTop = h("div", { className: "home-hero-top" }, [
    h("h1", { className: "home-title" }, "Corn Plot Entry"),
    brand ? h("img", { className: "home-logo", src: brand.logo, alt: brand.displayName }) : null,
  ]);

  const newPlotBtn = h(
    "button",
    {
      type: "button",
      className: "home-btn home-btn-primary",
      onclick: () => {
        libraryStore.flushDraftToLibrary();
        trialStore.startNewTrial();
        navigate("trial-details");
      },
    },
    "Enter a New Plot"
  );

  const savedPlotsBtn = h(
    "button",
    {
      type: "button",
      className: "home-btn home-btn-secondary",
      onclick: () => navigate("saved-plots", { enterWorkspaceOnSelect: true }),
    },
    [
      h("span", {}, "Saved Plots"),
      savedCount > 0 ? h("span", { className: "home-btn-badge" }, String(savedCount)) : null,
    ]
  );

  // Admin-only — visible only when the signed-in user's own stored
  // record has isAdmin === true (server re-checks this independently on
  // every call anyway; see adminPlots.js and _shared.js's requireAdmin()).
  const allPlotsAdminBtn = authStore.isAdmin()
    ? h(
        "button",
        {
          type: "button",
          className: "home-btn home-btn-secondary",
          onclick: () => navigate("admin-plots"),
        },
        "All Plots (Admin)"
      )
    : null;

  // A plain, less prominent link rather than another bordered button —
  // this is informational, not an action, and shouldn't visually compete
  // with "Enter a New Plot"/"Saved Plots" for a first-time user's
  // attention. Goes to quickStart.js's short getting-started guide; the
  // much longer Help screen lives in Settings instead (see settings.js),
  // since Settings is where every other "about the app" item already is.
  const quickStartBtn = h(
    "button",
    {
      type: "button",
      className: "home-btn home-btn-ghost",
      onclick: () => navigate("quick-start"),
    },
    "📖 Quick Start Guide"
  );

  const heroActions = h("div", { className: "home-actions" }, [
    newPlotBtn,
    savedPlotsBtn,
    allPlotsAdminBtn,
    quickStartBtn,
  ]);

  const hero = h("div", { className: "home-hero" }, [heroTop, heroActions]);

  const screen = h("div", { className: "screen home-screen" }, [topBar, hero]);

  mount(container, screen);
}
