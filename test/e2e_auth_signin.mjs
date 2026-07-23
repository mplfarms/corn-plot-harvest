// Verifies the email-only sign-in form (no name field, no password, no
// email verification, no shared team passcode — dropped per explicit
// request): client-side validation, server-error surfacing, and that a
// successful sign-in persists a local session and routes into the
// branded Home Screen (plotChooser.js, #/plot-chooser). Also covers the
// "unrecognized email domain" case, which navigates to the manual Brand
// View picker screen (brandSelect.js) instead of showing a modal.
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

// Mock netlify/functions/auth.js: email only — no name, no passcode.
await page.addInitScript(() => {
  window.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/auth")) {
      const payload = JSON.parse((options && options.body) || "{}");
      if (!payload.email) {
        return new Response(JSON.stringify({ error: "A valid email is required." }), { status: 400 });
      }
      return new Response(
        JSON.stringify({ user: { name: payload.email.toLowerCase(), email: payload.email.toLowerCase(), isAdmin: false } }),
        { status: 200 }
      );
    }
    if (u.includes("/.netlify/functions/plots")) {
      return new Response(JSON.stringify({ trials: [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
});

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/index.html?r=1#/account`);
await page.waitForSelector(".launch-screen");

// The launch screen shows the shield + brand-train images and has no
// name field or passcode field at all — just email.
const nameField = await page.$("#account-name-input");
check(!nameField, "the sign-in form has no name field");
const passcodeField = await page.$("#account-passcode-input");
check(!passcodeField, "the sign-in form has no team passcode field");
const shield = await page.$(".launch-shield");
const train = await page.$(".launch-brand-train");
check(Boolean(shield) && Boolean(train), "the launch screen shows the shield and brand-train images");

// Submit with no email filled -> client-side validation error, no network call.
await page.click(".launch-form-body .btn-primary");
await page.waitForTimeout(150);
let errorText = await page.$eval(".account-error-note", (el) => el.textContent);
check(errorText === "Enter your email.", `client-side validation blocks empty email (got "${errorText}")`);

// Submit with an unrecognized email domain -> navigates to the manual
// Brand View picker screen instead of straight into the workspace.
await page.fill("#account-email-input", "jamie@example.com");
await page.click(".launch-form-body .btn-primary");
await page.waitForSelector(".brand-select-screen", { timeout: 5000 });
check(true, "unrecognized email domain navigates to the Brand View picker screen");

// That screen shows a Back link (since we're already signed in at this
// point) and picking a brand there proceeds straight into the workspace.
const backLink = await page.$(".brand-select-back-link");
check(Boolean(backLink), "the Brand View picker shows a Back link when reached already signed in");

const brandButtons = await page.$$(".brand-select-btn");
const ncPlusBtn = brandButtons[1];
await ncPlusBtn.click();
await page.waitForSelector(".home-screen", { timeout: 5000 });
check(true, "choosing a brand on the picker navigates into the branded Home Screen");

const state = await page.evaluate(() => ({
  brand: JSON.parse(localStorage.getItem("cph.selectedBrand")),
  session: JSON.parse(localStorage.getItem("cph.authSession")),
  passcodeStored: localStorage.getItem("cph.authPasscode"),
}));
check(state.brand === "ncPlus", `picker choice (NC+) is persisted (got "${state.brand}")`);
check(
  state.session && state.session.email === "jamie@example.com",
  `signed-in session is persisted locally (got ${JSON.stringify(state.session)})`
);
check(state.passcodeStored === null, "no passcode is stored anywhere — the whole concept is gone");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
