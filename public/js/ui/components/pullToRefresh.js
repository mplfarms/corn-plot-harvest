// src/ui/components/pullToRefresh.js
//
// Native-app-style "pull down at the top of the screen to refresh" for
// touch-capable devices. On release past the threshold it does the same
// two things the header's manual sync icon does (cloudSyncStore's
// pullAndMerge() + pushNow() — see workspaceMenu.js's syncStatusIcon()),
// then re-renders whatever screen is currently showing via router.js's
// refreshCurrent(), so server-backed screens that fetch on render (All
// Plots (Admin), Manage Users) also pick up anything new, not just the
// synced trial library.
//
// Only arms on genuinely touch-capable devices — mouse/trackpad users
// already have the sync icon for this. Only starts a pull when the page
// is scrolled all the way to the top, so it never fights normal
// scrolling partway down a long entry form. Suppressed entirely while a
// modal/picker is open (modal.js's shared overlay — see its own comment
// on why only one can be open at a time): those have their own internal
// scroll and shouldn't also drag the page underneath them.
//
// Wired up once from main.js, after the router starts — there's exactly
// one of these for the whole app, same pattern as cloudSyncStore.js
// wiring itself up on import.

import * as cloudSyncStore from "../stores/cloudSyncStore.js";
import * as authStore from "../authStore.js";
import { refreshCurrent } from "../router.js";
import { showToast } from "./toast.js";
import { h } from "../dom.js";

const PULL_THRESHOLD = 70; // px of actual finger travel needed to arm a refresh
const INDICATOR_HEIGHT = 56; // px — must match .pull-refresh-indicator's height in styles.css
const RESISTANCE = 0.35; // drag feels "heavier" past the threshold, rather than infinitely draggable

function isTouchCapable() {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

function isModalOpen() {
  return Boolean(document.querySelector(".modal-overlay:not(.hidden)"));
}

function atTop() {
  return (document.scrollingElement || document.documentElement).scrollTop <= 0;
}

let indicatorEl = null;
let iconEl = null;
let labelEl = null;

function ensureIndicator() {
  if (indicatorEl) return indicatorEl;
  iconEl = h("span", { className: "pull-refresh-icon" }, "↓");
  labelEl = h("span", { className: "pull-refresh-label" }, "Pull to refresh");
  indicatorEl = h("div", { className: "pull-refresh-indicator" }, [iconEl, labelEl]);
  document.body.appendChild(indicatorEl);
  return indicatorEl;
}

function setPull(distance, state) {
  const el = ensureIndicator();
  el.style.transition = "";
  const revealPx = (Math.min(distance, PULL_THRESHOLD) / PULL_THRESHOLD) * INDICATOR_HEIGHT;
  el.style.transform = `translateY(${revealPx - INDICATOR_HEIGHT}px)`;
  el.classList.toggle("pull-refresh-ready", state === "ready");
  iconEl.classList.toggle("pull-refresh-icon-spin", state === "refreshing");
  iconEl.textContent = state === "refreshing" ? "⟳" : state === "ready" ? "↑" : "↓";
  labelEl.textContent =
    state === "refreshing" ? "Refreshing…" : state === "ready" ? "Release to refresh" : "Pull to refresh";
}

function resetIndicator() {
  if (!indicatorEl) return;
  indicatorEl.style.transition = "transform 0.2s ease-out";
  indicatorEl.style.transform = `translateY(-${INDICATOR_HEIGHT}px)`;
  indicatorEl.classList.remove("pull-refresh-ready");
}

let startY = null;
let pulling = false;
let refreshing = false;

async function doRefresh() {
  refreshing = true;
  setPull(PULL_THRESHOLD, "refreshing");
  try {
    if (authStore.getUser()) {
      await cloudSyncStore.pullAndMerge();
      await cloudSyncStore.pushNow();
      if (cloudSyncStore.getSyncStatus() === cloudSyncStore.SyncStatus.ERROR) {
        showToast("Couldn't sync right now — check your connection and try again.", { type: "error" });
      }
    }
    refreshCurrent();
  } finally {
    refreshing = false;
    resetIndicator();
  }
}

function onTouchStart(e) {
  if (refreshing || isModalOpen() || !atTop() || e.touches.length !== 1) {
    startY = null;
    return;
  }
  startY = e.touches[0].clientY;
  pulling = false;
}

function onTouchMove(e) {
  if (startY === null || refreshing) return;
  const dy = e.touches[0].clientY - startY;
  if (dy <= 0) {
    // Finger moved back up (or this was never a downward pull to begin
    // with) — bail out instead of leaving a stuck indicator.
    if (pulling) {
      pulling = false;
      resetIndicator();
    }
    return;
  }
  if (!atTop()) {
    // The page itself scrolled mid-gesture (e.g. iOS Safari's own
    // overscroll rubber-banding) — abandon the pull rather than fighting
    // native scroll behavior.
    startY = null;
    pulling = false;
    resetIndicator();
    return;
  }
  pulling = true;
  const resisted = dy <= PULL_THRESHOLD ? dy : PULL_THRESHOLD + (dy - PULL_THRESHOLD) * RESISTANCE;
  setPull(resisted, resisted >= PULL_THRESHOLD ? "ready" : "pulling");
  // Now that this gesture has committed to a pull, stop the browser's own
  // overscroll/refresh behavior from also firing alongside this one.
  if (e.cancelable) e.preventDefault();
}

function onTouchEnd() {
  if (!pulling || refreshing) {
    startY = null;
    pulling = false;
    return;
  }
  const el = ensureIndicator();
  const wasReady = el.classList.contains("pull-refresh-ready");
  startY = null;
  pulling = false;
  if (wasReady) {
    doRefresh();
  } else {
    resetIndicator();
  }
}

/** Call once at startup (main.js). No-ops on non-touch devices. */
export function initPullToRefresh() {
  if (!isTouchCapable()) return;
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true });
}
