// netlify/functions/_shared.js
//
// Small helpers shared by auth.js, plots.js, and adminUsers.js now that
// this app's "sign in" is Name + Email + a single team-wide passcode
// (see authStore.js) instead of real per-user Netlify Identity accounts.
// Not a Netlify Function itself — esbuild bundles this into whichever
// function(s) require() it, same as how each function already bundles
// its own copy of @netlify/blobs (no shared-code Lambda layer needed for
// a project this size).
//
// Security note (documented here since every function's auth check runs
// through this file): this is intentionally NOT strong security. There
// are no per-user passwords and no email verification — knowing a
// teammate's name/email plus the one shared passcode is enough to sign
// in as them, and knowing an admin's email plus the passcode is enough
// to use admin actions (list/delete/promote any account). That tradeoff
// was a deliberate, explicit choice for a small internal farm-operation
// tool, not an oversight — see the "Cloud sync setup" section of
// README.md for the full picture before changing this.

const crypto = require("crypto");

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

// Constant-time-ish comparison (via a fixed-length hash of each side) so
// checking the passcode doesn't leak timing information about how many
// leading characters matched. Belt-and-suspenders for a value that's
// meant to be shared with an entire team anyway, not a high-value secret.
function safeEquals(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * @param {string} suppliedPasscode
 * @returns {{ok: true}|{ok: false, statusCode: number, error: string}}
 */
function checkPasscode(suppliedPasscode) {
  const expected = process.env.APP_PASSCODE || "";
  if (!expected) {
    return { ok: false, statusCode: 500, error: "Server isn't configured with a team passcode yet (APP_PASSCODE environment variable is missing)." };
  }
  if (!suppliedPasscode || !safeEquals(String(suppliedPasscode), expected)) {
    return { ok: false, statusCode: 401, error: "Incorrect passcode." };
  }
  return { ok: true };
}

/**
 * Loads the caller's user record from the "users" Blobs store and
 * confirms both the passcode and that the record has isAdmin === true.
 * Used to gate every admin-only action (scope=all on plots.js,
 * everything in adminUsers.js).
 * @param {import('@netlify/blobs').Store} usersStore
 * @param {string} email
 * @param {string} passcode
 * @returns {Promise<{ok: true, user: Object}|{ok: false, statusCode: number, error: string}>}
 */
async function requireAdmin(usersStore, email, passcode) {
  const passcodeCheck = checkPasscode(passcode);
  if (!passcodeCheck.ok) return passcodeCheck;
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, statusCode: 400, error: "Missing email." };
  const record = await usersStore.get(userKey(normalized), { type: "json" });
  if (!record || !record.isAdmin) {
    return { ok: false, statusCode: 403, error: "Admin access required." };
  }
  return { ok: true, user: record };
}

module.exports = { json, normalizeEmail, isValidEmail, userKey, safeEquals, checkPasscode, requireAdmin };
