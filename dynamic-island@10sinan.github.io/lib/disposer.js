// Disposer: everything that must be undone in disable() is registered here,
// then released in reverse order with a single dispose() call.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {LOG_PREFIX} from './constants.js';

/** A one-shot, re-schedulable GLib timeout. At most one source alive at a time. */
export class Timer {
    constructor() {
        this._id = 0;
    }

    get active() {
        return this._id !== 0;
    }

    schedule(ms, fn) {
        this.clear();
        const cb = () => {
            this._id = 0;
            try {
                fn();
            } catch (e) {
                console.error(`${LOG_PREFIX} timer callback failed`, e);
            }
            return GLib.SOURCE_REMOVE;
        };
        // Whole seconds: let GLib coalesce the wakeup with other timers.
        this._id = ms >= 1000 && ms % 1000 === 0
            ? GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ms / 1000, cb)
            : GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, cb);
    }

    clear() {
        if (this._id) {
            GLib.Source.remove(this._id);
            this._id = 0;
        }
    }
}

export class Disposer {
    constructor() {
        this._fns = [];
    }

    /** Register an arbitrary cleanup function. */
    add(fn) {
        this._fns.push(fn);
        return fn;
    }

    /** obj.connect() whose handler is disconnected on dispose(). */
    connect(obj, signal, callback) {
        const id = obj.connect(signal, callback);
        this.add(() => obj.disconnect(id));
        return id;
    }

    /** A Timer that is cleared on dispose(). */
    timer() {
        const t = new Timer();
        this.add(() => t.clear());
        return t;
    }

    /** A Gio.Cancellable that is cancelled on dispose(). */
    cancellable() {
        const c = new Gio.Cancellable();
        this.add(() => c.cancel());
        return c;
    }

    dispose() {
        while (this._fns.length) {
            const fn = this._fns.pop();
            try {
                fn();
            } catch (e) {
                console.warn(`${LOG_PREFIX} cleanup step failed`, e);
            }
        }
    }
}
