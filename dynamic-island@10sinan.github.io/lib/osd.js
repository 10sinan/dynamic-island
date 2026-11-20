// Volume / brightness OSD inside the centre island instead of GNOME's
// on-screen box. The shell's OsdWindowManager instance methods are wrapped;
// anything we don't handle (Caps Lock, keyboard layout, island hidden in
// fullscreen, ...) falls through to the original GNOME OSD.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as C from './constants.js';
import {LevelBar} from './widgets.js';

const HANDLED = /^(audio-volume|audio-input|microphone|display-brightness|keyboard-brightness)/;

function iconName(icon) {
    if (icon instanceof Gio.ThemedIcon)
        return icon.get_names()[0] ?? '';
    return '';
}

export class OsdRouter {
    constructor(island, config) {
        this._island = island;
        this._accent = config.accent;
        this._mgr = Main.osdWindowManager;
        this._patched = [];
        if (!this._mgr)
            return;

        const wrap = (name, pick) => {
            const orig = this._mgr[name];
            const hadOwn = Object.prototype.hasOwnProperty.call(this._mgr, name);
            this._mgr[name] = (...args) => {
                const {icon, label, level, maxLevel} = pick(...args);
                if (this._handle(icon, label, level, maxLevel))
                    return undefined;
                return orig.apply(this._mgr, args);
            };
            this._patched.push({name, orig, hadOwn});
        };
        wrap('show', (icon, label, levels) => {
            const primary = Main.layoutManager.primaryIndex;
            const lv = levels?.[primary] ?? Object.values(levels ?? {})[0] ?? null;
            return {icon, label, level: lv?.level, maxLevel: lv?.maxLevel};
        });
        wrap('showAll', (icon, label, level, maxLevel) => ({icon, label, level, maxLevel}));
        wrap('showOne', (_monitor, icon, label, level, maxLevel) => ({icon, label, level, maxLevel}));
    }

    _handle(icon, label, level, maxLevel) {
        if (level === null || level === undefined || !HANDLED.test(iconName(icon)))
            return false;
        const max = maxLevel > 0 ? maxLevel : 1;
        return this._island.showActivity('osd', {
            priority: 2,
            duration: C.OSD_DURATION_MS,
            build: () => this._build(),
            update: d => this._update(d),
        }, {icon, label, level, max});
    }

    _build() {
        const box = new St.BoxLayout({style_class: 'di-osd', y_align: Clutter.ActorAlign.CENTER});
        this._icon = new St.Icon({style_class: 'di-osd-icon', icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER});
        this._bar = new LevelBar(C.BAR_W_OSD, {accent: this._accent, animMs: 120, height: 6});
        this._pct = new St.Label({style_class: 'di-osd-value', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._bar.actor);
        box.add_child(this._pct);
        box.connect('destroy', () => {
            this._icon = this._bar = this._pct = null;
        });
        return box;
    }

    _update({icon, level, max}) {
        if (!this._bar)
            return;
        this._icon.gicon = icon;
        // Over-amplified volume (max 1.5) shows up to 150 %, bar relative to max.
        this._bar.set(level / max, level > 1 ? 'warn' : 'ok');
        const text = `${Math.round(level * 100)}%`;
        if (this._pct.text !== text)
            this._pct.text = text;
    }

    destroy() {
        for (const {name, orig, hadOwn} of this._patched.reverse()) {
            if (hadOwn)
                this._mgr[name] = orig;
            else
                delete this._mgr[name];   // back to the prototype method
        }
        this._patched = [];
        this._island = null;
        this._mgr = null;
    }
}
