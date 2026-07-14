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
    logo: "/logos/midwest.png",
    operationsEmail: "operations@midwestseed.com",
  },
  ncPlus: {
    id: "ncPlus",
    accent: "#D7282F",
    accentLight: "#E2555B",
    accentPale: "#EDA0A3",
    highlight: "#FFDC32",
    chrome: "#4A1013",
    // Background tokens use NC+'s official "Seed Corn+" identity blue
    // (HEX 215AA8, per NC+ Brand Standards Annex I) — pale/dark tints of
    // it, mirroring how Midwest's bgLight/bgDark are tints of its accent
    // rather than the saturated brand color itself (keeps body text
    // readable). Accent/highlight/chrome stay the brand's red/yellow —
    // only the background was asked to change.
    cardLight: "#EAF1F8",
    danger: "#C94A4A",
    bgLight: "#EAF1F8",
    bgDark: "#071633",
    cardDark: "#163E73",
    displayName: "NC+",
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
 * Applies a brand's palette as CSS custom properties on :root. Safe to
 * call with null to reset to the default (Midwest) palette used by the
 * BrandSelect screen before any brand is chosen.
 * @param {string|null|undefined} brandId
 */
export function applyBrandTheme(brandId) {
  const brand = getBrand(brandId) || BRANDS.midwestSeedGenetics;
  const root = document.documentElement;
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
