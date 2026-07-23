// Verifies the Hybrid Entries screen's swipe-to-delete gesture
// (entriesList.js's attachSwipeToDelete()):
//   1. On a touch-capable page, swiping a row left past the halfway
//      point reveals the red Delete panel underneath.
//   2. Tapping that revealed Delete button removes the entry.
//   3. A short swipe that doesn't cross the halfway point snaps back
//      shut instead of deleting anything.
//   4. Opening a second row's swipe closes the first one.
//   5. Tapping the row's own content while it's swiped open just closes
//      it (doesn't navigate into the entry).
//   6. The original trash-can icon still deletes immediately, unaffected
//      by any of the above — the fallback for non-touch devices.
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

function mkEntry(n) {
  return {
    id: `e${n}`,
    brand: "Midwest Seed Genetics",
    hybrid: `H${n}`,
    trait: "VT2P",
    relativeMaturity: "100",
    seedTreatment: "",
    sampleNetWeightLbs: "",
    moisturePercent: "",
    testWeight: "",
    stripLengthFeet: "",
    numberOfRows: "",
    widthInches: "",
    comments: "",
    manualDryYield: "200",
  };
}

async function seedAndOpen(page, entries) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((entries) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify("midwestSeedGenetics"));
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
    localStorage.setItem(
      "cph.draftTrial",
      JSON.stringify({ id: "t1", header: { cooperatorName: "Test Coop", state: "IA", county: "" }, entries })
    );
  }, entries);
  await page.goto(`${BASE}/index.html?r=1#/entries`);
  await page.waitForSelector(".entries-list-screen", { timeout: 5000 });
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
      // A few intermediate steps, same as a real drag, so the row's own
      // "is this horizontal?" direction check (which needs >1 sample) sees
      // a clear left-moving gesture.
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

// ---- 1 & 2. Swipe past halfway reveals Delete, tapping it removes the entry ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  await swipeRow(page, firstRow, -100); // past the 84px reveal width's halfway point
  await page.waitForTimeout(150);
  const transform = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  check(transform.includes("-84"), `swiping a row left past halfway reveals the Delete panel (got transform "${transform}")`);

  const deleteBtn = page.locator(".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row-swipe-delete-btn");
  check((await deleteBtn.isVisible()), "the Delete button is present and visible once revealed");
  await deleteBtn.click();
  await page.waitForTimeout(150);
  const remainingTitles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(remainingTitles.length === 1 && !remainingTitles.join("").includes("H1"), `tapping the revealed Delete button removes that entry (remaining: ${JSON.stringify(remainingTitles)})`);

  await context.close();
}

// ---- 3. A short swipe (under halfway) snaps back shut, nothing deleted ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  await swipeRow(page, firstRow, -20); // well under the 42px halfway point
  await page.waitForTimeout(150);
  const transform = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  check(transform === "none" || transform.includes("matrix(1, 0, 0, 1, 0, 0)"), `a short swipe under halfway snaps back shut (got transform "${transform}")`);

  const titlesAfter = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titlesAfter.length === 2, `nothing was deleted by the short swipe (still ${titlesAfter.length} entries)`);

  await context.close();
}

// ---- 4. Opening a second row's swipe closes the first one ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);

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
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);

  const firstRow = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  await swipeRow(page, firstRow, -100);
  await page.waitForTimeout(150);
  await page.locator(firstRow).locator(".entry-row-main").click({ force: true });
  await page.waitForTimeout(150);
  check(page.url().includes("#/entries"), "tapping the swiped-open row's content does not navigate into the entry editor");
  const transformAfterTap = await page.locator(firstRow).evaluate((el) => getComputedStyle(el).transform);
  check(transformAfterTap === "none" || transformAfterTap.includes("matrix(1, 0, 0, 1, 0, 0)"), "that tap closes the row back up instead");

  await context.close();
}

// ---- 6. The trash-can icon still deletes immediately, independent of swipe ----
{
  const { context, page } = await newTouchPage(browser);
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);

  await page.locator(".entries-list .entry-row-swipe-wrap:nth-child(1) .icon-btn-danger").click();
  await page.waitForTimeout(150);
  const titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.length === 1, `the trash-can icon still deletes an entry immediately (remaining: ${JSON.stringify(titles)})`);

  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
