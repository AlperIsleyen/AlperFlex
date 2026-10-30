# AlperFlex

Çok merkezli kargo dağıtımı için Next.js yönetici paneli, Expo Android/iOS kurye uygulaması ve Supabase/PostgreSQL arka ucu.

## Kurulum

1. Supabase projesi açın. `supabase/migrations/001_initial.sql` dosyasını SQL Editor'da çalıştırın.
2. Supabase Authentication panelinden ilk yönetici kullanıcıyı e-posta ve şifre ile oluşturun. Kullanıcının UUID'si ile aşağıdaki komutu SQL Editor'da çalıştırın:

   ```sql
   insert into public.profiles(id, full_name, role)
   values ('AUTH_USER_UUID', 'İlk Yönetici', 'admin');
   ```

3. `apps/web/.env.example` dosyasını `apps/web/.env.local`, `apps/mobile/.env.example` dosyasını `apps/mobile/.env` olarak kopyalayıp anahtarları doldurun. `SUPABASE_SERVICE_ROLE_KEY` yalnızca web sunucusunda kalmalıdır.
4. Google Cloud projesinde Maps SDK for Android, Maps SDK for iOS, Geocoding API ve Routes API'yi açın; faturalandırma ve platforma göre kısıtlanmış anahtarları ayarlayın. Sunucu anahtarını web ortamına, mobil SDK anahtarlarını mobil ortama girin.
5. Kök dizinde `npm install` çalıştırın. Web paneli için `npm run dev:web`; mobil uygulama için `npm run dev:mobile` çalıştırın. Fiziksel telefonda `EXPO_PUBLIC_API_URL`, bilgisayarın yerel ağ IP adresindeki web sunucusunu göstermelidir.
6. Haritanın yerel SDK kurulumu gerektiğinden mobil uygulamayı Expo development build ile açın (`npm run android -w @alperflex/mobile` veya macOS üzerinde `npm run ios -w @alperflex/mobile`). Google Maps anahtarları olmadan harita görüntülenmez.

## İşleyiş

- Yönetici merkez, raf/göz ve kurye hesabı oluşturur. Kurye bir vardiyada tek merkeze bağlıdır; azami parça sayısı hesap oluştururken belirlenir.
- Yönetici kargo ve adresleri elle girer. Adresler koordinata çevrilir ve her kargoya benzersiz QR etiketi basılır. Aynı alıcı ve teslimat adresinin aynı metinle girilmesi, parçaların kapasite elverdiğince birlikte gruplanmasını sağlar.
- Kurye uygulamada müsait duruma geçince kendi merkezinden ve kapasitesine uygun iş önerilir. Reddedilen iş başka uygun kuryeye gider; uygun kurye yoksa sırada kalır.
- Merkezde bir QR okutulup tüm parçalar alındığı onaylanır. Adreste ise her parçanın QR'ı ayrı okutulur. QR kodu yalnızca rastgele UUID içerir.
- İnternet bağlantısı gereklidir. Konum izni verilmezse açık adres görünür ve kurye varışı konumsuz kaydedebilir.

## Doğrulama

`npm run typecheck` ve `npm run build` çalıştırın. Canlı Supabase ve Google anahtarlarıyla iki merkez, iki kurye ve belge/kutu/paket örnekleri oluşturup şu akışları deneyin: reddedilen teklifin yeniden önerilmesi, beş parçalık işin merkezde tek QR ile doğrulanması, yanlış QR'ın reddedilmesi ve aynı adresteki iki kutunun ikisi okutulmadan teslimatın tamamlanamaması.

Güncel Expo/React Native araç zincirinde `npm audit` yüksek önem dereceli transitive uyarılar gösterebilir. `npm audit fix --force` uyumsuz eski sürümlere düşürmeyi önerdiği için uygulanmadı; canlı yayından önce bağımlılık duyurularını ve gerçek cihaz testlerini yeniden değerlendirin.

## Yapı

- `apps/web`: yönetici paneli ve kimlik doğrulamalı API.
- `apps/mobile`: Android/iOS kurye uygulaması.
- `supabase/migrations`: veri modeli, erişim kısıtları ve atomik iş geçişleri.

Alıcı uygulaması, yönetici tarafında QR ile kargo ekleme, fotoğraf, alıcı kodu ve çevrimdışı çalışma ilk sürümün dışındadır.
