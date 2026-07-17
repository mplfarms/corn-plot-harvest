// src/version.js (served at public/js/version.js)
//
// Single source of truth for the human-readable app version shown on the
// Settings screen. Bump this alongside sw.js's CACHE_VERSION any time
// client-side files change — they're intentionally two separate constants
// (this one is purely a label for troubleshooting with the user; sw.js's
// controls actual cache invalidation) but keeping them in lockstep makes
// "what build are you on" a quick, unambiguous question to answer.

export const APP_VERSION = "v40";
