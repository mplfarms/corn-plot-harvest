// Verifies the "Upload Hybrid Catalog" button on the "All Plots (Admin)"
// screen (adminPlots.js) — the admin-only way to update the shared
// Company/Hybrid/Trait/RM reference data behind entryEditor.js's
// cascading pickers (see catalogStore.js / hybridCatalogImport.js /
// companyMatch.js / netlify/functions/hybridCatalog.js). Uses a .csv
// fixture rather than .xlsx here specifically so this test doesn't
// depend on fetching SheetJS from a CDN (no network access in this
// sandbox, see xlsxLibLoader.js's top comment) — the .csv path and the
// .xlsx path share the exact same rowsFromAOA() validation logic once
// parsed into a grid (see unit_hybrid_catalog_import.mjs), so this still
// exercises the real parsing/canonicalization/upload pipeline end to end.
//
//   1. The "Hybrid Catalog" section + status text + button are visible
//      to an admin, hidden entirely from a non-admin.
//   2. Uploading a valid .csv POSTs canonicalized rows and shows a
//      success toast with counts, updating the on-screen status text.
//   3. An "obvious duplicate" company spelling in the upload
//      (AgriGold) gets folded into this app's existing company
//      (Agrigold) rather than reported as a new brand; a genuinely new
//      company IS counted as new.
//   4. A file with unrecognized headers shows a client-side error toast
//      without ever calling the server.
//   5. A server-side error (e.g. a stale non-admin session) shows an
//      error toast and re-enables the button.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cph-catalog-"));

const goodCsvPath = path.join(tmpDir, "catalog.csv");
fs.writeFileSync(
  goodCsvPath,
  [
    "Brand,Hybrid Name,Maturity (RM/CRM day),Trait,Confidence,Notes",
    "AgriGold,A616-30,86,VT Double PRO,High,",
    "AgriGold,A620-99,90,SmartStax,High,",
    "AgriGold,A620-99,90,VT Double PRO,High,",
    "Some Brand New Seed Co,SBN100,95,Conventional,High,",
  ].join("\n")
);

const badHeaderCsvPath = path.join(tmpDir, "bad_header.csv");
fs.writeFileSync(badHeaderCsvPath, ["Foo,Bar,Baz", "1,2,3"].join("\n"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

function mockPlotsAndAdminUsers() {
  // Falls back to the real fetch for anything unmatched (crucially
  // /DefaultLists.json — listsStore.ensureLoaded() needs this to
  // actually succeed so its real company list, e.g. "Agrigold", is
  // loaded; without this fallback every unmatched fetch would throw and
  // silently leave listsStore.items(BRAND_COMPANY) empty, breaking the
  // canonicalization checks below for a completely different reason
  // than what they're meant to test).
  return () => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && u.includes("scope=all")) {
        return new Response(
          JSON.stringify({
            users: [
              { email: "admin@example.com", name: "Admin User", firstName: "Admin", lastName: "User", mobileNumber: "", isAdmin: true, trials: [] },
            ],
          }),
          { status: 200 }
        );
      }
      if (u.includes("/.netlify/functions/hybridCatalog") && (!options || !options.method || options.method === "GET")) {
        return new Response(JSON.stringify({ updatedAt: null, rows: [] }), { status: 200 });
      }
      if (u.includes("/.netlify/functions/hybridCatalog") && options && options.method === "POST") {
        window.__catalogUploadCalls = window.__catalogUploadCalls || [];
        const parsed = JSON.parse(options.body);
        window.__catalogUploadCalls.push(parsed);
        const companyCount = new Set(parsed.rows.map((r) => r.company.toLowerCase())).size;
        return new Response(
          JSON.stringify({ rowCount: parsed.rows.length, companyCount, updatedAt: "2026-07-21T12:00:00.000Z" }),
          { status: 200 }
        );
      }
      return realFetch(url, options);
    };
  };
}

// ---- 1 & 2 & 3. Happy path: section visible, upload succeeds, canonicalization + new-brand counting ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(mockPlotsAndAdminUsers());

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });

  const uploadBtn = page.locator("button", { hasText: "Upload Hybrid Catalog" });
  check(await uploadBtn.count() === 1, "the \"Upload Hybrid Catalog\" button is visible to an admin");

  const statusBefore = await page.locator(".field-note").first().textContent();
  check(/No Hybrid Catalog uploaded yet/.test(statusBefore), `status text shows nothing uploaded yet before the first upload (got "${statusBefore}")`);

  await page.locator('input[type="file"]').setInputFiles(goodCsvPath);
  await page.waitForSelector(".toast", { timeout: 5000 });
  const toastText = await page.$eval(".toast", (el) => el.textContent);
  check(/Hybrid Catalog updated: 4 hybrids across 2 brands/.test(toastText), `success toast summarizes row/brand counts (got "${toastText}")`);
  check(/1 new brand/.test(toastText), `success toast reports exactly 1 genuinely new brand — AgriGold folded into Agrigold, only "Some Brand New Seed Co" counts as new (got "${toastText}")`);

  const uploadCalls = await page.evaluate(() => window.__catalogUploadCalls);
  check(uploadCalls.length === 1, `exactly one upload request was sent (got ${uploadCalls.length})`);
  const uploadedCompanies = uploadCalls[0].rows.map((r) => r.company);
  check(uploadedCompanies.every((c) => c !== "AgriGold"), `"AgriGold" was rewritten before upload, not sent verbatim (got ${JSON.stringify(uploadedCompanies)})`);
  check(uploadedCompanies.includes("Agrigold"), `"AgriGold" rows were canonicalized to this app's existing "Agrigold" spelling (got ${JSON.stringify(uploadedCompanies)})`);
  check(uploadedCompanies.includes("Some Brand New Seed Co"), "a genuinely new company name passes through unchanged");

  await page.waitForFunction(() => document.querySelector(".field-note")?.textContent.includes("4 hybrids"), { timeout: 5000 });
  const statusAfter = await page.locator(".field-note").first().textContent();
  check(/4 hybrids across 2 brands/.test(statusAfter), `status text updates immediately after a successful upload (got "${statusAfter}")`);

  await page.close();
}

// ---- 4. Unrecognized headers: client-side error, never reaches the server ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(mockPlotsAndAdminUsers());

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });

  await page.locator('input[type="file"]').setInputFiles(badHeaderCsvPath);
  await page.waitForSelector(".toast", { timeout: 5000 });
  const toastText = await page.$eval(".toast", (el) => el.textContent);
  check(/Couldn't find/.test(toastText), `a file with unrecognized headers shows a clear client-side error (got "${toastText}")`);

  const uploadCalls = await page.evaluate(() => window.__catalogUploadCalls || []);
  check(uploadCalls.length === 0, "an unparseable file never even reaches the server");

  await page.close();
}

// ---- 5. Non-admin never sees the Hybrid Catalog section ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Regular User", email: "regular@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  const uploadBtnCount = await page.locator("button", { hasText: "Upload Hybrid Catalog" }).count();
  check(uploadBtnCount === 0, "a non-admin session never sees the Upload Hybrid Catalog button (the whole screen is gated)");
  await page.close();
}

// ---- 6. Server-side error re-enables the button with an error toast ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && u.includes("scope=all")) {
        return new Response(
          JSON.stringify({
            users: [
              { email: "admin@example.com", name: "Admin User", firstName: "Admin", lastName: "User", mobileNumber: "", isAdmin: true, trials: [] },
            ],
          }),
          { status: 200 }
        );
      }
      if (u.includes("/.netlify/functions/hybridCatalog") && (!options || !options.method || options.method === "GET")) {
        return new Response(JSON.stringify({ updatedAt: null, rows: [] }), { status: 200 });
      }
      if (u.includes("/.netlify/functions/hybridCatalog") && options && options.method === "POST") {
        return new Response(JSON.stringify({ error: "Admin access required." }), { status: 403 });
      }
      return realFetch(url, options);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });

  const uploadBtn = page.locator("button", { hasText: "Upload Hybrid Catalog" });
  await page.locator('input[type="file"]').setInputFiles(goodCsvPath);
  await page.waitForSelector(".toast", { timeout: 5000 });
  const toastText = await page.$eval(".toast", (el) => el.textContent);
  check(/Couldn't upload Hybrid Catalog.*Admin access required/.test(toastText), `a server error surfaces its actual message in the toast (got "${toastText}")`);
  const isDisabledAfterError = await uploadBtn.isDisabled();
  check(isDisabledAfterError === false, "the button re-enables itself after a failed attempt");
  const labelAfterError = await uploadBtn.textContent();
  check(labelAfterError === "Upload Hybrid Catalog", `the button's label reverts back to normal after a failed attempt (got "${labelAfterError}")`);

  await page.close();
}

await browser.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
