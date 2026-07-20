// src/ui/components/updateBanner.js
//
// A persistent top-of-screen banner that appears once a new app version
// has finished installing in the background and taken over. sw.js
// already calls self.skipWaiting()/self.clients.claim(), so a new
// service worker activates and takes control automatically without
// waiting for every tab to close first — but that handoff alone doesn't
// refresh what's already loaded in memory on THIS page. The JS modules
// currently running keep executing as whatever version they were when
// the page last loaded until an actual reload happens. This banner is
// how someone who's had the app open for a while (rather than having
// just relaunched it) finds out an update is ready, instead of
// unknowingly running stale code indefinitely — see the v26.78 fix in
// sw.js's install handler for the other half of this: making sure
// whatever DOES get installed is guaranteed fresh, not a stale HTTP
// cache hit.
//
// Deliberately NOT an automatic reload: this is a field data-entry app,
// and silently reloading out from under someone mid-entry (even with
// autosave) is a worse experience than a banner they act on when it's
// convenient. Two ways to act on it, both requiring deliberate intent
// so neither fires by accident:
//   - Swipe down from the very top of the page, far enough that it
//     can't be confused with an ordinary scroll — see
//     attachSwipeToUpdate() below.
//   - Tap/click the banner itself — the non-touch fallback, same
//     "every gesture also gets a non-gesture fallback" convention as
//     entriesList.js's swipe-to-delete (+ trash icon) and drag-to-
//     reorder (+ click-and-drag), and savedPlots.js's swipe/right-click
//     (+ trash icon).
//
// Appended straight to document.body (same pattern as modal.js's
// overlay and toast.js's container) rather than into #app, so it
// survives every screen's render() wiping #app's contents out from
// under it.

import { h } from "../dom.js";

// How far (in px) a downward pull from the top of the page has to
// travel before it's treated as "swipe down to update" rather than an
// ordinary scroll attempt or an accidental drag. Deliberately generous
// — reloading the whole app is a rare, consequential action, so erring
// toward "hard to trigger by accident" matters more here than it does
// for e.g. entriesList.js's 84px swipe-to-delete reveal.
const SWIPE_TRIGGER_PX = 120;

// How close to the very top of the page (in px of scrollY) the gesture
// has to START at — mirrors how native pull-to-refresh only engages
// when there's nowhere further up to scroll to, so it never hijacks an
// ordinary downward scroll partway down a long screen.
const SWIPE_START_SCROLL_TOLERANCE_PX = 4;

let bannerEl = null;
let swipeAttached = false;
let reloaded = false; // guards against double-triggering (swipe and tap racing each other)

function doUpdate() {
  if (reloaded) return;
  reloaded = true;
  window.location.reload();
}

// Touch-only — attached once, the first time the banner actually
// appears, rather than unconditionally at startup, so there's zero
// gesture-listener overhead on every normal page view where no update
// is pending.
function attachSwipeToUpdate() {
  if (swipeAttached) return;
  swipeAttached = true;

  let startY = null; // null unless a touch started at/near the very top of the page

  window.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      startY = window.scrollY <= SWIPE_START_SCROLL_TOLERANCE_PX ? e.touches[0].clientY : null;
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy >= SWIPE_TRIGGER_PX) {
        startY = null; // one-shot — don't keep re-triggering on further movement
        doUpdate();
      }
    },
    { passive: true }
  );

  window.addEventListener(
    "touchend",
    () => {
      startY = null;
    },
    { passive: true }
  );
}

function showBanner() {
  if (bannerEl) return; // already showing — a second controllerchange shouldn't duplicate it
  bannerEl = h(
    "div",
    {
      className: "update-banner",
      role: "button",
      tabindex: 0,
      "aria-label": "An app update is ready — swipe down or tap to refresh",
      onclick: doUpdate,
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") doUpdate();
      },
    },
    "Swipe Down to Update"
  );
  document.body.appendChild(bannerEl);
  attachSwipeToUpdate();
}

/**
 * Call once at startup (main.js). Safe to call even where service
 * workers aren't supported at all — this just no-ops there, since
 * there's nothing to detect an update from.
 */
export function initUpdateBanner() {
  if (!("serviceWorker" in navigator)) return;

  // Only a controllerchange that happens AFTER this page was already
  // being served by some existing service worker counts as "an update
  // arrived, tell the user." The very first install ever also fires
  // controllerchange once clients.claim() kicks in (transitioning from
  // "nothing controlling this page" to "the new service worker") — that
  // one is just this device's first-ever install taking over, not
  // something worth interrupting a brand-new user about.
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadControllerAtLoad) return;
    showBanner();
  });
}
