// Verifies the service worker (sw.js) precaches the app shell fresh on
// every install, rather than potentially reusing a stale HTTP-cached
// copy of an unchanged-URL file:
//   1. Source-level guard: the install handler must NOT call
//      cache.addAll(PRECACHE_URLS) directly (that convenience method
//      uses default, HTTP-cache-respecting fetch semantics) — it must
//      fetch each precached URL with { cache: "reload" } instead, which
//      is what actually forces a network round-trip past the browser's
//      own HTTP cache. This is a regression guard for exactly the bug
//      reported: the version footer showed the new build, but some
//      other module (which happened to still have a fresh HTTP-cache
//      entry) kept running old logic underneath it.
//   2. Functional smoke test: after registering the service worker in a
//      real browser and letting it activate, every precached URL is
//      actually present in Cache Storage under the current CACHE_NAME,
//      and a sampled file's cached bytes match what the server is
//      currently serving — proving the refactored install loop still
//      does its job.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const swSource = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");

// ---- 1. Source-level guard ----
// Strip // comment lines first — the fix's own explanatory comment
// mentions the string "cache.addAll(PRECACHE_URLS)" by name (describing
// what NOT to do), which would otherwise false-positive a naive
// substring/regex check against the raw source.
const swCodeOnly = swSource
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
check(!/cache\.addAll\(\s*PRECACHE_URLS\s*\)/.test(swCodeOnly), "the install handler does not call cache.addAll(PRECACHE_URLS) directly");
check(/fetch\(\s*url\s*,\s*\{\s*cache:\s*["']reload["']\s*\}\s*\)/.test(swCodeOnly), 'each precached URL is fetched with { cache: "reload" } to bypass the HTTP cache');

// ---- 2. Functional smoke test ----
{
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(`${BASE}/index.html`);
  await page.evaluate(() => {
    localStorage.clear();
  });

  const cacheVersion = await page.evaluate(async () => {
    const res = await fetch("/sw.js");
    const src = await res.text();
    const m = src.match(/CACHE_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  });
  check(Boolean(cacheVersion), `read the service worker's current CACHE_VERSION (got ${cacheVersion})`);

  // Register and wait for this service worker to take control, same as
  // main.js does on a real load, then wait for it to finish activating.
  const activated = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    return Boolean(reg.active);
  });
  check(activated, "the service worker registers and reaches the active state");

  const precacheUrlCount = await page.evaluate(() => {
    // Reach into the SW's own source to count PRECACHE_URLS without
    // duplicating the literal list here — parsed the same way the
    // browser will see it.
    return fetch("/sw.js")
      .then((r) => r.text())
      .then((src) => {
        const m = src.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
        if (!m) return 0;
        return (m[1].match(/"\/[^"]+"/g) || []).length;
      });
  });
  check(precacheUrlCount > 30, `sw.js lists a substantial app shell to precache (found ${precacheUrlCount} entries)`);

  const cacheName = `corn-plot-harvest-${cacheVersion}`;
  const cachedCount = await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    return keys.length;
  }, cacheName);
  check(
    cachedCount >= precacheUrlCount,
    `every precached URL actually landed in Cache Storage under "${cacheName}" (cached ${cachedCount}, expected at least ${precacheUrlCount})`
  );

  // Spot-check one file's cached bytes match what the server currently
  // serves — the actual property this whole fix is protecting.
  const demoPlotMatches = await page.evaluate(async (cacheName) => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match("/js/core/demoPlot.js");
    if (!cached) return { ok: false, reason: "not in cache" };
    const cachedText = await cached.text();
    const liveText = await fetch("/js/core/demoPlot.js", { cache: "reload" }).then((r) => r.text());
    return { ok: cachedText === liveText, cachedLen: cachedText.length, liveLen: liveText.length };
  }, cacheName);
  check(
    demoPlotMatches.ok,
    `the precached copy of demoPlot.js matches what the server currently serves (cached ${demoPlotMatches.cachedLen} bytes, live ${demoPlotMatches.liveLen} bytes)`
  );

  await context.close();
  await browser.close();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
