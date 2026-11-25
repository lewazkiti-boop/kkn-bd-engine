// Bideey service worker: shows reminder notifications. Deliberately caches nothing, so a new
// deployment is picked up exactly as before.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  // Every push must show something: browsers (iOS especially) revoke silent subscriptions.
  event.waitUntil(
    self.registration.showNotification(data.title || "Bideey reminder", {
      body: data.body || "Open Bideey to see your reminders.",
      tag: data.tag,
      icon: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) =>
      windows.length ? windows[0].focus() : self.clients.openWindow("/")
    )
  );
});
