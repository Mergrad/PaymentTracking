/* Ödeme Takip service worker: kabuk içeriğinden otomatik önbellek kimliği üretir. */
const CACHE_PREFIX = "odeme-takip-shell-";
const META_CACHE = "odeme-takip-meta";
const META_KEY = new Request("./active-shell");
const ASSETS = ["./", "./index.html", "./payments.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./icon-maskable-192.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];
const VERSIONED_ASSETS = ["./index.html", "./payments.js", "./manifest.json"];
const NETWORK_TIMEOUT = 4000;
let activeCacheName = null;

function shellHash(parts) {
  let hash = 2166136261;
  parts.join("\n").split("").forEach((char) => { hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); });
  return (hash >>> 0).toString(36);
}
async function rememberActiveCache(name) {
  activeCacheName = name;
  const meta = await caches.open(META_CACHE);
  await meta.put(META_KEY, new Response(name));
}
async function getActiveCacheName() {
  if (activeCacheName) return activeCacheName;
  const meta = await caches.open(META_CACHE);
  const saved = await meta.match(META_KEY);
  if (saved) {
    const name = await saved.text();
    if (name.indexOf(CACHE_PREFIX) === 0) { activeCacheName = name; return name; }
  }
  const names = (await caches.keys()).filter((name) => name.indexOf(CACHE_PREFIX) === 0).sort();
  if (!names.length) throw new Error("Uygulama önbelleği bulunamadı");
  const chosen = names[names.length - 1];
  await rememberActiveCache(chosen);
  return chosen;
}
async function getActiveCache() { return caches.open(await getActiveCacheName()); }
async function installShell() {
  const entries = await Promise.all(ASSETS.map(async (url) => {
    const response = await fetch(new Request(url, { cache: "reload" }));
    if (!response.ok) throw new Error("Varlık indirilemedi: " + url);
    return { url, response };
  }));
  const sourceByUrl = {};
  await Promise.all(entries.filter((entry) => VERSIONED_ASSETS.indexOf(entry.url) !== -1).map(async (entry) => {
    sourceByUrl[entry.url] = await entry.response.clone().text();
  }));
  const cacheName = CACHE_PREFIX + shellHash(VERSIONED_ASSETS.map((url) => sourceByUrl[url]));
  const cache = await caches.open(cacheName);
  await Promise.all(entries.map((entry) => cache.put(new Request(entry.url), entry.response)));
  await rememberActiveCache(cacheName);
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell().then(() => {
    /* Bu bir güncelleme ise (zaten etkin bir sürüm varsa) beklemeden etkinleş:
       kurulu PWA hiç kapanmasa da yeni sürüm devreye girsin. İlk kurulumda beklenir. */
    if (self.registration.active) self.skipWaiting();
  }));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(getActiveCacheName().then((current) => caches.keys().then((names) => Promise.all(names
    .filter((name) => /^odeme-takip-(?:v\d+|shell-)/.test(name) && name !== current)
    .map((name) => caches.delete(name))))).then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function networkFirst(req, isDocument) {
  /* Sorgu ekleyip no-store ile hem tarayıcı HTTP önbelleğini hem (mümkünse) CDN'i atla. */
  const sep = req.url.indexOf("?") === -1 ? "?" : "&";
  const fresh = new Request(req.url + sep + "_sw=" + Date.now(), { cache: "no-store", credentials: "same-origin" });
  const network = fetch(fresh).then(async (response) => {
    if (response && response.ok && response.type === "basic") await (await getActiveCache()).put(req, response.clone());
    return response;
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT));
  return Promise.race([network, timeout]).catch(async () => {
    const cache = await getActiveCache();
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (isDocument) return (await cache.match("./index.html")) || (await cache.match("./"));
    return new Response("Çevrimdışı", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  });
}
function cacheFirst(req) {
  return getActiveCache().then(async (cache) => {
    const hit = await cache.match(req);
    if (hit) return hit;
    const response = await fetch(req);
    if (response && response.ok && response.type === "basic") await cache.put(req, response.clone());
    return response;
  });
}
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  /* Sürüm dosyası asla önbelleğe alınmaz; her zaman ağdan okunur. */
  if (url.pathname.endsWith("/version.json")) { event.respondWith(fetch(req, { cache: "no-store" })); return; }
  const isDocument = req.mode === "navigate" || req.destination === "document";
  const isAppCode = isDocument || url.pathname.endsWith("/") || /\.(?:html|js|json|css|webmanifest)$/i.test(url.pathname);
  event.respondWith(isAppCode ? networkFirst(req, isDocument) : cacheFirst(req));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => windows.length ? windows[0].focus() : clients.openWindow("./")));
});
