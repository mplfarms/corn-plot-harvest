// Verifies the Settings screen's Brand section is renamed "Brand View"
// and shows logo images instead of text labels for brand selection.
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
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
});
await page.goto(`${BASE}/index.html?r=1#/settings`);
await page.waitForSelector(".settings-screen", { timeout: 5000 });

const headers = await page.$$eval(".section-header", (els) => els.map((e) => e.textContent));
check(headers.includes("Brand View"), `section header renamed to "Brand View" (got ${JSON.stringify(headers)})`);
check(!headers.includes("Brand"), 'old "Brand" header (exact) is gone');

const fieldNote = await page.$eval(".brand-view-segmented", (el) => el.parentElement.querySelector(".field-note").textContent);
check(fieldNote === "Select Brand View", `field note updated (got "${fieldNote}")`);

const logos = await page.$$(".brand-view-logo");
check(logos.length === 3, `all three brand buttons render a logo image (got ${logos.length})`);

const buttonTextLengths = await page.$$eval(".brand-view-btn", (els) => els.map((e) => e.textContent.trim().length));
check(buttonTextLengths.every((len) => len === 0), "brand buttons show no visible text, only the logo image");

const ariaLabels = await page.$$eval(".brand-view-btn", (els) => els.map((e) => e.getAttribute("aria-label")));
check(
  ariaLabels.includes("Midwest Seed Genetics") && ariaLabels.includes("NC+") && ariaLabels.includes("Crow's"),
  `each button (including the new Crow's 3rd Brand View) still has an accessible aria-label (got ${JSON.stringify(ariaLabels)})`
);

const activeBtn = await page.$(".brand-view-btn.segmented-btn-active");
const activeAlt = await page.evaluate((el) => el.querySelector("img").alt, activeBtn);
check(activeAlt === "Midwest Seed Genetics", `the currently selected brand view's button is marked active (got "${activeAlt}")`);

// Click NC+ and confirm it switches.
const ncBtn = (await page.$$(".brand-view-btn"))[1];
await ncBtn.click();
await page.waitForTimeout(150);
const selectedBrand = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.selectedBrand")));
check(selectedBrand === "ncPlus", `clicking the NC+ logo switches the brand view (got "${selectedBrand}")`);

// Click the 3rd button (Crow's) and confirm it switches too, with its
// black chrome theme applied.
const crowsBtn = (await page.$$(".brand-view-btn"))[2];
await crowsBtn.click();
await page.waitForTimeout(150);
const selectedBrandCrows = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.selectedBrand")));
check(selectedBrandCrows === "crows", `clicking the 3rd (Crow's) logo switches the brand view (got "${selectedBrandCrows}")`);
const chromeVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--chrome").trim());
check(chromeVar.toLowerCase() === "#231f20", `Crow's brand theme applies its black chrome color (got "${chromeVar}")`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
