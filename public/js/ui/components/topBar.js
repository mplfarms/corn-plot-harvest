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

import { h } from "../dom.js";
import { navigate } from "../router.js";
import * as brandStore from "../stores/brandStore.js";
import * as libraryStore from "../stores/libraryStore.js";

function goHome() {
  libraryStore.flushDraftToLibrary();
  brandStore.clearBrand();
  navigate("brand-select");
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
      { type: "button", className: "top-bar-btn", "aria-label": "Settings", onclick: () => navigate("settings") },
      "⚙"
    )
  );

  return h("header", { className: "top-bar" }, [
    h("div", { className: "top-bar-left" }, left),
    h("div", { className: "top-bar-title" }, opts.title),
    h("div", { className: "top-bar-right" }, right),
  ]);
}
