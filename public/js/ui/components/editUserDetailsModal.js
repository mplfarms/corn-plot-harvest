// src/ui/components/editUserDetailsModal.js
//
// A pre-filled, editable First Name / Last Name / Mobile Number form
// (Email shown, read-only — it's the account's identity, not something
// this form changes). Used two places: Settings' "Edit My Info" (a user
// editing their own details, via authStore.updateProfile()) and Manage
// Users' "☰" button (an admin editing ANY account's details, via
// updateProfile.js's adminEmail path — see manageUsers.js). This is the
// editable sibling of newUserDetailsModal.js's one-time "Welcome!" form —
// same fields, but pre-filled with existing values and labeled
// Save/Cancel instead of Continue/Skip.

import { h } from "../dom.js";
import { showCustomModal } from "./modal.js";

/**
 * @param {{title?: string, email: string, firstName?: string, lastName?: string, mobileNumber?: string}} opts
 * @returns {Promise<{firstName: string, lastName: string, mobileNumber: string}|null>}
 *   null if cancelled/dismissed without saving.
 */
export function promptEditUserDetails(opts) {
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
      value: opts.firstName || "",
    });
    const lastNameInput = h("input", {
      type: "text",
      className: "text-input",
      autocomplete: "family-name",
      value: opts.lastName || "",
    });
    const mobileInput = h("input", {
      type: "tel",
      className: "text-input",
      autocomplete: "tel",
      value: opts.mobileNumber || "",
    });
    const emailInput = h("input", {
      type: "email",
      className: "text-input",
      value: opts.email,
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
      field("First Name", firstNameInput),
      field("Last Name", lastNameInput),
      field("Mobile Number", mobileInput),
      field("Email", emailInput),
      h("div", { className: "modal-actions" }, [
        h("button", { type: "button", className: "btn btn-secondary", onclick: () => finish(null) }, "Cancel"),
        h("button", { type: "button", className: "btn btn-primary", onclick: submit }, "Save"),
      ]),
    ]);

    modal = showCustomModal({ title: opts.title || "Edit Info", bodyNode: body, onClose: () => finish(null) });

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
