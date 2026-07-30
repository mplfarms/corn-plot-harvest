// Verifies Plot Details' City field as a searchable selection list (per
// explicit request: "a selection list of cities by state, that acts like
// the selection lists for the companies and hybrids, allowing the user
// to start typing to get closer to the scroll selection") — for entering
// details from a distant location, alongside the GPS nearest-town
// autofill. Covers: state-scoped town list, type-to-filter, pick fills
// City + Zip, inline add of a missing town, and the disabled-until-state
// behavior.
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

function fieldByLabel(page, label) {
  return page.locator(".field", { has: page.locator(".field-label", { hasText: new RegExp(`^${label}$`) }) });
}

async function openPlotDetails(page, header) {
  await page.addInitScript(() => {
    // No GPS in these scenarios — deny cleanly so the auto-locate
    // resolves before any interaction (same approach as
    // e2e_plot_details_labels_cleanup.mjs).
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_ok, err) => err && err({ code: 1, message: "denied (mocked)" }) },
    });
  });
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((hdr) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "tcp", header: hdr, entries: [] }));
  }, header);
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
}

// ---- 1. Pick a town: tap City -> searchable list of the state's towns,
//         type to filter, tap to pick; City AND Zip fill ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await openPlotDetails(page, {
    cooperatorName: "Test Coop",
    state: "IA",
    county: "Monona",
    city: "",
    zip: "",
    gpsLatitude: 41.893007,
    gpsLongitude: -96.090279,
  });

  const cityField = fieldByLabel(page, "City");
  const placeholder = await cityField.locator(".wheel-row-value").textContent();
  check(placeholder.trim() === "Select", `an empty City shows the plain "Select" placeholder like the other pickers (got "${placeholder.trim()}")`);

  await cityField.locator(".wheel-row-header").click();
  await page.waitForSelector(".search-list-input", { timeout: 3000 });
  const optionCountAll = await page.$$eval(".search-list-option", (els) => els.length);
  check(optionCountAll > 500, `the untyped list holds the whole state's towns to scroll (got ${optionCountAll} for Iowa)`);

  await page.fill(".search-list-input", "onaw");
  await page.waitForTimeout(100);
  // (The picker may also show its standard `+ Add "onaw"` row for the
  // partial query, same as the Hybrid picker — only the real matches
  // matter here.)
  const filtered = await page.$$eval(".search-list-option:not(.search-list-add-new)", (els) => els.map((el) => el.textContent));
  check(filtered.length === 1 && filtered[0] === "Onawa", `typing filters the scroll down like the Hybrid picker (got ${JSON.stringify(filtered)})`);

  await page.click(".search-list-option:not(.search-list-add-new)");
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.city === "Onawa" && t.header.zip === "51040";
    },
    { timeout: 5000 }
  );
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.city === "Onawa" && header.zip === "51040", `picking a town fills City and its Zip follows (got "${header.city}"/"${header.zip}")`);
  const shown = await cityField.locator(".wheel-row-value").textContent();
  check(shown.trim() === "Onawa", `the closed row shows the picked town (got "${shown.trim()}")`);

  await page.close();
}

// ---- 2. A town missing from the list can be typed and added inline ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await openPlotDetails(page, { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" });

  await fieldByLabel(page, "City").locator(".wheel-row-header").click();
  await page.waitForSelector(".search-list-input", { timeout: 3000 });
  await page.fill(".search-list-input", "Mikeville Corners");
  await page.waitForTimeout(100);
  const addRow = await page.$eval(".search-list-add-new", (el) => el.textContent).catch(() => null);
  check(addRow === '+ Add "Mikeville Corners"', `an unknown town offers the inline + Add row (got ${JSON.stringify(addRow)})`);
  await page.click(".search-list-add-new");
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.city === "Mikeville Corners";
    },
    { timeout: 5000 }
  );
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.city === "Mikeville Corners", `the added town is stored as typed (got "${header.city}")`);
  check(!(header.zip || "").trim(), `an off-list town has no known zip — Zip stays blank for manual entry (got "${header.zip}")`);

  await page.close();
}

// ---- 3. No state picked: City is disabled with the same reason style
//         as County ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await openPlotDetails(page, { cooperatorName: "Test Coop", state: "", county: "", city: "", zip: "" });

  const cityField = fieldByLabel(page, "City");
  const disabled = await cityField.locator(".wheel-row-header").isDisabled();
  check(disabled, "with no State picked, the City row is disabled");
  const reason = await cityField.locator(".wheel-disabled-reason").textContent();
  check(reason.trim() === "Select a state first", `the disabled City row explains itself like County does (got "${reason.trim()}")`);

  // Picking a state enables it.
  await fieldByLabel(page, "State").locator(".wheel-row-header").click();
  await page.waitForSelector(".wheel-panel:not(.hidden), .wheel-modal, .search-list-input", { timeout: 3000 }).catch(() => {});
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
