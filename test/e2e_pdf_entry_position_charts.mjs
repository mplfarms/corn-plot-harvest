// Verifies the two new PDF-only "Yield by Entry Position" / "Moisture by
// Entry Position" bar-chart boxes in pdfBuilder.js — per explicit
// request: keep the Plot Summary SCREEN's Dry Yield Summary exactly as
// it was (see e2e_box_plot.mjs's screen-side checks, unchanged), and add
// these two as their own boxes (same visual treatment as the existing
// "Dry Yield Distribution" box) to the PDF/print/share export only —
// drawn SIDE BY SIDE (not stacked) per a later explicit follow-up
// request, to use less vertical space on the page.
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

// Entries in PLOT/PLANTING order (position 1..10) — deliberately NOT
// sorted by yield, so a position-ordered chart reading this exact order
// (rather than by rank) is the only way the ordering checks below pass.
// Position 4 (0-indexed 3) has no dry yield at all and position 7 has no
// moisture reading, to verify null values reserve an empty x-slot
// instead of being skipped/compacted.
const ROWS = [
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

async function buildPdfCalls(page, brandId, brandName) {
  return page.evaluate(
    async ({ brandId, brandName, rows }) => {
      const calls = { text: [], rect: [], fillColor: [], line: [] };
      function FakeJsPDF() {
        return {
          setFont() {}, setFontSize() {}, setTextColor() {}, setDrawColor() {}, setLineWidth() {},
          saveGraphicsState() {}, restoreGraphicsState() {},
          setGState() {}, GState(opts) { return opts; },
          setFillColor(r, g, b) { calls.fillColor.push([r, g, b]); },
          splitTextToSize: (t) => [t],
          getTextWidth: (t) => String(t).length * 5,
          getImageProperties: () => ({ width: 100, height: 40 }),
          addImage() {},
          text(str, x, y, opts) { calls.text.push({ str: String(str), x, y, opts }); },
          circle() {},
          rect(x, y, w, h, style) { calls.rect.push({ x, y, w, h, style, fill: calls.fillColor[calls.fillColor.length - 1] }); },
          line(x1, y1, x2, y2) { calls.line.push({ x1, y1, x2, y2 }); },
          addPage() {},
          output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
        };
      }
      window.jspdf = { jsPDF: FakeJsPDF };
      const { buildPdf } = await import("/js/core/pdfBuilder.js");
      const { getBrand } = await import("/js/ui/brand.js");
      const entries = rows.map((r, i) => ({
        id: `e${i}`, brand: brandName, hybrid: `H${i}`, trait: "", relativeMaturity: "100",
        manualDryYield: r.y === null ? "" : String(r.y),
        moisturePercent: r.m === null ? "" : String(r.m),
        sampleNetWeightLbs: "", testWeight: "", stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "",
      }));
      const results = entries.map((entry, idx) => ({ originalNumber: idx + 1, entry, value: Number(entry.manualDryYield) || 0 }));
      results.sort((a, b) => b.value - a.value);
      const header = { cooperatorName: "Test Coop", state: "IA", county: "", year: "2026" };
      await buildPdf({ header, results, metric: "dryYield", allEntries: entries, brand: brandId ? getBrand(brandId) : null, logoDataUrl: null });
      return calls;
    },
    { brandId, brandName, rows: ROWS }
  );
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- Midwest: both new boxes render, in order, with correct colors ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  const calls = await buildPdfCalls(page, "midwestSeedGenetics", "Midwest Seed Genetics");

  const allText = calls.text.map((t) => t.str);
  check(allText.some((t) => t.includes("Yield by Entry Position:")), `PDF includes "Yield by Entry Position:" header`);
  check(allText.some((t) => t.includes("Moisture by Entry Position:")), `PDF includes "Moisture by Entry Position:" header`);

  // Order: Dry Yield Distribution -> Yield by Entry Position -> Moisture
  // by Entry Position -> Average Dry Yield by Brand.
  const boxIdx = allText.findIndex((t) => t.includes("Dry Yield Distribution:"));
  const yieldPosIdx = allText.findIndex((t) => t.includes("Yield by Entry Position:"));
  const moisturePosIdx = allText.findIndex((t) => t.includes("Moisture by Entry Position:"));
  const brandIdx = allText.findIndex((t) => t.includes("Average Dry Yield by Brand:"));
  check(
    boxIdx !== -1 && boxIdx < yieldPosIdx && yieldPosIdx < moisturePosIdx && moisturePosIdx < brandIdx,
    `sections drawn in order: box plot -> yield-by-position -> moisture-by-position -> brand averages (indices ${JSON.stringify({ boxIdx, yieldPosIdx, moisturePosIdx, brandIdx })})`
  );

  // 9 bars each (10 entries, 1 null each) — identified by their fixed
  // colors (Midwest gold for yield, NC+ blue for moisture), per explicit
  // request that both are now fixed across all 3 Brand Views instead of
  // following the active brand's own accent the way the box-and-whisker
  // chart still does.
  const yieldBars = calls.rect.filter((r) => r.style === "F" && JSON.stringify(r.fill) === "[254,190,16]");
  check(yieldBars.length === 9, `9 yield-by-position bars drawn (fixed Midwest gold fill), skipping the 1 null entry (got ${yieldBars.length})`);

  const moistureBars = calls.rect.filter((r) => r.style === "F" && JSON.stringify(r.fill) === "[33,90,168]");
  check(moistureBars.length === 9, `9 moisture-by-position bars drawn (fixed NC+ blue fill), skipping the 1 null entry (got ${moistureBars.length})`);

  // Bars are in PLOT POSITION order, not rank: the entry at position 3
  // (index 2 among non-null yield bars, since position 4 is null) has the
  // plot's highest yield (240) and should be the tallest bar; position 2
  // (index 1) has the plot's lowest non-null yield (150) and should be
  // the shortest.
  const heightsInOrder = yieldBars.slice().sort((a, b) => a.x - b.x).map((r) => r.h);
  const maxH = Math.max(...heightsInOrder);
  const minH = Math.min(...heightsInOrder);
  check(heightsInOrder.indexOf(maxH) === 2, `tallest yield-by-position bar is plot position 3 (240 bu/ac) (heights=${JSON.stringify(heightsInOrder)})`);
  check(heightsInOrder.indexOf(minH) === 1, `shortest yield-by-position bar is plot position 2 (150 bu/ac) (heights=${JSON.stringify(heightsInOrder)})`);

  // Side by side: the moisture chart's bars must sit entirely to the
  // RIGHT of the yield chart's bars (non-overlapping columns), and both
  // charts' baselines (the bottom of every bar, y + h) must land on the
  // same row — confirming they share one horizontal row instead of being
  // stacked vertically.
  const yieldMaxX = Math.max(...yieldBars.map((r) => r.x + r.w));
  const moistureMinX = Math.min(...moistureBars.map((r) => r.x));
  check(moistureMinX >= yieldMaxX, `moisture chart's bars sit to the right of the yield chart's bars, side by side (yieldMaxX=${yieldMaxX.toFixed(1)}, moistureMinX=${moistureMinX.toFixed(1)})`);

  const yieldBaseline = yieldBars[0].y + yieldBars[0].h;
  const moistureBaseline = moistureBars[0].y + moistureBars[0].h;
  check(Math.abs(yieldBaseline - moistureBaseline) < 0.5, `both charts share the same baseline row (yieldBaseline=${yieldBaseline.toFixed(1)}, moistureBaseline=${moistureBaseline.toFixed(1)})`);

  // Captions.
  check(allText.some((t) => t.includes("Low 150.0") && t.includes("High 240.0")), `yield-by-position caption shows correct low/high`);
  check(allText.some((t) => t.includes("Low 15.0") && t.includes("High 22.5")), `moisture-by-position caption shows correct low/high`);

  // Position-number labels: every one of the 10 entries gets its own
  // label below its bar (or below its empty x-slot, for the 1 null
  // entry each chart has) — no thinning, even though 10 would have been
  // thinned under the old maxLabels rule. Both charts' labels sit on the
  // same row (labelY = shared baseline + 8); distinguish yield's labels
  // from moisture's by x position (left column vs. right column).
  const labelY = yieldBaseline + 8;
  const midX = (yieldMaxX + moistureMinX) / 2;
  const positionLabels = calls.text.filter(
    (t) => Math.abs(t.y - labelY) < 0.5 && t.opts && t.opts.align === "center" && /^\d+$/.test(t.str)
  );
  const yieldLabels = positionLabels.filter((t) => t.x < midX);
  const moistureLabels = positionLabels.filter((t) => t.x >= midX);
  check(yieldLabels.length === 10, `all 10 position labels drawn under the yield-by-position chart, no thinning (got ${yieldLabels.length})`);
  check(moistureLabels.length === 10, `all 10 position labels drawn under the moisture-by-position chart, no thinning (got ${moistureLabels.length})`);

  // Spacing: a bit more room between the position-label row and the
  // Low/High caption below it than before (was a 6pt gap, now 12pt).
  const yieldCaptionCall = calls.text.find((t) => t.str.includes("Low 150.0"));
  check(!!yieldCaptionCall && Math.abs(yieldCaptionCall.y - labelY - 12) < 0.01, `more vertical space between the position-label row and the Low/High caption (labelY=${labelY}, captionY=${yieldCaptionCall && yieldCaptionCall.y}, gap=${yieldCaptionCall ? (yieldCaptionCall.y - labelY).toFixed(1) : "?"})`);

  // Centering: the box plot's own "Min ... Max ..." caption and both
  // Low/High captions are now center-aligned under their chart, not
  // left-justified at the margin.
  const boxCaptionCall = calls.text.find((t) => t.str.includes("Min 150.0"));
  const moistureCaptionCall = calls.text.find((t) => t.str.includes("Low 15.0"));
  check(boxCaptionCall && boxCaptionCall.opts && boxCaptionCall.opts.align === "center", `box-and-whisker "Min/Q1/Median/Q3/Max" caption is center-aligned, not left-justified`);
  check(yieldCaptionCall && yieldCaptionCall.opts && yieldCaptionCall.opts.align === "center", `yield-by-position "Low/High" caption is center-aligned, not left-justified`);
  check(moistureCaptionCall && moistureCaptionCall.opts && moistureCaptionCall.opts.align === "center", `moisture-by-position "Low/High" caption is center-aligned, not left-justified`);

  await page.close();
}

// ---- NC+ and Crow's: both fixed colors hold regardless of the active brand ----
for (const [brandId, brandName] of [
  ["ncPlus", "NC+ Hybrids"],
  ["crows", "Republic Shield Crow's Genetics"],
]) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  const calls = await buildPdfCalls(page, brandId, brandName);

  const yieldBars = calls.rect.filter((r) => r.style === "F" && JSON.stringify(r.fill) === "[254,190,16]");
  check(yieldBars.length === 9, `${brandId}'s yield-by-position bars are still the fixed Midwest gold, unaffected by brand (got ${yieldBars.length} matching rects)`);

  // On NC+ specifically, the box-and-whisker's own IQR fill ALSO uses
  // this same blue (that's the whole point of its chrome-blue override —
  // see boxAccentRgb()), so exclude the one wide IQR-box rect by width
  // to count only the 9 narrow per-entry moisture bars.
  const moistureBars = calls.rect.filter((r) => r.style === "F" && JSON.stringify(r.fill) === "[33,90,168]" && r.w < 100);
  check(moistureBars.length === 9, `${brandId}'s moisture-by-position bars are still the fixed NC+ blue, unaffected by brand (got ${moistureBars.length} matching rects)`);

  await page.close();
}

// ---- No Brand View selected: both boxes still render ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  const calls = await buildPdfCalls(page, null, "");

  const allText = calls.text.map((t) => t.str);
  check(allText.some((t) => t.includes("Yield by Entry Position:")), `no-Brand-View PDF still includes "Yield by Entry Position:"`);
  check(allText.some((t) => t.includes("Moisture by Entry Position:")), `no-Brand-View PDF still includes "Moisture by Entry Position:"`);

  const yieldBars = calls.rect.filter((r) => r.style === "F" && JSON.stringify(r.fill) === "[254,190,16]");
  check(yieldBars.length === 9, `no-Brand-View still uses the fixed Midwest gold for yield-by-position bars (got ${yieldBars.length})`);

  const moistureBars = calls.rect.filter((r) => r.style === "F" && JSON.stringify(r.fill) === "[33,90,168]");
  check(moistureBars.length === 9, `no-Brand-View still uses the fixed NC+ blue for moisture-by-position bars (got ${moistureBars.length})`);

  await page.close();
}

// ---- Empty plot: no crash, both boxes render a "No data yet." caption instead of bars ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  const calls = await page.evaluate(async () => {
    const calls = { text: [], rect: [] };
    function FakeJsPDF() {
      return {
        setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {},
        saveGraphicsState() {}, restoreGraphicsState() {}, setGState() {}, GState(opts) { return opts; },
        splitTextToSize: (t) => [t],
        getTextWidth: (t) => String(t).length * 5,
        getImageProperties: () => ({ width: 100, height: 40 }),
        addImage() {},
        text(str) { calls.text.push(String(str)); },
        circle() {},
        rect(x, y, w, h, style) { calls.rect.push({ x, y, w, h, style }); },
        line() {},
        addPage() {},
        output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
      };
    }
    window.jspdf = { jsPDF: FakeJsPDF };
    const { buildPdf } = await import("/js/core/pdfBuilder.js");
    const { getBrand } = await import("/js/ui/brand.js");
    const header = { cooperatorName: "Empty Plot", state: "IA", county: "", year: "2026" };
    await buildPdf({ header, results: [], metric: "dryYield", allEntries: [], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null });
    return calls;
  });
  // With no entries, summary.boxPlot is null (dryYieldSummary needs at
  // least one dry-yield value), so none of the three chart boxes should
  // draw at all — same "no data yet" branch the screen already has.
  check(!calls.text.some((t) => t.includes("Yield by Entry Position:")), `empty plot: no "Yield by Entry Position:" box drawn (no data at all)`);
  check(!calls.text.some((t) => t.includes("Moisture by Entry Position:")), `empty plot: no "Moisture by Entry Position:" box drawn (no data at all)`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
