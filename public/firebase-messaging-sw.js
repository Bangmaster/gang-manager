/* Firebase Messaging Service Worker - obsługa powiadomień w tle */
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBFkrpSF7BX4VNbbNRPYg5I30T0OZmODbs",
  authDomain: "gang-wymiana.firebaseapp.com",
  projectId: "gang-wymiana",
  storageBucket: "gang-wymiana.firebasestorage.app",
  messagingSenderId: "563645431220",
  appId: "1:563645431220:web:f5a98aff554858737dc6e1"
});

const messaging = firebase.messaging();

// Powiadomienia w tle (gdy apka zamknięta)
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, data } = payload.notification || {};
  self.registration.showNotification(title || "™FAM™ Gang Manager", {
    body: body || "",
    icon: icon || "/logo192.png",
    badge: "/logo192.png",
    tag: "gang-notification",
    renotify: true,
    data: data || {},
    actions: [
      { action: "open", title: "Otwórz apkę" },
    ],
    vibrate: [200, 100, 200],
  });
});

// Klik w powiadomienie → otwórz apkę
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const url = self.location.origin;
      for (const client of clientList) {
        if (client.url.startsWith(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
