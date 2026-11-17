// Automatic Power Saver: when the battery is low and the laptop is running on
// battery, ask power-profiles-daemon to hold the "power-saver" profile.
//
// A *hold* (HoldProfile) is the right tool: the daemon switches to it and goes
// back to whatever profile was active the moment the hold is released, so
// there is nothing for us to remember or restore. The hold is released when
// the charger is plugged in, when the extension is disabled, and the daemon
// drops it by itself if this process dies.
// If you pick a profile yourself while the hold is active the daemon drops
// the hold (ProfileReleased); we then respect that until the charger is
// plugged in again.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as C from './constants.js';

const UPOWER = 'org.freedesktop.UPower';
const DISPLAY_DEVICE = '/org/freedesktop/UPower/devices/DisplayDevice';
const DEVICE_IFACE = 'org.freedesktop.UPower.Device';
const PPD = 'org.freedesktop.UPower.PowerProfiles';
const PPD_PATH = '/org/freedesktop/UPower/PowerProfiles';
const APP_ID = 'dynamic-island@local';
// UPower Device.State
const CHARGING = 1, DISCHARGING = 2, FULL = 4, PENDING_CHARGE = 5, PENDING_DISCHARGE = 6;

Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');
Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');

export class AutoPowerSaver {
    /**
     * @param {{trigger: Function}} hub  EventHub (announces on / off)
     * @param {number} level            battery % at or below which to hold Power Saver
     */
    constructor(hub, level) {
        this._hub = hub;
        this._level = level;
        this._cookie = 0;
        this._suppressed = false;   // the user overrode us; wait for the next charge
        this._ids = [];
        this._dead = false;
        this._cancellable = new Gio.Cancellable();
        this._init().catch(e => {
            if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`${C.LOG_PREFIX} auto power saver unavailable: ${e?.message ?? e}`);
        });
    }

    get holding() {
        return this._cookie !== 0;
    }

    async _init() {
        const sys = Gio.BusType.SYSTEM, none = Gio.DBusProxyFlags.NONE;
        const [bat, ppd] = await Promise.all([
            Gio.DBusProxy.new_for_bus(sys, none, null, UPOWER, DISPLAY_DEVICE, DEVICE_IFACE, this._cancellable),
            Gio.DBusProxy.new_for_bus(sys, none, null, PPD, PPD_PATH, PPD, this._cancellable),
        ]);
        if (this._dead || !bat.g_name_owner || !ppd.g_name_owner)
            return;   // no battery service or no power-profiles-daemon
        this._bat = bat;
        this._ppd = ppd;
        this._ids.push([bat, bat.connect('g-properties-changed', () => this._evaluate())]);
        this._ids.push([ppd, ppd.connect('g-signal', (_p, _sender, signal, params) => {
            if (signal === 'ProfileReleased' && params.deepUnpack()[0] === this._cookie) {
                this._cookie = 0;           // dropped by the daemon (e.g. you chose a profile)
                this._suppressed = true;
            }
        })]);
        this._evaluate();
    }

    _read() {
        return {
            state: this._bat.get_cached_property('State')?.unpack() ?? 0,
            pct: Math.round(this._bat.get_cached_property('Percentage')?.unpack() ?? 100),
            present: this._bat.get_cached_property('IsPresent')?.unpack() ?? true,
        };
    }

    /** Decide from the current battery state. Public for tests (pass a reading). */
    _evaluate(reading = null) {
        if (this._dead)
            return;
        const {state, pct, present} = reading ?? this._read();
        if (!present)
            return;
        const charging = [CHARGING, FULL, PENDING_CHARGE].includes(state);
        const discharging = [DISCHARGING, PENDING_DISCHARGE].includes(state);
        if (charging) {
            this._suppressed = false;
            if (this.holding)
                this._release(pct);
        } else if (discharging && pct <= this._level && !this.holding && !this._suppressed) {
            this._hold(pct);
        }
    }

    async _hold(pct) {
        const ppd = this._ppd;   // kept: the instance may be destroyed while the call is in flight
        this._cookie = -1;       // claimed: no second request meanwhile
        try {
            const alreadySaver = ppd.get_cached_property('ActiveProfile')?.unpack() === 'power-saver';
            const res = await ppd.call('HoldProfile',
                new GLib.Variant('(sss)', ['power-saver', `Battery at ${pct}%`, APP_ID]),
                Gio.DBusCallFlags.NONE, -1, this._cancellable);
            this._cookie = res.deepUnpack()[0];
            if (this._dead) {   // disabled meanwhile: give the hold straight back
                ppd.call('ReleaseProfile', new GLib.Variant('(u)', [this._cookie]),
                    Gio.DBusCallFlags.NONE, -1, null).catch(() => {});
                this._cookie = 0;
                return;
            }
            if (!alreadySaver)
                this._hub?.trigger('powersaver', {on: true, pct});
        } catch (e) {
            this._cookie = 0;
            if (!e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.debug(`${C.LOG_PREFIX} HoldProfile failed: ${e.message}`);
        }
    }

    _release(pct = 0) {
        const cookie = this._cookie;
        this._cookie = 0;
        if (cookie > 0) {
            this._ppd?.call('ReleaseProfile', new GLib.Variant('(u)', [cookie]),
                Gio.DBusCallFlags.NONE, -1, null).catch(() => {});
            if (!this._dead)
                this._hub?.trigger('powersaver', {on: false, pct});
        }
    }

    destroy() {
        this._dead = true;
        this._release();   // back to the previous profile right away (no announcement)
        this._cancellable.cancel();
        for (const [obj, id] of this._ids) {
            try {
                obj.disconnect(id);
            } catch {}
        }
        this._ids = [];
        this._bat = this._ppd = this._hub = null;
    }
}
