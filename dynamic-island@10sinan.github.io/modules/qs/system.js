// System row of the Quick Settings island:
//   [battery 45%]            [screenshot] [settings] [lock] [power]
// Power opens a second row: Sleep · Restart · Power off · Log out.
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {IslandModule} from '../base.js';
import {_} from '../../lib/i18n.js';
import {pressFeedback} from '../../lib/widgets.js';
import {listDir, tryReadText} from '../../lib/proc.js';

const PS = '/sys/class/power_supply';

function batteryIcon(pct, charging) {
    const level = Math.min(100, Math.round(pct / 10) * 10);
    return `battery-level-${level}${charging ? '-charging' : ''}-symbolic`;
}

export default class SystemModule extends IslandModule {
    static id = 'system';
    static slot = 'main';

    async init() {
        this._actions = SystemActions.getDefault();
        this._bat = null;
        for (const name of await listDir(PS, this.cancellable).catch(() => [])) {
            const type = await tryReadText(`${PS}/${name}/type`, this.cancellable);
            const scope = await tryReadText(`${PS}/${name}/scope`, this.cancellable);
            if (type === 'Battery' && scope !== 'Device') {
                this._bat = `${PS}/${name}`;
                break;
            }
        }
    }

    _iconButton(iconName, tooltip, onClick) {
        const b = new St.Button({style_class: 'di-round-button', can_focus: false,
            accessible_name: tooltip,
            child: new St.Icon({icon_name: iconName, icon_size: 16})});
        b.connect('clicked', onClick);
        pressFeedback(b);
        return b;
    }

    _run(fn) {
        // Close the island first so dialogs / the screenshot UI see a clean screen.
        this.ctx?.collapse?.();
        fn();
    }

    buildExpanded() {
        const box = new St.BoxLayout({style_class: 'di-system', orientation: Clutter.Orientation.VERTICAL});

        const row = new St.BoxLayout({style_class: 'di-system-row'});
        this._batBox = new St.BoxLayout({style_class: 'di-battery', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, visible: !!this._bat});
        this._batIcon = new St.Icon({icon_size: 16, icon_name: 'battery-level-50-symbolic'});
        this._batLabel = new St.Label({style_class: 'di-battery-label', y_align: Clutter.ActorAlign.CENTER});
        this._batBox.add_child(this._batIcon);
        this._batBox.add_child(this._batLabel);
        row.add_child(this._batBox);
        if (!this._bat)
            row.add_child(new St.Widget({x_expand: true}));

        const a = this._actions;
        row.add_child(this._iconButton('screenshooter-symbolic', _('Screenshot'),
            () => this._run(() => a.activateScreenshotUI())));
        row.add_child(this._iconButton('org.gnome.Settings-symbolic', _('Settings'),
            () => this._run(() => Shell.AppSystem.get_default().lookup_app('org.gnome.Settings.desktop')?.activate())));
        row.add_child(this._iconButton('system-lock-screen-symbolic', _('Lock'),
            () => this._run(() => a.activateLockScreen())));
        this._powerButton = this._iconButton('system-shutdown-symbolic', _('Power'), () => this._togglePowerRow());
        row.add_child(this._powerButton);
        box.add_child(row);

        // power choices (hidden until the power button is pressed)
        this._powerRow = new St.BoxLayout({style_class: 'di-power-row', visible: false});
        // availability (can-suspend, ...) is re-read every time the row opens
        this._choices = [];
        const choice = (text, fn, can) => {
            const b = new St.Button({style_class: 'di-chip di-power-choice', label: text,
                can_focus: false, x_expand: true});
            b.connect('clicked', () => this._run(fn));
            this._powerRow.add_child(b);
            this._choices.push([b, can]);
        };
        choice(_('Sleep'), () => a.activateSuspend(), () => a.canSuspend ?? true);
        choice(_('Restart'), () => a.activateRestart(), () => a.canRestart ?? true);
        choice(_('Shut down'), () => a.activatePowerOff(), () => a.canPowerOff ?? true);
        choice(_('Log out'), () => a.activateLogout(), () => a.canLogout ?? true);
        box.add_child(this._powerRow);

        box.connect('destroy', () => {
            this._batBox = this._batIcon = this._batLabel = this._powerRow = this._powerButton = null;
            this._choices = null;
        });
        this.tick().catch(() => {});
        return box;
    }

    _togglePowerRow() {
        if (!this._powerRow)
            return;
        this._powerRow.visible = !this._powerRow.visible;
        for (const [b, can] of this._choices ?? [])
            b.visible = can();
        if (this._powerRow.visible)
            this._powerButton.set_style(`background-color: ${this.accent}; color: #000;`);
        else
            this._powerButton.set_style(null);
        this.ctx?.requestExpandedRelayout?.();
    }

    onShown() {
        if (this._powerRow?.visible)
            this._togglePowerRow();
    }

    async tick() {
        if (!this._bat || !this._batLabel)
            return;
        const [cap, status] = await Promise.all([
            tryReadText(`${this._bat}/capacity`, this.cancellable),
            tryReadText(`${this._bat}/status`, this.cancellable),
        ]);
        const pct = Number(cap);
        if (!this._batLabel || !Number.isFinite(pct))
            return;
        const charging = status === 'Charging';
        const note = charging ? _('charging') : status === 'Full' ? _('full')
            : status === 'Not charging' ? _('plugged in') : '';
        const text = note ? `${pct}% · ${note}` : `${pct}%`;
        if (this._batLabel.text !== text)
            this._batLabel.text = text;
        this._batIcon.icon_name = batteryIcon(pct, charging || status === 'Not charging' || status === 'Full');
    }

    destroy() {
        this._actions = null;
        this._batBox = this._batIcon = this._batLabel = this._powerRow = this._powerButton = null;
        super.destroy();
    }
}
