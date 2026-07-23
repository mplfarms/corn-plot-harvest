import { chromium } from "playwright";

const BASE = "http://localhost:34205";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();

// Mock the cloud sync fetch (plots.js) so a GET looks like a successful
// pull with no trials — the sync icon just needs *a* successful call to
// go green, not real data.
await page.addInitScript(() => {
  window.fetch = async (url, options) => {
    if (String(url).includes("/.netlify/functions/plots")) {
      return new Response(JSON.stringify({ trials: [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
});

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({ id: "t1", header: { cooperatorName: "", state: "", county: "" }, entries: [] })
  );
  // Seed a signed-in session directly (no more Netlify Identity widget —
  // see authStore.js, which reads this key synchronously on load).
  localStorage.setItem(
    "cph.authSession",
    JSON.stringify({ name: "Farmer Test", email: "farmer@example.com", isAdmin: false })
  );
});
await page.goto(`${BASE}/index.html?r=1#/workspace`);
await page.waitForSelector(".workspace-menu-screen");
await page.waitForTimeout(300); // let cloudSyncStore's status settle

const cls = await page.$eval(".sync-icon-btn", (el) => el.className);
console.log("sync icon class when signed in:", cls);
console.log(cls.includes("sync-icon-synced") ? "PASS: green/synced when signed in" : "FAIL: expected synced state");

await browser.close();
