// Unit-tests the three Netlify Functions (auth.js, plots.js,
// adminUsers.js) against an in-memory mock of @netlify/blobs, since this
// sandbox has no network access to a real Blobs-backed Netlify site.
// Verifies: sign-in creates + updates records with just an email (no
// name required, no passcode of any kind — both dropped per explicit
// request; name defaults to the email itself), the bootstrap admin
// self-heals to isAdmin on every sign-in, each user only ever sees their
// own trials via scope=self, admin-only gating (scope=all,
// adminUsers.js) is based purely on the caller's own stored isAdmin flag,
// and that an admin can't delete their own account.
//
// Mocks Node's module resolution for "@netlify/blobs" so the real
// functions' source is exercised unmodified — see the Module._load
// override below.

import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

// ---- in-memory Blobs store mock ----
function makeStore() {
  const data = new Map(); // key -> {value, metadata}
  return {
    async get(key, opts) {
      const rec = data.get(key);
      if (!rec) return null;
      return opts && opts.type === "json" ? rec.value : JSON.stringify(rec.value);
    },
    async getMetadata(key) {
      const rec = data.get(key);
      return rec ? { metadata: rec.metadata || {} } : null;
    },
    async setJSON(key, value, opts) {
      data.set(key, { value, metadata: (opts && opts.metadata) || {} });
    },
    async delete(key) {
      data.delete(key);
    },
    async list() {
      return { blobs: Array.from(data.keys()).map((key) => ({ key })) };
    },
    _raw: data,
  };
}

const usersStore = makeStore();
const plotsStore = makeStore();
const stores = { users: usersStore, plots: plotsStore };

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@netlify/blobs") {
    return path.join(process.cwd(), "test", "_mock_netlify_blobs.cjs");
  }
  return originalResolve.call(this, request, ...rest);
};

// Write the mock module the resolver above points to, backed by the same
// stores object so functions under test share state across calls.
import fs from "node:fs";
fs.writeFileSync(
  path.join(process.cwd(), "test", "_mock_netlify_blobs.cjs"),
  `
  const stores = globalThis.__cph_test_stores__;
  module.exports = {
    connectLambda: () => {},
    getStore: (name) => stores[name],
  };
  `
);
globalThis.__cph_test_stores__ = stores;

const auth = (await import("../netlify/functions/auth.js")).handler;
const plots = (await import("../netlify/functions/plots.js")).handler;
const adminUsers = (await import("../netlify/functions/adminUsers.js")).handler;
const deleteAccount = (await import("../netlify/functions/deleteAccount.js")).handler;
const updateProfile = (await import("../netlify/functions/updateProfile.js")).handler;

let failures = 0;
function check(cond, label) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures++;
  }
}

function post(body) {
  return { httpMethod: "POST", body: JSON.stringify(body), queryStringParameters: {} };
}
function get(query) {
  return { httpMethod: "GET", queryStringParameters: query, body: null };
}

// ---- auth.js ----
let res = await auth(post({ email: "mplfarms@aol.com" }));
let body = JSON.parse(res.body);
check(res.statusCode === 200, "bootstrap admin sign-in succeeds (200) with no name or passcode involved");
check(body.user.isAdmin === true, "bootstrap admin email is automatically isAdmin=true on first sign-in");
check(body.user.name === "mplfarms@aol.com", "name defaults to the email itself when none is supplied");
check(body.isNewUser === true, "first-ever sign-in for an email reports isNewUser=true");

res = await auth(post({ email: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
check(body.isNewUser === false, "signing in again with the same email reports isNewUser=false");

res = await auth(post({ email: "Jamie@Example.com" }));
body = JSON.parse(res.body);
check(res.statusCode === 200, "regular user sign-in succeeds (200)");
check(body.user.isAdmin === false, "regular user is not admin by default");
check(body.user.email === "jamie@example.com", "email is normalized to lowercase");
check(body.user.name === "jamie@example.com", "regular user's name also defaults to their (normalized) email");
check(body.isNewUser === true, "a brand-new email also reports isNewUser=true");

res = await auth(post({ email: "not-an-email" }));
check(res.statusCode === 400, "invalid email format rejected (400)");

res = await auth(post({}));
check(res.statusCode === 400, "missing email rejected (400)");

// An explicitly-passed name is still honored (kept for flexibility, even
// though the current sign-in form's first call never sends one — see
// accountScreen.js's isNewUser-triggered follow-up call, which does).
res = await auth(post({ name: "Jamie Farmer", email: "jamie@example.com" }));
body = JSON.parse(res.body);
check(body.user.name === "Jamie Farmer", "an explicitly supplied name overrides the email default");
check(body.isNewUser === false, "the follow-up name-setting call (existing account) reports isNewUser=false");

// Re-signing-in as bootstrap admin after manually clearing isAdmin should self-heal.
usersStore._raw.get("mplfarms@aol.com.json").value.isAdmin = false;
res = await auth(post({ email: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
check(body.user.isAdmin === true, "bootstrap admin self-heals isAdmin=true on every sign-in");

// ---- plots.js ----
res = await plots(get({}));
check(res.statusCode === 400, "plots GET rejects a request with no email (400)");

res = await plots({
  httpMethod: "PUT",
  body: JSON.stringify({ email: "jamie@example.com", trials: [{ id: "t1" }] }),
});
check(res.statusCode === 200, "plots PUT succeeds for a signed-in user (200) with just an email");

res = await plots(get({ email: "jamie@example.com" }));
body = JSON.parse(res.body);
check(body.trials.length === 1 && body.trials[0].id === "t1", "plots GET (self scope) returns the trial just saved");

// A different user's plots must stay isolated — signing in as someone
// else must never leak jamie's trials back under scope=self.
res = await plots({
  httpMethod: "PUT",
  body: JSON.stringify({ email: "someoneelse@example.com", trials: [{ id: "t2" }] }),
});
check(res.statusCode === 200, "second user's plots PUT succeeds (200)");
res = await plots(get({ email: "someoneelse@example.com" }));
body = JSON.parse(res.body);
check(
  body.trials.length === 1 && body.trials[0].id === "t2",
  "each user's scope=self only ever returns their own trials, never another user's"
);

res = await plots(get({ email: "jamie@example.com", scope: "all" }));
check(res.statusCode === 403, "non-admin is rejected from scope=all (403)");

res = await plots(get({ email: "mplfarms@aol.com", scope: "all" }));
body = JSON.parse(res.body);
check(res.statusCode === 200, "admin can use scope=all (200)");
const jamieEntry = body.users.find((u) => u.email === "jamie@example.com");
check(Boolean(jamieEntry) && jamieEntry.name === "Jamie Farmer", "scope=all includes each user's name alongside their trials");
check(body.users.length === 2, "scope=all includes every user, not just the admin (got " + body.users.length + ")");

// ---- plots.js PUT with adminEmail (admin editing someone else's plots — see adminEditStore.js) ----
res = await plots({
  httpMethod: "PUT",
  body: JSON.stringify({
    email: "jamie@example.com",
    trials: [{ id: "hacked", header: {}, entries: [] }],
    adminEmail: "someoneelse@example.com", // never signed in via auth.js — no user record at all
  }),
});
check(res.statusCode === 403, "a non-admin (or unknown) adminEmail is rejected from writing another user's trials (403)");
res = await plots(get({ email: "jamie@example.com" }));
body = JSON.parse(res.body);
check(
  body.trials.length === 1 && body.trials[0].id === "t1",
  "the rejected PUT above never actually overwrote jamie's real trials"
);

res = await plots({
  httpMethod: "PUT",
  body: JSON.stringify({
    email: "jamie@example.com",
    trials: [{ id: "t1", header: { cooperatorName: "Edited By Admin" }, entries: [] }],
    adminEmail: "mplfarms@aol.com", // the real bootstrap admin
  }),
});
check(res.statusCode === 200, "a real admin CAN write another user's trials via adminEmail (200)");
res = await plots(get({ email: "jamie@example.com" }));
body = JSON.parse(res.body);
check(
  body.trials[0].header.cooperatorName === "Edited By Admin",
  "the admin's write actually landed in jamie's own trials"
);

res = await plots({
  httpMethod: "PUT",
  body: JSON.stringify({ email: "jamie@example.com", trials: [{ id: "t1", header: {}, entries: [] }], adminEmail: "jamie@example.com" }),
});
check(res.statusCode === 200, "adminEmail equal to the target email is just a normal self-save, no admin check (200)");

// ---- adminUsers.js ----
res = await adminUsers(get({ email: "jamie@example.com" }));
check(res.statusCode === 403, "non-admin rejected from adminUsers list (403)");

res = await adminUsers(get({ email: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
// Only mplfarms + jamie have actually signed in (registered a "users"
// record via auth.js) — "someoneelse@example.com" above only ever PUT
// trials directly and never called auth.js, so it has saved plots but no
// user record, and correctly does NOT show up here (adminUsers.js lists
// the "users" store, not the "plots" store).
check(res.statusCode === 200 && body.users.length === 2, `admin can list all registered users (got ${body.users && body.users.length})`);

res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({
    email: "mplfarms@aol.com",
    action: "setAdmin",
    targetEmail: "jamie@example.com",
    isAdmin: true,
  }),
});
body = JSON.parse(res.body);
check(res.statusCode === 200 && body.user.isAdmin === true, "admin can promote another user");

res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({
    email: "mplfarms@aol.com",
    action: "delete",
    targetEmail: "mplfarms@aol.com",
  }),
});
check(res.statusCode === 400, "admin cannot delete their own account (400)");

// ---- adminUsers.js merge action: same person, two accounts (e.g. one
// email used on a phone, a different one on a shared computer) ----
await auth(post({ email: "phone@example.com" }));
await auth(post({ email: "desktop@example.com" }));
await plots({
  httpMethod: "PUT",
  body: JSON.stringify({ email: "phone@example.com", trials: [{ id: "p1", header: { cooperatorName: "Plot A" }, entries: [] }] }),
});
await plots({
  httpMethod: "PUT",
  body: JSON.stringify({
    email: "desktop@example.com",
    trials: [
      { id: "p2", header: { cooperatorName: "Plot B" }, entries: [] },
      // Same id as one of phone@example.com's trials, simulating the
      // rare case where a plot was somehow already synced under both —
      // the merge must not end up with two copies of it.
      { id: "p1", header: { cooperatorName: "Plot A (desktop copy)" }, entries: [] },
    ],
  }),
});

res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({ email: "desktop@example.com", action: "merge", sourceEmail: "phone@example.com", targetEmail: "desktop@example.com" }),
});
check(res.statusCode === 403, "non-admin is rejected from merging accounts (403)");

res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({ email: "mplfarms@aol.com", action: "merge", sourceEmail: "phone@example.com", targetEmail: "phone@example.com" }),
});
check(res.statusCode === 400, "merging an account into itself is rejected (400)");

res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({ email: "mplfarms@aol.com", action: "merge", sourceEmail: "nobody@example.com", targetEmail: "desktop@example.com" }),
});
check(res.statusCode === 404, "merging a nonexistent source account is rejected (404)");

res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({ email: "mplfarms@aol.com", action: "merge", sourceEmail: "phone@example.com", targetEmail: "desktop@example.com" }),
});
body = JSON.parse(res.body);
check(res.statusCode === 200, "admin can merge one account into another (200)");
check(body.mergedTrialCount === 2, `the merge dedupes the colliding trial id instead of duplicating it (got ${body.mergedTrialCount})`);

check(!usersStore._raw.has("phone@example.com.json"), "the source account's user record is gone after merging");
check(!plotsStore._raw.has("phone@example.com.json"), "the source account's saved plots are gone after merging");

res = await plots(get({ email: "desktop@example.com" }));
body = JSON.parse(res.body);
const mergedIds = body.trials.map((t) => t.id).sort();
check(JSON.stringify(mergedIds) === JSON.stringify(["p1", "p2"]), `the target account now has both trials, deduped (got ${JSON.stringify(mergedIds)})`);
const mergedP1 = body.trials.find((t) => t.id === "p1");
check(
  mergedP1.header.cooperatorName === "Plot A (desktop copy)",
  "on a colliding id, the target's own copy is kept rather than being overwritten by the source's"
);

res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({
    email: "mplfarms@aol.com",
    action: "delete",
    targetEmail: "jamie@example.com",
  }),
});
check(res.statusCode === 200, "admin can delete another account (200)");
check(!usersStore._raw.has("jamie@example.com.json"), "deleted user's user record is gone");
check(!plotsStore._raw.has("jamie@example.com.json"), "deleted user's saved plots are also gone");

// ---- adminUsers.js merge action: transferredFrom tagging (non-colliding trial) ----
await auth(post({ email: "newphone@example.com" }));
await auth(post({ name: "Alex Grower", email: "alexdesktop@example.com" }));
await plots({
  httpMethod: "PUT",
  body: JSON.stringify({ email: "newphone@example.com", trials: [{ id: "np1", header: { cooperatorName: "New Phone Plot" }, entries: [] }] }),
});
res = await adminUsers({
  httpMethod: "POST",
  body: JSON.stringify({ email: "mplfarms@aol.com", action: "merge", sourceEmail: "newphone@example.com", targetEmail: "alexdesktop@example.com" }),
});
check(res.statusCode === 200, "merge with no colliding trial ids succeeds (200)");
res = await plots(get({ email: "alexdesktop@example.com" }));
body = JSON.parse(res.body);
const npTrial = body.trials.find((t) => t.id === "np1");
check(
  Boolean(npTrial && npTrial.transferredFrom && npTrial.transferredFrom.email === "newphone@example.com"),
  `a merged trial is tagged with transferredFrom (got ${JSON.stringify(npTrial && npTrial.transferredFrom)})`
);

// ---- deleteAccount.js: self-service "Delete My Account" ----
res = await deleteAccount(post({}));
check(res.statusCode === 400, "deleteAccount rejects a request with no email (400)");

res = await deleteAccount(post({ email: "totally-unknown@example.com" }));
check(res.statusCode === 404, "deleteAccount rejects an unregistered account (404)");

res = await deleteAccount(post({ email: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
check(
  res.statusCode === 400 && /can't delete itself/.test(body.error || ""),
  `the bootstrap admin can't self-delete via this endpoint (got ${res.statusCode} ${body.error})`
);
check(usersStore._raw.has("mplfarms@aol.com.json"), "the bootstrap admin's account is untouched after the rejected attempt");

await auth(post({ email: "grower@example.com" }));
await plots({
  httpMethod: "PUT",
  body: JSON.stringify({ email: "grower@example.com", trials: [{ id: "g1", header: { cooperatorName: "Grower Plot" }, entries: [] }] }),
});
res = await deleteAccount(post({ email: "grower@example.com" }));
body = JSON.parse(res.body);
check(res.statusCode === 200, "a regular user can self-delete (200)");
check(body.transferredCount === 1, `reports how many plots were transferred (got ${body.transferredCount})`);
check(body.transferredToEmail === "mplfarms@aol.com", "plots transfer to the bootstrap admin account");
check(!usersStore._raw.has("grower@example.com.json"), "the deleted user's own account record is gone");
check(!plotsStore._raw.has("grower@example.com.json"), "the deleted user's own saved plots are gone");

res = await plots(get({ email: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
const g1Trial = body.trials.find((t) => t.id === "g1");
check(
  Boolean(g1Trial && g1Trial.transferredFrom && g1Trial.transferredFrom.email === "grower@example.com"),
  `the transferred plot lands in the admin's own trials, tagged with transferredFrom (got ${JSON.stringify(g1Trial && g1Trial.transferredFrom)})`
);

// A trial that was already transferred once before (e.g. via an earlier
// admin merge) keeps its ORIGINAL transferredFrom tag through a second
// hop, rather than being re-tagged with the most recent account it
// passed through.
await auth(post({ email: "grower2@example.com" }));
await plots({
  httpMethod: "PUT",
  body: JSON.stringify({
    email: "grower2@example.com",
    trials: [
      {
        id: "g2",
        header: { cooperatorName: "Grower 2 Plot" },
        entries: [],
        transferredFrom: { email: "original-owner@example.com", name: "Original Owner" },
      },
    ],
  }),
});
res = await deleteAccount(post({ email: "grower2@example.com" }));
check(res.statusCode === 200, "a second self-delete (already-tagged trial) also succeeds (200)");
res = await plots(get({ email: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
const g2Trial = body.trials.find((t) => t.id === "g2");
check(
  Boolean(g2Trial && g2Trial.transferredFrom && g2Trial.transferredFrom.email === "original-owner@example.com"),
  `an already-tagged trial keeps its ORIGINAL transferredFrom through a second transfer (got ${JSON.stringify(g2Trial && g2Trial.transferredFrom)})`
);

// ---- auth.js: firstName/lastName/mobileNumber (the "Welcome!" form —
// see newUserDetailsModal.js), and a plain re-sign-in never blanks them
// out ----
res = await auth(post({ email: "newbie@example.com", firstName: "Casey", lastName: "Vander Berg", mobileNumber: "555-123-4567" }));
body = JSON.parse(res.body);
check(res.statusCode === 200, "sign-in with firstName/lastName/mobileNumber succeeds (200)");
check(body.user.firstName === "Casey" && body.user.lastName === "Vander Berg", "firstName/lastName are stored as supplied");
check(body.user.mobileNumber === "555-123-4567", "mobileNumber is stored as supplied");
check(body.user.name === "Casey Vander Berg", "name is computed by combining firstName + lastName");

// A plain returning sign-in (just {email}, no name/first/last/mobile —
// exactly what every normal login after the first sends, see
// accountScreen.js) must NOT blank out the name/first/last/phone that's
// already on file.
res = await auth(post({ email: "newbie@example.com" }));
body = JSON.parse(res.body);
check(
  body.user.name === "Casey Vander Berg" &&
    body.user.firstName === "Casey" &&
    body.user.lastName === "Vander Berg" &&
    body.user.mobileNumber === "555-123-4567",
  `a plain re-sign-in (no name fields sent) preserves the already-stored name/first/last/phone (got ${JSON.stringify(body.user)})`
);

// Legacy account created before firstName/lastName/mobileNumber existed
// (only `name` was ever passed) should still get sane, always-a-string
// values for the new fields rather than undefined/missing keys.
res = await auth(post({ name: "Legacy Person", email: "legacy@example.com" }));
body = JSON.parse(res.body);
check(
  body.user.firstName === "" && body.user.lastName === "" && body.user.mobileNumber === "",
  `an account with only a legacy \`name\` gets empty-string (not undefined) firstName/lastName/mobileNumber (got ${JSON.stringify(body.user)})`
);

// ---- plots.js scope=all + adminUsers.js list: admin-first, then
// alphabetical by last name, and every REGISTERED user gets their own
// card even with zero synced plots ----
await auth(post({ email: "zed@example.com", firstName: "Zed", lastName: "Zephyr" }));
await auth(post({ email: "amy@example.com", firstName: "Amy", lastName: "Anders" }));
// Zed syncs a plot; Amy never does — she should still get her own card.
await plots({ httpMethod: "PUT", body: JSON.stringify({ email: "zed@example.com", trials: [{ id: "z1", header: {}, entries: [] }] }) });
// An account that PUTs trials directly but never signs in via auth.js has
// no "users" record at all — scope=all must NOT show it (it now
// enumerates registered users, not plots blobs — see plots.js's
// handleGetAll).
await plots({
  httpMethod: "PUT",
  body: JSON.stringify({ email: "ghost-plots-only@example.com", trials: [{ id: "g1", header: {}, entries: [] }] }),
});

res = await plots(get({ email: "mplfarms@aol.com", scope: "all" }));
body = JSON.parse(res.body);
check(res.statusCode === 200, "admin scope=all still succeeds after adding more registered users (200)");
const orderedEmails = body.users.map((u) => u.email);
check(
  !orderedEmails.includes("ghost-plots-only@example.com"),
  `an account that only ever PUT trials (never signed in) does NOT get its own card (got ${JSON.stringify(orderedEmails)})`
);
const amyEntry = body.users.find((u) => u.email === "amy@example.com");
check(
  Boolean(amyEntry) && Array.isArray(amyEntry.trials) && amyEntry.trials.length === 0,
  `a registered user with zero synced plots still gets her own card, with an empty trials array (got ${JSON.stringify(amyEntry)})`
);
check(orderedEmails[0] === "mplfarms@aol.com", `the admin is always sorted first (got ${JSON.stringify(orderedEmails)})`);
const scopeAllTriple = orderedEmails.filter((e) => ["amy@example.com", "newbie@example.com", "zed@example.com"].includes(e));
check(
  JSON.stringify(scopeAllTriple) === JSON.stringify(["amy@example.com", "newbie@example.com", "zed@example.com"]),
  `non-admins sort alphabetically by last name — Anders, Vander Berg, Zephyr (got ${JSON.stringify(scopeAllTriple)})`
);

res = await adminUsers(get({ email: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
const listEmails = body.users.map((u) => u.email);
check(listEmails[0] === "mplfarms@aol.com", `Manage Users also always sorts the admin first (got ${JSON.stringify(listEmails)})`);
const listTriple = listEmails.filter((e) => ["amy@example.com", "newbie@example.com", "zed@example.com"].includes(e));
check(
  JSON.stringify(listTriple) === JSON.stringify(["amy@example.com", "newbie@example.com", "zed@example.com"]),
  `Manage Users sorts non-admins alphabetically by last name too (got ${JSON.stringify(listTriple)})`
);

// ---- updateProfile.js: self-edit and admin-edit-on-behalf-of ----
function postProfile(body) {
  return { httpMethod: "POST", body: JSON.stringify(body), queryStringParameters: {} };
}

res = await updateProfile(postProfile({}));
check(res.statusCode === 400, "updateProfile rejects a request with no email (400)");

res = await updateProfile(postProfile({ email: "nobody-registered@example.com", firstName: "X", lastName: "Y" }));
check(res.statusCode === 404, "updateProfile rejects an unregistered account (404)");

// Self-edit: no adminEmail, sets every field to exactly what's supplied.
res = await updateProfile(postProfile({ email: "amy@example.com", firstName: "Amy", lastName: "Andersen", mobileNumber: "555-999-8888" }));
body = JSON.parse(res.body);
check(res.statusCode === 200, "self-edit (no adminEmail) succeeds (200)");
check(
  body.user.firstName === "Amy" && body.user.lastName === "Andersen" && body.user.mobileNumber === "555-999-8888",
  `self-edit sets the fields to exactly what was supplied (got ${JSON.stringify(body.user)})`
);
check(body.user.name === "Amy Andersen", "name is recomputed from the new firstName + lastName");

// Explicit edit CAN clear a field to blank (unlike auth.js's sign-in
// call, which never blanks an already-stored field) — e.g. removing a
// phone number.
res = await updateProfile(postProfile({ email: "amy@example.com", firstName: "Amy", lastName: "Andersen", mobileNumber: "" }));
body = JSON.parse(res.body);
check(body.user.mobileNumber === "", `an explicit blank mobileNumber actually clears it (got "${body.user.mobileNumber}")`);

// A non-admin can't edit someone ELSE's profile.
res = await updateProfile(postProfile({ email: "amy@example.com", firstName: "Hacked", lastName: "Name", adminEmail: "newbie@example.com" }));
check(res.statusCode === 403, "a non-admin is rejected from editing another account's profile (403)");
res = await plots(get({ email: "mplfarms@aol.com", scope: "all" }));
body = JSON.parse(res.body);
const amyAfterRejectedEdit = body.users.find((u) => u.email === "amy@example.com");
check(
  amyAfterRejectedEdit && amyAfterRejectedEdit.firstName === "Amy",
  `the rejected edit above never actually changed Amy's profile (got ${JSON.stringify(amyAfterRejectedEdit)})`
);

// A real admin CAN edit someone else's profile via adminEmail.
res = await updateProfile(postProfile({ email: "amy@example.com", firstName: "Amy", lastName: "Anders-Smith", mobileNumber: "555-111-0000", adminEmail: "mplfarms@aol.com" }));
body = JSON.parse(res.body);
check(res.statusCode === 200, "a real admin CAN edit another user's profile via adminEmail (200)");
check(body.user.lastName === "Anders-Smith", "the admin's edit actually landed on the target account");

// adminEmail equal to the target email is just a normal self-edit, no admin check.
res = await updateProfile(postProfile({ email: "amy@example.com", firstName: "Amy", lastName: "Self", adminEmail: "amy@example.com" }));
check(res.statusCode === 200, "adminEmail equal to the target email needs no admin check (200)");

fs.unlinkSync(path.join(process.cwd(), "test", "_mock_netlify_blobs.cjs"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
