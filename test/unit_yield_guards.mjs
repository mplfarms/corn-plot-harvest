// Unit-tests the RC-audit accuracy guards in core/yieldCalculator.js:
//   1. gross() returns null (blank) — never NaN or a wrong number —
//      when the header is missing any of its three pricing inputs
//      (base moisture / price per bushel / drying shrink rate), e.g. an
//      older/imported plot or a field cleared mid-edit (which now
//      stores null, not 0 — see trialDetails.js).
//   2. rmNumericValue() extracts the digits from a Relative Maturity
//      like "111 CRM" for the numeric export cells (approved fix:
//      export the digits rather than a silently blank cell).
import { gross, rmNumericValue } from "../public/js/core/yieldCalculator.js";

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`PASS: ${label}`);
  else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

const entry = {
  moisturePercent: "18.2",
  manualDryYield: "172.3167",
  sampleNetWeightLbs: "",
  testWeight: "",
  stripLengthFeet: "",
  numberOfRows: "",
  widthInches: "",
};
const goodHeader = { baseMoisturePercent: 15.5, pricePerBushel: 3.5, dryingShrinkRate: 0.06 };

// ---- gross() with a complete header: the known-good number ----
const g = gross(entry, goodHeader);
check(Math.abs(g - 575.1931) < 0.001, `complete header computes the verified Gross (got ${g})`);

// ---- gross() guards: every missing/invalid pricing input -> null ----
for (const [label, patch] of [
  ["pricePerBushel null (cleared field)", { pricePerBushel: null }],
  ["pricePerBushel undefined (older plot)", { pricePerBushel: undefined }],
  ["dryingShrinkRate null", { dryingShrinkRate: null }],
  ["dryingShrinkRate undefined", { dryingShrinkRate: undefined }],
  ["baseMoisturePercent null", { baseMoisturePercent: null }],
  ["baseMoisturePercent NaN", { baseMoisturePercent: NaN }],
]) {
  const out = gross(entry, { ...goodHeader, ...patch });
  check(out === null, `${label} -> gross is null, never NaN/wrong (got ${out})`);
}

// A zero price is a REAL (if odd) number — still computes, not blanked.
check(gross(entry, { ...goodHeader, pricePerBushel: 0 }) === -27.919999999999998 || Math.abs(gross(entry, { ...goodHeader, pricePerBushel: 0 }) - -27.92) < 0.01, "an explicit 0 price still computes (deduction only) — 0 is a number, only null/missing blanks it");

// ---- rmNumericValue() ----
for (const [input, expected] of [
  ["111 CRM", 111],
  ["104", 104],
  [" 98.5 RM ", 98.5],
  ["CRM 102", 102],
  ["unknown", null],
  ["", null],
  [null, null],
]) {
  const out = rmNumericValue(input);
  check(out === expected, `rmNumericValue(${JSON.stringify(input)}) === ${expected} (got ${out})`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
