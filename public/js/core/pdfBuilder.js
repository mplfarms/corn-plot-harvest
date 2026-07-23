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
  dryYieldSummary,
  dryYieldSignificance,
  SIGNIFICANCE_THRESHOLD_BU_AC,
  brandAveragesForDisplay,
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
  // a 2-column grid of "Label: value" pairs at 8pt (each value clipped to
  // one line — this is a quick reference, not a full recap), so it adds
  // real content without eating much of the page the way a full copy of
  // the Plot Details screen would. Only ever called once, right after the
  // title/subtitle on page 1 — startNewPage() never calls this, so it
  // never repeats on later pages.
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

    const colWidth = tableWidth / 2;
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
      if (col > 1) {
        col = 0;
        rowStartY += rowHeight;
      }
    }
    if (col === 1) rowStartY += rowHeight;

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
    const [boxR, boxG, boxB] = hexToRgb(brand && brand.id === "ncPlus" ? brand.chrome : brand ? brand.accent : null);

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
    doc.text(caption, MARGIN, y);
    doc.setTextColor(0, 0, 0);
    y += 8 * 1.3 + 6;
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

      if (summary.boxPlot) drawBoxPlot(summary.boxPlot);

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
      doc.text(cellValues[i], columnX(i + 1), y + 10 * 0.8);
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
