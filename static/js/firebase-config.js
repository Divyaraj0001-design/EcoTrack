/**
 * firebase-config.js
 * ──────────────────
 * Initialises the Firebase Web SDK using the config object injected by the
 * Flask server via Jinja2.  The actual API keys are never stored in this file.
 *
 * window.__FIREBASE_CONFIG__ is set in index.html:
 *   <script>window.__FIREBASE_CONFIG__ = {{ firebase_config | tojson }};</script>
 *
 * Usage pattern — ALL other JS modules must use these references instead of
 * calling firebase.auth() / firebase.firestore() directly:
 *
 *   if (!window.__FIREBASE_READY__) return;   // guard before every usage
 *   const auth = window.__AUTH__;             // Firebase Auth instance
 *   const db   = window.__FIRESTORE__;        // Firestore client instance
 *
 * This ensures a single initialisation path and graceful degradation when
 * Firebase config is missing (e.g. in CI or local dev without credentials).
 */

(function () {
  "use strict";

  try {
    const config = window.__FIREBASE_CONFIG__;

    if (!config || !config.apiKey) {
      console.warn(
        "[EcoTrack] Firebase config is missing or incomplete. " +
        "Authentication and Firestore will be disabled."
      );
      window.__FIREBASE_READY__ = false;
      return;
    }

    // Initialise Firebase app (compat SDK v10)
    firebase.initializeApp(config);

    // Expose convenience references used by other modules
    window.__AUTH__      = firebase.auth();
    window.__FIRESTORE__ = firebase.firestore();

    window.__FIREBASE_READY__ = true;
    console.info("[EcoTrack] Firebase initialised for project:", config.projectId);

  } catch (err) {
    console.error("[EcoTrack] Firebase initialisation failed:", err);
    window.__FIREBASE_READY__ = false;
  }
})();
