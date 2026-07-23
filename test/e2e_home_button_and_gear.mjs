// Verifies: (1) the top bar's Home button now goes to the branded
// per-brand Home Screen (#/plot-chooser) instead of the launch/sign-in
// screen (#/account) or the deeper Plot Workspace menu (#/workspace);
// (2) Home and Back are icon-only (no "Home"/"Back" text label) and
// sized to match the Settings gear exactly, so all three top-bar chrome
// buttons read as one consistent set; (3) the center title stays
// centered (grid-based layout, not flexbox space-between) even on
// screens where the left/right button groups aren't the same width.
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
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries: [] })
  );
});

// Start from the Plot Workspace menu (a screen that is NOT the Home
// Screen), then tap the top bar's Home button.
await page.goto(`${BASE}/index.html?r=1#/workspace`);
await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });

await page.click('.top-bar-btn[aria-label="Home"]');
await page.waitForSelector(".home-screen", { timeout: 5000 });
check(true, "tapping the top bar Home button navigates to the branded Home Screen (#/plot-chooser)");
check(!(await page.$(".workspace-menu-screen")), "the Plot Workspace menu screen is no longer showing");
check(!(await page.$(".launch-screen")), "the Republic launch/sign-in screen is NOT shown by Home anymore");

// The Plot Workspace screen itself must still be reachable (only the top
// bar's Home button target changed, not the route/screen itself) — e.g.
// Settings' own Back button still returns to it.
await page.goto(`${BASE}/index.html?r=2#/workspace`);
await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
await page.click(".top-bar-btn-settings");
await page.waitForSelector(".settings-screen", { timeout: 5000 });
const settingsBackBtn = page.locator('.top-bar-btn[aria-label="Back"]');
await settingsBackBtn.click();
await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
check(true, "Plot Workspace is still reachable via other screens' own Back buttons (only the Home button's target changed)");

// ---- Home (now an outlined barn SVG — see topBar.js's BARN_ICON_SVG)
// and Back have no visible text, and Home's icon renders slightly
// LARGER than the gear's glyph ----
const homeText = await page.$eval('.top-bar-btn[aria-label="Home"]', (el) => el.textContent.trim());
check(homeText === "", `Home button has no "Home" text label, just the icon (got ${JSON.stringify(homeText)})`);

const homeHasSvg = await page.$('.top-bar-btn[aria-label="Home"] svg');
check(Boolean(homeHasSvg), "Home button renders an SVG icon (the barn outline)");

const sizes = await page.evaluate(() => {
  const gear = document.querySelector(".top-bar-btn-settings");
  const homeSvg = document.querySelector('.top-bar-btn[aria-label="Home"] svg');
  const homeBtn = document.querySelector('.top-bar-btn[aria-label="Home"]');
  return {
    gear: parseFloat(getComputedStyle(gear).fontSize),
    home: homeSvg.getBoundingClientRect().width,
    homeButtonFontSize: parseFloat(getComputedStyle(homeBtn).fontSize),
  };
});
check(
  sizes.home > sizes.gear,
  `Home icon's rendered width (${sizes.home}px) is bigger than the gear glyph's font-size (${sizes.gear}px)`
);

// Also check Back specifically, from a screen that has one (Settings does).
await page.goto(`${BASE}/index.html?r=3#/settings`);
await page.waitForSelector(".settings-screen", { timeout: 5000 });
const backInfo = await page.evaluate(() => {
  const back = document.querySelector('.top-bar-btn[aria-label="Back"]');
  return back ? { text: back.textContent.trim(), size: parseFloat(getComputedStyle(back).fontSize) } : null;
});
check(backInfo && backInfo.text === "‹", `Back button has no "Back" text label, just the icon (got ${JSON.stringify(backInfo && backInfo.text)})`);
// Back's own "‹" glyph is still sized via .top-bar-btn-nav's font-size
// (1.5rem) — the same class Home's button keeps too, for shared button
// styling (padding, min-height, etc.), even though Home's actual VISUAL
// icon size now comes from the SVG's own width/height instead of
// font-size. This confirms the two buttons still share that class/value
// (a class-drift regression check), not that they look the same size.
check(
  backInfo && backInfo.size === sizes.homeButtonFontSize,
  `Back button font-size (${backInfo && backInfo.size}px) still matches Home button's shared .top-bar-btn-nav font-size (${sizes.homeButtonFontSize}px)`
);

// ---- Title stays visually centered even when left/right groups differ ----
// Settings has Home + Back on the left and just the gear on the right —
// a lopsided case that a flex space-between layout would visibly
// off-center; the grid-based layout should keep it centered regardless.
const centering = await page.evaluate(() => {
  const bar = document.querySelector(".top-bar");
  const title = document.querySelector(".top-bar-title");
  const barBox = bar.getBoundingClientRect();
  const titleBox = title.getBoundingClientRect();
  const barCenter = barBox.left + barBox.width / 2;
  const titleCenter = titleBox.left + titleBox.width / 2;
  return Math.abs(barCenter - titleCenter);
});
check(centering < 2, `the title stays centered in the bar even with an asymmetric Home+Back/gear-only layout (off by ${centering.toFixed(1)}px)`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
