// src/ui/screens/plotSummaryHelp.js
//
// A focused "how do I read this screen" guide for Plot Summary & Results
// specifically — reachable via the "i" info icon plotSummary.js adds to
// its own top bar (next to the Settings gear). The main Help guide (help.js)
// already covers this screen at a summary level as part of the whole
// app; this screen goes deeper on the same handful of things people
// actually get confused by looking at a results screen for the first
// time: what the metric tabs rank by, what Trial Mean/CV mean,
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
    // A round trip back to wherever Plot Summary was actually opened
    // from (Workspace menu, a Saved Plots row, etc.) — not a new arrival
    // there — so this doesn't clobber the real remembered origin with
    // "plot-summary-help" every time someone taps the "i" icon and comes
    // straight back. See router.js's top comment.
    onBack: () => navigate("plot-summary", { _skipOriginTracking: true }),
    backLabel: "Plot Summary",
  });

  const intro = h("div", { className: "card help-intro-card" }, [
    p("A quick explanation of everything on the Plot Summary & Results screen — what each number means and how to read the chart."),
  ]);

  const sections = [
    helpSection(
      "The Dry Yield / Gross Tabs",
      [
        p("The two buttons near the top re-rank the whole list by a different number — the hybrids don't change, just the order and which value is shown on the right of each row:"),
        ul([
          "Dry Yield — bushels per acre, adjusted to a standard moisture level so every hybrid is compared fairly. Highest first.",
          "Gross — the estimated dollar value per acre (Dry Yield × your Price per Bushel, with a deduction if that entry's moisture came in above your plot's base moisture — see Yield Calculation on Plot Details). Highest first.",
        ]),
        p("Every row also shows that hybrid's Moisture reading underneath, no matter which tab you're on — it just isn't something you can re-sort the whole list by."),
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

    helpSection("The Yield & Moisture by Position Charts", [
      p("These two bar charts show your plot in PLANTING ORDER — one bar per entry, position 1 on the left through your last entry on the right, exactly as they sit in the field. The gold chart is each entry's Dry Yield; the blue chart is its Moisture reading. An entry missing that measurement keeps its numbered slot but shows no bar, and if no entries have a moisture reading at all, the moisture chart is left out entirely."),
      p("A check mark in place of a position number under a bar means that hybrid is entered at more than one position in this plot — a repeated \"check\" hybrid (its rows in Ranked Results say \"Check\" instead of \"Entry\" too). Checks are recognized automatically: enter the same hybrid at two or more positions — both ends plus the middle is the classic layout — and the marks appear on both charts on their own."),
      p("What to expect from your checks: those bars share the same genetics, so differences BETWEEN them are almost purely the field talking. Checks that land close together say the ground is even — the differences between your other hybrids are then believable as genetics. Checks that spread apart MEASURE the position effect directly: say your checks read 250, 238, and 224 across the plot, that's roughly a 26 bu/ac end-to-end field swing — lean on the CV and mentally handicap hybrids sitting on the poor end. Checks also calibrate the trend line: when they drift about as much as the dashed line slopes, the trend really is the field; when they stay flat but the line slopes anyway, the slope is mostly genetics and can be discounted. The same reading applies to the moisture chart's checks (drying conditions across the plot)."),
      p("Where the ranked list tells you WHICH hybrids won, these charts tell you WHERE the results happened — so a run of tall bars at one end of the plot, or moisture climbing steadily from one side to the other, jumps out in a way a sorted list can't show."),
      p("The dashed line across each chart is the trend line — a statistical best-fit through all the bars, showing the overall drift from the first entry to the last. Its caption reads like “Trend: +0.7 bu/ac per entry (R² 0.20)”:"),
      ul([
        "The +/- number is the average change per entry position — for example, +0.7 bu/ac per entry over 16 entries means roughly an 11 bu/ac climb from one end of the plot to the other.",
        "R² (0 to 1) is how tightly the bars actually follow that line. Near 1, the drift is strong and steady; near 0, the line is barely a pattern at all and individual hybrids explain most of what you see.",
        "Only the line's TILT and direction carry meaning — it's drawn across the middle of the chart for visibility, so its height above the baseline doesn't represent a value.",
      ]),
      p("What a trend implies: a clear slope (steeper line, higher R²) suggests something about the field itself — soil, drainage, compaction, planting conditions — changed from one end of the plot to the other, which means position, not just genetics, influenced the results. That's a reason to lean on the CV and read close rankings a little more cautiously."),
      p("The honest caveat printed under each chart: every position holds a DIFFERENT hybrid, not a repeated check, so the trend can't fully separate field variation from the genetics of whichever hybrids happen to sit at each end. Treat it as a useful flag about the plot ground, not a soil measurement. The trend line needs at least 3 entries with data before it's drawn at all."),
    ]),

    helpSection("Average By Brand", [
      p("When two or more hybrids from the same brand are entered in this plot, you'll see an average for that brand — a single-hybrid brand doesn't get an average of its own, since averaging one number isn't meaningful."),
      p("Your own selected Brand View (Midwest Seed Genetics, NC+, or Crow's) is always listed first, regardless of how its average actually compares to the others — every other brand present follows in order by average."),
      p("Midwest Seed Genetics, NC+, and Crow's share the same underlying hybrids under three different names — so whichever of the three is your current Brand View, entries from the other two display (and average in) under YOUR brand's name, and a hybrid's brand-code prefix (MW/NC/CR) switches to match too. For example, \"NC 09-90 PCE\" shows here as \"MW 09-90 PCE\" when Midwest is your Brand View. This is just how it displays here and in PDF exports — your actual saved data always keeps the real brand and hybrid name you entered."),
    ]),

    helpSection("The Colored Rank Badges", [
      p("Every hybrid in the Ranked Results list gets a numbered circle badge, and that badge's color tells you how it actually performed against this specific plot's average Dry Yield — not just where it landed in the ranking:"),
      ul([
        "Green — this hybrid came in 8 or more bu/ac ABOVE the plot's average. A standout in this plot.",
        "Yellow — this hybrid came in 8 or more bu/ac BELOW the plot's average. Worth a second look.",
        "Gray — within 8 bu/ac of the plot's average either way — a fairly typical result for this plot.",
      ]),
      p("Because this color is based on actual yield versus the plot average — not rank position — a hybrid keeps the same badge color no matter which tab (Dry Yield or Gross) you're viewing. It's always describing the same thing: how that hybrid's Dry Yield compares to the rest of this plot."),
      p("Below the moisture percentage on each row, any Comments typed in for that hybrid on the Plot Hybrids screen show up here too, so you don't have to go back and forth to see them."),
      p("This same colored-badge layout is used across all 3 Brand Views (Midwest Seed Genetics, NC+, and Crow's) and in every share option (PDF, print, etc.) — nothing about it changes based on your selected Brand View."),
    ]),

    helpSection("Sharing These Results", [
      p("Once everything looks right, tap “Share This Plot” at the bottom of this screen for a printable PDF, the full spreadsheet, printing, or emailing your results — see Settings → Help for the full walkthrough of those options."),
      p("Fastest option: the share icon at the very top of this screen (next to the “i”) sends the full PDF summary in one tap — straight to your share sheet, Plot Details always included, no questions asked. A PDF opens easily for everyone (iPhone, Android, or computer, using each device's built-in viewer) and travels through a group text as a proper file attachment, so it never gets blurred the way texted pictures can be. It's named after the cooperator and year — like “Larson Family Farms_2026_Corn Plot.pdf” — so it's easy to spot in a thread."),
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
