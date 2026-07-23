// Verifies the fix for "the back button doesn't always return to the
// previous screen": Settings, All Plots (Admin), Quick Start, and Plot
// Summary are all reachable from more than one place (the Settings gear
// sits on every top bar; All Plots (Admin) has a button on both the Home
// Screen and the Workspace menu; Quick Start is linked from the splash
// screen, Home, AND Help; Plot Summary is linked from the Workspace
// menu, a Saved Plots row, and "Return to Plot Summary" on Hybrid
// Entries) — see router.js's rememberedOriginFor(). Also checks that the
// remaining intentional hub-and-spoke screens (Plot Details/Hybrid
// Entries always returning to the Workspace menu) are left alone, and
// that the Workspace menu itself returns to All Plots (Admin) rather
// than Home during an admin-edit session.
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

async function signedInPage(overrides) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((over) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true, ...over }));
  }, overrides || {});
  return page;
}

const backBtn = (page) => page.locator('.top-bar-btn[aria-label="Back"]');

// ---- 1. Settings opened from Home returns to Home ----
{
  const page = await signedInPage();
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.locator(".top-bar-btn-settings").click();
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  check(true, "Settings opened from Home returns to Home on Back");
  await page.close();
}

// ---- 2. Settings opened from Saved Plots returns to Saved Plots (not the Workspace menu) ----
{
  const page = await signedInPage();
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  await page.locator(".top-bar-btn-settings").click();
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  check(true, "Settings opened from Saved Plots returns to Saved Plots, not hardcoded to the Workspace menu");
  await page.close();
}

// ---- 3. A detour through Help/Manage Users doesn't clobber Settings' real origin ----
{
  const page = await signedInPage();
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.locator(".top-bar-btn-settings").click();
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  await page.click("text=Help & How-To Guide");
  await page.waitForSelector(".help-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  check(true, "Settings -> Help -> Back -> Back still lands on Home, not lost after the Help detour");
  await page.close();
}

// ---- 4. All Plots (Admin) opened from Home returns to Home ----
{
  const page = await signedInPage();
  await page.addInitScript(() => {
    window.fetch = async (url) => {
      if (String(url).includes("scope=all")) return new Response(JSON.stringify({ users: [] }), { status: 200 });
      return new Response(JSON.stringify({ trials: [] }), { status: 200 });
    };
  });
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.click("text=All Plots (Admin)");
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  check(true, "All Plots (Admin) opened from Home returns to Home on Back");
  await page.close();
}

// ---- 5. All Plots (Admin) opened from the admin's OWN Workspace menu returns there, not Home ----
{
  const page = await signedInPage();
  await page.addInitScript(() => {
    window.fetch = async (url) => {
      if (String(url).includes("scope=all")) return new Response(JSON.stringify({ users: [] }), { status: 200 });
      return new Response(JSON.stringify({ trials: [] }), { status: 200 });
    };
  });
  await page.goto(`${BASE}/index.html?r=1#/workspace`);
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  await page.click("text=All Plots (Admin)");
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  check(true, "All Plots (Admin) opened from the admin's own Workspace menu returns there, not to Home");
  await page.close();
}

// ---- 6. Workspace menu reached via an admin-edit session returns to All Plots (Admin), not Home ----
{
  const page = await signedInPage();
  const jamieTrial = { id: "jamie-trial-1", header: { cooperatorName: "Jamie's Farm", state: "IA", county: "Story" }, entries: [] };
  await page.addInitScript((trial) => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && (!options || options.method !== "PUT")) {
        if (u.includes("scope=all")) {
          return new Response(
            JSON.stringify({ users: [{ email: "jamie@example.com", name: "Jamie Farmer", trials: [trial] }] }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  }, jamieTrial);

  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });
  await page.click("text=Jamie's Farm");
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  check(true, "the Workspace menu during an admin-edit session returns to All Plots (Admin), not the admin's own Home");
  await page.close();
}

// ---- 7. The hub-and-spoke screens are unaffected: Plot Details still always returns to the Workspace menu ----
{
  const page = await signedInPage();
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.click("text=Enter a New Plot");
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });
  // trial-details labels its Back button "Menu" (unaffected by this
  // change — see router.js's top comment), not the generic "Back".
  await page.locator('.top-bar-btn[aria-label="Menu"]').click();
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  check(true, "Plot Details (reached directly from Home, skipping the Workspace menu) still returns to the Workspace menu on Back — unchanged hub behavior");
  await page.close();
}

// ---- 8. Quick Start opened from Home returns to Home ----
{
  const page = await signedInPage();
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.click("text=Quick Start Guide");
  await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  check(true, "Quick Start opened from Home returns to Home on Back");
  await page.close();
}

// ---- 9. Quick Start opened from Help returns to Help, not Home ----
{
  const page = await signedInPage();
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.locator(".top-bar-btn-settings").click();
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  await page.click("text=Help & How-To Guide");
  await page.waitForSelector(".help-screen", { timeout: 5000 });
  await page.click("text=Show Me the Quick Start Guide Instead");
  await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".help-screen", { timeout: 5000 });
  check(true, "Quick Start opened from Help returns to Help, not to Home (previously a real bug — only signed-in-state was considered)");
  await page.close();
}

// ---- 10. Plot Summary opened from the Workspace menu returns there ----
{
  const page = await signedInPage();
  await page.evaluate(() => {
    localStorage.setItem(
      "cph.savedTrials",
      JSON.stringify([{ id: "t1", header: { cooperatorName: "Test Coop", state: "IA" }, entries: [], lastModified: "2026-01-01T00:00:00.000Z" }])
    );
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/workspace`);
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  await page.click("text=Plot Summary & Results");
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  check(true, "Plot Summary opened from the Workspace menu returns there on Back");
  await page.close();
}

// ---- 11. Plot Summary opened from a Saved Plots row returns to Saved Plots, not the Workspace menu ----
{
  const page = await signedInPage();
  await page.evaluate(() => {
    localStorage.setItem(
      "cph.savedTrials",
      JSON.stringify([{ id: "t1", header: { cooperatorName: "Test Coop", state: "IA" }, entries: [], lastModified: "2026-01-01T00:00:00.000Z" }])
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".entry-row", { timeout: 5000 });
  await page.click("text=Test Coop");
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  check(true, "Plot Summary opened from a Saved Plots row returns to Saved Plots on Back, not hardcoded to the Workspace menu");
  await page.close();
}

// ---- 12. Plot Summary opened via "Return to Plot Summary" on Hybrid Entries returns to Hybrid Entries ----
{
  const page = await signedInPage();
  await page.evaluate(() => {
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/entries`);
  await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
  await page.click("text=Return to Plot Summary");
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
  check(true, "Plot Summary opened via \"Return to Plot Summary\" on Hybrid Entries returns to Hybrid Entries on Back");
  await page.close();
}

// ---- 13. A detour through the "i" info icon (Plot Summary Help) doesn't clobber Plot Summary's real origin ----
{
  const page = await signedInPage();
  await page.evaluate(() => {
    localStorage.setItem(
      "cph.savedTrials",
      JSON.stringify([{ id: "t1", header: { cooperatorName: "Test Coop", state: "IA" }, entries: [], lastModified: "2026-01-01T00:00:00.000Z" }])
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".entry-row", { timeout: 5000 });
  await page.click("text=Test Coop");
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  await page.locator(".top-bar-btn-help").click();
  await page.waitForSelector(".plot-summary-help-screen", { timeout: 5000 });
  // plotSummaryHelp.js labels its own Back button "Plot Summary" (not the
  // generic "Back"), so it needs its own locator here.
  await page.locator('.top-bar-btn[aria-label="Plot Summary"]').click();
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  await backBtn(page).click();
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  check(true, "Plot Summary -> info icon -> Back -> Back still lands on Saved Plots, not lost after the help detour");
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
