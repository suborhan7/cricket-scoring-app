// Caches the app so it opens and scores with no signal at the ground.
const CACHE = "scorer-v24";
const FILES = ["./", "index.html", "css/app.css", "js/engine.js", "js/commentary.js", "js/stats.js", "js/store.js", "js/app.js", "js/config.js", "js/league.js", "js/squad.js", "js/jersey.js", "js/cards.js", "js/studio.js", "js/alerts.js", "js/live.js", "js/hub.js", "vendor/supabase.js", "manifest.webmanifest", "icon.svg", "icons/icon-192.png", "icons/icon-512.png", "privacy.html"];

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

// Push notifications (wickets, results and cards from the "push" Edge Function).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "CricPulse", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag || undefined, data: d.data || {},
  }));
});
// Tapping one opens the match (or the alerts list) in the app, reusing an open window.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {}, url = new URL(d.match ? `./#/m/${d.match}` : "./#/alerts", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope));
    return w ? w.navigate(url).then((c) => c && c.focus()) : self.clients.openWindow(url);
  }));
});
