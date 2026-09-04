# SAÜScript — Masaüstü Yardımcı Programı

Bu depo, [**SAÜScript**](https://yagizberkesu.github.io/sauscript/) için masaüstü yardımcı
programının indirilebilir sürümlerini barındırır. Kod içermez, yalnızca yayınlanan dosyalar burada durur.

**[→ Son sürümü indir](https://github.com/yagizberkesu/sauscript-releases/releases/latest/download/SAUScript-Yardimci.exe)**

## SAÜScript nedir

Sakarya Üniversitesi öğrencilerinin transkriptlerini kendi cihazlarında analiz etmesini sağlayan
bağımsız bir öğrenci projesi. Genel ortalama hesabı, harf notu senaryoları, dönem takibi ve
final hedefi hesaplaması yapar. Bütün hesaplamalar tarayıcının içinde çalışır; sunucu, üyelik
veya SABİS şifresiyle giriş yoktur.

## Yardımcı program ne işe yarıyor

Normalde derslerini siteye aktarmak için SABİS'ten transkript PDF'i indirip yüklemen ya da
sayfayı kopyalayıp yapıştırman gerekir. Bu program o adımı tamamen kaldırır:

1. Sitede **"SABİS'ten otomatik çek"** düğmesine basarsın.
2. Bir tarayıcı penceresi açılır, SABİS girişini orada sen yaparsın.
3. Transkript sayfası kendiliğinden açılır, okunur ve dersler siteye aktarılır.

## Kurulum

1. Yukarıdaki bağlantıdan `SAUScript-Yardimci.exe` dosyasını indir.
2. Çift tıkla.

Hepsi bu. Node.js, npm veya ayrı bir tarayıcı indirmesi gerekmez — her şey tek dosyanın içinde.
Program kendini `%LOCALAPPDATA%\SAUScript` klasörüne kopyalar ve `sauscript://` bağlantılarını
kaydeder; sonrasında indirdiğin dosyayı silebilirsin.

Windows yalnızca Windows 10/11 destekleniyor. Bilgisayarında Chrome, Edge, Opera, Brave, Vivaldi
veya benzeri Chromium tabanlı bir tarayıcı bulunmalı — varsayılan tarayıcın kullanılır.

### SmartScreen uyarısı

Program ücretli bir kod imzalama sertifikasıyla imzalanmadığı için Windows ilk açılışta
"bilinmeyen yayımcı" uyarısı verebilir. **Ek bilgi → Yine de çalıştır** ile geçebilirsin.

## Gizlilik

- SABİS şifreni **program görmez**. Şifreyi açılan tarayıcı penceresinde doğrudan SABİS'e girersin.
- Okunan sayfa metni bilgisayarından çıkmaz; yalnızca `127.0.0.1` üzerinden, açık olan siteye verilir.
- Yerel sunucu sadece kendi bilgisayarını dinler, ağdaki başka cihazlar erişemez.
- İş bittiğinde program kendini kapatır.

## Kaldırma

1. `%LOCALAPPDATA%\SAUScript` klasörünü sil.
2. Tarayıcı oturumunu da temizlemek istersen `%USERPROFILE%\.sauscript` klasörünü sil.
3. Kayıt defterinden `HKCU\Software\Classes\sauscript` anahtarını sil (isteğe bağlı).

---

> SAÜScript'in Sakarya Üniversitesi veya SABİS ile resmî bağlantısı yoktur.
> Gösterilen sonuçlar yalnızca bilgilendirme amaçlıdır.
