// Per-app volume: one slider for every app that is playing sound right now
// (browser, Spotify, Discord...). Hidden when no app plays anything.
import Clutter from 'gi://Clutter';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {IslandModule} from '../base.js';
import {_} from '../../lib/i18n.js';

const MAX_ROWS = 5;

export default class MixerModule extends IslandModule {
    static id = 'mixer';
    static slot = 'main';

    async init() {
        this._control = Volume.getMixerControl();
        this._rows = new Map();   // stream id -> {row, slider, pct, icon, ids, stream}
        this._ids = [
            this._control.connect('stream-added', (_c, id) => this._add(id)),
            this._control.connect('stream-removed', (_c, id) => this._remove(id)),
        ];
    }

    _isApp(stream) {
        return stream instanceof Gvc.MixerSinkInput && !stream.is_event_stream &&
            stream.get_application_id?.() !== 'org.gnome.Shell';
    }

    buildExpanded() {
        const box = new St.BoxLayout({style_class: 'di-audio di-mixer', orientation: Clutter.Orientation.VERTICAL,
            visible: false});
        box.add_child(new St.Label({style_class: 'di-section-title', text: _('APP VOLUME')}));
        this._list = new St.BoxLayout({style_class: 'di-audio-list', orientation: Clutter.Orientation.VERTICAL});
        box.add_child(this._list);
        this._box = box;
        box.connect('destroy', () => {
            for (const id of [...this._rows.keys()])
                this._dropRow(id);
            this._box = this._list = null;
        });
        for (const s of this._control.get_sink_inputs?.() ?? [])
            this._add(s.id);
        this._sync();
        return box;
    }

    _appFor(stream) {
        const id = stream.get_application_id?.();
        const sys = Shell.AppSystem.get_default();
        return (id && (sys.lookup_app(`${id}.desktop`) ?? sys.lookup_app(id))) ?? null;
    }

    _add(id) {
        if (!this._list || this._rows.has(id) || this._rows.size >= MAX_ROWS)
            return;
        const stream = this._control.lookup_stream_id(id);
        if (!stream || !this._isApp(stream))
            return;
        const app = this._appFor(stream);
        const icon = app?.create_icon_texture(20) ??
            new St.Icon({icon_name: stream.icon_name || 'application-x-executable-symbolic', icon_size: 20});
        const mute = new St.Button({style_class: 'di-mixer-icon', can_focus: false, child: icon,
            y_align: Clutter.ActorAlign.CENTER});
        mute.connect('clicked', () => stream.change_is_muted(!stream.is_muted));

        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        const name = new St.Label({style_class: 'di-mixer-name', text: app?.get_name() ?? stream.name ?? ''});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const slider = new Slider(0);
        slider.add_style_class_name('di-slider');
        slider.x_expand = true;
        slider.set_style(`-barlevel-active-background-color: ${this.accent};`);
        slider.connect('drag-begin', () => this.ctx?.holdOpen?.(true));
        slider.connect('drag-end', () => this.ctx?.holdOpen?.(false));
        col.add_child(name);
        col.add_child(slider);
        const pct = new St.Label({style_class: 'di-slider-pct', y_align: Clutter.ActorAlign.CENTER});

        const row = new St.BoxLayout({style_class: 'di-mixer-row'});
        row.add_child(mute);
        row.add_child(col);
        row.add_child(pct);
        this._list.add_child(row);

        const entry = {row, slider, pct, icon: mute, stream, syncing: false, ids: []};
        slider.connect('notify::value', () => {
            if (entry.syncing)
                return;
            stream.volume = slider.value * this._control.get_vol_max_norm();
            if (stream.is_muted && slider.value > 0)
                stream.change_is_muted(false);
            stream.push_volume();
            this._paint(entry);
        });
        entry.ids = ['notify::volume', 'notify::is-muted'].map(sig => stream.connect(sig, () => this._paint(entry)));
        this._rows.set(id, entry);
        this._paint(entry);
        row.set({opacity: 0, translation_y: 6});
        row.ease({opacity: 255, translation_y: 0, duration: 240, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._sync();
    }

    _paint(e) {
        const frac = Math.min(1, e.stream.volume / this._control.get_vol_max_norm());
        e.syncing = true;
        e.slider.value = e.stream.is_muted ? 0 : frac;
        e.syncing = false;
        e.pct.text = e.stream.is_muted ? _('muted') : `${Math.round(frac * 100)}%`;
        e.icon.opacity = e.stream.is_muted ? 110 : 255;
    }

    _dropRow(id) {
        const e = this._rows.get(id);
        if (!e)
            return;
        for (const sid of e.ids) {
            try {
                e.stream.disconnect(sid);
            } catch {}
        }
        this._rows.delete(id);
        return e;
    }

    _remove(id) {
        const e = this._dropRow(id);
        e?.row.destroy();
        this._sync();
    }

    _sync() {
        if (!this._box)
            return;
        this._box.visible = this._rows.size > 0;
        this.ctx?.requestExpandedRelayout?.();
    }

    destroy() {
        for (const id of [...(this._rows?.keys() ?? [])])
            this._dropRow(id);
        for (const id of this._ids ?? [])
            this._control?.disconnect(id);
        this._ids = [];
        this._control = this._box = this._list = null;
        super.destroy();
    }
}
