// Verifies the new 3rd Brand View, Crow's (per explicit request, brand
// standards: black HEX 231f20 / red HEX b12028): it shows up as a 3rd
// choice on the manual Brand View picker, and its Plot Summary Ranked
// Results list renders the deliberately plainer layout Crow's asked for —
// no color-coded significance badge, the entry's ORIGINAL number on the
// left, and its sorted placement rank + actual Dry Yield together on the
// right (regardless of which metric tab is selected) — with the
// significance-color legend hidden entirely, since there's no more color
// coding for it to explain. Every other Brand View keeps the original
// colored-badge layout untouched (see e2e_brand_view_relabel.mjs and
// plotSummary.js's isCrowsView).
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

function entry(id, brand, yieldVal) {
  return {
    id, brand, hybrid: id, trait: "", relativeMaturity: "100", seedTreatment: "",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "",
    numberOfRows: "", widthInches: "", comments: "", manualDryYield: String(yieldVal),
  };
}

// Deliberately out of yield order (e3 highest, e1 lowest) so "original
// number" (planting order) and "placement rank" (sorted order) diverge —
// otherwise a bug that swapped the two wouldn't be caught.
const ENTRIES = [
  entry("e1", "Crow's", 180), // originalNumber 1, lowest yield -> rank 3
  entry("e2", "Crow's", 210), // originalNumber 2, middle yield -> rank 2
  entry("e3", "Crow's", 240), // originalNumber 3, highest yield -> rank 1
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- 1. Brand Select picker now offers 3 choices, Crow's included ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "jamie@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/brand-select`);
  await page.waitForSelector(".brand-select-screen", { timeout: 5000 });
  const names = await page.$$eval(".brand-select-name", (els) => els.map((e) => e.textContent.trim()));
  check(
    names.length === 3 && names.includes("Midwest Seed Genetics") && names.includes("NC+") && names.includes("Crow's"),
    `Brand Select now offers all 3 brands, Crow's included (got ${JSON.stringify(names)})`
  );
  await page.close();
}

// ---- 2. Crow's Plot Summary: plain Ranked Results layout ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(
    (entries) => {
      localStorage.clear();
      localStorage.setItem("cph.selectedBrand", JSON.stringify("crows"));
      localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
      localStorage.setItem(
        "cph.draftTrial",
        JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries })
      );
    },
    ENTRIES
  );
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  // No colored significance badges at all in Crow's view.
  const colorBadges = await page.$(".rank-badge");
  check(!colorBadges, "Crow's view has no colored significance rank-badge at all");

  // No significance legend either — nothing left for it to explain.
  const legend = await page.$(".significance-legend");
  check(!legend, "Crow's view hides the significance-color legend entirely");

  // Plain entry-number elements on the left, one per row.
  const entryNums = await page.$$eval(".ranked-row-entry-num", (els) => els.map((e) => e.textContent.trim()));
  check(
    entryNums.length === 3 && entryNums.includes("#1") && entryNums.includes("#2") && entryNums.includes("#3"),
    `each row shows its ORIGINAL entry number on the left (got ${JSON.stringify(entryNums)})`
  );

  // Right-side stack shows "Rank N" + the actual Dry Yield, top row first (sorted by Dry Yield desc by default).
  const rightStacks = await page.$$eval(".ranked-row-right-stack", (els) =>
    els.map((el) => ({
      rank: el.querySelector(".ranked-row-rank").textContent.trim(),
      value: el.querySelector(".ranked-row-value").textContent.trim(),
    }))
  );
  check(rightStacks.length === 3, `3 right-side rank/yield stacks rendered (got ${rightStacks.length})`);
  check(
    rightStacks[0].rank === "Rank 1" && rightStacks[0].value === "240.0 bu/ac",
    `top row (highest yield, e3) shows "Rank 1" and its actual Dry Yield on the right (got ${JSON.stringify(rightStacks[0])})`
  );
  check(
    rightStacks[2].rank === "Rank 3" && rightStacks[2].value === "180.0 bu/ac",
    `bottom row (lowest yield, e1) shows "Rank 3" and its actual Dry Yield on the right (got ${JSON.stringify(rightStacks[2])})`
  );

  // Cross-check: the top row (rank 1, highest yield = e3) has ORIGINAL
  // number #3 (its planting-order position), NOT #1 — confirms entry
  // number and placement rank are genuinely two different, un-swapped
  // values rather than both accidentally showing the same thing.
  const topRowEntryNum = await page.$eval(".ranked-row:first-child .ranked-row-entry-num", (el) => el.textContent.trim());
  check(
    topRowEntryNum === "#3",
    `the top-ranked row's LEFT entry-number is its original planting position (#3 for e3), distinct from its "Rank 1" on the right (got "${topRowEntryNum}")`
  );

  // Dry Yield is shown on the right even though Dry Yield already IS the
  // active sort tab by default — also switch to the Gross tab and confirm
  // Dry Yield keeps showing on the right regardless of the active metric.
  await page.locator(".segmented-control .segmented-btn", { hasText: "Gross" }).click();
  await page.waitForTimeout(200);
  const rightStacksOnGross = await page.$$eval(".ranked-row-right-stack .ranked-row-value", (els) =>
    els.map((e) => e.textContent.trim())
  );
  check(
    rightStacksOnGross.every((t) => t.endsWith("bu/ac")),
    `Dry Yield keeps showing on the right even with the Gross tab active (got ${JSON.stringify(rightStacksOnGross)})`
  );

  await page.close();
}

// ---- 3. Sanity check: a NON-Crow's Brand View is completely unaffected (still colored badges, single value, legend shown) ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(
    (entries) => {
      localStorage.clear();
      localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
      localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
      localStorage.setItem(
        "cph.draftTrial",
        JSON.stringify({
          id: "t1",
          header: { cooperatorName: "Test Coop", state: "IA", county: "" },
          entries: entries.map((e) => ({ ...e, brand: "Midwest Seed Genetics" })),
        })
      );
    },
    ENTRIES
  );
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  const colorBadges = await page.$$(".rank-badge");
  check(colorBadges.length === 3, `Midwest (non-Crow's) view still shows the original colored rank-badges (got ${colorBadges.length})`);
  const legend = await page.$(".significance-legend");
  check(Boolean(legend), "Midwest (non-Crow's) view still shows the significance-color legend");
  const entryNums = await page.$(".ranked-row-entry-num");
  check(!entryNums, "Midwest (non-Crow's) view does NOT use Crow's plain entry-number layout");

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
