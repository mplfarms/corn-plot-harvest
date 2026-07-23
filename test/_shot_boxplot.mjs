import { chromium } from "playwright";
const BASE = "http://localhost:34205";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("ncPlus"));
  const yields = [80, 190, 195, 200, 205, 210, 215, 220, 225, 230];
  const entries = yields.map((y, i) => ({
    id: `e${i}`, brand: i % 3 === 0 ? "NC+ Hybrids" : (i % 3 === 1 ? "Crow's" : "NC+ Hybrids"),
    hybrid: `H${i}`, trait: "", relativeMaturity: "100", seedTreatment: "",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
    widthInches: "", comments: "", manualDryYield: String(y),
  }));
  localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries }));
});
await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
await page.waitForSelector(".box-plot-section");
await page.screenshot({ path: "/tmp/work/webapp/test/shot_boxplot_summary.png" });
await browser.close();
