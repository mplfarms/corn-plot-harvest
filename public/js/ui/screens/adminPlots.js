// src/ui/screens/adminPlots.js
//
// Admin-only screen (requires the caller's own stored user record to have
// isAdmin === true — see authStore.isAdmin(); admins are promoted/demoted
// in-app via the Manage Users screen, see manageUsers.js) listing every
// signed-in user's saved plots via GET /.netlify/functions/plots?
// scope=all. Read-only: no edit/delete here, just cross-operation
// visibility. Reachable only via workspaceMenu's "All Plots (Admin)"
// row, which itself only renders when authStore.isAdmin() is true — but
// this screen re-checks independently since the server is the real
// authority (a stale client-side role check should never be trusted
// alone; the function itself also re-checks the caller's own isAdmin
// flag and the shared passcode, returning 403/401 if either fails — see
// netlify/functions/plots.js).

import { h, mount, clear } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import * as authStore from "../authStore.js";
import { navigate } from "../router.js";

export async function render(container) {
  const topBar = createTopBar({ title: "All Plots (Admin)", onBack: () => navigate("workspace") });
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
    const url = `/.netlify/functions/plots?scope=all&email=${encodeURIComponent(creds.email)}&passcode=${encodeURIComponent(creds.passcode)}`;
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
      const rows =
        u.trials.length === 0
          ? [h("p", { className: "empty-state" }, "No saved plots.")]
          : u.trials.map((t) =>
              h("li", { className: "brand-average-row" }, [
                h("span", { className: "brand-average-name" }, (t.header.cooperatorName || "").trim() || "Untitled Plot"),
                h(
                  "span",
                  { className: "brand-average-value" },
                  `${t.entries.length} ${t.entries.length === 1 ? "entry" : "entries"}`
                ),
              ])
            );
      bodyEl.appendChild(
        h("section", { className: "card" }, [
          h("h3", { className: "section-header" }, u.name || u.email),
          u.trials.length === 0 ? rows[0] : h("ul", { className: "brand-average-list" }, rows),
        ])
      );
    }
  } catch (e) {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, `Couldn't load: ${e.message}`));
  }
}
