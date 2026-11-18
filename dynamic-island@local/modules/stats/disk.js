// Root filesystem usage + live disk throughput.
//
// Tile (open island): usage of /; while a big transfer runs the second line
// shows the live read / write speed instead of the capacity.
// Panel pill (if "disk" is in the compact list): a small drive icon with the
// combined speed, visible ONLY during heavy disk activity (copying a large
// folder, extracting an archive, writing to a USB stick...).
// A short toast announces the start and the end ("12.4 GB moved").
// There is no percentage: the operating system does not tell us how big the
// operation is, only how fast the disks are going.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {IslandModule} from '../base.js';
import {_, _f} from '../../lib/i18n.js';
import {Meter} from '../../lib/widgets.js';
import {IoMeter, formatBytes, parseDiskstats} from '../../lib/diskio.js';
import {clamp01, formatRate, readText, severity} from '../../lib/proc.js';

Gio._promisify(Gio.File.prototype, 'query_filesystem_info_async', 'query_filesystem_info_finish');

const GB = 1024 ** 3;

export default class DiskModule extends IslandModule {
    static id = 'disk';
    static background = true;   // sampled while compact too, so a transfer is noticed

    async init() {
        this._file = Gio.File.new_for_path('/');
        this._io = new IoMeter();
        this._active = false;
        this._capacity = '';
        this._speeds = '';
        await this._read();   // fail early (module is dropped) if unsupported
        await readText('/proc/diskstats', this.cancellable);
    }

    async _read() {
        const info = await this._file.query_filesystem_info_async('filesystem::size,filesystem::free', 0, this.cancellable);
        const size = Number(info.get_attribute_uint64('filesystem::size'));
        const free = Number(info.get_attribute_uint64('filesystem::free'));
        return {size, used: size - free};
    }

    buildCompact() {
        const box = new St.BoxLayout({style_class: 'di-diskio', y_align: Clutter.ActorAlign.CENTER, visible: this._active});
        this._icon = new St.Icon({icon_name: 'drive-harddisk-symbolic', icon_size: 13, y_align: Clutter.ActorAlign.CENTER});
        this._rate = new St.Label({style_class: 'di-value-compact', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._rate);
        this._compact = box;
        box.connect('destroy', () => {
            this._compact = this._icon = this._rate = null;
        });
        return box;
    }

    buildExpanded() {
        this._tile = new Meter({accent: this.accent, title: 'DISK'});
        return this._tile.actor;
    }

    async tick() {
        const [text, fs] = await Promise.all([
            readText('/proc/diskstats', this.cancellable),
            this._read(),
        ]);
        const r = this._io.push(parseDiskstats(text), GLib.get_monotonic_time() / 1e6);
        if (r.event === 'start')
            this._setActive(true, r);
        else if (r.event === 'end')
            this._setActive(false, r);

        if (fs.size) {
            this._frac = clamp01(fs.used / fs.size);
            this._capacity = `${(fs.used / GB).toFixed(0)}/${(fs.size / GB).toFixed(0)} GB`;
        }
        this._speeds = `↓ ${formatRate(r.readBps)}  ↑ ${formatRate(r.writeBps)}`;
        this._renderTile();
        if (this._active && this._rate) {
            const text2 = formatRate(r.readBps + r.writeBps);
            if (this._rate.text !== text2)
                this._rate.text = text2;
        }
    }

    _renderTile() {
        if (!this._tile || this._frac === undefined)
            return;
        // second line: live speeds during a transfer, otherwise the capacity
        this._tile.update(`${Math.round(this._frac * 100)}%`, this._frac, severity(this._frac, 0.8, 0.92),
            this._active ? this._speeds : this._capacity);
    }

    _setActive(on, r) {
        this._active = on;
        if (this._compact) {
            this._compact.visible = on;
            if (on && this._rate)
                this._rate.text = formatRate(r.readBps + r.writeBps);
            this._icon?.remove_all_transitions();
            if (on) {
                // gentle pulse while the transfer runs
                this._icon.ease({opacity: 110, duration: 700, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                    repeatCount: -1, autoReverse: true});
            } else {
                this._icon.opacity = 255;
            }
            this.ctx?.requestRelayout?.(true);
        }
        this._renderTile();
        this._announce(on, r);
    }

    _announce(on, r) {
        // not while the user has the island open
        if (this.ctx?.isExpanded?.() || !this.ctx?.showActivity)
            return;
        const view = on
            ? {title: _('Large file operation'), sub: `↓ ${formatRate(r.readBps)}  ↑ ${formatRate(r.writeBps)}`}
            : {title: _('File operation done'), sub: _f('%s transferred', formatBytes(r.moved))};
        this.ctx.showActivity('diskio', {
            priority: 0,
            duration: 3000,
            build: () => {
                const box = new St.BoxLayout({style_class: 'di-event', y_align: Clutter.ActorAlign.CENTER});
                const icon = new St.Icon({style_class: 'di-event-icon', icon_name: 'drive-harddisk-symbolic',
                    icon_size: 24, y_align: Clutter.ActorAlign.CENTER});
                const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
                    y_align: Clutter.ActorAlign.CENTER});
                const title = new St.Label({style_class: 'di-event-title'});
                const sub = new St.Label({style_class: 'di-event-sub'});
                col.add_child(title);
                col.add_child(sub);
                box.add_child(icon);
                box.add_child(col);
                this._toast = {title, sub};
                box.connect('destroy', () => {
                    if (this._toast?.title === title)
                        this._toast = null;
                });
                return box;
            },
            update: v => {
                if (this._toast) {
                    this._toast.title.text = v.title;
                    this._toast.sub.text = v.sub;
                }
            },
        }, view);
    }

    destroy() {
        this._icon?.remove_all_transitions();
        this._compact = this._icon = this._rate = this._tile = this._toast = null;
        this._file = this._io = null;
        super.destroy();
    }
}
