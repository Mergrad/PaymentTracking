# Ödeme Takip

Kişisel ödemeleri takip eden, çevrimdışı çalışan bir web uygulaması (PWA).

- Ödeme ve ayar verileri, cihazdaki şifreli kasada AES-GCM ile saklanır. İlk açılışta en az 12 karakterli bir parola belirlenir; parola anahtarı PBKDF2-SHA-256 ile türetilir.
- Kurulumda bir kurtarma anahtarı indirilir. Parola ve cihaz passkey'i kaybolursa verileri kurtarmak için bu anahtar gerekir; güvenli ve ayrı bir yerde sakla.
- Destekleyen cihazlarda Ayarlar > Güvenlik bölümünden passkey eklenebilir. Tarayıcı işletim sistemi doğrulamasını (parmak izi, yüz veya cihaz PIN'i) gösterir; biyometrik veri uygulamaya verilmez. Passkey için HTTPS ve WebAuthn PRF desteği gerekir; destek yoksa parola ile giriş kullanılabilir.
- Cihaz içi otomatik yedekler de şifreli tutulur. İndirilen JSON/CSV yedekleri dışa aktarım için düz metindir; bunları güvenli bir yerde sakla.
- Mevcut ödeme ve ayar verileri ilk parola kurulurken korunarak şifreli kasaya taşınır; eski PIN kaldırılır. Parolanı ve kurtarma anahtarını kaybedersen kasadaki veriler açılamaz.
- Kur göstergesi (USDT/TRY) Ayarlar > Kur Göstergesi'nden kapatılabilir; kapalıyken dış sunucuya istek gönderilmez, son kur cihazda saklanır.
- Yedekleme: Ayarlar > JSON dışa aktar / içe aktar. Özel fatura türleri de yedekle taşınır.
- Dosyalar: `index.html` (arayüz), `app.js` (uygulama), `vault.js` (şifreli saklama ve passkey), `sw.js` (çevrimdışı çalışma ve güncelleme), `manifest.json` (ana ekrana ekleme), `payments.js` (boş başlangıç verisi), `icon-*.png` ve `apple-touch-icon.png` (simgeler).

## Testler

```bash
npm test
```

veya tek tek:

```bash
node tests/critical-flows.test.js
node tests/page-transition.test.js
node tests/pwa-update.test.js
```
