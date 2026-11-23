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
import {Timer} from './disposer.js';
import {_, _f} from './i18n.js';
import * as C from './constants.js';

const ORANGE = [217, 119, 87];
const LIGHT = [255, 186, 150];
const WAVE_FRAME_MS = 32;
const MAX_WORKING = 32;   // sessions shown as "working" at once
export const MAX_QUEUED_PERMISSIONS = 8;   // waiting behind the one on screen

export class ClaudeNotifier {
    constructor(island, config = {}) {
        this._island = island;
        this._config = config;
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._working = new Map();   // session -> {project, since}
        this._perm = [];   // queued permission requests [{req, reply, win}]
        this._permShown = null;
        this._nextTimer = new Timer();   // pause before the next queued permission request
        this._bridge = new ClaudeBridge(ev => this._onEvent(ev), (req, reply) => this._onPermission(req, reply));
    }

    _onEvent(ev) {
        const key = ev.session || ev.project;
        if (ev.kind === 'working') {
            // bounded: the session id comes from whoever called the bridge
            if (!this._working.has(key) && this._working.size >= MAX_WORKING) {
                const oldest = [...this._working].sort((a, b) => a[1].since - b[1].since)[0];
                this._working.delete(oldest[0]);
            }
            this._working.set(key, {project: ev.project, since: GLib.get_monotonic_time()});
            this._syncWorking();
            return;
        }
        this._working.delete(key);
        this._syncWorking();
        this._show(ev);
    }

    // ------------------------------------------------------------ permission buttons

    /**
     * Claude Code asks for permission (PermissionRequest hook, waiting on D-Bus).
     * Shown only when the setting is on, you are not already looking at
     * Claude's window and Do Not Disturb is off; otherwise the answer is
     * 'ask' and Claude Code shows its own dialog. Allow / Deny need a mouse
     * click; nothing is ever approved automatically.
     */
    _onPermission(req, reply) {
        // nothing to show = nothing to approve: no blind Allow (the hook already skips these)
        if (!this._island || !this._config?.claudePermissionButtons || !this._notif.get_boolean('show-banners') ||
            !req.summary) {
            reply('ask');
            return;
        }
        const win = this._windowFor({pids: req.pids, project: req.project});
        if (win && win === global.display.focus_window &&
            win.located_on_workspace(global.workspace_manager.get_active_workspace())) {
            reply('ask');
            return;
        }
        // Any process of this user can call the D-Bus method: a flood of
        // requests must not pile up without end. Real Claude sessions rarely
        // wait on more than one or two at once; the rest get Claude Code's dialog.
        if (this._perm.length >= MAX_QUEUED_PERMISSIONS) {
            reply('ask');
            return;
        }
        this._perm.push({req, reply, win});
        this._nextPermission();
    }

    _nextPermission() {
        if (this._permShown || !this._perm.length || !this._island)
            return;
        const item = this._perm.shift();
        this._permShown = item;
        let answered = false;
        const answer = decision => {
            if (answered)
                return;
            answered = true;
            item.reply(decision);
            this._permShown = null;
            this._island?.endActivity('claude-permission');
            // the next waiting request, after the island has settled
            this._nextTimer.schedule(450, () => this._nextPermission());
        };
        item.answer = answer;
        const shown = this._island.showActivity('claude-permission', {
            priority: 3,
            duration: 45000,
            leaveMs: 20000,     // moving the pointer away must not cancel it quickly
            build: () => this._buildPermission(item),
            update: () => {},
            onEnd: () => {
                this._island?.setOutlineEffect(null);
                // closed / timed out / replaced without a click: Claude Code's own dialog decides
                if (!answered)
                    answer('ask');
            },
        }, item);
        if (!shown) {
            answered = true;
            this._permShown = null;
            item.reply('ask');
            this._nextPermission();
            return;
        }
        this._island.setOutlineEffect({color: ORANGE, color2: LIGHT, amp: 2.4, speed: 1.4, wavelength: 28});
    }

    _buildPermission({req, answer}) {
        const box = new St.BoxLayout({style_class: 'di-claude-perm', orientation: Clutter.Orientation.VERTICAL});
        const head = new St.BoxLayout({style_class: 'di-event di-claude-event', y_align: Clutter.ActorAlign.CENTER});
        const badge = new St.Bin({style_class: 'di-claude-badge', y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_size: 18, icon_name: 'dialog-password-symbolic'})});
        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        col.add_child(new St.Label({style_class: 'di-event-title',
            text: _f('Claude wants to use %s', req.tool || _('a tool'))}));
        const sub = new St.Label({style_class: 'di-event-sub', text: req.project});
        sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        col.add_child(sub);
        head.add_child(badge);
        head.add_child(col);
        box.add_child(head);

        if (req.summary) {
            // wrapped, never ellipsized: what you allow must be fully visible
            // (the hook sends at most 120 characters, so this stays a few lines)
            const cmd = new St.Label({style_class: 'di-claude-cmd', text: req.summary});
            cmd.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            cmd.clutter_text.line_wrap = true;
            cmd.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            box.add_child(cmd);
        }
        const row = new St.BoxLayout({style_class: 'di-claude-btnrow'});
        const deny = new St.Button({style_class: 'di-claude-btn di-claude-deny', label: _('Deny'),
            can_focus: false, x_expand: true});
        const allow = new St.Button({style_class: 'di-claude-btn di-claude-allow', label: _('Allow'),
            can_focus: false, x_expand: true});
        deny.connect('clicked', () => answer('deny'));
        allow.connect('clicked', () => answer('allow'));
        row.add_child(deny);
        row.add_child(allow);
        box.add_child(row);
        box.add_child(new St.Label({style_class: 'di-claude-perm-hint',
            text: _('No answer: Claude Code asks as usual')}));
        return box;
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
                pill.ease({opacity: 0, duration: C.FADE_OUT_MS, mode: C.EASE_FADE,
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
            this._pill.ease({opacity: 255, duration: C.FADE_IN_MS, mode: C.EASE_FADE});
        }
        if (this._pillLabel.text !== text) {
            this._pillLabel.text = text;
            this._island.setCompactAccessory(this._pill);   // re-measure the pill width
        }
        // safety net for stale sessions
        this._staleTimer ??= GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 60, () => {
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
        let last = 0, painted = 0;
        // the timeline only advances while the pill is on screen
        this._waveTl = new Clutter.Timeline({actor: this._wave, duration: 60000, repeat_count: -1});
        this._waveTl.connect('new-frame', (_t, ms) => {
            const dt = Math.max(0, Math.min(100, ms - last)) / 1000;
            last = ms > last ? ms : 0;
            this._wavePhase += dt * 2 * Math.PI / 0.9;
            // ~30 fps is plenty for a 22 x 12 px wave; a repaint every frame
            // keeps the compositor busy for as long as Claude works (measured
            // headless: ~3.8x the idle CPU)
            if (ms - painted >= WAVE_FRAME_MS || ms < painted) {
                painted = ms;
                this._wave?.queue_repaint();
            }
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
        this._badge.ease({scale_x: 1, scale_y: 1, duration: C.POP_MS, mode: C.EASE_POP});
    }

    destroy() {
        for (const {reply} of this._perm ?? [])
            reply('ask');
        this._perm = [];
        this._permShown?.answer?.('ask');   // schedules the next request ...
        this._permShown = null;
        this._nextTimer?.clear();           // ... which must not outlive us
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
