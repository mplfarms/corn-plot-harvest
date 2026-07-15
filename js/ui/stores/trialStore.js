// src/ui/stores/trialStore.js
//
// Mirrors TrialStore.swift: the trial currently being edited (the
// "draft"). Autosaved to localStorage (debounced) on every change and
// restored on load. Library upsert ("auto-save to library" rule) is
// handled by libraryStore.js, which subscribes to this store.

import { uuid, createTrialHeader, createPlotEntry } from "../../core/models.js";
import { createPubSub, debounce, readJson, writeJson } from "./pubsub.js";

const KEY = "cph.draftTrial";
const AUTOSAVE_DEBOUNCE_MS = 400;

const pubsub = createPubSub();

function blankTrial() {
  return { id: uuid(), header: createTrialHeader(), entries: [] };
}

function loadInitial() {
  const saved = readJson(KEY, null);
  if (saved && saved.id && saved.header && Array.isArray(saved.entries)) {
    return saved;
  }
  return blankTrial();
}

let state = loadInitial();

const persist = debounce(() => {
  writeJson(KEY, state);
}, AUTOSAVE_DEBOUNCE_MS);

function set(next) {
  state = next;
  persist();
  pubsub.notify();
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/** Force any pending debounced write to flush synchronously right now. */
export function flush() {
  persist.flush();
}

/**
 * @param {Partial<import('../../core/models.js').TrialHeader>} patch
 */
export function updateHeader(patch) {
  set({ ...state, header: { ...state.header, ...patch } });
}

/**
 * @param {import('../../core/models.js').PlotEntry} entry
 */
export function addEntry(entry) {
  const e = entry || createPlotEntry();
  set({ ...state, entries: [...state.entries, e] });
  return e;
}

// Strip Length / Number of Rows / Width are almost always constant for
// every entry in a given plot — re-typing them on each new entry is
// pure friction, so a freshly added entry carries them forward from the
// most recently added entry instead of starting blank.
const CARRIED_MEASUREMENT_FIELDS = ["stripLengthFeet", "numberOfRows", "widthInches"];

// Hybrid / RM / Trait are carried forward too — not because they're
// usually identical, but so each of those selection lists opens already
// scrolled to the previous entry's pick (wheelSelect.js auto-scrolls to
// whatever the current value is) instead of the top of a long list. The
// user still has to actively confirm or change it for the new entry.
const CARRIED_IDENTITY_FIELDS = ["hybrid", "relativeMaturity", "trait"];

/**
 * Adds a new blank entry, prepopulating Strip Length, Number of Rows,
 * Width, Hybrid, Relative Maturity, and Trait from the most recently
 * added entry (if any) — the first entry in a new plot has nothing to
 * carry forward from; see entryEditor.js for how it defaults instead.
 * @returns {import('../../core/models.js').PlotEntry}
 */
export function addEntryCarryingMeasurements() {
  const prev = state.entries[state.entries.length - 1];
  const entry = createPlotEntry();
  if (prev) {
    for (const key of CARRIED_MEASUREMENT_FIELDS) entry[key] = prev[key];
    for (const key of CARRIED_IDENTITY_FIELDS) entry[key] = prev[key];
  }
  return addEntry(entry);
}

/**
 * @param {string} entryId
 * @param {Partial<import('../../core/models.js').PlotEntry>} patch
 */
export function updateEntry(entryId, patch) {
  set({
    ...state,
    entries: state.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)),
  });
}

/**
 * @param {string} entryId
 */
export function removeEntry(entryId) {
  set({ ...state, entries: state.entries.filter((e) => e.id !== entryId) });
}

/**
 * Moves the entry at `index` up (-1) or down (+1) in the list.
 * @param {number} index
 * @param {number} direction -1 or +1
 */
export function moveEntry(index, direction) {
  const entries = state.entries.slice();
  const target = index + direction;
  if (target < 0 || target >= entries.length) return;
  const tmp = entries[index];
  entries[index] = entries[target];
  entries[target] = tmp;
  set({ ...state, entries });
}

/**
 * Discards the current draft and starts a brand new blank trial.
 * Callers are responsible for flushing the old draft to the library
 * first (see libraryStore.upsertIfNamed) if desired.
 */
export function startNewTrial() {
  set(blankTrial());
}

/**
 * Loads an existing SavedTrial into the draft slot, e.g. when the user
 * opens a plot from Saved Plots. Keeps the same id so future edits
 * continue to upsert the same library record.
 * @param {import('../../core/models.js').SavedTrial} trial
 */
export function loadTrial(trial) {
  set({ id: trial.id, header: { ...trial.header }, entries: trial.entries.map((e) => ({ ...e })) });
}
