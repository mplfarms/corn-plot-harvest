// netlify/functions/updateProfile.js
//
// Lets an account holder edit their own First Name, Last Name, and
// Mobile Number (Email is the account's identity — see authStore.js's
// top comment — and is never editable here), and lets an admin edit ANY
// account's same three fields on the account holder's behalf. Follows
// the same {email, adminEmail} pattern plots.js's PUT already uses for
// "self OR admin acting for someone else":
//   POST body {email, firstName, lastName, mobileNumber}
//     -> self-edit, no admin check — `email` must be the caller's own.
//   POST body {email, firstName, lastName, mobileNumber, adminEmail}
//     -> admin edit, requires adminEmail's own stored record to have
//        isAdmin === true (requireAdmin(), server-checked, never trusted
//        from the client alone — same pattern as every other admin
//        action in this app); `email` is the account BEING edited.
//
// Unlike auth.js's sign-in call — which deliberately only ever ADDS a
// value and never blanks an already-stored field, since a plain {email}
// sign-in must never wipe out a name (see auth.js's top comment) — this
// endpoint is a deliberate, explicit edit: every field is set to EXACTLY
// what's supplied, including an empty string, so clearing a field (e.g.
// removing a phone number) actually works.

const { getStore, connectLambda } = require("@netlify/blobs");
const { json, normalizeEmail, userKey, requireAdmin } = require("./_shared");

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

  const targetEmail = normalizeEmail(payload.email);
  if (!targetEmail) return json(400, { error: "Missing email." });

  const usersStore = getStore("users");

  const adminEmail = payload.adminEmail ? normalizeEmail(payload.adminEmail) : null;
  if (adminEmail && adminEmail !== targetEmail) {
    const adminCheck = await requireAdmin(usersStore, adminEmail);
    if (!adminCheck.ok) return json(adminCheck.statusCode, { error: adminCheck.error });
  }

  const key = userKey(targetEmail);
  const record = await usersStore.get(key, { type: "json" });
  if (!record) return json(404, { error: "Account not found." });

  const firstName = trimmedString(payload.firstName);
  const lastName = trimmedString(payload.lastName);
  const mobileNumber = trimmedString(payload.mobileNumber);

  record.firstName = firstName;
  record.lastName = lastName;
  record.mobileNumber = mobileNumber;
  record.name = [firstName, lastName].filter(Boolean).join(" ").trim() || targetEmail;

  await usersStore.setJSON(key, record);
  return json(200, { user: record });
};
