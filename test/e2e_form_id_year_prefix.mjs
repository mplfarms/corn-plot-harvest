// Verifies the CLIENT side of the Form ID year-prefix feature (per
// explicit request): when a plot is saved, the app computes which
// calendar year the reservation request should ask for and sends it as
// `year` in the POST body to /.netlify/functions/formId — see
// formIdAssign.js's doEnsure(), which reuses models.js's
// harvestedYear() (Date Harvested's year, else Date Planted's, else
// today's, as a last resort for a brand new plot with neither filled
// in). The actual "<year>-1001..."-style prefix generation itself is
// server-side and is covered by unit_form_id_function.mjs's/
// unit_backfill_form_ids.mjs's tests against _formIdShared.js — this
// file only proves the CLIENT asks for the right year in the first
// place, across all three branches of that fallback chain, by
// inspecting the real request body a mocked fetch actually receives.
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

function blankHeader(overrides) {
  return {
    cooperatorName: "Test Coop",
    address: "",
    city: "",
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
    plantingPopulation: "",
    dateHarvested: null,
    collectedBy: "",
    phone: "",
    email: "",
    baseMoisturePercent: 15.5,
    dryingShrinkRate: 0.06,
    pricePerBushel: 4.25,
    trialNotes: "",
    formId: "",
    ...overrides,
  };
}

async function saveAndCaptureYear(browser, header, label) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  // window.fetch is a per-page-load JS realm value — addInitScript()
  // re-installs this before any page script runs, same pattern as
  // e2e_form_id.mjs.
  await page.addInitScript(() => {
    window.__formIdFetchCalls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, options) => {
      if (String(url).includes("/.netlify/functions/formId")) {
        window.__formIdFetchCalls.push(JSON.parse((options && options.body) || "{}"));
        return Promise.resolve(new Response(JSON.stringify({ formId: "TEST-0000" }), { status: 200 }));
      }
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(
    ({ header }) => {
      localStorage.clear();
      localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
      localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
      localStorage.setItem(
        "cph.draftTrial",
        JSON.stringify({ id: `t-${Math.random()}`, header, entries: [] })
      );
    },
    { header }
  );

  // Fresh navigation so trialStore.js actually re-reads the localStorage
  // we just seeded (see e2e_seedware_export.mjs's section 4 comment for
  // why this second goto is required — module-level state is read once
  // at import time).
  await page.goto(`${BASE}/index.html?r=1#/entries`);
  await page.waitForSelector(".entries-list-screen", { timeout: 5000 });

  // "Add Another Hybrid" creates a blank entry and jumps straight into
  // the Entry Editor for it (see entriesList.js) — no need to drive
  // every entry field through the UI just to reach "Save Plot".
  await page.click("text=Add Another Hybrid");
  await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });

  await page.click(".entry-editor-actions >> text=Save Plot");
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  await page.waitForFunction(() => window.__formIdFetchCalls && window.__formIdFetchCalls.length > 0, { timeout: 5000 });

  const calls = await page.evaluate(() => window.__formIdFetchCalls);
  check(calls.length === 1, `${label}: exactly one reservation call fired (got ${calls.length})`);

  await page.close();
  return calls[0];
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- 1. Neither date set (brand new plot) -> falls back to today's real year ----
{
  const call = await saveAndCaptureYear(browser, blankHeader({}), "neither date set");
  const expectedYear = new Date().getFullYear();
  check(
    call && call.year === expectedYear,
    `with neither Date Planted nor Date Harvested set, the request asks for today's real year (expected ${expectedYear}, got ${call && call.year})`
  );
}

// ---- 2. Only Date Planted set -> that date's year ----
{
  const call = await saveAndCaptureYear(browser, blankHeader({ datePlanted: "2027-05-01" }), "only Date Planted set (2027)");
  check(call && call.year === 2027, `with only Date Planted set to 2027, the request asks for year 2027 (got ${call && call.year})`);
}

// ---- 3. Both set, disagreeing -> Date Harvested wins ----
{
  const call = await saveAndCaptureYear(
    browser,
    blankHeader({ datePlanted: "2026-11-20", dateHarvested: "2027-01-05" }),
    "Date Planted 2026 / Date Harvested 2027"
  );
  check(
    call && call.year === 2027,
    `when Date Planted (2026) and Date Harvested (2027) disagree, Date Harvested's year wins (got ${call && call.year})`
  );
}

// ---- 4. Only Date Harvested set (an older plot being filled in retroactively) ----
{
  const call = await saveAndCaptureYear(browser, blankHeader({ dateHarvested: "2028-10-15" }), "only Date Harvested set (2028)");
  check(call && call.year === 2028, `with only Date Harvested set to 2028, the request asks for year 2028 (got ${call && call.year})`);
}

await browser.close();

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
