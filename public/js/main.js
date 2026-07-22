// src/ui/main.js (served at public/js/main.js)
//
// App entry point: registers the service worker, waits for the default
// lists to load (screens assume listsStore is ready), picks a sensible
// initial route (skip the launch/sign-in screen straight to the Home
// Screen if a brand was already chosen on a previous visit), and starts
// the router.

import * as listsStore from "./ui/stores/listsStore.js";
import * as catalogStore from "./ui/stores/catalogStore.js";
import * as brandStore from "./ui/stores/brandStore.js";
import * as authStore from "./ui/authStore.js";
import * as libraryStore from "./ui/stores/libraryStore.js";
import * as cloudSyncStore from "./ui/stores/cloudSyncStore.js";
import "./ui/stores/themeStore.js"; // self-applies persisted theme mode on load
import { initUpdateBanner } from "./ui/components/updateBanner.js";
import { initRouter } from "./ui/router.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.error("[main] service worker registration failed", e);
    });
  });
}

// Registered up front (not gated behind the "load" event above) — it
// only reads navigator.serviceWorker.controller and adds an event
// listener, neither of which needs the registration call above to have
// resolved yet, and capturing "did this page already have a controller
// at load" as early as possible is exactly the point (see the module's
// own comment on why that timing matters).
initUpdateBanner();

async function start() {
  authStore.init();
  // Reconcile this device's local library with the cloud BEFORE
  // anything else gets a chance to mutate it and trigger an automatic
  // push (see libraryStore.ensureDemoPlot() right below, which touches
  // the library on every app version bump) — see cloudSyncStore.js's
  // top comment for the real production incident this order fixes: a
  // push overwrites the user's entire cloud copy, so it must never fire
  // from local data that hasn't been given a chance to catch up with
  // the cloud first. Awaited, not fire-and-forget, specifically so
  // ensureDemoPlot() can never run before this completes. authStore.init()
  // being a no-op above means this is also the ONLY place a normal
  // returning (already-signed-in) session ever re-pulls from the cloud —
  // previously that only happened on a brand-new sign-in. Never throws
  // (see pullAndMerge()'s own comment) and no-ops instantly when signed
  // out, so this can't block or break startup either way.
  await cloudSyncStore.pullAndMerge();
  // Local to this device, independent of sign-in — see
  // libraryStore.ensureDemoPlot()'s comment for the "reappears after an
  // update, but not before you delete it" rule.
  libraryStore.ensureDemoPlot();
  // Both fall back to their own local cache / defaults on failure and
  // never throw (see each store's ensureLoaded() top comment) — run
  // together rather than one-after-the-other since neither depends on
  // the other's result.
  await Promise.all([listsStore.ensureLoaded(), catalogStore.ensureLoaded()]);

  if (!window.location.hash) {
    // Signing in is mandatory now (see accountScreen.js / router.js) —
    // only send a returning visitor straight to the Home Screen if
    // they're both signed in AND have a brand already remembered.
    // Otherwise (first-time visit, or signed out) show the Republic
    // launch/sign-in screen (#/account); router.js's own guard would
    // catch this anyway, but deciding it correctly here avoids an extra
    // redirect hop on every cold start.
    const hasBrand = Boolean(brandStore.getState().selectedBrand);
    const signedIn = Boolean(authStore.getUser());
    window.location.hash = hasBrand && signedIn ? "#/plot-chooser" : "#/account";
  }

  const container = document.getElementById("app");
  initRouter(container);
}

start();
