// src/ui/authStore.js
//
// Thin wrapper around the Netlify Identity widget. Loaded via a plain
// <script> tag in index.html (https://identity.netlify.com/v1/netlify-
// identity-widget.js) rather than an npm package, because this app has
// no build step for its frontend — every other module here is a native
// ES module the browser runs directly, and the classic widget is the
// only Netlify Identity client that works the same way (a global
// `window.netlifyIdentity`, no bundler required). Screens never touch
// `window.netlifyIdentity` directly — everything goes through here so
// the rest of the app has one small, testable surface.

import { createPubSub } from "./stores/pubsub.js";

const pubsub = createPubSub();
let didInit = false;

function widget() {
  return typeof window !== "undefined" ? window.netlifyIdentity : null;
}

/**
 * Call once at startup (main.js), after the widget's <script> tag has
 * had a chance to load. Safe to call even if the script failed to load
 * (e.g. offline on first-ever visit, before the service worker has
 * cached it) — every other function here just no-ops in that case.
 */
export function init() {
  const w = widget();
  if (!w) {
    console.error("[authStore] netlify-identity-widget script did not load — cloud sync is unavailable this session.");
    return;
  }
  if (didInit) return;
  didInit = true;
  w.on("init", () => pubsub.notify());
  w.on("login", () => {
    pubsub.notify();
    // The widget shows a "Logged in as ..." confirmation screen and does
    // NOT dismiss itself — without this, a signed-in user is stuck
    // staring at that overlay forever, even though the app underneath
    // has already moved on (see accountScreen.js's subscribe callback).
    w.close();
  });
  w.on("logout", () => pubsub.notify());
  w.on("error", (err) => console.error("[authStore] identity widget error", err));
  w.init();
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/** @returns {boolean} whether the identity widget script is present at all */
export function isAvailable() {
  return Boolean(widget());
}

/** @returns {Object|null} the Netlify Identity user, or null if signed out */
export function getUser() {
  const w = widget();
  return w ? w.currentUser() : null;
}

/** @returns {boolean} whether the signed-in user has the "admin" role */
export function isAdmin() {
  const user = getUser();
  const roles = (user && user.app_metadata && user.app_metadata.roles) || [];
  return roles.includes("admin");
}

/** Opens the Identity modal to the "Create account" tab. */
export function openSignup() {
  const w = widget();
  if (w) w.open("signup");
}

/** Opens the Identity modal to the "Sign in" tab. */
export function openLogin() {
  const w = widget();
  if (w) w.open("login");
}

export function logout() {
  const w = widget();
  if (w) w.logout();
}

/**
 * A fresh (auto-refreshed if expired) JWT for calling Netlify Functions,
 * or null if signed out / the refresh fails (e.g. offline).
 * @returns {Promise<string|null>}
 */
export async function freshToken() {
  const w = widget();
  if (!w || !w.currentUser()) return null;
  try {
    return await w.refresh();
  } catch (e) {
    console.error("[authStore] failed to refresh token", e);
    return null;
  }
}
