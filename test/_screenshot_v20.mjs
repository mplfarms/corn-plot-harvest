import { chromium } from "playwright";

const BASE = "http://localhost:34205";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "test-trial-1",
      header: { cooperatorName: "Test Cooperator", state: "IA", county: "Story", datePlanted: "", dateHarvested: "", collectedBy: "" },
      entries: [
        {
          id: "e1", brand: "Midwest Seed Genetics", hybrid: "82-22 VT2PRIB", trait: "VT2PRIB",
          seedTreatment: "", relativeMaturity: "82", manualDryYield: "220", sampleNetWeightLbs: "",
          moisturePercent: "15", testWeight: "", stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: ""
        },
        {
          id: "e2", brand: "Midwest Seed Genetics", hybrid: "88-11 VT2PRIB", trait: "VT2PRIB",
          seedTreatment: "", relativeMaturity: "88", manualDryYield: "180", sampleNetWeightLbs: "",
          moisturePercent: "16", testWeight: "", stripLengthFeet: "", numberOfRows: "", widthInches: "", comments: ""
        }
      ],
    })
  );
});

// Force a real reload (not just a hash-only same-document navigation) so
// trialStore's module-level state re-reads the localStorage we just wrote.
await page.goto(`${BASE}/index.html?r=1#/workspace`);
await page.waitForSelector(".workspace-menu-screen");
await page.screenshot({ path: "/tmp/work/webapp/test/shot_workspace.png" });

await page.goto(`${BASE}/index.html?r=2#/plot-summary`);
await page.waitForSelector(".plot-summary-screen");
await page.click("text=Share This Plot");
await page.waitForSelector(".modal-overlay:not(.hidden) .modal-card-large");
await page.screenshot({ path: "/tmp/work/webapp/test/shot_share_modal.png" });

await browser.close();
console.log("done");
