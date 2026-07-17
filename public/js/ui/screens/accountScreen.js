// src/ui/screens/accountScreen.js
//
// The app's launch/sign-in screen — white background, the Republic
// shield in the upper third, the four-brand logo train below it, and a
// one-field Sign In With Email form. Signing in is now mandatory (there
// is no "Continue Without Signing In" — see router.js's guard, which
// bounces every other route back here when there's no session) — this is
// the first thing anyone sees until they sign in, and it's also where
// Settings' "Sign In to Sync" (after a Sign Out) sends them back to. It
// is NOT "Home" — once signed in and a brand is known, the branded
// per-brand Home Screen (plotChooser.js, #/plot-chooser) is Home (see
// topBar.js).
//
// Signing in is just an email address — no name, no password, no email
// verification, no shared passcode (see authStore.js / auth.js /
// _shared.js's top comment for the full tradeoff this implies), and the
// resulting session is kept in localStorage indefinitely (no expiry, no
// TTL) so it stays signed in across restarts on any device/browser
// capable of persisting it. It's also what decides the default Brand
// View:
//   - @midwestseedgenetics.com / @midwestseed.com / @republicseed.com
//     -> Midwest Seed Genetics, straight into the Home Screen
//   - @nc-plus.com -> NC+, straight into the Home Screen
//   - anything else -> the manual Brand View picker (brandSelect.js),
//     which then continues into the Home Screen itself once a brand is
//     chosen (see that file)
// (see brand.js's brandIdForEmail()).

import { h, mount } from "../dom.js";
import * as authStore from "../authStore.js";
import * as brandStore from "../stores/brandStore.js";
import { brandIdForEmail } from "../brand.js";
import { navigate } from "../router.js";

export function render(container) {
  // Already signed in (returning visit, or landed here right after
  // Sign Out re-routed here — see settings.js) — nothing to ask if
  // there's also a brand on file; otherwise fall through and show the
  // form so a signed-in-but-brandless account still gets somewhere.
  if (authStore.getUser() && brandStore.getState().selectedBrand) {
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

    const knownBrandId = brandIdForEmail(email);
    if (knownBrandId) {
      brandStore.selectBrand(knownBrandId);
      navigate("plot-chooser");
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
        "Sign in with your email to access your saved plots from any phone, tablet, or computer. You'll stay signed in on this device."
      ),
    ]),
  ]);

  mount(container, screen);
}
