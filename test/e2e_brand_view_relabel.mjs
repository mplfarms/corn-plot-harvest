// Verifies the new Brand View relabeling rule on Plot Summary + PDF
// export: whichever brand (Midwest Seed Genetics or NC+) is the selected
// Brand View, entries belonging to the *other* of those two brands
// display (and average) under the selected brand's name instead. A
// third-party brand ("Crow's") must never be touched. Plot Entries
// editing / the XLSX export must keep entries' real, unrelabeled brand.
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

// 2 Midwest entries, 2 NC+ Hybrids entries, 1 third-party (Crow's) entry.
const ENTRIES = [
  entry("e1", "Midwest Seed Genetics", 200),
  entry("e2", "Midwest Seed Genetics", 210),
  entry("e3", "NC+ Hybrids", 190),
  entry("e4", "NC+ Hybrids", 220),
  entry("e5", "Crow's", 205),
];

async function seed(page, selectedBrand) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(
    ({ selectedBrand, entries }) => {
      localStorage.clear();
      localStorage.setItem("cph.selectedBrand", JSON.stringify(selectedBrand));
      localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
      localStorage.setItem(
        "cph.draftTrial",
        JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries })
      );
    },
    { selectedBrand, entries: ENTRIES }
  );
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- Case 1: Midwest Seed Genetics is the selected Brand View ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seed(page, "midwestSeedGenetics");
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  const rowTitles = await page.$$eval(".ranked-row-title", (els) => els.map((el) => el.textContent));
  check(
    rowTitles.every((t) => !t.includes("NC+ Hybrids")),
    `no ranked row still shows "NC+ Hybrids" when Midwest is the selected Brand View (got ${JSON.stringify(rowTitles)})`
  );
  check(
    rowTitles.filter((t) => t.includes("Midwest Seed Genetics")).length === 4,
    `4 ranked rows (2 real Midwest + 2 relabeled NC+) now show "Midwest Seed Genetics" (got ${JSON.stringify(rowTitles)})`
  );
  check(
    rowTitles.some((t) => t.includes("Crow's")),
    "the third-party brand (Crow's) is untouched"
  );

  const brandAverages = await page.$$eval(".brand-average-block", (els) =>
    els.map((el) => el.querySelector(".brand-average-name").textContent + " " + el.querySelector(".brand-average-value").textContent)
  );
  console.log("Brand averages (Midwest view):", brandAverages);
  check(
    !brandAverages.some((t) => t.includes("NC+")),
    `"Average By Brand" no longer lists a separate NC+ entry (got ${JSON.stringify(brandAverages)})`
  );
  const midwestLine = brandAverages.find((t) => t.startsWith("Midwest Seed Genetics"));
  check(!!midwestLine && midwestLine.includes("n=4"), `Midwest's combined average now covers all 4 entries (n=4) (got "${midwestLine}")`);
  // (200+210+190+220)/4 = 205.0
  check(!!midwestLine && midwestLine.includes("205.0"), `Midwest's combined average value is correct (got "${midwestLine}")`);

  // Underlying trial data must remain unrelabeled (Plot Entries / XLSX source of truth).
  const storedBrands = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).entries.map((e) => e.brand));
  check(
    storedBrands.includes("NC+ Hybrids") && storedBrands.filter((b) => b === "Midwest Seed Genetics").length === 2,
    `stored trial data keeps entries' real brand untouched (got ${JSON.stringify(storedBrands)})`
  );

  await page.close();
}

// ---- Case 2 (mirror): NC+ is the selected Brand View ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seed(page, "ncPlus");
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  const rowTitles = await page.$$eval(".ranked-row-title", (els) => els.map((el) => el.textContent));
  check(
    rowTitles.every((t) => !t.includes("Midwest Seed Genetics")),
    `no ranked row still shows "Midwest Seed Genetics" when NC+ is the selected Brand View (got ${JSON.stringify(rowTitles)})`
  );
  check(
    rowTitles.filter((t) => t.includes("NC+ Hybrids")).length === 4,
    `4 ranked rows (2 real NC+ + 2 relabeled Midwest) now show "NC+ Hybrids" (got ${JSON.stringify(rowTitles)})`
  );
  check(
    rowTitles.some((t) => t.includes("Crow's")),
    "the third-party brand (Crow's) is untouched (mirror case)"
  );

  const brandAverages = await page.$$eval(".brand-average-block", (els) =>
    els.map((el) => el.querySelector(".brand-average-name").textContent + " " + el.querySelector(".brand-average-value").textContent)
  );
  console.log("Brand averages (NC+ view):", brandAverages);
  check(
    !brandAverages.some((t) => t.startsWith("Midwest Seed Genetics")),
    `"Average By Brand" no longer lists a separate Midwest entry (got ${JSON.stringify(brandAverages)})`
  );
  const ncLine = brandAverages.find((t) => t.startsWith("NC+ Hybrids"));
  check(!!ncLine && ncLine.includes("n=4") && ncLine.includes("205.0"), `NC+'s combined average is correct and covers n=4 (got "${ncLine}")`);

  // ---- PDF export mirrors the same relabeling (mocked jsPDF) ----
  const pdfCalls = await page.evaluate(async (rawEntries) => {
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
    const { getBrand, entriesForBrandView } = await import("/js/ui/brand.js");
    const brand = getBrand("ncPlus");
    const displayEntries = entriesForBrandView(rawEntries, brand);
    const results = displayEntries
      .map((entry, idx) => ({ originalNumber: idx + 1, entry, value: Number(entry.manualDryYield) }))
      .sort((a, b) => b.value - a.value);
    const header = { cooperatorName: "Test Coop", state: "IA", county: "", year: "2026" };
    await buildPdf({ header, results, metric: "dryYield", allEntries: displayEntries, brand, logoDataUrl: null });
    return calls;
  }, ENTRIES);
  check(
    pdfCalls.text.some((t) => t.includes("NC+ Hybrids:") && t.includes("(n=4)")),
    `PDF's brand-average section shows the combined n=4 NC+ Hybrids average (got ${JSON.stringify(pdfCalls.text.filter((t) => t.includes("bu/ac (n=")))})`
  );
  check(
    !pdfCalls.text.some((t) => t.startsWith("Midwest Seed Genetics:")),
    "PDF no longer lists a separate Midwest Seed Genetics brand-average line"
  );

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
