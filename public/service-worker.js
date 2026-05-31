/* Service Worker dla Gang Manager PWA */
const CACHE_NAME = "gang-manager-v1";

// Pliki do cache przy instalacji
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/static/js/main.chunk.js",
  "/static/js/bundle.js",
  "/manifest.json",
];

// Instalacja — cache plików statycznych
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch(() => {
        // Nie blokuj instalacji jeśli jakiś plik nie istnieje
      });
    })
  );
  self.skipWaiting();
});

// Aktywacja — usuń stare cache
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch — Network First dla Firebase, Cache First dla statycznych
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Firebase i zewnętrzne API — zawsze sieć (dane muszą być świeże)
  if (
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("anthropic") ||
    url.hostname.includes("google")
  ) {
    return; // Przeglądarka obsługuje normalnie
  }

  // Pliki statyczne — Cache First (szybkie ładowanie)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache tylko GET i sukces
        if (
          event.request.method !== "GET" ||
          !response ||
          response.status !== 200
        ) {
          return response;
        }
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      });
    })
  );
});
