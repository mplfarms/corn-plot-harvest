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

async function authedFetch(options) {
  const token = await authStore.freshToken();
  if (!token) return null;
  return fetch(ENDPOINT, {
    ...options,
    headers: { ...(options && options.headers), Authorization: `Bearer ${token}` },
  });
}

/**
 * Pulls the signed-in user's cloud trials and merges them into the local
 * library. Safe to call any time (e.g. on sign-in, or manually from a
 * "Refresh" affordance) — a failure just leaves local data untouched.
 * @returns {Promise<void>}
 */
export async function pullAndMerge() {
  if (!authStore.getUser()) return;
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
  }
}

/** Pushes the full local library to the cloud right now (no debounce). */
export async function pushNow() {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  if (!authStore.getUser()) return;
  setStatus(SyncStatus.SYNCING);
  try {
    const res = await authedFetch({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trials: libraryStore.getState().trials }),
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
