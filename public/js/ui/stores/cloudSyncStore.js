// src/ui/stores/cloudSyncStore.js
//
// Bridges the local-only libraryStore (localStorage — always the source
// of truth for offline use; nothing here ever blocks on the network) with
// the cloud (netlify/functions/plots.js + Netlify Blobs), when the user
// is signed in via authStore. Importing this module wires up its
// subscriptions as a side effect (mirrors themeStore.js/brandStore.js) —
// main.js just needs to import it once.
//
// Sync model: whenever the local library changes, push the *whole*
// trials array up (debounced, so rapid edits collapse into one request).
// On sign-in, pull the cloud copy and merge it into the local one by
// comparing each trial's lastModified — whichever side is newer per
// trial id wins. This is deliberately simple (no true conflict UI); for
// a single farm operation editing its own plots, "last write wins per
// trial" is enough and matches how the existing auto-save already works.
//
// Every network call is wrapped so a failure (offline, cold Netlify
// Function, etc.) is logged and otherwise silent — signing in on a
// spotty field connection should never break the app or lose local data.
//
// A REAL INCIDENT this file is now written to prevent: a push (see
// pushNow() below) sends the device's ENTIRE local trials list, and
// netlify/functions/plots.js's PUT handler unconditionally OVERWRITES
// the user's whole cloud blob with whatever's sent — there is no
// server-side merge and no history. That's fine as long as this device's
// local copy has already been reconciled with the cloud at least once.
// It is NOT fine on a normal app reopen with an already-signed-in
// session: authStore.init() is a no-op (it doesn't re-notify
// subscribers for a session that was merely reloaded from localStorage,
// only for a brand-new signIn() call), so before this fix, nothing here
// ever pulled fresh cloud data on a normal reopen — a device just kept
// using whatever it already had locally. Any local mutation at all
// (including libraryStore.ensureDemoPlot()'s automatic demo-plot
// refresh, which runs once per app version) would then schedule an
// automatic push (see schedulePush() below) of that possibly-stale,
// possibly-incomplete local list, silently deleting from the cloud any
// trial that existed there but not on this particular device (e.g. one
// created on a teammate's device, or on this same device before an
// earlier local-storage reset) — with no warning and no way to undo it
// server-side. This is exactly what happened in production: plots went
// missing from All Plots (Admin) after a routine app update, on a device
// that had been signed in for a while but not recently reopened.
//
// The fix has two layers: main.js now explicitly awaits pullAndMerge()
// at startup, before anything else (like ensureDemoPlot()) gets a chance
// to mutate the library — and, as a second, independent safety net in
// case some other code path ever mutates the library first,
// initialPullAttempted below makes pushNow() itself always wait for (or
// trigger) one pull attempt per app session before ever sending a push,
// regardless of how that push was triggered.

import * as libraryStore from "./libraryStore.js";
import * as authStore from "../authStore.js";
import { createPubSub } from "./pubsub.js";

const ENDPOINT = "/.netlify/functions/plots";
const PUSH_DEBOUNCE_MS = 1500;

let pushTimer = null;
// Set while applying a pulled cloud copy back into libraryStore, so that
// mutation doesn't itself schedule a redundant push of the same data
// right back up.
let applyingRemote = false;

// True once a pullAndMerge() call has SETTLED (succeeded OR failed) at
// least once this app session — see this file's top comment. pushNow()
// waits for this before ever sending, so a push can never fire based on
// local data that hasn't at least been given a chance to reconcile with
// the cloud first. Deliberately keyed off "attempted," not "succeeded":
// a device that's genuinely offline still needs to be able to push once
// connectivity returns, without this gate blocking it forever — the
// scenario this exists to prevent is "never even tried," not "tried and
// the network happened to be down."
let initialPullAttempted = false;
// Dedupes concurrent pullAndMerge() calls (e.g. main.js's explicit
// startup pull racing a schedulePush()-triggered one) into a single
// in-flight request rather than firing two GETs and merging twice.
let pullPromise = null;

// ---- Sync status (drives the header sync icon — see topBar.js) ----
//
// "synced"     — signed in, and the most recent push/pull succeeded.
// "syncing"    — signed in, a push or pull is in flight right now.
// "error"      — signed in, but the most recent push/pull failed.
// "signed-out" — not signed in at all; nothing to sync.
export const SyncStatus = {
  SYNCED: "synced",
  SYNCING: "syncing",
  ERROR: "error",
  SIGNED_OUT: "signed-out",
};

const statusPubsub = createPubSub();
let status = authStore.getUser() ? SyncStatus.SYNCED : SyncStatus.SIGNED_OUT;

function setStatus(next) {
  if (status === next) return;
  status = next;
  statusPubsub.notify();
}

/** @returns {string} one of SyncStatus */
export function getSyncStatus() {
  return status;
}

/** @param {Function} fn @returns {Function} unsubscribe */
export function subscribeStatus(fn) {
  return statusPubsub.subscribe(fn);
}

function mergeByLastModified(localTrials, cloudTrials) {
  const byId = new Map();
  for (const t of localTrials) byId.set(t.id, t);
  for (const t of cloudTrials) {
    const existing = byId.get(t.id);
    if (!existing || new Date(t.lastModified).getTime() > new Date(existing.lastModified).getTime()) {
      byId.set(t.id, t);
    }
  }
  return Array.from(byId.values());
}

// No JWT and no passcode — every request carries just the signed-in
// user's email explicitly (see authStore.js). GET requests get it as a
// query param; PUT/POST requests get it merged into the JSON body.
async function authedFetch(options) {
  const creds = authStore.getCredentials();
  if (!creds) return null;

  const method = (options && options.method) || "GET";
  if (method === "GET") {
    const url = `${ENDPOINT}?email=${encodeURIComponent(creds.email)}`;
    return fetch(url, options);
  }

  let body = {};
  try {
    body = options && options.body ? JSON.parse(options.body) : {};
  } catch (e) {
    body = {};
  }
  return fetch(ENDPOINT, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options && options.headers) },
    body: JSON.stringify({ ...body, email: creds.email }),
  });
}

/**
 * Pulls the signed-in user's cloud trials and merges them into the local
 * library. Safe to call any time (e.g. on sign-in, or manually from a
 * "Refresh" affordance) — a failure just leaves local data untouched.
 * Concurrent calls are deduped into a single in-flight request/merge.
 * @returns {Promise<void>}
 */
export function pullAndMerge() {
  if (!authStore.getUser()) return Promise.resolve();
  if (pullPromise) return pullPromise;
  pullPromise = (async () => {
    setStatus(SyncStatus.SYNCING);
    try {
      const res = await authedFetch({ method: "GET" });
      if (!res || !res.ok) {
        setStatus(SyncStatus.ERROR);
        return;
      }
      const payload = await res.json();
      const cloudTrials = Array.isArray(payload.trials) ? payload.trials : [];
      const merged = mergeByLastModified(libraryStore.getState().trials, cloudTrials);
      applyingRemote = true;
      try {
        libraryStore.replaceAll(merged);
      } finally {
        applyingRemote = false;
      }
      setStatus(SyncStatus.SYNCED);
    } catch (e) {
      console.error("[cloudSync] pull failed (offline or server error) — local data is unaffected", e);
      setStatus(SyncStatus.ERROR);
    } finally {
      initialPullAttempted = true;
      pullPromise = null;
    }
  })();
  return pullPromise;
}

/**
 * Pushes the full local library to the cloud right now (no debounce).
 *
 * Always waits for this session's first pullAndMerge() attempt to settle
 * before sending — see this file's top comment for the real incident
 * that requires this. A push overwrites the user's ENTIRE cloud copy
 * (netlify/functions/plots.js's PUT handler does a full replace, not a
 * merge), so it must never fire from local data that hasn't at least
 * been given the chance to reconcile with the cloud first — otherwise a
 * device that's fallen behind (a teammate's plot was added elsewhere
 * since this device last synced, or this device's local storage was
 * reset) would silently delete that data from the cloud the moment
 * ANYTHING here triggers a push, even something as passive as the demo
 * plot's automatic per-version refresh.
 */
export async function pushNow() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (!authStore.getUser()) return;
  if (!initialPullAttempted) {
    await pullAndMerge();
  }
  setStatus(SyncStatus.SYNCING);
  try {
    // The sample Demo Plot (see demoPlot.js) is deliberately local-only
    // sample data — it must never reach the cloud, show up in All Plots
    // (Admin), or count in an export, even while the user is editing it
    // for practice. libraryStore.upsert() carries the isDemo flag
    // forward across edits specifically so this filter keeps working.
    const trials = libraryStore.getState().trials.filter((t) => !t.isDemo);
    const res = await authedFetch({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trials }),
    });
    if (!res || !res.ok) {
      setStatus(SyncStatus.ERROR);
      return;
    }
    setStatus(SyncStatus.SYNCED);
  } catch (e) {
    console.error("[cloudSync] push failed (offline or server error) — will retry on next change", e);
    setStatus(SyncStatus.ERROR);
  }
}

/** Schedules a debounced push; call after any local library mutation. */
function schedulePush() {
  if (applyingRemote) return;
  if (!authStore.getUser()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
}

libraryStore.subscribe(() => schedulePush());

authStore.subscribe(() => {
  if (authStore.getUser()) {
    pullAndMerge();
  } else {
    setStatus(SyncStatus.SIGNED_OUT);
  }
});
