// src/core/demoPlot.js
//
// Factory for the sample "Demo Plot" every device gets seeded into
// Saved Plots automatically (see libraryStore.js's ensureDemoPlot()) —
// a fully filled-out example plot so a brand new user (or someone
// exploring after an update) has something to look at on Plot Summary
// right away: the CV/box-and-whisker chart, the colored rank badges,
// and an Average By Brand grouping (two brands here have 2 hybrids
// each, on purpose, so that feature has something to show too — see
// plotSummaryHelp.js).
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
// whenever you want, and it comes back next time the app updates" — see
// ensureDemoPlot()'s comment for exactly how that works.

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
      cooperatorName: "Demo Plot",
      address: "123 Farm Rd",
      city: "Example",
      state: "IA",
      zip: "50021",
      county: "Polk",
      gpsLatitude: null,
      gpsLongitude: null,
      datePlanted: "2026-05-02",
      tillage: "No-Till",
      irrigation: "No",
      soilType: "Clay Loam",
      previousCrop: "Soybeans",
      plantingPopulation: "34000",
      dateHarvested: "2026-10-15",
      collectedBy: "Demo",
      phone: "",
      email: "",
      baseMoisturePercent: 15.5,
      dryingShrinkRate: 0.06,
      pricePerBushel: 4.25,
      trialNotes:
        "This is a sample plot so you can explore Plot Summary, the chart, and the ranked results before entering your own data. Feel free to edit anything here for practice — delete it any time from Saved Plots, and it'll come back the next time the app updates. It's local to this device only and never syncs or counts as real data.",
    },
    entries: [
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "82-22 VT2PRIB",
        trait: "VT2P",
        relativeMaturity: "112",
        seedTreatment: "Standard",
        sampleNetWeightLbs: "48.2",
        moisturePercent: "16.2",
        testWeight: "57.5",
        stripLengthFeet: "300",
        numberOfRows: "4",
        widthInches: "30",
        manualDryYield: "235",
        comments: "Strong emergence, stood well.",
      }),
      entry({
        brand: "Midwest Seed Genetics",
        hybrid: "83-31 VT2PRIB",
        trait: "VT2P",
        relativeMaturity: "113",
        seedTreatment: "Standard",
        sampleNetWeightLbs: "45.1",
        moisturePercent: "17.8",
        testWeight: "56.8",
        stripLengthFeet: "300",
        numberOfRows: "4",
        widthInches: "30",
        manualDryYield: "210",
      }),
      entry({
        // Deliberately NOT "NC+ Hybrids" here — entriesForBrandView()
        // (brand.js) folds that sister brand into whichever Brand View
        // is currently selected (they share the same underlying
        // catalog), so it wouldn't demo as its own separate group. A
        // genuine third-party brand shows up as its own group instead.
        brand: "Armor Seed",
        hybrid: "84-14 VT2PRIB",
        trait: "VT2P",
        relativeMaturity: "114",
        seedTreatment: "None",
        sampleNetWeightLbs: "44.0",
        moisturePercent: "15.9",
        testWeight: "58.0",
        stripLengthFeet: "300",
        numberOfRows: "4",
        widthInches: "30",
        manualDryYield: "205",
      }),
      entry({
        brand: "Agrigold",
        hybrid: "80-32 VT2PRIB",
        trait: "VT2P",
        relativeMaturity: "108",
        seedTreatment: "Poncho/VoTivo",
        sampleNetWeightLbs: "42.0",
        moisturePercent: "19.5",
        testWeight: "55.9",
        stripLengthFeet: "300",
        numberOfRows: "4",
        widthInches: "30",
        manualDryYield: "198",
      }),
      entry({
        brand: "Agrigold",
        hybrid: "79-01 VT2PRIB",
        trait: "VT2P",
        relativeMaturity: "109",
        seedTreatment: "Poncho/VoTivo",
        sampleNetWeightLbs: "38.5",
        moisturePercent: "21.0",
        testWeight: "55.2",
        stripLengthFeet: "300",
        numberOfRows: "4",
        widthInches: "30",
        manualDryYield: "180",
        comments: "Wetter at harvest — held back for extra dry-down.",
      }),
    ],
  };
}
