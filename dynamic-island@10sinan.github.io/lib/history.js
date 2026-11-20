// Time-stamped sample history (for the system monitor graphs).
// Pure JS apart from the default clock, so it is unit-tested with gjs.
import GLib from 'gi://GLib';

const now = () => GLib.get_monotonic_time() / 1000;   // ms

export class History {
    /** @param {number} keepSeconds samples older than this are dropped */
    constructor(keepSeconds = 120) {
        this._keepMs = keepSeconds * 1000;
        this._data = new Map();   // key -> [{t, v}]
    }

    push(key, value, t = now()) {
        if (!Number.isFinite(value))
            return;
        let a = this._data.get(key);
        if (!a) {
            a = [];
            this._data.set(key, a);
        }
        a.push({t, v: value});
        // drop what fell out of the window (cheap: only the head moves)
        let drop = 0;
        while (drop < a.length && t - a[drop].t > this._keepMs)
            drop++;
        if (drop)
            a.splice(0, drop);
    }

    /** Samples of the last `seconds`, as [{ago (ms), v}] oldest first. */
    series(key, seconds = 60, t = now()) {
        const a = this._data.get(key) ?? [];
        const from = t - seconds * 1000;
        return a.filter(s => s.t >= from).map(s => ({ago: t - s.t, v: s.v}));
    }

    last(key) {
        const a = this._data.get(key);
        return a?.length ? a[a.length - 1].v : null;
    }

    clear() {
        this._data.clear();
    }
}
