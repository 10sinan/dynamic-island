// Compact content of the Quick Settings island: our own icon row, replacing
// the clone of GNOME's status icons (which was cramped and uneven in a 28 px
// pill). Every icon has the same size and spacing, vertically centred:
//
//   [wifi] [volume] [bluetooth] [do-not-disturb] [battery 86%]
//
// Bluetooth and Do Not Disturb only show when relevant. Rarely seen GNOME
// indicators (camera, microphone, location, screen sharing, unsafe mode) are
// cloned one by one and only appear while GNOME shows them.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {IslandModule} from '../base.js';
import {tryReadText, listDir} from '../../lib/proc.js';

const PS = '/sys/class/power_supply';
const ICON = 14;
const RARE = ['_camera', '_volumeInput', '_location', '_remoteAccess', '_unsafeMode'];

function wifiIcon(strength) {
    if (strength >= 80)
        return 'network-wireless-signal-excellent-symbolic';
    if (strength >= 55)
        return 'network-wireless-signal-good-symbolic';
    if (strength >= 30)
        return 'network-wireless-signal-ok-symbolic';
    return 'network-wireless-signal-weak-symbolic';
}

function volumeIcon(frac, muted) {
    if (muted || frac <= 0)
        return 'audio-volume-muted-symbolic';
    if (frac < 0.34)
        return 'audio-volume-low-symbolic';
    if (frac < 0.67)
        return 'audio-volume-medium-symbolic';
    return 'audio-volume-high-symbolic';
}

export default class QsStatusModule extends IslandModule {
    static id = 'qs-status';
    // sensors are polled (compact tick) so the pill stays correct while closed
    static background = true;

    async init() {
        this._dead = false;
        this._ids = [];   // [object, id]
        this._rare = [];

        // battery
        this._bat = null;
        for (const name of await listDir(PS, this.cancellable).catch(() => [])) {
            const type = await tryReadText(`${PS}/${name}/type`, this.cancellable);
            const scope = await tryReadText(`${PS}/${name}/scope`, this.cancellable);
            if (type === 'Battery' && scope !== 'Device') {
                this._bat = `${PS}/${name}`;
                break;
            }
        }

        // do not disturb
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._on(this._notif, 'changed::show-banners', () => this._syncDnd());

        // volume
        try {
            this._mixer = Volume.getMixerControl();
            this._on(this._mixer, 'default-sink-changed', () => this._bindSink());
            this._on(this._mixer, 'state-changed', () => this._bindSink());
        } catch {
            this._mixer = null;
        }

        // network
        try {
            this._NM = (await import('gi://NM')).default;
            Gio._promisify(this._NM.Client, 'new_async', 'new_finish');
            this._nm = await this._NM.Client.new_async(this.cancellable);
            for (const sig of ['notify::primary-connection', 'notify::wireless-enabled', 'notify::connectivity'])
                this._on(this._nm, sig, () => this._syncWifi());
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            this._nm = null;
        }

        // bluetooth
        try {
            const GnomeBluetooth = (await import('gi://GnomeBluetooth?version=3.0')).default;
            this._bt = new GnomeBluetooth.Client();
            for (const sig of ['notify::default-adapter', 'notify::default-adapter-powered'])
                this._on(this._bt, sig, () => this._syncBt());
        } catch {
            this._bt = null;
        }
    }

    _on(obj, sig, cb) {
        this._ids.push([obj, obj.connect(sig, cb)]);
    }

    // ------------------------------------------------------------ UI

    _icon(name) {
        return new St.Icon({style_class: 'di-qs-icon', icon_name: name, icon_size: ICON,
            y_align: Clutter.ActorAlign.CENTER});
    }

    buildCompact() {
        const row = new St.BoxLayout({style_class: 'di-qs-row', y_align: Clutter.ActorAlign.CENTER});
        this._row = row;

        // rare GNOME indicators first (privacy dots etc.)
        const qs = Main.panel?.statusArea?.quickSettings;
        for (const name of RARE) {
            const src = qs?.[name];
            if (!src)
                continue;
            const clone = new Clutter.Clone({source: src, y_align: Clutter.ActorAlign.CENTER});
            const bind = src.bind_property('visible', clone, 'visible', GObject.BindingFlags.SYNC_CREATE);
            this._rare.push({src, clone, bind});
            this._on(src, 'notify::visible', () => this.ctx?.requestRelayout?.(true));
            row.add_child(clone);
        }

        this._wifi = this._icon('network-wireless-offline-symbolic');
        this._vol = this._icon('audio-volume-high-symbolic');
        this._btIcon = this._icon('bluetooth-active-symbolic');
        this._dnd = this._icon('notifications-disabled-symbolic');
        row.add_child(this._wifi);
        row.add_child(this._vol);
        row.add_child(this._btIcon);
        row.add_child(this._dnd);

        // battery: outline + fill (scaled, no relayout) + tip + percentage
        this._batBox = new St.BoxLayout({style_class: 'di-qs-battery', y_align: Clutter.ActorAlign.CENTER,
            visible: !!this._bat});
        const shell = new St.Widget({style_class: 'di-bat-shell', y_align: Clutter.ActorAlign.CENTER});
        this._batFill = new St.Widget({style_class: 'di-bat-fill', x: 2, y: 2, width: 16, height: 6});
        this._batFill.set_pivot_point(0, 0.5);
        shell.add_child(this._batFill);
        const tip = new St.Widget({style_class: 'di-bat-tip', y_align: Clutter.ActorAlign.CENTER});
        this._batLabel = new St.Label({style_class: 'di-qs-percent', y_align: Clutter.ActorAlign.CENTER});
        this._batBox.add_child(shell);
        this._batBox.add_child(tip);
        this._batBox.add_child(this._batLabel);
        row.add_child(this._batBox);

        row.connect('destroy', () => {
            this._dead = true;
            this._row = this._wifi = this._vol = this._btIcon = this._dnd = null;
            this._batBox = this._batFill = this._batLabel = null;
            this._rare = [];
        });

        this._bindSink();
        this._syncWifi();
        this._syncBt();
        this._syncDnd();
        this.tick();
        return row;
    }

    // ------------------------------------------------------------ state

    _show(actor, on) {
        if (!actor || actor.visible === on)
            return false;
        actor.visible = on;
        return true;
    }

    _syncWifi() {
        if (!this._wifi || !this._nm)
            return;
        const NM = this._NM;
        let name = 'network-wireless-offline-symbolic';
        if (!this._nm.wireless_enabled && !this._nm.primary_connection) {
            name = 'network-wireless-disabled-symbolic';
        } else if (this._nm.primary_connection) {
            const dev = this._nm.primary_connection.get_devices?.()[0] ?? null;
            if (dev instanceof NM.DeviceWifi)
                name = wifiIcon(dev.active_access_point?.strength ?? 0);
            else if (dev instanceof NM.DeviceEthernet)
                name = 'network-wired-symbolic';
            else
                name = 'network-workgroup-symbolic';
        }
        if (this._wifi.icon_name !== name)
            this._wifi.icon_name = name;
    }

    _bindSink() {
        if (this._sink) {
            for (const id of this._sinkIds)
                this._sink.disconnect(id);
        }
        this._sinkIds = [];
        this._sink = this._mixer?.get_default_sink() ?? null;
        if (this._sink) {
            this._sinkIds = ['notify::volume', 'notify::is-muted']
                .map(sig => this._sink.connect(sig, () => this._syncVolume()));
        }
        this._syncVolume();
    }

    _syncVolume() {
        if (!this._vol)
            return;
        const s = this._sink;
        const frac = s ? Math.min(1, s.volume / this._mixer.get_vol_max_norm()) : 0;
        const name = volumeIcon(frac, !s || s.is_muted);
        if (this._vol.icon_name !== name)
            this._vol.icon_name = name;
    }

    _connectedBt() {
        const store = this._bt?.default_adapter_powered ? this._bt.get_devices() : null;
        for (let i = 0; i < (store?.get_n_items() ?? 0); i++) {
            if (store.get_item(i)?.connected)
                return true;
        }
        return false;
    }

    _syncBt() {
        if (this._show(this._btIcon, this._connectedBt()))
            this.ctx?.requestRelayout?.(true);
    }

    _syncDnd() {
        if (this._show(this._dnd, !this._notif.get_boolean('show-banners')))
            this.ctx?.requestRelayout?.(true);
    }

    async tick() {
        // signal strength and device connections change without a signal
        this._syncWifi();
        this._syncBt();
        if (!this._bat || !this._batLabel)
            return;
        const [cap, status] = await Promise.all([
            tryReadText(`${this._bat}/capacity`, this.cancellable),
            tryReadText(`${this._bat}/status`, this.cancellable),
        ]);
        const pct = Number(cap);
        if (!this._batLabel || !Number.isFinite(pct))
            return;
        const charging = status === 'Charging';
        const text = `${charging ? '⚡' : ''}${pct}%`;
        if (this._batLabel.text !== text) {
            this._batLabel.text = text;
            this.ctx?.requestRelayout?.(true);   // "9%" -> "100%" changes the width
        }
        this._batFill.ease({scale_x: Math.max(0.05, pct / 100), duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        const level = charging ? 'ok' : pct <= 10 ? 'crit' : pct <= 20 ? 'warn' : 'ok';
        for (const l of ['ok', 'warn', 'crit'])
            this._batFill.remove_style_class_name(`di-bat-${l}`);
        this._batFill.add_style_class_name(`di-bat-${level}`);
    }

    destroy() {
        this._dead = true;
        for (const [obj, id] of this._ids ?? []) {
            try {
                obj.disconnect(id);
            } catch {}
        }
        this._ids = [];
        if (this._sink) {
            for (const id of this._sinkIds ?? [])
                this._sink.disconnect(id);
        }
        for (const {bind} of this._rare ?? []) {
            try {
                bind.unbind();
            } catch {}
        }
        this._rare = [];
        this._sink = this._mixer = this._nm = this._bt = this._notif = null;
        super.destroy();
    }
}
