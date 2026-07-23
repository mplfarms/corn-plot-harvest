// Verifies the box-plot color change: NC+'s IQR box now uses NC+'s
// chrome blue (#215AA8 -> rgb(33,90,168)) instead of its red accent, in
// both the Plot Summary screen (SVG) and the PDF export, while the
// median line/mean marker and Midwest's box are unaffected — and the
// existing translucency level (fill-opacity 0.22 on screen, 0.35 in the
// PDF) is unchanged.
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
// Skewed so mean != median -> the mean marker actually renders too.
const YIELDS = [150, 160, 170, 180, 190, 200, 210, 220, 230, 280];

async function seedAndOpenSummary(page, selectedBrand, brandName) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(
    ({ selectedBrand, brandName, yields }) => {
      localStorage.clear();
      localStorage.setItem("cph.selectedBrand", JSON.stringify(selectedBrand));
      localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
      const entries = yields.map((y, i) => ({
        id: `e${i}`, brand: brandName, hybrid: `H${i}`, trait: "", relativeMaturity: "100", seedTreatment: "",
        sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
        widthInches: "", comments: "", manualDryYield: String(y),
      }));
      localStorage.setItem(
        "cph.draftTrial",
        JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries })
      );
    },
    { selectedBrand, brandName, yields: YIELDS }
  );
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- Screen (SVG): NC+ ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "ncPlus", "NC+ Hybrids");

  const boxFill = await page.$eval(".box-plot-box", (el) => getComputedStyle(el).fill);
  check(boxFill === "rgb(33, 90, 168)", `NC+'s box fill is chrome blue on screen (got "${boxFill}")`);
  const boxStroke = await page.$eval(".box-plot-box", (el) => getComputedStyle(el).stroke);
  check(boxStroke === "rgb(33, 90, 168)", `NC+'s box stroke is chrome blue on screen (got "${boxStroke}")`);
  const boxOpacity = await page.$eval(".box-plot-box", (el) => getComputedStyle(el).fillOpacity);
  check(boxOpacity === "0.22", `NC+'s box keeps the existing 0.22 fill-opacity (got "${boxOpacity}")`);

  const medianStroke = await page.$eval(".box-plot-median", (el) => getComputedStyle(el).stroke);
  check(medianStroke === "rgb(215, 40, 47)", `NC+'s median line stays on the red accent, unaffected (got "${medianStroke}")`);

  await page.close();
}

// ---- Screen (SVG): Midwest unaffected ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "midwestSeedGenetics", "Midwest Seed Genetics");

  const boxFill = await page.$eval(".box-plot-box", (el) => getComputedStyle(el).fill);
  check(boxFill === "rgb(9, 69, 44)", `Midwest's box fill is unchanged (still its green accent) (got "${boxFill}")`);
  const boxOpacity = await page.$eval(".box-plot-box", (el) => getComputedStyle(el).fillOpacity);
  check(boxOpacity === "0.22", `Midwest's box fill-opacity is unchanged (got "${boxOpacity}")`);

  await page.close();
}

// ---- PDF export: NC+ box is blue, median/mean stay red, opacity unchanged ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpenSummary(page, "ncPlus", "NC+ Hybrids");

  const pdfCalls = await page.evaluate(async (yields) => {
    const calls = { rect: [], circle: [], line: [], fillColor: [], drawColor: [], gstate: [] };
    function FakeJsPDF() {
      return {
        setFont() {}, setFontSize() {}, setTextColor() {}, setLineWidth() {},
        setFillColor(r, g, b) { calls.fillColor.push([r, g, b]); },
        setDrawColor(r, g, b) { calls.drawColor.push([r, g, b]); },
        saveGraphicsState() {}, restoreGraphicsState() {},
        setGState(gs) { calls.gstate.push(gs); },
        GState(opts) { return opts; },
        splitTextToSize: (t) => [t],
        getTextWidth: (t) => String(t).length * 5,
        getImageProperties: () => ({ width: 100, height: 40 }),
        addImage() {},
        text() {},
        circle(x, y, r, style) { calls.circle.push({ x, y, r, style, fill: calls.fillColor[calls.fillColor.length - 1], draw: calls.drawColor[calls.drawColor.length - 1] }); },
        rect(x, y, w, h, style) { calls.rect.push({ x, y, w, h, style, fill: calls.fillColor[calls.fillColor.length - 1], draw: calls.drawColor[calls.drawColor.length - 1] }); },
        line(x1, y1, x2, y2) { calls.line.push({ x1, y1, x2, y2, draw: calls.drawColor[calls.drawColor.length - 1] }); },
        addPage() {},
        output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
      };
    }
    window.jspdf = { jsPDF: FakeJsPDF };
    const { buildPdf } = await import("/js/core/pdfBuilder.js");
    const { getBrand } = await import("/js/ui/brand.js");
    const entries = yields.map((y, i) => ({
      id: `e${i}`, brand: "NC+ Hybrids", hybrid: `H${i}`, trait: "", relativeMaturity: "100",
      manualDryYield: String(y), sampleNetWeightLbs: "", moisturePercent: "", testWeight: "",
      stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "",
    }));
    const results = entries.map((entry, idx) => ({ originalNumber: idx + 1, entry, value: Number(entry.manualDryYield) }));
    results.sort((a, b) => b.value - a.value);
    const header = { cooperatorName: "Test Coop", state: "IA", county: "", year: "2026" };
    await buildPdf({ header, results, metric: "dryYield", allEntries: entries, brand: getBrand("ncPlus"), logoDataUrl: null });
    return calls;
  }, YIELDS);

  const boxFillRect = pdfCalls.rect.find((r) => r.style === "F");
  check(!!boxFillRect && JSON.stringify(boxFillRect.fill) === "[33,90,168]", `PDF box fill color is NC+ chrome blue (got ${JSON.stringify(boxFillRect && boxFillRect.fill)})`);
  const boxBorderRect = pdfCalls.rect.find((r) => r.style === "D");
  check(!!boxBorderRect && JSON.stringify(boxBorderRect.draw) === "[33,90,168]", `PDF box border color is NC+ chrome blue (got ${JSON.stringify(boxBorderRect && boxBorderRect.draw)})`);
  check(
    pdfCalls.gstate.some((gs) => gs.opacity === 0.35),
    `PDF box fill opacity is unchanged at 0.35 (got ${JSON.stringify(pdfCalls.gstate)})`
  );

  // Median line: the one non-whisker/non-cap line with a non-gray, non-blue draw color.
  const medianLine = pdfCalls.line.find((l) => l.draw && JSON.stringify(l.draw) !== "[150,150,150]" && l.x1 === l.x2);
  check(!!medianLine && JSON.stringify(medianLine.draw) === "[215,40,47]", `PDF median line stays on NC+'s red accent (got ${JSON.stringify(medianLine && medianLine.draw)})`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
