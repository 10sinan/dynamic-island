// Quick toggles for the Quick Settings island, plus two sub-pages:
//   Wi-Fi  ›  network list (connect)
//   Bluetooth ›  paired devices (connect / disconnect)
// Every toggle talks to the same service GNOME's own toggle uses.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Graphene from 'gi://Graphene';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {getRfkillManager} from 'resource:///org/gnome/shell/ui/status/rfkill.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {IslandModule} from '../base.js';
import {_, _f, pct} from '../../lib/i18n.js';
import {Timer} from '../../lib/disposer.js';

const PP_BUS = 'org.freedesktop.UPower.PowerProfiles';
const PP_PATH = '/org/freedesktop/UPower/PowerProfiles';
const ppName = p => ({'power-saver': _('Saver'), 'balanced': _('Balanced'), 'performance': _('Performance')})[p];
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
        this._connectTimer = new Timer();   // gives up the "connecting" spinner
        this._page = 'grid';

        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._color = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        for (const s of [this._iface, this._color, this._notif])
            this._on(s, 'changed', () => this._sync());

        this._caffeine = this.ctx?.services?.caffeine ?? null;
        this._unsubCaffeine = this._caffeine?.subscribe(() => this._sync()) ?? null;

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
            dark: this._toggle('dark-mode-symbolic', _('Dark'), () => this._iface.set_string('color-scheme',
                this._iface.get_string('color-scheme') === 'prefer-dark' ? 'default' : 'prefer-dark')),
            night: this._toggle('night-light-symbolic', _('Night light'), () => this._color.set_boolean('night-light-enabled',
                !this._color.get_boolean('night-light-enabled'))),
            dnd: this._toggle('notifications-disabled-symbolic', _('Do not disturb'), () => this._notif.set_boolean('show-banners',
                !this._notif.get_boolean('show-banners'))),
            airplane: this._toggle('airplane-mode-symbolic', _('Airplane mode'), () => {
                this._rfkill.airplaneMode = !this._rfkill.airplaneMode;
            }),
            power: this._toggle('power-profile-balanced-symbolic', _('Power mode'), () => this._cyclePower()),
            awake: this._toggle('weather-clear-symbolic', _('Keep awake'), () => this._caffeine?.cycle()),
        };
        this._order = ['wifi', 'bt', 'dark', 'night', 'dnd', 'airplane', 'power', 'awake'];
        this._packed = null;

        this._root.connect('destroy', () => {
            this._root = this._grid = this._pageBox = this._toggles = null;
        });
        this._sync();
        return this._root;
    }

    /** Two per row, only the visible ones: no gaps when a toggle is hidden. */
    _pack() {
        if (!this._grid || !this._toggles)
            return;
        const keys = this._order.filter(k => this._toggles[k].actor.visible);
        const sig = keys.join(',');
        if (sig === this._packed)
            return;
        this._packed = sig;
        for (const k of this._order) {
            const a = this._toggles[k].actor;
            a.get_parent()?.remove_child(a);
        }
        this._grid.destroy_all_children();
        let row = null;
        keys.forEach((k, i) => {
            if (i % 2 === 0) {
                row = new St.BoxLayout({style_class: 'di-toggle-row'});
                this._grid.add_child(row);
            }
            row.add_child(this._toggles[k].actor);
        });
        // hidden ones stay parented (in a hidden holder) so they can be re-shown by _sync()
        this._hiddenHolder = new St.Widget({visible: false});
        this._grid.add_child(this._hiddenHolder);
        for (const k of this._order.filter(k => !keys.includes(k)))
            this._hiddenHolder.add_child(this._toggles[k].actor);
        this.ctx?.requestExpandedRelayout?.();
    }

    /** [(icon)  Title / subtitle] (+ optional › opening a sub-page) */
    _toggle(iconName, title, onToggle, onArrow = null) {
        const outer = new St.BoxLayout({style_class: 'di-toggle', x_expand: true});
        const bubble = new St.Bin({style_class: 'di-toggle-bubble', y_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        const icon = new St.Icon({icon_name: iconName, icon_size: 16});
        bubble.set_child(icon);
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        const t = label(title, 'di-toggle-title');
        const sub = label('', 'di-toggle-sub');
        text.add_child(t);
        text.add_child(sub);
        const inner = new St.BoxLayout({style_class: 'di-toggle-inner', x_expand: true});
        inner.add_child(bubble);
        inner.add_child(text);
        const main = new St.Button({style_class: 'di-toggle-main', child: inner, x_expand: true, can_focus: false});
        main.connect('clicked', () => {
            // small press bounce on the icon
            bubble.remove_all_transitions();
            bubble.set_scale(0.82, 0.82);
            bubble.ease({scale_x: 1, scale_y: 1, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_BACK});
            onToggle();
        });
        outer.add_child(main);
        if (onArrow) {
            const arrow = new St.Button({style_class: 'di-toggle-arrow', can_focus: false,
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: 'go-next-symbolic', icon_size: 12})});
            arrow.connect('clicked', () => onArrow());
            outer.add_child(arrow);
        }
        let wasOn = null;
        return {
            actor: outer,
            icon,
            set: ({on, subtitle, visible = true, iconName: name}) => {
                outer.visible = visible;
                if (on !== wasOn) {
                    wasOn = on;
                    if (on) {
                        outer.add_style_pseudo_class('checked');
                        bubble.set_style(`background-color: ${this.accent}; color: #0b0b0b;`);
                    } else {
                        outer.remove_style_pseudo_class('checked');
                        bubble.set_style(null);
                    }
                }
                if (sub.text !== (subtitle ?? ''))
                    sub.text = subtitle ?? '';
                if (name && icon.icon_name !== name)
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
            subtitle: !wifiOn ? _('Off') : ap ? this._ssid(ap) : _('Not connected'),
            iconName: wifiOn && ap ? signalIcon(ap.strength) : 'network-wireless-offline-symbolic',
        });

        // Bluetooth
        const btHas = !!this._bt?.default_adapter;
        const btOn = btHas && this._bt.default_adapter_powered;
        const connected = btOn ? this._btDevices().filter(d => d.connected) : [];
        T.bt.set({
            visible: btHas,
            on: btOn,
            subtitle: !btOn ? _('Off') : connected.length === 1 ? connected[0].alias
                : connected.length ? _f('%s devices', connected.length) : _('On'),
            iconName: btOn ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic',
        });

        const dark = this._iface.get_string('color-scheme') === 'prefer-dark';
        T.dark.set({on: dark, subtitle: dark ? _('On') : _('Off')});
        const night = this._color.get_boolean('night-light-enabled');
        T.night.set({on: night, subtitle: night ? _('On') : _('Off')});
        const dnd = !this._notif.get_boolean('show-banners');
        T.dnd.set({on: dnd, subtitle: dnd ? _('On') : _('Off')});
        const air = !!this._rfkill?.airplaneMode;
        T.airplane.set({visible: !!this._rfkill?.showAirplaneMode || air, on: air,
            subtitle: air ? _('On') : _('Off')});

        if (T.awake) {
            const left = this._caffeine?.remaining ?? 0;
            T.awake.set({
                visible: !!this._caffeine,
                on: left > 0,
                subtitle: left === Infinity ? _('Until turned off')
                    : left > 0 ? _f('%s min left', Math.max(1, Math.ceil(left / 60))) : _('Off'),
            });
        }

        const profile = this._pp?.get_cached_property('ActiveProfile')?.unpack() ?? '';
        T.power.set({
            visible: !!this._pp,
            on: profile !== '' && profile !== 'balanced',
            subtitle: ppName(profile) ?? profile,
            iconName: PP_ICONS[profile],
        });

        this._pack();
        if (this._page === 'wifi')
            this._renderWifi();
        else if (this._page === 'bt')
            this._renderBt();
    }

    async tick() {
        this._sync();   // signal strength, device connections
    }

    onShown() {
        this._closePage(false);
        this._sync();
    }

    onHidden() {
        this._closePage(false);   // reopen on the toggles, with every section back
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
    // A page takes the whole island (other sections hide, see ctx.focus) and
    // slides in from the right; "back" slides the toggles in from the left.

    _openPage(page) {
        this._page = page;
        this._pageSig = null;
        this._pageFresh = true;   // stagger the rows of the first render
        this.ctx?.focus?.(this);
        this._grid.hide();
        this._pageBox.show();
        if (page === 'wifi') {
            this._wifiDevice()?.request_scan_async(null).catch(() => {});
            this._renderWifi();
        } else {
            this._renderBt();
        }
        this._slideIn(this._pageBox, 1);
    }

    _closePage(animate = true) {
        if (this._page === 'grid' || !this._pageBox)
            return;
        this._page = 'grid';
        this._pageSig = null;
        this._connecting = null;
        this._pageBox.hide();
        this._pageBox.destroy_all_children();
        this._grid.show();
        this.ctx?.focus?.(null);
        if (animate)
            this._slideIn(this._grid, -1);
    }

    _slideIn(actor, dir) {
        actor.remove_all_transitions();
        actor.set({opacity: 0, translation_x: 26 * dir});
        actor.ease({opacity: 255, translation_x: 0, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _switch(on, onToggle) {
        const knob = new St.Widget({style_class: 'di-switch-knob'});
        const sw = new St.Button({style_class: 'di-switch', can_focus: false, y_align: Clutter.ActorAlign.CENTER,
            child: knob, x_align: Clutter.ActorAlign.END});
        const paint = state => {
            knob.translation_x = state ? 16 : 0;
            sw.set_style(state ? `background-color: ${this.accent};` : null);
        };
        paint(on);
        sw.connect('clicked', () => {
            on = !on;
            knob.ease({translation_x: on ? 16 : 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            sw.set_style(on ? `background-color: ${this.accent};` : null);
            onToggle();
        });
        return sw;
    }

    _pageHeader(title, on, onToggle) {
        const header = new St.BoxLayout({style_class: 'di-page-header'});
        const back = new St.Button({style_class: 'di-page-back', can_focus: false, y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 14})});
        back.connect('clicked', () => this._closePage());
        header.add_child(back);
        const t = label(title, 'di-page-title');
        t.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        t.x_expand = true;
        header.add_child(t);
        header.add_child(this._switch(on, onToggle));
        return header;
    }

    _section(text) {
        return label(text, 'di-page-section');
    }

    /**
     * Rebuild a page only if its visible content changed (no flicker on ticks).
     * @param {() => Clutter.Actor} header  built only when the page is rebuilt
     * @param {Array<Clutter.Actor>} body  section labels and rows, top to bottom
     */
    _renderPage(signature, header, body, empty, settingsPanel) {
        if (signature === this._pageSig)
            return;
        this._pageSig = signature;
        this._pageBox.destroy_all_children();
        this._pageBox.add_child(header());
        const list = new St.BoxLayout({style_class: 'di-page-list', orientation: Clutter.Orientation.VERTICAL});
        if (!body.length) {
            const e = new St.BoxLayout({style_class: 'di-page-empty', orientation: Clutter.Orientation.VERTICAL,
                x_expand: true});
            e.add_child(new St.Label({style_class: 'di-page-empty-text', text: empty, x_align: Clutter.ActorAlign.CENTER}));
            list.add_child(e);
        }
        body.forEach((actor, i) => {
            list.add_child(actor);
            if (this._pageFresh) {
                actor.set({opacity: 0, translation_y: 8});
                actor.ease({opacity: 255, translation_y: 0, delay: 40 + i * 28, duration: 260,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            }
        });
        this._pageFresh = false;
        this._pageBox.add_child(list);

        const more = new St.Button({style_class: 'di-page-more', can_focus: false, x_align: Clutter.ActorAlign.START,
            label: _('More settings…')});
        more.connect('clicked', () => {
            try {
                Util.spawn(['gnome-control-center', settingsPanel]);
            } catch (e) {
                console.warn(`[dynamic-island] settings: ${e.message}`);
            }
            this.ctx?.collapse?.();
        });
        this._pageBox.add_child(more);
        this.ctx?.requestExpandedRelayout?.();
    }

    /** Card row: (icon) Name / status ...... trailing */
    _row({icon, name, status, trailing = null, active = false, busy = false, onClick}) {
        const box = new St.BoxLayout({style_class: 'di-page-row-box', x_expand: true});
        const bubble = new St.Bin({style_class: 'di-page-bubble', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: icon, icon_size: 15})});
        if (active)
            bubble.set_style(`background-color: ${this.accent}; color: #0b0b0b;`);
        box.add_child(bubble);
        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        col.add_child(label(name, 'di-page-row-name'));
        if (status) {
            const st = label(status, 'di-page-row-status');
            if (active)
                st.set_style(`color: ${this.accent};`);
            col.add_child(st);
        }
        box.add_child(col);
        if (busy) {
            const spin = new St.Icon({icon_name: 'process-working-symbolic', icon_size: 14,
                y_align: Clutter.ActorAlign.CENTER, pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
            spin.ease({rotation_angle_z: 360, duration: 900, mode: Clutter.AnimationMode.LINEAR, repeatCount: -1});
            box.add_child(spin);
        } else if (trailing) {
            box.add_child(new St.Icon({icon_name: trailing, icon_size: 13, y_align: Clutter.ActorAlign.CENTER,
                style_class: 'di-page-row-trailing'}));
        }
        const row = new St.Button({style_class: active ? 'di-page-row di-page-row-active' : 'di-page-row',
            child: box, x_expand: true, can_focus: false});
        row.connect('clicked', onClick);
        return row;
    }

    _ssid(ap) {
        const bytes = ap.get_ssid()?.get_data();
        return bytes ? this._NM.utils_ssid_to_utf8(bytes) : '';
    }

    _renderWifi() {
        const dev = this._wifiDevice();
        const on = !!this._nm?.wireless_enabled;
        const header = () => this._pageHeader('Wi-Fi', on, () => this._toggleWifi());
        if (!dev || !on) {
            this._renderPage('off', header, [], _('Wi-Fi off'), 'wifi');
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
        if (this._connecting && this._connecting === activeSsid)
            this._connecting = null;
        const saved = dev.get_available_connections();
        const aps = [...best.entries()]
            .sort(([a, x], [b, y]) => (b === activeSsid) - (a === activeSsid) || y.strength - x.strength)
            .slice(0, MAX_NETWORKS);
        const sig = aps.map(([s, ap]) => `${s}:${Math.round(ap.strength / 25)}:${s === activeSsid}`).join('|') +
            `#${this._connecting}`;
        const body = [];
        const others = [];
        for (const [ssid, ap] of aps) {
            const secured = (ap.flags | ap.wpa_flags | ap.rsn_flags) !== 0;
            const known = saved.some(c => ap.connection_valid(c));
            const isActive = ssid === activeSsid;
            const row = this._row({
                icon: signalIcon(ap.strength),
                name: ssid,
                status: isActive ? _('Connected')
                    : this._connecting === ssid ? _('Connecting…')
                        : known ? _('Saved') : secured ? _('Secured') : _('Open network'),
                trailing: isActive ? 'object-select-symbolic' : secured ? 'changes-prevent-symbolic' : null,
                active: isActive,
                busy: this._connecting === ssid,
                onClick: () => this._connectAp(dev, ap, ssid),
            });
            if (isActive)
                body.push(this._section(_('CURRENT NETWORK')), row);
            else
                others.push(row);
        }
        if (others.length)
            body.push(this._section(_('OTHER NETWORKS')), ...others);
        this._renderPage(sig, header, body, _('Scanning for networks…'), 'wifi');
    }

    _connectAp(dev, ap, ssid) {
        if (ap === dev.active_access_point)
            return;
        this._connecting = ssid;
        this._pageSig = null;
        this._renderWifi();
        const conn = dev.get_available_connections().find(c => ap.connection_valid(c));
        // Secured networks without a saved connection: GNOME's own network
        // agent asks for the password.
        if (conn)
            this._nm.activate_connection_async(conn, dev, null, null, null);
        else
            this._nm.add_and_activate_connection_async(null, dev, ap.get_path(), null, null);
        // give up the spinner if nothing happens
        this._connectTimer.schedule(20000, () => {
            if (this._connecting === ssid) {
                this._connecting = null;
                this._pageSig = null;
                this._sync();
            }
        });
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
        const on = !!this._bt?.default_adapter_powered;
        const header = () => this._pageHeader('Bluetooth', on, () => this._toggleBt());
        if (!on) {
            this._renderPage('off', header, [], _('Bluetooth off'), 'bluetooth');
            return;
        }
        this._btBusy ??= new Set();
        const devices = this._btDevices().sort((a, b) => b.connected - a.connected);
        const sig = devices.map(d => `${d.alias}:${d.connected}:${d.battery_percentage ?? ''}:${this._btBusy.has(d.get_object_path())}`).join('|');
        const connected = [], paired = [];
        for (const d of devices) {
            const busy = this._btBusy.has(d.get_object_path());
            const battery = d.connected && d.battery_percentage > 0 ? ` · ${_f('Battery %s', pct(d.battery_percentage))}` : '';
            const row = this._row({
                icon: d.icon || 'bluetooth-active-symbolic',
                name: d.alias || d.name,
                status: busy ? (d.connected ? _('Disconnecting…') : _('Connecting…'))
                    : d.connected ? `${_('Connected')}${battery}` : _('Not connected'),
                trailing: d.connected && !busy ? 'object-select-symbolic' : null,
                active: d.connected,
                busy,
                onClick: () => this._toggleDevice(d),
            });
            (d.connected ? connected : paired).push(row);
        }
        const body = [];
        if (connected.length)
            body.push(this._section(_('CONNECTED')), ...connected);
        if (paired.length)
            body.push(this._section(_('MY DEVICES')), ...paired);
        this._renderPage(sig, header, body, _('No paired devices'), 'bluetooth');
    }

    _toggleDevice(device) {
        const path = device.get_object_path();
        this._btBusy ??= new Set();
        if (this._btBusy.has(path))
            return;
        this._btBusy.add(path);
        this._renderBt();
        this._bt.connect_service(path, !device.connected, null)
            .catch(e => console.warn(`[dynamic-island] Bluetooth ${device.alias}: ${e.message}`))
            .finally(() => {
                this._btBusy?.delete(path);
                this._pageSig = null;
                this._sync();
            });
    }

    destroy() {
        this._connectTimer?.clear();
        this._unsubCaffeine?.();
        this._unsubCaffeine = this._caffeine = null;
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
