// src/ui/main.js (served at public/js/main.js)
//
// App entry point: registers the service worker, waits for the default
// lists to load (screens assume listsStore is ready), picks a sensible
// initial route (skip the launch/sign-in screen straight to the Home
// Screen if a brand was already chosen on a previous visit), and starts
// the router.

import * as listsStore from "./ui/stores/listsStore.js";
import * as brandStore from "./ui/stores/brandStore.js";
import * as authStore from "./ui/authStore.js";
import "./ui/stores/themeStore.js"; // self-applies persisted theme mode on load
import "./ui/stores/cloudSyncStore.js"; // wires up push/pull subscriptions on load
import { initRouter } from "./ui/router.js";
import { initPullToRefresh } from "./ui/components/pullToRefresh.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.error("[main] service worker registration failed", e);
    });
  });
}

async function start() {
  authStore.init();
  await listsStore.ensureLoaded();

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
  initPullToRefresh();
}

start();
