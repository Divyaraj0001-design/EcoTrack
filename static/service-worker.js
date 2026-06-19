/**
 * service-worker.js
 * ─────────────────
 * EcoTrack PWA Service Worker.
 * Cache-first strategy for static assets (shell, CSS, JS).
 * Network-first strategy for API calls.
 */

const CACHE_NAME    = "ecotrack-v1";
const SHELL_ASSETS  = [
  "/",
  "/static/css/styles.css",
  "/static/css/ecobot.css",
  "/static/css/map.css",
  "/static/css/dark-mode.css",
  "/static/js/app.js",
  "/static/js/auth.js",
  "/static/js/firestore.js",
  "/static/js/charts.js",
  "/static/js/calculator.js",
  "/static/js/challenges.js",
  "/static/js/insights.js",
  "/static/js/dashboard.js",
  "/static/js/dashboard-ui.js",
  "/static/js/ecobot.js",
  "/static/js/notifications.js",
  "/static/js/settings.js",
  "/static/js/import.js",
  "/static/js/help.js",
  "/static/js/map.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap",
];

// ── Install: pre-cache shell ─────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[SW] Installing EcoTrack service worker…");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache shell assets ignoring failures for CDN resources
      return Promise.allSettled(SHELL_ASSETS.map(url => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for static, network-first for API ────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always network-first for API and Firestore
  if (url.pathname.startsWith("/api/") || url.hostname.includes("firestore") || url.hostname.includes("firebase")) {
    event.respondWith(fetch(event.request).catch(() => new Response(
      JSON.stringify({ error: "Offline — please reconnect." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    )));
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(res => {
        // Cache successful GET responses for static files
        if (event.request.method === "GET" && res.status === 200 &&
            (url.pathname.startsWith("/static/") || url.pathname === "/")) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    }).catch(() => {
      // Offline fallback: return cached index for navigation requests
      if (event.request.mode === "navigate") {
        return caches.match("/");
      }
    })
  );
});
