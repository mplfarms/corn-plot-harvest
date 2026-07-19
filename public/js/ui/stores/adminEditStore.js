// src/ui/stores/adminEditStore.js
//
// Tracks an in-progress "admin edits a teammate's plot" session, started
// from adminPlots.js. While a session is active, trialStore's single
// "current draft" slot holds the OTHER user's trial (loaded the normal
// way, via trialStore.loadTrial()) so Plot Details / Plot Hybrids / Plot
// Summary all work completely unmodified — same editing screens, same
// validation, same export.
//
// The one thing that must NOT happen while this is active: the normal
// "auto-save to library" rule (libraryStore.js) upserting that foreign
// trial into the admin's OWN local device library, which would then get
// cloud-pushed under the admin's OWN email (cloudSyncStore.js pushes the
// whole local library on every libraryStore change) — silently
// re-attaching a teammate's plot to the admin's account. libraryStore.js
// checks isActive() here and no-ops its autosave while a session is
// active; nothing is written anywhere until saveAndExit() explicitly PUTs
// straight to the owner's own cloud record.
//
// Saving is a full replace of the owner's trials array (matching
// plots.js's PUT contract), reconstructed from the snapshot of their
// OTHER trials taken at begin() time plus the just-edited one — so an
// admin editing trial A can't accidentally clobber the owner's trial B
// that was saved server-side in the meantime by anyone else mid-edit.
// That's a real (if narrow) race; acceptable for a low-stakes internal
// tool with a handful of concurrent users, same tradeoff already made by
// the rest of this app's "whole array" sync model (see plots.js's top
// comment).

import * as trialStore from "./trialStore.js";
import * as authStore from "../authStore.js";
import { showToast } from "../components/toast.js";

let session = null; // { ownerEmail, ownerName, otherTrials, editingTrialId, adminOwnDraftSnapshot }

/** @returns {boolean} */
export function isActive() {
  return session !== null;
}

/**
 * True if trialStore's draft is no longer the trial this session started
 * editing — e.g. the admin tapped "Enter a New Plot" or opened one of
 * their OWN saved plots from somewhere other than the Save/Discard
 * actions this store provides (Home, Saved Plots, etc. all call
 * trialStore.startNewTrial()/loadTrial() directly and have no reason to
 * know an admin-edit session might be running). Those actions are
 * legitimate and are never blocked — but once they've happened, this
 * session's `otherTrials` snapshot no longer corresponds to whatever
 * trialStore now holds, so saving it would silently overwrite the
 * teammate's plot with unrelated data. Callers must check this before
 * trusting isActive() alone; see workspaceMenu.js.
 * @returns {boolean}
 */
export function isStale() {
  return Boolean(session) && trialStore.getState().id !== session.editingTrialId;
}

/** @returns {string|null} the owner's display name (falls back to email) */
export function getOwnerLabel() {
  return session ? session.ownerName || session.ownerEmail : null;
}

/** @returns {string|null} */
export function getOwnerEmail() {
  return session ? session.ownerEmail : null;
}

/**
 * The plot OWNER's own account details (not the admin doing the
 * editing) — used by trialDetails.js so a plot's Collected By/Phone/
 * Email (derived from account details, see BASE_MOISTURE_LOCKED-style
 * lockedField() there) reflect whoever the plot actually belongs to
 * while an admin is editing it on their behalf, not the admin's own
 * info. Sourced from adminPlots.js's scope=all listing (the same
 * request that already returns every user's firstName/lastName/
 * mobileNumber — see plots.js's handleGetAll), captured once at begin()
 * time — this is a point-in-time snapshot like otherTrials above, not a
 * live subscription, but that's fine here since an admin-edit session is
 * always short-lived.
 * @returns {{email: string, name?: string, firstName?: string, lastName?: string, mobileNumber?: string}|null}
 */
export function getOwnerUser() {
  return session ? session.ownerUser : null;
}

/**
 * Starts an admin-edit session for one specific trial belonging to
 * another user, and loads it into trialStore as the current draft.
 * Snapshots the admin's own current draft so it can be restored
 * untouched once the session ends (see exit() below).
 * @param {{ownerEmail: string, ownerName?: string, ownerUser?: Object, allTrials: Object[], editingTrial: Object}} args
 */
export function begin({ ownerEmail, ownerName, ownerUser, allTrials, editingTrial }) {
  session = {
    ownerEmail,
    ownerName: ownerName || null,
    ownerUser: ownerUser || { email: ownerEmail, name: ownerName || null },
    otherTrials: (allTrials || []).filter((t) => t.id !== editingTrial.id),
    editingTrialId: editingTrial.id,
    adminOwnDraftSnapshot: trialStore.getState(),
  };
  trialStore.loadTrial(editingTrial);
}

/**
 * Saves the edited trial back to the OWNER's cloud record (not the
 * admin's own) and ends the session, restoring the admin's own draft.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function saveAndExit() {
  if (!session) return { ok: false, error: "No admin edit session is active." };
  if (isStale()) {
    // trialStore no longer holds the trial this session started with —
    // see isStale()'s comment. Refusing to save (rather than pushing
    // whatever's in trialStore now) is the safe default; the session
    // itself is left for the caller to clear via clearStaleSession()
    // once it's told the user, since silently discarding here could
    // race with whatever legitimately just loaded into trialStore.
    return { ok: false, error: "This plot is no longer open in the workspace — nothing was saved." };
  }
  const editedTrial = trialStore.getState();
  const trials = [...session.otherTrials, editedTrial];
  const adminCreds = authStore.getCredentials();

  let res;
  try {
    res = await fetch("/.netlify/functions/plots", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: session.ownerEmail,
        trials,
        // Tells the server this write is on behalf of someone else — it
        // re-checks that THIS email is really an admin before allowing
        // it (see requireAdmin() in netlify/functions/plots.js). Without
        // this field the server treats `email` as a normal self-save,
        // matching the existing (weaker, already-documented) trust
        // model for every user's own saves.
        adminEmail: adminCreds && adminCreds.email,
      }),
    });
  } catch (e) {
    return { ok: false, error: "Couldn't reach the server — check your connection and try again." };
  }

  let payload = {};
  try {
    payload = await res.json();
  } catch (e) {
    // Ignore — payload stays {} and the generic status-based message below is used.
  }

  if (!res.ok) {
    return { ok: false, error: payload.error || `Save failed (${res.status}).` };
  }

  exit();
  return { ok: true };
}

/** Ends the session without saving, restoring the admin's own draft. */
export function discardAndExit() {
  exit();
}

/**
 * Clears a stale session (see isStale()) WITHOUT touching trialStore —
 * whatever legitimately loaded in over top of it (a new blank trial, one
 * of the admin's own saved plots) is left exactly as-is. Use this
 * instead of discardAndExit() once isStale() is true; discardAndExit()
 * would clobber that with the old adminOwnDraftSnapshot, which is no
 * longer what should be showing.
 */
export function clearStaleSession() {
  session = null;
}

/**
 * Convenience for screens that can be landed on right after a
 * staleness-causing action (workspaceMenu.js, trialDetails.js,
 * entriesList.js, plotSummary.js — call this once at the top of
 * render()). No-ops silently unless there's actually a stale session to
 * clear, so it's always safe to call unconditionally.
 * @returns {boolean} true if a stale session was found and cleared
 */
export function clearIfStale() {
  if (!isActive() || !isStale()) return false;
  clearStaleSession();
  showToast("Your admin edit was left without saving — nothing was changed on their account.", { type: "info" });
  return true;
}

function exit() {
  if (!session) return;
  trialStore.loadTrial(session.adminOwnDraftSnapshot);
  session = null;
}
