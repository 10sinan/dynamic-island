// Clipboard history (last 10 copies) for the right island.
// Click an entry to put it back on the clipboard, then paste it yourself.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {IslandModule} from '../base.js';

function ago(ms) {
    const s = Math.floor((Date.now() - ms) / 1000);
    if (s < 60)
        return 'şimdi';
    if (s < 3600)
        return `${Math.floor(s / 60)} dk`;
    return `${Math.floor(s / 3600)} sa`;
}

export default class ClipboardModule extends IslandModule {
    static id = 'clipboard';
    static slot = 'main';

    async init() {
        this._store = this.ctx?.services?.clipboard ?? null;
        this.available = !!this._store;   // history switched off in settings -> no section
        this._unsub = this._store?.onChange(() => this._rebuild());
    }

    buildExpanded() {
        const box = new St.BoxLayout({style_class: 'di-clip', orientation: Clutter.Orientation.VERTICAL});
        const head = new St.BoxLayout({style_class: 'di-clip-head'});
        head.add_child(new St.Label({style_class: 'di-section-title', text: 'PANO GEÇMİŞİ', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        this._clear = new St.Button({style_class: 'di-chip', label: 'Temizle', can_focus: false});
        this._clear.connect('clicked', () => this._store?.clear());
        head.add_child(this._clear);
        box.add_child(head);

        this._scroll = new St.ScrollView({style_class: 'di-clip-scroll', overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this._list = new St.BoxLayout({style_class: 'di-clip-list', orientation: Clutter.Orientation.VERTICAL});
        this._scroll.set_child(this._list);
        box.add_child(this._scroll);
        box.connect('destroy', () => {
            this._list = this._scroll = this._clear = null;
        });
        this._rebuild();
        return box;
    }

    _rebuild() {
        if (!this._list)
            return;
        this._list.destroy_all_children();
        const items = this._store?.items ?? [];
        this._clear.visible = items.length > 0;
        if (!items.length) {
            this._list.add_child(new St.Label({style_class: 'di-notifs-empty', text: 'Kopyaladığın şeyler burada görünür'}));
        }
        for (const item of items)
            this._list.add_child(this._row(item));
        this.ctx?.requestExpandedRelayout?.();
    }

    _row(item) {
        const row = new St.Button({style_class: 'di-clip-row', can_focus: false, x_expand: true});
        const box = new St.BoxLayout({style_class: 'di-clip-row-box', x_expand: true});
        if (item.kind === 'image') {
            const thumb = new St.Icon({style_class: 'di-clip-thumb', gicon: item.thumb, icon_size: 30,
                y_align: Clutter.ActorAlign.CENTER});
            box.add_child(thumb);
        } else {
            box.add_child(new St.Icon({style_class: 'di-clip-kind', icon_name: 'edit-copy-symbolic', icon_size: 14,
                y_align: Clutter.ActorAlign.CENTER}));
        }
        const label = new St.Label({style_class: 'di-clip-text', text: item.preview, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const time = new St.Label({style_class: 'di-clip-time', text: ago(item.at), y_align: Clutter.ActorAlign.CENTER});
        box.add_child(label);
        box.add_child(time);
        row.set_child(box);
        row.connect('clicked', () => {
            this._store?.restore(item);
            this.ctx?.collapse?.();
        });
        return row;
    }

    onShown() {
        this._rebuild();   // refreshes the "2 dk" ages
    }

    destroy() {
        this._unsub?.();
        this._store = null;
        this._list = this._scroll = this._clear = null;
        super.destroy();
    }
}
