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

// The one account that's always guaranteed to exist and stay an admin
// (see auth.js's self-healing isAdmin logic) — also the fixed recipient
// every self-deleted account's plots transfer to (see deleteAccount.js).
// Centralized here, rather than duplicated as a local literal in both
// auth.js and deleteAccount.js, so the two can never drift apart.
const BOOTSTRAP_ADMIN_EMAIL = "mplfarms@aol.com";

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

/**
 * Derives a "last name" to sort by for a stored user record. Prefers the
 * explicit lastName field (see auth.js); falls back to the last
 * whitespace-separated token of the legacy single `name` field for
 * accounts created before firstName/lastName existed, and finally to the
 * email itself if there's no name on file at all.
 * @param {{lastName?: string, name?: string, email?: string}} record
 * @returns {string}
 */
function lastNameFor(record) {
  if (record.lastName) return record.lastName;
  const source = String(record.name || record.email || "").trim();
  if (!source) return "";
  const parts = source.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : source;
}

/**
 * Shared ordering rule for every admin-facing list of users (All Plots,
 * Manage Users): admin(s) always first, then everyone else alphabetically
 * by last name (case-insensitive, see lastNameFor() above) — so a team's
 * roster reads the same way on both screens rather than each inventing
 * its own order.
 * @param {Array<{isAdmin?: boolean}>} users
 * @returns {Array} a new, sorted array (does not mutate the input)
 */
function sortUsersAdminFirst(users) {
  return users.slice().sort((a, b) => {
    if (Boolean(a.isAdmin) !== Boolean(b.isAdmin)) return a.isAdmin ? -1 : 1;
    return lastNameFor(a).toLowerCase().localeCompare(lastNameFor(b).toLowerCase());
  });
}

module.exports = {
  json,
  normalizeEmail,
  isValidEmail,
  userKey,
  requireAdmin,
  BOOTSTRAP_ADMIN_EMAIL,
  lastNameFor,
  sortUsersAdminFirst,
};
