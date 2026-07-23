// Verifies editing First Name/Last Name/Mobile Number
// (updateProfile.js + editUserDetailsModal.js) from both places it's
// reachable:
//   1. Settings' "Edit My Info" — a user editing their OWN details, via
//      authStore.updateProfile() (no adminEmail, self-edit).
//   2. Manage Users' "☰" button — an admin editing ANY user's details on
//      their behalf, via the adminEmail path.
// Both open the same pre-filled, editable form; Cancel makes no network
// call at all; Save sends exactly the edited values.
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

// ---- Settings: "Edit My Info" (self-edit) ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const updateCalls = [];
  await page.exposeFunction("__recordUpdate", (payload) => updateCalls.push(payload));
  await page.addInitScript(() => {
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/updateProfile")) {
        const payload = JSON.parse((options && options.body) || "{}");
        window.__recordUpdate(payload);
        return new Response(
          JSON.stringify({
            user: {
              name: `${payload.firstName} ${payload.lastName}`.trim() || payload.email,
              email: payload.email,
              isAdmin: false,
              firstName: payload.firstName,
              lastName: payload.lastName,
              mobileNumber: payload.mobileNumber,
            },
          }),
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
    localStorage.setItem(
      "cph.authSession",
      JSON.stringify({ name: "jamie@example.com", email: "jamie@example.com", isAdmin: false, firstName: "", lastName: "", mobileNumber: "" })
    );
  });
  await page.goto(`${BASE}/index.html?r=1#/settings`);
  await page.waitForSelector(".settings-screen", { timeout: 5000 });

  const editBtn = page.locator("button", { hasText: "Edit My Info" });
  check(await editBtn.count() === 1, "Settings shows an 'Edit My Info' button for a signed-in user");

  await editBtn.click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const modalTitle = await page.$eval(".modal-title", (el) => el.textContent);
  check(modalTitle === "Edit My Info", `the modal is titled "Edit My Info" (got "${modalTitle}")`);

  const emailFieldValue = await page.$eval(".new-user-details-body input[type=email]", (el) => el.value);
  check(emailFieldValue === "jamie@example.com", `the Email field shows the account's email, read-only (got "${emailFieldValue}")`);
  const emailFieldDisabled = await page.$eval(".new-user-details-body input[type=email]", (el) => el.disabled);
  check(emailFieldDisabled === true, "the Email field can't be edited here");

  // Cancel first — must not call the server at all.
  await page.locator(".modal-actions .btn-secondary", { hasText: "Cancel" }).click();
  await page.waitForTimeout(200);
  check(updateCalls.length === 0, "Cancel makes no updateProfile call");

  // Now for real: fill in and Save.
  await editBtn.click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const inputs = await page.$$(".new-user-details-body .text-input:not([disabled])");
  await inputs[0].fill("Jamie");
  await inputs[1].fill("Farmer");
  await inputs[2].fill("(555) 222-3333");
  await page.locator(".modal-actions .btn-primary", { hasText: "Save" }).click();
  await page.waitForTimeout(300);

  check(updateCalls.length === 1, `exactly one updateProfile call was made (got ${updateCalls.length})`);
  check(
    updateCalls[0] &&
      updateCalls[0].email === "jamie@example.com" &&
      updateCalls[0].firstName === "Jamie" &&
      updateCalls[0].lastName === "Farmer" &&
      updateCalls[0].mobileNumber === "(555) 222-3333" &&
      !updateCalls[0].adminEmail,
    `the self-edit call carries the user's own email and the new values, with no adminEmail (got ${JSON.stringify(updateCalls[0])})`
  );

  const toastText = await page.locator(".toast").first().textContent().catch(() => null);
  check(Boolean(toastText) && /updated/i.test(toastText), `a success toast confirms the update (got ${JSON.stringify(toastText)})`);

  // The local session was updated too — re-opening the form shows the new values pre-filled.
  await editBtn.click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const refilledValues = await page.$$eval(".new-user-details-body .text-input:not([disabled])", (els) => els.map((e) => e.value));
  check(
    JSON.stringify(refilledValues) === JSON.stringify(["Jamie", "Farmer", "(555) 222-3333"]),
    `re-opening the form shows the just-saved values, proving the local session was updated (got ${JSON.stringify(refilledValues)})`
  );

  await page.close();
}

// ---- Manage Users: "☰" button (admin editing someone else) ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  const updateCalls = [];
  await page.exposeFunction("__recordUpdate", (payload) => updateCalls.push(payload));
  await page.addInitScript(() => {
    const users = [
      { name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true, firstName: "Mike", lastName: "Admin", mobileNumber: "" },
      { name: "jamie@example.com", email: "jamie@example.com", isAdmin: false, firstName: "", lastName: "", mobileNumber: "" },
    ];
    window.fetch = async (url, options) => {
      const u = String(url);
      if (u.includes("/.netlify/functions/plots")) {
        return new Response(JSON.stringify({ trials: [] }), { status: 200 });
      }
      if (u.includes("/.netlify/functions/adminUsers")) {
        const method = (options && options.method) || "GET";
        if (method === "GET") return new Response(JSON.stringify({ users }), { status: 200 });
        return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400 });
      }
      if (u.includes("/.netlify/functions/updateProfile")) {
        const payload = JSON.parse((options && options.body) || "{}");
        window.__recordUpdate(payload);
        const rec = users.find((x) => x.email === payload.email);
        if (rec) {
          rec.firstName = payload.firstName;
          rec.lastName = payload.lastName;
          rec.mobileNumber = payload.mobileNumber;
          rec.name = `${payload.firstName} ${payload.lastName}`.trim() || rec.email;
        }
        return new Response(JSON.stringify({ user: rec }), { status: 200 });
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
  await page.goto(`${BASE}/index.html?r=1#/manage-users`);
  await page.waitForSelector(".manage-user-card", { timeout: 8000 });

  const menuButtons = await page.$$(".admin-user-menu-btn");
  check(menuButtons.length === 2, `every card has its own "☰" edit button (got ${menuButtons.length})`);

  // Edit Jamie's (the non-admin's) details.
  const jamieMenuBtn = await page.evaluateHandle(() => {
    const cards = Array.from(document.querySelectorAll(".manage-user-card"));
    const jamie = cards.find((c) => c.textContent.includes("jamie@example.com"));
    return jamie.querySelector(".admin-user-menu-btn");
  });
  await jamieMenuBtn.asElement().click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const modalTitle = await page.$eval(".modal-title", (el) => el.textContent);
  check(modalTitle.includes("jamie@example.com"), `the edit form is titled with the target user (got "${modalTitle}")`);

  const inputs = await page.$$(".new-user-details-body .text-input:not([disabled])");
  await inputs[0].fill("Jamie");
  await inputs[1].fill("Farmer");
  await inputs[2].fill("(555) 444-5555");
  await page.locator(".modal-actions .btn-primary", { hasText: "Save" }).click();
  await page.waitForTimeout(300);

  check(updateCalls.length === 1, `exactly one updateProfile call was made (got ${updateCalls.length})`);
  check(
    updateCalls[0] && updateCalls[0].email === "jamie@example.com" && updateCalls[0].adminEmail === "mplfarms@aol.com",
    `the admin-edit call targets Jamie's email and carries the admin's own email for server-side verification (got ${JSON.stringify(updateCalls[0])})`
  );

  // The list re-fetches after saving, so Jamie's card should now show her new name.
  const names = await page.$$eval(".manage-user-card .admin-user-header-name", (els) => els.map((e) => e.textContent));
  check(names.includes("Jamie Farmer"), `Jamie's card shows her newly-saved name after the edit (got ${JSON.stringify(names)})`);

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
