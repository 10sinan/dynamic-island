// Quick toggles for the Quick Settings island, plus two sub-pages:
//   Wi-Fi  ›  network list (connect)
//   Bluetooth ›  paired devices (connect / disconnect)
// Every toggle talks to the same service GNOME's own toggle uses.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {getRfkillManager} from 'resource:///org/gnome/shell/ui/status/rfkill.js';

import {IslandModule} from '../base.js';

const PP_BUS = 'org.freedesktop.UPower.PowerProfiles';
const PP_PATH = '/org/freedesktop/UPower/PowerProfiles';
const PP_NAMES = {'power-saver': 'Tasarruf', 'balanced': 'Dengeli', 'performance': 'Performans'};
const PP_ICONS = {
    'power-saver': 'power-profile-power-saver-symbolic',
    'balanced': 'power-profile-balanced-symbolic',
    'performance': 'power-profile-performance-symbolic',
};
const MAX_NETWORKS = 8;

Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');

function label(text, style) {
    const l = new St.Label({style_class: style, text, y_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

function signalIcon(strength) {
    if (strength >= 80)
        return 'network-wireless-signal-excellent-symbolic';
    if (strength >= 55)
        return 'network-wireless-signal-good-symbolic';
    if (strength >= 30)
        return 'network-wireless-signal-ok-symbolic';
    return 'network-wireless-signal-weak-symbolic';
}

export default class TogglesModule extends IslandModule {
    static id = 'toggles';
    static slot = 'main';

    async init() {
        this._ids = [];   // [object, id] pairs, disconnected in destroy()
        this._page = 'grid';

        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        for (const s of [this._iface, this._color, this._notif])
            this._on(s, 'changed', () => this._sync());

        this._rfkill = getRfkillManager();
        this._on(this._rfkill, 'notify::airplane-mode', () => this._sync());

        // NetworkManager
        try {
            this._NM = (await import('gi://NM')).default;
            Gio._promisify(this._NM.Client, 'new_async', 'new_finish');
            Gio._promisify(this._NM.Client.prototype, 'dbus_set_property', 'dbus_set_property_finish');
            Gio._promisify(this._NM.DeviceWifi.prototype, 'request_scan_async', 'request_scan_finish');
            this._nm = await this._NM.Client.new_async(this.cancellable);
            for (const sig of ['notify::wireless-enabled', 'notify::primary-connection', 'notify::active-connections'])
                this._on(this._nm, sig, () => this._sync());
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            this._nm = null;
        }

        // Bluetooth
        try {
            const GnomeBluetooth = (await import('gi://GnomeBluetooth?version=3.0')).default;
            Gio._promisify(GnomeBluetooth.Client.prototype, 'connect_service', 'connect_service_finish');
            this._bt = new GnomeBluetooth.Client();
            for (const sig of ['notify::default-adapter', 'notify::default-adapter-powered'])
                this._on(this._bt, sig, () => this._sync());
        } catch {
            this._bt = null;
        }

        // Power profiles
        try {
            this._pp = await Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE,
                null, PP_BUS, PP_PATH, PP_BUS, this.cancellable);
            if (this._pp.g_name_owner)
                this._on(this._pp, 'g-properties-changed', () => this._sync());
            else
                this._pp = null;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            this._pp = null;
        }
    }

    _on(obj, sig, cb) {
        this._ids.push([obj, obj.connect(sig, cb)]);
    }

    // ------------------------------------------------------------ UI

    buildExpanded() {
        this._root = new St.BoxLayout({style_class: 'di-toggles', orientation: Clutter.Orientation.VERTICAL});
        this._grid = new St.BoxLayout({style_class: 'di-toggle-grid', orientation: Clutter.Orientation.VERTICAL});
        this._pageBox = new St.BoxLayout({style_class: 'di-subpage', orientation: Clutter.Orientation.VERTICAL,
            visible: false});
        this._root.add_child(this._grid);
        this._root.add_child(this._pageBox);

        this._toggles = {
            wifi: this._toggle('network-wireless-symbolic', 'Wi-Fi', () => this._toggleWifi(), () => this._openPage('wifi')),
            bt: this._toggle('bluetooth-active-symbolic', 'Bluetooth', () => this._toggleBt(), () => this._openPage('bt')),
            dark: this._toggle('dark-mode-symbolic', 'Karanlık', () => this._iface.set_string('color-scheme',
                this._iface.get_string('color-scheme') === 'prefer-dark' ? 'default' : 'prefer-dark')),
            night: this._toggle('night-light-symbolic', 'Gece ışığı', () => this._color.set_boolean('night-light-enabled',
                !this._color.get_boolean('night-light-enabled'))),
            dnd: this._toggle('notifications-disabled-symbolic', 'Rahatsız etme', () => this._notif.set_boolean('show-banners',
                !this._notif.get_boolean('show-banners'))),
            airplane: this._toggle('airplane-mode-symbolic', 'Uçak modu', () => {
                this._rfkill.airplaneMode = !this._rfkill.airplaneMode;
            }),
            power: this._toggle('power-profile-balanced-symbolic', 'Güç modu', () => this._cyclePower()),
        };
        const order = ['wifi', 'bt', 'dark', 'night', 'dnd', 'airplane', 'power'];
        let row = null;
        for (const [i, key] of order.entries()) {
            if (i % 2 === 0) {
                row = new St.BoxLayout({style_class: 'di-toggle-row'});
                this._grid.add_child(row);
            }
            row.add_child(this._toggles[key].actor);
        }

        this._root.connect('destroy', () => {
            this._root = this._grid = this._pageBox = this._toggles = null;
        });
        this._sync();
        return this._root;
    }

    /** [icon  Title / subtitle] (+ optional › arrow opening a sub-page) */
    _toggle(iconName, title, onToggle, onArrow = null) {
        const outer = new St.BoxLayout({style_class: 'di-toggle', x_expand: true});
        const icon = new St.Icon({icon_name: iconName, icon_size: 16, y_align: Clutter.ActorAlign.CENTER});
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        const t = label(title, 'di-toggle-title');
        const sub = label('', 'di-toggle-sub');
        text.add_child(t);
        text.add_child(sub);
        const inner = new St.BoxLayout({style_class: 'di-toggle-inner', x_expand: true});
        inner.add_child(icon);
        inner.add_child(text);
        const main = new St.Button({style_class: 'di-toggle-main', child: inner, x_expand: true, can_focus: false});
        main.connect('clicked', () => onToggle());
        outer.add_child(main);
        if (onArrow) {
            const arrow = new St.Button({style_class: 'di-toggle-arrow', can_focus: false,
                child: new St.Icon({icon_name: 'go-next-symbolic', icon_size: 14})});
            arrow.connect('clicked', () => onArrow());
            outer.add_child(arrow);
        }
        return {
            actor: outer,
            icon,
            set: ({on, subtitle, visible = true, iconName: name}) => {
                outer.visible = visible;
                if (on) {
                    outer.add_style_pseudo_class('checked');
                    outer.set_style(`background-color: ${this.accent};`);
                } else {
                    outer.remove_style_pseudo_class('checked');
                    outer.set_style(null);
                }
                if (sub.text !== (subtitle ?? ''))
                    sub.text = subtitle ?? '';
                if (name)
                    icon.icon_name = name;
            },
        };
    }

    // ------------------------------------------------------------ state

    _wifiDevice() {
        return this._nm?.get_devices().find(d => d instanceof this._NM.DeviceWifi) ?? null;
    }

    _sync() {
        if (!this._toggles)
            return;
        const T = this._toggles;

        // Wi-Fi
        const dev = this._wifiDevice();
        const wifiOn = !!this._nm?.wireless_enabled;
        const ap = dev?.active_access_point;
        T.wifi.set({
            visible: !!dev,
            on: wifiOn,
            subtitle: !wifiOn ? 'Kapalı' : ap ? this._ssid(ap) : 'Bağlı değil',
            iconName: wifiOn && ap ? signalIcon(ap.strength) : 'network-wireless-offline-symbolic',
        });

        // Bluetooth
        const btHas = !!this._bt?.default_adapter;
        const btOn = btHas && this._bt.default_adapter_powered;
        const connected = btOn ? this._btDevices().filter(d => d.connected) : [];
        T.bt.set({
            visible: btHas,
            on: btOn,
            subtitle: !btOn ? 'Kapalı' : connected.length === 1 ? connected[0].alias
                : connected.length ? `${connected.length} cihaz` : 'Açık',
            iconName: btOn ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic',
        });

        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        T.dark.set({on: dark, subtitle: dark ? 'Açık' : 'Kapalı'});
        const night = this._color.get_boolean('night-light-enabled');
        T.night.set({on: night, subtitle: night ? 'Açık' : 'Kapalı'});
        const dnd = !this._notif.get_boolean('show-banners');
        T.dnd.set({on: dnd, subtitle: dnd ? 'Açık' : 'Kapalı'});
        const air = !!this._rfkill?.airplaneMode;
        T.airplane.set({visible: !!this._rfkill?.showAirplaneMode || air, on: air,
            subtitle: air ? 'Açık' : 'Kapalı'});

        const profile = this._pp?.get_cached_property('ActiveProfile')?.unpack() ?? '';
        T.power.set({
            visible: !!this._pp,
            on: profile !== '' && profile !== 'balanced',
            subtitle: PP_NAMES[profile] ?? profile,
            iconName: PP_ICONS[profile],
        });

        if (this._page === 'wifi')
            this._renderWifi();
        else if (this._page === 'bt')
            this._renderBt();
    }

    async tick() {
        this._sync();   // signal strength, device connections
    }

    onShown() {
        this._closePage();
        this._sync();
    }

    // ------------------------------------------------------------ actions

    _toggleWifi() {
        if (!this._nm)
            return;
        this._nm.dbus_set_property(this._NM.DBUS_PATH, this._NM.DBUS_INTERFACE, 'WirelessEnabled',
            new GLib.Variant('b', !this._nm.wireless_enabled), 2000, null)
            .catch(e => console.warn(`[dynamic-island] Wi-Fi toggle failed: ${e.message}`));
    }

    _toggleBt() {
        if (this._bt?.default_adapter)
            this._bt.default_adapter_powered = !this._bt.default_adapter_powered;
    }

    _cyclePower() {
        if (!this._pp)
            return;
        const available = (this._pp.get_cached_property('Profiles')?.deepUnpack() ?? [])
            .map(p => p.Profile?.unpack?.() ?? p.Profile).filter(Boolean);
        const order = ['power-saver', 'balanced', 'performance'].filter(p => available.includes(p));
        if (!order.length)
            return;
        const cur = this._pp.get_cached_property('ActiveProfile')?.unpack();
        const next = order[(order.indexOf(cur) + 1) % order.length];
        this._pp.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [PP_BUS, 'ActiveProfile', new GLib.Variant('s', next)]),
            Gio.DBusCallFlags.NONE, -1, null, null);
    }

    // ------------------------------------------------------------ sub-pages

    _openPage(page) {
        this._page = page;
        this._grid.hide();
        this._pageBox.show();
        if (page === 'wifi') {
            this._wifiDevice()?.request_scan_async(null).catch(() => {});
            this._renderWifi();
        } else {
            this._renderBt();
        }
        this.ctx?.requestExpandedRelayout?.();
    }

    _closePage() {
        if (this._page === 'grid' || !this._pageBox)
            return;
        this._page = 'grid';
        this._pageSig = null;
        this._pageBox.hide();
        this._pageBox.destroy_all_children();
        this._grid.show();
        this.ctx?.requestExpandedRelayout?.();
    }

    _pageHeader(title) {
        const header = new St.BoxLayout({style_class: 'di-subpage-header'});
        const back = new St.Button({style_class: 'di-icon-button', can_focus: false,
            child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 14})});
        back.connect('clicked', () => this._closePage());
        header.add_child(back);
        const t = label(title, 'di-section-title');
        t.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        t.x_expand = true;
        header.add_child(t);
        return header;
    }

    /** Rebuild a page only if its visible content changed (no flicker on ticks). */
    _renderPage(signature, title, rows, empty) {
        if (signature === this._pageSig)
            return;
        this._pageSig = signature;
        this._pageBox.destroy_all_children();
        this._pageBox.add_child(this._pageHeader(title));
        const list = new St.BoxLayout({style_class: 'di-list', orientation: Clutter.Orientation.VERTICAL});
        if (!rows.length)
            list.add_child(new St.Label({style_class: 'di-notifs-empty', text: empty}));
        for (const r of rows)
            list.add_child(r);
        this._pageBox.add_child(list);
        this.ctx?.requestExpandedRelayout?.();
    }

    _listRow(iconName, text, status, onClick, active = false) {
        const box = new St.BoxLayout({style_class: 'di-list-row-box', x_expand: true});
        box.add_child(new St.Icon({icon_name: iconName, icon_size: 16, y_align: Clutter.ActorAlign.CENTER}));
        box.add_child(Object.assign(label(text, 'di-list-name'), {x_expand: true}));
        if (status)
            box.add_child(label(status, active ? 'di-list-status di-list-active' : 'di-list-status'));
        const row = new St.Button({style_class: 'di-list-row', child: box, x_expand: true, can_focus: false});
        if (active)
            row.set_style(`color: ${this.accent};`);
        row.connect('clicked', onClick);
        return row;
    }

    _ssid(ap) {
        const bytes = ap.get_ssid()?.get_data();
        return bytes ? this._NM.utils_ssid_to_utf8(bytes) : '';
    }

    _renderWifi() {
        const dev = this._wifiDevice();
        if (!dev || !this._nm.wireless_enabled) {
            this._renderPage('off', 'Wi-Fi', [], 'Wi-Fi kapalı');
            return;
        }
        const active = dev.active_access_point;
        const best = new Map();
        for (const ap of dev.get_access_points()) {
            const ssid = this._ssid(ap);
            if (!ssid)
                continue;
            const cur = best.get(ssid);
            if (!cur || ap.strength > cur.strength || ap === active)
                best.set(ssid, ap);
        }
        const activeSsid = active ? this._ssid(active) : null;
        const aps = [...best.entries()]
            .sort(([a, x], [b, y]) => (b === activeSsid) - (a === activeSsid) || y.strength - x.strength)
            .slice(0, MAX_NETWORKS);
        const sig = aps.map(([s, ap]) => `${s}:${Math.round(ap.strength / 25)}:${s === activeSsid}`).join('|');
        const rows = aps.map(([ssid, ap]) => {
            const secured = (ap.flags | ap.wpa_flags | ap.rsn_flags) !== 0;
            const isActive = ssid === activeSsid;
            return this._listRow(signalIcon(ap.strength), ssid,
                isActive ? 'Bağlı' : secured ? '🔒' : '', () => this._connectAp(dev, ap), isActive);
        });
        this._renderPage(sig, 'Wi-Fi ağları', rows, 'Ağ aranıyor…');
    }

    _connectAp(dev, ap) {
        if (ap === dev.active_access_point)
            return;
        const conn = dev.get_available_connections().find(c => ap.connection_valid(c));
        // Secured networks without a saved connection: GNOME's own network
        // agent asks for the password.
        if (conn)
            this._nm.activate_connection_async(conn, dev, null, null, null);
        else
            this._nm.add_and_activate_connection_async(null, dev, ap.get_path(), null, null);
    }

    _btDevices() {
        const store = this._bt?.get_devices();
        const out = [];
        for (let i = 0; i < (store?.get_n_items() ?? 0); i++) {
            const d = store.get_item(i);
            if (d.paired || d.connected)
                out.push(d);
        }
        return out;
    }

    _renderBt() {
        if (!this._bt?.default_adapter_powered) {
            this._renderPage('off', 'Bluetooth', [], 'Bluetooth kapalı');
            return;
        }
        const devices = this._btDevices().sort((a, b) => b.connected - a.connected);
        const sig = devices.map(d => `${d.alias}:${d.connected}`).join('|');
        const rows = devices.map(d => this._listRow(d.icon || 'bluetooth-active-symbolic', d.alias || d.name,
            d.connected ? 'Bağlı' : 'Bağlan', () => this._toggleDevice(d), d.connected));
        this._renderPage(sig, 'Bluetooth cihazları', rows, 'Eşleşmiş cihaz yok');
    }

    _toggleDevice(device) {
        this._bt.connect_service(device.get_object_path(), !device.connected, null)
            .catch(e => console.warn(`[dynamic-island] Bluetooth ${device.alias}: ${e.message}`))
            .finally(() => {
                this._pageSig = null;
                this._sync();
            });
    }

    destroy() {
        for (const [obj, id] of this._ids ?? []) {
            try {
                obj.disconnect(id);
            } catch {}
        }
        this._ids = [];
        this._nm = this._bt = this._pp = this._rfkill = null;
        this._iface = this._color = this._notif = null;
        this._toggles = null;
        super.destroy();
    }
}
