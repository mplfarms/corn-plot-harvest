// Verifies the admin-only "Manage Users" screen: reachable from Settings
// only for an admin, lists every registered user, can promote/demote
// admin status, can delete another account (with a confirm dialog), and
// can't delete the signed-in admin's own account (button disabled).
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
const page = await browser.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

// In-memory mock "users" table, mutated by setAdmin/delete actions so a
// re-fetch after each action reflects the change — mirrors how the real
// adminUsers.js Netlify Function persists to Blobs across requests.
await page.addInitScript(() => {
  let users = [
    { name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true, createdAt: "2026-01-01T00:00:00.000Z" },
    { name: "Jamie Farmer", email: "jamie@example.com", isAdmin: false, createdAt: "2026-01-02T00:00:00.000Z" },
  ];

  window.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes("/.netlify/functions/plots")) {
      return new Response(JSON.stringify({ trials: [] }), { status: 200 });
    }
    if (u.includes("/.netlify/functions/adminUsers")) {
      const method = (options && options.method) || "GET";
      if (method === "GET") {
        return new Response(JSON.stringify({ users }), { status: 200 });
      }
      const payload = JSON.parse((options && options.body) || "{}");
      if (payload.action === "setAdmin") {
        const rec = users.find((x) => x.email === payload.targetEmail);
        if (rec) rec.isAdmin = Boolean(payload.isAdmin);
        return new Response(JSON.stringify({ user: rec }), { status: 200 });
      }
      if (payload.action === "delete") {
        if (payload.targetEmail === payload.email) {
          return new Response(JSON.stringify({ error: "You can't delete your own account." }), { status: 400 });
        }
        users = users.filter((x) => x.email !== payload.targetEmail);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400 });
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
    JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true })
  );
});

await page.goto(`${BASE}/index.html?r=1#/settings`);
await page.waitForSelector(".settings-screen");

const manageBtnText = await page.$$eval("button", (els) =>
  els.map((e) => e.textContent.trim()).filter((t) => t === "Manage Users")
);
check(manageBtnText.length === 1, "Settings shows a 'Manage Users' button for an admin");

await page.click("text=Manage Users");
await page.waitForSelector(".manage-users-screen");
await page.waitForSelector(".manage-user-card", { timeout: 5000 });

let cards = await page.$$(".manage-user-card");
check(cards.length === 2, `both registered users are listed (got ${cards.length})`);

const names = await page.$$eval(".manage-user-card .admin-user-header-name", (els) => els.map((e) => e.textContent));
check(
  names.includes("Mike Admin") && names.includes("Jamie Farmer"),
  `listed users include both names (got ${JSON.stringify(names)})`
);

// Self's Delete button should be disabled.
const selfDeleteDisabled = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".manage-user-card"));
  const mine = cards.find((c) => c.textContent.includes("mplfarms@aol.com"));
  const btn = Array.from(mine.querySelectorAll("button")).find((b) => b.textContent.trim() === "Delete");
  return btn.disabled;
});
check(selfDeleteDisabled, "the signed-in admin's own Delete button is disabled");

// Promote Jamie to admin.
const jamiePromoteBtn = await page.evaluateHandle(() => {
  const cards = Array.from(document.querySelectorAll(".manage-user-card"));
  const jamie = cards.find((c) => c.textContent.includes("jamie@example.com"));
  return Array.from(jamie.querySelectorAll("button")).find((b) => b.textContent.trim() === "Make Admin");
});
await jamiePromoteBtn.asElement().click();
await page.waitForTimeout(300);

let jamieStatusText = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".manage-user-card"));
  const jamie = cards.find((c) => c.textContent.includes("jamie@example.com"));
  return jamie.textContent;
});
check(jamieStatusText.includes("Admin") && !jamieStatusText.includes("Standard user"), "promoting Jamie updates her status to Admin after re-fetch");

// Demote Jamie back.
const jamieDemoteBtn = await page.evaluateHandle(() => {
  const cards = Array.from(document.querySelectorAll(".manage-user-card"));
  const jamie = cards.find((c) => c.textContent.includes("jamie@example.com"));
  return Array.from(jamie.querySelectorAll("button")).find((b) => b.textContent.trim() === "Remove Admin");
});
await jamieDemoteBtn.asElement().click();
await page.waitForTimeout(300);
jamieStatusText = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".manage-user-card"));
  const jamie = cards.find((c) => c.textContent.includes("jamie@example.com"));
  return jamie.textContent;
});
check(jamieStatusText.includes("Standard user"), "demoting Jamie reverts her status to Standard user");

// Delete Jamie — doubleConfirm's two-step dialog: a first confirm
// naming the consequences, then a second "type DELETE" prompt (see
// doubleConfirm.js). Both must be gotten through before anything happens.
const jamieDeleteBtn = await page.evaluateHandle(() => {
  const cards = Array.from(document.querySelectorAll(".manage-user-card"));
  const jamie = cards.find((c) => c.textContent.includes("jamie@example.com"));
  return Array.from(jamie.querySelectorAll("button")).find((b) => b.textContent.trim() === "Delete");
});
await jamieDeleteBtn.asElement().click();
await page.waitForSelector(".modal-card");
const modalMessage = await page.$eval(".modal-message", (el) => el.textContent);
check(modalMessage.includes("Jamie Farmer") && modalMessage.includes("cloud-saved plots"), `delete confirmation warns about the named user and their cloud plots (got "${modalMessage}")`);

await page.click(".modal-actions .btn-danger");
await page.waitForSelector(".modal-input", { timeout: 5000 });
const typeConfirmMessage = await page.$eval(".modal-message", (el) => el.textContent);
check(typeConfirmMessage.includes("DELETE"), `the second step asks the admin to type DELETE (got "${typeConfirmMessage}")`);

// Typing the wrong word does NOT delete anything.
await page.fill(".modal-input", "wrong");
await page.click(".modal-actions .btn-primary");
await page.waitForTimeout(300);
cards = await page.$$(".manage-user-card");
check(cards.length === 2, `typing the wrong confirmation word cancels the delete (got ${cards.length} card(s), expected still 2)`);

// Retry, typing the right word this time.
await jamieDeleteBtn.asElement().click();
await page.waitForSelector(".modal-card");
await page.click(".modal-actions .btn-danger");
await page.waitForSelector(".modal-input", { timeout: 5000 });
await page.fill(".modal-input", "DELETE");
await page.click(".modal-actions .btn-primary");
await page.waitForTimeout(300);

cards = await page.$$(".manage-user-card");
check(cards.length === 1, `Jamie is removed from the list after typing DELETE (got ${cards.length} card(s))`);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
