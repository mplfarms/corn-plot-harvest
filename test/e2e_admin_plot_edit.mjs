// Verifies the admin "edit a teammate's plot" flow (adminEditStore.js):
// tapping a plot row on the All Plots (Admin) screen opens it for real
// editing in the Plot Workspace (not a read-only view), a banner makes
// clear whose plot it is, Save Changes PUTs the *owner's* full trials
// array back to the server with an adminEmail field (so the server can
// verify admin status — see plots.js), the admin's own local library is
// never touched by any of this, and Discard Admin Edit restores the
// admin's own previous draft untouched.
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
  header: { cooperatorName: "Jamie's Farm", state: "IA", county: "Story", plantingDate: "", harvestDate: "" },
  entries: [{ id: "e1", hybrid: "H1", brand: "NC+ Hybrids", trait: "", relativeMaturity: "" }],
};

// ---- Full edit + save flow ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const putCalls = [];
  await page.exposeFunction("__recordPut", (payload) => putCalls.push(payload));
  await page.addInitScript(
    (jamieTrial) => {
      window.fetch = async (url, options) => {
        const u = String(url);
        if (u.includes("/.netlify/functions/plots") && (!options || options.method !== "PUT")) {
          if (u.includes("scope=all")) {
            return new Response(
              JSON.stringify({
                users: [
                  { email: "admin@example.com", name: "Admin User", trials: [] },
                  { email: "jamie@example.com", name: "Jamie Farmer", trials: [jamieTrial] },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ trials: [] }), { status: 200 });
        }
        if (u.includes("/.netlify/functions/plots") && options && options.method === "PUT") {
          const payload = JSON.parse(options.body || "{}");
          window.__recordPut(payload);
          return new Response(JSON.stringify({ ok: true, count: (payload.trials || []).length }), { status: 200 });
        }
        throw new Error(`unexpected fetch in test: ${u}`);
      };
    },
    JAMIE_TRIAL
  );

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".admin-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".card", { timeout: 5000 });

  await page.click("text=Jamie's Farm");
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });
  const bannerText = await page.$eval(".preview-owner-banner", (el) => el.textContent).catch(() => null);
  check(
    Boolean(bannerText) && bannerText.includes("Jamie Farmer"),
    `entering an admin edit shows a banner naming the plot's owner (got ${JSON.stringify(bannerText)})`
  );

  // Saved Plots / All Plots (Admin) rows should be hidden while admin-editing.
  const rowTitles = await page.$$eval(".chooser-row-title", (els) => els.map((e) => e.textContent));
  check(!rowTitles.includes("Saved Plots"), `"Saved Plots" row is hidden during an admin edit (got ${JSON.stringify(rowTitles)})`);

  // Edit the plot's cooperator name (the Cooperator section's "Name"
  // field is the first .text-input on Plot Details).
  await page.click("text=Enter Plot Details");
  await page.waitForSelector(".text-input", { timeout: 5000 });
  await page.locator(".text-input").first().fill("Jamie's Farm (edited by admin)");
  await page.click('.top-bar-btn[aria-label="Menu"]');
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });

  await page.locator("button", { hasText: "Save Changes" }).click();
  await page.waitForSelector(".admin-plots-screen", { timeout: 8000 });
  check(true, "Save Changes returns to the All Plots (Admin) screen");

  check(putCalls.length === 1, `exactly one PUT was made (got ${putCalls.length})`);
  const put = putCalls[0];
  check(put && put.email === "jamie@example.com", `the PUT targets the OWNER's email, not the admin's (got ${put && put.email})`);
  check(put && put.adminEmail === "admin@example.com", `the PUT carries the admin's own email for server-side verification (got ${put && put.adminEmail})`);
  check(
    put && Array.isArray(put.trials) && put.trials.length === 1,
    `the PUT's trials array has exactly the one (edited) trial, not the admin's own library (got ${JSON.stringify(put && put.trials)})`
  );

  const savedTrials = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
  check(
    !savedTrials.some((t) => t.id === "jamie-trial-1"),
    "the admin's own local library never gained Jamie's trial (no leak into libraryStore)"
  );

  await page.close();
}

// ---- Discard flow: restores the admin's own draft, no PUT sent ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await page.addInitScript((jamieTrial) => {
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots") && u.includes("scope=all")) {
        return new Response(
          JSON.stringify({ users: [{ email: "jamie@example.com", name: "Jamie Farmer", trials: [jamieTrial] }] }),
          { status: 200 }
        );
      }
      if (u.includes("/.netlify/functions/plots")) return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  }, JAMIE_TRIAL);

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Admin User", email: "admin@example.com", isAdmin: true }));
    // The admin's own in-progress draft, with a cooperator name set.
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "admins-own-draft", header: { cooperatorName: "Admin's Own Plot" }, entries: [] })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/admin-plots`);
  await page.waitForSelector(".card", { timeout: 5000 });
  await page.click("text=Jamie's Farm");
  await page.waitForSelector(".workspace-menu-screen", { timeout: 5000 });

  page.on("dialog", (d) => d.accept());
  await page.click("text=Discard Admin Edit");
  // showConfirm is a custom modal, not a native dialog — accept via its own button if present.
  const confirmBtn = page.locator(".modal-actions .btn-danger, .modal-actions .btn-primary").first();
  if (await confirmBtn.count()) await confirmBtn.click();

  await page.waitForSelector(".admin-plots-screen", { timeout: 8000 });
  const restoredDraft = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial") || "{}"));
  check(
    restoredDraft.id === "admins-own-draft",
    `discarding an admin edit restores the admin's own previous draft (got id=${restoredDraft.id})`
  );

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
