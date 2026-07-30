// Unit-tests netlify/functions/hybridCatalog.js against an in-memory
// mock of @netlify/blobs, following the exact same pattern as
// unit_backfill_form_ids.mjs / unit_form_id_function.mjs (this sandbox
// has no network access to a real Blobs-backed Netlify site).
//
// What actually matters here:
//   1. GET is public (no email/admin check) and returns whatever's
//      currently stored, or an empty catalog if nothing's been
//      uploaded yet.
//   2. POST is admin-gated exactly like backfillFormIds.js.
//   3. POST requires a group ("company" | "alt") — the legacy
//      group-less full-replace was PURGED per explicit request, so an
//      out-of-date client can never wipe the other half; each group
//      upload replaces ONLY its own half and keeps the other.
//   4. Malformed rows (missing a field, non-numeric rm) are dropped
//      rather than failing the whole upload; an upload left with zero
//      valid rows is rejected outright (400) rather than wiping the
//      catalog to empty by accident.
//   5. companyCount in the response counts DISTINCT companies
//      case-insensitively.

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
    _raw: data,
  };
}

const usersStore = makeStore();
const hybridCatalogStore = makeStore();
const stores = { users: usersStore, hybridCatalog: hybridCatalogStore };

const MOCK_PATH = path.join(process.cwd(), "test", "_mock_netlify_blobs_hybridcatalog.cjs");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@netlify/blobs") return MOCK_PATH;
  return originalResolve.call(this, request, ...rest);
};
fs.writeFileSync(
  MOCK_PATH,
  `
  const stores = globalThis.__cph_test_hybridcatalog_stores__;
  module.exports = {
    connectLambda: () => {},
    getStore: (name) => stores[name],
  };
  `
);
globalThis.__cph_test_hybridcatalog_stores__ = stores;

const hybridCatalog = (await import("../netlify/functions/hybridCatalog.js")).handler;

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

await usersStore.setJSON(userKey("admin@example.com"), { email: "admin@example.com", name: "Admin User", isAdmin: true });
await usersStore.setJSON(userKey("alice@example.com"), { email: "alice@example.com", name: "Alice Farmer", isAdmin: false });

// ---- GET before any upload: empty catalog, no auth needed ----
{
  const res = await hybridCatalog({ httpMethod: "GET" });
  const body = JSON.parse(res.body);
  check(res.statusCode === 200, `GET with no prior upload succeeds (got ${res.statusCode})`);
  check(Array.isArray(body.rows) && body.rows.length === 0, `an empty catalog before any upload returns rows: [] (got ${JSON.stringify(body.rows)})`);
  check(body.updatedAt === null, "updatedAt is null before any upload");
}

// ---- POST validation ----
{
  let res = await hybridCatalog(post({}));
  check(res.statusCode === 400, "missing email is rejected (400)");

  res = await hybridCatalog(post({ email: "alice@example.com", rows: [{ company: "A", hybrid: "B", trait: "C", rm: 90 }] }));
  check(res.statusCode === 403, "a non-admin caller is rejected (403)");
}

// ---- POST: the legacy group-less upload is REJECTED (purged path) ----
{
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: [{ company: "AgriGold", hybrid: "A616-30", trait: "VT Double PRO", rm: 86 }] }));
  const body = JSON.parse(res.body);
  check(res.statusCode === 400, `a group-less (legacy full-replace) upload is rejected (got ${res.statusCode})`);
  check(/out of date/.test(body.error || ""), `...with an update-your-app message (got "${body.error}")`);
  const getRes = await hybridCatalog({ httpMethod: "GET" });
  check(JSON.parse(getRes.body).rows.length === 0, "a rejected legacy upload touches nothing");
}

// ---- POST: an Alt. Variety upload fills the alt half ----
const altRows = [
  { company: "AgriGold", hybrid: "A616-30", trait: "VT Double PRO", rm: 86 },
  { company: "AgriGold", hybrid: "A620-99", trait: "SmartStax", rm: 90 },
  { company: "AgriGold", hybrid: "A620-99", trait: "VT Double PRO", rm: 90 },
  { company: "Wyffels", hybrid: "W1234", trait: "SS", rm: 95 },
];
{
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: altRows, group: "alt" }));
  const body = JSON.parse(res.body);
  check(res.statusCode === 200, `admin alt upload succeeds (got ${res.statusCode})`);
  check(body.rowCount === 4, `rowCount matches the uploaded row count (got ${body.rowCount})`);
  check(body.companyCount === 2, `companyCount counts distinct companies (got ${body.companyCount})`);
  check(body.totalRowCount === 4, `totalRowCount covers the whole stored catalog (got ${body.totalRowCount})`);
  check(Array.isArray(body.rows) && body.rows.length === 4, "the response carries the full merged catalog");
  check(typeof body.updatedAt === "string" && body.updatedAt.length > 0, "updatedAt is stamped on upload");
}

// ---- POST: a Company upload replaces ONLY the company half; a
//      mixed-in alt row is dropped server-side (defense in depth) ----
const companyRows = [
  { company: "Midwest Seed Genetics", hybrid: "83-31 VT2PRIB", trait: "VT2P RIB", rm: 83 },
  { company: "SuperCrost", hybrid: "10T84 VT2PRIB", trait: "VT2P RIB", rm: 84 },
  { company: "Pioneer", hybrid: "P1234", trait: "Qrome", rm: 100 }, // wrong side — must be dropped
];
{
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: companyRows, group: "company" }));
  const body = JSON.parse(res.body);
  check(res.statusCode === 200, `company upload succeeds (got ${res.statusCode})`);
  check(body.rowCount === 2, `the mixed-in Pioneer row is dropped server-side (got rowCount ${body.rowCount})`);
  check(body.totalRowCount === 6, `2 company + 4 alt = 6 stored rows (got ${body.totalRowCount})`);
  const getRes = await hybridCatalog({ httpMethod: "GET" });
  const stored = JSON.parse(getRes.body).rows;
  check(stored.length === 6, `GET reflects both halves (got ${stored.length})`);
  check(stored[0].company === "Midwest Seed Genetics", `company-group rows are stored FIRST (got "${stored[0].company}")`);
  check(stored.some((r) => r.company === "AgriGold"), "the alt half survived the company upload untouched");
  check(!stored.some((r) => r.company === "Pioneer"), "the wrong-side Pioneer row is nowhere in the stored catalog");
}

// ---- POST: malformed rows are dropped, not fatal ----
{
  const mixedRows = [
    { company: "Stine", hybrid: "9014", trait: "Conventional", rm: 90 },
    { company: "", hybrid: "missing company", trait: "X", rm: 90 }, // dropped: blank company
    { company: "Stine", hybrid: "9020", trait: "X", rm: "not a number" }, // dropped: non-numeric rm
    { company: "Stine", hybrid: "9030", trait: "Y", rm: 100 },
  ];
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: mixedRows, group: "alt" }));
  const body = JSON.parse(res.body);
  check(res.statusCode === 200, `an upload with SOME malformed rows still succeeds (got ${res.statusCode})`);
  check(body.rowCount === 2, `only the 2 valid rows are kept, malformed ones silently dropped (got ${body.rowCount})`);
  check(body.totalRowCount === 4, `the alt half was REPLACED (2 rows) and the company half kept (2) (got ${body.totalRowCount})`);
}

// ---- POST: an upload with ZERO valid rows is rejected outright ----
{
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: [{ company: "", hybrid: "", trait: "", rm: "x" }], group: "alt" }));
  check(res.statusCode === 400, `an upload with zero valid rows is rejected (400), not silently wiping the catalog (got ${res.statusCode})`);
  const getRes = await hybridCatalog({ httpMethod: "GET" });
  check(JSON.parse(getRes.body).rows.length === 4, `the stored catalog is untouched after a rejected upload (got ${JSON.parse(getRes.body).rows.length})`);
}

// ---- POST: an all-wrong-group upload is rejected, nothing wiped ----
{
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: [{ company: "Dekalb", hybrid: "DKC60-88", trait: "SmartStax", rm: 110 }], group: "company" }));
  const body = JSON.parse(res.body);
  check(res.statusCode === 400, `an upload whose rows ALL belong to the other group is rejected (got ${res.statusCode})`);
  check(/No Company Hybrids rows/.test(body.error || ""), `...with a which-side message (got "${body.error}")`);
  const getRes = await hybridCatalog({ httpMethod: "GET" });
  check(JSON.parse(getRes.body).rows.length === 4, "nothing was wiped by the rejected wrong-side upload");
}

fs.unlinkSync(MOCK_PATH);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
