// src/ui/screens/accountScreen.js
//
// The app's launch screen — white background, the Republic shield in the
// upper third, the four-brand logo train below it, and a one-field
// Sign In With Email form. This is now also "Home": router.js's default
// route and topBar.js's Home button both land here (see those files).
// Nothing here is required — the app is fully useful offline with no
// account, exactly as before this feature existed.
//
// Signing in is just an email address — no name, no password, no email
// verification, no shared passcode (see authStore.js / auth.js /
// _shared.js's top comment for the full tradeoff this implies). It's
// also what decides the default Brand View:
//   - @midwestseedgenetics.com / @midwestseed.com / @republicseed.com
//     -> Midwest Seed Genetics, straight into the workspace
//   - @nc-plus.com -> NC+, straight into the workspace
//   - anything else -> the manual Brand View picker (brandSelect.js),
//     which then continues into the workspace itself once a brand is
//     chosen (see that file)
// (see brand.js's brandIdForEmail()).

import { h, mount } from "../dom.js";
import * as authStore from "../authStore.js";
import * as brandStore from "../stores/brandStore.js";
import { brandIdForEmail } from "../brand.js";
import { navigate } from "../router.js";

const SKIP_KEY = "cph.skipAccountPrompt";

export function render(container, params) {
  // Settings' "Sign In to Sync" button (and the Home button, see
  // topBar.js) sends the user here explicitly with force:true — that's a
  // deliberate request to see the launch screen, so it must bypass both
  // shortcuts below (especially the "previously skipped" one), or
  // tapping it would just bounce right back out.
  const force = Boolean(params && params.force);

  // Already signed in (returning visit) — nothing to ask, go straight in.
  if (!force && authStore.getUser()) {
    navigate("workspace");
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

  const existingUser = authStore.getUser();
  const emailInput = h("input", {
    type: "email",
    className: "text-input",
    id: "account-email-input",
    autocomplete: "email",
    placeholder: "you@example.com",
    value: (existingUser && existingUser.email) || "",
  });
  const errorNote = h("p", { className: "field-note account-error-note hidden" });

  function showError(message) {
    errorNote.textContent = message;
    errorNote.classList.remove("hidden");
  }

  const submitBtn = h(
    "button",
    { type: "button", className: "btn btn-primary btn-block", onclick: handleSubmit },
    "Sign In"
  );

  async function handleSubmit() {
    const email = emailInput.value.trim();

    errorNote.classList.add("hidden");
    errorNote.textContent = "";

    if (!email) return showError("Enter your email.");

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing In…";
    const result = await authStore.signIn({ email });
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";

    if (!result.ok) {
      showError(result.error);
      return;
    }

    try {
      localStorage.removeItem(SKIP_KEY);
    } catch (e) {
      // Ignore.
    }

    const knownBrandId = brandIdForEmail(email);
    if (knownBrandId) {
      brandStore.selectBrand(knownBrandId);
      navigate("workspace");
    } else {
      // Unrecognized domain — send them to the manual Brand View picker
      // instead of guessing; they're already signed in at this point.
      navigate("brand-select");
    }
  }

  emailInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  });

  const screen = h("div", { className: "screen launch-screen" }, [
    h("div", { className: "launch-branding" }, [
      h("img", {
        className: "launch-shield",
        src: "/logos/republic-shield.png",
        alt: "Republic",
      }),
      h("img", {
        className: "launch-brand-train",
        src: "/logos/brand-train.png",
        alt: "NC+, Crow's, Midwest Seed Genetics, Super Crost",
      }),
    ]),
    h("div", { className: "screen-body launch-form-body" }, [
      h("div", { className: "field" }, [
        h("label", { className: "field-label", for: "account-email-input" }, "Email"),
        emailInput,
      ]),
      errorNote,
      submitBtn,
      h(
        "p",
        { className: "field-note launch-note" },
        "Sign in with your email to access your saved plots from any phone, tablet, or computer. This is optional — everything works fully offline without an account."
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
            navigate("plot-chooser");
          },
        },
        "Continue Without Signing In"
      ),
    ]),
  ]);

  mount(container, screen);
}
