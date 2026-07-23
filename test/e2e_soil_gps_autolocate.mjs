// Verifies the Plot Details GPS + soil-type-from-location integration:
// - A brand-new plot (no GPS yet) auto-locates on its own, no button tap
//   needed ("default to the device location").
// - A successful auto-locate also looks up and pre-populates Soil Type.
// - The button reads "Use Device Location or Enter Manually" and still
//   works as a manual re-trigger.
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

// ---- Case 1: brand-new plot (no GPS yet) auto-locates + auto-fills soil type ----
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
    const b = btns.find((x) => x.textContent.includes("Use Device Location"));
    return b ? b.textContent.trim() : null;
  });
  check(actualBtnText === "Use Device Location or Enter Manually", `button label is "Use Device Location or Enter Manually" (got "${actualBtnText}")`);

  // Auto-locate should have fired on its own (no click).
  await page.waitForFunction(() => window.__geoCalls > 0, { timeout: 5000 });
  const geoCalls = await page.evaluate(() => window.__geoCalls);
  check(geoCalls === 1, `geolocation was requested automatically on load, without a click (calls=${geoCalls})`);

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

  // Manual re-trigger via the button still works (calls geolocation again).
  const btn = page.locator("button", { hasText: "Use Device Location or Enter Manually" });
  await btn.click();
  await page.waitForFunction(() => window.__geoCalls > 1, { timeout: 5000 });
  check(true, "clicking the button re-triggers geolocation manually");

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

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
