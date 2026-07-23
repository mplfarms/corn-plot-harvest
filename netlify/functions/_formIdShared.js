// netlify/functions/_formIdShared.js
//
// Shared Form ID reservation logic between formId.js (one-at-a-time, live
// reservation the moment someone taps "Save Plot" in the app) and
// backfillFormIds.js (a bulk, one-time admin action that assigns a Form
// ID to every EXISTING plot that doesn't already have one). Both read
// and write the exact same "formIdRegistry" Blobs store (state.json)
// using this exact same candidate-formatting and collision-suffix
// logic, so an ID handed out by either path can never collide with one
// handed out by the other.

// Kept in one place so formId.js and backfillFormIds.js can never drift
// out of sync on where each year's counter starts or what key the
// registry is stored under.
//
// Format (per explicit request): "<2-digit year>-" followed by a
// zero-padded 4-digit number, e.g. "26-1001", "27-1001". The year
// prefix is whichever calendar year the PLOT itself belongs to — the
// plot's Date Harvested if set, else its Date Planted if set, else
// (for a brand new plot with neither filled in yet) today's date — see
// resolveFormYearFromHeader() below, and models.js's harvestedYear()/
// filenameYear() for the client-side twin of that same chain (formId.js
// trusts a `year` the client already computed that way rather than
// redoing it server-side; backfillFormIds.js has no live client
// request to ask, so it uses resolveFormYearFromHeader() directly
// against each stored trial's own header). This means a plot planted in
// 2027 gets a "27-" Form ID the moment it's saved, even if today's
// real-world date is still technically 2026 — and the reverse: a plot
// saved in early 2027 for last year's late-2026 harvest data entry
// still gets "26-" if its dates say so.
//
// Every calendar year gets its OWN independent counter, each starting
// at 1001, never at 1 — "<year>-1000" is permanently reserved (per
// year) for the app's built-in Demo Plot's fixed id ("26-1000" — see
// demoPlot.js) even though, as of this writing, the Demo Plot itself
// only ever actually uses the "26-" one. Reserving every year's "-1000"
// keeps the scheme uniform and leaves room to give the Demo Plot a
// different year's reserved id later without any counter conflict.
const STARTING_ID = 1001;
const STATE_KEY = "state.json";

/**
 * @param {string} yearSuffixStr 2-digit year string, e.g. "26"
 * @param {number} n
 * @returns {string} e.g. "26-1001"
 */
function formatFormIdCandidate(yearSuffixStr, n) {
  return `${yearSuffixStr}-${String(n).padStart(4, "0")}`;
}

/**
 * @param {number} fullYear e.g. 2027
 * @returns {string} the 2-digit year prefix, e.g. "27"
 */
function yearSuffix(fullYear) {
  return String(fullYear).slice(-2).padStart(2, "0");
}

/**
 * Server-side mirror of models.js's harvestedYear()/filenameYear() chain
 * (Date Harvested's year -> Date Planted's year -> today's year) — used
 * ONLY by backfillFormIds.js, which walks existing stored trials
 * directly and has no live client request to just ask for an
 * already-computed year. formId.js instead trusts the `year` value the
 * client sends (computed via that exact same chain, client-side, right
 * before it's about to save) rather than redoing this here — see its
 * own comment. Keep this in sync with models.js if that chain ever
 * changes.
 * @param {{datePlanted?: string, dateHarvested?: string}} header
 * @param {Date} [now] injectable for deterministic tests; defaults to
 *   the real current date.
 * @returns {number} a 4-digit calendar year, e.g. 2027
 */
function resolveFormYearFromHeader(header, now) {
  const dh = header && header.dateHarvested;
  if (typeof dh === "string" && /^\d{4}/.test(dh)) return parseInt(dh.slice(0, 4), 10);
  const dp = header && header.datePlanted;
  if (typeof dp === "string" && /^\d{4}/.test(dp)) return parseInt(dp.slice(0, 4), 10);
  return (now || new Date()).getFullYear();
}

/**
 * Defense in depth for formId.js's live path: the client is expected to
 * always send a valid 4-digit `year` (computed via models.js's
 * harvestedYear()), but a missing/malformed value here falls back to
 * today's real year rather than producing a broken "NaN-1001"-style id.
 * @param {any} year
 * @param {Date} [now] injectable for deterministic tests
 * @returns {number}
 */
function sanitizeYear(year, now) {
  const n = Number(year);
  return Number.isFinite(n) && n > 1000 ? Math.trunc(n) : (now || new Date()).getFullYear();
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

/**
 * Reads the registry's raw stored state and normalizes it to the
 * current per-year-counter shape: {counters: {"26": nextValue, "27":
 * nextValue, ...}, issued: {...}}.
 *
 * Also migrates the OLD, pre-per-year shape ({nextValue, issued}) —
 * which is what's actually sitting in the live production Blobs store
 * as of this change, from every "26-" id issued before per-year
 * counters existed — by moving that single flat `nextValue` into
 * `counters["26"]`. Without this migration, upgrading this function
 * would otherwise silently restart the "26" counter from 1001 and
 * re-issue ids that were already handed out live, which `issued`
 * itself (carried over untouched either way) would only catch via the
 * letter-suffix collision path rather than staying purely sequential.
 * @param {any} rawState whatever store.get(STATE_KEY) returned (may be
 *   null/undefined for a brand new registry)
 * @returns {{counters: Object<string, number>, issued: Object<string, any>}}
 */
function normalizeState(rawState) {
  const state = rawState || {};
  const issued = { ...(state.issued || {}) };
  if (state.counters) {
    return { counters: { ...state.counters }, issued };
  }
  if (typeof state.nextValue === "number") {
    // Genuine legacy shape from before per-year counters existed.
    return { counters: { "26": state.nextValue }, issued };
  }
  // Brand new / never-used registry — nothing to migrate. Each year's
  // counter (including "26") gets lazily seeded at STARTING_ID the
  // first time formId.js/backfillFormIds.js actually look it up (via
  // `state.counters[ySuffix] || STARTING_ID`), so there's no need to
  // pre-seed anything here.
  return { counters: {}, issued };
}

module.exports = {
  STARTING_ID,
  STATE_KEY,
  formatFormIdCandidate,
  yearSuffix,
  resolveFormYearFromHeader,
  sanitizeYear,
  nextFreeFormId,
  normalizeState,
};
