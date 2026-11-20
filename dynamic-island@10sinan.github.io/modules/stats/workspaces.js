// Workspaces and their windows (replaces what the Activities button gave you):
// click a window to jump to it, click a workspace title to switch to it.
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {IslandModule} from '../base.js';
import {_, _f} from '../../lib/i18n.js';

const MAX_WORKSPACES = 5;
const MAX_WINDOWS = 5;

export default class WorkspacesModule extends IslandModule {
    static id = 'workspaces';
    static slot = 'banner';

    async init() {
        this._wm = global.workspace_manager;
        this._tracker = Shell.WindowTracker.get_default();
        this._ids = ['active-workspace-changed', 'workspace-added', 'workspace-removed', 'workspaces-reordered']
            .map(sig => this._wm.connect(sig, () => this._render()));
        this._sig = '';
    }

    buildExpanded() {
        this._box = new St.BoxLayout({style_class: 'di-ws', x_expand: true});
        this._box.connect('destroy', () => {
            this._box = null;
        });
        this._sig = '';
        this._render();
        return this._box;
    }

    /** [{ws, index, windows:[Meta.Window], active}] — a trailing empty workspace is left out. */
    _collect() {
        const out = [];
        const n = this._wm.get_n_workspaces();
        const current = this._wm.get_active_workspace_index();
        for (let i = 0; i < n; i++) {
            const ws = this._wm.get_workspace_by_index(i);
            const windows = global.display.get_tab_list(Meta.TabList.NORMAL, ws)
                .filter(w => !w.skip_taskbar && (!w.is_on_all_workspaces() || i === current));
            out.push({ws, index: i, windows, active: i === current});
        }
        while (out.length > 1 && !out[out.length - 1].windows.length && !out[out.length - 1].active)
            out.pop();
        return out.slice(0, MAX_WORKSPACES);
    }

    _render() {
        if (!this._box)
            return;
        const data = this._collect();
        const sig = data.map(d => `${d.index}${d.active ? '*' : ''}:` +
            d.windows.map(w => `${w.get_stable_sequence()}${w.get_title()}${w.minimized ? 'm' : ''}`).join(',')).join('|');
        if (sig === this._sig)
            return;
        this._sig = sig;
        this._box.destroy_all_children();
        for (const d of data)
            this._box.add_child(this._card(d));
        this.ctx?.requestExpandedRelayout?.();
    }

    _card({ws, index, windows, active}) {
        const card = new St.BoxLayout({style_class: 'di-ws-card', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true});
        if (active)
            card.set_style(`border-color: ${this.accent};`);

        const head = new St.Button({style_class: 'di-ws-head', can_focus: false, x_expand: true,
            label: _f('Desktop %s', index + 1)});
        head.set_x_align(Clutter.ActorAlign.START);
        if (active)
            head.set_style(`color: ${this.accent};`);
        head.connect('clicked', () => {
            ws.activate(global.get_current_time());
            this.ctx?.collapse?.();
        });
        card.add_child(head);

        if (!windows.length) {
            card.add_child(new St.Label({style_class: 'di-ws-empty', text: _('No windows')}));
            return card;
        }
        for (const w of windows.slice(0, MAX_WINDOWS))
            card.add_child(this._windowRow(w));
        if (windows.length > MAX_WINDOWS) {
            card.add_child(new St.Label({style_class: 'di-ws-empty',
                text: _f('+%s more windows', windows.length - MAX_WINDOWS)}));
        }
        return card;
    }

    _windowRow(w) {
        const row = new St.Button({style_class: 'di-ws-win', can_focus: false, x_expand: true});
        const inner = new St.BoxLayout({x_expand: true});
        const app = this._tracker.get_window_app(w);
        const icon = app?.create_icon_texture(16) ??
            new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 16});
        icon.y_align = Clutter.ActorAlign.CENTER;
        const title = new St.Label({style_class: 'di-ws-win-title', text: w.get_title() || app?.get_name() || '',
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        inner.add_child(icon);
        inner.add_child(title);
        row.set_child(inner);
        if (w.minimized)
            row.opacity = 140;
        row.connect('clicked', () => {
            Main.activateWindow(w);
            this.ctx?.collapse?.();
        });
        return row;
    }

    onShown() {
        this._sig = '';
        this._render();
    }

    async tick() {
        this._render();   // window titles / opened / closed windows
    }

    destroy() {
        for (const id of this._ids ?? [])
            this._wm?.disconnect(id);
        this._ids = [];
        this._box = null;
        super.destroy();
    }
}
