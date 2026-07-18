// src/ui/components/newUserDetailsModal.js
//
// The one-time "Welcome!" form shown right after a brand-new email signs
// in for the first time (see accountScreen.js's isNewUser branch) —
// collects First Name, Last Name, and Mobile Number, and shows the Email
// address they just signed in with (read-only — it's already the
// account's identity, nothing to type again). This gives the admin
// screens (Manage Users, All Plots) something far more useful than a
// bare email to head each user's card with, and gives All Plots' new "☰"
// per-user detail popover a phone number to show.
//
// Answering is optional — tapping Skip (or the modal's own ✕/overlay
// dismiss) leaves the account working exactly as it did before this
// feature existed (name defaults to the email, phone stays blank); this
// mirrors the old single "what's your name?" prompt it replaces, which
// was also skippable.

import { h } from "../dom.js";
import { showCustomModal } from "./modal.js";

/**
 * @param {{email: string}} opts
 * @returns {Promise<{firstName: string, lastName: string, mobileNumber: string}|null>}
 *   null if skipped/dismissed without entering anything usable.
 */
export function promptNewUserDetails({ email }) {
  return new Promise((resolve) => {
    let resolved = false;
    let modal;

    function finish(result) {
      if (resolved) return;
      resolved = true;
      modal.close();
      resolve(result);
    }

    const firstNameInput = h("input", {
      type: "text",
      className: "text-input",
      autocomplete: "given-name",
      placeholder: "First name",
    });
    const lastNameInput = h("input", {
      type: "text",
      className: "text-input",
      autocomplete: "family-name",
      placeholder: "Last name",
    });
    const mobileInput = h("input", {
      type: "tel",
      className: "text-input",
      autocomplete: "tel",
      placeholder: "(555) 555-5555",
    });
    const emailInput = h("input", {
      type: "email",
      className: "text-input",
      value: email,
      disabled: true,
    });

    function submit() {
      finish({
        firstName: firstNameInput.value.trim(),
        lastName: lastNameInput.value.trim(),
        mobileNumber: mobileInput.value.trim(),
      });
    }

    function field(labelText, input) {
      return h("div", { className: "field" }, [h("label", { className: "field-label" }, labelText), input]);
    }

    const body = h("div", { className: "new-user-details-body" }, [
      h(
        "p",
        { className: "field-note" },
        "This helps your admin tell everyone's plots apart — especially on All Plots (Admin)."
      ),
      field("First Name", firstNameInput),
      field("Last Name", lastNameInput),
      field("Mobile Number", mobileInput),
      field("Email", emailInput),
      h("div", { className: "modal-actions" }, [
        h("button", { type: "button", className: "btn btn-secondary", onclick: () => finish(null) }, "Skip"),
        h("button", { type: "button", className: "btn btn-primary", onclick: submit }, "Continue"),
      ]),
    ]);

    modal = showCustomModal({ title: "Welcome!", bodyNode: body, onClose: () => finish(null) });

    for (const input of [firstNameInput, lastNameInput, mobileInput]) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    }

    setTimeout(() => firstNameInput.focus(), 0);
  });
}
