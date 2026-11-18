// Claude Code notifications in the centre island: when Claude finishes or
// waits for you (permission / input), the island grows like a notification
// preview with a wavy orange outline. Not shown while Claude's own window
// (VS Code / terminal) is focused, or while Do Not Disturb is on.
// Colour only: no Claude logo is drawn.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClaudeBridge} from './claudeBridge.js';
import {_, _f} from './i18n.js';

const ORANGE = [217, 119, 87];
const LIGHT = [255, 186, 150];

export class ClaudeNotifier {
    constructor(island) {
        this._island = island;
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._bridge = new ClaudeBridge(ev => this._show(ev));
    }

    /** The window Claude runs in: one whose process is an ancestor of the hook. */
    _windowFor(ev) {
        const pids = new Set(ev.pids);
        if (!pids.size)
            return null;
        const wins = global.display.list_all_windows().filter(w => pids.has(w.get_pid()));
        if (wins.length <= 1)
            return wins[0] ?? null;
        const p = ev.project.toLowerCase();
        return wins.find(w => (w.get_title() ?? '').toLowerCase().includes(p)) ?? wins[0];
    }

    _show(ev) {
        if (!this._island)
            return;
        if (!this._notif.get_boolean('show-banners'))
            return;   // Do Not Disturb (also during meeting mode)
        const win = this._windowFor(ev);
        if (win && win === global.display.focus_window && win.located_on_workspace(global.workspace_manager.get_active_workspace()))
            return;   // you are already looking at Claude
        const permission = /permission/i.test(ev.message);
        const view = {
            kind: ev.kind,
            title: ev.kind === 'done' ? _('Claude is done')
                : permission ? _('Claude needs permission') : _('Claude is waiting for you'),
            sub: [ev.project, this._translate(ev.message)].filter(Boolean).join(' · '),
        };
        const shown = this._island.showActivity('claude', {
            priority: 2,
            duration: ev.kind === 'done' ? 6000 : 15000,
            build: () => this._build(),
            update: v => this._update(v),
            onClick: () => {
                if (win && !win.is_override_redirect?.())
                    Main.activateWindow(win);
            },
            onEnd: () => this._island?.setOutlineEffect(null),
        }, view);
        if (shown) {
            this._island.setOutlineEffect(ev.kind === 'done'
                ? {color: ORANGE, color2: LIGHT, amp: 1.3, speed: 0.8, wavelength: 36}
                : {color: ORANGE, color2: LIGHT, amp: 1.9, speed: 1.4, wavelength: 30});
        }
    }

    /** Claude Code's messages are English; the usual ones get a translation. */
    _translate(msg) {
        let m = /needs your permission to use (.+)$/i.exec(msg);
        if (m)
            return _f('wants to use %s', m[1]);
        if (/waiting for your input/i.test(msg))
            return _('waiting for your reply');
        return msg;
    }

    _build() {
        const box = new St.BoxLayout({style_class: 'di-event di-claude-event', y_align: Clutter.ActorAlign.CENTER});
        this._badge = new St.Bin({style_class: 'di-claude-badge', y_align: Clutter.ActorAlign.CENTER});
        this._icon = new St.Icon({icon_size: 18, icon_name: 'utilities-terminal-symbolic'});
        this._badge.set_child(this._icon);
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
            this._badge = this._icon = this._title = this._sub = null;
        });
        return box;
    }

    _update(v) {
        if (!this._title)
            return;
        this._title.text = v.title;
        this._sub.text = v.sub;
        this._icon.icon_name = v.kind === 'done' ? 'object-select-symbolic' : 'utilities-terminal-symbolic';
        // a little pop on the badge every time a new event arrives
        this._badge.set_pivot_point(0.5, 0.5);
        this._badge.set_scale(0.6, 0.6);
        this._badge.ease({scale_x: 1, scale_y: 1, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_BACK});
    }

    destroy() {
        this._bridge?.destroy();
        this._bridge = null;
        if (this._island?.activityKey === 'claude')
            this._island.endActivity('claude');
        this._island?.setOutlineEffect(null);
        this._island = null;
        this._notif = null;
    }
}
