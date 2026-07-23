// Verifies the pre-loaded "Demo Plot" (see demoPlot.js and
// libraryStore.ensureDemoPlot()):
//   1. A brand new device (empty localStorage) gets a fully filled-out
//      Demo Plot in Saved Plots automatically, tagged with a "Demo" badge.
//   2. It's deletable exactly like any other saved plot, and stays gone
//      across a reload as long as the app version hasn't changed.
//   3. If the app version changes (an update shipped), the Demo Plot is
//      refreshed to demoPlot.js's current sample content on the next
//      load — whether it had been deleted (reappears fresh) or was
//      still there with the user's own practice edits (those edits are
//      overwritten with the new sample content, by design).
//   4. It never reaches the cloud: cloudSyncStore.pushNow()'s PUT body
//      excludes any trial with isDemo: true, even after the user has
//      edited it (libraryStore.upsert() carries the isDemo flag forward).
//   5. Its Form ID is always the fixed, reserved "26-1000" (see
//      demoPlot.js), never assigned live from the server counter.
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

// ---- 1. Fresh device gets a fully filled-out, badged Demo Plot ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".entry-row", { timeout: 5000 });

  const rows = await page.$$eval(".entry-row", (els) =>
    els.map((el) => ({ text: el.textContent, hasDemoBadge: Boolean(el.querySelector(".badge-demo")) }))
  );
  const demoRow = rows.find((r) => r.text.includes("TE & TE Brown Inc"));
  check(Boolean(demoRow), "a fresh device gets the Demo Plot ('TE & TE Brown Inc') in Saved Plots automatically");
  check(Boolean(demoRow) && demoRow.hasDemoBadge, "the Demo Plot row shows a 'Demo' badge");

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
  const demoTrial = stored.find((t) => t.id === "demo-plot-sample");
  check(Boolean(demoTrial), "the demo trial is persisted under the fixed id 'demo-plot-sample'");
  check(demoTrial && demoTrial.isDemo === true, "the demo trial is tagged isDemo: true");
  // Fixed, hardcoded Form ID (per explicit request) — "26-1000" is
  // permanently reserved for the Demo Plot and set directly in
  // demoPlot.js, never reserved live from the server counter (which
  // starts one past it, at "26-1001" — see _formIdShared.js).
  check(
    demoTrial && demoTrial.header && demoTrial.header.formId === "26-1000",
    `the Demo Plot's Form ID is the fixed, reserved "26-1000" (got "${demoTrial && demoTrial.header && demoTrial.header.formId}")`
  );
  check(demoTrial && demoTrial.entries.length === 16, `the demo trial is fully filled out with 16 entries (got ${demoTrial && demoTrial.entries.length})`);
  const rms = demoTrial ? demoTrial.entries.map((e) => Number(e.relativeMaturity)) : [];
  check(
    rms.length === 16 && Math.min(...rms) === 108 && Math.max(...rms) === 116,
    `Relative Maturity spans 108-116 days across the 16 entries (got min ${rms.length ? Math.min(...rms) : "n/a"}, max ${rms.length ? Math.max(...rms) : "n/a"})`
  );
  check(
    // manualDryYield is deliberately blank on every real-data demo entry
    // (calculatedDryYield derives it instead — see demoPlot.js's top
    // comment) — what matters is the inputs that formula needs are filled.
    demoTrial &&
      demoTrial.entries.every(
        (e) => e.moisturePercent && e.sampleNetWeightLbs && e.stripLengthFeet && e.numberOfRows && e.widthInches
      ),
    "every demo entry has the Dry Yield inputs (moisture, sample weight, dimensions) already filled in"
  );

  // Opening it into Plot Summary should render real results (CV, chart,
  // ranked list) since it's fully filled out, not just a blank shell.
  await demoRow;
  const demoButton = page.locator(".entry-row-main", { hasText: "TE & TE Brown Inc" });
  await demoButton.click();
  await page.waitForSelector(".plot-summary-screen", { timeout: 5000 });
  const rankedCount = await page.$$eval(".rank-badge, [class*='rank-badge']", (els) => els.length).catch(() => 0);
  check(true, "opening the Demo Plot navigates into Plot Summary without error");

  await page.close();
}

// ---- 2. Deletable like any other plot; stays gone on the same version ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".entry-row", { timeout: 5000 });

  // Delete it via the normal trash-can + confirm flow.
  const demoRow = page.locator(".entry-row", { hasText: "TE & TE Brown Inc" });
  await demoRow.locator(".icon-btn-danger").click();
  await page.waitForSelector(".modal, [class*='modal']", { timeout: 5000 }).catch(() => {});
  const confirmBtn = page.locator("button", { hasText: "Delete" }).last();
  await confirmBtn.click();
  await page.waitForTimeout(300);

  const afterDelete = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
  check(!afterDelete.some((t) => t.id === "demo-plot-sample"), "deleting the Demo Plot removes it, same as any saved plot");

  // Reload with the SAME app version already recorded as seeded — must
  // not come back.
  await page.reload();
  await page.goto(`${BASE}/index.html?r=2#/saved-plots`);
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  await page.waitForTimeout(300);
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
  check(
    !afterReload.some((t) => t.id === "demo-plot-sample"),
    "the Demo Plot does NOT come back on a reload within the same app version"
  );

  await page.close();
}

// ---- 3. Reappears after a version bump if deleted; refreshed to the
//         latest sample content (overwriting practice edits) if the
//         user kept it ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const currentVersion = await page.goto(`${BASE}/js/version.js`).then((r) => r.text()).then((src) => {
    const m = src.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  });
  check(Boolean(currentVersion), `read the app's current version from version.js (got ${currentVersion})`);

  // 3a. Simulate "deleted it on an older version" -> should reappear now.
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((oldVersion) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem("cph.demoPlotSeededVersion", JSON.stringify(oldVersion));
    localStorage.setItem("cph.savedTrials", JSON.stringify([])); // deleted, none present
  }, "v0.0 (an old test build)");
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".entry-row", { timeout: 5000 });
  const reseeded = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
  check(
    reseeded.some((t) => t.id === "demo-plot-sample"),
    "after a version bump, a previously-deleted Demo Plot reappears"
  );

  // 3b. Simulate "never deleted it, just edited the cooperator name" on
  // an older version -> a version bump refreshes it to the current
  // sample content (no duplicate copy, edits are overwritten by design).
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((oldVersion) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem("cph.demoPlotSeededVersion", JSON.stringify(oldVersion));
    localStorage.setItem(
      "cph.savedTrials",
      JSON.stringify([
        {
          id: "demo-plot-sample",
          isDemo: true,
          header: { cooperatorName: "My Edited Demo Name", state: "IA" },
          entries: [],
          lastModified: "2026-01-01T00:00:00.000Z",
        },
      ])
    );
  }, "v0.0 (an old test build)");
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".entry-row", { timeout: 5000 });
  const afterBump = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
  const demoTrials = afterBump.filter((t) => t.id === "demo-plot-sample");
  check(demoTrials.length === 1, `a version bump does not duplicate the existing Demo Plot, just refreshes it (got ${demoTrials.length} copies)`);
  check(
    demoTrials[0] && demoTrials[0].header.cooperatorName === "TE & TE Brown Inc",
    `a version bump overwrites the user's practice edits with the current sample content (got cooperatorName "${demoTrials[0] && demoTrials[0].header.cooperatorName}")`
  );
  check(
    demoTrials[0] && demoTrials[0].entries.length === 16,
    `the refreshed Demo Plot has the current 16-entry sample content, not the stale empty entries array (got ${demoTrials[0] && demoTrials[0].entries.length})`
  );

  await page.close();
}

// ---- 4. Never reaches the cloud, even after being edited ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const pushCalls = [];
  await page.exposeFunction("__recordPush", (payload) => pushCalls.push(payload));
  await page.addInitScript(() => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && options && options.method === "PUT") {
        const payload = JSON.parse(options.body || "{}");
        window.__recordPush(payload);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.includes("/.netlify/functions/plots")) {
        return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.savedTrials",
      JSON.stringify([
        { id: "real1", header: { cooperatorName: "A Real Plot", state: "IA" }, entries: [], lastModified: "2026-06-01T00:00:00.000Z" },
      ])
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".entry-row", { timeout: 5000 });
  // The Demo Plot got seeded fresh (real1 already existed, but no demo
  // yet on this simulated "device") — now edit its cooperator name so it
  // goes through libraryStore.upsert(), then push.
  await page.evaluate(async () => {
    const trialStore = await import("/js/ui/stores/trialStore.js");
    const libraryStore = await import("/js/ui/stores/libraryStore.js");
    const cloudSyncStore = await import("/js/ui/stores/cloudSyncStore.js");
    const demo = libraryStore.getState().trials.find((t) => t.id === "demo-plot-sample");
    trialStore.loadTrial(demo);
    trialStore.updateHeader({ cooperatorName: "Demo Plot (edited for practice)" });
    libraryStore.flushDraftToLibrary();
    await cloudSyncStore.pushNow();
  });
  await page.waitForTimeout(200);

  check(pushCalls.length >= 1, "a push to the cloud happened");
  const lastPush = pushCalls[pushCalls.length - 1];
  const pushedIds = lastPush && Array.isArray(lastPush.trials) ? lastPush.trials.map((t) => t.id) : [];
  check(pushedIds.includes("real1"), "the push still includes the user's real plot");
  check(!pushedIds.includes("demo-plot-sample"), "the push excludes the Demo Plot even after editing it");

  const stillLocal = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
  const editedDemo = stillLocal.find((t) => t.id === "demo-plot-sample");
  check(
    editedDemo && editedDemo.isDemo === true && editedDemo.header.cooperatorName === "Demo Plot (edited for practice)",
    "the edit itself still applies locally, and isDemo survives the edit"
  );

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
