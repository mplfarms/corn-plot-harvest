// src/ui/screens/plotSummary.js
//
// Segmented Dry Yield/Gross/Moisture control, header card, Dry Yield
// Summary card, Ranked Results list, and a toolbar share menu with the
// 4 export/share/print/email actions.

import { h, mount } from "../dom.js";
import { getBrand } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as trialStore from "../stores/trialStore.js";
import * as listsStore from "../stores/listsStore.js";
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
  const brand = getBrand(brandStore.getState().selectedBrand);
  const draft = trialStore.getState();
  const header = draft.header;
  const entries = draft.entries;
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
    const results = computeRanked(entries, metric, header);
    const logoDataUrl = await getLogoDataUrl(brand).catch(() => null);
    return buildPdf({ header, results, metric, allEntries: entries, brand, logoDataUrl });
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

  const topBar = createTopBar({
    title: "Plot Summary",
    onBack: () => navigate("workspace"),
    backLabel: "Menu",
  });

  // ---- Header card ----
  const subtitle = `${filenameYear(header)} • ${header.state || "—"} • ${header.county || "—"}`;
  const headerCard = h("section", { className: "card summary-header-card" }, [
    brand ? h("img", { className: "summary-header-logo", src: brand.logo, alt: brand.displayName }) : null,
    h("div", { className: "summary-header-text" }, [
      h("h2", { className: "summary-header-name" }, header.cooperatorName.trim() || "Untitled Plot"),
      h("p", { className: "summary-header-subtitle" }, subtitle),
    ]),
  ]);

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
  const summary = dryYieldSummary(entries);

  // Only brands with 2+ hybrids in this plot get an average (a "brand
  // average" of one hybrid isn't meaningful); the selected brand (Midwest
  // Seed Genetics or NC+) always leads what's left, regardless of where
  // it'd otherwise land by average value. Shared with the PDF export so
  // both stay consistent.
  const byBrandOrdered = brandAveragesForDisplay(summary.byBrand, brand ? brand.displayName : null);

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
  const ranked = computeRanked(entries, metric, header);
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

  // ---- Bottom action: back to Plot Entries to keep editing ----
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
