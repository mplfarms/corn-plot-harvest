// Verifies entryEditor.js's Hybrid Catalog cascading behavior (see that
// file's top comment, catalogStore.js, and the original request: pick a
// Brand, see only that brand's hybrids; pick a Hybrid, get RM
// auto-filled and Trait either auto-filled (one package) or narrowed to
// just its available package(s) (more than one) — while manual
// entry/override always still works for anything not on the lists.
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

const FIXTURE_ROWS = [
  // Single-trait hybrid: picking it should auto-fill BOTH RM and Trait.
  { company: "TestCo", hybrid: "TC100-Single", trait: "VT2P", rm: 95 },
  // Multi-trait hybrid (same RM across both trait rows, like real data):
  // picking it should auto-fill RM but only NARROW the Trait list.
  { company: "TestCo", hybrid: "TC200-Multi", trait: "SmartStax", rm: 102 },
  { company: "TestCo", hybrid: "TC200-Multi", trait: "Conventional", rm: 102 },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.addInitScript((rows) => {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/hybridCatalog")) {
      return new Response(JSON.stringify({ updatedAt: "2026-07-21T12:00:00.000Z", rows }), { status: 200 });
    }
    return realFetch(url, options);
  };
}, FIXTURE_ROWS);

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

// ---- Switch Brand to the catalog's TestCo, confirm its hybrids show up ----
// Brand / Company and Hybrid are now searchable list pickers (tap opens
// a modal with the keyboard up — see searchListPicker.js), not the old
// wheels.
await page.click(".field:has-text('Brand / Company') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.waitForTimeout(200); // debounceGuard dedupes clicks within 80ms of the previous one — the open-panel click and the option click can otherwise land close enough together to have the second swallowed
await page.click(".search-list-option:has-text('TestCo')");
await page.waitForTimeout(150);

let brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(brandValue === "TestCo", `Brand is now TestCo (got "${brandValue}")`);

await page.click(".field:has-text('Hybrid') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
const hybridOptionTexts = await page.$$eval(".search-list-option", (els) => els.map((e) => e.textContent.trim()));
check(
  hybridOptionTexts.some((t) => t.includes("TC100-Single")) && hybridOptionTexts.some((t) => t.includes("TC200-Multi")),
  `Hybrid picker offers TestCo's catalog hybrids once Brand is selected (got ${JSON.stringify(hybridOptionTexts)})`
);

// ---- Pick the single-trait hybrid: RM AND Trait both auto-fill ----
await page.waitForTimeout(200); // see the debounceGuard note above
await page.click(".search-list-option:has-text('TC100-Single')");
await page.waitForTimeout(150);

let rmValue = await page.$eval(".field:has-text('Relative Maturity') .wheel-row-value", (el) => el.textContent.trim());
check(rmValue === "95", `picking a single-trait catalog Hybrid auto-fills RM (got "${rmValue}")`);
let traitValue = await page.$eval(".field:has-text('Trait') .wheel-row-value", (el) => el.textContent.trim());
check(traitValue === "VT2P", `picking a single-trait catalog Hybrid also auto-fills its one Trait package (got "${traitValue}")`);

// ---- Switch to the multi-trait hybrid: RM auto-fills, Trait is CLEARED and narrowed (not auto-picked) ----
await page.click(".field:has-text('Hybrid') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.waitForTimeout(200); // debounceGuard dedupes clicks within 80ms of the previous one — the open-panel click and the option click can otherwise land close enough together to have the second swallowed
await page.click(".search-list-option:has-text('TC200-Multi')");
await page.waitForTimeout(150);

rmValue = await page.$eval(".field:has-text('Relative Maturity') .wheel-row-value", (el) => el.textContent.trim());
check(rmValue === "102", `switching to a different catalog Hybrid re-auto-fills RM to its own value (got "${rmValue}")`);
traitValue = await page.$eval(".field:has-text('Trait') .wheel-row-value", (el) => el.textContent.trim());
check(
  traitValue === "Select…",
  `a multi-trait Hybrid does NOT auto-pick a Trait — the stale single-trait-hybrid's value is cleared instead of left mismatched (got "${traitValue}")`
);

await page.click(".field:has-text('Trait') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
const traitOptionTexts = (await page.$$eval(".search-list-option", (els) => els.map((e) => e.textContent.trim()))).filter(
  (t) => !t.startsWith("+ Add New")
);
check(
  traitOptionTexts.length === 2 && traitOptionTexts.includes("SmartStax") && traitOptionTexts.includes("Conventional"),
  `the Trait picker is narrowed to exactly this hybrid's 2 catalog packages, nothing else (got ${JSON.stringify(traitOptionTexts)})`
);

// Manual pick from the narrowed list still works normally.
await page.waitForTimeout(200); // see the guard() note above (searchListPicker.js's options use the same short-window dedupe)
await page.click(".search-list-option:has-text('Conventional')");
await page.waitForTimeout(150);
traitValue = await page.$eval(".field:has-text('Trait') .wheel-row-value", (el) => el.textContent.trim());
check(traitValue === "Conventional", `picking from the narrowed Trait list still saves normally (got "${traitValue}")`);

// ---- Manual override is still fully available: RM stays a normal spinnable wheel ----
await page.click(".field:has-text('Relative Maturity') .wheel-row-header");
await page.waitForSelector(".wheel-panel .wheel-option", { timeout: 3000 });
await page.waitForTimeout(200); // guard() dedupes clicks within 80ms of the previous one — the open-panel click and the option click can otherwise land close enough together to have the second swallowed
await page.click(".wheel-option:has-text('110')");
await page.waitForTimeout(150);
rmValue = await page.$eval(".field:has-text('Relative Maturity') .wheel-row-value", (el) => el.textContent.trim());
check(rmValue === "110", `RM can still be manually overridden after an auto-fill — nothing here locks it (got "${rmValue}")`);

// ---- Trait "+Add New" — now inline type-to-create, no separate modal
// (per explicit request) — still works even with a narrowed catalog list
// showing ----
await page.click(".field:has-text('Trait') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.waitForTimeout(200); // see the guard() note above
await page.fill(".search-list-input", "Totally Custom Trait");
await page.waitForSelector(".search-list-add-new", { timeout: 3000 });
await page.click(".search-list-add-new");
await page.waitForTimeout(200);
traitValue = await page.$eval(".field:has-text('Trait') .wheel-row-value", (el) => el.textContent.trim());
check(
  traitValue === "Totally Custom Trait",
  `a hand-typed Trait not in the catalog's narrowed list can still be added directly by typing, no modal needed (got "${traitValue}")`
);

// ---- A Hybrid with NO catalog match (custom/free-typed) leaves RM alone and shows the FULL Trait list, not narrowed ----
await page.click(".field:has-text('Hybrid') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.waitForTimeout(200); // see the debounceGuard note above
await page.fill(".search-list-input", "Totally Custom Hybrid");
await page.waitForSelector(".search-list-add-new", { timeout: 3000 });
await page.click(".search-list-add-new");
await page.waitForTimeout(200);

rmValue = await page.$eval(".field:has-text('Relative Maturity') .wheel-row-value", (el) => el.textContent.trim());
check(rmValue === "110", `a custom (non-catalog) Hybrid does NOT touch RM — it stays whatever was last set (got "${rmValue}")`);

await page.click(".field:has-text('Trait') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
const fullTraitOptionTexts = await page.$$eval(".search-list-option", (els) => els.map((e) => e.textContent.trim()));
check(
  fullTraitOptionTexts.length > 2,
  `a custom (non-catalog) Hybrid shows the FULL, unrestricted Trait list, not narrowed to 2 (got ${fullTraitOptionTexts.length} options)`
);
await page.keyboard.press("Escape");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
