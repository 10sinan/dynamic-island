// Claude Code usage tile for the centre island: tokens used in the current
// 5-hour session and when it resets. Estimated from the local session logs
// (nothing is sent anywhere, no credentials are read). With a limit set in the
// settings it shows how much is left.
import Cairo from 'gi://cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {IslandModule} from './base.js';
import {_, _f} from '../lib/i18n.js';
import {WINDOW_MS, addEntry, formatTokens, parseLine, splitDuration, windowStats} from '../lib/claudeUsage.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');

const RESCAN_S = 15;
// Claude's warm terracotta orange (colour only; no logo is drawn)
const ORANGE = {r: 217, g: 119, b: 87};
const RED = {r: 255, g: 99, b: 84};
const MAX_DEPTH = 4;
const CHUNK = 1 << 20;

export default class ClaudeUsageModule extends IslandModule {
    static id = 'claude';

    async init() {
        this._root = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.claude', 'projects']));
        if (!this._root.query_exists(null)) {
            this.available = false;
            return;
        }
        this._entries = new Map();     // message id -> counters
        this._files = new Map();       // path -> bytes already read (up to the last full line)
        this._lastScan = 0;
        this._scanning = false;
    }

    buildExpanded() {
        const card = new St.BoxLayout({style_class: 'di-claude', x_expand: true});

        // ring: how much of the session is left (or of the limit, when one is set)
        this._ringFrac = 0;
        this._ringColor = ORANGE;
        this._ring = new St.DrawingArea({style_class: 'di-claude-ring', width: 54, height: 54,
            y_align: Clutter.ActorAlign.CENTER});
        this._ring.connect('repaint', () => this._paintRing());
        this._ringText = new St.Label({style_class: 'di-claude-ring-text', text: '—',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const ringBox = new St.Widget({layout_manager: new Clutter.BinLayout(), y_align: Clutter.ActorAlign.CENTER});
        ringBox.add_child(this._ring);
        ringBox.add_child(this._ringText);
        card.add_child(ringBox);

        const col = new St.BoxLayout({style_class: 'di-claude-col', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const top = new St.BoxLayout();
        top.add_child(new St.Label({style_class: 'di-claude-title', text: 'CLAUDE', x_expand: true}));
        this._today = new St.Label({style_class: 'di-claude-today', text: ''});
        top.add_child(this._today);
        const mid = new St.BoxLayout({style_class: 'di-claude-mid'});
        this._value = new St.Label({style_class: 'di-claude-value', text: '—', y_align: Clutter.ActorAlign.END});
        this._unit = new St.Label({style_class: 'di-claude-unit', text: '', y_align: Clutter.ActorAlign.END});
        mid.add_child(this._value);
        mid.add_child(this._unit);

        // 5-hour timeline: elapsed part of the session, reset time at the end
        this._track = new St.Widget({style_class: 'di-claude-track', x_expand: true, height: 4,
            y_align: Clutter.ActorAlign.CENTER});
        this._fill = new St.Widget({style_class: 'di-claude-fill', height: 4, scale_x: 0});
        this._fill.set_pivot_point(0, 0.5);
        this._track.add_child(this._fill);
        this._track.connect('notify::width', () => this._fill?.set_width(this._track.width));
        const foot = new St.BoxLayout({style_class: 'di-claude-foot'});
        this._sub = new St.Label({style_class: 'di-claude-sub', text: '', x_expand: true});
        this._sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        foot.add_child(this._sub);

        col.add_child(top);
        col.add_child(mid);
        col.add_child(this._track);
        col.add_child(foot);
        card.add_child(col);

        card.connect('destroy', () => {
            this._ringTl?.stop();
            this._ringTl = null;
            this._ring = this._ringText = this._value = this._unit = this._today = null;
            this._track = this._fill = this._sub = null;
        });
        this._card = card;
        this._shown = null;
        this._render();
        return card;
    }

    _paintRing() {
        const cr = this._ring.get_context();
        try {
            const [w] = this._ring.get_surface_size();
            const c = w / 2, r = w / 2 - 4;
            const TAU = Math.PI * 2;
            cr.setLineWidth(5);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setSourceRGBA(1, 1, 1, 0.10);
            cr.arc(c, c, r, 0, TAU);
            cr.stroke();
            const f = Math.max(0, Math.min(1, this._ringFrac));
            if (f > 0.004) {
                const {r: cr_, g, b} = this._ringColor;
                cr.setSourceRGBA(cr_ / 255, g / 255, b / 255, 1);
                cr.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + TAU * f);
                cr.stroke();
            }
        } finally {
            cr.$dispose();
        }
    }

    /** Glide the ring to a new fraction/colour (no jumpy redraws). */
    _setRing(frac, color) {
        const from = this._ringFrac, fromC = this._ringColor;
        this._ringTl?.stop();
        if (Math.abs(from - frac) < 0.002 && fromC.r === color.r && fromC.g === color.g && fromC.b === color.b)
            return;
        if (!this._ring?.mapped) {
            this._ringFrac = frac;
            this._ringColor = color;
            this._ring?.queue_repaint();
            return;
        }
        const tl = new Clutter.Timeline({actor: this._ring, duration: 600});
        tl.set_progress_mode(Clutter.AnimationMode.EASE_OUT_CUBIC);
        tl.connect('new-frame', () => {
            const p = tl.get_progress();
            this._ringFrac = from + (frac - from) * p;
            this._ringColor = {
                r: Math.round(fromC.r + (color.r - fromC.r) * p),
                g: Math.round(fromC.g + (color.g - fromC.g) * p),
                b: Math.round(fromC.b + (color.b - fromC.b) * p),
            };
            this._ring?.queue_repaint();
        });
        tl.connect('completed', () => {
            this._ringFrac = frac;
            this._ringColor = color;
            this._ring?.queue_repaint();
        });
        this._ringTl = tl;
        tl.start();
    }

    onShown() {
        this._lastScan = 0;   // refresh as soon as the island opens
    }

    async tick() {
        const now = GLib.get_monotonic_time() / 1e6;
        if (!this._scanning && now - this._lastScan >= RESCAN_S) {
            this._scanning = true;
            try {
                await this._scan();
                this._lastScan = GLib.get_monotonic_time() / 1e6;
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.debug(`[dynamic-island] claude usage scan failed: ${e.message}`);
            } finally {
                this._scanning = false;
            }
        }
        this._render();
    }

    /** Oldest message that can still matter: today, or the last 6 h (a window started before midnight). */
    _since() {
        const nowMs = Date.now();
        const d = new Date(nowMs);
        const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return {midnight, since: Math.min(midnight, nowMs - WINDOW_MS - 3600000)};
    }

    async _scan() {
        const {since} = this._since();
        const sinceSec = Math.floor(since / 1000);
        const seen = new Set();
        await this._walk(this._root, 0, sinceSec, seen);
        for (const p of [...this._files.keys()]) {
            if (!seen.has(p))
                this._files.delete(p);   // rotated away / too old now
        }
        for (const [id, e] of this._entries) {
            if (e.t < since)
                this._entries.delete(id);
        }
    }

    async _walk(dir, depth, sinceSec, seen) {
        if (this._dead())
            return;
        let en;
        try {
            en = await dir.enumerate_children_async('standard::name,standard::type,standard::size,time::modified',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, this.cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return;
        }
        for (;;) {
            const infos = await en.next_files_async(64, GLib.PRIORITY_LOW, this.cancellable);
            if (!infos.length)
                break;
            for (const info of infos) {
                const child = dir.get_child(info.get_name());
                if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                    if (depth < MAX_DEPTH)
                        await this._walk(child, depth + 1, sinceSec, seen);
                } else if (info.get_name().endsWith('.jsonl') &&
                           info.get_attribute_uint64('time::modified') >= sinceSec) {
                    const path = child.get_path();
                    seen.add(path);
                    await this._readNew(child, path, Number(info.get_size()));
                }
            }
        }
        en.close_async?.(GLib.PRIORITY_LOW, null).catch(() => {});
    }

    _dead() {
        return !this.ctx || this.cancellable?.is_cancelled();
    }

    /** Parse only what was appended since the last scan. */
    async _readNew(file, path, size) {
        let offset = this._files.get(path) ?? 0;
        if (size < offset)
            offset = 0;   // file was rewritten
        if (size === offset)
            return;
        const stream = await file.read_async(GLib.PRIORITY_LOW, this.cancellable);
        try {
            if (offset)
                stream.seek(offset, GLib.SeekType.SET, null);
            const dec = new TextDecoder();
            let carry = new Uint8Array(0), consumed = offset;
            for (;;) {
                const bytes = await stream.read_bytes_async(CHUNK, GLib.PRIORITY_LOW, this.cancellable);
                if (!bytes.get_size())
                    break;
                // work on bytes: only whole lines (up to the last "\n") are decoded,
                // so a multi-byte character cut at a chunk border is never split
                const chunk = bytes.toArray();
                const buf = new Uint8Array(carry.length + chunk.length);
                buf.set(carry);
                buf.set(chunk, carry.length);
                const end = buf.lastIndexOf(10);
                if (end < 0) {
                    carry = buf;
                    continue;
                }
                for (const line of dec.decode(buf.subarray(0, end)).split('\n')) {
                    const e = parseLine(line);
                    if (e)
                        addEntry(this._entries, e);
                }
                consumed += end + 1;
                carry = buf.slice(end + 1);
            }
            // the unfinished last line is read again next time
            this._files.set(path, consumed);
        } finally {
            stream.close_async(GLib.PRIORITY_LOW, null).catch(() => {});
        }
    }

    _render() {
        if (!this._value)
            return;
        const {midnight} = this._since();
        const nowMs = Date.now();
        const w = windowStats([...this._entries.values()], nowMs, midnight);
        const limit = this.ctx?.config?.claudeLimit ?? 0;
        const set = (label, text) => {
            if (label && label.text !== text)
                label.text = text;
        };
        const accent = ORANGE;
        set(this._today, w.today ? _f('Today %s', formatTokens(w.today)) : '');

        if (!w.active) {
            this._setRing(0, accent);
            set(this._ringText, '—');
            set(this._value, _('No active session'));
            set(this._unit, '');
            set(this._sub, _('A new session starts with your next message'));
            this._fill?.set_scale(0, 1);
            return;
        }

        const left = w.end - nowMs;
        const {h, m} = splitDuration(left);
        const at = new Date(w.end);
        const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
        const timeLeft = h ? _f('%s h %s min', h, m) : _f('%s min', m);
        set(this._sub, _f('Resets %s · %s left', clock, timeLeft));
        const elapsed = Math.min(1, (nowMs - w.start) / WINDOW_MS);
        if (this._shown !== elapsed.toFixed(3)) {
            this._shown = elapsed.toFixed(3);
            this._fill?.ease({scale_x: elapsed, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }

        if (limit > 0) {
            const used = w.used / limit;
            const color = used > 0.9 ? RED : accent;
            this._setRing(Math.max(0, 1 - used), color);
            set(this._ringText, `${Math.max(0, Math.round((1 - used) * 100))}%`);
            set(this._value, formatTokens(w.used));
            set(this._unit, `/ ${formatTokens(limit)} ${_('tokens')}`);
        } else {
            this._setRing(Math.max(0, 1 - elapsed), accent);
            set(this._ringText, `${h}:${String(m).padStart(2, '0')}`);
            set(this._value, formatTokens(w.used));
            set(this._unit, _('tokens used'));
        }
    }

    destroy() {
        this._entries?.clear();
        this._files?.clear();
        this._ringTl?.stop();
        this._ringTl = null;
        this._value = null;
        super.destroy();
    }
}
