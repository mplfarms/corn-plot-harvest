// netlify/functions/formId.js
//
// Reserves a plot's "Form ID" — "<2-digit year>-" followed by a
// zero-padded 4-digit number, e.g. "26-1001", starting at "<year>-1001"
// for EACH calendar year independently (see _formIdShared.js —
// "26-1000" is permanently reserved for the Demo Plot and never issued
// from here). Shared across every user (not scoped per-user or
// per-location — deliberately as simple as possible, per explicit
// request, beyond the per-year prefix itself). One shared counter per
// year means "no repeats between all users" is true by construction:
// everyone pulls from the same number line for that year.
//
// Which year a plot's prefix uses is NOT today's real-world date — it's
// the plot's own Date Harvested (or, if that's not filled in yet, Date
// Planted; or, if neither is, today's date as a last resort) — see
// _formIdShared.js's resolveFormYearFromHeader()/models.js's
// harvestedYear() for the full chain. The client computes this via
// harvestedYear() right before requesting a reservation and sends it as
// `year` below, since it already has the current draft's header in
// hand; this function just trusts and sanitizes that value rather than
// re-deriving it (it has no header to derive it FROM — see
// backfillFormIds.js, which does have one per stored trial and uses
// _formIdShared.js's resolveFormYearFromHeader() directly instead).
//
// POST body: {email, year} -> {formId: "26-1001"}
//   - email is recorded purely for later troubleshooting (who pulled
//     which number, and when) — it has no effect on the number itself.
//   - year is a 4-digit calendar year (e.g. 2027); a missing/invalid
//     value safely falls back to today's real year (sanitizeYear()).
//
// Duplicate safety net: this is a plain read-then-write against Netlify
// Blobs, not a compare-and-swap (see the same tradeoff documented in
// _shared.js's top comment — deliberately simple for a small trusted
// team's usage volume). A genuinely simultaneous pair of requests could
// in theory both read the same counter value and both compute the same
// candidate ID. Rather than risk two different plots silently ending up
// with the identical Form ID, every candidate is checked against a
// registry of IDs already handed out before it's returned; if it's
// already taken, a lowercase letter is appended — "26-1001" ->
// "26-1001a" -> "26-1001b" -> ... — and re-checked, until a free one
// is found. In ordinary (non-racing) use this registry check always
// passes on the first try and no letter ever gets appended; it only
// kicks in as protection against that one edge case above.
//
// See _formIdShared.js for the candidate-formatting/collision-suffix/
// per-year-counter logic (shared with backfillFormIds.js, the bulk
// one-time admin action that assigns Form IDs to plots that existed
// before this feature did — both read/write this exact same registry,
// so the two paths can never hand out the same id twice).

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail } = require("./_shared");
const {
  STARTING_ID,
  STATE_KEY,
  formatFormIdCandidate,
  yearSuffix,
  sanitizeYear,
  nextFreeFormId,
  normalizeState,
} = require("./_formIdShared");

exports.handler = async (event) => {
  connectLambda(event);

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

  const store = getStore("formIdRegistry");
  const state = normalizeState(await store.get(STATE_KEY, { type: "json" }));

  const ySuffix = yearSuffix(sanitizeYear(payload.year));
  const nextValue = state.counters[ySuffix] || STARTING_ID;

  const candidateBase = formatFormIdCandidate(ySuffix, nextValue);
  const formId = nextFreeFormId(candidateBase, state.issued);

  state.issued[formId] = { email, at: new Date().toISOString() };
  state.counters[ySuffix] = nextValue + 1;

  await store.setJSON(STATE_KEY, state);

  return json(200, { formId });
};
