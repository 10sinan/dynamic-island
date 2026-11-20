// Event indicators: the centre island briefly opens to tell you about things
// that happen to the machine — charger plugged / unplugged, low battery,
// Wi-Fi connected / lost, Bluetooth device connected / gone, microphone or
// camera started being used.
//
// All sources are signals (UPower, NetworkManager, GnomeBluetooth and the
// shell's own privacy indicators); nothing polls. The first value of each
// source is only recorded, never announced, so starting the extension is
// silent. trigger(kind, data) is public so tests can fire events.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getInputSourceManager} from 'resource:///org/gnome/shell/ui/status/keyboard.js';

import * as C from './constants.js';
import {findCpuTemp, parseMeminfo, readText, tryReadText} from './proc.js';
import {_, _f, pct} from './i18n.js';

const UPOWER = 'org.freedesktop.UPower';
const DISPLAY_DEVICE = '/org/freedesktop/UPower/devices/DisplayDevice';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';
// UPower Device.State
const CHARGING = 1, DISCHARGING = 2, FULL = 4, PENDING_CHARGE = 5;
const LOW_LEVELS = [20, 10];
const DEDUPE_MS = 3000;
const DURATION_MS = 3200;

Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');

// Resource alerts: fire when a value crosses `on`, re-arm when it falls below `off`.
const LIMITS = {
    thermal: {on: 90, off: 85},        // CPU °C
    memory: {on: 0.90, off: 0.85},     // fraction of RAM in use
    disk: {on: 0.95, off: 0.92},       // fraction of / in use
};
const WATCH_SECONDS = 10;

Gio._promisify(Gio.File.prototype, 'query_filesystem_info_async', 'query_filesystem_info_finish');

const TONES = {ok: '#ffffff', warn: '#f5b841', crit: '#ff6b5e', mic: '#ff9f0a', cam: '#30d158'};

export class EventHub {
    /**
     * @param {Island} island   the island that shows the events (centre)
     * @param {object} config   lib/settings.js snapshot (config.events = enabled kinds)
     */
    constructor(island, config) {
        this._island = island;
        this._enabled = new Set(config.events);
        this._accent = config.accent;
        this._ids = [];            // [object, id]
        this._lastShown = new Map();
        this._cancellable = new Gio.Cancellable();
        this._dead = false;

        if (this._enabled.has('power') || this._enabled.has('battery-low'))
            this._initPower().catch(e => this._failed('power', e));
        if (this._enabled.has('wifi'))
            this._initNetwork().catch(e => this._failed('wifi', e));
        if (this._enabled.has('bluetooth'))
            this._initBluetooth().catch(e => this._failed('bluetooth', e));
        if (this._enabled.has('privacy'))
            this._initPrivacy();
        if (this._enabled.has('lockkey'))
            this._initLockKeys();
        if (this._enabled.has('layout'))
            this._initLayout();
        if (['thermal', 'memory', 'disk'].some(k => this._enabled.has(k)))
            this._initResourceWatch().catch(e => this._failed('resources', e));
    }

    _failed(what, e) {
        if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            console.debug(`${C.LOG_PREFIX} events: ${what} unavailable: ${e?.message ?? e}`);
    }

    _on(obj, sig, cb) {
        this._ids.push([obj, obj.connect(sig, cb)]);
    }

    // ------------------------------------------------------------ sources

    async _initPower() {
        const proxy = await Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            UPOWER, DISPLAY_DEVICE, DEVICE_IFACE, this._cancellable);
        if (this._dead || !proxy.g_name_owner)
            return;
        this._power = proxy;
        const read = () => ({
            state: proxy.get_cached_property('State')?.unpack() ?? 0,
            pct: Math.round(proxy.get_cached_property('Percentage')?.unpack() ?? 100),
            present: proxy.get_cached_property('IsPresent')?.unpack() ?? true,
        });
        let last = read();
        this._on(proxy, 'g-properties-changed', () => {
            const cur = read();
            if (!cur.present)
                return;
            const wasCharging = [CHARGING, FULL, PENDING_CHARGE].includes(last.state);
            const isCharging = [CHARGING, FULL, PENDING_CHARGE].includes(cur.state);
            if (last.state && cur.state !== last.state) {
                if (!wasCharging && isCharging)
                    this.trigger('power', {charging: true, pct: cur.pct});
                else if (wasCharging && cur.state === DISCHARGING)
                    this.trigger('power', {charging: false, pct: cur.pct});
            }
            if (cur.state === DISCHARGING) {
                for (const level of LOW_LEVELS) {
                    if (last.pct > level && cur.pct <= level) {
                        this.trigger('battery-low', {pct: cur.pct, level});
                        break;
                    }
                }
            }
            last = cur;
        });
    }

    async _initNetwork() {
        const NM = (await import('gi://NM')).default;
        Gio._promisify(NM.Client, 'new_async', 'new_finish');
        const client = await NM.Client.new_async(this._cancellable);
        if (this._dead)
            return;
        this._nm = client;
        let last = client.primary_connection?.id ?? null;
        this._on(client, 'notify::primary-connection', () => {
            const cur = client.primary_connection;
            const name = cur?.id ?? null;
            if (name === last)
                return;
            const wasUp = last !== null;
            last = name;
            if (name) {
                const dev = cur.get_devices?.()[0];
                this.trigger('wifi', {connected: true, name, wired: dev instanceof NM.DeviceEthernet});
            } else if (wasUp) {
                this.trigger('wifi', {connected: false});
            }
        });
    }

    async _initBluetooth() {
        const GnomeBluetooth = (await import('gi://GnomeBluetooth?version=3.0')).default;
        if (this._dead)
            return;
        const client = new GnomeBluetooth.Client();
        this._bt = client;
        const store = client.get_devices();
        const state = new Map();   // device -> connected
        const watch = device => {
            if (state.has(device))
                return;
            state.set(device, !!device.connected);
            this._on(device, 'notify::connected', () => {
                const now = !!device.connected;
                if (now === state.get(device))
                    return;
                state.set(device, now);
                this.trigger('bluetooth', {connected: now, name: device.alias || device.name, icon: device.icon});
            });
        };
        for (let i = 0; i < store.get_n_items(); i++)
            watch(store.get_item(i));
        // devices that appear later (paired while running)
        this._on(store, 'items-changed', (_s, pos, _removed, added) => {
            for (let i = 0; i < added; i++)
                watch(store.get_item(pos + i));
        });
    }

    _initPrivacy() {
        const qs = Main.panel?.statusArea?.quickSettings;
        for (const [prop, kind] of [['_volumeInput', 'mic'], ['_camera', 'cam']]) {
            const ind = qs?.[prop];
            if (!ind)
                continue;
            this._on(ind, 'notify::visible', () => {
                if (ind.visible)
                    this.trigger('privacy', {kind, on: true});
                else
                    this._island?.endActivity(`event-privacy-${kind}`);
            });
        }
    }

    // ---- Caps Lock / Num Lock: GNOME shows nothing for these, we do
    _initLockKeys() {
        const keymap = global.stage.context.get_backend().get_default_seat().get_keymap();
        let last = {caps: keymap.get_caps_lock_state(), num: keymap.get_num_lock_state()};
        this._on(keymap, 'state-changed', () => {
            const cur = {caps: keymap.get_caps_lock_state(), num: keymap.get_num_lock_state()};
            for (const key of ['caps', 'num']) {
                if (cur[key] !== last[key])
                    this.trigger('lockkey', {key, on: cur[key]});
            }
            last = cur;
        });
    }

    // ---- keyboard layout switched (Super+Space, ...)
    _initLayout() {
        const mgr = getInputSourceManager();
        this._on(mgr, 'current-source-changed', (_m, old) => {
            const cur = mgr.currentSource;
            if (!old || !cur || cur === old)
                return;   // first value at startup is only recorded
            this.trigger('layout', {
                short: String(cur.shortName || cur.id).toUpperCase().slice(0, 3),
                name: cur.displayName,
            });
        });
    }

    // ---- overheating / low memory / full disk: a slow check every 10 s
    async _initResourceWatch() {
        const sensor = await findCpuTemp(this._cancellable);
        if (this._dead)
            return;
        this._tempPath = sensor?.path ?? null;
        this._armed = {thermal: true, memory: true, disk: true};
        this._firstCheck = true;
        await this._checkResources();
        if (this._dead)
            return;   // destroyed while the first reading was in flight: no timer may outlive us
        this._watchId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WATCH_SECONDS, () => {
            this._checkResources().catch(e => this._failed('resources', e));
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _checkResources() {
        const read = {};
        if (this._tempPath && this._enabled.has('thermal')) {
            const t = Number(await tryReadText(this._tempPath, this._cancellable));
            if (Number.isFinite(t))
                read.temp = t / 1000;
        }
        if (this._enabled.has('memory')) {
            const m = parseMeminfo(await readText('/proc/meminfo', this._cancellable));
            read.ram = 1 - m.availableKb / m.totalKb;
        }
        if (this._enabled.has('disk')) {
            const info = await Gio.File.new_for_path('/').query_filesystem_info_async(
                'filesystem::size,filesystem::free', 0, this._cancellable);
            const size = Number(info.get_attribute_uint64('filesystem::size'));
            const free = Number(info.get_attribute_uint64('filesystem::free'));
            if (size > 0)
                read.disk = 1 - free / size;
            read.diskFreeGb = free / 1024 ** 3;
        }
        if (!this._dead)
            this._evaluate(read);
    }

    /**
     * Compare readings with the limits. A value that is already over its limit
     * when we first look is only remembered (silent start); after that each
     * crossing is announced once, and re-armed when the value drops again.
     * Public for tests.
     */
    _evaluate({temp, ram, disk, diskFreeGb = 0}) {
        this._armed ??= {thermal: true, memory: true, disk: true};
        const first = !!this._firstCheck;
        this._firstCheck = false;
        const step = (kind, value, data) => {
            if (value === undefined || !this._enabled.has(kind))
                return;
            const lim = LIMITS[kind];
            if (value >= lim.on) {
                if (this._armed[kind] && !first)
                    this.trigger(kind, data);
                this._armed[kind] = false;
            } else if (value < lim.off) {
                this._armed[kind] = true;
            }
        };
        step('thermal', temp, {c: Math.round(temp ?? 0)});
        step('memory', ram, {pct: Math.round((ram ?? 0) * 100)});
        step('disk', disk, {pct: Math.round((disk ?? 0) * 100), freeGb: diskFreeGb});
    }

    // ------------------------------------------------------------ events -> views

    _view(kind, d) {
        switch (kind) {
        case 'power': {
            const level = Math.min(100, Math.round(d.pct / 10) * 10);
            return d.charging
                ? {icon: `battery-level-${level}-charging-symbolic`, title: _('Charging'), sub: pct(d.pct), tone: 'ok'}
                : {icon: `battery-level-${level}-symbolic`, title: _('Charger unplugged'), sub: pct(d.pct), tone: 'ok'};
        }
        case 'battery-low':
            return {icon: 'battery-level-10-symbolic', title: _('Battery low'), sub: _f('%s left', pct(d.pct)),
                tone: d.level <= 10 ? 'crit' : 'warn', duration: 5000};
        case 'wifi':
            return d.connected
                ? {icon: d.wired ? 'network-wired-symbolic' : 'network-wireless-signal-excellent-symbolic',
                    title: d.name, sub: _('Connected'), tone: 'ok'}
                : {icon: 'network-wireless-offline-symbolic', title: _('Connection lost'), sub: _('No internet'), tone: 'warn'};
        case 'bluetooth':
            return {icon: d.icon || 'bluetooth-active-symbolic', title: d.name,
                sub: d.connected ? _('Connected') : _('Disconnected'), tone: d.connected ? 'ok' : 'warn'};
        case 'lockkey': {
            const caps = d.key === 'caps';
            return {badge: caps ? (d.on ? 'AA' : 'aa') : (d.on ? '123' : '···'),
                title: caps ? 'Caps Lock' : 'Num Lock', sub: d.on ? _('On') : _('Off'),
                tone: d.on && caps ? 'warn' : 'ok', duration: 2000};
        }
        case 'layout':
            return {badge: d.short, title: d.name, sub: _('Keyboard layout'), tone: 'ok', duration: 2200};
        case 'meeting':
            return d.on
                ? {icon: 'notifications-disabled-symbolic', title: _('Meeting mode'), sub: _('Notifications muted'), tone: 'mic', duration: 3500}
                : {icon: 'notifications-symbolic', title: _('Meeting ended'), sub: _('Notifications back on'), tone: 'ok', duration: 3000};
        case 'powersaver':
            return d.on
                ? {icon: 'power-profile-power-saver-symbolic', title: _('Power saver on'),
                    sub: _f('Battery %s · screen and CPU throttled', pct(d.pct)), tone: 'warn', duration: 4500}
                : {icon: 'power-profile-balanced-symbolic', title: _('Power saver off'),
                    sub: _('Previous profile restored'), tone: 'ok', duration: 3000};
        case 'thermal':
            return {icon: 'dialog-warning-symbolic', title: _('System running hot'), sub: `CPU ${d.c}°C`, tone: 'crit', duration: 5000};
        case 'memory':
            return {icon: 'dialog-warning-symbolic', title: _('Low memory'), sub: _f('%s used', pct(d.pct)), tone: 'warn', duration: 5000};
        case 'disk':
            return {icon: 'drive-harddisk-symbolic', title: _('Disk almost full'),
                sub: _f('%s used · %s GB free', pct(d.pct), d.freeGb.toFixed(1)), tone: 'crit', duration: 5000};
        case 'privacy':
            return d.kind === 'mic'
                ? {icon: 'audio-input-microphone-symbolic', title: _('Microphone in use'), sub: _('An app is listening'),
                    tone: 'mic', dot: true, duration: 4000}
                : {icon: 'camera-web-symbolic', title: _('Camera in use'), sub: _('An app is using the camera'),
                    tone: 'cam', dot: true, duration: 4000};
        default:
            return null;
        }
    }

    /** Public: announce an event (also used by the tests). */
    trigger(kind, data) {
        if (this._dead || !this._enabled.has(kind))
            return false;
        const island = this._island;
        // Do not pop over something the user is looking at.
        if (!island || island.mode === 'expanded')
            return false;
        const view = this._view(kind, data);
        if (!view)
            return false;

        const sig = `${kind}:${view.title}:${view.sub}`;
        const now = Date.now();
        if (this._lastShown.get(sig) > now - DEDUPE_MS)
            return false;   // same event again within 3 s
        this._lastShown.set(sig, now);

        const key = kind === 'privacy' ? `event-privacy-${data.kind}` : `event-${kind}`;
        return island.showActivity(key, {
            priority: 1,
            duration: view.duration ?? DURATION_MS,
            build: () => this._build(),
            update: v => this._update(v),
        }, view);
    }

    _build() {
        const box = new St.BoxLayout({style_class: 'di-event', y_align: Clutter.ActorAlign.CENTER});
        const refs = {
            icon: new St.Icon({style_class: 'di-event-icon', icon_size: 24, y_align: Clutter.ActorAlign.CENTER}),
            badge: new St.Label({style_class: 'di-event-badge', y_align: Clutter.ActorAlign.CENTER, visible: false}),
            title: new St.Label({style_class: 'di-event-title'}),
            sub: new St.Label({style_class: 'di-event-sub'}),
            dot: new St.Widget({style_class: 'di-event-dot', y_align: Clutter.ActorAlign.CENTER, visible: false}),
        };
        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        col.add_child(refs.title);
        col.add_child(refs.sub);
        box.add_child(refs.icon);
        box.add_child(refs.badge);
        box.add_child(col);
        box.add_child(refs.dot);
        // The island destroys the previous view AFTER building the next one
        // (a different event replaces it): only clear our references if they
        // still belong to this view.
        this._refs = refs;
        box.connect('destroy', () => {
            if (this._refs === refs)
                this._refs = null;
        });
        return box;
    }

    _update(v) {
        const r = this._refs;
        if (!r)
            return;
        const color = TONES[v.tone] ?? TONES.ok;
        // keys and layouts have no icon: a bold letter badge instead
        r.icon.visible = !v.badge;
        r.badge.visible = !!v.badge;
        if (v.badge) {
            r.badge.text = v.badge;
            r.badge.set_style(`color: ${color};`);
        } else {
            r.icon.icon_name = v.icon;
            r.icon.set_style(`color: ${color};`);
        }
        r.title.text = v.title;
        r.sub.text = v.sub;
        r.dot.visible = !!v.dot;
        if (v.dot)
            r.dot.set_style(`background-color: ${TONES[v.tone]};`);
        if (!r.entered) {   // first paint of a new view only, not in-place updates
            r.entered = true;
            this._enter(r, v.tone);
        }
    }

    /**
     * Entrance of a fresh event view: the icon pops in with an overshoot, the
     * text glides in behind it. Warnings and critical events pulse the icon
     * afterwards (2x warn, 3x crit) so they read as urgent.
     */
    _enter(r, tone) {
        const mark = r.badge.visible ? r.badge : r.icon;
        mark.set_pivot_point(0.5, 0.5);
        mark.set({opacity: 0, scale_x: 0.35, scale_y: 0.35});
        let pulses = tone === 'crit' ? 3 : tone === 'warn' ? 2 : 0;
        let gone = false;
        mark.connect('destroy', () => {
            gone = true;
        });
        const pulse = () => {
            if (gone || pulses-- <= 0)
                return;
            mark.ease({
                scale_x: 1.22, scale_y: 1.22, duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (gone)
                        return;
                    mark.ease({
                        scale_x: 1, scale_y: 1, duration: 220,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: pulse,
                    });
                },
            });
        };
        mark.ease({
            opacity: 255, scale_x: 1, scale_y: 1, duration: 380,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: pulse,
        });
        [r.title, r.sub].forEach((label, n) => {
            label.set({opacity: 0, translation_x: 10});
            label.ease({
                opacity: 255, translation_x: 0, delay: 70 + n * 50, duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            });
        });
    }

    destroy() {
        this._dead = true;
        if (this._watchId) {
            GLib.Source.remove(this._watchId);
            this._watchId = 0;
        }
        this._cancellable.cancel();
        for (const [obj, id] of this._ids) {
            try {
                obj.disconnect(id);
            } catch {}
        }
        this._ids = [];
        for (const key of ['event-power', 'event-battery-low', 'event-wifi', 'event-bluetooth',
            'event-thermal', 'event-memory', 'event-disk', 'event-lockkey', 'event-layout',
            'event-meeting', 'event-powersaver',
            'event-privacy-mic', 'event-privacy-cam'])
            this._island?.endActivity(key);
        this._power = this._nm = this._bt = null;
        this._island = null;
    }
}
