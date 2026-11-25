// Volume + brightness sliders (GNOME's own Slider widget, island-styled).
// The volume row has a chevron that opens a drawer in place with the sound
// output chooser and the per-app volumes (audio.js / mixer.js sections).
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {IslandModule} from '../base.js';
import {_} from '../../lib/i18n.js';
import AudioSection from './audio.js';
import MixerSection from './mixer.js';

const DRAWER_IN_MS = 260;
const DRAWER_OUT_MS = 130;

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
        this._audio = new AudioSection(this.ctx, () => this._drawerChanged());
        this._mixer = new MixerSection(this.ctx, () => this._drawerChanged());
        await Promise.all([this._audio.init(), this._mixer.init()]);
        this._open = false;
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
        const volRow = this._row(mute, this._volSlider, this._volPct);
        this._chev = new St.Button({style_class: 'di-icon-button di-drawer-toggle', can_focus: false, visible: false,
            accessible_name: _('Sound output and app volume'),
            child: new St.Icon({icon_name: 'pan-end-symbolic', icon_size: 14})});
        this._chev.set_pivot_point(0.5, 0.5);
        this._chev.connect('clicked', () => this._toggleDrawer());
        volRow.add_child(this._chev);
        box.add_child(volRow);

        // drawer: output chooser + per-app volumes, closed until the chevron is used
        this._drawer = new St.BoxLayout({style_class: 'di-drawer', orientation: Clutter.Orientation.VERTICAL,
            visible: false});
        this._drawer.add_child(this._audio.build());
        this._drawer.add_child(this._mixer.build());
        box.add_child(this._drawer);

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
            this._volSlider = this._lightSlider = this._chev = this._drawer = null;
            this._open = false;
        });
        this._bindStream();
        this._bindScale();
        this._drawerChanged();
        return box;
    }

    // ------------------------------------------------------------ drawer

    /** A section appeared / disappeared / changed size. */
    _drawerChanged() {
        if (!this._drawer)
            return;
        const has = this._audio.hasContent || this._mixer.hasContent;
        this._chev.visible = has;
        if (!has && this._open)
            this._setDrawer(false, false);
        else if (this._open)
            this.ctx?.requestExpandedRelayout?.();
    }

    _toggleDrawer() {
        this._setDrawer(!this._open, true);
    }

    /**
     * The drawer takes its full size at once so the island's spring morph
     * measures the final layout; its content fades and rises in (and fades
     * out before the island shrinks).
     */
    _setDrawer(open, animate) {
        const d = this._drawer;
        if (!d || open === this._open)
            return;
        this._open = open;
        d.remove_all_transitions();
        this._chev?.ease({
            rotation_angle_z: open ? 90 : 0,
            duration: animate ? 200 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        if (open) {
            d.set({visible: true, opacity: animate ? 0 : 255, translation_y: animate ? -8 : 0});
            this.ctx?.requestExpandedRelayout?.();
            if (animate) {
                d.ease({opacity: 255, translation_y: 0, delay: 60, duration: DRAWER_IN_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            }
            return;
        }
        const done = () => {
            if (!this._drawer || this._open)
                return;
            this._drawer.hide();
            this.ctx?.requestExpandedRelayout?.();
        };
        if (!animate) {
            d.opacity = 255;
            done();
            return;
        }
        d.ease({opacity: 0, translation_y: -6, duration: DRAWER_OUT_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: done});
    }

    onShown() {
        this._audio?.onShown();
    }

    /** Back to the calm view whenever the island closes. */
    onHidden() {
        this._setDrawer(false, false);
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
        this._volPct.text = s ? (muted ? _('muted') : `${Math.round(frac * 100)}%`) : '–';
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
        this._audio?.destroy();
        this._mixer?.destroy();
        this._audio = this._mixer = null;
        this._stream = this._control = this._scale = this._manager = null;
        this._volSlider = this._lightSlider = this._chev = this._drawer = null;
        super.destroy();
    }
}
