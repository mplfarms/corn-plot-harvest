// src/ui/components/searchListPicker.js
//
// A full-screen-ish modal searchable list, mirroring
// ExtendableListPickerView.swift — used for Trait and Seed Treatment
// pickers in entryEditor.js (rather than the wheel style, since these
// lists can be long and benefit from search-to-filter).

import { h, clear, debounceGuard } from "../dom.js";
import { showCustomModal, showPrompt } from "./modal.js";

/**
 * @param {{
 *   title: string,
 *   value: string,
 *   options: string[],
 *   onChange: (value: string) => void,
 *   onAddNew?: (raw: string) => string,
 *   addNewPromptTitle?: string,
 *   addNewPromptMessage?: string,
 * }} opts
 */
export function openSearchListPicker(opts) {
  const { title, value, options, onChange, onAddNew, addNewPromptTitle, addNewPromptMessage } = opts;
  let query = "";
  let currentOptions = options.slice();

  const listEl = h("div", { className: "search-list", role: "listbox" });

  function renderList() {
    clear(listEl);
    const q = query.trim().toLowerCase();
    const filtered = q === "" ? currentOptions : currentOptions.filter((v) => v.toLowerCase().includes(q));

    if (filtered.length === 0) {
      listEl.appendChild(h("p", { className: "search-list-empty" }, "No matches."));
    }

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

    if (onAddNew) {
      listEl.appendChild(
        h(
          "div",
          {
            className: "search-list-option search-list-add-new",
            role: "option",
            tabindex: "0",
            onclick: debounceGuard(handleAddNew),
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleAddNew();
              }
            },
          },
          `+ Add New ${title}…`
        )
      );
    }
  }

  function selectAndClose(val) {
    onChange(val);
    modal.close();
  }

  async function handleAddNew() {
    const raw = await showPrompt({
      title: addNewPromptTitle || `Add New ${title}`,
      message: addNewPromptMessage || "",
      placeholder: `New ${title}`,
    });
    if (raw === null) return;
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
  });

  const body = h("div", { className: "search-list-body" }, [searchInput, listEl]);

  const modal = showCustomModal({ title, bodyNode: body });
  renderList();
  setTimeout(() => searchInput.focus(), 0);

  return modal;
}
