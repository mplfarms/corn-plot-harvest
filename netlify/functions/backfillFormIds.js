// netlify/functions/backfillFormIds.js
//
// One-time (safely repeatable) admin action: walks every REGISTERED
// user's saved plots and assigns a Form ID (see core/formId.js's top
// comment) to any trial that doesn't already have one. Existing plots
// saved before the Form ID feature existed never got one on their own —
// assignment only ever happens live, going forward, the moment someone
// taps "Save Plot" (see ui/formIdAssign.js) — this is the one-time
// catch-up for everything that predates that. Triggered from the "All
// Plots (Admin)" screen's "Assign Form IDs to All Plots" button (see
// adminPlots.js) — admin-only, same as every other bulk/cross-user
// action in this app.
//
// Reserves every backfilled ID from the exact same "formIdRegistry"
// counter/registry formId.js uses (see _formIdShared.js) — advancing the
// SAME shared per-year counters and recording into the SAME `issued`
// map — so a plot backfilled here can never collide with an ID someone
// is live-saving elsewhere at the same moment, and each year's counter
// picks up exactly where this run leaves it for every future live
// reservation. Each trial's OWN dates decide which year's counter it
// draws from (Date Harvested, else Date Planted, else today — see
// _formIdShared.js's resolveFormYearFromHeader()), same rule formId.js
// applies live, just computed directly from the stored header here
// instead of trusted from a client request.
//
// POST body: {email} (the calling admin's own email, for the
// requireAdmin() check — identical pattern to plots.js's scope=all and
// every other admin-only endpoint in this app)
//   -> {assignedCount, updatedUserCount, totalTrialCount}
//
// Safe to run more than once: every trial that already has a formId is
// left completely untouched, so re-running this later (e.g. to catch a
// plot that was somehow missed, or just as a periodic sanity sweep) only
// ever backfills whatever's still actually missing — it never reassigns
// or duplicates an id a plot already has.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, userKey, requireAdmin } = require("./_shared");
const {
  STARTING_ID,
  STATE_KEY,
  formatFormIdCandidate,
  yearSuffix,
  resolveFormYearFromHeader,
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

  const usersStore = getStore("users");
  const plotsStore = getStore("plots");
  const registryStore = getStore("formIdRegistry");

  const adminCheck = await requireAdmin(usersStore, email);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const state = normalizeState(await registryStore.get(STATE_KEY, { type: "json" }));

  // Enumerated from the "users" store (every REGISTERED account), same
  // as plots.js's handleGetAll — a user who's never saved a plot simply
  // contributes zero trials and is skipped below without error.
  const { blobs } = await usersStore.list();

  let assignedCount = 0;
  let updatedUserCount = 0;
  let totalTrialCount = 0;

  for (const b of blobs) {
    const record = await usersStore.get(b.key, { type: "json" });
    if (!record || !record.email) continue;
    const userEmail = normalizeEmail(record.email);

    const trials = (await plotsStore.get(userKey(userEmail), { type: "json" })) || [];
    if (trials.length === 0) continue;

    let changedForThisUser = false;
    for (const trial of trials) {
      totalTrialCount++;
      if (!trial || !trial.header) continue;
      if (trial.header.formId) continue; // already assigned — leave it alone

      const ySuffix = yearSuffix(resolveFormYearFromHeader(trial.header));
      const nextValue = state.counters[ySuffix] || STARTING_ID;

      const candidateBase = formatFormIdCandidate(ySuffix, nextValue);
      const formId = nextFreeFormId(candidateBase, state.issued);
      state.issued[formId] = { email: userEmail, at: new Date().toISOString(), backfilled: true };
      state.counters[ySuffix] = nextValue + 1;

      trial.header.formId = formId;
      changedForThisUser = true;
      assignedCount++;
    }

    if (changedForThisUser) {
      await plotsStore.setJSON(userKey(userEmail), trials, {
        metadata: { email: userEmail, name: record.name || "" },
      });
      updatedUserCount++;
    }
  }

  // Written once at the end, after every user's trials have been walked
  // — every reservation made during this run shares one in-memory
  // `state`, so this single write is what actually commits all of them
  // together (across however many different years' counters got
  // touched along the way).
  await registryStore.setJSON(STATE_KEY, state);

  return json(200, { assignedCount, updatedUserCount, totalTrialCount });
};
