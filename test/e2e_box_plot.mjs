// Verifies the new Dry Yield box-and-whisker chart: renders on Plot
// Summary just above "Average By Brand", computes correct quartiles, and
// draws the equivalent shapes in the PDF export via mocked jsPDF.
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

function entry(id, brand, yieldVal) {
  return {
    id, brand, hybrid: id, trait: "", relativeMaturity: "100", seedTreatment: "",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "",
    numberOfRows: "", widthInches: "", comments: "", manualDryYield: String(yieldVal),
  };
}

// Values chosen so quartiles are easy to hand-verify: [150,160,170,180,190,200,210,220,230,240]
const YIELDS = [150, 160, 170, 180, 190, 200, 210, 220, 230, 240];

await page.goto(`${BASE}/index.html`);
await page.evaluate((yields) => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  const entries = yields.map((y, i) => ({
    id: `e${i}`, brand: "Midwest Seed Genetics", hybrid: `H${i}`, trait: "", relativeMaturity: "100", seedTreatment: "",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
    widthInches: "", comments: "", manualDryYield: String(y),
  }));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries })
  );
}, YIELDS);

await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

const boxPlotSection = await page.$(".box-plot-section");
check(!!boxPlotSection, "box plot section renders on Plot Summary");

// Placement: box-plot-section should come before brand-average-header in DOM order.
const order = await page.evaluate(() => {
  const card = document.querySelector(".card:has(.box-plot-section)") || document.querySelector(".box-plot-section").closest(".card");
  const children = Array.from(card.children);
  const boxIdx = children.findIndex((c) => c.classList.contains("box-plot-section"));
  const brandIdx = children.findIndex((c) => c.classList.contains("brand-average-header"));
  return { boxIdx, brandIdx };
});
check(order.boxIdx !== -1 && order.brandIdx !== -1 && order.boxIdx < order.brandIdx, `box plot appears above "Average By Brand" (boxIdx=${order.boxIdx}, brandIdx=${order.brandIdx})`);

const svg = await page.$(".box-plot-svg");
check(!!svg, "box plot SVG element exists");
const rectCount = await page.$$eval(".box-plot-box", (els) => els.length);
check(rectCount === 1, `exactly one IQR box rect drawn (got ${rectCount})`);
const capCount = await page.$$eval(".box-plot-cap", (els) => els.length);
check(capCount === 2, `exactly two whisker end caps drawn (got ${capCount})`);

const caption = await page.$eval(".box-plot-caption", (el) => el.textContent);
console.log("Caption:", caption);
// n=10, sorted [150..240 step10]. Min=150, Max=240, Median=(190+200)/2=195,
// Q1 = value at pos (10-1)*0.25=2.25 -> between idx2(170) and idx3(180) = 170+0.25*10=172.5
// Q3 = pos (9)*0.75=6.75 -> between idx6(210) and idx7(220) = 210+0.75*10=217.5
check(caption.includes("Min 150.0"), `caption shows correct Min (got "${caption}")`);
check(caption.includes("Max 240.0"), `caption shows correct Max`);
check(caption.includes("Median 195.0"), `caption shows correct Median`);
check(caption.includes("Q1 172.5"), `caption shows correct Q1`);
check(caption.includes("Q3 217.5"), `caption shows correct Q3`);

// ---- PDF: mocked jsPDF, confirm box-plot shapes + caption drawn ----
const pdfCalls = await page.evaluate(async () => {
  const calls = { text: [], rect: [], circle: [], line: [], gstate: [] };
  function FakeJsPDF() {
    return {
      setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {},
      saveGraphicsState() {}, restoreGraphicsState() {},
      setGState(gs) { calls.gstate.push(gs); },
      GState(opts) { return opts; },
      splitTextToSize: (t) => [t],
      getTextWidth: (t) => String(t).length * 5,
      getImageProperties: () => ({ width: 100, height: 40 }),
      addImage() {},
      text(str) { calls.text.push(String(str)); },
      circle(x, y, r, style) { calls.circle.push({ x, y, r, style }); },
      rect(x, y, w, h, style) { calls.rect.push({ x, y, w, h, style }); },
      line(x1, y1, x2, y2) { calls.line.push({ x1, y1, x2, y2 }); },
      addPage() {},
      output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
    };
  }
  window.jspdf = { jsPDF: FakeJsPDF };
  const { buildPdf } = await import("/js/core/pdfBuilder.js");
  const { getBrand } = await import("/js/ui/brand.js");
  // Deliberately skewed (one low outlier) so mean != median — a
  // perfectly symmetric set like 150..240 gives mean === median, which
  // correctly draws no separate mean marker at all (by design).
  const yields = [80, 190, 195, 200, 205, 210, 215, 220, 225, 230];
  const entries = yields.map((y, i) => ({
    id: `e${i}`, brand: "Midwest Seed Genetics", hybrid: `H${i}`, trait: "", relativeMaturity: "100",
    manualDryYield: String(y), sampleNetWeightLbs: "", moisturePercent: "", testWeight: "",
    stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "",
  }));
  const results = entries.map((entry, idx) => ({ originalNumber: idx + 1, entry, value: Number(entry.manualDryYield) }));
  results.sort((a, b) => b.value - a.value);
  const header = { cooperatorName: "Test Coop", state: "IA", county: "", year: "2026" };
  await buildPdf({ header, results, metric: "dryYield", allEntries: entries, brand: getBrand("midwestSeedGenetics"), logoDataUrl: null });
  return calls;
});
check(pdfCalls.text.some((t) => t.includes("Dry Yield Distribution:")), "PDF includes the box plot section header");
check(pdfCalls.rect.length >= 1, `PDF draws at least one rect (the IQR box) (got ${pdfCalls.rect.length})`);
check(pdfCalls.circle.some((c) => c.style === "FD"), "PDF draws a hollow-fill circle for the mean marker");
check(pdfCalls.text.some((t) => t.includes("Min 80.0") && t.includes("Max 230.0")), `PDF caption includes correct min/max`);

// The IQR box fill is now translucent (so the quartile split around the
// median line is visible instead of being hidden inside a solid block).
check(
  pdfCalls.gstate.some((gs) => typeof gs.opacity === "number" && gs.opacity < 1),
  `PDF sets a reduced opacity graphics state for the box fill (got ${JSON.stringify(pdfCalls.gstate)})`
);
// Two rect calls for the box now: one translucent fill ("F"), one opaque
// outline ("D") drawn on top — instead of the old single solid "FD" rect.
check(
  pdfCalls.rect.some((r) => r.style === "F") && pdfCalls.rect.some((r) => r.style === "D"),
  `PDF draws the box as a separate translucent fill + opaque outline (got styles ${JSON.stringify(pdfCalls.rect.map((r) => r.style))})`
);

// Order: box plot header should appear before "Average Dry Yield by Brand:" in the text stream.
const boxIdx2 = pdfCalls.text.findIndex((t) => t.includes("Dry Yield Distribution:"));
const brandIdx2 = pdfCalls.text.findIndex((t) => t.includes("Average Dry Yield by Brand:"));
check(boxIdx2 !== -1 && brandIdx2 !== -1 && boxIdx2 < brandIdx2, `PDF box plot drawn above "Average Dry Yield by Brand:" (boxIdx=${boxIdx2}, brandIdx=${brandIdx2})`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
