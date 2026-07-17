// src/ui/screens/adminPlots.js
//
// Admin-only screen (requires the caller's own stored user record to have
// isAdmin === true — see authStore.isAdmin(); admins are promoted/demoted
// in-app via the Manage Users screen, see manageUsers.js) listing every
// signed-in user's saved plots via GET /.netlify/functions/plots?
// scope=all. Tapping a plot row starts a full admin-edit session (see
// adminEditStore.js) and lands on the Plot Workspace menu, where Plot
// Details / Plot Hybrids / Plot Summary all work exactly as normal (the
// trial is loaded into the same trialStore draft slot real editing
// always uses) — full read/write, not a read-only view. Before swapping
// the draft, the admin's OWN in-progress draft (if any) is flushed to
// their own local library first so it's never at risk even if the
// browser closes mid admin-edit; adminEditStore then restores it exactly
// once the admin-edit session ends (Save or Discard, both in
// workspaceMenu.js). Reachable from the Home Screen's "All Plots
// (Admin)" button (plotChooser.js) and from the Plot Workspace menu's
// own row (workspaceMenu.js), both of which only render when
// authStore.isAdmin() is true — but this screen re-checks independently
// since the server is the real authority (a stale client-side role check
// should never be trusted alone; the function itself also re-checks the
// caller's own isAdmin flag, returning 403 if it isn't set — see
// netlify/functions/plots.js).

import { h, mount, clear } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import * as authStore from "../authStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import * as adminEditStore from "../stores/adminEditStore.js";
import { navigate } from "../router.js";

export async function render(container) {
  const topBar = createTopBar({ title: "All Plots (Admin)", onBack: () => navigate("plot-chooser") });
  const bodyEl = h("div", { className: "screen-body" }, [h("p", { className: "empty-state" }, "Loading…")]);
  mount(container, h("div", { className: "screen admin-plots-screen" }, [topBar, bodyEl]));

  if (!authStore.isAdmin()) {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, "Admin access required."));
    return;
  }

  try {
    const creds = authStore.getCredentials();
    if (!creds) throw new Error("Not signed in.");
    const url = `/.netlify/functions/plots?scope=all&email=${encodeURIComponent(creds.email)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const { users } = await res.json();

    clear(bodyEl);
    bodyEl.appendChild(h("h2", { className: "screen-heading" }, "All Plots (Admin)"));

    if (!users || users.length === 0) {
      bodyEl.appendChild(h("p", { className: "empty-state" }, "No cloud-synced plots yet."));
      return;
    }

    for (const u of users) {
      const ownerLabel = u.name || u.email;
      const rows =
        u.trials.length === 0
          ? [h("p", { className: "empty-state" }, "No saved plots.")]
          : u.trials.map((t) =>
              h("li", { className: "brand-average-row" }, [
                h(
                  "button",
                  {
                    type: "button",
                    className: "admin-plot-row",
                    onclick: () => {
                      libraryStore.flushDraftToLibrary();
                      adminEditStore.begin({
                        ownerEmail: u.email,
                        ownerName: u.name,
                        allTrials: u.trials,
                        editingTrial: t,
                      });
                      navigate("workspace");
                    },
                  },
                  [
                    h("span", { className: "brand-average-name" }, (t.header.cooperatorName || "").trim() || "Untitled Plot"),
                    h(
                      "span",
                      { className: "brand-average-value" },
                      `${t.entries.length} ${t.entries.length === 1 ? "entry" : "entries"} ›`
                    ),
                  ]
                ),
              ])
            );
      bodyEl.appendChild(
        h("section", { className: "card" }, [
          h("h3", { className: "section-header" }, ownerLabel),
          u.trials.length === 0 ? rows[0] : h("ul", { className: "brand-average-list" }, rows),
        ])
      );
    }
  } catch (e) {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, `Couldn't load: ${e.message}`));
  }
}
