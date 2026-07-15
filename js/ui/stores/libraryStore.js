// src/ui/stores/libraryStore.js
//
// Mirrors TrialLibraryStore.swift: the list of SavedTrial records
// (cph.savedTrials). Subscribes to trialStore and implements the
// "auto-save to library" rule — whenever the draft's cooperatorName is
// non-empty, upsert (by id) into this array with a fresh lastModified,
// debounced ~500ms.

import { createPubSub, debounce, readJson, writeJson } from "./pubsub.js";
import * as trialStore from "./trialStore.js";

const KEY = "cph.savedTrials";
const AUTOSAVE_DEBOUNCE_MS = 500;

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
 * @param {string} id
 * @param {import('../../core/models.js').TrialHeader} header
 * @param {import('../../core/models.js').PlotEntry[]} entries
 */
export function upsert(id, header, entries) {
  const lastModified = new Date().toISOString();
  const idx = state.trials.findIndex((t) => t.id === id);
  const record = { id, header: { ...header }, entries: entries.map((e) => ({ ...e })), lastModified };
  const next = state.trials.slice();
  if (idx >= 0) {
    next[idx] = record;
  } else {
    next.push(record);
  }
  set(next);
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

const debouncedAutosave = debounce((draft) => {
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
  const draft = trialStore.getState();
  if (draft.header.cooperatorName.trim() !== "") {
    upsert(draft.id, draft.header, draft.entries);
  }
}

// Wire up the auto-save-to-library subscription once, at module load.
trialStore.subscribe(() => {
  debouncedAutosave(trialStore.getState());
});
