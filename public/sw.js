// Tilt HQ service worker — Web Push notifications + tap-to-open.
/* eslint-disable no-undef */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Tilt HQ", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Tilt HQ";
  const options = {
    body: data.body || "",
    icon: "/images/tilt-shield.png",
    badge: "/images/tilt-shield.png",
    data: { url: data.url || "/" },
    tag: data.tag,
    renotify: Boolean(data.tag),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ("focus" in client) {
            client.navigate(url).catch(() => {});
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
  );
});

// Activate immediately on update.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
