// Verifies the Plot Summary header card (cooperator name + year/state/
// county, with the brand logo) expands/collapses an inline, read-only
// recap of the rest of Plot Details right below it when tapped — blank
// fields are skipped, and an "Edit Plot Details" button inside the
// expanded panel is the actual way in to change anything. See
// plotSummary.js's headerCard/detailsPanel/toggleDetails.
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

function seedEntries() {
  return [150, 180, 210].map((y, i) => ({
    id: `e${i}`,
    brand: "Midwest Seed Genetics",
    hybrid: `H${i}`,
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
    manualDryYield: String(y),
  }));
}

// ---- Expand/collapse in place (no navigation), populated fields shown, blanks skipped ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((entries) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "t1",
        header: {
          cooperatorName: "Mike Lage",
          state: "IA",
          county: "Monona",
          address: "456 County Rd",
          city: "Onawa",
          zip: "51040",
          tillage: "No-Till",
          irrigation: "",
          soilType: "",
          previousCrop: "Soybeans",
          plantingPopulation: "34000",
          collectedBy: "",
          phone: "",
          email: "",
          dryingShrinkRate: 0.06,
          pricePerBushel: 3.5,
          trialNotes: "Hail damage on the east end.",
        },
        entries,
      })
    );
  }, seedEntries());

  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  const cardTag = await page.$eval(".summary-header-card", (el) => el.tagName);
  check(cardTag === "BUTTON", `the header card renders as a real button (got ${cardTag})`);

  const initiallyHidden = await page.$eval(".plot-details-summary-panel", (el) => getComputedStyle(el).display);
  check(initiallyHidden === "none", `the details panel starts collapsed (got display:${initiallyHidden})`);
  const initialAriaExpanded = await page.$eval(".summary-header-card", (el) => el.getAttribute("aria-expanded"));
  check(initialAriaExpanded === "false", `aria-expanded starts false (got ${initialAriaExpanded})`);

  await page.locator(".summary-header-card").click();
  await page.waitForTimeout(150); // clear the tap-guard window before the assertions below

  const hashAfterClick = await page.evaluate(() => window.location.hash);
  check(hashAfterClick === "#/plot-summary", `tapping the header card does NOT navigate away (got hash "${hashAfterClick}")`);

  const expandedDisplay = await page.$eval(".plot-details-summary-panel", (el) => getComputedStyle(el).display);
  check(expandedDisplay !== "none", "the details panel is visible after tapping once");
  const ariaExpandedTrue = await page.$eval(".summary-header-card", (el) => el.getAttribute("aria-expanded"));
  check(ariaExpandedTrue === "true", `aria-expanded flips to true (got ${ariaExpandedTrue})`);
  const chevronRotated = await page.$eval(".summary-header-card .chooser-row-chevron", (el) =>
    el.classList.contains("chooser-row-chevron-expanded")
  );
  check(chevronRotated, "the chevron gets the rotated/expanded class");

  const panelText = await page.$eval(".plot-details-summary-panel", (el) => el.textContent);
  check(panelText.includes("456 County Rd"), `the expanded panel shows populated fields (Address, got "${panelText}")`);
  check(panelText.includes("Onawa"), "the expanded panel shows City");
  check(panelText.includes("No-Till"), "the expanded panel shows Tillage");
  check(panelText.includes("Hail damage on the east end."), "the expanded panel shows Plot Notes");
  check(!panelText.includes("Irrigation"), "a blank field (Irrigation) is skipped entirely, not shown empty");
  check(!panelText.includes("Soil Type"), "a blank field (Soil Type) is skipped entirely, not shown empty");

  await page.locator(".summary-header-card").click();
  await page.waitForTimeout(150);
  const collapsedAgain = await page.$eval(".plot-details-summary-panel", (el) => getComputedStyle(el).display);
  check(collapsedAgain === "none", "tapping the card again collapses the panel");
  const ariaExpandedFalseAgain = await page.$eval(".summary-header-card", (el) => el.getAttribute("aria-expanded"));
  check(ariaExpandedFalseAgain === "false", "aria-expanded flips back to false");

  // Expand once more and use the "Edit Plot Details" link inside the panel.
  await page.locator(".summary-header-card").click();
  await page.waitForTimeout(150);
  await page.locator(".plot-details-summary-edit-btn").click();
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });
  const hashAfterEdit = await page.evaluate(() => window.location.hash);
  check(hashAfterEdit === "#/trial-details", `the "Edit Plot Details" button inside the panel navigates there (got hash "${hashAfterEdit}")`);
  const nameFieldValue = await page.$eval("input.text-input", (el) => el.value).catch(() => null);
  check(nameFieldValue === "Mike Lage", `Plot Details opens showing the SAME plot (got "${nameFieldValue}")`);

  await page.close();
}

// ---- A plot with nothing else filled in shows the empty-state message ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((entries) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t2", header: { cooperatorName: "Bare Plot", state: "IA", county: "" }, entries })
    );
  }, seedEntries());

  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  await page.locator(".summary-header-card").click();
  await page.waitForTimeout(150);
  const panelText = await page.$eval(".plot-details-summary-panel", (el) => el.textContent);
  check(panelText.includes("No other plot details entered yet."), `a plot with nothing else filled in shows the empty-state note (got "${panelText}")`);
  check(panelText.includes("Edit Plot Details"), "the Edit Plot Details button still shows even with nothing else to display");

  await page.close();
}

// ---- Still works (and doesn't crash) mid admin-edit ----
// adminEditStore's session lives in memory only (not localStorage), and
// a page.goto() to a new hash is a full reload that would wipe it — so,
// same as e2e_admin_plot_edit.mjs, this drives entirely through real UI
// clicks (SPA in-page navigation) rather than page.goto after starting
// the session.
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const jamieTrial = {
    id: "jamie-trial-1",
    header: { cooperatorName: "Jamie's Farm", state: "IA", county: "Story" },
    entries: seedEntries(),
  };
  await page.addInitScript((trial) => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && (!options || options.method !== "PUT")) {
        if (u.includes("scope=all")) {
          return new Response(
            JSON.stringify({
              users: [
                { email: "admin@example.com", name: "Admin User", trials: [] },
                { email: "jamie@example.com", name: "Jamie Farmer", trials: [trial] },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  }, jamieTrial);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });

  await page.click("text=Jamie's Farm");
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  await page.click("text=Plot Summary & Results");
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  await page.locator(".summary-header-card").click();
  await page.waitForTimeout(150);
  const expandedDisplay = await page.$eval(".plot-details-summary-panel", (el) => getComputedStyle(el).display);
  check(expandedDisplay !== "none", "the header card still expands in place during an admin edit");

  await page.locator(".plot-details-summary-edit-btn").click();
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });
  const hash = await page.evaluate(() => window.location.hash);
  check(hash === "#/trial-details", `the Edit Plot Details button also works during an admin edit (got hash "${hash}")`);
  const nameFieldValue = await page.$eval("input.text-input", (el) => el.value).catch(() => null);
  check(nameFieldValue === "Jamie's Farm", `Plot Details opens showing the OWNER's plot being edited, not the admin's own (got "${nameFieldValue}")`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
