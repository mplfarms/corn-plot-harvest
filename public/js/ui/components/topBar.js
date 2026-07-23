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

// Home button icon — an outlined barn (per explicit request, replacing
// the previous plain house glyph "⌂"): a gambrel (two-slope) roofline
// distinguishes it from a generic house pictogram, and the X
// cross-braced door is a classic barn-door detail. `stroke="currentColor"`
// so it always matches the top bar's white text/icon color in both
// light and dark mode, same as every other glyph up here — no separate
// color to keep in sync. Set via dom.js's `h()` `html` attr (raw
// innerHTML) since h() only builds plain HTML elements, not SVG's
// namespaced ones — see plotSummary.js's buildBoxPlotSvg() for the
// alternative (createElementNS) pattern used where an SVG needs to be
// built/updated programmatically; this icon is static, so a plain
// string is simpler.
const BARN_ICON_SVG = `
<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 11 L6.5 6 L12 3 L17.5 6 L21 11" />
  <path d="M3 11 L3 21 L21 21 L21 11" />
  <path d="M9.5 21 L9.5 14 L14.5 14 L14.5 21" />
  <path d="M9.5 14 L14.5 21 M14.5 14 L9.5 21" />
</svg>
`.trim();

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
      {
        type: "button",
        className: "top-bar-btn top-bar-btn-nav top-bar-btn-home",
        "aria-label": "Home",
        onclick: opts.onHome || goHome,
      },
      h("span", { className: "top-bar-home-icon", html: BARN_ICON_SVG })
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
