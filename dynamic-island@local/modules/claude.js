// Claude Code usage tile for the centre island: tokens used in the current
// 5-hour session and when it resets. Estimated from the local session logs
// (nothing is sent anywhere, no credentials are read). With a limit set in the
// settings it shows how much is left.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {IslandModule} from './base.js';
import {Meter} from '../lib/widgets.js';
import {severity} from '../lib/proc.js';
import {_, _f} from '../lib/i18n.js';
import {WINDOW_MS, addEntry, formatTokens, parseLine, splitDuration, windowStats} from '../lib/claudeUsage.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');

const RESCAN_S = 15;
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
        this._tile = new Meter({accent: this.accent, title: 'CLAUDE'});
        this._tile.actor.connect('destroy', () => {
            this._tile = null;
        });
        this._render();
        return this._tile.actor;
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
        if (!this._tile)
            return;
        const {midnight} = this._since();
        const nowMs = Date.now();
        const w = windowStats([...this._entries.values()], nowMs, midnight);
        const limit = this.ctx?.config?.claudeLimit ?? 0;
        if (!w.active) {
            this._tile.update('—', 0, 'ok', w.today ? _f('Today %s', formatTokens(w.today)) : _('No active session'));
            return;
        }
        const {h, m} = splitDuration(w.end - nowMs);
        const reset = h ? _f('resets in %s h %s min', h, m) : _f('resets in %s min', m);
        if (limit > 0) {
            const usedFrac = w.used / limit;
            const left = Math.max(0, Math.round((1 - usedFrac) * 100));
            this._tile.update(`${left}%`, Math.max(0, 1 - usedFrac), severity(usedFrac, 0.75, 0.9),
                `${formatTokens(w.used)}/${formatTokens(limit)} · ${reset}`);
        } else {
            this._tile.update(formatTokens(w.used), Math.min(1, (nowMs - w.start) / WINDOW_MS), 'ok', reset);
        }
    }

    destroy() {
        this._entries?.clear();
        this._files?.clear();
        this._tile = null;
        super.destroy();
    }
}
