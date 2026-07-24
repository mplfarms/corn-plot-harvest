// Verifies the 3rd Brand View, Crow's (per explicit request, brand
// standards: black HEX 231f20 / red HEX b12028): it shows up as a 3rd
// choice on the manual Brand View picker, and its Plot Summary Ranked
// Results list renders IDENTICALLY to Midwest Seed Genetics/NC+ — same
// colored significance rank-badge, same significance-color legend, same
// single current-metric-value on the right. Crow's previously had its
// own plainer variant here (no color coding, entry number on the left,
// Rank + Dry Yield stacked on the right) — that was removed per explicit
// request ("Make the layout of all views and share options match the
// Midwest and NC+ views"), so this file now checks Crow's is a plain
// no-op pass-through of the shared layout rather than checking a
// Crow's-specific one. See plotSummary.js (the isCrowsView branch is
// gone entirely) and e2e_brand_view_relabel.mjs (which still covers the
// separate, UNCHANGED brand-name/hybrid-code-prefix relabeling feature).
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
    sampleNetWeightLbs: "", testWeight: "", stripLengthFeet: "",
    numberOfRows: "", widthInches: "", comments: "", manualDryYield: String(yieldVal),
    // Equal to the test header's baseMoisturePercent (15) below, so
    // gross() takes its "at or under base moisture" branch (no shrink
    // deduction) and the Gross-tab check can assert an exact value.
    moisturePercent: "15.0",
  };
}

const ENTRIES = [
  entry("e1", "Crow's", 180),
  entry("e2", "Crow's", 210),
  entry("e3", "Crow's", 240),
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- 1. Brand Select picker still offers 3 choices, Crow's included ----
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
    `Brand Select still offers all 3 brands, Crow's included (got ${JSON.stringify(names)})`
  );
  await page.close();
}

// ---- 2. Crow's Plot Summary now uses the exact same layout as every other Brand View ----
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
        JSON.stringify({
          id: "t1",
          // pricePerBushel/baseMoisturePercent/dryingShrinkRate needed so
          // gross() can actually compute a value (not just null) for the
          // Gross-tab check below.
          header: { cooperatorName: "Test Coop", state: "IA", county: "", baseMoisturePercent: 15, dryingShrinkRate: 0.06, pricePerBushel: 4.25 },
          entries,
        })
      );
    },
    ENTRIES
  );
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  // Colored significance rank-badges, one per row — same as Midwest/NC+.
  const colorBadges = await page.$$(".rank-badge");
  check(colorBadges.length === 3, `Crow's view now shows colored significance rank-badges, one per row (got ${colorBadges.length})`);

  // The significance-color legend is shown, not hidden.
  const legend = await page.$(".significance-legend");
  check(Boolean(legend), "Crow's view now shows the significance-color legend");

  // No leftover plain-layout elements from the old Crow's-specific variant.
  const entryNums = await page.$(".ranked-row-entry-num");
  check(!entryNums, "Crow's view no longer uses the old plain entry-number-on-the-left layout");
  const rightStack = await page.$(".ranked-row-right-stack");
  check(!rightStack, "Crow's view no longer uses the old Rank+DryYield right-side stack");

  // Each row shows a single current-metric value on the right (Dry Yield
  // by default), highest first, same shape as every other Brand View.
  const values = await page.$$eval(".ranked-row-value", (els) => els.map((e) => e.textContent.trim()));
  check(
    JSON.stringify(values) === JSON.stringify(["240.0 bu/ac", "210.0 bu/ac", "180.0 bu/ac"]),
    `Crow's view shows a single Dry Yield value per row, highest first (got ${JSON.stringify(values)})`
  );

  // Switching to Gross re-sorts and re-labels the single value column too,
  // exactly like Midwest/NC+ — no separate Dry Yield display lingers.
  await page.locator(".segmented-control .segmented-btn", { hasText: "Gross" }).click();
  await page.waitForTimeout(200);
  const grossValues = await page.$$eval(".ranked-row-value", (els) => els.map((e) => e.textContent.trim()));
  check(
    grossValues.every((t) => t.startsWith("$")),
    `Crow's view's Gross tab shows dollar values in the single value column, like every other Brand View (got ${JSON.stringify(grossValues)})`
  );

  // Only Dry Yield and Gross are selectable (the Entry # tab was removed
  // separately, across all 3 Brand Views).
  const tabLabels = await page.$$eval(".segmented-control .segmented-btn", (els) => els.map((e) => e.textContent.trim()));
  check(
    tabLabels.length === 2 && tabLabels[0] === "Dry Yield" && tabLabels[1] === "Gross",
    `Crow's view's segmented control shows only Dry Yield and Gross (got ${JSON.stringify(tabLabels)})`
  );

  await page.close();
}

// ---- 3. Cross-check: Crow's rendering is now byte-for-byte structurally identical to Midwest's for the same data ----
{
  async function rankedRowsFor(brandId, brandLabel) {
    const page = await browser.newPage();
    page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(
      (args) => {
        localStorage.clear();
        localStorage.setItem("cph.selectedBrand", JSON.stringify(args.brandId));
        localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
        localStorage.setItem(
          "cph.draftTrial",
          JSON.stringify({
            id: "t1",
            header: { cooperatorName: "Test Coop", state: "IA", county: "" },
            entries: args.entries.map((e) => ({ ...e, brand: args.brandLabel })),
          })
        );
      },
      { brandId, entries: ENTRIES, brandLabel }
    );
    await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
    await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
    const badgeCount = (await page.$$(".rank-badge")).length;
    const hasLegend = Boolean(await page.$(".significance-legend"));
    const values = await page.$$eval(".ranked-row-value", (els) => els.map((e) => e.textContent.trim()));
    await page.close();
    return { badgeCount, hasLegend, values };
  }

  const crows = await rankedRowsFor("crows", "Crow's");
  const midwest = await rankedRowsFor("midwestSeedGenetics", "Midwest Seed Genetics");
  check(
    crows.badgeCount === midwest.badgeCount && crows.hasLegend === midwest.hasLegend && JSON.stringify(crows.values) === JSON.stringify(midwest.values),
    `Crow's and Midwest render structurally identical Ranked Results for the same data (Crow's: ${JSON.stringify(crows)}, Midwest: ${JSON.stringify(midwest)})`
  );
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
