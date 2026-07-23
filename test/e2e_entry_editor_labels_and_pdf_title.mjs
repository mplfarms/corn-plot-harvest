// Verifies changes to the Hybrid Details section on the Entry Editor
// (entryEditor.js) and the PDF export's title (pdfBuilder.js):
//   1. Trait and Seed Treatment now each get their own field label above
//      their row (e.g. "TRAIT", "SEED TREATMENT"), matching Brand /
//      Company, Hybrid, and Relative Maturity (RM) — previously Seed
//      Treatment's title sat inline inside the row itself, and Trait had
//      no title at all.
//   2. None of the five rows repeat their title a second time inside the
//      row itself anymore — every row is now value + chevron only, with
//      its title shown exactly once, above.
//   3. All five rows in the section use identical vertical spacing now
//      that every one of them is wrapped in the same field() layout —
//      previously Seed Treatment (no wrapper) sat flush against its
//      neighbors while the others had normal breathing room.
//   4. The PDF export's title now starts with the year HARVESTED (not
//      planted) followed by "Corn Plot Outline".
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
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  const entry = {
    id: "e1", brand: "Midwest Seed Genetics", hybrid: "H1", trait: "VT2P", relativeMaturity: "100", seedTreatment: "Poncho",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
    widthInches: "", comments: "", manualDryYield: "",
  };
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries: [entry] })
  );
});

// entry-editor needs an entryId param, which a bare hash nav can't carry
// — go through the real entries list instead.
await page.goto(`${BASE}/index.html?r=1#/entries`);
await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
await page.click(".entry-row-main");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });

// ---- 1. Every one of the five rows has its own field label above it now ----
const fieldLabels = await page.$$eval(".field > .field-label", (els) => els.map((el) => el.textContent));
check(
  fieldLabels.slice(0, 5).join("|") === ["Brand / Company", "Hybrid", "Trait", "Seed Treatment", "Relative Maturity (RM)"].join("|"),
  `all five Hybrid Details rows have field labels above them, in order (got ${JSON.stringify(fieldLabels)})`
);

// ---- 2. No row repeats its title a second time inside itself ----
const rowLabelTexts = await page.$$eval(".wheel-row-label", (els) => els.map((el) => el.textContent));
check(rowLabelTexts.length === 0, `none of the five rows show a redundant in-row title anymore (got ${JSON.stringify(rowLabelTexts)})`);

// Values themselves are still visible even with the in-row title removed.
const rowValueTexts = await page.$$eval(".wheel-row-value", (els) => els.map((el) => el.textContent));
check(rowValueTexts.includes("Midwest Seed Genetics"), `Brand / Company's value still shows (got ${JSON.stringify(rowValueTexts)})`);
check(rowValueTexts.includes("100"), `RM's value still shows (got ${JSON.stringify(rowValueTexts)})`);
check(rowValueTexts.includes("Poncho"), `Seed Treatment's value still shows (got ${JSON.stringify(rowValueTexts)})`);

// ---- 3. Consistent spacing: every .field in the Hybrid Details card uses the same gap/margin ----
// .screen-body's first .card is Hybrid Details (identitySection) — see
// entryEditor.js's render(), which lists it before Yield Measurements/
// Comments — so this scopes to exactly its 5 rows, not the other cards'.
const fieldBoxSizes = await page.$$eval(".screen-body > .card:first-child .field", (els) =>
  els.map((el) => {
    const style = getComputedStyle(el);
    return { gap: style.rowGap || style.gap, marginBottom: style.marginBottom };
  })
);
// The very last field in the card intentionally has no bottom margin
// (see styles.css's .field:last-child) — nothing to add breathing room
// before, since the card itself ends there. Every OTHER field, including
// Seed Treatment (previously the odd one out with no margin at all),
// should match exactly.
check(
  fieldBoxSizes.length === 5 &&
    fieldBoxSizes.every((s) => s.gap === fieldBoxSizes[0].gap) &&
    fieldBoxSizes.slice(0, 4).every((s) => s.marginBottom === fieldBoxSizes[0].marginBottom && s.marginBottom !== "0px") &&
    fieldBoxSizes[4].marginBottom === "0px",
  `all five rows use identical spacing, aside from the last row's intentional zero bottom margin (got ${JSON.stringify(fieldBoxSizes)})`
);

// ---- 3. PDF title starts with the year HARVESTED, followed by "Corn Plot Outline" ----
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
      circle() {}, rect() {}, line() {}, addPage() {},
      output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
    };
  }
  window.jspdf = { jsPDF: FakeJsPDF };
  const { buildPdf } = await import("/js/core/pdfBuilder.js");
  const { getBrand } = await import("/js/ui/brand.js");
  const testEntry = {
    id: "e1", brand: "Midwest Seed Genetics", hybrid: "H1", trait: "", relativeMaturity: "100",
    manualDryYield: "200", sampleNetWeightLbs: "", moisturePercent: "", testWeight: "",
    stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: "",
  };
  const results = [{ originalNumber: 1, entry: testEntry, value: 200 }];
  // datePlanted (2025) and dateHarvested (2026) deliberately differ, so a
  // title that used the OLD planting-year source would show 2025 instead.
  const header = { cooperatorName: "Test Coop", state: "IA", county: "", datePlanted: "2025-05-01", dateHarvested: "2026-10-15" };
  await buildPdf({ header, results, metric: "dryYield", allEntries: [testEntry], brand: getBrand("midwestSeedGenetics"), logoDataUrl: null });
  return calls;
});
check(pdfCalls.text.includes("2026 Corn Plot Outline"), `PDF title starts with the harvested year, not the planted year (got ${JSON.stringify(pdfCalls.text.slice(0, 2))})`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
