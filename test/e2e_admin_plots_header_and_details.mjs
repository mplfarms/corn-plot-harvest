// Verifies the redesigned "All Plots (Admin)" card header (adminPlots.js):
// each card shows the user's name above their email (falling back to just
// the email when no name is on file, rather than showing it twice), and a
// "☰" button on the far right opens a popover with that user's First
// Name, Last Name, Email, and Phone. The server-side sort order
// (admin-first, then alphabetical by last name — see plots.js's
// handleGetAll / _shared.js's sortUsersAdminFirst) is unit-tested
// directly in unit_auth_functions.mjs; this test only confirms the
// client renders cards in whatever order the mocked response returns,
// since adminPlots.js trusts the server's ordering rather than re-sorting.
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

await page.addInitScript(() => {
  window.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/plots") && u.includes("scope=all")) {
      return new Response(
        JSON.stringify({
          users: [
            {
              email: "admin@example.com",
              name: "Admin User",
              firstName: "Admin",
              lastName: "User",
              mobileNumber: "(555) 000-1111",
              isAdmin: true,
              trials: [],
            },
            {
              email: "amy@example.com",
              name: "Amy Anders",
              firstName: "Amy",
              lastName: "Anders",
              mobileNumber: "",
              isAdmin: false,
              trials: [{ header: { cooperatorName: "Amy's Plot" }, entries: [{ id: "e1" }] }],
            },
            // No name on file at all — the header should show the email
            // just once, not twice.
            { email: "noname@example.com", name: "noname@example.com", firstName: "", lastName: "", mobileNumber: "", isAdmin: false, trials: [] },
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
await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
await page.waitForSelector(".card", { timeout: 5000 });

// ---- Name above email, two lines, for a user with a real name on file ----
const cards = await page.$$(".admin-plots-screen .card");
check(cards.length === 3, `all three registered users get their own card (got ${cards.length})`);

const amyCard = cards[1];
const amyName = await amyCard.$eval(".admin-user-header-name", (el) => el.textContent);
const amyEmailLine = await amyCard.$eval(".admin-user-header-email", (el) => el.textContent);
check(amyName === "Amy Anders", `Amy's card shows her name (got "${amyName}")`);
check(amyEmailLine === "amy@example.com", `Amy's card shows her email on its own line below the name (got "${amyEmailLine}")`);

// ---- No separate name on file -> email shown once, not twice ----
const nonameCard = cards[2];
const nonameName = await nonameCard.$eval(".admin-user-header-name", (el) => el.textContent);
check(nonameName === "noname@example.com", `an account with no name shows just the email as the header (got "${nonameName}")`);
const nonameEmailLine = await nonameCard.$(".admin-user-header-email");
check(!nonameEmailLine, "that same card does NOT also show a separate (duplicate) email line");

// ---- The "☰" details button ----
const menuButtons = await page.$$(".admin-user-menu-btn");
check(menuButtons.length === 3, `every card has its own "☰" details button (got ${menuButtons.length})`);

await menuButtons[1].click(); // Amy's card
await page.waitForSelector(".modal-card", { timeout: 5000 });
const modalTitle = await page.$eval(".modal-title", (el) => el.textContent);
check(modalTitle === "User Details", `tapping "☰" opens a "User Details" popover (got "${modalTitle}")`);

const detailText = await page.$eval(".admin-user-detail-body", (el) => el.textContent);
check(detailText.includes("First Name: Amy"), `the popover shows First Name (got ${JSON.stringify(detailText)})`);
check(detailText.includes("Last Name: Anders"), `the popover shows Last Name (got ${JSON.stringify(detailText)})`);
check(detailText.includes("Email: amy@example.com"), `the popover shows Email (got ${JSON.stringify(detailText)})`);
check(detailText.includes("Phone: —"), `the popover shows a "—" placeholder for a missing phone number (got ${JSON.stringify(detailText)})`);

await page.click(".modal-close-btn");
await page.waitForSelector(".modal-card", { state: "hidden", timeout: 5000 }).catch(() => {});

// Admin's own card DOES have a phone number on file — confirm it shows.
await menuButtons[0].click();
await page.waitForSelector(".modal-card", { timeout: 5000 });
const adminDetailText = await page.$eval(".admin-user-detail-body", (el) => el.textContent);
check(adminDetailText.includes("Phone: (555) 000-1111"), `a user's actual phone number shows when on file (got ${JSON.stringify(adminDetailText)})`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
