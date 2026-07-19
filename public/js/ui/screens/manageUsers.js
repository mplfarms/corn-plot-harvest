// src/ui/screens/manageUsers.js
//
// Admin-only screen: list every registered account and promote/demote
// admin status, delete an account, or merge one account into another,
// via netlify/functions/adminUsers.js. Reachable only from Settings'
// "Manage Users" row, which itself only renders when
// authStore.isAdmin() is true — but this screen re-checks independently
// since the server is the real authority (see adminUsers.js's
// requireAdmin() — every action re-checks the caller's own isAdmin flag
// on every single call).
//
// Deleting an account also deletes that account's cloud-saved plots
// (enforced server-side in adminUsers.js's handleDelete) — the confirm
// dialog here says so explicitly. An admin can't delete their own
// account (also enforced server-side), so a team can never accidentally
// lock itself out of admin access.
//
// "Merge Into…" exists for the common real case: the same person shows
// up as two separate accounts on the All Plots (Admin) screen because
// they signed in with a different email on a different device (see
// adminUsers.js's handleMerge() comment) — this moves the source
// account's saved plots onto the chosen target account and deletes the
// source account, so it stops showing up as a duplicate.
//
// Both Delete and Merge Into… use doubleConfirm() rather than a single
// showConfirm() — these move or delete an entire account's worth of
// data at once, so a first dialog explains the consequences and a
// second step requires typing "DELETE" before anything actually
// happens, matching deleteAccount.js's self-service equivalent.
//
// Each card's header also has a "☰" button (same look as All Plots
// (Admin)'s — see adminPlots.js) — here it opens an EDITABLE First
// Name/Last Name/Mobile Number form (editUserDetailsModal.js) rather
// than a read-only one, since this screen's whole job is managing user
// accounts: an admin can fix up ANY user's details from here, via
// updateProfile.js's adminEmail path.

import { h, mount, clear } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { doubleConfirm } from "../components/doubleConfirm.js";
import { promptEditUserDetails } from "../components/editUserDetailsModal.js";
import { showToast } from "../components/toast.js";
import { openSearchListPicker } from "../components/searchListPicker.js";
import * as authStore from "../authStore.js";
import { navigate } from "../router.js";

const ENDPOINT = "/.netlify/functions/adminUsers";
const UPDATE_PROFILE_ENDPOINT = "/.netlify/functions/updateProfile";

async function callAdminUsers(payload) {
  const creds = authStore.getCredentials();
  if (!creds) throw new Error("Not signed in.");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, email: creds.email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);
  return body;
}

async function callUpdateProfile(payload) {
  const creds = authStore.getCredentials();
  if (!creds) throw new Error("Not signed in.");
  const res = await fetch(UPDATE_PROFILE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, adminEmail: creds.email }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);
  return body;
}

export async function render(container) {
  // This is a round trip back to wherever Settings was actually opened
  // from, not a new arrival there — see router.js's rememberedOriginFor().
  const topBar = createTopBar({ title: "Manage Users", onBack: () => navigate("settings", { _skipOriginTracking: true }) });
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
      const url = `${ENDPOINT}?email=${encodeURIComponent(creds.email)}`;
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

      function userLabel(u) {
        return u.name && u.name !== u.email ? `${u.name} (${u.email})` : u.email;
      }

      async function handleMergeInto(sourceUser) {
        const others = users.filter((other) => other.email !== sourceUser.email);
        if (others.length === 0) {
          showToast("There's no other account to merge into.", { type: "error" });
          return;
        }
        const labelToUser = new Map(others.map((other) => [userLabel(other), other]));
        openSearchListPicker({
          title: `Merge "${userLabel(sourceUser)}" Into…`,
          value: "",
          options: Array.from(labelToUser.keys()),
          // The modal system (modal.js) is a single shared overlay, not a
          // stack — selectAndClose() inside the picker calls onChange
          // (this function) and THEN immediately calls the picker's own
          // modal.close(), which clears the overlay. Opening the confirm
          // dialog synchronously in here would mount it into that same
          // overlay only to have the picker's close() wipe it out right
          // after. Deferring to the next tick lets the picker's close()
          // run first, so the confirm dialog mounts into an overlay
          // that's actually empty and stays put.
          onChange: (label) => setTimeout(() => handleMergeTargetChosen(sourceUser, labelToUser.get(label)), 0),
        });
      }

      async function handleEditDetails(u) {
        const result = await promptEditUserDetails({
          title: `Edit ${userLabel(u)}`,
          email: u.email,
          firstName: u.firstName || "",
          lastName: u.lastName || "",
          mobileNumber: u.mobileNumber || "",
        });
        if (!result) return;
        try {
          await callUpdateProfile({ email: u.email, ...result });
          showToast(`Updated ${result.firstName || u.email}'s info.`);
          await load();
        } catch (e) {
          showToast(`Couldn't update ${u.name || u.email}: ${e.message}`, { type: "error" });
        }
      }

      async function handleMergeTargetChosen(sourceUser, targetUser) {
        if (!targetUser) return;
        const ok = await doubleConfirm({
          title: "Merge Accounts?",
          message: `This moves every saved plot from ${userLabel(sourceUser)} onto ${userLabel(
            targetUser
          )}, then permanently deletes the ${userLabel(sourceUser)} account. This can't be undone.`,
          confirmLabel: "Merge Accounts",
        });
        if (!ok) return;
        try {
          const result = await callAdminUsers({ action: "merge", sourceEmail: sourceUser.email, targetEmail: targetUser.email });
          showToast(`Merged into ${userLabel(targetUser)} — ${result.mergedTrialCount} total saved plot(s) now on that account.`);
          await load();
        } catch (e) {
          showToast(`Couldn't merge: ${e.message}`, { type: "error" });
        }
      }

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

        const mergeBtn = h(
          "button",
          {
            type: "button",
            className: "btn btn-secondary",
            disabled: users.length < 2,
            title: users.length < 2 ? "There's no other account to merge into." : "",
            onclick: () => handleMergeInto(u),
          },
          "Merge Into…"
        );

        const deleteBtn = h(
          "button",
          {
            type: "button",
            className: "btn btn-danger",
            disabled: isSelf,
            title: isSelf ? "You can't delete your own account." : "",
            onclick: async () => {
              const ok = await doubleConfirm({
                title: "Delete This Account?",
                message: `This permanently deletes ${u.name || u.email}'s account and all of their cloud-saved plots. This can't be undone.`,
                confirmLabel: "Delete Account",
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

        const menuBtn = h(
          "button",
          {
            type: "button",
            className: "admin-user-menu-btn",
            "aria-label": `Edit ${userLabel(u)}`,
            title: "Edit this user's info",
            onclick: () => handleEditDetails(u),
          },
          "☰"
        );

        bodyEl.appendChild(
          h("section", { className: "card manage-user-card" }, [
            h("div", { className: "section-header admin-user-header" }, [
              h("p", { className: "admin-user-header-name" }, u.name || "(no name)"),
              menuBtn,
            ]),
            h("div", { className: "manage-user-card-body" }, [
              h("div", { className: "manage-user-info" }, [
                h("p", { className: "field-note" }, u.email),
                h("p", { className: "field-note" }, u.isAdmin ? "Admin" : "Standard user"),
              ]),
              h("div", { className: "manage-user-actions" }, [toggleBtn, mergeBtn, deleteBtn]),
            ]),
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
