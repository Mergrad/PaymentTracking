const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("sw.js", "utf8");
const listeners = {};
let skipWaitingCalls = 0;
const context = {
  Request: function Request(url) { this.url = url; },
  Response: function Response(body) { this.body = body; },
  caches: {},
  self: {
    location: { origin: "https://example.test" },
    registration: { scope: "https://example.test/PaymentTracking/" },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => { skipWaitingCalls += 1; },
    addEventListener: (type, handler) => { listeners[type] = handler; }
  },
  clients: { matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve() },
  URL, Promise, setTimeout, clearTimeout
};

vm.createContext(context);
vm.runInContext(source + ";this.shellHash = shellHash;", context);

assert.ok(source.includes("const CACHE_PREFIX = \"odeme-takip-shell-\""));
assert.ok(source.includes("VERSIONED_ASSETS"));
assert.ok(source.includes("cache: \"reload\""));
assert.ok(source.includes("networkFirst(req, isDocument)"));
assert.ok(source.includes("cacheFirst(req)"));
const installBlock = source.slice(source.indexOf('self.addEventListener("install"'), source.indexOf('self.addEventListener("activate"'));
// Güncellemeler kurulu PWA hiç kapanmasa da devreye girsin: install, mevcut bir
// etkin sürüm varsa skipWaiting çağırır; ilk kurulumda beklemede kalır.
assert.ok(installBlock.includes("self.registration.active"));
assert.ok(installBlock.includes("self.skipWaiting()"));
assert.notStrictEqual(context.shellHash(["index-v1", "payments", "manifest"]), context.shellHash(["index-v2", "payments", "manifest"]));

listeners.message({ data: { type: "SKIP_WAITING" } });
assert.strictEqual(skipWaitingCalls, 1);
listeners.message({ data: { type: "OTHER" } });
assert.strictEqual(skipWaitingCalls, 1);

console.log("PWA update flow: OK");
