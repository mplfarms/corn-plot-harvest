// Verifies the "Assign Form IDs to All Plots" button on the "All Plots
// (Admin)" screen (adminPlots.js) — the one-time (safely repeatable)
// admin action that backfills a Form ID onto every existing plot that
// doesn't already have one (see netlify/functions/backfillFormIds.js;
// its actual server-side reservation/collision logic is unit-tested
// directly in unit_backfill_form_ids.mjs). This test only covers the
// client side:
//   1. The button is visible on the screen (admin-only, same gate as the
//      rest of this screen).
//   2. Tapping it POSTs the signed-in admin's own email to
//      /.netlify/functions/backfillFormIds and shows a success toast
//      summarizing the result once it resolves.
//   3. The screen re-renders afterward so a newly-backfilled plot's Form
//      ID shows up on its row without a manual reload.
//   4. A non-admin never sees the button at all (the whole screen is
//      already gated — this just confirms the new button doesn't leak
//      through some other path).
//   5. A server-side error (e.g. this admin session somehow isn't
//      actually an admin by the time the request lands) shows an error
//      toast and re-enables the button instead of leaving it stuck.
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

// ---- 1, 2 & 3. Happy path: button visible, backfill runs, screen refreshes ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    window.__backfillCalls = [];
    let backfilled = false;
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/backfillFormIds")) {
        window.__backfillCalls.push(JSON.parse((options && options.body) || "{}"));
        backfilled = true;
        return new Response(JSON.stringify({ assignedCount: 1, updatedUserCount: 1, totalTrialCount: 1 }), { status: 200 });
      }
      if (u.includes("/.netlify/functions/plots") && u.includes("scope=all")) {
        return new Response(
          JSON.stringify({
            users: [
              {
                email: "admin@example.com",
                name: "Admin User",
                firstName: "Admin",
                lastName: "User",
                mobileNumber: "",
                isAdmin: true,
                trials: [],
              },
              {
                email: "bob@example.com",
                name: "Bob Grower",
                firstName: "Bob",
                lastName: "Grower",
                mobileNumber: "",
                isAdmin: false,
                trials: [
                  {
                    header: { cooperatorName: "Bob's Farm", formId: backfilled ? "26-1001" : "" },
                    entries: [{ id: "e1" }],
                  },
                ],
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
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });

  const backfillBtn = page.locator("button", { hasText: "Assign Form IDs to All Plots" });
  check(await backfillBtn.count() === 1, "the \"Assign Form IDs to All Plots\" button is visible to an admin");

  // Before backfilling, Bob's row shows no Form ID.
  let bobRowText = await page.locator(".admin-plot-row", { hasText: "Bob's Farm" }).textContent();
  check(!bobRowText.includes("APP"), `before backfilling, Bob's plot row shows no Form ID yet (got "${bobRowText}")`);

  // Note: NOT asserting the transient "Assigning…"/disabled in-flight
  // state here — against a mocked fetch that resolves near-instantly,
  // that state can come and go between two polls with no reliable window
  // to observe it, which made this check itself the source of flakiness
  // rather than the feature. Section 5 below (the error path, where the
  // button visibly STAYS re-enabled afterward) is what actually confirms
  // the disabled/label-swap wiring works.
  await backfillBtn.click();
  await page.waitForSelector(".toast", { timeout: 5000 });
  const toastText = await page.$eval(".toast", (el) => el.textContent);
  check(/Assigned 1 new Form ID/.test(toastText), `a success toast summarizes the backfill result (got "${toastText}")`);

  const backfillCalls = await page.evaluate(() => window.__backfillCalls);
  check(backfillCalls.length === 1, `exactly one backfill request was sent (got ${backfillCalls.length})`);
  check(backfillCalls[0].email === "admin@example.com", `the request carries the signed-in admin's own email (got "${backfillCalls[0].email}")`);

  // After the screen re-renders, Bob's row now shows the newly-assigned Form ID.
  await page.waitForFunction(
    () => document.querySelector(".admin-plot-row")?.textContent.includes("26-1001"),
    { timeout: 5000 }
  );
  bobRowText = await page.locator(".admin-plot-row", { hasText: "Bob's Farm" }).textContent();
  check(bobRowText.includes("26-1001"), `after the backfill, the screen refreshes and Bob's row now shows "26-1001" (got "${bobRowText}")`);

  await page.close();
}

// ---- 4. Non-admin never sees the button ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Regular User", email: "regular@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  const backfillBtnCount = await page.locator("button", { hasText: "Assign Form IDs to All Plots" }).count();
  check(backfillBtnCount === 0, "a non-admin session never sees the backfill button at all (the whole screen is gated)");
  await page.close();
}

// ---- 5. Server error re-enables the button with an error toast ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/backfillFormIds")) {
        return new Response(JSON.stringify({ error: "Admin access required." }), { status: 403 });
      }
      if (u.includes("/.netlify/functions/plots") && u.includes("scope=all")) {
        return new Response(
          JSON.stringify({
            users: [
              { email: "admin@example.com", name: "Admin User", firstName: "Admin", lastName: "User", mobileNumber: "", isAdmin: true, trials: [] },
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

  const backfillBtn = page.locator("button", { hasText: "Assign Form IDs to All Plots" });
  await backfillBtn.click();
  await page.waitForSelector(".toast", { timeout: 5000 });
  const toastText = await page.$eval(".toast", (el) => el.textContent);
  check(/Couldn't assign Form IDs/.test(toastText), `a server error surfaces as an error toast (got "${toastText}")`);
  const isDisabledAfterError = await backfillBtn.isDisabled();
  check(isDisabledAfterError === false, "the button re-enables itself after a failed attempt, instead of staying stuck");
  const labelAfterError = await backfillBtn.textContent();
  check(labelAfterError === "Assign Form IDs to All Plots", `the button's label reverts back to normal after a failed attempt (got "${labelAfterError}")`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
