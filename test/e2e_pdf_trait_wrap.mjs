// Verifies the results table's Trait cell overflow handling in
// pdfBuilder.js — per explicit request: a long trait name (e.g.
// "Drought Gard VT2PRO RIB") used to overflow the 83pt Trait column and
// run into the Moisture % value next to it; now, when a trait doesn't
// fit its column at the normal 10pt size, it drops to a smaller font
// (7.5pt) and wraps onto up to 2 lines inside the same row. A trait
// that DOES fit keeps the exact same single-line 10pt treatment as
// every other cell.
//
// Unlike the other PDF test mocks (which stub splitTextToSize as
// (t) => [t] and getTextWidth as len*5), this mock makes both honor the
// CURRENT font size (charWidth = fontSize / 2 — identical to len*5 at
// the default 10pt, so the same arithmetic the other mocks use), so the
// shrink-then-wrap path actually produces 2 lines here the way real
// jsPDF font metrics would.
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

const calls = await page.evaluate(async () => {
  const calls = { text: [] };
  let fontSize = 10;
  const charW = () => fontSize / 2;
  function FakeJsPDF() {
    return {
      setFont() {}, setTextColor() {}, setFillColor() {}, setDrawColor() {}, setLineWidth() {},
      setFontSize(s) { fontSize = s; },
      saveGraphicsState() {}, restoreGraphicsState() {}, setGState() {}, GState(opts) { return opts; },
      getTextWidth: (t) => String(t).length * charW(),
      // Greedy word-wrap using the same per-character width as
      // getTextWidth, like real jsPDF's splitTextToSize.
      splitTextToSize(t, maxW) {
        const words = String(t).split(" ");
        const lines = [];
        let line = "";
        for (const w of words) {
          const candidate = line ? `${line} ${w}` : w;
          if (candidate.length * charW() <= maxW || !line) line = candidate;
          else { lines.push(line); line = w; }
        }
        if (line) lines.push(line);
        return lines;
      },
      getImageProperties: () => ({ width: 100, height: 40 }),
      addImage() {},
      text(str, x, y, opts) { calls.text.push({ str: String(str), x, y, opts, fontSize }); },
      circle() {}, rect() {}, line() {}, addPage() {},
      output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
    };
  }
  window.jspdf = { jsPDF: FakeJsPDF };
  const { buildPdf } = await import("/js/core/pdfBuilder.js");
  const { getBrand } = await import("/js/ui/brand.js");
  const baseEntry = {
    relativeMaturity: "100", sampleNetWeightLbs: "", testWeight: "",
    stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "",
  };
  // Entry 1: short trait "VT2Pro RIB" (10 chars * 5pt = 50 <= 77 avail)
  // fits at 10pt. Entry 2: long trait "Drought Gard VT2PRO RIB"
  // (23 chars * 5pt = 115 > 77) triggers shrink+wrap; at 7.5pt
  // (charW 3.75) it wraps to "Drought Gard VT2PRO" (71.25) + "RIB".
  // The LONG-trait row comes FIRST so the short-trait row after it can
  // prove the font size gets restored to 10pt once a wrapped trait is
  // done shrinking it.
  const e1 = { ...baseEntry, id: "e1", brand: "Midwest Seed Genetics", hybrid: "11-30 TRERIB", trait: "VT2Pro RIB", manualDryYield: "239.8", moisturePercent: "16.9" };
  const e2 = { ...baseEntry, id: "e2", brand: "Midwest Seed Genetics", hybrid: "12-48 DGVT2PRIB", trait: "Drought Gard VT2PRO RIB", manualDryYield: "240", moisturePercent: "17.6" };
  const results = [
    { originalNumber: 2, entry: e2, value: 240 },
    { originalNumber: 1, entry: e1, value: 239.8 },
  ];
  const header = { cooperatorName: "Test Coop", state: "IA", county: "", year: "2026" };
  await buildPdf({ header, results, metric: "dryYield", allEntries: [e1, e2], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null });
  return calls;
});

const shortTrait = calls.text.find((t) => t.str === "VT2Pro RIB");
const shortHybrid = calls.text.find((t) => t.str === "11-30 TRERIB");
const longLine1 = calls.text.find((t) => t.str === "Drought Gard VT2PRO");
const longLine2 = calls.text.filter((t) => t.str === "RIB");
const longHybrid = calls.text.find((t) => t.str === "12-48 DGVT2PRIB");
const longFull = calls.text.find((t) => t.str === "Drought Gard VT2PRO RIB");

check(!!shortTrait, `short trait still drawn as one whole line (found "VT2Pro RIB")`);
check(shortTrait && shortTrait.fontSize === 10, `short trait keeps the normal 10pt font (got ${shortTrait && shortTrait.fontSize}pt)`);
check(
  shortTrait && shortHybrid && Math.abs(shortTrait.y - shortHybrid.y) < 0.01,
  `short trait sits on the same baseline as its row's other cells (trait y=${shortTrait && shortTrait.y}, hybrid y=${shortHybrid && shortHybrid.y})`
);

check(!longFull, "long trait is NOT drawn as a single overflowing line anymore");
check(!!longLine1 && longLine2.length === 1, `long trait wraps to 2 lines ("Drought Gard VT2PRO" + "RIB") (line2 matches: ${longLine2.length})`);
check(longLine1 && longLine1.fontSize === 7.5, `wrapped trait uses the smaller 7.5pt font (got ${longLine1 && longLine1.fontSize}pt)`);
if (longLine1 && longLine2.length === 1) {
  const l2 = longLine2[0];
  check(l2.fontSize === 7.5, `wrapped trait's 2nd line also uses 7.5pt (got ${l2.fontSize}pt)`);
  check(Math.abs(l2.x - longLine1.x) < 0.01, `both wrapped lines start at the Trait column's x (line1 x=${longLine1.x}, line2 x=${l2.x})`);
  check(Math.abs(l2.y - longLine1.y - 8) < 0.01, `2nd line sits 8pt below the 1st, inside the same 18pt row (line1 y=${longLine1.y}, line2 y=${l2.y})`);
  if (longHybrid) {
    check(l2.y < longHybrid.y + 10, `wrapped lines stay within their own row (line2 y=${l2.y}, row baseline y=${longHybrid.y})`);
  }
}

// The wrapped trait's widest line must actually FIT the trait column
// now: at 7.5pt, "Drought Gard VT2PRO" is 19 * 3.75 = 71.25pt, inside
// the 77pt available width — so nothing reaches the Moisture column.
if (longLine1 && longHybrid) {
  const moistureCell = calls.text.find((t) => t.str === "17.6%");
  check(!!moistureCell, "long-trait row's moisture % value is still drawn");
  if (moistureCell) {
    const line1Width = longLine1.str.length * 3.75;
    check(
      longLine1.x + line1Width <= moistureCell.x,
      `wrapped trait's widest line ends before the Moisture column starts (trait right edge=${(longLine1.x + line1Width).toFixed(1)}, moisture x=${moistureCell.x})`
    );
  }
}

// The trait cell is the LAST thing drawn in its row, so the next row's
// cells (the short-trait row, drawn after the wrapped one) must be back
// at 10pt — confirming the shrink is restored and can't bleed into the
// rest of the table.
check(
  shortHybrid && shortHybrid.fontSize === 10,
  `font size is restored to 10pt for the row after a wrapped trait (next row's hybrid cell got ${shortHybrid && shortHybrid.fontSize}pt)`
);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
