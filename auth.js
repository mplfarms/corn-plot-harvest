// netlify/functions/auth.js
//
// The entire "sign in" flow for this app: POST {email} — email only, no
// password, no email verification, and no passcode of any kind
// (deliberately simple: this is low-stakes farm data, not anything
// sensitive). There's no separate sign-up step either — a first-time
// email creates a new user record, a returning email just logs the
// existing record back in. See _shared.js's top comment for the security
// tradeoff this implies (in short: knowing someone's email is enough to
// sign in as them).
//
// firstName/lastName/mobileNumber/name are all optional and every one of
// them defaults to whatever's already on file (or, for a brand-new
// account, to the email address) when not supplied — the plain sign-in
// call every RETURNING user's device makes is just {email}, with none of
// these fields, and that call must never blank out an already-stored
// name or phone number. Only accountScreen.js's one-time "Welcome!"
// follow-up (see isNewUser below) actually sends firstName/lastName/
// mobileNumber; a plain `name` (no first/last) is also still accepted for
// flexibility/backward compatibility. `name` itself is kept as a single
// combined display field (firstName + " " + lastName when those are set)
// purely so every existing admin screen and saved-plot badge that already
// reads `name` keeps working unchanged.
//
// The very first account ever created with BOOTSTRAP_ADMIN_EMAIL becomes
// an admin automatically (and self-heals back to admin on every sign-in,
// in case that flag ever got cleared some other way) — every other new
// account starts as a regular (non-admin) user. From then on, admins are
// managed in-app via netlify/functions/adminUsers.js (Settings -> Manage
// Users, admin-only) rather than by editing this file again.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, isValidEmail, userKey, BOOTSTRAP_ADMIN_EMAIL } = require("./_shared");

function trimmedString(v) {
  return typeof v === "string" ? v.trim() : "";
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

  const email = normalizeEmail(payload.email);
  if (!email || !isValidEmail(email)) return json(400, { error: "A valid email is required." });

  const firstNameIn = trimmedString(payload.firstName);
  const lastNameIn = trimmedString(payload.lastName);
  const mobileIn = trimmedString(payload.mobileNumber);
  const nameIn = trimmedString(payload.name);

  const store = getStore("users");
  const key = userKey(email);
  let record = await store.get(key, { type: "json" });
  const isNewUser = !record;

  if (!record) {
    const combinedName = [firstNameIn, lastNameIn].filter(Boolean).join(" ").trim();
    record = {
      name: nameIn || combinedName || email,
      firstName: firstNameIn,
      lastName: lastNameIn,
      mobileNumber: mobileIn,
      email,
      isAdmin: email === BOOTSTRAP_ADMIN_EMAIL,
      createdAt: new Date().toISOString(),
    };
  } else {
    // Only touch fields this call actually supplied — a bare {email}
    // sign-in (every normal returning login) must leave an
    // already-stored name/first/last/phone untouched rather than
    // resetting it back to the email address.
    if (firstNameIn || lastNameIn) {
      record.firstName = firstNameIn || record.firstName || "";
      record.lastName = lastNameIn || record.lastName || "";
      record.name = [record.firstName, record.lastName].filter(Boolean).join(" ").trim() || record.name || email;
    } else if (nameIn) {
      record.name = nameIn;
    }
    if (mobileIn) record.mobileNumber = mobileIn;
    // Backfill fields that predate this schema (legacy accounts created
    // before firstName/lastName/mobileNumber existed) so every record
    // has consistent, always-a-string fields for the client to read.
    if (typeof record.firstName !== "string") record.firstName = "";
    if (typeof record.lastName !== "string") record.lastName = "";
    if (typeof record.mobileNumber !== "string") record.mobileNumber = "";
    if (email === BOOTSTRAP_ADMIN_EMAIL) record.isAdmin = true;
  }

  await store.setJSON(key, record);
  // isNewUser lets the client know to prompt for First Name/Last
  // Name/Mobile Number right after this first sign-in (see
  // accountScreen.js) — the account itself is already created at this
  // point (with name defaulted to the email), so a cancelled/skipped
  // prompt still leaves a fully working account.
  return json(200, { user: record, isNewUser });
};
