import { chromium } from "playwright";
const BASE = "http://localhost:34205";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 700 } });

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "t1",
      header: { cooperatorName: "Test Coop", state: "IA", county: "" },
      entries: [
        { id: "e1", brand: "Midwest Seed Genetics", hybrid: "00-31 SSRIB", trait: "", relativeMaturity: "100",
          seedTreatment: "", sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "",
          numberOfRows: "", widthInches: "", comments: "", manualDryYield: "" }
      ],
    })
  );
});
await page.goto(`${BASE}/index.html?r=1#/entries`);
await page.waitForSelector(".entries-list-screen");
await page.click(".entry-row-main");
await page.waitForSelector(".entry-editor-screen");
const placeholder = await page.$eval("input[inputmode='decimal']", el => el.placeholder);
console.log("Dry Yield placeholder:", placeholder);
await page.locator("text=Dry Yield (bu/ac)").scrollIntoViewIfNeeded();
await page.screenshot({ path: "/tmp/work/webapp/test/shot_dry_yield_placeholder.png" });
await browser.close();
