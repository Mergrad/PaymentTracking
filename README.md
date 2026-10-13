# Ödeme Takip

Kişisel ödemeleri takip eden, çevrimdışı çalışan bir web uygulaması (PWA).

- Veriler yalnızca kullanıcının cihazındaki tarayıcıda saklanır; bu depoda kişisel veri yoktur.
- PIN kilidi isteğe bağlıdır (Ayarlar > Güvenlik). Uygulama ilk açılışta PIN istemez; kilit yalnızca sen belirlediğinde etkinleşir.
- PIN gizlilik amaçlıdır (cihazı eline alan meraklı bakışlara karşı), kriptografik güvenlik iddiası taşımaz; asıl yedek JSON dosyasıdır.
- Kur göstergesi (USDT/TRY) Ayarlar > Kur Göstergesi'nden kapatılabilir; kapalıyken dış sunucuya istek gönderilmez, son kur cihazda saklanır.
- Yedekleme: Ayarlar > JSON dışa aktar / içe aktar. Özel fatura türleri de yedekle taşınır.
- Dosyalar: `index.html` (uygulama), `sw.js` (çevrimdışı çalışma ve güncelleme), `manifest.json` (ana ekrana ekleme), `payments.js` (boş başlangıç verisi), `icon-*.png` ve `apple-touch-icon.png` (simgeler).

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
