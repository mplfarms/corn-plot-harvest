// Regression test for a real production incident: a device that hadn't
// recently reopened the app would, on the next app update, silently
// overwrite the cloud with its own stale/incomplete local copy — because
// nothing pulled fresh cloud data on a normal reopen (authStore.init() is
// a no-op) before libraryStore.ensureDemoPlot()'s automatic per-version
// mutation triggered an automatic push. See cloudSyncStore.js's top
// comment and main.js's start() for the two-layer fix this test guards.
//
// Scenario simulated here: a signed-in "device" whose local storage has
// (a) one real plot NOT known to the cloud, and (b) an outdated
// demoPlotSeededVersion (so ensureDemoPlot() will mutate the library the
// moment the app boots, exactly like it does after every shipped
// update). The cloud, per the mocked GET, has a DIFFERENT real plot that
// this device has never seen locally. If the app ever pushes before it
// has pulled, that cloud-only plot would be silently deleted the moment
// the PUT lands. This test asserts:
//   1. The GET (pull) always happens before any PUT (push) is sent.
//   2. After boot settles, the cloud-only plot has been merged into local
//      storage (proving the pull+merge actually ran and wasn't skipped).
//   3. If/when a push does fire (ensureDemoPlot's mutation schedules one),
//      its payload still includes the cloud-only plot's id — i.e. the
//      cloud data survives the round trip instead of being overwritten
//      away.
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

const calls = [];
await page.exposeFunction("__recordCall", (entry) => calls.push(entry));
await page.addInitScript(() => {
  window.fetch = async (url, options) => {
    const u = String(url);
    const method = (options && options.method) || "GET";
    if (u.includes("/.netlify/functions/plots")) {
      if (method === "GET") {
        await window.__recordCall({ method: "GET" });
        return new Response(
          JSON.stringify({
            trials: [
              {
                id: "cloud-only-plot",
                header: { cooperatorName: "George Harrison", state: "IA" },
                entries: [],
                lastModified: "2026-07-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200 }
        );
      }
      const payload = JSON.parse((options && options.body) || "{}");
      await window.__recordCall({ method: "PUT", ids: (payload.trials || []).map((t) => t.id) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  };
});

// Simulate a "device" that: is signed in, has one real local-only plot the
// cloud has never seen, and has an OUTDATED demoPlotSeededVersion — so
// ensureDemoPlot() will mutate the library (and schedule an automatic
// push) the instant the app boots, just like after every real update.
await page.goto(`${BASE}/index.html`);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
  localStorage.setItem(
    "cph.authSession",
    JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false })
  );
  localStorage.setItem("cph.demoPlotSeededVersion", JSON.stringify("v0.0 (an old test build)"));
  localStorage.setItem(
    "cph.savedTrials",
    JSON.stringify([
      {
        id: "local-only-plot",
        header: { cooperatorName: "Mike Lage", state: "IA" },
        entries: [],
        lastModified: "2026-06-15T00:00:00.000Z",
      },
    ])
  );
});

// A normal reopen — not a fresh sign-in — is exactly the scenario that
// used to skip the pull entirely (authStore.init() is a no-op).
await page.goto(`${BASE}/index.html?r=1`);
await page.waitForSelector(".screen-body, .plot-chooser-screen, .saved-plots-screen", { timeout: 5000 }).catch(() => {});

// Give the debounced push (1.5s) plenty of time to fire if it's going to.
await page.waitForTimeout(2200);

check(calls.length >= 1, `at least one cloud call happened (got ${calls.length})`);
const firstGetIdx = calls.findIndex((c) => c.method === "GET");
const firstPutIdx = calls.findIndex((c) => c.method === "PUT");
check(firstGetIdx !== -1, "a GET (pull) happened at all");
check(
  firstPutIdx === -1 || firstGetIdx < firstPutIdx,
  `the GET (pull) always happens before any PUT (push) — GET at index ${firstGetIdx}, first PUT at index ${firstPutIdx}`
);

const localAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.savedTrials") || "[]"));
check(
  localAfter.some((t) => t.id === "cloud-only-plot"),
  "the cloud-only plot ('George Harrison') got merged into local storage after boot"
);
check(
  localAfter.some((t) => t.id === "local-only-plot"),
  "the device's own pre-existing local-only plot ('Mike Lage') is still present"
);

if (firstPutIdx !== -1) {
  const put = calls[firstPutIdx];
  check(
    put.ids.includes("cloud-only-plot"),
    `the eventual push includes the cloud-only plot instead of silently dropping it (got ${JSON.stringify(put.ids)})`
  );
  check(
    put.ids.includes("local-only-plot"),
    `the eventual push still includes the device's own local plot (got ${JSON.stringify(put.ids)})`
  );
} else {
  check(true, "no push fired during the window (nothing to lose either way)");
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
