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
// adminPlots.js's "Upload Hybrid Catalog" button, the only place that
// ever POSTs here).
//
// GET: public, no auth required — this is non-sensitive shared
//   reference data (hybrid names and maturity ratings, not grower data),
//   the same trust level as the statically-served DefaultLists.json.
//   -> {updatedAt: string|null, rows: Array<{company, hybrid, trait, rm}>}
//
// POST body: {email, rows: Array<{company, hybrid, trait, rm}>}
//   Admin-only (requireAdmin(), identical pattern to
//   backfillFormIds.js). REPLACES the entire catalog — this is a full
//   re-upload each time, by design: the admin's source spreadsheet is
//   the single source of truth, and always re-parsing it fresh from
//   scratch means there's never a question of what merged with what
//   from a previous upload. Company-name de-duplication against the
//   app's existing brand list happens client-side before this is ever
//   called (see public/js/core/companyMatch.js) — this function trusts
//   whatever rows it's given and only validates their basic shape.
//   -> {rowCount, companyCount, updatedAt}
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

  const updatedAt = new Date().toISOString();
  await store.setJSON(STATE_KEY, { updatedAt, rows });

  const companyCount = new Set(rows.map((r) => r.company.toLowerCase())).size;
  return json(200, { rowCount: rows.length, companyCount, updatedAt });
};
