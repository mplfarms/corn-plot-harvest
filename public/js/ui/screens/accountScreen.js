// src/ui/screens/accountScreen.js
//
// Shown once, right after choosing a brand: offers signing in (turns on
// cross-device cloud sync of saved plots, via netlify/functions/auth.js +
// plots.js) or continuing without one. Nothing here is required — the app
// is fully useful offline with no account, exactly as before this feature
// existed. Sign-up and sign-in are the same form/action now (see
// authStore.js) — there's no separate "Create Account" step, no password,
// and no email verification, just Name + Email + the team's shared
// passcode.
//
// On a successful sign-in, this also sets the user's default Brand View:
// known company-email domains (@midwestseed.com / @republicseed.com ->
// Midwest, @nc-plus.com -> NC+, see brand.js's brandIdForEmail()) apply
// automatically; any other domain prompts the user to pick one via
// promptForBrandView() below.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { showCustomModal } from "../components/modal.js";
import * as authStore from "../authStore.js";
import * as brandStore from "../stores/brandStore.js";
import { BRANDS, brandIdForEmail } from "../brand.js";
import { navigate } from "../router.js";

const SKIP_KEY = "cph.skipAccountPrompt";

/**
 * Asks the user to pick a default Brand View, for email domains that
 * aren't recognized as belonging to a specific brand. Reuses the same
 * logo-button visual idea as brandSelect.js, sized for a modal card.
 * Dismissing without choosing (tapping outside, or the ✕) still needs
 * *some* default, so it falls back to Midwest Seed Genetics.
 * @returns {Promise<"midwestSeedGenetics"|"ncPlus">}
 */
function promptForBrandView() {
  return new Promise((resolve) => {
    let resolved = false;
    const settle = (brandId) => {
      if (resolved) return;
      resolved = true;
      resolve(brandId);
    };

    const body = h("div", { className: "brand-prompt-body" }, [
      h(
        "p",
        { className: "field-note" },
        "We couldn't tell which brand you work with from your email address. Choose your default Brand View — you can always switch it later in Settings."
      ),
      h(
        "div",
        { className: "brand-prompt-buttons" },
        Object.values(BRANDS).map((b) =>
          h(
            "button",
            {
              type: "button",
              className: "brand-prompt-btn",
              onclick: () => {
                settle(b.id);
                modalRef.close();
              },
            },
            [
              h("img", { className: "brand-prompt-logo", src: b.logo, alt: b.displayName }),
              h("span", { className: "brand-prompt-name" }, b.displayName),
            ]
          )
        )
      ),
    ]);

    const modalRef = showCustomModal({
      title: "Choose Your Default Brand View",
      bodyNode: body,
      onClose: () => settle(BRANDS.midwestSeedGenetics.id),
    });
  });
}

export function render(container, params) {
  // Settings' "Sign In to Sync" button sends the user here explicitly —
  // that's a deliberate request to see the sign-in form, so it must
  // bypass both shortcuts below (especially the "previously skipped"
  // one), or tapping it would just bounce right back out.
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

  const topBar = createTopBar({
    title: "Account",
    onBack: () => navigate("brand-select"),
  });

  const existingUser = authStore.getUser();
  const nameInput = h("input", {
    type: "text",
    className: "text-input",
    id: "account-name-input",
    autocomplete: "name",
    value: (existingUser && existingUser.name) || "",
  });
  const emailInput = h("input", {
    type: "email",
    className: "text-input",
    id: "account-email-input",
    autocomplete: "email",
    value: (existingUser && existingUser.email) || "",
  });
  const passcodeInput = h("input", {
    type: "password",
    className: "text-input",
    id: "account-passcode-input",
    autocomplete: "off",
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
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const passcode = passcodeInput.value;

    errorNote.classList.add("hidden");
    errorNote.textContent = "";

    if (!name) return showError("Enter your name.");
    if (!email) return showError("Enter your email.");
    if (!passcode) return showError("Enter the team passcode.");

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing In…";
    const result = await authStore.signIn({ name, email, passcode });
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
    const brandId = knownBrandId || (await promptForBrandView());
    brandStore.selectBrand(brandId);

    navigate("workspace");
  }

  passcodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  });

  const card = h("section", { className: "card account-card" }, [
    h("h2", { className: "screen-heading" }, "Sync Your Plots"),
    h(
      "p",
      { className: "field-note" },
      "Sign in with your name, email, and the team passcode to access your saved plots from any phone, tablet, or computer. This is optional — everything works fully offline without an account."
    ),
    h("div", { className: "field" }, [
      h("label", { className: "field-label", for: "account-name-input" }, "Name"),
      nameInput,
    ]),
    h("div", { className: "field" }, [
      h("label", { className: "field-label", for: "account-email-input" }, "Email"),
      emailInput,
    ]),
    h("div", { className: "field" }, [
      h("label", { className: "field-label", for: "account-passcode-input" }, "Team Passcode"),
      passcodeInput,
    ]),
    errorNote,
    submitBtn,
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
  ]);

  const screen = h("div", { className: "screen account-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [card]),
  ]);

  mount(container, screen);
}
