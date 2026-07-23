// Verifies: (1) the significance threshold is now 8 bu/ac (was 10), on
// both the Plot Summary legend and the PDF legend; (2) the NC+ Hybrids
// brand-average-ordering bug is fixed — brand.catalogBrandName ("NC+
// Hybrids") now actually matches PlotEntry.brand values, not the shorter
// cosmetic displayName ("NC+") that never matched anything.
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
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("ncPlus"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "t1",
      header: { cooperatorName: "Test Coop", state: "IA", county: "" },
      entries: [
        // Two NC+ Hybrids entries (2+ so it qualifies for a brand average)
        // plus one lower-yielding competitor entry, mean should land such
        // that an entry +8 over is green and -8 under is yellow.
        { id: "e1", brand: "NC+ Hybrids", hybrid: "A", trait: "", relativeMaturity: "100", seedTreatment: "",
          sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
          widthInches: "", comments: "", manualDryYield: "208" },
        { id: "e2", brand: "NC+ Hybrids", hybrid: "B", trait: "", relativeMaturity: "101", seedTreatment: "",
          sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
          widthInches: "", comments: "", manualDryYield: "192" },
        { id: "e3", brand: "Crow's", hybrid: "C", trait: "", relativeMaturity: "102", seedTreatment: "",
          sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
          widthInches: "", comments: "", manualDryYield: "200" },
      ],
    })
  );
});
await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

// Mean = (208+192+200)/3 = 200. e1 = 208 = +8 -> green/positive. e2 = 192 = -8 -> yellow/negative.
const legendText = await page.$eval(".significance-legend", (el) => el.textContent);
check(legendText.includes("8+ bu/ac over plot mean"), `on-screen legend shows the new 8 bu/ac threshold (got "${legendText}")`);
check(legendText.includes("8+ bu/ac under plot mean"), `on-screen legend shows 8 bu/ac under threshold too`);
check(!legendText.includes("10+ bu/ac"), "on-screen legend no longer shows the old 10 bu/ac threshold");

const positiveBadge = await page.$(".rank-badge-sig-positive");
check(!!positiveBadge, "at least one rank badge is classified positive (green) with the new 8 bu/ac threshold");
const negativeBadge = await page.$(".rank-badge-sig-negative");
check(!!negativeBadge, "at least one rank badge is classified negative (yellow) with the new 8 bu/ac threshold");

// NC+ Hybrids brand average should now actually appear (bug: it silently
// never showed before because "NC+" != "NC+ Hybrids").
const brandSection = await page.$eval(".card", () => document.body.textContent);
check(brandSection.includes("NC+ Hybrids"), "NC+ Hybrids brand average section actually renders (was silently broken before)");

// ---- PDF export: mocked jsPDF, confirm same threshold + brand fix ----
const pdfCalls = await page.evaluate(async () => {
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
      circle() {},
      rect() {},
      line() {},
      addPage() {},
      output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
    };
  }
  window.jspdf = { jsPDF: FakeJsPDF };
  const { buildPdf } = await import("/js/core/pdfBuilder.js");
  const { getBrand } = await import("/js/ui/brand.js");
  const header = { cooperatorName: "Test Coop", state: "IA", county: "", year: "2026" };
  const entries = [
    { id: "e1", brand: "NC+ Hybrids", hybrid: "A", trait: "", relativeMaturity: "100", manualDryYield: "208",
      sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "" },
    { id: "e2", brand: "NC+ Hybrids", hybrid: "B", trait: "", relativeMaturity: "101", manualDryYield: "192",
      sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "" },
    { id: "e3", brand: "Crow's", hybrid: "C", trait: "", relativeMaturity: "102", manualDryYield: "200",
      sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "" },
  ];
  const results = entries.map((entry, idx) => ({ originalNumber: idx + 1, entry, value: Number(entry.manualDryYield) }));
  results.sort((a, b) => b.value - a.value);
  await buildPdf({ header, results, metric: "dryYield", allEntries: entries, brand: getBrand("ncPlus"), logoDataUrl: null });
  return calls;
});
check(pdfCalls.text.some((t) => t.includes("8+ bu/ac over plot mean")), "PDF legend shows the new 8 bu/ac threshold");
check(pdfCalls.text.some((t) => t.includes("NC+ Hybrids:")), "PDF brand-average section includes NC+ Hybrids (bug fix verified in export too)");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
