// Verifies initial-route selection (main.js) and the router-level
// mandatory-sign-in guard (router.js): with no session, the app always
// opens on (or is bounced back to) the Republic launch/sign-in screen
// (#/account) — never the old blue Brand Select picker
// (#/brand-select), and never any other screen even if a brand is
// remembered or the URL hash points elsewhere directly. Only once BOTH a
// session AND a brand are on file does a cold start skip straight to the
// branded Home Screen (#/plot-chooser).
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

// ---- First-ever visit: no brand, no session ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector(".launch-screen", { timeout: 5000 });
  check(true, "first-ever visit (no brand, no session) opens on the Republic launch/sign-in screen");
  check(!(await page.$(".brand-select-screen")), "the old blue Brand Select picker is NOT shown on first visit");
  await page.close();
}

// ---- Brand remembered, but NOT signed in — still mandatory sign-in ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("ncPlus"));
  });
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector(".launch-screen", { timeout: 5000 });
  check(true, "a remembered brand alone (no session) does NOT skip the mandatory sign-in screen");
  await page.close();
}

// ---- Both brand AND session remembered -> straight to Home Screen ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("ncPlus"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  check(true, "a remembered brand + session skips straight to the branded Home Screen");
  check(!(await page.$(".launch-screen")), "the launch/sign-in screen is NOT shown once both are on file");
  await page.close();
}

// ---- Router-level guard: directly hitting a protected route hash while
// signed out bounces back to the launch screen, regardless of a brand ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  });
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".launch-screen", { timeout: 5000 });
  check(true, "directly navigating to a protected route (#/plot-chooser) while signed out bounces to the launch screen");
  check(!(await page.$(".home-screen")), "the protected screen itself never rendered");
  await page.close();
}

// ---- Signing out from deep in the app returns to the launch screen ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  await page.click("text=Sign Out");
  await page.waitForSelector(".launch-screen", { timeout: 5000 });
  check(true, "tapping Sign Out in Settings returns straight to the mandatory sign-in screen");
  const session = await page.evaluate(() => localStorage.getItem("cph.authSession"));
  check(session === null, "the session is actually cleared from localStorage on Sign Out");
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
