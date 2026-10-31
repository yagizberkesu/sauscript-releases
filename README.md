# SAÜScript — Masaüstü Yardımcı Programı

Bu depo, [**SAÜScript**](https://yagizberkesu.github.io/sauscript/) için masaüstü yardımcı
programının kaynak kodunu ve indirilebilir sürümlerini barındırır. Program açık kaynaklıdır
([MIT lisansı](LICENSE)): ne yaptığını satır satır okuyabilir, istersen kendin derleyebilirsin.

**[→ Son sürümü indir](https://github.com/yagizberkesu/sauscript-releases/releases/latest)**  
Dosya adı sürüm numarasını taşır, örneğin `SAUYardimci-1.3.2.exe`.

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

1. Yukarıdaki bağlantıdan `SAUYardimci-<sürüm>.exe` dosyasını indir.
2. Çift tıkla.

Hepsi bu. Node.js, npm veya ayrı bir tarayıcı indirmesi gerekmez — her şey tek dosyanın içinde.
Program kendini `%LOCALAPPDATA%\SAUScript` klasörüne kopyalar ve `sauscript://` bağlantılarını
kaydeder; sonrasında indirdiğin dosyayı silebilirsin.

Windows yalnızca Windows 10/11 destekleniyor. Bilgisayarında Chrome, Edge, Opera, Brave, Vivaldi
veya benzeri Chromium tabanlı bir tarayıcı bulunmalı — varsayılan tarayıcın kullanılır.

### SmartScreen uyarısı

Program ücretli bir kod imzalama sertifikasıyla imzalanmadığı için Windows ilk açılışta
"bilinmeyen yayımcı" uyarısı verebilir. **Ek bilgi → Yine de çalıştır** ile geçebilirsin.

### İndirdiğin dosyayı doğrulama

v1.2.0'dan itibaren her sürüm GitHub Actions üzerinde kaynak koddan otomatik derlenir; sürüm sayfasında
exe'nin SHA256 özeti ve `.sha256` dosyası bulunur. PowerShell'de karşılaştırmak için:

```powershell
Get-FileHash .\SAUYardimci-1.3.2.exe
```

## Gizlilik

- SABİS şifreni **program görmez**. Şifreyi açılan tarayıcı penceresinde doğrudan SABİS'e girersin.
- Okunan sayfa metni bilgisayarından çıkmaz; yalnızca `127.0.0.1` üzerinden, açık olan siteye verilir.
- Yerel sunucu sadece kendi bilgisayarını dinler, ağdaki başka cihazlar erişemez.
- İş bittiğinde program kendini kapatır.

## Kaynak kod

| Dosya | Ne yapar |
| --- | --- |
| [`scripts/fetch-notlar-handler.ts`](scripts/fetch-notlar-handler.ts) | Programın kendisi: tarayıcıyı açar, SABİS sayfasının metnini okur, `127.0.0.1:53412` üzerinden siteye verir |
| [`scripts/build-exe.mjs`](scripts/build-exe.mjs) | Kodu Node.js'in [tek dosyalık çalıştırılabilir](https://nodejs.org/api/single-executable-applications.html) özelliğiyle `.exe`'ye paketler |
| [`src/parser.ts`](src/parser.ts), [`src/types.ts`](src/types.ts) | Transkript metnini derslere ayıran, sitedekiyle aynı ayrıştırıcı |

Programın dış bağımlılığı yoktur; yalnızca Node.js'in kendi modüllerini kullanır. İnternete yalnızca
açtığın tarayıcı penceresi üzerinden, SABİS'e (`obs.sabis.sakarya.edu.tr`) bağlanır.

### Kendin derlemek için

Windows'ta [Node.js 22 veya üstü](https://nodejs.org/) kurulu olmalı.

```bash
npm install
npm run build
```

Çıktı `build/SAUScript-Yardimci.exe` olur. Derlemeden, doğrudan kaynaktan da çalıştırabilirsin:

```bash
npm run register   # sauscript:// bağlantılarını bu kaynak klasöre yönlendirir
npm run file       # siteye aktarmak yerine sonucu JSON dosyasına yazar
```

## Lisans

[MIT](LICENSE) — kullanabilir, değiştirebilir ve paylaşabilirsin; yalnızca lisans metnini korumalısın.

## Kaldırma

**Windows Ayarlar › Uygulamalar › Yüklü uygulamalar › SAÜScript+ Yardımcı › Kaldır.**
Program onay ister; ardından kendisini, SABİS için açılan tarayıcı profilini ve `sauscript://`
bağlantısını siler. Sitedeki derslerin ve notların etkilenmez.

1.3.0'dan eski bir sürüm kurduysan program listede görünmeyebilir. Programı bir kez kullanınca
listeye eklenir; ya da şunları elle silebilirsin:

1. `%LOCALAPPDATA%\SAUScript` klasörü
2. `%USERPROFILE%\.sauscript` klasörü (tarayıcı oturumu ve kayıtlar)
3. Kayıt defterinde `HKCU\Software\Classes\sauscript` anahtarı

---

> SAÜScript'in Sakarya Üniversitesi veya SABİS ile resmî bağlantısı yoktur.
> Gösterilen sonuçlar yalnızca bilgilendirme amaçlıdır.
