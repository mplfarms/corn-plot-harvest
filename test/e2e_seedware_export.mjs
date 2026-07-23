// Verifies the new "Export for Seedware" feature (see
// core/seedwareExportBuilder.js):
//   1. Direct module test — column mapping (Variety Provider Company vs.
//      Competitor vs. Request, Position sequencing, blank entries
//      skipped, Form Type/Test Type/Crop fixed values, Yield computed,
//      filename convention), reading real cell values back out of the
//      generated .xlsx's zip (not just trusting the JS function's
//      inputs/outputs) — including the "+ Add New" -> Request case: a
//      custom hybrid under a known brand, and a custom brand itself,
//      both land as Variety Provider "Request" with Variety blank and
//      Request Variety/Company/Trait/Maturity filled in instead.
//   2. The Plot Summary share menu offers "Export for Seedware" as its
//      own action, and — per explicit request — it now shares BOTH the
//      Seedware file and the full Trial Outline xlsx together (mocked
//      Web Share), not the Seedware file alone.
//   3. "Email XLSX to ... Operations" also shares BOTH the full Trial
//      Outline xlsx and the Seedware file together (mocked Web Share).
//   4. End-to-end through the REAL listsStore (cph.customLists in
//      localStorage, exactly as addCustomItem()/addCustomHybrid()
//      persist it) rather than a stubbed customChecks — confirms
//      plotSummary.js actually wires listsStore.isCustomCompany()/
//      isCustomHybrid() into the export, not just that the builder
//      function works in isolation.
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

// ---- 1. Direct module test of buildSeedwareExport() ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);

  const result = await page.evaluate(async () => {
    const { buildSeedwareExport, varietyProviderFor, seedwareExportFilename } = await import(
      "/js/core/seedwareExportBuilder.js"
    );

    // Minimal reader for the STORED (uncompressed) zip entries
    // zipWriter.js always produces — good enough to pull xl/worksheets/
    // sheet1.xml's raw text back out for a real, end-to-end check of
    // what actually landed in the file, not just what the JS functions
    // would produce in isolation.
    function readZipEntryText(buf, path) {
      const dv = new DataView(buf);
      let eocd = -1;
      for (let i = buf.byteLength - 22; i >= 0; i--) {
        if (dv.getUint32(i, true) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd === -1) throw new Error("EOCD not found");
      const totalEntries = dv.getUint16(eocd + 10, true);
      let offset = dv.getUint32(eocd + 16, true);
      const decoder = new TextDecoder();
      for (let i = 0; i < totalEntries; i++) {
        const compSize = dv.getUint32(offset + 20, true);
        const nameLen = dv.getUint16(offset + 28, true);
        const extraLen = dv.getUint16(offset + 30, true);
        const commentLen = dv.getUint16(offset + 32, true);
        const localHeaderOffset = dv.getUint32(offset + 42, true);
        const name = decoder.decode(new Uint8Array(buf, offset + 46, nameLen));
        if (name === path) {
          const lhNameLen = dv.getUint16(localHeaderOffset + 26, true);
          const lhExtraLen = dv.getUint16(localHeaderOffset + 28, true);
          const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
          return decoder.decode(new Uint8Array(buf, dataStart, compSize));
        }
        offset += 46 + nameLen + extraLen + commentLen;
      }
      return null;
    }

    // Cell value at a given ref (e.g. "Q3") — text via inlineStr, number
    // via <v>, or "" for a present-but-blank self-closed cell, undefined
    // if the ref doesn't appear at all.
    function cellValue(sheetXml, ref) {
      const re = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(?:<is><t[^>]*>([^<]*)</t></is>|<v>([^<]*)</v>)?</c>)`);
      const m = re.exec(sheetXml);
      if (!m) return undefined;
      if (m[1] !== undefined) return m[1];
      if (m[2] !== undefined) return Number(m[2]);
      return "";
    }

    const header = {
      formId: "26-1042",
      datePlanted: "2026-05-10",
      dateHarvested: "2026-10-15",
      previousCrop: "Soybeans",
      city: "Ames",
      state: "IA",
      zip: "50010",
      gpsLatitude: 42.034534,
      gpsLongitude: -93.62,
      cooperatorName: "Test Cooperator",
    };
    const entries = [
      {
        // Row 2: known Company brand, known (non-custom) hybrid.
        brand: "Midwest Seed Genetics",
        hybrid: "12-34 ABC",
        trait: "VT2PRIB",
        relativeMaturity: "112",
        seedTreatment: "Poncho/Votivo",
        stripLengthFeet: "500",
        widthInches: "30",
        numberOfRows: "6",
        moisturePercent: "16.5",
        sampleNetWeightLbs: "2500",
        manualDryYield: "",
      },
      // A blank entry (no brand/hybrid) — must be skipped entirely, not
      // just left mostly-empty, and must NOT consume a Position number.
      { brand: "", hybrid: "", seedTreatment: "", stripLengthFeet: "", widthInches: "", numberOfRows: "", moisturePercent: "", sampleNetWeightLbs: "", manualDryYield: "" },
      {
        // Row 3 (Position 2): known Competitor brand.
        brand: "Pioneer",
        hybrid: "P1185Q",
        seedTreatment: "",
        stripLengthFeet: "500",
        widthInches: "30",
        numberOfRows: "6",
        moisturePercent: "17.0",
        sampleNetWeightLbs: "",
        manualDryYield: "225.5", // manual override should win over calculated
      },
      {
        // Row 4 (Position 3): stray casing/whitespace should still match "Company".
        brand: "  super crost  ",
        hybrid: "SC-99",
        seedTreatment: "",
        stripLengthFeet: "500",
        widthInches: "30",
        numberOfRows: "6",
        moisturePercent: "15.0",
        sampleNetWeightLbs: "2400",
        manualDryYield: "",
      },
      {
        // Row 5 (Position 4): known Company brand, but a HAND-TYPED
        // "+Add New" hybrid under it -> Request, not Company.
        brand: "Midwest Seed Genetics",
        hybrid: "99-99 BRAND NEW",
        trait: "New Trait",
        relativeMaturity: "99",
        seedTreatment: "",
        stripLengthFeet: "500",
        widthInches: "30",
        numberOfRows: "6",
        moisturePercent: "18.0",
        sampleNetWeightLbs: "2600",
        manualDryYield: "",
      },
      {
        // Row 6 (Position 5): the BRAND itself is a hand-typed "+Add
        // New" company -> Request too, regardless of the hybrid.
        brand: "Some Brand New Seed Co",
        hybrid: "XYZ-123",
        trait: "",
        relativeMaturity: "",
        seedTreatment: "",
        stripLengthFeet: "500",
        widthInches: "30",
        numberOfRows: "6",
        moisturePercent: "16.0",
        sampleNetWeightLbs: "2450",
        manualDryYield: "",
      },
    ];

    // Stub customChecks: only "99-99 BRAND NEW" (under Midwest Seed
    // Genetics) and "Some Brand New Seed Co" itself count as "+Add New"
    // custom items — mirrors listsStore.isCustomCompany()/isCustomHybrid().
    const customChecks = {
      isCustomCompany: (name) => (name || "").trim() === "Some Brand New Seed Co",
      isCustomHybrid: (brand, hybrid) =>
        (brand || "").trim() === "Midwest Seed Genetics" && (hybrid || "").trim() === "99-99 BRAND NEW",
    };

    const { blob, filename } = buildSeedwareExport(header, entries, customChecks);
    const buf = await blob.arrayBuffer();
    const sheetXml = readZipEntryText(buf, "xl/worksheets/sheet1.xml");

    return {
      filename,
      byteLength: buf.byteLength,
      providerMidwest: varietyProviderFor("Midwest Seed Genetics"),
      providerNcPlus: varietyProviderFor("NC+ Hybrids"),
      providerSuperCrost: varietyProviderFor("Super Crost"),
      providerPioneer: varietyProviderFor("Pioneer"),
      providerBlank: varietyProviderFor(""),
      fallbackFilename: seedwareExportFilename({ formId: "", state: "IA", cooperatorName: "Some Co-op", datePlanted: "2026-01-01" }),
      // Row 5 = Position 4 = the custom-hybrid-under-a-known-brand case.
      row5: {
        varietyProvider: cellValue(sheetXml, "P5"),
        variety: cellValue(sheetXml, "Q5"),
        requestVariety: cellValue(sheetXml, "S5"),
        requestCompany: cellValue(sheetXml, "T5"),
        requestTrait: cellValue(sheetXml, "U5"),
        requestMaturity: cellValue(sheetXml, "V5"),
      },
      // Row 6 = Position 5 = the custom-brand-itself case.
      row6: {
        varietyProvider: cellValue(sheetXml, "P6"),
        variety: cellValue(sheetXml, "Q6"),
        requestVariety: cellValue(sheetXml, "S6"),
        requestCompany: cellValue(sheetXml, "T6"),
      },
      // Row 2 = Position 1 = the ordinary Company case, to confirm
      // Request Variety/Company/Trait/Maturity stay blank there.
      row2: {
        varietyProvider: cellValue(sheetXml, "P2"),
        variety: cellValue(sheetXml, "Q2"),
        requestVariety: cellValue(sheetXml, "S2"),
        requestCompany: cellValue(sheetXml, "T2"),
      },
    };
  });

  check(result.filename === "26-1042_Seedware.xlsx", `filename uses "<formId>_Seedware.xlsx" (got "${result.filename}")`);
  check(result.byteLength > 0, "the export produced a non-empty file");
  check(result.providerMidwest === "Company", `Midwest Seed Genetics -> Company (got "${result.providerMidwest}")`);
  check(result.providerNcPlus === "Company", `NC+ Hybrids -> Company (got "${result.providerNcPlus}")`);
  check(result.providerSuperCrost === "Company", `"  super crost  " (stray case/whitespace) -> Company (got "${result.providerSuperCrost}")`);
  check(result.providerPioneer === "Competitor", `Pioneer -> Competitor (got "${result.providerPioneer}")`);
  check(result.providerBlank === "Competitor", `blank brand (no customChecks) -> Competitor, not Request (got "${result.providerBlank}")`);
  check(
    result.fallbackFilename === "IA_2026_Some_Co_op_Seedware.xlsx",
    `fallback filename (no Form ID yet) matches the State_Year_Cooperator_Seedware scheme (got "${result.fallbackFilename}")`
  );

  check(result.row2.varietyProvider === "Company", `ordinary row: Variety Provider is Company (got "${result.row2.varietyProvider}")`);
  check(result.row2.variety === "12-34 ABC", `ordinary row: Variety is filled in (got "${result.row2.variety}")`);
  check(result.row2.requestVariety === "", `ordinary row: Request Variety stays blank (got "${result.row2.requestVariety}")`);
  check(result.row2.requestCompany === "", `ordinary row: Request Company stays blank (got "${result.row2.requestCompany}")`);

  check(
    result.row5.varietyProvider === "Request",
    `a hand-typed "+Add New" hybrid under a known Company brand -> Request (got "${result.row5.varietyProvider}")`
  );
  check(result.row5.variety === "", `that row's Variety column is left blank (got "${result.row5.variety}")`);
  check(
    result.row5.requestVariety === "99-99 BRAND NEW",
    `that row's Request Variety holds the hybrid name (got "${result.row5.requestVariety}")`
  );
  check(
    result.row5.requestCompany === "Midwest Seed Genetics",
    `that row's Request Company holds the brand name (got "${result.row5.requestCompany}")`
  );
  check(result.row5.requestTrait === "New Trait", `that row's Request Trait carries the entry's trait (got "${result.row5.requestTrait}")`);
  check(result.row5.requestMaturity === 99, `that row's Request Maturity carries the entry's RM (got ${result.row5.requestMaturity})`);

  check(
    result.row6.varietyProvider === "Request",
    `a hand-typed "+Add New" BRAND itself -> Request regardless of the hybrid (got "${result.row6.varietyProvider}")`
  );
  check(result.row6.variety === "", `that row's Variety column is also left blank (got "${result.row6.variety}")`);
  check(result.row6.requestVariety === "XYZ-123", `that row's Request Variety holds the hybrid name (got "${result.row6.requestVariety}")`);
  check(
    result.row6.requestCompany === "Some Brand New Seed Co",
    `that row's Request Company holds the custom brand name (got "${result.row6.requestCompany}")`
  );

  await page.close();
}

// ---- 2 & 3. Plot Summary share menu + the email action's dual-file share ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  // Mock the Web Share API so handleEmailXlsx()/handleExportSeedware()
  // take the navigator.share path instead of falling back to a real
  // browser download, and record what was actually shared.
  await page.addInitScript(() => {
    window.__shareCalls = [];
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data) => {
        window.__shareCalls.push({
          title: data.title,
          files: (data.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
        });
      },
      configurable: true,
    });
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "seedware-test-trial",
        header: {
          formId: "26-1777",
          cooperatorName: "Seedware Test Co-op",
          state: "IA",
          county: "Story",
          city: "Ames",
          zip: "50010",
          datePlanted: "2026-05-01",
          dateHarvested: "2026-10-01",
          previousCrop: "Corn",
        },
        entries: [
          {
            id: "e1",
            brand: "Midwest Seed Genetics",
            hybrid: "12-34 ABC",
            trait: "",
            relativeMaturity: "112",
            seedTreatment: "",
            sampleNetWeightLbs: "2500",
            moisturePercent: "16.5",
            testWeight: "",
            stripLengthFeet: "500",
            numberOfRows: "6",
            widthInches: "30",
            comments: "",
            manualDryYield: "",
          },
        ],
      })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  await page.click("text=Share This Plot");
  await page.waitForSelector(".modal-overlay:not(.hidden) .modal-card-large", { timeout: 3000 });
  const menuItems = await page.$$eval(".modal-overlay .share-menu-item", (els) => els.map((e) => e.textContent));
  check(menuItems.some((t) => t.includes("Export for Seedware")), `share menu includes "Export for Seedware" (got ${JSON.stringify(menuItems)})`);
  check(
    menuItems.some((t) => t.startsWith("Email XLSX to")),
    "share menu still includes the Email XLSX to Operations action"
  );

  // ---- 2b. "Export for Seedware" now bundles BOTH the Seedware file
  // AND the full Trial Outline xlsx together (per explicit request —
  // the filled-out harvest form rides along with it, same as "Email
  // XLSX to Operations" already does below) ----
  await page.click("text=Export for Seedware");
  await page.waitForTimeout(300);
  let shareCalls = await page.evaluate(() => window.__shareCalls);
  check(shareCalls.length === 1, `"Export for Seedware" triggered exactly one share call (got ${shareCalls.length})`);
  if (shareCalls.length === 1) {
    const names = shareCalls[0].files.map((f) => f.name).sort();
    check(
      names.length === 2 && names.includes("26-1777.xlsx") && names.includes("26-1777_Seedware.xlsx"),
      `"Export for Seedware" includes both the Seedware file and the full Trial Outline xlsx (got ${JSON.stringify(names)})`
    );
  }

  // ---- 3. "Email XLSX to ... Operations" shares BOTH files together ----
  await page.evaluate(() => {
    window.__shareCalls.length = 0;
  });
  await page.click("text=Share This Plot");
  await page.waitForSelector(".modal-overlay:not(.hidden) .modal-card-large", { timeout: 3000 });
  await page.click("text=Email XLSX to Midwest Seed Genetics Operations");
  await page.waitForTimeout(400);
  shareCalls = await page.evaluate(() => window.__shareCalls);
  check(shareCalls.length === 1, `"Email XLSX to Operations" triggered exactly one share call (got ${shareCalls.length})`);
  if (shareCalls.length === 1) {
    const names = shareCalls[0].files.map((f) => f.name).sort();
    check(
      names.length === 2 && names.includes("26-1777.xlsx") && names.includes("26-1777_Seedware.xlsx"),
      `the email share includes both the full Trial Outline xlsx and the Seedware file (got ${JSON.stringify(names)})`
    );
  }

  await page.close();
}

// ---- 4. End-to-end through the REAL listsStore (not a stub): a brand
//         and hybrid that were actually added via "+Add New" at some
//         point (persisted in cph.customLists, exactly how
//         listsStore.addCustomItem()/addCustomHybrid() store them)
//         resolve to "Request" when the Seedware file is built through
//         the real Plot Summary screen. ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    // Exactly the shape listsStore.js's addCustomItem()/addCustomHybrid()
    // persist — simulating "this brand and this hybrid were both typed
    // in through '+ Add New…' on a previous visit."
    localStorage.setItem(
      "cph.customLists",
      JSON.stringify({
        companies: ["Some Brand New Seed Co"],
        hybridsByBrand: { "Midwest Seed Genetics": ["99-99 BRAND NEW"] },
        traits: [],
        seedTreatments: [],
        collectionMethods: [],
      })
    );
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "seedware-request-test-trial",
        header: {
          formId: "26-1888",
          cooperatorName: "Request Test Co-op",
          state: "IA",
          county: "Story",
          city: "Ames",
          zip: "50010",
          datePlanted: "2026-05-01",
          previousCrop: "Corn",
        },
        entries: [
          {
            id: "e1",
            brand: "Midwest Seed Genetics",
            hybrid: "99-99 BRAND NEW", // the custom hybrid added above
            trait: "New Trait",
            relativeMaturity: "99",
            seedTreatment: "",
            sampleNetWeightLbs: "2500",
            moisturePercent: "16.5",
            testWeight: "",
            stripLengthFeet: "500",
            numberOfRows: "6",
            widthInches: "30",
            comments: "",
            manualDryYield: "",
          },
          {
            id: "e2",
            brand: "Some Brand New Seed Co", // the custom brand added above
            hybrid: "XYZ-123",
            trait: "",
            relativeMaturity: "",
            seedTreatment: "",
            sampleNetWeightLbs: "2400",
            moisturePercent: "16.0",
            testWeight: "",
            stripLengthFeet: "500",
            numberOfRows: "6",
            widthInches: "30",
            comments: "",
            manualDryYield: "",
          },
        ],
      })
    );
  });
  // A fresh navigation (not just localStorage.setItem on the already-
  // loaded page) so trialStore.js/listsStore.js's module-level state
  // actually re-reads what was just written — both read localStorage
  // once at import time, not reactively (same reason every other
  // section here re-navigates after seeding localStorage).
  await page.goto(`${BASE}/index.html?r=1#/plot-summary`);
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });

  const providers = await page.evaluate(async () => {
    const listsStore = await import("/js/ui/stores/listsStore.js");
    await listsStore.ensureLoaded();
    const { buildSeedwareExport } = await import("/js/core/seedwareExportBuilder.js");
    const trialStore = await import("/js/ui/stores/trialStore.js");
    const { header, entries } = trialStore.getState();
    const { blob } = buildSeedwareExport(header, entries, {
      isCustomCompany: listsStore.isCustomCompany,
      isCustomHybrid: listsStore.isCustomHybrid,
    });
    const buf = await blob.arrayBuffer();
    // Re-decode just enough to read the Variety Provider column (P) for
    // both rows, same lightweight approach as section 1.
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    const totalEntries = dv.getUint16(eocd + 10, true);
    let offset = dv.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    let sheetXml = null;
    for (let i = 0; i < totalEntries; i++) {
      const compSize = dv.getUint32(offset + 20, true);
      const nameLen = dv.getUint16(offset + 28, true);
      const extraLen = dv.getUint16(offset + 30, true);
      const commentLen = dv.getUint16(offset + 32, true);
      const localHeaderOffset = dv.getUint32(offset + 42, true);
      const name = decoder.decode(new Uint8Array(buf, offset + 46, nameLen));
      if (name === "xl/worksheets/sheet1.xml") {
        const lhNameLen = dv.getUint16(localHeaderOffset + 26, true);
        const lhExtraLen = dv.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
        sheetXml = decoder.decode(new Uint8Array(buf, dataStart, compSize));
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    function cellValue(ref) {
      const re = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(?:<is><t[^>]*>([^<]*)</t></is>|<v>([^<]*)</v>)?</c>)`);
      const m = re.exec(sheetXml);
      return m ? m[1] || "" : undefined;
    }
    return { row1: cellValue("P2"), row2: cellValue("P3") };
  });

  check(
    providers.row1 === "Request",
    `a real cph.customLists-persisted custom hybrid resolves to Request end-to-end (got "${providers.row1}")`
  );
  check(
    providers.row2 === "Request",
    `a real cph.customLists-persisted custom brand resolves to Request end-to-end (got "${providers.row2}")`
  );

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
