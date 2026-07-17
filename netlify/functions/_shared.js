// netlify/functions/_shared.js
//
// Small helpers shared by auth.js, plots.js, and adminUsers.js. This
// app's "sign in" is just an Email address — no name, no password, no
// email verification, and (per the user's explicit request) no shared
// team passcode either; all deliberately simple since none of this data
// is sensitive. See authStore.js.
//
// Security note (documented here since every function's auth check runs
// through this file): this is intentionally NOT strong security, and
// with the passcode removed there is effectively no verification at
// all — anyone who knows (or guesses) a teammate's email can type it
// into the sign-in form and see that person's saved plots, and anyone
// who knows the bootstrap admin's email (mplfarms@aol.com, see auth.js)
// can sign in as them and get full admin access (view everyone's plots,
// promote/demote, delete accounts). That tradeoff was a deliberate,
// explicit choice for a small internal farm-operation tool where the
// people who'd ever type in this form are trusted teammates, not an
// oversight — see the "Cloud sync setup" section of README.md for the
// full picture before changing this further.

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  // Deliberately simple — just enough to catch "forgot to type an email"
  // typos, not a full RFC 5322 validator.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function userKey(email) {
  return `${normalizeEmail(email)}.json`;
}

/**
 * Loads the caller's user record from the "users" Blobs store and
 * confirms it has isAdmin === true. Used to gate every admin-only
 * action (scope=all on plots.js, everything in adminUsers.js). There is
 * no passcode check anymore — this is purely "does the stored record for
 * this email say isAdmin: true", which is why knowing an admin's email
 * alone is enough to act as them (see the top-of-file security note).
 * @param {import('@netlify/blobs').Store} usersStore
 * @param {string} email
 * @returns {Promise<{ok: true, user: Object}|{ok: false, statusCode: number, error: string}>}
 */
async function requireAdmin(usersStore, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, statusCode: 400, error: "Missing email." };
  const record = await usersStore.get(userKey(normalized), { type: "json" });
  if (!record || !record.isAdmin) {
    return { ok: false, statusCode: 403, error: "Admin access required." };
  }
  return { ok: true, user: record };
}

module.exports = { json, normalizeEmail, isValidEmail, userKey, requireAdmin };
