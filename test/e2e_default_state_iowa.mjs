// Verifies a brand new plot's Plot Details "State" wheel defaults to
// Iowa, while an existing saved trial that already has a different (or
// blank) state is left untouched.
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

// ---- 1. Brand new plot (no draft in localStorage at all) ----
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
});
await page.goto(`${BASE}/index.html?r=1#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });

const stateValueNew = await page.$eval(".field:has-text('State') .wheel-row-value", (el) => el.textContent.trim());
check(stateValueNew === "Iowa (IA)", `new plot's State wheel defaults to Iowa (got "${stateValueNew}")`);

// ---- 2. Existing saved trial with a different state already set ----
await page.evaluate(() => {
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "existing-1",
      header: {
        cooperatorName: "Existing Coop",
        address: "",
        city: "",
        state: "NE",
        zip: "",
        county: "",
        gpsLatitude: null,
        gpsLongitude: null,
        datePlanted: null,
        tillage: "",
        irrigation: "",
        soilType: "",
        previousCrop: "",
        plantingPopulation: "32000",
        dateHarvested: null,
        collectedBy: "",
        phone: "",
        email: "",
        baseMoisturePercent: 15.5,
        dryingShrinkRate: 0.06,
        pricePerBushel: 3.5,
        trialNotes: "",
      },
      entries: [],
    })
  );
});
await page.goto(`${BASE}/index.html?r=2#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });
const stateValueExisting = await page.$eval(".field:has-text('State') .wheel-row-value", (el) => el.textContent.trim());
check(stateValueExisting === "Nebraska (NE)", `existing trial's own state (Nebraska) is preserved, not overwritten (got "${stateValueExisting}")`);

// ---- 3. Iowa is actually selectable/highlighted when the wheel opens ----
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.evaluate(() => {
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
});
await page.goto(`${BASE}/index.html?r=3#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });
await page.click(".field:has-text('State') .wheel-row-header");
await page.waitForSelector(".wheel-panel .wheel-option", { timeout: 3000 });
const selectedOptionText = await page.$eval(".wheel-option-selected", (el) => el.textContent.trim());
check(selectedOptionText === "Iowa (IA)", `Iowa is highlighted as the selected option in the open wheel (got "${selectedOptionText}")`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
