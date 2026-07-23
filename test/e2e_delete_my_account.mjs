// Verifies the self-service "Delete My Account" flow on Settings (see
// settings.js's handleDeleteMyAccount() + netlify/functions/
// deleteAccount.js): a regular signed-in user can delete their own
// account, going through doubleConfirm.js's two-step "type DELETE"
// dialog first, is signed out and returned to the sign-in screen on
// success, and a server error (e.g. attempting this as the bootstrap
// admin) is surfaced without touching the local session.
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

// ---- Regular user: full successful delete-and-transfer flow ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const deleteCalls = [];
  await page.exposeFunction("__recordDelete", (payload) => deleteCalls.push(payload));
  await page.addInitScript(() => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/deleteAccount")) {
        const payload = JSON.parse((options && options.body) || "{}");
        window.__recordDelete(payload);
        return new Response(
          JSON.stringify({ ok: true, transferredCount: 3, transferredToEmail: "mplfarms@aol.com", transferredToName: "Mike Admin" }),
          { status: 200 }
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Jamie Farmer", email: "jamie@example.com", isAdmin: false }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });

  const deleteBtn = page.locator("button", { hasText: "Delete My Account" });
  check(await deleteBtn.count() === 1, "Settings shows a 'Delete My Account' button for a signed-in user");

  await deleteBtn.click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const firstMessage = await page.$eval(".modal-message", (el) => el.textContent);
  check(
    firstMessage.includes("transfers to your farm's admin account") && firstMessage.includes("signed out"),
    `the first dialog explains the consequences (got "${firstMessage}")`
  );

  // Cancelling the first dialog makes no request at all.
  await page.click(".modal-actions .btn-secondary");
  await page.waitForTimeout(200);
  check(deleteCalls.length === 0, "cancelling the first dialog never calls the server");

  // Go again, this time typing the wrong confirmation word.
  await deleteBtn.click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  await page.click(".modal-actions .btn-danger");
  await page.waitForSelector(".modal-input", { timeout: 5000 });
  await page.fill(".modal-input", "delete my account"); // wrong — must be exactly DELETE
  await page.click(".modal-actions .btn-primary");
  await page.waitForTimeout(200);
  check(deleteCalls.length === 0, "typing the wrong confirmation word also never calls the server");
  check(await page.locator(".settings-screen").count() === 1, "still on the Settings screen after a cancelled/mistyped attempt");

  // Third time, typed correctly.
  await deleteBtn.click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  await page.click(".modal-actions .btn-danger");
  await page.waitForSelector(".modal-input", { timeout: 5000 });
  await page.fill(".modal-input", "DELETE");
  await page.click(".modal-actions .btn-primary");
  await page.waitForSelector(".launch-screen, .toast", { timeout: 5000 });

  check(deleteCalls.length === 1, `exactly one deleteAccount call was made (got ${deleteCalls.length})`);
  check(deleteCalls[0] && deleteCalls[0].email === "jamie@example.com", `the call carries the signed-in user's own email (got ${JSON.stringify(deleteCalls[0])})`);

  const sessionAfter = await page.evaluate(() => localStorage.getItem("cph.authSession"));
  check(sessionAfter === null, "the local session is cleared after a successful self-delete");

  await page.close();
}

// ---- Server rejects the attempt (e.g. the bootstrap admin) — session untouched ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.addInitScript(() => {
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/deleteAccount")) {
        return new Response(
          JSON.stringify({ error: "This account can't delete itself — it's the account every deleted account's plots transfer to." }),
          { status: 400 }
        );
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    };
  });

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });

  await page.locator("button", { hasText: "Delete My Account" }).click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  await page.click(".modal-actions .btn-danger");
  await page.waitForSelector(".modal-input", { timeout: 5000 });
  await page.fill(".modal-input", "DELETE");
  await page.click(".modal-actions .btn-primary");
  await page.waitForSelector(".toast", { timeout: 5000 });

  const toastText = await page.$eval(".toast-message", (el) => el.textContent);
  check(toastText.includes("Couldn't delete"), `a server rejection shows an error toast rather than silently signing out (got "${toastText}")`);

  const sessionAfter = await page.evaluate(() => localStorage.getItem("cph.authSession"));
  check(sessionAfter !== null, "the local session is untouched after a rejected self-delete");
  check(await page.locator(".settings-screen").count() === 1, "still on the Settings screen after a rejected self-delete");

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
