// src/ui/components/topBar.js
//
// Shared toolbar: dark "chrome" background with white text always (both
// light and dark mode), matching the Swift app's dark navy toolbar.
//
// The Home button (far left) and Settings gear (far right) are shown on
// every top bar, on every screen, unconditionally — they're the app's
// permanent chrome, not per-screen options. A screen can still add its
// own contextual Back button (left, after Home) and/or extra right-side
// content (e.g. Plot Summary's share menu), which sits to the left of
// the Settings gear so the gear always stays the rightmost element.
//
// "Home" means the branded per-brand Home Screen (plotChooser.js, routed
// at #/plot-chooser — "Corn Plot Entry" + that brand's logo, with "Enter
// a New Plot" / "Saved Plots"), not the deeper Plot Workspace menu
// (workspaceMenu.js, #/workspace — that screen's own Back button already
// returns to plot-chooser, unaffected by this). The white Republic
// shield launch/sign-in screen (accountScreen.js, #/account) is reserved
// for the initial sign-on only (first visit before a brand is known, or
// Settings' explicit "Sign In to Sync") — it is never the Home button's
// target.

import { h } from "../dom.js";
import { navigate } from "../router.js";
import * as libraryStore from "../stores/libraryStore.js";

function goHome() {
  libraryStore.flushDraftToLibrary();
  navigate("plot-chooser");
}

/**
 * @param {{
 *   title: string,
 *   onHome?: () => void,
 *   onBack?: () => void,
 *   backLabel?: string,
 *   right?: Node|Node[],
 * }} opts
 */
export function createTopBar(opts) {
  const left = [
    h(
      "button",
      { type: "button", className: "top-bar-btn top-bar-btn-nav", "aria-label": "Home", onclick: opts.onHome || goHome },
      "⌂"
    ),
  ];
  if (opts.onBack) {
    left.push(
      h(
        "button",
        { type: "button", className: "top-bar-btn top-bar-btn-nav", "aria-label": opts.backLabel || "Back", onclick: opts.onBack },
        "‹"
      )
    );
  }

  const right = [];
  if (opts.right) right.push(opts.right);
  right.push(
    h(
      "button",
      {
        type: "button",
        className: "top-bar-btn top-bar-btn-settings",
        "aria-label": "Settings",
        onclick: () => navigate("settings"),
      },
      "⚙"
    )
  );

  return h("header", { className: "top-bar" }, [
    h("div", { className: "top-bar-left" }, left),
    h("div", { className: "top-bar-title" }, opts.title),
    h("div", { className: "top-bar-right" }, right),
  ]);
}
