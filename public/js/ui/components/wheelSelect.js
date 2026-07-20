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
    // False when the caller already shows `title` as a field label above
    // this row (see field() in the screens that use it) — showing it a
    // second time inside the row itself is redundant. Defaults to true
    // so every other existing caller (this row used on its own, with no
    // label above it) is unaffected.
    showLabel = true,
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
        showLabel ? h("span", { className: "wheel-row-label" }, title) : null,
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

  // Previously this reserved a fixed-height, always-centered "wheel" with
  // blank spacer rows above/below the options so scroll-snap could center
  // the first/last item. That spacer is what showed up as a persistent
  // blank line at the top of the list — most visibly whenever the
  // currently selected value was the first (or an early) option, since
  // centering it still requires scrolling space above. Instead, this is
  // now a plain top-anchored list: it never reserves blank space, and
  // just caps its height and scrolls (see .wheel-scroll's max-height) once
  // there are more options than fit.
  function buildPanel() {
    const scrollEl = h("div", { className: "wheel-scroll", role: "listbox", tabindex: "0" });

    // Type-to-jump: for any list long enough that scrolling through it by
    // hand is a chore (the exact "over ten items" cutoff requested),
    // typing a letter while the list is open scrolls straight to (and
    // focuses) the first option starting with what's been typed —
    // pressing the SAME letter again jumps to the next match after that
    // one (standard native <select> behavior); typing a DIFFERENT letter
    // right after narrows to a fresh multi-character prefix instead of
    // starting over. optionEls is built in lockstep with currentOptions
    // below so the two stay index-aligned.
    const typeaheadEnabled = currentOptions.length > 10;
    const optionEls = [];
    let typeaheadBuffer = "";
    let typeaheadTimer = null;

    function jumpToTypeahead(char) {
      const isRepeatSameChar = typeaheadBuffer.length > 0 && typeaheadBuffer.split("").every((c) => c === char);
      typeaheadBuffer = isRepeatSameChar ? typeaheadBuffer + char : char;
      clearTimeout(typeaheadTimer);
      // Resets to "start a fresh search" after a short pause, same as a
      // native <select>'s type-ahead — this is what lets typing "Wa"
      // quickly narrow to "Washington" while typing "W" ... (pause) ...
      // "a" instead searches for "a" on its own.
      typeaheadTimer = setTimeout(() => {
        typeaheadBuffer = "";
      }, 700);

      const searchTerm = isRepeatSameChar ? char : typeaheadBuffer;
      const n = optionEls.length;
      if (n === 0) return;

      let startIndex = 0;
      if (isRepeatSameChar) {
        const activeIndex = optionEls.indexOf(document.activeElement);
        startIndex = activeIndex >= 0 ? activeIndex + 1 : 0;
      }

      for (let i = 0; i < n; i++) {
        const idx = (startIndex + i) % n;
        if (currentOptions[idx].label.toLowerCase().startsWith(searchTerm)) {
          optionEls[idx].scrollIntoView({ block: "nearest", behavior: "auto" });
          optionEls[idx].focus();
          return;
        }
      }
    }

    if (typeaheadEnabled) {
      scrollEl.addEventListener("keydown", (e) => {
        // Single printable character, no modifier held — anything else
        // (Enter, Space, Tab, arrow keys, Ctrl/Cmd combos, ...) passes
        // through untouched to the option's own onkeydown/native
        // scrolling below.
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
        const char = e.key.toLowerCase();
        if (!/[a-z0-9]/.test(char)) return;
        e.preventDefault();
        jumpToTypeahead(char);
      });
    }

    for (const opt of currentOptions) {
      const isSelected = opt.value === currentValue;
      const optionEl = h(
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
      );
      optionEls.push(optionEl);
      scrollEl.appendChild(optionEl);
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

    const panel = h("div", { className: "wheel-panel" }, scrollEl);

    // Bring the current selection into view without ever introducing
    // blank space above it — "nearest" scrolls only the minimum amount
    // needed (none at all if it's already visible, e.g. the first item),
    // unlike "center" which is what originally required the spacer hack.
    requestAnimationFrame(() => {
      const selectedEl = scrollEl.querySelector(".wheel-option-selected");
      if (selectedEl && selectedEl.scrollIntoView) selectedEl.scrollIntoView({ block: "nearest", behavior: "auto" });
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
 * @param {{title: string, value: string, options: Array<string|{label:string,value:string}>, onChange: (value:string)=>void, placeholder?: string, showLabel?: boolean}} opts
 */
export function createWheelSelect(opts) {
  return createWheelSelectBase({ ...opts, extendable: false });
}

/**
 * @param {{
 *   title: string, value: string, options: Array<string|{label:string,value:string}>,
 *   onChange: (value:string)=>void, onAddNew: (raw:string)=>string,
 *   placeholder?: string, disabledReason?: string, disabled?: boolean,
 *   addNewPromptTitle?: string, addNewPromptMessage?: string, showLabel?: boolean,
 * }} opts
 */
export function createExtendableWheelSelect(opts) {
  return createWheelSelectBase({ ...opts, extendable: true });
}
