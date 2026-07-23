// Verifies the "Return to Plot Summary" button on the Hybrid Entries list
// screen — added so a user can navigate back to Plot Summary without
// being forced to tap "Add Another Hybrid" and add one first.
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
    id: "e1", brand: "Midwest Seed Genetics", hybrid: "H1", trait: "VT2P", relativeMaturity: "100",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
    widthInches: "", comments: "", manualDryYield: "200",
  };
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries: [entry] })
  );
});
await page.goto(`${BASE}/index.html?r=1#/entries`);
await page.waitForSelector(".entries-list-screen", { timeout: 5000 });

const backBtn = page.locator("button", { hasText: "Return to Plot Summary" });
check((await backBtn.count()) === 1, "the Return to Plot Summary button is present");

const entryCountBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).entries.length);
await backBtn.click();
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
check(true, "tapping it navigates to Plot Summary");

const entryCountAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).entries.length);
check(entryCountAfter === entryCountBefore, `no hybrid entry was added along the way (before=${entryCountBefore}, after=${entryCountAfter})`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
