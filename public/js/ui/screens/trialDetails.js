// src/ui/screens/trialDetails.js
//
// Cooperator Details / GPS Location / Planting Details / Harvest Details /
// Yield Calculation sections.
// IMPORTANT: this screen does NOT subscribe to trialStore for its own
// re-render — text inputs mutate the store directly via oninput, but we
// never rebuild the DOM in response (that would blow away focus/cursor
// position on every keystroke). Only isolated local UI state (GPS
// status) is patched in place.

import { h, mount, clear } from "../dom.js";
import * as trialStore from "../stores/trialStore.js";
import * as listsStore from "../stores/listsStore.js";
import * as authStore from "../authStore.js";
import * as adminEditStore from "../stores/adminEditStore.js";
import * as geoData from "../geoData.js";
import { kickOffFormNumberAssignment } from "../formNumberAssign.js";
import { createTopBar } from "../components/topBar.js";
import { createWheelSelect, createExtendableWheelSelect } from "../components/wheelSelect.js";
import { createDatePicker } from "../components/datePicker.js";
import { openSearchListPicker } from "../components/searchListPicker.js";
import { navigate } from "../router.js";
import { fetchSoilTypeForCoordinates } from "../../core/soilLookup.js";

// Above this many ZIP matches for a city, an inline row of tappable
// chips gets unwieldy (some large cities have dozens of ZIPs, including
// PO-box/business-only codes) — fall back to the searchable list picker
// used elsewhere in the app for long option lists.
const ZIP_CHIP_LIMIT = 8;

// Base Moisture % is locked at 15.5 (standard corn moisture basis) rather
// than an editable field — Drying Shrink Rate and Price per Bushel still
// vary per plot, but this one no longer does.
const BASE_MOISTURE_LOCKED = 15.5;

// Collected By/Phone/Email are pre-populated (once, while still blank)
// from whoever's account the plot belongs to, but are editable fields from
// there on — someone can collect on another person's behalf, or fix a
// stale phone/email, without it getting silently overwritten on the next
// visit to this screen. "Collected By" no longer means a collection
// METHOD (that was the old wheel picker backed by
// listsStore.CATEGORY.COLLECTED_BY, left in place unused rather than
// removed, in case it's needed again) but WHO: the person's account name,
// "Last Name, First Name", via resolveActiveUser()/lastFirstName() below.
// Phone is normalized to "(555) 555-5555" as it's typed — see
// formatPhoneNumber()/phoneInput() below.

const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"],
  ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["DC", "District of Columbia"],
].map(([code, name]) => ({ label: `${name} (${code})`, value: code }));

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

// Formats a US phone number as "(555) 555-5555", progressively, so it
// reads correctly whether it's the fully pre-populated 10-digit value or
// still being typed/edited by hand. Anything past 10 digits is dropped
// rather than wrapping into an extension — this app has no field for one.
function formatPhoneNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 10);
  if (!digits) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// A plain text input, but every keystroke reformats the field's own value
// to "(555) 555-5555" as it's typed, and the value handed to `oninput` is
// the formatted string (so it's what ends up stored and what appears
// anywhere else this header field is shown, e.g. Plot Summary / exports).
function phoneInput({ value, oninput }) {
  return h("input", {
    type: "tel",
    inputmode: "tel",
    className: "text-input",
    value: formatPhoneNumber(value),
    placeholder: "(555) 555-5555",
    oninput: (e) => {
      const formatted = formatPhoneNumber(e.target.value);
      e.target.value = formatted;
      oninput(formatted);
    },
  });
}

// Which account's details Collected By/Phone/Email should be derived
// from: the plot OWNER's during an admin-edit session (see
// adminEditStore.getOwnerUser()'s comment — a teammate's plot being
// edited on their behalf should still show THEIR info, not the admin's),
// otherwise whoever is actually signed in.
function resolveActiveUser() {
  return adminEditStore.isActive() ? adminEditStore.getOwnerUser() : authStore.getUser();
}

// "Last Name, First Name" for a user record, with the same fallback chain
// already used by adminPlots.js's openUserDetailModal(): firstName/
// lastName if present, else split the combined `name` field (accounts
// that predate firstName/lastName), else the email, else "—".
function lastFirstName(u) {
  if (!u) return "—";
  if (u.firstName || u.lastName) {
    return [u.lastName, u.firstName].filter(Boolean).join(", ") || "—";
  }
  const hasSeparateName = u.name && u.name.trim() && u.name !== u.email;
  if (hasSeparateName) {
    const parts = u.name.trim().split(/\s+/);
    return parts.length > 1 ? `${parts.slice(1).join(" ")}, ${parts[0]}` : parts[0];
  }
  return u.email || "—";
}

function lockedField(displayValue) {
  return h("div", { className: "text-input field-locked" }, [
    h("span", {}, displayValue),
    h("span", { className: "field-locked-tag" }, "Locked"),
  ]);
}

function textAreaInput({ value, placeholder, oninput }) {
  return h("textarea", {
    className: "text-input text-area",
    placeholder: placeholder || "",
    oninput: (e) => oninput(e.target.value),
  }, value || "");
}


export function render(container) {
  // See adminEditStore.clearIfStale()'s comment — safe to call unconditionally.
  adminEditStore.clearIfStale();

  const header = trialStore.getState().header;
  const fixed = listsStore.fixedLists();

  // Correct any older/imported plot whose base moisture isn't the locked
  // 15.5 value — this field is no longer user-editable (see yieldSection
  // below), so nothing should be able to leave it at a stale value.
  if (header.baseMoisturePercent !== BASE_MOISTURE_LOCKED) {
    trialStore.updateHeader({ baseMoisturePercent: BASE_MOISTURE_LOCKED });
  }

  // Collected By/Phone/Email are pre-populated from the current account
  // details (see resolveActiveUser() above) but are now plain editable
  // fields, same as Name/Address/City — so this only fills them in the
  // FIRST time (while still blank, e.g. a brand-new plot), and never
  // overwrites a value that's already there. A later name/phone/email
  // change in Settings no longer reaches back into existing plots; a
  // manual edit made here is the one that sticks.
  const activeUser = resolveActiveUser();
  const derivedCollectedBy = lastFirstName(activeUser);
  const derivedPhone = formatPhoneNumber((activeUser && activeUser.mobileNumber) || "");
  const derivedEmail = (activeUser && activeUser.email) || "";
  const prefillPatch = {};
  if (!header.collectedBy) prefillPatch.collectedBy = derivedCollectedBy;
  if (!header.phone) prefillPatch.phone = derivedPhone;
  if (!header.email) prefillPatch.email = derivedEmail;
  if (Object.keys(prefillPatch).length > 0) {
    trialStore.updateHeader(prefillPatch);
    Object.assign(header, prefillPatch);
  }

  const topBar = createTopBar({
    title: "Plot Details",
    onBack: () => navigate("workspace"),
    backLabel: "Menu",
  });

  // ---- Cooperator section ----
  // header.state/city/county below are a one-time snapshot (this screen
  // never re-renders itself — see the file-level note above), so cross-
  // field logic (county options depending on state, zip lookup depending
  // on state+city) tracks the live values in these locals instead of
  // re-reading the stale `header` object.
  let currentState = header.state;
  let lastCityLookup = null; // last city text a zip lookup ran for; null forces a re-run

  const stateWheel = createWheelSelect({
    title: "State",
    value: header.state,
    options: US_STATES,
    placeholder: "Select",
    showLabel: false,
    onChange: (v) => {
      currentState = v;
      trialStore.updateHeader({ state: v });
      refreshCountyOptions();
      lastCityLookup = null;
      if (cityInput.value.trim() !== "") runCityZipLookup();
      // See formNumberAssign.js's top comment — a no-op unless County is
      // also already set (and unless this plot doesn't already have a
      // Form Number locked in).
      kickOffFormNumberAssignment();
    },
  });

  const countyWheel = createExtendableWheelSelect({
    title: "County",
    value: header.county,
    options: geoData.getCountiesForState(header.state),
    placeholder: "Select",
    showLabel: false,
    disabled: !header.state,
    disabledReason: "Select a state first",
    onChange: (v) => {
      trialStore.updateHeader({ county: v });
      // Background FIPS lookup + Form Number reservation — see
      // formNumberAssign.js's top comment.
      kickOffFormNumberAssignment();
    },
    onAddNew: (raw) => raw,
    addNewPromptMessage: "Enter the county name.",
  });

  function refreshCountyOptions() {
    if (!currentState) {
      countyWheel.setDisabled(true, "Select a state first");
      countyWheel.setOptions([]);
      return;
    }
    countyWheel.setDisabled(false);
    countyWheel.setOptions(geoData.getCountiesForState(currentState));
  }

  const zipInput = textInput({
    value: header.zip,
    inputmode: "numeric",
    oninput: (v) => trialStore.updateHeader({ zip: v }),
  });

  const zipStatusEl = h("p", { className: "field-status" }, "");
  const zipChoicesEl = h("div", { className: "zip-choice-list" });

  function setZipStatus(text, active) {
    zipStatusEl.textContent = text;
    zipStatusEl.className = "field-status" + (active ? " field-status-active" : "");
  }

  function clearZipChoices() {
    clear(zipChoicesEl);
  }

  function commitZipChoice(z) {
    zipInput.value = z;
    trialStore.updateHeader({ zip: z });
    setZipStatus(`Zip set to ${z}.`, true);
    clearZipChoices();
  }

  function showZipChoices(zips, cityVal) {
    clearZipChoices();
    if (zips.length > ZIP_CHIP_LIMIT) {
      zipChoicesEl.appendChild(
        h(
          "button",
          {
            type: "button",
            className: "zip-choice-btn",
            onclick: () =>
              openSearchListPicker({
                title: `ZIP Codes in ${cityVal}`,
                value: zipInput.value,
                options: zips,
                onChange: (z) => commitZipChoice(z),
              }),
          },
          `Choose from ${zips.length} ZIP codes…`
        )
      );
      return;
    }
    for (const z of zips) {
      zipChoicesEl.appendChild(
        h(
          "button",
          {
            type: "button",
            className: "zip-choice-btn" + (z === zipInput.value ? " zip-choice-btn-selected" : ""),
            onclick: () => commitZipChoice(z),
          },
          z
        )
      );
    }
  }

  function runCityZipLookup() {
    const cityVal = cityInput.value.trim();
    if (cityVal === "" || cityVal === lastCityLookup) return;
    lastCityLookup = cityVal;
    clearZipChoices();
    if (!currentState) {
      setZipStatus("Select a state to look up ZIP codes for this city.", false);
      return;
    }
    const zips = geoData.getZipsForCity(currentState, cityVal);
    if (zips.length === 0) {
      setZipStatus("", false);
    } else if (zips.length === 1) {
      zipInput.value = zips[0];
      trialStore.updateHeader({ zip: zips[0] });
      setZipStatus(`Zip auto-filled from ${cityVal}.`, true);
    } else {
      setZipStatus(`${zips.length} ZIP codes found for ${cityVal} — choose one, or type your own.`, true);
      showZipChoices(zips, cityVal);
    }
  }

  const cityInput = textInput({
    value: header.city,
    oninput: (v) => trialStore.updateHeader({ city: v }),
  });
  cityInput.addEventListener("change", () => runCityZipLookup());

  // County options and any pending city/zip lookup both depend on the
  // geo dataset, which loads asynchronously (and may still be loading
  // the first time this screen mounts).
  geoData.ensureLoaded().then(() => {
    refreshCountyOptions();
    lastCityLookup = null;
    if (cityInput.value.trim() !== "") runCityZipLookup();
  });

  const cooperatorSection = h("section", { className: "card" }, [
    sectionHeader("Cooperator Details"),
    field("Name", textInput({ value: header.cooperatorName, oninput: (v) => trialStore.updateHeader({ cooperatorName: v }) })),
    field("Address", textInput({ value: header.address, oninput: (v) => trialStore.updateHeader({ address: v }) })),
    field("State", stateWheel.el),
    field("County", countyWheel.el),
    field("City", cityInput),
    field("Zip", h("div", {}, [zipInput, zipStatusEl, zipChoicesEl])),
  ]);

  // ---- GPS section ----
  // GPS coordinates are always stored rounded to 6 decimal places (~11cm
  // of precision at the equator — plenty for identifying a field/plot),
  // regardless of whether they came from the device's raw geolocation
  // reading (which commonly reports 12+ decimal digits) or manual entry.
  function round6(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  function commitLat(raw) {
    if (raw.trim() === "") {
      trialStore.updateHeader({ gpsLatitude: null });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    trialStore.updateHeader({ gpsLatitude: round6(Math.abs(n)) });
  }
  function commitLon(raw) {
    if (raw.trim() === "") {
      trialStore.updateHeader({ gpsLongitude: null });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    trialStore.updateHeader({ gpsLongitude: round6(-Math.abs(n)) });
  }

  const latInput = textInput({
    value: header.gpsLatitude === null || header.gpsLatitude === undefined ? "" : String(header.gpsLatitude),
    placeholder: "e.g. 41.878",
    inputmode: "decimal",
    oninput: () => {},
  });
  latInput.addEventListener("change", (e) => commitLat(e.target.value));

  const lonInput = textInput({
    value: header.gpsLongitude === null || header.gpsLongitude === undefined ? "" : String(header.gpsLongitude),
    placeholder: "e.g. -93.097",
    inputmode: "decimal",
    oninput: () => {},
  });
  lonInput.addEventListener("change", (e) => commitLon(e.target.value));

  const locationStatusEl = h("p", { className: "location-status" }, "");

  function setLocationStatus(text, kind) {
    locationStatusEl.textContent = text;
    locationStatusEl.className = "location-status" + (kind ? ` location-status-${kind}` : "");
  }

  // Runs after GPS succeeds: looks up the most prevalent soil texture at
  // that point (USDA NRCS SSURGO data, via soilLookup.js) and, if a
  // confident match is found, pre-populates the Soil Type wheel with it.
  // Never blocks or errors the GPS status itself — a failed/inconclusive
  // soil lookup just leaves Soil Type for manual selection, same as
  // before this feature existed. References `soilTypeWheel` and `fixed`,
  // both defined further down in this same render() call — safe since
  // this only ever actually runs later, after render() has finished
  // building the whole screen (either from the button's onclick or from
  // the auto-locate call at the end of render()).
  async function attemptSoilLookup(lat, lon, accuracy) {
    const accuracyText = `Location captured (±${Math.round(accuracy)}m).`;
    const matched = await fetchSoilTypeForCoordinates(lat, lon, fixed.soilTypeOptions);
    if (matched) {
      trialStore.updateHeader({ soilType: matched });
      soilTypeWheel.setValue(matched);
      setLocationStatus(`${accuracyText} Soil type set to ${matched}.`, "success");
    } else {
      setLocationStatus(`${accuracyText} Couldn't determine a soil type for this location — select manually.`, "success");
    }
  }

  // Shared by both the "Use Device Location or Enter Manually" button and
  // the automatic attempt (see the bottom of render()) that fires on its
  // own for a plot that doesn't have GPS coordinates yet — "default to
  // the device location" means the user shouldn't have to tap anything
  // first, but the button still exists as a manual re-trigger (e.g. after
  // moving to a different field, or after initially denying permission).
  async function runLocationCapture() {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Geolocation isn't supported on this device.", "failure");
      return;
    }
    setLocationStatus("Requesting location permission…", "requesting");
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: "geolocation" });
        if (status.state === "denied") {
          setLocationStatus("Location permission denied. Enable it in your browser's site settings.", "failure");
          return;
        }
      }
    } catch (e) {
      // Permissions API not available on this browser (e.g. Safari) — proceed anyway.
    }

    setLocationStatus("Locating…", "locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = round6(Math.abs(pos.coords.latitude));
        const lon = round6(-Math.abs(pos.coords.longitude));
        trialStore.updateHeader({ gpsLatitude: lat, gpsLongitude: lon });
        latInput.value = String(lat);
        lonInput.value = String(lon);
        setLocationStatus(`Location captured (±${Math.round(pos.coords.accuracy)}m). Looking up soil type…`, "success");
        attemptSoilLookup(lat, lon, pos.coords.accuracy);
      },
      (err) => {
        setLocationStatus(err.message || "Unable to determine location.", "failure");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  const useLocationBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-secondary",
      onclick: runLocationCapture,
    },
    "Use Device Location or Enter Manually"
  );

  const gpsSection = h("section", { className: "card" }, [
    sectionHeader("GPS Location"),
    field("Latitude", latInput),
    field("Longitude", lonInput),
    useLocationBtn,
    locationStatusEl,
    h("p", { className: "field-note" }, "Latitude is always stored as positive (N), longitude as negative (W)."),
  ]);

  // ---- Planting section ----
  // showLabel: false on every wheel below — its title is already shown
  // once, as the field() label above the row (see cooperatorSection's
  // State/County wheels for the same treatment) — and placeholder:
  // "Select" replaces whatever grayed-out text an empty one used to show
  // with a single consistent word, rather than repeating the field's own
  // title a second time in muted text.
  const tillageWheel = createWheelSelect({
    title: "Tillage",
    value: header.tillage,
    options: fixed.tillageOptions,
    placeholder: "Select",
    showLabel: false,
    onChange: (v) => trialStore.updateHeader({ tillage: v }),
  });
  const irrigationWheel = createWheelSelect({
    title: "Irrigation",
    value: header.irrigation,
    options: fixed.irrigationOptions,
    placeholder: "Select",
    showLabel: false,
    onChange: (v) => trialStore.updateHeader({ irrigation: v }),
  });
  const soilTypeWheel = createWheelSelect({
    title: "Soil Type",
    value: header.soilType,
    options: fixed.soilTypeOptions,
    placeholder: "Select",
    showLabel: false,
    onChange: (v) => trialStore.updateHeader({ soilType: v }),
  });
  const previousCropWheel = createWheelSelect({
    title: "Previous Crop",
    value: header.previousCrop,
    options: fixed.previousCropOptions,
    placeholder: "Select",
    showLabel: false,
    onChange: (v) => trialStore.updateHeader({ previousCrop: v }),
  });

  const populationOptions = [];
  for (let p = 14000; p <= 46000; p += 500) populationOptions.push(String(p));
  const populationWheel = createWheelSelect({
    title: "Planting Population",
    value: header.plantingPopulation || "32000",
    options: populationOptions,
    placeholder: "Select",
    showLabel: false,
    onChange: (v) => trialStore.updateHeader({ plantingPopulation: v }),
  });

  const plantingSection = h("section", { className: "card" }, [
    sectionHeader("Planting Details"),
    field(
      "Date Planted",
      createDatePicker({
        value: header.datePlanted || null,
        onChange: (v) => trialStore.updateHeader({ datePlanted: v }),
      }).el
    ),
    field("Tillage", tillageWheel.el),
    field("Irrigation", irrigationWheel.el),
    h("label", { className: "field" }, [
      h("span", { className: "field-label" }, "Soil Type"),
      h(
        "p",
        { className: "field-note" },
        "Pre-populated from GPS Location. To change, select from the dropdown list."
      ),
      soilTypeWheel.el,
    ]),
    field("Previous Crop", previousCropWheel.el),
    field("Planting Population", populationWheel.el),
  ]);

  // ---- Harvest section ----
  // Collected By/Phone/Email are pre-populated from the account's details
  // (see resolveActiveUser()/lastFirstName() above and the one-time
  // prefill above) but are now ordinary editable fields, same as
  // Name/Address/City — someone collecting on behalf of another person,
  // or correcting a stale phone number, can just type over them.
  const harvestSection = h("section", { className: "card" }, [
    sectionHeader("Harvest Details"),
    field(
      "Date Harvested",
      createDatePicker({
        value: header.dateHarvested || null,
        onChange: (v) => trialStore.updateHeader({ dateHarvested: v }),
      }).el
    ),
    field("Collected By", textInput({ value: header.collectedBy, oninput: (v) => trialStore.updateHeader({ collectedBy: v }) })),
    field("Phone", phoneInput({ value: header.phone, oninput: (v) => trialStore.updateHeader({ phone: v }) })),
    field("Email", textInput({ value: header.email, type: "email", inputmode: "email", oninput: (v) => trialStore.updateHeader({ email: v }) })),
  ]);

  // ---- Yield Calculation section ----
  const yieldSection = h("section", { className: "card" }, [
    sectionHeader("Yield Calculation"),
    field("Base Moisture %", lockedField(`${BASE_MOISTURE_LOCKED}%`)),
    field(
      "Drying Shrink Rate",
      textInput({
        value: String(header.dryingShrinkRate),
        inputmode: "decimal",
        oninput: (v) => {
          const n = Number(v);
          if (Number.isFinite(n)) trialStore.updateHeader({ dryingShrinkRate: n });
        },
      })
    ),
    field(
      "Price per Bushel",
      textInput({
        value: String(header.pricePerBushel),
        inputmode: "decimal",
        oninput: (v) => {
          const n = Number(v);
          if (Number.isFinite(n)) trialStore.updateHeader({ pricePerBushel: n });
        },
      })
    ),
    field(
      "Plot Notes",
      textAreaInput({
        value: header.trialNotes,
        placeholder: "Enter notes about this plot here. Examples include: Hail Damage, Flooded, Severe Wind, etc…",
        oninput: (v) => trialStore.updateHeader({ trialNotes: v }),
      })
    ),
    h(
      "p",
      { className: "field-note" },
      "Base moisture (fixed at 15.5%), drying shrink rate, and price per bushel are used to calculate Gross $/ac across all entries."
    ),
  ]);

  // ---- Bottom action: move on to entering hybrids for this plot ----
  const continueToEntriesBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-primary btn-block",
      onclick: () => {
        const entry = trialStore.addEntryCarryingMeasurements();
        navigate("entry-editor", { entryId: entry.id });
      },
    },
    "Continue to Hybrid Entries"
  );

  const screen = h("div", { className: "screen trial-details-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      cooperatorSection,
      gpsSection,
      plantingSection,
      harvestSection,
      yieldSection,
      continueToEntriesBtn,
    ]),
  ]);

  mount(container, screen);

  // "Default to the device location" — for a plot that doesn't have GPS
  // coordinates yet, go get them automatically rather than waiting for
  // the user to tap "Use Device Location or Enter Manually" first (that
  // button still exists for a manual re-trigger, e.g. after moving to a
  // different field, or retrying after an earlier denial). Never
  // re-triggers once coordinates exist — same "don't overwrite what's
  // already there" rule as the State-defaults-to-Iowa behavior — so this
  // only fires for a genuinely new/not-yet-located plot, not every time
  // this screen is revisited for one that already has a location.
  if (!Number.isFinite(header.gpsLatitude) && !Number.isFinite(header.gpsLongitude)) {
    runLocationCapture();
  }
}
