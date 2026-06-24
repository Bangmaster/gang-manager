// Rejestracja Service Workera — używamy firebase-messaging-sw.js
// który obsługuje zarówno FCM push notyfikacje jak i PWA cache

const isLocalhost = Boolean(
  window.location.hostname === "localhost" ||
  window.location.hostname === "[::1]" ||
  window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
);

// Używamy FCM SW zamiast domyślnego CRA SW
// Dzięki temu FCM token jest przypisany do właściwego SW
const SW_URL = "/firebase-messaging-sw.js";

export function register() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    if (isLocalhost) {
      checkValidServiceWorker(SW_URL);
    } else {
      registerValidSW(SW_URL);
    }
  });
}

function registerValidSW(swUrl) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.onstatechange = () => {
          if (installingWorker.state === "installed") {
            if (navigator.serviceWorker.controller) {
              console.log("Nowa wersja Gang Manager dostępna.");
            }
          }
        };
      };
    })
    .catch((error) => {
      console.error("Błąd rejestracji service worker:", error);
    });
}

function checkValidServiceWorker(swUrl) {
  fetch(swUrl, { headers: { "Service-Worker": "script" } })
    .then((response) => {
      const contentType = response.headers.get("content-type");
      if (
        response.status === 404 ||
        (contentType != null && contentType.indexOf("javascript") === -1)
      ) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => window.location.reload());
        });
      } else {
        registerValidSW(swUrl);
      }
    })
    .catch(() => {
      console.log("Brak połączenia — apka działa offline.");
    });
}

export function unregister() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.unregister())
      .catch((error) => console.error(error.message));
  }
}
