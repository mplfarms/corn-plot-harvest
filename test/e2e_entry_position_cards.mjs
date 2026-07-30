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
        id: `e${i}`, brand: brandName, hybrid: e.h || `H${i}`, trait: "", relativeMaturity: "100", seedTreatment: "",
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

  // Colors: yield bar is the fixed Midwest gold (#FEBE10), moisture bar
  // is the fixed NC+ blue (#215AA8) — per explicit request, both are now
  // fixed across all 3 Brand Views instead of following the active
  // brand's own accent the way the box-and-whisker chart still does.
  const yieldFill = await page.$eval(".entry-bar-yield", (el) => getComputedStyle(el).fill);
  check(yieldFill === "rgb(254, 190, 16)", `yield bar is the fixed Midwest gold #FEBE10 on Midwest (got "${yieldFill}")`);

  const moistureFill = await page.$eval(".entry-bar-moisture", (el) => getComputedStyle(el).fill);
  check(moistureFill === "rgb(33, 90, 168)", `moisture bar is the fixed NC+ blue #215AA8 on Midwest (got "${moistureFill}")`);

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

// ---- NC+ and Crow's: both fixed colors hold across every Brand View, unaffected by the active brand ----
for (const [brandId, brandName] of [
  ["ncPlus", "NC+ Hybrids"],
  ["crows", "Republic Shield Crow's Genetics"],
]) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, brandId, brandName, ENTRIES);

  const yieldFill = await page.$eval(".entry-bar-yield", (el) => getComputedStyle(el).fill);
  check(yieldFill === "rgb(254, 190, 16)", `${brandId}'s yield bar is still the fixed Midwest gold, unaffected by brand (got "${yieldFill}")`);

  const moistureFill = await page.$eval(".entry-bar-moisture", (el) => getComputedStyle(el).fill);
  check(moistureFill === "rgb(33, 90, 168)", `${brandId}'s moisture bar is still the fixed NC+ blue, unaffected by brand (got "${moistureFill}")`);

  await page.close();
}

// ---- Position labels: every bar gets its own number below it, even with a lot of entries ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  const manyEntries = Array.from({ length: 18 }, (_, i) => ({ y: 150 + i, m: 15 + i * 0.2 }));
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", manyEntries);

  const labelCounts = await page.$$eval(".card", (cards) =>
    cards
      .filter((c) => c.querySelector(".entry-bar-svg"))
      .map((c) => c.querySelectorAll(".entry-bar-axis-label").length)
  );
  check(
    labelCounts.length === 2 && labelCounts.every((n) => n === 18),
    `every one of the 18 entries gets its own position-number label below it, on both charts, no thinning (got ${JSON.stringify(labelCounts)})`
  );

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

// ---- Trendline: perfect linear data (R²=1), opposite slope directions on yield vs. moisture ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  // Crafted so both fits are exact (R²=1): yield rises +10 bu/ac per
  // position (slope=10, intercept=190), moisture falls -2% per position
  // (slope=-2, intercept=27) — hand-verified by OLS.
  const trendEntries = [
    { y: 200, m: 25 },
    { y: 210, m: 23 },
    { y: 220, m: 21 },
    { y: 230, m: 19 },
    { y: 240, m: 17 },
  ];
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", trendEntries);

  const trendLineCount = await page.$$eval(".entry-bar-trend-line", (els) => els.length);
  check(trendLineCount === 2, `trendline overlay renders on both charts with 5 clean data points (got ${trendLineCount})`);

  const yieldTrendCaption = await page.evaluate(
    () => Array.from(document.querySelectorAll(".card")).find((c) => c.querySelector(".section-header")?.textContent === "Yield by Position").querySelector(".entry-bar-trend-caption").textContent
  );
  check(yieldTrendCaption === "Trend: +10.0 bu/ac per entry (R² 1.00)", `yield trendline caption shows the correct positive slope and R² (got "${yieldTrendCaption}")`);

  const moistureTrendCaption = await page.evaluate(
    () => Array.from(document.querySelectorAll(".card")).find((c) => c.querySelector(".section-header")?.textContent === "Moisture by Position").querySelector(".entry-bar-trend-caption").textContent
  );
  check(moistureTrendCaption === "Trend: −2.0% per entry (R² 1.00)", `moisture trendline caption shows the correct negative slope and R² (got "${moistureTrendCaption}")`);

  const disclaimerCount = await page.$$eval(".entry-bar-trend-disclaimer", (els) => els.length);
  check(disclaimerCount === 2, `the "reflects hybrid + field variation" disclaimer renders under both charts (got ${disclaimerCount})`);
  const disclaimerText = await page.$eval(".entry-bar-trend-disclaimer", (el) => el.textContent);
  check(
    disclaimerText.toLowerCase().includes("hybrid") && disclaimerText.toLowerCase().includes("field"),
    `disclaimer text is the honest caveat about hybrid vs. field variation (got "${disclaimerText}")`
  );

  // Direction: SVG y grows downward, so a rising-yield trend's line
  // should slope UPWARD on screen — its y1 (position 1, the lowest
  // value) sits lower on the chart (larger y) than y2 (position 5, the
  // highest value, smaller y).
  const yieldY1Y2 = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll(".card"))
      .find((c) => c.querySelector(".section-header")?.textContent === "Yield by Position")
      .querySelector(".entry-bar-trend-line");
    return { y1: Number(line.getAttribute("y1")), y2: Number(line.getAttribute("y2")) };
  });
  check(yieldY1Y2.y1 > yieldY1Y2.y2, `rising yield trend slopes upward on screen (y1=${yieldY1Y2.y1} > y2=${yieldY1Y2.y2})`);

  const moistureY1Y2 = await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll(".card"))
      .find((c) => c.querySelector(".section-header")?.textContent === "Moisture by Position")
      .querySelector(".entry-bar-trend-line");
    return { y1: Number(line.getAttribute("y1")), y2: Number(line.getAttribute("y2")) };
  });
  check(moistureY1Y2.y1 < moistureY1Y2.y2, `falling moisture trend slopes downward on screen (y1=${moistureY1Y2.y1} < y2=${moistureY1Y2.y2})`);

  await page.close();
}

// ---- Trendline gating: too few data points (< 3) means no trendline at all ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", [
    { y: 100, m: 10 },
    { y: 200, m: 20 },
  ]);

  const trendLineCount = await page.$$eval(".entry-bar-trend-line", (els) => els.length);
  check(trendLineCount === 0, `no trendline drawn with only 2 data points, below the 3-point minimum (got ${trendLineCount})`);

  const trendCaptionCount = await page.$$eval(".entry-bar-trend-caption", (els) => els.length);
  check(trendCaptionCount === 0, "no trend caption or disclaimer text with only 2 data points");

  await page.close();
}

// ---- No moistures at all: Moisture card hidden entirely, Yield card unaffected ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", [
    { y: 200, m: null },
    { y: 210, m: null },
    { y: 220, m: null },
    { y: 230, m: null },
  ]);

  const cardTitles = await page.$$eval(".screen-body > .card > .section-header", (els) => els.map((e) => e.textContent));
  check(cardTitles.includes("Yield by Position"), `Yield by Position card still renders with yields but no moistures (got ${JSON.stringify(cardTitles)})`);
  check(!cardTitles.includes("Moisture by Position"), `Moisture by Position card is absent entirely when the plot has no moisture readings (got ${JSON.stringify(cardTitles)})`);

  const barSvgCount = await page.$$eval(".entry-bar-svg", (els) => els.length);
  check(barSvgCount === 1, `exactly 1 entry-position chart renders (yield only) (got ${barSvgCount})`);

  await page.close();
}

// ---- Check-hybrid marks: a repeated hybrid's bars carry the white check, unique hybrids don't ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  // "CHECK" planted at positions 1, 3, and 5 (ends + middle); unique
  // hybrids at 2 and 4. Position 4 has no moisture, so the moisture
  // chart draws 4 bars but the same 3 checks.
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", [
    { y: 200, m: 25, h: "CHECK" },
    { y: 210, m: 23 },
    { y: 220, m: 21, h: "CHECK" },
    { y: 230, m: null },
    { y: 240, m: 17, h: "CHECK" },
  ]);

  // The check replaces the position NUMBER below the bar (same label
  // element/class, so same size and color automatically) — per explicit
  // follow-up; it is no longer drawn inside the bar.
  const labelsPerChart = await page.$$eval(".entry-bar-svg", (svgs) =>
    svgs.map((s) => Array.from(s.querySelectorAll(".entry-bar-axis-label")).map((t) => t.textContent))
  );
  check(
    JSON.stringify(labelsPerChart) === JSON.stringify([["✓", "2", "✓", "4", "✓"], ["✓", "2", "✓", "4", "✓"]]),
    `check positions show ✓ in place of their entry numbers on BOTH charts (got ${JSON.stringify(labelsPerChart)})`
  );

  // Ranked Results: check entries say "Check n", others "Entry n".
  // Ranked by yield desc: 240(check,5), 230(4), 220(check,3), 210(2), 200(check,1).
  const entryPosTexts = await page.$$eval(".ranked-row-entry-pos", (els) => els.map((e) => e.textContent));
  check(
    JSON.stringify(entryPosTexts) === JSON.stringify(["Check 5", "Entry 4", "Check 3", "Entry 2", "Check 1"]),
    `Ranked Results says "Check" instead of "Entry" for the repeated hybrid's rows only (got ${JSON.stringify(entryPosTexts)})`
  );

  await page.close();
}

// ---- No repeated hybrids: no check marks anywhere ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics", [
    { y: 200, m: 25 },
    { y: 210, m: 23 },
    { y: 220, m: 21 },
  ]);
  const labelTexts = await page.$eval(".entry-bar-svg", (s) => Array.from(s.querySelectorAll(".entry-bar-axis-label")).map((t) => t.textContent));
  check(JSON.stringify(labelTexts) === JSON.stringify(["1", "2", "3"]), `all-unique hybrids keep plain position numbers, no ✓ anywhere (got ${JSON.stringify(labelTexts)})`);
  const rankedLabels = await page.$$eval(".ranked-row-entry-pos", (els) => els.map((e) => e.textContent));
  check(rankedLabels.every((l) => l.startsWith("Entry ")), `all-unique hybrids all say "Entry n" in Ranked Results (got ${JSON.stringify(rankedLabels)})`);
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
