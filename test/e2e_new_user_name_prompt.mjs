// Verifies the new-user "Welcome!" details form on the launch screen
// (accountScreen.js / newUserDetailsModal.js): a first-time email
// (server reports isNewUser: true) triggers a form asking for First
// Name, Last Name, and Mobile Number (with the Email they just signed in
// with shown, read-only, for reference), whose answers are sent back via
// a second auth call; a returning email (isNewUser: false) never sees
// the form at all; skipping it still lets sign-in continue normally.
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

function mockAuthOnce(page) {
  return page.addInitScript(() => {
    let callCount = 0;
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/auth")) {
        const payload = JSON.parse((options && options.body) || "{}");
        window.__recordAuthCall && window.__recordAuthCall(payload);
        callCount++;
        // First call for this email: brand new. Any call carrying
        // firstName/lastName/mobileNumber is the follow-up.
        const isNewUser = callCount === 1;
        const name = [payload.firstName, payload.lastName].filter(Boolean).join(" ") || payload.email.toLowerCase();
        return new Response(
          JSON.stringify({
            user: {
              name,
              email: payload.email.toLowerCase(),
              isAdmin: false,
              firstName: payload.firstName || "",
              lastName: payload.lastName || "",
              mobileNumber: payload.mobileNumber || "",
            },
            isNewUser,
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });
}

// ---- New user: form appears with 4 fields, answering it sends a follow-up call ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const authCalls = [];
  await page.exposeFunction("__recordAuthCall", (payload) => authCalls.push(payload));
  await mockAuthOnce(page);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/index.html?r=1#/account`);
  await page.waitForSelector(".launch-screen");

  await page.fill("#account-email-input", "newperson@gmail.com");
  await page.click(".launch-form-body .btn-primary");

  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const modalTitle = await page.$eval(".modal-title", (el) => el.textContent);
  check(modalTitle === "Welcome!", `a new user is shown a "Welcome!" details form (got "${modalTitle}")`);

  const fieldLabels = await page.$$eval(".new-user-details-body .field-label", (els) => els.map((e) => e.textContent));
  check(
    JSON.stringify(fieldLabels) === JSON.stringify(["First Name", "Last Name", "Mobile Number", "Email"]),
    `the form asks for First Name, Last Name, Mobile Number, and Email (got ${JSON.stringify(fieldLabels)})`
  );

  const emailFieldValue = await page.$eval(".new-user-details-body input[type=email]", (el) => el.value);
  check(emailFieldValue === "newperson@gmail.com", `the Email field is pre-filled with what was just typed (got "${emailFieldValue}")`);
  const emailFieldDisabled = await page.$eval(".new-user-details-body input[type=email]", (el) => el.disabled);
  check(emailFieldDisabled === true, "the Email field is read-only (it's already the account's identity)");

  const inputs = await page.$$(".new-user-details-body .text-input:not([disabled])");
  check(inputs.length === 3, `three editable fields — First Name, Last Name, Mobile Number (got ${inputs.length})`);
  await inputs[0].fill("Pat");
  await inputs[1].fill("Newperson");
  await inputs[2].fill("(555) 111-2222");

  await page.locator(".modal-actions .btn-primary", { hasText: "Continue" }).click();

  // Unrecognized domain (gmail.com) -> the manual Brand View picker, same as always.
  await page.waitForSelector(".brand-select-screen", { timeout: 5000 });
  check(true, "after answering the form, the normal unrecognized-domain routing still happens");

  check(authCalls.length === 2, `two auth calls were made — the initial sign-in and the details follow-up (got ${authCalls.length})`);
  check(!authCalls[0].firstName && !authCalls[0].lastName, "the first (sign-in) call carries no name fields");
  check(
    authCalls[1] && authCalls[1].firstName === "Pat" && authCalls[1].lastName === "Newperson" && authCalls[1].mobileNumber === "(555) 111-2222",
    `the second call carries the answered First Name/Last Name/Mobile Number (got ${JSON.stringify(authCalls[1])})`
  );

  await page.close();
}

// ---- New user: Skip still lets sign-in continue, with no follow-up call ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const authCalls = [];
  await page.exposeFunction("__recordAuthCall", (payload) => authCalls.push(payload));
  await mockAuthOnce(page);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/index.html?r=1#/account`);
  await page.waitForSelector(".launch-screen");

  await page.fill("#account-email-input", "skipper@nc-plus.com");
  await page.click(".launch-form-body .btn-primary");

  await page.waitForSelector(".modal-card", { timeout: 5000 });
  await page.locator(".modal-actions .btn-secondary", { hasText: "Skip" }).click();

  // Known domain -> straight to the Home Screen even without answering.
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  check(true, "tapping Skip still continues sign-in normally (known-domain routing)");
  check(authCalls.length === 1, `Skip sends no follow-up call — only the initial sign-in (got ${authCalls.length})`);

  await page.close();
}

// ---- Returning user: no form at all ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/auth")) {
        const payload = JSON.parse((options && options.body) || "{}");
        return new Response(
          JSON.stringify({
            user: { name: payload.email.toLowerCase(), email: payload.email.toLowerCase(), isAdmin: false, firstName: "", lastName: "", mobileNumber: "" },
            isNewUser: false,
          }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/index.html?r=1#/account`);
  await page.waitForSelector(".launch-screen");

  await page.fill("#account-email-input", "returning@nc-plus.com");
  await page.click(".launch-form-body .btn-primary");

  // Known domain -> straight to the Home Screen, no modal ever appears.
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  const modalShown = await page.$(".modal-card");
  check(!modalShown, "a returning user (isNewUser: false) is never shown the Welcome! form");

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
