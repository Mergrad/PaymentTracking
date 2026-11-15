# Ödeme Takip

Kişisel ödemeleri takip eden, çevrimdışı çalışan bir web uygulaması (PWA).

- İlk açılışta bu cihaz için ad, e-posta ve şifreyle bir yerel profil oluşturulur. Hesap sunucuya bağlanmaz; e-posta doğrulaması ve cihazlar arasında eşitleme yoktur.
- Şifre giriş kontrolünde kullanılır; ödeme verileri tarayıcının yerel depolamasında normal şekilde tutulur. Cihazdan tarayıcı verilerini silmek kayıtları kaldırabilir; JSON yedeğini düzenli al.
- Destekleyen cihazlarda Ayarlar > Giriş Güvenliği bölümünden parmak izi/cihaz doğrulaması etkinleştirilebilir. İşletim sistemi Windows Hello, Touch ID, yüz tanıma veya cihaz PIN'i isteyebilir.
- Eski sürümde şifreli kasa varsa hesap oluştururken eski kasa parolasını girerek ödeme, ayar ve cihaz yedeklerini yeni yerel depolamaya taşı.
- Kur göstergesi (USDT/TRY) Ayarlar > Kur Göstergesi'nden kapatılabilir; kapalıyken dış sunucuya istek gönderilmez, son kur cihazda saklanır.
- Yedekleme: Ayarlar > JSON dışa aktar / içe aktar. Özel fatura türleri de yedekle taşınır.
- Dosyalar: `index.html` (arayüz), `app.js` (uygulama), `account.js` (yerel hesap girişi), `vault.js` (yalnızca eski sürüm verilerini taşıma), `sw.js` (çevrimdışı çalışma ve güncelleme), `manifest.json` (ana ekrana ekleme), `payments.js` (boş başlangıç verisi), `icon-*.png` ve `apple-touch-icon.png` (simgeler).

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
