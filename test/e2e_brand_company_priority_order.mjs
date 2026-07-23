// Verifies the Brand / Company picker's requested fixed display order
// (see COMPANY_PRIORITY_ORDER / orderCompaniesForBrandView in
// listsStore.js): whichever Brand View is currently selected leads the
// list, then a fixed sequence of the most-used companies in the exact
// order Mike asked for, with everything else falling after, unordered.
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

// The exact sequence requested (excluding Midwest Seed Genetics / NC+
// Hybrids, which are prepended dynamically based on the selected Brand
// View) — mirrors COMPANY_PRIORITY_ORDER in listsStore.js verbatim.
const PRIORITY_ORDER = [
  "Dekalb",
  "Pioneer",
  "Golden Harvest",
  "Channel",
  "Agrigold",
  "LG Seed",
  "Brevant Seeds",
  "Hoegemeyer",
  "Becks",
  "Dyna-Gro",
  "Mustang Seeds",
  "NuTech Seed",
  "Croplan",
  "Innvictis",
  "Republic",
  "Dairyland Seed",
  "Rob See Co",
  "Crow's",
  "AgVenture",
  "Wyffels",
  "Latham Hi-Tech Seeds",
  "NK Brand",
  "Stine",
  "Thunder Seed",
  "Jacobsen Seeds",
  "Legend Seeds",
  "Champion Seed",
  "Ohlde",
  "Integra",
  "Prairie Valley",
  "AP Select",
  "Renk Seed",
  "Peterson Farms Seed",
  "Legacy Seeds",
  "Enestvedt",
  "FS InVISION",
  "Frontiersman",
  "Super Crost",
  "Hefty Seed",
  "Enogen",
];

async function openBrandOptionsFor(page, brandId, expectedLeadName) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((id) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify(id));
    localStorage.setItem(
      "cph.authSession",
      JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false })
    );
  }, brandId);
  await page.goto(`${BASE}/index.html?r=${brandId}#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  await page.click("text=Continue to Hybrid Entries");
  await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
  // Brand / Company is now a searchable list picker (tap opens a modal
  // with the keyboard up — see searchListPicker.js), not the old wheel —
  // an empty search query shows the full, unfiltered option list.
  await page.click(".field:has-text('Brand / Company') .wheel-row-header");
  await page.waitForSelector(".search-list-option", { timeout: 3000 });
  // The tap-guard debounce (see dom.js createTapGuard/debounceGuard) can
  // swallow a click that lands within ~80ms of the panel opening in
  // automated timing — not relevant here since we're only reading text,
  // but a short settle avoids reading options mid-render.
  await page.waitForTimeout(150);
  const names = await page.$$eval(".search-list-option", (els) =>
    els.map((el) => el.textContent.trim()).filter((t) => !t.startsWith("+ Add New"))
  );
  await page.keyboard.press("Escape");
  check(names.length > 0, `${brandId}: wheel options list is non-empty`);
  check(names[0] === expectedLeadName, `${brandId}: first option is "${expectedLeadName}" (got "${names[0]}")`);
  return names;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

// ---- Midwest Seed Genetics view ----
const midwestNames = await openBrandOptionsFor(page, "midwestSeedGenetics", "Midwest Seed Genetics");
const midwestAfterLead = midwestNames.slice(1);
const midwestPriorityPositions = PRIORITY_ORDER.map((name) => midwestAfterLead.indexOf(name));
check(
  midwestPriorityPositions.every((p) => p !== -1),
  "Midwest view: every priority-order company is present in the list"
);
const midwestPriorityOnly = midwestAfterLead.filter((n) => PRIORITY_ORDER.includes(n));
check(
  JSON.stringify(midwestPriorityOnly) === JSON.stringify(PRIORITY_ORDER),
  "Midwest view: priority companies appear in exactly the requested order"
);
// Anything not in the priority list (or the leading brand) should sort
// after every priority-order company.
const lastPriorityIndex = Math.max(...PRIORITY_ORDER.map((name) => midwestAfterLead.indexOf(name)));
const tailNames = midwestAfterLead.slice(lastPriorityIndex + 1);
check(
  tailNames.every((n) => !PRIORITY_ORDER.includes(n)),
  "Midwest view: nothing after the last priority company is itself a priority company"
);

// ---- NC+ Hybrids view ----
const ncPlusNames = await openBrandOptionsFor(page, "ncPlus", "NC+ Hybrids");
const ncPlusAfterLead = ncPlusNames.slice(1);
const ncPlusPriorityOnly = ncPlusAfterLead.filter((n) => PRIORITY_ORDER.includes(n));
check(
  JSON.stringify(ncPlusPriorityOnly) === JSON.stringify(PRIORITY_ORDER),
  "NC+ view: priority companies appear in exactly the requested order"
);
check(
  !ncPlusAfterLead.includes("Midwest Seed Genetics") || ncPlusAfterLead.indexOf("Midwest Seed Genetics") > 0,
  "NC+ view: Midwest Seed Genetics is not forced to the front when NC+ is the selected view"
);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
