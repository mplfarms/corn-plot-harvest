// Verifies the latest batch of Plot Details / Plot Entries changes:
//   1. State defaults to Iowa (covered separately in e2e_default_state_iowa.mjs)
//   2. Date Planted / Date Harvested use a tap-to-open calendar picker
//   3. Base Moisture % is locked at 15.5 and not editable
//   4. Collected By/Phone/Email pre-populate from the signed-in account but
//      are plain editable fields (covered in more depth by
//      e2e_collected_by_phone_email.mjs)
//   5. Adding a new hybrid entry scrolls the new screen to the top
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
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "t1",
      header: {
        cooperatorName: "Test Cooperator",
        address: "",
        city: "",
        state: "IA",
        zip: "",
        county: "",
        gpsLatitude: null,
        gpsLongitude: null,
        datePlanted: null,
        tillage: "",
        irrigation: "",
        soilType: "",
        previousCrop: "",
        plantingPopulation: "32000",
        dateHarvested: null,
        collectedBy: "",
        phone: "",
        email: "",
        baseMoisturePercent: 20, // deliberately "wrong" to verify the lock corrects it
        dryingShrinkRate: 0.06,
        pricePerBushel: 3.5,
        trialNotes: "",
      },
      entries: [],
    })
  );
});
await page.goto(`${BASE}/index.html?r=1#/trial-details`);
await page.waitForSelector(".screen-body", { timeout: 5000 });

// ---- 2. Date picker: no native <input type=date>, opens a calendar modal ----
const nativeDateInputs = await page.$$eval('input[type="date"]', (els) => els.length);
check(nativeDateInputs === 0, "no native <input type=date> anywhere on the page");

const datePlantedBtn = page.locator(".date-picker-btn").first();
check((await datePlantedBtn.count()) > 0, "Date Planted renders as a date-picker button");
const placeholderText = await datePlantedBtn.textContent();
check(placeholderText.trim() === "Select a date", `unset date shows placeholder text (got "${placeholderText.trim()}")`);

await datePlantedBtn.click();
await page.waitForSelector(".date-picker-grid .date-picker-day:not(.date-picker-day-empty)", { timeout: 3000 });
const modalTitle = await page.$eval(".modal-title", (el) => el.textContent);
check(modalTitle === "Select Date", `calendar opens in a modal titled "Select Date" (got "${modalTitle}")`);

// Click day "15" of whatever month is showing (first non-empty cell with text "15" if present, else just first day).
const dayButtons = await page.$$(".date-picker-day:not(.date-picker-day-empty)");
check(dayButtons.length > 0, "calendar grid renders clickable day buttons");
await dayButtons[Math.min(14, dayButtons.length - 1)].click();
await page.waitForTimeout(150);
const modalGoneAfterPick = await page.$eval(".modal-overlay", (el) => el.classList.contains("hidden"));
check(modalGoneAfterPick, "picking a day closes the calendar modal");
const newBtnLabel = await datePlantedBtn.textContent();
check(/^\d{2}\/\d{2}\/\d{4}$/.test(newBtnLabel.trim()), `Date Planted button now shows a MM/DD/YYYY date (got "${newBtnLabel.trim()}")`);

// ---- 3. Base Moisture % locked at 15.5 ----
const baseMoistureLocked = page.locator(".field", { hasText: "Base Moisture %" }).locator(".field-locked");
const lockedText = await baseMoistureLocked.textContent();
check(lockedText.includes("15.5%"), `Base Moisture field shows the locked 15.5% value (got "${lockedText}")`);
const lockedInputCount = await baseMoistureLocked.locator("input").count();
check(lockedInputCount === 0, "Base Moisture field has no editable <input> — not user-editable");
await page.waitForTimeout(500); // trialStore's autosave to localStorage is debounced 400ms
const storedBaseMoisture = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header.baseMoisturePercent);
check(storedBaseMoisture === 15.5, `stored baseMoisturePercent was corrected to 15.5 on load (got ${storedBaseMoisture})`);

// ---- 4. Collected By/Phone/Email pre-populate from the signed-in account
// into plain editable fields (cph.authSession above has no firstName/
// lastName, so this also exercises the "split the combined name"
// fallback) ----
const collectedByInput = page.locator(".field", { hasText: "Collected By" }).locator(".text-input");
const collectedByText = await collectedByInput.inputValue();
check(collectedByText.includes("User, Test"), `Collected By derives "Last, First" from the account name (got "${collectedByText}")`);
check((await collectedByInput.evaluate((el) => el.tagName)) === "INPUT", "Collected By is a plain editable <input>");

const emailInput = page.locator(".field", { hasText: "Email" }).locator(".text-input");
const emailText = await emailInput.inputValue();
check(emailText.includes("test@example.com"), `Email derives from the signed-in account (got "${emailText}")`);

const phoneInput = page.locator(".field", { hasText: "Phone" }).locator(".text-input");
const phoneText = await phoneInput.inputValue();
check(phoneText.trim() === "", `Phone is left blank when the account has no phone on file (got "${phoneText.trim()}")`);
check((await page.locator('input[type="tel"]').count()) === 1, "the editable phone <input> is present on the page (pre-populated, not locked)");

await page.waitForTimeout(500); // trialStore's autosave to localStorage is debounced 400ms
const storedHeader = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
check(storedHeader.collectedBy === "User, Test", `stored collectedBy matches the derived value (got "${storedHeader.collectedBy}")`);
check(storedHeader.email === "test@example.com", `stored email matches the derived value (got "${storedHeader.email}")`);
check(storedHeader.phone === "", `stored phone is blank when the account has none on file (got "${storedHeader.phone}")`);

// ---- 5. Adding a new hybrid entry scrolls the new screen to the top ----
await page.goto(`${BASE}/index.html?r=2#/entries`);
await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
// Scroll the (empty) entries list down first so there's something to reset from.
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(50);
const scrollBeforeAdd = await page.evaluate(() => window.scrollY);
await page.click("text=Add Another Hybrid");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
await page.waitForTimeout(100);
const scrollAfterAdd = await page.evaluate(() => window.scrollY);
check(scrollAfterAdd === 0, `new entry screen (from "Add Another Hybrid") opens scrolled to the top (was ${scrollBeforeAdd}, now ${scrollAfterAdd})`);

// Now the in-editor "+ Add Another Entry" path — scroll down within the
// editor first (it's a long form), then confirm the next entry starts at top.
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(50);
await page.click("text=+ Add Another Entry");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });
await page.waitForTimeout(100);
const scrollAfterSecondAdd = await page.evaluate(() => window.scrollY);
check(scrollAfterSecondAdd === 0, `"+ Add Another Entry" also opens the new entry scrolled to the top (got ${scrollAfterSecondAdd})`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
