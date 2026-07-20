// src/ui/formIdAssign.js
//
// Owns the one-time "lock in" step of a plot's Form ID — reserving the
// next number from the server's single global counter (see
// netlify/functions/formId.js) and writing it onto the current draft's
// header (see models.js and core/formId.js's top comment for the full
// design).
//
// Called from trialDetails.js as soon as Plot Details is opened for a
// plot that doesn't have a Form ID yet (no longer gated on State/County
// being set — unlike the earlier FIPS-based design, a Form ID carries no
// location information at all, so there's nothing to wait on).
//
// Deliberately never throws and never blocks anything: this app is
// built to keep working offline in the field (see geoData.js's top
// comment), so a plot that can't reach the server yet simply doesn't
// have a Form ID shown yet — xlsxBuilder.js/pdfBuilder.js both fall back
// to their pre-Form-ID filename/footer behavior when a header has none,
// and trialDetails.js shows a plain "not yet assigned" note instead.

import * as trialStore from "./stores/trialStore.js";
import * as authStore from "./authStore.js";
import { isFormIdAssigned } from "../core/formId.js";

// Dedupes overlapping calls (e.g. the screen re-mounting quickly, or a
// second caller awaiting this while the first request is still
// in-flight) so at most one reservation request is ever in-flight for
// the current draft at a time.
let inFlight = null;

/**
 * @returns {Promise<boolean>} true if the current draft's header has (or
 *   now has) a Form ID assigned; false if it still doesn't (not signed
 *   in, or the server couldn't be reached).
 */
export function ensureFormIdAssigned() {
  if (inFlight) return inFlight;
  inFlight = doEnsure().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doEnsure() {
  const header = trialStore.getState().header;
  if (isFormIdAssigned(header)) return true;

  const creds = authStore.getCredentials();
  if (!creds) return false;

  let res;
  try {
    res = await fetch("/.netlify/functions/formId", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email }),
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

  if (!payload || !payload.formId) return false;

  // Re-check right before writing — a slower-to-resolve call could
  // otherwise stomp a Form ID some other in-flight call already
  // assigned (or the user could have started a brand new trial in the
  // meantime).
  const latest = trialStore.getState().header;
  if (isFormIdAssigned(latest)) return true;

  trialStore.updateHeader({ formId: payload.formId });
  return true;
}
