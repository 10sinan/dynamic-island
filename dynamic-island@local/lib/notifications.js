// Notification previews inside the centre island.
//
// GNOME keeps doing all the bookkeeping (queue, acknowledging, the unread
// dot, Do Not Disturb, critical handling). We only:
//   * listen to every source's 'notification-request-banner' (same signal
//     the shell uses to decide on a banner) and show our own preview,
//   * move the shell's banner layer off-screen so it is neither visible nor
//     clickable (translation moves its input region too). Restored on disable.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

import * as C from './constants.js';

const OFFSCREEN = -100000;

function plain(text) {
    return (text ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export class NotificationPreview {
    constructor(island, config) {
        this._island = island;
        this._duration = config.notificationDuration;
        this._screenshots = config.screenshotPreview;
        this._tray = Main.messageTray;
        this._sources = new Map();   // source -> [signal ids]
        this._fresh = new WeakSet(); // notifications added while still unseen
        this._pending = null;
        this._current = null;
        this._currentId = 0;
        this._dnd = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});

        // Hide the shell's own banners (state machine keeps running).
        this._saved = {translation_y: this._tray.translation_y, opacity: this._tray.opacity};
        this._tray.translation_y = OFFSCREEN;
        this._tray.opacity = 0;

        for (const s of this._tray.getSources())
            this._watch(s);
        this._trayIds = [
            this._tray.connect('source-added', (_t, s) => this._watch(s)),
            this._tray.connect('source-removed', (_t, s) => this._unwatch(s)),
        ];
    }

    _watch(source) {
        if (this._sources.has(source))
            return;
        // The shell's own handler runs before ours and marks the notification
        // acknowledged while showing its banner, so remember which ones were
        // still unseen when they were added (emitted right before the banner request).
        const ids = [
            source.connect('notification-added', (_s, n) => {
                if (!n.acknowledged)
                    this._fresh.add(n);
            }),
            source.connect('notification-request-banner', (_s, n) => this._onBanner(n)),
        ];
        this._sources.set(source, ids);
    }

    _unwatch(source) {
        for (const id of this._sources.get(source) ?? [])
            source.disconnect(id);
        this._sources.delete(source);
    }

    // Same filters as MessageTray._onNotificationRequestBanner + DND.
    _onBanner(n) {
        if (!this._fresh.has(n))
            return;   // already seen before (e.g. an update of an old notification)
        this._fresh.delete(n);
        if (n.urgency === Urgency.LOW)
            return;
        const critical = n.urgency === Urgency.CRITICAL;
        if (!critical && (!n.source?.policy?.showBanners || !this._dnd.get_boolean('show-banners')))
            return;
        this._show(n);
    }

    /** GNOME's screenshot notification carries the picture as an St.ImageContent icon. */
    _isScreenshot(n) {
        return this._screenshots && n.gicon instanceof St.ImageContent;
    }

    _show(n) {
        const shot = this._isScreenshot(n);
        const key = shot ? 'screenshot' : 'notification';
        const shown = this._island.showActivity(key, {
            priority: 1,
            duration: n.urgency === Urgency.CRITICAL ? Math.max(10000, this._duration)
                : shot ? Math.max(4000, this._duration) : this._duration,
            build: () => shot ? this._buildShot() : this._build(),
            update: notif => shot ? this._updateShot(notif) : this._update(notif),
            onClick: () => this._activate(),
            onEnd: () => this._onEnd(),
        }, n);
        if (shown)
            this._track(n, key);
        else
            this._pending = n;   // e.g. an OSD is showing; try again when it ends
    }

    _track(n, key = 'notification') {
        if (this._current && this._currentId)
            this._current.disconnect(this._currentId);
        this._current = n;
        this._currentKey = key;
        // Dismissed elsewhere (notification list, app) -> close the preview.
        this._currentId = n.connect('destroy', () => {
            this._currentId = 0;
            this._current = null;
            this._island?.endActivity(key);
        });
    }

    _onEnd() {
        if (this._current && this._currentId)
            this._current.disconnect(this._currentId);
        this._current = null;
        this._currentId = 0;
        const next = this._pending;
        this._pending = null;
        if (next && !next.acknowledged)
            this._show(next);
    }

    _activate() {
        try {
            this._current?.activate();
        } catch (e) {
            console.warn(`${C.LOG_PREFIX} notification activate failed`, e);
        }
    }

    _build() {
        const box = new St.BoxLayout({style_class: 'di-notif', y_align: Clutter.ActorAlign.CENTER});
        this._icon = new St.Icon({style_class: 'di-notif-icon', icon_size: 32,
            y_align: Clutter.ActorAlign.CENTER});
        const col = new St.BoxLayout({
            style_class: 'di-notif-text',
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._app = new St.Label({style_class: 'di-notif-app'});
        this._title = new St.Label({style_class: 'di-notif-title'});
        this._body = new St.Label({style_class: 'di-notif-body'});
        for (const l of [this._app, this._title, this._body])
            l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        col.add_child(this._app);
        col.add_child(this._title);
        col.add_child(this._body);
        box.add_child(this._icon);
        box.add_child(col);
        box.connect('destroy', () => {
            this._icon = this._app = this._title = this._body = null;
        });
        return box;
    }

    // ---- screenshot: the picture itself, with a shutter flash and a springy pop-in
    _buildShot() {
        const box = new St.BoxLayout({style_class: 'di-shot', y_align: Clutter.ActorAlign.CENTER});
        const frame = new St.Widget({style_class: 'di-shot-frame', layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true, y_align: Clutter.ActorAlign.CENTER});
        frame.set_pivot_point(0.5, 0.5);
        const image = new Clutter.Actor({x_expand: true, y_expand: true,
            content_gravity: Clutter.ContentGravity.RESIZE_ASPECT});
        const flash = new St.Widget({style_class: 'di-shot-flash', x_expand: true, y_expand: true, opacity: 0});
        frame.add_child(image);
        frame.add_child(flash);

        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({style_class: 'di-event-title', text: 'Ekran görüntüsü alındı'});
        const sub = new St.Label({style_class: 'di-event-sub'});
        const hint = new St.Label({style_class: 'di-shot-hint', text: 'Tıkla: aç  ·  sağ tık: kapat'});
        col.add_child(title);
        col.add_child(sub);
        col.add_child(hint);
        box.add_child(frame);
        box.add_child(col);

        const refs = {frame, image, flash, sub};
        this._shotRefs = refs;
        box.connect('destroy', () => {
            if (this._shotRefs === refs)
                this._shotRefs = null;
        });
        return box;
    }

    _updateShot(n) {
        const r = this._shotRefs;
        if (!r)
            return;
        this._track(n, 'screenshot');
        const content = n.gicon;
        // fit into 176 x 108, keeping the picture's aspect ratio
        let [ok, w, h] = content.get_preferred_size?.() ?? [false, 16, 10];
        if (!ok || !(w > 0) || !(h > 0))
            [w, h] = [16, 10];
        const k = Math.min(176 / w, 108 / h);
        r.frame.set_size(Math.max(48, Math.round(w * k)), Math.max(30, Math.round(h * k)));
        r.image.set_content(content);
        r.sub.text = n.actions?.length ? 'Panoya kopyalandı · dosyaya kaydedildi' : 'Panoya kopyalandı';

        // shutter flash + pop-in
        r.frame.remove_all_transitions();
        r.flash.remove_all_transitions();
        r.frame.set_scale(0.78, 0.78);
        r.frame.ease({scale_x: 1, scale_y: 1, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        r.flash.opacity = 230;
        r.flash.ease({opacity: 0, duration: 340, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _update(n) {
        if (!this._icon)
            return;
        this._track(n);
        this._icon.gicon = n.gicon ?? n.source?.icon ?? null;
        if (!this._icon.gicon)
            this._icon.icon_name = 'preferences-system-notifications-symbolic';
        this._app.text = `${plain(n.source?.title) || 'Bildirim'} · şimdi`;
        this._title.text = plain(n.title) || plain(n.source?.title);
        const body = plain(n.body);
        this._body.text = body;
        this._body.visible = body.length > 0;
    }

    destroy() {
        if (this._current && this._currentId)
            this._current.disconnect(this._currentId);
        this._current = null;
        for (const [s, ids] of this._sources) {
            for (const id of ids)
                s.disconnect(id);
        }
        this._sources.clear();
        for (const id of this._trayIds ?? [])
            this._tray.disconnect(id);
        this._island?.endActivity('notification');
        this._island?.endActivity('screenshot');
        this._tray.translation_y = this._saved.translation_y;
        this._tray.opacity = this._saved.opacity;
        this._pending = null;
        this._island = null;
        this._dnd = null;
    }
}
