// Meeting mode: Do Not Disturb switches on while the microphone or camera is
// in use (video calls, voice chats, recordings) and off again afterwards.
//
// Rules that keep it from being annoying or destructive:
//   * it reacts to the shell's own privacy indicators (the orange / green dots);
//   * it waits 2 s before switching on (a quick test of the mic is not a meeting)
//     and 10 s after the last use before switching off (calls blip);
//   * if Do Not Disturb was already on, it does nothing and never turns it off;
//   * if you switch DND off yourself during the call, it leaves it alone;
//   * it remembers that IT turned DND on (GSettings flag), so a crash or log-out
//     in the middle of a call never leaves you silenced for good;
//   * disabling the extension restores DND immediately.
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Disposer} from './disposer.js';

const START_DELAY_MS = 2000;
const STOP_DELAY_MS = 10000;

export class MeetingMode {
    /**
     * @param {{trigger: Function}} hub   EventHub (announces start / end)
     * @param {Gio.Settings} settings     the extension's settings (for the persisted flag)
     */
    constructor(hub, settings) {
        this._hub = hub;
        this._settings = settings;
        this._d = new Disposer();
        this._notif = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._startTimer = this._d.timer();
        this._stopTimer = this._d.timer();
        this._meeting = false;     // a meeting is in progress
        this._ours = false;        // ... and DND was switched on by us

        const qs = Main.panel?.statusArea?.quickSettings;
        this._sources = ['_volumeInput', '_camera'].map(n => qs?.[n]).filter(Boolean);
        for (const src of this._sources)
            this._d.connect(src, 'notify::visible', () => this._evaluate());
        // the user turning DND off themselves ends our responsibility
        this._d.connect(this._notif, 'changed::show-banners', () => {
            if (this._ours && this._notif.get_boolean('show-banners'))
                this._forget();
        });

        this._recover();
        this._evaluate();
    }

    get inUse() {
        return this._sources.some(s => s.visible);
    }

    /** A previous session may have died while we had DND on. */
    _recover() {
        if (!this._settings.get_boolean('meeting-dnd-active'))
            return;
        if (this.inUse) {
            this._meeting = this._ours = true;   // still in the same call: carry on
        } else {
            this._notif.set_boolean('show-banners', true);
            this._settings.set_boolean('meeting-dnd-active', false);
        }
    }

    _evaluate() {
        if (this.inUse) {
            this._stopTimer.clear();
            if (!this._meeting && !this._startTimer.active)
                this._startTimer.schedule(START_DELAY_MS, () => this._start());
        } else {
            this._startTimer.clear();
            if (this._meeting && !this._stopTimer.active)
                this._stopTimer.schedule(STOP_DELAY_MS, () => this._stop());
        }
    }

    _start() {
        if (!this.inUse || this._meeting)
            return;
        this._meeting = true;
        if (!this._notif.get_boolean('show-banners'))
            return;   // DND already on (the user's own choice): leave it alone
        this._notif.set_boolean('show-banners', false);
        this._ours = true;
        this._settings.set_boolean('meeting-dnd-active', true);
        this._hub?.trigger('meeting', {on: true});
    }

    _stop() {
        this._meeting = false;
        if (!this._ours)
            return;
        this._restore();
        this._hub?.trigger('meeting', {on: false});
    }

    _restore() {
        if (this._ours && !this._notif.get_boolean('show-banners'))
            this._notif.set_boolean('show-banners', true);
        this._forget();
    }

    _forget() {
        this._ours = false;
        this._settings.set_boolean('meeting-dnd-active', false);
    }

    destroy() {
        this._d.dispose();
        if (this._ours)
            this._restore();   // never leave Do Not Disturb on behind us
        this._notif = null;
        this._hub = null;
        this._settings = null;
    }
}
