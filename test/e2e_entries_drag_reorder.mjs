// Verifies the Hybrid Entries screen's drag-to-reorder gesture
// (entriesList.js's attachTouchGestures()/attachMouseDragToReorder(),
// trialStore.reorderEntry()), which replaced the old up/down arrow
// buttons entirely:
//   1. The up/down arrow buttons are gone.
//   2. Mouse click-and-drag reorders immediately (no long-press needed)
//      — dragging entry 1 to land between entries 3 and 4 renumbers the
//      list to [2, 3, 1, 4], exactly the example given in the request.
//   3. A plain mouse click (no real drag) still navigates into the entry
//      — a click-and-drag doesn't leave a stray "click" behind that also
//      navigates.
//   4. On a touch device, a long-press (hold still, then drag) reorders.
//   5. On a touch device, a quick drag with NO hold still resolves as
//      the existing swipe-to-delete gesture, not a reorder — the two
//      gestures don't stomp on each other.
//   6. A quick vertical drag with no hold does nothing (treated as a
//      scroll attempt, matching a real list), and a plain tap still
//      navigates afterward.
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

// Drives a synthetic touch drag via dispatchEvent (same technique as
// e2e_entries_swipe_delete.mjs) — touchstart, an optional hold before any
// movement (to simulate a long-press), then a sequence of touchmove steps
// down to touchend. holdMs models how long the finger sits still before
// starting to move; 0 means "immediate fast swipe", well over
// entriesList.js's 450ms LONG_PRESS_MS models a real long-press-then-drag.
async function touchDrag(page, selector, dy, { holdMs, steps }) {
  const box = await page.locator(selector).boundingBox();
  await page.evaluate(
    ({ selector, box, dy, holdMs, steps }) => {
      return new Promise((resolve) => {
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
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        fireTouch("touchstart", startX, startY);
        setTimeout(() => {
          let i = 0;
          const mover = setInterval(() => {
            i++;
            fireTouch("touchmove", startX, startY + (dy * i) / steps);
            if (i >= steps) {
              clearInterval(mover);
              fireTouch("touchend", startX, startY + dy);
              resolve();
            }
          }, 20);
        }, holdMs);
      });
    },
    { selector, box, dy, holdMs, steps }
  );
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--touch-events=enabled"] });

// ---- 1. The old arrow buttons are gone ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);
  check((await page.locator('[aria-label="Move up"]').count()) === 0, "the old Move up arrow button is gone");
  check((await page.locator('[aria-label="Move down"]').count()) === 0, "the old Move down arrow button is gone");
  check((await page.locator('[aria-label="Delete entry"]').count()) === 2, "the trash-can delete button is still there on every row");
  await page.close();
}

// ---- 2. Mouse click-and-drag reorders — the request's own worked example ----
{
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpen(page, [mkEntry(1), mkEntry(2), mkEntry(3), mkEntry(4)]);

  const row1 = page.locator(".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row-main");
  const row3 = page.locator(".entries-list .entry-row-swipe-wrap:nth-child(3) .entry-row-main");
  const box1 = await row1.boundingBox();
  const box3 = await row3.boundingBox();

  await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
  await page.mouse.down();
  // Drop just past entry 3's center — "between position 3 and 4".
  await page.mouse.move(box1.x + box1.width / 2, box3.y + box3.height / 2 + 5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const titlesAfter = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(
    titlesAfter.join(",") === "H2,H3,H1,H4",
    `dragging entry 1 to between positions 3 and 4 reorders to [H2, H3, H1, H4] (got ${JSON.stringify(titlesAfter)})`
  );
  const numbersAfter = await page.$$eval(".entry-row-number", (els) => els.map((el) => el.textContent));
  check(numbersAfter.join(",") === "1,2,3,4", `the list renumbers sequentially 1-4 from its new order (got ${JSON.stringify(numbersAfter)})`);

  await page.waitForTimeout(300); // autosave debounce
  const storedOrder = await page.evaluate(() => JSON.parse(localStorage.getItem("cph.draftTrial")).entries.map((e) => e.hybrid));
  check(storedOrder.join(",") === "H2,H3,H1,H4", `the new order is actually persisted (got ${JSON.stringify(storedOrder)})`);

  await page.close();
}

// ---- 3. A plain mouse click (no drag) still navigates — no stray click-after-drag ----
{
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);

  await page.click(".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row-main");
  await page.waitForSelector(".entry-editor-screen", { timeout: 3000 }).catch(() => {});
  check(page.url().includes("#/entry-editor"), "a plain click with no drag still navigates into the entry editor");

  await page.close();
}

// ---- 4. Touch long-press then drag reorders ----
{
  const { context, page } = await (async () => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
    return { context, page };
  })();
  await seedAndOpen(page, [mkEntry(1), mkEntry(2), mkEntry(3), mkEntry(4)]);

  // Hold well past LONG_PRESS_MS (450ms) before moving, then drag down
  // past every other row.
  await touchDrag(page, ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row", 320, { holdMs: 550, steps: 8 });
  await page.waitForTimeout(300);
  const titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.join(",") === "H2,H3,H4,H1", `a long-press then drag moves entry 1 to the end (got ${JSON.stringify(titles)})`);

  await context.close();
}

// ---- 5. A quick horizontal drag with NO hold is still swipe-to-delete, not a reorder ----
{
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpen(page, [mkEntry(1), mkEntry(2)]);

  await touchDrag(page, ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row", 0, { holdMs: 0, steps: 5 });
  // touchDrag only varies Y; do a horizontal one directly for this check.
  const row = ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row";
  const box = await page.locator(row).boundingBox();
  await page.evaluate(
    ({ selector, box }) => {
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
      for (let i = 1; i <= 5; i++) fireTouch("touchmove", startX - (100 * i) / 5, startY);
      fireTouch("touchend", startX - 100, startY);
    },
    { selector: row, box }
  );
  await page.waitForTimeout(200);
  const transform = await page.locator(row).evaluate((el) => getComputedStyle(el).transform);
  check(transform.includes("-84"), `a quick horizontal drag (no hold) still resolves as swipe-to-delete (got transform "${transform}")`);
  const titlesUnchanged = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titlesUnchanged.join(",") === "H1,H2", "the entry order is untouched by that swipe");

  await context.close();
}

// ---- 6. A quick vertical drag with no hold does nothing; a plain tap still navigates ----
{
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedAndOpen(page, [mkEntry(1), mkEntry(2), mkEntry(3)]);

  await touchDrag(page, ".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row", 200, { holdMs: 0, steps: 4 });
  await page.waitForTimeout(200);
  const titles = await page.$$eval(".entry-row-title", (els) => els.map((el) => el.textContent));
  check(titles.join(",") === "H1,H2,H3", `a quick vertical drag with no hold reorders nothing (got ${JSON.stringify(titles)})`);

  await page.click(".entries-list .entry-row-swipe-wrap:nth-child(1) .entry-row-main");
  await page.waitForSelector(".entry-editor-screen", { timeout: 3000 }).catch(() => {});
  check(page.url().includes("#/entry-editor"), "a plain tap afterward still navigates normally");

  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
