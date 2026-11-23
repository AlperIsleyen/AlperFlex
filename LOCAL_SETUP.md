# AlperFlex: bilgisayar + Android çalıştırma kılavuzu

Bu kurulumda web paneli, API ve veritabanı sizin Windows bilgisayarınızda çalışır. Android telefon aynı Wi-Fi ağından veya Tailscale ile dışarıdan bağlanır. Modemde port açılmaz. Supabase, Google Maps ve bulut derleme kullanılmaz. İlk kurulumda npm paketlerini, Android araçlarını ve Tailscale uygulamasını indirmek için internet gerekir; sonrasında uygulama verileri bilgisayarda kalır. Dışarıdan bağlantı için telefonun ve bilgisayarın internet erişimi ile Tailscale bağlantısı gereklidir.

## 1. İlk kurulum

1. Windows'ta Node.js 24.14 veya daha yeni bir 24.x sürümü kullanın. PowerShell'de proje klasörünü açın:

   ```powershell
   cd 'C:\Users\alper\OneDrive\Documents\GitHub\AlperFlex'
   node --version
   npm ci
   ```

2. İlk yöneticiyi oluşturun. Komut adı, e-posta ve en az 12 karakterli şifre sorar. Şifre yazılırken ekranda görünmez. Şifreyi komut satırına parametre olarak yazmayın.

   ```powershell
   npm run setup:admin
   ```

3. Ağdan erişim açmadan önce **Yönetici olarak** ayrı bir PowerShell penceresi açıp proje klasöründe şu komutu bir kez çalıştırın:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\configure-firewall.ps1
   ```

   Bu komut TCP 3000'i yerel Wi-Fi/Ethernet alt ağına ve Tailscale arayüzüne açar. Önceden açılmış, bütün portları kapsayan Node.js giriş kurallarını kapatır; başka Node sunucularınız varsa onların erişim kurallarını ayrıca düzenleyin. Wi-Fi ağını değiştirirseniz güvenmediğiniz ortak ağlarda sunucuyu başlatmayın.

   Ardından web'i derleyip başlatın. `start:local` çalıştığı terminal açık kalmalıdır.

   ```powershell
   npm run build
   npm run start:local
   ```

4. Bilgisayarda `http://localhost:3000` adresini açıp ana yönetici hesabıyla giriş yapın. Buradan merkez adını, adresini ve merkezin sorumlu hesabını oluşturun. Mevcut bir merkez için henüz hesap yoksa aynı panelden hesap ekleyin. Merkez hesabıyla giriş yaparak raf/göz ve kargo girin; kurye başvurularını onaylayın. Her şifre en az 12 karakter olmalıdır.

Veritabanı `%LOCALAPPDATA%\AlperFlex\data.sqlite` konumunda otomatik oluşur. OneDrive içindeki proje klasörüne canlı veritabanı yazılmaz. Bilgisayar kapanır veya terminal durursa telefon uygulaması sunucuya bağlanamaz.

## 2. Telefonu aynı Wi-Fi üzerinden bağlama

1. Telefonu ve bilgisayarı aynı Wi-Fi ağına bağlayın. Bilgisayarda `ipconfig` komutunu çalıştırıp aktif Wi-Fi veya Ethernet bağdaştırıcısının **IPv4 Address** değerini bulun. VPN/sanal bağdaştırıcı adresini seçmeyin.
2. Telefon tarayıcısında `http://BILGISAYAR_IP:3000/api/health` adresini açın. `{"ok":true,"name":"AlperFlex"}` görünmelidir.
3. Android uygulamasını açın. Uygulama `192.168.0.143:3000` adresini otomatik dener. **Kurye hesabı oluştur** ile ad, e-posta, şifre ve çalışacağınız merkezi girin. Merkez sorumlusu web panelinde hesabı onayladıktan sonra giriş yapın.

Bağlantı kurulmazsa bilgisayardaki web terminalini, aynı ağa bağlı olmayı ve Windows güvenlik duvarını kontrol edin. `localhost` telefon üzerinde bilgisayarı göstermez. Bilgisayarın IP adresi değişirse `apps/mobile/src/lib.ts` içindeki `SERVER_URLS` listesini güncelleyip APK'yı yeniden derleyin.

## 3. Telefonu dışarıdan bağlama: Tailscale

1. Bilgisayara ve Android telefona Tailscale yükleyin; ikisinde aynı kişisel hesaba giriş yapın. Bilgisayarda Tailscale simgesinin **Connected** olduğunu doğrulayın.
2. Bilgisayarda `tailscale ip -4` komutuyla bilgisayarın `100.x.y.z` biçimindeki Tailscale IP adresini öğrenin. Gerekirse `C:\Program Files\Tailscale\tailscale.exe ip -4` kullanın.
3. Telefonun Wi-Fi bağlantısını kapatıp mobil veriye geçin; telefonda Tailscale'i açın. Telefon tarayıcısında `http://TAILSCALE_IP:3000/api/health` adresini deneyin.
4. Android uygulamasını açın. Uygulama Wi-Fi adresine erişemezse `100.65.74.43:3000` Tailscale adresini otomatik dener. IP farklıysa `apps/mobile/src/lib.ts` içindeki `SERVER_URLS` listesini güncelleyip APK'yı yeniden derleyin.

Tailscale özel ağı dışındaki kişiler bu adrese erişemez. Modemde port yönlendirmeyin. İlk kurulumdaki güvenlik duvarı komutunun başarıyla çalıştığını doğrulayın. Tailscale bağlantısı kurulmadıysa mobil veriden uygulama çalışmaz.

## 4. Android APK'yi bilgisayarda üretme

Android Studio ve Android SDK'yı resmî kurulumla yükleyin. Bu bilgisayarda Android Studio ve komut satırı araçları kurulmuştur. Expo 58 derlemesi Android Platform 37, Build-Tools 37, NDK 27.1 ve Platform-Tools kullanır. İlk derleme Gradle bağımlılıklarını indirmek için internet ister.

Bilgisayardan bağımsız açılabilen test APK'sı için proje ana klasöründe:

```powershell
npm run build:apk
```

Komut, Windows'un uzun dosya yolu sınırını aşmak için projeyi geçici olarak C:\\ kökündeki kısa bir derleme dizinine kopyalar ve bitince temizler. Kaynak kod proje klasöründe kalır. Çıktı `dist\AlperFlex-Kurye.apk` dosyasıdır. Bu test APK'sı ARM64 (`arm64-v8a`) Android telefonlar içindir ve bu bilgisayarda oluşturulan kişisel anahtarla imzalanır. Her başarılı derlemede Android sürüm kodu artar. Mağazaya dağıtım için hazırlanmış değildir.

**Bu imza değişikliğinde bir kez:** Telefonda eski AlperFlex Kurye uygulamasını kaldırıp yeni APK'yı kurun. Eski sürüm genel test anahtarıyla imzalı olduğundan Android, yeni kişisel imzayı mevcut uygulamanın üzerine güncelleme olarak kabul etmez. Uygulamayı kaldırmak telefondaki oturum bilgisini siler; sunucudaki kargo verileri bilgisayarda kalır. Sonraki APK'lar aynı kişisel anahtarla güncellenir. Android, mağaza dışından yüklenen APK için yine kurulum/güncelleme onayı veya Play Protect uyarısı gösterebilir; bu onay uygulama koduyla kaldırılamaz. Yalnızca kendiniz ürettiğiniz APK'yı kurun.

İmza dosyaları `%LOCALAPPDATA%\AlperFlex\signing` klasöründedir ve Git'e eklenmez. `release.p12`, `password.dpapi` ve `version-code.txt` dosyalarını birlikte yedekleyin. DPAPI şifre dosyası bu Windows kullanıcısına bağlıdır; Windows profili kaybolursa eski imzayla güncelleme üretilemez. APK'yı USB ile telefona kopyalayıp açarak kurabilirsiniz. Telefon dosyadan kurulum izni vermezse USB ile bağlayıp **Geliştirici seçenekleri > USB hata ayıklama** ayarını açın, telefondaki izni kabul edin ve `& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r .\dist\AlperFlex-Kurye.apk` komutunu kullanın. `android/` klasörü derleme sırasında üretilir ve Git'e eklenmez.

## 5. Örnek çalışma ve test

1. Ana yönetici hesabında merkezi ve merkez sorumlusunu oluşturun. Merkez hesabıyla giriş yapıp `A1` raf/gözünü ekleyin.
2. Telefonda kurye hesabı açın. Merkez hesabında başvuruyu onaylayın.
3. Merkez hesabının **Kargolar** bölümünde aynı alıcı ve adres için iki kargo oluşturun; **QR yazdır** ile etiketleri açın veya yazdırın.
4. Telefonda kurye hesabına giriş yapıp **Müsait** durumuna geçin. İş teklifi gelmezse merkez hesabında atamayı çalıştırın. Teklif ekranında tüm paketlerin adreslerini inceleyin.
5. İşi kabul edin. Ayrı iş ekranında gösterilen raflardan paketleri alın; merkezde iki kargodan **birinin** QR'ını okutun ve **Tüm paketleri aldım** deyin. QR canlı kamerada algılanmazsa etiketi çerçeveyi dolduracak kadar yaklaştırıp **Fotoğraf çekip tara** düğmesini deneyin. **Dağıtıma başla** ile adres metnini açın.
6. **Adrese vardım** deyin. Bu adresteki **her kargonun** QR'ını ayrı okutun. Bir QR eksikken **Teslim edildi** işlemi tamamlanmaz. İkisi de okutulunca teslimatı tamamlayın.
7. İkinci kurye ile teklif reddi ve yeniden atamayı deneyin. Yanlış QR'ın reddedildiğini doğrulayın. Alınmadan iptal edilen iş beklemeye döner. Alındıktan sonra iptal için paketleri merkeze götürün; merkez sorumlusu iş ekranından 6 haneli iade kodu üretir. Kodu uygulamaya girince paketler tekrar atama bekler.

Web terminalinde `Ctrl+C` sunucuyu durdurur. Telefon sunucu bağlantısını düzenli kontrol eder. Bağlantı kesilirse kurye ekranı kapanır, işlem yapılmaz ve **Sunucu bağlantısı yok** ekranı görünür. Bağlantı geri gelince ekran otomatik yenilenir. Telefon işlemleri çevrimdışı kuyrukta bekletmez.

## 6. Yedek ve geri yükleme

Yedek almak için proje klasöründe `npm run backup` çalıştırın. Tam veritabanı kopyası `%LOCALAPPDATA%\AlperFlex\backups` altına yazılır ve dosya yolu ekrana basılır. Bu yedek klasörünü ayrıca harici diske kopyalamak bilgisayar arızasına karşı korur.

Geri yüklemek için önce web sunucusunu `Ctrl+C` ile durdurun. Sonra proje klasöründe `npm run restore -- "C:\\yedek\\alperflex-....sqlite"` çalıştırın ve `npm run start:local` ile yeniden başlatın. Komut, mevcut veritabanını otomatik olarak `backups` klasörüne yedekler, seçilen dosyanın bütünlüğünü kontrol eder ve eski SQLite WAL dosyalarını temizler. Sunucu çalışırken geri yükleme yapmayın.

## Sınırlar

Bu sürüm test ve demo içindir. Harita, otomatik yol tarifi, internet olmadan telefonda işlem biriktirme ve bilgisayar kapalıyken erişim yoktur. Dış bağlantı için Tailscale'in ücretsiz kişisel planı kullanılır; ticari kullanım ve kesintisiz hizmet için kurulum yeniden değerlendirilmelidir.
