// src/version.js (served at public/js/version.js)
//
// Single source of truth for the human-readable app version shown on the
// Settings screen. Bump this alongside sw.js's CACHE_VERSION any time
// client-side files change — they're intentionally two separate constants
// (this one is purely a label for troubleshooting with the user; sw.js's
// controls actual cache invalidation) but keeping them in lockstep makes
// "what build are you on" a quick, unambiguous question to answer.
//
// Naming convention (per explicit request): "v26.<build>" — the "26"
// stays fixed, "<build>" increments by one on every delivered build,
// with " (Beta)" appended until told otherwise. sw.js's CACHE_VERSION
// mirrors the same "v26.<build>" number but stays free of spaces/
// parens (it's used to build an internal cache name / can end up in a
// filename, not shown to the user), so the two stay in lockstep without
// literally matching character-for-character. Next build after this one
// is v26.67.

export const APP_VERSION = "v26.66 (Beta)";
