// Verifies the wheel-select "blank line at top" bug is actually gone —
// including the case the v19 fix missed: a LONG (scrollable) list whose
// currently selected value is the first option. That bug (and this
// regression test) originally targeted the Brand/Company wheel, but
// Brand/Company (along with Hybrid) has since moved to the searchable
// list picker (searchListPicker.js — see entryEditor.js's top comment),
// a structurally different component with no scroll-snap/spacer
// mechanism at all, so that specific bug can't recur there — this file
// now only covers RM, the one field still built as a wheel.
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
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "t1",
      header: { cooperatorName: "Test Cooperator", state: "IA", county: "Story" },
      entries: [
        {
          id: "e1",
          brand: "Midwest Seed Genetics", // first option in the 57-company list
          hybrid: "00-31 SSRIB", // first RM-100 hybrid — also first in its filtered list
          trait: "",
          relativeMaturity: "100",
          seedTreatment: "",
          sampleNetWeightLbs: "",
          moisturePercent: "",
          testWeight: "",
          stripLengthFeet: "",
          numberOfRows: "",
          widthInches: "",
          comments: "",
          manualDryYield: "",
        },
      ],
    })
  );
});

// entry-editor needs an entryId param, which normally comes from the
// router's in-memory params set by navigate() — a fresh page load can't
// supply that via URL alone, so go through the app's own Entries list UI
// and click into the seeded entry instead.
await page.goto(`${BASE}/index.html?r=1#/entries`);
await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
await page.click(".entry-row-main");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });

// ---- Open the RM wheel (locked 75-120 list, mid-list value = "100") ----
const rmHeader = page.locator(".field", { hasText: "Relative Maturity (RM)" }).locator(".wheel-row-header");
await rmHeader.click();
await page.waitForSelector(".wheel-panel .wheel-option", { timeout: 3000 });
await page.waitForTimeout(150);

const rmFirstChildClass = await page.$eval(".wheel-scroll", (el) => el.firstElementChild && el.firstElementChild.className);
check(
  !!rmFirstChildClass && rmFirstChildClass.includes("wheel-option") && !rmFirstChildClass.includes("wheel-spacer"),
  `RM panel's first child is a real option, not a spacer (got "${rmFirstChildClass}")`
);
const rmSelectedVisible = await page.$eval(".wheel-scroll", (el) => {
  const sel = el.querySelector(".wheel-option-selected");
  if (!sel) return false;
  const elRect = el.getBoundingClientRect();
  const selRect = sel.getBoundingClientRect();
  return selRect.top >= elRect.top - 1 && selRect.bottom <= elRect.bottom + 1;
});
check(rmSelectedVisible, "RM's selected value (100) is scrolled into view within the panel");
const spacerCount = await page.$$eval(".wheel-spacer", (els) => els.length);
check(spacerCount === 0, `no .wheel-spacer elements exist anywhere on the page (found ${spacerCount})`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
