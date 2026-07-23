// Verifies the new Quick Start Guide (linked from the Home Screen) and
// Help screen (linked from Settings): both are reachable, show their
// content, and their Back buttons return to where they came from. Also
// checks the Help screen's accordion behavior (first section open by
// default, others closed until tapped) and its cross-link back to Quick
// Start.
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

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
});

// ---- Home Screen -> Quick Start Guide ----
await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
await page.waitForSelector(".home-screen", { timeout: 5000 });

const quickStartLink = page.locator("button", { hasText: "Quick Start Guide" });
check(await quickStartLink.count() === 1, "Home Screen shows a Quick Start Guide link");

await quickStartLink.click();
await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
const stepCount = await page.$$eval(".quick-start-step", (els) => els.length);
check(stepCount === 9, `Quick Start Guide shows 9 numbered steps (got ${stepCount})`);
const firstStepTitle = await page.$eval(".quick-start-step-title", (el) => el.textContent);
check(firstStepTitle === "Sign in", `first step is about signing in (got "${firstStepTitle}")`);

// Step 4 ("Enter a New Plot") has a highlighted tip recommending GPS access —
// shifted from step 3 once "Add it to your Home Screen" was inserted as step 2.
const step3Tip = await page.$eval(".quick-start-step:nth-child(4) .quick-start-step-tip", (el) => el.textContent);
check(
  step3Tip.includes("Recommended") && /allow location/i.test(step3Tip),
  `step 3 has a tip recommending location access (got "${step3Tip}")`
);

// Step 2 covers adding to the home screen, with instructions for both
// iOS Safari and Android Chrome (the two differ enough to need both).
const step2Title = await page.$eval(".quick-start-step:nth-child(2) .quick-start-step-title", (el) => el.textContent);
check(step2Title === "Add it to your Home Screen", `step 2 is about adding to the Home Screen (got "${step2Title}")`);
const step2Body = await page.$eval(".quick-start-step:nth-child(2) .quick-start-step-body", (el) => el.textContent);
check(
  /share button/i.test(step2Body) && /add to home screen/i.test(step2Body) && /chrome/i.test(step2Body),
  `step 2 covers both iOS Safari's Share button and Android Chrome (got "${step2Body}")`
);
const introText = await page.$eval(".quick-start-screen .field-note", (el) => el.textContent);
check(introText.includes("nine steps"), `the intro line's step count matches the actual 9 steps, not stale (got "${introText}")`);

const qsBackBtn = page.locator('.top-bar-btn[aria-label="Back"]');
await qsBackBtn.click();
await page.waitForSelector(".home-screen", { timeout: 5000 });
check(true, "Quick Start Guide's Back button returns to the Home Screen");

// ---- Settings -> Help ----
await page.goto(`${BASE}/index.html?r=1#/settings`);
await page.waitForSelector(".settings-screen", { timeout: 5000 });

const helpBtn = page.locator("button", { hasText: "Help & How-To Guide" });
check(await helpBtn.count() === 1, "Settings shows a Help & How-To Guide button");

await helpBtn.click();
await page.waitForSelector(".help-screen", { timeout: 5000 });

const sectionCount = await page.$$eval(".help-section", (els) => els.length);
check(sectionCount >= 10, `Help screen shows every section (got ${sectionCount})`);

// The detailed "Adding This App to Your Home Screen" section, right
// after Signing In — full instructions for both iOS Safari and Android
// Chrome, since the steps genuinely differ between the two.
const homeScreenSectionText = await page.evaluate(() => {
  const titles = Array.from(document.querySelectorAll(".help-section-title"));
  const section = titles.find((t) => t.textContent === "Adding This App to Your Home Screen")?.closest(".help-section");
  return section ? section.textContent : null;
});
check(Boolean(homeScreenSectionText), "Help includes an 'Adding This App to Your Home Screen' section");
check(
  Boolean(homeScreenSectionText) && /iphone or ipad \(safari\)/i.test(homeScreenSectionText) && /share button/i.test(homeScreenSectionText),
  `the section covers iOS Safari's Share button (got ${JSON.stringify(homeScreenSectionText)})`
);
check(
  Boolean(homeScreenSectionText) && /android phone or tablet \(chrome\)/i.test(homeScreenSectionText) && /add to home screen/i.test(homeScreenSectionText),
  `the section covers Android Chrome's menu too (got ${JSON.stringify(homeScreenSectionText)})`
);

const openStates = await page.$$eval(".help-section", (els) => els.map((el) => el.open));
check(openStates[0] === true, "the first section (Signing In) starts open");
check(openStates.slice(1).every((o) => o === false), "every other section starts closed");

// Tap the second section's summary to open it.
const secondSummary = page.locator(".help-section-title").nth(1);
await secondSummary.click();
await page.waitForTimeout(150);
const secondOpen = await page.$$eval(".help-section", (els) => els[1].open);
check(secondOpen === true, "tapping a closed section's title opens it");

// GPS Location's expanded content and the new Soil Type sub-section.
const subheadings = await page.$$eval(".help-subheading", (els) => els.map((el) => el.textContent));
check(subheadings.includes("Soil Type"), `Help includes a dedicated Soil Type sub-section (got ${JSON.stringify(subheadings)})`);

// The two ways to enter yield, each with its own explained sub-heading.
check(
  subheadings.some((t) => t.includes("Option 1") && /enter it yourself/i.test(t)),
  `Help explains the manual entry option for yield (got ${JSON.stringify(subheadings)})`
);
check(
  subheadings.some((t) => t.includes("Option 2") && /let the app calculate/i.test(t)),
  `Help explains the app-calculated option for yield (got ${JSON.stringify(subheadings)})`
);

// Contact Us is the last section, with working tel:/mailto: hotlinks.
const lastSectionTitle = await page.$eval(".help-section:last-of-type .help-section-title", (el) => el.textContent);
check(lastSectionTitle === "Contact Us", `Contact Us is the very last Help section (got "${lastSectionTitle}")`);

const mailLink = await page.$eval(".help-section:last-of-type a[href^='mailto:']", (el) => ({ href: el.getAttribute("href"), text: el.textContent }));
check(mailLink.href === "mailto:mikelage@republicseed.com", `the email is a mailto: hotlink (got "${mailLink.href}")`);
check(mailLink.text === "mikelage@republicseed.com", `the email link displays the address (got "${mailLink.text}")`);

const telLink = await page.$eval(".help-section:last-of-type a[href^='tel:']", (el) => ({ href: el.getAttribute("href"), text: el.textContent }));
check(telLink.href === "tel:+17124202348", `the phone number is a tel: hotlink (got "${telLink.href}")`);
check(telLink.text === "(712) 420-2348", `the phone link displays the formatted number (got "${telLink.text}")`);

// Cross-link back to Quick Start from Help.
await page.locator("button", { hasText: "Show Me the Quick Start Guide Instead" }).click();
await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
check(true, "Help screen's link jumps to the Quick Start Guide");

// Navigate back to Help directly and check its own Back button.
await page.goto(`${BASE}/index.html?r=1#/help`);
await page.waitForSelector(".help-screen", { timeout: 5000 });
const helpBackBtn = page.locator('.top-bar-btn[aria-label="Back"]');
await helpBackBtn.click();
await page.waitForSelector(".settings-screen", { timeout: 5000 });
check(true, "Help screen's Back button returns to Settings");

// ---- Help is visible to non-admins too (not gated like Manage Users) ----
await page.evaluate(() => {
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Jamie Farmer", email: "jamie@example.com", isAdmin: false }));
});
// r=2 (not r=1, already the current URL from the SPA nav above) so this
// is a genuine fresh navigation/reload rather than a same-URL no-op.
await page.goto(`${BASE}/index.html?r=2#/settings`);
await page.waitForSelector(".settings-screen", { timeout: 5000 });
const helpBtnForNonAdmin = page.locator("button", { hasText: "Help & How-To Guide" });
check(await helpBtnForNonAdmin.count() === 1, "a non-admin also sees the Help button in Settings");
const manageUsersBtnForNonAdmin = page.locator("button", { hasText: "Manage Users" });
check(await manageUsersBtnForNonAdmin.count() === 0, "a non-admin does NOT see Manage Users (unrelated admin-only control, sanity check)");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
