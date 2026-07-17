// src/ui/authStore.js
//
// Local session store for this app's lightweight auth: just Name + Email,
// no password, no email verification, and no shared passcode either (the
// team explicitly asked for the passcode to be dropped — see auth.js and
// _shared.js's top comment for the resulting tradeoff). There is no JWT
// and no server-side session — a "session" here is just {name, email,
// isAdmin}, cached in localStorage. Every other module that needs to
// prove who's calling (cloudSyncStore.js, adminPlots.js, manageUsers.js)
// reads the email from getCredentials() here and sends it explicitly on
// every request; the server re-checks the isAdmin flag on the caller's
// own stored record for every admin action — but there's no way for the
// server to verify the email actually belongs to whoever typed it in.

import { createPubSub, readJson, writeJson } from "./stores/pubsub.js";

const SESSION_KEY = "cph.authSession"; // {name, email, isAdmin}

const pubsub = createPubSub();

let session = readJson(SESSION_KEY, null);

/**
 * Call once at startup (main.js). Kept for symmetry with how every other
 * store/screen expects an init() hook — hydration from localStorage
 * already happened above at module load, so this is currently a no-op,
 * but keeping the call site in main.js means a future change here (e.g.
 * re-validating the cached session against the server on launch) doesn't
 * need a call-site change anywhere else.
 */
export function init() {
  // No-op — see comment above.
}

/**
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/** @returns {{name: string, email: string, isAdmin: boolean}|null} */
export function getUser() {
  return session;
}

/** @returns {boolean} whether the signed-in user's stored record has isAdmin === true */
export function isAdmin() {
  return Boolean(session && session.isAdmin);
}

/**
 * The email every authenticated request must send. Never a Bearer token
 * or passcode — this app has neither anymore.
 * @returns {{email: string}|null} null if signed out
 */
export function getCredentials() {
  if (!session) return null;
  return { email: session.email };
}

/**
 * Signs in, creating the account on first use (see auth.js — sign-up and
 * sign-in are the same call). Persists the resulting session to
 * localStorage on success.
 * @param {{name: string, email: string}} params
 * @returns {Promise<{ok: true, user: Object}|{ok: false, error: string}>}
 */
export async function signIn({ name, email }) {
  let res;
  try {
    res = await fetch("/.netlify/functions/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
  } catch (e) {
    return { ok: false, error: "Couldn't reach the server — check your connection and try again." };
  }

  let payload = {};
  try {
    payload = await res.json();
  } catch (e) {
    // Ignore — payload stays {} and the generic status-based message below is used.
  }

  if (!res.ok) {
    return { ok: false, error: payload.error || `Sign-in failed (${res.status}).` };
  }

  session = payload.user;
  writeJson(SESSION_KEY, session);
  pubsub.notify();
  return { ok: true, user: session };
}

/** Clears the local session. There's no server-side session to invalidate. */
export function signOut() {
  session = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.error("[authStore] failed to clear session", e);
  }
  pubsub.notify();
}
