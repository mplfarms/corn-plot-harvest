import { chromium } from "playwright";
const BASE = "http://localhost:34205";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const [brandId, filename] of [["midwestSeedGenetics", "/tmp/home_midwest.png"], ["ncPlus", "/tmp/home_ncplus.png"]]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((brandId) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify(brandId));
  }, brandId);
  await page.goto(`${BASE}/index.html?r=shot#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.screenshot({ path: filename });
  await page.close();
}
await browser.close();
console.log("done");
