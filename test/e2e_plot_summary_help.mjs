// Verifies the "i" info icon on Plot Summary (a circled "i", not a "?" —
// see styles.css's .top-bar-btn-help-badge): it sits next to the
// Settings gear, opens the new "Reading Your Results" screen
// (plotSummaryHelp.js) with its accordion sections (first one open),
// and its Back button returns to Plot Summary. Also checks the two small
// cross-reference pointers added elsewhere per the standing "update the
// guides when warranted" instruction: Quick Start step 6's tip and the
// note at the end of Help's "Viewing Your Results" section.
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
  const entries = [150, 180, 210].map((y, i) => ({
    id: `e${i}`, brand: "Midwest Seed Genetics", hybrid: `H${i}`, trait: "", relativeMaturity: "100", seedTreatment: "",
    sampleNetWeightLbs: "", moisturePercent: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
    widthInches: "", comments: "", manualDryYield: String(y),
  }));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries })
  );
});

// ---- Plot Summary shows the "i" info icon next to the gear ----
await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

const helpBtn = page.locator(".top-bar-btn-help");
check(await helpBtn.count() === 1, "Plot Summary shows a help icon in the top bar");
const badgeText = await page.$eval(".top-bar-btn-help-badge", (el) => el.textContent);
check(badgeText === "i", `the icon is a circled "i" (info), not a "?" (got "${badgeText}")`);

const rightGroupOrder = await page.evaluate(() => {
  const right = document.querySelector(".top-bar-right");
  return Array.from(right.children).map((el) => el.className);
});
check(
  rightGroupOrder.length === 2 &&
    rightGroupOrder[0].includes("top-bar-btn-help") &&
    rightGroupOrder[1].includes("top-bar-btn-settings"),
  `the help icon sits immediately to the left of the Settings gear (got ${JSON.stringify(rightGroupOrder)})`
);

// ---- Tapping it opens the new help screen ----
await helpBtn.click();
await page.waitForSelector(".plot-summary-help-screen", { timeout: 5000 });
check(true, "tapping the help icon opens the Reading Your Results screen");

const hash = await page.evaluate(() => window.location.hash);
check(hash === "#/plot-summary-help", `navigated to #/plot-summary-help (got "${hash}")`);

const sectionCount = await page.$$eval(".help-section", (els) => els.length);
check(sectionCount === 6, `the screen shows all 6 sections (got ${sectionCount})`);

const openStates = await page.$$eval(".help-section", (els) => els.map((el) => el.open));
check(openStates[0] === true, "the first section starts open");
check(openStates.slice(1).every((o) => o === false), "every other section starts closed");

const firstTitle = await page.$eval(".help-section-title", (el) => el.textContent);
check(/Dry Yield.*Gross/.test(firstTitle) && !/Moisture/.test(firstTitle), `the first open section explains the Dry Yield/Gross tabs, no Moisture tab (got "${firstTitle}")`);

const sectionTitles = await page.$$eval(".help-section-title", (els) => els.map((el) => el.textContent));
check(sectionTitles.some((t) => /box.*whisker/i.test(t)), `a section explains the box-and-whisker chart (got ${JSON.stringify(sectionTitles)})`);
check(sectionTitles.some((t) => /colored rank badges/i.test(t)), `a section explains the colored rank badges (got ${JSON.stringify(sectionTitles)})`);

// The Trial Mean/CV/Entries section explains what a low vs. high CV means
// for how trustworthy the plot's rankings are.
const cvSectionText = await page.evaluate(() => {
  const details = Array.from(document.querySelectorAll(".help-section"));
  const cvSection = details.find((d) => /Trial Mean, CV, and Entries/.test(d.querySelector(".help-section-title").textContent));
  return cvSection ? cvSection.textContent : "";
});
check(/under about 10%/.test(cvSectionText), `the CV explanation gives a rule-of-thumb threshold around 10% (got ${JSON.stringify(cvSectionText)})`);
check(
  /clean, consistent plot/.test(cvSectionText) && /more caution/.test(cvSectionText),
  `the CV explanation says a low CV means a more trustworthy plot and a high CV warrants more caution (got ${JSON.stringify(cvSectionText)})`
);

// ---- Back button returns to Plot Summary ----
// backLabel is "Plot Summary" here (see plotSummaryHelp.js), not the
// generic "Back" used elsewhere.
const backBtn = page.locator('.top-bar-btn[aria-label="Plot Summary"]');
await backBtn.click();
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
check(true, "the help screen's Back button returns to Plot Summary");

// ---- Cross-reference: Quick Start's "Check your results" step points to the new icon ----
// Shifted from position 6 to 7 once "Add it to your Home Screen" was inserted as step 2.
await page.goto(`${BASE}/index.html?r=2#/quick-start`);
await page.waitForSelector(".quick-start-screen", { timeout: 5000 });
const step6Tip = await page.$eval(".quick-start-step:nth-child(7) .quick-start-step-tip", (el) => el.textContent);
check(/[“"]i[”"]\s*(info\s+)?icon/i.test(step6Tip), `Quick Start's "Check your results" step points to the "i" info icon (got "${step6Tip}")`);

// ---- Cross-reference: Help's "Viewing Your Results" section points to it too ----
await page.goto(`${BASE}/index.html?r=2#/help`);
await page.waitForSelector(".help-screen", { timeout: 5000 });
const helpBodyText = await page.evaluate(() => document.querySelector(".help-screen").textContent);
check(helpBodyText.includes("next to the gear"), "Help's Viewing Your Results section mentions the new icon");

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
