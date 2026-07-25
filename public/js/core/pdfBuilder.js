// src/core/pdfBuilder.js
//
// Port of Export/PDFReportBuilder.swift's layout using jsPDF. jsPDF is
// loaded by the HTML page via a <script> tag (UMD build), which exposes
// a global `window.jspdf.jsPDF` constructor. We reference it lazily
// (inside buildPdf) rather than importing it, since there is no bundler
// and no npm install in this sandbox.

import {
  rankingMetricMeta,
  moisture,
  dryYield,
  dryYieldSummary,
  dryYieldSignificance,
  SIGNIFICANCE_THRESHOLD_BU_AC,
  brandAveragesForDisplay,
  computeLinearTrend,
  recenterTrendLineY,
} from "./yieldCalculator.js";
import { filenameYear, harvestedYear, formatHeaderDate, gpsCellText } from "./models.js";
import { exportFilename } from "./xlsxBuilder.js";

// Same 3-color rule as the Plot Summary screen's rank badges (see
// significanceBadgeClass() in plotSummary.js / dryYieldSignificance() in
// yieldCalculator.js) — kept in sync by construction since both read the
// same "positive"/"negative"/"neutral" classification.
const SIGNIFICANCE_COLORS = {
  positive: { fill: [12, 163, 12], text: [255, 255, 255] }, // green, white numeral
  negative: { fill: [250, 178, 25], text: [26, 26, 25] }, // yellow, dark numeral
  neutral: { fill: [216, 215, 209], text: [26, 26, 25] }, // light gray, dark numeral
};

// Same 3 labels as the Plot Summary screen's on-screen legend (see
// significanceLegend in plotSummary.js) — kept in sync by construction
// since both reference SIGNIFICANCE_THRESHOLD_BU_AC.
const LEGEND_ITEMS = [
  { significance: "positive", label: `${SIGNIFICANCE_THRESHOLD_BU_AC}+ bu/ac over plot mean` },
  { significance: "negative", label: `${SIGNIFICANCE_THRESHOLD_BU_AC}+ bu/ac under plot mean` },
  { significance: "neutral", label: `Within ${SIGNIFICANCE_THRESHOLD_BU_AC} bu/ac of plot mean` },
];

// Fallback box-plot accent color when no brand is selected (matches the
// Midwest green, this app's original default accent, before NC+ existed).
const DEFAULT_BOX_PLOT_RGB = [9, 69, 44];

// Fixed colors for the two entry-position bar charts (see
// drawEntryPositionBarChart() below) — per explicit request, both now use
// one fixed color each across all 3 Brand Views instead of following the
// active brand's own accent (the Dry Yield Distribution box above them
// still does that via boxAccentRgb(); only these two bar charts changed).
// Yield uses Midwest's own `highlight` brand color (#FEBE10 — see
// BRANDS.midwestSeedGenetics.highlight in brand.js); Moisture uses NC+'s
// own `chrome` brand color (#215AA8 — see BRANDS.ncPlus.chrome in
// brand.js). Both match the on-screen .entry-bar-yield/.entry-bar-moisture
// CSS rules in styles.css.
const YIELD_BAR_RGB = [254, 190, 16];
const MOISTURE_BAR_RGB = [33, 90, 168];

/**
 * @param {string} hex e.g. "#09452C"
 * @returns {[number, number, number]}
 */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || "").trim());
  if (!m) return DEFAULT_BOX_PLOT_RGB;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 36;

const COLUMN_TITLES = ["Rank", "Entry", "Brand", "Hybrid", "Trait"];
const COLUMN_WIDTHS = [36, 40, 118, 118, 83];
const MOISTURE_COLUMN_WIDTH = 55;
const METRIC_COLUMN_WIDTH = 90;

const ROW_HEIGHT = 18;
const COMMENT_LINE_HEIGHT = 24;
const BOTTOM_LIMIT = PAGE_HEIGHT - MARGIN - 20;
const LOGO_RESERVED_WIDTH = 110;
const LOGO_MAX_HEIGHT = 40;
const LOGO_MAX_WIDTH = 100;

// The optional compact "Plot Details" header block — see the
// "Include Plot Details" prompt in plotSummary.js's handleExportPdf()/
// handlePrint(). Same field set as the Plot Summary screen's own
// expandable details recap (see detailRows in plotSummary.js) so the two
// stay consistent; blank fields are skipped here too, same as there.
/**
 * @param {import('./models.js').TrialHeader} header
 * @returns {Array<[string, string]>}
 */
function plotDetailsFields(header) {
  return [
    ["Cooperator", header.cooperatorName],
    ["Cooperator Address", header.address],
    ["City", header.city],
    ["County", header.county],
    ["Zip", header.zip],
    ["GPS", gpsCellText(header)],
    ["Date Planted", formatHeaderDate(header.datePlanted)],
    ["Date Harvested", formatHeaderDate(header.dateHarvested)],
    ["Tillage", header.tillage],
    ["Irrigation", header.irrigation],
    ["Soil Type", header.soilType],
    ["Previous Crop", header.previousCrop],
    ["Planting Population", header.plantingPopulation],
    ["Collected By", header.collectedBy],
    ["Phone", header.phone],
    ["Email", header.email],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
}

let warnedMissingJsPdf = false;

/**
 * @returns {any} the jsPDF constructor
 */
function getJsPdfCtor() {
  const ctor = typeof window !== "undefined" && window.jspdf ? window.jspdf.jsPDF : undefined;
  if (!ctor) {
    if (!warnedMissingJsPdf) {
      warnedMissingJsPdf = true;
    }
    throw new Error("PDF library not loaded — check your connection");
  }
  return ctor;
}

/**
 * @typedef {Object} RankedResult
 * @property {number} originalNumber
 * @property {import('./models.js').PlotEntry} entry
 * @property {number|null} value
 */

/**
 * @param {{
 *   header: import('./models.js').TrialHeader,
 *   results: RankedResult[],
 *   metric: string,
 *   allEntries: import('./models.js').PlotEntry[],
 *   brand: {displayName: string},
 *   logoDataUrl: string|null,
 *   includePlotDetails?: boolean,
 * }} args
 * @returns {Promise<Blob>}
 */
export async function buildPdf({ header, results, metric, allEntries, brand, logoDataUrl, includePlotDetails = false }) {
  const JsPDF = getJsPdfCtor();
  const doc = new JsPDF({ unit: "pt", format: "letter", orientation: "portrait" });

  const meta = rankingMetricMeta[metric];
  const metricDisplayName = meta.displayName;
  const showsMoistureColumn = metric !== "moisture";

  const allColumnTitles = COLUMN_TITLES.concat(
    showsMoistureColumn ? ["Moisture %"] : [],
    [metricDisplayName]
  );
  const allColumnWidths = COLUMN_WIDTHS.concat(
    showsMoistureColumn ? [MOISTURE_COLUMN_WIDTH] : [],
    [showsMoistureColumn ? METRIC_COLUMN_WIDTH : METRIC_COLUMN_WIDTH + MOISTURE_COLUMN_WIDTH]
  );

  const tableWidth = allColumnWidths.reduce((a, b) => a + b, 0);
  const summary = dryYieldSummary(allEntries);

  let y = MARGIN;
  let isFirstPage = true;

  function columnX(index) {
    let x = MARGIN;
    for (let i = 0; i < index; i++) x += allColumnWidths[i];
    return x;
  }

  // Draws a straight line as a series of short dashes — hand-rolled
  // rather than jsPDF's native setLineDash() API, so it works with the
  // exact same doc.line() primitive already used everywhere else in this
  // file (and the same mocked jsPDF test doubles elsewhere in the test
  // suite, none of which stub out setLineDash). Used by
  // drawEntryPositionBarChart()'s trendline overlay.
  function drawDashedLine(x1, y1, x2, y2, dashLen, gapLen) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return;
    const ux = dx / dist;
    const uy = dy / dist;
    let drawn = 0;
    while (drawn < dist) {
      const segEnd = Math.min(drawn + dashLen, dist);
      doc.line(x1 + ux * drawn, y1 + uy * drawn, x1 + ux * segEnd, y1 + uy * segEnd);
      drawn += dashLen + gapLen;
    }
  }

  function drawLogo() {
    if (!logoDataUrl) return;
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const aspect = props.width / props.height;
      let w = LOGO_MAX_WIDTH;
      let h = w / aspect;
      if (h > LOGO_MAX_HEIGHT) {
        h = LOGO_MAX_HEIGHT;
        w = h * aspect;
      }
      const x = MARGIN + tableWidth - w;
      doc.addImage(logoDataUrl, "PNG", x, MARGIN, w, h);
    } catch (e) {
      // If the logo fails to decode, silently omit it rather than fail export.
    }
  }

  function drawTitleAndSubtitle() {
    const titleMaxWidth = tableWidth - LOGO_RESERVED_WIDTH;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    // Starts with the year HARVESTED (not planted — see harvestedYear()'s
    // comment in models.js), per explicit request.
    const titleLines = doc.splitTextToSize(`${harvestedYear(header)} Corn Plot Outline`, titleMaxWidth);
    const titleLineHeight = 18 * 1.15;
    for (const line of titleLines) {
      doc.text(line, MARGIN, y + 18 * 0.8);
      y += titleLineHeight;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const subtitle = `${filenameYear(header)}  •  ${header.state || "—"}  •  ${
      header.county || "—"
    }  •  ${header.cooperatorName || "—"}  •  Ranked by ${metricDisplayName}`;
    y += 4;
    doc.text(subtitle, MARGIN, y + 11 * 0.8);
    y += 11 * 1.15 + 6;

    drawLogo();

    y = Math.max(y, MARGIN + LOGO_MAX_HEIGHT + 6);
  }

  // Optional compact "Plot Details" block — only drawn when the user
  // answers "Yes" to the "Include Plot Details" prompt (see
  // plotSummary.js). Deliberately terse: a bold gray section label, then
  // a 3-column grid of "Label: value" pairs at 8pt (each value clipped to
  // one line — this is a quick reference, not a full recap), so it adds
  // real content without eating much of the page the way a full copy of
  // the Plot Details screen would. 3 columns (per explicit request,
  // narrowed down from an original 2) packs more fields into fewer rows
  // — each value simply clips to a shorter line than it did at 2 columns,
  // which is an acceptable trade for a "quick reference" block. Only
  // ever called once, right after the title/subtitle on page 1 —
  // startNewPage() never calls this, so it never repeats on later pages.
  function drawPlotDetailsHeader() {
    const fields = plotDetailsFields(header);
    if (fields.length === 0) return;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, MARGIN + tableWidth, y);
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text("Plot Details", MARGIN, y + 9 * 0.8);
    doc.setTextColor(0, 0, 0);
    y += 9 * 1.15 + 4;

    const NUM_DETAIL_COLS = 3;
    const colWidth = tableWidth / NUM_DETAIL_COLS;
    const rowHeight = 8 * 1.6;
    let col = 0;
    let rowStartY = y;

    doc.setFontSize(8);
    for (const [label, rawValue] of fields) {
      const x = MARGIN + col * colWidth;
      const labelText = `${label}: `;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(90, 90, 90);
      doc.text(labelText, x, rowStartY + 8 * 0.8);
      const labelWidth = doc.getTextWidth(labelText);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(26, 26, 25);
      const maxValueWidth = Math.max(colWidth - labelWidth - 8, 20);
      const valueLines = doc.splitTextToSize(String(rawValue), maxValueWidth);
      doc.text(valueLines[0], x + labelWidth, rowStartY + 8 * 0.8);

      col += 1;
      if (col >= NUM_DETAIL_COLS) {
        col = 0;
        rowStartY += rowHeight;
      }
    }
    if (col > 0) rowStartY += rowHeight;

    doc.setTextColor(0, 0, 0);
    y = rowStartY + 6;
  }

  // Ranking-bubble color legend — same 3-color rule and label text as the
  // Plot Summary screen (see significanceLegend in plotSummary.js).
  // Drawn just above the "Trial Mean: ... CV: ..." stats line so it reads
  // right before the ranked table's colored Rank bubbles below it.
  function drawSignificanceLegend() {
    const swatchRadius = 4;
    const itemGap = 14;
    const rowHeight = 9 * 1.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    let x = MARGIN;
    let rowStartY = y;
    for (const item of LEGEND_ITEMS) {
      const colors = SIGNIFICANCE_COLORS[item.significance];
      const textWidth = doc.getTextWidth(item.label);
      const itemWidth = swatchRadius * 2 + 4 + textWidth;

      if (x + itemWidth > MARGIN + tableWidth && x > MARGIN) {
        x = MARGIN;
        rowStartY += rowHeight;
      }

      const swatchCenterY = rowStartY + 8 * 0.8 - 2.5;
      doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
      doc.circle(x + swatchRadius, swatchCenterY, swatchRadius, "F");
      doc.setTextColor(90, 90, 90);
      doc.text(item.label, x + swatchRadius * 2 + 4, rowStartY + 8 * 0.8);
      doc.setTextColor(0, 0, 0);

      x += itemWidth + itemGap;
    }

    y = rowStartY + rowHeight;
  }

  // The IQR box's own color — for NC+, that's its chrome blue (the same
  // blue already used for its top bar and Home Screen) rather than its
  // saturated red accent; every other brand (and no brand at all) just
  // uses the regular accent. Shared with drawEntryPositionBarChart()
  // below for the Yield by Entry Position bars, per explicit request that
  // they use "the same shaded color as the box in the bar and whisker
  // graph."
  function boxAccentRgb() {
    return hexToRgb(brand && brand.id === "ncPlus" ? brand.chrome : brand ? brand.accent : null);
  }

  // Horizontal box-and-whisker for the plot's Dry Yield distribution —
  // same shape/rule as the Plot Summary screen's box plot (see
  // buildBoxPlotSvg() in plotSummary.js): one hue (the selected brand's
  // accent color, falling back to the app's original green when no brand
  // is set) for the whole thing, since it's a single series. Placed just
  // above "Average Dry Yield by Brand:" in both places.
  function drawBoxPlot(boxPlot) {
    const { min, q1, median, q3, max, mean } = boxPlot;
    const range = max - min;
    const scale = (v) => (range === 0 ? MARGIN + tableWidth / 2 : MARGIN + ((v - min) / range) * tableWidth);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Dry Yield Distribution:", MARGIN, y + 9 * 0.8);
    y += 9 * 1.15 + 8;

    const chartCenterY = y + 9;
    const boxHalfHeight = 7;
    const capHalfHeight = 5;
    // Median line / mean marker keep the brand's regular accent color
    // (unchanged). The IQR box itself uses a separate color: for NC+,
    // that's its chrome blue (the same blue already used for its top bar
    // and Home Screen) rather than its saturated red accent — requested
    // specifically for the box, not the rest of the chart. Midwest's box
    // stays exactly as it was (its accent IS already this app's original
    // green, so there's nothing to change there).
    const [r, g, b] = hexToRgb(brand ? brand.accent : null);
    const [boxR, boxG, boxB] = boxAccentRgb();

    const xMin = scale(min);
    const xQ1 = scale(q1);
    const xMedian = scale(median);
    const xQ3 = scale(q3);
    const xMax = scale(max);

    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(1);
    doc.line(xMin, chartCenterY, xMax, chartCenterY);
    doc.line(xMin, chartCenterY - capHalfHeight, xMin, chartCenterY + capHalfHeight);
    doc.line(xMax, chartCenterY - capHalfHeight, xMax, chartCenterY + capHalfHeight);

    // The IQR box is filled at reduced opacity — a fully solid fill hid the
    // median line (drawn in the same brand color) inside it, making the box
    // look like one undivided block instead of the two quartiles (Q1–median,
    // median–Q3) it actually represents. Fill translucent, then stroke the
    // outline and median at full opacity so all four quadrants (lower
    // whisker, Q1–median, median–Q3, upper whisker) read clearly.
    const boxW = Math.max(xQ3 - xQ1, 1);
    doc.saveGraphicsState();
    doc.setGState(doc.GState({ opacity: 0.35 }));
    doc.setFillColor(boxR, boxG, boxB);
    doc.rect(xQ1, chartCenterY - boxHalfHeight, boxW, boxHalfHeight * 2, "F");
    doc.restoreGraphicsState();

    doc.setDrawColor(boxR, boxG, boxB);
    doc.setLineWidth(1.2);
    doc.rect(xQ1, chartCenterY - boxHalfHeight, boxW, boxHalfHeight * 2, "D");

    // Back to the regular accent color for the median line — see the
    // comment above drawBoxPlot's color setup for why this can differ
    // from the box's own color.
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(1.8);
    doc.line(xMedian, chartCenterY - boxHalfHeight, xMedian, chartCenterY + boxHalfHeight);

    // Mean marker — a small hollow circle, a different shape (not just a
    // color) so it reads distinctly from the median line — only drawn
    // when it wouldn't just sit on top of the median.
    if (Math.abs(mean - median) > Math.max(0.05, range * 0.01)) {
      const xMean = scale(mean);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(r, g, b);
      doc.circle(xMean, chartCenterY, 3, "FD");
    }

    doc.setDrawColor(0, 0, 0);
    y = chartCenterY + boxHalfHeight + 10;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    const caption = `Min ${min.toFixed(1)}  •  Q1 ${q1.toFixed(1)}  •  Median ${median.toFixed(1)}  •  Q3 ${q3.toFixed(
      1
    )}  •  Max ${max.toFixed(1)} bu/ac`;
    // Centered under the chart (matches the Plot Summary screen's own
    // .box-plot-caption, which is already centered via CSS) rather than
    // left-justified at the margin — per explicit request.
    doc.text(caption, MARGIN + tableWidth / 2, y, { align: "center" });
    doc.setTextColor(0, 0, 0);
    y += 8 * 1.3 + 6;
  }

  // A zero-baseline vertical bar chart, one bar per entry, in the
  // entries' ORIGINAL plot position (left-to-right = first-to-last
  // planted) — never re-sorted by rank/value, so it shows the trend from
  // one end of the physical plot to the other. Drawn as its own box
  // (title, chart, caption), the same visual treatment as
  // drawBoxPlot()'s "Dry Yield Distribution" box just above it — per
  // explicit request: on the export/print/share PDF only (the Plot
  // Summary screen itself keeps its original single box-and-whisker
  // chart, unchanged; it gets its own separate full-width cards instead
  // — see buildEntryPositionCard() in plotSummary.js). Entries with no
  // value for `valueFn` keep their x-slot (so every other bar's position
  // stays meaningful) but simply draw no bar there.
  //
  // Takes an explicit (x, width, startY) rather than reading/writing the
  // shared `y` directly, so the caller can draw two of these SIDE BY
  // SIDE (per explicit request, to use less vertical space) instead of
  // stacked — each instance is self-contained and returns the y just
  // below its own caption; the caller takes the max of both before
  // continuing.
  // @param {number} startY
  // @param {number} x
  // @param {number} width
  // @param {import('./models.js').PlotEntry[]} entries
  // @param {(entry: import('./models.js').PlotEntry) => number|null} valueFn
  // @param {string} title
  // @param {[number, number, number]} barRgb
  // @param {(v: number) => string} formatValue
  // @returns {number} the y position just below this chart's caption
  function drawEntryPositionBarChart(startY, x, width, entries, valueFn, title, barRgb, formatValue) {
    let localY = startY;
    const n = entries.length;
    const values = entries.map((entry) => valueFn(entry));
    const numeric = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${title}:`, x, localY + 9 * 0.8);
    localY += 9 * 1.15 + 8;

    if (numeric.length === 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text("No data yet.", x, localY + 8 * 0.8);
      doc.setTextColor(0, 0, 0);
      return localY + 8 * 1.3 + 6;
    }

    // Zero-baseline, honest magnitude encoding (never truncated) — a
    // touch of headroom above the tallest bar so it doesn't touch the
    // chart's own title line above it.
    const maxValue = Math.max(...numeric, 0);
    const domainMax = maxValue > 0 ? maxValue * 1.08 : 1;

    const chartTop = localY; // captured before localY moves on below — clamps the trendline to this chart's own plot area
    const chartH = 46;
    const gap = 2;
    const barW = Math.max((width - (n - 1) * gap) / n, 1);
    const baselineY = localY + chartH;

    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(1);
    doc.line(x, baselineY, x + width, baselineY);

    doc.setFillColor(barRgb[0], barRgb[1], barRgb[2]);
    values.forEach((v, i) => {
      if (v === null || v === undefined || Number.isNaN(v)) return;
      const barH = (v / domainMax) * chartH;
      const barX = x + i * (barW + gap);
      doc.rect(barX, baselineY - barH, barW, Math.max(barH, 0.5), "F");
    });

    // Least-squares trendline overlay (see computeLinearTrend() in
    // yieldCalculator.js, shared with the Plot Summary screen's own
    // version of this chart) — a neutral ink color (not the bar's own
    // hue) and hand-dashed (see drawDashedLine()) so it reads as a
    // statistical overlay on top of the bars rather than a 3rd data
    // series. Recentered to the vertical middle of the chart (see
    // recenterTrendLineY()) rather than drawn at the actual regression
    // height — per explicit follow-up request, since real yield/moisture
    // values sit high in a zero-baseline chart and crowded the line up
    // against the bar tops, hard to see. The tilt/steepness is preserved
    // exactly; only its position moves.
    const trend = computeLinearTrend(entries, valueFn);
    if (trend) {
      const rawYFirst = baselineY - ((trend.slope * 1 + trend.intercept) / domainMax) * chartH;
      const rawYLast = baselineY - ((trend.slope * n + trend.intercept) / domainMax) * chartH;
      const xFirst = x + barW / 2;
      const xLast = x + (n - 1) * (barW + gap) + barW / 2;
      const { yFirst, yLast } = recenterTrendLineY(rawYFirst, rawYLast, chartTop, baselineY);
      doc.setDrawColor(26, 26, 25);
      doc.setLineWidth(1.25);
      drawDashedLine(xFirst, yFirst, xLast, yLast, 4, 3);
      doc.setDrawColor(0, 0, 0);
    }

    // Every bar gets its own position-number label below it — per
    // explicit request, no thinning/skipping even when there are a lot
    // of entries (an earlier build thinned these out to avoid crowding;
    // that's no longer what's wanted here).
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(120, 120, 120);
    values.forEach((v, i) => {
      const labelX = x + i * (barW + gap) + barW / 2;
      doc.text(String(i + 1), labelX, baselineY + 8, { align: "center" });
    });
    doc.setTextColor(0, 0, 0);

    // A bit more breathing room between the position-number row and the
    // Low/High caption below it than the box plot's own caption gets —
    // per explicit request (was baselineY + 14, tight enough that the
    // two lines almost ran together).
    localY = baselineY + 20;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    const caption = `Low ${formatValue(Math.min(...numeric))}  •  High ${formatValue(Math.max(...numeric))}`;
    // Centered under this chart's own column (matches the Plot Summary
    // screen's .box-plot-caption, already centered via CSS) rather than
    // left-justified — per explicit request.
    doc.text(caption, x + width / 2, localY, { align: "center" });
    doc.setTextColor(0, 0, 0);
    localY += 8 * 1.3;

    // Trend caption + honest caveat — per a later explicit follow-up
    // request to show whether there's variability from first entry to
    // last. See computeLinearTrend()'s own comment in yieldCalculator.js
    // for why this can't cleanly separate genetic differences between
    // hybrids from actual field/soil variability: these entries are
    // different, non-replicated hybrids, not a repeated check planted at
    // intervals, so the trend is presented as descriptive rather than a
    // controlled measurement.
    if (trend) {
      // Same font/weight/color as the Low/High caption right above it
      // (helvetica normal, 8pt, [90,90,90]) — per explicit request, so
      // the two captions read as one consistent style rather than the
      // trend line looking like a different kind of label.
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(90, 90, 90);
      const sign = trend.slope >= 0 ? "+" : "−";
      const trendCaption = `Trend: ${sign}${formatValue(Math.abs(trend.slope))} per entry (R² ${trend.r2.toFixed(2)})`;
      doc.text(trendCaption, x + width / 2, localY, { align: "center" });
      doc.setTextColor(0, 0, 0);
      localY += 8 * 1.3;

      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 120);
      const disclaimerLines = doc.splitTextToSize(
        "Reflects hybrid differences as well as field variation — not a pure soil measurement.",
        width
      );
      for (const line of disclaimerLines) {
        doc.text(line, x + width / 2, localY, { align: "center" });
        localY += 6.5 * 1.3;
      }
      doc.setTextColor(0, 0, 0);
    }

    return localY + 6;
  }

  function drawSummaryBlock() {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Trial Summary — Dry Yield", MARGIN, y + 12 * 0.8);
    y += 12 * 1.15 + 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (summary.mean === null) {
      doc.setTextColor(120, 120, 120);
      doc.text("No entries with complete data yet...", MARGIN, y + 9 * 0.8);
      doc.setTextColor(0, 0, 0);
      y += 9 * 1.15 + 6;
    } else {
      drawSignificanceLegend();

      const cvText =
        summary.coefficientOfVariation === null
          ? "CV requires at least 2 entries"
          : `Coefficient of Variation (CV): ${summary.coefficientOfVariation.toFixed(1)}%`;
      const line = `Trial Mean: ${summary.mean.toFixed(1)} bu/ac   •   n = ${summary.sampleCount} entries   •   ${cvText}`;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(line, MARGIN, y + 9 * 0.8);
      y += 9 * 1.15 + 6;

      if (summary.boxPlot) {
        drawBoxPlot(summary.boxPlot);
        // Per explicit request, these two entry-position bar charts are
        // PDF/print/share-only — the Plot Summary screen itself gets its
        // own separate full-width cards instead (see
        // buildEntryPositionCard() in plotSummary.js). Gated on the same
        // summary.boxPlot check as the box plot above (there's no point
        // drawing an entry-position chart when there isn't even enough
        // data for a distribution chart). Side by side (not stacked) —
        // per explicit request, to use less vertical space — so both
        // start at the same y and the block only advances past whichever
        // one ends up taller.
        // The moisture chart is skipped entirely when the plot has no
        // moisture readings at all (e.g. manual dry yields only) — per
        // explicit request, no empty "No data yet." box. Same rule as
        // the Plot Summary screen's own Moisture by Position card (see
        // hasAnyMoisture in plotSummary.js's render()). When it's
        // skipped, the yield chart takes the full table width by itself
        // instead of sitting alone in a half-width left column.
        const hasAnyMoisture = allEntries.some((entry) => moisture(entry) !== null);
        const entryChartGap = 16;
        const entryChartColWidth = hasAnyMoisture ? (tableWidth - entryChartGap) / 2 : tableWidth;
        const yieldChartEndY = drawEntryPositionBarChart(
          y,
          MARGIN,
          entryChartColWidth,
          allEntries,
          dryYield,
          "Yield by Entry Position",
          YIELD_BAR_RGB,
          (v) => `${v.toFixed(1)} bu/ac`
        );
        const moistureChartEndY = hasAnyMoisture
          ? drawEntryPositionBarChart(
              y,
              MARGIN + entryChartColWidth + entryChartGap,
              entryChartColWidth,
              allEntries,
              moisture,
              "Moisture by Entry Position",
              MOISTURE_BAR_RGB,
              (v) => `${v.toFixed(1)}%`
            )
          : y;
        y = Math.max(yieldChartEndY, moistureChartEndY);
      }

      // Only brands with 2+ hybrids in this plot get an average (a
      // "brand average" of one hybrid isn't meaningful); the selected
      // brand (Midwest Seed Genetics or NC+) always leads what's left —
      // same rule as the Plot Summary screen, so the two stay consistent.
      // catalogBrandName, not displayName — see the matching comment in
      // plotSummary.js's byBrandOrdered for why (NC+'s catalog entry is
      // "NC+ Hybrids", not the shorter cosmetic "NC+").
      const brandsToShow = brandAveragesForDisplay(summary.byBrand, brand ? brand.catalogBrandName : null);
      if (brandsToShow.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text("Average Dry Yield by Brand:", MARGIN, y + 9 * 0.8);
        y += 9 * 1.15 + 4;

        const brandLineHeight = 9 * 1.3;
        for (const b of brandsToShow) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.text(`${b.brand}: ${b.average.toFixed(1)} bu/ac (n=${b.count})`, MARGIN, y + 9 * 0.8);
          y += brandLineHeight;
        }
        y += 3;
      }
    }

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, MARGIN + tableWidth, y);
    y += 10;
  }

  function drawTableHeader() {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    for (let i = 0; i < allColumnTitles.length; i++) {
      doc.text(allColumnTitles[i], columnX(i), y + 10 * 0.8);
    }
    y += 10 * 1.15 + 4;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, y, MARGIN + tableWidth, y);
    y += 6;
  }

  function startNewPage() {
    doc.addPage();
    y = MARGIN;
    isFirstPage = false;
    drawTitleAndSubtitle();
    drawTableHeader();
  }

  drawTitleAndSubtitle();
  if (includePlotDetails) drawPlotDetailsHeader();
  drawSummaryBlock();
  drawTableHeader();

  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx];
    const comment = (result.entry.comments || "").trim();
    const neededHeight = ROW_HEIGHT + (comment ? COMMENT_LINE_HEIGHT : 0);

    if (y + neededHeight > BOTTOM_LIMIT) {
      startNewPage();
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const moistureValue = moisture(result.entry);
    const moistureText =
      moistureValue === null || moistureValue === undefined ? "—" : `${moistureValue.toFixed(1)}%`;

    const cellValues = [
      String(result.originalNumber),
      result.entry.brand || "",
      result.entry.hybrid || "",
      result.entry.trait || "",
    ];
    if (showsMoistureColumn) cellValues.push(moistureText);
    cellValues.push(meta.formatValue(result.value));

    // Rank badge: a colored circle (same green/yellow/light-gray rule as
    // the Plot Summary screen's rank badges) with the rank number on top,
    // instead of plain text, in the Rank column.
    const significance = dryYieldSignificance(result.entry, summary);
    const colors = SIGNIFICANCE_COLORS[significance] || SIGNIFICANCE_COLORS.neutral;
    const badgeRadius = 8;
    const badgeCenterX = columnX(0) + badgeRadius + 2;
    const badgeCenterY = y + 10 * 0.8 - 3;
    doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
    doc.circle(badgeCenterX, badgeCenterY, badgeRadius, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
    doc.text(String(idx + 1), badgeCenterX, badgeCenterY + 3, { align: "center" });
    doc.setTextColor(0, 0, 0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (let i = 0; i < cellValues.length; i++) {
      if (i === 3) continue; // Trait — drawn separately below (may shrink/wrap)
      doc.text(cellValues[i], columnX(i + 1), y + 10 * 0.8);
    }

    // Trait cell: normally a single 10pt line like every other cell, but
    // a long trait name (e.g. "Drought Gard VT2PRO RIB") used to overflow
    // its 83pt column and run into the Moisture % value next to it — per
    // explicit request, when it doesn't fit at the normal size it drops
    // to a smaller font and wraps onto up to 2 lines inside the same row
    // instead. Measured at the normal 10pt size (getTextWidth reads the
    // current font), with a small right gap so even a full-width line
    // never touches the next column.
    const traitText = cellValues[3];
    const traitMaxWidth = COLUMN_WIDTHS[4] - 6;
    if (doc.getTextWidth(traitText) <= traitMaxWidth) {
      doc.text(traitText, columnX(4), y + 10 * 0.8);
    } else {
      doc.setFontSize(7.5);
      const traitLines = doc.splitTextToSize(traitText, traitMaxWidth).slice(0, 2);
      traitLines.forEach((line, li) => {
        doc.text(line, columnX(4), y + 6.5 + li * 8);
      });
      doc.setFontSize(10);
    }
    y += ROW_HEIGHT;

    if (comment) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(`Comment: ${comment}`, columnX(1), y + 9 * 0.8);
      doc.setTextColor(0, 0, 0);
      y += COMMENT_LINE_HEIGHT;
    }
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated by Republic Regional Seed Network on ${new Date().toLocaleString()}`, MARGIN, PAGE_HEIGHT - MARGIN);

  // Form ID — lower-right footer, same row as the "Generated by..." note
  // on the left (see core/formId.js's top comment for what this
  // identifier is and how it's assigned). Omitted entirely for a plot
  // that doesn't have one yet (offline on its first export — see
  // ui/formIdAssign.js) rather than printing a blank/placeholder label.
  if (header.formId) {
    doc.text(`Form ID: ${header.formId}`, MARGIN + tableWidth, PAGE_HEIGHT - MARGIN, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);

  return doc.output("blob");
}

/**
 * Once a Form ID is assigned, the PDF's filename is just the code itself
 * — "26-1001.pdf" — matching the xlsx export exactly (see
 * xlsxBuilder.js's exportFilename()), per explicit request. Falls back
 * to the original State_Year_Cooperator_Results.pdf scheme for a plot
 * that doesn't have a Form ID yet, same as exportFilename()'s own fallback.
 * @param {import('./models.js').TrialHeader} header
 * @returns {string}
 */
export function pdfFilename(header) {
  if (header.formId) return `${header.formId}.pdf`;
  return exportFilename(header).replace(/\.xlsx$/, "_Results.pdf");
}
