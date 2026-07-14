// src/ui/stores/themeStore.js
//
// Persists the user's chosen theme mode ("light" | "dark" | "system") to
// localStorage. Mirrors brandStore.js's pattern exactly.

import { createPubSub, readJson, writeJson } from "./pubsub.js";
import { applyThemeMode } from "../theme.js";

const KEY = "cph.themeMode";
const VALID_MODES = ["light", "dark", "system"];

function normalizeMode(mode) {
  return VALID_MODES.includes(mode) ? mode : "system";
}

const pubsub = createPubSub();

let state = {
  mode: normalizeMode(readJson(KEY, "system")),
};

applyThemeMode(state.mode);

export function getState() {
  return state;
}

export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/**
 * @param {"light"|"dark"|"system"} mode
 */
export function setMode(mode) {
  const normalized = normalizeMode(mode);
  state = { ...state, mode: normalized };
  writeJson(KEY, normalized);
  applyThemeMode(normalized);
  pubsub.notify();
}
