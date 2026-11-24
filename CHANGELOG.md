# Değişiklik günlüğü

Biçim [Keep a Changelog](https://keepachangelog.com/) tarzındadır. Henüz sürüm numarası verilmedi; aşağıdakiler
`main`'e göre bu daldaki değişikliklerdir.

## [Yayımlanmamış]

### Eklenenler

- **Liquid glass görünümü** (`liquid-glass`, varsayılan kapalı) ve **açıkken arka plan bulanıklığı** (`liquid-glass-blur`,
  varsayılan kapalı). Ayarlar → Görünüm ve `di-config`. Ayrıntı README'de. Mevcut temalara ve animasyonlara dokunmaz.
- `tests/glass-body.sh` (`BODY=... tests/headless-smoke.sh`): glass kontrolleri ve `MEASURE=1` ile CPU ölçümü;
  `tests/smoke-body.sh` disable/enable döngüsüne bulanıklık efekti sızıntı kontrolü eklendi.

### Davranış değişiklikleri (güncellerken fark edeceksin)

- **Pano geçmişi varsayılan olarak KAPALI.** Eskiden açıktı. Kullanmak istiyorsan Ayarlar → Özellikler → *Pano geçmişi*
  ya da `di-config set clipboard-history true`. Ayarı daha önce elle `true` yapmış olanlar etkilenmez.
  Açıkken `org.freedesktop.Secret` ailesi, `x-secret` ve `*passwordmanager*` biçimleri de (`x-kde-passwordManagerHint` zaten vardı) atlanır.
- **Claude gerçek kotası (`claude-real-usage`)** kapalı kalır ama artık:
  - Ayarlar penceresinde açarken ne okunduğunu (`~/.claude/.credentials.json`) ve nereye gittiğini (`api.anthropic.com`)
    söyleyen bir **onay penceresi** çıkar;
  - kodu tek bir yerde yalıtılmıştır (`lib/claudeRealQuota.js`); kart ile kota uyarıları eskiden ayrı ayrı istek atıyordu,
    şimdi tek bir istek paylaşılır (en az dakikada bir);
  - **kapanma kuralları:** dosya yoksa/okunamıyorsa ya da HTTP 401/403 gelirse özellik hemen ve sessizce kapanır
    (ayar `false` olur); ağ/5xx hatalarında art arda 3 başarısızlıktan sonra kapanır, başarılı istek sayacı sıfırlar;
    **süresi dolmuş anahtar** hata sayılmaz (istek yok, son değerler kalır, dosya sonraki yoklamada yeniden okunur);
  - anahtar, `Authorization` başlığı ve istek ayrıntıları hiçbir log ya da hata mesajına girmez.
- **`di-claude-hook` sırları maskeler** (en iyi çaba): `Bearer`/`Authorization` değerleri, `--password`/`--token`/`--secret`/`--api-key`,
  `password=`/`token=`/`api_key:` atamaları, URL içi parola, `curl -u`, `sk-ant-…`, `ghp_…`/`github_pat_…`, AWS anahtar kimlikleri,
  Slack/GitLab belirteçleri ve JWT'ler D-Bus'a ve island'a gitmeden önce `*****` olur. Yalnızca değer maskelenir.
- **Claude köprüsü** (`ClaudeEvent`) hız sınırlıdır (20 patlama, saniyede 5) ve en fazla 32 "çalışıyor" oturumu izler.
- **Müzik kapakları:** https adresi çözülüp yerel/özel ağa giden adresler reddedilir; Soup'un gerçekten bağlandığı adres de kontrol edilir.
- **Zamanlayıcılar:** kullanıcının gördüğü süreler (otomatik kapanma, bildirim süreleri) artık tam saniye hizasına
  yuvarlanmaz (1 sn'ye kadar sapma vardı). Yalnızca arka plan yoklaması birleştirilmiş zamanlayıcı kullanmaya devam eder.
- **`install.sh`** hata durumunda "Bitti" demeden çıkış kodu 1 ile durur; `glib-compile-schemas` yoksa söyler; `di-claude-hook` da bağlanır.

- **Hover (akıcılık turu):** imleç adanın üstünde en az 60 ms durmadan ada açılmaz (eskiden anında; `hover-expand-delay` bundan büyükse o geçerli). Açık ada kenarının **8 px dışına kadar hover sayılır** (görünmez bir pay: bu bantta altındaki pencereler tıklama almaz). Yeni açılan ada 250 ms'den önce kapanmaz; kenarda titreme (900 ms içinde tekrar çıkış) kapanma bekleyişini en çok 3 katına uzatır.
- **Animasyon süreleri** tek tabloda (`lib/constants.js`); aynı türdeki animasyonlar aynı süre/easing'i kullanır (ör. tüm kayarak giriş 260 ms, tüm pop 400 ms, tüm süzülmeler 500 ms). Küçük sapmalar: ajan paneli girişi 160→220, Claude pill çıkışı 200→120, çubuklar 380→500 ms.

### Düzeltmeler

- Eklenti kapanırken/yeniden kurulurken **sızan zamanlayıcılar**: kaynak izleme (10 sn'lik `/proc` yoklaması), izin sırası (450 ms),
  Wi-Fi bağlanıyor göstergesi (20 sn), arama odak `idle`'ı.
- "Uyanık tut" çift dokunuşta bir inhibit kaydı sızdırıyordu (isteklere sıra eklendi).
- Açık island içeriği yeniden ölçülünce (arama sonuçları, ajan paneli, mixer…) her seferinde tüm modüllerin yoklanması:
  100 ms'de bir yeniden ölçümde 6 sn'de 59 yoklama → 6.
- Süreç listesi: aynı anda iki `/proc` anlık görüntüsü gürültülü CPU % üretiyordu.
- Müzik: hızlı A→B→A şarkı değişiminde yanlış başlık; her oynatıcı özelliği değişiminde sonsuz animasyonların başa sarması;
  proxy hatasından sonra oynatıcının bir daha bulunmaması.
- Bir modülün yapıcısı hata verirse tüm island "• • •" kalıyordu.
- Hover çıkış-giriş arasında içerik 90 ms takılıyordu; Claude halkası aynı değer için animasyonu yeniden başlatıyordu.

### Performans

- Renk geçişlerinde (700 ms) aynı `set_style` metni her karede tekrar yazılmıyor.
- Claude "çalışıyor" dalgası ve dış çizgi yenilemesi ~30 fps ile sınırlı (başsız ölçüm: boşta 17, dalga 72 → 54 CPU tiki / 10 sn).
- Gizliyken (genişlemiş adada pill, kapalı adada karo) çizim ve güncelleme yok: Claude dalgası zaman çizgisi duraklatılır (gizliyken faz ilerliyordu), `Meter` gizliyken yazmaz ve görününce en yeni değeri uygular.
- Saat etiketleri yalnızca değişince atanıyor (aynı metin de yeniden yerleşim kuyruğuna giriyordu).

### Testler

- Yeni: `claudeRealQuota.test.js`, `claudebridge.test.js`, `tests/headless-quota-failure.sh`; `artfetch`, `cliplist`, `claudehook` testleri genişletildi.
