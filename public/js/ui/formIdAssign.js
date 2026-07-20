// src/ui/formIdAssign.js
//
// Owns the one-time "lock in" step of a plot's Form ID — reserving the
// next number from the server's single global counter (see
// netlify/functions/formId.js) and writing it onto the current draft's
// header (see models.js and core/formId.js's top comment for the full
// design).
//
// Called from exactly two places:
//   1. entryEditor.js's "Save Plot" button — the real trigger, by
//      explicit request: a Form ID is only ever generated once the user
//      actually taps Save, never just from opening/browsing Plot
//      Details. Fire-and-forget there (never blocks navigating to Plot
//      Summary).
//   2. plotSummary.js's export/print handlers, as a safety net — in
//      case that first attempt hasn't finished yet (or never got a
//      chance to run, e.g. a plot saved before this feature existed).
//      Awaited there, since the exported file needs the real value.
//
// Deliberately never throws and never blocks anything: this app is
// built to keep working offline in the field (see geoData.js's top
// comment), so a plot that can't reach the server yet simply doesn't
// have a Form ID yet — xlsxBuilder.js/pdfBuilder.js both fall back to
// their pre-Form-ID filename/footer behavior when a header has none, and
// trialDetails.js shows a plain "will be assigned when you save this
// plot" note instead.

import * as trialStore from "./stores/trialStore.js";
import * as authStore from "./authStore.js";
import { isFormIdAssigned } from "../core/formId.js";
import { showToast } from "./components/toast.js";

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

/**
 * Same as ensureFormIdAssigned(), but surfaces an error toast on failure
 * — for explicit, user-initiated attempts only (the "Save Plot" button
 * and the "Assign Plot ID" manual-retry buttons on Plot Details/Plot
 * Summary), never for a silent background attempt like Plot Summary's
 * own self-heal-on-render. A user who just tapped something expects to
 * know if it didn't work; a passive background retry that fails
 * shouldn't nag someone standing in a field with no signal every time
 * they open a screen.
 *
 * Deliberately silent (no toast) when navigator.onLine is false — an
 * offline failure is expected and already communicated by every other
 * "will be assigned when..." fallback text in this app; the toast is
 * reserved for "we tried and the server said no" cases, which is what's
 * actually worth a user's attention (and worth them reporting back, if
 * it keeps happening on a strong connection).
 * @returns {Promise<boolean>}
 */
export async function ensureFormIdAssignedWithFeedback() {
  const assigned = await ensureFormIdAssigned();
  if (!assigned && typeof navigator !== "undefined" && navigator.onLine !== false) {
    showToast("Couldn't assign a Plot ID — check your connection and try again.", { type: "error" });
  }
  return assigned;
}
