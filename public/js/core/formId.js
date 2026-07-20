// src/core/formId.js
//
// The "Form ID" is a short, permanent reference number for a plot — a
// zero-padded 5-digit number prefixed with "APP" (starting at
// "APP00001"), reserved once from a single global counter shared across
// every user (see netlify/functions/formId.js) and reused forever after
// for that same plot. It carries no location/user/date information at
// all — it's purely a unique reference tag.
//
// It's reserved the moment the user taps "Save Plot" on the Entry
// Editor (see entryEditor.js and ui/formIdAssign.js), NOT just from
// opening/browsing Plot Details — so a plot that's started but never
// saved never burns a number.
//
// On the rare chance a reservation would collide with an already-issued
// ID (e.g. two requests racing the same counter value), the server
// appends a lowercase letter — "APP00001", then "APP00001a",
// "APP00001b", ... — see formId.js's top comment for why that can only
// really happen under a genuine race, and why appending a letter is
// enough to guarantee it's still resolved to something globally unique
// rather than silently duplicating.

/**
 * @param {import('./models.js').TrialHeader} header
 * @returns {boolean} whether this plot has ever been assigned a Form ID
 */
export function isFormIdAssigned(header) {
  return Boolean(header && header.formId);
}
