// Verifies the splash/sign-in screen (accountScreen.js): shows a Quick
// Start Guide link reachable WITHOUT being signed in (router.js exempts
// "quick-start" from its mandatory-sign-in guard specifically for this),
// that link's Back button returns to the splash screen (not the
// authenticated Home Screen, since there's no session to return to), and
// the splash screen's background is a gradient (not the old flat white)
// built from the shield artwork's own navy blue.
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

// ---- Gradient background ----
const bgImage = await page.$eval(".launch-screen", (el) => getComputedStyle(el).backgroundImage);
check(bgImage.includes("gradient"), `the splash screen uses a CSS gradient background (got "${bgImage}")`);
check(!bgImage.includes("none"), "the background is not \"none\"");
// Every round of "make it darker" (four so far) only ever darkens from
// whatever shipped before — pull the two rgb(...) stops out of the
// computed gradient string and confirm each channel actually dropped from
// the ORIGINAL baseline colors, rather than re-asserting an exact hex
// (which would make this test brittle to the next fine-tuning request).
const stops = [...bgImage.matchAll(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g)].map((m) => m.slice(1, 4).map(Number));
check(stops.length === 2, `the gradient has exactly two color stops (got ${JSON.stringify(stops)})`);
const OLD_TOP = [238, 244, 251];
const OLD_BOTTOM = [199, 219, 240];
check(
  stops.length === 2 && stops[0].every((c, i) => c < OLD_TOP[i]) && stops[1].every((c, i) => c < OLD_BOTTOM[i]),
  `both gradient stops are darker than the original baseline colors (got ${JSON.stringify(stops)})`
);
// The most recent request was specifically "25% darker" than the
// previous build's values, (148,160,176)/(98,126,157) — confirm that
// specific transform landed (channels × 0.75, rounded).
const PREV_TOP = [148, 160, 176];
const PREV_BOTTOM = [98, 126, 157];
check(
  stops.length === 2 &&
    stops[0].every((c, i) => Math.abs(c - Math.round(PREV_TOP[i] * 0.75)) <= 1) &&
    stops[1].every((c, i) => Math.abs(c - Math.round(PREV_BOTTOM[i] * 0.75)) <= 1),
  `both stops landed at ~25% darker than the immediately-previous build (got ${JSON.stringify(stops)})`
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
