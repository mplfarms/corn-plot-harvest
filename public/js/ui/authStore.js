// src/ui/authStore.js
//
// Local session store for this app's lightweight auth: just an Email
// address, no name, no password, no email verification, and no shared
// passcode either — deliberately as simple as possible, since none of
// this data is sensitive (see auth.js and _shared.js's top comment for
// the resulting tradeoff). There is no JWT and no server-side session —
// a "session" here is just whatever the server hands back for the
// account — {name, email, isAdmin, firstName, lastName, mobileNumber}
// (name defaults to the email itself server-side — see auth.js;
// firstName/lastName/mobileNumber default to empty strings for accounts
// that never answered the "Welcome!" prompt), cached in localStorage. Every
// other module that needs to prove who's calling (cloudSyncStore.js,
// adminPlots.js, manageUsers.js) reads the email from getCredentials()
// here and sends it explicitly on every request; the server re-checks
// the isAdmin flag on the caller's own stored record for every admin
// action — but there's no way for the server to verify the email
// actually belongs to whoever typed it in.

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
 * localStorage on success. `name`/`firstName`/`lastName`/`mobileNumber`
 * are all optional and normally omitted — the sign-in form only collects
 * an email; accountScreen.js makes a second call with these once the user
 * answers the "Welcome!" prompt that's shown when `isNewUser` comes back
 * true (see promptNewUserDetails() in newUserDetailsModal.js).
 * @param {{email: string, name?: string, firstName?: string, lastName?: string, mobileNumber?: string}} params
 * @returns {Promise<{ok: true, user: Object, isNewUser: boolean}|{ok: false, error: string}>}
 */
export async function signIn({ email, name, firstName, lastName, mobileNumber }) {
  let res;
  try {
    res = await fetch("/.netlify/functions/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, firstName, lastName, mobileNumber }),
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
  return { ok: true, user: session, isNewUser: Boolean(payload.isNewUser) };
}

/**
 * Lets the signed-in user edit their own First Name, Last Name, and
 * Mobile Number (see updateProfile.js — Email itself isn't editable
 * here, it's the account's identity). Unlike signIn(), every field is
 * set to exactly what's passed, including an empty string to clear a
 * field — this is a deliberate edit, not a sign-in ping. Updates the
 * cached local session with the server's response on success, so
 * anything reading authStore.getUser() reflects the change immediately
 * without needing to sign in again.
 * @param {{firstName?: string, lastName?: string, mobileNumber?: string}} params
 * @returns {Promise<{ok: true, user: Object}|{ok: false, error: string}>}
 */
export async function updateProfile({ firstName, lastName, mobileNumber }) {
  if (!session) return { ok: false, error: "Not signed in." };

  let res;
  try {
    res = await fetch("/.netlify/functions/updateProfile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: session.email, firstName, lastName, mobileNumber }),
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
    return { ok: false, error: payload.error || `Update failed (${res.status}).` };
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
