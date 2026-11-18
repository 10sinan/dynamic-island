# Dynamic Island — GNOME Shell 50 eklentisi

Üst panelde **üç siyah hap**. **Tıklama yok**: her şey üstüne gelince açılır, imleç çekilince kapanır.

```
[ sol: istatistik ]  (Activities yerine)     [ orta: saat + müzik ]     [ sağ: ses/Wi-Fi/pil ]
```

| | Panelde (kapalı) | Üstüne gelince |
|---|---|---|
| **Sol** (Activities'in yerine) | `CPU 8%  RAM 62%` (seçilebilir) | CPU, RAM, sıcaklık, ağ, pil, **GPU**, **disk** karoları · son 60 sn'nin **canlı CPU / RAM / ağ grafiği** · **en çok CPU ve bellek kullanan 3 uygulama** |
| **Orta** (saatin yerine) | saat, bildirim noktası, **müzik (kapak + equalizer)** | en üstte **büyük saat + tarih** · **müzik kartı** · **takvim** (ay görünümü, ‹ › ile ay değiştir, başlığa tıkla = bugün) · **bildirim listesi** (tıkla = aç, × = kapat, Temizle) |
| **Sağ** (Quick Settings) | Wi-Fi sinyali, ses, Bluetooth (bağlıyken), Rahatsız Etme (açıkken), pil + yüzde | **ses + parlaklık kaydırıcıları** · **düğmeler**: Wi-Fi ›, Bluetooth ›, Karanlık, Gece ışığı, Rahatsız etme, Uçak modu, Güç modu · **pano geçmişi** (son 10 kopya) · **pil + ekran görüntüsü, ayarlar, kilit, güç** (Uyku / Yeniden başlat / Kapat / Oturumu kapat) |

- **Super+A:** GNOME'un Quick Settings kısayolu (varsayılan `Super+A`, GNOME Ayarlar → Klavye'den değiştirdiysen o tuş) GNOME menüsü yerine **sağ island'ı** açar. Fare olmadan da açık kalır. Kapatmak için tekrar `Super+A`, `Esc` ya da island dışına tıklama yeter; dışarı tıklama yalnızca island'ı kapatır, alttaki pencereye geçmez. `shortcut-qs=false` ile GNOME'un menüsü geri gelir. Sağ island kapalıyken ya da tam ekranda kısayol yine GNOME'un menüsünü açar.
- **Sol island ve Activities:** Island, GNOME'un Activities düğmesinin yerini alır. Genel bakış yine **Super** tuşuyla (ve varsa hot corner ile) açılır. Düğmeyi geri istersen `di-config`'ten sol island'ı kapat: `stats-enabled=false`.
- **Wi-Fi ›:** island içinde yakındaki ağları listeler. Bir ağa tıklayınca bağlanır; şifreli yeni ağlarda şifreyi GNOME'un kendi penceresi sorar.
- **Bluetooth ›:** eşleşmiş cihazları listeler. Tıklayınca bağlanır ya da bağlantıyı keser.
- **Kaydırıcılar:** Sürüklerken imleç island'ın dışına çıksa da island açık kalır.
- **GNOME menüleri:** GNOME'un kendi takvim ve Quick Settings menüleri kullanılmaz; yalnızca klavye kısayolu (`Super+V`) ile açılırlar.
- **Sağ ikon satırı:** Menü çubuğu tarzında, Cairo ile çizilmiş özgün vektör ikonlar (`lib/glyphs.js`): Wi-Fi yelpazesi (sinyale göre 0-3 yay yanar, kapalıyken üstü çizili), dalgalı hoparlör (sessizde çarpı), Bluetooth, Rahatsız Etme ayı ve yuvarlak köşeli pil. Pilde doluluk yuvarlak bir dolgu olarak çizilir; %20 ve altında kırmızı, şarjdayken yeşil ve içinde şimşek vardır. Hepsi 16 px'lik aynı çizgide, eşit aralıkla durur. Bluetooth ve Rahatsız Etme yalnızca ilgiliyken görünür. Mikrofon, kamera, konum, ekran paylaşımı gibi nadir GNOME göstergeleri yalnızca görünür oldukları sürece eklenir. Hazır ikon seti kullanılmadığı için lisans sorunu yoktur.

### Müzik

Spotify, tarayıcılar (YouTube Music dahil), VLC, Rhythmbox gibi **MPRIS** destekleyen her oynatıcıyla çalışır:

- **Panelde:** Çalarken küçük kapak ve hareketli equalizer görünür. Müzik durunca ya da oynatıcı kapanınca kaybolur ve pill eski genişliğine döner.
- **Üstüne gelince:** Saatin altında kart açılır. Kapakta kapak, başlık, sanatçı, albüm, ilerleme çubuğu ve ⏮ ⏯ ⏭ düğmeleri vardır. İlerleme çubuğuna tıklayınca şarkıda o noktaya atlar.
- **Şarkıya göre renk:** Albüm kapağından **iki ayrı renk** çıkarılır (beyaz çerçeve gibi kenarlar yok sayılır; tek renkli kapakta ikinci renk komşu bir ton olur). Kart arka planı, ilerleme çubuğu, equalizer ve oynat düğmesi bu renklerle boyanır. Şarkı değişince renkler yumuşakça geçer, kapak çapraz solarak değişir.
- **Hareket:** Kart açıkken ve müzik çalarken arka plandaki renkler yavaşça akar, kapağın arkasındaki parıltı ve kapak hafifçe nabız atar, equalizer çubukları (5 adet, iki renkli) oynar. **Müzik çalarken island'ın gövdesi de albüm renginde iki renkli bir gradient'e dönüşür** (panelde, açıkken ve şarkı değişimi önizlemesinde), kenarı albüm renginde yanar; duraklayınca ya da müzik bitince 0,7 sn'de tema rengine geri döner. Duraklayınca her şey durur; kart kapalıyken hiçbir animasyon çalışmaz.
- **Şarkı değişince:** Island kısa süre (4 sn) kapak, başlık ve sanatçıyla açılır. `music-popup` ile kapatılabilir.
- Birden çok oynatıcı varsa çalan, yoksa en son çalan gösterilir.
- Kapaklar `file://` ya da `https://` adresinden alınır. `https` için yalnızca oynatıcının bildirdiği kapak adresi istenir, başka bir şey gönderilmez.
- `dynamic-music-pill` eklentisi dock'ta çalışmaya devam eder; ikisi birbirini etkilemez.

### Video önizleme

Müzik kartında, çalan oynatıcının **penceresi bulunursa** bir 📹 **Video** düğmesi çıkar. Basınca kapak yerine o pencerenin **canlı küçük görüntüsü** gösterilir (mpv, VLC, Totem, tarayıcıdaki YouTube...), tekrar basınca kapağa döner. Nasıl çalışır ve sınırları:

- Oynatıcılar video karelerini dışarıya vermez; eklenti GNOME'un kendi genel bakış küçük resimlerinin kullandığı yolla pencerenin kendisini klonlar (`Shell.WindowPreviewLayout`). Bu yüzden tarayıcıda **tüm pencere** görünür, yalnızca video kısmı değil.
- Pencere, oynatıcının kimliğinden (MPRIS `Identity` / `DesktopEntry` / veri yolu adı) bulunur. Birden çok pencere varsa başlığı şarkı/video başlığını içeren seçilir (Türkçe `ı`/`i` ve aksan farkı yok sayılır).
- Kart kapanınca klon bırakılır; pencere kapanırsa düğme ve önizleme kendiliğinden gider.
- Pencere başka çalışma alanında ya da simge durumundaysa uygulama kare üretmeyebilir; görüntü donabilir.
- `music-video=false` ile düğme tamamen kaldırılır.

### Pano geçmişi

Sağ island'da **son 10 kopya** listelenir (metin ve resim; resimler küçük resimle). Bir kayda tıklayınca **panoya geri konur**, sen istediğin yere kendin yapıştırırsın (otomatik yapıştırma yok: terminalde ve bazı uygulamalarda yanlış çalışır). Liste 5-6 satırdan uzunsa tekerlekle kayar, **Temizle** hepsini siler.

- **Yalnızca bellekte tutulur**, diske hiçbir şey yazılmaz; oturumu ya da eklentiyi kapatınca silinir. Ayar değiştirince (island'lar yeniden kurulurken) silinmez.
- Parola yöneticilerinin "bu gizli" işaretiyle (`x-kde-passwordManagerHint` vb.) kopyaladığı içerik hiç okunmaz.
- Aynı şeyi tekrar kopyalarsan yeni satır eklenmez, üste taşınır. Çok uzun metinler 20 000 karakterde, 8 MB'tan büyük resimler hiç kaydedilmez.
- `clipboard-history=false` ile izleme tamamen durur ve bölüm kaybolur. Kurulu `gnome-clipboard` gibi bir pano eklentisiyle birlikte çalışır, ikisi birbirini etkilemez.

### Olay göstergeleri

Orta island, makinede bir şey olunca kısa süre kendiliğinden açılır (sinyallerle çalışır, polling yok):

| Olay | Gösterim |
|---|---|
| Şarj kablosu takıldı / çıkarıldı | `⚡ Şarj oluyor · %62` |
| Pil %20 ve %10'a düştü | `Pil düşük · %19 kaldı` (sarı / kırmızı) |
| Wi-Fi bağlandı / koptu | `EvAğı · Bağlandı`, `Bağlantı koptu` |
| Bluetooth cihazı bağlandı / ayrıldı | `Kulaklık · Bağlandı` (cihazın simgesiyle) |
| Mikrofon / kamera kullanılıyor | turuncu / yeşil nokta |
| CPU 90°C'yi geçti | `Sistem ısındı · CPU 92°C` (kırmızı) |
| RAM %90'ı geçti | `Bellek az · %93 dolu` |
| Disk (`/`) %95'i geçti | `Disk dolmak üzere · %97 dolu · 12 GB boş` |
| Caps Lock / Num Lock açıldı-kapandı | `AA · Caps Lock · Açık` (GNOME bunlar için hiçbir gösterge vermez) |
| Klavye düzeni değişti | `TR · Türkçe (Q)` |
| Toplantı modu açıldı / bitti | `Bildirimler susturuldu` / `Bildirimler yeniden açık` |
| Güç tasarrufu açıldı / kapandı | `Pil %19 · ekran ve işlemci kısıldı` |

Sıcaklık, bellek ve disk 10 saniyede bir okunur. Her uyarı eşik aşılınca bir kez gösterilir ve değer tekrar düşünce (85°C, %85, %92) yeniden kurulur. Başlangıçta ilk değerler yalnızca kaydedilir, olay üretilmez. Island o sırada açıksa (sen kullanıyorsan) olay gösterilmez. Hangi olayların açık olduğunu `di-config` → **Olaylar** sekmesinden seçersin.

Orta island ayrıca kısa süreli **etkinlikler** gösterir:
- **Ses / parlaklık:** tuşa basınca GNOME'un ortadaki kutusu yerine island `🔊 ▬▬▬▬── 64%` diye açılır. Tuş basılı tutulursa yeniden animasyon yapmadan yerinde güncellenir.
- **Bildirim önizleme:** yeni bildirim gelince island uygulama, başlık ve metinle açılır.
  - Önizlemenin kendisine tıklamak bildirimi açar; sağ tık önizlemeyi kapatır; üstüne gelince süre durur.
  - Rahatsız Etme ayarına uyar.
- Caps Lock, klavye düzeni gibi diğer OSD'ler ve tam ekrandaki değişiklikler GNOME'un kendi göstergesinde kalır.

- **Hover:** Üstüne gelince hemen, yaylanarak açılır. İmleç çekilince 150 ms sonra kapanır. İmleç yokken 5 sn sonra kendiliğinden kapanır.
- **Ayarlar:** Hepsi `di-config` terminal arayüzünden değiştirilir ve **anında** uygulanır.
- **Gizlenme:** Tam ekran uygulamalarda panelle birlikte gizlenir. Etkinlikler ekranında görünür kalır.
- **Veri okuma:** Veriler `/proc`, `/sys` ve shell servisleri (Gvc, NetworkManager, GnomeBluetooth, PowerProfiles) üzerinden **asenkron** okunur; ana thread bloklanmaz.
- **Tasarım:** Tamamen özgündür; üçüncü taraf ikon ya da karakter kullanılmaz.

## Kurulum

```bash
cd ~/projects/dynmıc_island
./install.sh                                  # şemayı derler, eklentiyi ve di-config'i bağlar
# → oturumu BİR KEZ kapatıp tekrar aç (Wayland'da shell yeniden başlatılamaz)
gnome-extensions enable dynamic-island@local
```

Sonraki **ayar** değişiklikleri için tekrar giriş gerekmez. Yalnızca **kod** değişince
tekrar giriş gerekir; GJS modülleri önbellekte tuttuğu için `disable`/`enable` yetmez.

## Özelleştirme: `di-config`

```bash
di-config            # etkileşimli terminal arayüzü
```

| Tuş | İşlev |
|---|---|
| `↑` `↓` | gez |
| `←` `→` (`+` `−`) | sayıyı / seçimi değiştir |
| `Space` | aç/kapa, modülü göster/gizle |
| `Enter` | (renkte) `#rrggbb` gir |
| `Tab`, `1`–`5` | sekme: Genel · Zamanlama · Görünüm · Orta modüller · QS modülleri |
| `J` / `K` | modülü aşağı / yukarı taşı |
| `p` | (orta modüller) panelde de göster |
| `r` / `R` | seçili ayarı / hepsini varsayılana döndür |
| `q` | çık |

Komut satırından (betikler için):

```bash
di-config list
di-config set hover-expand-delay 0
di-config set leave-collapse-delay 150
di-config set center-modules cpu,ram,temp,net,battery
di-config set center-compact-modules cpu,ram,temp      # panelde görünenler
di-config set accent-color '#5ab8ff'
di-config reset                                       # hepsini varsayılana döndür
```

| Anahtar | Varsayılan | Anlamı |
|---|---|---|
| `center-enabled` / `stats-enabled` / `qs-enabled` | açık | orta / sol (istatistik) / sağ island |
| `expand-on-hover` | açık | üstüne gelince aç (tek açılma yolu) |
| `hover-expand-delay` | 0 ms | açılmadan önce bekleme |
| `leave-collapse-delay` | 150 ms | imleç çekilince kapanmadan önce bekleme |
| `auto-collapse` | 5000 ms | imleç yokken kendiliğinden kapanma (0 = asla) |
| `animation-duration` / `spring` | 420 ms / açık | açılma animasyonu, yaylanma |
| `poll-compact` / `poll-expanded` | 2000 / 1000 ms | veri yenileme aralığı |
| `center-modules` | music, calendar, notifications | orta island içeriği (müzik kartı saatin altında, takvim/bildirimler yanyana) |
| `center-compact-modules` | music | saatin yanında panelde görünenler |
| `stats-modules` | cpu, ram, temp, net, battery, gpu, disk, graph, procs | sol island içeriği |
| `stats-compact-modules` | cpu, ram, disk | sol pill'de panelde görünenler |
| `events` | power, battery-low, wifi, bluetooth, privacy, thermal, memory, disk, lockkey, layout, meeting, powersaver | island'ı kısa süre açan olaylar |
| `language` | tr | arayüz dili: `tr` (Türkçe) ya da `en` (English). Cihazın diline **bağlı değildir**; yalnızca buradan değişir |
| `theme` | ink | `ink`, `midnight`, `sunset`, `forest`, `rose` |
| `accent-color` | boş | vurgu rengi (#rrggbb); boş = temanın rengi |
| `clipboard-history` | açık | son 10 kopyayı bellekte tut, sağ island'da göster |
| `music-video` | açık | müzik kartında Video (pencere önizleme) düğmesi |
| `meeting-mode` | açık | mikrofon/kamera kullanılırken Rahatsız Etme |
| `auto-power-saver` / `auto-power-saver-level` | açık / 20 | düşük pilde Güç Tasarrufu / pil yüzdesi eşiği |
| `shortcut-qs` | açık | Super+A (GNOME'un Quick Settings kısayolu) sağ island'ı açar |
| `screenshot-preview` | açık | ekran görüntüsü küçük resmi (bildirim önizlemeye bağlı) |
| `layout-version` | 2 | iç kullanım: eski kayıtlı listelerin otomatik taşınması |
| `qs-modules` | sliders, toggles, clipboard, system | sağ island bölümleri (yukarıdan aşağı) |
| `show-seconds` | kapalı | island saatinde saniye |
| `osd-enabled` | açık | ses/parlaklık göstergesi island'da |
| `music-popup` | açık | şarkı değişince kısa önizleme |
| `notification-preview` | açık | bildirimler island'da |
| `notification-duration` | 5000 ms | önizleme süresi (kritik bildirimler en az 10 sn) |

## Nasıl çalışıyor?

### Panel yerini alma (`lib/panelSlot.js`)

Saat (`dateMenu`), Quick Settings ve Activities düğmeleri **silinmez**:

- Görünmez yapılırlar (`opacity 0`), ama panelde kalıp yer kaplamaya devam ederler.
- Kapladıkları genişlik island'ın genişliğine ayarlanır. Böylece paneldeki diğer öğeler island'ın altına kaymaz.
- Menüleri (takvim, Quick Settings) ve kısayolları (`Super+V`, Super ile genel bakış) aynen çalışır.
- `disable()` opaklığı ve doğal genişliği geri verir.

### Toplantı modu

Mikrofon ya da kamera kullanılmaya başlayınca (Meet, Zoom, Teams, sesli arama, kayıt) **Rahatsız Etme otomatik açılır**, bırakılınca 10 saniye sonra eski haline döner. Kurallar:

- 2 saniye beklenir; mikrofonu kısa süre deneyince açılmaz. Aramadaki kısa kesintilerde de hemen kapanmaz.
- Rahatsız Etme zaten açıksa dokunulmaz ve asla kapatılmaz.
- Arama sırasında Rahatsız Etme'yi kendin kapatırsan eklenti karışmaz.
- Eklentinin açtığı bilgisi ayarlarda saklanır; oturum ortasında çökme ya da çıkış olursa bir sonraki açılışta geri alınır. Eklentiyi kapatmak da hemen geri alır.
- `meeting-mode=false` ile tamamen kapatılır.

### Otomatik güç tasarrufu

Pil %20'nin (ayarlanabilir) altına düşünce ve şarjda değilken `power-profiles-daemon`'dan **Güç Tasarrufu profili istenir** (`HoldProfile`). Bu bir "tutma"dır: bıraktığında daemon kendiliğinden önceki profile döner, eklentinin geri yüklenecek bir durum tutması gerekmez. Şarja takınca, eklenti kapanınca ya da süreç ölünce bırakılır. Profili kendin değiştirirsen daemon tutmayı bırakır ve eklenti bir sonraki şarja kadar tekrar istemez.

### Disk hızı göstergesi

Diskte iki ölçüm üst üste yüksek okuma+yazma (≥50 MB/s) görünce sol pill'de küçük bir disk simgesi ve toplam hız (`190 MB/s`) belirir ve island `Büyük dosya işlemi · ↓ 100 MB/s ↑ 90 MB/s` diye kısa süre açılır. Hız 20 MB/s'nin altına inince `Dosya işlemi bitti · 12.4 GB aktarıldı` der. Açık island'ın DISK karosunda da canlı hız görünür. **Yüzde ve kalan süre yoktur:** işletim sistemi işlemin toplam boyutunu bildirmez (Nautilus 50 ilerlemeyi yalnızca kendi penceresinde gösterir, dışarıya sunmaz). USB bellek, SD kart ve NVMe/SATA diskler sayılır; bölümler ve sanal cihazlar (loop, dm, zram) hariç.

### Dil (Türkçe / English)

Arayüz dili cihazın diline göre **değil**, `language` ayarına göre belirlenir (varsayılan `tr`). `di-config` → Genel → **Dil / Language** ile ya da `di-config set language en` ile değişir; island'lar ve `di-config` arayüzü anında yeni dile geçer. Tarih/ay/gün adları ve takvimin hafta başlangıcı da dile bağlıdır (Türkçe: Pazartesi, English: Sunday). Yeni dil eklemek için `lib/i18n.js` içindeki tabloya (İngilizce metin → çeviri) ve `tools/di-config` içindeki `EN` sözlüğüne bakın.

### Temalar

`di-config` → Görünüm → **Renk teması**: Mürekkep (siyah, varsayılan), Gece mavisi, Gün batımı, Orman, Gül. Tema island'ın zeminini, kenarını (üstüne gelince parlar) ve varsayılan vurgu rengini birlikte değiştirir. **Vurgu rengini** ayrıca elle seçersen o, temanın rengini ezer; "tema rengi" seçeneği temanınkine döner. Müzik çalarken kenar albüm renginde yanmaya devam eder.

### Eski ayarların taşınması

Daha önce `di-config` ile kaydedilmiş `center-modules` / `center-compact-modules` listeleri varsayılanı ezdiği için, eklenti ilk açılışında `cpu, ram, temp, net, battery` kimliklerini bu listelerden **sol island'ın listelerine taşır** (sıran ve seçimlerin korunur), sonra `layout-version=2` yazar. Yeni modüller (GPU, disk, grafik, süreçler) sol island'a eklenir.

### Grafikler

`lib/history.js` zaman damgalı örnekleri tutar, `lib/graph.js` onları Cairo ile çizer. CPU, RAM ve ağ modülleri island kapalıyken de örnek toplar (yalnızca birkaç dosya okuması), böylece grafik açılınca zaten dolu gelir. Çizim yalnızca island açıkken yapılır. Süreç listesi `/proc/<pid>/stat` dosyalarını yalnızca island açıkken, asenkron ve 24'erli gruplar halinde okur; aynı adlı süreçler (bir tarayıcının onlarca süreci) tek satırda toplanır.

### Akıcılık

Animasyon sırasında hiçbir içerik yeniden yerleşmez:

- **Hareket eden tek parça:** Yalnızca içi boş siyah arka plan (`bg`) büyüyüp küçülür.
- **İçerik:** Saat, karolar, OSD ve bildirim zaten son konumlarında durur; yalnızca solup belirir ve `bg`'nin dikdörtgenine göre kırpılır.
- **Fare alanı (hitbox):** Bir açılma/kapanmada yalnızca 1 kez boyut değiştirir. Önceden her karede değişiyordu ve shell her karede input bölgesini yeniden hesaplıyordu.
- **Köşeler:** Yarıçap her karede `min(26 px, yükseklik/2)` olarak hesaplanır, bu yüzden köşeler hiçbir karede bozulmaz.
- **Gölge yok:** Island'ların arkasında gölge yok (hem görünüm hem performans için).
- **Çubuklar:** Seviye çubukları genişlik yerine `scale_x` ile anime edilir.
- **Veri yenileme:** Kapalıyken yalnızca panelde görünen modüller yenilenir. Açılınca veri yenilemesi animasyon bitince yapılır.

### Ayar değişince

Eklenti GSettings'i dinler. Bir ayar değişince 150 ms bekler, island'ları sızıntısız biçimde yıkıp yeniden kurar.

## Klasör yapısı

```
install.sh                 # kurulum
tools/di-config            # terminal arayüzü + CLI (Python, curses; ek bağımlılık yok)
dynamic-island@local/
├── metadata.json
├── extension.js           # ayarları okur, island'ları kurar, değişince yeniden kurar
├── stylesheet.css
├── schemas/               # GSettings şeması (install.sh derler)
├── lib/
│   ├── island.js          # bir island: aktörler, konum, morph animasyonu, etkinlikler, hover/tık, polling
│   ├── osd.js             # ses/parlaklık OSD'sini island'a yönlendirir
│   ├── notifications.js   # bildirim önizleme (GNOME balonu ekran dışına alınır)
│   ├── events.js          # olay göstergeleri (şarj, pil, Wi-Fi, Bluetooth, mikrofon/kamera)
│   ├── history.js graph.js# canlı grafikler için örnek tamponu + Cairo çizimi
│   ├── clipboardStore.js  # pano geçmişi (bellekte), clipList.js: liste mantığı
│   ├── windows.js         # oynatıcının penceresini bulur (windowMatch.js: eşleştirme kuralları)
│   ├── glyphs.js          # sağ ikon satırının Cairo ile çizilmiş ikonları (glyphLogic.js: seviye/renk kararları)
│   ├── color.js           # albüm kapağından renk çıkarma (saf fonksiyonlar)
│   ├── panelSlot.js       # panel düğmesini gizler, yerini ayırır, menüsüne erişim
│   ├── settings.js        # GSettings → config
│   ├── disposer.js        # sinyal / timeout / cancellable temizliği
│   ├── proc.js            # async dosya okuma + parser'lar
│   ├── widgets.js         # Meter / LevelBar
│   └── constants.js
└── modules/
    ├── base.js            # IslandModule sözleşmesi
    ├── index.js           # kayıtlar: CENTER_MODULES, QS_MODULES
    ├── clock.js music.js calendar.js notificationList.js cpu.js ram.js temp.js net.js battery.js
    ├── stats/ graph.js gpu.js disk.js procs.js
    └── qs/ status.js sliders.js toggles.js system.js
tests/
├── proc.test.js           # parser + canlı /proc okuma (gjs)
├── color.test.js          # renk çıkarma + palet testleri (gjs)
├── history.test.js        # grafik örnek tamponu testleri (gjs)
├── diskio.test.js         # disk hızı ölçer testleri (gjs)
├── glyphs.test.js         # ikon seviye/renk kararları testleri (gjs)
├── cliplist.test.js       # pano geçmişi listesi testleri (gjs)
├── i18n.test.js           # dil katmanı testleri (gjs)
├── windowmatch.test.js    # oynatıcı penceresi eşleştirme testleri (gjs)
├── fake-player.py         # testlerde kullanılan sahte MPRIS oynatıcı
├── tui.test.py            # di-config'i sahte terminalde tuşlarla sürer
├── headless-smoke.sh      # izole headless shell başlatır
└── smoke-body.sh          # o shell içinde çalışan kontroller
```

## Yeni modül ekleme (örn. hava durumu, takvim etkinlikleri)

1. `modules/foo.js` dosyasını oluştur:

```js
import {IslandModule} from './base.js';
import {Meter} from '../lib/widgets.js';

export default class FooModule extends IslandModule {
    static id = 'foo';

    async init() {}           // isteğe bağlı: kaynak yoksa this.available = false

    buildCompact() {          // isteğe bağlı: panelde görünüm
        this._compact = new Meter({accent: this.accent, title: 'FOO', compact: true});
        return this._compact.actor;
    }

    buildExpanded() {         // açılınca karo
        this._tile = new Meter({accent: this.accent, title: 'FOO'});
        return this._tile.actor;
    }

    async tick() {            // 1-2 sn'de bir; I/O'yu async yap, this.cancellable'ı geçir
        this._compact?.update('42', 0.42);
        this._tile?.update('42', 0.42, 'ok', 'alt metin');
    }

    destroy() {               // kendi sinyallerini kopar; aktörler island ile yok olur
        this._compact = this._tile = null;
        super.destroy();
    }
}
```

2. `modules/index.js` içinde `CENTER_MODULES` ya da `QS_MODULES` haritasına `foo: FooModule` ekle.
3. Modülü listeye ekle: `di-config set center-modules cpu,ram,foo`. TUI'de görünmesi için
   `tools/di-config` içindeki `CENTER_ALL` / `QS_ALL` listelerine ve `MODULE_NAMES`'e ekle.

## Test

```bash
gjs -m tests/proc.test.js
gjs -m tests/color.test.js
gjs -m tests/history.test.js
gjs -m tests/diskio.test.js
gjs -m tests/glyphs.test.js
gjs -m tests/cliplist.test.js
gjs -m tests/i18n.test.js
gjs -m tests/windowmatch.test.js
XDG_CONFIG_HOME=$(mktemp -d) dbus-run-session -- python3 -I tests/tui.test.py
tests/headless-smoke.sh 10 /tmp/di-shots
```

`headless-smoke.sh`, ayrı bir D-Bus, geçici bir dconf ve yalnızca bu eklentiyle headless bir
`gnome-shell` başlatır. Gerçek oturumuna dokunmaz. Kontrol ettikleri:

- iki island'ın panel yuvalarına oturması
- anında açılma ve ~150 ms'de kapanma
- akıcılık: bir açılma/kapanmada fare alanının 1 kez boyut değiştirmesi, kompakt satırın hiç yeniden yerleşmemesi
- köşe yarıçapının hiçbir karede yüksekliğin yarısını aşmaması
- açıkken büyük saatin en üstte olması
- OSD'nin island'da olması, yerinde güncellenmesi, Caps Lock gibilerinin GNOME'da kalması
- bildirim önizlemesinin gösterilmesi ve süresinde kapanması
- üç island'ın yuvalara oturması (Activities dahil), eski ayarların taşınması, sol island grafikleri / süreç listesi / GPU / disk
- sağ ikon satırı (aynı boyutlu ikonlar), olay göstergeleri (şarj, pil, Wi-Fi, Bluetooth, mikrofon/kamera), aynı olayın birleştirilmesi
- OSD ve bildirimin arka arkaya iki kez doğru görünmesi
- kaynak uyarıları (eşik, yeniden kurulma, sessiz başlangıç), Super+A ile açma/kapama ve modal yakalamanın bırakılması, ekran görüntüsü önizlemesi
- müzik: oynatıcının bulunması, kapaktan renk, Next / PlayPause / konum atlama, şarkı değişince önizleme, oynatıcı kapanınca pill'in eski haline dönmesi (sahte MPRIS oynatıcıyla)
- tıklamanın kalkması; orta panelde takvim + bildirim listesi; sağ panelde kaydırıcılar, düğmeler, Wi-Fi/Bluetooth alt sayfaları, güç satırı
- kaydırıcı sürüklenirken island'ın açık kalması
- özellikler kapatılınca ve `disable` sonrasında GNOME'un kendi OSD'sine ve bildirim balonuna dönülmesi

Test, Wi-Fi, Bluetooth, güç modu ve ses gibi **gerçek sistem servislerini yalnızca okur**, değiştirmez.
- canlı ayar değişikliği
- 10 kez kapatıp açmadan sonra aktör sayısının sabit kalması
- `disable` sonrasında panelin eski haline dönmesi
- log'da `JS ERROR` / `CRITICAL` olmaması

## Loglar

```bash
journalctl -b -o cat /usr/bin/gnome-shell | grep -E "dynamic-island|JS ERROR"
gnome-extensions info dynamic-island@local
```

Satırlar `[dynamic-island] [center]` ya da `[dynamic-island] [qs]` önekiyle gelir.
`module brightness not available` gibi satırlar hata değildir; bu sistemde o kaynak olmadığı anlamına gelir.

## Diğer eklentilerle uyum

- **dash-to-dock** altta, **custom-hot-corners** köşelerde, **ddterm** solda: çakışmazlar.
- **blur-my-shell** paneli bulanıklaştırır. Island'lar kendi siyah haplarıdır, panel stiline dokunmazlar.
- **Vitals** (sol) ve **netspeedsimplified** panel göstergeleridir. Yuvalar island genişliğinde ayrıldığı için
  island'ların altına girmezler.
- **appindicator** ikonları Quick Settings'in solunda durur. Sağ island'ın içine alınmazlar, yanında kalırlar.
- **dynamic-music-pill** dock'ta durur. Island'da müzik modülü bu yüzden yok.

## GNOME 50 notları

- `addTopChrome()` yalnızca `trackFullscreen` ve `affectsStruts` alır. `affectsInputRegion` verilirse
  eklenti `Unrecognized parameter` hatasıyla ERROR durumuna düşer.
- `St.BoxLayout` için `vertical` yerine `orientation: Clutter.Orientation.VERTICAL` kullanılır.
- `--nested` yerine `--devkit` var (Fedora: `sudo dnf install mutter-devkit`).

## Lisans

GPL-3.0 — ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
