// Unit-tests netlify/functions/formId.js (the server-side Form ID
// reservation endpoint) and its shared helpers in _formIdShared.js —
// against an in-memory mock of @netlify/blobs, following the exact
// same pattern as unit_auth_functions.mjs (this sandbox has no network
// access to a real Blobs-backed Netlify site).
//
// What actually matters here:
//   1. IDs are "<2-digit year>-" + a zero-padded 4-digit number, e.g.
//      "26-1001" — a PER-YEAR sequence, each starting at "<year>-1001"
//      (see _formIdShared.js's STARTING_ID — "<year>-1000" is reserved
//      separately and never issued from this counter), shared across
//      every user — "no repeats between all users, per year" is true by
//      construction since everyone pulls from the same counter for a
//      given year.
//   2. Which year a reservation draws from is whatever `year` the
//      client sends (computed client-side via models.js's
//      harvestedYear() — see formIdAssign.js) — this endpoint trusts
//      and sanitizes it rather than re-deriving it. A brand new
//      calendar year's counter starts fresh at 1001 regardless of what
//      any other year's counter is currently at (they're fully
//      independent).
//   3. If a candidate ID is somehow already taken (the documented
//      read-then-write race — two requests reading the same counter
//      value before either writes back), a lowercase letter gets
//      appended instead of silently handing out a duplicate.
//   4. A pre-existing OLD-shape registry ({nextValue, issued}, from
//      before per-year counters existed) is transparently migrated —
//      that flat nextValue becomes year "26"'s counter — so upgrading
//      this function can never cause a live collision with "26-" ids
//      already issued under the old single-counter scheme.

import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import formIdShared from "../netlify/functions/_formIdShared.js";

const {
  STARTING_ID,
  formatFormIdCandidate,
  yearSuffix,
  resolveFormYearFromHeader,
  sanitizeYear,
  nextFreeFormId,
  normalizeState,
} = formIdShared;

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

// ==== Section 1: pure-function tests on _formIdShared.js's helpers ====

check(formatFormIdCandidate("26", 1001) === "26-1001", "formatFormIdCandidate pads to 4 digits under a 2-digit year prefix");
check(formatFormIdCandidate("27", 42) === "27-0042", "formatFormIdCandidate zero-pads a small number to 4 digits");
check(yearSuffix(2026) === "26", "yearSuffix takes the last 2 digits of a 4-digit year (2026 -> 26)");
check(yearSuffix(2027) === "27", "yearSuffix(2027) -> 27");
check(yearSuffix(2030) === "30", "yearSuffix(2030) -> 30");

// resolveFormYearFromHeader: Date Harvested wins when both are set.
check(
  resolveFormYearFromHeader({ datePlanted: "2026-05-01", dateHarvested: "2027-01-15" }) === 2027,
  "resolveFormYearFromHeader prefers Date Harvested's year when both dates are set"
);
// Falls back to Date Planted when Date Harvested is blank.
check(
  resolveFormYearFromHeader({ datePlanted: "2027-05-01", dateHarvested: "" }) === 2027,
  "resolveFormYearFromHeader falls back to Date Planted's year when Date Harvested is blank"
);
check(
  resolveFormYearFromHeader({ datePlanted: "2027-05-01", dateHarvested: null }) === 2027,
  "resolveFormYearFromHeader falls back to Date Planted's year when Date Harvested is null"
);
// Falls back to `now` when neither date is set (a brand new plot).
check(
  resolveFormYearFromHeader({ datePlanted: "", dateHarvested: "" }, new Date("2028-03-01T00:00:00Z")) === 2028,
  "resolveFormYearFromHeader falls back to the injected `now`'s year when neither date is set"
);
check(
  resolveFormYearFromHeader({}, new Date("2029-11-01T00:00:00Z")) === 2029,
  "resolveFormYearFromHeader handles a header with neither date field present at all"
);

// sanitizeYear: passes through a valid year; falls back to `now`'s year
// for anything missing/invalid.
check(sanitizeYear(2027) === 2027, "sanitizeYear passes through a valid 4-digit year");
check(sanitizeYear("2027") === 2027, "sanitizeYear coerces a numeric string");
check(
  sanitizeYear(undefined, new Date("2030-06-01T00:00:00Z")) === 2030,
  "sanitizeYear falls back to the injected `now`'s year when the value is missing"
);
check(
  sanitizeYear("garbage", new Date("2030-06-01T00:00:00Z")) === 2030,
  "sanitizeYear falls back to the injected `now`'s year when the value is unparseable"
);
check(
  sanitizeYear(0, new Date("2030-06-01T00:00:00Z")) === 2030,
  "sanitizeYear rejects an out-of-range value (0) and falls back"
);

// normalizeState: brand new registry, already-migrated registry, and
// legacy pre-per-year registry.
check(
  JSON.stringify(normalizeState(null)) === JSON.stringify({ counters: {}, issued: {} }),
  `normalizeState(null) (a brand new registry) starts with empty counters/issued (got ${JSON.stringify(normalizeState(null))})`
);
{
  const already = normalizeState({ counters: { "26": 1050 }, issued: { "26-1001": { email: "x" } } });
  check(
    already.counters["26"] === 1050 && Boolean(already.issued["26-1001"]),
    "normalizeState leaves an already-migrated (per-year) registry untouched"
  );
}
{
  const legacy = normalizeState({ nextValue: 1050, issued: { "26-1001": { email: "x" } } });
  check(
    legacy.counters["26"] === 1050 && !("nextValue" in legacy) && Boolean(legacy.issued["26-1001"]),
    `normalizeState migrates the OLD flat {nextValue, issued} shape into counters["26"] (got ${JSON.stringify(legacy)})`
  );
}

// ==== Section 2: the live endpoint, against a mocked Blobs store ====

function makeStore() {
  const data = new Map();
  return {
    async get(key, opts) {
      const rec = data.get(key);
      if (!rec) return null;
      return opts && opts.type === "json" ? rec.value : JSON.stringify(rec.value);
    },
    async setJSON(key, value) {
      data.set(key, { value });
    },
    _raw: data,
  };
}

const formIdRegistryStore = makeStore();
const stores = { formIdRegistry: formIdRegistryStore };

const MOCK_PATH = path.join(process.cwd(), "test", "_mock_netlify_blobs_formid.cjs");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@netlify/blobs") return MOCK_PATH;
  return originalResolve.call(this, request, ...rest);
};
fs.writeFileSync(
  MOCK_PATH,
  `
  const stores = globalThis.__cph_test_formid_stores__;
  module.exports = {
    connectLambda: () => {},
    getStore: (name) => stores[name],
  };
  `
);
globalThis.__cph_test_formid_stores__ = stores;

const formId = (await import("../netlify/functions/formId.js")).handler;

function post(body) {
  return { httpMethod: "POST", body: JSON.stringify(body) };
}

// ---- validation ----
let res = await formId({ httpMethod: "GET" });
check(res.statusCode === 405, "GET is rejected (405)");

res = await formId(post({}));
check(res.statusCode === 400, "missing email rejected (400)");

// ---- the actual sequencing behavior, all under year 2026 ----
res = await formId(post({ email: "mike@example.com", year: 2026 }));
let body = JSON.parse(res.body);
check(
  res.statusCode === 200 && body.formId === "26-1001",
  `the very first 2026 reservation starts at 26-1001 (got ${JSON.stringify(body)})`
);

res = await formId(post({ email: "someone-else@example.com", year: 2026 }));
body = JSON.parse(res.body);
check(
  body.formId === "26-1002",
  `the NEXT reservation — from a totally different user — simply continues the SAME shared 2026 counter (got ${body.formId})`
);

res = await formId(post({ email: "mike@example.com", year: 2026 }));
body = JSON.parse(res.body);
check(
  body.formId === "26-1003",
  `and the next one after that continues it again, regardless of who's asking (got ${body.formId})`
);

// ---- duplicate-suffix safety net ----
// Force a collision: pretend "26-1004" (the next number the counter is
// about to hand out) was already issued to someone else, simulating the
// documented read-then-write race. The next reservation must NOT return
// "26-1004" again — it should fall through to "26-1004a".
const state = await formIdRegistryStore.get("state.json", { type: "json" });
state.issued["26-1004"] = { email: "raced-request@example.com", at: "2026-01-01T00:00:00.000Z" };
await formIdRegistryStore.setJSON("state.json", state);

res = await formId(post({ email: "mike@example.com", year: 2026 }));
body = JSON.parse(res.body);
check(
  body.formId === "26-1004a",
  `a candidate that's already taken falls through to a lowercase-letter suffix instead of duplicating (got ${body.formId})`
);

// The counter itself still only advanced by one (to 26-1005 next), even
// though the letter-suffixed ID went out — the base number "26-1004"
// isn't reissued to someone else later, it's just retired as "the one
// that needed a suffix".
res = await formId(post({ email: "mike@example.com", year: 2026 }));
body = JSON.parse(res.body);
check(
  body.formId === "26-1005",
  `the counter itself still just advances by one per request, letter suffix or not (got ${body.formId})`
);

// And "26-1004a" itself is now also taken (simulated) — while a fresh
// collision on a brand new base number also falls through to its own
// letter suffix.
const state2 = await formIdRegistryStore.get("state.json", { type: "json" });
state2.issued["26-1006"] = { email: "raced-again@example.com", at: "2026-01-01T00:00:00.000Z" };
await formIdRegistryStore.setJSON("state.json", state2);
res = await formId(post({ email: "mike@example.com", year: 2026 }));
body = JSON.parse(res.body);
check(
  body.formId === "26-1006a",
  `a fresh collision on a different base number also gets its own letter suffix (got ${body.formId})`
);

// ---- every issued ID (base and letter-suffixed alike) is permanently
// recorded, so it can never be handed out again ----
let regState = await formIdRegistryStore.get("state.json", { type: "json" });
check(
  Boolean(
    regState.issued["26-1001"] && regState.issued["26-1002"] && regState.issued["26-1004a"] && regState.issued["26-1006a"]
  ),
  `every issued Form ID (including letter-suffixed ones) is recorded in the registry (got ${JSON.stringify(
    Object.keys(regState.issued)
  )})`
);
check(
  regState.issued["26-1001"].email === "mike@example.com",
  "the registry records which email pulled each Form ID, for troubleshooting"
);

// ---- Section 3: a brand new year is a fully independent counter ----
// 2026's counter is at 1007 by now — a request for 2027 must NOT
// continue that number; it must start its own fresh sequence at 1001.
res = await formId(post({ email: "mike@example.com", year: 2027 }));
body = JSON.parse(res.body);
check(
  body.formId === "27-1001",
  `a brand new year (2027) starts its own fresh counter at 1001, independent of 2026's (got ${body.formId})`
);

res = await formId(post({ email: "mike@example.com", year: 2027 }));
body = JSON.parse(res.body);
check(body.formId === "27-1002", `2027's counter then advances on its own (got ${body.formId})`);

// Meanwhile 2026's counter is completely unaffected by 2027 activity.
res = await formId(post({ email: "mike@example.com", year: 2026 }));
body = JSON.parse(res.body);
check(
  body.formId === "26-1007",
  `2026's counter picks up right where it left off, unaffected by 2027's requests (got ${body.formId})`
);

regState = await formIdRegistryStore.get("state.json", { type: "json" });
check(
  Boolean(regState.counters && regState.counters["26"] === 1008 && regState.counters["27"] === 1003),
  `the registry now tracks both years' counters independently (got ${JSON.stringify(regState.counters)})`
);

// ---- Section 4: missing/invalid `year` in the request falls back to
// today's real year rather than erroring or producing a broken id ----
res = await formId(post({ email: "mike@example.com" }));
body = JSON.parse(res.body);
const thisYearSuffix = yearSuffix(new Date().getFullYear());
check(
  body.formId.startsWith(`${thisYearSuffix}-`),
  `a request with no \`year\` at all falls back to today's real year's prefix (got "${body.formId}", expected to start with "${thisYearSuffix}-")`
);

// ==== Section 5: legacy-registry migration, exercised through the
// live endpoint (not just normalizeState() in isolation) ====
// Overwrites the SAME mocked store's contents directly (rather than
// swapping in a second store instance) — the "@netlify/blobs" mock
// module above captures its `stores` object once, at require() time,
// so formId.js's getStore("formIdRegistry") call is permanently bound
// to `formIdRegistryStore`; a later reassignment of
// globalThis.__cph_test_formid_stores__ would silently have no effect
// on it.
{
  await formIdRegistryStore.setJSON("state.json", {
    nextValue: 1050,
    issued: { "26-1001": { email: "someone@example.com", at: "2026-01-01T00:00:00.000Z" } },
  });

  res = await formId(post({ email: "mike@example.com", year: 2026 }));
  body = JSON.parse(res.body);
  check(
    body.formId === "26-1050",
    `against a pre-existing OLD-shape registry (flat nextValue: 1050), the next 2026 reservation continues from 1050, not restarting at 1001 (got ${body.formId})`
  );

  const migratedState = await formIdRegistryStore.get("state.json", { type: "json" });
  check(
    Boolean(migratedState.counters) && !("nextValue" in migratedState),
    "the registry is rewritten to the new per-year counters shape after the first request against a legacy registry"
  );
}

fs.unlinkSync(MOCK_PATH);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
