// netlify/functions/adminUsers.js
//
// Admin-only user management: list every registered account, promote or
// demote admin status, delete an account (which also deletes that
// account's saved cloud plots), and merge two accounts into one — for
// the common real-world case here of the same person ending up with two
// separate accounts because they signed in with a different email on a
// different device (this app's identity IS the email typed in at
// sign-in — see authStore.js's top comment — there's no way to link two
// emails as "the same person" other than an admin merging them after the
// fact). Every request must supply the caller's own email, and the
// caller's stored record must have isAdmin === true (see _shared.js's
// requireAdmin()) — there is no other credential involved; see
// _shared.js's top comment for the security tradeoff this implies.
//
// Endpoints (all under /.netlify/functions/adminUsers):
//   GET  ?email=                                             -> { users: [{name,email,isAdmin,createdAt}] }
//   POST body {email,action:"setAdmin",targetEmail,isAdmin}     -> { user }
//   POST body {email,action:"delete",targetEmail}               -> { ok: true }
//   POST body {email,action:"merge",sourceEmail,targetEmail}    -> { ok: true, mergedTrialCount }
//     Moves every one of sourceEmail's saved plots onto targetEmail's
//     account (trials concatenated, deduped by id in case the same plot
//     ever synced under both, each tagged with transferredFrom so
//     targetEmail's Saved Plots screen can show where it came from — see
//     savedPlots.js), then deletes sourceEmail's account entirely — same
//     "account + its plots" deletion handleDelete already does, just
//     preceded by not losing the plots. targetEmail keeps its own
//     isAdmin status unchanged either way. See deleteAccount.js for the
//     self-service equivalent of this same merge, triggered by a regular
//     user deleting their own account rather than an admin here.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, userKey, requireAdmin, sortUsersAdminFirst } = require("./_shared");

async function handleList(usersStore, email) {
  const adminCheck = await requireAdmin(usersStore, email);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const { blobs } = await usersStore.list();
  const users = (await Promise.all(blobs.map((b) => usersStore.get(b.key, { type: "json" })))).filter(Boolean);
  // Admin(s) first, then alphabetically by last name — same ordering rule
  // as the All Plots (Admin) screen (see plots.js's handleGetAll), so a
  // team's roster reads the same way on both admin screens.
  return json(200, { users: sortUsersAdminFirst(users) });
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

async function handleMerge(usersStore, plotsStore, callerEmail, sourceEmailRaw, targetEmailRaw) {
  const adminCheck = await requireAdmin(usersStore, callerEmail);
  if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });

  const sourceEmail = normalizeEmail(sourceEmailRaw);
  const targetEmail = normalizeEmail(targetEmailRaw);
  if (!sourceEmail || !targetEmail) return json(400, { error: "Missing sourceEmail or targetEmail." });
  if (sourceEmail === targetEmail) return json(400, { error: "Can't merge an account into itself." });

  const [sourceUser, targetUser] = await Promise.all([
    usersStore.get(userKey(sourceEmail), { type: "json" }),
    usersStore.get(userKey(targetEmail), { type: "json" }),
  ]);
  if (!sourceUser) return json(404, { error: "Source account not found." });
  if (!targetUser) return json(404, { error: "Target account not found." });

  const [sourceTrials, targetTrials] = await Promise.all([
    plotsStore.get(userKey(sourceEmail), { type: "json" }),
    plotsStore.get(userKey(targetEmail), { type: "json" }),
  ]);

  // Tag each moved trial with who it used to belong to (see
  // savedPlots.js's "Transferred" badge) — preserving an already-existing
  // tag rather than overwriting it, in case a trial was transferred more
  // than once across its lifetime (e.g. merged here, then later moved
  // again via deleteAccount.js's self-delete flow).
  const taggedSourceTrials = (sourceTrials || []).map((t) => ({
    ...t,
    transferredFrom: t.transferredFrom || { email: sourceEmail, name: sourceUser.name || sourceEmail },
  }));

  // Concat, then dedupe by trial id (target's copy wins on a collision —
  // arbitrary but consistent; a same-id collision across two originally
  // separate accounts should never happen in practice, ids are
  // client-generated UUIDs, but this keeps a merge idempotent/safe to
  // retry rather than ever duplicating a trial).
  const merged = [];
  const seenIds = new Set();
  for (const t of [...(targetTrials || []), ...taggedSourceTrials]) {
    if (seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    merged.push(t);
  }

  await plotsStore.setJSON(userKey(targetEmail), merged, {
    metadata: { email: targetEmail, name: targetUser.name || "" },
  });
  await usersStore.delete(userKey(sourceEmail));
  await plotsStore.delete(userKey(sourceEmail));

  return json(200, { ok: true, mergedTrialCount: merged.length });
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
    if (payload.action === "merge") {
      return handleMerge(usersStore, plotsStore, payload.email, payload.sourceEmail, payload.targetEmail);
    }
    return json(400, { error: "Unknown action." });
  }

  return json(405, { error: "Method not allowed." });
};
