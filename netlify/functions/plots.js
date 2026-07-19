// netlify/functions/plots.js
//
// Cloud sync endpoint for saved plots. One JSON blob per user (key
// "<email>.json" in the "plots" Blobs store) holding that user's full
// SavedTrial[] array — the same shape libraryStore.js keeps in
// localStorage. The client always sends/receives the *whole* array; for
// a small farm operation's plot count this is simpler and far less
// failure-prone than incremental per-trial endpoints, at a negligible
// bandwidth cost.
//
// Auth: every request carries just `email` (query string for GET, JSON
// body for PUT) — no password, no passcode, nothing else. Each user only
// ever sees their own trials via the default scope=self. `scope=all`
// additionally requires the caller's own stored user record to have
// isAdmin === true (checked server-side via requireAdmin(), never
// trusted from the client alone) — see _shared.js's top comment for the
// security tradeoff this implies.
//
// Endpoints (all under /.netlify/functions/plots):
//   GET  ?email=&scope=self (default) -> { trials: SavedTrial[] } (caller's own)
//   GET  ?email=&scope=all            -> { users: [{email, name, firstName, lastName,
//                                          mobileNumber, isAdmin, trials}] } (admin only) —
//        one entry per REGISTERED account (from the "users" store), not just
//        accounts that have synced a plot, so a brand-new user still gets
//        their own card (with 0 trials) on the All Plots (Admin) screen —
//        see adminPlots.js. Sorted admin(s)-first, then alphabetically by
//        last name (sortUsersAdminFirst() in _shared.js).
//   PUT  body {email, trials: [...]}  -> overwrites `email`'s stored trials
//   PUT  body {email, trials: [...], adminEmail}
//        -> same, but on behalf of a DIFFERENT user (email !== adminEmail):
//           requires adminEmail's own stored record to have isAdmin ===
//           true (requireAdmin(), server-checked, never trusted from the
//           client alone — same pattern as scope=all above). Used by the
//           admin "All Plots" edit flow (see adminEditStore.js) so an
//           admin can fix up a teammate's plot without ever touching
//           their own local library. Omitting adminEmail (or setting it
//           equal to email) is a normal self-save and gets no admin
//           check — matches every other user's own saves, unchanged.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, userKey, requireAdmin, sortUsersAdminFirst } = require("./_shared");

async function handleGetSelf(plotsStore, email) {
  const trials = (await plotsStore.get(userKey(email), { type: "json" })) || [];
  return json(200, { trials });
}

async function handleGetAll(usersStore, plotsStore, email) {
  const adminCheck = await requireAdmin(usersStore, email);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  // Enumerated from the "users" store (every REGISTERED account) rather
  // than the "plots" store (only accounts that have ever synced at least
  // one trial) — a user who's signed in but hasn't saved a plot of their
  // own yet still gets their own card here, with 0 entries, instead of
  // silently not appearing at all. Each user's trials are then looked up
  // from the "plots" store by their own email (defaulting to an empty
  // array when they have no blob there yet).
  const { blobs } = await usersStore.list();
  const users = (
    await Promise.all(
      blobs.map(async (b) => {
        const record = await usersStore.get(b.key, { type: "json" });
        if (!record) return null;
        const trials = (await plotsStore.get(userKey(record.email), { type: "json" })) || [];
        return {
          email: record.email,
          name: record.name || record.email,
          firstName: record.firstName || "",
          lastName: record.lastName || "",
          mobileNumber: record.mobileNumber || "",
          isAdmin: Boolean(record.isAdmin),
          trials,
        };
      })
    )
  ).filter(Boolean);

  return json(200, { users: sortUsersAdminFirst(users) });
}

async function handlePut(usersStore, plotsStore, event) {
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON body." });
  }

  const email = normalizeEmail(payload.email);
  if (!email) return json(400, { error: "Missing email." });

  const adminEmail = payload.adminEmail ? normalizeEmail(payload.adminEmail) : null;
  if (adminEmail && adminEmail !== email) {
    const adminCheck = await requireAdmin(usersStore, adminEmail);
    if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });
  }

  const trials = Array.isArray(payload.trials) ? payload.trials : [];
  const userRecord = await usersStore.get(userKey(email), { type: "json" });
  await plotsStore.setJSON(userKey(email), trials, {
    metadata: { email, name: (userRecord && userRecord.name) || "" },
  });
  return json(200, { ok: true, count: trials.length });
}

exports.handler = async (event) => {
  // This handler uses the classic (event, context) "Lambda compatibility"
  // signature, and in that mode Netlify Blobs' environment is NOT wired
  // up automatically the way it is for the modern (req, context) function
  // signature — getStore() throws MissingBlobsEnvironmentError if called
  // without this first, which crashes the function and surfaces to the
  // client as a bare "502 Bad Gateway" with no further detail. This must
  // run before any getStore()/getDeployStore() call.
  connectLambda(event);

  const usersStore = getStore("users");
  const plotsStore = getStore("plots");

  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    const email = normalizeEmail(q.email);
    if (!email) return json(400, { error: "Missing email." });

    const scope = q.scope || "self";
    if (scope === "all") return handleGetAll(usersStore, plotsStore, email);
    return handleGetSelf(plotsStore, email);
  }

  if (event.httpMethod === "PUT") {
    return handlePut(usersStore, plotsStore, event);
  }

  return json(405, { error: "Method not allowed." });
};
