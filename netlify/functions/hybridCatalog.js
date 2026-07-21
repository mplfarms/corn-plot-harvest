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
//   Admin-only
