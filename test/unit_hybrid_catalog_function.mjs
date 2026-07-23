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
//   3. POST replaces the ENTIRE catalog (not a merge) — a second
//      upload with fewer rows actually shrinks the stored catalog.
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

// ---- POST: a real upload, admin caller ----
const rowsV1 = [
  { company: "AgriGold", hybrid: "A616-30", trait: "VT Double PRO", rm: 86 },
  { company: "AgriGold", hybrid: "A620-99", trait: "SmartStax", rm: 90 },
  { company: "AgriGold", hybrid: "A620-99", trait: "VT Double PRO", rm: 90 },
  { company: "Wyffels", hybrid: "W1234", trait: "SS", rm: 95 },
];
{
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: rowsV1 }));
  const body = JSON.parse(res.body);
  check(res.statusCode === 200, `admin upload succeeds (got ${res.statusCode})`);
  check(body.rowCount === 4, `rowCount matches the uploaded row count (got ${body.rowCount})`);
  check(body.companyCount === 2, `companyCount counts distinct companies (got ${body.companyCount})`);
  check(typeof body.updatedAt === "string" && body.updatedAt.length > 0, "updatedAt is stamped on upload");
}

// ---- GET reflects the upload ----
{
  const res = await hybridCatalog({ httpMethod: "GET" });
  const body = JSON.parse(res.body);
  check(body.rows.length === 4, `GET after upload reflects all 4 rows (got ${body.rows.length})`);
}

// ---- POST: malformed rows are dropped, not fatal ----
{
  const mixedRows = [
    { company: "Stine", hybrid: "9014", trait: "Conventional", rm: 90 },
    { company: "", hybrid: "missing company", trait: "X", rm: 90 }, // dropped: blank company
    { company: "Stine", hybrid: "9020", trait: "X", rm: "not a number" }, // dropped: non-numeric rm
    { company: "Stine", hybrid: "9030", trait: "Y", rm: 100 },
  ];
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: mixedRows }));
  const body = JSON.parse(res.body);
  check(res.statusCode === 200, `an upload with SOME malformed rows still succeeds (got ${res.statusCode})`);
  check(body.rowCount === 2, `only the 2 valid rows are kept, malformed ones silently dropped (got ${body.rowCount})`);
}

// ---- POST: an upload with ZERO valid rows is rejected outright (doesn't wipe the catalog) ----
{
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: [{ company: "", hybrid: "", trait: "", rm: "x" }] }));
  check(res.statusCode === 400, `an upload with zero valid rows is rejected (400), not silently wiping the catalog (got ${res.statusCode})`);

  const getRes = await hybridCatalog({ httpMethod: "GET" });
  const getBody = JSON.parse(getRes.body);
  check(getBody.rows.length === 2, `the previous valid catalog (2 rows) is untouched after a rejected upload (got ${getBody.rows.length})`);
}

// ---- POST: a second FULL upload REPLACES the catalog, not merges it ----
{
  const rowsV2 = [{ company: "Pioneer", hybrid: "P1234", trait: "Qrome", rm: 100 }];
  const res = await hybridCatalog(post({ email: "admin@example.com", rows: rowsV2 }));
  const body = JSON.parse(res.body);
  check(body.rowCount === 1, `a full re-upload replaces rather than merges — only the new row remains (got ${body.rowCount})`);

  const getRes = await hybridCatalog({ httpMethod: "GET" });
  const getBody = JSON.parse(getRes.body);
  check(
    getBody.rows.length === 1 && getBody.rows[0].company === "Pioneer",
    `GET after the replace shows only the new catalog (got ${JSON.stringify(getBody.rows)})`
  );
}

fs.unlinkSync(MOCK_PATH);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
