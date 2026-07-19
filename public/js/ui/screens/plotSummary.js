// src/ui/screens/plotSummary.js
//
// Segmented Dry Yield/Gross/Moisture control, header card, Dry Yield
// Summary card, Ranked Results list, and a toolbar share menu with the
// 4 export/share/print/email actions.

import { h, mount } from "../dom.js";
import { getBrand, entriesForBrandView } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as trialStore from "../stores/trialStore.js";
import * as listsStore from "../stores/listsStore.js";
import * as adminEditStore from "../stores/adminEditStore.js";
import { createTopBar } from "../components/topBar.js";
import { showToast } from "../components/toast.js";
import { showCustomModal } from "../components/modal.js";
import { navigate } from "../router.js";
import { filenameYear } from "../../core/models.js";
import {
  RankingMetric,
  rankingMetricMeta,
  valueForMetric,
  moisture,
  dryYieldSummary,
  dryYieldSignificance,
  SIGNIFICANCE_THRESHOLD_BU_AC,
  brandAveragesForDisplay,
} from "../../core/yieldCalculator.js";
import { buildPdf, pdfFilename } from "../../core/pdfBuilder.js";
import { buildXlsx, createEffectiveLists } from "../../core/xlsxBuilder.js";
import { getLogoDataUrl } from "../logoCache.js";
import { downloadBlob, shareOrDownload, openMailto } from "../fileSave.js";

const METRIC_ORDER = [RankingMetric.DRY_YIELD, RankingMetric.GROSS, RankingMetric.MOISTURE];

const SVG_NS = "http://www.w3.org/2000/svg";
const BOX_PLOT_VIEW_W = 320;
const BOX_PLOT_VIEW_H = 56;
const BOX_PLOT_PAD_X = 16;
const BOX_PLOT_HEIGHT = 22;
const BOX_PLOT_CAP_HEIGHT = 12;

/**
 * Builds a horizontal box-and-whisker SVG for the plot's Dry Yield
 * distribution (min / Q1 / median / Q3 / max, plus a small diamond
 * marker for the mean when it's visually distinguishable from the
 * median). One series, so one hue (the app's own accent color) does the
 * whole job — no categorical palette needed; the whisker/caps use a
 * muted neutral so the box (the actual IQR) reads as the focal shape.
 * @param {import('../../core/yieldCalculator.js').BoxPlotStats} boxPlot
 * @returns {SVGSVGElement}
 */
function buildBoxPlotSvg(boxPlot) {
  const { min, q1, median, q3, max, mean } = boxPlot;
  const trackW = BOX_PLOT_VIEW_W - BOX_PLOT_PAD_X * 2;
  const range = max - min;
  // A zero-width range (every entry has the identical dry yield) would
  // divide by zero — fall back to centering everything instead.
  const scale = (v) => (range === 0 ? BOX_PLOT_PAD_X + trackW / 2 : BOX_PLOT_PAD_X + ((v - min) / range) * trackW);
  const midY = BOX_PLOT_VIEW_H / 2;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${BOX_PLOT_VIEW_W} ${BOX_PLOT_VIEW_H}`);
  svg.setAttribute("class", "box-plot-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Dry yield distribution: minimum ${min.toFixed(1)}, first quartile ${q1.toFixed(1)}, median ${median.toFixed(
      1
    )}, third quartile ${q3.toFixed(1)}, maximum ${max.toFixed(1)} bushels per acre`
  );

  function line(x1, y1, x2, y2, extraClass) {
    const el = document.createElementNS(SVG_NS, "line");
    el.setAttribute("x1", x1);
    el.setAttribute("y1", y1);
    el.setAttribute("x2", x2);
    el.setAttribute("y2", y2);
    el.setAttribute("class", "box-plot-line" + (extraClass ? " " + extraClass : ""));
    svg.appendChild(el);
  }
  function rect(x, y, w, h, extraClass) {
    const el = document.createElementNS(SVG_NS, "rect");
    el.setAttribute("x", x);
    el.setAttribute("y", y);
    el.setAttribute("width", Math.max(w, 1));
    el.setAttribute("height", h);
    el.setAttribute("class", "box-plot-box" + (extraClass ? " " + extraClass : ""));
    svg.appendChild(el);
  }

  const xMin = scale(min);
  const xQ1 = scale(q1);
  const xMedian = scale(median);
  const xQ3 = scale(q3);
  const xMax = scale(max);

  // Whisker (min -> max) drawn first so the box sits visually on top of it.
  line(xMin, midY, xMax, midY, "box-plot-whisker");
  line(xMin, midY - BOX_PLOT_CAP_HEIGHT / 2, xMin, midY + BOX_PLOT_CAP_HEIGHT / 2, "box-plot-cap");
  line(xMax, midY - BOX_PLOT_CAP_HEIGHT / 2, xMax, midY + BOX_PLOT_CAP_HEIGHT / 2, "box-plot-cap");
  // Box (Q1 -> Q3).
  rect(xQ1, midY - BOX_PLOT_HEIGHT / 2, xQ3 - xQ1, BOX_PLOT_HEIGHT, "box-plot-iqr");
  // Median line.
  line(xMedian, midY - BOX_PLOT_HEIGHT / 2, xMedian, midY + BOX_PLOT_HEIGHT / 2, "box-plot-median");
  // Mean marker — a diamond, not just a color, so it's distinguishable
  // even without color (only drawn when it wouldn't just sit on top of
  // the median line).
  if (Math.abs(mean - median) > Math.max(0.05, range * 0.01)) {
    const xMean = scale(mean);
    const d = 5;
    const diamond = document.createElementNS(SVG_NS, "polygon");
    diamond.setAttribute(
      "points",
      `${xMean},${midY - d} ${xMean + d},${midY} ${xMean},${midY + d} ${xMean - d},${midY}`
    );
    diamond.setAttribute("class", "box-plot-mean");
    svg.appendChild(diamond);
  }

  return svg;
}

/**
 * @param {import('../../core/yieldCalculator.js').BoxPlotStats} boxPlot
 * @returns {HTMLElement}
 */
function buildBoxPlotSection(boxPlot) {
  return h("div", { className: "box-plot-section" }, [
    h("h4", { className: "brand-average-header" }, "Dry Yield Distribution"),
    buildBoxPlotSvg(boxPlot),
    h(
      "p",
      { className: "box-plot-caption" },
      `Min ${boxPlot.min.toFixed(1)} • Q1 ${boxPlot.q1.toFixed(1)} • Median ${boxPlot.median.toFixed(
        1
      )} • Q3 ${boxPlot.q3.toFixed(1)} • Max ${boxPlot.max.toFixed(1)} bu/ac`
    ),
  ]);
}

function computeRanked(entries, metric, header) {
  const meta = rankingMetricMeta[metric];
  const all = entries.map((entry, idx) => ({
    originalNumber: idx + 1,
    entry,
    value: valueForMetric(entry, metric, header),
  }));
  const withValue = all.filter((r) => r.value !== null);
  const withoutValue = all.filter((r) => r.value === null);
  withValue.sort((a, b) => (meta.ascending ? a.value - b.value : b.value - a.value));
  return [...withValue, ...withoutValue];
}

// Badge color reflects the entry's dry yield vs. the plot mean (green =
// 10+ bu/ac over, yellow = 10+ bu/ac under, light gray = within 10 bu/ac
// either way) rather than its rank position — this holds steady across
// all 3 metric tabs (Dry Yield/Gross/Moisture) since it's describing the
// entry's yield standing, not the current sort.
function significanceBadgeClass(significance) {
  if (significance === "positive") return "rank-badge rank-badge-sig-positive";
  if (significance === "negative") return "rank-badge rank-badge-sig-negative";
  return "rank-badge rank-badge-sig-neutral";
}

export function render(container, params) {
  // See adminEditStore.clearIfStale()'s comment — safe to call unconditionally.
  adminEditStore.clearIfStale();

  const brand = getBrand(brandStore.getState().selectedBrand);
  // Admin editing someone else's plot (see adminEditStore.js) works by
  // temporarily loading that trial into this same trialStore draft slot
  // — trialStore.loadTrial() — so this screen (and Plot Details/Plot
  // Hybrids) need no special-casing at all to support it; they just
  // read/edit "the current draft" exactly as normal. adminEditStore is
  // what keeps that safe: while a session is active it suppresses
  // libraryStore's auto-save-to-library rule, so this never leaks into
  // the admin's own device library or gets cloud-pushed under the
  // admin's own account (see libraryStore.js's isActive() guard).
  const draft = trialStore.getState();
  const header = draft.header;
  const entries = draft.entries;
  // Relabeled view of entries used only for this screen and its PDF
  // export (Hybrid Entries editing and the XLSX export use the real,
  // unrelabeled `entries` above) — see entriesForBrandView() for the
  // Midwest Seed Genetics <-> NC+ mirrored relabeling rule.
  const displayEntries = entriesForBrandView(entries, brand);
  const metric = (params && params.metric) || RankingMetric.DRY_YIELD;

  function goMetric(nextMetric) {
    render(container, { ...params, metric: nextMetric });
  }

  // ---- Toolbar share menu (centered modal popup, not a below-button
  // dropdown, so the user never has to scroll down to reach it) ----
  let activeShareModal = null;

  function closeShareModal() {
    if (activeShareModal) activeShareModal.close();
    activeShareModal = null;
  }

  function menuAction(label, fn) {
    return h(
      "button",
      {
        type: "button",
        className: "share-menu-item",
        onclick: async () => {
          closeShareModal();
          await fn();
        },
      },
      label
    );
  }

  function openShareModal() {
    const body = h("div", { className: "share-menu-panel share-menu-panel-modal" }, [
      menuAction("Export / Share PDF (Ranked Results)", handleExportPdf),
      menuAction("Export / Share XLSX (Full Form)", handleExportXlsx),
      menuAction("Print Ranked Results", handlePrint),
      menuAction(`Email XLSX to ${brand ? brand.displayName : "Operations"} Operations`, handleEmailXlsx),
    ]);
    activeShareModal = showCustomModal({
      title: "Share This Plot",
      bodyNode: body,
      onClose: () => {
        activeShareModal = null;
      },
    });
  }

  async function buildRankedPdfBlob() {
    const results = computeRanked(displayEntries, metric, header);
    const logoDataUrl = await getLogoDataUrl(brand).catch(() => null);
    return buildPdf({ header, results, metric, allEntries: displayEntries, brand, logoDataUrl });
  }

  async function buildFullXlsxBlob() {
    const effectiveLists = createEffectiveLists(listsStore.getEffectiveLists());
    return buildXlsx(header, entries, effectiveLists);
  }

  async function handleExportPdf() {
    try {
      const blob = await buildRankedPdfBlob();
      await shareOrDownload(blob, pdfFilename(header), "application/pdf");
    } catch (e) {
      showToast(`Couldn't export the PDF: ${e.message}`, { type: "error" });
    }
  }

  async function handleExportXlsx() {
    try {
      const { blob, filename } = await buildFullXlsxBlob();
      await shareOrDownload(blob, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      showToast(`Couldn't export the XLSX: ${e.message}`, { type: "error" });
    }
  }

  async function handlePrint() {
    try {
      const blob = await buildRankedPdfBlob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (win) {
        showToast("Opened in a new tab — use your browser's print button.", { type: "info" });
      } else {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = url;
        document.body.appendChild(iframe);
        iframe.onload = () => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            // ignore — user still has the new-tab fallback message below
          }
        };
        showToast("Pop-up blocked — preparing to print from this tab instead.", { type: "info" });
      }
    } catch (e) {
      showToast(`Couldn't prepare the print preview: ${e.message}`, { type: "error" });
    }
  }

  async function handleEmailXlsx() {
    try {
      const { blob, filename } = await buildFullXlsxBlob();
      const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return;
        } catch (e) {
          if (e && e.name === "AbortError") return;
        }
      }
      downloadBlob(blob, filename);
      openMailto(
        brand.operationsEmail,
        `Corn Plot Harvest — ${filename}`,
        `Attached is the trial outline for ${header.cooperatorName || "this plot"}.\n\n(Your file downloaded separately — attach it manually in this email.)`
      );
      showToast("Your file downloaded — attach it manually in the email that just opened.", { type: "info" });
    } catch (e) {
      showToast(`Couldn't prepare the email: ${e.message}`, { type: "error" });
    }
  }

  const shareBtn = h(
    "button",
    { type: "button", className: "btn btn-secondary btn-block", onclick: openShareModal },
    "Share This Plot"
  );

  const helpBtn = h(
    "button",
    {
      type: "button",
      className: "top-bar-btn top-bar-btn-help",
      "aria-label": "How to read these results",
      title: "How to read these results",
      onclick: () => navigate("plot-summary-help"),
    },
    h("span", { className: "top-bar-btn-help-badge" }, "i")
  );

  const topBar = createTopBar({
    title: "Plot Summary",
    onBack: () => navigate("workspace"),
    backLabel: "Menu",
    right: helpBtn,
  });

  // ---- Header card ----
  // The whole card is a button that jumps straight to Plot Details for
  // this same plot (no id/param needed — trialDetails.js just reads the
  // current workspace draft, same as this screen does) — a shortcut to
  // fix a typo'd cooperator name or wrong county without hunting through
  // the workspace menu. Works the same during an admin edit as the
  // existing "Edit This Plot" button below does (see its comment).
  const subtitle = `${filenameYear(header)} • ${header.state || "—"} • ${header.county || "—"}`;
  const headerCard = h(
    "button",
    {
      type: "button",
      className: "card summary-header-card",
      "aria-label": "Edit Plot Details",
      onclick: () => navigate("trial-details"),
    },
    [
      brand ? h("img", { className: "summary-header-logo", src: brand.logo, alt: brand.displayName }) : null,
      h("div", { className: "summary-header-text" }, [
        h("h2", { className: "summary-header-name" }, header.cooperatorName.trim() || "Untitled Plot"),
        h("p", { className: "summary-header-subtitle" }, subtitle),
      ]),
      h("span", { className: "chooser-row-chevron" }, "›"),
    ]
  );

  const adminEditBanner = adminEditStore.isActive()
    ? h("div", { className: "preview-owner-banner" }, [
        `Admin Edit — editing ${adminEditStore.getOwnerLabel()}'s plot. Changes save to their account, not yours.`,
      ])
    : null;

  // ---- Segmented control ----
  const segmented = h(
    "div",
    { className: "segmented-control" },
    METRIC_ORDER.map((m) =>
      h(
        "button",
        {
          type: "button",
          className: "segmented-btn" + (m === metric ? " segmented-btn-active" : ""),
          onclick: () => goMetric(m),
        },
        rankingMetricMeta[m].displayName
      )
    )
  );

  // ---- Dry Yield Summary card ----
  const summary = dryYieldSummary(displayEntries);

  // Only brands with 2+ hybrids in this plot get an average (a "brand
  // average" of one hybrid isn't meaningful); the selected brand (Midwest
  // Seed Genetics or NC+) always leads what's left, regardless of where
  // it'd otherwise land by average value. Shared with the PDF export so
  // both stay consistent.
  // catalogBrandName, not displayName — summary.byBrand groups entries by
  // their actual PlotEntry.brand string (e.g. "NC+ Hybrids"), which for
  // NC+ never equals the shorter cosmetic "NC+" displayName used
  // elsewhere. Matching against the wrong string silently fails to
  // reorder anything, so this has to be the catalog name.
  const byBrandOrdered = brandAveragesForDisplay(summary.byBrand, brand ? brand.catalogBrandName : null);

  const summaryCard = h("section", { className: "card" }, [
    h("h3", { className: "section-header" }, "Dry Yield Summary"),
    summary.mean === null
      ? h("p", { className: "empty-state" }, "No entries with complete data yet.")
      : h("div", { className: "summary-stats" }, [
          h("div", { className: "summary-stat" }, [
            h("span", { className: "summary-stat-value" }, `${summary.mean.toFixed(1)}`),
            h("span", { className: "summary-stat-label" }, "Trial Mean (bu/ac)"),
          ]),
          h("div", { className: "summary-stat" }, [
            h(
              "span",
              { className: "summary-stat-value" },
              summary.coefficientOfVariation === null ? "—" : `${summary.coefficientOfVariation.toFixed(1)}%`
            ),
            h("span", { className: "summary-stat-label" }, summary.coefficientOfVariation === null ? "CV needs 2+ entries" : "CV"),
          ]),
          h("div", { className: "summary-stat" }, [
            h("span", { className: "summary-stat-value" }, String(summary.sampleCount)),
            h("span", { className: "summary-stat-label" }, "Entries"),
          ]),
        ]),
    summary.boxPlot ? buildBoxPlotSection(summary.boxPlot) : null,
    byBrandOrdered.length > 0
      ? h("h4", { className: "brand-average-header" }, "Average By Brand")
      : null,
    byBrandOrdered.length > 0
      ? h(
          "ul",
          { className: "brand-average-list" },
          byBrandOrdered.map((b) =>
            h("li", { className: "brand-average-block" }, [
              h("div", { className: "brand-average-row" }, [
                h("span", { className: "brand-average-name" }, b.brand),
                h("span", { className: "brand-average-value" }, `${b.average.toFixed(1)} bu/ac (n=${b.count})`),
              ]),
            ])
          )
        )
      : null,
  ]);

  // ---- Ranked Results ----
  const meta = rankingMetricMeta[metric];
  const ranked = computeRanked(displayEntries, metric, header);
  const showsMoistureLine = metric !== RankingMetric.MOISTURE;

  const significanceLegend = h("div", { className: "significance-legend" }, [
    h("span", { className: "significance-legend-item" }, [
      h("span", { className: "significance-swatch significance-swatch-positive" }),
      `${SIGNIFICANCE_THRESHOLD_BU_AC}+ bu/ac over plot mean`,
    ]),
    h("span", { className: "significance-legend-item" }, [
      h("span", { className: "significance-swatch significance-swatch-negative" }),
      `${SIGNIFICANCE_THRESHOLD_BU_AC}+ bu/ac under plot mean`,
    ]),
    h("span", { className: "significance-legend-item" }, [
      h("span", { className: "significance-swatch significance-swatch-neutral" }),
      `Within ${SIGNIFICANCE_THRESHOLD_BU_AC} bu/ac of plot mean`,
    ]),
  ]);

  const rankedList = h("div", { className: "ranked-list" });
  if (ranked.length === 0) {
    rankedList.appendChild(h("p", { className: "empty-state" }, "No entries yet — add plot entries to see ranked results."));
  }
  ranked.forEach((result, idx) => {
    const rank = idx + 1;
    const subtitleParts = [];
    if (result.entry.hybrid.trim()) subtitleParts.push(result.entry.hybrid.trim());
    if (result.entry.brand.trim()) subtitleParts.push(result.entry.brand.trim());
    if (result.entry.trait.trim()) subtitleParts.push(result.entry.trait.trim());
    if (result.entry.relativeMaturity.trim()) subtitleParts.push(`RM ${result.entry.relativeMaturity.trim()}`);

    const moistureVal = moisture(result.entry);
    const moistureText = moistureVal === null ? "—" : `${moistureVal.toFixed(1)}%`;
    const significance = dryYieldSignificance(result.entry, summary);

    rankedList.appendChild(
      h("div", { className: "ranked-row card" }, [
        h("span", { className: significanceBadgeClass(significance) }, String(rank)),
        h("div", { className: "ranked-row-body" }, [
          h("p", { className: "ranked-row-title" }, subtitleParts.length ? subtitleParts.join(" • ") : "Untitled Entry"),
          showsMoistureLine ? h("p", { className: "ranked-row-moisture" }, `Moisture: ${moistureText}`) : null,
          result.entry.comments.trim() ? h("p", { className: "ranked-row-comment" }, result.entry.comments.trim()) : null,
        ]),
        h("span", { className: "ranked-row-value" }, meta.formatValue(result.value)),
      ])
    );
  });

  // ---- Bottom action: back to Hybrid Entries to keep editing ----
  const editPlotBtn = h(
    "button",
    {
      type: "button",
      className: "btn btn-secondary btn-block",
      onclick: () => navigate("entries"),
    },
    "Edit This Plot"
  );

  const screen = h("div", { className: "screen plot-summary-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      adminEditBanner,
      headerCard,
      segmented,
      summaryCard,
      h("h3", { className: "section-header" }, "Ranked Results"),
      significanceLegend,
      rankedList,
      editPlotBtn,
      shareBtn,
    ]),
  ]);

  mount(container, screen);
}
