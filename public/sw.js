// Corn Plot Harvest service worker.
//
// Cache-first-falling-back-to-network for same-origin GET requests, plus
// the jsPDF CDN URL specifically (also cache-first, falling back to
// network, caching a successful network response for next time). The
// app shell is precached on install; old-versioned caches are purged on
// activate.

const CACHE_VERSION = "v26.104-beta";
const CACHE_NAME = `corn-plot-harvest-${CACHE_VERSION}`;

const JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";

// Enumerated app-shell files (no wildcard support in the Cache API).
// Keep this in sync with the actual contents of public/ — see the
// `find public -type f` cross-check in the build notes.
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/DefaultLists.json",
  "/css/styles.css",

  "/js/main.js",
  "/js/version.js",
  "/js/ui/authStore.js",
  "/js/ui/brand.js",
  "/js/ui/dom.js",
  "/js/ui/fileSave.js",
  "/js/ui/formIdAssign.js",
  "/js/ui/geoData.js",
  "/js/ui/logoCache.js",
  "/js/ui/router.js",
  "/js/ui/theme.js",
  "/js/ui/xlsxLibLoader.js",

  "/js/ui/components/datePicker.js",
  "/js/ui/components/doubleConfirm.js",
  "/js/ui/components/editUserDetailsModal.js",
  "/js/ui/components/modal.js",
  "/js/ui/components/newUserDetailsModal.js",
  "/js/ui/components/searchListPicker.js",
  "/js/ui/components/toast.js",
  "/js/ui/components/topBar.js",
  "/js/ui/components/updateBanner.js",
  "/js/ui/components/wheelSelect.js",

  "/js/ui/screens/accountScreen.js",
  "/js/ui/screens/adminPlots.js",
  "/js/ui/screens/brandSelect.js",
  "/js/ui/screens/entriesList.js",
  "/js/ui/screens/entryEditor.js",
  "/js/ui/screens/help.js",
  "/js/ui/screens/manageUsers.js",
  "/js/ui/screens/plotChooser.js",
  "/js/ui/screens/plotSummary.js",
  "/js/ui/screens/plotSummaryHelp.js",
  "/js/ui/screens/quickStart.js",
  "/js/ui/screens/savedPlots.js",
  "/js/ui/screens/settings.js",
  "/js/ui/screens/trialDetails.js",
  "/js/ui/screens/workspaceMenu.js",

  "/js/ui/stores/brandStore.js",
  "/js/ui/stores/catalogStore.js",
  "/js/ui/stores/cloudSyncStore.js",
  "/js/ui/stores/libraryStore.js",
  "/js/ui/stores/listsStore.js",
  "/js/ui/stores/pubsub.js",
  "/js/ui/stores/themeStore.js",
  "/js/ui/stores/trialStore.js",

  "/js/core/companyMatch.js",
  "/js/core/demoPlot.js",
  "/js/core/formId.js",
  "/js/core/hybridCatalogImport.js",
  "/js/core/models.js",
  "/js/core/pdfBuilder.js",
  "/js/core/seedwareExportBuilder.js",
  "/js/core/soilLookup.js",
  "/js/core/xlsxBuilder.js",
  "/js/core/xlsxTemplateParts.js",
  "/js/core/xmlHelpers.js",
  "/js/core/yieldCalculator.js",
  "/js/core/zipWriter.js",

  "/data/counties.json",
  "/data/cityZips.json",

  "/logos/midwest.png",
  "/logos/ncplus.png",
  "/logos/republic-shield.png",
  "/logos/brand-train.png",

  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",

  "/template/drawing1.xml",
  "/template/drawing1.xml.rels",
  "/template/image1.emf",
  "/template/sharedStrings.xml",
  "/template/sheet1_prefix.xml",
  "/template/sheet1_rows_9_10.xml",
  "/template/sheet1_suffix.xml",
  "/template/styles.xml",
  "/template/theme1.xml",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Deliberately NOT cache.addAll(PRECACHE_URLS) — that convenience
      // method fetches with the browser's DEFAULT (HTTP-cache-respecting)
      // caching mode under the hood. Since every URL here keeps the same
      // path release over release (no content hashing) and _headers only
      // forces no-cache on index.html/sw.js, a plain fetch() during
      // install can silently hand back a STALE previously-cached copy of
      // an unchanged-URL file straight from the browser's own HTTP cache
      // — even though this brand-new service worker is actively
      // installing specifically because the server has a newer build.
      // That produces exactly the bug this comment is here to prevent:
      // some files (whichever the browser happened to still have fresh
      // HTTP-cache entries for) silently stay on old code after an
      // update, while others (freshly fetched) update normally — so the
      // version footer can show the new build number while some other
      // module underneath is still running old logic. { cache: "reload" }
      // forces every one of these fetches to bypass the HTTP cache and
      // go to the network, guaranteeing the whole app shell updates
      // atomically together on every new service worker install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (response.ok) {
            await cache.put(url, response);
          }
        })
      );

      // Best-effort: cache jsPDF too, so the app works fully offline after
      // the first successful load. This sandbox has no network access, so
      // this will fail here — that's fine, it's wrapped so it never fails
      // the whole install. In the real deployed app (with real internet)
      // this succeeds and is cached for offline use thereafter.
      try {
        await cache.add(JSPDF_URL);
      } catch (e) {
        // Ignored on purpose — see comment above.
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCacheableCdnAsset = req.url === JSPDF_URL;

  // Cloud sync API calls must never be served from cache — they're the
  // live, per-user plot data, not app-shell assets. Let these fall
  // straight through to the network untouched (no caching either way).
  const isCloudFunction = isSameOrigin && url.pathname.startsWith("/.netlify/functions/");
  if (isCloudFunction) return;

  if (!isSameOrigin && !isCacheableCdnAsset) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const response = await fetch(req);
        if (response && response.ok) {
          cache.put(req, response.clone());
        }
        return response;
      } catch (e) {
        if (isSameOrigin) {
          const fallback = await cache.match("/index.html");
          if (fallback) return fallback;
        }
        throw e;
      }
    })()
  );
});
