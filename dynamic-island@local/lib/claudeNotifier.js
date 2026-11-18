// Claude Code notifications in the centre island: when Claude finishes or
// waits for you (permission / input), the island grows like a notification
// preview with a wavy orange outline. Not shown while Claude's own window
// (VS Code / terminal) is focused, or while Do Not Disturb is on.
// Colour only: no Claude logo is drawn.
import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
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
        this._working = new Map();   // session -> {project, since}
        this._bridge = new ClaudeBridge(ev => this._onEvent(ev));
    }

    _onEvent(ev) {
        const key = ev.session || ev.project;
        if (ev.kind === 'working') {
            this._working.set(key, {project: ev.project, since: GLib.get_monotonic_time()});
            this._syncWorking();
            return;
        }
        this._working.delete(key);
        this._syncWorking();
        this._show(ev);
    }

    // ------------------------------------------------------------ "Claude is working" in the pill

    _syncWorking() {
        // a session that never reported back (closed terminal) is dropped after 30 min
        const now = GLib.get_monotonic_time();
        for (const [k, v] of this._working) {
            if (now - v.since > 30 * 60 * 1e6)
                this._working.delete(k);
        }
        if (!this._island)
            return;
        if (!this._working.size) {
            if (this._pill) {
                const pill = this._pill;
                this._pill = null;
                this._stopWave();
                pill.ease({opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => this._island?.setCompactAccessory(null)});
            }
            return;
        }
        const latest = [...this._working.values()].sort((a, b) => b.since - a.since)[0];
        const text = this._working.size > 1 ? `${latest.project} +${this._working.size - 1}` : latest.project;
        if (!this._pill) {
            this._pill = this._buildPill();
            this._pill.opacity = 0;
            this._island.setCompactAccessory(this._pill);
            this._pill.ease({opacity: 255, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        if (this._pillLabel.text !== text) {
            this._pillLabel.text = text;
            this._island.setCompactAccessory(this._pill);   // re-measure the pill width
        }
        // safety net for stale sessions
        this._staleTimer ||= GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
            this._staleTimer = 0;
            this._syncWorking();
            return GLib.SOURCE_REMOVE;
        });
    }

    _buildPill() {
        const box = new St.BoxLayout({style_class: 'di-claude-working', y_align: Clutter.ActorAlign.CENTER});
        this._wave = new St.DrawingArea({style_class: 'di-claude-wave', width: 22, height: 12,
            y_align: Clutter.ActorAlign.CENTER});
        this._wavePhase = 0;
        this._wave.connect('repaint', () => this._paintWave());
        this._pillLabel = new St.Label({style_class: 'di-claude-working-label', y_align: Clutter.ActorAlign.CENTER});
        this._pillLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._wave);
        box.add_child(this._pillLabel);
        let last = 0;
        // the timeline only advances while the pill is on screen
        this._waveTl = new Clutter.Timeline({actor: this._wave, duration: 60000, repeat_count: -1});
        this._waveTl.connect('new-frame', (_t, ms) => {
            const dt = Math.max(0, Math.min(100, ms - last)) / 1000;
            last = ms > last ? ms : 0;
            this._wavePhase += dt * 2 * Math.PI / 0.9;
            this._wave?.queue_repaint();
        });
        this._waveTl.start();
        box.connect('destroy', () => {
            this._stopWave();
            this._wave = this._pillLabel = null;
        });
        return box;
    }

    _stopWave() {
        this._waveTl?.stop();
        this._waveTl = null;
    }

    /** A small travelling sine wave in Claude orange (original drawing). */
    _paintWave() {
        const cr = this._wave.get_context();
        try {
            const [w, h] = this._wave.get_surface_size();
            const mid = h / 2, amp = h * 0.32;
            cr.setLineWidth(1.8);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            const g = new Cairo.LinearGradient(0, 0, w, 0);
            g.addColorStopRGBA(0, ORANGE[0] / 255, ORANGE[1] / 255, ORANGE[2] / 255, 0.35);
            g.addColorStopRGBA(0.5, LIGHT[0] / 255, LIGHT[1] / 255, LIGHT[2] / 255, 1);
            g.addColorStopRGBA(1, ORANGE[0] / 255, ORANGE[1] / 255, ORANGE[2] / 255, 0.35);
            cr.setSource(g);
            for (let x = 1; x <= w - 1; x += 0.5) {
                const y = mid + amp * Math.sin(x / w * 2.2 * Math.PI * 2 - this._wavePhase);
                if (x === 1)
                    cr.moveTo(x, y);
                else
                    cr.lineTo(x, y);
            }
            cr.stroke();
        } finally {
            cr.$dispose();
        }
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
        if (this._staleTimer) {
            GLib.source_remove(this._staleTimer);
            this._staleTimer = 0;
        }
        this._working?.clear();
        this._stopWave();
        if (this._pill)
            this._island?.setCompactAccessory(null);
        this._pill = null;
        this._bridge?.destroy();
        this._bridge = null;
        if (this._island?.activityKey === 'claude')
            this._island.endActivity('claude');
        this._island?.setOutlineEffect(null);
        this._island = null;
        this._notif = null;
    }
}
