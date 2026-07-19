// src/ui/screens/entriesList.js
//
// List of plot entries. Tap a row to edit; the trash icon deletes, and on
// a touch device the whole row can also be swiped left to reveal a red
// "Delete" action (the mouse/keyboard-only trash icon stays put either
// way — swipe is additive, not a replacement, since not every device
// that opens this app supports touch gestures); up/down arrow buttons
// are the substitute for native drag-reorder. "Add Another Hybrid" adds
// a new blank entry and jumps straight into editing it; "Back to Plot
// Summary" leaves this screen without adding one.

import { h, mount } from "../dom.js";
import * as trialStore from "../stores/trialStore.js";
import * as adminEditStore from "../stores/adminEditStore.js";
import { createTopBar } from "../components/topBar.js";
import { navigate } from "../router.js";
import { entryDisplayTitle } from "../../core/models.js";
import { dryYield } from "../../core/yieldCalculator.js";

// How far a row slides left to reveal the swipe-delete action, in px —
// matches .entry-row-swipe-delete's width in styles.css.
const SWIPE_REVEAL_PX = 84;

export function render(container) {
  // See adminEditStore.clearIfStale()'s comment — safe to call unconditionally.
  adminEditStore.clearIfStale();

  const draft = trialStore.getState();
  const entries = draft.entries;

  const topBar = createTopBar({
    title: "Hybrid Entries",
    onBack: () => navigate("workspace"),
    backLabel: "Menu",
  });

  const listEl = h("div", { className: "entries-list" });

  if (entries.length === 0) {
    // Deliberately doesn't repeat the button's own label verbatim here —
    // a `text=` selector in the test suite matches by substring, and an
    // exact repeat would make it ambiguous which element (this message
    // or the actual button) a test's click resolves to.
    listEl.appendChild(h("p", { className: "empty-state" }, "No entries yet. Use the button below to add your first plot entry."));
  }

  // Only one row's swipe-delete action should be revealed at a time —
  // opening a second row (or tapping/scrolling away) snaps any other
  // open row shut first. Reset fresh on every render() since the whole
  // list is rebuilt anyway.
  let openRow = null; // { entryId, rowEl } | null

  function closeOpenRow() {
    if (!openRow) return;
    openRow.rowEl.style.transform = "translateX(0)";
    openRow = null;
  }

  entries.forEach((entry, index) => {
    const yieldVal = dryYield(entry);
    const subtitleParts = [];
    if (entry.brand.trim()) subtitleParts.push(entry.brand.trim());
    if (entry.trait.trim()) subtitleParts.push(entry.trait.trim());
    if (yieldVal !== null) subtitleParts.push(`${yieldVal.toFixed(1)} bu/ac`);

    const rowEl = h("div", { className: "entry-row" }, [
      h(
        "button",
        {
          type: "button",
          className: "entry-row-main",
          onclick: () => {
            // A tap while this row is swiped open just closes it back up
            // — a native swipe-to-delete list treats that sliver of
            // still-visible row as "dismiss", not "open the item".
            if (openRow && openRow.entryId === entry.id) {
              closeOpenRow();
              return;
            }
            navigate("entry-editor", { entryId: entry.id });
          },
        },
        [
          h("span", { className: "entry-row-number" }, String(index + 1)),
          h("span", { className: "entry-row-text" }, [
            h("span", { className: "entry-row-title" }, entryDisplayTitle(entry)),
            subtitleParts.length ? h("span", { className: "entry-row-subtitle" }, subtitleParts.join(" • ")) : null,
          ]),
        ]
      ),
      h("div", { className: "entry-row-actions" }, [
        h(
          "button",
          {
            type: "button",
            className: "icon-btn",
            "aria-label": "Move up",
            disabled: index === 0,
            onclick: () => {
              trialStore.moveEntry(index, -1);
              render(container);
            },
          },
          "↑"
        ),
        h(
          "button",
          {
            type: "button",
            className: "icon-btn",
            "aria-label": "Move down",
            disabled: index === entries.length - 1,
            onclick: () => {
              trialStore.moveEntry(index, 1);
              render(container);
            },
          },
          "↓"
        ),
        h(
          "button",
          {
            type: "button",
            className: "icon-btn icon-btn-danger",
            "aria-label": "Delete entry",
            onclick: () => {
              trialStore.removeEntry(entry.id);
              render(container);
            },
          },
          "🗑"
        ),
      ]),
    ]);

    const deletePanel = h("div", { className: "entry-row-swipe-delete" }, [
      h(
        "button",
        {
          type: "button",
          className: "entry-row-swipe-delete-btn",
          "aria-label": `Delete entry ${index + 1}`,
          onclick: () => {
            trialStore.removeEntry(entry.id);
            render(container);
          },
        },
        "Delete"
      ),
    ]);

    const swipeWrap = h("div", { className: "entry-row-swipe-wrap" }, [deletePanel, rowEl]);
    attachSwipeToDelete(rowEl, {
      onOpen: () => {
        if (openRow && openRow.rowEl !== rowEl) closeOpenRow();
        openRow = { entryId: entry.id, rowEl };
      },
      onClose: () => {
        if (openRow && openRow.rowEl === rowEl) openRow = null;
      },
    });

    listEl.appendChild(swipeWrap);
  });

  const addBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-primary btn-block",
      onclick: () => {
        const entry = trialStore.addEntryCarryingMeasurements();
        navigate("entry-editor", { entryId: entry.id });
      },
    },
    "Add Another Hybrid"
  );

  // A plain way back to Plot Summary without adding a hybrid first.
  const backBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-secondary btn-block",
      onclick: () => navigate("plot-summary"),
    },
    "Back to Plot Summary"
  );

  const screen = h("div", { className: "screen entries-list-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [h("h2", { className: "screen-heading" }, "Hybrid Entries"), listEl, addBtn, backBtn]),
  ]);

  mount(container, screen);
}

// Wires up touch-only swipe-left-to-delete on a single entry row. Left of
// the row, nothing changes — a mouse click still just clicks. On a touch
// device, dragging left reveals the red Delete panel already sitting
// behind the row (see the "entry-row-swipe-delete" sibling built above);
// dragging right (or letting go before the halfway point) snaps it shut.
// Uses raw addEventListener (not the h() "on*" shorthand) because
// touchmove needs { passive: false } to be able to preventDefault() the
// page's own vertical scroll while a horizontal drag is in progress —
// the dom.js h() helper doesn't support passing listener options.
function attachSwipeToDelete(rowEl, { onOpen, onClose }) {
  let startX = 0;
  let startY = 0;
  let baseX = 0; // translateX at the start of this drag (0 closed, -SWIPE_REVEAL_PX open)
  let dragging = false;
  let horizontal = null; // null = undecided yet, true/false once one axis wins
  let isOpen = false;

  function currentTranslateX() {
    const match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(rowEl.style.transform || "");
    return match ? parseFloat(match[1]) : 0;
  }

  rowEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      baseX = currentTranslateX();
      dragging = true;
      horizontal = null;
      rowEl.style.transition = "none";
    },
    { passive: true }
  );

  rowEl.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (horizontal === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // too small to tell yet
        horizontal = Math.abs(dx) > Math.abs(dy);
        if (!horizontal) {
          // A vertical drag: let the page scroll normally, this row
          // takes no further part in it.
          dragging = false;
          return;
        }
      }
      e.preventDefault(); // this is a horizontal drag — don't also scroll the page
      const next = Math.min(0, Math.max(-SWIPE_REVEAL_PX, baseX + dx));
      rowEl.style.transform = `translateX(${next}px)`;
    },
    { passive: false }
  );

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    rowEl.style.transition = "";
    const x = currentTranslateX();
    if (x <= -SWIPE_REVEAL_PX / 2) {
      rowEl.style.transform = `translateX(-${SWIPE_REVEAL_PX}px)`;
      if (!isOpen) {
        isOpen = true;
        onOpen();
      }
    } else {
      rowEl.style.transform = "translateX(0)";
      if (isOpen) {
        isOpen = false;
        onClose();
      }
    }
  }

  rowEl.addEventListener("touchend", finishDrag, { passive: true });
  rowEl.addEventListener("touchcancel", finishDrag, { passive: true });
}
