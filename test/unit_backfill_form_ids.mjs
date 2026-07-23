// Unit-tests netlify/functions/backfillFormIds.js — the bulk, one-time
// admin action that assigns a Form ID to every existing plot (across
// every user) that doesn't already have one — against an in-memory mock
// of @netlify/blobs, following the exact same pattern as
// unit_form_id_function.mjs (this sandbox has no network access to a
// real Blobs-backed Netlify site).
//
// What actually matters here:
//   1. Non-admin / unauthenticated callers are rejected, same as every
//      other admin-only endpoint (requireAdmin()).
//   2. A trial that already has a formId is left completely untouched —
//      only trials missing one get backfilled.
//   3. Backfilled IDs continue the SAME shared per-year counter/registry
//      formId.js's live, one-at-a-time reservations use (see
//      _formIdShared.js) — never restarting a year's counter and never
//      colliding with IDs already issued live.
//   4. Each trial's OWN Date Harvested/Date Planted decides which
//      year's counter it draws from (resolveFormYearFromHeader()) — a
//      2027-dated trial gets backfilled under "27-", completely
//      independent of the "26-" counter, even in the same run as
//      2026-dated trials.
//   5. Re-running the backfill (idempotency) assigns nothing new once
//      every plot already has an ID.
//   6. The same duplicate-suffix safety net formId.js has also applies
//      here, for a candidate that's somehow already taken.
//   7. A user record with zero saved trials is skipped without error
//      (and doesn't get an unnecessary write).

import Module from "node:module";
import path from "node:path";
import fs from "node:fs";

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
    async list() {
      return { blobs: Array.from(data.keys()).map((key) => ({ key })) };
    },
    _raw: data,
  };
}

const usersStore = makeStore();
const plotsStore = makeStore();
const formIdRegistryStore = makeStore();
const stores = { users: usersStore, plots: plotsStore, formIdRegistry: formIdRegistryStore };

const MOCK_PATH = path.join(process.cwd(), "test", "_mock_netlify_blobs_backfill.cjs");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@netlify/blobs") return MOCK_PATH;
  return originalResolve.call(this, request, ...rest);
};
fs.writeFileSync(
  MOCK_PATH,
  `
  const stores = globalThis.__cph_test_backfill_stores__;
  module.exports = {
    connectLambda: () => {},
    getStore: (name) => stores[name],
  };
  `
);
globalThis.__cph_test_backfill_stores__ = stores;

const backfillFormIds = (await import("../netlify/functions/backfillFormIds.js")).handler;

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

function post(body) {
  return { httpMethod: "POST", body: JSON.stringify(body) };
}

function userKey(email) {
  return `${email}.json`;
}

// Dated 2026 by default (both Date Planted and Date Harvested) so every
// trial resolves to the "26-" counter unless a test explicitly
// overrides the dates — deterministic regardless of the real
// wall-clock date this test happens to run on.
function blankHeader(overrides) {
  return {
    cooperatorName: "Test Coop",
    state: "IA",
    county: "Polk",
    formId: "",
    datePlanted: "2026-04-15",
    dateHarvested: "2026-10-01",
    ...overrides,
  };
}

// ---- seed data ----
await usersStore.setJSON(userKey("admin@example.com"), { email: "admin@example.com", name: "Admin User", isAdmin: true });
await usersStore.setJSON(userKey("alice@example.com"), { email: "alice@example.com", name: "Alice Farmer", isAdmin: false });
await usersStore.setJSON(userKey("bob@example.com"), { email: "bob@example.com", name: "Bob Grower", isAdmin: false });
await usersStore.setJSON(userKey("carol@example.com"), { email: "carol@example.com", name: "Carol NoPlots", isAdmin: false });

await plotsStore.setJSON(userKey("alice@example.com"), [
  { id: "alice-t1", header: blankHeader({ cooperatorName: "Alice's Farm 1", formId: "26-1010" }), entries: [] },
  { id: "alice-t2", header: blankHeader({ cooperatorName: "Alice's Farm 2" }), entries: [] },
]);
await plotsStore.setJSON(userKey("bob@example.com"), [
  { id: "bob-t1", header: blankHeader({ cooperatorName: "Bob's Farm" }), entries: [] },
]);
// carol@example.com deliberately has NO "plots" blob at all (never saved a plot).

// Registry already has 4 ids issued live, before this backfill ever runs
// — simulates a system that's already been in use. The "26" counter
// starts at 1005 here (not the real STARTING_ID of 1001 — see
// _formIdShared.js) specifically to simulate "this system has already
// issued a few IDs live before the first backfill ever ran". Already in
// the current per-year `counters` shape (not the legacy flat
// `nextValue` shape — that migration path is covered separately in
// unit_form_id_function.mjs).
await formIdRegistryStore.setJSON("state.json", {
  counters: { "26": 1005 },
  issued: {
    "26-1001": { email: "someone@example.com", at: "2026-01-01T00:00:00.000Z" },
    "26-1002": { email: "someone@example.com", at: "2026-01-01T00:00:00.000Z" },
    "26-1003": { email: "someone@example.com", at: "2026-01-01T00:00:00.000Z" },
    "26-1010": { email: "alice@example.com", at: "2026-01-01T00:00:00.000Z" },
  },
});

// ---- validation ----
let res = await backfillFormIds({ httpMethod: "GET" });
check(res.statusCode === 405, "GET is rejected (405)");

res = await backfillFormIds(post({}));
check(res.statusCode === 400, "missing email rejected (400)");

res = await backfillFormIds(post({ email: "alice@example.com" }));
check(res.statusCode === 403, "a non-admin caller is rejected (403)");

// ---- run 1: the actual backfill ----
res = await backfillFormIds(post({ email: "admin@example.com" }));
let body = JSON.parse(res.body);
check(res.statusCode === 200, `admin caller succeeds (got status ${res.statusCode})`);
check(body.totalTrialCount === 3, `totalTrialCount counts every trial across every user with at least one saved plot (got ${body.totalTrialCount})`);
check(body.assignedCount === 2, `assignedCount only counts trials that were actually MISSING a formId (got ${body.assignedCount})`);
check(body.updatedUserCount === 2, `updatedUserCount only counts users who had at least one trial backfilled (got ${body.updatedUserCount})`);

const aliceTrials = await plotsStore.get(userKey("alice@example.com"), { type: "json" });
check(aliceTrials[0].header.formId === "26-1010", "a trial that already had a formId is left completely untouched");
check(aliceTrials[1].header.formId === "26-1005", `the backfilled trial continues the SAME shared 2026 counter, not a restart (got "${aliceTrials[1].header.formId}")`);

const bobTrials = await plotsStore.get(userKey("bob@example.com"), { type: "json" });
check(bobTrials[0].header.formId === "26-1006", `the next backfilled trial (a different user) continues the same counter again (got "${bobTrials[0].header.formId}")`);

let registryState = await formIdRegistryStore.get("state.json", { type: "json" });
check(registryState.counters["26"] === 1007, `the "26" counter itself advanced by exactly 2 (one per backfilled trial), to 1007 (got ${registryState.counters["26"]})`);
check(
  Boolean(registryState.issued["26-1005"] && registryState.issued["26-1006"]),
  "both newly-backfilled ids are recorded in the registry, alongside everything issued before this run"
);
check(Boolean(registryState.issued["26-1010"]), "the pre-existing registry entries (including alice's already-assigned id) survive the run untouched");

// ---- run 2: idempotency — nothing left to backfill ----
res = await backfillFormIds(post({ email: "admin@example.com" }));
body = JSON.parse(res.body);
check(body.assignedCount === 0, `re-running the backfill with nothing missing assigns 0 new ids (got ${body.assignedCount})`);
check(body.updatedUserCount === 0, `and touches 0 users' stored trials (got ${body.updatedUserCount})`);
registryState = await formIdRegistryStore.get("state.json", { type: "json" });
check(registryState.counters["26"] === 1007, `the "26" counter does not advance at all on a no-op run (still 1007, got ${registryState.counters["26"]})`);

// ---- run 3: a brand new user appears, AND a forced collision on the next candidate ----
await usersStore.setJSON(userKey("dave@example.com"), { email: "dave@example.com", name: "Dave Newcomer", isAdmin: false });
await plotsStore.setJSON(userKey("dave@example.com"), [
  { id: "dave-t1", header: blankHeader({ cooperatorName: "Dave's Farm" }), entries: [] },
]);
// Simulate "26-1007" (the next candidate) having been issued live,
// concurrently, moments before this backfill run reads the registry.
registryState = await formIdRegistryStore.get("state.json", { type: "json" });
registryState.issued["26-1007"] = { email: "raced-request@example.com", at: "2026-01-01T00:00:00.000Z" };
await formIdRegistryStore.setJSON("state.json", registryState);

res = await backfillFormIds(post({ email: "admin@example.com" }));
body = JSON.parse(res.body);
check(body.assignedCount === 1, `a newly-added user with a missing formId gets backfilled on a later run too (got ${body.assignedCount})`);

const daveTrials = await plotsStore.get(userKey("dave@example.com"), { type: "json" });
check(
  daveTrials[0].header.formId === "26-1007a",
  `a candidate that's already taken (simulated race) falls through to the same lowercase-letter suffix safety net as formId.js (got "${daveTrials[0].header.formId}")`
);

// ---- run 4: a trial dated for a DIFFERENT year backfills under that
// year's own, fully independent counter ----
await usersStore.setJSON(userKey("erin@example.com"), { email: "erin@example.com", name: "Erin NextSeason", isAdmin: false });
await plotsStore.setJSON(userKey("erin@example.com"), [
  // Planted for the 2027 season, not yet harvested (dateHarvested blank)
  // — resolveFormYearFromHeader() falls back to Date Planted's year.
  { id: "erin-t1", header: blankHeader({ cooperatorName: "Erin's Farm", datePlanted: "2027-05-01", dateHarvested: "" }), entries: [] },
]);

res = await backfillFormIds(post({ email: "admin@example.com" }));
body = JSON.parse(res.body);
check(body.assignedCount === 1, `Erin's 2027-dated trial gets backfilled too (got ${body.assignedCount})`);

const erinTrials = await plotsStore.get(userKey("erin@example.com"), { type: "json" });
check(
  erinTrials[0].header.formId === "27-1001",
  `a trial planted in 2027 (harvest date blank) backfills under a brand new, independent "27-" counter starting at 1001, regardless of what "26-"'s counter is at (got "${erinTrials[0].header.formId}")`
);

registryState = await formIdRegistryStore.get("state.json", { type: "json" });
check(
  registryState.counters["26"] === 1008 && registryState.counters["27"] === 1002,
  `both years' counters now coexist independently in the same registry (got ${JSON.stringify(registryState.counters)})`
);

// carol@example.com (zero saved trials) never got a "plots" blob written for her.
const carolTrials = await plotsStore.get(userKey("carol@example.com"), { type: "json" });
check(carolTrials === null, "a registered user with zero saved trials is skipped entirely — no blob is created for them");

fs.unlinkSync(MOCK_PATH);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
