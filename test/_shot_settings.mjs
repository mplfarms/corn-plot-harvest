import { chromium } from "playwright";
const BASE = "http://localhost:34205";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
});
await page.goto(`${BASE}/index.html?r=1#/settings`);
await page.waitForSelector(".settings-screen");
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/work/webapp/test/shot_settings_brandview.png" });
await browser.close();
