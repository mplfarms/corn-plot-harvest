// src/core/models.js
//
// Plain-object models (no classes) mirroring the Swift structs from the
// native Corn Plot Harvest iOS app. These are JSDoc-documented factory
// functions rather than TypeScript types since there is no type-checker
// in this no-build-step project.

/**
 * @typedef {Object} TrialHeader
 * @property {string} cooperatorName
 * @property {string} address
 * @property {string} city
 * @property {string} state
 * @property {string} zip
 * @property {string} county
 * @property {number|null} gpsLatitude
 * @property {number|null} gpsLongitude
 * @property {string|null} datePlanted ISO date string "YYYY-MM-DD" or null
 * @property {string} tillage
 * @property {string} irrigation
 * @property {string} soilType
 * @property {string} previousCrop
 * @property {string} plantingPopulation
 * @property {string|null} dateHarvested ISO date string "YYYY-MM-DD" or null
 * @property {string} collectedBy
 * @property {string} phone
 * @property {string} email
 * @property {number} baseMoisturePercent
 * @property {number} dryingShrinkRate
 * @property {number} pricePerBushel
 * @property {string} trialNotes
 * @property {string} formId A short, permanent reference number for this
 *   exact plot — e.g. "5001", or "5001a" if "5001" was somehow already
 *   taken (see netlify/functions/formId.js's duplicate-suffix logic).
 *   Reserved from a single global server-side counter (starting at
 *   5000, shared across every user — see ui/formIdAssign.js) the first
 *   time this screen is opened for a plot that doesn't have one yet,
 *   and reused forever after — "" until assigned. Shown on Plot Details
 *   and used as the .xlsx export's filename / the PDF+print footer's
 *   "Form ID" label.
 */

/**
 * @typedef {Object} PlotEntry
 * @property {string} id
 * @property {string} brand
 * @property {string} hybrid
 * @property {string} trait
 * @property {string} relativeMaturity
 * @property {string} seedTreatment
 * @property {string} sampleNetWeightLbs
 * @property {string} moisturePercent
 * @property {string} testWeight
 * @property {string} stripLengthFeet
 * @property {string} numberOfRows
 * @property {string} widthInches
 * @property {string} comments
 * @property {string} manualDryYield
 */

/**
 * @typedef {Object} SavedTrial
 * @property {string} id
 * @property {TrialHeader} header
 * @property {PlotEntry[]} entries
 * @property {string} lastModified ISO datetime string
 */

/** @returns {string} */
export function uuid() {
  return crypto.randomUUID();
}

/** @returns {TrialHeader} */
export function createTrialHeader() {
  return {
    cooperatorName: "",
    address: "",
    city: "",
    // Defaults to Iowa (this farm operation's home state) so a brand new
    // plot's State wheel opens already set instead of blank — the user
    // can still change it for out-of-state plots. Only affects new/blank
    // trials; an existing saved trial keeps whatever state it already has.
    state: "IA",
    zip: "",
    county: "",
    gpsLatitude: null,
    gpsLongitude: null,
    datePlanted: null,
    tillage: "",
    irrigation: "",
    soilType: "",
    previousCrop: "",
    plantingPopulation: "32000",
    dateHarvested: null,
    collectedBy: "",
    phone: "",
    email: "",
    baseMoisturePercent: 15.5,
    dryingShrinkRate: 0.06,
    pricePerBushel: 3.5,
    trialNotes: "",
    formId: "",
  };
}

/** @returns {PlotEntry} */
export function createPlotEntry() {
  return {
    id: uuid(),
    brand: "",
    hybrid: "",
    trait: "",
    relativeMaturity: "",
    seedTreatment: "",
    sampleNetWeightLbs: "",
    moisturePercent: "",
    testWeight: "",
    stripLengthFeet: "",
    numberOfRows: "",
    widthInches: "",
    comments: "",
    manualDryYield: "",
  };
}

/**
 * @param {PlotEntry} entry
 * @returns {boolean}
 */
export function isEntryBlank(entry) {
  return entry.brand.trim() === "" && entry.hybrid.trim() === "";
}

/**
 * @param {PlotEntry} entry
 * @returns {string}
 */
export function entryDisplayTitle(entry) {
  const hybrid = entry.hybrid.trim();
  if (hybrid !== "") return hybrid;
  const brand = entry.brand.trim();
  if (brand !== "") return brand;
  return "New Entry";
}

/**
 * @param {string} id
 * @param {TrialHeader} header
 * @param {PlotEntry[]} entries
 * @param {string} lastModifiedISO
 * @returns {SavedTrial}
 */
export function createSavedTrial(id, header, entries, lastModifiedISO) {
  return { id, header, entries, lastModified: lastModifiedISO };
}

/**
 * Mirrors Swift's TrialHeader.formattedDate (format MM/dd/yyyy).
 * @param {string|null|undefined} isoDateString "YYYY-MM-DD" or null/empty
 * @returns {string}
 */
export function formatHeaderDate(isoDateString) {
  if (!isoDateString) return "";
  const s = String(isoDateString);
  if (s.length < 10) return "";
  const year = s.slice(0, 4);
  const month = s.slice(5, 7);
  const day = s.slice(8, 10);
  if (!year || !month || !day) return "";
  return `${month}/${day}/${year}`;
}

/**
 * @param {TrialHeader} header
 * @returns {string}
 */
export function gpsCellText(header) {
  if (
    typeof header.gpsLatitude === "number" &&
    typeof header.gpsLongitude === "number" &&
    Number.isFinite(header.gpsLatitude) &&
    Number.isFinite(header.gpsLongitude)
  ) {
    return `${header.gpsLatitude.toFixed(6)} ${header.gpsLongitude.toFixed(6)}`;
  }
  return "";
}

/**
 * @param {TrialHeader} header
 * @returns {number}
 */
export function filenameYear(header) {
  const dp = header.datePlanted;
  if (typeof dp === "string" && /^\d{4}/.test(dp)) {
    return parseInt(dp.slice(0, 4), 10);
  }
  return new Date().getFullYear();
}

/**
 * The year shown at the very front of the PDF export's title (see
 * pdfBuilder.js's drawTitleAndSubtitle()) — specifically the year
 * HARVESTED, not planted, so it's read from dateHarvested rather than
 * reusing filenameYear() above (which is planting-year based, used
 * elsewhere for the export filename itself). Falls back to filenameYear()
 * — and from there, to today's year — for a plot whose Date Harvested
 * hasn't been filled in yet, so the title never ends up blank.
 * @param {TrialHeader} header
 * @returns {number}
 */
export function harvestedYear(header) {
  const dh = header.dateHarvested;
  if (typeof dh === "string" && /^\d{4}/.test(dh)) {
    return parseInt(dh.slice(0, 4), 10);
  }
  return filenameYear(header);
}
