// Verifies the "Include Plot Details" compact header block (see
// drawPlotDetailsHeader() in pdfBuilder.js) now lays its "Label: value"
// pairs out in 3 COLUMNS instead of 2 — per explicit request, to pack
// more fields into fewer rows and take up less page space.
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

async function buildCalls(includePlotDetails) {
  return page.evaluate(async (includePlotDetails) => {
    const calls = { text: [], line: [] };
    function FakeJsPDF() {
      return {
        setFont() {}, setFontSize() {}, setTextColor() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {},
        saveGraphicsState() {}, restoreGraphicsState() {}, setGState() {}, GState(opts) { return opts; },
        splitTextToSize: (t) => [t],
        getTextWidth: (t) => String(t).length * 5,
        getImageProperties: () => ({ width: 100, height: 40 }),
        addImage() {},
        text(str, x, y) { calls.text.push({ str: String(str), x, y }); },
        circle() {}, rect() {}, line(x1, y1, x2, y2) { calls.line.push({ x1, y1, x2, y2 }); }, addPage() {},
        output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
      };
    }
    window.jspdf = { jsPDF: FakeJsPDF };
    const { buildPdf } = await import("/js/core/pdfBuilder.js");
    const { getBrand } = await import("/js/ui/brand.js");
    // 4 fields, in plotDetailsFields()'s own order (Cooperator, Cooperator
    // Address, City, County) — the first 3 should share row 1 (3 columns),
    // the 4th should wrap to row 2. With the OLD 2-column layout, the 3rd
    // field would already have wrapped to row 2 instead.
    const header = {
      cooperatorName: "Test Coop",
      address: "123 Farm Rd",
      city: "Ames",
      county: "Story",
      state: "IA",
      year: "2026",
    };
    const testEntry = {
      id: "e1", brand: "Midwest Seed Genetics", hybrid: "H1", trait: "", relativeMaturity: "100",
      manualDryYield: "200", sampleNetWeightLbs: "", moisturePercent: "", testWeight: "",
      stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "",
    };
    const results = [{ originalNumber: 1, entry: testEntry, value: 200 }];
    await buildPdf({ header, results, metric: "dryYield", allEntries: [testEntry], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null, includePlotDetails });
    return calls;
  }, includePlotDetails);
}

const calls = await buildCalls(true);

function labelCall(prefix) {
  return calls.text.find((t) => t.str === `${prefix}: `);
}

const cooperator = labelCall("Cooperator");
const address = labelCall("Cooperator Address");
const city = labelCall("City");
const county = labelCall("County");

check(!!cooperator && !!address && !!city && !!county, "all 4 expected \"Label: \" fields were drawn");

if (cooperator && address && city) {
  check(
    Math.abs(cooperator.y - address.y) < 0.01 && Math.abs(cooperator.y - city.y) < 0.01,
    `first 3 fields (Cooperator, Cooperator Address, City) share row 1 — confirms 3 columns, not 2 (y values: ${cooperator.y}, ${address.y}, ${city.y})`
  );
  check(
    address.x > cooperator.x && city.x > address.x,
    `fields advance left-to-right across 3 distinct x positions (x values: ${cooperator.x}, ${address.x}, ${city.x})`
  );
}

if (cooperator && county) {
  check(county.y > cooperator.y, `4th field (County) wraps to row 2 (Cooperator y=${cooperator.y}, County y=${county.y})`);
  check(Math.abs(county.x - cooperator.x) < 0.01, `row 2 restarts at column 1's x position (Cooperator x=${cooperator.x}, County x=${county.x})`);
}

// ---- Gray header anchor line always prints — with AND without plot
// details (it used to be drawn only by the details block, so a PDF
// exported without "Include Plot Details" had no line under its
// header). MARGIN=36, tableWidth=540, so the full-width line spans
// x 36 -> 576; "above the header's end" means above the Trial Summary
// title that follows it, and there must be exactly ONE such line (the
// details block must not stack a second one on top).
function headerAnchorLines(runCalls) {
  const trialSummary = runCalls.text.find((t) => t.str.startsWith("Trial Summary"));
  if (!trialSummary) return null;
  return runCalls.line.filter(
    (l) => l.y1 === l.y2 && Math.abs(l.x1 - 36) < 0.01 && Math.abs(l.x2 - 576) < 0.01 && l.y1 < trialSummary.y
  );
}

const withDetailsAnchors = headerAnchorLines(calls);
check(
  withDetailsAnchors !== null && withDetailsAnchors.length === 1,
  `WITH plot details: exactly 1 gray header anchor line above the summary — moved into the header, not doubled (got ${withDetailsAnchors === null ? "no Trial Summary text" : withDetailsAnchors.length})`
);

const noDetailsCalls = await buildCalls(false);
const noDetailsAnchors = headerAnchorLines(noDetailsCalls);
check(
  noDetailsAnchors !== null && noDetailsAnchors.length === 1,
  `WITHOUT plot details: the header anchor line now prints too (got ${noDetailsAnchors === null ? "no Trial Summary text" : noDetailsAnchors.length})`
);
check(
  !noDetailsCalls.text.some((t) => t.str === "Plot Details"),
  `WITHOUT plot details: the "Plot Details" block itself still correctly absent`
);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
