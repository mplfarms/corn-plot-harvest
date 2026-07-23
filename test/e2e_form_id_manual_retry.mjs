// Verifies the manual "Assign Plot ID" / "tap to try now" retry
// affordances added for a plot whose Form ID never got assigned (e.g.
// the background attempt hit a connection/server problem and failed
// silently — see formIdAssign.js's ensureFormIdAssignedWithFeedback()):
//   1. Plot Details' Form ID note doubles as a tappable retry button
//      while unassigned; a successful retry replaces its text with the
//      real assigned ID and disables it; a failed retry (while online)
//      re-enables it with an ERROR TOAST, unlike the silent background
//      attempts elsewhere in this app.
//   2. Plot Summary shows a separate "Assign Plot ID" button (NOT nested
//      inside the header card, which is itself a <button> and can't
//      contain another one) only while unassigned; success removes the
//      button and updates the header subtitle; failure re-enables it
//      with the same error toast.
//   3. A failed retry while genuinely offline (navigator.onLine false)
//      does NOT show an error toast — only a failure on an actually-live
//      connection is surfaced.
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

function unassignedHeader(overrides) {
  return {
    cooperatorName: "Test Coop",
    state: "IA",
    county: "Monona",
    formId: "",
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

// ---- 1a. Plot Details manual retry: FAILURE while online shows an error toast ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/formId")) {
        return new Response(JSON.stringify({ error: "Server error." }), { status: 500 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, unassignedHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  const retryBtn = page.locator(".trial-details-form-id-retry-btn");
  check((await retryBtn.evaluate((el) => el.tagName)) === "BUTTON", "the unassigned Form ID note is a real <button>, not just styled text");

  await retryBtn.click();
  await page.waitForSelector(".toast", { timeout: 5000 });
  const toastText = await page.$eval(".toast", (el) => el.textContent);
  check(/Couldn't assign a Plot ID/.test(toastText), `a failed manual retry (while online) shows an error toast (got "${toastText}")`);
  check(
    toastText.includes("server returned 500"),
    `the toast includes the SPECIFIC failure reason (e.g. "server returned 500"), not just a generic message — this is what made the real backfillFormIds/formId 404 deployment bug diagnosable at all (got "${toastText}")`
  );

  const finalText = await retryBtn.textContent();
  check(
    finalText === "Form ID: will be assigned when you save this plot (tap to try now)",
    `the button re-enables itself with its original text after a failed retry (got "${finalText}")`
  );
  check((await retryBtn.isDisabled()) === false, "the button is re-enabled (not stuck disabled) after a failed retry");

  await page.close();
}

// ---- 1b. Plot Details manual retry: SUCCESS updates the note and disables the button ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/formId")) {
        return new Response(JSON.stringify({ formId: "26-1042" }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, unassignedHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  const retryBtn = page.locator(".trial-details-form-id-retry-btn");
  await retryBtn.click();
  await page.waitForFunction(() => document.querySelector(".trial-details-form-id-retry-btn")?.textContent === "Form ID: 26-1042", {
    timeout: 5000,
  });
  const successText = await retryBtn.textContent();
  check(successText === "Form ID: 26-1042", `a successful manual retry replaces the note with the real assigned Form ID (got "${successText}")`);
  check((await retryBtn.isDisabled()) === true, "the button disables itself once successfully assigned — nothing left to retry");

  // trialStore's write to localStorage is debounced (see
  // AUTOSAVE_DEBOUNCE_MS in trialStore.js) — wait for it to actually land
  // before reading it back, rather than a fixed timeout shorter than the
  // debounce window itself.
  await page.waitForFunction(
    () => {
      const d = JSON.parse(localStorage.getItem("cph.draftTrial") || "null");
      return Boolean(d && d.header.formId);
    },
    { timeout: 3000 }
  );
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")));
  check(draft.header.formId === "26-1042", `the assigned Form ID is actually persisted to the draft (got "${draft.header.formId}")`);

  await page.close();
}

// ---- 2. Plot Summary's "Assign Plot ID" button — separate row, not nested in the header card ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    window.__formIdCallCount = 0;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/formId")) {
        window.__formIdCallCount++;
        if (window.__formIdShouldSucceed) {
          return new Response(JSON.stringify({ formId: "26-1077" }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "Server error." }), { status: 500 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false }));
    window.__formIdShouldSucceed = false;
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "t1",
        header,
        entries: [{ id: "e1", brand: "Midwest Seed Genetics", hybrid: "H1", trait: "", relativeMaturity: "100", comments: "", manualDryYield: "180" }],
      })
    );
  }, unassignedHeader());
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  // The self-heal fires silently on its own (no toast either way) — wait
  // for it to finish (and fail, since __formIdShouldSucceed is false)
  // before interacting, so its background call doesn't get confused with
  // the button's own explicit one below.
  await page.waitForTimeout(400);

  const retryBtn = page.locator(".summary-formid-retry-btn");
  check((await retryBtn.count()) === 1, "Plot Summary shows a separate \"Assign Plot ID\" button while unassigned");
  const isNestedInHeaderCard = await page.evaluate(() => {
    const btn = document.querySelector(".summary-formid-retry-btn");
    return Boolean(btn && btn.closest(".summary-header-card"));
  });
  check(isNestedInHeaderCard === false, "the retry button is NOT nested inside the header card button (invalid <button>-in-<button> HTML)");

  await retryBtn.click();
  await page.waitForSelector(".toast", { timeout: 5000 });
  let toastText = await page.$eval(".toast", (el) => el.textContent);
  check(/Couldn't assign a Plot ID/.test(toastText), `a failed "Assign Plot ID" click shows an error toast (got "${toastText}")`);
  check((await retryBtn.isDisabled()) === false, "the \"Assign Plot ID\" button re-enables after a failed attempt");
  check((await retryBtn.textContent()) === "Assign Plot ID", "the button's label reverts back to normal after a failed attempt");

  // Now let it succeed.
  await page.evaluate(() => {
    window.__formIdShouldSucceed = true;
  });
  await retryBtn.click();
  await page.waitForFunction(() => document.querySelector(".summary-header-subtitle")?.textContent.endsWith("• 26-1077"), { timeout: 5000 });
  const subtitleAfter = await page.$eval(".summary-header-subtitle", (el) => el.textContent);
  check(subtitleAfter.endsWith("• 26-1077"), `a successful "Assign Plot ID" click updates the header subtitle (got "${subtitleAfter}")`);
  const retryBtnGoneAfterSuccess = (await page.locator(".summary-formid-retry-btn").count()) === 0;
  check(retryBtnGoneAfterSuccess, "the \"Assign Plot ID\" button disappears once a Form ID is actually assigned");

  await page.close();
}

// ---- 3. A failed retry while genuinely offline shows NO error toast ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    // Simulates the network call itself failing the way a real fetch()
    // does when there's no connection — a rejected promise, not an HTTP
    // error response — while leaving navigator.onLine to be controlled
    // separately by the real browser-level offline toggle below.
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/formId")) {
        throw new TypeError("Failed to fetch");
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate((header) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Lage", email: "mike@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "t1", header, entries: [] }));
  }, unassignedHeader());
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });

  // Real browser-level offline — navigator.onLine reads false for the
  // click handled below, without needing to touch our fetch stub (which
  // already simulates a failed network call regardless).
  await page.context().setOffline(true);

  const retryBtn = page.locator(".trial-details-form-id-retry-btn");
  await retryBtn.click();

  // Give the (failed) attempt time to fully resolve, then confirm no
  // toast ever appeared — can't wait FOR a toast that shouldn't exist,
  // so this waits a fixed window and checks its absence instead.
  await page.waitForFunction(
    () => document.querySelector(".trial-details-form-id-retry-btn")?.textContent.includes("tap to try now"),
    { timeout: 5000 }
  );
  const toastCount = await page.locator(".toast").count();
  check(toastCount === 0, "a failed retry while genuinely offline (navigator.onLine === false) shows NO error toast");

  await page.context().setOffline(false);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
