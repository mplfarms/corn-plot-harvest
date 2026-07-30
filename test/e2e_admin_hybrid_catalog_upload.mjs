// Verifies the Hybrid Catalog upload section in Settings' Admin card —
// per explicit request the catalog is now maintained as TWO separate
// uploads: "Upload Company Hybrids" (MW / NC / CR incl. the house
// alias, plus SuperCrost) and "Upload Alt. Variety Hybrids" (every
// other brand). Each upload replaces ONLY its own half of the catalog
// (server-side group mode — the mock below emulates the real merge in
// netlify/functions/hybridCatalog.js); rows belonging to the other
// upload are IGNORED WITH A NOTICE, never routed or uploaded. Uses .csv
// fixtures so no SheetJS/CDN is needed (same reasoning as before — the
// .csv and .xlsx paths share rowsFromAOA()).
//
//   1. Both upload buttons visible to an admin; hidden from a non-admin.
//   2. Alt upload: canonicalization (AgriGold -> Agrigold), new-brand
//      counting, and a mixed-in MW/NC/CR row is skipped with a notice.
//   3. Company upload afterward: replaces only the company half — the
//      alt rows survive; a mixed-in Pioneer row is skipped with a
//      notice; SuperCrost is accepted as a company row.
//   4. Wrong-file safety: a pure-alt file on the company button errors
//      without reaching the server.
//   5. Unrecognized headers: client-side error, no server call.
//   6. A server error surfaces its message and re-enables the button.
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

// Alt. Variety file — with one house-alias row mixed in by mistake.
const altCsvPath = path.join(tmpDir, "alt_catalog.csv");
fs.writeFileSync(
  altCsvPath,
  [
    "Brand,Hybrid Name,Maturity (RM/CRM day),Trait,Confidence,Notes",
    "AgriGold,A616-30,86,VT Double PRO,High,",
    "AgriGold,A620-99,90,SmartStax,High,",
    "AgriGold,A620-99,90,VT Double PRO,High,",
    "Some Brand New Seed Co,SBN100,95,Conventional,High,",
    "MW / NC / CR,83-31 VT2PRIB,83,VT2P RIB,High,",
  ].join("\n")
);

// Company file — MW/NC/CR alias + SuperCrost, with one Pioneer row
// mixed in by mistake.
const companyCsvPath = path.join(tmpDir, "company_catalog.csv");
fs.writeFileSync(
  companyCsvPath,
  [
    "Brand,Hybrid Name,Maturity (RM/CRM day),Trait,Confidence,Notes",
    "MW / NC / CR,83-31 VT2PRIB,83,VT2P RIB,High,",
    "MW / NC / CR,88-12 TRERIB,88,Trecepta RIB,High,",
    "SuperCrost,10T84 VT2PRIB,84,VT2P RIB,High,",
    "Pioneer,P0075AM,100,AcreMax,High,",
  ].join("\n")
);

const badHeaderCsvPath = path.join(tmpDir, "bad_header.csv");
fs.writeFileSync(badHeaderCsvPath, ["Foo,Bar,Baz", "1,2,3"].join("\n"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

function mockPlotsAndCatalogServer() {
  // Emulates netlify/functions/hybridCatalog.js's group-merge semantics
  // in-page (window.__serverRows persists across POSTs on the same
  // page), and falls back to the real fetch for anything unmatched —
  // crucially /DefaultLists.json (listsStore needs it for the
  // canonicalization checks).
  return () => {
    const COMPANY_KEYS = new Set(["midwestseedgenetics", "nchybrids", "crows", "supercrost", "mwnccr"]);
    const isCompanyBrand = (c) => COMPANY_KEYS.has(String(c || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    window.__serverRows = [];
    window.__catalogUploadCalls = [];
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
        const parsed = JSON.parse(options.body);
        window.__catalogUploadCalls.push(parsed);
        const wantCompany = parsed.group === "company";
        const uploaded = parsed.rows.filter((r) => isCompanyBrand(r.company) === wantCompany);
        const keptOther = window.__serverRows.filter((r) => isCompanyBrand(r.company) !== wantCompany);
        window.__serverRows = wantCompany ? [...uploaded, ...keptOther] : [...keptOther, ...uploaded];
        const companyCount = new Set(uploaded.map((r) => r.company.toLowerCase())).size;
        return new Response(
          JSON.stringify({
            rowCount: uploaded.length,
            companyCount,
            totalRowCount: window.__serverRows.length,
            updatedAt: "2026-07-29T12:00:00.000Z",
            rows: window.__serverRows,
          }),
          { status: 200 }
        );
      }
      return realFetch(url, options);
    };
  };
}

async function openSettingsAsAdmin(page) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });
}

async function lastToastText(page) {
  await page.waitForSelector(".toast", { timeout: 5000 });
  return page.$$eval(".toast", (els) => els[els.length - 1].textContent);
}

// ---- 1-3. Happy path: both buttons, alt upload then company upload,
//           each replacing only its own half ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(mockPlotsAndCatalogServer());
  await openSettingsAsAdmin(page);

  check((await page.locator("button", { hasText: "Upload Company Hybrids" }).count()) === 1, 'the "Upload Company Hybrids" button is visible to an admin');
  check((await page.locator("button", { hasText: "Upload Alt. Variety Hybrids" }).count()) === 1, 'the "Upload Alt. Variety Hybrids" button is visible to an admin');

  const statusBefore = await page.locator(".hybrid-catalog-upload-section > .field-note").first().textContent();
  check(/No Hybrid Catalog uploaded yet/.test(statusBefore), `status text shows nothing uploaded yet (got "${statusBefore}")`);

  // -- Alt upload (with a mixed-in house-alias row) --
  await page.locator('.hybrid-catalog-upload-alt input[type="file"]').setInputFiles(altCsvPath);
  let toast = await lastToastText(page);
  check(/Alt\. Variety Hybrids updated: 4 hybrids across 2 brands/.test(toast), `alt success toast counts only the alt rows (got "${toast}")`);
  check(/1 new brand/.test(toast), `AgriGold folds into Agrigold; only "Some Brand New Seed Co" is new (got "${toast}")`);
  check(/Skipped 1 row that belongs in the "Company Hybrids" upload/.test(toast), `the mixed-in MW\/NC\/CR row is ignored WITH A NOTICE (got "${toast}")`);

  let calls = await page.evaluate(() => window.__catalogUploadCalls);
  check(calls.length === 1 && calls[0].group === "alt", `the upload POSTs with group:"alt" (got ${JSON.stringify(calls.map((c) => c.group))})`);
  const altCompanies = calls[0].rows.map((r) => r.company);
  check(altCompanies.every((c) => c !== "AgriGold") && altCompanies.includes("Agrigold"), `"AgriGold" canonicalized to "Agrigold" before upload (got ${JSON.stringify([...new Set(altCompanies)])})`);
  check(!altCompanies.some((c) => /mw|midwest|nc|crow/i.test(c)), `no house rows were uploaded from the alt file (got ${JSON.stringify([...new Set(altCompanies)])})`);

  // -- Company upload (with a mixed-in Pioneer row) — alt half survives --
  await page.locator('.hybrid-catalog-upload-company input[type="file"]').setInputFiles(companyCsvPath);
  toast = await lastToastText(page);
  check(/Company Hybrids updated: 7 hybrids across 4 brands/.test(toast), `company toast counts the expanded house rows (2 alias rows -> 6) + SuperCrost (got "${toast}")`);
  check(/Skipped 1 row that belongs in the "Alt\. Variety Hybrids" upload/.test(toast), `the mixed-in Pioneer row is ignored WITH A NOTICE (got "${toast}")`);

  calls = await page.evaluate(() => window.__catalogUploadCalls);
  check(calls.length === 2 && calls[1].group === "company", `the second upload POSTs with group:"company"`);
  const companyCompanies = [...new Set(calls[1].rows.map((r) => r.company))].sort();
  check(
    JSON.stringify(companyCompanies) === JSON.stringify(["Crow's", "Midwest Seed Genetics", "NC+ Hybrids", "SuperCrost"]),
    `the company upload carries the 3 expanded house brands + SuperCrost, nothing else (got ${JSON.stringify(companyCompanies)})`
  );

  // -- The merged catalog (what every picker reads) holds BOTH halves --
  const cached = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.hybridCatalog")));
  const cachedCompanies = [...new Set(cached.rows.map((r) => r.company))];
  check(
    cachedCompanies.includes("Agrigold") && cachedCompanies.includes("Some Brand New Seed Co") && cachedCompanies.includes("SuperCrost") && cachedCompanies.includes("Midwest Seed Genetics"),
    `after both uploads the cached catalog holds both halves (got ${JSON.stringify(cachedCompanies)})`
  );
  check(cached.rows.length === 11, `4 alt + 7 company rows = 11 total (got ${cached.rows.length})`);

  const statusAfter = await page.locator(".hybrid-catalog-upload-section > .field-note").first().textContent();
  check(/7 company \+ 4 alt\. variety hybrids across 6 brands/.test(statusAfter), `the status line breaks the catalog down by half (got "${statusAfter}")`);

  await page.close();
}

// ---- 4. Wrong-file safety: a pure-alt file on the Company button ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(mockPlotsAndCatalogServer());
  await openSettingsAsAdmin(page);

  const pureAltCsv = path.join(tmpDir, "pure_alt.csv");
  fs.writeFileSync(pureAltCsv, ["Brand,Hybrid,RM,Trait", "Pioneer,P0075AM,100,AcreMax", "Dekalb,DKC60-88,110,SmartStax"].join("\n"));
  await page.locator('.hybrid-catalog-upload-company input[type="file"]').setInputFiles(pureAltCsv);
  const toast = await lastToastText(page);
  check(
    /Couldn't upload Company Hybrids: No Company Hybrids rows found in this file \(all 2 rows belong in the "Alt\. Variety Hybrids" upload\)/.test(toast),
    `a pure-alt file on the Company button errors clearly (got "${toast}")`
  );
  const calls = await page.evaluate(() => window.__catalogUploadCalls);
  check(calls.length === 0, "the wrong-file upload never reaches the server");
  await page.close();
}

// ---- 5. Unrecognized headers: client-side error, no server call ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript(mockPlotsAndCatalogServer());
  await openSettingsAsAdmin(page);

  await page.locator('.hybrid-catalog-upload-alt input[type="file"]').setInputFiles(badHeaderCsvPath);
  const toast = await lastToastText(page);
  check(/Couldn't find/.test(toast), `a file with unrecognized headers shows a clear client-side error (got "${toast}")`);
  const calls = await page.evaluate(() => window.__catalogUploadCalls || []);
  check(calls.length === 0, "an unparseable file never reaches the server");
  await page.close();
}

// ---- 6. Non-admin never sees the upload section ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Regular User", email: "regular@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });
  const count =
    (await page.locator("button", { hasText: "Upload Company Hybrids" }).count()) +
    (await page.locator("button", { hasText: "Upload Alt. Variety Hybrids" }).count());
  check(count === 0, "a non-admin session never sees either upload button (the Admin card is gated)");
  await page.close();
}

// ---- 7. Server-side error re-enables the button with an error toast ----
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
  await openSettingsAsAdmin(page);

  const uploadBtn = page.locator("button", { hasText: "Upload Company Hybrids" });
  await page.locator('.hybrid-catalog-upload-company input[type="file"]').setInputFiles(companyCsvPath);
  const toast = await lastToastText(page);
  check(/Couldn't upload Company Hybrids.*Admin access required/.test(toast), `a server error surfaces its actual message (got "${toast}")`);
  check((await uploadBtn.isDisabled()) === false, "the button re-enables itself after a failed attempt");
  check((await uploadBtn.textContent()) === "Upload Company Hybrids", "the button's label reverts after a failed attempt");
  await page.close();
}

await browser.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
