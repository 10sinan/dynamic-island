// Notification list for the centre island (replaces GNOME's popover list).
// Reads the shell's own message tray, so nothing is lost or duplicated.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {NotificationDestroyedReason} from 'resource:///org/gnome/shell/ui/messageTray.js';

import {IslandModule} from './base.js';

const MAX_ROWS = 4;

function plain(text) {
    return (text ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function ago(dt) {
    if (!dt)
        return '';
    const secs = GLib.DateTime.new_now_local().difference(dt) / GLib.USEC_PER_SEC;
    if (secs < 60)
        return 'şimdi';
    if (secs < 3600)
        return `${Math.floor(secs / 60)} dk`;
    return dt.format('%H:%M');
}

export default class NotificationListModule extends IslandModule {
    static id = 'notifications';
    static slot = 'main';

    async init() {
        this._tray = Main.messageTray;
        this._sources = new Map();
        this._idle = 0;
        for (const s of this._tray.getSources())
            this._watch(s);
        this._trayIds = [
            this._tray.connect('source-added', (_t, s) => {
                this._watch(s);
                this._queueRebuild();
            }),
            this._tray.connect('source-removed', (_t, s) => {
                this._unwatch(s);
                this._queueRebuild();
            }),
        ];
    }

    _watch(source) {
        if (this._sources.has(source))
            return;
        this._sources.set(source, [
            source.connect('notification-added', () => this._queueRebuild()),
            source.connect('notification-removed', () => this._queueRebuild()),
        ]);
    }

    _unwatch(source) {
        for (const id of this._sources.get(source) ?? [])
            source.disconnect(id);
        this._sources.delete(source);
    }

    _notifications() {
        return this._tray.getSources()
            .flatMap(s => s.notifications)
            .sort((a, b) => (b.datetime?.to_unix() ?? 0) - (a.datetime?.to_unix() ?? 0));
    }

    buildExpanded() {
        const box = new St.BoxLayout({
            style_class: 'di-notifs',
            orientation: Clutter.Orientation.VERTICAL,
        });
        const header = new St.BoxLayout({style_class: 'di-notifs-header'});
        header.add_child(new St.Label({
            style_class: 'di-section-title',
            text: 'BİLDİRİMLER',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._clear = new St.Button({style_class: 'di-chip', label: 'Temizle', can_focus: false});
        this._clear.connect('clicked', () => this._clearAll());
        header.add_child(this._clear);
        box.add_child(header);

        this._list = new St.BoxLayout({
            style_class: 'di-notifs-list',
            orientation: Clutter.Orientation.VERTICAL,
        });
        box.add_child(this._list);
        box.connect('destroy', () => {
            this._list = null;
            this._clear = null;
        });
        this._rebuild();
        return box;
    }

    _queueRebuild() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._rebuild();
            this.ctx?.requestExpandedRelayout?.();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        if (!this._list)
            return;
        this._list.destroy_all_children();
        const all = this._notifications();
        this._clear.visible = all.length > 0;
        if (!all.length) {
            this._list.add_child(new St.Label({style_class: 'di-notifs-empty', text: 'Bildirim yok'}));
            return;
        }
        for (const n of all.slice(0, MAX_ROWS))
            this._list.add_child(this._row(n));
        if (all.length > MAX_ROWS) {
            this._list.add_child(new St.Label({
                style_class: 'di-notifs-more',
                text: `+${all.length - MAX_ROWS} bildirim daha`,
            }));
        }
    }

    _row(n) {
        const row = new St.Button({style_class: 'di-notif-row', can_focus: false, x_expand: true});
        const box = new St.BoxLayout({style_class: 'di-notif-row-box', x_expand: true});
        const icon = new St.Icon({style_class: 'di-notif-row-icon', icon_size: 24,
            y_align: Clutter.ActorAlign.START});
        icon.gicon = n.gicon ?? n.source?.icon ?? null;
        if (!icon.gicon)
            icon.icon_name = 'preferences-system-notifications-symbolic';
        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const meta = new St.Label({style_class: 'di-notif-app',
            text: `${plain(n.source?.title) || 'Bildirim'} · ${ago(n.datetime)}`});
        const title = new St.Label({style_class: 'di-notif-row-title', text: plain(n.title)});
        const body = new St.Label({style_class: 'di-notif-row-body', text: plain(n.body)});
        body.visible = body.text.length > 0;
        for (const l of [meta, title, body])
            l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        col.add_child(meta);
        col.add_child(title);
        col.add_child(body);

        const close = new St.Button({style_class: 'di-notif-close', can_focus: false,
            y_align: Clutter.ActorAlign.START,
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12})});
        close.connect('clicked', () => n.destroy(NotificationDestroyedReason.DISMISSED));

        box.add_child(icon);
        box.add_child(col);
        box.add_child(close);
        row.set_child(box);
        row.connect('clicked', () => {
            this.ctx?.collapse?.();
            n.activate();
        });
        return row;
    }

    _clearAll() {
        for (const n of this._notifications()) {
            if (!n.resident)
                n.destroy(NotificationDestroyedReason.DISMISSED);
        }
    }

    onShown() {
        // Opening the panel counts as "seen" (clears the unread dot), like GNOME's calendar.
        for (const n of this._notifications())
            n.acknowledged = true;
        this._rebuild();
    }

    destroy() {
        if (this._idle) {
            GLib.Source.remove(this._idle);
            this._idle = 0;
        }
        for (const s of [...this._sources.keys()])
            this._unwatch(s);
        for (const id of this._trayIds ?? [])
            this._tray.disconnect(id);
        this._tray = null;
        this._list = null;
        this._clear = null;
        super.destroy();
    }
}
