// src/ui/screens/entriesList.js
//
// List of plot entries. Tap a row to edit; the trash icon deletes, and on
// a touch device the whole row can also be swiped left to reveal a red
// "Delete" action (the mouse/keyboard-only trash icon stays put either
// way — swipe is additive, not a replacement, since not every device
// that opens this app supports touch gestures).
//
// Reordering is drag-based, not arrow buttons: hold a row down on a
// touch device (long-press, same as a real finger drag on iOS/Android
// lists) or click-and-drag it with a mouse, and drop it wherever it
// should land — every entry in between shifts by one and the whole list
// renumbers 1..N from its new order. See attachRowGestures()/startDrag()/
// moveDrag()/endDrag() below.
//
// "Add Another Hybrid" adds a new blank entry and jumps straight into
// editing it; "Return to Plot Summary" leaves this screen without adding one.

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

// How long a touch has to hold still before it's treated as "long-press,
// start dragging to reorder" rather than a tap or the start of a
// swipe-to-delete. Long enough that a normal tap or the start of a swipe
// never accidentally triggers it, short enough that it doesn't feel like
// a bug when someone actually means to drag.
const LONG_PRESS_MS = 450;

// How far a mouse has to move (in any direction) before a click-and-hold
// commits to "this is a drag", not a click. Small — a real drag clears
// this within a couple of pixels of movement.
const MOUSE_DRAG_THRESHOLD_PX = 6;

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
  // opening a second row (or tapping/scrolling away, or starting a drag)
  // snaps any other open row shut first. Reset fresh on every render()
  // since the whole list is rebuilt anyway.
  let openRow = null; // { entryId, rowEl } | null

  function closeOpenRow() {
    if (!openRow) return;
    openRow.rowEl.style.transform = "translateX(0)";
    openRow = null;
  }

  // Every row's outer swipe-wrap, in current (pre-drag) DOM order —
  // needed by the drag-to-reorder logic to measure every row's position,
  // not just the one being dragged. Filled in as rows are built below.
  const wrapEls = [];

  // ---- Drag-to-reorder state, shared across all rows in this render() ----
  // Only one drag can be in progress at a time; this holds everything
  // that in-progress drag needs across its start/move/end callbacks.
  let drag = null; // { fromIndex, targetIndex, rects, wrapEl } | null

  function startDrag(index, wrapEl) {
    closeOpenRow(); // a swiped-open row and an active drag don't mix
    const rects = wrapEls.map((el) => el.getBoundingClientRect());
    drag = { fromIndex: index, targetIndex: index, rects, wrapEl };
    wrapEl.classList.add("entry-row-dragging");
    wrapEl.style.transition = "none";
    wrapEl.style.transform = "translateY(0px) scale(1.03)";
  }

  function moveDrag(dy) {
    if (!drag) return;
    drag.wrapEl.style.transform = `translateY(${dy}px) scale(1.03)`;

    const rects = drag.rects;
    const draggedRect = rects[drag.fromIndex];
    const currentCenterY = draggedRect.top + draggedRect.height / 2 + dy;

    // Which original slot is the dragged row's current center closest
    // to? That slot becomes the drop target — a plain nearest-neighbor
    // search over each row's own (pre-drag, so still accurate) position,
    // which naturally handles rows of slightly different height (a
    // wrapped subtitle, etc.) instead of assuming a fixed row height.
    let targetIndex = 0;
    let bestDist = Infinity;
    rects.forEach((r, i) => {
      const center = r.top + r.height / 2;
      const dist = Math.abs(currentCenterY - center);
      if (dist < bestDist) {
        bestDist = dist;
        targetIndex = i;
      }
    });

    if (targetIndex === drag.targetIndex) return;
    drag.targetIndex = targetIndex;

    // Shift every OTHER row by exactly the distance to the neighboring
    // slot it needs to occupy to visually make room for the drop —
    // measured from the real original rects, not a fixed row height, so
    // it stays correct even when rows aren't all the same height.
    wrapEls.forEach((el, i) => {
      if (i === drag.fromIndex) return;
      let shift = 0;
      if (drag.fromIndex < targetIndex && i > drag.fromIndex && i <= targetIndex) {
        shift = rects[i - 1].top - rects[i].top;
      } else if (drag.fromIndex > targetIndex && i < drag.fromIndex && i >= targetIndex) {
        shift = rects[i + 1].top - rects[i].top;
      }
      el.style.transition = "transform 0.15s ease";
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  }

  function endDrag() {
    if (!drag) return;
    const { fromIndex, targetIndex } = drag;
    drag = null;
    if (targetIndex !== fromIndex) {
      trialStore.reorderEntry(fromIndex, targetIndex);
    }
    // Rebuild from scratch either way — cheaper than hand-unwinding every
    // inline style this drag touched, and it's what already renumbers
    // the rows 1..N from their new order.
    render(container);
  }

  entries.forEach((entry, index) => {
    const yieldVal = dryYield(entry);
    const subtitleParts = [];
    if (entry.brand.trim()) subtitleParts.push(entry.brand.trim());
    if (entry.trait.trim()) subtitleParts.push(entry.trait.trim());
    if (yieldVal !== null) subtitleParts.push(`${yieldVal.toFixed(1)} bu/ac`);

    // Shared with the mouse-drag handler below so a click-and-drag that
    // ends back over this button doesn't ALSO fire a native "click" and
    // navigate into the entry right after reordering it.
    const rowState = { suppressNextClick: false };

    const rowEl = h("div", { className: "entry-row" }, [
      h(
        "button",
        {
          type: "button",
          className: "entry-row-main",
          onclick: () => {
            if (rowState.suppressNextClick) {
              rowState.suppressNextClick = false;
              return;
            }
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
    wrapEls.push(swipeWrap);

    attachTouchGestures(rowEl, {
      onSwipeOpen: () => {
        if (openRow && openRow.rowEl !== rowEl) closeOpenRow();
        openRow = { entryId: entry.id, rowEl };
      },
      onSwipeClose: () => {
        if (openRow && openRow.rowEl === rowEl) openRow = null;
      },
      onDragStart: () => startDrag(index, swipeWrap),
      onDragMove: (dy) => moveDrag(dy),
      onDragEnd: () => endDrag(),
    });

    attachMouseDragToReorder(rowEl, {
      onDragStart: () => startDrag(index, swipeWrap),
      onDragMove: (dy) => moveDrag(dy),
      onDragEnd: () => endDrag(),
      rowState,
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
    "Return to Plot Summary"
  );

  const screen = h("div", { className: "screen entries-list-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [h("h2", { className: "screen-heading" }, "Hybrid Entries"), listEl, addBtn, backBtn]),
  ]);

  mount(container, screen);
}

// Wires up every touch-only gesture on a single entry row: a quick tap
// (handled separately, by the row's own onclick — this function never
// touches that), a horizontal swipe (swipe-to-delete, unchanged from
// before), and now a long-press-then-drag (reorder). All three share one
// touchstart/touchmove/touchend sequence because only one of them can be
// "the" gesture for any given touch — the first one to resolve (swipe
// resolves the instant the drag is clearly horizontal; long-press
// resolves on its own timer if the finger hasn't moved enough to already
// resolve as a swipe) wins, and the rest of that touch belongs to it.
//
// Uses raw addEventListener (not the h() "on*" shorthand) because
// touchmove needs { passive: false } to be able to preventDefault() the
// page's own vertical scroll while a horizontal swipe or a reorder drag
// is in progress — the dom.js h() helper doesn't support passing
// listener options.
function attachTouchGestures(rowEl, { onSwipeOpen, onSwipeClose, onDragStart, onDragMove, onDragEnd }) {
  let startX = 0;
  let startY = 0;
  let baseX = 0; // translateX at the start of this drag (0 closed, -SWIPE_REVEAL_PX open)
  let dragging = false;
  let horizontal = null; // null = undecided yet, true/false once swipe direction is resolved
  let isOpen = false;
  let longPressTimer = null;
  let reordering = false;

  function currentTranslateX() {
    const match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(rowEl.style.transform || "");
    return match ? parseFloat(match[1]) : 0;
  }

  function clearLongPressTimer() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
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
      reordering = false;
      rowEl.style.transition = "none";
      clearLongPressTimer();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        // Only engage if nothing has already claimed this touch (e.g. a
        // swipe that started resolving in the meantime).
        if (dragging && horizontal === null) {
          horizontal = false; // this touch is spoken for — no swipe now
          reordering = true;
          onDragStart();
        }
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );

  rowEl.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (reordering) {
        e.preventDefault();
        onDragMove(dy);
        return;
      }

      if (horizontal === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // too small to tell yet — keep waiting on the long-press timer
        clearLongPressTimer(); // real movement before the long-press fired — this is no longer a "hold still" gesture
        horizontal = Math.abs(dx) > Math.abs(dy);
        if (!horizontal) {
          // A vertical drag before long-press engaged: a normal scroll
          // attempt, not a gesture this row owns.
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
    clearLongPressTimer();

    if (reordering) {
      reordering = false;
      onDragEnd();
      return;
    }

    rowEl.style.transition = "";
    const x = currentTranslateX();
    if (x <= -SWIPE_REVEAL_PX / 2) {
      rowEl.style.transform = `translateX(-${SWIPE_REVEAL_PX}px)`;
      if (!isOpen) {
        isOpen = true;
        onSwipeOpen();
      }
    } else {
      rowEl.style.transform = "translateX(0)";
      if (isOpen) {
        isOpen = false;
        onSwipeClose();
      }
    }
  }

  rowEl.addEventListener("touchend", finishDrag, { passive: true });
  rowEl.addEventListener("touchcancel", finishDrag, { passive: true });
}

// Wires up click-and-drag reordering for mouse users on a single entry
// row's main (tappable) content — deliberately NOT the whole row, so a
// mousedown that starts on the trash icon is left alone and just clicks
// it, rather than being interpreted as the start of a drag.
//
// Unlike the touch version, there's no long-press wait: a mouse click is
// already unambiguous (it's not also a scroll gesture), so any movement
// past a small threshold immediately commits to "this is a drag" — the
// same as dragging an item in a desktop file manager or task list.
function attachMouseDragToReorder(rowEl, { onDragStart, onDragMove, onDragEnd, rowState }) {
  const mainEl = rowEl.querySelector(".entry-row-main") || rowEl;

  mainEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // left click only
    const startX = e.clientX;
    const startY = e.clientY;
    let reordering = false;

    function onMouseMove(e2) {
      const dx = e2.clientX - startX;
      const dy = e2.clientY - startY;
      if (!reordering) {
        if (Math.abs(dx) < MOUSE_DRAG_THRESHOLD_PX && Math.abs(dy) < MOUSE_DRAG_THRESHOLD_PX) return;
        reordering = true;
        onDragStart();
      }
      e2.preventDefault();
      onDragMove(e2.clientY - startY);
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (reordering) {
        rowState.suppressNextClick = true;
        onDragEnd();
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
}
