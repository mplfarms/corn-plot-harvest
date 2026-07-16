// src/ui/router.js
//
// A minimal hash-based view router — no external router library. The
// URL hash (#/screen-name) selects the screen; navigation params that
// don't belong in a URL (e.g. "which entry id are we editing") are kept
// in an in-memory object since this is a workspace app, not something
// meant to be deep-linked/bookmarked mid-edit.

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
};

let appContainer = null;
let currentParams = {};

function currentPath() {
  const hash = window.location.hash || "";
  const m = hash.match(/^#\/([a-zA-Z0-9-]+)/);
  return m ? m[1] : null;
}

function renderCurrent() {
  if (!appContainer) return;
  const path = currentPath() || "brand-select";
  const screen = routes[path] || routes["brand-select"];
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
 * @param {Object} [params]
 */
export function navigate(path, params) {
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
