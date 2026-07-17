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
//   GET  ?email=&scope=all            -> { users: [{email, name, trials}] } (admin only)
//   PUT  body {email, trials: [...]}  -> overwrites the caller's stored trials

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, userKey, requireAdmin } = require("./_shared");

async function handleGetSelf(plotsStore, email) {
  const trials = (await plotsStore.get(userKey(email), { type: "json" })) || [];
  return json(200, { trials });
}

async function handleGetAll(usersStore, plotsStore, email) {
  const adminCheck = await requireAdmin(usersStore, email);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const { blobs } = await plotsStore.list();
  const users = [];
  for (const b of blobs) {
    const [trials, meta] = await Promise.all([
      plotsStore.get(b.key, { type: "json" }),
      plotsStore.getMetadata(b.key),
    ]);
    users.push({
      email: (meta && meta.metadata && meta.metadata.email) || b.key.replace(/\.json$/, ""),
      name: (meta && meta.metadata && meta.metadata.name) || null,
      trials: trials || [],
    });
  }
  // Alphabetical by name (falling back to email) so the admin view is
  // stable and scannable rather than in arbitrary blob-listing order.
  users.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  return json(200, { users });
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
