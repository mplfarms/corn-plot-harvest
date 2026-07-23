// Verifies the Plot Details screen (trialDetails.js) cleanup:
//   1. State, County, Tillage, Irrigation, Soil Type, Previous Crop, and
//      Planting Population no longer repeat their title a second time
//      inside the row itself (same redundant-label issue already fixed
//      on the Entry Editor's Hybrid Details section).
//   2. An empty selection box shows the plain word "Select" instead of
//      its old grayed-out title (or, for State/County, the old more
//      verbose "Select a state"/"Select a county" placeholder).
//   3. "Cooperator", "Planting", and "Harvest" are renamed to
//      "Cooperator Details", "Planting Details", and "Harvest Details".
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

// This fixture has no GPS coordinates yet, which makes the screen fire a
// real, unmocked device-geolocation lookup on mount (see trialDetails.js's
// auto-locate-on-empty-GPS behavior, also covered by
// e2e_soil_gps_autolocate.mjs). Left unmocked, that lookup's async
// fail-over (no network/location access in this sandbox) can race with the
// wheel-panel interaction below and intermittently swallow the click —
// stub it out so it resolves (as a clean failure) before any interaction
// starts, the same way e2e_soil_gps_autolocate.mjs mocks it.
await page.addInitScript(() => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition(_success, error) {
        if (error) error({ code: 1, message: "denied (mocked)" });
      },
    },
  });
});

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "t1",
      header: {
        cooperatorName: "Test Coop",
        address: "",
        city: "",
        state: "", // deliberately blank, unlike most other fixtures in this suite
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
      },
      entries: [],
    })
  );
});
await page.goto(`${BASE}/index.html?r=1#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });

// ---- 3. Section renames ----
const sectionTitles = await page.$$eval(".section-header", (els) => els.map((el) => el.textContent));
check(sectionTitles.includes("Cooperator Details"), `"Cooperator" is renamed to "Cooperator Details" (got ${JSON.stringify(sectionTitles)})`);
check(sectionTitles.includes("Planting Details"), `"Planting" is renamed to "Planting Details" (got ${JSON.stringify(sectionTitles)})`);
check(sectionTitles.includes("Harvest Details"), `"Harvest" is renamed to "Harvest Details" (got ${JSON.stringify(sectionTitles)})`);
// GPS Location and Yield Calculation weren't part of the rename request — sanity check they're untouched.
check(sectionTitles.includes("GPS Location"), "GPS Location's title is unchanged");
check(sectionTitles.includes("Yield Calculation"), "Yield Calculation's title is unchanged");

// ---- 1. No redundant in-row titles anywhere on this screen ----
const rowLabelTexts = await page.$$eval(".wheel-row-label", (els) => els.map((el) => el.textContent));
check(rowLabelTexts.length === 0, `no wheel on Plot Details shows a redundant in-row title anymore (got ${JSON.stringify(rowLabelTexts)})`);

// Scope by the field's own label text using an EXACT match (text-is), not a
// substring hasText match — "State" as a substring also matches County's
// disabled-reason text ("Select a state first"), which caused a strict-mode
// violation (2 elements) when clicking below.
function fieldByLabel(label) {
  return page.locator(".field", { has: page.locator(".field-label", { hasText: new RegExp(`^${label}$`) }) });
}

// ---- 2. Empty selection boxes show plain "Select" ----
const FIELDS_EXPECTED_EMPTY = ["State", "County", "Tillage", "Irrigation", "Soil Type", "Previous Crop"];
for (const label of FIELDS_EXPECTED_EMPTY) {
  const text = await fieldByLabel(label).locator(".wheel-row-value").first().textContent();
  check(text.trim() === "Select", `${label}'s empty box shows plain "Select" (got "${text.trim()}")`);
}

// County starts disabled (no state chosen yet) — confirm the placeholder
// still reads "Select" even in the disabled state, not the old "Select a
// county" copy, and that the disabled-reason note is unaffected.
const countyDisabledReason = await fieldByLabel("County").locator(".wheel-disabled-reason").textContent();
check(countyDisabledReason.trim() === "Select a state first", `County's disabled-reason note is unaffected (got "${countyDisabledReason.trim()}")`);

// Planting Population always defaults to a real value (32000), so it's
// never actually shown blank — just confirm its label placement/value
// are otherwise consistent with its neighbors.
const populationValue = await fieldByLabel("Planting Population").locator(".wheel-row-value").textContent();
check(populationValue.trim() === "32000", `Planting Population still shows its default value (got "${populationValue.trim()}")`);

// ---- Selecting a value still works normally after these changes ----
await fieldByLabel("State").locator(".wheel-row-header").click();
await page.waitForSelector(".wheel-panel .wheel-option", { timeout: 3000 });
// The State list is long (50 options, nothing pre-selected to scroll to
// since the fixture starts blank) — clicking Iowa immediately after the
// panel's first option attaches raced with the panel/list finishing its
// layout often enough to land the click somewhere that didn't register as
// a real pick. A short settle delay before clicking made this reliable
// (confirmed as the actual fix, not a real app bug, before landing this).
await page.waitForTimeout(200);
await page.click(".wheel-option:has-text('Iowa')");
await page.waitForTimeout(150);
const stateValueAfterPick = await fieldByLabel("State").locator(".wheel-row-value").textContent();
check(stateValueAfterPick.trim() === "Iowa (IA)", `picking a State still works and shows the value, not "Select" (got "${stateValueAfterPick.trim()}")`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
