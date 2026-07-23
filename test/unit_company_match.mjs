// Unit-tests core/companyMatch.js's canonicalizeCompanyName() — the
// "is this an obvious duplicate of an existing company" logic used by
// adminPlots.js's Hybrid Catalog upload before rows are sent to
// netlify/functions/hybridCatalog.js (see that module's top comment for
// the full rationale). Includes the exact 16-brand case this was built
// against (Corn_Hybrids_AllBrands_clean_1.xlsx vs. this app's real
// DefaultLists.json), so a future edit to either the matching rule or
// the company list can't silently break that real-world case.

import { coreCompanyKey, canonicalizeCompanyName } from "../public/js/core/companyMatch.js";
import { readFileSync } from "node:fs";

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

const defaultLists = JSON.parse(readFileSync(new URL("../public/DefaultLists.json", import.meta.url)));
const existingCompanies = defaultLists.companies;

// ---- the real 16-brand case this feature was built against ----
{
  const uploadedBrands = {
    AgriGold: "Agrigold",
    "Beck's": "Becks",
    Brevant: "Brevant Seeds",
    CROPLAN: "Croplan",
    Channel: "Channel",
    DeKalb: "Dekalb",
    "Dyna-Gro": "Dyna-Gro",
    "Golden Harvest": "Golden Harvest",
    Hoegemeyer: "Hoegemeyer",
    Mustang: "Mustang Seeds",
    NK: "NK Brand",
    NuTech: "NuTech Seed",
    Pioneer: "Pioneer",
    Stine: "Stine",
    Thunder: "Thunder Seed",
    Wyffels: "Wyffels",
  };
  for (const [uploaded, expectedExisting] of Object.entries(uploadedBrands)) {
    const got = canonicalizeCompanyName(uploaded, existingCompanies);
    check(got === expectedExisting, `"${uploaded}" canonicalizes to the existing "${expectedExisting}" (got "${got}")`);
  }
}

// ---- no false collisions among the existing company list itself ----
{
  const buckets = new Map();
  for (const c of existingCompanies) {
    const key = coreCompanyKey(c);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  const collisions = Array.from(buckets.entries()).filter(([, names]) => names.length > 1);
  check(collisions.length === 0, `no two of this app's ~${existingCompanies.length} existing companies core-match each other (collisions: ${JSON.stringify(collisions)})`);
}

// ---- a genuinely new company passes through unchanged ----
{
  const got = canonicalizeCompanyName("Some Brand New Seed Co", existingCompanies);
  check(got === "Some Brand New Seed Co", `an unmatched company name is returned as-is, not blocked or altered (got "${got}")`);
}

// ---- exact case-insensitive match (no filler-word stripping needed) ----
{
  const got = canonicalizeCompanyName("pioneer", existingCompanies);
  check(got === "Pioneer", `a plain case-insensitive match still works (got "${got}")`);
}

// ---- blank input ----
{
  check(canonicalizeCompanyName("", existingCompanies) === "", "a blank company name returns blank, not a crash");
  check(canonicalizeCompanyName("   ", existingCompanies) === "", "a whitespace-only company name returns blank");
}

// ---- re-uploading against a list that already includes a prior catalog upload's new company keeps using it (no duplicate) ----
{
  const knownIncludingPriorUpload = [...existingCompanies, "Some Brand New Seed Co"];
  const got = canonicalizeCompanyName("SOME BRAND NEW SEED CO", knownIncludingPriorUpload);
  check(got === "Some Brand New Seed Co", `a second upload of a previously-new company matches ITS established spelling, not creating a second duplicate (got "${got}")`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
