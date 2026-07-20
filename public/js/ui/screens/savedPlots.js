// src/ui/screens/savedPlots.js
//
// Searchable (by cooperator/state/year), sorted by lastModified desc.
// "Current" badge on the trial that is currently open in the workspace.
// Tapping a row opens it into the workspace: from PlotChooser this lands
// on Plot Summary (params.enterWorkspaceOnSelect === true); from inside
// the workspace menu it just navigates in place (also to Plot Summary,
// since that's "opening a different saved plot" per the spec).
//
// A plot that moved here from a deleted/merged-away account (see
// adminUsers.js's handleMerge() and deleteAccount.js) carries a
// transferredFrom field and shows a "From {name}" badge, rather than
// silently blending into whoever's library it landed in — deliberately
// NOT re-sorted into its own group, so the list stays in its normal
// most-recently-touched order regardless of where each plot came from.
//
// The sample Demo Plot (see demoPlot.js, seeded automatically by
// libraryStore.ensureDemoPlot()) shows a "Demo" badge for the same
// reason — never mistaken for a real cooperator's plot — and deletes
// the same way any other plot does (it just comes back next update).
//
// Deleting a whole saved plot is more consequential than deleting a
// single hybrid entry (entriesList.js), so every path to delete one —
// the trash icon, a touch-device swipe-left, or a desktop right-click —
// funnels through the same confirmAndDeleteTrial() below, which always
// asks first via showConfirm() rather than deleting immediately. Swipe
// reveals a red "Delete" panel (same visual pattern as entriesList.js's
// swipe-to-delete); right-click skips straight to the confirmation,
// matching the "right-click for a delete/context action" most desktop
// users already expect, and calls e.preventDefault() so the browser's
// own context menu doesn't also pop up. All three are additive — the
// trash icon is never removed, since not every device has touch or a
// mouse with a right button.
import { h, mount, clear } from "../dom.js";
import * as trialStore from "../stores/trialStore.js";
import * as libraryStore from "../stores/libraryStore.js";
import { createTopBar } from "../components/topBar.js";
import { showConfirm } from "../components/modal.js";
import { navigate } from "../router.js";
import { filenameYear } from "../../core/models.js";

// How far a row slides left to reveal the swipe-delete action, in px —
// matches .entry-row-swipe-delete's width in styles.css (the same
// constant/CSS entriesList.js uses, since both screens share the same
// swipe-to-delete markup and styling).
const SWIPE_REVEAL_PX = 84;

function matchesQuery(trial, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const h = trial.header;
  return (
    (h.cooperatorName || "").toLowerCase().includes(q) ||
    (h.state || "").toLowerCase().includes(q) ||
    String(filenameYear(h)).includes(q)
  );
}

export function render(container, params) {
  let query = "";
  const currentDraftId = trialStore.getState().id;

  const topBar = createTopBar({
    title: "Saved Plots",
    onBack: () => navigate(params && params.enterWorkspaceOnSelect ? "plot-chooser" : "workspace"),
    backLabel: "Back",
  });

  const searchInput = h("input", {
    type: "search",
    className: "text-input saved-plots-search",
    placeholder: "Search by cooperator, state, or year…",
    oninput: (e) => {
      query = e.target.value;
      renderList();
    },
  });

  const listEl = h("div", { className: "entries-list" });

  // Only one row's swipe-delete action should be revealed at a time —
  // opening a second row (or tapping/scrolling away) snaps any other
  // open row shut first. Reset fresh on every renderList() call since
  // the whole list is rebuilt anyway.
  let openRow = null; // { trialId, rowEl } | null

  function closeOpenRow() {
    if (!openRow) return;
    openRow.rowEl.style.transform = "translateX(0)";
    openRow = null;
  }

  function renderList() {
    clear(listEl);
    openRow = null;
    const trials = libraryStore
      .getState()
      .trials.filter((t) => matchesQuery(t, query))
      .slice()
      .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

    if (trials.length === 0) {
      listEl.appendChild(h("p", { className: "empty-state" }, "No saved plots yet."));
      return;
    }

    for (const trial of trials) {
      const isCurrent = trial.id === currentDraftId;
      const subtitleParts = [String(filenameYear(trial.header))];
      if (trial.header.state) subtitleParts.push(trial.header.state);
      subtitleParts.push(`${trial.entries.length} ${trial.entries.length === 1 ? "entry" : "entries"}`);

      // Set once, server-side, whenever a plot moves accounts — either an
      // admin's "Merge Into…" (adminUsers.js's handleMerge()) or a user's
      // own "Delete My Account" (deleteAccount.js) — so it's still
      // identifiable as having belonged to a teammate rather than being
      // silently absorbed into whoever's library it landed in.
      const transferredFrom = trial.transferredFrom;
      const isDemo = Boolean(trial.isDemo);

      // Shared by every path to delete this row — trash icon, swipe
      // panel, and right-click — so all three "ask" the same way and
      // there's only one place that actually calls deleteTrial().
      async function confirmAndDeleteTrial() {
        const ok = await showConfirm({
          title: isDemo ? "Delete Demo Plot?" : "Delete Saved Plot?",
          message: isDemo
            ? "This removes the sample Demo Plot from this device. It'll come back automatically the next time the app updates."
            : `This permanently removes "${trial.header.cooperatorName.trim() || "Untitled Plot"}" from your library.`,
          confirmLabel: "Delete",
          destructive: true,
        });
        if (!ok) return;
        libraryStore.deleteTrial(trial.id);
        renderList();
      }

      const rowEl = h("div", { className: "entry-row" }, [
        h(
          "button",
          {
            type: "button",
            className: "entry-row-main",
            onclick: () => {
              // A tap while this row is swiped open just closes it back
              // up — same convention as entriesList.js's swipe-to-delete.
              if (openRow && openRow.trialId === trial.id) {
                closeOpenRow();
                return;
              }
              trialStore.loadTrial(trial);
              navigate("plot-summary");
            },
          },
          [
            h("span", { className: "entry-row-text" }, [
              h("span", { className: "entry-row-title" }, [
                trial.header.cooperatorName.trim() || "Untitled Plot",
                isCurrent ? h("span", { className: "badge-current" }, "Current") : null,
                isDemo
                  ? h(
                      "span",
                      { className: "badge-demo", title: "A sample plot for practice — safe to edit or delete." },
                      "Demo"
                    )
                  : null,
                transferredFrom
                  ? h(
                      "span",
                      { className: "badge-transferred", title: `Transferred from ${transferredFrom.email}` },
                      `From ${transferredFrom.name || transferredFrom.email}`
                    )
                  : null,
              ]),
              h("span", { className: "entry-row-subtitle" }, subtitleParts.join(" • ")),
            ]),
          ]
        ),
        h("div", { className: "entry-row-actions" }, [
          h(
            "button",
            {
              type: "button",
              className: "icon-btn icon-btn-danger",
              "aria-label": "Delete saved plot",
              onclick: confirmAndDeleteTrial,
            },
            "🗑"
          ),
        ]),
      ]);

      // Desktop right-click: skip straight to the same confirmation
      // (see confirmAndDeleteTrial() above) instead of revealing a
      // swipe panel that a mouse can't produce. preventDefault() so the
      // browser's own context menu doesn't also appear.
      rowEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        confirmAndDeleteTrial();
      });

      const deletePanel = h("div", { className: "entry-row-swipe-delete" }, [
        h(
          "button",
          {
            type: "button",
            className: "entry-row-swipe-delete-btn",
            "aria-label": `Delete ${trial.header.cooperatorName.trim() || "Untitled Plot"}`,
            onclick: confirmAndDeleteTrial,
          },
          "Delete"
        ),
      ]);

      const swipeWrap = h("div", { className: "entry-row-swipe-wrap" }, [deletePanel, rowEl]);

      attachSwipeToDelete(rowEl, {
        onOpen: () => {
          if (openRow && openRow.rowEl !== rowEl) closeOpenRow();
          openRow = { trialId: trial.id, rowEl };
        },
        onClose: () => {
          if (openRow && openRow.rowEl === rowEl) openRow = null;
        },
      });

      listEl.appendChild(swipeWrap);
    }
  }

  renderList();

  const screen = h("div", { className: "screen saved-plots-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [h("h2", { className: "screen-heading" }, "Saved Plots"), searchInput, listEl]),
  ]);

  mount(container, screen);
}

// Touch-only swipe-left-to-delete — the same mechanics as
// entriesList.js's attachTouchGestures(), minus its long-press-to-reorder
// half (there's nothing to reorder here; Saved Plots is always sorted by
// lastModified, not a user-defined order). Raw addEventListener (not the
// h() "on*" shorthand) because touchmove needs { passive: false } to be
// able to preventDefault() the page's own vertical scroll while a
// horizontal swipe is in progress.
function attachSwipeToDelete(rowEl, { onOpen, onClose }) {
  let startX = 0;
  let startY = 0;
  let baseX = 0; // translateX at the start of this drag (0 closed, -SWIPE_REVEAL_PX open)
  let dragging = false;
  let horizontal = null; // null = undecided yet, true/false once swipe direction is resolved
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
          // A vertical drag: a normal scroll attempt, not a swipe.
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
