/* Local account sign-in. Data remains in this browser's storage; passwords are verified, not used to encrypt app data. */
(function (global) {
  "use strict";

  var PROFILE_KEY = "odeme-takip-account-v1";
  var LEGACY_VAULT_KEY = "odeme-takip-encrypted-vault-v1";
  var ITERATIONS = 210000;
  var profile = readProfile();
  var signedIn = false;

  function readProfile() {
    try { return JSON.parse(global.localStorage.getItem(PROFILE_KEY) || "null"); } catch (e) { return null; }
  }
  function b64(bytes) {
    var raw = "";
    new Uint8Array(bytes).forEach(function (b) { raw += String.fromCharCode(b); });
    return btoa(raw);
  }
  function unb64(value) {
    var raw = atob(value), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function randomBytes(size) {
    var bytes = new Uint8Array(size);
    global.crypto.getRandomValues(bytes);
    return bytes;
  }
  function passwordDigest(password, salt) {
    if (!global.isSecureContext || !global.crypto || !global.crypto.subtle) return Promise.reject(new Error("Hesap girişi için güvenli bağlantı gerekli (HTTPS)."));
    return global.crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return global.crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
      }).then(b64);
  }
  function same(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    var mismatch = 0;
    for (var i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return mismatch === 0;
  }
  function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
  function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254; }
  function hasLegacyVault() { return !!global.localStorage.getItem(LEGACY_VAULT_KEY); }

  function loadLegacyVault() {
    if (global.OdemeVault) return Promise.resolve(global.OdemeVault);
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "./vault.js";
      script.onload = function () { global.OdemeVault ? resolve(global.OdemeVault) : reject(new Error("Önceki uygulama verileri okunamadı.")); };
      script.onerror = function () { reject(new Error("Önceki uygulama verileri yüklenemedi.")); };
      document.head.appendChild(script);
    });
  }

  function migrateLegacyBackups(legacyVault) {
    if (!global.indexedDB) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var request;
      try { request = indexedDB.open("odeme-takip-backups", 1); } catch (e) { reject(e); return; }
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains("snapshots")) request.result.createObjectStore("snapshots", { keyPath: "ts" });
      };
      request.onerror = function () { reject(request.error || new Error("Yedekler açılamadı.")); };
      request.onsuccess = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains("snapshots")) { db.close(); resolve(); return; }
        var read = db.transaction("snapshots", "readonly").objectStore("snapshots").getAll();
        read.onerror = function () { db.close(); reject(read.error || new Error("Yedekler okunamadı.")); };
        read.onsuccess = function () {
          Promise.all(read.result.map(function (row) {
            if (!row || !row.encrypted) return Promise.resolve(row);
            return legacyVault.decryptData(row.payload).then(function (data) {
              return { ts: data.ts, date: data.date, payments: data.payments, count: data.count };
            });
          })).then(function (rows) {
            var tx = db.transaction("snapshots", "readwrite"), store = tx.objectStore("snapshots");
            rows.forEach(function (row) { if (row) store.put(row); });
            tx.oncomplete = function () { db.close(); resolve(); };
            tx.onerror = function () { db.close(); reject(tx.error || new Error("Yedekler taşınamadı.")); };
            tx.onabort = function () { db.close(); reject(tx.error || new Error("Yedek taşıma işlemi iptal edildi.")); };
          }).catch(function (error) { db.close(); reject(error); });
        };
      };
    });
  }

  function migrateLegacyData(oldPassword) {
    if (!hasLegacyVault()) return Promise.resolve();
    return loadLegacyVault().then(function (legacyVault) {
      return legacyVault.unlockPassword(oldPassword).then(function () {
        return migrateLegacyBackups(legacyVault).then(function () {
          var oldStore = legacyVault.storage;
          for (var i = 0; i < oldStore.length; i++) {
            var key = oldStore.key(i);
            if (key && key.indexOf("odeme-takip-") === 0) global.localStorage.setItem(key, oldStore.getItem(key));
          }
          global.localStorage.removeItem(LEGACY_VAULT_KEY);
          ["odeme-takip-pin", "odeme-takip-pin-salt", "odeme-takip-lock", "odeme-takip-vault-lockout"].forEach(function (key) {
            global.localStorage.removeItem(key);
          });
        });
      }).catch(function () { throw new Error("Eski verilerini taşımak için önceki kasa parolanı gir. Bu parola artık yeni hesap şifren olmak zorunda değil."); });
    });
  }

  function bootstrap() {
    profile = readProfile();
    return profile && profile.email && profile.verifier ? "login" : "setup";
  }
  function register(name, email, password, legacyPassword) {
    name = String(name || "").trim().slice(0, 60);
    email = normalizeEmail(email);
    if (!name) return Promise.reject(new Error("Adını yaz."));
    if (!validEmail(email)) return Promise.reject(new Error("Geçerli bir e-posta adresi yaz."));
    if (String(password || "").length < 8) return Promise.reject(new Error("Şifre en az 8 karakter olmalı."));
    var salt = randomBytes(16);
    return migrateLegacyData(legacyPassword || password).then(function () {
      return passwordDigest(password, salt).then(function (verifier) {
        profile = { version: 1, name: name, email: email, salt: b64(salt), verifier: verifier, iterations: ITERATIONS, biometric: null };
        global.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
        signedIn = true;
        return getProfile();
      });
    });
  }
  function login(email, password) {
    profile = readProfile();
    email = normalizeEmail(email);
    if (!profile || !profile.verifier) return Promise.reject(new Error("Bu cihazda hesap bulunamadı."));
    if (email !== profile.email) return Promise.reject(new Error("E-posta veya şifre yanlış."));
    return passwordDigest(password, unb64(profile.salt)).then(function (verifier) {
      if (!same(verifier, profile.verifier)) throw new Error("E-posta veya şifre yanlış.");
      signedIn = true;
      return getProfile();
    });
  }
  function storeProfile() { global.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }
  function getProfile() { return profile ? { name: profile.name, email: profile.email, hasBiometric: !!profile.biometric } : null; }
  function signedInNow() { return signedIn; }
  function signOut() { signedIn = false; }

  function enrollBiometric() {
    if (!signedIn || !profile) return Promise.reject(new Error("Önce hesabına giriş yap."));
    if (!global.isSecureContext || !global.PublicKeyCredential || !navigator.credentials || !navigator.credentials.create) {
      return Promise.reject(new Error("Bu cihazda parmak izi doğrulaması desteklenmiyor. HTTPS ve uyumlu cihaz gerekir."));
    }
    var rpId = global.location.hostname;
    var challenge = randomBytes(32);
    var userId = new TextEncoder().encode(profile.email).slice(0, 64);
    return navigator.credentials.create({ publicKey: {
      challenge: challenge,
      rp: { name: "Ödeme Takip", id: rpId },
      user: { id: userId, name: profile.email, displayName: profile.name || profile.email },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
      timeout: 60000,
      attestation: "none"
    } }).then(function (credential) {
      profile.biometric = { id: b64(credential.rawId), rpId: rpId };
      storeProfile();
      return true;
    });
  }
  function loginBiometric() {
    profile = readProfile();
    if (!profile || !profile.biometric) return Promise.reject(new Error("Bu hesap için parmak izi girişi ayarlanmamış."));
    if (!global.isSecureContext || !navigator.credentials || !navigator.credentials.get) return Promise.reject(new Error("Bu cihazda parmak izi doğrulaması kullanılamıyor."));
    return navigator.credentials.get({ publicKey: {
      challenge: randomBytes(32),
      rpId: profile.biometric.rpId,
      allowCredentials: [{ type: "public-key", id: unb64(profile.biometric.id) }],
      userVerification: "required",
      timeout: 60000
    } }).then(function (credential) {
      if (!same(b64(credential.rawId), profile.biometric.id)) throw new Error("Parmak izi profili eşleşmedi.");
      signedIn = true;
      return getProfile();
    });
  }
  function removeBiometric() {
    if (!profile) return;
    profile.biometric = null;
    storeProfile();
  }
  function changePassword(currentPassword, newPassword) {
    profile = readProfile();
    if (!profile) return Promise.reject(new Error("Hesap bulunamadı."));
    if (String(newPassword || "").length < 8) return Promise.reject(new Error("Şifre en az 8 karakter olmalı."));
    return passwordDigest(currentPassword, unb64(profile.salt)).then(function (verifier) {
      if (!same(verifier, profile.verifier)) throw new Error("Mevcut şifre yanlış.");
      var salt = randomBytes(16);
      return passwordDigest(newPassword, salt).then(function (newVerifier) {
        profile.salt = b64(salt); profile.verifier = newVerifier; storeProfile();
      });
    });
  }

  global.OdemeAccount = {
    storage: global.localStorage,
    bootstrap: bootstrap,
    hasLegacyVault: hasLegacyVault,
    register: register,
    login: login,
    loginBiometric: loginBiometric,
    enrollBiometric: enrollBiometric,
    removeBiometric: removeBiometric,
    changePassword: changePassword,
    getProfile: getProfile,
    signedIn: signedInNow,
    signOut: signOut
  };
})(window);
