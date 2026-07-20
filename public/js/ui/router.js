// src/ui/router.js
//
// A minimal hash-based view router — no external router library. The
// URL hash (#/screen-name) selects the screen; navigation params that
// don't belong in a URL (e.g. "which entry id are we editing") are kept
// in an in-memory object since this is a workspace app, not something
// meant to be deep-linked/bookmarked mid-edit.
//
// Signing in is mandatory (see accountScreen.js) — every route other
// than "account" itself requires a session, enforced here rather than
// per-screen so it holds regardless of how a hash got set (a typed-in
// URL, a stale PWA launch shortcut, browser back/forward, etc.), not
// just normal in-app navigation. "quick-start" is the one other
// exception — the splash/sign-in screen links straight to it (see
// accountScreen.js) so someone can read "how do I even use this app"
// before they've signed in at all, not just after.

import * as brandSelect from "./screens/brandSelect.js";
import * as accountScreen from "./screens/accountScreen.js";
import * as plotChooser from "./screens/plotChooser.js";
import * as workspaceMenu from "./screens/workspaceMenu.js";
import * as trialDetails from "./screens/trialDetails.js";
import * as entriesList from "./screens/entriesList.js";
import * as entryEditor from "./screens/entryEditor.js";
import * as plotSummary from "./screens/plotSummary.js";
import * as savedPlots from "./screens/savedPlots.js";
import * as settingsScreen from "./screens/settings.js";
import * as adminPlots from "./screens/adminPlots.js";
import * as manageUsers from "./screens/manageUsers.js";
import * as quickStart from "./screens/quickStart.js";
import * as help from "./screens/help.js";
import * as plotSummaryHelp from "./screens/plotSummaryHelp.js";
import * as authStore from "./authStore.js";

const routes = {
  "brand-select": brandSelect,
  account: accountScreen,
  "plot-chooser": plotChooser,
  workspace: workspaceMenu,
  "trial-details": trialDetails,
  entries: entriesList,
  "entry-editor": entryEditor,
  "plot-summary": plotSummary,
  "saved-plots": savedPlots,
  settings: settingsScreen,
  "admin-plots": adminPlots,
  "manage-users": manageUsers,
  "quick-start": quickStart,
  help: help,
  "plot-summary-help": plotSummaryHelp,
};

let appContainer = null;
let currentParams = {};

function currentPath() {
  const hash = window.location.hash || "";
  const m = hash.match(/^#\/([a-zA-Z0-9-]+)/);
  return m ? m[1] : null;
}

// Most of the app is a fixed hub-and-spoke hierarchy — Plot Workspace
// (#/workspace) is the hub, and Plot Details/Hybrid Entries always
// return to it on Back. That's intentional, not a bug: those two are
// usually reached by jumping straight in from somewhere else (Home's
// "Enter a New Plot", the Workspace menu itself, etc.), skipping the hub
// entirely, and Back is the primary way to actually reach the hub
// afterward — changing it to "wherever you literally were before" would
// remove the only way in for a first-time plot. Their hardcoded
// destinations are left alone.
//
// A handful of screens are genuinely reachable from more than one place,
// though (the Settings gear sits on every top bar; "All Plots (Admin)"
// has a button on both the Home Screen and the Workspace menu; Quick
// Start is linked from the splash screen, Home, AND Help; Plot Summary
// is reached from the Workspace menu, a Saved Plots row, the Demo Plot,
// and "Return to Plot Summary" on Hybrid Entries — by explicit request,
// its Back button was changed from always-Workspace to this same
// pattern) — for THESE, a single hardcoded Back destination is always
// wrong some of the time. This remembers whichever screen each was
// actually opened from (in memory only — same lifetime as currentParams
// above — so a direct deep link or a page reload falls back to each
// screen's own sensible default; see settings.js/adminPlots.js/
// quickStart.js/plotSummary.js's onBack) so their Back button returns
// there instead.
const rememberedOrigin = {}; // { settings: 'plot-chooser', 'admin-plots': 'workspace', 'quick-start': 'help', 'plot-summary': 'saved-plots' }
const BACK_SENSITIVE_TARGETS = new Set(["settings", "admin-plots", "quick-start", "plot-summary"]);

/**
 * @param {string} path one of BACK_SENSITIVE_TARGETS
 * @returns {string|null} whatever screen `path` was actually last opened
 *   from, or null if nothing's been recorded yet.
 */
export function rememberedOriginFor(path) {
  return rememberedOrigin[path] || null;
}

function renderCurrent() {
  if (!appContainer) return;
  const path = currentPath() || "account";

  // Every screen except the launch/sign-in screen (and its linked Quick
  // Start Guide) requires a session now — bounce back to it rather than
  // rendering whatever the hash happened to point at.
  if (path !== "account" && path !== "quick-start" && !authStore.getUser()) {
    window.location.hash = "#/account";
    return;
  }

  const screen = routes[path] || routes["account"];
  screen.render(appContainer, currentParams);

  // Screens replace #app's content in place (see dom.js's mount()) rather
  // than the browser loading a fresh page, so the window's scroll
  // position otherwise carries over unchanged from whatever screen was
  // showing before. Most visibly: tapping "+ Add Another Entry" (or the
  // Entries list's "+" button) from partway down a long form used to
  // land on the new entry's editor already scrolled to that same
  // mid-page offset instead of its top. Every navigation should start
  // scrolled to the top of the new screen, so this resets it here once,
  // for all routes, rather than special-casing just the entry-add flows.
  window.scrollTo(0, 0);
}

/**
 * @param {string} path e.g. "plot-chooser"
 * @param {Object} [params] — pass `_skipOriginTracking: true` for a
 *   navigation that's really a "return trip" back to a BACK_SENSITIVE_TARGETS
 *   screen (e.g. Help's own Back button going back to Settings) rather
 *   than a genuine new arrival there, so it doesn't clobber the
 *   already-remembered true origin — see help.js/manageUsers.js and
 *   workspaceMenu.js's Save Changes/Discard Admin Edit handlers.
 */
export function navigate(path, params) {
  const from = currentPath();
  if (BACK_SENSITIVE_TARGETS.has(path) && from && from !== path && !(params && params._skipOriginTracking)) {
    rememberedOrigin[path] = from;
  }

  currentParams = params || {};
  const nextHash = `#/${path}`;
  if (window.location.hash === nextHash) {
    // Same route — hashchange won't fire, so re-render manually (e.g.
    // opening a different saved plot while already on Plot Summary).
    renderCurrent();
  } else {
    window.location.hash = nextHash;
  }
}

/**
 * @param {HTMLElement} container
 */
export function initRouter(container) {
  appContainer = container;
  window.addEventListener("hashchange", renderCurrent);
  renderCurrent();
}
