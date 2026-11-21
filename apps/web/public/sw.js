importScripts("/account-worker.js");
self.addEventListener("install", () => self.skipWaiting());
const CACHE = "kooyu-shell-v5";
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Kooyu", {
      body: "打开 Kooyu 查看更新。",
      tag: "kooyu-wake",
      icon: "/icon.svg",
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((windows) => {
      const client = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (client) return client.focus();
      return self.clients.openWindow(self.registration.scope);
    }),
  );
});
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/icon.svg"])));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients
      .claim()
      .then(() => caches.keys())
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    /(?:^|\/)api(?:\/|$)/.test(url.pathname)
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && !response.headers.get("content-type")?.startsWith("application/json")) {
          const clone = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(
          (cached) =>
            cached ??
            new Response("当前离线，请恢复网络后重试。", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            }),
        ),
      ),
  );
});
