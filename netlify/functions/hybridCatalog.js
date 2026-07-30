// netlify/functions/hybridCatalog.js
//
// Shared Company / Hybrid / Trait / RM reference catalog — the data
// behind entryEditor.js's cascading pickers (pick a Brand/Company, see
// only that brand's hybrids; pick a Hybrid, get its Relative Maturity
// and available Trait package(s) automatically). Unlike everything else
// this app stores server-side, this catalog is NOT scoped per-user — it
// is one shared reference table every signed-in device reads, same as
// DefaultLists.json's static lists, except this one needs to be
// updatable by an admin at any time without a new app build/deploy (see
// the two upload buttons in Settings' Admin card —
// public/js/ui/components/hybridCatalogUpload.js, the only place that
// ever POSTs here).
//
// GET: public, no auth required — this is non-sensitive shared
//   reference data (hybrid names and maturity ratings, not grower data),
//   the same trust level as the statically-served DefaultLists.json.
//   -> {updatedAt: string|null, rows: Array<{company, hybrid, trait, rm}>}
//
// POST body: {email, rows: Array<{company, hybrid, trait, rm}>, group?}
//   Admin-only (requireAdmin(), identical pattern to
//   backfillFormIds.js).
//   With group ("company" | "alt") — the split-upload mode, per
//   explicit request: replaces ONLY that group's rows (Company Hybrids
//   = Midwest Seed Genetics / NC+ Hybrids / Crow's / SuperCrost; Alt.
//   Variety Hybrids = every other brand) and keeps the other group's
//   stored rows untouched, so the two halves are maintained as two
//   separate source files. Incoming rows that belong to the OTHER
//   group are dropped here too (defense in depth — the client already
//   filters them out with a notice before uploading).
//   group is REQUIRED — the legacy group-less full-replace was removed
//   (per explicit request) so an out-of-date client can never wipe the
//   other half of the catalog; a group-less POST gets a 400 telling the
//   admin to update the app. The response carries the complete merged
//   catalog so the uploading device can reflect it immediately.
//   Company-name de-duplication against the app's existing brand list
//   happens client-side before this is ever called (see
//   public/js/core/companyMatch.js) — this function trusts whatever
//   rows it's given and only validates their basic shape.
//   -> {rowCount, companyCount, totalRowCount, updatedAt, rows}
//
// Row validation is deliberately light (matching this app's overall
// "small trusted team" simplicity — see _shared.js's top comment): each
// row must have a non-empty company/hybrid/trait string and a finite
// numeric rm, or it's dropped rather than failing the whole upload —
// one malformed row in a 1500-row spreadsheet shouldn't block every
// other row from updating.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, requireAdmin } = require("./_shared");

const STATE_KEY = "catalog.json";

// "Company Hybrids" upload-group membership — CommonJS copy of
// isCompanyGroupBrand() in public/js/core/hybridCatalogImport.js; keep
// the two in sync (same normalization, same brand keys).
const COMPANY_GROUP_BRAND_KEYS = new Set([
  "midwestseedgenetics",
  "nchybrids",
  "crows",
  "supercrost",
  "mwnccr", // the MW / NC / CR house alias (normally expanded client-side)
]);

function isCompanyGroupBrand(company) {
  const key = String(company || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return COMPANY_GROUP_BRAND_KEYS.has(key);
}

function sanitizeRows(rawRows) {
  if (!Array.isArray(rawRows)) return [];
  const out = [];
  for (const r of rawRows) {
    if (!r || typeof r !== "object") continue;
    const company = String(r.company || "").trim();
    const hybrid = String(r.hybrid || "").trim();
    const trait = String(r.trait || "").trim();
    const rm = Number(r.rm);
    if (!company || !hybrid || !trait || !Number.isFinite(rm)) continue;
    out.push({ company, hybrid, trait, rm });
  }
  return out;
}

exports.handler = async (event) => {
  connectLambda(event);

  const store = getStore("hybridCatalog");

  if (event.httpMethod === "GET") {
    const state = (await store.get(STATE_KEY, { type: "json" })) || { updatedAt: null, rows: [] };
    return json(200, { updatedAt: state.updatedAt || null, rows: state.rows || [] });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON body." });
  }

  const email = normalizeEmail(payload.email);
  if (!email) return json(400, { error: "Missing email." });

  const usersStore = getStore("users");
  const adminCheck = await requireAdmin(usersStore, email);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const rows = sanitizeRows(payload.rows);
  if (rows.length === 0) {
    return json(400, { error: "No valid rows in upload — expected company, hybrid, trait, and rm on every row." });
  }

  const group = payload.group === "company" || payload.group === "alt" ? payload.group : null;
  if (!group) {
    // The legacy no-group full-replace path is GONE — per explicit
    // request ("we definitely want to proceed with 2 files, purge any
    // legacy... so there is a non issue"): an out-of-date client must
    // never be able to wipe the other half of the catalog with a
    // group-less upload.
    return json(400, {
      error: "This app version is out of date — update to the current version before uploading the Hybrid Catalog.",
    });
  }

  // Split-upload mode: replace only this group's rows; keep the other
  // group's stored rows exactly as they were. Company-group rows are
  // stored first so the house brands stay ahead of the alt list in
  // every first-seen-order picker.
  const wantCompany = group === "company";
  const uploaded = rows.filter((r) => isCompanyGroupBrand(r.company) === wantCompany);
  if (uploaded.length === 0) {
    return json(400, {
      error: `No ${wantCompany ? "Company Hybrids" : "Alt. Variety Hybrids"} rows in this upload.`,
    });
  }
  const existing = (await store.get(STATE_KEY, { type: "json" })) || { rows: [] };
  const keptOther = (existing.rows || []).filter((r) => isCompanyGroupBrand(r.company) !== wantCompany);
  const companyRows = wantCompany ? uploaded : keptOther;
  const altRows = wantCompany ? keptOther : uploaded;
  const allRows = [...companyRows, ...altRows];

  const updatedAt = new Date().toISOString();
  await store.setJSON(STATE_KEY, { updatedAt, rows: allRows });

  const companyCount = new Set(uploaded.map((r) => r.company.toLowerCase())).size;
  return json(200, {
    rowCount: uploaded.length,
    companyCount,
    totalRowCount: allRows.length,
    updatedAt,
    rows: allRows,
  });
};
