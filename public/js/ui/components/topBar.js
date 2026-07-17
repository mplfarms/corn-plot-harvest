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
// "Home" means the branded Home Screen (plotChooser.js, routed at
// #/plot-chooser — the "Corn Plot Entry" title/logo screen with "Enter a
// New Plot" and "Saved Plots"), not the Plot Workspace menu — the brand
// is chosen once up front and from then on stays fixed for the session;
// switching brands is a deliberate action tucked into Settings (see
// settings.js), not something the Home button does as a side effect.
// The Plot Workspace screen ("workspace") is still reachable and is
// still what several screens' own Back buttons return to — only this
// top bar's Home button was repointed.

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
      { type: "button", className: "top-bar-btn", "aria-label": "Home", onclick: opts.onHome || goHome },
      "⌂ Home"
    ),
  ];
  if (opts.onBack) {
    left.push(
      h("button", { type: "button", className: "top-bar-btn", onclick: opts.onBack }, `‹ ${opts.backLabel || "Back"}`)
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
