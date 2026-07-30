// Verifies the two desk-entry features (both per explicit request,
// answered before build):
//   1. DESKTOP GPS WARNING — on a device with no touch screen and a
//      mouse-style pointer (i.e. probably a desk computer, whose
//      "location" is an internet-connection guess that can be miles
//      off), tapping "Use Device for Location & Soil Type" asks first;
//      No backs out, Yes proceeds. A touch device never sees it.
//   2. PICK LOCATION ON MAP — a lazy-loaded Leaflet satellite map
//      (stubbed here: the CDN isn't reachable from this sandbox, so the
//      route serves a minimal Leaflet lookalike implementing exactly
//      the API surface mapPicker.js uses); tapping the map + "Use This
//      Location" fills Latitude/Longitude (rounded, N+/W- normalized),
//      stores gpsSource "manual" (the device button stays un-lit and
//      would confirm before overriding), and runs the same soil/region
//      lookups a device capture does.
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

// Minimal Leaflet stub: window.L with map/tileLayer/marker, click
// simulation via window.__mapStub.
const LEAFLET_STUB = `
window.__mapStub = { clicks: [], tileLayers: [] };
window.L = {
  map(el, opts) {
    const handlers = {};
    const m = {
      setView() { return m; },
      on(ev, fn) { handlers[ev] = fn; return m; },
      removeLayer() {},
      invalidateSize() {},
      _fireClick(lat, lng) { if (handlers.click) handlers.click({ latlng: { lat, lng } }); },
    };
    window.__mapStub.map = m;
    return m;
  },
  tileLayer(url, opts) {
    const t = { url, opts, on() { return t; }, addTo() { window.__mapStub.tileLayers.push(url); return t; } };
    return t;
  },
  marker(latlng, opts) {
    const mk = {
      _latlng: { lat: latlng[0], lng: latlng[1] },
      addTo() { window.__mapStub.marker = mk; return mk; },
      on() { return mk; },
      setLatLng(ll) { mk._latlng = { lat: ll[0], lng: ll[1] }; },
      getLatLng() { return mk._latlng; },
    };
    return mk;
  },
};
`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function seedPlot(page, header) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((hdr) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem("cph.draftTrial", JSON.stringify({ id: "tm", header: hdr, entries: [] }));
  }, header);
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });
}

function mockLookups(page) {
  return page.addInitScript(() => {
    window.__geoCalls = 0;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(ok) {
          window.__geoCalls++;
          ok({ coords: { latitude: 41.878, longitude: -93.097, accuracy: 9 } });
        },
      },
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov")) return new Response(JSON.stringify({ State: { code: "IA" }, County: { name: "Monona" } }), { status: 200 });
      if (u.includes("overpass")) {
        return new Response(JSON.stringify({ elements: [{ lat: 41.95, lon: -96.09, tags: { name: "Onawa" } }] }), { status: 200 });
      }
      if (u.includes("bigdatacloud")) return new Response("{}", { status: 200 });
      if (u.includes("sdmdataaccess")) {
        window.__soilCalls = (window.__soilCalls || 0) + 1;
        return new Response(JSON.stringify({ Table: [] }), { status: 200 });
      }
      return realFetch(url, options);
    };
  });
}

// ---- 1. DESKTOP (no touch): the accuracy warning gates the button ----
{
  const page = await browser.newPage(); // default context: fine pointer, no touch
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await mockLookups(page);
  await seedPlot(page, { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" });

  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForSelector(".modal-overlay:not(.hidden)", { timeout: 3000 });
  const title = await page.$eval(".modal-overlay:not(.hidden) .modal-title", (el) => el.textContent);
  check(/Not a Phone or Tablet\?/.test(title), `a no-touch device gets the accuracy warning first (got "${title}")`);
  const msg = await page.$eval(".modal-overlay:not(.hidden)", (el) => el.textContent);
  check(/miles off/.test(msg) && /Pick Location on Map/.test(msg), "the warning explains the risk and points at the map picker");

  await page.locator(".modal-overlay:not(.hidden) button", { hasText: "No" }).click();
  await page.waitForTimeout(300);
  let geoCalls = await page.evaluate(() => window.__geoCalls);
  check(geoCalls === 0, `answering No does not capture (calls=${geoCalls})`);

  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForSelector(".modal-overlay:not(.hidden)", { timeout: 3000 });
  await page.locator(".modal-overlay:not(.hidden) button", { hasText: "Yes" }).click();
  await page.waitForFunction(() => window.__geoCalls > 0, { timeout: 5000 });
  check(true, "answering Yes proceeds with the capture");
  await page.close();
}

// ---- 2. TOUCH device: no warning, capture fires immediately ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await mockLookups(page);
  await seedPlot(page, { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" });

  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForFunction(() => window.__geoCalls > 0, { timeout: 5000 });
  const modalOpen = await page.$(".modal-overlay:not(.hidden)");
  check(!modalOpen, "a touch device captures immediately — no desktop warning");
  await page.close();
}

// ---- 3. MAP PICKER: lazy stub load, tap -> pin -> confirm -> fills +
//         lookups, counts as manual ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await mockLookups(page);
  // Serve the Leaflet stub in place of the CDN (JS) and an empty CSS.
  await page.route("**/cdnjs.cloudflare.com/ajax/libs/leaflet/**", (route) => {
    const url = route.request().url();
    if (url.endsWith(".css")) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    return route.fulfill({ status: 200, contentType: "application/javascript", body: LEAFLET_STUB });
  });
  await seedPlot(page, { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" });

  const leafletLoadedEarly = await page.evaluate(() => Boolean(window.L));
  check(!leafletLoadedEarly, "Leaflet is NOT loaded at screen open — zero startup cost, lazy-load only");

  await page.locator("button", { hasText: "Pick Location on Map" }).click();
  await page.waitForSelector(".map-picker-map", { timeout: 5000 });
  await page.waitForFunction(() => window.L && window.__mapStub && window.__mapStub.map, { timeout: 5000 });
  check(true, "tapping the button lazy-loads the map library and opens the modal");
  const tileUrl = await page.evaluate(() => window.__mapStub.tileLayers[0] || "");
  check(/basemap\.nationalmap\.gov.*USGSImageryTopo/.test(tileUrl), `the primary layer is USGS Imagery TOPO — satellite plus boundaries/highways/rivers/town names for orientation (got "${tileUrl}")`);

  const useBtnDisabled = await page.locator("button", { hasText: "Use This Location" }).isDisabled();
  check(useBtnDisabled, "with no coordinates yet, Use This Location starts disabled until a pin is dropped");

  // Simulate a map tap through the stub, then confirm.
  await page.evaluate(() => window.__mapStub.map._fireClick(41.8930071234, -96.0902791234));
  const readout = await page.$eval(".map-picker-readout", (el) => el.textContent);
  check(/41\.893007, -96\.090279/.test(readout), `the readout shows the picked spot (got "${readout}")`);
  await page.locator("button", { hasText: "Use This Location" }).click();

  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.gpsLatitude === 41.893007;
    },
    { timeout: 5000 }
  );
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.gpsLatitude === 41.893007 && header.gpsLongitude === -96.090279, `confirming fills the coordinates, rounded to 6 places, N+/W- normalized (got ${header.gpsLatitude}, ${header.gpsLongitude})`);
  check(header.gpsSource === "manual", `a map pick counts as MANUAL coordinates (got "${header.gpsSource}")`);

  const latVal = await page.$eval('input[placeholder="e.g. 41.878"]', (el) => el.value);
  check(latVal === "41.893007", `the Latitude field shows the picked value (got "${latVal}")`);

  // The same lookups a device capture runs: soil + region (fill-blanks).
  await page.waitForFunction(() => (window.__soilCalls || 0) > 0, { timeout: 5000 });
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.county === "Monona" && t.header.city === "Onawa";
    },
    { timeout: 8000 }
  );
  check(true, "the map pick runs the same soil + County/City lookups as a device capture");

  const status = await page.$eval(".location-status", (el) => el.textContent);
  check(/Location set from the map\./.test(status), `the status line credits the map (got "${status}")`);

  const btnState = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent.includes("Use Device") || x.textContent.includes("Device Location"));
    return { text: b.textContent.trim(), enabled: b.classList.contains("location-capture-btn-enabled") };
  });
  check(btnState.text === "Use Device for Location & Soil Type" && !btnState.enabled, `the device button stays un-lit after a map pick (got ${JSON.stringify(btnState)})`);
  await page.close();
}

// ---- 4. Map load failure fails soft with a helpful message ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.route("**/cdnjs.cloudflare.com/ajax/libs/leaflet/**", (route) => route.abort());
  await seedPlot(page, { cooperatorName: "Test Coop", state: "IA" });
  await page.locator("button", { hasText: "Pick Location on Map" }).click();
  await page.waitForSelector(".modal-overlay:not(.hidden) .empty-state", { timeout: 8000 });
  const failMsg = await page.$eval(".modal-overlay:not(.hidden) .empty-state", (el) => el.textContent);
  check(/couldn't load the map/i.test(failMsg) && /internet connection/.test(failMsg), `an offline map open fails soft with guidance (got "${failMsg}")`);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
