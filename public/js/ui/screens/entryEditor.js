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

function listPickerRow({ title, value, options, onChange, onAddNew, addNewPromptTitle, addNewPromptMessage }) {
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
    [h("span", { className: "wheel-row-label" }, title), valueEl, h("span", { className: "wheel-chevron" }, "›")]
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

  // ---- Brand / Company ----
  const brandWheel = createExtendableWheelSelect({
    title: "Brand / Company",
    value: entry.brand,
    options: listsStore.items(listsStore.CATEGORY.BRAND_COMPANY),
    onChange: (v) => {
      trialStore.updateEntry(entryId, { brand: v });
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
      onChange: (v) => trialStore.updateEntry(entryId, { hybrid: v }),
      onAddNew: (raw) => listsStore.addCustomHybrid(raw, brand),
      addNewPromptTitle: "Add New Hybrid",
      addNewPromptMessage: `This is added under ${brand} permanently, for this and every future trial — it will only show up when ${brand} is the selected Brand / Company.`,
    });
    clear(hybridWheelHolder);
    hybridWheelHolder.appendChild(wheel.el);
  }
  rebuildHybridWheel();

  // ---- Trait / Seed Treatment ----
  const traitRow = listPickerRow({
    title: "Trait",
    value: entry.trait,
    options: listsStore.items(listsStore.CATEGORY.TRAIT),
    onChange: (v) => trialStore.updateEntry(entryId, { trait: v }),
    onAddNew: (raw) => listsStore.addCustomItem(raw, listsStore.CATEGORY.TRAIT),
    addNewPromptTitle: "Add New Trait",
    addNewPromptMessage: "This is added to the list permanently, for this and every future trial.",
  });

  const seedTreatmentRow = listPickerRow({
    title: "Seed Treatment",
    value: entry.seedTreatment,
    options: listsStore.items(listsStore.CATEGORY.SEED_TREATMENT),
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
    onChange: (v) => trialStore.updateEntry(entryId, { relativeMaturity: v }),
  });

  const identitySection = h("section", { className: "card" }, [
    sectionHeader("Identity"),
    field("Brand / Company", brandWheel.el),
    field("Hybrid", hybridWheelHolder),
    traitRow,
    seedTreatmentRow,
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
    dryYieldInput.placeholder = calc === null ? "Calculated automatically" : `${calc.toFixed(1)} bu/ac (calculated)`;
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
      placeholder: "Notes about this entry…",
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
        onclick: () => navigate("plot-summary"),
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
