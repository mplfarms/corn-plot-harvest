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

import { h, mount, clear } from "../dom.js";
import * as trialStore from "../stores/trialStore.js";
import * as listsStore from "../stores/listsStore.js";
import { createTopBar } from "../components/topBar.js";
import { createWheelSelect, createExtendableWheelSelect } from "../components/wheelSelect.js";
import { openSearchListPicker } from "../components/searchListPicker.js";
import { navigate } from "../router.js";
import { entryDisplayTitle } from "../../core/models.js";
import { calculatedDryYield } from "../../core/yieldCalculator.js";
import { ensureFormIdAssigned } from "../formIdAssign.js";

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
    },
    onAddNew: (raw) => listsStore.addCustomItem(raw, listsStore.CATEGORY.BRAND_COMPANY),
    addNewPromptTitle: "Add New Brand / Company",
    addNewPromptMessage: "This is added to the list permanently, for this and every future trial.",
  });

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
      onChange: (v) => trialStore.updateEntry(entryId, { hybrid: v }),
      onAddNew: (raw) => listsStore.addCustomHybrid(raw, brand),
      addNewPromptTitle: "Add New Hybrid",
      addNewPromptMessage: `This is added under ${brand} permanently, for this and every future trial — it will only show up when ${brand} is the selected Brand / Company.`,
    });
    clear(hybridWheelHolder);
    hybridWheelHolder.appendChild(wheel.el);
  }

  // ---- Trait / Seed Treatment ----
  const traitRow = listPickerRow({
    title: "Trait",
    value: entry.trait,
    options: listsStore.items(listsStore.CATEGORY.TRAIT),
    showLabel: false,
    onChange: (v) => trialStore.updateEntry(entryId, { trait: v }),
    onAddNew: (raw) => listsStore.addCustomItem(raw, listsStore.CATEGORY.TRAIT),
    addNewPromptTitle: "Add New Trait",
    addNewPromptMessage: "This is added to the list permanently, for this and every future trial.",
  });

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

  // ---- RM (locked, 75-120) ----
  const rmOptions = [];
  for (let n = 75; n <= 120; n++) rmOptions.push(String(n));
  const rmWheel = createWheelSelect({
    title: "Relative Maturity (RM)",
    value: entry.relativeMaturity,
    options: rmOptions,
    showLabel: false,
    onChange: (v) => trialStore.updateEntry(entryId, { relativeMaturity: v }),
  });

  // Brand is pre-filled by trialStore for a freshly created entry (see
  // addEntryCarryingMeasurements()), so this has to run once up front —
  // not just from brandWheel's onChange — or the very first entry in a
  // new plot would never get its Hybrid/RM default applied unless the
  // user happened to touch the Brand wheel themselves.
  applyFirstEntryHybridRmDefault(currentEntry().brand);
  rebuildHybridWheel();

  // Every row in this section is now wrapped the same way — a field()
  // label above a labelless wheel/list-picker row — so the vertical
  // spacing (field()'s own 6px label gap + 14px margin-bottom, see
  // styles.css) is identical between all five, not just some of them.
  const identitySection = h("section", { className: "card" }, [
    sectionHeader("Hybrid Details"),
    field("Brand / Company", brandWheel.el),
    field("Hybrid", hybridWheelHolder),
    field("Trait", traitRow),
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
        onclick: () => {
          // A plot's Form ID (see core/formId.js) is reserved right here,
          // the moment "Save Plot" is actually tapped — by explicit
          // request, NOT the instant Plot Details is opened, so simply
          // browsing/backing out of a plot never burns a number. This is
          // fire-and-forget (never blocks navigating to Plot Summary,
          // matching this app's offline-first design — see
          // formIdAssign.js's top comment); plotSummary.js makes its own
          // follow-up attempt before actually building an export, as a
          // safety net in case this one hasn't finished yet.
          ensureFormIdAssigned();
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
