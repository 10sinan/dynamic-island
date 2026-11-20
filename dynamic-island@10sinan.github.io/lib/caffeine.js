// "Keep awake": asks the session manager not to blink the screen or suspend.
// Lives at extension level (like the clipboard store) so a settings rebuild of
// the islands doesn't drop it. The inhibit belongs to the shell's D-Bus
// connection, so if the shell dies the system goes back to normal by itself.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS = 'org.gnome.SessionManager';
const PATH = '/org/gnome/SessionManager';
const FLAG_SUSPEND = 4, FLAG_IDLE = 8;

/** Tap cycles through these (seconds; 0 = off, -1 = until switched off). */
export const STEPS = [0, 30 * 60, 60 * 60, 3 * 60 * 60, -1];

export class Caffeine {
    constructor() {
        this._cookie = 0;
        this._until = 0;       // monotonic seconds; Infinity = no end
        this._timer = 0;
        this._tick = 0;
        this._subs = new Set();
        this._dead = false;
    }

    get active() {
        return this._cookie !== 0;
    }

    /** Seconds left, Infinity if endless, 0 if off. */
    get remaining() {
        if (!this.active)
            return 0;
        return this._until === Infinity ? Infinity : Math.max(0, this._until - GLib.get_monotonic_time() / 1e6);
    }

    subscribe(fn) {
        this._subs.add(fn);
        return () => this._subs.delete(fn);
    }

    _emit() {
        for (const fn of [...this._subs]) {
            try {
                fn();
            } catch (e) {
                console.warn('[dynamic-island] caffeine subscriber failed', e);
            }
        }
    }

    /** Next step of the cycle: off -> 30 min -> 1 h -> 3 h -> endless -> off. */
    cycle() {
        let i = 0;
        if (this.active) {
            const left = this.remaining;
            if (left === Infinity)
                i = STEPS.length - 1;
            else
                i = Math.max(1, STEPS.findIndex((s, k) => k > 0 && s > 0 && left <= s + 5));
        }
        this.set(STEPS[(i + 1) % STEPS.length]);
    }

    /** seconds > 0 timed, -1 endless, 0 off */
    async set(seconds) {
        if (this._dead)
            return;
        this._clearTimers();
        if (seconds === 0) {
            await this._release();
            this._emit();
            return;
        }
        if (!this._cookie) {
            try {
                const res = await new Promise((resolve, reject) => {
                    Gio.DBus.session.call(BUS, PATH, BUS, 'Inhibit',
                        new GLib.Variant('(susu)', ['Dynamic Island', 0, 'Keep awake', FLAG_SUSPEND | FLAG_IDLE]),
                        new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 3000, null,
                        (conn, r) => {
                            try {
                                resolve(conn.call_finish(r));
                            } catch (e) {
                                reject(e);
                            }
                        });
                });
                this._cookie = res.deepUnpack()[0];
            } catch (e) {
                console.warn(`[dynamic-island] keep-awake failed: ${e.message}`);
                this._emit();
                return;
            }
            if (this._dead) {
                this._release();
                return;
            }
        }
        if (seconds < 0) {
            this._until = Infinity;
        } else {
            this._until = GLib.get_monotonic_time() / 1e6 + seconds;
            this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                this._timer = 0;
                this.set(0);
                return GLib.SOURCE_REMOVE;
            });
        }
        // keep "23 min" labels fresh
        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._emit();
            return this.active ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
        });
        this._emit();
    }

    async _release() {
        const cookie = this._cookie;
        this._cookie = 0;
        this._until = 0;
        if (!cookie)
            return;
        try {
            await new Promise(resolve => {
                Gio.DBus.session.call(BUS, PATH, BUS, 'Uninhibit', new GLib.Variant('(u)', [cookie]),
                    null, Gio.DBusCallFlags.NONE, 3000, null, (conn, r) => {
                        try {
                            conn.call_finish(r);
                        } catch {}
                        resolve();
                    });
            });
        } catch {}
    }

    _clearTimers() {
        for (const k of ['_timer', '_tick']) {
            if (this[k]) {
                GLib.source_remove(this[k]);
                this[k] = 0;
            }
        }
    }

    destroy() {
        this._dead = true;
        this._clearTimers();
        this._subs.clear();
        // fire and forget: the shell may be going down
        this._release();
    }
}
