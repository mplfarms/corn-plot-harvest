// Verifies the current (simplified, per explicit request) behavior of
// "Add Another Entry" / "Add Another Hybrid" (see
// trialStore.addEntryCarryingMeasurements()): Brand / Company still
// defaults to whichever Brand View is selected (Midwest or NC+), Strip
// Length/Number of Rows/Width still carry forward from the previous
// entry, but Hybrid, Relative Maturity, and Trait are left BLANK — not
// carried forward, not auto-advanced to a "next" product — so every
// entry after the first gets a deliberate, fresh pick. Also checks Seed
// Treatment's placeholder text, which spells out that leaving it blank
// is fine.
//
// This supersedes the short-lived "step RM up to the next-maturity
// product" behavior from a prior build (see git history /
// e2e_entry_hybrid_rm_progression.mjs, now removed) — that approach was
// tried and explicitly walked back in favor of this simpler one.
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

async function readEntries(page) {
  return page.evaluate(async () => {
    const trialStore = await import("/js/ui/stores/trialStore.js");
    return trialStore.getState().entries;
  });
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

// ---- First entry keeps its existing RM-100 default (unaffected) ----
let entries = await readEntries(page);
check(entries.length === 1, "first entry created");
check(entries[0].relativeMaturity === "100", `first entry still defaults RM to 100 (got "${entries[0].relativeMaturity}")`);
check(entries[0].hybrid !== "", `first entry still gets a default Hybrid (got "${entries[0].hybrid}")`);

// Set measurement fields on entry 1 so we can confirm they still carry
// forward to entry 2 below.
await page.evaluate(async () => {
  const trialStore = await import("/js/ui/stores/trialStore.js");
  const id = trialStore.getState().entries[0].id;
  trialStore.updateEntry(id, { stripLengthFeet: "300", numberOfRows: "4", widthInches: "30" });
});

// ---- 2nd entry: Brand defaults, Hybrid/RM/Trait are BLANK, measurements carry ----
await page.click("text=+ Add Another Entry");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
entries = await readEntries(page);
check(entries.length === 2, "a 2nd entry was added");
const e2 = entries[1];
check(e2.brand === "Midwest Seed Genetics", `2nd entry's Brand still defaults to the selected Brand View (got "${e2.brand}")`);
check(e2.hybrid === "", `2nd entry's Hybrid is blank, not carried/advanced (got "${e2.hybrid}")`);
check(e2.relativeMaturity === "", `2nd entry's Relative Maturity is blank, not carried/advanced (got "${e2.relativeMaturity}")`);
check(e2.trait === "", `2nd entry's Trait is blank (got "${e2.trait}")`);
check(
  e2.stripLengthFeet === "300" && e2.numberOfRows === "4" && e2.widthInches === "30",
  `2nd entry's measurements (Strip Length/Rows/Width) still carry forward from the 1st (got ${JSON.stringify({
    stripLengthFeet: e2.stripLengthFeet,
    numberOfRows: e2.numberOfRows,
    widthInches: e2.widthInches,
  })})`
);

// Hybrid and RM fields should visibly show their "Select…" placeholder,
// not a stale value, and the Hybrid field should NOT be disabled (Brand
// is already filled in).
const hybridValueText = await page.$eval(".field:has-text('Hybrid') .wheel-row-value", (el) => el.textContent.trim());
check(hybridValueText === "Select…", `Hybrid row visibly shows the blank placeholder (got "${hybridValueText}")`);
const hybridDisabledReason = await page.$(".wheel-disabled-reason");
check(!hybridDisabledReason, "Hybrid row is not disabled on a freshly added 2nd+ entry (Brand is pre-filled)");
const rmValueText = await page.$eval(".field:has-text('Relative Maturity') .wheel-row-value", (el) => el.textContent.trim());
check(rmValueText === "Select…", `RM row visibly shows the blank placeholder (got "${rmValueText}")`);

// ---- Seed Treatment's placeholder spells out that blank is OK ----
const seedTreatmentValueText = await page.$eval(
  ".field:has-text('Seed Treatment') .wheel-row-value",
  (el) => el.textContent.trim()
);
check(
  seedTreatmentValueText === "Select or leave blank if unknown",
  `Seed Treatment's placeholder spells out that leaving it blank is fine (got "${seedTreatmentValueText}")`
);

// ---- "Add Another Hybrid" (from the Entries list) behaves the same way ----
await page.goto(`${BASE}/index.html?r=1#/entries`);
await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
await page.click("text=Add Another Hybrid");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
entries = await readEntries(page);
check(entries.length === 3, "Add Another Hybrid also adds a new entry");
const e3 = entries[2];
check(e3.brand === "Midwest Seed Genetics", `"Add Another Hybrid" also defaults Brand (got "${e3.brand}")`);
check(
  e3.hybrid === "" && e3.relativeMaturity === "" && e3.trait === "",
  `"Add Another Hybrid" also leaves Hybrid/RM/Trait blank (got ${JSON.stringify({
    hybrid: e3.hybrid,
    relativeMaturity: e3.relativeMaturity,
    trait: e3.trait,
  })})`
);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
