// src/ui/mapPicker.js
//
// "Pick Location on Map" — a satellite-imagery map in a modal, tap (or
// drag the pin) to choose the plot's exact spot, confirm to fill
// Latitude/Longitude. Built for the desk/desktop case where device GPS
// is useless-to-harmful (a computer guesses location from its internet
// connection): the user literally sees the field and taps it.
//
// COSTS NOTHING AT STARTUP, AND NO FEES — two deliberate choices, both
// per explicit request/answered questions:
//  - The map library (Leaflet, free open-source, ~55 KB) is lazy-loaded
//    from the CDN only when this modal first opens — the exact pattern
//    xlsxLibLoader.js uses for SheetJS. App launch never pays for it.
//  - Imagery comes from the USGS National Map (U.S. government, public
//    domain, no key/account/billing — built for exactly this kind of
//    light use), falling back automatically to Esri's free World
//    Imagery tiles (standard attribution shown) if USGS errors. There
//    is no payment method anywhere in this chain — worst case at
//    unrealistic scale is throttling, never a bill.
//
// Needs a live connection when opened (tiles stream on demand) — fine,
// it's an alternative to GPS for remote/desk entry, which implies
// connectivity. Fails soft with a clear message when offline.

import { h, clear } from "./dom.js";
import { showCustomModal } from "./components/modal.js";

const LEAFLET_JS_URL = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const LEAFLET_CSS_URL = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";

// USGS National Map "Imagery Topo" (public domain): the same satellite
// imagery PLUS reference layers — state/county boundaries, highways
// with route shields, rivers/lakes, and town names — so a zoomed-out
// user can orient quickly (per explicit request; plain ImageryOnly had
// no labels at all). z/y/x order per ArcGIS tile services.
// maxNativeZoom 16 — USGS serves most rural areas to 16; Leaflet
// upscales beyond that rather than showing broken tiles.
const USGS_TILE_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}";
const USGS_ATTRIBUTION = "Imagery: USGS National Map";
const ESRI_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION = "Imagery: Esri, Maxar, Earthstar Geographics";

// Fallback view when the plot has no coordinates yet: centered on Iowa
// (this operation's home territory) zoomed out far enough to grab and
// pan anywhere in the region quickly.
const DEFAULT_CENTER = [42.0, -93.5];
const DEFAULT_ZOOM = 7;
const HAS_COORDS_ZOOM = 15;

let leafletPromise = null;

/**
 * Lazy-loads Leaflet (JS + CSS) once. Same retry-on-failure contract as
 * loadXlsxLib(): a failed load clears the promise so a later open can
 * try again.
 * @returns {Promise<any>} resolves to the global `L`
 */
export function loadLeaflet() {
  if (typeof window !== "undefined" && window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = LEAFLET_CSS_URL;
    document.head.appendChild(css);

    const script = document.createElement("script");
    script.src = LEAFLET_JS_URL;
    script.onload = () => {
      if (window.L && window.L.map) resolve(window.L);
      else reject(new Error("the map loaded but isn't available — try again"));
    };
    script.onerror = () => reject(new Error("couldn't load the map — check your connection"));
    document.head.appendChild(script);
  }).catch((e) => {
    leafletPromise = null;
    throw e;
  });
  return leafletPromise;
}

/**
 * Opens the pick-on-map modal.
 * @param {{
 *   initialLat?: number|null,
 *   initialLon?: number|null,
 *   onPick: (lat: number, lon: number) => void,
 * }} opts onPick fires only on an explicit "Use This Location" tap.
 */
export async function openMapPicker(opts) {
  const hasStart = Number.isFinite(opts.initialLat) && Number.isFinite(opts.initialLon);
  const start = hasStart ? [opts.initialLat, opts.initialLon] : DEFAULT_CENTER;

  const mapEl = h("div", { className: "map-picker-map" });
  const readoutEl = h("p", { className: "field-note map-picker-readout" }, hasStart ? `${start[0].toFixed(6)}, ${start[1].toFixed(6)}` : "Tap the map to drop a pin on the plot.");
  const useBtn = h("button", { type: "button", className: "btn btn-primary btn-block", disabled: !hasStart }, "Use This Location");
  const body = h("div", { className: "map-picker-body" }, [
    mapEl,
    readoutEl,
    useBtn,
    h("p", { className: "field-note map-picker-hint" }, "Zoom and pan to the field, then tap it — the pin can also be dragged to fine-tune."),
  ]);

  const modal = showCustomModal({ title: "Pick Location on Map", bodyNode: body });

  let L;
  try {
    L = await loadLeaflet();
  } catch (e) {
    clear(body);
    body.appendChild(h("p", { className: "empty-state" }, `${e.message || "Couldn't load the map."} The map needs an internet connection — you can also type coordinates into the GPS Location fields instead.`));
    return;
  }

  const map = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView(start, hasStart ? HAS_COORDS_ZOOM : DEFAULT_ZOOM);

  // Primary imagery: USGS (public domain). If it errors repeatedly
  // (outage, non-US extent), swap once to Esri's free imagery.
  let usgsErrors = 0;
  let swapped = false;
  const usgsLayer = L.tileLayer(USGS_TILE_URL, { attribution: USGS_ATTRIBUTION, maxNativeZoom: 16, maxZoom: 18 });
  usgsLayer.on("tileerror", () => {
    usgsErrors++;
    if (!swapped && usgsErrors >= 4) {
      swapped = true;
      map.removeLayer(usgsLayer);
      L.tileLayer(ESRI_TILE_URL, { attribution: ESRI_ATTRIBUTION, maxNativeZoom: 18, maxZoom: 18 }).addTo(map);
    }
  });
  usgsLayer.addTo(map);

  let marker = null;
  let picked = hasStart ? { lat: start[0], lon: start[1] } : null;

  function setPin(lat, lon) {
    picked = { lat, lon };
    if (!marker) {
      marker = L.marker([lat, lon], { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        setPin(p.lat, p.lng);
      });
    } else {
      marker.setLatLng([lat, lon]);
    }
    readoutEl.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    useBtn.disabled = false;
  }

  if (hasStart) setPin(start[0], start[1]);
  map.on("click", (e) => setPin(e.latlng.lat, e.latlng.lng));

  useBtn.onclick = () => {
    if (!picked) return;
    modal.close();
    opts.onPick(picked.lat, picked.lon);
  };

  // The modal animates open — Leaflet measures its container at init,
  // so nudge it once the layout settles or the tiles render misaligned.
  setTimeout(() => map.invalidateSize(), 120);
}
