// Verifies: (1) Settings shows an app version footer sourced from
// version.js; (2) the top bar's Home button (checked here from a second,
// different screen than e2e_home_button_and_gear.mjs covers) goes to the
// branded per-brand Home Screen (#/plot-chooser), not the launch/sign-in
// screen.
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
});
await page.goto(`${BASE}/index.html?r=1#/settings`);
await page.waitForSelector(".settings-screen");

const versionText = await page.$eval(".settings-version-footer", (el) => el.textContent);
check(/^Corn Plot Harvest v\d+/.test(versionText), `Settings shows a version footer (got "${versionText}")`);

const moduleVersion = await page.evaluate(async () => {
  const mod = await import("/js/version.js");
  return mod.APP_VERSION;
});
check(versionText === `Corn Plot Harvest ${moduleVersion}`, `footer text matches version.js's APP_VERSION (got "${versionText}" vs "${moduleVersion}")`);

// Home button from Settings itself.
await page.click('.top-bar-btn[aria-label="Home"]');
await page.waitForSelector(".home-screen", { timeout: 5000 });
check(true, "Home button from Settings also lands on the branded Home Screen (#/plot-chooser)");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
