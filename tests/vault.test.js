const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const { webcrypto, createHmac } = require("crypto");

const vaultSource = fs.readFileSync("vault.js", "utf8");
const secret = Buffer.from("test authenticator secret");
const credentialId = new Uint8Array([3, 1, 4, 1, 5, 9]);

function memoryStorage(seed) {
  const data = new Map(Object.entries(seed || {}));
  return {
    get length() { return data.size; },
    key(index) { return Array.from(data.keys())[index] || null; },
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
    setItem(key, value) { data.set(String(key), String(value)); },
    removeItem(key) { data.delete(String(key)); },
    dump() { return Object.fromEntries(data.entries()); }
  };
}

function prf(salt) {
  return new Uint8Array(createHmac("sha256", secret).update(Buffer.from(salt)).digest());
}

function createVault(store) {
  const credentials = {
    create: async (options) => ({
      rawId: credentialId,
      getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: prf(options.publicKey.extensions.prf.eval.first) } } })
    }),
    get: async (options) => ({
      rawId: credentialId,
      getClientExtensionResults: () => ({ prf: { results: { first: prf(options.publicKey.extensions.prf.eval.first) } } })
    })
  };
  const window = {
    localStorage: store,
    crypto: webcrypto,
    isSecureContext: true,
    location: { hostname: "example.test" },
    PublicKeyCredential: function PublicKeyCredential() {}
  };
  const context = { window, navigator: { credentials }, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Promise, Object, Array, String, Error, JSON, btoa, atob };
  vm.createContext(context);
  vm.runInContext(vaultSource, context);
  return window.OdemeVault;
}

(async () => {
  const key = "odeme-takip-v1";
  const secretNote = "GİZLİ BORÇ NOTU 987654";
  const store = memoryStorage({
    [key]: JSON.stringify({ version: 1, payments: [{ id: 1, note: secretNote, amount: 88 }], seeded: false }),
    "odeme-takip-settings": JSON.stringify({ fx: false })
  });
  const vault = createVault(store);
  assert.strictEqual(vault.bootstrap(), "setup");

  const initialized = await vault.initialize("uzun ve guclu parola 2026");
  assert.ok(initialized.recoveryCode.length >= 40);
  await vault.flush();
  assert.strictEqual(store.getItem(key), null, "legacy plaintext should be removed after encryption");
  assert.ok(!JSON.stringify(store.dump()).includes(secretNote), "payment note must not be present in localStorage ciphertext");
  assert.strictEqual(vault.storage.getItem(key).includes(secretNote), true, "decrypted data remains available to the app");

  await assert.rejects(createVault(store).unlockPassword("incorrect password"));
  const passwordVault = createVault(store);
  assert.strictEqual(passwordVault.bootstrap(), "locked");
  await passwordVault.unlockPassword("uzun ve guclu parola 2026");
  assert.ok(passwordVault.storage.getItem(key).includes(secretNote));

  await passwordVault.enrollPasskey();
  const passkeyVault = createVault(store);
  await passkeyVault.unlockPasskey();
  assert.ok(passkeyVault.storage.getItem(key).includes(secretNote), "PRF passkey should unwrap the same data key");

  const recoveryVault = createVault(store);
  await recoveryVault.unlockRecovery(initialized.recoveryCode);
  await recoveryVault.changePassword("yeni uzun parola guclu 2026");
  const changedVault = createVault(store);
  await changedVault.unlockPassword("yeni uzun parola guclu 2026");
  assert.ok(changedVault.storage.getItem(key).includes(secretNote));

  const html = fs.readFileSync("index.html", "utf8");
  const app = fs.readFileSync("app.js", "utf8");
  assert.doesNotThrow(() => new Function(app), "application script must parse");
  const csp = html.match(/Content-Security-Policy[^>]*script-src[^;]+/);
  assert.ok(csp && !csp[0].includes("unsafe-inline"), "script CSP must not allow inline handlers");
  assert.ok(html.includes('<script src="./app.js"></script>'), "application code must be loaded as a same-origin external script");
  assert.ok(!html.includes("<script>"), "HTML must not contain inline script blocks");
  console.log("encrypted vault and passkey: OK");
})().catch((error) => { console.error(error); process.exitCode = 1; });
