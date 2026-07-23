// src/core/demoPlot.js
//
// Factory for the sample "Demo Plot" every device gets seeded into
// Saved Plots automatically (see libraryStore.js's ensureDemoPlot()) —
// a fully filled-out example plot so a brand new user (or someone
// exploring after an update) has something to look at on Plot Summary
// right away: the CV/box-and-whisker chart, the colored rank badges,
// and an Average By Brand grouping (Midwest Seed Genetics has well over
// 2 hybrids here, on purpose, so that feature has something to show too
// — see plotSummaryHelp.js).
//
// This is real harvest-report data (a 2023 Monona County, IA plot,
// cooperator TE & TE Brown Inc, 16 entries — provided directly by Mike
// to replace the earlier made-up sample numbers). Every entry's Row
// Length/Width/# of Rows/Moisture/Harvested-weight fields were copied
// straight off that report, and manualDryYield is deliberately left ""
// on every entry so the app's own calculatedDryYield() formula derives
// Yield @ 15% itself — verified against the report's own "Yield @ 15%"
// column to within 0.05 bu/ac (print rounding) per entry, so this also
// doubles as a real-world sanity check that the formula port is exact.
// The one correction made from the source report: hybrid "16-10 PCE"
// printed with RM 0 (an obvious data-entry slip in the original report
// — every other "16-xx" hybrid here is RM 116, and the app's own
// hybrid-name-to-RM convention agrees), corrected to 116 here so the
// demo doesn't reproduce that error.
//
// Deliberately marked isDemo: true so:
//   - cloudSyncStore.js's pushNow() never sends it to the cloud — it's
//     local-only sample data on this device, never real farm data, and
//     never shows up in All Plots (Admin) or an export.
//   - savedPlots.js shows a "Demo" badge on its row so it's never
//     mistaken for a real cooperator's plot.
// libraryStore.js's upsert() carries this flag forward across edits (see
// its comment) so it stays excluded from sync even if the user edits it
// for practice, right up until they delete it.
//
// Fixed id (not a random uuid) is the whole mechanism behind "delete it
// whenever you want, and it comes back next time the app updates" — and,
// as of the version that added this line, also the mechanism behind
// "every device gets refreshed to this file's current sample content on
// the next app update, even if they never deleted their old demo plot."
// See ensureDemoPlot()'s comment for exactly how that works, including
// the tradeoff that a version bump overwrites any practice edits a user
// made to their demo plot.
//
// header.formId is likewise hardcoded (not left blank for live
// assignment) — see the inline comment on it below for why "26-1000"
// specifically.

import { createPlotEntry } from "./models.js";

export const DEMO_TRIAL_ID = "demo-plot-sample";

function entry(fields) {
  return { ...createPlotEntry(), ...fields };
}

/**
 * @returns {{id: string, isDemo: true, header: import('./models.js').TrialHeader, entries: import('./models.js').PlotEntry[]}}
 */
export function createDemoTrial() {
  return {
    id: DEMO_TRIAL_ID,
    isDemo: true,
    header: {
      // Fixed, hardcoded Form ID (per explicit request) — "26-1000" is
      // permanently reserved for the Demo Plot specifically and is
      // never handed out by the real server-side counter (see
      // netlify/functions/_formIdShared.js's STARTING_ID, which begins
      // one past it at 1001), so there's no risk of it ever colliding
      // with a real plot's assigned ID. Because it's already set here,
      // formIdAssign.js's ensureFormIdAssigned() sees isFormIdAssigned()
      // is already true and never attempts a network reservation for
      // the Demo Plot at all.
      formId: "26-1000",
      cooperatorName: "TE & TE Brown Inc",
      address: "",
      city: "Turin",
      state: "IA",
      zip: "51059",
      county: "Monona",
      gpsLatitude: null,
      gpsLongitude: null,
      datePlanted: "2023-05-12",
      tillage: "No-Till",
      irrigation: "No",
      // Report printed "Silt Clay Loam" — normalized to the app's fixed
      // soilTypeOptions spelling, "Silty Clay Loam".
      soilType: "Silty Clay Loam",
      previousCrop: "Soybeans",
      plantingPopulation: "32000",
      dateHarvested: "2023-10-21",
      collectedBy: "",
      phone: "",
      email: "",
      baseMoisturePercent: 15.5,
      dryingShrinkRate: 0.06,
      pricePerBushel: 4.25,
      trialNotes:
        "This is a sample plot (real harvest data from a Monona County, IA trial) so you can explore Plot Summary, the chart, and the ranked results before entering your own data. Feel free to edit anything here for practice — delete it any time from Saved Plots, and it'll come back the next time the app updates. It's local to this device only and never syncs or counts as real data.",
    },
    // Entries are in the report's original row order (ascending by
    // hybrid/RM, i.e. planting layout order) — each entry's own Rank
    // badge on Plot Summary is computed by the app from Dry Yield, same
    // as any real plot, and doesn't need to match this ordering.
    entries: [
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "08-06 VT2PRIB",
        trait: "VT2Pro RIB",
        relativeMaturity: "108",
        seedTreatment: "",
        sampleNetWeightLbs: "2469",
        moisturePercent: "16.7",
        testWeight: "",
        stripLengthFeet: "510",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "09-90 PCE",
        trait: "PowerCore Enlist",
        relativeMaturity: "109",
        seedTreatment: "",
        sampleNetWeightLbs: "2406",
        moisturePercent: "15.2",
        testWeight: "",
        stripLengthFeet: "520",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "09-79 VT2PRIB",
        trait: "VT2Pro RIB",
        relativeMaturity: "109",
        seedTreatment: "",
        sampleNetWeightLbs: "2595",
        moisturePercent: "16.3",
        testWeight: "",
        stripLengthFeet: "530",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "11-30 TRERIB",
        trait: "TREC RIB",
        relativeMaturity: "111",
        seedTreatment: "",
        sampleNetWeightLbs: "2563",
        moisturePercent: "16.9",
        testWeight: "",
        stripLengthFeet: "540",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Pioneer",
        hybrid: "P1185Q",
        trait: "Qrome",
        relativeMaturity: "111",
        seedTreatment: "",
        sampleNetWeightLbs: "2495",
        moisturePercent: "17.3",
        testWeight: "",
        stripLengthFeet: "550",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "12-48 DGVT2PRIB",
        trait: "Drought Gard VT2P RIB",
        relativeMaturity: "112",
        seedTreatment: "",
        sampleNetWeightLbs: "2577",
        moisturePercent: "16.6",
        testWeight: "",
        stripLengthFeet: "550",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "13-50 SSPRORIB",
        trait: "SmartStax Pro RIB",
        relativeMaturity: "113",
        seedTreatment: "",
        sampleNetWeightLbs: "2597",
        moisturePercent: "18.3",
        testWeight: "",
        stripLengthFeet: "560",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "13-04 VT2PRIB",
        trait: "VT2Pro RIB",
        relativeMaturity: "113",
        seedTreatment: "",
        sampleNetWeightLbs: "2595",
        moisturePercent: "17.5",
        testWeight: "",
        stripLengthFeet: "560",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "13-60 PCE",
        trait: "PowerCore Enlist",
        relativeMaturity: "113",
        seedTreatment: "",
        sampleNetWeightLbs: "2514",
        moisturePercent: "16.1",
        testWeight: "",
        stripLengthFeet: "565",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "14-36 PCE",
        trait: "PowerCore Enlist",
        relativeMaturity: "114",
        seedTreatment: "",
        sampleNetWeightLbs: "2808",
        moisturePercent: "17.3",
        testWeight: "",
        stripLengthFeet: "575",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "14-20 PCE",
        trait: "PowerCore Enlist",
        relativeMaturity: "114",
        seedTreatment: "",
        sampleNetWeightLbs: "2674",
        moisturePercent: "16.8",
        testWeight: "",
        stripLengthFeet: "585",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "14-60 TRERIB",
        trait: "TREC RIB",
        relativeMaturity: "114",
        seedTreatment: "",
        sampleNetWeightLbs: "2689",
        moisturePercent: "17.0",
        testWeight: "",
        stripLengthFeet: "590",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "14-88 VT2PRIB",
        trait: "VT2Pro RIB",
        relativeMaturity: "114",
        seedTreatment: "",
        sampleNetWeightLbs: "2866",
        moisturePercent: "18.2",
        testWeight: "",
        stripLengthFeet: "590",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "15-65 VT2PRIB",
        trait: "VT2Pro RIB",
        relativeMaturity: "115",
        seedTreatment: "",
        sampleNetWeightLbs: "2731",
        moisturePercent: "19.4",
        testWeight: "",
        stripLengthFeet: "600",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "16-10 PCE",
        trait: "PowerCore Enlist",
        // Report printed RM 0 for this one entry — see the top-of-file
        // comment; corrected to 116 to match every other "16-xx" hybrid
        // here and this catalog's own RM-from-name convention.
        relativeMaturity: "116",
        seedTreatment: "",
        sampleNetWeightLbs: "2800",
        moisturePercent: "16.8",
        testWeight: "",
        stripLengthFeet: "600",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "16-29 VT2PRIB",
        trait: "VT2Pro RIB",
        relativeMaturity: "116",
        seedTreatment: "",
        sampleNetWeightLbs: "2831",
        moisturePercent: "17.6",
        testWeight: "",
        stripLengthFeet: "610",
        numberOfRows: "6",
        widthInches: "30",
        manualDryYield: "",
      }),
    ],
  };
}
