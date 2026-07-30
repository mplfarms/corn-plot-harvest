// Verifies the Plot Summary top bar's share icon (the box-with-up-arrow
// next to the "i" help badge) — per explicit request it now opens the
// SAME "Share This Plot" menu as the button at the bottom of the screen
// (replacing its earlier direct one-tap-PDF behavior): one consistent
// set of share actions (PDF / Excel / Seedware), reachable from both
// ends of the screen.
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
    JSON.stringify({
      id: "t1",
      header: { cooperatorName: "Menu Coop", state: "IA", county: "Story", formId: "26-1888", city: "Ames" },
      entries: [
        {
          id: "e0", brand: "Midwest Seed Genetics", hybrid: "H0", trait: "VT2Pro RIB", relativeMaturity: "100",
          seedTreatment: "", sampleNetWeightLbs: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
          widthInches: "", comments: "", manualDryYield: "220", moisturePercent: "18",
        },
      ],
    })
  );
});
await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

// ---- 1. Button placement + label ----
const rightButtons = await page.$$eval(".top-bar-right > button", (els) => els.map((e) => e.className));
check(
  rightButtons.length === 3 &&
    rightButtons[0].includes("top-bar-btn-share") &&
    rightButtons[1].includes("top-bar-btn-help") &&
    rightButtons[2].includes("top-bar-btn-settings"),
  `top-bar right slot is share icon -> help badge -> settings gear (got ${JSON.stringify(rightButtons)})`
);
const shareLabel = await page.$eval(".top-bar-btn-share", (el) => el.getAttribute("aria-label"));
check(shareLabel === "Share this plot", `the share icon is labeled as the general share entry point (got "${shareLabel}")`);

// ---- 2. Tapping the icon opens the Share This Plot menu (no direct
//         export fires) ----
await page.click(".top-bar-btn-share");
await page.waitForSelector(".share-menu-panel-modal", { timeout: 3000 });
const menuState = await page.evaluate(() => {
  const title = document.querySelector(".modal-overlay:not(.hidden) .modal-title");
  const items = [...document.querySelectorAll(".share-menu-panel-modal .share-menu-item")].map((el) => el.textContent);
  return { title: title ? title.textContent : null, items };
});
check(menuState.title === "Share This Plot", `the icon opens the "Share This Plot" menu (got "${menuState.title}")`);
check(
  JSON.stringify(menuState.items) ===
    JSON.stringify(["Share / Print PDF Summary", "Share / Print Excel Plot Form", "Export for Seedware"]),
  `the menu carries the same 3 actions as the bottom button's menu (got ${JSON.stringify(menuState.items)})`
);

// Close it, then confirm the BOTTOM button still opens the identical menu.
await page.click(".modal-overlay:not(.hidden) .modal-close-btn");
await page.waitForTimeout(300);
const bottomBtn = page.locator("button", { hasText: "Share This Plot" });
await bottomBtn.click();
await page.waitForSelector(".share-menu-panel-modal", { timeout: 3000 });
const itemsFromBottom = await page.$$eval(".share-menu-panel-modal .share-menu-item", (els) => els.map((el) => el.textContent));
check(
  JSON.stringify(itemsFromBottom) ===
    JSON.stringify(["Share / Print PDF Summary", "Share / Print Excel Plot Form", "Export for Seedware"]),
  "the bottom Share This Plot button opens the same menu as before"
);

await page.close();
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
