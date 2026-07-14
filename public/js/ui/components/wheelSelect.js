// src/ui/components/wheelSelect.js
//
// Tap-to-expand "wheel" picker row, approximating WheelSelectRow /
// ExtendableWheelSelectRow from the native SwiftUI app. True native
// .wheel picker style isn't a web primitive, so this uses a scrollable
// list with CSS scroll-snap (roughly 3 rows tall, center row
// highlighted) — but selection also commits on a plain click/Enter on
// any row, so it works with mouse, keyboard, and touch alike, not just
// scroll-and-release.

import { h, clear, createTapGuard } from "../dom.js";
import { showPrompt } from "./modal.js";

/**
 * @param {Array<string|{label:string,value:string}>} options
 * @returns {Array<{label:string,value:string}>}
 */
function normalizeOptions(options) {
  return (options || []).map((opt) =>
    typeof opt === "string" ? { label: opt, value: opt } : { label: opt.label, value: opt.value }
  );
}

/**
 * @param {{
 *   title: string,
 *   value: string,
 *   options: Array<string|{label:string,value:string}>,
 *   onChange: (value: string) => void,
 *   placeholder?: string,
 *   extendable?: boolean,
 *   onAddNew?: (raw: string) => string,
 *   addNewPromptTitle?: string,
 *   addNewPromptMessage?: string,
 *   disabled?: boolean,
 *   disabledReason?: string,
 * }} opts
 */
function createWheelSelectBase(opts) {
  const {
    title,
    onChange,
    placeholder,
    extendable = false,
    onAddNew = null,
    addNewPromptTitle = null,
    addNewPromptMessage = "",
  } = opts;

  let currentValue = opts.value;
  let currentOptions = normalizeOptions(opts.options);
  let expanded = false;
  let disabled = Boolean(opts.disabled);
  let disabledReason = opts.disabledReason || "";

  // See createTapGuard's doc comment in dom.js — a single mobile tap can
  // dispatch more than one "click" event, which would otherwise toggle
  // this open then immediately closed again (or select-then-reselect).
  // One guard instance is shared across every render of this component,
  // since the header/options are rebuilt on every toggle/selection.
  const guard = createTapGuard();

  const root = h("div", { className: "wheel-row" });

  function displayLabelFor(val) {
    if (val === null || val === undefined || val === "") return null;
    const found = currentOptions.find((o) => o.value === val);
    return found ? found.label : val;
  }

  function render() {
    root.className = "wheel-row" + (disabled ? " wheel-row-disabled" : "");
    clear(root);
    const displayLabel = displayLabelFor(currentValue);

    const header = h(
      "button",
      {
        type: "button",
        className: "wheel-row-header",
        "aria-expanded": expanded ? "true" : "false",
        disabled: disabled,
        onclick: guard(() => {
          if (disabled) return;
          expanded = !expanded;
          render();
        }),
      },
      [
        h("span", { className: "wheel-row-label" }, title),
        h(
          "span",
          { className: "wheel-row-value" + (displayLabel ? "" : " wheel-row-placeholder") },
          displayLabel || placeholder || "Select…"
        ),
        h("span", { className: "wheel-chevron" + (expanded ? " wheel-chevron-open" : "") }, "⌄"),
      ]
    );
    root.appendChild(header);

    if (disabled && disabledReason) {
      root.appendChild(h("p", { className: "wheel-disabled-reason" }, disabledReason));
    }

    if (expanded && !disabled) {
      root.appendChild(buildPanel());
    }
  }

  function commit(val) {
    currentValue = val;
    expanded = false;
    render();
    if (onChange) onChange(val);
  }

  function buildPanel() {
    const scrollEl = h("div", { className: "wheel-scroll", role: "listbox", tabindex: "0" });
    scrollEl.appendChild(h("div", { className: "wheel-spacer", "aria-hidden": "true" }));

    for (const opt of currentOptions) {
      const isSelected = opt.value === currentValue;
      scrollEl.appendChild(
        h(
          "div",
          {
            className: "wheel-option" + (isSelected ? " wheel-option-selected" : ""),
            role: "option",
            "aria-selected": isSelected ? "true" : "false",
            tabindex: "0",
            onclick: guard(() => commit(opt.value)),
            onkeydown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                commit(opt.value);
              }
            },
          },
          opt.label
        )
      );
    }

    if (extendable) {
      scrollEl.appendChild(
        h(
          "div",
          {
            className: "wheel-option wheel-option-add-new",
            role: "option",
            tabindex: "0",
            onclick: guard(handleAddNew),
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

    scrollEl.appendChild(h("div", { className: "wheel-spacer", "aria-hidden": "true" }));

    const panel = h("div", { className: "wheel-panel" }, scrollEl);

    requestAnimationFrame(() => {
      const selectedEl = scrollEl.querySelector(".wheel-option-selected");
      const target = selectedEl || scrollEl.querySelector(".wheel-option");
      if (target && target.scrollIntoView) target.scrollIntoView({ block: "center", behavior: "auto" });
    });

    return panel;
  }

  async function handleAddNew() {
    const raw = await showPrompt({
      title: addNewPromptTitle || `Add New ${title}`,
      message: addNewPromptMessage,
      placeholder: `New ${title}`,
    });
    if (raw === null) return; // cancelled
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const selected = onAddNew ? onAddNew(trimmed) : trimmed;
    if (!selected) return;
    if (!currentOptions.some((o) => o.value === selected)) {
      currentOptions = [...currentOptions, { label: selected, value: selected }];
    }
    commit(selected);
  }

  render();

  return {
    el: root,
    /** @param {string} val */
    setValue(val) {
      currentValue = val;
      render();
    },
    /** @param {Array<string|{label:string,value:string}>} opts */
    setOptions(opts) {
      currentOptions = normalizeOptions(opts);
      render();
    },
    /**
     * @param {boolean} nextDisabled
     * @param {string} [reason]
     */
    setDisabled(nextDisabled, reason) {
      disabled = nextDisabled;
      if (reason !== undefined) disabledReason = reason;
      if (disabled) expanded = false;
      render();
    },
  };
}

/**
 * @param {{title: string, value: string, options: Array<string|{label:string,value:string}>, onChange: (value:string)=>void, placeholder?: string}} opts
 */
export function createWheelSelect(opts) {
  return createWheelSelectBase({ ...opts, extendable: false });
}

/**
 * @param {{
 *   title: string, value: string, options: Array<string|{label:string,value:string}>,
 *   onChange: (value:string)=>void, onAddNew: (raw:string)=>string,
 *   placeholder?: string, disabledReason?: string, disabled?: boolean,
 *   addNewPromptTitle?: string, addNewPromptMessage?: string,
 * }} opts
 */
export function createExtendableWheelSelect(opts) {
  return createWheelSelectBase({ ...opts, extendable: true });
}
