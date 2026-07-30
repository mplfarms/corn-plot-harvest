// Verifies the Plot Details GPS + soil-type-from-location integration:
// - NOTHING auto-fires — per explicit request (reversing the earlier
//   auto-locate-on-open behavior), location/soil only pre-populate when
//   the top capture button is actually tapped.
// - A successful capture also looks up and pre-populates Soil Type, and
//   flips the button to its brand-dark "Device Location Enabled" state.
// - The capture button lives in its own card at the very TOP of the
//   screen (above Cooperator Details, per explicit request), reads "Use
//   Device for Location & Soil Type" with an explanatory note under it,
//   and still works as a manual re-trigger.
// - The field-note explaining the pre-population is present.
// - An EXISTING plot that already has GPS coordinates does NOT get
//   auto-relocated (no surprise overwrite on every revisit).
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

// Installed via addInitScript so it's in place before any app code runs
// (including the automatic on-load locate attempt) — fakes both the
// browser Geolocation API and the USDA SDA fetch call so this test needs
// no real network or location permission.
const MOCK_INIT_SCRIPT = () => {
  window.__geoCalls = 0;
  window.__fetchCalls = [];
  // navigator.geolocation is a read-only accessor on the real Navigator
  // prototype in Chromium — a plain `navigator.geolocation = {...}`
  // assignment silently no-ops (sloppy-mode script), leaving the real API
  // in place. defineProperty forces the override.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition(success) {
        window.__geoCalls++;
        success({ coords: { latitude: 41.878, longitude: -93.097, accuracy: 12 } });
      },
    },
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    if (typeof url === "string" && url.includes("sdmdataaccess.nrcs.usda.gov")) {
      window.__fetchCalls.push(JSON.parse(opts.body).query);
      return {
        ok: true,
        json: async () => ({
          Table: [{ compname: "A", comppct_r: 58, hzdept_r: 0, texdesc: "Silty clay loam" }],
        }),
      };
    }
    return realFetch(url, opts);
  };
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- Case 1: brand-new plot — nothing fires until the button is tapped;
//              a tap fills GPS + soil type and flips the button state ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(MOCK_INIT_SCRIPT);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    // No gpsLatitude/gpsLongitude in the seeded header -> defaults to null.
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });

  const actualBtnText = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((x) => x.textContent.includes("Use Device"));
    return b ? b.textContent.trim() : null;
  });
  check(actualBtnText === "Use Device for Location & Soil Type", `button label is "Use Device for Location & Soil Type" (got "${actualBtnText}")`);

  // Per explicit request the capture card is the FIRST thing on the
  // screen — above Cooperator Details — with the explainer note under
  // the button.
  const captureLayout = await page.evaluate(() => {
    const body = document.querySelector(".trial-details-screen .screen-body");
    const firstCard = body && body.querySelector(".card");
    return {
      firstCardIsCapture: Boolean(firstCard && firstCard.classList.contains("location-capture-card")),
      note: (firstCard && firstCard.querySelector(".location-capture-note") || {}).textContent || null,
      statusInCard: Boolean(firstCard && firstCard.querySelector(".location-status")),
    };
  });
  check(captureLayout.firstCardIsCapture, "the capture card is the first card on the screen, above Cooperator Details");
  check(
    /One tap fills GPS, State, County, City, Zip, and Soil Type/.test(captureLayout.note || ""),
    `the note under the button explains what one tap fills (got "${captureLayout.note}")`
  );
  check(captureLayout.statusInCard, "the capture/soil status line rides inside the top card with the button");

  // NOTHING auto-fires — per explicit request, opening Plot Details
  // does not request location on its own.
  await page.waitForTimeout(400);
  const geoCallsBeforeTap = await page.evaluate(() => window.__geoCalls);
  check(geoCallsBeforeTap === 0, `opening Plot Details does NOT request location on its own (calls=${geoCallsBeforeTap})`);
  const btnBeforeTap = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.includes("Use Device"));
    return { text: b.textContent.trim(), enabled: b.classList.contains("location-capture-btn-enabled") };
  });
  check(btnBeforeTap.text === "Use Device for Location & Soil Type" && !btnBeforeTap.enabled, `before any tap the button is in its normal outlined state (got ${JSON.stringify(btnBeforeTap)})`);

  // Tap the button — THIS is what kicks everything off now.
  await page.locator("button", { hasText: "Use Device for Location & Soil Type" }).click();
  await page.waitForFunction(() => window.__geoCalls > 0, { timeout: 5000 });
  const geoCalls = await page.evaluate(() => window.__geoCalls);
  check(geoCalls === 1, `tapping the button requests location exactly once (calls=${geoCalls})`);

  // The button flips to the brand-dark "Device Location Enabled" state.
  await page.waitForFunction(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.includes("Device Location"));
    return b && b.textContent.trim() === "Device Location Enabled";
  }, { timeout: 5000 });
  const btnAfterTap = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.trim() === "Device Location Enabled");
    return { enabled: b.classList.contains("location-capture-btn-enabled") };
  });
  check(btnAfterTap.enabled, "after a successful capture the button carries the brand-dark enabled styling");

  // Wait for the soil lookup fetch triggered by that auto-locate to complete.
  await page.waitForFunction(() => window.__fetchCalls && window.__fetchCalls.length > 0, { timeout: 5000 });

  const latVal = await page.$eval('input[placeholder="e.g. 41.878"]', (el) => el.value);
  check(latVal === "41.878", `latitude field auto-populated from the mocked position (got "${latVal}")`);

  await page.waitForFunction(
    () => document.querySelector(".location-status")?.textContent.includes("Soil type set to"),
    { timeout: 5000 }
  );
  const statusText = await page.$eval(".location-status", (el) => el.textContent);
  check(statusText.includes("Soil type set to Silty Clay Loam"), `status message reports the matched soil type (got "${statusText}")`);

  // Soil Type's in-row label was removed (redundant with the field's own
  // "Soil Type" label above it) — the wheel row itself no longer contains
  // that text, so locate it via the field-label wrapper instead of
  // searching .wheel-row's own textContent.
  const soilWheelValue = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".field-label"));
    const soilLabel = labels.find((l) => l.textContent.trim() === "Soil Type");
    const wrapper = soilLabel ? soilLabel.closest(".field") : null;
    const valueEl = wrapper ? wrapper.querySelector(".wheel-row-value") : null;
    return valueEl ? valueEl.textContent.trim() : null;
  });
  check(soilWheelValue === "Silty Clay Loam", `Soil Type wheel itself shows the matched value (got "${soilWheelValue}")`);

  // trialStore's autosave to localStorage is debounced 400ms — the
  // in-memory store is already correct instantly, but a localStorage read
  // needs to wait out the debounce first (same gotcha as elsewhere in
  // this test suite's e2e_v22_batch.mjs).
  await page.waitForTimeout(500);
  const storedSoilType = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header.soilType);
  check(storedSoilType === "Silty Clay Loam", `matched soil type is actually persisted to the trial header (got "${storedSoilType}")`);

  // Field-note is present under Soil Type, and specifically ordered
  // between the "Soil Type" label and the wheel itself (label -> note ->
  // selection box), not below the whole field row.
  const soilFieldOrder = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".field-label"));
    const soilLabel = labels.find((l) => l.textContent.trim() === "Soil Type");
    if (!soilLabel) return null;
    const wrapper = soilLabel.closest(".field");
    const children = Array.from(wrapper.children);
    return {
      labelIdx: children.indexOf(soilLabel),
      noteIdx: children.findIndex((c) => c.classList.contains("field-note")),
      wheelIdx: children.findIndex((c) => c.classList.contains("wheel-row")),
      noteText: (wrapper.querySelector(".field-note") || {}).textContent,
    };
  });
  check(
    soilFieldOrder && soilFieldOrder.noteText === "Pre-populated from GPS Location. To change, select from the dropdown list.",
    `field-note explains the pre-population (got ${JSON.stringify(soilFieldOrder)})`
  );
  check(
    soilFieldOrder && soilFieldOrder.labelIdx < soilFieldOrder.noteIdx && soilFieldOrder.noteIdx < soilFieldOrder.wheelIdx,
    `note sits between the "Soil Type" label and the selection box, not below it (order ${JSON.stringify(soilFieldOrder)})`
  );

  // Re-tapping the (now-enabled) button still re-captures.
  const btn = page.locator("button", { hasText: "Device Location Enabled" });
  await btn.click();
  await page.waitForFunction(() => window.__geoCalls > 1, { timeout: 5000 });
  check(true, "tapping the enabled button re-triggers a capture");

  await page.close();
}

// ---- Case 2: an existing plot that already has GPS does NOT auto-relocate ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(MOCK_INIT_SCRIPT);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "t1",
        header: { cooperatorName: "Test Coop", state: "IA", county: "", gpsLatitude: 40.1, gpsLongitude: -95.2, soilType: "Loam" },
        entries: [],
      })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });
  // Give any (incorrect) auto-fire a moment to happen before asserting it didn't.
  await page.waitForTimeout(400);

  const geoCalls = await page.evaluate(() => window.__geoCalls);
  check(geoCalls === 0, `an existing plot with GPS already set does NOT auto-trigger a new location fetch (calls=${geoCalls})`);

  // A plot that already HAS coordinates opens with the button already in
  // its "Device Location Enabled" state.
  const btnState = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.includes("Device Location"));
    return b ? { text: b.textContent.trim(), enabled: b.classList.contains("location-capture-btn-enabled") } : null;
  });
  check(btnState && btnState.text === "Device Location Enabled" && btnState.enabled, `a plot with existing coordinates shows the enabled button on open (got ${JSON.stringify(btnState)})`);

  const soilWheelValue = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".field-label"));
    const soilLabel = labels.find((l) => l.textContent.trim() === "Soil Type");
    const wrapper = soilLabel ? soilLabel.closest(".field") : null;
    const valueEl = wrapper ? wrapper.querySelector(".wheel-row-value") : null;
    return valueEl ? valueEl.textContent.trim() : null;
  });
  check(soilWheelValue === "Loam", `existing manually-set Soil Type is untouched (got "${soilWheelValue}")`);

  await page.close();
}

// ---- Case 3: MANUAL coordinates — the button stays off, persists off,
//              and tapping it asks before overriding (per explicit
//              request: "toggle button off... alert them that turning on
//              location device will override manual data") ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(MOCK_INIT_SCRIPT);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t3", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });

  // Type coordinates by hand (commit fires on change).
  await page.fill('input[placeholder="e.g. 41.878"]', "41.5");
  await page.locator('input[placeholder="e.g. 41.878"]').blur();
  await page.fill('input[placeholder="e.g. -93.097"]', "-93.5");
  await page.locator('input[placeholder="e.g. -93.097"]').blur();
  await page.waitForTimeout(600);

  const btnState = () =>
    page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.includes("Use Device") || x.textContent.includes("Device Location"));
      return { text: b.textContent.trim(), enabled: b.classList.contains("location-capture-btn-enabled") };
    });
  let st = await btnState();
  check(st.text === "Use Device for Location & Soil Type" && !st.enabled, `hand-typed coordinates do NOT light up the button (got ${JSON.stringify(st)})`);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(stored.gpsSource === "manual" && stored.gpsLatitude === 41.5, `manual entry stores gpsSource "manual" (got ${stored.gpsSource}, lat ${stored.gpsLatitude})`);

  // Persisted across a revisit: still un-lit.
  await page.goto(`${BASE}/index.html?r=2#/trial-details`);
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });
  st = await btnState();
  check(!st.enabled && st.text === "Use Device for Location & Soil Type", `on revisit, manual coordinates STILL don't show "Device Location Enabled" (got ${JSON.stringify(st)})`);

  // Tapping the button now asks before overriding — "No" backs out.
  await page.locator("button", { hasText: "Use Device for Location & Soil Type" }).click();
  await page.waitForSelector(".modal-overlay:not(.hidden)", { timeout: 3000 });
  const confirmTitle = await page.$eval(".modal-overlay:not(.hidden) .modal-title", (el) => el.textContent);
  check(/Override Manual Location/.test(confirmTitle), `tapping the button over manual coords asks first (got "${confirmTitle}")`);
  await page.locator(".modal-overlay:not(.hidden) button", { hasText: "No" }).click();
  await page.waitForTimeout(400);
  let geoCalls = await page.evaluate(() => window.__geoCalls);
  check(geoCalls === 0, `answering No leaves the manual coordinates alone — no capture fired (calls=${geoCalls})`);

  // "Yes" proceeds: captures, overwrites, flips the button on.
  await page.locator("button", { hasText: "Use Device for Location & Soil Type" }).click();
  await page.waitForSelector(".modal-overlay:not(.hidden)", { timeout: 3000 });
  await page.locator(".modal-overlay:not(.hidden) button", { hasText: "Yes" }).click();
  await page.waitForFunction(() => window.__geoCalls > 0, { timeout: 5000 });
  await page.waitForFunction(() => {
    const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
    return t.header && t.header.gpsSource === "device" && t.header.gpsLatitude === 41.878;
  }, { timeout: 5000 });
  st = await btnState();
  check(st.text === "Device Location Enabled" && st.enabled, `answering Yes captures and flips the button on (got ${JSON.stringify(st)})`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
