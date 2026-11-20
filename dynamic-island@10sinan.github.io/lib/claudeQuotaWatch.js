// Warns once when a Claude plan window (5-hour / weekly) passes 80 % and 95 %.
// Runs in the background while `claude-real-usage` is on: every 5 minutes one
// request to Anthropic (see lib/claudeFetch.js). Shown as a notification in
// the centre island with the wavy orange outline; not during Do Not Disturb.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {crossedThresholds, untilReset} from './claudeQuota.js';
import {fetchQuota} from './claudeFetch.js';
import {_, _f, pct} from './i18n.js';

const EVERY_S = 300;
const ORANGE = [217, 119, 87];
const LIGHT = [255, 186, 150];
const RED = [255, 99, 84];

export class ClaudeQuotaWatch {
    constructor(island) {
        this._island = island;
        this._cancellable = new Gio.Cancellable();
        this._holder = {soup: null};
        this._state = new Map();
        this._first = true;
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 20, () => {
            this._poll();   // first reading shortly after login, then regularly
            this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, EVERY_S, () => {
                this._poll();
                return GLib.SOURCE_CONTINUE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    async _poll() {
        if (this._busy || !this._island)
            return;
        this._busy = true;
        try {
            const r = await fetchQuota(this._holder, this._cancellable);
            if (!r.rows || !this._island)
                return;
            this.rows = r.rows;
            const crossed = crossedThresholds(r.rows, this._state, this._first);
            this._first = false;
            // highest level first; one pop-up per poll is enough
            crossed.sort((a, b) => b.level - a.level);
            if (crossed.length)
                this.show(crossed[0].row, crossed[0].level, r.rows);
        } finally {
            this._busy = false;
        }
    }

    /** Public so tests (and the settings) can trigger the same pop-up. */
    show(row, level, rows = []) {
        if (!this._island || !this._notif.get_boolean('show-banners'))
            return false;
        const name = row.kind === 'session' ? _('5-hour limit') : _('Weekly limit');
        const u = untilReset(row.resetsAt, Date.now());
        const left = !u ? '' : u.unit === 'min' ? _f('%s min', u.value)
            : u.unit === 'h' ? _f('%s h', u.value.toFixed(1).replace('.', _('.')))
                : _f('%s d', u.value.toFixed(1).replace('.', _('.')));
        const other = rows.find(r => r.kind !== row.kind && r.kind !== 'weekly-model');
        const view = {
            title: `Claude · ${name} ${pct(Math.round(row.percent))}`,
            sub: [left ? _f('resets in %s', left) : '', other
                ? `${other.kind === 'session' ? _('5-hour') : _('Weekly')} ${pct(Math.round(other.percent))}` : '']
                .filter(Boolean).join(' · '),
            level,
        };
        const shown = this._island.showActivity('claude-quota', {
            priority: 2,
            duration: 7000,
            build: () => this._build(),
            update: v => this._update(v),
            onEnd: () => this._island?.setOutlineEffect(null),
        }, view);
        if (shown) {
            this._island.setOutlineEffect({color: level >= 95 ? RED : ORANGE, color2: level >= 95 ? ORANGE : LIGHT,
                amp: level >= 95 ? 2.2 : 1.5, speed: level >= 95 ? 1.4 : 0.9, wavelength: 32});
        }
        return shown;
    }

    _build() {
        const box = new St.BoxLayout({style_class: 'di-event di-claude-event', y_align: Clutter.ActorAlign.CENTER});
        this._badge = new St.Bin({style_class: 'di-claude-badge', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Label({style_class: 'di-claude-badge-text', text: '%',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER})});
        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this._title = new St.Label({style_class: 'di-event-title'});
        this._sub = new St.Label({style_class: 'di-event-sub'});
        this._sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        col.add_child(this._title);
        col.add_child(this._sub);
        box.add_child(this._badge);
        box.add_child(col);
        box.connect('destroy', () => {
            this._badge = this._title = this._sub = null;
        });
        return box;
    }

    _update(v) {
        if (!this._title)
            return;
        this._title.text = v.title;
        this._sub.text = v.sub;
        this._badge.set_style(v.level >= 95 ? 'background-color: #ff6354;' : null);
    }

    destroy() {
        this._cancellable?.cancel();
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._holder?.soup?.abort();
        this._holder = null;
        if (this._island?.activityKey === 'claude-quota')
            this._island.endActivity('claude-quota');
        this._island?.setOutlineEffect(null);
        this._island = null;
        this._notif = null;
    }
}
