// Verifies the Saved Plots screen's swipe-to-delete and right-click-to-
// delete gestures (savedPlots.js's attachSwipeToDelete() and the row's
// contextmenu listener):
//   1. On a touch-capable page, swiping a row left past the halfway
//      point reveals the red Delete panel underneath, same as
//      entriesList.js.
//   2. Tapping that revealed Delete button asks for confirmation first
//      (unlike entriesList.js, which deletes immediately) — canceling
//      leaves the plot in place, confirming removes it.
//   3. A short swipe that doesn't cross the halfway point snaps back
//      shut instead of opening anything.
//   4. Opening a second row's swipe closes the first one.
//   5. Tapping the row's own content while it's swiped open just closes
//      it (doesn't navigate into the plot).
//   6. A right-click on a row skips straight to the same confirmation —
//      canceling leaves the plot in place, confirming removes it.
//   7. The original trash-can icon still asks and deletes as before,
//      unaffected by any of the above.
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

function mkTrial(id, cooperatorName, lastModified) {
  return {
    id,
    header: { cooperatorName, state: "IA" },
    entries: [],
    lastModified,
  };
}

async function seedAndOpen(page, trials) {
  await page.goto(`${BASE}/index.html`);
  // Seed the demo-plot-seeded flag to the app's current version so
  // ensureDemoPlot() (see libraryStore.js) no-ops and doesn't add an
  // extra "Demo Plot" row on top of the trials this test seeds — this
  // test cares only about the rows it explicitly created.
  const currentVersion = await page.evaluate(async () => {
    const res = await fetch("/js/version.js");
    const src = await res.text();
    const m = src.match(/APP_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  });
  await page.evaluate(
    ({ trials, currentVersion }) => {
      localStorage.clear();
      localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
      localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
      localStorage.setItem("cph.demoPlotSeededVersion", JSON.stringify(currentVersion));
      localStorage.setItem("cph.savedTrials", JSON.stringify(trials));
    },
    { trials, currentVersion }
  );
  await page.goto(`${BASE}/index.html?r=1#/saved-plots`);
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  await page.waitForSelector(".entry-row", { timeout: 5000 });
}

// Drives a synthetic touch swipe directly via dispatchEvent — Playwright's
// page.touchscreen only supports a single tap, no drag, so this constructs
// the same touchstart/touchmove/touchend sequence the browser would fire
// for a real finger drag and dispatches it straight at the row element.
async function swipeRow(page, rowSelector, dx) {
  const box = await page.locator(rowSelector).boundingBox();
  await page.evaluate(
    ({ selector, box, dx }) => {
      const el = document.querySelector(selector);
      function fireTouch(type, clientX, clientY) {
        const touch = new Touch({ identifier: 1, target: el, clientX, clientY });
        const ev = new TouchEvent(type, {
          touches: type === "touchend" ? [] : [touch],
          targetTouches: type === "touchend" ? [] : [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(ev);
      }
      const startX = box.x + box.width - 20;
      const startY = box.y + box.height / 2;
      fireTouch("touchstart", startX, startY);
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        fireTouch("touchmove", startX + (dx * i) / steps, startY);
      }
      fireTouch("touchend", startX + dx, startY);
    },
    { selector: rowSelector, box, dx }
  );
}

async function newTouchPage(browser) {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  return { context, page };
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--touch-events=enabled"] });

const TWO_TRIALS = [
  mkTrial("t1", "Coop One", "2026-01-01T00:00:00.000Z"),
  mkTrial("t2", "Coop Two", "2026-02-01T00:00:00.000Z"), // more recent -> sorts first (row 1)
];

// ---- 1 & 2. Swipe past halfway reveals Delete; tapping it asks first ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, TWO_TRIALS);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  await swipeRow(page, firstRow, -100); // past the 84px reveal width's halfway point
  await page.waitForTimeout(150);
  const transform = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  check(transform.includes("-84"), `swiping a row left past halfway reveals the Delete panel (got transform "${transform}")`);

  const deleteBtn = page.locator(".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row-swipe-delete-btn");
  check(await deleteBtn.isVisible(), "the Delete button is present and visible once revealed");
  await deleteBtn.click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const modalTitle = await page.locator(".modal-title").textContent();
  check(modalTitle === "Delete Saved Plot?", `tapping the revealed Delete button asks for confirmation first, doesn't delete immediately (got title "${modalTitle}")`);

  // Cancel: the plot must still be there.
  await page.locator(".modal-actions button", { hasText: "Cancel" }).click();
  await page.waitForTimeout(150);
  let titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.some((t) => t.includes("Coop Two")), `canceling the confirmation leaves the plot in place (got ${JSON.stringify(titles)})`);

  // Swipe open again and this time confirm — the plot should be removed.
  await swipeRow(page, firstRow, -100);
  await page.waitForTimeout(150);
  await page.locator(".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row-swipe-delete-btn").click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  await page.locator(".modal-actions button", { hasText: "Delete" }).click();
  await page.waitForTimeout(150);
  titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.length === 1 && !titles.join("").includes("Coop Two"), `confirming removes the plot (remaining: ${JSON.stringify(titles)})`);

  await context.close();
}

// ---- 3. A short swipe (under halfway) snaps back shut, nothing opens ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, TWO_TRIALS);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  await swipeRow(page, firstRow, -20); // well under the 42px halfway point
  await page.waitForTimeout(150);
  const transform = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  check(transform === "none" || transform.includes("matrix(1, 0, 0, 1, 0, 0)"), `a short swipe under halfway snaps back shut (got transform "${transform}")`);

  const modalVisible = await page.locator(".modal-card").count();
  check(modalVisible === 0, "no confirmation was triggered by the short swipe");

  await context.close();
}

// ---- 4. Opening a second row's swipe closes the first one ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, TWO_TRIALS);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  const secondRow = ".entries-list .entry-row-swipe-wrap:nth-child(2) .entry-row";
  await swipeRow(page, firstRow, -100);
  await page.waitForTimeout(150);
  let firstTransform = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  check(firstTransform.includes("-84"), "first row opens as expected");

  await swipeRow(page, secondRow, -100);
  await page.waitForTimeout(150);
  firstTransform = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  const secondTransform = await page.locator(secondRow).evaluate((el) => getComputedStyle(el).transform);
  check(firstTransform === "none" || firstTransform.includes("matrix(1, 0, 0, 1, 0, 0)"), `opening the second row's swipe closes the first row (got "${firstTransform}")`);
  check(secondTransform.includes("-84"), "the second row is now the one open");

  await context.close();
}

// ---- 5. Tapping the row's own content while swiped open just closes it, doesn't navigate ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, TWO_TRIALS);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  await swipeRow(page, firstRow, -100);
  await page.waitForTimeout(150);
  await page.locator(firstRow).locator(".entry-row-main").click({ force: true });
  await page.waitForTimeout(150);
  check(page.url().includes("#/saved-plots"), "tapping the swiped-open row's content does not navigate into the plot");
  const transformAfterTap = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  check(transformAfterTap === "none" || transformAfterTap.includes("matrix(1, 0, 0, 1, 0, 0)"), "that tap closes the row back up instead");

  await context.close();
}

// ---- 6. Right-click skips straight to the same confirmation ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, TWO_TRIALS);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  await page.locator(firstRow).click({ button: "right" });
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  const modalTitle = await page.locator(".modal-title").textContent();
  check(modalTitle === "Delete Saved Plot?", `right-clicking a row asks for confirmation directly (got title "${modalTitle}")`);

  // Cancel: the plot must still be there.
  await page.locator(".modal-actions button", { hasText: "Cancel" }).click();
  await page.waitForTimeout(150);
  let titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.some((t) => t.includes("Coop Two")), `canceling a right-click delete leaves the plot in place (got ${JSON.stringify(titles)})`);

  // Right-click again and confirm — the plot should be removed.
  await page.locator(firstRow).click({ button: "right" });
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  await page.locator(".modal-actions button", { hasText: "Delete" }).click();
  await page.waitForTimeout(150);
  titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.length === 1 && !titles.join("").includes("Coop Two"), `confirming a right-click delete removes the plot (remaining: ${JSON.stringify(titles)})`);

  await context.close();
}

// ---- 7. The trash-can icon still asks and deletes, independent of the above ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, TWO_TRIALS);

  await page.locator(".entries-list .entry-row-swipe-wrap:nth-child(1) .icon-btn-danger").click();
  await page.waitForSelector(".modal-card", { timeout: 5000 });
  await page.locator(".modal-actions button", { hasText: "Delete" }).click();
  await page.waitForTimeout(150);
  const titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.length === 1, `the trash-can icon still asks and then deletes a plot (remaining: ${JSON.stringify(titles)})`);

  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
