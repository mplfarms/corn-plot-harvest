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
  Plot Entries → Plot Summary & Results.
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

## Cloud sync setup (optional — sign in to access plots on any device)

This is a newer, separate piece: signing in (Netlify Identity) lets a saved plot
follow you across phones/tablets/computers instead of staying stuck on one device.
It's entirely optional — skip it and the app works exactly as it always has,
local-only. Turning it on requires a few one-time steps that only the site owner
needs to do, once:

**1. Switch from drag-and-drop to Git-based deploys.** The parts that make cloud
sync work (`netlify/functions/plots.js`) need Netlify to run a small build step to
package them, and manual drag-and-drop deploys skip that step entirely — they only
work for plain static files. So:
   - Put this whole project (not just `public/`) in a GitHub repository.
   - In the Netlify dashboard, go to your site → **Site configuration → Build & deploy →
     Continuous deployment**, and connect it to that GitHub repo instead of using
     drag-and-drop. Netlify will auto-detect `netlify.toml` (already in this project),
     which tells it: publish `public/`, functions live in `netlify/functions/`, no
     custom build command needed.
   - From then on, every push to the repo redeploys automatically — no more manual
     dragging.

**2. Enable Identity.** In the Netlify dashboard: your site → **Site configuration →
   Identity → Enable Identity**. Leave the default settings (email/password signup) —
   no extra configuration is required for this app to work.

**3. Promote yourself to admin (optional).** Once you've signed up for an account
   *inside the deployed app itself* (tap "Create Account" on the Account screen), go
   to your site → **Identity** tab in the Netlify dashboard, find your user in the
   list, open it, and add the role `admin`. Only users with this role can see the
   "All Plots (Admin)" screen (everyone's saved plots, not just their own) — regular
   users only ever see their own.

**4. Test it.** Sign up on one device, save a plot (give it a Cooperator Name — that's
   what triggers auto-save), then sign in with the same account on a second
   device/browser and confirm the plot shows up under Saved Plots there too.

If any of this errors out, the most likely causes are: Identity isn't enabled yet
(step 2), or the site is still on a drag-and-drop deploy instead of a Git-connected
one (step 1) — Functions silently won't exist without it, and `/.netlify/functions/plots`
will 404. A **502** instead (the function exists and is being called, but errors out)
most likely means `netlify/functions/plots.js` threw `MissingBlobsEnvironmentError` —
this endpoint uses the classic Lambda-compatible `(event, context)` handler signature
(needed to read `context.clientContext.user` from Identity), and in that mode Netlify
Blobs requires an explicit `connectLambda(event)` call before `getStore()` or its
environment isn't configured. This is already handled in the current version of
`plots.js` — if you're still seeing a 502 after deploying it, check **Site →
Functions → plots → real-time logs** in the Netlify dashboard for the actual error.

## Local testing (optional, for whoever's deploying this)

Since there's no build step, you can preview it locally with any static file server, e.g.:

```
cd public
python3 -m http.server 8080
```

then open `http://localhost:8080` in a browser. (Camera/GPS/Add-to-Home-Screen
features need a real HTTPS deployment to fully test, per browser security rules —
`localhost` is an exception for most APIs except installability.)
