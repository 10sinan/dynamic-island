// The "real plan quota" feature, in one place (opt-in, setting `claude-real-usage`).
//
// It is the only code that touches Claude Code's login token
// (~/.claude/.credentials.json, read by lib/claudeFetch.js). Rules:
//   * only exists while the setting is on: extension.js creates it then and
//     nothing else asks for credentials;
//   * one request at a time, at most one per MIN_GAP_S, shared by the Claude
//     card and the quota warnings (they used to ask separately);
//   * the token is never logged or stored here; failures log a fixed message;
//   * if the request fails for any reason (no login, expired login, network,
//     HTTP error) the feature switches itself off for good (the setting goes
//     back to false) instead of retrying: the user turns it on again on purpose.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {fetchQuota} from './claudeFetch.js';

const MIN_GAP_S = 60;

export class RealQuota {
    /** @param {Gio.Settings} settings  the extension's settings (to switch the feature off) */
    constructor(settings) {
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._holder = {soup: null};
        this._busy = null;
        this._at = 0;          // monotonic seconds of the last answer
        this._rows = null;
        this._dead = false;
    }

    /** Last quota rows, or null before the first answer. */
    get rows() {
        return this._rows;
    }

    /** Wall-clock ms of the last good answer, 0 if none. */
    get when() {
        return this._when ?? 0;
    }

    /**
     * Ask for fresh numbers. Shares an answer younger than MIN_GAP_S and a
     * request already in flight.
     * @returns {Promise<Array|null>} rows, or null (not available / switched off)
     */
    refresh() {
        if (this._dead)
            return Promise.resolve(null);
        const now = GLib.get_monotonic_time() / 1e6;
        if (this._rows && now - this._at < MIN_GAP_S)
            return Promise.resolve(this._rows);
        this._busy ??= this._request().finally(() => {
            this._busy = null;
        });
        return this._busy;
    }

    async _request() {
        const r = await fetchQuota(this._holder, this._cancellable);
        if (this._dead || r.cancelled)
            return null;
        if (!r.rows) {
            this._giveUp();
            return null;
        }
        this._rows = r.rows;
        this._when = Date.now();
        this._at = GLib.get_monotonic_time() / 1e6;
        return this._rows;
    }

    _giveUp() {
        this._dead = true;
        this._rows = null;
        console.debug('[dynamic-island] Claude quota unavailable: feature switched off');
        try {
            this._settings?.set_boolean('claude-real-usage', false);
        } catch {
            // settings gone (extension disabled meanwhile)
        }
    }

    destroy() {
        this._dead = true;
        this._cancellable.cancel();
        this._holder.soup?.abort();
        this._holder = null;
        this._settings = null;
        this._rows = null;
    }
}
