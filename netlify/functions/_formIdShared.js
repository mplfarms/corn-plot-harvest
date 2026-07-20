// netlify/functions/_formIdShared.js
//
// Shared Form ID reservation logic between formId.js (one-at-a-time, live
// reservation the moment someone taps "Save Plot" in the app) and
// backfillFormIds.js (a bulk, one-time admin action that assigns a Form
// ID to every EXISTING plot that doesn't already have one). Both read
// and write the exact same "formIdRegistry" Blobs store (state.json —
// {nextValue, issued}) using this exact same candidate-formatting and
// collision-suffix logic, so an ID handed out by either path can never
// collide with one handed out by the other.

// Kept in one place so formId.js and backfillFormIds.js can never drift
// out of sync on where the counter starts or what key it's stored under.
const STARTING_ID = 1;
const STATE_KEY = "state.json";

/**
 * @param {number} n
 * @returns {string} e.g. "APP00001"
 */
function formatFormIdCandidate(n) {
  return `APP${String(n).padStart(5, "0")}`;
}

/**
 * Given the registry's current `issued` map, finds the next AVAILABLE id
 * starting at candidateBase, appending "a".."z" on collision (see
 * formId.js's top comment for why this exists — a plain read-then-write
 * race, not something expected to trigger often). Deliberately does NOT
 * mutate `issued` itself — the caller records the chosen id into `issued`
 * right after calling this, before computing the next candidate, since a
 * bulk backfill call reserves many ids against the same in-memory map
 * before ever writing back to the store.
 * @param {string} candidateBase
 * @param {Object<string, any>} issued
 * @returns {string}
 */
function nextFreeFormId(candidateBase, issued) {
  if (!issued[candidateBase]) return candidateBase;
  for (let i = 0; i < 26; i++) {
    const suffix = String.fromCharCode(97 + i); // "a".."z"
    const candidate = `${candidateBase}${suffix}`;
    if (!issued[candidate]) return candidate;
  }
  // Exhausted a-z (should never realistically happen) — fall back to a
  // timestamp suffix so this still can't silently collide.
  return `${candidateBase}-${Date.now()}`;
}

module.exports = { STARTING_ID, STATE_KEY, formatFormIdCandidate, nextFreeFormId };
