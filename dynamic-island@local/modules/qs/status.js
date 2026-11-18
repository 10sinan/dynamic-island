// Compact content of the Quick Settings island: our own icon row, replacing
// the clone of GNOME's status icons (which was cramped and uneven in a 28 px
// pill). Every icon has the same size and spacing, vertically centred:
//
//   [wifi] [volume] [bluetooth] [do-not-disturb] [battery 86%]
// drawn as menu-bar style glyphs (lib/glyphs.js), not theme icons.
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
import {Glyph, volumeLevel, wifiLevel} from '../../lib/glyphs.js';

const PS = '/sys/class/power_supply';
const RARE = ['_camera', '_volumeInput', '_location', '_remoteAccess', '_unsafeMode'];

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

        this._wifi = new Glyph('wifi', {level: 0, off: true});
        this._vol = new Glyph('volume', {level: 3, muted: false});
        this._btIcon = new Glyph('bluetooth');
        this._dnd = new Glyph('dnd');
        this._awake = new Glyph('awake');
        for (const g of [this._wifi, this._vol, this._btIcon, this._dnd, this._awake]) {
            g.actor.y_align = Clutter.ActorAlign.CENTER;
            row.add_child(g.actor);
        }
        this._btIcon.actor.visible = false;
        this._dnd.actor.visible = false;
        this._awake.actor.visible = (this.ctx?.services?.caffeine?.remaining ?? 0) > 0;
        this._unsubAwake = this.ctx?.services?.caffeine?.subscribe(() => {
            if (this._show(this._awake?.actor, (this.ctx?.services?.caffeine?.remaining ?? 0) > 0))
                this.ctx?.requestRelayout?.(true);
        }) ?? null;

        // battery: one drawn glyph (rounded body + rounded fill + terminal) and the percentage
        this._batBox = new St.BoxLayout({style_class: 'di-qs-battery', y_align: Clutter.ActorAlign.CENTER,
            visible: !!this._bat});
        this._batGlyph = new Glyph('battery', {pct: 100, charging: false});
        this._batGlyph.actor.y_align = Clutter.ActorAlign.CENTER;
        this._batLabel = new St.Label({style_class: 'di-qs-percent', y_align: Clutter.ActorAlign.CENTER});
        this._batBox.add_child(this._batGlyph.actor);
        this._batBox.add_child(this._batLabel);
        row.add_child(this._batBox);

        row.connect('destroy', () => {
            this._dead = true;
            this._row = this._wifi = this._vol = this._btIcon = this._dnd = this._awake = null;
            this._batBox = this._batGlyph = this._batLabel = null;
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
        const ac = this._nm.primary_connection;
        if (!ac) {
            // no connection: Wi-Fi radio on -> empty fan, off -> empty fan with a slash
            this._wifi.setKind('wifi');
            this._wifi.set({level: 0, off: !this._nm.wireless_enabled});
            return;
        }
        const dev = ac.get_devices?.()[0] ?? null;
        if (dev instanceof NM.DeviceWifi) {
            this._wifi.setKind('wifi');
            this._wifi.set({level: wifiLevel(dev.active_access_point?.strength ?? 0), off: false});
        } else {
            this._wifi.setKind('wired');   // ethernet, VPN-only, ...
        }
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
        const muted = !s || s.is_muted;
        this._vol.set({level: volumeLevel(frac, muted), muted: muted || frac <= 0});
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
        if (this._show(this._btIcon?.actor, this._connectedBt()))
            this.ctx?.requestRelayout?.(true);
    }

    _syncDnd() {
        if (this._show(this._dnd?.actor, !this._notif.get_boolean('show-banners')))
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
        this._batGlyph.set({pct, charging});
        const text = `${pct}%`;
        if (this._batLabel.text !== text) {
            this._batLabel.text = text;
            this.ctx?.requestRelayout?.(true);   // "9%" -> "100%" changes the width
        }
    }

    destroy() {
        this._dead = true;
        this._unsubAwake?.();
        this._unsubAwake = null;
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
