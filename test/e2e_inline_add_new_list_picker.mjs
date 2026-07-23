// Verifies searchListPicker.js's inline "type to add" redesign (per
// explicit request: "can you make it so you just start typing the new
// name instead of having to click the add new nnn button" for Brand /
// Company, Hybrid, Trait, and Seed Treatment — the four entryEditor.js
// fields that use this component's onAddNew option). The old flow was:
// click a static "+ Add New {title}…" row -> a SEPARATE popup modal asks
// for the name -> confirm. The new flow: type the new name straight into
// the search box -> a live "+ Add "{typed text}"" row appears in the
// filtered list itself -> tap it (or press Enter) -> added AND selected,
// no second modal. Also checks: an EXACT match to an existing option does
// NOT show the add-new row, and each field's always-visible addNewHint
// caption (replacing the old click-gated prompt message) is shown,
// including Hybrid's brand-scoped wording.
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
await page.goto(`${BASE}/index.html?r=1#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });
await page.click("text=Continue to Hybrid Entries");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });

// ---- 1. Brand / Company: no static "+ Add New…" row/modal anymore; typing
// a brand-new name shows a live `+ Add "..."` row with no separate modal ----
await page.click(".field:has-text('Brand / Company') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });

const staticAddRowGone = await page.$('.search-list-option:has-text("+ Add New Brand")');
check(!staticAddRowGone, "the old static \"+ Add New Brand / Company…\" row no longer exists");

const hintBeforeTyping = await page.$(".search-list-add-new-hint");
check(
  Boolean(hintBeforeTyping),
  "Brand / Company's add-new hint caption is always visible under the search box, even before typing anything"
);

await page.fill(".search-list-input", "Totally Custom Brand Co");
await page.waitForSelector(".search-list-add-new", { timeout: 3000 });
let addNewText = await page.$eval(".search-list-add-new", (el) => el.textContent.trim());
check(
  addNewText === '+ Add "Totally Custom Brand Co"',
  `the inline add-new row echoes back the exact typed text (got "${addNewText}")`
);

const modalInputPresent = await page.$(".modal-input");
check(!modalInputPresent, "no separate prompt modal/input appeared — the add-new row lives inline in the same list");

await page.click(".search-list-add-new");
await page.waitForTimeout(200);
let brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(
  brandValue === "Totally Custom Brand Co",
  `clicking the inline add-new row adds AND selects it in one step (got "${brandValue}")`
);

// ---- 2. Typing text that EXACTLY matches an existing option (case-insensitive) does NOT show the add-new row ----
await page.click(".field:has-text('Brand / Company') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.fill(".search-list-input", "totally custom brand co"); // same name, different case
await page.waitForTimeout(200);
const addNewRowOnExactMatch = await page.$(".search-list-add-new");
check(!addNewRowOnExactMatch, "typing an exact (case-insensitive) match to an existing option hides the add-new row");
await page.click(".modal-close-btn");
await page.waitForSelector(".modal-card", { state: "hidden", timeout: 3000 });

// ---- 3. Enter key in the search box adds+selects directly, no click needed ----
await page.click(".field:has-text('Brand / Company') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.fill(".search-list-input", "Enter Key Brand");
await page.waitForSelector(".search-list-add-new", { timeout: 3000 });
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
brandValue = await page.$eval(".field:has-text('Brand / Company') .wheel-row-value", (el) => el.textContent.trim());
check(brandValue === "Enter Key Brand", `pressing Enter in the search box adds+selects the typed name (got "${brandValue}")`);

// ---- 4. Hybrid: brand-scoped hint text is preserved (previously only shown inside the now-removed prompt modal) ----
// Note: unlike Brand/Company, Trait, and Seed Treatment (which always have
// some preset options), this brand-new custom Brand has ZERO hybrids yet,
// so ".search-list-option" rows won't exist at all — wait on the always-
// present search input instead.
await page.click(".field:has-text('Hybrid') .wheel-row-header");
await page.waitForSelector(".search-list-input", { timeout: 3000 });
const hybridHint = await page.$eval(".search-list-add-new-hint", (el) => el.textContent.trim());
check(
  hybridHint.includes("Enter Key Brand") && hybridHint.includes("permanently"),
  `Hybrid's add-new hint still mentions it's scoped to the selected Brand (got "${hybridHint}")`
);
await page.fill(".search-list-input", "Totally Custom Hybrid XYZ");
await page.waitForSelector(".search-list-add-new", { timeout: 3000 });
await page.click(".search-list-add-new");
await page.waitForTimeout(200);
const hybridValue = await page.$eval(".field:has-text('Hybrid') .wheel-row-value", (el) => el.textContent.trim());
check(hybridValue === "Totally Custom Hybrid XYZ", `Hybrid also supports inline type-to-add (got "${hybridValue}")`);

// ---- 5. Trait ----
await page.click(".field:has-text('Trait') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.fill(".search-list-input", "Totally Custom Trait XYZ");
await page.waitForSelector(".search-list-add-new", { timeout: 3000 });
await page.click(".search-list-add-new");
await page.waitForTimeout(200);
const traitValue = await page.$eval(".field:has-text('Trait') .wheel-row-value", (el) => el.textContent.trim());
check(traitValue === "Totally Custom Trait XYZ", `Trait also supports inline type-to-add (got "${traitValue}")`);

// ---- 6. Seed Treatment ----
await page.click(".field:has-text('Seed Treatment') .wheel-row-header");
await page.waitForSelector(".search-list-option", { timeout: 3000 });
await page.fill(".search-list-input", "Totally Custom Seed Treatment XYZ");
await page.waitForSelector(".search-list-add-new", { timeout: 3000 });
await page.click(".search-list-add-new");
await page.waitForTimeout(200);
const seedTreatmentValue = await page.$eval(".field:has-text('Seed Treatment') .wheel-row-value", (el) => el.textContent.trim());
check(
  seedTreatmentValue === "Totally Custom Seed Treatment XYZ",
  `Seed Treatment also supports inline type-to-add (got "${seedTreatmentValue}")`
);

// ---- 7. A picker with no onAddNew (e.g. RM's wheel) is untouched — RM never had this UX and still doesn't ----
const rmHasAddNewHint = await page.evaluate(() => {
  const rmRow = Array.from(document.querySelectorAll(".field")).find((f) => f.textContent.includes("Relative Maturity"));
  return rmRow ? rmRow.querySelector(".search-list-add-new-hint") : null;
});
check(!rmHasAddNewHint, "RM (a fixed 75-120 wheel, not a searchable list) has no add-new hint — it was never part of this UX");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
