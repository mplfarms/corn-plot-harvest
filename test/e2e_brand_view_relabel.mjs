// Verifies the Brand View relabeling rule on Plot Summary + PDF export:
// whichever brand (Midwest Seed Genetics, NC+, or Crow's) is the selected
// Brand View, entries belonging to either OTHER of those three rebadge
// brands display (and average) under the selected brand's name instead —
// AND (per explicit request extending Crow's into this the same way
// Midwest/NC+ already worked) the hybrid name's 2-letter brand code
// prefix ("MW "/"NC "/"CR ") swaps to match too, so "MW 09-90 PCE",
// "NC 09-90 PCE", and "CR 09-90 PCE" are all recognized as the exact same
// underlying hybrid and always display under whichever of the three is
// the current Brand View. A hybrid with no recognized prefix (hand-typed,
// no brand code) is left exactly as typed. A genuine third-party brand
// ("Dekalb", not one of the three rebadge brands) must never be touched.
// Plot Entries editing / the XLSX export must keep entries' real,
// unrelabeled brand and hybrid text.
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

function entry(id, brand, hybrid, yieldVal) {
  return {
    id, brand, hybrid, trait: "", relativeMaturity: "100", seedTreatment: "",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "",
    numberOfRows: "", widthInches: "", comments: "", manualDryYield: String(yieldVal),
  };
}

// 2 Midwest, 2 NC+, 2 Crow's (all three are rebadge partners of each
// other), 1 genuine third-party (Dekalb, never touched). e1/e3/e5 share
// the same hybrid "family" (09-90 PCE) under each brand's own code — the
// key case this whole feature is about. e2 has NO recognized brand-code
// prefix at all, to confirm hybrid text is left alone when there's
// nothing safe to swap.
const ENTRIES = [
  entry("e1", "Midwest Seed Genetics", "MW 09-90 PCE", 200),
  entry("e2", "Midwest Seed Genetics", "P1185Q", 210),
  entry("e3", "NC+ Hybrids", "NC 09-90 PCE", 190),
  entry("e4", "NC+ Hybrids", "NC 11-30 TRERIB", 220),
  entry("e5", "Crow's", "CR 09-90 PCE", 205),
  entry("e6", "Crow's", "CR 14-36 PCE", 215),
  entry("e7", "Dekalb", "DKC61-88", 225),
];

// (200+210+190+220+205+215)/6 = 206.666... -> 206.7 — the combined
// average of the 6 rebadge-group entries is the SAME in every one of the
// 3 views (same 6 entries, just grouped/labeled differently), a useful
// cross-check that nothing is being double-counted or dropped.
const REBADGE_GROUP_AVG = "206.7";

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

async function checkView(selectedBrandId, viewLabel, ownDisplayBrand, ownCode) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seed(page, selectedBrandId);
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  const rowTitles = await page.$$eval(".ranked-row-title", (els) => els.map((el) => el.textContent));

  check(
    rowTitles.every((t) => !t.includes("Midwest Seed Genetics") || ownDisplayBrand === "Midwest Seed Genetics"),
    `[${viewLabel}] no row shows a stale "Midwest Seed Genetics" label unless that's the current view (got ${JSON.stringify(rowTitles)})`
  );
  check(
    rowTitles.every((t) => !t.includes("NC+ Hybrids") || ownDisplayBrand === "NC+ Hybrids"),
    `[${viewLabel}] no row shows a stale "NC+ Hybrids" label unless that's the current view`
  );
  check(
    rowTitles.every((t) => !t.includes("Crow's") || ownDisplayBrand === "Crow's"),
    `[${viewLabel}] no row shows a stale "Crow's" label unless that's the current view`
  );
  check(
    rowTitles.filter((t) => t.includes(ownDisplayBrand)).length === 6,
    `[${viewLabel}] all 6 rebadge-group rows now show "${ownDisplayBrand}" (got ${JSON.stringify(rowTitles)})`
  );
  check(
    rowTitles.some((t) => t.includes("Dekalb")),
    `[${viewLabel}] the genuine third-party brand (Dekalb) is untouched`
  );

  // The 3 "09-90 PCE" siblings (e1/e3/e5) all converge on THIS view's own
  // code — the central claim of the feature.
  const familyCount = rowTitles.filter((t) => t.includes(`${ownCode} 09-90 PCE`)).length;
  check(
    familyCount === 3,
    `[${viewLabel}] all 3 "09-90 PCE" sibling hybrids now show the "${ownCode} 09-90 PCE" prefix (got ${familyCount}, titles: ${JSON.stringify(rowTitles)})`
  );
  // No stale prefix from either OTHER rebadge brand survives anywhere.
  const OTHER_CODES = ["MW", "NC", "CR"].filter((c) => c !== ownCode);
  for (const staleCode of OTHER_CODES) {
    check(
      !rowTitles.some((t) => t.includes(`${staleCode} 09-90 PCE`)),
      `[${viewLabel}] no row still shows the stale "${staleCode} 09-90 PCE" prefix`
    );
  }
  // The no-prefix hybrid (e2, "P1185Q") is left completely alone.
  check(
    rowTitles.some((t) => t.includes("P1185Q")),
    `[${viewLabel}] a hybrid with no recognized brand code ("P1185Q") is left exactly as typed`
  );
  // Dekalb's own hybrid text is untouched too (not swept into the family).
  check(
    rowTitles.some((t) => t.includes("DKC61-88")),
    `[${viewLabel}] the third-party brand's hybrid text ("DKC61-88") is untouched`
  );

  const brandAverages = await page.$$eval(".brand-average-block", (els) =>
    els.map((el) => el.querySelector(".brand-average-name").textContent + " " + el.querySelector(".brand-average-value").textContent)
  );
  console.log(`Brand averages (${viewLabel}):`, brandAverages);
  const ownLine = brandAverages.find((t) => t.startsWith(ownDisplayBrand));
  check(
    !!ownLine && ownLine.includes("n=6") && ownLine.includes(REBADGE_GROUP_AVG),
    `[${viewLabel}] "${ownDisplayBrand}"'s combined average covers n=6 at ${REBADGE_GROUP_AVG} bu/ac (got "${ownLine}")`
  );

  // Underlying trial data must remain unrelabeled (Plot Entries / XLSX source of truth).
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).entries);
  check(
    stored.find((e) => e.id === "e3").hybrid === "NC 09-90 PCE" && stored.find((e) => e.id === "e3").brand === "NC+ Hybrids",
    `[${viewLabel}] stored trial data keeps e3's real brand/hybrid untouched (got ${JSON.stringify(stored.find((e) => e.id === "e3"))})`
  );

  await page.close();
}

await checkView("midwestSeedGenetics", "Midwest view", "Midwest Seed Genetics", "MW");
await checkView("ncPlus", "NC+ view", "NC+ Hybrids", "NC");
await checkView("crows", "Crow's view", "Crow's", "CR");

// ---- PDF export mirrors the same relabeling (mocked jsPDF), NC+ view ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seed(page, "ncPlus");
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

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
    pdfCalls.text.some((t) => t.includes("NC+ Hybrids:") && t.includes("(n=6)")),
    `PDF's brand-average section shows the combined n=6 NC+ Hybrids average (got ${JSON.stringify(pdfCalls.text.filter((t) => t.includes("bu/ac (n=")))})`
  );
  check(
    !pdfCalls.text.some((t) => t.startsWith("Midwest Seed Genetics:") || t.startsWith("Crow's:")),
    "PDF no longer lists separate Midwest Seed Genetics or Crow's brand-average lines"
  );
  check(
    pdfCalls.text.some((t) => t.includes("NC 09-90 PCE")),
    `PDF text includes the swapped "NC 09-90 PCE" hybrid name (got ${JSON.stringify(pdfCalls.text.filter((t) => t.includes("09-90")))})`
  );

  await page.close();
}

// ---- Case-insensitive prefix matching + a non-rebadge Brand View (none
// selected) leaves everything alone — checked directly against the
// function, not through the DOM, since these are pure-logic edge cases ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  const results = await page.evaluate(async (rawEntries) => {
    const { getBrand, entriesForBrandView } = await import("/js/ui/brand.js");
    const lowerCaseEntry = {
      id: "x1", brand: "NC+ Hybrids", hybrid: "nc 12-48 dgvt2prib", trait: "", relativeMaturity: "100",
      seedTreatment: "", sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "",
      numberOfRows: "", widthInches: "", comments: "", manualDryYield: "200",
    };
    const swapped = entriesForBrandView([lowerCaseEntry], getBrand("midwestSeedGenetics"));
    const untouchedByNullBrand = entriesForBrandView(rawEntries, null);
    return { swappedHybrid: swapped[0].hybrid, sameRefForNullBrand: untouchedByNullBrand === rawEntries };
  }, ENTRIES);
  check(
    results.swappedHybrid === "MW 12-48 dgvt2prib",
    `hybrid brand-code matching is case-insensitive on input, canonical-uppercase on output (got "${results.swappedHybrid}")`
  );
  check(results.sameRefForNullBrand, "entriesForBrandView(entries, null) returns entries untouched (no Brand View selected at all)");
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
