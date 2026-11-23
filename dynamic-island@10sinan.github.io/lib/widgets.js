// Small reusable building blocks for module UIs.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {BAR_W_COMPACT, BAR_W_TILE, EASE_SLIDE, GLIDE_MS} from './constants.js';

const DEFAULT_ACCENT = '#5ee6b5';

/**
 * Thin horizontal level bar: a track with a coloured fill.
 * The fill always has the full width and is scaled horizontally
 * (scale_x, pivot at the left edge): animating a transform never
 * triggers a relayout, unlike animating `width`.
 */
export class LevelBar {
    constructor(width, {compact = false, accent = DEFAULT_ACCENT, animMs = GLIDE_MS, height = null} = {}) {
        this._accent = accent;
        this._animMs = animMs;
        const h = height ?? (compact ? 4 : 5);
        this.actor = new St.Widget({
            style_class: 'di-bar-track',
            width,
            height: h,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({
            style_class: 'di-bar-fill',
            width,
            height: h,
            scale_x: 0,
        });
        this._fill.set_pivot_point(0, 0.5);
        this.actor.add_child(this._fill);
        this._frac = 0;
        this._sev = null;
        this._setSeverity('ok');
    }

    _setSeverity(sev) {
        if (sev === this._sev)
            return;
        if (this._sev && this._sev !== 'ok')
            this._fill.remove_style_class_name(`di-sev-${this._sev}`);
        if (sev === 'warn' || sev === 'crit') {
            this._fill.add_style_class_name(`di-sev-${sev}`);
            this._fill.set_style(null);
            this._sev = sev;
        } else {
            // "ok" uses the user's accent colour.
            this._fill.set_style(`background-color: ${this._accent};`);
            this._sev = 'ok';
        }
    }

    set(fraction, sev = 'ok') {
        const f = Math.max(0, Math.min(1, fraction));
        this._setSeverity(sev);
        if (Math.abs(f - this._frac) < 0.002)
            return;   // nothing visible would change
        this._frac = f;
        this._fill.ease({
            scale_x: f,
            duration: this._animMs,
            mode: EASE_SLIDE,
        });
    }
}

/**
 * A labelled meter.
 *  compact: [TITLE ▬▬ 23%] on one line
 *  tile:    TITLE / big value / bar / small sub-text, stacked
 * Options: {title, compact, bar (default true), accent}
 */
export class Meter {
    constructor({title, compact = false, bar = true, accent = DEFAULT_ACCENT}) {
        this._dead = false;

        this.actor = new St.BoxLayout({
            style_class: compact ? 'di-meter-compact' : 'di-tile',
            orientation: compact ? Clutter.Orientation.HORIZONTAL : Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: !compact,
        });
        // Actors die with the island; stop touching them after that.
        this.actor.connect('destroy', () => {
            this._dead = true;
        });
        this.actor.connect('notify::mapped', () => {
            if (this.actor.mapped && this._latest && !this._dead) {
                const args = this._latest;
                this._latest = null;
                this._apply(...args);
            }
        });

        this._title = new St.Label({style_class: 'di-title', text: title,
            y_align: Clutter.ActorAlign.CENTER});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._value = new St.Label({style_class: compact ? 'di-value-compact' : 'di-value',
            text: '–', y_align: Clutter.ActorAlign.CENTER});
        this._bar = bar
            ? new LevelBar(compact ? BAR_W_COMPACT : BAR_W_TILE, {compact, accent})
            : null;

        this.actor.add_child(this._title);
        if (compact) {
            if (this._bar)
                this.actor.add_child(this._bar.actor);
            this.actor.add_child(this._value);
        } else {
            this.actor.add_child(this._value);
            if (this._bar)
                this.actor.add_child(this._bar.actor);
            this._sub = new St.Label({style_class: 'di-sub', text: ''});
            this.actor.add_child(this._sub);
        }
    }

    update(valueText, fraction = 0, sev = 'ok', subText = null) {
        if (this._dead)
            return;
        // A meter that is not on screen (the tile of a collapsed island, or an island hidden
        // in fullscreen) is not touched: no text/relayout/animation for nothing. The newest
        // reading is applied the moment it shows up.
        if (!this.actor.mapped) {
            this._latest = [valueText, fraction, sev, subText];
            return;
        }
        this._latest = null;
        this._apply(valueText, fraction, sev, subText);
    }

    _apply(valueText, fraction, sev, subText) {
        // Setting identical text still queues a relayout; skip it.
        if (this._value.text !== valueText)
            this._value.text = valueText;
        this._bar?.set(fraction, sev);
        if (this._sub && subText !== null && this._sub.text !== subText)
            this._sub.text = subText;
    }

    setTitle(text) {
        if (!this._dead && this._title.text !== text)
            this._title.text = text;
    }
}
