// Verifies the "Entry #" tab added to Plot Summary's segmented control
// (between Dry Yield and Gross — see yieldCalculator.js's
// RankingMetric.ENTRY_NUM), per explicit request: a way to sort Ranked
// Results back to the plot's original/planting order after having
// sorted by a measured value.
//   1. The segmented control shows exactly 3 tabs, in order: Dry Yield,
//      Entry #, Gross.
//   2. Dry Yield (the default tab) sorts rows highest-to-lowest yield —
//      NOT original entry order, so this plot's yields are picked to
//      differ from planting order and prove the two sorts disagree.
//   3. Clicking "Entry #" re-sorts the same rows back to original
//      entry/planting order (1, 2, 3, ...), each row's value column
//      showing "#1", "#2", "#3", ... — regardless of dry yield.
//   4. Switching back to Gross re-sorts by gross value again (highest
//      first), proving Entry # didn't clobber the other tabs' sorts.
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

function entry(id, dryYieldBu) {
  return {
    id,
    brand: "Midwest Seed Genetics",
    hybrid: id,
    trait: "",
    relativeMaturity: "112",
    seedTreatment: "",
    sampleNetWeightLbs: "",
    // Equal to header.baseMoisturePercent below (15) on every entry, so
    // gross() takes its "at or under base moisture" branch (no shrink
    // deduction) uniformly — that keeps Gross exactly proportional to
    // Dry Yield (gross = dryYield * pricePerBushel) so this test can
    // assert Gross's sort order without hand-computing a shrink
    // deduction per entry; it's still a real, independent computation
    // through gross(), not a stand-in for it.
    moisturePercent: "15.0",
    testWeight: "",
    stripLengthFeet: "",
    numberOfRows: "",
    widthInches: "",
    comments: "",
    // manualDryYield lets the app use the exact yield we want, sidestepping
    // the row-length/weight/moisture calculation entirely.
    manualDryYield: String(dryYieldBu),
  };
}

// Planting order (entry order) is E1..E4. Yields are deliberately NOT in
// that order, so Dry Yield's sort and Entry #'s sort visibly disagree —
// otherwise this test couldn't tell the two tabs apart.
const ENTRIES = [
  entry("E1", 180),
  entry("E2", 220),
  entry("E3", 160),
  entry("E4", 200),
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.goto(`${BASE}/index.html`);
await page.evaluate((entries) => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem(
    "cph.authSession",
    JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false })
  );
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "t1",
      header: {
        cooperatorName: "Test Coop",
        state: "IA",
        county: "",
        baseMoisturePercent: 15,
        dryingShrinkRate: 0.06,
        pricePerBushel: 4.25,
      },
      entries,
    })
  );
}, ENTRIES);

await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

// ---- 1. Three tabs, in order ----
const tabLabels = await page.$$eval(".segmented-control .segmented-btn", (els) => els.map((el) => el.textContent.trim()));
check(
  tabLabels.length === 3 && tabLabels[0] === "Dry Yield" && tabLabels[1] === "Entry #" && tabLabels[2] === "Gross",
  `segmented control shows Dry Yield, Entry #, Gross in order (got ${JSON.stringify(tabLabels)})`
);

// ---- 2. Dry Yield tab (default) sorts by yield, highest first ----
const dryYieldTitles = await page.$$eval(".ranked-row-title", (els) => els.map((el) => el.textContent.split(" • ")[0]));
check(
  JSON.stringify(dryYieldTitles) === JSON.stringify(["E2", "E4", "E1", "E3"]),
  `Dry Yield tab sorts E2(220) > E4(200) > E1(180) > E3(160) (got ${JSON.stringify(dryYieldTitles)})`
);

// ---- 3. Click "Entry #" — sorts back to original/planting order ----
await page.locator(".segmented-control .segmented-btn", { hasText: "Entry #" }).click();
await page.waitForSelector(".segmented-btn-active", { timeout: 5000 });

const activeTab = await page.$eval(".segmented-control .segmented-btn-active", (el) => el.textContent.trim());
check(activeTab === "Entry #", `Entry # tab becomes active after clicking it (got "${activeTab}")`);

const entryNumTitles = await page.$$eval(".ranked-row-title", (els) => els.map((el) => el.textContent.split(" • ")[0]));
check(
  JSON.stringify(entryNumTitles) === JSON.stringify(["E1", "E2", "E3", "E4"]),
  `Entry # tab sorts rows back to original entry order E1, E2, E3, E4 regardless of yield (got ${JSON.stringify(entryNumTitles)})`
);

const entryNumValues = await page.$$eval(".ranked-row-value", (els) => els.map((el) => el.textContent.trim()));
check(
  JSON.stringify(entryNumValues) === JSON.stringify(["#1", "#2", "#3", "#4"]),
  `Entry # tab's value column shows #1, #2, #3, #4 (got ${JSON.stringify(entryNumValues)})`
);

// ---- 4. Switching to Gross re-sorts by gross value, unaffected by Entry # ----
await page.locator(".segmented-control .segmented-btn", { hasText: "Gross" }).click();
await page.waitForSelector(".segmented-btn-active", { timeout: 5000 });

const grossTitles = await page.$$eval(".ranked-row-title", (els) => els.map((el) => el.textContent.split(" • ")[0]));
// Every entry's moisturePercent equals header.baseMoisturePercent (see
// entry()'s comment), so gross = dryYield * pricePerBushel uniformly —
// same relative order as Dry Yield. This only proves the sort actually
// re-ran off Gross's own value function, not that it stayed stuck on
// Entry #'s order.
check(
  JSON.stringify(grossTitles) === JSON.stringify(["E2", "E4", "E1", "E3"]),
  `Gross tab re-sorts by gross value, not left on Entry #'s order (got ${JSON.stringify(grossTitles)})`
);

await page.close();
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
