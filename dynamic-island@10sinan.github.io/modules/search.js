// Search from the centre island (Super+R): apps, files, settings, calculator...
// It asks the same search providers GNOME's overview uses (applications plus
// every app that offers a search provider: Files, Settings, Calculator, ...),
// so results and their actions are GNOME's own.
//
// Hidden until opened: the island is pinned (keyboard grab, Esc closes) and
// takes the whole expanded view (ctx.focus) for the search page.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {IslandModule} from './base.js';
import {_} from '../lib/i18n.js';

const DEBOUNCE_MS = 140;
const PER_PROVIDER = 3;
const APPS = 5;
const MAX_ROWS = 10;

/** The overview's own providers (private path, guarded). */
function overviewProviders() {
    try {
        const c = Main.overview._overview?._controls ?? Main.overview._overview?.controls;
        return c?._searchController?._searchResults?._providers ?? null;
    } catch {
        return null;
    }
}

/** Fallback: applications only. */
const APP_PROVIDER = {
    id: 'applications',
    isFallback: true,
    getInitialResultSet: async terms => Shell.AppSystem.search(terms.join(' ')).flat(),
    getResultMetas: async ids => ids.map(id => Shell.AppSystem.get_default().lookup_app(id)).filter(Boolean)
        .map(app => ({id: app.get_id(), name: app.get_name(), description: app.get_description() ?? '',
            createIcon: size => app.create_icon_texture(size)})),
    activateResult: id => Shell.AppSystem.get_default().lookup_app(id)?.activate(),
};

export default class SearchModule extends IslandModule {
    static id = 'search';
    static slot = 'banner';

    async init() {
        this._open = false;
        this._timer = 0;
        this._results = [];   // [{provider, meta, row}]
        this._selected = 0;
    }

    buildExpanded() {
        const box = new St.BoxLayout({style_class: 'di-search', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, visible: false});
        this._entry = new St.Entry({style_class: 'di-search-entry', can_focus: true, x_expand: true,
            hint_text: _('Search apps, files, settings…'),
            primary_icon: new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 16, style_class: 'di-search-icon'})});
        this._entry.clutter_text.connect('text-changed', () => this._queue());
        this._entry.clutter_text.connect('key-press-event', (_a, e) => this._onKey(e));
        this._entry.clutter_text.connect('activate', () => this._activate(this._selected));
        this._list = new St.BoxLayout({style_class: 'di-search-list', orientation: Clutter.Orientation.VERTICAL});
        box.add_child(this._entry);
        box.add_child(this._list);
        box.connect('destroy', () => {
            this._box = this._entry = this._list = null;
            this._results = [];
        });
        this._box = box;
        return box;
    }

    // ------------------------------------------------------------ open / close

    get isOpen() {
        return this._open;
    }

    /** Called by the extension (Super+R) after the island was pinned. */
    open() {
        if (!this._box || this._open)
            return;
        this._open = true;
        this.ctx?.focus?.(this);
        this._box.show();
        this._entry.text = '';
        this._renderEmpty();
        this._box.set({opacity: 0, translation_y: -8});
        this._box.ease({opacity: 255, translation_y: 0, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        // after the morph started: the entry must be mapped to take focus
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._open && this._entry)
                this._entry.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }

    close() {
        if (!this._open)
            return;
        this._open = false;
        this._cancel();
        if (this._box) {
            this._box.hide();
            this._list.destroy_all_children();
            this._entry.text = '';
        }
        this._results = [];
        this.ctx?.focus?.(null);
    }

    onHidden() {
        this.close();   // island collapsed (Esc, click outside, shortcut again)
    }

    // ------------------------------------------------------------ searching

    _queue() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._timer = 0;
            this._search();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancel() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    async _search() {
        const text = this._entry?.text.trim() ?? '';
        this._cancellable?.cancel();
        if (!text) {
            this._renderEmpty();
            return;
        }
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._shownSig = null;
        const terms = text.split(/\s+/);
        const providers = overviewProviders() ?? [APP_PROVIDER];

        // ask every provider at once; show results as each one answers (a slow
        // provider that first has to start its app must not hold the others back)
        const groups = new Array(providers.length).fill(null);
        let pending = providers.length;
        const done = () => {
            pending--;
            if (cancellable.is_cancelled() || !this._list)
                return;
            this._render(groups.filter(g => g?.metas.length), terms, pending === 0);
        };
        providers.forEach(async (p, i) => {
            try {
                let ids = await p.getInitialResultSet(terms, cancellable);
                const max = p.id === 'applications' ? APPS : PER_PROVIDER;
                if (p.filterResults)
                    ids = p.filterResults(ids, max);
                ids = ids.slice(0, max);
                if (ids.length && !cancellable.is_cancelled()) {
                    const metas = await p.getResultMetas(ids, cancellable);
                    groups[i] = {p, metas: metas.filter(Boolean)};
                }
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.debug(`[dynamic-island] search provider ${p.id}: ${e.message}`);
            }
            done();
        });
    }

    _providerName(p) {
        if (p.id === 'applications')
            return _('Applications');
        return p.appInfo?.get_name?.() ?? p.id;
    }

    _render(groups, terms, final = true) {
        // same rows as already shown -> nothing to do (no flicker while others answer)
        const sig = groups.map(g => g.metas.map(m => m.id).join(',')).join('|');
        if (sig === this._shownSig && this._shownFinal === final)
            return;
        const firstPaint = !this._shownSig;
        this._shownSig = sig;
        this._shownFinal = final;
        this._list.destroy_all_children();
        this._results = [];
        let n = 0;
        for (const {p, metas} of groups) {
            if (n >= MAX_ROWS)
                break;
            this._list.add_child(new St.Label({style_class: 'di-search-section', text: this._providerName(p).toUpperCase()}));
            for (const meta of metas) {
                if (n >= MAX_ROWS)
                    break;
                const index = this._results.length;
                const row = this._row(meta, () => this._activate(index));
                this._results.push({p, meta, row, terms});
                this._list.add_child(row);
                if (firstPaint) {
                    row.set({opacity: 0, translation_y: 6});
                    row.ease({opacity: 255, translation_y: 0, delay: n * 22, duration: 220,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
                n++;
            }
        }
        if (!this._results.length) {
            this._list.add_child(new St.Label({style_class: 'di-search-empty',
                text: final ? _('No results') : _('Searching…')}));
        }
        this._select(0);
        this.ctx?.requestExpandedRelayout?.();
    }

    _renderEmpty() {
        if (!this._list)
            return;
        this._shownSig = null;
        this._list.destroy_all_children();
        this._results = [];
        this._list.add_child(new St.Label({style_class: 'di-search-empty',
            text: _('Type to search · Enter opens · Esc closes')}));
        this.ctx?.requestExpandedRelayout?.();
    }

    _row(meta, onClick) {
        const box = new St.BoxLayout({style_class: 'di-search-row-box', x_expand: true});
        let icon = null;
        try {
            icon = meta.createIcon?.(28) ?? null;
        } catch {}
        icon ??= new St.Icon({icon_name: 'system-search-symbolic', icon_size: 28});
        icon.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);
        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        const name = new St.Label({style_class: 'di-search-name', text: meta.name ?? ''});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        col.add_child(name);
        const descText = (meta.description ?? '').split('\n')[0];
        if (descText) {
            const desc = new St.Label({style_class: 'di-search-desc', text: descText});
            desc.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            col.add_child(desc);
        }
        box.add_child(col);
        const row = new St.Button({style_class: 'di-search-row', child: box, x_expand: true, can_focus: false});
        row.connect('clicked', onClick);
        return row;
    }

    _select(i) {
        if (!this._results.length)
            return;
        this._selected = (i + this._results.length) % this._results.length;
        this._results.forEach((r, k) => {
            if (k === this._selected) {
                r.row.add_style_pseudo_class('selected');
                r.row.set_style(`background-color: rgba(255, 255, 255, 0.12); box-shadow: inset 3px 0 0 ${this.accent};`);
            } else {
                r.row.remove_style_pseudo_class('selected');
                r.row.set_style(null);
            }
        });
    }

    _onKey(event) {
        const key = event.get_key_symbol();
        if (key === Clutter.KEY_Down || (key === Clutter.KEY_Tab && !(event.get_state() & Clutter.ModifierType.SHIFT_MASK))) {
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Up || key === Clutter.KEY_ISO_Left_Tab || key === Clutter.KEY_Tab) {
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;   // Escape goes on to the island (closes it)
    }

    _activate(i) {
        const r = this._results[i];
        if (!r)
            return;
        try {
            r.p.activateResult(r.meta.id, r.terms, global.get_current_time());
        } catch (e) {
            console.warn(`[dynamic-island] search: could not open ${r.meta.name}: ${e.message}`);
        }
        this.ctx?.collapse?.();
    }

    destroy() {
        this._cancel();
        this._results = [];
        this._box = this._entry = this._list = null;
        super.destroy();
    }
}
