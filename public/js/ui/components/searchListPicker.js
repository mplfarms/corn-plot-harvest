// src/ui/components/searchListPicker.js
//
// A full-screen-ish modal searchable list, mirroring
// ExtendableListPickerView.swift — used for Brand/Company, Hybrid, Trait,
// and Seed Treatment pickers in entryEditor.js (rather than the wheel
// style, since these lists can be long and benefit from search-to-filter),
// and (without onAddNew) for the ZIP code picker in trialDetails.js and the
// merge-user picker in manageUsers.js.

import { h, clear, debounceGuard } from "../dom.js";
import { showCustomModal } from "./modal.js";

/**
 * @param {{
 *   title: string,
 *   value: string,
 *   options: string[],
 *   onChange: (value: string) => void,
 *   onAddNew?: (raw: string) => string,
 *   addNewHint?: string,
 * }} opts
 */
export function openSearchListPicker(opts) {
  const { title, value, options, onChange, onAddNew, addNewHint } = opts;
  let query = "";
  let currentOptions = options.slice();

  const listEl = h("div", { className: "search-list", role: "listbox" });

  // Per explicit request, there's no separate "+ Add New…" row + popup
  // prompt anymore — instead, typing a name that doesn't already exist
  // shows a live `+ Add "{query}"` row right in the filtered list, and
  // tapping/Entering it adds AND selects it in one step, no second modal.
  // handleAddNew() below does the add directly with whatever raw text is
  // passed to it (no showPrompt() call), so it's usable both from that
  // inline row and from the Enter-key shortcut in the search input.
  function matchingAddNewRaw() {
    if (!onAddNew) return null;
    const trimmed = query.trim();
    if (trimmed === "") return null;
    const lower = trimmed.toLowerCase();
    const alreadyExists = currentOptions.some((v) => v.toLowerCase() === lower);
    if (alreadyExists) return null;
    return trimmed;
  }

  function renderList() {
    clear(listEl);
    const q = query.trim().toLowerCase();
    const filtered = q === "" ? currentOptions : currentOptions.filter((v) => v.toLowerCase().includes(q));

    for (const opt of filtered) {
      const isSelected = opt === value;
      listEl.appendChild(
        h(
          "div",
          {
            className: "search-list-option" + (isSelected ? " search-list-option-selected" : ""),
            role: "option",
            tabindex: "0",
            "aria-selected": isSelected ? "true" : "false",
            onclick: debounceGuard(() => selectAndClose(opt)),
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                selectAndClose(opt);
              }
            },
          },
          opt
        )
      );
    }

    const addNewRaw = matchingAddNewRaw();
    if (addNewRaw !== null) {
      listEl.appendChild(
        h(
          "div",
          {
            className: "search-list-option search-list-add-new",
            role: "option",
            tabindex: "0",
            onclick: debounceGuard(() => handleAddNew(addNewRaw)),
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleAddNew(addNewRaw);
              }
            },
          },
          `+ Add "${addNewRaw}"`
        )
      );
    }

    if (filtered.length === 0 && addNewRaw === null) {
      listEl.appendChild(h("p", { className: "search-list-empty" }, "No matches."));
    }
  }

  function selectAndClose(val) {
    onChange(val);
    modal.close();
  }

  function handleAddNew(raw) {
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const selected = onAddNew(trimmed);
    if (!selected) return;
    if (!currentOptions.includes(selected)) currentOptions = [...currentOptions, selected];
    selectAndClose(selected);
  }

  const searchInput = h("input", {
    type: "search",
    className: "search-list-input",
    placeholder: `Search ${title}…`,
    oninput: (e) => {
      query = e.target.value;
      renderList();
    },
    onkeydown: (e) => {
      // Enter in the search box: if there's exactly one filtered match,
      // pick it; otherwise, if the typed text is addable, add it — so a
      // user who just types a brand-new name and hits Enter never has to
      // reach for the mouse/tap target at all.
      if (e.key !== "Enter") return;
      const q = query.trim().toLowerCase();
      const filtered = q === "" ? currentOptions : currentOptions.filter((v) => v.toLowerCase().includes(q));
      const addNewRaw = matchingAddNewRaw();
      if (filtered.length === 1 && addNewRaw === null) {
        e.preventDefault();
        selectAndClose(filtered[0]);
      } else if (addNewRaw !== null) {
        e.preventDefault();
        handleAddNew(addNewRaw);
      }
    },
  });

  const bodyChildren = [searchInput];
  // addNewHint is a static caption shown right under the search input
  // whenever this field supports adding new values — always visible
  // (rather than buried behind a click, the way the old "+ Add New…" row's
  // popup message used to be), so context like Hybrid's brand-scoping note
  // ("this is added under {brand}...") is still communicated even though
  // there's no longer a separate add-new prompt to show it in.
  if (onAddNew && addNewHint) {
    bodyChildren.push(h("p", { className: "search-list-add-new-hint" }, addNewHint));
  }
  bodyChildren.push(listEl);

  const body = h("div", { className: "search-list-body" }, bodyChildren);

  const modal = showCustomModal({ title, bodyNode: body });
  renderList();
  setTimeout(() => searchInput.focus(), 0);

  return modal;
}
