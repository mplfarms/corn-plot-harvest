// Verifies a new plot entry's Brand / Company defaults to whichever
// app-level brand is currently selected (Midwest Seed Genetics or NC+
// Hybrids), across every entry-creation path: Plot Details' "Continue to
// Hybrid Entries", the Entries list's "Add Another Hybrid" button, and
// "+ Add Another Entry" inside the editor. Also checks the first-entry
// Hybrid/RM-100 default still applies now that Brand is pre-filled
// instead of blank.
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

// ---- 1. Midwest Seed Genetics view: "Continue to Hybrid Entries" from Plot Details ----
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
});
await page.goto(`${BASE}/index.html?r=1#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });
await page.click("text=Continue to Hybrid Entries");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
let brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(brandValue === "Midwest Seed Genetics", `Midwest view: first entry defaults Brand to "Midwest Seed Genetics" (got "${brandValue}")`);

// First-entry RM-100 default should still fire even though Brand was pre-filled, not manually chosen.
let rmValue = await page.$eval(".field:has-text('Relative Maturity') .wheel-row-value", (el) => el.textContent.trim());
check(rmValue === "100", `first entry still defaults RM to 100 (got "${rmValue}")`);
let hybridValue = await page.$eval(".field:has-text('Hybrid') .wheel-row-value", (el) => el.textContent.trim());
check(hybridValue !== "Select…", `first entry's Hybrid wheel is no longer stuck on "Select…" (got "${hybridValue}")`);

// ---- 2. "+ Add Another Entry" also defaults to Midwest ----
await page.click("text=+ Add Another Entry");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(brandValue === "Midwest Seed Genetics", `"+ Add Another Entry" also defaults Brand to Midwest (got "${brandValue}")`);
// Hybrid wheel should NOT be stuck disabled now that brand defaults instead of starting blank.
const hybridDisabledReason = await page.$(".wheel-disabled-reason");
check(!hybridDisabledReason, "Hybrid wheel is not disabled on a freshly created 2nd+ entry (Brand is pre-filled)");

// ---- 3. Entries list's "Add Another Hybrid" button also defaults to Midwest ----
await page.goto(`${BASE}/index.html?r=2#/entries`);
await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
await page.click("text=Add Another Hybrid");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(brandValue === "Midwest Seed Genetics", `Entries list "Add Another Hybrid" also defaults Brand to Midwest (got "${brandValue}")`);

// ---- 4. Switch to the NC+ Hybrids brand view — new plot's first entry should default to NC+ ----
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("ncPlus"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
});
await page.goto(`${BASE}/index.html?r=3#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });
await page.click("text=Continue to Hybrid Entries");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(brandValue === "NC+ Hybrids", `NC+ view: first entry defaults Brand to "NC+ Hybrids" (got "${brandValue}")`);

// ---- 5. Manually picking a different (competitor) brand for one entry doesn't "stick" for the next new entry ----
// Brand / Company is now a searchable list picker (see
// searchListPicker.js), not the old wheel.
await page.click(".field:has-text('Brand / Company') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.click(".search-list-option:has-text('Crow')");
await page.waitForTimeout(150);
await page.click("text=+ Add Another Entry");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(
  brandValue === "NC+ Hybrids",
  `next new entry defaults back to the app brand (NC+ Hybrids), not the previous entry's competitor brand (got "${brandValue}")`
);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
