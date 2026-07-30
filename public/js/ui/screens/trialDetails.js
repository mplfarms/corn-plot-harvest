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
import { createTopBar } from "../components/topBar.js";
import { showConfirm } from "../components/modal.js";
import { openMapPicker } from "../mapPicker.js";
import { createWheelSelect, createExtendableWheelSelect } from "../components/wheelSelect.js";
import { createDatePicker } from "../components/datePicker.js";
import { openSearchListPicker } from "../components/searchListPicker.js";
import { navigate } from "../router.js";
import { fetchSoilTypeForCoordinates } from "../../core/soilLookup.js";
import {
  fetchRegionForCoordinates,
  snapToKnownName,
  cleanCityCandidate,
  fetchNearbyCityCandidatesByRadius,
} from "../../core/locationLookup.js";
import { ensureFormIdAssignedWithFeedback } from "../formIdAssign.js";

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
  let digits = String(raw || "").replace(/\D/g, "");
  // Chrome's (and some other browsers') autofill commonly prepends the US
  // country code "1" ahead of the real 10-digit number when it fills this
  // field from a saved contact — without stripping it, the result would
  // be an 11-digit number that renders as something like
  // "(155) 555-5555" instead of the correct "(555) 555-5555". Only strip
  // it when it's clearly a country-code prefix (exactly 11 digits,
  // leading "1") — a genuine 10-digit number starting with "1" on its
  // own can't happen (US area codes never start with 1), so this can't
  // misfire and eat a real digit.
  if (digits.length === 11 && digits[0] === "1") {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
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
      const prevState = currentState;
      currentState = v;
      trialStore.updateHeader({ state: v });
      refreshCountyOptions();
      refreshCityDisabled();
      lastCityLookup = null;

      // Switching to a DIFFERENT state clears out location fields that
      // belonged to the old one — per audit finding/explicit approval:
      // previously the old County (possibly not even a county of the
      // new state) and City lingered, and the Zip silently re-filled
      // for the old city under the NEW state's list. A County/City that
      // happens to exist in the new state too is kept. Judged only when
      // the geo lists are actually loaded — with no list there's
      // nothing safe to judge against.
      if (v !== prevState) {
        const header2 = trialStore.getState().header;
        const newCounties = geoData.getCountiesForState(v);
        if ((header2.county || "").trim() && newCounties.length > 0 && !snapToKnownName(header2.county, newCounties)) {
          trialStore.updateHeader({ county: "" });
          countyWheel.setValue("");
        }
        const newCities = geoData.getCityNamesForState(v);
        if (cityValue.trim() && newCities.length > 0 && !snapToKnownName(cityValue, newCities)) {
          setCityDisplay("");
          trialStore.updateHeader({ city: "", zip: "" });
          zipInput.value = "";
          setZipStatus("", false);
          clearZipChoices();
          nearbyTowns = [];
          renderNearbyTownChoices();
          setCityStatus("", false);
        }
      }

      if (cityValue.trim() !== "") runCityZipLookup();
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
    onChange: (v) => trialStore.updateHeader({ county: v }),
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
    const cityVal = cityValue.trim();
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

  // ---- City: a searchable selection list (per explicit request) ----
  // Works exactly like the Company/Hybrid pickers on the Entry Editor:
  // tap to open a scrollable list of every town in the selected State,
  // start typing to filter down, tap to pick — so details can be
  // entered for a distant location without GPS. A town that's somehow
  // missing from the list can still be typed and added inline (the
  // picker's `+ Add "…"` row), same as adding a custom Hybrid.
  let cityValue = header.city || "";

  const cityValueEl = h(
    "span",
    { className: "wheel-row-value" + (cityValue ? "" : " wheel-row-placeholder") },
    cityValue || "Select"
  );

  function setCityDisplay(v) {
    cityValue = v || "";
    cityValueEl.textContent = cityValue || "Select";
    cityValueEl.classList.toggle("wheel-row-placeholder", !cityValue);
  }

  // A city chosen by hand (picker tap or inline add) drives Zip the same
  // way a nearby-town chip tap does: the Zip re-fills to follow the new
  // town (single zip fills directly, multiple zips show chooser chips).
  function commitCityChoice(v) {
    setCityDisplay(v);
    trialStore.updateHeader({ city: cityValue });
    zipInput.value = "";
    trialStore.updateHeader({ zip: "" });
    lastCityLookup = null;
    runCityZipLookup();
    renderNearbyTownChoices();
  }

  const cityDisabledReasonEl = h("p", { className: "wheel-disabled-reason" }, "Select a state first");

  const cityRowBtn = h(
    "button",
    {
      type: "button",
      className: "wheel-row-header",
      onclick: () => {
        if (!currentState) return;
        openSearchListPicker({
          title: "City",
          value: cityValue,
          options: geoData.getCityNamesForState(currentState),
          onChange: (v) => commitCityChoice(v),
          onAddNew: (raw) => raw.trim(),
          addNewHint: "Not finding the town? Type its name and tap Add.",
        });
      },
    },
    [cityValueEl, h("span", { className: "wheel-chevron" }, "›")]
  );

  const cityRow = h("div", { className: "wheel-row" }, [cityRowBtn, cityDisabledReasonEl]);

  function refreshCityDisabled() {
    const disabled = !currentState;
    cityRowBtn.disabled = disabled;
    cityRow.classList.toggle("wheel-row-disabled", disabled);
    cityDisabledReasonEl.style.display = disabled ? "" : "none";
  }
  refreshCityDisabled();

  // ---- Nearby-towns selection box (GPS city autofill) ----
  // After a GPS capture, the nearest incorporated town pre-populates the
  // City field and this list shows every qualifying town found within
  // the search radius, nearest first with distances — tap one to adjust,
  // per explicit request ("Pre populate nearest but allow user to adjust
  // in selection box"). Reuses the zip-choice chip styling on purpose:
  // same "auto-filled, tap to change" interaction the Zip field already
  // has right below.
  const cityStatusEl = h("p", { className: "field-status" }, "");
  const cityChoicesEl = h("div", { className: "zip-choice-list city-nearby-list" });

  function setCityStatus(text, active) {
    cityStatusEl.textContent = text;
    cityStatusEl.className = "field-status" + (active ? " field-status-active" : "");
  }

  function commitNearbyTownChoice(town) {
    setCityDisplay(town.name);
    trialStore.updateHeader({ city: town.name });
    // The town choice drives Zip: re-run the city->zip lookup fresh so
    // the Zip follows the newly picked town (single zip fills directly,
    // multiple zips show the existing chooser chips).
    zipInput.value = "";
    trialStore.updateHeader({ zip: "" });
    lastCityLookup = null;
    runCityZipLookup();
    renderNearbyTownChoices();
  }

  let nearbyTowns = [];

  function renderNearbyTownChoices() {
    clear(cityChoicesEl);
    if (nearbyTowns.length === 0) return;
    const current = cityValue.trim().toLowerCase();
    for (const town of nearbyTowns) {
      cityChoicesEl.appendChild(
        h(
          "button",
          {
            type: "button",
            className:
              "zip-choice-btn" + (town.name.toLowerCase() === current ? " zip-choice-btn-selected" : ""),
            // preventDefault/stopPropagation: belt-and-suspenders against
            // any label-activation forwarding (see the cooperatorSection
            // comment) — tapping a chip must ONLY pick the town, never
            // also open the City selection list, per explicit request.
            onclick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              commitNearbyTownChoice(town);
            },
          },
          `${town.name} — ${town.distanceMiles.toFixed(1)} mi`
        )
      );
    }
  }

  function showNearbyTowns(towns, radiusUsed) {
    nearbyTowns = towns;
    setCityStatus(
      towns.length > 1
        ? `Nearest town auto-filled — towns within ${radiusUsed} miles, tap to adjust:`
        : `Nearest town auto-filled (only one found within ${radiusUsed} miles).`,
      true
    );
    renderNearbyTownChoices();
  }

  // Nearby-towns radii: prefer towns within 10 miles (per explicit
  // request); fall back to 15 (tightened from 25 per follow-up) when
  // open country has nothing incorporated that close.
  const NEARBY_TOWN_NEAR_RADIUS_MILES = 10;
  const NEARBY_TOWN_WIDE_RADIUS_MILES = 15;

  // SPEED-UP (per explicit request): ONE network query at the wide
  // 15-mile radius, partitioned locally, instead of the old
  // ask-at-10-then-ask-again-at-15 double round trip. The app computes
  // every town's exact distance anyway, so the 10-mile preference is
  // just a local filter: when anything incorporated sits within 10
  // miles, only those towns show (exactly as before); otherwise the
  // full within-15 list shows. Same lists, same chips, same status
  // wording — the slowest case (open country, standing in the field)
  // drops from two round trips to one. Places are snapped against the
  // app's own city list for the state (the "real incorporated towns,
  // not townships" filter), deduped keeping each town's closest
  // distance, nearest first.
  function partitionNearbyTowns(places, cityNames) {
    const byName = new Map();
    for (const place of places) {
      const snapped = snapToKnownName(cleanCityCandidate(place.name), cityNames);
      if (!snapped) continue;
      const existing = byName.get(snapped);
      if (existing === undefined || place.distanceMiles < existing) byName.set(snapped, place.distanceMiles);
    }
    const all = [...byName.entries()]
      .map(([name, d]) => ({ name, distanceMiles: d }))
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
    const near = all.filter((t) => t.distanceMiles <= NEARBY_TOWN_NEAR_RADIUS_MILES);
    if (near.length > 0) return { radiusUsed: NEARBY_TOWN_NEAR_RADIUS_MILES, towns: near };
    if (all.length > 0) return { radiusUsed: NEARBY_TOWN_WIDE_RADIUS_MILES, towns: all };
    return { radiusUsed: null, towns: [] };
  }

  // County options and any pending city/zip lookup both depend on the
  // geo dataset, which loads asynchronously (and may still be loading
  // the first time this screen mounts).
  geoData.ensureLoaded().then(() => {
    refreshCountyOptions();
    lastCityLookup = null;
    if (cityValue.trim() !== "") runCityZipLookup();
  });

  // Form ID — a short, permanent reference number for this exact plot
  // (see core/formId.js's top comment). NOT reserved automatically from
  // here — by default, a Form ID is only ever generated the moment the
  // user taps "Save Plot" on the Entry Editor (see ensureFormIdAssigned()
  // there), so simply opening/browsing Plot Details never burns a number
  // on its own. Once assigned, this is a plain, static note. Until then,
  // it doubles as a manual "tap to try now" retry button — a visible
  // backstop for a plot that WAS already saved (so its number should
  // exist) but still shows nothing, most likely because the earlier
  // background attempt hit a connection/server problem that failed
  // silently. Tapping it uses ensureFormIdAssignedWithFeedback() (not the
  // plain, silent ensureFormIdAssigned()) specifically because this is an
  // explicit user action — an explicit tap that fails should say so,
  // rather than just quietly doing nothing again.
  const formIdNote = header.formId
    ? h("p", { className: "field-note trial-details-form-id-note" }, `Form ID: ${header.formId}`)
    : h(
        "button",
        {
          type: "button",
          className: "field-note trial-details-form-id-note trial-details-form-id-retry-btn",
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = "Form ID: assigning…";
            const ok = await ensureFormIdAssignedWithFeedback();
            if (ok) {
              const latest = trialStore.getState().header;
              btn.textContent = `Form ID: ${latest.formId}`;
            } else {
              btn.disabled = false;
              btn.textContent = "Form ID: will be assigned when you save this plot (tap to try now)";
            }
          },
        },
        "Form ID: will be assigned when you save this plot (tap to try now)"
      );

  const cooperatorSection = h("section", { className: "card" }, [
    sectionHeader("Cooperator Details"),
    formIdNote,
    field("Name", textInput({ value: header.cooperatorName, oninput: (v) => trialStore.updateHeader({ cooperatorName: v }) })),
    field("Cooperator Address", textInput({ value: header.address, oninput: (v) => trialStore.updateHeader({ address: v }) })),
    h("p", { className: "field-note trial-details-address-note" }, "Leave blank if not known."),
    field("State", stateWheel.el),
    field("County", countyWheel.el),
    // cityStatusEl/cityChoicesEl sit OUTSIDE the field()'s <label> on
    // purpose: a click anywhere inside a label activates the label's
    // first button — which here is the City picker row — so nearby-town
    // chips nested inside the label would commit their town AND pop the
    // full City selection list right after (real field report). As
    // plain siblings, a chip tap just picks the town, nothing else.
    field("City", cityRow),
    cityStatusEl,
    cityChoicesEl,
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

  // Typing coordinates by hand marks the location's source as "manual"
  // — the capture button drops out of its "Device Location Enabled"
  // state (per explicit request), and tapping it again first asks
  // before overriding the manually entered data (see the button's
  // onclick below).
  function markGpsManual() {
    trialStore.updateHeader({ gpsSource: "manual" });
    markLocationDisabled();
  }

  function commitLat(raw) {
    if (raw.trim() === "") {
      trialStore.updateHeader({ gpsLatitude: null });
      markGpsManual();
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    trialStore.updateHeader({ gpsLatitude: round6(Math.abs(n)) });
    markGpsManual();
  }
  function commitLon(raw) {
    if (raw.trim() === "") {
      trialStore.updateHeader({ gpsLongitude: null });
      markGpsManual();
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    trialStore.updateHeader({ gpsLongitude: round6(-Math.abs(n)) });
    markGpsManual();
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
  // building the whole screen (it's reached only from the capture
  // button's onclick; nothing auto-fires on open).
  // statusPrefix: the "where these coordinates came from" lead-in for
  // the status line — "Location captured (±8m)." from the device
  // button, "Location set from the map." from the map picker.
  async function attemptSoilLookup(lat, lon, statusPrefix) {
    const matched = await fetchSoilTypeForCoordinates(lat, lon, fixed.soilTypeOptions);
    if (matched) {
      trialStore.updateHeader({ soilType: matched });
      soilTypeWheel.setValue(matched);
      setLocationStatus(`${statusPrefix} Soil type set to ${matched}.`, "success");
    } else {
      setLocationStatus(`${statusPrefix} Couldn't determine a soil type for this location — select manually.`, "success");
    }
  }

  // Runs alongside attemptSoilLookup() after GPS succeeds — per explicit
  // request: reverse-geocodes the captured coordinate into State +
  // County (FCC Area API) and the nearest City (BigDataCloud), and
  // pre-fills ONLY the fields that are still blank. A value the user
  // already picked/typed is never overwritten — GPS reflects where the
  // phone is standing, which isn't necessarily the plot being entered
  // (e.g. entering last week's plot from the kitchen table). County and
  // City are snapped onto this app's own lists for that state (see
  // snapToKnownName) so an auto-filled value matches what the pickers
  // would offer — and the snapped City keeps the zip auto-fill working.
  // Fails soft in every direction (see locationLookup.js): no
  // connection or an inconclusive answer just leaves the fields for
  // manual entry, exactly as before this feature existed. Deliberately
  // does NOT touch the location status line — that's the soil lookup's
  // to finish (racing the two lookups' completion order over one status
  // line would make its final text a coin flip).
  // A brand-new plot's State defaults to "IA" (see models.js's header
  // default) — for the state-fill rule below, that untouched default is
  // treated as fillable, NOT as a manual entry (real field report: a
  // Nebraska capture filled County/City correctly but left State stuck
  // on the Iowa default, which also made the county snap against the
  // wrong state's list).
  const DEFAULT_NEW_PLOT_STATE = "IA";

  async function attemptRegionLookup(lat, lon) {
    const before = trialStore.getState().header;
    // State counts as fillable when it's blank OR still the untouched
    // new-plot default with the whole location group (county/city/zip)
    // untouched too — a deliberately-picked State always has SOMETHING
    // filled around it, or differs from the default. A GPS capture in
    // Iowa overwrites IA with IA harmlessly either way.
    const stateVal = (before.state || "").trim();
    const locationGroupUntouched =
      !(before.county || "").trim() && !(before.city || "").trim() && !(before.zip || "").trim();
    const stateFillable = !stateVal || (stateVal === DEFAULT_NEW_PLOT_STATE && locationGroupUntouched);
    const needCounty = !(before.county || "").trim();
    const needCity = !(before.city || "").trim();
    if (!stateFillable && !needCounty && !needCity) return;

    // SPEED-UP (per explicit request): the nearby-towns radius query
    // starts NOW, in parallel with the state/county reverse-geocode —
    // the query itself doesn't need the state (only the snap-filter
    // later does), so there's no reason to run the two in sequence.
    // Fails soft to [] like every other lookup, so this promise never
    // rejects.
    const nearbyPlacesPromise = needCity
      ? fetchNearbyCityCandidatesByRadius(lat, lon, NEARBY_TOWN_WIDE_RADIUS_MILES)
      : Promise.resolve([]);

    const region = await fetchRegionForCoordinates(lat, lon, { wantCity: needCity });
    await geoData.ensureLoaded();

    // Re-read AFTER the network round-trip — the user may have filled
    // something in by hand while the lookup was in flight, and a manual
    // entry always wins.
    const now = trialStore.getState().header;
    const patch = {};

    const nowStateVal = (now.state || "").trim();
    const nowStateStillFillable =
      !nowStateVal ||
      (nowStateVal === DEFAULT_NEW_PLOT_STATE &&
        !(now.county || "").trim() &&
        !(now.city || "").trim() &&
        !(now.zip || "").trim());
    if (stateFillable && region.stateCode && nowStateStillFillable && region.stateCode !== nowStateVal) {
      patch.state = region.stateCode;
      currentState = region.stateCode;
      stateWheel.setValue(region.stateCode);
      refreshCountyOptions();
    }

    // County/City snap against whichever state is in effect now — the
    // state just auto-filled from this same coordinate when there is
    // one, else whatever the field already held.
    const effectiveState = patch.state || nowStateVal || "";

    if (needCounty && region.countyName && !(now.county || "").trim() && effectiveState) {
      // Snap to the state's own county list; when nothing matches, fall
      // back to the raw name minus any " County" suffix (the app's
      // lists don't carry the suffix — a real capture once stored "Hall
      // County" verbatim because it snapped against the wrong state).
      const countyValue =
        snapToKnownName(region.countyName, geoData.getCountiesForState(effectiveState)) ||
        region.countyName.replace(/\s+county$/i, "").trim();
      patch.county = countyValue;
      countyWheel.setValue(countyValue);
    }

    if (needCity && !(now.city || "").trim() && effectiveState) {
      const cityNames = geoData.getCityNamesForState(effectiveState);

      // PRIMARY: a radius search for incorporated towns near the point
      // (10 miles, widening once to 25) — per explicit request/field
      // report, a rural GPS point often isn't "in" any incorporated
      // place, so asking "what towns are NEAR here" beats asking "what
      // place is here". The nearest one pre-populates City and the full
      // nearest-first list renders as a tap-to-adjust selection box
      // under the field.
      // The radius query has been in flight since before the
      // state/county lookup (see nearbyPlacesPromise above) — by now
      // it's usually already resolved; snap-filter its places against
      // this state's own city list.
      const nearby = partitionNearbyTowns(await nearbyPlacesPromise, cityNames);

      let autoCity = null;
      if (nearby.towns.length > 0) {
        autoCity = nearby.towns[0].name;
      } else {
        // FALLBACK (radius service unreachable or nothing incorporated
        // within 15 miles): the reverse-geocode candidate walk — the
        // FIRST candidate that matches the app's own city list for this
        // state wins; that list is real postal towns, which is exactly
        // the "nearest incorporated town, not a township" filter (per
        // explicit field report: "Township of South Loup" is not a
        // useful City). NO raw fallback below that: a name that matches
        // nothing leaves City blank for manual entry rather than
        // storing a township label.
        for (const candidate of region.cityCandidates || []) {
          autoCity = snapToKnownName(candidate, cityNames);
          if (autoCity) break;
        }
      }

      if (autoCity) {
        // Guard against the user having picked a City while the radius
        // lookup was in flight — a manual entry always wins.
        if (cityValue.trim() === "") {
          patch.city = autoCity;
          setCityDisplay(autoCity);
          if (nearby.towns.length > 0) showNearbyTowns(nearby.towns, nearby.radiusUsed);
          // Kick the existing city->zip auto-fill, but only when Zip is
          // still blank too — the fill-blanks-only rule applies to it as
          // much as to the fields above.
          if (!(now.zip || "").trim() && !zipInput.value.trim()) {
            lastCityLookup = null;
            runCityZipLookup();
          }
        }
      }
    }

    // FINAL race guard, re-read at commit time: the city radius search
    // above is a second long await (Overpass, up to two 10s timeouts),
    // and the `now` snapshot predates it — a State or County the user
    // picked DURING that window must win over the lookup's result (the
    // City field already had this guard; State/County were the gap —
    // real probe: a county picked mid-lookup was silently reverted).
    const latest = trialStore.getState().header;
    if (patch.state && (latest.state || "").trim() !== nowStateVal) {
      // The user changed State mid-lookup — drop the state patch AND the
      // county that was snapped against the lookup's state.
      delete patch.state;
      delete patch.county;
    }
    if (patch.county && (latest.county || "").trim() !== "") {
      // County was blank at the snapshot; the user filled it mid-lookup.
      delete patch.county;
    }
    if (patch.city && (latest.city || "").trim() !== "" && (latest.city || "").trim() !== patch.city) {
      delete patch.city;
    }
    if (Object.keys(patch).length > 0) trialStore.updateHeader(patch);
  }

  // Runs ONLY from the "Use Device for Location & Soil Type" button at
  // the top of the screen (location capture is tap-only — per explicit
  // request, nothing fires automatically on open). The button doubles
  // as a re-capture after moving to a different field, or a retry after
  // initially denying permission.
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
        trialStore.updateHeader({ gpsLatitude: lat, gpsLongitude: lon, gpsSource: "device" });
        latInput.value = String(lat);
        lonInput.value = String(lon);
        markLocationEnabled();
        setLocationStatus(`Location captured (±${Math.round(pos.coords.accuracy)}m). Looking up soil type…`, "success");
        attemptSoilLookup(lat, lon, `Location captured (±${Math.round(pos.coords.accuracy)}m).`);
        attemptRegionLookup(lat, lon);
      },
      (err) => {
        setLocationStatus(err.message || "Unable to determine location.", "failure");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // "Probably a desk computer, not a phone/tablet" — no touch screen
  // AND a fine (mouse-style) pointer. A desktop browser has no GPS
  // chip; it guesses location from the internet connection, which can
  // be miles off — exactly the wrong input for the soil/region
  // lookups. Deliberately a heuristic + WARNING rather than hiding the
  // button (per explicit answered question): a misdetected tablet user
  // in the field just answers Yes and carries on.
  function isProbablyDesktop() {
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const touch = (navigator.maxTouchPoints || 0) > 0;
    return !coarse && !touch;
  }

  const useLocationBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-secondary btn-block",
      // Two possible confirmations, in order:
      //  1. Stored coordinates were typed MANUALLY — using the device
      //     would override them; ask first (per explicit request).
      //  2. This looks like a desk computer — its location guess can be
      //     miles off; warn first (per explicit request).
      // A device-sourced (or pre-gpsSource legacy) location on a phone
      // re-captures without any questions, as before.
      onclick: async () => {
        const hdr = trialStore.getState().header;
        const hasCoords = Number.isFinite(hdr.gpsLatitude) && Number.isFinite(hdr.gpsLongitude);
        if (hasCoords && hdr.gpsSource === "manual") {
          const ok = await showConfirm({
            title: "Override Manual Location",
            message:
              "Turning on device location will replace the coordinates you entered manually (and re-run the region and soil type lookups). Are you sure?",
            confirmLabel: "Yes",
            cancelLabel: "No",
          });
          if (!ok) return;
        }
        if (isProbablyDesktop()) {
          const ok = await showConfirm({
            title: "Not a Phone or Tablet?",
            message:
              "This computer estimates its location from the internet connection, not GPS — it can be miles off. For an exact spot, use “Pick Location on Map” below instead. Use the computer's location estimate anyway?",
            confirmLabel: "Yes",
            cancelLabel: "No",
          });
          if (!ok) return;
        }
        runLocationCapture();
      },
    },
    "Use Device for Location & Soil Type"
  );

  // "Pick Location on Map" — the desk-friendly alternative: a satellite
  // map (lazy-loaded, free/public-domain imagery — see mapPicker.js) to
  // tap the exact field. A map pick counts as MANUAL coordinates
  // (gpsSource "manual" — the device button un-lights and will ask
  // before overriding), and runs the same soil/region autofill a device
  // capture does.
  const mapPickBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-secondary btn-block",
      onclick: () => {
        const hdr = trialStore.getState().header;
        openMapPicker({
          initialLat: hdr.gpsLatitude,
          initialLon: hdr.gpsLongitude,
          onPick: (lat, lon) => {
            const rLat = round6(Math.abs(lat));
            const rLon = round6(-Math.abs(lon));
            trialStore.updateHeader({ gpsLatitude: rLat, gpsLongitude: rLon, gpsSource: "manual" });
            latInput.value = String(rLat);
            lonInput.value = String(rLon);
            markLocationDisabled();
            setLocationStatus("Location set from the map. Looking up soil type…", "success");
            attemptSoilLookup(rLat, rLon, "Location set from the map.");
            attemptRegionLookup(rLat, rLon);
          },
        }).catch((e) => {
          setLocationStatus(e.message || "Couldn't open the map.", "failure");
        });
      },
    },
    "Pick Location on Map"
  );

  // Once a DEVICE location is in (this tap, or a plot whose coordinates
  // came from an earlier capture), the button flips to the brand's
  // darker color and reads "Device Location Enabled" — per explicit
  // request. It stays tappable as a re-capture (e.g. after moving to a
  // different field). Coordinates typed by hand do NOT light it up
  // (gpsSource "manual" — see markGpsManual()); a legacy plot with
  // coordinates but no recorded source counts as device (that's how
  // most existing plots got theirs).
  function markLocationEnabled() {
    useLocationBtn.textContent = "Device Location Enabled";
    useLocationBtn.classList.add("location-capture-btn-enabled");
  }
  function markLocationDisabled() {
    useLocationBtn.textContent = "Use Device for Location & Soil Type";
    useLocationBtn.classList.remove("location-capture-btn-enabled");
  }
  if (
    Number.isFinite(header.gpsLatitude) &&
    Number.isFinite(header.gpsLongitude) &&
    header.gpsSource !== "manual"
  ) {
    markLocationEnabled();
  }

  // The device-location capture lives in its own card at the very TOP of
  // the screen (above Cooperator Details) — per explicit request — since
  // it's the natural first move standing in the field: one tap fills
  // GPS, State, County, City, Zip, and Soil Type at once. The status
  // line rides with the button, so capture/soil-lookup feedback shows
  // where the tap happened. The GPS Location card below keeps the
  // Latitude/Longitude fields themselves for manual entry/corrections.
  const locationCaptureSection = h("section", { className: "card location-capture-card" }, [
    useLocationBtn,
    mapPickBtn,
    h(
      "p",
      { className: "field-note location-capture-note" },
      "One tap fills GPS, State, County, City, Zip, and Soil Type from where you're standing — or skip it and enter everything manually below."
    ),
    locationStatusEl,
  ]);

  const gpsSection = h("section", { className: "card" }, [
    sectionHeader("GPS Location"),
    field("Latitude", latInput),
    field("Longitude", lonInput),
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
        value: header.dryingShrinkRate === null || header.dryingShrinkRate === undefined ? "" : String(header.dryingShrinkRate),
        inputmode: "decimal",
        oninput: (v) => {
          // An EMPTY field stores null, never 0 — Number("") is 0, which
          // silently committed a 0 shrink rate the instant a user
          // cleared the field to retype it, corrupting every Gross
          // value. null makes Gross show blank until a number is back
          // (see gross()'s finite-check in yieldCalculator.js).
          const t = v.trim();
          const n = Number(t);
          trialStore.updateHeader({ dryingShrinkRate: t !== "" && Number.isFinite(n) ? n : null });
        },
      })
    ),
    field(
      "Price per Bushel",
      textInput({
        value: header.pricePerBushel === null || header.pricePerBushel === undefined ? "" : String(header.pricePerBushel),
        inputmode: "decimal",
        oninput: (v) => {
          // Same empty-means-null rule as Drying Shrink Rate above.
          const t = v.trim();
          const n = Number(t);
          trialStore.updateHeader({ pricePerBushel: t !== "" && Number.isFinite(n) ? n : null });
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
      locationCaptureSection,
      cooperatorSection,
      gpsSection,
      plantingSection,
      harvestSection,
      yieldSection,
      continueToEntriesBtn,
    ]),
  ]);

  mount(container, screen);

  // NO automatic location request — per explicit request (reversing the
  // earlier auto-locate-on-open behavior), location and soil type only
  // ever pre-populate when the user actually taps "Use Device for
  // Location & Soil Type" at the top of the screen. Opening Plot
  // Details does nothing on its own.
}
