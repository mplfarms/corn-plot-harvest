// netlify/functions/adminUsers.js
//
// Admin-only user management: list every registered account, promote or
// demote admin status, and delete an account (which also deletes that
// account's saved cloud plots). Every request must supply the caller's
// own email, and the caller's stored record must have isAdmin === true
// (see _shared.js's requireAdmin()) — there is no other credential
// involved; see _shared.js's top comment for the security tradeoff this
// implies.
//
// Endpoints (all under /.netlify/functions/adminUsers):
//   GET  ?email=                                          -> { users: [{name,email,isAdmin,createdAt}] }
//   POST body {email,action:"setAdmin",targetEmail,isAdmin}  -> { user }
//   POST body {email,action:"delete",targetEmail}            -> { ok: true }

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, userKey, requireAdmin } = require("./_shared");

async function handleList(usersStore, email) {
  const adminCheck = await requireAdmin(usersStore, email);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const { blobs } = await usersStore.list();
  const users = (await Promise.all(blobs.map((b) => usersStore.get(b.key, { type: "json" })))).filter(Boolean);
  users.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  return json(200, { users });
}

async function handleSetAdmin(usersStore, callerEmail, targetEmail, isAdmin) {
  const adminCheck = await requireAdmin(usersStore, callerEmail);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const key = userKey(targetEmail);
  const record = await usersStore.get(key, { type: "json" });
  if (!record) return json(404, { error: "User not found." });
  record.isAdmin = Boolean(isAdmin);
  await usersStore.setJSON(key, record);
  return json(200, { user: record });
}

async function handleDelete(usersStore, plotsStore, callerEmail, targetEmail) {
  const adminCheck = await requireAdmin(usersStore, callerEmail);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const normalizedTarget = normalizeEmail(targetEmail);
  if (!normalizedTarget) return json(400, { error: "Missing targetEmail." });
  // An admin can't delete their own account this way — avoids a team
  // accidentally locking itself out of admin access entirely.
  if (normalizedTarget === normalizeEmail(callerEmail)) {
    return json(400, { error: "You can't delete your own account." });
  }

  await usersStore.delete(userKey(normalizedTarget));
  await plotsStore.delete(userKey(normalizedTarget));
  return json(200, { ok: true });
}

exports.handler = async (event) => {
  // See plots.js's matching comment — classic (event, context) handler
  // signature requires connectLambda(event) before any getStore() call.
  connectLambda(event);

  const usersStore = getStore("users");
  const plotsStore = getStore("plots");

  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    return handleList(usersStore, q.email);
  }

  if (event.httpMethod === "POST") {
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { error: "Invalid JSON body." });
    }

    if (payload.action === "setAdmin") {
      return handleSetAdmin(usersStore, payload.email, payload.targetEmail, payload.isAdmin);
    }
    if (payload.action === "delete") {
      return handleDelete(usersStore, plotsStore, payload.email, payload.targetEmail);
    }
    return json(400, { error: "Unknown action." });
  }

  return json(405, { error: "Method not allowed." });
};
