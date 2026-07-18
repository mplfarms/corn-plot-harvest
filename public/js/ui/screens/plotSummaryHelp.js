// src/ui/screens/plotSummaryHelp.js
//
// A focused "how do I read this screen" guide for Plot Summary & Results
// specifically — reachable via the "i" info icon plotSummary.js adds to
// its own top bar (next to the Settings gear). The main Help guide (help.js)
// already covers this screen at a summary level as part of the whole
// app; this screen goes deeper on the same handful of things people
// actually get confused by looking at a results screen for the first
// time: what the three metric tabs rank by, what Trial Mean/CV mean,
// how to read the box-and-whisker chart, and what the colored rank
// badges mean. Built with the same <details>/<summary> accordion
// pattern as help.js (see helpSection() there) for a consistent feel,
// reusing its exact CSS classes (help-section/help-p/help-list/etc.)
// rather than duplicating them.
//
// Written in plain, non-technical language throughout, same as the rest
// of this app's help content — see help.js's top comment.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { navigate } from "../router.js";

function p(text) {
  return h("p", { className: "help-p" }, text);
}

function ul(items) {
  return h(
    "ul",
    { className: "help-list" },
    items.map((item) => h("li", {}, item))
  );
}

function helpSection(title, children, opts) {
  return h(
    "details",
    { className: "help-section", open: Boolean(opts && opts.open) },
    [h("summary", { className: "help-section-title" }, title), h("div", { className: "help-section-body" }, children)]
  );
}

export function render(container) {
  const topBar = createTopBar({
    title: "Reading Your Results",
    onBack: () => navigate("plot-summary"),
    backLabel: "Plot Summary",
  });

  const intro = h("div", { className: "card help-intro-card" }, [
    p("A quick explanation of everything on the Plot Summary & Results screen — what each number means and how to read the chart."),
  ]);

  const sections = [
    helpSection(
      "The Dry Yield / Gross / Moisture Tabs",
      [
        p("The three buttons near the top re-rank the whole list by a different number — the hybrids don't change, just the order and which value is shown on the right of each row:"),
        ul([
          "Dry Yield — bushels per acre, adjusted to a standard moisture level so every hybrid is compared fairly. Highest first.",
          "Gross — the estimated dollar value per acre (Dry Yield × your Price per Bushel, with a deduction if that entry's moisture came in above your plot's base moisture — see Yield Calculation on Plot Details). Highest first.",
          "Moisture — the moisture percentage measured at harvest. Lowest (driest) first.",
        ]),
        p("Whichever tab is selected, the same rank badge colors apply — see “The Colored Rank Badges” below."),
      ],
      { open: true }
    ),

    helpSection("Trial Mean, CV, and Entries", [
      p("Trial Mean is the plot's average Dry Yield across every entry that has a complete, usable number — this is the number every individual hybrid gets compared against for its rank badge color."),
      p("Entries is simply how many hybrids have a complete enough Dry Yield to be counted — an entry missing required measurements (and with nothing typed into Dry Yield directly) won't factor into the Mean, CV, or box plot, though it still shows up at the bottom of the Ranked Results list."),
      p("CV (Coefficient of Variation) shows how spread out the results are, as a percentage of the mean. A lower CV means the hybrids in this plot performed close together; a higher CV means bigger swings between your best and worst performers. It needs at least 2 entries with a Dry Yield to calculate at all."),
      p("As a rule of thumb, a CV under about 10% points to a clean, consistent plot — the field itself stayed even, so the differences between hybrids are more likely to be real and worth trusting. A noticeably higher CV means more variability crept in somewhere (soil, drainage, planting, and so on), so treat the rankings with a bit more caution rather than reading every spot as purely hybrid performance."),
    ]),

    helpSection("The Dry Yield Distribution Chart (Box & Whisker)", [
      p("This small horizontal chart shows the full spread of this plot's Dry Yield results at a glance, without having to read every number individually. Here's how to read it, left (lowest) to right (highest):"),
      ul([
        "The thin line stretching all the way across, with a short cap at each end, is the whisker — it spans from your single lowest result to your single highest.",
        "The solid box in the middle covers the middle half of your results (technically, the 25th to 75th percentile) — a short, narrow box means most of your hybrids landed close together; a long box means more spread even among the “typical” results.",
        "The line through the middle of the box is the median — the exact middle value if you lined up every result from lowest to highest (not the same as the average when results are uneven).",
        "A small diamond, when you see one, marks the mean (average) — it's only shown separately when it lands somewhere different enough from the median to be worth pointing out; if the two are close, only the median line shows.",
      ]),
      p("Put simply: the shorter and narrower this whole shape is, the more consistently your hybrids performed against each other in this plot. A long whisker or wide box just means bigger differences between your best and worst — worth knowing, not necessarily a problem."),
    ]),

    helpSection("Average By Brand", [
      p("When two or more hybrids from the same brand are entered in this plot, you'll see an average for that brand — a single-hybrid brand doesn't get an average of its own, since averaging one number isn't meaningful."),
      p("Your own selected Brand View (Midwest Seed Genetics or NC+) is always listed first, regardless of how its average actually compares to the others — every other brand present follows in order by average."),
    ]),

    helpSection("The Colored Rank Badges", [
      p("Every hybrid in the Ranked Results list gets a numbered circle badge, and that badge's color tells you how it actually performed against this specific plot's average Dry Yield — not just where it landed in the ranking:"),
      ul([
        "Green — this hybrid came in 8 or more bu/ac ABOVE the plot's average. A standout in this plot.",
        "Yellow — this hybrid came in 8 or more bu/ac BELOW the plot's average. Worth a second look.",
        "Gray — within 8 bu/ac of the plot's average either way — a fairly typical result for this plot.",
      ]),
      p("Because this color is based on actual yield versus the plot average — not rank position — a hybrid keeps the same badge color no matter which of the three tabs (Dry Yield/Gross/Moisture) you're viewing. It's always describing the same thing: how that hybrid's Dry Yield compares to the rest of this plot."),
      p("Below the moisture percentage on each row, any Comments typed in for that hybrid on the Plot Hybrids screen show up here too, so you don't have to go back and forth to see them."),
    ]),

    helpSection("Sharing These Results", [
      p("Once everything looks right, tap “Share This Plot” at the bottom of this screen for a printable PDF, the full spreadsheet, printing, or emailing your results — see Settings → Help for the full walkthrough of those options."),
    ]),
  ];

  const backToHelpNote = h("p", { className: "field-note quick-start-more-help" }, [
    "Looking for something about a different part of the app? Open ",
    h("strong", {}, "Settings → Help"),
    " for the full guide.",
  ]);

  const screen = h("div", { className: "screen plot-summary-help-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      h("h2", { className: "screen-heading" }, "Reading Your Results"),
      intro,
      ...sections,
      backToHelpNote,
    ]),
  ]);

  mount(container, screen);
}
