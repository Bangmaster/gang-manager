/* Service Worker dla Gang Manager PWA */
const CACHE_NAME = "gang-manager-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((name) => caches.delete(name)))
    )
  );
  self.clients.claim();
});

// Fetch — przepuść wszystko przez sieć, nie przechwytuj plików statycznych
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Pliki statyczne — zawsze z sieci, nigdy nie przechwytuj
  const staticFiles = [
    "/logo192.png",
    "/logo512.png", 
    "/manifest.json",
    "/favicon.ico",
    "/service-worker.js",
  ];
  
  if (staticFiles.some(f => url.pathname === f)) {
    // Przepuść bezpośrednio do sieci
    event.respondWith(fetch(event.request));
    return;
  }

  // Reszta — normalnie przez sieć
  // Nie robimy cache żeby nie komplikować
});
