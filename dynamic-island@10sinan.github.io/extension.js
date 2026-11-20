// Entry point: builds the islands (and the OSD / notification preview
// features that hang off them) from GSettings, and rebuilds everything
// whenever a setting changes (e.g. from the `di-config` terminal UI), so
// changes apply live without logging out.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Island} from './lib/island.js';
import {OsdRouter} from './lib/osd.js';
import {NotificationPreview} from './lib/notifications.js';
import {EventHub} from './lib/events.js';
import {ClipboardStore} from './lib/clipboardStore.js';
import {Caffeine} from './lib/caffeine.js';
import {MeetingMode} from './lib/meeting.js';
import {AutoPowerSaver} from './lib/powerPolicy.js';
import {ClaudeNotifier} from './lib/claudeNotifier.js';
import {ClaudeQuotaWatch} from './lib/claudeQuotaWatch.js';
import {readConfig} from './lib/settings.js';
import {setLanguage} from './lib/i18n.js';
import {LOG_PREFIX, REBUILD_DEBOUNCE_MS} from './lib/constants.js';
import {CENTER_FIXED, CENTER_MODULES, QS_FIXED, QS_MODULES, STATS_FIXED, STATS_MODULES} from './modules/index.js';

const STAT_IDS = ['cpu', 'ram', 'temp', 'net', 'battery'];
const LAYOUT_VERSION = 6;
// Written by the extension itself; changing them must not rebuild the islands.
const INTERNAL_KEYS = new Set(['meeting-dnd-active', 'layout-version']);

export default class DynamicIslandExtension extends Extension {
    enable() {
        this._islands = [];
        this._features = [];
        this._settings = this.getSettings();
        this._migrate();
        this._settingsId = this._settings.connect('changed', (_s, key) => {
            if (!INTERNAL_KEYS.has(key))
                this._scheduleRebuild();
        });
        this._clip = null;
        this._caffeine = new Caffeine();   // survives island rebuilds
        this._build(true);
        this._takeOverQuickSettingsShortcut();
        this._addSearchShortcut();
    }

    disable() {
        if (this._rebuildId) {
            GLib.Source.remove(this._rebuildId);
            this._rebuildId = 0;
        }
        this._settings?.disconnect(this._settingsId);
        this._restoreQuickSettingsShortcut();
        this._removeSearchShortcut();
        this._teardown();
        this._caffeine?.destroy();
        this._caffeine = null;
        this._clip?.destroy();   // the clipboard history ends with the extension
        this._clip = null;
        this._settings = null;
    }

    /** Super+R (setting `shortcut-search`): search from the centre island. */
    _addSearchShortcut() {
        try {
            Main.wm.addKeybinding('shortcut-search', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._toggleSearch());
            this._searchKey = true;
        } catch (e) {
            console.warn(`${LOG_PREFIX} search shortcut not available: ${e.message}`);
        }
    }

    _removeSearchShortcut() {
        if (this._searchKey)
            Main.wm.removeKeybinding('shortcut-search');
        this._searchKey = false;
    }

    _toggleSearch() {
        const center = this._islands?.find(i => i._id === 'center');
        const search = center?.moduleById('search');
        if (!search)
            return;
        if (search.isOpen) {
            center.unpin();
            center._maybeCollapse?.();
            return;
        }
        if (Main.overview.visible)
            Main.overview.hide();
        if (center.pin())
            search.open();
    }

    /**
     * GNOME's own shortcut for Quick Settings (Super+A by default, whatever
     * the user set in Settings -> Keyboard) simply calls
     * Main.panel.toggleQuickSettings(). Replace that one method so the same
     * shortcut opens the right island (kept open until pressed again or
     * Escape) instead of GNOME's popup. Falls back to GNOME's menu when the
     * island is off or hidden (fullscreen). Removed again in disable().
     */
    _takeOverQuickSettingsShortcut() {
        const panel = Main.panel;
        if (!panel || typeof panel.toggleQuickSettings !== 'function')
            return;
        this._hadOwnToggle = Object.prototype.hasOwnProperty.call(panel, 'toggleQuickSettings');
        this._origToggle = panel.toggleQuickSettings;
        panel.toggleQuickSettings = (...args) => {
            const qs = this._islands?.find(i => i._id === 'qs');
            if (this._settings?.get_boolean('shortcut-qs') && qs?.visible) {
                qs.togglePin();
                return undefined;
            }
            return this._origToggle.apply(panel, args);
        };
    }

    _restoreQuickSettingsShortcut() {
        if (!this._origToggle)
            return;
        if (this._hadOwnToggle)
            Main.panel.toggleQuickSettings = this._origToggle;
        else
            delete Main.panel.toggleQuickSettings;   // back to the prototype method
        this._origToggle = null;
    }

    /**
     * v2: the CPU / RAM / temperature / network / battery tiles moved from the
     * centre island to the new statistics island. A module list the user saved
     * overrides the schema default, so move those ids over (keeping the user's
     * order and choices) instead of silently dropping them.
     */
    _migrate() {
        const s = this._settings;
        const from = s.get_int('layout-version');
        if (from >= LAYOUT_VERSION)
            return;
        const userList = key => (s.get_user_value(key) ? s.get_strv(key) : null);

        if (from < 2) {
            const moved = key => {
                const cur = userList(key);
                if (!cur)
                    return [];   // never customised: the new defaults apply
                s.set_strv(key, cur.filter(id => !STAT_IDS.includes(id)));
                return cur.filter(id => STAT_IDS.includes(id));
            };
            const tiles = moved('center-modules');
            const compact = moved('center-compact-modules');
            if (tiles.length) {
                const defaults = s.get_default_value('stats-modules').deepUnpack();
                s.set_strv('stats-modules', [...tiles, ...defaults.filter(id => !tiles.includes(id))]);
            }
            if (compact.length)
                s.set_strv('stats-compact-modules', compact);
            console.log(`${LOG_PREFIX} settings migrated to layout v2: tiles [${tiles}] compact [${compact}]`);
        }

        if (from < 3) {
            // v3: disk activity indicator in the statistics pill, new events.
            // Lists the user saved would otherwise never include them.
            const add = (key, ids) => {
                const cur = userList(key);
                if (cur)
                    s.set_strv(key, [...cur, ...ids.filter(id => !cur.includes(id))]);
            };
            add('stats-compact-modules', ['disk']);
            add('events', ['lockkey', 'layout', 'meeting', 'powersaver']);
        }

        if (from < 4) {
            // v4: clipboard history section in the right island
            const cur = userList('qs-modules');
            if (cur && !cur.includes('clipboard')) {
                const at = cur.indexOf('system');   // keep the system row last
                s.set_strv('qs-modules', at >= 0 ? [...cur.slice(0, at), 'clipboard', ...cur.slice(at)] : [...cur, 'clipboard']);
            }
        }

        if (from < 5) {
            // v5: workspaces card (left island), sound output chooser (right island)
            const center = userList('center-modules');
            if (center && !center.includes('claude'))
                s.set_strv('center-modules', [...center, 'claude']);
            const stats = userList('stats-modules');
            if (stats && !stats.includes('workspaces'))
                s.set_strv('stats-modules', ['workspaces', ...stats]);
            const qs = userList('qs-modules');
            if (qs && !qs.includes('audio')) {
                const at = qs.indexOf('sliders');
                s.set_strv('qs-modules', at >= 0 ? [...qs.slice(0, at + 1), 'audio', ...qs.slice(at + 1)] : ['audio', ...qs]);
            }
        }
        if (from < 6) {
            // v6: per-app volume in the right island, after the output chooser
            const qs = userList('qs-modules');
            if (qs && !qs.includes('mixer')) {
                const after = qs.includes('audio') ? qs.indexOf('audio') : qs.indexOf('sliders');
                s.set_strv('qs-modules', after >= 0 ? [...qs.slice(0, after + 1), 'mixer', ...qs.slice(after + 1)] : ['mixer', ...qs]);
            }
        }
        s.set_int('layout-version', LAYOUT_VERSION);
    }

    _scheduleRebuild() {
        if (this._rebuildId)
            GLib.Source.remove(this._rebuildId);
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REBUILD_DEBOUNCE_MS, () => {
            this._rebuildId = 0;
            this._teardown();
            this._build(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Known module ids only; if none of the saved ones exist any more
     *  (renamed in an update), fall back to the schema default. */
    _modules(key, registry) {
        const saved = this._settings.get_strv(key);
        const known = saved.filter(id => registry[id]);
        if (known.length || !saved.length)
            return known;
        return this._settings.get_default_value(key).deepUnpack().filter(id => registry[id]);
    }

    _build(animateIn) {
        const cfg = readConfig(this._settings);
        setLanguage(cfg.language);
        // The clipboard store outlives island rebuilds (a setting change must not
        // wipe the history); it exists only while the setting is on.
        if (cfg.clipboardHistory && !this._clip)
            this._clip = new ClipboardStore(10);
        else if (!cfg.clipboardHistory && this._clip) {
            this._clip.destroy();
            this._clip = null;
        }
        const services = {clipboard: this._clip, caffeine: this._caffeine};
        cfg.centerModules = this._modules('center-modules', CENTER_MODULES);
        cfg.centerCompactModules = this._modules('center-compact-modules', CENTER_MODULES);
        cfg.qsModules = this._modules('qs-modules', QS_MODULES);
        cfg.statsModules = this._modules('stats-modules', STATS_MODULES);
        cfg.statsCompactModules = this._modules('stats-compact-modules', STATS_MODULES);
        let center = null, qs = null, stats = null;
        try {
            if (cfg.centerEnabled) {
                center = new Island({
                    id: 'center',
                    target: 'dateMenu',
                    align: 'center',
                    fixed: CENTER_FIXED,
                    registry: CENTER_MODULES,
                    compactIds: cfg.centerCompactModules,
                    expandedIds: cfg.centerModules,
                    mainOrientation: 'horizontal',   // calendar | notifications side by side
                    growOnly: true,
                    config: cfg,
                    animateIn,
                    services,
                });
                this._islands.push(center);
            }
            if (cfg.statsEnabled) {
                stats = new Island({
                    id: 'stats',
                    target: 'activities',
                    align: 'start',
                    fixed: STATS_FIXED,
                    registry: STATS_MODULES,
                    compactIds: cfg.statsCompactModules,
                    expandedIds: cfg.statsModules,
                    mainOrientation: 'horizontal',   // graphs | top processes
                    growOnly: true,
                    config: cfg,
                    animateIn,
                });
                this._islands.push(stats);
            }
            if (cfg.qsEnabled) {
                qs = new Island({
                    id: 'qs',
                    target: 'quickSettings',
                    align: 'end',
                    fixed: QS_FIXED,
                    registry: QS_MODULES,
                    compactIds: [],
                    expandedIds: cfg.qsModules,
                    mainOrientation: 'vertical',     // sliders / toggles / system stacked
                    growOnly: false,
                    config: cfg,
                    animateIn,
                    services,
                });
                this._islands.push(qs);
            }

            // OSD and notification previews live in the centre island; without
            // it GNOME's own OSD and banners are left alone.
            if (center && cfg.osdEnabled)
                this._features.push(new OsdRouter(center, cfg));
            if (center && cfg.notificationPreview)
                this._features.push(new NotificationPreview(center, cfg));
            // 80 % / 95 % warnings for the Claude plan quota (real data only)
            if (center && cfg.claudeRealUsage && cfg.claudeQuotaAlerts)
                this._features.push(new ClaudeQuotaWatch(center));
            // Claude Code hook -> D-Bus -> wavy orange notification
            if (center && cfg.claudeNotify) {
                try {
                    this._features.push(new ClaudeNotifier(center, cfg));
                } catch (e) {
                    console.warn(`${LOG_PREFIX} Claude notifications unavailable: ${e.message}`);
                }
            }
            // event indicators use whichever island exists (centre preferred)
            const host = center ?? stats ?? qs;
            if (host) {
                const hub = new EventHub(host, cfg);
                this._features.push(hub);
                // behaviours that report through the hub
                if (cfg.meetingMode)
                    this._features.push(new MeetingMode(hub, this._settings));
                if (cfg.autoPowerSaver)
                    this._features.push(new AutoPowerSaver(hub, cfg.autoPowerSaverLevel));
            }
        } catch (e) {
            console.error(`${LOG_PREFIX} building islands failed`, e);
        }
    }

    _teardown() {
        // Features first: they reference the islands.
        for (const f of (this._features ?? []).reverse()) {
            try {
                f.destroy();
            } catch (e) {
                console.error(`${LOG_PREFIX} feature teardown failed`, e);
            }
        }
        this._features = [];
        for (const island of this._islands ?? [])
            island.destroy();
        this._islands = [];
    }
}
