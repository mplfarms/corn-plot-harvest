// Verifies Plot Details' Collected By/Phone/Email fields (see
// trialDetails.js's resolveActiveUser()/lastFirstName()/formatPhoneNumber()):
//   1. A signed-in account with firstName/lastName/mobileNumber on file
//      pre-populates "Last, First" / a formatted phone / email into plain,
//      EDITABLE text fields (not locked) the first time the screen opens
//      on a blank plot.
//   2. An account with only a combined `name` (pre-firstName/lastName
//      accounts) falls back to splitting it.
//   3. During an admin-edit session, the fields pre-populate from the
//      PLOT OWNER's account, not the admin doing the editing.
//   4. Editing Collected By/Phone/Email sticks — reopening the screen (or
//      the account's own info changing later) does not silently overwrite
//      a value the user already typed in.
//   5. Phone is normalized to "(555) 555-5555" as it's typed, from
//      whatever raw digits the account has on file.
//   6. The Plot Summary header card's chevron is visibly larger than an
//      ordinary navigation row's chevron elsewhere in the app, and the
//      Moisture tab is gone from the Dry Yield/Entry #/Gross segmented
//      control (moisture still shows per-row, it's just no longer
//      sortable).
// Also verifies, in the same screen:
//   7. The Address field is relabeled "Cooperator Address" with a "leave
//      blank if not known" note, and an 11-digit leading-"1" phone
//      number (Chrome autofill's country-code bug) is stripped down to
//      just area code + 7 digits, both on pre-populate and on live typing.
//   8. wheelSelect's type-ahead-jump feature: enabled (and working,
//      including cycling and fresh-prefix behavior) for any list over 10
//      options, and NOT wired up at all for a list of 10 or fewer.
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

function blankHeader(overrides) {
  return {
    cooperatorName: "Test Coop",
    state: "IA",
    county: "",
    address: "",
    city: "",
    zip: "",
    tillage: "",
    irrigation: "",
    soilType: "",
    previousCrop: "",
    plantingPopulation: "32000",
    collectedBy: "",
    phone: "",
    email: "",
    dryingShrinkRate: 0.06,
    pricePerBushel: 3.5,
    trialNotes: "",
    ...overrides,
  };
}

function fieldInput(page, label) {
  return page.locator(".field", { hasText: label }).locator(".text-input");
}

// ---- 1. firstName/lastName/mobileNumber on file, pre-populated into editable fields ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem(
      "cph.authSession",
      JSON.stringify({
        name: "Mike Lage",
        email: "mike@example.com",
        isAdmin: false,
        firstName: "Mike",
        lastName: "Lage",
        // Stored raw, same as what an account actually has on file (no
        // formatting is applied when it's typed into Settings) — the
        // Plot Details screen is responsible for formatting it on display.
        mobileNumber: "7124202348",
      })
    );
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, blankHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  const collectedByEl = fieldInput(page, "Collected By");
  const collectedByTag = await collectedByEl.evaluate((el) => el.tagName);
  check(collectedByTag === "INPUT", `Collected By is a plain editable input, not a locked div (got ${collectedByTag})`);
  check((await collectedByEl.inputValue()) === "Lage, Mike", `Collected By pre-populates "Last, First" from firstName/lastName`);

  const phoneEl = fieldInput(page, "Phone");
  check((await phoneEl.getAttribute("type")) === "tel", "Phone renders as a tel-type input");
  check((await phoneEl.inputValue()) === "(712) 420-2348", `Phone pre-populates formatted as "(555) 555-5555" from the account's raw mobileNumber (got "${await phoneEl.inputValue()}")`);

  // Cooperator Address rename (was just "Address") + its new instruction note.
  const addressLabelText = await page.locator(".field-label", { hasText: "Cooperator Address" }).textContent();
  check(addressLabelText.trim() === "Cooperator Address", `the Address field is now labeled "Cooperator Address" (got "${addressLabelText.trim()}")`);
  const addressNoteText = await page.$eval(".trial-details-address-note", (el) => el.textContent);
  check(addressNoteText === "Leave blank if not known.", `the Cooperator Address field shows the "leave blank if not known" instruction (got "${addressNoteText}")`);
  check((await page.locator(".field-label", { hasText: /^Address$/ }).count()) === 0, "the plain \"Address\" label no longer exists on its own");

  const emailEl = fieldInput(page, "Email");
  check((await emailEl.inputValue()) === "mike@example.com", "Email pre-populates from the account's email");

  // Base Moisture % (in the Yield Calculation section, out of scope for
  // this request) is the only field on this screen that's still meant to
  // show a Locked tag — confirm Collected By/Phone/Email don't have one,
  // without asserting Base Moisture % lost its own.
  const lockedFieldLabels = await page.$$eval(".field-locked", (els) =>
    els.map((el) => el.closest(".field").querySelector(".field-label").textContent)
  );
  check(
    lockedFieldLabels.length === 1 && lockedFieldLabels[0] === "Base Moisture %",
    `only Base Moisture % is still shown as a Locked field — Collected By/Phone/Email are not (got ${JSON.stringify(lockedFieldLabels)})`
  );
  check((await page.locator(".wheel-row", { hasText: "Collected By" }).count()) === 0, "the old Collected By wheel picker is gone");

  await page.waitForTimeout(500); // trialStore's autosave is debounced 400ms
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(stored.collectedBy === "Lage, Mike", `stored header.collectedBy matches the pre-populated value (got "${stored.collectedBy}")`);
  check(stored.phone === "(712) 420-2348", `stored header.phone is the formatted value, not the raw digits (got "${stored.phone}")`);
  check(stored.email === "mike@example.com", `stored header.email matches the pre-populated value (got "${stored.email}")`);

  await page.close();
}

// ---- 2. Legacy account: only a combined `name`, no firstName/lastName; no phone on file ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Jamie Farmer", email: "jamie@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, blankHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  const collectedBy = await fieldInput(page, "Collected By").inputValue();
  check(collectedBy === "Farmer, Jamie", `Collected By falls back to splitting the combined name (got "${collectedBy}")`);

  const phoneEl = fieldInput(page, "Phone");
  check((await phoneEl.inputValue()) === "", `Phone is left blank (not "—") when the account has none on file, showing its placeholder instead`);
  check((await phoneEl.getAttribute("placeholder")) === "(555) 555-5555", "Phone's empty-state placeholder matches the requested format");

  await page.close();
}

// ---- 3. Admin editing a teammate's plot pre-populates from the OWNER's info, not the admin's ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const jamieTrial = {
    id: "jamie-trial-1",
    header: blankHeader({ cooperatorName: "Jamie's Farm" }),
    entries: [],
  };
  await page.addInitScript((trial) => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && (!options || options.method !== "PUT")) {
        if (u.includes("scope=all")) {
          return new Response(
            JSON.stringify({
              users: [
                { email: "admin@example.com", name: "Admin User", firstName: "Admin", lastName: "User", mobileNumber: "5550000000", trials: [] },
                { email: "jamie@example.com", name: "Jamie Farmer", firstName: "Jamie", lastName: "Farmer", mobileNumber: "5551112222", trials: [trial] },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  }, jamieTrial);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem(
      "cph.authSession",
      JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true, firstName: "Admin", lastName: "User", mobileNumber: "5550000000" })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });

  await page.click("text=Jamie's Farm");
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  await page.click("text=Plot Details");
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });

  const collectedBy = await fieldInput(page, "Collected By").inputValue();
  check(collectedBy === "Farmer, Jamie", `admin-edit pre-populates the OWNER's name, not the admin's (got "${collectedBy}")`);
  const phone = await fieldInput(page, "Phone").inputValue();
  check(phone === "(555) 111-2222", `admin-edit pre-populates the OWNER's phone, not the admin's (got "${phone}")`);
  const email = await fieldInput(page, "Email").inputValue();
  check(email === "jamie@example.com", `admin-edit pre-populates the OWNER's email, not the admin's (got "${email}")`);

  await page.close();
}

// ---- 4. A manual edit sticks — it's not overwritten on the next visit, even if the account changes later ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem(
      "cph.authSession",
      JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false, firstName: "Mike", lastName: "Lage", mobileNumber: "7124202348" })
    );
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, blankHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  // Someone else collected this particular plot — overwrite the pre-populated defaults.
  const collectedByEl = fieldInput(page, "Collected By");
  await collectedByEl.fill("Smith, Alex");
  const phoneEl = fieldInput(page, "Phone");
  await phoneEl.fill("6195551234");
  await phoneEl.blur();

  await page.waitForTimeout(500); // autosave debounce
  const storedAfterEdit = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(storedAfterEdit.collectedBy === "Smith, Alex", `edited Collected By is stored as typed (got "${storedAfterEdit.collectedBy}")`);
  check(storedAfterEdit.phone === "(619) 555-1234", `edited Phone is stored formatted, live, as it's typed (got "${storedAfterEdit.phone}")`);

  // Simulate the account's own name/phone changing later in Settings, then
  // reopen Plot Details on the SAME plot — the edit made above must survive.
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("cph.authSession"));
    session.firstName = "Michael";
    session.lastName = "Lageson";
    session.mobileNumber = "9998887777";
    localStorage.setItem("cph.authSession", JSON.stringify(session));
  });
  await page.goto(`${BASE}/index.html?r=2#/workspace`);
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  await page.click("text=Plot Details");
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });

  const collectedByAfterReopen = await fieldInput(page, "Collected By").inputValue();
  check(collectedByAfterReopen === "Smith, Alex", `Collected By is untouched by a later account change — the edit sticks (got "${collectedByAfterReopen}")`);
  const phoneAfterReopen = await fieldInput(page, "Phone").inputValue();
  check(phoneAfterReopen === "(619) 555-1234", `Phone is untouched by a later account change — the edit sticks (got "${phoneAfterReopen}")`);

  await page.close();
}

// ---- 5. Plot Summary header card's chevron is scoped-bigger than a plain navigation row's ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "t1",
        header,
        entries: [{ id: "e1", brand: "Midwest Seed Genetics", hybrid: "H1", trait: "", relativeMaturity: "100", comments: "", manualDryYield: "180" }],
      })
    );
  }, blankHeader());

  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  const headerChevronSize = await page.$eval(".summary-header-card .chooser-row-chevron", (el) =>
    parseFloat(getComputedStyle(el).fontSize)
  );

  // The Moisture tab is gone — only Dry Yield, Entry #, and Gross remain
  // selectable (Entry # added between Dry Yield and Gross — see
  // yieldCalculator.js's RankingMetric.ENTRY_NUM).
  const tabLabels = await page.$$eval(".segmented-control .segmented-btn", (els) => els.map((el) => el.textContent.trim()));
  check(
    tabLabels.length === 3 &&
      tabLabels[0] === "Dry Yield" &&
      tabLabels[1] === "Entry #" &&
      tabLabels[2] === "Gross" &&
      !tabLabels.includes("Moisture"),
    `Plot Summary shows the Dry Yield, Entry #, and Gross tabs in order, no Moisture tab (got ${JSON.stringify(tabLabels)})`
  );
  // Each hybrid's moisture reading is still shown on its row, just not sortable.
  const moistureLineText = await page.$eval(".ranked-row-moisture", (el) => el.textContent).catch(() => null);
  check(Boolean(moistureLineText) && /Moisture:/.test(moistureLineText), `each ranked row still shows its own Moisture reading (got ${JSON.stringify(moistureLineText)})`);

  await page.goto(`${BASE}/index.html?r=2#/workspace`);
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  const navChevronSize = await page.$eval(".chooser-row-chevron", (el) => parseFloat(getComputedStyle(el).fontSize));

  check(headerChevronSize > navChevronSize, `the summary header's chevron (${headerChevronSize}px) is larger than an ordinary nav row's (${navChevronSize}px)`);

  await page.close();
}

// ---- 6. Chrome autofill's leading "1" country code is stripped, both on pre-populate and on manual entry ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem(
      "cph.authSession",
      JSON.stringify({
        name: "Mike Lage",
        email: "mike@example.com",
        isAdmin: false,
        firstName: "Mike",
        lastName: "Lage",
        // 11 digits, leading "1" — simulates the account having been
        // saved with a Chrome-autofilled country-code prefix already on
        // it, same shape as the live bug being fixed.
        mobileNumber: "17124202348",
      })
    );
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, blankHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  const phoneEl = fieldInput(page, "Phone");
  const prefilled = await phoneEl.inputValue();
  check(
    prefilled === "(712) 420-2348",
    `an 11-digit, leading-"1" account phone number is pre-populated with the "1" stripped, showing just area code + number (got "${prefilled}")`
  );

  // Simulate Chrome's autofill directly typing/filling an 11-digit,
  // leading-"1" value into the field (the actual bug scenario) — the
  // live formatter must strip it the same way.
  await phoneEl.fill("");
  await phoneEl.type("16195551234", { delay: 5 });
  const typedResult = await phoneEl.inputValue();
  check(
    typedResult === "(619) 555-1234",
    `typing/autofilling an 11-digit number starting with "1" strips the leading "1" and shows just (area code) number (got "${typedResult}")`
  );

  // A genuine 10-digit number is completely unaffected (no false-positive
  // stripping — US area codes never start with "1" so this can't happen
  // for real, but confirm the boundary is exactly at 11 digits).
  await phoneEl.fill("");
  await phoneEl.type("6195551234", { delay: 5 });
  const genuine10Digit = await phoneEl.inputValue();
  check(genuine10Digit === "(619) 555-1234", `a genuine 10-digit number formats normally, untouched by the 11-digit stripping rule (got "${genuine10Digit}")`);

  await page.close();
}

// ---- 7. wheelSelect type-ahead-jump: enabled only past 10 options, cycles on repeat, narrows on a fresh prefix ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, blankHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  // State (51 options) is well over the >10-item cutoff — open it, then
  // type "w" and confirm focus jumps straight to a state starting with
  // "w" (Washington) rather than requiring a manual scroll.
  await page.click(".field:has-text('State') .wheel-row-header");
  await page.waitForSelector(".field:has-text('State') .wheel-panel .wheel-option", { timeout: 3000 });
  await page.waitForTimeout(150);
  await page.locator(".field:has-text('State') .wheel-panel .wheel-scroll").focus();
  await page.keyboard.press("w");
  await page.waitForTimeout(50);
  let focusedLabel = await page.evaluate(() => document.activeElement.textContent.trim());
  check(/^Washington/.test(focusedLabel), `typing "w" in the State wheel jumps focus to the first option starting with "w" (got "${focusedLabel}")`);

  // Typing "w" again (repeat-same-char) cycles to the NEXT "w" match after that one.
  await page.keyboard.press("w");
  await page.waitForTimeout(50);
  focusedLabel = await page.evaluate(() => document.activeElement.textContent.trim());
  check(
    /^West Virginia|^Wisconsin|^Wyoming/.test(focusedLabel),
    `repeating "w" cycles to the NEXT match after Washington (got "${focusedLabel}")`
  );

  // A different letter right after starts a fresh single-character search.
  await page.keyboard.press("a");
  await page.waitForTimeout(50);
  focusedLabel = await page.evaluate(() => document.activeElement.textContent.trim());
  check(/^Alabama/.test(focusedLabel), `typing a different letter ("a") starts a brand new search from the top (got "${focusedLabel}")`);

  // Close State (typing never commits a selection — only a click/Enter/
  // Space on an option does — so State is still "IA", blankHeader()'s
  // default, the whole time) and confirm the SAME type-ahead behavior
  // applies to County — a second, independently-wired wheel, not
  // something hardcoded to the State field.
  await page.waitForTimeout(150);
  await page.click(".field:has-text('State') .wheel-row-header");
  await page.waitForTimeout(150);
  await page.click(".field:has-text('County') .wheel-row-header");
  await page.waitForSelector(".field:has-text('County') .wheel-panel .wheel-option", { timeout: 3000 });
  await page.waitForTimeout(150);
  await page.locator(".field:has-text('County') .wheel-panel .wheel-scroll").focus();
  await page.keyboard.press("p");
  await page.waitForTimeout(50);
  const focusedCounty = await page.evaluate(() => document.activeElement.textContent.trim());
  check(/^P/.test(focusedCounty), `type-ahead also works on the County wheel (Iowa has 99 counties, well over 10) — jumped to "${focusedCounty}"`);

  // Planting Population (14000–46000 step 500 = 65 plain numeric-string
  // options, well over 10) confirms type-ahead also matches leading
  // DIGITS, not just letters (digits ARE matched via the same [a-z0-9]
  // rule) — options ascend numerically, so typing "3" should land on
  // "30000", the first value starting with "3".
  await page.waitForTimeout(150);
  await page.click(".field:has-text('County') .wheel-row-header");
  await page.waitForTimeout(150);
  await page.click(".field:has-text('Planting Population') .wheel-row-header");
  await page.waitForSelector(".field:has-text('Planting Population') .wheel-panel .wheel-option", { timeout: 3000 });
  await page.waitForTimeout(150);
  await page.locator(".field:has-text('Planting Population') .wheel-panel .wheel-scroll").focus();
  await page.keyboard.press("3");
  await page.waitForTimeout(50);
  const focusedPopulation = await page.evaluate(() => document.activeElement.textContent.trim());
  check(
    focusedPopulation.startsWith("3"),
    `type-ahead also matches leading digits, not just letters (Planting Population wheel: got "${focusedPopulation}")`
  );

  await page.close();
}

// ---- 8. wheelSelect type-ahead is NOT enabled for a short list (<=10 options) ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, blankHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  // Irrigation is a short, app-defined list (well under 10 items) — its
  // wheel-scroll must have no keydown-driven type-ahead wired up at all,
  // so a keypress there does nothing but is also perfectly harmless.
  await page.click(".field:has-text('Irrigation') .wheel-row-header");
  await page.waitForSelector(".field:has-text('Irrigation') .wheel-panel .wheel-option", { timeout: 3000 });
  const optionCount = await page.locator(".field:has-text('Irrigation') .wheel-panel .wheel-option").count();
  check(optionCount <= 10, `sanity check — Irrigation actually has 10 or fewer options in this app (got ${optionCount})`);

  await page.locator(".field:has-text('Irrigation') .wheel-panel .wheel-scroll").focus();
  await page.keyboard.press("z");
  await page.waitForTimeout(50);
  const stillOnScroll = await page.evaluate(() => document.activeElement.className.includes("wheel-scroll"));
  check(stillOnScroll, "for a 10-or-fewer-item list, a keypress does not move focus to any option (type-ahead is disabled below the cutoff)");

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
