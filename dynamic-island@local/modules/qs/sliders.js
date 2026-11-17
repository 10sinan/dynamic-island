// Volume + brightness sliders (GNOME's own Slider widget, island-styled).
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {IslandModule} from '../base.js';

function volumeIcon(frac, muted) {
    if (muted || frac <= 0)
        return 'audio-volume-muted-symbolic';
    if (frac < 0.34)
        return 'audio-volume-low-symbolic';
    if (frac < 0.67)
        return 'audio-volume-medium-symbolic';
    return 'audio-volume-high-symbolic';
}

export default class SlidersModule extends IslandModule {
    static id = 'sliders';
    static slot = 'main';

    async init() {
        this._control = Volume.getMixerControl();
        this._streamIds = [];
        this._controlIds = [
            this._control.connect('default-sink-changed', () => this._bindStream()),
            this._control.connect('state-changed', () => this._bindStream()),
        ];
        this._manager = Main.brightnessManager ?? null;
        this._managerId = this._manager?.connect('changed', () => this._bindScale()) ?? 0;
    }

    _slider(onChange) {
        const slider = new Slider(0);
        slider.add_style_class_name('di-slider');
        slider.x_expand = true;
        slider.y_align = Clutter.ActorAlign.CENTER;
        slider.set_style(`-barlevel-active-background-color: ${this.accent};`);
        slider.connect('notify::value', () => {
            if (!this._syncing)
                onChange(slider.value);
        });
        // Dragging may leave the island's area: keep it open meanwhile.
        slider.connect('drag-begin', () => this.ctx?.holdOpen?.(true));
        slider.connect('drag-end', () => this.ctx?.holdOpen?.(false));
        return slider;
    }

    _row(iconButton, slider, pct) {
        const row = new St.BoxLayout({style_class: 'di-slider-row'});
        row.add_child(iconButton);
        row.add_child(slider);
        row.add_child(pct);
        return row;
    }

    buildExpanded() {
        const box = new St.BoxLayout({style_class: 'di-sliders', orientation: Clutter.Orientation.VERTICAL});

        // volume: icon toggles mute
        this._volIcon = new St.Icon({icon_name: 'audio-volume-high-symbolic', icon_size: 16});
        const mute = new St.Button({style_class: 'di-icon-button', child: this._volIcon, can_focus: false});
        mute.connect('clicked', () => {
            if (this._stream)
                this._stream.change_is_muted(!this._stream.is_muted);
        });
        this._volSlider = this._slider(v => {
            const s = this._stream;
            if (!s)
                return;
            s.volume = v * this._control.get_vol_max_norm();
            if (s.is_muted && v > 0)
                s.change_is_muted(false);
            s.push_volume();
        });
        this._volPct = new St.Label({style_class: 'di-slider-pct', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._row(mute, this._volSlider, this._volPct));

        // brightness (only with a controllable backlight)
        const light = new St.Button({style_class: 'di-icon-button', can_focus: false,
            child: new St.Icon({icon_name: 'display-brightness-symbolic', icon_size: 16})});
        this._lightSlider = this._slider(v => {
            if (this._scale)
                this._scale.value = v;
        });
        this._lightPct = new St.Label({style_class: 'di-slider-pct', y_align: Clutter.ActorAlign.CENTER});
        this._lightRow = this._row(light, this._lightSlider, this._lightPct);
        box.add_child(this._lightRow);

        box.connect('destroy', () => {
            this._volSlider = this._lightSlider = null;
        });
        this._bindStream();
        this._bindScale();
        return box;
    }

    _bindStream() {
        if (this._stream) {
            for (const id of this._streamIds)
                this._stream.disconnect(id);
        }
        this._streamIds = [];
        this._stream = this._control?.get_default_sink() ?? null;
        if (this._stream) {
            this._streamIds = ['notify::volume', 'notify::is-muted']
                .map(sig => this._stream.connect(sig, () => this._syncVolume()));
        }
        this._syncVolume();
    }

    _syncVolume() {
        if (!this._volSlider)
            return;
        const s = this._stream;
        const frac = s ? Math.min(1, s.volume / this._control.get_vol_max_norm()) : 0;
        const muted = !s || s.is_muted;
        this._syncing = true;
        this._volSlider.value = muted ? 0 : frac;
        this._syncing = false;
        this._volIcon.icon_name = volumeIcon(frac, muted);
        this._volPct.text = s ? (muted ? 'sessiz' : `${Math.round(frac * 100)}%`) : '–';
    }

    _bindScale() {
        if (this._scale && this._scaleId)
            this._scale.disconnect(this._scaleId);
        this._scale = this._manager?.globalScale ?? null;
        this._scaleId = this._scale?.connect('notify::value', () => this._syncLight()) ?? 0;
        this._syncLight();
    }

    _syncLight() {
        if (!this._lightSlider)
            return;
        this._lightRow.visible = !!this._scale;
        if (!this._scale)
            return;
        this._syncing = true;
        this._lightSlider.value = this._scale.value;
        this._syncing = false;
        this._lightPct.text = `${Math.round(this._scale.value * 100)}%`;
    }

    destroy() {
        if (this._stream) {
            for (const id of this._streamIds)
                this._stream.disconnect(id);
        }
        for (const id of this._controlIds ?? [])
            this._control.disconnect(id);
        if (this._scale && this._scaleId)
            this._scale.disconnect(this._scaleId);
        if (this._manager && this._managerId)
            this._manager.disconnect(this._managerId);
        this._stream = this._control = this._scale = this._manager = null;
        this._volSlider = this._lightSlider = null;
        super.destroy();
    }
}
