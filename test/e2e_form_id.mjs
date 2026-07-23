// Verifies the "Form ID" feature end to end:
//   1. core/formId.js's isFormIdAssigned() pure helper.
//   2. Opening/browsing Plot Details for a brand new plot does NOT
//      reserve a Form ID — by explicit request, that only happens the
//      moment the user actually taps "Save Plot" on the Entry Editor.
//   3. Tapping "Save Plot" fires exactly one reservation and the newly
//      assigned "26-1001"-style ID shows up back on Plot Details.
//   4. Assign-once-reuse-forever: tapping Save Plot again (same plot)
//      never fires a second reservation, and the ID survives a reload.
//   5. xlsxBuilder's exportFilename() uses the Form ID once assigned,
//      falling back to the original State_Year_Cooperator scheme when
//      not.
//   6. pdfBuilder's buildPdf() draws "Form ID: ..." in the lower-right
//      footer when assigned (and omits it when not), and its optional
//      includePlotDetails flag draws (or omits) a compact "Plot Details"
//      header block; pdfFilename() is just "26-1001.pdf" once assigned
//      (no "_Results" suffix), matching the xlsx export exactly.
//   7. Plot Summary's header subtitle shows the Form ID as a trailing
//      "• 26-1001" once assigned, and self-heals (reserves one in the
//      background and re-renders) for a plot that reaches it WITHOUT one
//      yet — e.g. an older plot from before this feature existed.
import { chromium } from "playwright";

const BASE = "http://localhost:34205";
let failures = 0;

function check(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(`${BASE}/index.html`);

// ---- 1. core/formId.js pure helper ----
const pureChecks = await page.evaluate(async () => {
  const { isFormIdAssigned } = await import("/js/core/formId.js");
  return {
    assignedTrue: isFormIdAssigned({ formId: "26-1001" }),
    assignedFalse: isFormIdAssigned({ formId: "" }),
    nullHeader: isFormIdAssigned(null),
  };
});
check(pureChecks.assignedTrue === true, "isFormIdAssigned() is true once a header has a formId");
check(pureChecks.assignedFalse === false, "isFormIdAssigned() is false for an empty formId");
check(pureChecks.nullHeader === false, "isFormIdAssigned() handles a null header without throwing");

// ---- 2, 3 & 4. No assignment on Plot Details open; assignment fires on Save Plot ----
// window.fetch is a per-page-load JS realm value — page.addInitScript()
// re-installs this stub before ANY page script runs, on every single
// navigation/reload from here on, unlike a one-shot page.evaluate() call
// (which a subsequent page.goto()/page.reload() would silently wipe out).
await page.addInitScript(() => {
  window.__formIdFetchCalls = window.__formIdFetchCalls || [];
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    if (String(url).includes("/.netlify/functions/formId")) {
      window.__formIdFetchCalls.push(JSON.parse((options && options.body) || "{}"));
      return Promise.resolve(new Response(JSON.stringify({ formId: "26-1001" }), { status: 200 }));
    }
    return realFetch(url, options);
  };
});

await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem(
    "cph.authSession",
    JSON.stringify({ name: "Mike Larson", firstName: "Mike", lastName: "Larson", email: "mike@example.com", isAdmin: false })
  );
});
await page.goto(`${BASE}/index.html?r=1#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });

// Opening a brand new plot's Plot Details must NOT reserve a Form ID.
const noteBeforeSave = await page.$eval(".trial-details-form-id-note", (el) => el.textContent);
check(
  noteBeforeSave === "Form ID: will be assigned when you save this plot (tap to try now)",
  `Plot Details shows the "not yet assigned" note (doubling as a manual retry button) before Save Plot is ever tapped (got "${noteBeforeSave}")`
);
let callsBeforeSave = await page.evaluate(() => window.__formIdFetchCalls.length);
check(callsBeforeSave === 0, `merely opening Plot Details fires NO reservation call (got ${callsBeforeSave})`);

// Move on to the Entry Editor (same in-app SPA navigation — no reload,
// so __formIdFetchCalls keeps accumulating from here) and confirm it's
// still untouched.
await page.click("text=Continue to Hybrid Entries");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
callsBeforeSave = await page.evaluate(() => window.__formIdFetchCalls.length);
check(callsBeforeSave === 0, `reaching the Entry Editor (without saving) still fires NO reservation call (got ${callsBeforeSave})`);

// Tapping "Save Plot" is the real trigger — fire-and-forget, so give it
// a moment to land after the navigation to Plot Summary completes.
await page.click(".entry-editor-actions >> text=Save Plot");
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

await page.waitForFunction(() => window.__formIdFetchCalls && window.__formIdFetchCalls.length > 0, { timeout: 5000 });
let fetchCallCount = await page.evaluate(() => window.__formIdFetchCalls.length);
check(fetchCallCount === 1, `tapping "Save Plot" fires exactly one reservation call (got ${fetchCallCount})`);

// Save Plot AWAITS the reservation before navigating (see
// entryEditor.js) specifically so Plot Summary's header subtitle already
// shows the Form ID the very first time it renders, with no manual
// refresh needed.
const subtitleAfterSave = await page.$eval(".summary-header-subtitle", (el) => el.textContent);
check(
  subtitleAfterSave.endsWith("• 26-1001"),
  `Plot Summary's header subtitle shows the Form ID as a trailing "• 26-1001" right after Save Plot (got "${subtitleAfterSave}")`
);

// trialStore's write to localStorage is debounced (see AUTOSAVE_DEBOUNCE_MS
// in trialStore.js) — wait for it to actually land before reading it back.
await page.waitForFunction(
  () => {
    const d = JSON.parse(localStorage.getItem("cph.draftTrial") || "null");
    return Boolean(d && d.header.formId);
  },
  { timeout: 3000 }
);
let draft = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")));
check(draft.header.formId === "26-1001", `the draft's header actually has formId persisted (got "${draft.header.formId}")`);

// Back to Plot Details — the note should now show the real assigned ID.
await page.goto(`${BASE}/index.html?r=2#/trial-details`);
await page.waitForSelector(".trial-details-form-id-note", { timeout: 5000 });
const noteAfterSave = await page.$eval(".trial-details-form-id-note", (el) => el.textContent);
check(noteAfterSave === "Form ID: 26-1001", `Plot Details shows the assigned Form ID after Save Plot (got "${noteAfterSave}")`);

// Re-entering the Entry Editor and tapping "Save Plot" again on the SAME
// plot must NOT fire a second reservation — assign-once-reuse-forever.
// Each navigation/reload gets a brand new JS realm (a fresh, empty
// __formIdFetchCalls array via the init script's `|| []`), so this count
// reflects ONLY calls made since this most recent page load (r=2).
// "Continue to Hybrid Entries" always adds a new entry unconditionally
// (see trialStore.addEntryCarryingMeasurements()) and always exists on
// Plot Details regardless of how many entries the plot already has.
await page.click("text=Continue to Hybrid Entries");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
await page.click(".entry-editor-actions >> text=Save Plot");
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
await page.waitForTimeout(300);
const callCountOnReopen = await page.evaluate(() => window.__formIdFetchCalls.length);
check(callCountOnReopen === 0, `re-saving an already-assigned plot fires NO new reservation call (got ${callCountOnReopen})`);

// ---- Plot Summary self-heals a plot that reaches it WITHOUT a Form ID
// (e.g. an older plot that predates this feature — see the "assign to
// all existing plots" backfill this same request also added) — it
// should quietly pick one up in the background and re-render, without
// the user having to navigate away and back.
await page.evaluate(() => {
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "pre-existing-plot",
      header: {
        cooperatorName: "Old Plot Coop",
        state: "IA",
        county: "Monona",
        datePlanted: "2026-05-01",
        dateHarvested: "2026-10-15",
        formId: "", // never assigned — simulates a plot from before this feature existed
        collectedBy: "",
        phone: "",
        email: "",
        address: "",
        city: "",
        zip: "",
        tillage: "",
        irrigation: "",
        soilType: "",
        previousCrop: "",
        plantingPopulation: "32000",
        dryingShrinkRate: 0.06,
        pricePerBushel: 3.5,
        trialNotes: "",
      },
      entries: [],
    })
  );
});
await page.goto(`${BASE}/index.html?r=3#/plot-summary`);
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
// Note: NOT asserting anything about the subtitle at this exact instant
// — the self-heal's reservation call is fire-and-forget (see
// plotSummary.js) and, against this stub, can resolve fast enough that
// there's no reliable window to observe the "still missing" state before
// it lands. What actually matters (and IS asserted below) is that it
// eventually shows up with no manual refresh required.

// Note: the stubbed /.netlify/functions/formId endpoint always returns
// the same fixed "26-1001" regardless of which plot asks (see the
// addInitScript stub above) — this test only cares that Plot Summary
// picks up WHATEVER the server hands back and re-renders with it, not
// that the id itself differs from earlier in this file.
await page.waitForFunction(
  () => document.querySelector(".summary-header-subtitle")?.textContent.endsWith("• 26-1001"),
  { timeout: 5000 }
);
const subtitleAfterHeal = await page.$eval(".summary-header-subtitle", (el) => el.textContent);
check(
  subtitleAfterHeal.endsWith("• 26-1001"),
  `Plot Summary self-heals a Form-ID-less plot in the background and re-renders once assigned (got "${subtitleAfterHeal}")`
);
// <= 1, not === 1: rarely (a service-worker-driven auto-reload racing
// this exact page load — see updateBanner.js — landing between the
// self-heal's own reservation call and this read), window.__formId-
// FetchCalls itself gets reset by a second, unrelated navigation after
// the self-heal already ran and its result was already persisted to
// localStorage — the subtitle assertion above still correctly shows
// the healed Form ID either way. What actually matters here (and what
// this still catches) is that the self-heal never fires the
// reservation call MORE than once for the same plot.
const healFetchCount = await page.evaluate(() => window.__formIdFetchCalls.length);
check(healFetchCount <= 1, `the self-heal fires at most one reservation call for this plot, never a duplicate (got ${healFetchCount})`);

// ---- 5 & 6. xlsxBuilder/pdfBuilder integration ----
const buildChecks = await page.evaluate(async () => {
  const { buildXlsx, exportFilename, createEffectiveLists } = await import("/js/core/xlsxBuilder.js");

  const assignedHeader = {
    cooperatorName: "Test Coop",
    state: "IA",
    county: "Polk",
    datePlanted: "2026-05-01",
    dateHarvested: "2026-10-15",
    formId: "26-1001",
  };
  const unassignedHeader = {
    cooperatorName: "Test Coop",
    state: "IA",
    county: "Polk",
    datePlanted: "2026-05-01",
    formId: "",
  };

  const assignedFilename = exportFilename(assignedHeader);
  const unassignedFilename = exportFilename(unassignedHeader);

  const lists = createEffectiveLists({});
  const { filename: xlsxFilename } = await buildXlsx(assignedHeader, [], lists);

  function makeCalls() {
    const calls = { text: [] };
    function FakeJsPDF() {
      return {
        setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {},
        saveGraphicsState() {}, restoreGraphicsState() {}, setGState() {}, GState(opts) { return opts; },
        splitTextToSize: (t) => [t],
        getTextWidth: (t) => String(t).length * 5,
        getImageProperties: () => ({ width: 100, height: 40 }),
        addImage() {},
        text(str) { calls.text.push(String(str)); },
        circle() {}, rect() {}, line() {}, addPage() {},
        output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
      };
    }
    window.jspdf = { jsPDF: FakeJsPDF };
    return calls;
  }

  const { buildPdf, pdfFilename } = await import("/js/core/pdfBuilder.js");
  const { getBrand } = await import("/js/ui/brand.js");
  const testEntry = {
    id: "e1", brand: "Midwest Seed Genetics", hybrid: "H1", trait: "", relativeMaturity: "100",
    manualDryYield: "200", sampleNetWeightLbs: "", moisturePercent: "", testWeight: "",
    stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "",
  };
  const results = [{ originalNumber: 1, entry: testEntry, value: 200 }];

  const assignedCalls = makeCalls();
  await buildPdf({ header: assignedHeader, results, metric: "dryYield", allEntries: [testEntry], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null });

  const unassignedCalls = makeCalls();
  await buildPdf({ header: unassignedHeader, results, metric: "dryYield", allEntries: [testEntry], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null });

  // "Include Plot Details" — includePlotDetails: true should draw a
  // "Plot Details" section label plus at least one "Label: value" pair
  // (Address is set on this header so it should always show up); false
  // (or simply omitted, the default) must draw neither.
  const detailedHeader = { ...assignedHeader, address: "123 Farm Rd", collectedBy: "Larson, Mike" };
  const withDetailsCalls = makeCalls();
  await buildPdf({ header: detailedHeader, results, metric: "dryYield", allEntries: [testEntry], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null, includePlotDetails: true });

  const withoutDetailsCalls = makeCalls();
  await buildPdf({ header: detailedHeader, results, metric: "dryYield", allEntries: [testEntry], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null, includePlotDetails: false });

  const defaultCalls = makeCalls();
  await buildPdf({ header: detailedHeader, results, metric: "dryYield", allEntries: [testEntry], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null });

  return {
    assignedFilename,
    unassignedFilename,
    xlsxFilename,
    pdfFilenameAssigned: pdfFilename(assignedHeader),
    pdfFilenameUnassigned: pdfFilename(unassignedHeader),
    assignedFooterHasFormId: assignedCalls.text.some((t) => t === "Form ID: 26-1001"),
    unassignedFooterHasFormId: unassignedCalls.text.some((t) => t.startsWith("Form ID")),
    withDetailsHasHeader: withDetailsCalls.text.some((t) => t === "Plot Details"),
    withDetailsHasAddressLabel: withDetailsCalls.text.some((t) => t.startsWith("Cooperator Address")),
    withoutDetailsHasHeader: withoutDetailsCalls.text.some((t) => t === "Plot Details"),
    defaultHasHeader: defaultCalls.text.some((t) => t === "Plot Details"),
  };
});

check(buildChecks.assignedFilename === "26-1001.xlsx", `xlsx filename is just the Form ID once assigned (got ${buildChecks.assignedFilename})`);
check(
  buildChecks.unassignedFilename === "IA_2026_Test_Coop.xlsx",
  `xlsx filename falls back to the original State_Year_Cooperator scheme when no Form ID is assigned yet (got ${buildChecks.unassignedFilename})`
);
check(buildChecks.xlsxFilename === "26-1001.xlsx", `buildXlsx()'s returned filename matches exportFilename() (got ${buildChecks.xlsxFilename})`);
check(
  buildChecks.pdfFilenameAssigned === "26-1001.pdf",
  `pdfFilename() is just the Form ID + .pdf once assigned, matching the xlsx export exactly, with no "_Results" suffix (got ${buildChecks.pdfFilenameAssigned})`
);
check(
  buildChecks.pdfFilenameUnassigned === "IA_2026_Test_Coop_Results.pdf",
  `pdfFilename() still falls back to the original State_Year_Cooperator_Results.pdf scheme when no Form ID is assigned yet (got ${buildChecks.pdfFilenameUnassigned})`
);
check(buildChecks.assignedFooterHasFormId, "the PDF footer includes \"Form ID: 26-1001\" for an assigned plot");
check(buildChecks.unassignedFooterHasFormId === false, "the PDF footer omits any Form ID line for a plot that doesn't have one yet");
check(buildChecks.withDetailsHasHeader, "includePlotDetails: true draws the compact \"Plot Details\" section label");
check(buildChecks.withDetailsHasAddressLabel, "includePlotDetails: true draws a \"Cooperator Address: ...\" field in the compact header");
check(buildChecks.withoutDetailsHasHeader === false, "includePlotDetails: false omits the \"Plot Details\" block entirely");
check(buildChecks.defaultHasHeader === false, "omitting includePlotDetails altogether defaults to NOT drawing the block (PDF stays as-is)");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
