// src/ui/screens/manageUsers.js
//
// Admin-only screen: list every registered account and promote/demote
// admin status or delete an account, via netlify/functions/adminUsers.js.
// Reachable only from Settings' "Manage Users" row, which itself only
// renders when authStore.isAdmin() is true — but this screen re-checks
// independently since the server is the real authority (see
// adminUsers.js's requireAdmin() — every action re-checks the passcode
// and the caller's own isAdmin flag on every single call).
//
// Deleting an account also deletes that account's cloud-saved plots
// (enforced server-side in adminUsers.js's handleDelete) — the confirm
// dialog here says so explicitly. An admin can't delete their own
// account (also enforced server-side), so a team can never accidentally
// lock itself out of admin access.

import { h, mount, clear } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { showConfirm } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import * as authStore from "../authStore.js";
import { navigate } from "../router.js";

const ENDPOINT = "/.netlify/functions/adminUsers";

async function callAdminUsers(payload) {
  const creds = authStore.getCredentials();
  if (!creds) throw new Error("Not signed in.");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, email: creds.email, passcode: creds.passcode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);
  return body;
}

export async function render(container) {
  const topBar = createTopBar({ title: "Manage Users", onBack: () => navigate("settings") });
  const bodyEl = h("div", { className: "screen-body" }, [h("p", { className: "empty-state" }, "Loading…")]);
  mount(container, h("div", { className: "screen manage-users-screen" }, [topBar, bodyEl]));

  if (!authStore.isAdmin()) {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, "Admin access required."));
    return;
  }

  async function load() {
    clear(bodyEl);
    bodyEl.appendChild(h("p", { className: "empty-state" }, "Loading…"));
    try {
      const creds = authStore.getCredentials();
      if (!creds) throw new Error("Not signed in.");
      const url = `${ENDPOINT}?email=${encodeURIComponent(creds.email)}&passcode=${encodeURIComponent(creds.passcode)}`;
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);

      clear(bodyEl);
      bodyEl.appendChild(h("h2", { className: "screen-heading" }, "Manage Users"));

      const users = body.users || [];
      if (users.length === 0) {
        bodyEl.appendChild(h("p", { className: "empty-state" }, "No registered users yet."));
        return;
      }

      const selfEmail = (authStore.getUser() || {}).email;

      for (const u of users) {
        const isSelf = u.email === selfEmail;
        const toggleBtn = h(
          "button",
          {
            type: "button",
            className: "btn btn-secondary",
            onclick: async () => {
              try {
                await callAdminUsers({ action: "setAdmin", targetEmail: u.email, isAdmin: !u.isAdmin });
                await load();
              } catch (e) {
                showToast(`Couldn't update ${u.name || u.email}: ${e.message}`, { type: "error" });
              }
            },
          },
          u.isAdmin ? "Remove Admin" : "Make Admin"
        );

        const deleteBtn = h(
          "button",
          {
            type: "button",
            className: "btn btn-danger",
            disabled: isSelf,
            title: isSelf ? "You can't delete your own account." : "",
            onclick: async () => {
              const ok = await showConfirm({
                title: "Delete This Account?",
                message: `This permanently deletes ${u.name || u.email}'s account and all of their cloud-saved plots. This can't be undone.`,
                confirmLabel: "Delete Account",
                destructive: true,
              });
              if (!ok) return;
              try {
                await callAdminUsers({ action: "delete", targetEmail: u.email });
                showToast(`Deleted ${u.name || u.email}.`);
                await load();
              } catch (e) {
                showToast(`Couldn't delete ${u.name || u.email}: ${e.message}`, { type: "error" });
              }
            },
          },
          "Delete"
        );

        bodyEl.appendChild(
          h("section", { className: "card manage-user-card" }, [
            h("div", { className: "manage-user-info" }, [
              h("h3", { className: "section-header" }, u.name || "(no name)"),
              h("p", { className: "field-note" }, u.email),
              h(
                "p",
                { className: "field-note" },
                u.isAdmin ? "Admin" : "Standard user"
              ),
            ]),
            h("div", { className: "manage-user-actions" }, [toggleBtn, deleteBtn]),
          ])
        );
      }
    } catch (e) {
      clear(bodyEl);
      bodyEl.appendChild(h("p", { className: "empty-state" }, `Couldn't load: ${e.message}`));
    }
  }

  await load();
}
