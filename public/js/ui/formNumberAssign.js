// src/ui/formNumberAssign.js
//
// Owns the one-time "lock in" step of a plot's Form Number — reserving a
// globally-unique Sequence number from the server (see
// netlify/functions/formNumber.js) and writing formNumberYear/
// formNumberInitials/formNumberSeq onto the current draft's header (see
// models.js and core/formNumber.js's top comment for the full design).
//
// Called two ways, both funneling through the same idempotent
// ensureFormNumberAssigned():
//   1. "In the background" — trialDetails.js fires this (without
//      awaiting it, best-effort) as soon as both State and County are
//      set on a plot that doesn't have a Form Number yet, per the
//      user's explicit request. This means the reservation round-trip
//      to the server has usually already finished by the time the user
//      gets to Plot Summary and taps Export/Print, so there's no
//      perceptible delay there.
//   2. As a synchronous fallback — plotSummary.js awaits this
//      immediately before building any export, in case the background
//      attempt above never got a chance to run (e.g. State/County were
//      already set on an older plot from before this feature existed)
//      or failed the first time (e.g. no signal at the time).
//
// Deliberately never throws and never blocks exporting: this app is
// built to keep working offline in the field (see geoData.js's top
// comment), so a plot that can't reach the server yet still exports —
// just without a Form Number until connectivity comes back and this
// gets a chance to run again (xlsxBuilder.js/pdfBuilder.js both fall
// back to their pre-Form-Number filename/footer behavior when a header
// has no Form Number assigned yet).

import * as trialStore from "./stores/trialStore.js";
import * as authStore from "./authStore.js";
import * as geoData from "./geoData.js";
import { harvestedYear } from "../core/models.js";
import { initialsForUser, isFormNumberAssigned } from "../core/formNumber.js";

// Dedupes overlapping calls (e.g. State and County both changing in
// quick succession, or the background attempt still in flight when
// Export is tapped) so at most one reservation request is ever
// in-flight for the current draft at a time.
let inFlight = null;

/**
 * @returns {Promise<boolean>} true if the current draft's header has (or
 *   now has) a fully assigned Form Number; false if it still doesn't
 *   (missing State/County, not signed in, or the server couldn't be
 *   reached).
 */
export function ensureFormNumberAssigned() {
  if (inFlight) return inFlight;
  inFlight = doEnsure().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doEnsure() {
  const header = trialStore.getState().header;
  if (isFormNumberAssigned(header)) return true;

  if (!header.state || !header.county) return false;

  const creds = authStore.getCredentials();
  if (!creds) return false;

  const year = String(harvestedYear(header)).slice(-2);
  const initials = initialsForUser(authStore.getUser());

  let res;
  try {
    res = await fetch("/.netlify/functions/formNumber", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, year, initials }),
    });
  } catch (e) {
    return false;
  }

  if (!res.ok) return false;

  let payload;
  try {
    payload = await res.json();
  } catch (e) {
    return false;
  }

  if (!payload || !payload.seq) return false;

  // Re-check right before writing — a slower-to-resolve background
  // attempt could otherwise stomp a Form Number some other in-flight
  // call already assigned (or the user could have started a brand new
  // trial in the meantime).
  const latest = trialStore.getState().header;
  if (isFormNumberAssigned(latest)) return true;

  trialStore.updateHeader({
    formNumberYear: year,
    formNumberInitials: initials,
    formNumberSeq: payload.seq,
  });
  return true;
}

/**
 * Best-effort, non-blocking kickoff — used by trialDetails.js right
 * after a State or County change. Swallows any error since this is
 * purely an optimization (see ensureFormNumberAssigned's real,
 * awaited call in plotSummary.js for the synchronous fallback).
 */
export function kickOffFormNumberAssignment() {
  geoData
    .ensureLoaded()
    .then(() => ensureFormNumberAssigned())
    .catch(() => {});
}
