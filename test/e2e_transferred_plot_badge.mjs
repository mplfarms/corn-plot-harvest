// Verifies the Saved Plots screen shows a "From {name}" badge on any
// plot that carries a transferredFrom tag (set server-side whenever a
// plot moves accounts — adminUsers.js's merge or deleteAccount.js's
// self-delete, see savedPlots.js) without re-sorting the list into
// groups by origin.
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

// savedPlots.js reads straight from libraryStore's local
// cph.savedTrials — it never calls the server itself (only
// cloudSyncStore does, on an actual sign-in event, which a page reload
// with an already-set session doesn't re-trigger). So the local library
// is seeded directly here; fetch is left real (just DefaultLists.json
// off the local static server at startup, same as every other test).
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem("cph.authSession", JSON.stringify({ name: "Mike Admin", email: "mplfarms@aol.com", isAdmin: true }));
  localStorage.setItem(
    "cph.savedTrials",
    JSON.stringify([
      {
        id: "own1",
        header: { cooperatorName: "My Own Plot", state: "IA" },
        entries: [],
        lastModified: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "transferred1",
        header: { cooperatorName: "Jamie's Old Plot", state: "IA" },
        entries: [],
        lastModified: "2026-06-05T00:00:00.000Z",
        transferredFrom: { email: "jamie@example.com", name: "Jamie Farmer" },
      },
    ])
  );
});
await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
await page.waitForSelector(".entry-row", { timeout: 5000 });
const rows = await page.$$eval(".entry-row", (els) =>
  els.map((el) => ({
    text: el.textContent,
    hasBadge: Boolean(el.querySelector(".badge-transferred")),
  }))
);

const ownRow = rows.find((r) => r.text.includes("My Own Plot"));
const transferredRow = rows.find((r) => r.text.includes("Jamie's Old Plot"));

check(Boolean(ownRow) && !ownRow.hasBadge, "a plot with no transferredFrom tag shows no 'From' badge");
check(Boolean(transferredRow) && transferredRow.hasBadge, "a plot with a transferredFrom tag shows a 'From' badge");
check(
  Boolean(transferredRow) && transferredRow.text.includes("From Jamie Farmer"),
  `the badge names the original owner (got row text "${transferredRow && transferredRow.text}")`
);

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
