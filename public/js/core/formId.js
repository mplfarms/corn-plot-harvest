// src/core/formId.js
//
// The "Form ID" is a short, permanent reference number for a plot —
// "<2-digit year>-" followed by a zero-padded 4-digit number (e.g.
// "26-1001", "27-1001"), reserved once from a per-year global counter
// shared across every user (see netlify/functions/formId.js and
// _formIdShared.js) and reused forever after for that same plot. The
// year prefix comes from the PLOT's own dates (Date Harvested, else
// Date Planted, else today's date if neither is filled in yet — see
// models.js's harvestedYear(), which ui/formIdAssign.js calls right
// before requesting a reservation) — not necessarily the real-world
// date the Form ID happens to be requested on. Each year's counter
// starts fresh at "<year>-1001" the first time that year is ever
// needed — "<year>-1000" is reserved (though only the Demo Plot's
// "26-1000" is actually hardcoded/used today — see demoPlot.js) and
// never issued from here.
//
// It's reserved the moment the user taps "Save Plot" on the Entry
// Editor (see entryEditor.js and ui/formIdAssign.js), NOT just from
// opening/browsing Plot Details — so a plot that's started but never
// saved never burns a number.
//
// On the rare chance a reservation would collide with an already-issued
// ID (e.g. two requests racing the same counter value), the server
// appends a lowercase letter — "26-1001", then "26-1001a",
// "26-1001b", ... — see formId.js's top comment for why that can only
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
