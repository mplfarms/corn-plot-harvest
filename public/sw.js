// Corn Plot Harvest — SUSPENSION service worker.
//
// This file replaces the app's real sw.js while access is suspended. Its
// entire job is to undo the previous service worker, and it is the piece
// that actually reaches phones with the app already installed.
//
// Why it's needed at all: the real sw.js serves the app shell
// cache-first, so an installed device keeps opening the CACHED
// index.html — the old app — even with a signal, and would never see a
// suspension page put on the server. What the browser DOES fetch fresh
// is sw.js itself (it byte-compares the registered worker against the
// server's copy on navigations, and the site's _headers already force
// no-cache on this file). So the suspension has to arrive as a new
// service worker, not as a new page.
//
// The sequence below is deliberate:
//   install  — skipWaiting() so this takes over immediately instead of
//              waiting for every tab of the old app to close.
//   activate — delete EVERY cache (that's the old app shell, and the
//              jsPDF/Leaflet CDN copies with it), then unregister this
//              worker entirely.
//
// After that the device has no service worker and no cache, so the very
// next launch of the app is served straight from the network: the
// suspension index.html. Someone with the old app ALREADY open in front
// of them keeps seeing it until they close it — this deliberately does
// not force-reload their page out from under them (a forced navigate
// mid-activation can take the page down hard, and there is nothing to
// gain by yanking a screen away from someone who may be mid-entry). One
// close-and-reopen is all it takes.
//
// There is NO fetch handler here on purpose — while this worker is alive
// every request passes straight through to the network, so nothing can
// be served out of a cache that is on its way to being deleted.
//
// What this does NOT touch: localStorage. Every plot a rep has entered
// on that device lives there, and suspending access must not destroy
// their work. Only the app shell is cleared.
//
// To lift the suspension, restore the app's real index.html and sw.js
// and deploy. Devices pick the real sw.js back up the same way — a
// byte-different sw.js on the next navigation — and reinstall the app
// shell from scratch.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1. Wipe every cache this origin holds — the old app shell.
      try {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      } catch (e) {
        // Ignored on purpose — nothing cached is the same outcome.
      }

      // 2. Take control, so nothing else can answer from a cache while
      //    this worker is standing itself down.
      try {
        await self.clients.claim();
      } catch (e) {
        // Ignored on purpose.
      }

      // 3. Remove this worker too, so the device is left with no service
      //    worker at all until the real one is deployed again.
      try {
        await self.registration.unregister();
      } catch (e) {
        // Ignored on purpose.
      }
    })()
  );
});
