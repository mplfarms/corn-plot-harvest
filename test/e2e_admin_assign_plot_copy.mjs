// Verifies the admin "assign a copy of a plot to another user" flow (per
// explicit request):
//   1. models.copyTrialForAssignment() — a genuine deep copy with a new
//      trial id and new entry ids, the ORIGINAL's Form ID carried over
//      unchanged (explicit choice), isDemo stripped, source untouched.
//   2. Every plot row on All Plots (Admin) carries its own "Copy to…"
//      button alongside the row itself (which still opens the plot for
//      admin editing, unchanged).
//   3. The picker lists every OTHER registered user (never the plot's own
//      owner), and choosing one PUTs that user's existing trials PLUS the
//      copy, with the adminEmail field the server checks admin rights
//      against — the owner's own record is never written to.
//   4. Sending the same plot to someone who already has it warns first,
//      and cancelling puts the picker back rather than leaving the screen
//      with no dialog at all.
//   5. None of this touches the admin's own local library.
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

const JAMIE_TRIAL = {
  id: "jamie-trial-1",
  lastModified: "2026-10-01T12:00:00.000Z",
  header: { cooperatorName: "Jamie's Farm", state: "IA", county: "Story", city: "Ames", formId: "26-1042" },
  entries: [
    { id: "e1", brand: "NC+ Hybrids", hybrid: "01-42 TRE", trait: "TRERIB", relativeMaturity: "101" },
    { id: "e2", brand: "Pioneer", hybrid: "P1185Q", trait: "", relativeMaturity: "111" },
  ],
};

// ---- 1. The copy helper itself ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.goto(`${BASE}/index.html`);

  const r = await page.evaluate(async (source) => {
    const { copyTrialForAssignment } = await import("/js/core/models.js");
    const withDemo = { ...source, isDemo: true };
    const copy = copyTrialForAssignment(withDemo, "2026-11-05T09:00:00.000Z");
    // Mutating the copy must not reach back into the source.
    copy.header.cooperatorName = "Changed";
    copy.entries[0].hybrid = "CHANGED";
    return {
      newTrialId: copy.id !== source.id,
      newEntryIds: copy.entries.every((e, i) => e.id !== source.entries[i].id),
      uniqueEntryIds: new Set(copy.entries.map((e) => e.id)).size === copy.entries.length,
      formId: copy.header.formId,
      entryCount: copy.entries.length,
      hasDemoFlag: Object.prototype.hasOwnProperty.call(copy, "isDemo"),
      lastModified: copy.lastModified,
      sourceName: withDemo.header.cooperatorName,
      sourceHybrid: withDemo.entries[0].hybrid,
    };
  }, JAMIE_TRIAL);

  check(r.newTrialId, "the copy gets a brand new trial id (cloud sync merges by id)");
  check(r.newEntryIds && r.uniqueEntryIds, "every entry gets a brand new id too");
  check(r.formId === "26-1042", `the original's Form ID is carried over unchanged (got "${r.formId}")`);
  check(r.entryCount === 2, `all entries come along (got ${r.entryCount})`);
  check(!r.hasDemoFlag, "the local-only isDemo flag is stripped so the copy survives the recipient's cloud push");
  check(r.lastModified === "2026-11-05T09:00:00.000Z", `lastModified is stamped (got "${r.lastModified}")`);
  check(
    r.sourceName === "Jamie's Farm" && r.sourceHybrid === "01-42 TRE",
    "it's a deep copy — editing the copy leaves the source plot untouched"
  );

  await page.close();
}

// ---- 2-5. The screen, the picker, and what actually gets sent ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const putCalls = [];
  await page.exposeFunction("__recordPut", (payload) => putCalls.push(payload));
  await page.addInitScript((jamieTrial) => {
    // A tiny mutable server: the scope=all listing reflects whatever has
    // been PUT so far, so the duplicate warning has something real to
    // notice on the second pass.
    window.__users = [
      { email: "admin@example.com", name: "Admin User", trials: [] },
      { email: "jamie@example.com", name: "Jamie Farmer", trials: [jamieTrial] },
      { email: "casey@example.com", name: "Casey Rep", trials: [] },
    ];
    window.fetch = async (url, options) => {
      const u = String(url);
      const method = (options && options.method) || "GET";
      if (u.includes("/.netlify/functions/plots") && method !== "PUT") {
        if (u.includes("scope=all")) {
          return new Response(JSON.stringify({ users: window.__users }), { status: 200 });
        }
        return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      }
      if (u.includes("/.netlify/functions/plots") && method === "PUT") {
        const payload = JSON.parse(options.body || "{}");
        window.__recordPut(payload);
        const target = window.__users.find((x) => x.email === payload.email);
        if (target) target.trials = payload.trials;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  }, JAMIE_TRIAL);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".admin-plot-row", { timeout: 5000 });

  const assignBtnCount = await page.$$eval(".admin-plot-assign-btn", (els) => els.length);
  check(assignBtnCount === 1, `every plot row carries its own "Copy to…" button (got ${assignBtnCount} for 1 plot)`);
  const rowStillOpens = await page.$$eval(".admin-plot-row", (els) => els.length);
  check(rowStillOpens === 1, "the row button that opens the plot for editing is still there alongside it");

  await page.click(".admin-plot-assign-btn");
  await page.waitForSelector(".modal-overlay:not(.hidden) .admin-assign-user-list", { timeout: 3000 });
  const listed = await page.$$eval(".admin-assign-user-btn .admin-assign-user-name", (els) => els.map((e) => e.textContent));
  check(
    listed.length === 2 && listed.includes("Casey Rep") && listed.includes("Admin User"),
    `the picker lists the other users (got ${JSON.stringify(listed)})`
  );
  check(!listed.includes("Jamie Farmer"), "the plot's own owner is left out of the picker — they already have it");

  await page.click('.admin-assign-user-btn:has-text("Casey Rep")');
  await page.waitForFunction(() => document.querySelectorAll(".toast").length > 0, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);

  check(putCalls.length === 1, `choosing a recipient sends exactly one save (got ${putCalls.length})`);
  const put = putCalls[0] || {};
  check(put.email === "casey@example.com", `the save is addressed to the RECIPIENT (got "${put.email}")`);
  check(put.adminEmail === "admin@example.com", `it carries adminEmail so the server can verify admin rights (got "${put.adminEmail}")`);
  check((put.trials || []).length === 1, `the recipient's array is their existing plots plus the copy (got ${(put.trials || []).length})`);
  const sent = (put.trials || [])[0] || { header: {}, entries: [] };
  check(sent.id !== JAMIE_TRIAL.id, `the copy carries a new trial id (got "${sent.id}")`);
  check(sent.header.formId === "26-1042", `the copy keeps the original's Form ID (got "${sent.header.formId}")`);
  check(sent.header.cooperatorName === "Jamie's Farm", `the plot data comes across intact (got "${sent.header.cooperatorName}")`);
  check((sent.entries || []).length === 2, `both entries come across (got ${(sent.entries || []).length})`);
  check(
    (sent.entries || []).every((e) => e.id !== "e1" && e.id !== "e2"),
    "the copied entries carry new ids of their own"
  );
  check(
    !putCalls.some((p) => p.email === "jamie@example.com"),
    "the owner's own record is never written to — their original is untouched"
  );

  const ownLibrary = await page.evaluate(() => localStorage.getItem("cph.savedTrials"));
  const ownTrials = JSON.parse(ownLibrary || "[]");
  check(
    !ownTrials.some((t) => t.header && t.header.formId === "26-1042"),
    `assigning a copy never drops the plot into the admin's own library (got ${ownTrials.length} local trials)`
  );

  // ---- 4. Sending it a second time warns first ----
  await page.waitForSelector(".admin-plot-assign-btn", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll(".admin-plot-assign-btn").length === 2, { timeout: 5000 });
  const assignBtnsNow = await page.$$eval(".admin-plot-assign-btn", (els) => els.length);
  check(assignBtnsNow === 2, `the screen refreshes and Casey's new copy shows up as its own row (got ${assignBtnsNow} rows)`);

  await page.click(".admin-plot-assign-btn"); // Jamie's original again
  await page.waitForSelector(".modal-overlay:not(.hidden) .admin-assign-user-list", { timeout: 3000 });
  await page.click('.admin-assign-user-btn:has-text("Casey Rep")');
  await page.waitForSelector(".modal-overlay:not(.hidden) .modal-title", { timeout: 3000 });
  const warnTitle = await page.$eval(".modal-title", (el) => el.textContent);
  check(warnTitle === "Already Has a Copy", `a second copy to the same person warns first (got "${warnTitle}")`);

  const beforeCancel = putCalls.length;
  await page.click(".modal-actions .btn-secondary"); // Cancel
  await page.waitForSelector(".modal-overlay:not(.hidden) .admin-assign-user-list", { timeout: 3000 });
  check(putCalls.length === beforeCancel, "cancelling the warning sends nothing");
  const reopened = await page.$$eval(".admin-assign-user-btn", (els) => els.length);
  check(reopened === 2, `cancelling puts the picker back rather than closing everything (got ${reopened} rows)`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
