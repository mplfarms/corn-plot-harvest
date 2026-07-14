// src/ui/stores/brandStore.js
//
// Mirrors BrandStore.swift: persists the user's chosen brand
// ("midwestSeedGenetics" | "ncPlus") to localStorage.

import { createPubSub, readJson, writeJson } from "./pubsub.js";
import { applyBrandTheme } from "../brand.js";

const KEY = "cph.selectedBrand";

const pubsub = createPubSub();

let state = {
  selectedBrand: readJson(KEY, null),
};

applyBrandTheme(state.selectedBrand);

export function getState() {
  return state;
}

export function subscribe(fn) {
  return pubsub.subscribe(fn);
}

/**
 * @param {"midwestSeedGenetics"|"ncPlus"} brandId
 */
export function selectBrand(brandId) {
  state = { ...state, selectedBrand: brandId };
  writeJson(KEY, brandId);
  applyBrandTheme(brandId);
  pubsub.notify();
}

/** Clears the selected brand — returns the user to BrandSelect ("Home"). */
export function clearBrand() {
  state = { ...state, selectedBrand: null };
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    console.error("[brandStore] failed to clear", e);
  }
  applyBrandTheme(null);
  pubsub.notify();
}
