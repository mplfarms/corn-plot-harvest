// src/core/yieldCalculator.js
//
// Faithful port of the Swift yield-calculation formulas. Do not alter
// these formulas — they must match the original app's arithmetic exactly.

/**
 * @param {string|null|undefined} text
 * @returns {number|null}
 */
export function parseNumber(text) {
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {import('./models.js').PlotEntry} entry
 * @returns {number|null}
 */
export function calculatedDryYield(entry) {
  const h = parseNumber(entry.moisturePercent);
  const g = parseNumber(entry.sampleNetWeightLbs);
  const l = parseNumber(entry.widthInches);
  const k = parseNumber(entry.numberOfRows);
  const j = parseNumber(entry.stripLengthFeet);
  if (
    h === null ||
    g === null ||
    l === null ||
    k === null ||
    j === null ||
    h === 0 ||
    l === 0 ||
    k === 0 ||
    j === 0
  ) {
    return null;
  }
  return ((100 - h) * (g * 110.465)) / (l * k * j);
}

/**
 * @param {import('./models.js').PlotEntry} entry
 * @returns {number|null}
 */
export function dryYield(entry) {
  const manual = parseNumber(entry.manualDryYield);
  if (manual !== null) return manual;
  return calculatedDryYield(entry);
}

/**
 * @param {import('./models.js').PlotEntry} entry
 * @param {import('./models.js').TrialHeader} header
 * @returns {number|null}
 */
export function gross(entry, header) {
  const h = parseNumber(entry.moisturePercent);
  if (h === null || h === 0) return null;
  const m = dryYield(entry);
  if (m === null) return null;
  const base = header.baseMoisturePercent;
  const price = header.pricePerBushel;
  const drying = header.dryingShrinkRate;
  if (h > base + 0.01) {
    const r = h - base;
    return m * price - r * drying * m;
  }
  return m * price;
}

/**
 * @param {import('./models.js').PlotEntry} entry
 * @returns {number|null}
 */
export function moisture(entry) {
  return parseNumber(entry.moisturePercent);
}

/** @readonly */
export const RankingMetric = {
  DRY_YIELD: "dryYield",
  GROSS: "gross",
  MOISTURE: "moisture",
};

/**
 * @typedef {Object} RankingMetricMeta
 * @property {string} displayName
 * @property {boolean} ascending
 * @property {(value: number|null) => string} formatValue
 */

/** @type {Object<string, RankingMetricMeta>} */
export const rankingMetricMeta = {
  [RankingMetric.DRY_YIELD]: {
    displayName: "Dry Yield",
    ascending: false,
    formatValue: (value) => (value === null || value === undefined ? "—" : `${value.toFixed(1)} bu/ac`),
  },
  [RankingMetric.GROSS]: {
    displayName: "Gross",
    ascending: false,
    formatValue: (value) => (value === null || value === undefined ? "—" : `$${value.toFixed(2)}`),
  },
  [RankingMetric.MOISTURE]: {
    displayName: "Moisture",
    ascending: true,
    formatValue: (value) => (value === null || value === undefined ? "—" : `${value.toFixed(1)}%`),
  },
};

/**
 * @param {import('./models.js').PlotEntry} entry
 * @param {string} metric one of RankingMetric values
 * @param {import('./models.js').TrialHeader} header
 * @returns {number|null}
 */
export function valueForMetric(entry, metric, header) {
  switch (metric) {
    case RankingMetric.DRY_YIELD:
      return dryYield(entry);
    case RankingMetric.GROSS:
      return gross(entry, header);
    case RankingMetric.MOISTURE:
      return moisture(entry);
    default:
      return null;
  }
}

/**
 * @typedef {Object} BrandAverage
 * @property {string} brand
 * @property {number} average
 * @property {number} count
 */

/**
 * @typedef {Object} DryYieldSummary
 * @property {BrandAverage[]} byBrand
 * @property {number|null} mean
 * @property {number|null} coefficientOfVariation
 * @property {number} sampleCount
 */

/**
 * @param {import('./models.js').PlotEntry[]} entries
 * @returns {DryYieldSummary}
 */
export function dryYieldSummary(entries) {
  /** @type {Map<string, number[]>} */
  const groups = new Map();
  /** @type {number[]} */
  const allValues = [];

  for (const entry of entries) {
    const y = dryYield(entry);
    if (y === null) continue;
    allValues.push(y);
    const brand = entry.brand.trim() || "Unlisted Brand";
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push(y);
  }

  const byBrand = Array.from(groups.entries()).map(([brand, values]) => {
    const sum = values.reduce((a, b) => a + b, 0);
    return { brand, average: sum / values.length, count: values.length };
  });
  byBrand.sort((a, b) => b.average - a.average);

  const sampleCount = allValues.length;
  const mean = sampleCount > 0 ? allValues.reduce((a, b) => a + b, 0) / sampleCount : null;

  let coefficientOfVariation = null;
  if (mean !== null && sampleCount >= 2 && mean !== 0) {
    const variance =
      allValues.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / (sampleCount - 1);
    coefficientOfVariation = (Math.sqrt(variance) / mean) * 100;
  }

  return { byBrand, mean, coefficientOfVariation, sampleCount };
}

/**
 * Fixed conditional-formatting threshold (bu/ac) an entry's dry yield must
 * clear above/below the plot mean to be flagged green/yellow — a plain
 * cutoff set directly by the user, not a statistical test.
 * @readonly
 */
export const SIGNIFICANCE_THRESHOLD_BU_AC = 10;

/**
 * Classifies one entry's dry yield against the plot mean using the fixed
 * +/-10 bu/ac threshold: green ("positive") at 10+ bu/ac over the mean,
 * yellow ("negative") at 10+ bu/ac under the mean, light gray ("neutral")
 * for everything in between.
 * @param {import('./models.js').PlotEntry} entry
 * @param {DryYieldSummary} summary
 * @returns {"positive"|"negative"|"neutral"}
 */
export function dryYieldSignificance(entry, summary) {
  if (summary.mean === null) return "neutral";
  const y = dryYield(entry);
  if (y === null) return "neutral";
  const delta = y - summary.mean;
  if (delta >= SIGNIFICANCE_THRESHOLD_BU_AC) return "positive";
  if (delta <= -SIGNIFICANCE_THRESHOLD_BU_AC) return "negative";
  return "neutral";
}

/**
 * Reorders a DryYieldSummary's byBrand array so the given brand's own
 * average leads the list, regardless of where it'd otherwise land by
 * yield value — everything else keeps its existing highest-to-lowest
 * order behind it.
 * @param {BrandAverage[]} byBrand
 * @param {string|null|undefined} leadBrandName e.g. "Midwest Seed Genetics" or "NC+"
 * @returns {BrandAverage[]}
 */
export function orderBrandFirst(byBrand, leadBrandName) {
  if (!leadBrandName) return byBrand;
  const idx = byBrand.findIndex((b) => b.brand.trim().toLowerCase() === leadBrandName.toLowerCase());
  if (idx <= 0) return byBrand;
  const copy = byBrand.slice();
  const [lead] = copy.splice(idx, 1);
  copy.unshift(lead);
  return copy;
}

/**
 * Filters a DryYieldSummary's byBrand array down to brands with 2 or more
 * hybrids in the plot (a "brand average" of a single hybrid isn't a
 * meaningful average) and puts the given lead brand first among what's
 * left. Shared by the Plot Summary screen and PDF export so both stay
 * consistent.
 * @param {BrandAverage[]} byBrand
 * @param {string|null|undefined} leadBrandName e.g. "Midwest Seed Genetics" or "NC+"
 * @returns {BrandAverage[]}
 */
export function brandAveragesForDisplay(byBrand, leadBrandName) {
  return orderBrandFirst(
    byBrand.filter((b) => b.count >= 2),
    leadBrandName
  );
}
