// src/ui/screens/entryEditor.js
//
// Brand/Hybrid extendable wheels, Trait/Seed Treatment searchable list
// pickers, locked RM wheel, numeric measurement fields, a live
// calculated-or-overridden Dry Yield field, and Comments.
//
// Like trialDetails.js, this screen builds its DOM once per render()
// call and never rebuilds itself in response to its own typing (would
// blow away focus). The Hybrid wheel is the one exception: it is
// re-created (small, isolated DOM patch) whenever the Brand changes,
// since its option list and "+Add New" copy depend on the Brand value.
// The Trait row is re-created the same way whenever the Hybrid or Brand
// changes, for the same reason — see the Hybrid Catalog cascading
// section below.
//
// Hybrid Catalog cascading (see catalogStore.js / companyMatch.js /
// netlify/functions/hybridCatalog.js): when the selected Hybrid is one
// of the admin-uploaded catalog's entries for the current Brand,
// picking it auto-fills Relative Maturity, and auto-fills Trait too if
// that hybrid has exactly one catalog trait package — or narrows the
// Trait picker down to just that hybrid's available package(s) if it
// has more than one. A Hybrid with no catalog match (hand-typed/custom,
// or a brand with no catalog data at all) leaves RM alone and shows the
// full, unrestricted Trait list, exactly like before this feature
// existed. Every one of these is still just a starting point, never a
// lock: RM stays a normal spinnable wheel, and Trait's "+Add New" can
// always add something outside the narrowed list — nothing here
// prevents entering values manually when a plot isn't on the lists.

import { h, mount, clear } from "../dom.js";
import * as trialStore from "../stores/trialStore.js";
import * as listsStore from "../stores/listsStore.js";
import { createTopBar } from "../components/topBar.js";
import { createWheelSelect, createExtendableWheelSelect } from "../components/wheelSelect.js";
import { openSearchListPicker } from "../components/searchListPicker.js";
import { navigate } from "../router.js";
import { entryDisplayTitle } from "../../core/models.js";
import { calculatedDryYield } from "../../core/yieldCalculator.js";
import { ensureFormIdAssignedWithFeedback } from "../formIdAssign.js";
import * as catalogStore from "../stores/catalogStore.js";

function sectionHeader(title) {
  return h("h3", { className: "section-header" }, title);
}

function field(label, inputEl) {
  return h("label", { className: "field" }, [h("span", { className: "field-label" }, label), inputEl]);
}

function textInput({ value, placeholder, oninput, type = "text", inputmode }) {
  return h("input", {
    type,
    inputmode,
    className: "text-input",
    value: value || "",
    placeholder: placeholder || "",
    oninput: (e) => oninput(e.target.value),
  });
}

function listPickerRow({ title, value, options, onChange, onAddNew, addNewPromptTitle, addNewPromptMessage, showLabel = true }) {
  let currentValue = value;
  let currentOptions = options.slice();

  const valueEl = h(
    "span",
    { className: "wheel-row-value" + (currentValue ? "" : " wheel-row-placeholder") },
    currentValue || "Select…"
  );

  const btn = h(
    "button",
    {
      type: "button",
      className: "wheel-row-header",
      onclick: () => {
        openSearchListPicker({
          title,
          value: currentValue,
          options: currentOptions,
          onChange: (v) => {
            currentValue = v;
            valueEl.textContent = v;
            valueEl.classList.remove("wheel-row-placeholder");
            onChange(v);
          },
          onAddNew: onAddNew
            ? (raw) => {
                const selected = onAddNew(raw);
                if (selected && !currentOptions.includes(selected)) currentOptions = [...currentOptions, selected];
                return selected;
              }
            : undefined,
          addNewPromptTitle,
          addNewPromptMessage,
        });
      },
    },
    [showLabel ? h("span", { className: "wheel-row-label" }, title) : null, valueEl, h("span", { className: "wheel-chevron" }, "›")]
  );

  return h("div", { className: "wheel-row" }, btn);
}

export function render(container, params) {
  const entryId = params && params.entryId;
  const draft = trialStore.getState();
  const entry = draft.entries.find((e) => e.id === entryId);

  if (!entry) {
    mount(
      container,
      h("div", { className: "screen" }, [
        createTopBar({ title: "Entry Not Found", onBack: () => navigate("entries") }),
        h("div", { className: "screen-body" }, h("p", { className: "empty-state" }, "This entry no longer exists.")),
      ])
    );
    return;
  }

  function currentEntry() {
    return trialStore.getState().entries.find((e) => e.id === entryId) || entry;
  }

  const topBar = createTopBar({
    title: entryDisplayTitle(entry),
    onBack: () => navigate("entries"),
    backLabel: "Entries",
  });

  // The very first entry in a brand new plot has nothing to carry a
  // Hybrid/RM/Trait forward from (every later entry does — see
  // CARRIED_IDENTITY_FIELDS in trialStore.js). Instead, once its Brand is
  // set, it defaults Hybrid and RM to the catalog's first RM-100 hybrid
  // so there's a sensible starting point instead of a blank field. Brand
  // itself is now pre-filled at entry-creation time (see
  // addEntryCarryingMeasurements() in trialStore.js), so this has to run
  // both right away below (the user may never touch the Brand wheel at
  // all) and again from the wheel's onChange (if they pick a different
  // Brand while Hybrid/RM are still untouched).
  const isFirstEntryOfPlot = draft.entries.length > 0 && draft.entries[0].id === entryId;
  const DEFAULT_RM_FOR_NEW_PLOT = 100;

  function applyFirstEntryHybridRmDefault(brandValue) {
    if (!isFirstEntryOfPlot || !brandValue) return;
    const current = currentEntry();
    // Only default while both are still untouched, so this never
    // clobbers a hybrid/RM the user already picked.
    if (current.hybrid.trim() || current.relativeMaturity.trim()) return;
    const defaultHybrid = listsStore.firstHybridWithRm(brandValue, DEFAULT_RM_FOR_NEW_PLOT);
    const patch = { relativeMaturity: String(DEFAULT_RM_FOR_NEW_PLOT) };
    if (defaultHybrid) patch.hybrid = defaultHybrid;
    trialStore.updateEntry(entryId, patch);
    rmWheel.setValue(String(DEFAULT_RM_FOR_NEW_PLOT));
  }

  // ---- Brand / Company ----
  // showLabel: false on every wheel/list-picker row below — each one's
  // title is now shown once, as a field() label above the row (matching
  // Brand/Company, Hybrid, and RM's existing look), so repeating it a
  // second time inside the row itself would be redundant. This also
  // keeps the spacing between every row in this section consistent —
  // Seed Treatment used to be the one row with no label above it, which
  // left it sitting flush against Trait's box with none of the other
  // rows' breathing room.
  const brandWheel = createExtendableWheelSelect({
    title: "Brand / Company",
    value: entry.brand,
    options: listsStore.items(listsStore.CATEGORY.BRAND_COMPANY),
    showLabel: false,
    onChange: (v) => {
      trialStore.updateEntry(entryId, { brand: v });
      applyFirstEntryHybridRmDefault(v);
      rebuildHybridWheel();
      refreshTraitOptionsForCurrentHybrid();
    },
    onAddNew: (raw) => listsStore.addCustomItem(raw, listsStore.CATEGORY.BRAND_COMPANY),
    addNewPromptTitle: "Add New Brand / Company",
    addNewPromptMessage: "This is added to the list permanently, for this and every future trial.",
  });

  // ---- RM (locked, 75-120) ----
  // Declared up here (rather than in its previous spot below Trait) so
  // the Hybrid wheel's onChange, defined next, can call rmWheel.setValue()
  // when a catalog Hybrid pick auto-fills RM.
  const rmOptions = [];
  for (let n = 75; n <= 120; n++) rmOptions.push(String(n));
  const rmWheel = createWheelSelect({
    title: "Relative Maturity (RM)",
    value: entry.relativeMaturity,
    options: rmOptions,
    showLabel: false,
    onChange: (v) => trialStore.updateEntry(entryId, { relativeMaturity: v }),
  });

  // ---- Trait (depends on Hybrid; rebuilt in place, same pattern as the
  // Hybrid wheel below) ----
  const traitRowHolder = h("div", { className: "field-wrapper" });

  function rebuildTraitRow(options) {
    const row = listPickerRow({
      title: "Trait",
      value: currentEntry().trait,
      options: options && options.length ? options : listsStore.items(listsStore.CATEGORY.TRAIT),
      showLabel: false,
      onChange: (v) => trialStore.updateEntry(entryId, { trait: v }),
      onAddNew: (raw) => listsStore.addCustomItem(raw, listsStore.CATEGORY.TRAIT),
      addNewPromptTitle: "Add New Trait",
      addNewPromptMessage: "This is added to the list permanently, for this and every future trial.",
    });
    clear(traitRowHolder);
    traitRowHolder.appendChild(row);
  }

  // Refreshes ONLY the Trait row's option list to match whatever Hybrid
  // is currently selected — never touches the stored Trait/RM values.
  // Called on Brand change (the old Hybrid value may or may not still
  // be valid under the new Brand's catalog) and once up front for a
  // pre-existing entry being reopened, so its Trait picker already
  // shows the right narrowed list without the user having to re-pick
  // the Hybrid first.
  function refreshTraitOptionsForCurrentHybrid() {
    const brand = currentEntry().brand || "";
    const hybrid = currentEntry().hybrid || "";
    const traits = catalogStore.traitsForHybrid(brand, hybrid);
    rebuildTraitRow(traits);
  }

  // Applied on an explicit Hybrid pick only (not a Brand change) — a
  // deliberate user action to select THIS hybrid is what earns it an
  // automatic RM/Trait fill; see this file's top comment.
  function applyCatalogHybridDefaults(brand, hybridValue) {
    const rm = catalogStore.rmForHybrid(brand, hybridValue);
    if (rm !== null) {
      trialStore.updateEntry(entryId, { relativeMaturity: String(rm) });
      rmWheel.setValue(String(rm));
    }
    const traits = catalogStore.traitsForHybrid(brand, hybridValue);
    if (traits.length === 1) {
      trialStore.updateEntry(entryId, { trait: traits[0] });
    } else if (traits.length > 1 && !traits.includes(currentEntry().trait)) {
      // Switching TO a multi-trait hybrid whose package list doesn't
      // include whatever Trait was left over from a previous Hybrid
      // pick — clear it rather than silently keeping a mismatched
      // value the narrowed list doesn't even offer, so the picker
      // visibly prompts a fresh pick from the (now-narrowed) options.
      trialStore.updateEntry(entryId, { trait: "" });
    }
    rebuildTraitRow(traits);
  }

  // ---- Hybrid (depends on Brand; rebuilt in place when Brand changes) ----
  const hybridWheelHolder = h("div", { className: "field-wrapper" });

  function rebuildHybridWheel() {
    const brand = currentEntry().brand || "";
    const isBlank = brand.trim() === "";
    const wheel = createExtendableWheelSelect({
      title: "Hybrid",
      value: currentEntry().hybrid,
      options: listsStore.hybridItems(brand),
      disabled: isBlank,
      disabledReason: "Select a Brand / Company first to choose a Hybrid.",
      showLabel: false,
      onChange: (v) => {
        trialStore.updateEntry(entryId, { hybrid: v });
        applyCatalogHybridDefaults(brand, v);
      },
      onAddNew: (raw) => listsStore.addCustomHybrid(raw, brand),
      addNewPromptTitle: "Add New Hybrid",
      addNewPromptMessage: `This is added under ${brand} permanently, for this and every future trial — it will only show up when ${brand} is the selected Brand / Company.`,
    });
    clear(hybridWheelHolder);
    hybridWheelHolder.appendChild(wheel.el);
  }

  const seedTreatmentRow = listPickerRow({
    title: "Seed Treatment",
    value: entry.seedTreatment,
    options: listsStore.items(listsStore.CATEGORY.SEED_TREATMENT),
    showLabel: false,
    onChange: (v) => trialStore.updateEntry(entryId, { seedTreatment: v }),
    onAddNew: (raw) => listsStore.addCustomItem(raw, listsStore.CATEGORY.SEED_TREATMENT),
    addNewPromptTitle: "Add New Seed Treatment",
    addNewPromptMessage: "This is added to the list permanently, for this and every future trial.",
  });

  // Brand is pre-filled by trialStore for a freshly created entry (see
  // addEntryCarryingMeasurements()), so this has to run once up front —
  // not just from brandWheel's onChange — or the very first entry in a
  // new plot would never get its Hybrid/RM default applied unless the
  // user happened to touch the Brand wheel themselves.
  applyFirstEntryHybridRmDefault(currentEntry().brand);
  rebuildHybridWheel();
  // Matches the Trait picker's narrowed options to whatever Hybrid this
  // entry already has (a no-op for a brand new blank entry) — see this
  // function's own comment for why an existing entry needs this run up
  // front too, not just on the next Brand/Hybrid change.
  refreshTraitOptionsForCurrentHybrid();

  // Every row in this section is now wrapped the same way — a field()
  // label above a labelless wheel/list-picker row — so the vertical
  // spacing (field()'s own 6px label gap + 14px margin-bottom, see
  // styles.css) is identical between all five, not just some of them.
  const identitySection = h("section", { className: "card" }, [
    sectionHeader("Hybrid Details"),
    field("Brand / Company", brandWheel.el),
    field("Hybrid", hybridWheelHolder),
    field("Trait", traitRowHolder),
    field("Seed Treatment", seedTreatmentRow),
    field("Relative Maturity (RM)", rmWheel.el),
  ]);

  // ---- Dry Yield (calculated, overridable) + measurements ----
  const dryYieldInput = textInput({
    value: entry.manualDryYield || "",
    inputmode: "decimal",
    placeholder: "",
    oninput: (v) => trialStore.updateEntry(entryId, { manualDryYield: v }),
  });

  function refreshDryYieldPlaceholder() {
    const calc = calculatedDryYield(currentEntry());
    dryYieldInput.placeholder = calc === null ? "Calculated Automatically or Enter Manually" : `${calc.toFixed(1)} bu/ac (calculated)`;
  }
  refreshDryYieldPlaceholder();

  function measurementField(label, key, inputmode = "decimal") {
    return field(
      label,
      textInput({
        value: entry[key],
        inputmode,
        oninput: (v) => {
          trialStore.updateEntry(entryId, { [key]: v });
          refreshDryYieldPlaceholder();
        },
      })
    );
  }

  const measurementsSection = h("section", { className: "card" }, [
    sectionHeader("Yield Measurements"),
    field("Dry Yield (bu/ac)", dryYieldInput),
    h("p", { className: "field-note" }, "Leave blank to use the calculated value; type a value to override it."),
    measurementField("Sample Net Wt. (lbs)", "sampleNetWeightLbs"),
    measurementField("Moisture %", "moisturePercent"),
    measurementField("Test Weight", "testWeight"),
    measurementField("Strip Length (ft)", "stripLengthFeet"),
    measurementField("Number of Rows", "numberOfRows"),
    measurementField("Width (in)", "widthInches"),
  ]);

  const commentsSection = h("section", { className: "card" }, [
    sectionHeader("Comments"),
    h("textarea", {
      className: "text-input text-area",
      placeholder: "Enter notes about entry here. Examples: Sprayer Blight, Animal Damage, Row Missing, etc…",
      oninput: (e) => trialStore.updateEntry(entryId, { comments: e.target.value }),
    }, entry.comments || ""),
    h(
      "p",
      { className: "field-note" },
      "Dry Yield is calculated from Sample Net Wt., Moisture %, Strip Length, Number of Rows, and Width — override it above if you have a lab-verified value."
    ),
  ]);

  // ---- Bottom actions: add another entry, or finish and save the plot ----
  const actionsRow = h("div", { className: "entry-editor-actions" }, [
    h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary",
        onclick: () => {
          const newEntry = trialStore.addEntryCarryingMeasurements();
          navigate("entry-editor", { entryId: newEntry.id });
        },
      },
      "+ Add Another Entry"
    ),
    h(
      "button",
      {
        type: "button",
        className: "btn btn-primary",
        onclick: async (e) => {
          // A plot's Form ID (see core/formId.js) is reserved right here,
          // the moment "Save Plot" is actually tapped — by explicit
          // request, NOT the instant Plot Details is opened, so simply
          // browsing/backing out of a plot never burns a number.
          // Deliberately AWAITED (not fire-and-forget) before navigating —
          // Plot Summary reads the header once at mount time and doesn't
          // live-subscribe to the store, so if this fired-and-forgot the
          // way it originally did, Plot Summary would frequently render
          // BEFORE the reservation actually landed and show no Form ID at
          // all until the next visit. ensureFormIdAssignedWithFeedback()
          // never throws (offline just resolves false — see its top
          // comment), so this never blocks Save Plot from working, it
          // just makes the wait visible with a brief "Saving…" state
          // instead of hiding it, and — unlike a silent background
          // attempt — surfaces an error toast if it genuinely fails while
          // online, so a real server-side problem is visible instead of
          // just quietly never showing up. Plot Summary's own
          // resolveHeaderForExport(), its self-healing re-render, and its
          // own manual "Assign Plot ID" retry button (see plotSummary.js)
          // all remain as further safety nets/backstops.
          e.target.disabled = true;
          e.target.textContent = "Saving…";
          await ensureFormIdAssignedWithFeedback().catch(() => {});
          navigate("plot-summary");
        },
      },
      "Save Plot"
    ),
  ]);

  const screen = h("div", { className: "screen entry-editor-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [identitySection, measurementsSection, commentsSection, actionsRow]),
  ]);

  mount(container, screen);
}
