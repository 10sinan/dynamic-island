// One island: actor tree, placement in a top-panel slot, morph animation,
// pointer handling, activities (OSD / notification previews) and the
// polling loop that feeds its modules.
// extension.js creates two of them: 'center' (clock) and 'qs' (Quick Settings).
//
// Actor tree — built so that animating never triggers a relayout of content:
//
//   hitbox  St.Widget (hover only, no click), tracked chrome. Resized only when a morph starts/ends,
//   │       so the shell recomputes the input region once, not every frame.
//   └ root  St.Widget (fixed layout, fills the hitbox)
//     ├ bg       childless St.Widget: the black pill. Only this is animated
//     │          (x / y / width / height); radius follows its height.
//     └ content  St.Widget, clipped to bg's rectangle every frame (paint only)
//       ├ compactBox   pill content in the panel
//       ├ expandedBox  big clock header, main row (calendar / controls), tiles
//       └ activityBox  OSD / notification view
//
// Every content box sits at its *final* position and only fades
// (offscreen-redirected, so a fade is one texture, not N children).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as C from './constants.js';
import {Disposer} from './disposer.js';
import {PanelSlot} from './panelSlot.js';
import {History} from './history.js';
import {hexToRgb, mix} from './color.js';
import {SpringGroup} from './spring.js';
import {perimeterPoints, perimeterLength, waveOffset} from './wave.js';
import Cairo from 'gi://cairo';

/** Single place for the island's diagnostics (errors only; nothing is logged in normal operation). */
const logIsland = {
    warn: (...a) => console.warn(...a),
    error: (...a) => console.error(...a),
};

function isCancelled(e) {
    return e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) ?? false;
}

const OUTLINE_MARGIN = 8;   // px around the pill for the wavy line + glow

function sameRect(a, b) {
    return a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export class Island {
    /**
     * @param {object} p
     * @param {string} p.id                 'center' | 'qs' (logs, style class)
     * @param {string} p.target             panel button to replace (PanelSlot target)
     * @param {'start'|'center'|'end'} p.align  stick to the slot's left edge, centre on it, or stick to its right edge
     * @param {Function[]} p.fixed          module classes always present (first)
     * @param {object} p.registry           id -> module class (configurable modules)
     * @param {string[]} p.compactIds       configurable modules shown in the pill
     * @param {string[]} p.expandedIds      configurable modules shown as tiles
     * @param {'horizontal'|'vertical'} p.mainOrientation  layout of the 'main' modules
     * @param {boolean} p.growOnly          compact width never shrinks (avoids jitter with digits)
     * @param {object} p.config             snapshot from lib/settings.js
     * @param {boolean} p.animateIn         play the appear animation
     * @param {object} [p.services]         long-lived helpers owned by the extension (clipboard history)
     */
    constructor(p) {
        this._id = p.id;
        this._align = p.align;
        this._mainVertical = p.mainOrientation === 'vertical';
        this._holds = 0;                  // >0: something (a slider drag) keeps the island open
        this._pinned = false;             // opened with the keyboard shortcut
        this._grab = null;
        this._pinIds = [];
        this._growOnly = p.growOnly;
        this._cfg = p.config;
        this._services = p.services ?? {};

        this._d = new Disposer();
        this._history = new History(120);
        this._borderColor = null;
        this._bodyTint = null;        // {a, b}: colours of the body gradient while music plays
        this._tintTarget = null;
        this._tintTl = null;
        this._destroyed = false;
        this._mode = 'compact';            // 'compact' | 'expanded' | 'activity'
        this._activity = null;
        this._ticking = false;
        this._modules = [];
        this._expandedActors = new Map();   // module -> its expanded actor (focus mode)
        this._compactModules = [];         // modules visible in the pill (ticked while compact)
        this._compactW = 0;
        this._radius = -1;
        this._rects = null;
        this._hb = null;
        this._failed = new Set();

        this._hoverTimer = this._d.timer();
        this._collapseTimer = this._d.timer();
        this._autoTimer = this._d.timer();
        this._pollTimer = this._d.timer();
        this._relayoutTimer = this._d.timer();
        this._slotTimer = this._d.timer();
        this._activityTimer = this._d.timer();
        this._cancellable = this._d.cancellable();

        this._buildActors();
        this._slot = new PanelSlot({
            target: p.target,
            onChanged: () => this._onSlotChanged(),
            onMenuToggled: open => this._onMenuToggled(open),
        });
        this._connectSignals();
        this._syncCompactWidth();
        this._settle();
        if (p.animateIn)
            this._appear();
        else
            this.actor.opacity = 255;

        this._initModules(p).catch(e => {
            if (!isCancelled(e))
                logIsland.error(`${C.LOG_PREFIX} [${this._id}] module init failed`, e);
        });
    }

    /** True while the normal expanded view is shown (used by tests/tools). */
    get _expanded() {
        return this._mode === 'expanded';
    }

    get mode() {
        return this._mode;
    }

    /** Stage rectangle of the compact pill (menuTheme uses it as animation origin). */
    get compactRect() {
        return this._rects?.compact ?? null;
    }

    get visible() {
        return !this._destroyed && this.actor.visible;
    }

    // ------------------------------------------------------------ actors

    _buildActors() {
        // Hover only: the island itself takes no clicks; controls inside it do.
        this.actor = new St.Widget({
            style_class: `di-hitbox di-hitbox-${this._id}`,
            reactive: true,
            track_hover: true,
            opacity: 0,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });
        // The shell destroys all its actors when it shuts down, BEFORE it disables
        // extensions. Timers that fire in between must not touch them.
        this._actorGone = false;
        this.actor.connect('destroy', () => {
            this._actorGone = true;
            for (const t of [this._hoverTimer, this._collapseTimer, this._autoTimer, this._pollTimer,
                this._relayoutTimer, this._slotTimer, this._activityTimer])
                t?.clear();
        });
        this._root = new St.Widget({x_expand: true, y_expand: true});
        this.actor.add_child(this._root);

        this._bg = new St.Widget({style_class: `di-island di-island-${this._id}`});
        this._content = new St.Widget();
        this._root.add_child(this._bg);
        this._root.add_child(this._content);

        const box = () => {
            const b = new St.Widget({layout_manager: new Clutter.BinLayout()});
            b.set_offscreen_redirect(Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY);
            this._content.add_child(b);
            return b;
        };

        // compact
        this._compactBox = box();
        this._compactRow = new St.BoxLayout({
            style_class: 'di-compact',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        this._placeholder = new St.Label({style_class: 'di-title', text: '• • •',
            y_align: Clutter.ActorAlign.CENTER});
        this._compactRow.add_child(this._placeholder);
        this._compactBox.add_child(this._compactRow);

        // expanded: [header row] then [tiles row], pinned to the top
        this._expandedBox = box();
        this._expandedBox.set({opacity: 0, visible: false});
        this._expandedInner = new St.BoxLayout({
            style_class: 'di-expanded',
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
        });
        this._headerRow = new St.BoxLayout({
            style_class: 'di-header-row',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        // full-width strip under the clock (music player card)
        this._bannerRow = new St.BoxLayout({style_class: 'di-banner-row', visible: false});
        this._mainRow = new St.BoxLayout({
            style_class: this._mainVertical ? 'di-main-col' : 'di-main-row',
            orientation: this._mainVertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
            visible: false,
        });
        this._tilesRow = new St.BoxLayout({style_class: 'di-expanded-row', visible: false});
        this._expandedInner.add_child(this._headerRow);
        this._expandedInner.add_child(this._bannerRow);
        this._expandedInner.add_child(this._mainRow);
        this._expandedInner.add_child(this._tilesRow);
        this._expandedBox.add_child(this._expandedInner);

        // activity (OSD / notification)
        this._activityBox = box();
        this._activityBox.set({opacity: 0, visible: false});
        this._activityInner = new St.Bin({
            style_class: 'di-activity',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
        });
        // Only an activity's own content is clickable (left: its action, right: dismiss).
        this._activityButton = new St.Button({
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            can_focus: false,
            x_expand: true,
            y_expand: true,
            child: this._activityInner,
        });
        this._activityBox.add_child(this._activityButton);

        // Above windows and the panel, hidden on fullscreen (like the panel).
        // GNOME 50: every tracked chrome actor is part of the input region
        // (the old `affectsInputRegion` param is gone and is rejected).
        // No struts: the expanded island overlays windows, it never pushes them.
        Main.layoutManager.addTopChrome(this.actor, {
            trackFullscreen: true,
            affectsStruts: false,
        });
    }

    _boxFor(mode) {
        return {compact: this._compactBox, expanded: this._expandedBox, activity: this._activityBox}[mode];
    }

    _appear() {
        this.actor.set_scale(0.7, 0.7);
        this.actor.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: C.APPEAR_MS,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    // ------------------------------------------------------------ signals

    _connectSignals() {
        const d = this._d;
        d.connect(this.actor, 'notify::hover', () => this._onHover());
        d.connect(this._activityButton, 'clicked', (_a, button) => this._onActivityClicked(button));

        // Radius + content clip follow the animated pill, every frame.
        d.connect(this._bg, 'notify::allocation', () => this._onBgChanged());

        d.connect(Main.layoutManager, 'monitors-changed', () => this._onSlotChanged());
        const panelBox = Main.layoutManager.panelBox;
        for (const sig of ['notify::height', 'notify::y', 'notify::visible'])
            d.connect(panelBox, sig, () => this._onSlotChanged());

        // Islands stay visible in the overview (the panel does too); keep them compact.
        d.connect(Main.overview, 'showing', () => this._collapseAll());

        // Fullscreen visibility is toggled by the layout manager.
        d.connect(this.actor, 'notify::visible', () => {
            if (this.actor.visible)
                this._kickPoll();
            else
                this._collapseAll(false);
        });
    }

    _onBgChanged() {
        const bg = this._bg;
        // T8: never let the radius exceed half the height, at any frame.
        const r = Math.max(0, Math.min(C.EXPANDED_RADIUS, Math.floor(bg.height / 2)));
        if (r !== this._radius) {
            this._radius = r;
            this._applyBgStyle();
        }
        // Clip content to the pill: paint-only, no relayout.
        this._content.set_clip(bg.x, bg.y, bg.width, bg.height);
        if (this._outline) {
            const m = OUTLINE_MARGIN;
            this._outline.set_position(bg.x - m, bg.y - m);
            this._outline.set_size(Math.max(1, bg.width + 2 * m), Math.max(1, bg.height + 2 * m));
        }
    }

    // ------------------------------------------------------------ wavy outline

    /**
     * An animated wavy line just outside the pill (Claude notifications).
     * @param {{color: number[], color2?: number[], amp?: number, speed?: number, wavelength?: number}|null} fx
     *   null fades it out and removes the actor (no cost while unused)
     */
    setOutlineEffect(fx) {
        if (this._destroyed || this._actorGone)
            return;
        if (!fx) {
            if (this._outlineFx)
                this._outlineFx.target = 0;
            return;
        }
        const prev = this._outlineFx;
        this._outlineFx = {amp: 2.2, speed: 1, wavelength: 30, color2: fx.color, ...fx,
            phase: prev?.phase ?? 0, alpha: prev?.alpha ?? 0, target: 1, grow: prev?.grow ?? 0};
        if (this._outline)
            return;
        const area = new St.DrawingArea({reactive: false});
        area.connect('repaint', () => this._paintOutline());
        this._root.insert_child_above(area, this._bg);
        this._outline = area;
        this._onBgChanged();
        let last = 0;
        const tl = new Clutter.Timeline({actor: area, duration: 60000, repeat_count: -1});
        tl.connect('new-frame', (_t, msecs) => {
            const o = this._outlineFx;
            if (!o || !this._outline)
                return;
            const dt = Math.max(0, Math.min(100, msecs - last)) / 1000;
            last = msecs > last ? msecs : 0;
            o.phase += dt * 2 * Math.PI / 1.6 * o.speed;   // one wave per ~1.6 s
            // fade in / out linearly (~0.3 s)
            o.alpha = o.target > o.alpha ? Math.min(o.target, o.alpha + dt / 0.3)
                : Math.max(o.target, o.alpha - dt / 0.3);
            o.grow = Math.min(1, o.grow + dt / 0.45);
            if (o.target === 0 && o.alpha <= 0.001) {
                this._removeOutline();
                return;
            }
            this._outline.queue_repaint();
        });
        this._outlineTl = tl;
        tl.start();
    }

    _removeOutline() {
        this._outlineTl?.stop();
        this._outlineTl = null;
        this._outline?.destroy();
        this._outline = null;
        this._outlineFx = null;
    }

    _paintOutline() {
        const o = this._outlineFx, area = this._outline;
        if (!o || !area)
            return;
        const cr = area.get_context();
        try {
            const m = OUTLINE_MARGIN;
            const w = this._bg.width, h = this._bg.height, rad = Math.max(0, this._radius);
            const total = perimeterLength(w, h, rad);
            const pts = perimeterPoints(w, h, rad, 3);
            if (pts.length < 8)
                return;
            // amplitude grows in with the notification, the line follows the morph every frame
            const amp = o.amp * (0.25 + 0.75 * o.grow);
            const path = () => {
                pts.forEach((p, i) => {
                    const off = 1.2 + waveOffset(p.s, total, o.phase, amp, o.wavelength);
                    const x = m + p.x + p.nx * off, y = m + p.y + p.ny * off;
                    if (i === 0)
                        cr.moveTo(x, y);
                    else
                        cr.lineTo(x, y);
                });
                cr.closePath();
            };
            const [r1, g1, b1] = o.color, [r2, g2, b2] = o.color2;
            const grad = (alpha) => {
                const g = new Cairo.LinearGradient(m, 0, m + w, 0);
                g.addColorStopRGBA(0, r1 / 255, g1 / 255, b1 / 255, alpha);
                g.addColorStopRGBA(0.5, r2 / 255, g2 / 255, b2 / 255, alpha);
                g.addColorStopRGBA(1, r1 / 255, g1 / 255, b1 / 255, alpha);
                return g;
            };
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            // soft glow, then the bright line
            path();
            cr.setSource(grad(0.22 * o.alpha));
            cr.setLineWidth(6);
            cr.stroke();
            path();
            cr.setSource(grad(0.95 * o.alpha));
            cr.setLineWidth(1.8);
            cr.stroke();
        } finally {
            cr.$dispose();
        }
    }

    _applyBgStyle() {
        if (!this._bg)
            return;
        const t = this._cfg.theme;
        // 0..1; 0 keeps the solid body, 1 is the most see-through
        const g = Math.max(0, Math.min(100, this._cfg.glassStrength ?? 0)) / 100;
        // the album colour (while music plays) wins over the theme's outline
        let edge = this._borderColor ?? (this.actor?.hover ? t.edgeHover : t.edge);
        // no backdrop blur: Shell.BlurEffect ignores rounded corners and
        // painted a square shadow around the pill, so keep it more opaque
        const alpha = 1 - 0.45 * g;
        const rgba = (c, a) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a.toFixed(3)})`;
        const bt = this._bodyTint;
        const base = bt ? bt.a : hexToRgb(t.bg);
        let body;
        if (g === 0) {
            body = bt
                ? `background-color: ${rgba(bt.a, 1)}; background-gradient-direction: horizontal; background-gradient-start: ${rgba(bt.a, 1)}; background-gradient-end: ${rgba(bt.b, 1)};`
                : `background-color: ${t.bg};`;
        } else if (bt) {
            body = `background-color: ${rgba(bt.a, alpha)}; background-gradient-direction: horizontal; background-gradient-start: ${rgba(bt.a, alpha)}; background-gradient-end: ${rgba(bt.b, alpha)};`;
        } else {
            // glass: a bright sheen at the top fading into the tinted body
            const top = mix(base, {r: 255, g: 255, b: 255}, 0.16 * g);
            body = `background-color: ${rgba(base, alpha)}; background-gradient-direction: vertical; background-gradient-start: ${rgba(top, Math.min(1, alpha + 0.10 * g))}; background-gradient-end: ${rgba(base, alpha)};`;
        }
        // lit rim: a white edge that gets brighter with the strength
        if (g > 0 && !this._borderColor)
            edge = `rgba(255, 255, 255, ${((this.actor?.hover ? 0.30 : 0.20) * (0.4 + 0.6 * g)).toFixed(3)})`;
        this._bg.set_style(`border-radius: ${Math.max(0, this._radius)}px; ${body} border-color: ${edge};`);
    }

    /**
     * Colour the whole body with a two-colour gradient (the album colours while
     * music plays); null fades back to the theme colour. The change glides
     * over 700 ms. Only the childless background widget is restyled per frame.
     * @param {{a: {r,g,b}, b: {r,g,b}}|null} target
     */
    setBodyTint(target) {
        if (this._destroyed)
            return;
        const theme = hexToRgb(this._cfg.theme.bg);
        const flat = {a: theme, b: theme};
        const to = target ?? flat;
        const cur = this._tintTarget ?? flat;
        const same = (x, y) => ['r', 'g', 'b'].every(k => x.a[k] === y.a[k] && x.b[k] === y.b[k]);
        if (same(cur, to))
            return;
        const from = this._bodyTint ?? flat;
        this._tintTarget = target;
        this._tintTl?.stop();
        const tl = new Clutter.Timeline({actor: this.actor, duration: 700});
        this._tintTl = tl;
        tl.connect('new-frame', () => {
            const p = tl.get_progress();
            const e = 1 - (1 - p) * (1 - p);   // ease-out
            this._bodyTint = {a: mix(from.a, to.a, e), b: mix(from.b, to.b, e)};
            this._applyBgStyle();
        });
        tl.connect('completed', () => {
            this._bodyTint = target ? to : null;
            this._applyBgStyle();
            if (this._tintTl === tl)
                this._tintTl = null;
        });
        tl.start();
    }

    /** Tint the pill's outline (e.g. with the album colour); null = default. */
    setAccentBorder(color) {
        if (this._destroyed || color === this._borderColor)
            return;
        this._borderColor = color;
        this._applyBgStyle();
    }

    _onHover() {
        this._applyBgStyle();   // outline brightens on hover
        if (this.actor.hover) {
            this._collapseTimer.clear();
            if (this._mode === 'activity') {
                this._activityTimer.clear();   // hovering freezes the activity
                return;
            }
            if (this._mode === 'expanded' || !this._cfg.expandOnHover || this._slot.menuOpen)
                return;
            if (this._cfg.hoverDelay <= 0) {
                this._setMode('expanded');     // instantly
            } else {
                this._hoverTimer.schedule(this._cfg.hoverDelay, () => {
                    if (this.actor.hover && !this._slot.menuOpen && this._mode === 'compact')
                        this._setMode('expanded');
                });
            }
        } else {
            this._hoverTimer.clear();
            if (this._pinned && !this._grab)
                this.unpin();   // no grab (another modal owned the input): hover rules apply
            if (this._mode === 'activity') {
                this._activityTimer.schedule(this._activity?.leaveMs ?? C.ACTIVITY_LEAVE_MS, () => this.endActivity());
            } else if (this._mode === 'expanded') {
                if (this._cfg.leaveDelay <= 0)
                    this._maybeCollapse();
                else
                    this._collapseTimer.schedule(this._cfg.leaveDelay, () => this._maybeCollapse());
            }
        }
    }

    _onActivityClicked(button) {
        if (this._mode !== 'activity')
            return;
        if (button !== Clutter.BUTTON_SECONDARY)
            this._activity?.onClick?.();
        this.endActivity(false);
    }

    /** A control inside the panel is being dragged (slider): keep the island open. */
    _hold(on) {
        this._holds = Math.max(0, this._holds + (on ? 1 : -1));
        if (this._holds === 0 && !this.actor.hover && this._mode === 'expanded')
            this._collapseTimer.schedule(Math.max(this._cfg.leaveDelay, 300), () => this._maybeCollapse());
    }

    /**
     * An extra widget at the end of the pill in the panel (Claude "working"
     * indicator). null removes it. The pill re-measures its width.
     */
    setCompactAccessory(actor) {
        if (this._destroyed)
            return;
        if (this._accessory && this._accessory !== actor) {
            const old = this._accessory;
            this._accessory = null;
            if (old.get_parent())
                old.destroy();
        }
        if (actor && actor.get_parent() !== this._compactRow) {
            this._accessory = actor;
            this._compactRow.add_child(actor);
        }
        this._requestRelayout(true);
    }

    /** A module of this island by id (e.g. 'search'), or null. */
    moduleById(id) {
        return this._modules.find(m => m.constructor.id === id) ?? null;
    }

    get pinned() {
        return this._pinned;
    }

    /**
     * Keyboard-opened (Super+A): expand and stay open until the shortcut is
     * pressed again, Escape is pressed, or something outside is clicked —
     * the way GNOME's own popup menus behave. A modal grab is needed for
     * that: on Wayland a focused window would otherwise swallow Escape.
     * @returns {boolean} false if the island is not visible (fullscreen)
     */
    pin() {
        if (this._destroyed || !this.actor.visible)
            return false;
        if (this._pinned)
            return true;
        if (this._activity)
            this._finishActivity();
        this._pinned = true;
        this._holds++;

        // Main.pushModal() always returns a grab (GNOME 50 has no seat-state
        // check); whatever happens, a grab we took must be popped again.
        try {
            this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        } catch (e) {
            logIsland.warn(`${C.LOG_PREFIX} [${this._id}] modal grab failed`, e);
            this._grab = null;
        }
        if (this._grab) {
            this.actor.grab_key_focus();
            this._pinIds = [
                [this.actor, this.actor.connect('key-press-event', (_a, event) => {
                    if (event.get_key_symbol() !== Clutter.KEY_Escape)
                        return Clutter.EVENT_PROPAGATE;
                    this.unpin();
                    this._maybeCollapse();
                    return Clutter.EVENT_STOP;
                })],
                [global.stage, global.stage.connect('captured-event', (_s, event) => {
                    const t = event.type();
                    if (t !== Clutter.EventType.BUTTON_PRESS && t !== Clutter.EventType.TOUCH_BEGIN)
                        return Clutter.EVENT_PROPAGATE;
                    const src = event.get_source();
                    if (src && this.actor.contains(src))
                        return Clutter.EVENT_PROPAGATE;   // inside: let the controls work
                    this.unpin();
                    this._maybeCollapse();
                    return Clutter.EVENT_STOP;           // the click only closes the island
                })],
            ];
        }
        this._setMode('expanded');
        return true;
    }

    _releasePin() {
        if (!this._pinned)
            return false;
        this._pinned = false;
        for (const [obj, id] of this._pinIds ?? []) {
            try {
                obj.disconnect(id);
            } catch {}
        }
        this._pinIds = [];
        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (e) {
                logIsland.warn(`${C.LOG_PREFIX} [${this._id}] modal release failed`, e);
            }
            this._grab = null;
        }
        this._holds = Math.max(0, this._holds - 1);
        return true;
    }

    unpin() {
        if (!this._releasePin())
            return;
        if (this._holds === 0 && !this.actor.hover && this._mode === 'expanded')
            this._collapseTimer.schedule(Math.max(this._cfg.leaveDelay, 120), () => this._maybeCollapse());
    }

    togglePin() {
        if (this._pinned) {
            this.unpin();
            this._maybeCollapse();   // close right away on the second press
        } else {
            this.pin();
        }
    }

    _maybeCollapse() {
        if (this._holds > 0 || this.actor.hover)
            return;
        this._setMode('compact');
    }

    _onMenuToggled(open) {
        if (open) {
            this._hoverTimer.clear();
            this._collapseAll();
        }
    }

    _onAutoCollapse() {
        // Never collapse from under the pointer; check again later.
        if (this.actor.hover || this._holds > 0) {
            this._autoTimer.schedule(this._cfg.autoCollapse, () => this._onAutoCollapse());
            return;
        }
        this._setMode('compact');
    }

    /** Coalesce slot/panel changes into one placement per frame (T7). */
    _onSlotChanged() {
        if (!this._destroyed && !this._actorGone)
            this._slotTimer.schedule(0, () => this._place());
    }

    _place() {
        if (this._destroyed || this._actorGone)
            return;
        // Don't fight a running morph; its onComplete settles with fresh geometry.
        if (this._springTl) {
            this._refineSpringTarget();   // steer the running morph instead
            return;
        }
        this._settle();
    }

    _requestExpandedRelayout() {
        if (!this._destroyed && this._mode === 'expanded')
            this._relayoutTimer.schedule(16, () => this._setMode('expanded'));
    }

    /** Modules call this (via ctx) when their compact content changed size. */
    _requestRelayout(shrink = false) {
        if (!this._destroyed) {
            this._relayoutTimer.schedule(50, () => {
                if (shrink)
                    this._compactW = 0;   // grow-only islands may shrink after a removal
                if (this._syncCompactWidth())
                    this._onSlotChanged();
            });
        }
    }

    // ------------------------------------------------------------ geometry

    /** Updates the compact width (and the panel slot); returns true if it changed. */
    _syncCompactWidth() {
        const [, natural] = this._compactRow.get_preferred_width(-1);
        let w = Math.max(C.COMPACT_MIN_W, Math.ceil((natural + C.BORDER) / 2) * 2);
        if (this._growOnly)
            w = Math.max(w, this._compactW);
        const changed = w !== this._compactW;
        this._compactW = w;
        this._slot?.reserve(w + C.SLOT_MARGIN);
        return changed;
    }

    _frame() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return null;
        const anchor = this._slot.anchor();
        if (anchor) {
            // Inside the panel, exactly where the original button was.
            return {
                monitor,
                anchorX: this._align === 'end'
                    ? anchor.x + anchor.width - C.SLOT_MARGIN / 2
                    : this._align === 'start'
                        ? anchor.x + C.SLOT_MARGIN / 2
                        : anchor.centerX,
                outerTop: anchor.top,
                top: anchor.top + C.PANEL_INSET,
                compactH: Math.max(18, anchor.height - 2 * C.PANEL_INSET),
            };
        }
        // No slot (panel hidden / button removed): float at the top edge.
        return {
            monitor,
            anchorX: this._align === 'end'
                ? monitor.x + monitor.width - C.FLOAT_GAP
                : this._align === 'start'
                    ? monitor.x + C.FLOAT_GAP
                    : monitor.x + monitor.width / 2,
            outerTop: monitor.y,
            top: monitor.y + C.FLOAT_GAP,
            compactH: C.FLOAT_H,
        };
    }

    _rectAt(w, h, f) {
        let x = this._align === 'end' ? f.anchorX - w : this._align === 'start' ? f.anchorX : f.anchorX - w / 2;
        const minX = f.monitor.x + C.SCREEN_MARGIN;
        const maxX = f.monitor.x + f.monitor.width - w - C.SCREEN_MARGIN;
        x = Math.min(maxX, Math.max(minX, x));
        return {x: Math.round(x), y: Math.round(f.top), w: Math.round(w), h: Math.round(h)};
    }

    _naturalRect(inner, minW, f) {
        const [, nw] = inner.get_preferred_width(-1);
        const [, nh] = inner.get_preferred_height(nw);
        return this._rectAt(Math.max(minW, Math.ceil(nw) + C.BORDER),
            Math.max(f.compactH, Math.ceil(nh) + C.BORDER), f);
    }

    _computeRects(f) {
        const rects = {compact: this._rectAt(this._compactW, f.compactH, f)};
        rects.expanded = this._naturalRect(this._expandedInner, C.EXPANDED_MIN_W, f);
        if (this._activity)
            rects.activity = this._naturalRect(this._activityInner, C.ACTIVITY_MIN_W, f);
        return rects;
    }

    /** Hit box = union of pills + the gap above (up to the panel edge) + side slack. */
    _hitboxFor(rects, f) {
        const side = C.HIT_SLACK_X;
        const minX = Math.min(...rects.map(r => r.x)) - side;
        const maxX = Math.max(...rects.map(r => r.x + r.w)) + side;
        const bottom = Math.max(...rects.map(r => r.y + r.h));
        const y = Math.round(f.outerTop);
        return {x: minX, y, w: maxX - minX, h: bottom - y};
    }

    _setHitbox(hb) {
        if (![hb.x, hb.y, hb.w, hb.h].every(Number.isFinite))
            return;   // never hand NaN to Clutter
        if (!sameRect(hb, this._hb)) {
            this._hb = hb;
            this.actor.set_position(hb.x, hb.y);
            this.actor.set_size(hb.w, hb.h);
            this._root.set_size(hb.w, hb.h);
            this._content.set_size(hb.w, hb.h);
        }
        // Content boxes sit at their final positions inside the hit box.
        for (const [mode, box] of [['compact', this._compactBox],
            ['expanded', this._expandedBox], ['activity', this._activityBox]]) {
            const r = this._rects[mode];
            if (!r)
                continue;
            box.set_position(r.x - hb.x, r.y - hb.y);
            box.set_size(r.w, r.h);
        }
    }

    /** Snap to the current mode's geometry (no animation). */
    _settle() {
        const f = this._frame();
        if (!f)
            return;
        this._rects = this._computeRects(f);
        const to = this._rects[this._mode] ?? this._rects.compact;
        if (![to.x, to.y, to.w, to.h].every(Number.isFinite))
            return;
        this._setHitbox(this._hitboxFor([to], f));
        this._bg.set_position(to.x - this._hb.x, to.y - this._hb.y);
        this._bg.set_size(to.w, to.h);
        // T2: the shadow only exists while the pill is still.
        if (this._mode === 'compact')
            this._bg.remove_style_class_name('di-settled');
        else
            this._bg.add_style_class_name('di-settled');
    }

    /** Morph the pill to `mode`. */
    _setMode(mode, animate = true) {
        if (this._destroyed)
            return;
        const prev = this._mode;
        if (prev === mode && mode === 'compact')
            return;   // expanded / activity: same mode = re-measure (content changed size)
        const f = this._frame();
        if (!f)
            return;
        this._mode = mode;

        // Where the pill is right now (mid-animation values included).
        const from = this._hb
            ? {x: this._hb.x + this._bg.x, y: this._hb.y + this._bg.y, w: this._bg.width, h: this._bg.height}
            : null;
        this._rects = this._computeRects(f);
        const to = this._rects[mode];

        const growing = mode !== 'compact';
        const duration = growing ? this._cfg.expandMs : Math.min(C.COLLAPSE_MS, this._cfg.expandMs);
        const animating = animate && duration > 0 && from && !sameRect(from, to);

        this._bg.remove_all_transitions();
        this._bg.remove_style_class_name('di-settled');
        if (animating) {
            // Hit box covers start and end for the whole morph.
            this._setHitbox(this._hitboxFor([from, to], f));
            this._springTo(from, to, growing, duration, mode);
        } else {
            this._stopSpring();
            this._settle();
        }

        // Cross-fade the content boxes (each already at its final place).
        for (const m of ['compact', 'expanded', 'activity']) {
            const box = this._boxFor(m);
            const show = m === mode;
            box.remove_all_transitions();
            if (!animate) {
                box.opacity = show ? 255 : 0;
                box.visible = show;
            } else if (show) {
                box.show();
                box.ease({
                    opacity: 255,
                    delay: prev === mode ? 0 : C.FADE_IN_DELAY_MS,
                    duration: C.FADE_IN_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else if (box.visible) {
                box.ease({
                    opacity: 0,
                    duration: C.FADE_OUT_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        if (!this._destroyed && this._mode !== m)
                            box.hide();
                    },
                });
            }
        }

        if (prev === 'expanded' && mode !== 'expanded') {
            for (const m of this._modules) {
                try {
                    m.onHidden?.();
                } catch (e) {
                    logIsland.warn(`${C.LOG_PREFIX} [${this._id}] onHidden failed`, e);
                }
            }
        }
        if (mode === 'expanded' && prev !== 'expanded') {
            for (const m of this._modules) {
                try {
                    m.onShown?.();
                } catch (e) {
                    logIsland.warn(`${C.LOG_PREFIX} [${this._id}] onShown failed`, e);
                }
            }
        }
        if (mode === 'expanded') {
            if (this._cfg.autoCollapse > 0)
                this._autoTimer.schedule(this._cfg.autoCollapse, () => this._onAutoCollapse());
            // T3: refresh after the morph, not during it.
            if (!this._ticking)
                this._pollTimer.schedule(animating ? duration : 0, () => this._tick());
        } else {
            this._autoTimer.clear();
            if (mode === 'compact')
                this._collapseTimer.clear();
        }
    }

    // ------------------------------------------------------------ spring morph

    /**
     * Drive the pill with a damped spring (lib/spring.js). A morph that starts
     * while another is running keeps the pill's current speed, so quick
     * hover in/out turns around smoothly instead of jumping.
     */
    _springTo(from, to, growing, durationMs, mode) {
        const g = this._springs ??= new SpringGroup(['x', 'y', 'w', 'h']);
        const bouncy = this._cfg.spring;
        // response ~ the configured duration; growing may bounce a little,
        // collapsing barely does (it should feel like it snaps shut).
        g.configure(durationMs / 1000 * (growing ? 1.0 : 0.9),
            growing ? (bouncy ? C.SPRING_DAMPING : 1) : (bouncy ? C.SPRING_DAMPING_COLLAPSE : 1));
        if (!this._springTl)
            g.reset(from);
        g.retarget(to);
        this._blurTarget = this._cfg.morphBlur ? this._boxFor(mode) : null;
        this._blurT0 = GLib.get_monotonic_time();
        this._blurMs = Math.max(160, durationMs * C.MORPH_BLUR_SHARE);
        this._setupBlur();

        if (this._springTl)
            return;
        let last = 0, n = 0;
        const tl = new Clutter.Timeline({actor: this._bg, duration: 60000});
        tl.connect('new-frame', (_t, msecs) => {
            if (this._destroyed || this._actorGone)
                return;
            const dt = Math.max(0, msecs - last) / 1000;
            last = msecs;
            const v = g.step(dt);
            const hb = this._hb;
            this._bg.set_position(v.x - hb.x, v.y - hb.y);
            this._bg.set_size(Math.max(1, v.w), Math.max(1, v.h));
            this._updateBlur();
            // content measured after the morph started (modules filling in
            // on show): follow the real size, keeping the current speed
            if (++n % 3 === 0 && this._refineSpringTarget())
                return;
            if (g.resting)
                this._finishSpring();
        });
        // the timeline's own end is only a safety net; resting ends it first
        tl.connect('completed', () => this._finishSpring());
        this._springTl = tl;
        tl.start();
    }

    /** Re-measure the target of a running morph. True if it moved. */
    _refineSpringTarget() {
        const g = this._springs;
        const f = this._frame();
        if (!g || !f || !this._springTl)
            return false;
        const rects = this._computeRects(f);
        const to = rects[this._mode];
        if (!to || ![to.x, to.y, to.w, to.h].every(Number.isFinite))
            return false;
        const t = g.targets();
        if (sameRect(to, {x: t.x, y: t.y, w: t.w, h: t.h}))
            return false;
        const v = g.values();
        this._rects = rects;
        this._setHitbox(this._hitboxFor([{x: v.x, y: v.y, w: v.w, h: v.h}, to], f));
        g.retarget(to, true);
        return true;
    }

    _finishSpring() {
        if (!this._springTl)
            return;
        this._stopSpring();
        if (!this._destroyed && !this._actorGone)
            this._settle();
    }

    _stopSpring() {
        const tl = this._springTl;
        this._springTl = null;
        tl?.stop();
        this._clearBlur();
    }

    // iOS-like: content is blurred while the pill changes shape and sharpens
    // as it arrives; the outgoing content blurs away as it fades.
    _setupBlur() {
        if (!this._blurTarget) {
            this._clearBlur();
            return;
        }
        for (const m of ['compact', 'expanded', 'activity']) {
            const box = this._boxFor(m);
            if (!box.get_effect('di-blur'))
                box.add_effect_with_name('di-blur', new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, brightness: 1, radius: 0}));
        }
        this._updateBlur();
    }

    _updateBlur() {
        if (!this._blurTarget)
            return;
        // time-based: the spring covers most of the distance early, the
        // blur should still read as part of the motion
        const p = Math.max(0, Math.min(1, (GLib.get_monotonic_time() - this._blurT0) / 1000 / this._blurMs));
        for (const m of ['compact', 'expanded', 'activity']) {
            const box = this._boxFor(m);
            const fx = box.get_effect('di-blur');
            if (!fx)
                continue;
            const incoming = box === this._blurTarget;
            // ease-out on the way in: sharp well before the bounce settles
            const amount = incoming ? (1 - p) ** 1.6 : Math.min(1, p * 3);
            const r = Math.round(C.MORPH_BLUR * amount);
            if (fx.radius !== r)
                fx.radius = r;
        }
    }

    _clearBlur() {
        this._blurTarget = null;
        for (const m of ['compact', 'expanded', 'activity'])
            this._boxFor(m)?.remove_effect_by_name('di-blur');
    }

    /** Back to compact, dropping any activity. */
    _collapseAll(animate = true) {
        this._releasePin();
        if (this._activity)
            this._finishActivity();
        this._setMode('compact', animate);
    }

    // ------------------------------------------------------------ activities

    /**
     * Temporarily morph into a custom view (OSD, notification preview).
     * Same key while showing -> update in place, no new animation.
     * @returns {boolean} false if not shown (hidden island, menu open, lower priority)
     */
    showActivity(key, {build, update, duration, priority = 0, onClick, onEnd, leaveMs}, data) {
        if (this._destroyed || !this.actor.visible || this._slot.menuOpen)
            return false;
        const cur = this._activity;
        if (cur && cur.key === key) {
            cur.update?.(data);
            this._armActivityTimer(duration);
            this._setMode('activity');   // re-measures; animates only if the size changed
            return true;
        }
        if (cur && cur.priority > priority)
            return false;
        if (cur)
            this._finishActivity();

        this._hoverTimer.clear();
        this._collapseTimer.clear();
        // Destroy the previous view BEFORE building the next one: modules keep
        // references to their view's widgets and clear them when it is
        // destroyed, which must not hit the new view.
        this._activityInner.get_child()?.destroy();
        this._activityInner.set_child(build());

        this._activity = {key, priority, update, onClick, onEnd, leaveMs};
        update?.(data);
        this._setMode('activity');
        this._armActivityTimer(duration);
        return true;
    }

    _armActivityTimer(duration) {
        if (this._activity)
            this._activity.duration = duration;
        if (this.actor.hover)
            this._activityTimer.clear();
        else
            this._activityTimer.schedule(duration, () => this.endActivity());
    }

    /** End the current activity (or only if it has `key`). */
    endActivity(keyOrAnimate = true) {
        const key = typeof keyOrAnimate === 'string' ? keyOrAnimate : null;
        if (!this._activity || (key && this._activity.key !== key))
            return;
        this._finishActivity();
        const back = this.actor.hover && this._cfg.expandOnHover && !this._slot.menuOpen
            ? 'expanded' : 'compact';
        this._setMode(back);
    }

    get activityKey() {
        return this._activity?.key ?? null;
    }

    _finishActivity() {
        const a = this._activity;
        this._activity = null;
        this._activityTimer.clear();
        try {
            a?.onEnd?.();
        } catch (e) {
            logIsland.warn(`${C.LOG_PREFIX} [${this._id}] activity onEnd failed`, e);
        }
    }

    // ------------------------------------------------------------ modules / polling

    async _initModules(p) {
        const ctx = {
            cancellable: this._cancellable,
            config: this._cfg,
            panelSlot: this._slot,
            requestRelayout: shrink => this._requestRelayout(shrink),
            // temporary view in the island (track change popup)
            showActivity: (key, spec, data) => this.showActivity(key, spec, data),
            endActivity: key => this.endActivity(key),
            // panel content changed size (lists, sub-pages): re-measure + morph
            requestExpandedRelayout: () => this._requestExpandedRelayout(),
            services: this._services,
            isExpanded: () => this._mode === 'expanded',
            history: this._history,
            setAccentBorder: c => this.setAccentBorder(c),
            setBodyTint: t => this.setBodyTint(t),
            holdOpen: on => this._hold(on),
            collapse: () => this._collapseAll(),
            // a module takes the whole expanded view (Wi-Fi / Bluetooth pages):
            // every other module's expanded content is hidden until focus(null)
            focus: m => this._focusModule(m),
        };

        // fixed modules + every configurable module referenced by the settings,
        // once each (unknown ids from the settings are ignored with a warning).
        const ids = [...new Set([...p.expandedIds, ...p.compactIds])].filter(id => {
            if (p.registry[id])
                return true;
            logIsland.warn(`${C.LOG_PREFIX} [${this._id}] unknown module "${id}" in settings`);
            return false;
        });
        const entries = [
            ...p.fixed.map(M => ({M, fixed: true})),
            ...ids.map(id => ({M: p.registry[id], fixed: false})),
        ];
        const all = entries.map(e => ({...e, m: new e.M(ctx)}));
        this._modules = all.map(e => e.m);   // so destroy() reaches them even mid-init

        const results = await Promise.allSettled(all.map(e => e.m.init()));
        if (this._destroyed)
            return;

        const usable = [];
        results.forEach((r, i) => {
            const {m} = all[i];
            if (r.status === 'rejected') {
                if (!isCancelled(r.reason))
                    logIsland.warn(`${C.LOG_PREFIX} [${this._id}] module ${m.constructor.id} disabled: ${r.reason}`);
                m.destroy();
            } else if (!m.available) {
                m.destroy();
            } else {
                usable.push(all[i]);
            }
        });
        this._modules = usable.map(e => e.m);

        this._placeholder.destroy();
        this._placeholder = null;

        const compactSet = new Set();
        const byId = new Map(usable.filter(e => !e.fixed).map(e => [e.m.constructor.id, e.m]));
        // Header + compact + tiles of the fixed modules come first.
        for (const {m, fixed} of usable) {
            if (!fixed)
                continue;
            const header = m.buildHeader();
            if (header) {
                this._headerRow.add_child(header);
                this._headerRow.show();
            }
            const compact = m.buildCompact();
            if (compact) {
                this._compactRow.add_child(compact);
                compactSet.add(m);
            }
            const tile = m.buildExpanded();
            if (tile) {
                const slot = m.constructor.slot;
                const row = slot === 'banner' ? this._bannerRow : slot === 'main' ? this._mainRow : this._tilesRow;
                this._expandedActors.set(m, tile);
                row.add_child(tile);
                row.show();
            }
        }
        // Then the configurable ones, each list in its own configured order.
        for (const id of p.compactIds) {
            const m = byId.get(id);
            const compact = m?.buildCompact();
            if (compact) {
                this._compactRow.add_child(compact);
                compactSet.add(m);
            }
        }
        for (const id of p.expandedIds) {
            const m = byId.get(id);
            const actor = m?.buildExpanded();
            if (!actor)
                continue;
            // 'main' modules (calendar, notification list, QS controls) go in
            // the main row; small metric tiles in the tiles row below it.
            const slot = m.constructor.slot;
            const row = slot === 'banner' ? this._bannerRow : slot === 'main' ? this._mainRow : this._tilesRow;
            this._expandedActors.set(m, actor);
            row.add_child(actor);
            row.show();   // an empty row has no size; modules hide their own actor
        }
        this._compactModules = this._modules.filter(m => compactSet.has(m));

        this._syncCompactWidth();
        this._settle();
        this._kickPoll();
    }

    _focusModule(module) {
        if (this._destroyed)
            return;
        if (module) {
            this._focusHidden ??= new Map();
            for (const [m, actor] of this._expandedActors) {
                if (m === module || this._focusHidden.has(actor))
                    continue;
                this._focusHidden.set(actor, actor.visible);
                actor.hide();
            }
            // header (big clock) and tiles hide too, for a clean page
            for (const row of [this._headerRow, this._tilesRow]) {
                if (!this._focusHidden.has(row)) {
                    this._focusHidden.set(row, row.visible);
                    row.hide();
                }
            }
        } else if (this._focusHidden) {
            for (const [actor, was] of this._focusHidden) {
                try {
                    actor.visible = was;
                } catch {}   // destroyed meanwhile
            }
            this._focusHidden = null;
        }
        this._requestExpandedRelayout();
    }

    /** Run a tick now unless one is already running. */
    _kickPoll() {
        if (!this._destroyed && !this._ticking)
            this._pollTimer.schedule(0, () => this._tick());
    }

    async _tick() {
        if (this._destroyed || this._actorGone || this._ticking)
            return;
        this._ticking = true;
        try {
            // T5: while compact only the modules visible in the pill are refreshed.
            const targets = this._mode === 'expanded'
                ? this._modules
                : [...new Set([...this._compactModules, ...this._modules.filter(m => m.constructor.background)])];
            if (this.actor.visible && targets.length) {
                const results = await Promise.allSettled(targets.map(m => m.tick()));
                if (this._destroyed)
                    return;
                results.forEach((r, i) => {
                    const id = targets[i]?.constructor.id;
                    if (r.status === 'rejected' && !isCancelled(r.reason) && !this._failed.has(id)) {
                        this._failed.add(id);   // report once, keep trying silently
                        logIsland.warn(`${C.LOG_PREFIX} [${this._id}] module ${id} tick failed: ${r.reason}`);
                    }
                });
                // Content got wider/narrower: resize pill + panel slot.
                if (this._syncCompactWidth() && this._mode === 'compact')
                    this._onSlotChanged();
            }
        } finally {
            this._ticking = false;
        }
        // Self-scheduling: the next tick starts only after this one finished.
        if (!this._destroyed) {
            this._pollTimer.schedule(
                this._mode === 'expanded' ? this._cfg.pollExpanded : this._cfg.pollCompact,
                () => this._tick());
        }
    }

    // ------------------------------------------------------------ teardown

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._tintTl?.stop();
        this._tintTl = null;
        this._releasePin();
        this._activity = null;

        for (const m of this._modules) {
            try {
                m.destroy();
            } catch (e) {
                logIsland.warn(`${C.LOG_PREFIX} [${this._id}] module destroy failed`, e);
            }
        }
        this._modules = [];
        this._expandedActors.clear();
        this._focusHidden = null;
        this._compactModules = [];
        this._history.clear();

        // Disconnect signals, clear timers, cancel in-flight I/O.
        this._d.dispose();
        this._d = null;

        // Give the panel its button back (opacity + natural width).
        this._slot.destroy();
        this._slot = null;

        this._stopSpring();
        this._removeOutline();
        this._bg.remove_all_transitions();
        this.actor.remove_all_transitions();
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();   // destroys all child actors too

        this.actor = null;
        this._root = this._bg = this._content = null;
        this._compactBox = this._compactRow = this._placeholder = null;
        this._expandedBox = this._expandedInner = this._headerRow = this._tilesRow = this._mainRow = this._bannerRow = null;
        this._activityButton = null;
        this._activityBox = this._activityInner = null;
        this._cancellable = null;
        this._hoverTimer = this._collapseTimer = this._autoTimer = null;
        this._pollTimer = this._relayoutTimer = this._slotTimer = this._activityTimer = null;
    }
}
