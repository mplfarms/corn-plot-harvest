// src/core/formId.js
//
// The "Form ID" is a short, permanent reference number for a plot — a
// plain sequential number starting at 5000 (e.g. "5001"), reserved once
// from a single global counter shared across every user (see
// netlify/functions/formId.js) and reused forever after for that same
// plot. Unlike the app's earlier FIPS-based "Form Number" design, it
// carries no location/user/date information at all — it's purely a
// unique reference tag, which is what makes it simple enough to display
// directly on Plot Details as soon as a plot is opened (see
// ui/formIdAssign.js for the reservation flow).
//
// On the rare chance a reservation would collide with an already-issued
// ID (e.g. two requests racing the same counter value), the server
// appends a lowercase letter — "5001", then "5001a", "5001b", ... — see
// formId.js's top comment for why that can only really happen under a
// genuine race, and why appending a letter is enough to guarantee it's
// still resolved to something globally unique rather than silently
// duplicating.

/**
 * @param {import('./models.js').TrialHeader} header
 * @returns {boolean} whether this plot has ever been assigned a Form ID
 */
export function isFormIdAssigned(header) {
  return Boolean(header && header.formId);
}
