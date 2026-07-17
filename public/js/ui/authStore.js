// src/ui/authStore.js
//
// Local session store for this app's lightweight auth: Name + Email + one
// shared team passcode, instead of Netlify Identity (removed — see
// netlify/functions/auth.js and _shared.js's top comment for why: no
// per-user passwords, no email verification, just a single passcode the
// whole team shares). There is no JWT and no server-side session — a
// "session" here is just {name, email, isAdmin} plus the passcode, cached
// in localStorage. Every other module that needs to prove who's calling
// (cloudSyncStore.js, adminPlots.js, manageUsers.js) reads the pair from
// getCredentials() here and sends it explicitly on every request; the
// server re-checks the passcode (and, for admin actions, the isAdmin flag
// on the caller's own stored record) on every single call — nothing here
// is trusted client-side alone.

import { createPubSub, readJson, writeJson } from "./stores/pubsub.js";

const SESSION_KEY = "cph.authSession"; // {name, email, isAdmin}
const PASSCODE_KEY = "cph.authPasscode";

const pubsub = createPubSub();

let session = readJson(SESSION_KEY, null);
let passcode = null;
try {
  passcode = localStorage.getItem(PASSCODE_KEY) || null;
} catch (e) {
  passcode = null;
}

// A session without its passcode (or vice versa) is useless for making
// authenticated calls — treat that as signed out rather than half-signed-in.
if (!session || !passcode) {
  session = null;
  passcode = null;
}

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
 * The email + passcode pair every authenticated request must send. Never
 * a Bearer token — this app has no JWTs at all now.
 * @returns {{email: string, passcode: string}|null} null if signed out
 */
export function getCredentials() {
  if (!session || !passcode) return null;
  return { email: session.email, passcode };
}

/**
 * Signs in, creating the account on first use (see auth.js — sign-up and
 * sign-in are the same call). Persists the resulting session + passcode
 * to localStorage on success.
 * @param {{name: string, email: string, passcode: string}} params
 * @returns {Promise<{ok: true, user: Object}|{ok: false, error: string}>}
 */
export async function signIn({ name, email, passcode: suppliedPasscode }) {
  let res;
  try {
    res = await fetch("/.netlify/functions/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, passcode: suppliedPasscode }),
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
  passcode = suppliedPasscode;
  writeJson(SESSION_KEY, session);
  try {
    localStorage.setItem(PASSCODE_KEY, passcode);
  } catch (e) {
    console.error("[authStore] failed to persist passcode", e);
  }
  pubsub.notify();
  return { ok: true, user: session };
}

/** Clears the local session. There's no server-side session to invalidate. */
export function signOut() {
  session = null;
  passcode = null;
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PASSCODE_KEY);
  } catch (e) {
    console.error("[authStore] failed to clear session", e);
  }
  pubsub.notify();
}
