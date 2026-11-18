// Tiny translation layer. The UI language is a user setting (`language`:
// 'tr' | 'en'); it does NOT follow the device locale. English text is the key,
// so a missing translation falls back to English.
//
//   _('Clear')              -> 'Temizle' (tr) / 'Clear' (en)
//   _f('%s left', 12)       -> '12 left'
//   pct(62)                 -> '%62' (tr) / '62%' (en)

export const LANGUAGES = ['tr', 'en'];
export const DEFAULT_LANGUAGE = 'tr';

const WEEKDAYS = {
    tr: ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const MONTHS = {
    tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

const TR = {
    // events
    'Charging': 'Şarj oluyor',
    'Charger unplugged': 'Şarj kablosu çıkarıldı',
    'Battery low': 'Pil düşük',
    '%s left': '%s kaldı',
    'Connected': 'Bağlandı',
    'Connection lost': 'Bağlantı koptu',
    'No internet': 'İnternet yok',
    'Disconnected': 'Bağlantı kesildi',
    'On': 'Açık',
    'Off': 'Kapalı',
    'Keyboard layout': 'Klavye düzeni',
    'Meeting mode': 'Toplantı modu',
    'Notifications muted': 'Bildirimler susturuldu',
    'Meeting ended': 'Toplantı bitti',
    'Notifications back on': 'Bildirimler yeniden açık',
    'Power saver on': 'Güç tasarrufu açıldı',
    'Power saver off': 'Güç tasarrufu kapandı',
    'Battery %s · screen and CPU throttled': 'Pil %s · ekran ve işlemci kısıldı',
    'Previous profile restored': 'Önceki profile dönüldü',
    'System running hot': 'Sistem ısındı',
    'Low memory': 'Bellek az',
    '%s used': '%s dolu',
    'Disk almost full': 'Disk dolmak üzere',
    '%s used · %s GB free': '%s dolu · %s GB boş',
    'Microphone in use': 'Mikrofon kullanılıyor',
    'An app is listening': 'Bir uygulama dinliyor',
    'Camera in use': 'Kamera kullanılıyor',
    'An app is using the camera': 'Bir uygulama görüntü alıyor',
    // notifications / screenshot
    'Screenshot taken': 'Ekran görüntüsü alındı',
    'Click: open  ·  right click: dismiss': 'Tıkla: aç  ·  sağ tık: kapat',
    'Copied to clipboard · saved to file': 'Panoya kopyalandı · dosyaya kaydedildi',
    'Copied to clipboard': 'Panoya kopyalandı',
    'Notification': 'Bildirim',
    'now': 'şimdi',
    'min': 'dk',
    'h': 'sa',
    'NOTIFICATIONS': 'BİLDİRİMLER',
    'Clear': 'Temizle',
    'No notifications': 'Bildirim yok',
    '+%s more notifications': '+%s bildirim daha',
    // clipboard
    'CLIPBOARD HISTORY': 'PANO GEÇMİŞİ',
    'Things you copy show up here': 'Kopyaladığın şeyler burada görünür',
    'Image': 'Resim',
    // stats
    'TOP CPU': 'EN ÇOK CPU',
    'TOP MEMORY': 'EN ÇOK BELLEK',
    'NET': 'AĞ',
    'Large file operation': 'Büyük dosya işlemi',
    'File operation done': 'Dosya işlemi bitti',
    '%s transferred': '%s aktarıldı',
    // quick settings
    'Screenshot': 'Ekran görüntüsü',
    'Power': 'Güç',
    'Sleep': 'Uyku',
    'Restart': 'Yeniden başlat',
    'Shut down': 'Kapat',
    'Log out': 'Oturumu kapat',
    'charging': 'şarj oluyor',
    'full': 'dolu',
    'Saver': 'Tasarruf',
    'Balanced': 'Dengeli',
    'Performance': 'Performans',
    'Dark': 'Karanlık',
    'Night light': 'Gece ışığı',
    'Do not disturb': 'Rahatsız etme',
    'Airplane mode': 'Uçak modu',
    'Power mode': 'Güç modu',
    'Not connected': 'Bağlı değil',
    '%s devices': '%s cihaz',
    'Wi-Fi off': 'Wi-Fi kapalı',
    'Bluetooth off': 'Bluetooth kapalı',
    'Wi-Fi networks': 'Wi-Fi ağları',
    'Scanning for networks…': 'Ağ aranıyor…',
    'Connect': 'Bağlan',
    'Bluetooth devices': 'Bluetooth cihazları',
    'No paired devices': 'Eşleşmiş cihaz yok',
    // settings window
    'General': 'Genel', 'Timing': 'Zamanlama', 'Modules': 'Modüller', 'Islands': 'Island\'lar',
    'Center island': 'Orta island', 'Replaces the panel clock': 'Paneldeki saatin yerine geçer',
    'Left island': 'Sol island', 'Statistics; replaces the Activities button': 'İstatistik; Activities düğmesinin yerine geçer',
    'Right island': 'Sağ island', 'Quick Settings': 'Hızlı Ayarlar', 'Open on hover': 'Üstüne gelince aç',
    'Super+A opens the right island': 'Super+A sağ island\'ı açsın', 'Look': 'Görünüm', 'Color theme': 'Renk teması',
    'Accent color (#rrggbb, empty = theme color)': 'Vurgu rengi (#rrggbb, boş = tema rengi)',
    'Show seconds on the clock': 'Saatte saniye göster', 'Features': 'Özellikler', 'Clipboard history': 'Pano geçmişi',
    'Last 10 copies, memory only, never written to disk': 'Son 10 kopya, yalnızca bellekte, diske yazılmaz',
    'Video preview button on the music card': 'Müzik kartında video önizleme düğmesi',
    'Preview on track change': 'Şarkı değişince önizleme',
    'Volume/brightness indicator in the island': 'Ses/parlaklık göstergesi island\'da',
    'Notification preview': 'Bildirim önizleme', 'Screenshot thumbnail': 'Ekran görüntüsü küçük resmi',
    'Meeting mode (mic/camera → Do Not Disturb)': 'Toplantı modu (mikrofon/kamera → Rahatsız Etme)',
    'Auto Power Saver on low battery': 'Pil azalınca otomatik Güç Tasarrufu',
    'Power saver battery level': 'Güç tasarrufu pil seviyesi', 'Values in milliseconds': 'Değerler milisaniye cinsinden',
    'Open delay': 'Açılma bekleme', 'instant': 'anında', 'Close delay': 'Kapanma bekleme', 'Auto close': 'Kendiliğinden kapanma',
    'never': 'asla', 'Open animation': 'Açılma animasyonu', 'Notification preview time': 'Bildirim önizleme süresi',
    'Refresh (collapsed)': 'Yenileme (kapalıyken)', 'Refresh (expanded)': 'Yenileme (açıkken)', 'Spring effect': 'Yaylanma efekti',
    'Shown under the clock': 'Saatin altında açılanlar', 'Statistics (top-left corner)': 'İstatistikler (üst sol köşe)',
    'Panel sections (top to bottom)': 'Panel bölümleri (yukarıdan aşağı)',
    'Events that open the island briefly': 'Island\'ı kısa süre açan olaylar', 'Also show in the panel': 'Panelde de göster',
    'Music player': 'Müzik oynatıcı', 'Calendar': 'Takvim', 'Notification list': 'Bildirim listesi',
    'CPU usage': 'CPU kullanımı', 'RAM usage': 'RAM kullanımı', 'CPU temperature': 'CPU sıcaklığı', 'Network speed': 'Ağ hızı',
    'GPU usage': 'GPU kullanımı', 'Disk usage': 'Disk doluluğu', 'Live graphs (60 s)': 'Canlı grafikler (60 sn)',
    'Top resource-using apps': 'En çok kaynak kullanan uygulamalar', 'Volume + brightness sliders': 'Ses + parlaklık kaydırıcıları',
    'Toggles (Wi-Fi, Bluetooth, ...)': 'Düğmeler (Wi-Fi, Bluetooth, ...)', 'Clipboard history (last 10)': 'Pano geçmişi (son 10)',
    'Battery + system buttons': 'Pil + sistem düğmeleri', 'Charger plugged / unplugged': 'Şarj takıldı / çıkarıldı',
    'Battery low (20%, 10%)': 'Pil düşük (%20, %10)', 'Wi-Fi connected / lost': 'Wi-Fi bağlandı / koptu',
    'Bluetooth device connected / disconnected': 'Bluetooth cihazı bağlandı / ayrıldı',
    'Microphone / camera in use': 'Mikrofon / kamera kullanımda', 'System hot (CPU above 90°C)': 'Sistem ısındı (CPU 90°C üstü)',
    'Low memory (above 90%)': 'Bellek az (%90 üstü)', 'Caps Lock / Num Lock toggled': 'Caps Lock / Num Lock açıldı-kapandı',
    'Keyboard layout changed': 'Klavye dili değişti', 'Meeting mode on / off': 'Toplantı modu açıldı / kapandı',
    'Power saver on / off': 'Güç tasarrufu açıldı / kapandı',
    'A slight bounce when opening': 'Açılırken hafifçe esner',
    'Blur while opening/closing': 'Açılıp kapanırken bulanıklık',
    'Content blurs while the island changes shape': 'Island şekil değiştirirken içerik bulanıklaşır',
    'Battery': 'Pil', 'Settings': 'Ayarlar', 'Lock': 'Kilitle',
    // workspaces / audio / keep awake
    'Desktop %s': 'Masaüstü %s', 'No windows': 'Pencere yok', '+%s more windows': '+%s pencere daha',
    'SOUND OUTPUT': 'SES ÇIKIŞI', 'Keep awake': 'Uyanık tut', 'Until turned off': 'Kapatana kadar',
    '%s min left': '%s dk kaldı',
    'Workspaces and windows': 'Çalışma alanları ve pencereler', 'Sound output': 'Ses çıkışı',
    // claude usage
    'Claude Code usage': 'Claude Code kullanımı', 'Claude token limit (K per 5 h)': 'Claude token limiti (5 saatte, bin)',
    '0 = just show the tokens used; set your own limit to see how much is left': '0 = yalnızca kullanılan token; kendi limitini yazarsan kalanı görürsün',
    'Today %s': 'Bugün %s', 'tokens': 'token', 'tokens used': 'token kullanıldı',
    'A new session starts with your next message': 'Yeni oturum bir sonraki mesajınla başlar',
    'Resets %s · %s left': 'Sıfırlanma %s · %s kaldı', '%s h %s min': '%s sa %s dk', '%s min': '%s dk', 'No active session': 'Aktif oturum yok',
    'resets in %s h %s min': '%s sa %s dk sonra sıfırlanır', 'resets in %s min': '%s dk sonra sıfırlanır',
    // wifi / bluetooth pages
    'More settings…': 'Diğer ayarlar…', 'Saved': 'Kayıtlı', 'Secured': 'Güvenli', 'Open network': 'Açık ağ',
    'Connecting…': 'Bağlanıyor…', 'Disconnecting…': 'Bağlantı kesiliyor…', 'CURRENT NETWORK': 'BAĞLI AĞ',
    'OTHER NETWORKS': 'DİĞER AĞLAR', 'CONNECTED': 'BAĞLI', 'MY DEVICES': 'CİHAZLARIM', 'Battery %s': 'Pil %s',
    // search
    'Search apps, files, settings…': 'Uygulama, dosya, ayar ara…', 'Applications': 'Uygulamalar',
    'No results': 'Sonuç yok', 'Searching…': 'Aranıyor…', 'Type to search · Enter opens · Esc closes': 'Yazmaya başla · Enter açar · Esc kapatır',
    // themes
    'Ink': 'Mürekkep',
    'Midnight': 'Gece mavisi',
    'Sunset': 'Gün batımı',
    'Forest': 'Orman',
    'Rose': 'Gül',
};

let _lang = DEFAULT_LANGUAGE;

export function setLanguage(lang) {
    _lang = LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

export function getLanguage() {
    return _lang;
}

export function _(s) {
    return _lang === 'tr' ? (TR[s] ?? s) : s;
}

/** Translate then fill %s placeholders in order. */
export function _f(s, ...args) {
    let i = 0;
    return _(s).replace(/%s/g, () => String(args[i++] ?? ''));
}

export function pct(n) {
    return _lang === 'tr' ? `%${n}` : `${n}%`;
}

/** Day of week 0 = Sunday. */
export function weekdayName(dow, short = false) {
    const n = WEEKDAYS[_lang][((dow % 7) + 7) % 7];
    return short ? n.slice(0, 3) : n;
}

export function monthName(m0, short = false) {
    const n = MONTHS[_lang][m0];
    return short ? n.slice(0, 3) : n;
}

/** First day of the week for the language: tr Monday, en Sunday. */
export function weekStart() {
    return _lang === 'tr' ? 1 : 0;
}

/** Clock header: "Çar 18 Kas" / "Wed 18 Nov". */
export function shortDate(dt) {
    return `${weekdayName(dt.get_day_of_week() % 7, true)} ${dt.get_day_of_month()} ${monthName(dt.get_month() - 1, true)}`;
}

export function monthTitle(year, month1) {
    return `${monthName(month1 - 1)} ${year}`;
}
