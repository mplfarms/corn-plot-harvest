// src/core/formNumber.js
//
// Builds the "Form Number" identifier used as the .xlsx export's filename
// and as a lower-right footer label on PDF/print exports — see the
// user's original spec: {2-digit harvest year}{2-letter State}{3-digit
// County FIPS}{Last-initial}{First-initial}{2-digit sequence}, e.g.
// "26IA067LM01".
//
// Design (confirmed with the user before implementing):
//   - Year, Initials, and Sequence are locked in ONCE — the first time a
//     plot is exported or printed in any format — and reused for every
//     later re-export of that same plot, even after edits. They live on
//     the TrialHeader as formNumberYear/formNumberInitials/formNumberSeq
//     (see models.js) and are assigned by ui/formNumberAssign.js, which
//     reserves the Sequence number from a server-side counter (see
//     netlify/functions/formNumber.js) so it's guaranteed unique across
//     every user who happens to share the same Year+Initials — the
//     scenario "make sure there are no repeats between all users" is
//     actually about.
//   - State/County are NOT locked — they're always read fresh from the
//     header's CURRENT values every time assembleFormNumber() is called.
//     If a plot's State or County gets corrected after its Form Number
//     was already assigned, the Form Number's location portion updates
//     on the next export to match, while Year/Initials/Sequence stay
//     exactly as first assigned (explicit user decision — no new
//     sequence number gets burned just because a location typo got
//     fixed).
//
// This file is pure (no DOM, no fetch, no localStorage) — the actual
// reservation/assignment flow lives in ui/formNumberAssign.js, which is
// the only thing that ever writes formNumberYear/Initials/Seq onto a
// trial's header.

/**
 * @param {string} s
 * @returns {string} uppercase first character, or "" for an empty/blank string
 */
function firstLetter(s) {
  const t = String(s || "").trim();
  return t ? t[0].toUpperCase() : "";
}

/**
 * Derives the 2-letter Last+First initials used in a Form Number from a
 * signed-in user record (authStore.getUser()'s shape). Prefers the
 * explicit firstName/lastName fields; falls back to splitting the
 * legacy combined `name` field for accounts that never went through the
 * "Welcome!" first/last name prompt, and finally to the email address
 * itself so this never returns something blank.
 * @param {{firstName?: string, lastName?: string, name?: string, email?: string}|null} user
 * @returns {string} always exactly 2 uppercase characters
 */
export function initialsForUser(user) {
  if (!user) return "XX";

  let first = user.firstName || "";
  let last = user.lastName || "";

  if (!first && !last && user.name) {
    const parts = String(user.name).trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      first = parts[0];
      last = parts[parts.length - 1];
    } else if (parts.length === 1) {
      first = parts[0];
      last = parts[0];
    }
  }

  if (!first && !last && user.email) {
    first = user.email;
    last = user.email;
  }

  const combined = `${firstLetter(last)}${firstLetter(first)}`;
  return combined || "XX";
}

/**
 * Assembles the full Form Number string, or null if it can't be built
 * yet (the plot hasn't had one assigned — see formNumberAssign.js — or
 * has no State set at all). County FIPS is resolved by the caller (see
 * geoData.getCountyFips) and passed in, since this file has no access to
 * that data on its own; a null/unknown county FIPS falls back to "000"
 * rather than blocking the whole Form Number on one unresolved segment
 * (e.g. a manually-typed county name that isn't in the standard table).
 * @param {import('./models.js').TrialHeader} header
 * @param {string|null} countyFipsCode 3-digit County FIPS string, or null
 * @returns {string|null}
 */
export function assembleFormNumber(header, countyFipsCode) {
  if (!header || !header.formNumberYear || !header.formNumberInitials || !header.formNumberSeq) return null;
  const state = String(header.state || "")
    .trim()
    .toUpperCase();
  if (!state) return null;
  const county = countyFipsCode || "000";
  return `${header.formNumberYear}${state}${county}${header.formNumberInitials}${header.formNumberSeq}`;
}

/**
 * Whether a header already has its Year/Initials/Sequence locked in —
 * i.e. whether this plot has ever been successfully assigned a Form
 * Number before (regardless of whether assembleFormNumber() can
 * currently resolve County FIPS).
 * @param {import('./models.js').TrialHeader} header
 * @returns {boolean}
 */
export function isFormNumberAssigned(header) {
  return Boolean(header && header.formNumberYear && header.formNumberInitials && header.formNumberSeq);
}
