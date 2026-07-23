// Verifies the "Swipe Down to Update" banner (updateBanner.js):
//   1. A brand-new device's very first service-worker install/activate
//      does NOT show the banner — that's just this device's first-ever
//      install taking over, not "an update arrived."
//   2. On a page that was already being served by an existing service
//      worker, a controllerchange (a new version taking over) shows the
//      banner.
//   3. Swiping down from the very top of the page, far enough to cross
//      the trigger threshold, reloads the app.
//   4. A swipe that doesn't start at the top of the page (i.e. the user
//      is scrolled into content) does nothing, even if it's a long
//      downward drag.
//   5. A swipe from the top that doesn't travel far enough does nothing
//      — it can't be confused with an ordinary small scroll/wobble.
//   6. Tapping/clicking the banner itself (the non-touch fallback) also
//      reloads the app.
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

// Chromium refuses to let scripts redefine window.location.reload (it's
// a protected Location-object method, not a plain own property), so
// stubbing it to count calls silently no-ops and the REAL reload fires
// instead. Rather than fight that, this marks the current page with a
// value that can only exist on THIS specific page instance, then checks
// whether it survived — gone means a real reload/navigation actually
// happened, present means it didn't. A genuine end-to-end check of the
// real behavior, not a mock.
async function markPage(page) {
  await page.evaluate(() => {
    window.__updateBannerTestMarker = true;
  });
}

async function pageWasReloaded(page) {
  return page.evaluate(() => window.__updateBannerTestMarker !== true);
}

async function seedSignedIn(page) {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  });
}

async function swipeDown(page, distancePx, { fromTop = true } = {}) {
  await page.evaluate(
    ({ distancePx, fromTop }) => {
      if (!fromTop) {
        // The current screen's own content might not naturally be tall
        // enough to actually scroll away from the top — add a spacer so
        // scrollTo(0, 200) below is guaranteed to really move scrollY,
        // not silently clamp back to 0 for lack of anywhere to scroll to.
        let spacer = document.getElementById("__testScrollSpacer");
        if (!spacer) {
          spacer = document.createElement("div");
          spacer.id = "__testScrollSpacer";
          spacer.style.height = "3000px";
          document.body.appendChild(spacer);
        }
        window.scrollTo(0, 200);
      }
      function fireTouch(type, clientX, clientY) {
        const touch = new Touch({ identifier: 1, target: document.body, clientX, clientY });
        const ev = new TouchEvent(type, {
          touches: type === "touchend" ? [] : [touch],
          targetTouches: type === "touchend" ? [] : [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(ev);
      }
      const startX = 200;
      const startY = 100;
      fireTouch("touchstart", startX, startY);
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        fireTouch("touchmove", startX, startY + (distancePx * i) / steps);
      }
      fireTouch("touchend", startX, startY + distancePx);
    },
    { distancePx, fromTop }
  );
}

async function newTouchContext(browser) {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  return { context, page };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--touch-events=enabled"] });

// ---- 1. First-ever install does not show the banner ----
{
  const { context, page } = await newTouchContext(browser);
  await page.goto(`${BASE}/index.html`);
  await seedSignedIn(page);
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), { timeout: 8000 });
  // Give the freshly-registered worker's own (first-ever) controllerchange
  // a moment to actually fire and be handled, same as it would for a real
  // brand-new install.
  await page.waitForTimeout(500);
  const bannerCount = await page.locator(".update-banner").count();
  check(bannerCount === 0, "a fresh device's first-ever service worker install does not show the update banner");

  await context.close();
}

// ---- 2, 3, 4, 5. Banner appears on a genuine controllerchange (page
// already had a controller); swipe-to-update behavior ----
{
  const { context, page } = await newTouchContext(browser);
  await page.goto(`${BASE}/index.html`);
  await seedSignedIn(page);
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), { timeout: 8000 });

  // Reload so THIS page load genuinely already has an active controller
  // at load time (hadControllerAtLoad = true) — the real-world condition
  // the guard in initUpdateBanner() cares about.
  await page.reload();
  await page.waitForSelector("#app", { timeout: 8000 }).catch(() => {});
  const hadController = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  check(hadController, "the reloaded page is already controlled by a service worker (test setup sanity check)");

  // Simulate "a new version just took over" without needing to actually
  // orchestrate a second real service-worker build — controllerchange is
  // a plain EventTarget event, so dispatching it directly exercises the
  // exact same listener a genuine version handoff would.
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  await page.waitForSelector(".update-banner", { timeout: 3000 });
  const bannerText = await page.locator(".update-banner").textContent();
  check(bannerText.includes("Swipe Down to Update"), `the banner appears after a genuine controllerchange (got "${bannerText}")`);

  // ---- 4. Swipe that doesn't start at the top does nothing ----
  await markPage(page);
  await swipeDown(page, 200, { fromTop: false });
  const scrollYDuringTest4 = await page.evaluate(() => window.scrollY);
  check(scrollYDuringTest4 > 4, `test setup sanity check: the page actually scrolled away from the top (scrollY=${scrollYDuringTest4})`);
  await page.waitForTimeout(150);
  let reloaded = await pageWasReloaded(page);
  check(!reloaded, "a long downward swipe that doesn't start at the top of the page does not trigger a reload");

  // ---- 5. Swipe from the top that's too short does nothing ----
  await page.evaluate(() => window.scrollTo(0, 0));
  await markPage(page);
  await swipeDown(page, 40, { fromTop: true }); // well under the 120px threshold
  await page.waitForTimeout(150);
  reloaded = await pageWasReloaded(page);
  check(!reloaded, "a short swipe from the top under the threshold does not trigger a reload");

  // ---- 3. A real swipe down from the top past the threshold reloads ----
  await page.evaluate(() => window.scrollTo(0, 0));
  await markPage(page);
  await swipeDown(page, 150, { fromTop: true });
  await page.waitForTimeout(500);
  reloaded = await pageWasReloaded(page);
  check(reloaded, "swiping down from the top past the threshold triggers a real reload");

  await context.close();
}

// ---- 6. Tapping/clicking the banner also reloads (non-touch fallback) ----
{
  const { context, page } = await newTouchContext(browser);
  await page.goto(`${BASE}/index.html`);
  await seedSignedIn(page);
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), { timeout: 8000 });
  await page.reload();
  await page.waitForSelector("#app", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  await page.waitForSelector(".update-banner", { timeout: 3000 });

  await markPage(page);
  await page.locator(".update-banner").click();
  await page.waitForTimeout(500);
  const reloaded = await pageWasReloaded(page);
  check(reloaded, "tapping/clicking the banner itself triggers a real reload");

  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
