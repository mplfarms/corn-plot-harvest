// Verifies brandIdForEmail()'s domain rules end-to-end through the
// (email-only) sign-in flow: @midwestseedgenetics.com / @midwestseed.com
// / @republicseed.com default straight to Midwest, @nc-plus.com defaults
// straight to NC+, and none of the four should be sent to the manual
// Brand View picker screen.
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

const CASES = [
  { email: "pat@midwestseedgenetics.com", expectedBrand: "midwestSeedGenetics" },
  { email: "pat@midwestseed.com", expectedBrand: "midwestSeedGenetics" },
  { email: "sam@republicseed.com", expectedBrand: "midwestSeedGenetics" },
  { email: "alex@nc-plus.com", expectedBrand: "ncPlus" },
  // Mixed case should still match — email domains aren't case-sensitive.
  { email: "casey@NC-Plus.com", expectedBrand: "ncPlus" },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

for (const { email, expectedBrand } of CASES) {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/auth")) {
        const payload = JSON.parse((options && options.body) || "{}");
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

  await page.fill("#account-email-input", email);
  await page.click(".launch-form-body .btn-primary");

  // A known domain should skip the Brand View picker entirely and land
  // straight on the branded Home Screen.
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  const pickerShown = await page.$(".brand-select-screen");
  check(!pickerShown, `${email}: known domain skips the Brand View picker`);

  const selectedBrand = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.selectedBrand")));
  check(
    selectedBrand === expectedBrand,
    `${email}: defaults to ${expectedBrand} (got "${selectedBrand}")`
  );

  await page.close();
}

// An unrecognized domain should still be routed to the manual picker
// (already covered end-to-end in e2e_auth_signin.mjs — this is a quick
// sanity check on a second, different unrecognized domain).
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
await page.addInitScript(() => {
  window.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/auth")) {
      const payload = JSON.parse((options && options.body) || "{}");
      return new Response(
        JSON.stringify({ user: { name: payload.email.toLowerCase(), email: payload.email.toLowerCase(), isAdmin: false } }),
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
await page.fill("#account-email-input", "someone@gmail.com");
await page.click(".launch-form-body .btn-primary");
await page.waitForSelector(".brand-select-screen", { timeout: 5000 });
check(true, "an unrecognized domain (gmail.com) is routed to the manual Brand View picker");
await page.close();

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
