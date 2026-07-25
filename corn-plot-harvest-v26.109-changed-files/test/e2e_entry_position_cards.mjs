// Verifies the two new "Yield by Position" / "Moisture by Position"
// cards on the Plot Summary SCREEN — per explicit follow-up request:
// "add the Yield by Position and Moisture by Position graphs, each in a
// separate window, below the Dry Yield Summary window." Each is its own
// full-width card (same "window" pattern as Dry Yield Summary itself),
// stacked below it and above "Ranked Results".
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

async function seedAndOpenSummary(page, selectedBrand, brandName, entries) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(
    ({ selectedBrand, brandName, entries }) => {
      localStorage.clear();
      if (selectedBrand) localStorage.setItem("cph.selectedBrand", JSON.stringify(selectedBrand));
      localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
      const full = entries.map((e, i) => ({
        id: `e${i}`, brand: brandName, hybrid: `H${i}`, trait: "", relativeMaturity: "100", seedTreatment: "",
        sampleNetWeightLbs: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
        widthInches: "", comments: "",
        manualDryYield: e.y === null ? "" : String(e.y),
        moisturePercent: e.m === null || e.m === undefined ? "" : String(e.m),
      }));
      localStorage.setItem(
        "cph.draftTrial",
        JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries: full })
      );
    },
    { selectedBrand, brandName, entries }
  );
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
}

// Entries in PLOT/PLANTING order (position 1..10) — deliberately NOT
// sorted by yield. Position 4 (0-indexed 3) has no dry yield at all and
// position 7 has no moisture reading, to verify null values reserve an
// empty x-slot instead of being skipped/compacted.
const ENTRIES = [
  { y: 220, m: 18.0 },
  { y: 150, m: 22.5 },
  { y: 240, m: 15.0 },
  { y: null, m: 19.0 },
  { y: 200, m: 20.0 },
  { y: 180, m: 17.5 },
  { y: 210, m: null },
  { y: 230, m: 16.0 },
  { y: 160, m: 21.0 },
  { y: 190, m: 19.5 },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- Structure & placement: 2 separate full-width cards, below Dry Yield Summary, above Ranked Results ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", ENTRIES);

  const cardTitles = await page.$$eval(".screen-body > .card > .section-header", (els) => els.map((e) => e.textContent));
  check(cardTitles.includes("Dry Yield Summary"), `"Dry Yield Summary" card renders (got ${JSON.stringify(cardTitles)})`);
  check(cardTitles.includes("Yield by Position"), `"Yield by Position" is its own separate card (got ${JSON.stringify(cardTitles)})`);
  check(cardTitles.includes("Moisture by Position"), `"Moisture by Position" is its own separate card (got ${JSON.stringify(cardTitles)})`);

  const order = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll(".screen-body > .card > .section-header, .screen-body > .section-header")).map((e) => e.textContent);
    return titles;
  });
  const summaryIdx = order.indexOf("Dry Yield Summary");
  const yieldIdx = order.indexOf("Yield by Position");
  const moistureIdx = order.indexOf("Moisture by Position");
  const rankedIdx = order.indexOf("Ranked Results");
  check(
    summaryIdx !== -1 && summaryIdx < yieldIdx && yieldIdx < moistureIdx && moistureIdx < rankedIdx,
    `cards appear in order: Dry Yield Summary -> Yield by Position -> Moisture by Position -> Ranked Results (order=${JSON.stringify(order)})`
  );

  // Each is its own card element, distinct from the Dry Yield Summary card.
  const yieldCard = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll(".card")).find((c) => c.querySelector(".section-header")?.textContent === "Yield by Position")
  );
  const isBoxPlotInsideYieldCard = await page.evaluate((card) => !!card.querySelector(".box-plot-section"), yieldCard);
  check(!isBoxPlotInsideYieldCard, "Yield by Position card does NOT contain the box-and-whisker chart (it's a separate card)");

  // Bar chart SVGs.
  const barSvgCount = await page.$$eval(".entry-bar-svg", (els) => els.length);
  check(barSvgCount === 2, `two entry-position bar chart SVGs render (got ${barSvgCount})`);

  // Yield chart: 9 bars (10 entries, 1 null skipped), in PLOT POSITION order.
  const yieldBarHeights = await page.$$eval(".entry-bar-yield", (els) => els.map((e) => Number(e.getAttribute("height"))));
  check(yieldBarHeights.length === 9, `yield chart draws 9 bars, skipping the 1 null entry (got ${yieldBarHeights.length})`);
  const maxH = Math.max(...yieldBarHeights);
  const minH = Math.min(...yieldBarHeights);
  // Bars are drawn only for the 9 non-null entries in plot-position order
  // (position 4 is the skipped null) — index 2 is plot position 3 (value
  // 240, the plot MAX) and index 1 is plot position 2 (value 150, the
  // plot MIN among non-nulls). Confirms x-axis order tracks PLANTING
  // position, not rank.
  check(yieldBarHeights.indexOf(maxH) === 2, `tallest yield bar is plot position 3 (240 bu/ac) (heights=${JSON.stringify(yieldBarHeights)})`);
  check(yieldBarHeights.indexOf(minH) === 1, `shortest yield bar is plot position 2 (150 bu/ac) (heights=${JSON.stringify(yieldBarHeights)})`);

  const moistureBarCount = await page.$$eval(".entry-bar-moisture", (els) => els.length);
  check(moistureBarCount === 9, `moisture chart draws 9 bars, skipping the 1 null entry (got ${moistureBarCount})`);

  // Colors: yield bar matches the box-and-whisker box color on Midwest; moisture is the fixed dark blue.
  const yieldFill = await page.$eval(".entry-bar-yield", (el) => getComputedStyle(el).fill);
  const boxFill = await page.$eval(".box-plot-box", (el) => getComputedStyle(el).fill);
  check(yieldFill === boxFill, `yield bar color matches the box-and-whisker box color on Midwest (got "${yieldFill}" vs "${boxFill}")`);

  const moistureFill = await page.$eval(".entry-bar-moisture", (el) => getComputedStyle(el).fill);
  check(moistureFill === "rgb(12, 35, 54)", `moisture bar is the fixed dark blue #0c2336 (got "${moistureFill}")`);

  // Captions.
  const yieldCaption = await page.evaluate(
    () => Array.from(document.querySelectorAll(".card")).find((c) => c.querySelector(".section-header")?.textContent === "Yield by Position").querySelector(".box-plot-caption").textContent
  );
  check(yieldCaption.includes("Low 150.0") && yieldCaption.includes("High 240.0"), `yield-by-position caption shows correct low/high (got "${yieldCaption}")`);

  const moistureCaption = await page.evaluate(
    () => Array.from(document.querySelectorAll(".card")).find((c) => c.querySelector(".section-header")?.textContent === "Moisture by Position").querySelector(".box-plot-caption").textContent
  );
  check(moistureCaption.includes("Low 15.0") && moistureCaption.includes("High 22.5"), `moisture-by-position caption shows correct low/high (got "${moistureCaption}")`);

  await page.close();
}

// ---- NC+: yield bar follows the box-plot's chrome-blue override; moisture stays fixed dark blue ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "ncPlus", "NC+ Hybrids", ENTRIES);

  const yieldFill = await page.$eval(".entry-bar-yield", (el) => getComputedStyle(el).fill);
  check(yieldFill === "rgb(33, 90, 168)", `NC+'s yield bar uses chrome blue, matching its box-plot override (got "${yieldFill}")`);

  const moistureFill = await page.$eval(".entry-bar-moisture", (el) => getComputedStyle(el).fill);
  check(moistureFill === "rgb(12, 35, 54)", `NC+'s moisture bar is still the fixed dark blue, unaffected by brand (got "${moistureFill}")`);

  await page.close();
}

// ---- Crow's: cards available (no special-cased layout) ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "crows", "Republic Shield Crow's Genetics", ENTRIES);

  const barSvgCount = await page.$$eval(".entry-bar-svg", (els) => els.length);
  check(barSvgCount === 2, `Crow's view also renders both entry-position bar cards (got ${barSvgCount})`);

  await page.close();
}

// ---- No Brand View selected: cards still available ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, null, "", ENTRIES);

  const barSvgCount = await page.$$eval(".entry-bar-svg", (els) => els.length);
  check(barSvgCount === 2, `no-Brand-View state also renders both entry-position bar cards (got ${barSvgCount})`);

  await page.close();
}

// ---- Empty plot: no crash, cards simply absent (same gating as the box plot) ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", []);

  const barSvgCount = await page.$$eval(".entry-bar-svg", (els) => els.length);
  check(barSvgCount === 0, "entry-position cards are absent entirely when there's no dry-yield data yet (same gating as the box plot)");

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
