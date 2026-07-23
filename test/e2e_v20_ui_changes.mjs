// Verifies the 6-part "v20" batch:
//   1. PDF ranking-bubble color legend (mocked jsPDF)
//   2. Sync-status icon in the workspace top bar (green/red), account card hidden
//   3. "Enter a New Plot" button label + confirm dialog copy
//   4. Plot Summary "Share This Plot" opens as a centered modal
//   5. "Enter Plot Details" menu row label
//   6. "Enter Plot Hybrids" menu row label
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

async function seedWorkspace(page) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({
        id: "test-trial-1",
        header: {
          cooperatorName: "Test Cooperator",
          state: "IA",
          county: "Story",
          datePlanted: "",
          dateHarvested: "",
          collectedBy: "",
        },
        entries: [],
      })
    );
  });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
});

// Mock the cloud sync endpoint so main.js's startup pullAndMerge() (see
// cloudSyncStore.js) succeeds instead of failing against the real
// network, which this sandboxed test has none of. Before that startup
// pull existed, this test's already-signed-in-via-localStorage session
// never touched the network at all, so the sync icon just sat in its
// hardcoded initial "synced" state — now that every boot genuinely
// attempts a pull, the icon's "synced" state has to be earned by a
// successful (mocked) round trip, same as e2e_demo_plot.mjs's section 4
// mocks it. Everything else passes through to the real fetch.
await page.addInitScript(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/plots")) {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return originalFetch(url, options);
  };
});

// ---- 1. Workspace menu: labels, no account card, sync icon present ----
await seedWorkspace(page);
// A cache-busting query param forces an actual page reload rather than a
// same-document hash-only navigation — needed now that router.js's
// mandatory-sign-in guard depends on authStore's module state actually
// re-reading the session just seeded into localStorage above.
await page.goto(`${BASE}/index.html?r=1#/workspace`);
await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });

const rowTitles = await page.$$eval(".chooser-row-title", (els) => els.map((e) => e.textContent));
check(rowTitles.includes("Enter Plot Details"), '"Enter Plot Details" row label present');
check(rowTitles.includes("Enter Plot Hybrids"), '"Enter Plot Hybrids" row label present');
check(!rowTitles.includes("Plot Details"), 'old "Plot Details" label gone');
check(!rowTitles.includes("Plot Entries"), 'old "Plot Entries" label gone');

const startBtnText = await page.$eval(".btn-danger", (el) => el.textContent.trim());
check(startBtnText === "Enter a New Plot", `"Enter a New Plot" button label (got "${startBtnText}")`);

const accountCardCount = await page.$$eval(".account-status-card", (els) => els.length);
check(accountCardCount === 0, '"Synced as" account-status-card is hidden from workspace menu');

const syncIcon = await page.$(".sync-icon-btn");
check(!!syncIcon, "sync icon button exists in top bar");
const syncIconClass = await page.$eval(".sync-icon-btn", (el) => el.className);
// Signing in is mandatory now (see router.js's guard) — this screen can
// only ever be reached already signed in, so the icon starts in its
// optimistic "synced" (green) state rather than the signed-out red one.
check(
  syncIconClass.includes("sync-icon-synced"),
  `sync icon shows the signed-in "synced" (green) state (class="${syncIconClass}")`
);
const syncIconText = await page.$eval(".sync-icon-btn", (el) => el.textContent.trim());
check(syncIconText === "⇄", `sync icon glyph is the double arrow (got "${syncIconText}")`);

// sync icon sits to the left of the gear, inside top-bar-right
const rightBtnOrder = await page.$$eval(".top-bar-right .top-bar-btn", (els) =>
  els.map((e) => e.getAttribute("aria-label"))
);
check(
  rightBtnOrder.length === 2 && rightBtnOrder[1] === "Settings",
  `Settings gear stays rightmost (order: ${JSON.stringify(rightBtnOrder)})`
);

// ---- 2. Confirm dialog copy for "Enter a New Plot" ----
await page.click(".btn-danger");
await page.waitForSelector(".modal-title", { timeout: 3000 });
const confirmTitle = await page.$eval(".modal-title", (el) => el.textContent);
check(confirmTitle === "Enter a New Plot?", `confirm dialog title updated (got "${confirmTitle}")`);
const confirmBtnLabel = await page.$eval(".modal-actions .btn-danger", (el) => el.textContent.trim());
check(confirmBtnLabel === "Enter a New Plot", `confirm dialog action button label (got "${confirmBtnLabel}")`);
// Cancel it so we don't wipe the seeded draft.
await page.click(".modal-actions .btn-secondary");
await page.waitForTimeout(150);

// ---- 3. Plot Summary "Share This Plot" opens as a centered modal ----
await page.goto(`${BASE}/index.html#/plot-summary`);
await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
const shareMenuVisibleBefore = await page.$(".modal-overlay:not(.hidden)");
check(!shareMenuVisibleBefore, "no modal open before clicking Share This Plot");

await page.click("text=Share This Plot");
await page.waitForSelector(".modal-overlay:not(.hidden) .modal-card-large", { timeout: 3000 });
const modalItems = await page.$$eval(".modal-overlay .share-menu-item", (els) => els.map((e) => e.textContent));
// 5 actions as of "Export for Seedware" (see seedwareExportBuilder.js) —
// was 4 before that action existed.
check(modalItems.length === 5, `share modal has 5 actions (got ${modalItems.length})`);
check(
  modalItems.some((t) => t.includes("Export / Share PDF")),
  "share modal includes PDF export action"
);

// Confirm it's actually centered via the overlay's flex centering (not a
// below-button dropdown) — check the overlay computed style.
const overlayDisplay = await page.$eval(".modal-overlay", (el) => getComputedStyle(el).display);
const overlayAlign = await page.$eval(".modal-overlay", (el) => getComputedStyle(el).alignItems);
check(overlayDisplay === "flex" && overlayAlign === "center", "share modal overlay centers its content (flex/center)");

// Close it via the X button.
await page.click(".modal-close-btn");
await page.waitForTimeout(150);
const overlayHiddenAfter = await page.$eval(".modal-overlay", (el) => el.classList.contains("hidden"));
check(overlayHiddenAfter, "share modal closes via the X button");

// ---- 4. PDF ranking-bubble legend (mocked jsPDF) ----
const pdfCalls = await page.evaluate(async () => {
  const calls = { text: [], circle: [] };
  function FakeJsPDF() {
    return {
      setFont() {},
      setFontSize() {},
      setTextColor() {},
      setFillColor() {},
      setDrawColor() {},
      setLineWidth() {},
      saveGraphicsState() {},
      restoreGraphicsState() {},
      setGState() {},
      GState(opts) {
        return opts;
      },
      splitTextToSize: (t) => [t],
      getTextWidth: (t) => String(t).length * 5,
      getImageProperties: () => ({ width: 100, height: 40 }),
      addImage() {},
      text(str, x, y, opts) {
        calls.text.push(String(str));
      },
      circle(x, y, r, style) {
        calls.circle.push({ x, y, r, style });
      },
      rect() {},
      line() {},
      addPage() {},
      output: () => new Blob(["fake-pdf"], { type: "application/pdf" }),
    };
  }
  window.jspdf = { jsPDF: FakeJsPDF };

  const { buildPdf } = await import("/js/core/pdfBuilder.js");
  const header = {
    cooperatorName: "Test Cooperator",
    state: "IA",
    county: "Story",
    year: "2026",
  };
  const entries = [
    {
      id: "e1",
      brand: "Midwest Seed Genetics",
      hybrid: "82-22 VT2PRIB",
      trait: "VT2PRIB",
      relativeMaturity: "82",
      manualDryYield: "220",
      sampleNetWeightLbs: "",
      moisturePercent: "15",
      testWeight: "",
      stripLengthFeet: "",
      numberOfRows: "",
      widthInches: "",
      comments: "",
    },
    {
      id: "e2",
      brand: "Midwest Seed Genetics",
      hybrid: "88-11 VT2PRIB",
      trait: "VT2PRIB",
      relativeMaturity: "88",
      manualDryYield: "180",
      sampleNetWeightLbs: "",
      moisturePercent: "16",
      testWeight: "",
      stripLengthFeet: "",
      numberOfRows: "",
      widthInches: "",
      comments: "",
    },
  ];
  const results = entries.map((entry, idx) => ({ originalNumber: idx + 1, entry, value: Number(entry.manualDryYield) }));
  results.sort((a, b) => b.value - a.value);

  await buildPdf({
    header,
    results,
    metric: "dryYield",
    allEntries: entries,
    brand: { displayName: "Midwest Seed Genetics" },
    logoDataUrl: null,
  });

  return calls;
});

check(
  pdfCalls.text.some((t) => t.includes("over plot mean")),
  "PDF legend includes the 'over plot mean' label"
);
check(
  pdfCalls.text.some((t) => t.includes("under plot mean")),
  "PDF legend includes the 'under plot mean' label"
);
check(
  pdfCalls.text.some((t) => t.includes("Within") && t.includes("plot mean")),
  "PDF legend includes the 'Within ... plot mean' label"
);
// 3 legend swatches + 2 rank badges (one per entry) = 5 filled circles total.
check(
  pdfCalls.circle.filter((c) => c.style === "F").length === 5,
  `PDF drew 5 filled circles total: 3 legend swatches + 2 rank badges (got ${
    pdfCalls.circle.filter((c) => c.style === "F").length
  })`
);
// The legend line ("Trial Mean: ...") should appear AFTER the header
// ("Trial Summary — Dry Yield") and the legend text appears before the
// "Trial Mean" text in draw order, confirming placement above the stats line.
const legendIdx = pdfCalls.text.findIndex((t) => t.includes("over plot mean"));
const meanLineIdx = pdfCalls.text.findIndex((t) => t.startsWith("Trial Mean:"));
check(legendIdx !== -1 && meanLineIdx !== -1 && legendIdx < meanLineIdx, "legend is drawn above the Trial Mean stats line");
const headerIdx = pdfCalls.text.findIndex((t) => t.includes("Trial Summary"));
check(headerIdx !== -1 && headerIdx < legendIdx, "legend is drawn below the 'Trial Summary — Dry Yield' header");

await browser.close();

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
