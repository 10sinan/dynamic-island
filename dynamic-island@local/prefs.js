// Settings window (GNOME Extensions app -> Dynamic Island -> Settings).
// The same settings are available in the terminal with `di-config`.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {_, setLanguage} from './lib/i18n.js';
import {THEMES} from './lib/themes.js';

const MODULES = {
    'center-modules': ['music', 'calendar', 'notifications', 'claude'],
    'stats-modules': ['workspaces', 'cpu', 'ram', 'temp', 'net', 'battery', 'gpu', 'disk', 'graph', 'procs'],
    'qs-modules': ['sliders', 'audio', 'mixer', 'toggles', 'clipboard', 'system'],
    'events': ['power', 'battery-low', 'wifi', 'bluetooth', 'privacy', 'thermal', 'memory', 'disk',
        'lockkey', 'layout', 'meeting', 'powersaver'],
};
const COMPACT_CAPABLE = new Set(['music', 'cpu', 'ram', 'temp', 'net', 'battery', 'disk']);
const PANEL_KEY = {'center-modules': 'center-compact-modules', 'stats-modules': 'stats-compact-modules'};

const NAMES = () => ({
    claude: _('Claude Code usage'), music: _('Music player'), calendar: _('Calendar'), notifications: _('Notification list'),
    cpu: _('CPU usage'), ram: _('RAM usage'), temp: _('CPU temperature'), net: _('Network speed'),
    battery: _('Battery'), gpu: _('GPU usage'), disk: _('Disk usage'), graph: _('Live graphs (60 s)'),
    procs: _('Top resource-using apps'),
    workspaces: _('Workspaces and windows'), audio: _('Sound output'), mixer: _('App volume'),
    sliders: _('Volume + brightness sliders'), toggles: _('Toggles (Wi-Fi, Bluetooth, ...)'),
    clipboard: _('Clipboard history (last 10)'), system: _('Battery + system buttons'),
    power: _('Charger plugged / unplugged'), 'battery-low': _('Battery low (20%, 10%)'),
    wifi: _('Wi-Fi connected / lost'), bluetooth: _('Bluetooth device connected / disconnected'),
    privacy: _('Microphone / camera in use'), thermal: _('System hot (CPU above 90°C)'),
    memory: _('Low memory (above 90%)'), lockkey: _('Caps Lock / Num Lock toggled'),
    layout: _('Keyboard layout changed'), meeting: _('Meeting mode on / off'),
    powersaver: _('Power saver on / off'),
});

export default class DynamicIslandPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        setLanguage(s.get_string('language'));
        window.set_default_size(680, 760);
        window.add(this._general(s, window));
        window.add(this._timing(s));
        window.add(this._modules(s));
    }

    _switch(s, group, key, title, subtitle = '') {
        const row = new Adw.SwitchRow({title, subtitle});
        s.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }

    _spin(s, group, key, title, subtitle, step) {
        const range = s.settings_schema.get_key(key).get_range().deepUnpack()[1].deepUnpack();
        const row = new Adw.SpinRow({
            title, subtitle,
            adjustment: new Gtk.Adjustment({lower: range[0], upper: range[1], step_increment: step,
                page_increment: step * 5}),
        });
        s.bind(key, row.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }

    _combo(s, group, key, title, subtitle, choices, onChange) {
        const row = new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(choices.map(c => c[1]))});
        const sync = () => {
            const i = choices.findIndex(c => c[0] === s.get_string(key));
            if (i >= 0 && row.selected !== i)
                row.selected = i;
        };
        sync();
        row.connect('notify::selected', () => {
            const v = choices[row.selected]?.[0];
            if (v && v !== s.get_string(key)) {
                s.set_string(key, v);
                onChange?.();
            }
        });
        group.add(row);
    }

    _general(s, window) {
        const page = new Adw.PreferencesPage({title: _('General'), icon_name: 'preferences-system-symbolic'});

        const islands = new Adw.PreferencesGroup({title: _('Islands')});
        this._switch(s, islands, 'center-enabled', _('Center island'), _('Replaces the panel clock'));
        this._switch(s, islands, 'stats-enabled', _('Left island'), _('Statistics; replaces the Activities button'));
        this._switch(s, islands, 'qs-enabled', _('Right island'), _('Quick Settings'));
        this._switch(s, islands, 'expand-on-hover', _('Open on hover'));
        this._switch(s, islands, 'shortcut-qs', _('Super+A opens the right island'));
        page.add(islands);

        const look = new Adw.PreferencesGroup({title: _('Look')});
        this._combo(s, look, 'language', 'Dil / Language', '',
            [['tr', 'Türkçe'], ['en', 'English']], () => {
                // reopen so this window switches language too
                setLanguage(s.get_string('language'));
                window.close();
            });
        this._combo(s, look, 'theme', _('Color theme'), '',
            Object.keys(THEMES).map(k => [k, _(THEMES[k].label)]));
        const accent = new Adw.EntryRow({title: _('Accent color (#rrggbb, empty = theme color)')});
        accent.text = s.get_string('accent-color');
        accent.connect('changed', () => {
            const t = accent.text.trim();
            if (t === '' || /^#[0-9a-fA-F]{6}$/.test(t))
                s.set_string('accent-color', t.toLowerCase());
        });
        const pick = new Gtk.ColorDialogButton({valign: Gtk.Align.CENTER, dialog: new Gtk.ColorDialog()});
        const rgba = new Gdk.RGBA();
        if (/^#[0-9a-fA-F]{6}$/.test(accent.text))
            rgba.parse(accent.text);
        pick.rgba = rgba;
        pick.connect('notify::rgba', () => {
            const c = pick.rgba;
            const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
            accent.text = `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
        });
        accent.add_suffix(pick);
        look.add(accent);
        this._switch(s, look, 'show-seconds', _('Show seconds on the clock'));
        page.add(look);

        const feat = new Adw.PreferencesGroup({title: _('Features')});
        this._switch(s, feat, 'clipboard-history', _('Clipboard history'),
            _('Last 10 copies, memory only, never written to disk'));
        this._switch(s, feat, 'music-popup', _('Preview on track change'));
        this._switch(s, feat, 'osd-enabled', _('Volume/brightness indicator in the island'));
        this._switch(s, feat, 'notification-preview', _('Notification preview'));
        this._switch(s, feat, 'screenshot-preview', _('Screenshot thumbnail'));
        this._switch(s, feat, 'meeting-mode', _('Meeting mode (mic/camera → Do Not Disturb)'));
        this._switch(s, feat, 'claude-notify', _('Claude Code notifications'),
            _('When Claude finishes or waits for you (run: di-config claude-hooks install)'));
        this._spin(s, feat, 'claude-token-limit', _('Claude token limit (K per 5 h)'),
            _('0 = just show the tokens used; set your own limit to see how much is left'), 1000);
        this._switch(s, feat, 'auto-power-saver', _('Auto Power Saver on low battery'));
        this._spin(s, feat, 'auto-power-saver-level', _('Power saver battery level'), '%', 5);
        page.add(feat);
        return page;
    }

    _timing(s) {
        const page = new Adw.PreferencesPage({title: _('Timing'), icon_name: 'preferences-system-time-symbolic'});
        const g = new Adw.PreferencesGroup({title: _('Timing'), description: _('Values in milliseconds')});
        this._spin(s, g, 'hover-expand-delay', _('Open delay'), '0 = ' + _('instant'), 50);
        this._spin(s, g, 'leave-collapse-delay', _('Close delay'), '', 50);
        this._spin(s, g, 'auto-collapse', _('Auto close'), '0 = ' + _('never'), 500);
        this._spin(s, g, 'animation-duration', _('Open animation'), '', 20);
        this._spin(s, g, 'notification-duration', _('Notification preview time'), '', 500);
        this._spin(s, g, 'poll-compact', _('Refresh (collapsed)'), '', 250);
        this._spin(s, g, 'poll-expanded', _('Refresh (expanded)'), '', 250);
        this._switch(s, g, 'spring', _('Spring effect'), _('A slight bounce when opening'));
        this._switch(s, g, 'morph-blur', _('Blur while opening/closing'), _('Content blurs while the island changes shape'));
        page.add(g);
        return page;
    }

    _modules(s) {
        const page = new Adw.PreferencesPage({title: _('Modules'), icon_name: 'view-list-symbolic'});
        const titles = {
            'center-modules': _('Shown under the clock'),
            'stats-modules': _('Statistics (top-left corner)'),
            'qs-modules': _('Panel sections (top to bottom)'),
            'events': _('Events that open the island briefly'),
        };
        const names = NAMES();
        for (const [key, all] of Object.entries(MODULES)) {
            const group = new Adw.PreferencesGroup({title: titles[key]});
            const panelKey = PANEL_KEY[key];
            let rows = [];

            const render = () => {
                for (const r of rows)
                    group.remove(r);
                rows = [];
                const on = s.get_strv(key);
                const order = [...on, ...all.filter(m => !on.includes(m))];
                order.forEach((id, idx) => {
                    const row = new Adw.ActionRow({title: names[id] ?? id});
                    const sw = new Gtk.Switch({active: on.includes(id), valign: Gtk.Align.CENTER});
                    sw.connect('notify::active', () => {
                        const cur = s.get_strv(key);
                        if (sw.active === cur.includes(id))
                            return;
                        if (sw.active) {
                            cur.push(id);
                            cur.sort((a, b) => order.indexOf(a) - order.indexOf(b));
                        } else {
                            cur.splice(cur.indexOf(id), 1);
                        }
                        s.set_strv(key, cur);
                        render();
                    });
                    if (panelKey && COMPACT_CAPABLE.has(id)) {
                        const chk = new Gtk.CheckButton({valign: Gtk.Align.CENTER,
                            tooltip_text: _('Also show in the panel'),
                            active: s.get_strv(panelKey).includes(id)});
                        chk.connect('toggled', () => {
                            const cur = s.get_strv(panelKey).filter(m => m !== id);
                            if (chk.active)
                                cur.push(id);
                            s.set_strv(panelKey, order.filter(m => cur.includes(m)));
                        });
                        row.add_suffix(chk);
                    }
                    if (key !== 'events' && on.includes(id)) {
                        const mk = (icon, step) => {
                            const b = new Gtk.Button({icon_name: icon, valign: Gtk.Align.CENTER, css_classes: ['flat']});
                            b.connect('clicked', () => {
                                const cur = s.get_strv(key);
                                const i = cur.indexOf(id), j = i + step;
                                if (j < 0 || j >= cur.length)
                                    return;
                                [cur[i], cur[j]] = [cur[j], cur[i]];
                                s.set_strv(key, cur);
                                render();
                            });
                            return b;
                        };
                        row.add_suffix(mk('go-up-symbolic', -1));
                        row.add_suffix(mk('go-down-symbolic', 1));
                    }
                    row.add_suffix(sw);
                    row.activatable_widget = sw;
                    group.add(row);
                    rows.push(row);
                });
            };
            render();
            page.add(group);
        }
        return page;
    }
}
