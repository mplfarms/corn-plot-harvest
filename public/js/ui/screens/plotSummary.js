// src/ui/screens/plotSummary.js
//
// Segmented Dry Yield/Gross control, header card, Dry Yield Summary
// card, Ranked Results list, and a toolbar share menu with the 4
// export/share/print/email actions.

import { h, mount, debounceGuard } from "../dom.js";
import { getBrand, entriesForBrandView } from "../brand.js";
import * as brandStore from "../stores/brandStore.js";
import * as trialStore from "../stores/trialStore.js";
import * as listsStore from "../stores/listsStore.js";
import * as adminEditStore from "../stores/adminEditStore.js";
import { ensureFormIdAssigned, ensureFormIdAssignedWithFeedback } from "../formIdAssign.js";
import { createTopBar } from "../components/topBar.js";
import { showToast } from "../components/toast.js";
import { showCustomModal, showConfirm } from "../components/modal.js";
import { navigate, rememberedOriginFor } from "../router.js";
import { filenameYear, formatHeaderDate, gpsCellText } from "../../core/models.js";
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
import { buildSeedwareExport } from "../../core/seedwareExportBuilder.js";
import { getLogoDataUrl } from "../logoCache.js";
import { downloadBlob, shareOrDownload, shareOrDownloadFiles, openMailto } from "../fileSave.js";

// Moisture is deliberately omitted from the segmented control — ranking/
// sorting the whole list BY moisture wasn't useful in practice; the
// per-hybrid moisture reading is still shown on each row (see
// showsMoistureLine below) and still factors into Gross's deduction
// calculation, it's just no longer its own selectable "view". Entry #
// sits between Dry Yield and Gross (per explicit request) — it sorts
// back to original/planting order rather than by a measured value.
const METRIC_ORDER = [RankingMetric.DRY_YIELD, RankingMetric.ENTRY_NUM, RankingMetric.GROSS];

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
    value: valueForMetric(entry, metric, header, idx + 1),
  }));
  const withValue = all.filter((r) => r.value !== null);
  const withoutValue = all.filter((r) => r.value === null);
  withValue.sort((a, b) => (meta.ascending ? a.value - b.value : b.value - a.value));
  return [...withValue, ...withoutValue];
}

// Badge color reflects the entry's dry yield vs. the plot mean (green =
// 10+ bu/ac over, yellow = 10+ bu/ac under, light gray = within 10 bu/ac
// either way) rather than its rank position — this holds steady across
// both metric tabs (Dry Yield/Gross) since it's describing the entry's
// yield standing, not the current sort.
function significanceBadgeClass(significance) {
  if (significance === "positive") return "rank-badge rank-badge-sig-positive";
  if (significance === "negative") return "rank-badge rank-badge-sig-negative";
  return "rank-badge rank-badge-sig-neutral";
}

export function render(container, params) {
  // See adminEditStore.clearIfStale()'s comment — safe to call unconditionally.
  adminEditStore.clearIfStale();

  const brand = getBrand(brandStore.getState().selectedBrand);
  // Crow's Brand View uses a deliberately plainer Ranked Results row (per
  // explicit request): no color-coded significance badge, the entry's
  // ORIGINAL number on the left instead, and its sorted placement rank +
  // actual Dry Yield always shown together on the right regardless of
  // which metric tab is selected. Every other Brand View (and no Brand
  // View at all) keeps the original color-coded badge + single
  // current-metric-value layout — see the Ranked Results section below.
  const isCrowsView = Boolean(brand && brand.id === "crows");
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
      menuAction("Export for Seedware", handleExportSeedware),
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

  // Resolves the freshest possible header (in case a background Form ID
  // assignment — see formIdAssign.js — finished after this screen last
  // rendered), making one last attempt to lock one in right now if this
  // plot somehow doesn't have one yet (an older plot from before this
  // feature existed, or the attempt on Plot Details never got a chance
  // to run/succeed). Never throws — a plot that still can't reach the
  // server here exports/prints using the pre-Form-ID fallback filename
  // and simply omits the footer label, rather than blocking the export
  // — see formIdAssign.js's top comment.
  async function resolveHeaderForExport() {
    await ensureFormIdAssigned().catch(() => {});
    return trialStore.getState().header;
  }

  // Asked every time the user exports/prints a PDF (per explicit request
  // — this is a one-off choice for that specific PDF, not a saved
  // preference), right before it's built. "No" (the default/cancel
  // button too — see showConfirm's overlay-click-to-cancel behavior)
  // leaves the PDF exactly as it always was; "Yes" adds the compact
  // header block built by pdfBuilder.js's drawPlotDetailsHeader().
  function promptIncludePlotDetails() {
    return showConfirm({
      title: "Include Plot Details",
      message: "Add a compact Plot Details header to this PDF?",
      confirmLabel: "Yes",
      cancelLabel: "No",
    });
  }

  async function buildRankedPdfBlob(freshHeader, includePlotDetails) {
    const results = computeRanked(displayEntries, metric, freshHeader);
    const logoDataUrl = await getLogoDataUrl(brand).catch(() => null);
    return buildPdf({
      header: freshHeader,
      results,
      metric,
      allEntries: displayEntries,
      brand,
      logoDataUrl,
      includePlotDetails,
    });
  }

  async function buildFullXlsxBlob(freshHeader) {
    const effectiveLists = createEffectiveLists(listsStore.getEffectiveLists());
    return buildXlsx(freshHeader, entries, effectiveLists);
  }

  // Deliberately built from the raw (unrelabeled) `entries`, same as
  // buildFullXlsxBlob() above and NOT displayEntries — see brand.js's
  // entriesForBrandView() comment: exports keep entries' real Brand/
  // Company value, only Plot Summary's on-screen display relabels it.
  // isCustomCompany/isCustomHybrid decide Variety Provider "Request" —
  // see seedwareExportBuilder.js's top comment.
  function buildSeedwareExportBlob(freshHeader) {
    return buildSeedwareExport(freshHeader, entries, {
      isCustomCompany: listsStore.isCustomCompany,
      isCustomHybrid: listsStore.isCustomHybrid,
    });
  }

  async function handleExportPdf() {
    try {
      const includePlotDetails = await promptIncludePlotDetails();
      const freshHeader = await resolveHeaderForExport();
      const blob = await buildRankedPdfBlob(freshHeader, includePlotDetails);
      await shareOrDownload(blob, pdfFilename(freshHeader), "application/pdf");
    } catch (e) {
      showToast(`Couldn't export the PDF: ${e.message}`, { type: "error" });
    }
  }

  async function handleExportXlsx() {
    try {
      const freshHeader = await resolveHeaderForExport();
      const { blob, filename } = await buildFullXlsxBlob(freshHeader);
      await shareOrDownload(blob, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      showToast(`Couldn't export the XLSX: ${e.message}`, { type: "error" });
    }
  }

  // Exports/shares BOTH the flat Seedware import file AND the full
  // "Trial Outline" XLSX (this app's own formatted form) together, in
  // one action — per explicit request, the filled-out harvest form now
  // rides along with the Seedware file from this button too (not just
  // from "Email XLSX to Operations" below, which already bundled both —
  // see handleEmailXlsx()). shareOrDownloadFiles() hands both files to
  // the OS share sheet at once when available (e.g. AirDrop, a Files
  // app, a cloud-upload picker), falling back to two separate browser
  // downloads otherwise.
  async function handleExportSeedware() {
    try {
      const freshHeader = await resolveHeaderForExport();
      const { blob: fullBlob, filename: fullFilename } = await buildFullXlsxBlob(freshHeader);
      const seedware = buildSeedwareExportBlob(freshHeader);
      const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      await shareOrDownloadFiles(
        [
          { blob: fullBlob, filename: fullFilename, mime },
          { blob: seedware.blob, filename: seedware.filename, mime },
        ],
        seedware.filename
      );
    } catch (e) {
      showToast(`Couldn't export the Seedware file: ${e.message}`, { type: "error" });
    }
  }

  async function handlePrint() {
    try {
      const includePlotDetails = await promptIncludePlotDetails();
      const freshHeader = await resolveHeaderForExport();
      const blob = await buildRankedPdfBlob(freshHeader, includePlotDetails);
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

  // Emails BOTH the full "Trial Outline" XLSX (this app's own formatted
  // form) and the flat Seedware import file together, in a single
  // action — per explicit request, Seedware's file rides along with
  // whatever this button already sent to Operations, rather than being
  // a separate share-menu-only action. shareOrDownload's multi-file
  // Web Share path (below) hands both files to the OS share sheet at
  // once, which is what actually lets a phone attach two files to one
  // outgoing email; the mailto: fallback can't attach anything at all
  // (mailto doesn't support attachments), so both files download
  // separately there and the user attaches them by hand.
  async function handleEmailXlsx() {
    try {
      const freshHeader = await resolveHeaderForExport();
      const { blob, filename } = await buildFullXlsxBlob(freshHeader);
      const seedware = buildSeedwareExportBlob(freshHeader);
      const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const file = new File([blob], filename, { type: mime });
      const seedwareFile = new File([seedware.blob], seedware.filename, { type: mime });
      const files = [file, seedwareFile];
      if (navigator.canShare && navigator.share && navigator.canShare({ files })) {
        try {
          await navigator.share({ files, title: filename });
          return;
        } catch (e) {
          if (e && e.name === "AbortError") return;
        }
      }
      downloadBlob(blob, filename);
      downloadBlob(seedware.blob, seedware.filename);
      openMailto(
        brand.operationsEmail,
        `Corn Plot Harvest — ${filename}`,
        `Attached is the trial outline for ${freshHeader.cooperatorName || "this plot"}, along with the Seedware import file (${seedware.filename}).\n\n(Your files downloaded separately — attach them both manually in this email.)`
      );
      showToast("Your files downloaded — attach them manually in the email that just opened.", { type: "info" });
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

  // Reached from more than one place (the Workspace menu, a Saved Plots
  // row, the Demo Plot, "Return to Plot Summary" on Hybrid Entries,
  // "Save Plot" on the entry editor) — by explicit request, Back always
  // returns to whichever one was actually used to get here, rather than
  // a single hardcoded destination. Falls back to "workspace" only when
  // nothing's been recorded yet (a direct deep link or a page reload —
  // see router.js's rememberedOriginFor()).
  const topBar = createTopBar({
    title: "Plot Summary",
    onBack: () => navigate(rememberedOriginFor("plot-summary") || "workspace"),
    backLabel: "Back",
    right: helpBtn,
  });

  // ---- Header card ----
  // Tapping the card expands/collapses an inline, read-only recap of the
  // rest of Plot Details right below it — blank fields are skipped, so
  // only whatever's actually been filled in shows up. This is NOT a
  // second render of trialDetails.js's real fields (no wheels/pickers,
  // nothing editable here) — just plain label/value rows built fresh
  // from the same `header` object, so it's always in sync with whatever
  // was last saved. The "Edit Plot Details" link at the bottom of the
  // expanded panel is the actual way in to change anything (works the
  // same during an admin edit as the existing "Edit This Plot" button
  // below does — see its comment).
  // Form ID (see core/formId.js) shown as a trailing "• 26-1001" once
  // assigned — omitted entirely (not even a placeholder dash) for a plot
  // that doesn't have one yet, same as everywhere else this shows up.
  const subtitle = `${filenameYear(header)} • ${header.state || "—"} • ${header.county || "—"}${
    header.formId ? ` • ${header.formId}` : ""
  }`;

  function detailRow(label, value) {
    if (!value) return null;
    return h("div", { className: "plot-details-summary-row" }, [
      h("span", { className: "plot-details-summary-label" }, label),
      h("span", { className: "plot-details-summary-value" }, value),
    ]);
  }

  const gpsText = gpsCellText(header);
  const detailRows = [
    detailRow("Address", header.address),
    detailRow("City", header.city),
    detailRow("Zip", header.zip),
    detailRow("GPS", gpsText || null),
    detailRow("Date Planted", formatHeaderDate(header.datePlanted)),
    detailRow("Tillage", header.tillage),
    detailRow("Irrigation", header.irrigation),
    detailRow("Soil Type", header.soilType),
    detailRow("Previous Crop", header.previousCrop),
    detailRow("Planting Population", header.plantingPopulation),
    detailRow("Date Harvested", formatHeaderDate(header.dateHarvested)),
    detailRow("Collected By", header.collectedBy),
    detailRow("Phone", header.phone),
    detailRow("Email", header.email),
    detailRow("Drying Shrink Rate", header.dryingShrinkRate === null || header.dryingShrinkRate === undefined ? "" : String(header.dryingShrinkRate)),
    detailRow("Price per Bushel", header.pricePerBushel === null || header.pricePerBushel === undefined ? "" : String(header.pricePerBushel)),
    detailRow("Plot Notes", header.trialNotes),
  ].filter(Boolean);

  const editDetailsLink = h(
    "button",
    { type: "button", className: "btn btn-secondary btn-block plot-details-summary-edit-btn", onclick: () => navigate("trial-details") },
    "Edit Plot Details"
  );

  const detailsPanel = h(
    "section",
    { className: "card plot-details-summary-panel", style: { display: "none" } },
    detailRows.length > 0
      ? [...detailRows, editDetailsLink]
      : [h("p", { className: "empty-state" }, "No other plot details entered yet."), editDetailsLink]
  );

  let expanded = false;
  const chevronEl = h("span", { className: "chooser-row-chevron" }, "›");

  const toggleDetails = debounceGuard(() => {
    expanded = !expanded;
    detailsPanel.style.display = expanded ? "" : "none";
    chevronEl.classList.toggle("chooser-row-chevron-expanded", expanded);
    headerCard.classList.toggle("summary-header-card-expanded", expanded);
    detailsPanel.classList.toggle("plot-details-summary-panel-expanded", expanded);
    headerCard.setAttribute("aria-expanded", String(expanded));
    headerCard.setAttribute("aria-label", expanded ? "Hide plot details" : "Show plot details");
  });

  const headerCard = h(
    "button",
    {
      type: "button",
      className: "card summary-header-card",
      "aria-label": "Show plot details",
      "aria-expanded": "false",
      onclick: toggleDetails,
    },
    [
      brand ? h("img", { className: "summary-header-logo", src: brand.logo, alt: brand.displayName }) : null,
      h("div", { className: "summary-header-text" }, [
        h("h2", { className: "summary-header-name" }, header.cooperatorName.trim() || "Untitled Plot"),
        h("p", { className: "summary-header-subtitle" }, subtitle),
      ]),
      chevronEl,
    ]
  );

  const adminEditBanner = adminEditStore.isActive()
    ? h("div", { className: "preview-owner-banner" }, [
        `Admin Edit — editing ${adminEditStore.getOwnerLabel()}'s plot. Changes save to their account, not yours.`,
      ])
    : null;

  // Manual "Assign Plot ID" retry — a visible, explicit backstop for the
  // silent self-heal below (see the bottom of this render() function).
  // Not nested inside headerCard itself: headerCard IS a <button> (it
  // toggles the details recap), and a <button> can never contain another
  // <button> — browsers silently reparent nested ones out, breaking
  // clicks — so this has to be its own separate row instead. Only ever
  // rendered when there's genuinely no Form ID yet; disappears the
  // moment one's actually assigned (via this button's own re-render, the
  // self-heal's re-render, or just reopening this screen later).
  const formIdRetryBtn = !header.formId
    ? h(
        "button",
        {
          type: "button",
          className: "btn btn-secondary btn-block summary-formid-retry-btn",
          onclick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = "Assigning Plot ID…";
            await ensureFormIdAssignedWithFeedback();
            render(container, params);
          },
        },
        "Assign Plot ID"
      )
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
  const dryYieldMeta = rankingMetricMeta[RankingMetric.DRY_YIELD];

  // The significance legend describes what the rank badge's color coding
  // means — Crow's view has no color coding at all (see isCrowsView
  // above), so the legend would just be confusing dead text there.
  const significanceLegend = isCrowsView
    ? null
    : h("div", { className: "significance-legend" }, [
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

    const rowBody = h("div", { className: "ranked-row-body" }, [
      h("p", { className: "ranked-row-title" }, subtitleParts.length ? subtitleParts.join(" • ") : "Untitled Entry"),
      showsMoistureLine ? h("p", { className: "ranked-row-moisture" }, `Moisture: ${moistureText}`) : null,
      result.entry.comments.trim() ? h("p", { className: "ranked-row-comment" }, result.entry.comments.trim()) : null,
    ]);

    if (isCrowsView) {
      // Plain layout, no significance color-coding: the entry's ORIGINAL
      // number (its position in the plot before any sorting — same value
      // the Entry # metric sorts by) sits on the left; its current sorted
      // placement rank and its actual Dry Yield (regardless of which
      // metric tab is active) sit stacked on the right.
      const dryYieldVal = valueForMetric(result.entry, RankingMetric.DRY_YIELD, header);
      rankedList.appendChild(
        h("div", { className: "ranked-row card ranked-row-plain" }, [
          h("span", { className: "ranked-row-entry-num" }, `#${result.originalNumber}`),
          rowBody,
          h("div", { className: "ranked-row-right-stack" }, [
            h("span", { className: "ranked-row-rank" }, `Rank ${rank}`),
            h("span", { className: "ranked-row-value" }, dryYieldMeta.formatValue(dryYieldVal)),
          ]),
        ])
      );
    } else {
      const significance = dryYieldSignificance(result.entry, summary);
      rankedList.appendChild(
        h("div", { className: "ranked-row card" }, [
          h("span", { className: significanceBadgeClass(significance) }, String(rank)),
          rowBody,
          h("span", { className: "ranked-row-value" }, meta.formatValue(result.value)),
        ])
      );
    }
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
      formIdRetryBtn,
      detailsPanel,
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

  // Self-heals a plot that reaches Plot Summary without a Form ID yet —
  // an older plot saved before this feature existed (see the "assign to
  // all existing plots" backfill in netlify/functions/backfillFormIds.js,
  // which should catch most of these up front), or the rarer case of a
  // very slow connection where even entryEditor.js's awaited Save Plot
  // reservation hasn't landed yet. Deliberately SILENT (no error toast,
  // unlike the "Assign Plot ID" button above) — this is a passive,
  // opportunistic background attempt, not something the user actually
  // asked for, so a failure here (e.g. genuinely no signal) shouldn't
  // interrupt them; the visible retry button is what's there for anyone
  // who wants to know WHY it isn't showing up. Fire-and-forget, exactly
  // like every other formIdAssign.js call site — never blocks anything
  // on screen — but if it succeeds AND this screen is still the one
  // showing (the user hasn't already navigated elsewhere while it was in
  // flight, checked via container.isConnected), re-render once so the
  // newly assigned ID actually appears without requiring a manual refresh.
  if (!header.formId) {
    ensureFormIdAssigned().then((assigned) => {
      if (assigned && container.isConnected) render(container, params);
    });
  }
}
