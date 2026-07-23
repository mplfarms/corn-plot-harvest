// Verifies the "All Plots (Admin)" button on the branded Home Screen
// (plotChooser.js): hidden for a non-admin session, shown for an admin
// session, navigates to the admin-plots screen, and that screen's Back
// button returns to the Home Screen (not the deeper Plot Workspace menu).
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

// ---- Non-admin: no button shown ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Regular User", email: "regular@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  const btnLabels = await page.$$eval(".home-actions .home-btn", (els) => els.map((el) => el.textContent.trim()));
  check(!btnLabels.some((t) => t.includes("All Plots")), `non-admin does NOT see the "All Plots (Admin)" button (got ${JSON.stringify(btnLabels)})`);
  await page.close();
}

// ---- Admin: button shown, navigates, loads, and Back returns Home ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && u.includes("scope=all")) {
        return new Response(
          JSON.stringify({
            users: [
              { email: "admin@example.com", name: "Admin User", trials: [] },
              {
                email: "jamie@example.com",
                name: "Jamie Farmer",
                trials: [{ header: { cooperatorName: "Jamie's Farm" }, entries: [{ id: "e1" }, { id: "e2" }] }],
              },
            ],
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });

  const btnLabels = await page.$$eval(".home-actions .home-btn", (els) => els.map((el) => el.textContent.trim()));
  check(btnLabels.some((t) => t.includes("All Plots")), `admin DOES see the "All Plots (Admin)" button (got ${JSON.stringify(btnLabels)})`);

  await page.click("text=All Plots (Admin)");
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });
  const cardHeaders = await page.$$eval(".admin-plots-screen .admin-user-header-name", (els) => els.map((e) => e.textContent));
  check(
    cardHeaders.includes("Admin User") && cardHeaders.includes("Jamie Farmer"),
    `admin-plots screen loads and lists every user (got ${JSON.stringify(cardHeaders)})`
  );

  const backBtn = page.locator('.top-bar-btn[aria-label="Back"]');
  await backBtn.click();
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  check(true, "admin-plots screen's Back button returns to the Home Screen (#/plot-chooser)");

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
