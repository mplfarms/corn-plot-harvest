// netlify/functions/formId.js
//
// Reserves a plot's "Form ID" — "APP" followed by a zero-padded 5-digit
// globally-sequential number, starting at "APP00001", shared across
// every user (not scoped per-user, per-year, or per-location —
// deliberately as simple as possible, per explicit request). One shared
// counter means "no repeats between all users" is true by construction:
// everyone pulls from the same number line.
//
// POST body: {email} -> {formId: "APP00001"}
//   - email is recorded purely for later troubleshooting (who pulled
//     which number, and when) — it has no effect on the number itself.
//
// Duplicate safety net: this is a plain read-then-write against Netlify
// Blobs, not a compare-and-swap (see the same tradeoff documented in
// _shared.js's top comment — deliberately simple for a small trusted
// team's usage volume). A genuinely simultaneous pair of requests could
// in theory both read the same counter value and both compute the same
// candidate ID. Rather than risk two different plots silently ending up
// with the identical Form ID, every candidate is checked against a
// registry of IDs already handed out before it's returned; if it's
// already taken, a lowercase letter is appended — "APP00001" ->
// "APP00001a" -> "APP00001b" -> ... — and re-checked, until a free one
// is found. In ordinary (non-racing) use this registry check always
// passes on the first try and no letter ever gets appended; it only
// kicks in as protection against that one edge case above.
//
// See _formIdShared.js for the candidate-formatting/collision-suffix
// logic (shared with backfillFormIds.js, the bulk one-time admin action
// that assigns Form IDs to plots that existed before this feature did —
// both read/write this exact same registry, so the two paths can never
// hand out the same id twice).

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail } = require("./_shared");
const formIdShared = require("./_formIdShared");
const STARTING_ID = formIdShared.STARTING_ID;
const STATE_KEY = formIdShared.STATE_KEY;
const formatFormIdCandidate = formIdShared.formatFormIdCandidate;
const nextFreeFormId = formIdShared.nextFreeFormId;

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
  const state = (await store.get(STATE_KEY, { type: "json" })) || { nextValue: STARTING_ID, issued: {} };
  const issued = state.issued || {};

  const candidateBase = formatFormIdCandidate(state.nextValue || STARTING_ID);
  const formId = nextFreeFormId(candidateBase, issued);

  issued[formId] = { email: email, at: new Date().toISOString() };

  await store.setJSON(STATE_KEY, {
    nextValue: (state.nextValue || STARTING_ID) + 1,
    issued: issued,
  });

  return json(200, { formId: formId });
};
