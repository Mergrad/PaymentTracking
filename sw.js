/* Ödeme Takip service worker
   - index.html, payments.js, manifest ve diğer kod dosyaları: önce ağ (her zaman güncel), ağ yoksa önbellek
   - simgeler/görseller: önce önbellek
   - Yeni sürümde CACHE adını artırmak zorunda değilsin; yine de eski önbelleği temizlemek istersen sayıyı değiştir. */
const CACHE = "odeme-takip-v6";
const ASSETS = ["./", "./index.html", "./payments.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];
const NETWORK_TIMEOUT = 4000;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(ASSETS.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => null)))
    )
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req, isDoc) {
  const fresh = new Request(req.url, { cache: "no-cache", credentials: "same-origin" });
  const network = fetch(fresh).then((res) => {
    if (res && res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req.url, copy));
    }
    return res;
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT));
  return Promise.race([network, timeout]).catch(() =>
    caches
      .match(req.url, { ignoreSearch: true })
      .then((hit) => hit || (isDoc ? caches.match("./index.html").then((fb) => fb || caches.match("./")) : null))
      .then(
        (hit) =>
          hit ||
          new Response("Çevrimdışı", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          })
      )
  );
}

function cacheFirst(req) {
  return caches.match(req).then(
    (hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  const isDoc = req.mode === "navigate" || req.destination === "document";
  const isCode = isDoc || url.pathname.endsWith("/") || /\.(?:html|js|json|css|webmanifest)$/i.test(url.pathname);

  e.respondWith(isCode ? networkFirst(req, isDoc) : cacheFirst(req));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      if (windows.length) return windows[0].focus();
      return clients.openWindow("./");
    })
  );
});
