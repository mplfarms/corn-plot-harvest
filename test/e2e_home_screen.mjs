// Verifies the new branded Home Screen (public/js/ui/screens/plotChooser.js,
// still routed at #/plot-chooser): "Corn Plot Entry" title above the
// selected brand's logo near the top, a solid brand-color background
// (green for Midwest Seed Genetics, blue for NC+), and the two action
// buttons ("Enter a New Plot" -> trial-details, "Saved Plots" ->
// saved-plots) toward the bottom, on top of the usual top bar.
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

async function seedBrandOnly(page, selectedBrand) {
  await page.goto(`${BASE}/index.html`);
  await page.evaluate((selectedBrand) => {
    localStorage.clear();
    localStorage.setItem("cph.selectedBrand", JSON.stringify(selectedBrand));
    // Sign-in is mandatory now — every screen but the launch screen
    // requires a session (see router.js's guard) — so seed one here too.
    localStorage.setItem("cph.authSession", JSON.stringify({ name: "Test User", email: "test@example.com", isAdmin: false }));
  }, selectedBrand);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ---- Midwest Seed Genetics view ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedBrandOnly(page, "midwestSeedGenetics");
  await page.goto(`${BASE}/index.html?r=1#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });

  check(!!(await page.$(".top-bar")), "top bar is present on the Home Screen");

  const titleText = await page.$eval(".home-title", (el) => el.textContent.trim());
  check(titleText === "Corn Plot Entry", `title reads "Corn Plot Entry" (got "${titleText}")`);

  const logoAlt = await page.$eval(".home-logo", (el) => el.alt);
  check(logoAlt === "Midwest Seed Genetics", `logo alt matches the selected brand (got "${logoAlt}")`);

  // Title must appear above the logo (DOM order within .home-hero-top).
  const order = await page.evaluate(() => {
    const top = document.querySelector(".home-hero-top");
    const children = Array.from(top.children);
    return { titleIdx: children.findIndex((c) => c.classList.contains("home-title")), logoIdx: children.findIndex((c) => c.classList.contains("home-logo")) };
  });
  check(order.titleIdx !== -1 && order.logoIdx !== -1 && order.titleIdx < order.logoIdx, `title comes before the logo in DOM order (${JSON.stringify(order)})`);

  // Hero background should be the brand's chrome color (Midwest: #08341f -> rgb(8,52,31)).
  const heroBg = await page.$eval(".home-hero", (el) => getComputedStyle(el).backgroundColor);
  check(heroBg === "rgb(8, 52, 31)", `Home Screen background uses Midwest's green chrome color (got "${heroBg}")`);

  // The white card behind the logo should take on the logo's own (wide,
  // ~2.38:1) aspect ratio rather than a fixed square that letterboxes it.
  const logoBox = await page.$eval(".home-logo", (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  const logoRatio = logoBox.w / logoBox.h;
  check(logoRatio > 1.8, `Midwest's logo card is proportionately wide, not square (ratio ${logoRatio.toFixed(2)}, box ${JSON.stringify(logoBox)})`);

  // Logo/title block should be pushed down from the very top of the hero
  // (toward the "horizon"/vertical middle), not flush against the top.
  const heroTopOffset = await page.evaluate(() => {
    const hero = document.querySelector(".home-hero").getBoundingClientRect();
    const top = document.querySelector(".home-hero-top").getBoundingClientRect();
    return top.top - hero.top;
  });
  check(heroTopOffset > 80, `title/logo block sits well below the top of the hero, closer to the middle (offset ${heroTopOffset.toFixed(0)}px)`);

  // Action buttons should be lifted slightly off the very bottom edge, not flush against it.
  const actionsBottomGap = await page.evaluate(() => {
    const hero = document.querySelector(".home-hero").getBoundingClientRect();
    const actions = document.querySelector(".home-actions").getBoundingClientRect();
    return hero.bottom - actions.bottom;
  });
  check(actionsBottomGap > 15, `action buttons are lifted slightly off the bottom edge (gap ${actionsBottomGap.toFixed(0)}px)`);

  // Buttons: "Enter a New Plot" then "Saved Plots", then the Quick Start
  // Guide link, in that DOM order, all below the hero-top.
  const btnLabels = await page.$$eval(".home-actions .home-btn", (els) => els.map((el) => el.textContent.trim()));
  check(
    btnLabels.length === 3 &&
      btnLabels[0].startsWith("Enter a New Plot") &&
      btnLabels[1].startsWith("Saved Plots") &&
      btnLabels[2].includes("Quick Start Guide"),
    `both action buttons plus the Quick Start Guide link are present in order (got ${JSON.stringify(btnLabels)})`
  );

  const actionsAfterTop = await page.evaluate(() => {
    const hero = document.querySelector(".home-hero");
    const children = Array.from(hero.children);
    const topIdx = children.findIndex((c) => c.classList.contains("home-hero-top"));
    const actionsIdx = children.findIndex((c) => c.classList.contains("home-actions"));
    return topIdx !== -1 && actionsIdx !== -1 && topIdx < actionsIdx;
  });
  check(actionsAfterTop, "the action buttons sit below the title/logo block");

  // "Enter a New Plot" -> new plot's trial-details screen.
  await page.click(".home-btn-primary");
  await page.waitForSelector(".trial-details-screen", { timeout: 5000 });
  check(true, "\"Enter a New Plot\" navigates to the new plot's Plot Details screen");

  await page.close();
}

// ---- NC+ view (mirror: blue background, NC+ logo) ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedBrandOnly(page, "ncPlus");
  await page.goto(`${BASE}/index.html?r=2#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });

  const logoAlt = await page.$eval(".home-logo", (el) => el.alt);
  check(logoAlt === "NC+", `NC+ view: logo alt matches the selected brand (got "${logoAlt}")`);

  const heroBg = await page.$eval(".home-hero", (el) => getComputedStyle(el).backgroundColor);
  check(heroBg === "rgb(33, 90, 168)", `NC+ view: Home Screen background uses NC+'s blue chrome color (got "${heroBg}")`);

  // NC+'s logo is square, so its card should stay roughly square (unlike
  // Midwest's wide-card case above) — same aspect-ratio-follows-image rule.
  const logoBox = await page.$eval(".home-logo", (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  const logoRatio = logoBox.w / logoBox.h;
  check(logoRatio > 0.85 && logoRatio < 1.15, `NC+'s logo card stays roughly square (ratio ${logoRatio.toFixed(2)}, box ${JSON.stringify(logoBox)})`);

  // "Saved Plots" -> saved plots list.
  const savedBtn = page.locator(".home-btn-secondary");
  await savedBtn.click();
  await page.waitForSelector(".saved-plots-screen", { timeout: 5000 });
  check(true, "\"Saved Plots\" navigates to the Saved Plots list");

  await page.close();
}

// ---- Crow's view: white CIRCLE behind the logo (per explicit request),
// not the white rounded-rectangle "card" every other brand uses. Unlike
// Midwest/NC+ (a plain <img class="home-logo">), Crow's renders as a
// wrapper <div class="home-logo home-logo-circle"> around an <img
// class="home-logo-circle-img"> — see plotChooser.js's homeLogo() for
// why: applying border-radius straight to the <img> (an earlier build)
// hit a browser quirk that silently clipped some of the wordmark's
// finer strokes even with plenty of geometric margin: an
// overflow:hidden wrapper avoids it, and (per explicit follow-up
// request) the circle is also noticeably bigger now with generous
// padding around the logo. ----
{
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));
  await seedBrandOnly(page, "crows");
  await page.goto(`${BASE}/index.html?r=3#/plot-chooser`);
  await page.waitForSelector(".home-screen", { timeout: 5000 });
  await page.waitForFunction(() => {
    const img = document.querySelector(".home-logo-circle-img");
    return img && img.complete && img.naturalWidth > 0;
  }, { timeout: 5000 });

  // The wrapper div (not an <img>) carries the "home-logo" class Midwest/
  // NC+ put directly on their <img> — the actual logo <img> is a child
  // with its own "home-logo-circle-img" class and the alt text.
  const wrapperTag = await page.$eval(".home-logo", (el) => el.tagName);
  check(wrapperTag === "DIV", `Crow's ".home-logo" is a wrapper <div>, not a plain <img> like Midwest/NC+ (got <${wrapperTag}>)`);

  const logoAlt = await page.$eval(".home-logo-circle-img", (el) => el.alt);
  check(logoAlt === "Crow's", `Crow's view: logo alt matches the selected brand (got "${logoAlt}")`);

  const heroBg = await page.$eval(".home-hero", (el) => getComputedStyle(el).backgroundColor);
  check(heroBg === "rgb(35, 31, 32)", `Crow's view: Home Screen background uses Crow's black chrome color (got "${heroBg}")`);

  // Unlike Midwest (wide card) and NC+ (square card), Crow's logo sits on
  // a perfect white CIRCLE — equal width/height and a fully round corner
  // radius, not the 16px rounded-rectangle every other brand gets — and
  // (per explicit follow-up request) noticeably bigger than the 116px
  // every other brand's card uses, so there's generous white margin.
  const logoBox = await page.$eval(".home-logo", (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { w: r.width, h: r.height, borderRadius: style.borderRadius, background: style.backgroundColor, overflow: style.overflow };
  });
  check(
    Math.abs(logoBox.w - logoBox.h) < 1,
    `Crow's logo box is a perfect square (equal width/height) so its circle isn't an oval (got ${JSON.stringify(logoBox)})`
  );
  check(logoBox.w > 116, `Crow's white circle is bigger than the 116px every other brand's card uses (got ${logoBox.w}px)`);
  check(
    logoBox.borderRadius === "50%",
    `Crow's logo has a fully round (50%) border-radius, making a circle not a rounded square (got "${logoBox.borderRadius}")`
  );
  check(logoBox.overflow === "hidden", `Crow's wrapper clips via overflow: hidden, not border-radius directly on the <img> (got "${logoBox.overflow}")`);
  check(logoBox.background === "rgb(255, 255, 255)", `Crow's logo's circle background is white (got "${logoBox.background}")`);

  // The inner <img>'s ACTUAL VISIBLE content (after object-fit: contain
  // letterboxes the wide rooster+wordmark artwork to fit the img's
  // square box — it doesn't fill that box's own corners) sits
  // comfortably inside the circle with real margin on every side, not
  // touching its edge. Computed from the img box plus the source
  // image's own aspect ratio, the same way the browser's object-fit
  // math works, rather than using the img element's own (square, so
  // necessarily corner-touching) box directly.
  const geometry = await page.evaluate(() => {
    const wrap = document.querySelector(".home-logo-circle").getBoundingClientRect();
    const img = document.querySelector(".home-logo-circle-img");
    const box = img.getBoundingClientRect();
    return { wrap, box, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  });
  const ratio = geometry.naturalWidth / geometry.naturalHeight;
  let contentW = geometry.box.width;
  let contentH = contentW / ratio;
  if (contentH > geometry.box.height) {
    contentH = geometry.box.height;
    contentW = contentH * ratio;
  }
  const contentX = geometry.box.x + (geometry.box.width - contentW) / 2;
  const contentY = geometry.box.y + (geometry.box.height - contentH) / 2;
  const cx = geometry.wrap.x + geometry.wrap.width / 2;
  const cy = geometry.wrap.y + geometry.wrap.height / 2;
  const radius = geometry.wrap.width / 2;
  const corners = [
    [contentX, contentY],
    [contentX + contentW, contentY],
    [contentX, contentY + contentH],
    [contentX + contentW, contentY + contentH],
  ];
  const maxCornerDist = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  check(
    maxCornerDist < radius - 3,
    `the logo's actual visible content sits with real margin inside the circle, not touching its edge (max corner distance ${maxCornerDist.toFixed(1)}px vs radius ${radius}px)`
  );

  // Primary regression guard against the actual bug: the earlier build's
  // clipping quirk was specifically about applying border-radius directly
  // to a scaled <img>'s own box. Confirming NO element with the
  // "home-logo" family of classes has both border-radius AND is itself
  // an <img> (i.e. the clip always lives on a wrapper, never the
  // replaced element being scaled) structurally rules that out, without
  // needing a flaky in-browser pixel-rasterization comparison.
  const anyImgWithRadius = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("img.home-logo, img.home-logo-circle, img[class*='home-logo']")).some(
      (img) => getComputedStyle(img).borderRadius !== "0px"
    );
  });
  check(!anyImgWithRadius, "no <img> in the home-logo family has border-radius applied directly to it (the clip always lives on a wrapper element)");

  await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
