# Corn Plot Harvest — Web App (PWA)

This is the web-based rewrite of the Corn Plot Harvest iOS app. It's a Progressive
Web App: no App Store, no Xcode. You host it at a URL, and anyone opens that URL in
their phone's browser and taps "Add to Home Screen" to install it like a normal app
icon. It works offline after the first visit, including full Excel (.xlsx) export.

It is a completely separate project from the iOS app — the iOS app is untouched.

## What's inside

Everything the app needs lives in the `public/` folder. There is **no build step** —
it's plain HTML/CSS/JavaScript that any static web host can serve as-is.

- `public/index.html` — the app.
- `public/js/` — all application code (data models, the exact Excel/PDF export logic
  ported from the iOS app, and the screens).
- `public/manifest.webmanifest` + `public/sw.js` — what makes it installable and
  offline-capable.
- `public/template/`, `public/logos/`, `public/icons/`, `public/DefaultLists.json` —
  the original Excel template pieces (copied byte-for-byte from the iOS app, so
  exported spreadsheets match exactly), brand logos, app icons, and the built-in
  hybrid/trait/etc. reference lists.

## How to put it online (pick one — all are free)

You just need to upload the **contents of the `public/` folder** to any static host.
A few good options:

**Netlify (easiest — drag and drop)**
1. Go to https://app.netlify.com/drop
2. Drag the `public` folder onto the page.
3. Netlify gives you a URL immediately (e.g. `random-name.netlify.app`). You can
   rename it or attach your own domain from the site settings.

**Vercel**
1. Go to https://vercel.com, create a project, choose "Deploy without Git" / upload,
   and upload the `public` folder contents (or point it at a GitHub repo containing
   this project with `public` as the output/root directory).

**GitHub Pages**
1. Create a GitHub repo, put the contents of `public/` at the repo root (or in a
   `docs/` folder), enable Pages in the repo settings pointing at that folder.

Any of these give you an `https://` URL — that's required (PWAs and "Add to Home
Screen" need HTTPS; all three of the above provide it automatically).

## Installing it on a phone

Once it's online:
- **iPhone (Safari):** open the URL → tap the Share icon → "Add to Home Screen".
- **Android (Chrome):** open the URL → tap the ⋮ menu → "Add to Home Screen" / "Install app".

After that first visit, the app works fully offline for filling out plots and
exporting the .xlsx form — the PDF export additionally needs the device to have been
online at least once (to cache the PDF library), after which it also works offline.

## What matches the iOS app

- Same data entry flow: brand selection → saved plots or new plot → Plot Details →
  Hybrid Entries → Plot Summary & Results.
- Same brand-scoped hybrid lists, same wheel-style pickers, same Dry Yield manual
  override, same Population wheel (14,000–46,000 in 500s, defaults to 32,000).
- The exported `.xlsx` is assembled from the exact same template XML/styles as the
  Excel file the iOS app produces — same formulas (Yield/Rank/Gross/Income), same
  merged cells, same logo, same row-extension behavior past 32 entries.
- The PDF ranked-results report matches the iOS app's layout (title/logo, summary
  block with trial mean/CV/by-brand averages, ranked table, comments).

## What's different (and why), given this is now a browser instead of a native app

- **Sharing/printing** uses the Web Share sheet and the browser's PDF viewer instead
  of iOS's native share sheet / Mail composer / AirPrint — same end result, one extra
  tap in a couple of places.
- **Emailing to Operations**: a browser can't attach a file to an email
  automatically the way the iOS app could. Tapping "Email XLSX to Operations" will
  either open your phone's native share sheet (pick Mail/Gmail and the file arrives
  already attached — this is what happens on most modern phones), or, if your browser
  doesn't support that, it downloads the file and opens a blank email addressed to
  Operations for you to attach it to manually.
- **GPS** uses the browser's location permission prompt instead of iOS's — same
  behavior, different permission dialog.
- Selection wheels are a tap-to-expand scrolling list rather than iOS's native spinning
  wheel control — same idea, adapted for the web.

## Cloud sync setup (sign-in is required — lets plots follow you across devices)

Signing in is mandatory: every screen except the launch screen itself requires a
session (enforced in `router.js`, not just by hiding a button), and there's no
"use it without an account" option anymore. Once signed in, a saved plot follows
that email across phones/tablets/computers instead of staying stuck on one
device, and the session is kept in `localStorage` indefinitely (no expiry, no
TTL) so a device stays signed in across restarts until someone explicitly taps
Sign Out.

**This app no longer uses Netlify Identity.** Signing in used to require a
password and email verification, which caused sign-in trouble for the team — it's
been replaced with something much lighter: **just an email address**, on the
app's launch screen (the Republic shield + brand-logo screen). There's no name
field, no password, no verification email, no per-user Netlify Identity account
to manage, and (per the team's explicit choice) no shared passcode either — this
is deliberately as simple as possible, since none of this data is sensitive.
Turning it on requires one one-time step that only the site owner needs to do:

**1. Switch from drag-and-drop to Git-based deploys.** The parts that make cloud
sync work (the functions in `netlify/functions/`) need Netlify to run a small
build step to package them, and manual drag-and-drop deploys skip that step
entirely — they only work for plain static files. So:
   - Put this whole project (not just `public/`) in a GitHub repository.
   - In the Netlify dashboard, go to your site → **Site configuration → Build & deploy →
     Continuous deployment**, and connect it to that GitHub repo instead of using
     drag-and-drop. Netlify will auto-detect `netlify.toml` (already in this project),
     which tells it: publish `public/`, functions live in `netlify/functions/`, no
     custom build command needed.
   - From then on, every push to the repo redeploys automatically — no more manual
     dragging.

**2. That's it for admin setup.** The account signed in as **mplfarms@aol.com** is
   automatically the admin the first time it signs in inside the deployed app — no
   dashboard step needed. From Settings → **Manage Users** (only visible to an
   admin), that account can promote or demote any other signed-in user to admin,
   or delete an account entirely (which also deletes that account's cloud-saved
   plots). An admin can't accidentally delete their own account.

**3. Default Brand View by email domain.** When someone signs in, the app tries to
   guess which brand they work with from their email address and sets that as
   their Brand View automatically: `@midwestseedgenetics.com`, `@midwestseed.com`,
   or `@republicseed.com` → Midwest Seed Genetics, `@nc-plus.com` → NC+. Anyone
   signing in from any other email domain is sent to a manual Brand View picker
   screen instead (they can always change it later in Settings, too). To add or
   change these domain rules, edit `BRAND_ID_BY_EMAIL_DOMAIN` near the top of
   `public/js/ui/brand.js`.

**4. Test it.** Sign in on one device with just an email, save a plot (give it a
   Cooperator Name — that's what triggers auto-save), then sign in with the same
   email on a second device/browser and confirm the plot shows up under Saved
   Plots there too. Each person's plots are private to their own email — a
   different email sees only what it saved itself, except the admin account, which
   can see everyone's via **Workspace → All Plots (Admin)**.

**A security tradeoff worth knowing clearly.** This is intentionally lightweight,
not enterprise-grade, and dropping the shared passcode makes it meaningfully more
open: there's no password, no email verification, and now nothing at all standing
between typing an email into the sign-in form and being treated as that person.
Concretely — anyone who knows (or guesses) a teammate's email can sign in as them
and see their saved plots, and anyone who knows the admin's email
(`mplfarms@aol.com`, documented right here in this file) can sign in as the admin
and get full access: view every user's plots, promote or demote any account, or
delete accounts outright. For a small internal farm-operation tool where the only
people who'd ever open this sign-in screen are trusted teammates, that's an
acceptable, deliberate tradeoff in exchange for the simplest possible sign-in flow
— but it's worth being clear-eyed that this is closer to "an honor system with a
name tag" than real authentication. If that stops feeling like enough (e.g. the
app ever needs to be reachable by people outside the immediate team), the shared
passcode that used to sit on top of this is the natural first thing to bring
back.

If any of this errors out, the most likely cause is the site still being on a
drag-and-drop deploy instead of a Git-connected one (step 1) — Functions silently
won't exist without it, and `/.netlify/functions/auth` (or `plots`, `adminUsers`,
`formId`, `backfillFormIds`, or `hybridCatalog`) will 404. This is also exactly
what happens if a function file (or a shared file it `require()`s, like
`_shared.js` or `_formIdShared.js`) simply never made it into the GitHub repo on
a manual upload — every new function file added to `netlify/functions/` has to
actually be committed there, or Netlify never registers it as deployed at all;
check the repo's file listing directly if a specific function keeps 404ing while
its siblings work fine. A **502** instead (the function exists and is being
called, but errors out) most likely means the function threw
`MissingBlobsEnvironmentError` — every function (`auth.js`, `plots.js`,
`adminUsers.js`, `formId.js`, `backfillFormIds.js`, `hybridCatalog.js`, etc.)
uses the classic Lambda-compatible `(event, context)` handler signature, and in
that mode Netlify Blobs requires an explicit `connectLambda(event)` call before
`getStore()` or its environment isn't configured. This is already handled at the
top of every function — if you're still seeing a 502 after deploying, check
**Site → Functions → (auth / plots / adminUsers / formId / backfillFormIds /
hybridCatalog) → real-time logs** in the Netlify dashboard for the actual error.
(`formId.js` specifically backs the "Form ID" reference number shown on Plot
Details, on Plot Summary, and on exported/printed plots — see
`netlify/functions/formId.js`'s top comment for what it does; a 502 there just
means a plot won't get a Form ID yet, everything else keeps working.
`backfillFormIds.js` is the one-time, safely-repeatable admin action — the
"Assign Form IDs to All Plots" button on the All Plots (Admin) screen — that
assigns a Form ID to every plot that existed before this feature did; see its
own top comment. `hybridCatalog.js` backs the "Upload Hybrid Catalog" button on
that same screen — the shared Company/Hybrid/Trait/RM reference data behind the
Hybrid Details cascading pickers in the entry editor; a 502/404 there just means
those pickers fall back to fully manual entry, same as before this feature
existed — see `netlify/functions/hybridCatalog.js`'s top comment.)

## Local testing (optional, for whoever's deploying this)

Since there's no build step, you can preview it locally with any static file server, e.g.:

```
cd public
python3 -m http.server 8080
```

then open `http://localhost:8080` in a browser. (Camera/GPS/Add-to-Home-Screen
features need a real HTTPS deployment to fully test, per browser security rules —
`localhost` is an exception for most APIs except installability.)
