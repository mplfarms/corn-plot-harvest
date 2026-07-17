// netlify/functions/auth.js
//
// The entire "sign in" flow for this app: POST {email} — email only, no
// name, no password, no email verification, and no passcode of any kind
// (deliberately simple: this is low-stakes farm data, not anything
// sensitive). There's no separate sign-up step either — a first-time
// email creates a new user record, a returning email just logs the
// existing record back in. See _shared.js's top comment for the security
// tradeoff this implies (in short: knowing someone's email is enough to
// sign in as them).
//
// "name" is optional and defaults to the email address itself when not
// supplied (the current sign-in form doesn't ask for one at all) — it's
// kept as a stored field purely so the admin screens (Manage Users, All
// Plots) have *something* to head each user's card/section with; when a
// caller does pass a name it's stored and shown instead.
//
// The very first account ever created with BOOTSTRAP_ADMIN_EMAIL becomes
// an admin automatically (and self-heals back to admin on every sign-in,
// in case that flag ever got cleared some other way) — every other new
// account starts as a regular (non-admin) user. From then on, admins are
// managed in-app via netlify/functions/adminUsers.js (Settings -> Manage
// Users, admin-only) rather than by editing this file again.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, isValidEmail, userKey } = require("./_shared");

const BOOTSTRAP_ADMIN_EMAIL = "mplfarms@aol.com";

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
  if (!email || !isValidEmail(email)) return json(400, { error: "A valid email is required." });
  const name = String(payload.name || "").trim() || email;

  const store = getStore("users");
  const key = userKey(email);
  let record = await store.get(key, { type: "json" });

  if (!record) {
    record = {
      name,
      email,
      isAdmin: email === BOOTSTRAP_ADMIN_EMAIL,
      createdAt: new Date().toISOString(),
    };
  } else {
    record.name = name;
    if (email === BOOTSTRAP_ADMIN_EMAIL) record.isAdmin = true;
  }

  await store.setJSON(key, record);
  return json(200, { user: record });
};
