// src/ui/brand.js (served at public/js/ui/brand.js)
//
// Brand palettes + theming, mirrors Theme.swift/Brand.swift. Two brands,
// each with a set of colors that stay fixed across light/dark mode
// (accent, accentLight, accentPale, highlight, chrome, danger) plus
// light/dark variants for backgrounds and cards.

/** @typedef {"midwestSeedGenetics"|"ncPlus"} BrandId */

export const BRANDS = {
  midwestSeedGenetics: {
    id: "midwestSeedGenetics",
    accent: "#09452C",
    accentLight: "#4C9A6B",
    accentPale: "#9CC93B",
    highlight: "#FEBE10",
    chrome: "#08341F",
    cardLight: "#F4F8F1",
    danger: "#C94A4A",
    bgLight: "#F4F8F1",
    bgDark: "#04140C",
    cardDark: "#0C4A2C",
    displayName: "Midwest Seed Genetics",
    // The exact string this brand is stored as in the Brand / Company
    // catalog (DefaultLists.json's "companies" list) and therefore on
    // every PlotEntry.brand value for it — used anywhere brand data needs
    // to be matched or defaulted against real entries (see
    // trialStore.js's defaultBrandForNewEntry() and
    // yieldCalculator.js's orderBrandFirst()). displayName above is for
    // cosmetic UI text only (logo alt text, email subject lines) and
    // isn't guaranteed to match the catalog string — for Midwest the two
    // happen to be identical, but they are NOT for NC+ (see below).
    catalogBrandName: "Midwest Seed Genetics",
    logo: "/logos/midwest.png",
    operationsEmail: "operations@midwestseed.com",
  },
  ncPlus: {
    id: "ncPlus",
    accent: "#D7282F",
    accentLight: "#E2555B",
    accentPale: "#EDA0A3",
    highlight: "#FFDC32",
    // Chrome (the top bar / browser theme-color background) uses NC+'s
    // official "Seed Corn+" identity blue directly (HEX 215AA8, per NC+
    // Brand Standards Annex I) rather than the brand red — requested so
    // the app's dominant background reads as NC+ blue, not red.
    chrome: "#215AA8",
    // bgLight/bgDark/cardDark are pale/dark tints of that same blue,
    // mirroring how Midwest's bgLight/bgDark are tints of its accent
    // rather than the saturated brand color itself (keeps body text
    // readable). Accent/highlight stay the brand's red/yellow — those
    // are used for buttons and small highlights, not backgrounds.
    cardLight: "#EAF1F8",
    danger: "#C94A4A",
    bgLight: "#EAF1F8",
    bgDark: "#071633",
    cardDark: "#163E73",
    displayName: "NC+",
    // The catalog (DefaultLists.json) lists this brand's company entry as
    // "NC+ Hybrids", not "NC+" — see the comment on Midwest's
    // catalogBrandName above for why this field exists separately from
    // displayName.
    catalogBrandName: "NC+ Hybrids",
    logo: "/logos/ncplus.png",
    operationsEmail: "operations@nc-pluse.com",
  },
};

/**
 * @param {string|null|undefined} brandId
 * @returns {typeof BRANDS[BrandId]|null}
 */
export function getBrand(brandId) {
  if (!brandId) return null;
  return BRANDS[brandId] || null;
}

/**
 * Returns a copy of `entries` with .brand relabeled for display purposes
 * when a Brand View is selected: any entry belonging to the *other*
 * brand (matched by its catalogBrandName) is shown under the currently
 * selected brand's catalogBrandName instead — e.g. with "Midwest Seed
 * Genetics" selected as the Brand View, every "NC+ Hybrids" entry
 * displays (and groups, for brand averages) as "Midwest Seed Genetics",
 * and the mirror image happens when "NC+" is selected. Entries for any
 * other/third-party brand are left untouched.
 *
 * Only meant for the Plot Summary screen and its PDF export — Plot
 * Entries editing and the XLSX export intentionally keep entries' real
 * (unrelabeled) brand, since those are the source-of-truth data.
 * @param {import('../core/models.js').PlotEntry[]} entries
 * @param {typeof BRANDS[BrandId]|null} brand - the currently selected Brand View
 * @returns {import('../core/models.js').PlotEntry[]}
 */
export function entriesForBrandView(entries, brand) {
  if (!brand) return entries;
  const otherBrand = brand.id === "midwestSeedGenetics" ? BRANDS.ncPlus : BRANDS.midwestSeedGenetics;
  return entries.map((entry) =>
    entry.brand.trim() === otherBrand.catalogBrandName ? { ...entry, brand: brand.catalogBrandName } : entry
  );
}

/**
 * Applies a brand's palette as CSS custom properties on :root. Safe to
 * call with null to reset to the default (Midwest) palette used by the
 * BrandSelect screen before any brand is chosen.
 * @param {string|null|undefined} brandId
 */
export function applyBrandTheme(brandId) {
  const brand = getBrand(brandId) || BRANDS.midwestSeedGenetics;
  const root = document.documentElement;
  // Lets CSS target brand-specific one-offs (see .box-plot-box's NC+
  // override in styles.css) without needing a matching JS-set custom
  // property for every such case.
  root.setAttribute("data-brand", brand.id);
  root.style.setProperty("--accent", brand.accent);
  root.style.setProperty("--accent-light", brand.accentLight);
  root.style.setProperty("--accent-pale", brand.accentPale);
  root.style.setProperty("--highlight", brand.highlight);
  root.style.setProperty("--chrome", brand.chrome);
  root.style.setProperty("--danger", brand.danger);
  root.style.setProperty("--bg-light", brand.bgLight);
  root.style.setProperty("--bg-dark", brand.bgDark);
  root.style.setProperty("--card-light", brand.cardLight);
  root.style.setProperty("--card-dark", brand.cardDark);
  root.style.setProperty("--theme-color", brand.chrome);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", brand.chrome);
}
