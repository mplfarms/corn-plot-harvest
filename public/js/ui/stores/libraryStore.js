// src/ui/stores/libraryStore.js
//
// Mirrors TrialLibraryStore.swift: the list of SavedTrial records
// (cph.savedTrials). Subscribes to trialStore and implements the
// "auto-save to library" rule — whenever the draft's cooperatorName is
// non-empty, upsert (by id) into this array with a fresh lastModified,
// debounced ~500ms.

import { createPubSub, debounce, readJson, writeJson } from "./pubsub.js";
import * as trialStore from "./trialStore.js";
import * as adminEditStore from "./adminEditStore.js";
import { DEMO_TRIAL_ID, createDemoTrial } from "../../core/demoPlot.js";
import { APP_VERSION } from "../../version.js";

const KEY = "cph.savedTrials";
const AUTOSAVE_DEBOUNCE_MS = 500;
const DEMO_SEED_VERSION_KEY = "cph.demoPlotSeededVersion";

const pubsub = createPubSub();

let state = {
  trials: readJson(KEY, []),
};

function persist() {
  writeJson(KEY, state.trials);
}

function set(trials) {
  state = { trials };
  persist();
  pubsub.notify();
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/**
 * Upserts a SavedTrial-shaped record (by id), stamping lastModified now.
 * Carries forward any extra fields already on the existing record (e.g.
 * transferredFrom — see adminUsers.js's handleMerge()/deleteAccount.js —
 * or isDemo — see demoPlot.js) that aren't passed in here, so editing a
 * trial's header/entries never silently strips flags set elsewhere.
 * @param {string} id
 * @param {import('../../core/models.js').TrialHeader} header
 * @param {import('../../core/models.js').PlotEntry[]} entries
 */
export function upsert(id, header, entries) {
  const lastModified = new Date().toISOString();
  const idx = state.trials.findIndex((t) => t.id === id);
  const existing = idx >= 0 ? state.trials[idx] : null;
  const record = {
    ...existing,
    id,
    header: { ...header },
    entries: entries.map((e) => ({ ...e })),
    lastModified,
  };
  const next = state.trials.slice();
  if (idx >= 0) {
    next[idx] = record;
  } else {
    next.push(record);
  }
  set(next);
}

/**
 * Seeds the sample "Demo Plot" (see demoPlot.js) into this device's
 * library, refreshing it to the latest sample content on every app
 * version. Runs once per app version, not once ever: whether the user
 * deleted it, never touched it, or edited it for practice, the next
 * time the app updates to a new version this replaces it with
 * createDemoTrial()'s current content — so everyone sees the latest
 * sample data (e.g. after the demo plot itself changes), not just new
 * installs or people who happened to have deleted theirs. This is a
 * deliberate tradeoff: any practice edits a user made to the demo plot
 * are overwritten in the process, since it's meant purely as a sample/
 * reference rather than real data worth preserving. Safe to call more
 * than once per boot; it no-ops once this version's seed has already
 * run. Call once at startup — see main.js.
 */
export function ensureDemoPlot() {
  const seededVersion = readJson(DEMO_SEED_VERSION_KEY, null);
  if (seededVersion === APP_VERSION) return;
  const demo = createDemoTrial();
  const idx = state.trials.findIndex((t) => t.id === DEMO_TRIAL_ID);
  if (idx >= 0) {
    const next = state.trials.slice();
    next[idx] = { ...demo, lastModified: new Date().toISOString() };
    set(next);
  } else {
    set([...state.trials, { ...demo, lastModified: new Date().toISOString() }]);
  }
  writeJson(DEMO_SEED_VERSION_KEY, APP_VERSION);
}

/**
 * @param {string} id
 */
export function deleteTrial(id) {
  set(state.trials.filter((t) => t.id !== id));
}

/**
 * Replaces the entire trials array wholesale. Used by cloudSyncStore.js
 * after pulling and merging the signed-in user's cloud copy — everything
 * else in this file only ever adds/updates one trial at a time.
 * @param {import('../../core/models.js').SavedTrial[]} trials
 */
export function replaceAll(trials) {
  set(trials);
}

/**
 * @param {string} id
 * @returns {import('../../core/models.js').SavedTrial|undefined}
 */
export function getById(id) {
  return state.trials.find((t) => t.id === id);
}

// Both of these skip entirely while an admin-edit session is active
// (see adminEditStore.js): trialStore's draft slot then holds a
// TEAMMATE's trial, not the signed-in admin's own — auto-saving it here
// would upsert it into the admin's own local library, which
// cloudSyncStore.js would then push to the server under the admin's own
// email, silently re-attaching someone else's plot to the wrong account.
// adminEditStore.saveAndExit() writes straight to the real owner's cloud
// record instead, bypassing this local library entirely.
const debouncedAutosave = debounce((draft) => {
  if (adminEditStore.isActive()) return;
  if (draft.header.cooperatorName.trim() !== "") {
    upsert(draft.id, draft.header, draft.entries);
  }
}, AUTOSAVE_DEBOUNCE_MS);

/**
 * Immediately (synchronously, no debounce) upserts the current draft
 * trial into the library if it has a cooperator name. Used before
 * destructive actions (starting a new trial, navigating Home) so
 * in-flight edits are not lost.
 */
export function flushDraftToLibrary() {
  debouncedAutosave.cancel();
  if (adminEditStore.isActive()) return;
  const draft = trialStore.getState();
  if (draft.header.cooperatorName.trim() !== "") {
    upsert(draft.id, draft.header, draft.entries);
  }
}

// Wire up the auto-save-to-library subscription once, at module load.
trialStore.subscribe(() => {
  debouncedAutosave(trialStore.getState());
});
