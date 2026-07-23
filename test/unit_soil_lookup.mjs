// Pure-logic unit tests for public/js/core/soilLookup.js — no browser
// needed, just Node's built-in ESM loader + fetch (Node 18+).
import {
  buildSoilTextureQuery,
  parseSdaTableRows,
  pickDominantSurfaceTexture,
  normalizeTextureClass,
  fetchSoilTypeForCoordinates,
} from "../public/js/core/soilLookup.js";

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

const CANONICAL = [
  "Clay",
  "Sandy Clay",
  "Sandy Clay Loam",
  "Sandy Loam",
  "Loamy Sand",
  "Sand",
  "Silty Clay",
  "Clay Loam",
  "Loam",
  "Silty Clay Loam",
  "Silt Loam",
  "Silt",
];

// ---- buildSoilTextureQuery ----
{
  const q = buildSoilTextureQuery(41.878, -93.097);
  check(q.includes("point(-93.097 41.878)"), `WKT point is (longitude latitude), not (lat, lon) (got query containing: ${q.match(/point\([^)]*\)/)})`);
  check(q.includes("SDA_Get_Mukey_from_intersection_with_WktWgs84"), "query uses the documented spatial point-intersection function");
  check(q.includes("ORDER BY c.comppct_r DESC"), "query orders by representative percentage descending (most prevalent first)");
  check(q.includes("ch.hzdept_r = 0"), "query filters to the surface horizon (hzdept_r = 0)");
}

// ---- parseSdaTableRows: both response shapes ----
{
  const columnNameShape = { Table: [{ compname: "A", comppct_r: 70, texdesc: "Silt loam" }] };
  const rows1 = parseSdaTableRows(columnNameShape);
  check(rows1.length === 1 && rows1[0].texdesc === "Silt loam", `JSON+COLUMNNAME shape parses directly (got ${JSON.stringify(rows1)})`);

  const headerRowShape = { Table: [["compname", "comppct_r", "texdesc"], ["A", 70, "Silt loam"], ["B", 30, "Loam"]] };
  const rows2 = parseSdaTableRows(headerRowShape);
  check(
    rows2.length === 2 && rows2[0].texdesc === "Silt loam" && rows2[1].compname === "B",
    `plain JSON (header-row-first) shape is zipped correctly (got ${JSON.stringify(rows2)})`
  );

  check(parseSdaTableRows({}).length === 0, "missing Table -> empty array, not a throw");
  check(parseSdaTableRows(null).length === 0, "null response -> empty array, not a throw");
}

// ---- pickDominantSurfaceTexture ----
{
  const rows = [
    { compname: "Water", comppct_r: 40, texdesc: null },
    { compname: "B", comppct_r: 35, texdesc: "Loam" },
    { compname: "A", comppct_r: 55, texdesc: "Silt loam" },
  ];
  check(
    pickDominantSurfaceTexture(rows) === "Silt loam",
    `picks the highest-comppct_r row that HAS a texture, skipping a higher-ranked row with none (got "${pickDominantSurfaceTexture(rows)}")`
  );
  check(pickDominantSurfaceTexture([]) === null, "empty rows -> null");
  check(pickDominantSurfaceTexture([{ compname: "Water", comppct_r: 100, texdesc: "" }]) === null, "only blank texdescs -> null");
}

// ---- normalizeTextureClass ----
{
  const cases = [
    ["Silt loam", "Silt Loam"],
    ["SILTY CLAY LOAM", "Silty Clay Loam"],
    ["Very gravelly silt loam", "Silt Loam"],
    ["Extremely stony sandy loam", "Sandy Loam"],
    ["Fine sandy loam", "Sandy Loam"],
    ["Loamy fine sand", "Loamy Sand"],
    ["Silt loam, high organic matter", "Silt Loam"],
    ["Mucky silt loam", "Silt Loam"],
    ["Clay", "Clay"],
    ["Sandy clay loam", "Sandy Clay Loam"],
  ];
  for (const [raw, expected] of cases) {
    const got = normalizeTextureClass(raw, CANONICAL);
    check(got === expected, `"${raw}" -> "${expected}" (got "${got}")`);
  }
  check(normalizeTextureClass("Water", CANONICAL) === null, `unrecognized texture ("Water") -> null, not a wrong guess`);
  check(normalizeTextureClass(null, CANONICAL) === null, "null input -> null");
  check(normalizeTextureClass("", CANONICAL) === null, "empty string input -> null");
}

// ---- fetchSoilTypeForCoordinates: end-to-end with an injected fetch ----
{
  const okFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    check(url.includes("sdmdataaccess.nrcs.usda.gov"), "posts to the documented SDA endpoint");
    check(typeof body.query === "string" && body.query.includes("SDA_Get_Mukey_from_intersection_with_WktWgs84"), "request body carries the spatial SQL query");
    return {
      ok: true,
      json: async () => ({
        Table: [{ compname: "A", comppct_r: 62, hzdept_r: 0, texdesc: "Very gravelly silt loam" }],
      }),
    };
  };
  const result = await fetchSoilTypeForCoordinates(41.878, -93.097, CANONICAL, { fetchImpl: okFetch });
  check(result === "Silt Loam", `end-to-end success maps a real-shaped response to "Silt Loam" (got "${result}")`);
}
{
  const notOkFetch = async () => ({ ok: false, status: 500 });
  const result = await fetchSoilTypeForCoordinates(41.878, -93.097, CANONICAL, { fetchImpl: notOkFetch });
  check(result === null, "non-OK HTTP response -> null, not a throw");
}
{
  const throwingFetch = async () => {
    throw new Error("network down");
  };
  const result = await fetchSoilTypeForCoordinates(41.878, -93.097, CANONICAL, { fetchImpl: throwingFetch });
  check(result === null, "a thrown network error -> null, not a throw propagating to the caller");
}
{
  const emptyFetch = async () => ({ ok: true, json: async () => ({ Table: [] }) });
  const result = await fetchSoilTypeForCoordinates(41.878, -93.097, CANONICAL, { fetchImpl: emptyFetch });
  check(result === null, "empty Table (point outside SSURGO coverage) -> null");
}
{
  const result = await fetchSoilTypeForCoordinates(NaN, -93.097, CANONICAL, { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  check(result === null, "non-finite coordinates -> null without even attempting a fetch");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
