// Caches the app so it opens and scores with no signal at the ground.
const CACHE = "scorer-v18";
const FILES = ["./", "index.html", "css/app.css", "js/engine.js", "js/stats.js", "js/store.js", "js/app.js", "js/config.js", "js/league.js", "js/squad.js", "js/cards.js", "js/studio.js", "js/alerts.js", "js/hub.js", "vendor/supabase.js", "manifest.webmanifest", "icon.svg", "icons/icon-192.png", "icons/icon-512.png", "privacy.html"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
// Network first so updates show up; fall back to the cache when offline.
self.addEventListener("fetch", (e) => {
  // Data from Supabase is never cached here: scores must be fresh, and league.js handles offline.
  if (e.request.method !== "GET" || new URL(e.request.url).hostname.endsWith("supabase.co")) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
