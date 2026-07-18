// src/ui/screens/settings.js
//
// Settings screen, reachable from the workspace ("Home") menu. Currently
// holds a single setting: appearance (Light / Dark / System), using the
// same segmented-control look as plotSummary.js's metric switcher.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { BRANDS } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import * as themeStore from "../stores/themeStore.js";
import * as authStore from "../authStore.js";
import { doubleConfirm } from "../components/doubleConfirm.js";
import { showToast } from "../components/toast.js";
import { APP_VERSION } from "../../version.js";
import { navigate } from "../router.js";

const DELETE_ACCOUNT_ENDPOINT = "/.netlify/functions/deleteAccount";

const MODES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function render(container) {
  const topBar = createTopBar({
    title: "Settings",
    onBack: () => navigate("workspace"),
  });

  const mode = themeStore.getState().mode;

  const segmented = h(
    "div",
    { className: "segmented-control" },
    MODES.map((m) =>
      h(
        "button",
        {
          type: "button",
          className: "segmented-btn" + (m.value === mode ? " segmented-btn-active" : ""),
          "aria-pressed": m.value === mode ? "true" : "false",
          onclick: () => {
            themeStore.setMode(m.value);
            render(container);
          },
        },
        m.label
      )
    )
  );

  const appearanceCard = h("section", { className: "card" }, [
    h("h3", { className: "section-header" }, "Appearance"),
    h(
      "p",
      { className: "field-note" },
      "System follows your device's light/dark setting automatically."
    ),
    segmented,
  ]);

  // ---- Brand View ----
  const selectedBrandId = brandStore.getState().selectedBrand;
  const brandSegmented = h(
    "div",
    { className: "segmented-control brand-view-segmented" },
    Object.values(BRANDS).map((b) =>
      h(
        "button",
        {
          type: "button",
          className: "segmented-btn brand-view-btn" + (b.id === selectedBrandId ? " segmented-btn-active" : ""),
          "aria-pressed": b.id === selectedBrandId ? "true" : "false",
          "aria-label": b.displayName,
          title: b.displayName,
          onclick: () => {
            if (b.id === selectedBrandId) return;
            libraryStore.flushDraftToLibrary();
            brandStore.selectBrand(b.id);
            render(container);
          },
        },
        h("img", { className: "brand-view-logo", src: b.logo, alt: b.displayName })
      )
    )
  );

  const brandCard = h("section", { className: "card" }, [
    h("h3", { className: "section-header" }, "Brand View"),
    h("p", { className: "field-note" }, "Select Brand View"),
    brandSegmented,
  ]);

  // ---- Account ----
  const user = authStore.getUser();

  // Self-service account deletion (netlify/functions/deleteAccount.js):
  // every saved plot transfers to the farm's designated admin account
  // first (tagged with transferredFrom — see savedPlots.js's badge), so
  // nothing is lost, then this account is gone for good. Executes
  // immediately once confirmed (no admin approval step, per explicit
  // request) — doubleConfirm()'s two-step "type DELETE" dialog is the
  // safeguard against an accidental tap, not a review gate. The one
  // account this can never be used on (the farm's bootstrap admin) just
  // gets a clear error back from the server if attempted — not worth
  // special-casing client-side for what's a single, well-known account.
  async function handleDeleteMyAccount() {
    const ok = await doubleConfirm({
      title: "Delete My Account?",
      message:
        "This permanently deletes your account. Every plot you've saved to the cloud transfers to your farm's admin account first, so nothing is lost — but you'll be signed out immediately and this account itself can't be recovered.",
      confirmLabel: "Delete My Account",
    });
    if (!ok) return;
    try {
      const res = await fetch(DELETE_ACCOUNT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);
      authStore.signOut();
      navigate("account");
      showToast(
        `Your account was deleted. ${body.transferredCount} saved plot${
          body.transferredCount === 1 ? "" : "s"
        } transferred to ${body.transferredToName}.`
      );
    } catch (e) {
      showToast(`Couldn't delete your account: ${e.message}`, { type: "error" });
    }
  }

  const accountCard = h(
    "section",
    { className: "card account-card" },
    user
      ? [
          h("h3", { className: "section-header" }, "Account"),
          h("p", { className: "account-status-text" }, `Signed in as ${user.email}`),
          h(
            "button",
            {
              type: "button",
              className: "btn btn-secondary",
              onclick: () => {
                authStore.signOut();
                // Signing in is mandatory (see accountScreen.js /
                // router.js) — head straight back to the launch/sign-in
                // screen rather than leaving this screen rendered in a
                // signed-out state.
                navigate("account");
              },
            },
            "Sign Out"
          ),
          h(
            "button",
            {
              type: "button",
              className: "btn btn-danger",
              onclick: handleDeleteMyAccount,
            },
            "Delete My Account"
          ),
        ]
      : [
          h("h3", { className: "section-header" }, "Account"),
          h("p", { className: "account-status-text" }, "Not signed in."),
          h(
            "button",
            {
              type: "button",
              className: "btn btn-secondary",
              onclick: () => navigate("account"),
            },
            "Sign In"
          ),
        ]
  );

  // Available to every signed-in user, not just admins — the Help screen
  // (help.js) itself has a section describing admin-only features, but
  // reading about them doesn't require being one.
  const helpCard = h("section", { className: "card" }, [
    h("h3", { className: "section-header" }, "Help"),
    h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-block",
        onclick: () => navigate("help"),
      },
      "Help & How-To Guide"
    ),
  ]);

  // Admin-only — visible only when the signed-in user's own stored record
  // has isAdmin === true (server re-checks this on every call anyway; see
  // manageUsers.js and _shared.js's requireAdmin()).
  const manageUsersCard = authStore.isAdmin()
    ? h("section", { className: "card" }, [
        h("h3", { className: "section-header" }, "Admin"),
        h(
          "button",
          {
            type: "button",
            className: "btn btn-secondary btn-block",
            onclick: () => navigate("manage-users"),
          },
          "Manage Users"
        ),
      ])
    : null;

  const versionFooter = h("p", { className: "settings-version-footer" }, `Corn Plot Harvest ${APP_VERSION}`);

  const screen = h("div", { className: "screen settings-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      h("h2", { className: "screen-heading" }, "Settings"),
      appearanceCard,
      brandCard,
      accountCard,
      helpCard,
      manageUsersCard,
      versionFooter,
    ]),
  ]);

  mount(container, screen);
}
