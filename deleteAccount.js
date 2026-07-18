// netlify/functions/deleteAccount.js
//
// Self-service "Delete My Account" (Settings screen — see settings.js).
// Any signed-in user can delete their OWN account here; unlike
// adminUsers.js's admin-triggered delete/merge, this never checks
// isAdmin — the whole point is a regular user doing this to themselves,
// with no admin having to act on their behalf. (The client still shows a
// two-step "type DELETE to confirm" dialog first — see
// doubleConfirm.js — but that's a UI safeguard against fat-fingering,
// not a security check; this endpoint executes immediately once called,
// per explicit request that self-delete not require admin approval.)
//
// The account's saved plots are never just thrown away: every one of
// them is merged onto BOOTSTRAP_ADMIN_EMAIL's account (see _shared.js —
// the one account guaranteed to always exist and stay admin), tagged
// with a `transferredFrom: {email, name}` field so the receiving admin's
// Saved Plots screen can show which teammate's account a plot used to
// belong to (see savedPlots.js's badge). Merge/dedupe logic mirrors
// adminUsers.js's handleMerge() exactly, including preserving an
// already-existing transferredFrom tag rather than overwriting it, in
// case a plot was transferred more than once across its lifetime.
//
// POST body {email} -> { ok: true, transferredCount, transferredToEmail, transferredToName }
//
// BOOTSTRAP_ADMIN_EMAIL itself can't use this endpoint on itself — there
// would be nowhere for its plots to go, and it's the one account this
// app guarantees always stays an admin (see auth.js).

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, userKey, BOOTSTRAP_ADMIN_EMAIL } = require("./_shared");

async function handleSelfDelete(usersStore, plotsStore, callerEmailRaw) {
  const callerEmail = normalizeEmail(callerEmailRaw);
  if (!callerEmail) return json(400, { error: "Missing email." });

  const callerUser = await usersStore.get(userKey(callerEmail), { type: "json" });
  if (!callerUser) return json(404, { error: "Account not found." });

  if (callerEmail === BOOTSTRAP_ADMIN_EMAIL) {
    return json(400, {
      error: "This account can't delete itself — it's the account every deleted account's plots transfer to.",
    });
  }

  const targetEmail = BOOTSTRAP_ADMIN_EMAIL;
  const targetUser = await usersStore.get(userKey(targetEmail), { type: "json" });
  if (!targetUser) {
    // Should never happen once anyone has ever signed in as the bootstrap
    // admin, but fail loudly rather than silently discarding plots.
    return json(500, { error: "Couldn't find the account to transfer your plots to. Please try again later." });
  }

  const [callerTrials, targetTrials] = await Promise.all([
    plotsStore.get(userKey(callerEmail), { type: "json" }),
    plotsStore.get(userKey(targetEmail), { type: "json" }),
  ]);

  const tagged = (callerTrials || []).map((t) => ({
    ...t,
    transferredFrom: t.transferredFrom || { email: callerEmail, name: callerUser.name || callerEmail },
  }));

  // Concat, then dedupe by trial id (target's existing copy wins on a
  // collision) — identical approach to adminUsers.js's handleMerge().
  const merged = [];
  const seenIds = new Set();
  for (const t of [...(targetTrials || []), ...tagged]) {
    if (seenIds.has(t.id)) continue;
    seenIds.add(t.id);
    merged.push(t);
  }

  await plotsStore.setJSON(userKey(targetEmail), merged, {
    metadata: { email: targetEmail, name: targetUser.name || "" },
  });
  await usersStore.delete(userKey(callerEmail));
  await plotsStore.delete(userKey(callerEmail));

  return json(200, {
    ok: true,
    transferredCount: tagged.length,
    transferredToEmail: targetEmail,
    transferredToName: targetUser.name || targetEmail,
  });
}

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

  const usersStore = getStore("users");
  const plotsStore = getStore("plots");
  return handleSelfDelete(usersStore, plotsStore, payload.email);
};
