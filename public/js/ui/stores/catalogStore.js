// src/ui/stores/catalogStore.js
//
// Client-side cache of the shared Hybrid Catalog (see
// netlify/functions/hybridCatalog.js) — the Company/Hybrid/Trait/RM
// reference data behind entryEditor.js's cascading pickers. Mirrors
// listsStore.js's own fetch-once-and-cache pattern (see its top
// comment), with one addition: since this data can be updated by an
// admin at any time (not just shipped with a new app build), every
// signed-in device re-fetches it once per app load and refreshes its
// local cache — but ALWAYS falls back to whatever was last cached in
// localStorage on any fetch failure, so a plot being entered out in a
// field with no signal still gets full cascading Hybrid/Trait/RM
// support from the last time the device had a connection (see
// geoData.js's top comment for this app's overall offline-first
// philosophy — this store follows the same rule).
//
// Deliberately silent on fetch failure (console.error only, like
// listsStore.js's own ensureLoaded()) — this is reference data, not a
// user action, so there's nothing actionable for a toast to tell
// someone standing in a field; the cascading pickers just fall back to
// manual entry (this app's existing behavior for any brand/hybrid with
// no catalog match at all).

import { createPubSub, readJson, writeJson } from "./pubsub.js";

const CACHE_KEY = "cph.hybridCatalog";
const ENDPOINT = "/.netlify/functions/hybridCatalog";

const pubsub = createPubSub();

function loadCached() {
  const cached = readJson(CACHE_KEY, null);
  if (!cached || !Array.isArray(cached.rows)) return { updatedAt: null, rows: [] };
  return { updatedAt: cached.updatedAt || null, rows: cached.rows };
}

let state = {
  ready: false,
  ...loadCached(),
};

let loadPromise = null;

export function getState() {
  return state;
}

export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/**
 * Fetches the catalog once (module-level singleton promise, like
 * listsStore.js's ensureLoaded()). Safe to call multiple times from
 * multiple screens.
 * @returns {Promise<void>}
 */
export function ensureLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = fetch(ENDPOINT)
    .then((r) => {
      if (!r.ok) throw new Error(`server returned ${r.status}`);
      return r.json();
    })
    .then((payload) => {
      setCatalog(payload.rows || [], payload.updatedAt || null);
    })
    .catch((e) => {
      // Expected/routine when offline — the local cache (if any) already
      // seeded `state` above, so callers still get whatever was cached
      // last time. Not surfaced to the user; see top comment.
      console.error("[catalogStore] failed to load hybrid catalog", e);
      state = { ...state, ready: true };
      pubsub.notify();
    });
  return loadPromise;
}

/**
 * Forces a fresh fetch on the next call to ensureLoaded() (e.g. after
 * an admin upload elsewhere in this same session already called
 * setCatalog() directly — this is only needed if something wants to
 * re-confirm against the server rather than trust the just-uploaded
 * data, which setCatalog() already reflects immediately).
 */
export function reset() {
  loadPromise = null;
}

/**
 * Replaces the in-memory + cached catalog immediately — called after a
 * successful admin upload (see adminPlots.js) so the picker options
 * update in this session without waiting on a re-fetch, and by
 * ensureLoaded() itself once a fetch succeeds.
 * @param {Array<{company:string, hybrid:string, trait:string, rm:number}>} rows
 * @param {string|null} updatedAt
 */
export function setCatalog(rows, updatedAt) {
  state = { ready: true, updatedAt: updatedAt || null, rows: Array.isArray(rows) ? rows : [] };
  writeJson(CACHE_KEY, { updatedAt: state.updatedAt, rows: state.rows });
  pubsub.notify();
}

function rowsForHybrid(company, hybrid) {
  const c = String(company || "").trim().toLowerCase();
  const h = String(hybrid || "").trim().toLowerCase();
  if (!c || !h) return [];
  return state.rows.filter((r) => r.company.toLowerCase() === c && r.hybrid.toLowerCase() === h);
}

/**
 * @returns {string[]} distinct company names present in the catalog, in
 *   first-seen (upload) order.
 */
export function companies() {
  const seen = [];
  for (const r of state.rows) {
    if (!seen.some((v) => v.toLowerCase() === r.company.toLowerCase())) seen.push(r.company);
  }
  return seen;
}

/**
 * Shared "RM first" display ordering for hybrid-name lists — per
 * explicit request: primary sort is RM ascending; hybrids sharing the
 * same base code (the part before the first space — e.g. "18-88 TRERIB"
 * and "18-88 VT2PRIB" are two trait versions of the same 18-88 base)
 * stay TOGETHER, ordered among themselves alphabetically by trait name;
 * names with no known RM sink to the end in their original order. Used
 * by hybridsForCompany()/allHybrids() below and by listsStore.js's
 * hybridItems()/items(HYBRID) so every hybrid list in the app (pickers
 * and the exported form's dropdown sheet alike) shares one ordering.
 *
 * @param {string[]} names distinct hybrid names
 * @param {(name: string) => {rm: number|null, trait: string}} keyFor
 *   resolves a name's RM (null when unknown) and its alphabetically
 *   FIRST trait name ("" when unknown)
 * @returns {string[]} a new sorted array
 */
export function sortHybridNamesForDisplay(names, keyFor) {
  return names
    .map((name, i) => {
      const { rm, trait } = keyFor(name);
      return {
        name,
        i,
        rm: rm === null || rm === undefined || Number.isNaN(rm) ? Infinity : rm,
        base: String(name).trim().split(/\s+/)[0].toLowerCase(),
        trait: String(trait || ""),
      };
    })
    .sort((a, b) => {
      if (a.rm !== b.rm) return a.rm - b.rm;
      if (a.base !== b.base) return a.base < b.base ? -1 : 1;
      const t = a.trait.localeCompare(b.trait);
      if (t !== 0) return t;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return a.i - b.i; // stable fallback (also the unknown-RM tail's order)
    })
    .map((e) => e.name);
}

/**
 * Any-company lookup for one hybrid name — the flat all-hybrids list
 * (the exported form's dropdown sheet) has no company context, so its
 * sort keys come from the name's first matching rows regardless of
 * company.
 * @param {string} name
 * @returns {{rm: number|null, trait: string}}
 */
export function hybridNameSortInfo(name) {
  const n = String(name || "").trim().toLowerCase();
  const rows = state.rows.filter((r) => r.hybrid.toLowerCase() === n);
  if (rows.length === 0) return { rm: null, trait: "" };
  const traits = rows.map((r) => r.trait).sort((a, b) => a.localeCompare(b));
  return { rm: rows[0].rm, trait: traits[0] };
}

/**
 * @returns {boolean} true when any catalog data at all is present
 *   (fetched or cached). The pickers use this as the switch between
 *   "the uploaded catalog is the source of truth" and "fall back to the
 *   built-in default lists" — per explicit request, the original
 *   built-in company/hybrid/trait lists (from the source xlsx this app
 *   was originally built around) are disregarded entirely once an
 *   uploaded catalog exists (see listsStore.js's items()).
 */
export function hasData() {
  return state.rows.length > 0;
}

/**
 * @returns {string[]} distinct trait package names across the whole
 *   catalog, in first-seen (upload) order.
 */
export function traits() {
  const seen = [];
  for (const r of state.rows) {
    if (!seen.some((v) => v.toLowerCase() === r.trait.toLowerCase())) seen.push(r.trait);
  }
  return seen;
}

/**
 * @returns {string[]} distinct hybrid names across the whole catalog
 *   (all companies), in first-seen (upload) order.
 */
export function allHybrids() {
  const seen = [];
  for (const r of state.rows) {
    if (!seen.some((v) => v.toLowerCase() === r.hybrid.toLowerCase())) seen.push(r.hybrid);
  }
  // Same RM-first display order as every other hybrid list.
  return sortHybridNamesForDisplay(seen, hybridNameSortInfo);
}

/**
 * @param {string} company
 * @returns {string[]} distinct hybrid names for that company, in
 *   first-seen (upload) order.
 */
export function hybridsForCompany(company) {
  const c = String(company || "").trim().toLowerCase();
  if (!c) return [];
  const seen = [];
  for (const r of state.rows) {
    if (r.company.toLowerCase() !== c) continue;
    if (!seen.some((v) => v.toLowerCase() === r.hybrid.toLowerCase())) seen.push(r.hybrid);
  }
  // RM-first display order (see sortHybridNamesForDisplay above) — per
  // explicit request, replacing plain upload order.
  return sortHybridNamesForDisplay(seen, (name) => {
    const rows = rowsForHybrid(company, name);
    const traits = rows.map((r) => r.trait).sort((a, b) => a.localeCompare(b));
    return { rm: rows.length ? rows[0].rm : null, trait: traits[0] || "" };
  });
}

/**
 * @param {string} company
 * @param {string} hybrid
 * @returns {string[]} that hybrid's distinct available Trait package(s)
 *   — usually one, sometimes several (see companyMatch.js's sibling
 *   top comment / the original request: "some hybrids have multiple
 *   traits").
 */
export function traitsForHybrid(company, hybrid) {
  const seen = [];
  for (const r of rowsForHybrid(company, hybrid)) {
    if (!seen.includes(r.trait)) seen.push(r.trait);
  }
  return seen;
}

/**
 * @param {string} company
 * @param {string} hybrid
 * @returns {number|null} the hybrid's Relative Maturity, or null if
 *   it's not in the catalog. RM is a property of the hybrid's genetics,
 *   not its trait package, so this is the same value across every trait
 *   row for the same (company, hybrid) pair — the first match is used.
 */
export function rmForHybrid(company, hybrid) {
  const rows = rowsForHybrid(company, hybrid);
  return rows.length ? rows[0].rm : null;
}
