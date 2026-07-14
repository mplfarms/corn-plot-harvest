// src/ui/screens/accountScreen.js
//
// Shown once, right after choosing a brand: offers signing in / creating
// an account (turns on cross-device cloud sync of saved plots, via
// Netlify Identity + netlify/functions/plots.js) or continuing without
// one. Nothing here is required — the app is fully useful offline with
// no account, exactly as before this feature existed.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import * as authStore from "../authStore.js";
import { navigate } from "../router.js";

const SKIP_KEY = "cph.skipAccountPrompt";

export function render(container, params) {
  // Settings' "Sign In to Sync" button sends the user here explicitly —
  // that's a deliberate request to see the sign-in form, so it must
  // bypass both shortcuts below (especially the "previously skipped"
  // one), or tapping it would just bounce right back out.
  const force = Boolean(params && params.force);

  // Already signed in (returning visit) — nothing to ask, go straight in.
  if (!force && authStore.getUser()) {
    navigate("plot-chooser");
    return;
  }

  // Previously chose "Continue Without Signing In" — don't nag every time.
  let skipRemembered = false;
  if (!force) {
    try {
      skipRemembered = localStorage.getItem(SKIP_KEY) === "1";
    } catch (e) {
      // localStorage unavailable — just show the prompt every time; harmless.
    }
  }
  if (skipRemembered) {
    navigate("plot-chooser");
    return;
  }

  // If the identity widget finishes loading a session (or the user signs
  // in via the modal) while this screen is up, move on automatically.
  const unsubscribe = authStore.subscribe(() => {
    if (authStore.getUser()) {
      unsubscribe();
      navigate("plot-chooser");
    }
  });

  const topBar = createTopBar({
    title: "Account",
    onBack: () => navigate("brand-select"),
  });

  const unavailableNote = authStore.isAvailable()
    ? null
    : h(
        "p",
        { className: "field-note" },
        "Sign-in isn't available right now (this usually means you're offline on first load). You can still continue without an account below."
      );

  const card = h("section", { className: "card account-card" }, [
    h("h2", { className: "screen-heading" }, "Sync Your Plots"),
    h(
      "p",
      { className: "field-note" },
      "Sign in to access your saved plots from any phone, tablet, or computer. This is optional — everything works fully offline without an account."
    ),
    unavailableNote,
    h(
      "button",
      {
        type: "button",
        className: "btn btn-primary btn-block",
        disabled: !authStore.isAvailable(),
        onclick: () => authStore.openSignup(),
      },
      "Create Account"
    ),
    h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-block",
        disabled: !authStore.isAvailable(),
        onclick: () => authStore.openLogin(),
      },
      "Sign In"
    ),
    h(
      "button",
      {
        type: "button",
        className: "btn-link-block",
        onclick: () => {
          try {
            localStorage.setItem(SKIP_KEY, "1");
          } catch (e) {
            // Ignore — worst case, this screen is shown again next time.
          }
          unsubscribe();
          navigate("plot-chooser");
        },
      },
      "Continue Without Signing In"
    ),
  ]);

  const screen = h("div", { className: "screen account-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [card]),
  ]);

  mount(container, screen);
}
