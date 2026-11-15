/* Client-side encrypted storage for Ödeme Takip. No biometric data leaves the OS authenticator. */
(function (global) {
  "use strict";

  var STORE_KEY = "odeme-takip-encrypted-vault-v1";
  var LEGACY_KEYS = ["odeme-takip-pin", "odeme-takip-pin-salt", "odeme-takip-lock"];
  var ITERATIONS = 600000;
  var encoder = new TextEncoder();
  var nativeStore = global.localStorage;
  var values = Object.create(null);
  var meta = null;
  var dataKey = null;
  var unlocked = false;
  var writeQueue = Promise.resolve();

  function randomBytes(length) {
    var bytes = new Uint8Array(length);
    global.crypto.getRandomValues(bytes);
    return bytes;
  }
  function b64(bytes) {
    var binary = "";
    new Uint8Array(bytes).forEach(function (b) { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64(value) {
    var text = String(value).replace(/-/g, "+").replace(/_/g, "/");
    while (text.length % 4) text += "=";
    var binary = atob(text), out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  function requireCrypto() {
    if (!global.isSecureContext || !global.crypto || !global.crypto.subtle || !global.crypto.getRandomValues) {
      throw new Error("Şifreli kasa için HTTPS ve güncel Web Crypto desteği gerekli.");
    }
  }
  function derivePasswordKey(password, salt, iterations) {
    return global.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return global.crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iterations || ITERATIONS, hash: "SHA-256" }, base,
          { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }
  function derivePrfKey(output, salt) {
    return global.crypto.subtle.importKey("raw", output, "HKDF", false, ["deriveKey"])
      .then(function (base) {
        return global.crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt, info: encoder.encode("odeme-takip-vault-prf-v1") }, base,
          { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }
  function deriveRecoveryKey(code, salt) {
    return global.crypto.subtle.importKey("raw", unb64(code), "HKDF", false, ["deriveKey"])
      .then(function (base) {
        return global.crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: salt, info: encoder.encode("odeme-takip-vault-recovery-v1") }, base,
          { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }
  function seal(key, plain) {
    var iv = randomBytes(12);
    return global.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain)
      .then(function (cipher) { return { iv: b64(iv), cipher: b64(cipher) }; });
  }
  function open(key, envelope) {
    return global.crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(envelope.iv) }, key, unb64(envelope.cipher));
  }
  function wrapKey(key, rawKey) { return seal(key, rawKey); }
  function unwrapKey(key, envelope) { return open(key, envelope).then(function (raw) {
    return global.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  }); }
  function currentMeta() {
    try { return JSON.parse(nativeStore.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
  }
  function persist() {
    if (!unlocked || !dataKey || !meta) return Promise.reject(new Error("Kasa kilitli"));
    var snapshot = JSON.stringify(values);
    writeQueue = writeQueue.catch(function () {}).then(function () {
      return seal(dataKey, encoder.encode(snapshot)).then(function (data) {
        meta.data = data;
        nativeStore.setItem(STORE_KEY, JSON.stringify(meta));
      });
    });
    writeQueue.catch(function () {
      try { global.dispatchEvent(new Event("odeme-vault-storage-error")); } catch (e) {}
    });
    return writeQueue;
  }
  function copyLegacyValues() {
    var result = Object.create(null);
    for (var i = 0; i < nativeStore.length; i++) {
      var key = nativeStore.key(i);
      if (key && key.indexOf("odeme-takip-") === 0 && key !== STORE_KEY && LEGACY_KEYS.indexOf(key) === -1) result[key] = nativeStore.getItem(key);
    }
    return result;
  }
  function activate(key, decodedValues) {
    dataKey = key;
    values = decodedValues && typeof decodedValues === "object" ? decodedValues : Object.create(null);
    unlocked = true;
  }
  function dataFromVault(key, saved) {
    return open(key, saved.data).then(function (plain) {
      var parsed = JSON.parse(new TextDecoder().decode(plain));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Kasa verisi geçersiz.");
      return parsed;
    });
  }
  function checkPassword(password) {
    requireCrypto();
    var saved = currentMeta();
    if (!saved || saved.v !== 1 || !saved.password || !saved.data) return Promise.reject(new Error("Şifreli kasa bulunamadı."));
    return Promise.resolve().then(function(){ return derivePasswordKey(password, unb64(saved.password.salt), ITERATIONS); })
      .then(function (key) { return unwrapKey(key, saved.password); })
      .then(function (key) { return dataFromVault(key, saved).then(function (decoded) { meta = saved; activate(key, decoded); return true; }); });
  }
  function enrollPasskey() {
    requireCrypto();
    if (!unlocked) return Promise.reject(new Error("Önce kasanın kilidini açın."));
    if (!global.PublicKeyCredential || !navigator.credentials || !navigator.credentials.create) return Promise.reject(new Error("Bu tarayıcı WebAuthn passkey desteği sunmuyor."));
    var rpId = global.location.hostname;
    if (!rpId) return Promise.reject(new Error("Passkey için geçerli HTTPS adresi gerekli."));
    var challenge = randomBytes(32), prfSalt = randomBytes(32), userId = randomBytes(16);
    return navigator.credentials.create({ publicKey: {
      challenge: challenge,
      rp: { name: "Ödeme Takip", id: rpId },
      user: { id: userId, name: "odeme-takip", displayName: "Ödeme Takip" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
      timeout: 60000,
      attestation: "none",
      extensions: { prf: { eval: { first: prfSalt } } }
    } }).then(function (credential) {
      var result = credential.getClientExtensionResults().prf;
      if (!result || result.enabled !== true || !result.results || !result.results.first) {
        throw new Error("Bu cihaz parmak izi/passkey doğrulamasını destekliyor olabilir, ancak şifreli kasa için gereken PRF özelliğini sunmuyor.");
      }
      return derivePrfKey(result.results.first, prfSalt).then(function (wrappingKey) {
        return global.crypto.subtle.exportKey("raw", dataKey).then(function (raw) {
          return wrapKey(wrappingKey, raw).then(function (envelope) {
            meta.passkey = { credentialId: b64(credential.rawId), salt: b64(prfSalt), iv: envelope.iv, cipher: envelope.cipher };
            nativeStore.setItem(STORE_KEY, JSON.stringify(meta));
            return true;
          });
        });
      });
    });
  }
  function unlockPasskey() {
    requireCrypto();
    if (!global.PublicKeyCredential || !navigator.credentials || !navigator.credentials.get) return Promise.reject(new Error("Bu tarayıcı passkey desteği sunmuyor. Parolayla giriş yapın."));
    var saved = currentMeta();
    if (!saved || !saved.passkey) return Promise.reject(new Error("Kayıtlı passkey bulunamadı."));
    var passkey = saved.passkey;
    var salt = unb64(passkey.salt);
    var challenge = randomBytes(32);
    return navigator.credentials.get({ publicKey: {
      challenge: challenge,
      rpId: global.location.hostname,
      allowCredentials: [{ type: "public-key", id: unb64(passkey.credentialId) }],
      userVerification: "required",
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } }
    } }).then(function (credential) {
      var result = credential.getClientExtensionResults().prf;
      if (!result || !result.results || !result.results.first) throw new Error("Passkey bu cihazda kasa anahtarını açamadı. Parolayla giriş yapın.");
      return derivePrfKey(result.results.first, salt).then(function (wrappingKey) {
        return unwrapKey(wrappingKey, passkey).then(function (key) {
          return dataFromVault(key, saved).then(function (decoded) { meta = saved; activate(key, decoded); return true; });
        });
      });
    });
  }
  function unlockRecovery(code) {
    requireCrypto();
    var saved = currentMeta();
    if (!saved || !saved.recovery) return Promise.reject(new Error("Bu kasa için kurtarma anahtarı bulunmuyor."));
    var recovery = saved.recovery;
    return Promise.resolve().then(function(){ return deriveRecoveryKey(String(code).trim(), unb64(recovery.salt)); })
      .then(function (key) { return unwrapKey(key, recovery); })
      .then(function (key) { return dataFromVault(key, saved).then(function (decoded) { meta = saved; activate(key, decoded); return true; }); });
  }
  function bootstrap() {
    requireCrypto();
    var saved = currentMeta();
    return saved && saved.v === 1 ? "locked" : "setup";
  }
  function initialize(password) {
    requireCrypto();
    var salt = randomBytes(16), rawKey = randomBytes(32);
    return Promise.all([
      derivePasswordKey(password, salt),
      global.crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
    ]).then(function (parts) {
      var wrappingKey = parts[0], key = parts[1], legacy = copyLegacyValues();
      var recoveryCode = b64(randomBytes(32));
      return Promise.all([
        wrapKey(wrappingKey, rawKey),
        seal(key, encoder.encode(JSON.stringify(legacy)))
      ]).then(function (parts2) {
        var recoverySalt = randomBytes(16);
        return deriveRecoveryKey(recoveryCode, recoverySalt).then(function (recoveryWrappingKey) {
          return wrapKey(recoveryWrappingKey, rawKey).then(function (recoveryEnvelope) {
        var saved = { v: 1, iterations: ITERATIONS, password: { salt: b64(salt), iv: parts2[0].iv, cipher: parts2[0].cipher }, data: parts2[1], recovery: { salt:b64(recoverySalt), iv:recoveryEnvelope.iv, cipher:recoveryEnvelope.cipher } };
        nativeStore.setItem(STORE_KEY, JSON.stringify(saved));
        meta = saved;
        activate(key, legacy);
        LEGACY_KEYS.concat(Object.keys(legacy)).forEach(function (oldKey) { try { nativeStore.removeItem(oldKey); } catch (e) {} });
        return { recoveryCode:recoveryCode };
          });
        });
      });
    });
  }
  function changePassword(password) {
    requireCrypto();
    if (!unlocked) return Promise.reject(new Error("Kasa kilitli"));
    var salt = randomBytes(16);
    return derivePasswordKey(password, salt).then(function (wrappingKey) {
      return global.crypto.subtle.exportKey("raw", dataKey).then(function (raw) {
        return wrapKey(wrappingKey, raw).then(function (envelope) {
          meta.password = { salt: b64(salt), iv: envelope.iv, cipher: envelope.cipher };
          return persist().then(function () { nativeStore.setItem(STORE_KEY, JSON.stringify(meta)); });
        });
      });
    });
  }
  function removePasskey() {
    if (!unlocked) return Promise.reject(new Error("Kasa kilitli"));
    delete meta.passkey;
    nativeStore.setItem(STORE_KEY, JSON.stringify(meta));
    return Promise.resolve(true);
  }
  function encryptData(value) {
    if (!unlocked || !dataKey) return Promise.reject(new Error("Kasa kilitli"));
    return seal(dataKey, encoder.encode(JSON.stringify(value)));
  }
  function decryptData(envelope) {
    if (!unlocked || !dataKey) return Promise.reject(new Error("Kasa kilitli"));
    return open(dataKey, envelope).then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }
  var storage = {
    getItem: function (key) { return unlocked && Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem: function (key, value) { if (!unlocked) throw new Error("Kasa kilitli"); values[String(key)] = String(value); persist().catch(function () {}); },
    removeItem: function (key) { if (!unlocked) return; delete values[String(key)]; persist().catch(function () {}); },
    clear: function () { if (!unlocked) return; values = Object.create(null); persist().catch(function () {}); },
    key: function (index) { return unlocked ? Object.keys(values)[index] || null : null; },
    get length() { return unlocked ? Object.keys(values).length : 0; }
  };

  global.OdemeVault = {
    storage: storage,
    bootstrap: bootstrap,
    initialize: initialize,
    unlockPassword: checkPassword,
    enrollPasskey: enrollPasskey,
    unlockPasskey: unlockPasskey,
    unlockRecovery: unlockRecovery,
    changePassword: changePassword,
    removePasskey: removePasskey,
    encryptData: encryptData,
    decryptData: decryptData,
    hasPasskey: function () { var saved = currentMeta(); return !!(saved && saved.passkey); },
    isUnlocked: function () { return unlocked; },
    flush: function () { return writeQueue; }
  };
})(window);
