// netlify/functions/hybridCatalog.js
//
// Shared Company / Hybrid / Trait / RM reference catalog -- the data
// behind entryEditor.js's cascading pickers (pick a Brand/Company, see
// only that brand's hybrids; pick a Hybrid, get its Relative Maturity
// and available Trait package(s) automatically). Unlike everything else
// this app stores server-side, this catalog is NOT scoped per-user -- it
// is one shared reference table every signed-in device reads, same as
// DefaultLists.json's static lists, except this one needs to be
// updatable by an admin at any time without a new app build/deploy (see
// adminPlots.js's "Upload Hybrid Catalog" button, the only place that
// ever POSTs here).
//
// GET: public, no auth required.
//   -> {updatedAt: string|null, rows: Array<{company, hybrid, trait, rm}>}
//
// POST body: {email, rows: Array<{company, hybrid, trait, rm}>}
//   Admin-only (requireAdmin(), identical pattern to backfillFormIds.js).
//   REPLACES the entire catalog each time.
//   -> {rowCount, companyCount, updatedAt}

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
    out.push({ company: company, hybrid: hybrid, trait: trait, rm: rm });
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
    return json(400, { error: "No valid rows in upload -- expected company, hybrid, trait, and rm on every row." });
  }

  const updatedAt = new Date().toISOString();
  await store.setJSON(STATE_KEY, { updatedAt: updatedAt, rows: rows });

  const companyCount = new Set(rows.map((r) => r.company.toLowerCase())).size;
  return json(200, { rowCount: rows.length, companyCount: companyCount, updatedAt: updatedAt });
};
