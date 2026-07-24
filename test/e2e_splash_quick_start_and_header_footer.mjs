// Verifies the splash/sign-in screen (accountScreen.js): shows a Quick
// Start Guide link reachable WITHOUT being signed in (router.js exempts
// "quick-start" from its mandatory-sign-in guard specifically for this),
// that link's Back button returns to the splash screen (not the
// authenticated Home Screen, since there's no session to return to), and
// the splash screen's own background is now plain white (per explicit
// request — this used to be a navy-blue gradient, see the old
// e2e_splash_quick_start_and_gradient.mjs this file replaced) framed by
// a solid-navy header bar and footer bar in that same navy — the
// Republic shield artwork's own blue (#0c2336) — rather than an
// unrelated color, so the page and the shield still read as one
// consistent "Republic blue" even though the middle of the page is now
// white instead of blue.
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

// Deliberately signed OUT — this is the whole point of the test.
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/index.html?r=1#/account`);
await page.waitForSelector(".launch-screen", { timeout: 5000 });

// ---- Title above the shield ----
const launchTitle = await page.$eval(".launch-title", (el) => el.textContent);
check(launchTitle === "Corn Plot Entry Tool", `the splash screen shows a "Corn Plot Entry Tool" title above the shield (got "${launchTitle}")`);
const titleBeforeShield = await page.evaluate(() => {
  const branding = document.querySelector(".launch-branding");
  const children = Array.from(branding.children);
  return children.findIndex((c) => c.classList.contains("launch-title")) < children.findIndex((c) => c.classList.contains("launch-shield"));
});
check(titleBeforeShield, "the title sits above (before, in DOM order) the shield image");

// ---- Plain white background, no more gradient ----
const bg = await page.$eval(".launch-screen", (el) => {
  const style = getComputedStyle(el);
  return { image: style.backgroundImage, color: style.backgroundColor };
});
check(bg.image === "none", `the splash screen's own background is no longer a CSS gradient (got backgroundImage "${bg.image}")`);
check(bg.color === "rgb(255, 255, 255)", `the splash screen's own background is plain white (got "${bg.color}")`);

// ---- Header/footer bars in the Republic shield's own navy blue ----
const headerBg = await page.$eval(".launch-header-bar", (el) => getComputedStyle(el).backgroundColor);
check(headerBg === "rgb(12, 35, 54)", `the header bar is the Republic shield's navy blue, #0c2336 (got "${headerBg}")`);
const footerBg = await page.$eval(".launch-footer-bar", (el) => getComputedStyle(el).backgroundColor);
check(footerBg === "rgb(12, 35, 54)", `the footer bar is the same Republic-shield navy blue, #0c2336 (got "${footerBg}")`);

// Header bar sits above (before, in DOM order) the branding block, and
// the footer bar sits after (below) the sign-in form — i.e. they truly
// bookend the page rather than floating in the middle somewhere.
const barOrder = await page.evaluate(() => {
  const screen = document.querySelector(".launch-screen");
  const children = Array.from(screen.children);
  return {
    headerIdx: children.findIndex((c) => c.classList.contains("launch-header-bar")),
    brandingIdx: children.findIndex((c) => c.classList.contains("launch-branding")),
    formIdx: children.findIndex((c) => c.classList.contains("launch-form-body")),
    footerIdx: children.findIndex((c) => c.classList.contains("launch-footer-bar")),
  };
});
check(
  barOrder.headerIdx === 0 && barOrder.headerIdx < barOrder.brandingIdx && barOrder.formIdx < barOrder.footerIdx && barOrder.footerIdx === 3,
  `the header bar is the first element and the footer bar is the last, bookending the branding/form in between (got ${JSON.stringify(barOrder)})`
);

// ---- Quick Start Guide link, reachable while signed out ----
const qsLink = page.locator("button", { hasText: "Quick Start Guide" });
check(await qsLink.count() === 1, "the splash screen shows a Quick Start Guide link");

await qsLink.click();
await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
check(true, "tapping it while signed out actually opens the Quick Start Guide (not bounced back to sign-in)");

const stepCount = await page.$$eval(".quick-start-step", (els) => els.length);
check(stepCount === 9, `the guide still shows all 9 steps when reached signed-out (got ${stepCount})`);

// Back button returns to the splash screen (there's no Home Screen to
// return to — no session exists).
const backBtn = page.locator('.top-bar-btn[aria-label="Back"]');
await backBtn.click();
await page.waitForSelector(".launch-screen", { timeout: 5000 });
check(true, "Back from the Quick Start Guide returns to the splash screen when signed out");

// ---- Sanity: directly hitting #/quick-start signed-out (e.g. a typed
// URL or a bookmark) also works, rather than only working via the link ----
await page.goto(`${BASE}/index.html?r=2#/quick-start`);
await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
check(true, "navigating directly to #/quick-start while signed out is NOT bounced to the sign-in guard");

// ---- Signed IN: the same link's Back button goes to the Home Screen instead ----
await page.evaluate(() => {
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
});
await page.goto(`${BASE}/index.html?r=3#/quick-start`);
await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
await backBtn.click();
await page.waitForSelector(".home-screen", { timeout: 5000 });
check(true, "Back from the Quick Start Guide returns to the Home Screen when signed in");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
