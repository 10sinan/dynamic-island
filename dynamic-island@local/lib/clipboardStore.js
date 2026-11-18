// Clipboard history, in memory only (nothing is ever written to disk).
//
// The shell watches the clipboard through Meta.Selection ('owner-changed'),
// reads text or PNG images with St.Clipboard and keeps the last 10 in a
// ClipList. Content offered together with a password-manager hint
// (x-kde-passwordManagerHint, ...) is never read. Clicking an entry in the UI
// puts it back on the clipboard (restore()).
//
// It lives as long as the extension is enabled, not as long as one island:
// changing a setting rebuilds the islands but keeps the history.
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {ClipList, oneLine, pickKind} from './clipList.js';
import * as C from './constants.js';

const MAX_TEXT = 20000;          // characters kept per text entry
const MAX_IMAGE = 8 * 1024 * 1024;
const DEBOUNCE_MS = 120;         // owner-changed fires several times per copy

export class ClipboardStore {
    constructor(limit = 10) {
        this._list = new ClipList(limit);
        this._listeners = new Set();
        this._cancellable = new Gio.Cancellable();
        this._dead = false;
        this._timer = 0;
        this._chain = Promise.resolve();
        this._clipboard = St.Clipboard.get_default();
        Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');

        this._selection = global.display.get_selection();
        this._selectionId = this._selection.connect('owner-changed', (_s, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._schedule();
        });
    }

    get items() {
        return this._list.items;
    }

    /** Subscribe to changes; returns the unsubscribe function. */
    onChange(cb) {
        this._listeners.add(cb);
        return () => this._listeners.delete(cb);
    }

    _emit() {
        for (const cb of [...this._listeners]) {
            try {
                cb();
            } catch (e) {
                console.warn(`${C.LOG_PREFIX} clipboard listener failed`, e);
            }
        }
    }

    _schedule() {
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._timer = 0;
            // one read at a time, in copy order: a slow image decode must not
            // end up newer than a text copied right after it
            this._chain = this._chain
                .then(() => (this._dead ? null : this._read()))
                .catch(e => console.warn(`${C.LOG_PREFIX} clipboard read failed: ${e?.message ?? e}`));
            return GLib.SOURCE_REMOVE;
        });
    }

    async _read() {
        const mimes = this._clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD);
        const kind = pickKind(mimes);
        if (kind === 'text') {
            const text = await new Promise(resolve =>
                this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, t) => resolve(t)));
            if (!text || !text.trim() || this._dead)
                return;
            this._add({key: `t:${text}`, kind: 'text', text: text.slice(0, MAX_TEXT), preview: oneLine(text)});
        } else if (kind === 'image') {
            // St hands us a GBytes that is only valid INSIDE the callback (it is
            // released right after it returns); using it later crashes the shell.
            // Copy the data while we still can.
            const bytes = await new Promise(resolve =>
                this._clipboard.get_content(St.ClipboardType.CLIPBOARD, 'image/png',
                    (_c, b) => resolve(b ? GLib.Bytes.new(b.toArray()) : null)));
            if (!bytes || this._dead || bytes.get_size() > MAX_IMAGE)
                return;
            const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
            const thumb = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 96, 64, true, this._cancellable);
            if (this._dead)
                return;
            const key = `i:${GLib.compute_checksum_for_bytes(GLib.ChecksumType.MD5, bytes)}`;
            this._add({key, kind: 'image', bytes, thumb, preview: 'Resim'});
        }
    }

    /** Add one entry (also used by tests). */
    _add(item) {
        this._list.add(item);
        this._emit();
    }

    /** Put an entry back on the clipboard. */
    restore(item) {
        if (item.kind === 'text')
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item.text);
        else
            this._clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', item.bytes);
    }

    clear() {
        this._list.clear();
        this._emit();
    }

    destroy() {
        this._dead = true;
        this._cancellable.cancel();
        if (this._timer)
            GLib.Source.remove(this._timer);
        this._selection.disconnect(this._selectionId);
        this._list.clear();        // the history does not outlive the extension
        this._listeners.clear();
        this._selection = this._clipboard = null;
    }
}
