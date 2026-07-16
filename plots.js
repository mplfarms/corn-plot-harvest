// netlify/functions/plots.js
//
// Cloud sync endpoint for saved plots. One function, one Netlify Blobs
// store ("plots"), one JSON blob per user (key "user-<sub>.json") holding
// that user's full SavedTrial[] array — the same shape libraryStore.js
// keeps in localStorage. The client always sends/receives the *whole*
// array; for a small farm operation's plot count this is simpler and far
// less failure-prone than incremental per-trial endpoints, at a
// negligible bandwidth cost.
//
// Auth: every request must be signed in (Netlify Identity). Netlify
// decodes the caller's JWT (sent as `Authorization: Bearer <token>` by
// the client — see src/ui/authStore.js) and, for functions using this
// classic (event, context) handler signature, exposes it as
// context.clientContext.user. No token verification code needed here —
// that's Netlify's job before our handler even runs.
//
// Endpoints (all under /.netlify/functions/plots):
//   GET  ?scope=self (default) -> { trials: SavedTrial[] }  (caller's own)
//   GET  ?scope=all            -> { users: [{userId, email, trials}] }
//                                  (admin role required)
//   PUT  body {trials: [...]}  -> overwrites the caller's stored trials
//
// NOTE: this file was written against Netlify's documented Blobs/Identity
// APIs but has not been exercised against a live Netlify deployment from
// this environment (no Netlify project is reachable from here to test
// against) — verify the three endpoints manually after your first deploy
// (see the "Cloud sync setup" section in README.md for a checklist).

const { getStore, connectLambda } = require("@netlify/blobs");

function userKey(sub) {
  return `user-${sub}.json`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function handleGetSelf(store, user) {
  const trials = (await store.get(userKey(user.sub), { type: "json" })) || [];
  return json(200, { trials });
}

async function handleGetAll(store, user) {
  const roles = (user.app_metadata && user.app_metadata.roles) || [];
  if (!roles.includes("admin")) {
    return json(403, { error: "Admin role required." });
  }
  const { blobs } = await store.list({ prefix: "user-" });
  const users = [];
  for (const b of blobs) {
    const [trials, meta] = await Promise.all([
      store.get(b.key, { type: "json" }),
      store.getMetadata(b.key),
    ]);
    users.push({
      userId: b.key.replace(/^user-/, "").replace(/\.json$/, ""),
      email: (meta && meta.metadata && meta.metadata.email) || null,
      trials: trials || [],
    });
  }
  return json(200, { users });
}

async function handlePut(store, user, event) {
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON body." });
  }
  const trials = Array.isArray(payload.trials) ? payload.trials : [];
  await store.setJSON(userKey(user.sub), trials, { metadata: { email: user.email || "" } });
  return json(200, { ok: true, count: trials.length });
}

exports.handler = async (event, context) => {
  // This handler uses the classic (event, context) "Lambda compatibility"
  // signature (needed to read Identity's context.clientContext.user
  // below), and in that mode Netlify Blobs' environment is NOT wired up
  // automatically the way it is for the modern (req, context) function
  // signature — getStore() throws MissingBlobsEnvironmentError if called
  // without this first, which crashes the function and surfaces to the
  // client as a bare "502 Bad Gateway" with no further detail (exactly
  // what this endpoint was doing before this fix). connectLambda(event)
  // must run before any getStore()/getDeployStore() call.
  connectLambda(event);

  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return json(401, { error: "Sign in required." });
  }

  const store = getStore("plots");

  if (event.httpMethod === "GET") {
    const scope = (event.queryStringParameters && event.queryStringParameters.scope) || "self";
    if (scope === "all") return handleGetAll(store, user);
    return handleGetSelf(store, user);
  }

  if (event.httpMethod === "PUT") {
    return handlePut(store, user, event);
  }

  return json(405, { error: "Method not allowed." });
};
