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
  brandAveragesForDisplay,
} from "./yieldCalculator.js";
import { filenameYear } from "./models.js";
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
 * }} args
 * @returns {Promise<Blob>}
 */
export async function buildPdf({ header, results, metric, allEntries, brand, logoDataUrl }) {
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
    const titleLines = doc.splitTextToSize(
      "2026 Corn Trial Outline / Harvest Form — Ranked Results",
      titleMaxWidth
    );
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
      const cvText =
        summary.coefficientOfVariation === null
          ? "CV requires at least 2 entries"
          : `Coefficient of Variation (CV): ${summary.coefficientOfVariation.toFixed(1)}%`;
      const line = `Trial Mean: ${summary.mean.toFixed(1)} bu/ac   •   n = ${summary.sampleCount} entries   •   ${cvText}`;
      doc.text(line, MARGIN, y + 9 * 0.8);
      y += 9 * 1.15 + 6;

      // Only brands with 2+ hybrids in this plot get an average (a
      // "brand average" of one hybrid isn't meaningful); the selected
      // brand (Midwest Seed Genetics or NC+) always leads what's left —
      // same rule as the Plot Summary screen, so the two stay consistent.
      const brandsToShow = brandAveragesForDisplay(summary.byBrand, brand ? brand.displayName : null);
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
  doc.text(`Generated by Corn Plot Harvest on ${new Date().toLocaleString()}`, MARGIN, PAGE_HEIGHT - MARGIN);
  doc.setTextColor(0, 0, 0);

  return doc.output("blob");
}

/**
 * @param {import('./models.js').TrialHeader} header
 * @returns {string}
 */
export function pdfFilename(header) {
  return exportFilename(header).replace(/\.xlsx$/, "_Results.pdf");
}
