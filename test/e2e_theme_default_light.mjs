// Verifies themeStore.js's new default: a fresh install (no theme choice
// ever saved) starts in Light mode rather than following the system/OS
// preference, but once someone picks Light, Dark, or System on the
// Settings screen, that exact choice persists across reloads — the
// default only ever applies before any choice has been made.
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

async function themeAttr(page) {
  return page.evaluate(() => document.documentElement.dataset.theme || null);
}

// ---- Fresh install (dark OS preference, to prove the app ignores it and defaults to Light anyway) ----
{
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });

  check((await themeAttr(page)) === "light", `a brand-new session defaults to Light mode even under a dark OS preference (got "${await themeAttr(page)}")`);
  const activeBtn = await page.$eval(".segmented-control .segmented-btn-active", (el) => el.textContent.trim());
  check(activeBtn === "Light", `the Appearance control shows Light as active by default (got "${activeBtn}")`);
  check((await page.evaluate(() => localStorage.getItem("cph.themeMode"))) === null, "nothing is written to storage just from the default applying — only an explicit choice persists");

  await context.close();
}

// ---- Explicitly choosing Dark persists across a reload ----
{
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });

  await page.locator(".segmented-control .segmented-btn", { hasText: "Dark" }).click();
  await page.waitForTimeout(150);
  check((await themeAttr(page)) === "dark", "tapping Dark applies it immediately");

  await page.goto(`${BASE}/index.html?r=2#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  check((await themeAttr(page)) === "dark", "Dark mode survives a full reload rather than reverting to the Light default");
  const activeBtnAfterReload = await page.$eval(".segmented-control .segmented-btn-active", (el) => el.textContent.trim());
  check(activeBtnAfterReload === "Dark", `the Appearance control still shows Dark as active after reload (got "${activeBtnAfterReload}")`);

  await context.close();
}

// ---- Explicitly choosing System also persists (removes the override, follows OS) ----
{
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });

  await page.locator(".segmented-control .segmented-btn", { hasText: "System" }).click();
  await page.waitForTimeout(150);
  check((await themeAttr(page)) === null, "tapping System removes the light/dark override immediately");
  check((await page.evaluate(() => localStorage.getItem("cph.themeMode"))) === '"system"', "System is explicitly saved (not just left as an unset default)");

  await page.goto(`${BASE}/index.html?r=2#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  check((await themeAttr(page)) === null, "System mode survives a reload rather than reverting to the Light default");

  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
