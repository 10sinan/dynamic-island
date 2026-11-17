// Clock: replaces the hidden top-panel clock.
// Compact: time (+ a dot when there are unread notifications).
// Header (expanded): big time · date at the very top of the island.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {IslandModule} from './base.js';

export default class ClockModule extends IslandModule {
    static id = 'clock';

    async init() {
        this._dead = false;
        this._dots = [];
        this._timeLabels = [];

        if (this.ctx.config.showSeconds) {
            // WallClock follows the system "show seconds" setting only; when
            // the island wants seconds, tick ourselves once per second.
            this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            this._secondsId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._sync();
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            // Same source the shell clock uses: follows the 12h/24h setting
            // and ticks exactly on the minute.
            this._wall = new GnomeDesktop.WallClock({time_only: true});
            this._wallId = this._wall.connect('notify::clock', () => this._sync());
        }

        this._indicator = this.ctx.panelSlot?.notificationIndicator ?? null;
        if (this._indicator)
            this._indicatorId = this._indicator.connect('notify::visible', () => this._sync());
    }

    _timeText() {
        if (this._wall)
            return this._wall.clock.trim();   // 12h format pads hours with a space
        const now = GLib.DateTime.new_now_local();
        return this._iface?.get_string('clock-format') === '12h'
            ? now.format('%l∶%M∶%S %p').trim()
            : now.format('%H∶%M∶%S');
    }

    _makeTime(styleClass) {
        const label = new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._timeLabels.push(label);
        return label;
    }

    _makeDot() {
        // The dot always takes its space and only fades, so the pill width
        // never changes when a notification arrives.
        const dot = new St.Widget({style_class: 'di-dot', opacity: 0, y_align: Clutter.ActorAlign.CENTER});
        dot.set_style(`background-color: ${this.accent};`);
        this._dots.push(dot);
        return dot;
    }

    _watchDestroy(actor) {
        actor.connect('destroy', () => {
            this._dead = true;
        });
    }

    buildCompact() {
        const box = new St.BoxLayout({style_class: 'di-clock-box', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._makeTime('di-clock'));
        box.add_child(this._makeDot());
        this._watchDestroy(box);
        this._sync();
        return box;
    }

    buildHeader() {
        const box = new St.BoxLayout({
            style_class: 'di-header',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._makeTime('di-clock-big'));
        this._date = new St.Label({style_class: 'di-date', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._date);
        box.add_child(this._makeDot());
        this._watchDestroy(box);
        this._sync();
        return box;
    }

    _sync() {
        if (this._dead)
            return;
        const time = this._timeText();
        for (const l of this._timeLabels)
            l.text = time;
        if (this._date)
            this._date.text = GLib.DateTime.new_now_local().format('%a %-d %b');
        const target = this._indicator?.visible ? 255 : 0;
        for (const d of this._dots) {
            if (d.opacity !== target)
                d.ease({opacity: target, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    async tick() {
        // Event-driven; refresh date / dot just in case.
        this._sync();
    }

    destroy() {
        this._dead = true;
        if (this._wall) {
            this._wall.disconnect(this._wallId);
            this._wall.run_dispose();   // stops its internal timeout now
            this._wall = null;
        }
        if (this._secondsId) {
            GLib.Source.remove(this._secondsId);
            this._secondsId = 0;
        }
        this._iface = null;
        if (this._indicator && this._indicatorId)
            this._indicator.disconnect(this._indicatorId);
        this._indicator = null;
        this._timeLabels = [];
        this._dots = [];
        this._date = null;
        super.destroy();
    }
}
