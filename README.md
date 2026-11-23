# AlperFlex

Çok merkezli kargo dağıtımı için bilgisayarda çalışan yönetici paneli ve Android kurye uygulaması. Veriler SQLite dosyasında, bu bilgisayarda saklanır. Supabase veya Google Maps hesabı gerekmez. Adresler metin olarak gösterilir; harita ve otomatik rota yoktur.

**Başlamak için:** [Türkçe kurulum ve test kılavuzu](LOCAL_SETUP.md).

## Komutlar

```powershell
npm ci                 # İlk kurulum
npm run setup:admin    # İlk yönetici
npm run build          # Web üretim derlemesi
npm run start:local    # Web ve API, port 3000
npm run backup         # SQLite yedeği
npm run restore -- "C:\\yedek\\alperflex.sqlite" # Sunucu kapalıyken geri yükleme
npm run build:apk      # Yerel Android test APK'sı
npm run typecheck      # Tip kontrolü
npm test               # Yerel API uçtan uca testi; önce build gerekir
```

Android uygulaması kayıtlı yerel Wi-Fi ve Tailscale adreslerini otomatik dener. Kurye kendi hesabını açar; merkez hesabı onayladıktan sonra giriş yapar. Bilgisayar açık ve web sunucusu çalışır durumda olmalıdır; telefon işlemleri çevrimdışı biriktirmez. Bilgisayarın IP adresi değişirse APK içindeki adreslerin güncellenip yeniden derlenmesi gerekir.

Canlı veritabanı OneDrive ile eşitlenmemesi için varsayılan olarak `%LOCALAPPDATA%\AlperFlex\data.sqlite` konumundadır. `ALPERFLEX_DATA_DIR` ortam değişkeniyle farklı bir dizin seçilebilir. Bu proje test ve demo içindir.
