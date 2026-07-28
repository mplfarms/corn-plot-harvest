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
// Every field is REQUIRED — per explicit request (this replaced the
// original skippable version): there's no Skip button, the modal can't
// be dismissed (see showCustomModal's dismissable: false), and Continue
// refuses to proceed until First Name, Last Name, and Mobile Number are
// all filled in.

import { h } from "../dom.js";
import { showCustomModal } from "./modal.js";

/**
 * @param {{email: string}} opts
 * @returns {Promise<{firstName: string, lastName: string, mobileNumber: string}>}
 *   resolves only once every field is filled in — there is no skip/
 *   dismiss path anymore.
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

    const errorNote = h("p", { className: "field-note new-user-details-error hidden" }, "Please fill in every field to continue.");

    function submit() {
      const firstName = firstNameInput.value.trim();
      const lastName = lastNameInput.value.trim();
      const mobileNumber = mobileInput.value.trim();
      if (!firstName || !lastName || !mobileNumber) {
        errorNote.classList.remove("hidden");
        // Put the cursor in the first empty box so fixing it is one tap.
        const firstEmpty = [firstNameInput, lastNameInput, mobileInput].find((i) => !i.value.trim());
        if (firstEmpty) firstEmpty.focus();
        return;
      }
      finish({ firstName, lastName, mobileNumber });
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
      errorNote,
      h("div", { className: "modal-actions" }, [
        h("button", { type: "button", className: "btn btn-primary", onclick: submit }, "Continue"),
      ]),
    ]);

    // dismissable: false — no ✕, overlay taps ignored; Continue (with
    // every field filled) is the only way through. onClose stays absent
    // on purpose: nothing can call it.
    modal = showCustomModal({ title: "Welcome!", bodyNode: body, dismissable: false });

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
