// Verifies entryEditor.js's clear-on-brand-change rule — per explicit
// request (real field report: switching an entry's Brand from the
// default Midwest to Dekalb left Midwest's "00-28 CONV" + RM 100
// sitting in the fields): picking a DIFFERENT Brand/Company clears
// Hybrid, Trait, and RM outright and applies NO new defaults; the
// fields stay blank until a hybrid is deliberately picked. Re-picking
// the SAME brand changes nothing.
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

const FIXTURE_ROWS = [
  { company: "Midwest Seed Genetics", hybrid: "00-28 CONV", trait: "Conventional", rm: 100 },
  { company: "Dekalb", hybrid: "DKC60-88", trait: "SmartStax", rm: 110 },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

await page.addInitScript((rows) => {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/hybridCatalog")) {
      return new Response(JSON.stringify({ updatedAt: "2026-07-21T12:00:00.000Z", rows }), { status: 200 });
    }
    return realFetch(url, options);
  };
}, FIXTURE_ROWS);

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  localStorage.setItem(
    "cph.draftTrial",
    JSON.stringify({
      id: "t1",
      header: { cooperatorName: "Test Coop", state: "IA" },
      entries: [
        {
          id: "e1", brand: "Midwest Seed Genetics", hybrid: "00-28 CONV", trait: "Conventional", relativeMaturity: "100",
          seedTreatment: "Standard", sampleNetWeightLbs: "", testWeight: "", stripLengthFeet: "", numberOfRows: "",
          widthInches: "", comments: "", manualDryYield: "", moisturePercent: "",
        },
      ],
    })
  );
});
// Reach the editor through the Hybrid Entries list (the editor route
// takes params via in-app navigation, not the URL hash).
await page.goto(`${BASE}/index.html?r=1#/entries`);
await page.waitForSelector(".entry-row", { timeout: 5000 });
await page.click(".entry-row .entry-row-main");
await page.waitForSelector(".entry-editor-screen", { timeout: 5000 });

function rowValue(label) {
  return page.evaluate((lbl) => {
    const labels = Array.from(document.querySelectorAll(".field-label"));
    const el = labels.find((l) => l.textContent.trim() === lbl);
    const wrapper = el ? el.closest(".field") : null;
    const valueEl = wrapper ? wrapper.querySelector(".wheel-row-value") : null;
    return valueEl ? valueEl.textContent.trim() : null;
  }, label);
}

check((await rowValue("Hybrid")) === "00-28 CONV", `entry opens showing its Midwest hybrid (got "${await rowValue("Hybrid")}")`);

// ---- 1. Switch Brand to Dekalb: Hybrid/Trait/RM all clear, no defaults ----
await page.click(".field:has-text('Brand / Company') .wheel-row-header");
await page.waitForSelector(".search-list-input", { timeout: 3000 });
await page.fill(".search-list-input", "Dekalb");
await page.waitForTimeout(100);
await page.click(".search-list-option:not(.search-list-add-new)");
await page.waitForTimeout(300);

check((await rowValue("Brand / Company")) === "Dekalb", `Brand switched to Dekalb (got "${await rowValue("Brand / Company")}")`);
const hybridAfter = await rowValue("Hybrid");
check(hybridAfter === "Select…" || hybridAfter === "Select", `Hybrid cleared to its placeholder — no stale Midwest hybrid, no new default (got "${hybridAfter}")`);
const traitAfter = await rowValue("Trait");
check(traitAfter === "Select…" || traitAfter === "Select", `Trait cleared to its placeholder (got "${traitAfter}")`);
const rmAfter = await rowValue("Relative Maturity (RM)");
check(rmAfter === "Select" || rmAfter === "Select…", `RM cleared to its placeholder (got "${rmAfter}")`);
const stAfter = await rowValue("Seed Treatment");
check(stAfter === "Standard", `Seed Treatment is NOT brand-specific and survives the switch (got "${stAfter}")`);

// The stored entry is really cleared too (debounced persistence).
await page.waitForFunction(
  () => {
    const t = JSON.parse(localStorage.getItem("cph.draftTrial") || "{}");
    const e = t.entries && t.entries[0];
    return e && e.brand === "Dekalb" && e.hybrid === "" && e.trait === "" && e.relativeMaturity === "";
  },
  { timeout: 5000 }
);
check(true, "the stored entry's hybrid/trait/RM are cleared, brand is Dekalb");

// ---- 2. Picking a Dekalb hybrid now cascades Trait/RM as usual ----
await page.click(".field:has-text('Hybrid') .wheel-row-header");
await page.waitForSelector(".search-list-input", { timeout: 3000 });
await page.fill(".search-list-input", "DKC60");
await page.waitForTimeout(100);
await page.click(".search-list-option:not(.search-list-add-new)");
await page.waitForTimeout(300);
check((await rowValue("Hybrid")) === "DKC60-88", "a deliberate Dekalb hybrid pick fills Hybrid");
check((await rowValue("Relative Maturity (RM)")) === "110", `...and cascades its catalog RM (got "${await rowValue("Relative Maturity (RM)")}")`);
check((await rowValue("Trait")) === "SmartStax", `...and its single catalog Trait (got "${await rowValue("Trait")}")`);

// ---- 3. Re-picking the SAME brand leaves everything untouched ----
await page.click(".field:has-text('Brand / Company') .wheel-row-header");
await page.waitForSelector(".search-list-input", { timeout: 3000 });
await page.fill(".search-list-input", "Dekalb");
await page.waitForTimeout(100);
await page.click(".search-list-option:not(.search-list-add-new)");
await page.waitForTimeout(300);
check((await rowValue("Hybrid")) === "DKC60-88", `re-picking the same brand keeps the Hybrid (got "${await rowValue("Hybrid")}")`);
check((await rowValue("Relative Maturity (RM)")) === "110", `...and the RM (got "${await rowValue("Relative Maturity (RM)")}")`);
check((await rowValue("Trait")) === "SmartStax", `...and the Trait (got "${await rowValue("Trait")}")`);

await page.close();

// ---- 4. First-entry default: applied ONCE (with its catalog Trait),
//         and NEVER re-applied after a brand change cleared it — even
//         after leaving and reopening the entry (RC-audit fixes) ----
{
  const page2 = await browser.newPage();
  page2.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page2.addInitScript((rows) => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/hybridCatalog")) {
        return new Response(JSON.stringify({ updatedAt: "2026-07-21T12:00:00.000Z", rows }), { status: 200 });
      }
      return realFetch(url, options);
    };
  }, FIXTURE_ROWS);

  await page2.goto(`${BASE}/index.html`);
  await page2.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    // Pre-seed the catalog cache so the first-entry default (which runs
    // at editor mount) has catalog data available synchronously.
  });
  await page2.goto(`${BASE}/index.html?r=1#/trial-details`);
  await page2.waitForSelector(".screen-body", { timeout: 5000 });
  await page2.click("text=Continue to Hybrid Entries");
  await page2.waitForSelector(".entry-editor-screen", { timeout: 5000 });
  await page2.waitForTimeout(400);

  function rowValue2(label) {
    return page2.evaluate((lbl) => {
      const labels = Array.from(document.querySelectorAll(".field-label"));
      const el = labels.find((l) => l.textContent.trim() === lbl);
      const wrapper = el ? el.closest(".field") : null;
      const valueEl = wrapper ? wrapper.querySelector(".wheel-row-value") : null;
      return valueEl ? valueEl.textContent.trim() : null;
    }, label);
  }

  check((await rowValue2("Hybrid")) === "00-28 CONV", `the first entry defaults to the catalog's RM-100 hybrid (got "${await rowValue2("Hybrid")}")`);
  check((await rowValue2("Relative Maturity (RM)")) === "100", `...with RM 100 (got "${await rowValue2("Relative Maturity (RM)")}")`);
  check((await rowValue2("Trait")) === "Conventional", `...AND its single catalog Trait — the default gets the same cascade a manual pick would (got "${await rowValue2("Trait")}")`);

  // Switch Brand -> everything clears...
  await page2.click(".field:has-text('Brand / Company') .wheel-row-header");
  await page2.waitForSelector(".search-list-input", { timeout: 3000 });
  await page2.fill(".search-list-input", "Dekalb");
  await page2.waitForTimeout(100);
  await page2.click(".search-list-option:not(.search-list-add-new)");
  await page2.waitForTimeout(400);
  check((await rowValue2("Hybrid")).startsWith("Select"), `brand change clears the defaulted Hybrid (got "${await rowValue2("Hybrid")}")`);

  // ...and REOPENING the entry does NOT re-apply the default.
  await page2.click("text=Return to Plot Summary").catch(() => {});
  const backBtn = await page2.$("text=Return to Plot Summary");
  if (backBtn) await backBtn.click();
  await page2.waitForTimeout(400);
  // Navigate to the entries list and reopen entry 1 regardless of which
  // screen the button above landed on.
  await page2.goto(`${BASE}/index.html?r=2#/entries`);
  await page2.waitForSelector(".entry-row", { timeout: 5000 });
  await page2.click(".entry-row .entry-row-main");
  await page2.waitForSelector(".entry-editor-screen", { timeout: 5000 });
  await page2.waitForTimeout(400);
  check((await rowValue2("Hybrid")).startsWith("Select"), `reopening the entry does NOT sneak the RM-100 default back in (got "${await rowValue2("Hybrid")}")`);
  check((await rowValue2("Relative Maturity (RM)")).startsWith("Select"), `...RM stays blank too (got "${await rowValue2("Relative Maturity (RM)")}")`);

  await page2.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
