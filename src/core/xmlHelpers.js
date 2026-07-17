// src/core/xmlHelpers.js
//
// Faithful port of XML-escaping and cell-building helpers used by the
// XLSX builder. Formatting details (integer vs. trimmed-decimal) must
// match the original Swift implementation exactly.

/**
 * @param {string} s
 * @returns {string}
 */
export function escapeXml(s) {
  let out = String(s);
  out = out.replace(/&/g, "&amp;");
  out = out.replace(/</g, "&lt;");
  out = out.replace(/>/g, "&gt;");
  out = out.replace(/"/g, "&quot;");
  out = out.replace(/\r\n/g, "\n");
  out = out.replace(/\r/g, "\n");
  return out;
}

/**
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
  if (value === Math.round(value) && Math.abs(value) < 1e15) {
    let intVal = Math.trunc(value);
    if (Object.is(intVal, -0)) intVal = 0;
    return String(intVal);
  }
  let s = value.toFixed(6);
  s = s.replace(/0+$/, "");
  s = s.replace(/\.$/, "");
  return s;
}

/**
 * @param {string} ref cell reference, e.g. "B2"
 * @param {number} style style index
 * @param {string} text
 * @returns {string}
 */
export function cellInline(ref, style, text) {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") {
    return `<c r="${ref}" s="${style}"/>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(trimmed)}</t></is></c>`;
}

/**
 * @param {string} ref
 * @param {number} style
 * @param {number|null|undefined} value
 * @returns {string}
 */
export function cellNum(ref, style, value) {
  if (value === null || value === undefined) {
    return `<c r="${ref}" s="${style}"/>`;
  }
  return `<c r="${ref}" s="${style}"><v>${formatNumber(value)}</v></c>`;
}

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
