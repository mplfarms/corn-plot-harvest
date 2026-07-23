import { chromium } from "playwright";
const BASE = "http://localhost:34205";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
});
await page.goto(`${BASE}/index.html?r=1#/trial-details`);
await page.waitForSelector(".screen-body");
await page.click(".date-picker-btn >> nth=0");
await page.waitForSelector(".date-picker-grid .date-picker-day:not(.date-picker-day-empty)");
await page.waitForTimeout(150);
await page.screenshot({ path: "/tmp/work/webapp/test/shot_calendar.png" });
await page.click(".modal-close-btn");
await page.waitForTimeout(150);
await page.screenshot({ path: "/tmp/work/webapp/test/shot_trial_details_state_iowa.png" });
await browser.close();
