// src/ui/main.js (served at public/js/main.js)
//
// App entry point: registers the service worker, waits for the default
// lists to load (screens assume listsStore is ready), picks a sensible
// initial route (skip BrandSelect if a brand was already chosen on a
// previous visit), and starts the router.

import * as listsStore from "./ui/stores/listsStore.js";
import * as brandStore from "./ui/stores/brandStore.js";
import * as authStore from "./ui/authStore.js";
import "./ui/stores/themeStore.js"; // self-applies persisted theme mode on load
import "./ui/stores/cloudSyncStore.js"; // wires up push/pull subscriptions on load
import { initRouter } from "./ui/router.js";

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
    const hasBrand = Boolean(brandStore.getState().selectedBrand);
    window.location.hash = hasBrand ? "#/plot-chooser" : "#/brand-select";
  }

  const container = document.getElementById("app");
  initRouter(container);
}

start();
