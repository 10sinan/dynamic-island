// Sound output chooser: speakers / headphones / Bluetooth / HDMI, one click.
// Shown only when there is more than one output to choose from.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {IslandModule} from '../base.js';
import {_} from '../../lib/i18n.js';

const MAX_ROWS = 5;

export default class AudioOutputModule extends IslandModule {
    static id = 'audio';
    static slot = 'main';

    async init() {
        this._control = Volume.getMixerControl();
        this._devices = new Map();   // id -> Gvc.MixerUIDevice
        this._active = null;
        this._ids = [
            this._control.connect('output-added', (_c, id) => this._add(id)),
            this._control.connect('output-removed', (_c, id) => {
                this._devices.delete(id);
                this._render();
            }),
            this._control.connect('active-output-update', (_c, id) => {
                this._active = id;
                this._render();
            }),
            this._control.connect('default-sink-changed', () => {
                this._syncActive();
                this._render();
            }),
        ];
        // devices that exist before we connected
        for (let id = 0; id < 64; id++)
            this._add(id, false);
        this._syncActive();
    }

    _add(id, render = true) {
        const dev = this._control?.lookup_output_id(id);
        if (!dev || !dev.is_output?.())
            return;
        this._devices.set(id, dev);
        if (render)
            this._render();
    }

    _syncActive() {
        const sink = this._control?.get_default_sink();
        const dev = sink ? this._control.lookup_device_from_stream(sink) : null;
        if (dev)
            this._active = dev.get_id();
    }

    buildExpanded() {
        const box = new St.BoxLayout({style_class: 'di-audio', orientation: Clutter.Orientation.VERTICAL});
        box.add_child(new St.Label({style_class: 'di-section-title', text: _('SOUND OUTPUT')}));
        this._list = new St.BoxLayout({style_class: 'di-audio-list', orientation: Clutter.Orientation.VERTICAL});
        box.add_child(this._list);
        this._box = box;
        box.connect('destroy', () => {
            this._box = this._list = null;
        });
        this._render();
        return box;
    }

    _visibleDevices() {
        // a jack with nothing plugged in reports port-available = false
        return [...this._devices.values()].filter(d => d.port_available !== false);
    }

    _render() {
        if (!this._list)
            return;
        const devs = this._visibleDevices();
        const sig = devs.map(d => `${d.get_id()}:${d.description}`).join('|') + `#${this._active}`;
        if (sig === this._sig)
            return;
        this._sig = sig;
        this._list.destroy_all_children();
        this._box.visible = devs.length > 1;
        for (const dev of devs.slice(0, MAX_ROWS))
            this._list.add_child(this._row(dev));
        this.ctx?.requestExpandedRelayout?.();
    }

    _row(dev) {
        const active = dev.get_id() === this._active;
        const box = new St.BoxLayout({style_class: 'di-page-row-box', x_expand: true});
        const bubble = new St.Bin({style_class: 'di-page-bubble', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: dev.icon_name || 'audio-speakers-symbolic', icon_size: 15})});
        if (active)
            bubble.set_style(`background-color: ${this.accent}; color: #0b0b0b;`);
        box.add_child(bubble);
        const name = new St.Label({style_class: 'di-page-row-name', text: dev.description ?? '', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(name);
        if (active) {
            box.add_child(new St.Icon({style_class: 'di-page-row-trailing', icon_name: 'object-select-symbolic',
                icon_size: 13, y_align: Clutter.ActorAlign.CENTER}));
        }
        const row = new St.Button({style_class: active ? 'di-audio-row di-audio-row-active' : 'di-audio-row',
            child: box, x_expand: true, can_focus: false});
        row.connect('clicked', () => {
            if (dev.get_id() !== this._active)
                this._control?.change_output(dev);
        });
        return row;
    }

    onShown() {
        this._syncActive();
        this._sig = null;
        this._render();
    }

    destroy() {
        for (const id of this._ids ?? [])
            this._control?.disconnect(id);
        this._ids = [];
        this._devices?.clear();
        this._control = this._box = this._list = null;
        super.destroy();
    }
}
