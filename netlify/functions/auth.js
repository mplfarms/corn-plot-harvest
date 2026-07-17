// netlify/functions/auth.js
//
// The entire "sign in" flow for this app: POST {name, email, passcode}.
// There's no separate sign-up step and no password — a first-time email
// creates a new user record, a returning email just updates its name (in
// case they typed it differently) and logs the existing record back in.
// See _shared.js's top comment for the security tradeoff this implies.
//
// The very first account ever created with BOOTSTRAP_ADMIN_EMAIL becomes
// an admin automatically (and self-heals back to admin on every sign-in,
// in case that flag ever got cleared some other way) — every other new
// account starts as a regular (non-admin) user. From then on, admins are
// managed in-app via netlify/functions/adminUsers.js (Settings -> Manage
// Users, admin-only) rather than by editing this file again.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, isValidEmail, userKey, checkPasscode } = require("./_shared");

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

  const passcodeCheck = checkPasscode(payload.passcode);
  if (!passcodeCheck.ok) return json(passcodeCheck.statusCode, { error: passcodeCheck.error });

  const name = String(payload.name || "").trim();
  const email = normalizeEmail(payload.email);
  if (!name) return json(400, { error: "Name is required." });
  if (!email || !isValidEmail(email)) return json(400, { error: "A valid email is required." });

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
