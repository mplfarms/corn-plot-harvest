// Verifies the "Merge Into…" flow on the Manage Users screen
// (manageUsers.js + adminUsers.js's "merge" action): the real-world case
// of the same person ending up as two separate accounts because they
// signed in with a different email on a different device. Clicking
// "Merge Into…" on one account opens a picker of every OTHER account,
// picking one shows a confirm dialog naming both accounts, and
// confirming calls the merge endpoint with the right source/target and
// removes the merged-away account from the list.
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

const mergeCalls = [];
await page.exposeFunction("__recordMerge", (payload) => mergeCalls.push(payload));

await page.addInitScript(() => {
  let users = [
    { name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true, createdAt: "2026-01-01T00:00:00.000Z" },
    { name: "Mike Lage", email: "mikelage@republicseed.com", isAdmin: false, createdAt: "2026-01-02T00:00:00.000Z" },
    { name: null, email: "mikelage2@gmail.com", isAdmin: false, createdAt: "2026-01-03T00:00:00.000Z" },
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
      if (payload.action === "merge") {
        window.__recordMerge(payload);
        users = users.filter((x) => x.email !== payload.sourceEmail);
        return new Response(JSON.stringify({ ok: true, mergedTrialCount: 7 }), { status: 200 });
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
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
});
await page.goto(`${BASE}/index.html?r=1#/manage-users`);
await page.waitForSelector(".manage-user-card", { timeout: 8000 });

let cards = await page.$$(".manage-user-card");
check(cards.length === 3, `all three registered accounts are listed (got ${cards.length})`);

// Merge the no-name gmail duplicate into the named republicseed.com account.
const mergeBtn = await page.evaluateHandle(() => {
  const cards = Array.from(document.querySelectorAll(".manage-user-card"));
  const dup = cards.find((c) => c.textContent.includes("mikelage2@gmail.com"));
  return Array.from(dup.querySelectorAll("button")).find((b) => b.textContent.trim() === "Merge Into…");
});
await mergeBtn.asElement().click();

await page.waitForSelector(".search-list-option", { timeout: 5000 });
const pickerOptions = await page.$$eval(".search-list-option", (els) => els.map((e) => e.textContent.trim()));
check(
  pickerOptions.some((t) => t.includes("mikelage@republicseed.com")) && pickerOptions.some((t) => t.includes("mplfarms@aol.com")),
  `the merge-target picker lists every OTHER account (got ${JSON.stringify(pickerOptions)})`
);
check(
  !pickerOptions.some((t) => t.includes("mikelage2@gmail.com")),
  "the account being merged does NOT appear as a possible target for itself"
);

await page.locator(".search-list-option", { hasText: "mikelage@republicseed.com" }).click();
await page.waitForSelector(".modal-card", { timeout: 5000 });
const modalMessage = await page.$eval(".modal-message", (el) => el.textContent);
check(
  modalMessage.includes("mikelage2@gmail.com") && modalMessage.includes("mikelage@republicseed.com"),
  `the confirm dialog names both the source and target accounts (got "${modalMessage}")`
);

// doubleConfirm.js's second step: typing the wrong word cancels the merge.
await page.click(".modal-actions .btn-danger");
await page.waitForSelector(".modal-input", { timeout: 5000 });
await page.fill(".modal-input", "nope");
await page.click(".modal-actions .btn-primary");
await page.waitForTimeout(300);
check(mergeCalls.length === 0, "typing the wrong confirmation word does NOT trigger a merge call");

// Retry the whole flow, typing the right word this time.
await mergeBtn.asElement().click();
await page.waitForSelector(".search-list-option", { timeout: 5000 });
await page.locator(".search-list-option", { hasText: "mikelage@republicseed.com" }).click();
await page.waitForSelector(".modal-card", { timeout: 5000 });
await page.click(".modal-actions .btn-danger");
await page.waitForSelector(".modal-input", { timeout: 5000 });
await page.fill(".modal-input", "DELETE");
await page.click(".modal-actions .btn-primary");
await page.waitForTimeout(400);

check(mergeCalls.length === 1, `exactly one merge call was made (got ${mergeCalls.length})`);
check(
  mergeCalls[0] && mergeCalls[0].sourceEmail === "mikelage2@gmail.com" && mergeCalls[0].targetEmail === "mikelage@republicseed.com",
  `the merge call carries the right source and target (got ${JSON.stringify(mergeCalls[0])})`
);

cards = await page.$$(".manage-user-card");
check(cards.length === 2, `the merged-away account no longer appears in the list (got ${cards.length} card(s))`);

// With only two accounts left, merging the last remaining non-self pair
// should still work — but merging the ADMIN's own account (self) is
// still fine to attempt from here since only "delete self" is blocked,
// not "merge self away"; this just confirms the button isn't disabled
// unless there's truly nobody else to merge into.
const remainingMergeBtns = await page.$$eval(".manage-user-card button", (els) =>
  els.filter((b) => b.textContent.trim() === "Merge Into…").map((b) => b.disabled)
);
check(
  remainingMergeBtns.every((disabled) => !disabled),
  `with 2+ accounts, Merge Into… stays enabled on every card (got ${JSON.stringify(remainingMergeBtns)})`
);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
