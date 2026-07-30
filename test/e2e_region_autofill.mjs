// Verifies Plot Details' State/County/City auto-fill from GPS (see
// attemptRegionLookup() in trialDetails.js + core/locationLookup.js) —
// per explicit request: when the location capture runs, the captured
// coordinate is reverse-geocoded (FCC Area API for State+County) and
// ONLY still-blank fields are filled; manual entries are never
// overwritten. County/City snap onto the app's own lists
// (spelling-wise) so the pickers/zip-autofill stay consistent.
//
// City (per explicit follow-up request): PRIMARY is a 10-mile radius
// search for incorporated towns (OpenStreetMap Overpass, widening once
// to 15 miles) — the NEAREST pre-populates and the whole nearest-first
// list renders as a tap-to-adjust selection box under the City field.
// The BigDataCloud reverse-geocode candidate walk remains as the
// fallback when the radius service is unreachable.
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

/**
 * Stubs geolocation (fixed Ames, IA point) and the two reverse-geocode
 * endpoints. FCC deliberately returns "Story County" (with the suffix)
 * and BigDataCloud "AMES" (wrong case) so the checks below prove the
 * snap-to-known-list normalization, not just pass-through.
 */
async function stubGeoAndFetch(page) {
  await page.addInitScript(() => {
    window.__regionCalls = { fcc: 0, city: 0, overpass: 0 };
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok) =>
          setTimeout(() => ok({ coords: { latitude: 42.034722, longitude: -93.62, accuracy: 8 } }), 10),
      },
      configurable: true,
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov")) {
        window.__regionCalls.fcc++;
        return new Response(JSON.stringify({ State: { code: "ia", name: "Iowa" }, County: { name: "Story County" } }), { status: 200 });
      }
      if (u.includes("overpass")) {
        // Radius service unreachable in this scenario — proves the
        // BigDataCloud candidate walk still works as the fallback.
        window.__regionCalls.overpass++;
        throw new TypeError("overpass down");
      }
      if (u.includes("bigdatacloud.net")) {
        window.__regionCalls.city++;
        return new Response(JSON.stringify({ city: "AMES", locality: "Ames" }), { status: 200 });
      }
      if (u.includes("sdmdataaccess")) {
        // Soil lookup fails soft — not under test here.
        return new Response("{}", { status: 500 });
      }
      return realFetch(url, options);
    };
  });
}

// ---- 1. Blank plot: State/County/City all auto-fill, snapped to the app's own spellings ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await stubGeoAndFetch(page);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "", county: "", city: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  // Location capture is tap-only now (per explicit request) — kick it off.
  await page.locator("button", { hasText: "Use Device" }).first().click();

  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.state === "IA";
    },
    { timeout: 8000 }
  );
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.state === "IA", `State auto-fills from GPS, uppercased to the app's code (got "${header.state}")`);
  check(header.county === "Story", `County auto-fills, "Story County" snapped to the county list's own "Story" (got "${header.county}")`);
  check(header.city === "Ames", `City auto-fills, "AMES" snapped to the city list's own "Ames" spelling (got "${header.city}")`);
  check(header.gpsLatitude === 42.034722, `GPS itself still captures exactly as before (got ${header.gpsLatitude})`);

  const regionCalls = await page.evaluate(() => window.__regionCalls);
  check(regionCalls.fcc === 1 && regionCalls.city === 1, `each reverse-geocode endpoint was called exactly once (got ${JSON.stringify(regionCalls)})`);

  await page.close();
}

// ---- 1b. Radius search (the primary city path, per explicit follow-up
//          request): towns within 10 miles — nearest REAL town
//          pre-populates City (townships filtered out), the full list
//          renders as a tap-to-adjust selection box with distances, and
//          tapping a different town switches City + Zip ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    window.__overpassBodies = [];
    // The exact Monona County, IA point from the field report screenshot.
    const LAT = 41.893007;
    const LON = -96.090279;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok) =>
          setTimeout(() => ok({ coords: { latitude: LAT, longitude: LON, accuracy: 8 } }), 10),
      },
      configurable: true,
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov")) {
        return new Response(JSON.stringify({ State: { code: "IA", name: "Iowa" }, County: { name: "Monona" } }), { status: 200 });
      }
      if (u.includes("overpass")) {
        window.__overpassBodies.push(options && options.body ? String(options.body) : "");
        // A township-y OSM node closest, then two real Monona Co. towns
        // (deliberately out of distance order in the response — the app
        // must sort). ~0.05° lat ≈ 3.5 mi, ~0.1° ≈ 6.9 mi.
        return new Response(
          JSON.stringify({
            elements: [
              { lat: LAT + 0.1, lon: LON, tags: { name: "Whiting" } },
              { lat: LAT + 0.01, lon: LON, tags: { name: "Ticonderoga Township" } },
              { lat: LAT + 0.05, lon: LON, tags: { name: "ONAWA" } },
            ],
          }),
          { status: 200 }
        );
      }
      if (u.includes("bigdatacloud.net")) {
        return new Response(JSON.stringify({ city: "Township of Nowhere" }), { status: 200 });
      }
      if (u.includes("sdmdataaccess")) return new Response("{}", { status: 500 });
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t1b", header: { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  // Location capture is tap-only now (per explicit request) — kick it off.
  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && (t.header.city || "").trim() !== "";
    },
    { timeout: 8000 }
  );
  let header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.city === "Onawa", `the NEAREST real town pre-populates City — township skipped, "ONAWA" snapped to the list's own spelling (got "${header.city}")`);
  check(header.zip === "51040", `Zip follows the auto-filled town (got "${header.zip}")`);

  const overpassBodies = await page.evaluate(() => window.__overpassBodies);
  check(overpassBodies.length === 1 && overpassBodies[0].includes("16093"), `one radius query, at 10 miles (~16093m) (got ${overpassBodies.length}: ${overpassBodies.map((b) => (b.match(/around%3A(\d+)/) || [])[1]).join(",")})`);

  const chips = await page.$$eval(".city-nearby-list .zip-choice-btn", (els) =>
    els.map((el) => ({ text: el.textContent, selected: el.className.includes("selected") }))
  );
  check(chips.length === 2, `the selection box lists both real towns, townships excluded (got ${chips.length}: ${JSON.stringify(chips.map((c) => c.text))})`);
  check(
    chips[0] && /^Onawa — 3\.[45] mi$/.test(chips[0].text) && chips[0].selected,
    `nearest first, with distance, marked selected (got "${chips[0] && chips[0].text}")`
  );
  check(
    chips[1] && /^Whiting — 6\.9 mi$/.test(chips[1].text) && !chips[1].selected,
    `the farther town listed second with its distance (got "${chips[1] && chips[1].text}")`
  );

  // Tap the second town — City AND Zip follow, selection highlight moves.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".city-nearby-list .zip-choice-btn")];
    btns.find((b) => b.textContent.startsWith("Whiting")).click();
  });
  // The draft's persistence is debounced — poll until the switch lands.
  const switched = await page
    .waitForFunction(
      () => {
        const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
        return t.header && t.header.city === "Whiting" && t.header.zip === "51063";
      },
      { timeout: 5000 }
    )
    .then(() => true)
    .catch(() => false);
  header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(switched, `tapping a different town switches City and Zip together (got "${header.city}"/"${header.zip}")`);
  const chipsAfter = await page.$$eval(".city-nearby-list .zip-choice-btn", (els) =>
    els.map((el) => ({ text: el.textContent, selected: el.className.includes("selected") }))
  );
  check(
    chipsAfter.every((c) => c.selected === c.text.startsWith("Whiting")),
    `the selection highlight moves to the tapped town (got ${JSON.stringify(chipsAfter)})`
  );
  // Per explicit request (real field report): tapping a nearby-town chip
  // must ONLY pick the town — the full City selection list must NOT pop
  // open on top of it.
  await page.waitForTimeout(300);
  const pickerOpened = await page.evaluate(() => Boolean(document.querySelector(".search-list-input")));
  check(!pickerOpened, "tapping a chip does NOT open the City selection list");

  await page.close();
}

// ---- 1c. Nothing incorporated within 10 miles: the search widens ONCE
//          to 15 miles and fills from there ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    window.__overpassBodies = [];
    const LAT = 41.893007;
    const LON = -96.090279;
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok) =>
          setTimeout(() => ok({ coords: { latitude: LAT, longitude: LON, accuracy: 8 } }), 10),
      },
      configurable: true,
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov")) {
        return new Response(JSON.stringify({ State: { code: "IA", name: "Iowa" }, County: { name: "Monona" } }), { status: 200 });
      }
      if (u.includes("overpass")) {
        const body = options && options.body ? String(options.body) : "";
        window.__overpassBodies.push(body);
        // 10-mile pass: only a township (snaps to nothing). 15-mile
        // pass: a real town appears.
        const elements = body.includes("16093")
          ? [{ lat: LAT + 0.01, lon: LON, tags: { name: "Ticonderoga Township" } }]
          : [{ lat: LAT + 0.25, lon: LON, tags: { name: "Onawa" } }];
        return new Response(JSON.stringify({ elements }), { status: 200 });
      }
      if (u.includes("bigdatacloud.net")) {
        return new Response(JSON.stringify({ city: "Township of Nowhere" }), { status: 200 });
      }
      if (u.includes("sdmdataaccess")) return new Response("{}", { status: 500 });
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t1c", header: { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  // Location capture is tap-only now (per explicit request) — kick it off.
  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && (t.header.city || "").trim() !== "";
    },
    { timeout: 8000 }
  );
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.city === "Onawa", `the widened 15-mile pass fills the town the 10-mile pass couldn't (got "${header.city}")`);
  const radii = await page.evaluate(() => window.__overpassBodies.map((b) => (b.match(/around%3A(\d+)/) || [])[1]));
  check(radii.length === 2 && radii[0] === "16093" && radii[1] === "24140", `two radius queries: 10 miles then 15 (got ${JSON.stringify(radii)})`);
  const statusText = await page.$eval(".city-nearby-list", (el) => el.previousElementSibling.textContent);
  check(/15 miles/.test(statusText), `the status note reports the widened radius (got "${statusText}")`);

  await page.close();
}

// ---- 2. Fill-blanks-only: manual values are never overwritten (and no lookups even fire) ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await stubGeoAndFetch(page);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "t2",
        header: { cooperatorName: "Test Coop", state: "NE", county: "Custer", city: "Broken Bow" },
        entries: [],
      })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  // Location capture is tap-only now (per explicit request) — kick it off.
  await page.locator("button", { hasText: "Use Device" }).first().click();

  // Wait for the GPS capture itself to land (it still runs — only the
  // region fill is skipped).
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.gpsLatitude === 42.034722;
    },
    { timeout: 8000 }
  );
  await page.waitForTimeout(300);
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.state === "NE" && header.county === "Custer" && header.city === "Broken Bow",
    `manually-set State/County/City survive a location capture untouched (got ${header.state}/${header.county}/${header.city})`);

  const regionCalls = await page.evaluate(() => window.__regionCalls);
  check(regionCalls.fcc === 0 && regionCalls.city === 0, `with nothing blank, no reverse-geocode request is made at all (got ${JSON.stringify(regionCalls)})`);

  await page.close();
}

// ---- 2b. The Nebraska field report: untouched default State "IA" gets
//          corrected by GPS, county snaps against the RIGHT state, and a
//          township never lands in City — the first candidate matching
//          the state's real town list wins ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok) =>
          setTimeout(() => ok({ coords: { latitude: 41.003902, longitude: -98.63262, accuracy: 8 } }), 10),
      },
      configurable: true,
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov")) {
        return new Response(JSON.stringify({ State: { code: "NE", name: "Nebraska" }, County: { name: "Hall County" } }), { status: 200 });
      }
      if (u.includes("overpass")) throw new TypeError("overpass down");
      if (u.includes("bigdatacloud.net")) {
        return new Response(
          JSON.stringify({
            city: "Township of South Loup",
            locality: "South Loup",
            localityInfo: { informative: [{ name: "Grand Island" }, { name: "Doniphan" }], administrative: [{ name: "Nebraska" }] },
          }),
          { status: 200 }
        );
      }
      if (u.includes("sdmdataaccess")) return new Response("{}", { status: 500 });
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    // State carries the untouched new-plot DEFAULT ("IA"); county/city/
    // zip blank — exactly the state a fresh plot arrives in.
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t2b", header: { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  // Location capture is tap-only now (per explicit request) — kick it off.
  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.state === "NE";
    },
    { timeout: 8000 }
  );
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.state === "NE", `the untouched default State "IA" is corrected to the GPS state (got "${header.state}")`);
  check(header.county === "Hall", `"Hall County" snaps against NEBRASKA's county list to "Hall" (got "${header.county}")`);
  check(
    header.city === "Grand Island",
    `the township candidates are passed over — the first REAL town on the state's own list wins (got "${header.city}")`
  );

  await page.close();
}

// ---- 2c. All candidates are townships/unknown: City stays BLANK, never a township label ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok) =>
          setTimeout(() => ok({ coords: { latitude: 41.003902, longitude: -98.63262, accuracy: 8 } }), 10),
      },
      configurable: true,
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov")) {
        return new Response(JSON.stringify({ State: { code: "NE", name: "Nebraska" }, County: { name: "Hall" } }), { status: 200 });
      }
      if (u.includes("overpass")) throw new TypeError("overpass down");
      if (u.includes("bigdatacloud.net")) {
        return new Response(JSON.stringify({ city: "Township of Nowhere", locality: "Nowhere Township" }), { status: 200 });
      }
      if (u.includes("sdmdataaccess")) return new Response("{}", { status: 500 });
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t2c", header: { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  // Location capture is tap-only now (per explicit request) — kick it off.
  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.county === "Hall";
    },
    { timeout: 8000 }
  );
  await page.waitForTimeout(200);
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(!(header.city || "").trim(), `no candidate matches a real town -> City stays blank for manual entry (got "${header.city}")`);

  await page.close();
}

// ---- 3. Reverse-geocode failure: fails soft, fields stay blank for manual entry ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok) =>
          setTimeout(() => ok({ coords: { latitude: 42.034722, longitude: -93.62, accuracy: 8 } }), 10),
      },
      configurable: true,
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov") || u.includes("bigdatacloud.net") || u.includes("sdmdataaccess") || u.includes("overpass")) {
        throw new TypeError("network down");
      }
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t3", header: { cooperatorName: "Test Coop", state: "", county: "", city: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  // Location capture is tap-only now (per explicit request) — kick it off.
  await page.locator("button", { hasText: "Use Device" }).first().click();
  await page.waitForFunction(
    () => {
      const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
      return t.header && t.header.gpsLatitude === 42.034722;
    },
    { timeout: 8000 }
  );
  await page.waitForTimeout(400);
  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(
    !(header.state || "").trim() && !(header.county || "").trim() && !(header.city || "").trim(),
    `a dead network fails soft — GPS captured, region fields simply stay blank (got "${header.state}"/"${header.county}"/"${header.city}")`
  );

  await page.close();
}

// ---- 4. RACE GUARD (RC-audit fix): a County the user picks WHILE the
//         slow radius lookup is in flight must win over the lookup's
//         result — previously the lookup's patch silently reverted it ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok) =>
          setTimeout(() => ok({ coords: { latitude: 42.034722, longitude: -93.62, accuracy: 8 } }), 10),
      },
      configurable: true,
    });
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("geo.fcc.gov")) {
        return new Response(JSON.stringify({ State: { code: "IA", name: "Iowa" }, County: { name: "Story" } }), { status: 200 });
      }
      if (u.includes("overpass")) {
        // SLOW radius lookup — the race window under test.
        await new Promise((r) => setTimeout(r, 1500));
        return new Response(JSON.stringify({ elements: [] }), { status: 200 });
      }
      if (u.includes("bigdatacloud.net")) return new Response("{}", { status: 200 });
      if (u.includes("sdmdataaccess")) return new Response("{}", { status: 500 });
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t4", header: { cooperatorName: "Test Coop", state: "IA", county: "", city: "", zip: "" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  await page.locator("button", { hasText: "Use Device" }).first().click();

  // While the 1.5s Overpass call is still in flight, pick a county by hand.
  await page.waitForTimeout(500);
  await page.locator(".field", { has: page.locator(".field-label", { hasText: /^County$/ }) }).locator(".wheel-row-header").click();
  await page.waitForSelector(".wheel-panel .wheel-option", { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.click(".wheel-option:has-text('Polk')");
  await page.waitForTimeout(2500); // let the slow lookup land and commit

  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.county === "Polk", `a county picked mid-lookup WINS — the lookup's "Story" never overwrites it (got "${header.county}")`);
  check(header.state === "IA", `state is unaffected (got "${header.state}")`);
  await page.close();
}

// ---- 5. STATE CHANGE clears out-of-state County/City/Zip (RC-audit
//         approved fix) — a same-named survivor would be kept, but
//         Story/Ames don't exist in Nebraska ----
{
  const page = await browser.newPage({ hasTouch: true });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_ok, err) => err && err({ code: 1, message: "denied (mocked)" }) },
    });
  });
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      // "Ankeny" deliberately, NOT "Ames" — Nebraska has its own tiny
      // Ames (zip 68621), which the keep-a-same-named-survivor rule
      // correctly retains; Ankeny exists only in Iowa, so it must clear.
      JSON.stringify({ id: "t5", header: { cooperatorName: "Test Coop", state: "IA", county: "Story", city: "Ankeny", zip: "50023" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page.waitForSelector(".screen-body", { timeout: 5000 });
  await page.waitForTimeout(600); // geoData load

  await page.locator(".field", { has: page.locator(".field-label", { hasText: /^State$/ }) }).locator(".wheel-row-header").click();
  await page.waitForSelector(".wheel-panel .wheel-option", { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.click(".wheel-option:has-text('Nebraska')");
  await page.waitForTimeout(600);

  const header = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).header);
  check(header.state === "NE", `state switched to NE (got "${header.state}")`);
  check(!(header.county || "").trim(), `the Iowa county "Story" is cleared — it isn't a Nebraska county (got "${header.county}")`);
  check(!(header.city || "").trim(), `the Iowa-only city "Ankeny" is cleared with it (got "${header.city}")`);
  check(!(header.zip || "").trim(), `...and the Iowa zip goes with the city — no silent cross-state re-fill (got "${header.zip}")`);
  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
