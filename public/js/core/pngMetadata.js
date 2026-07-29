// src/core/pngMetadata.js
//
// Embeds the plot's GPS location into a PNG's metadata — per explicit
// request. Two complementary forms are written, both standard PNG:
//
//  1. An `eXIf` chunk carrying a real EXIF GPS IFD (GPSLatitude/
//     GPSLongitude + hemisphere refs, as degree/minute/second
//     rationals). This is the same structure camera photos use, so
//     photo apps that read location from pictures (e.g. a phone's photo
//     library "places" view, desktop photo tools) can see where the
//     plot is.
//  2. A `tEXt` chunk ("Description") with the same coordinates as
//     plain human-readable text, for tools that show text metadata but
//     don't parse EXIF.
//
// Pure byte-level work on the PNG structure — no DOM, no canvas — so
// it runs (and is unit-tested) in Node as well as the browser. PNG is
// a signature followed by length/type/data/CRC chunks; metadata chunks
// are inserted immediately after the mandatory IHDR chunk, which is
// where ancillary chunks conventionally live.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// ---- CRC-32 (the PNG chunk checksum) ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number} unsigned CRC-32
 */
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- little building blocks ----

/**
 * @param {string} type 4-char chunk type
 * @param {Uint8Array} data
 * @returns {Uint8Array} full chunk: length + type + data + CRC
 */
function buildChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A latin-1 `tEXt` chunk (keyword NUL text).
 * @param {string} keyword
 * @param {string} text
 * @returns {Uint8Array}
 */
function buildTextChunk(keyword, text) {
  const payload = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) payload[i] = keyword.charCodeAt(i) & 0xff;
  payload[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) payload[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
  return buildChunk("tEXt", payload);
}

/**
 * A decimal coordinate as EXIF's three degree/minute/second rationals.
 * Seconds keep 4 decimal places (sub-centimeter precision) via a
 * denominator of 10000.
 * @param {number} value absolute decimal degrees
 * @returns {Array<[number, number]>} [[deg,1],[min,1],[sec*1e4,1e4]]
 */
function toDmsRationals(value) {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 10000);
  return [
    [deg, 1],
    [min, 1],
    [sec, 10000],
  ];
}

/**
 * A minimal little-endian EXIF (TIFF) blob whose IFD0 holds only the
 * GPS-IFD pointer, and whose GPS IFD holds version + latitude +
 * longitude. That's everything needed for "where was this taken".
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Uint8Array}
 */
function buildGpsExif(latitude, longitude) {
  // Fixed layout (all offsets are from the TIFF header start):
  //   0: TIFF header (8 bytes: "II", 42, IFD0 offset = 8)
  //   8: IFD0 — count(2) + 1 entry(12) + next(4) = 18 bytes
  //  26: GPS IFD — count(2) + 5 entries(60) + next(4) = 66 bytes
  //  92: data area — 6 rationals × 8 bytes = 48 bytes
  const GPS_IFD_OFFSET = 26;
  const DATA_OFFSET = 92;
  const TOTAL = DATA_OFFSET + 48;
  const out = new Uint8Array(TOTAL);
  const view = new DataView(out.buffer);

  // TIFF header, little-endian ("II").
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);

  let p = 8;
  const entry = (tag, type, count, valueWriter) => {
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    valueWriter(p + 8);
    p += 12;
  };

  // IFD0: just the GPS IFD pointer (tag 0x8825, LONG).
  view.setUint16(p, 1, true);
  p += 2;
  entry(0x8825, 4, 1, (at) => view.setUint32(at, GPS_IFD_OFFSET, true));
  view.setUint32(p, 0, true); // no next IFD
  p += 4;

  // GPS IFD (entries in ascending tag order, as EXIF requires).
  const latRef = latitude >= 0 ? "N" : "S";
  const lonRef = longitude >= 0 ? "E" : "W";
  view.setUint16(p, 5, true);
  p += 2;
  entry(0x0000, 1, 4, (at) => {
    out[at] = 2; // GPSVersionID 2.3.0.0
    out[at + 1] = 3;
  });
  entry(0x0001, 2, 2, (at) => {
    out[at] = latRef.charCodeAt(0);
  });
  entry(0x0002, 5, 3, (at) => view.setUint32(at, DATA_OFFSET, true));
  entry(0x0003, 2, 2, (at) => {
    out[at] = lonRef.charCodeAt(0);
  });
  entry(0x0004, 5, 3, (at) => view.setUint32(at, DATA_OFFSET + 24, true));
  view.setUint32(p, 0, true); // no next IFD

  // Rational data: latitude's 3, then longitude's 3.
  const rationals = [...toDmsRationals(latitude), ...toDmsRationals(longitude)];
  rationals.forEach(([num, den], i) => {
    view.setUint32(DATA_OFFSET + i * 8, num, true);
    view.setUint32(DATA_OFFSET + i * 8 + 4, den, true);
  });

  return out;
}

/**
 * True when `bytes` starts with the PNG signature.
 * @param {Uint8Array} bytes
 */
function isPng(bytes) {
  return bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Inserts GPS metadata (eXIf + human-readable tEXt) into a PNG's bytes,
 * right after its IHDR chunk. Returns a NEW Uint8Array; the input is
 * never modified. Returns the input unchanged (same reference) if it
 * isn't a PNG or the coordinates aren't finite numbers — callers can
 * pass whatever they have and always get valid bytes back.
 * @param {Uint8Array} bytes the original PNG
 * @param {{latitude: number, longitude: number, description?: string}} meta
 * @returns {Uint8Array}
 */
export function embedGpsMetadata(bytes, { latitude, longitude, description }) {
  if (!isPng(bytes)) return bytes;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return bytes;
  }

  // IHDR is required to be first: signature (8) + length(4) + "IHDR"(4)
  // + 13 data bytes + CRC(4) — ends at byte 33. Verified, not assumed.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLen = view.getUint32(8);
  const typeStr = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (typeStr !== "IHDR") return bytes;
  const insertAt = 8 + 12 + ihdrLen;

  const exifChunk = buildChunk("eXIf", buildGpsExif(latitude, longitude));
  const textChunk = buildTextChunk(
    "Description",
    description || `GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
  );

  const out = new Uint8Array(bytes.length + exifChunk.length + textChunk.length);
  out.set(bytes.subarray(0, insertAt), 0);
  out.set(exifChunk, insertAt);
  out.set(textChunk, insertAt + exifChunk.length);
  out.set(bytes.subarray(insertAt), insertAt + exifChunk.length + textChunk.length);
  return out;
}
