// src/core/zipWriter.js
//
// Minimal dependency-free ZIP writer (STORED method, no compression).
// This produces fully valid, spec-compliant ZIP files — Excel opens
// uncompressed-entry .xlsx packages without complaint — so XLSX export
// has zero external dependencies and works fully offline.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit CRC
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Fixed DOS date/time for 1980-01-01 00:00:00 (Excel does not care about
 * the timestamp of ZIP entries in an .xlsx package).
 */
const DOS_TIME = 0; // hh=0 mm=0 ss=0
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // year offset 0 (1980), month 1, day 1

/**
 * @param {string|ArrayBuffer|Uint8Array} data
 * @returns {Uint8Array}
 */
function toBytes(data) {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  throw new TypeError("ZipWriter.addFile: data must be a string, ArrayBuffer, or Uint8Array");
}

function writeUint16LE(view, offset, value) {
  view.setUint16(offset, value, true);
}
function writeUint32LE(view, offset, value) {
  view.setUint32(offset, value, true);
}

export class ZipWriter {
  constructor() {
    /** @type {{path: string, bytes: Uint8Array, crc: number}[]} */
    this._entries = [];
  }

  /**
   * @param {string} path
   * @param {string|ArrayBuffer|Uint8Array} dataStringOrArrayBuffer
   */
  addFile(path, dataStringOrArrayBuffer) {
    const bytes = toBytes(dataStringOrArrayBuffer);
    const crc = crc32(bytes);
    this._entries.push({ path, bytes, crc });
  }

  /**
   * @returns {Blob}
   */
  finalize() {
    const GP_FLAG = 1 << 11; // bit 11: language encoding flag (EFS), UTF-8 names/comments
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of this._entries) {
      const nameBytes = new TextEncoder().encode(entry.path);
      const size = entry.bytes.length;

      // Local file header
      const local = new ArrayBuffer(30);
      const lv = new DataView(local);
      writeUint32LE(lv, 0, 0x04034b50); // local file header signature
      writeUint16LE(lv, 4, 20); // version needed to extract
      writeUint16LE(lv, 6, GP_FLAG); // general purpose bit flag
      writeUint16LE(lv, 8, 0); // compression method: stored
      writeUint16LE(lv, 10, DOS_TIME);
      writeUint16LE(lv, 12, DOS_DATE);
      writeUint32LE(lv, 14, entry.crc);
      writeUint32LE(lv, 18, size); // compressed size
      writeUint32LE(lv, 22, size); // uncompressed size
      writeUint16LE(lv, 26, nameBytes.length);
      writeUint16LE(lv, 28, 0); // extra field length

      localParts.push(new Uint8Array(local), nameBytes, entry.bytes);

      const localHeaderOffset = offset;
      offset += 30 + nameBytes.length + size;

      // Central directory header
      const central = new ArrayBuffer(46);
      const cv = new DataView(central);
      writeUint32LE(cv, 0, 0x02014b50); // central file header signature
      writeUint16LE(cv, 4, 20); // version made by
      writeUint16LE(cv, 6, 20); // version needed to extract
      writeUint16LE(cv, 8, GP_FLAG);
      writeUint16LE(cv, 10, 0); // compression method
      writeUint16LE(cv, 12, DOS_TIME);
      writeUint16LE(cv, 14, DOS_DATE);
      writeUint32LE(cv, 16, entry.crc);
      writeUint32LE(cv, 20, size);
      writeUint32LE(cv, 24, size);
      writeUint16LE(cv, 28, nameBytes.length);
      writeUint16LE(cv, 30, 0); // extra field length
      writeUint16LE(cv, 32, 0); // file comment length
      writeUint16LE(cv, 34, 0); // disk number start
      writeUint16LE(cv, 36, 0); // internal file attributes
      writeUint32LE(cv, 38, 0); // external file attributes
      writeUint32LE(cv, 42, localHeaderOffset);

      centralParts.push(new Uint8Array(central), nameBytes);
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const p of centralParts) centralDirSize += p.length;

    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    writeUint32LE(ev, 0, 0x06054b50); // end of central directory signature
    writeUint16LE(ev, 4, 0); // number of this disk
    writeUint16LE(ev, 6, 0); // disk where central directory starts
    writeUint16LE(ev, 8, this._entries.length); // number of central directory records on this disk
    writeUint16LE(ev, 10, this._entries.length); // total number of central directory records
    writeUint32LE(ev, 12, centralDirSize);
    writeUint32LE(ev, 16, centralDirOffset);
    writeUint16LE(ev, 20, 0); // comment length

    const allParts = [...localParts, ...centralParts, new Uint8Array(eocd)];
    return new Blob(allParts, { type: "application/zip" });
  }
}
