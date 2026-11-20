// Menu-bar style status glyphs, drawn with Cairo: Wi-Fi fan, speaker, Bluetooth
// rune, Do Not Disturb moon and a rounded battery. All are original shapes
// (nothing copied from an icon set), drawn white on the dark island, with
// round caps and joins, on a 16 px line so they sit together like the icons
// of a desktop menu bar.
import Cairo from 'gi://cairo';
import St from 'gi://St';

import {batteryColor} from './glyphLogic.js';

export {batteryColor, volumeLevel, wifiLevel} from './glyphLogic.js';

const TAU = Math.PI * 2;
export const GLYPH_H = 16;

// ---------------------------------------------------------------- drawing

function roundRect(cr, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    cr.newSubPath();
    cr.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
    cr.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
    cr.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
    cr.arc(x + rr, y + rr, rr, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

const DIM = 0.30;   // the unlit parts of a glyph

const DRAW = {
    // Wi-Fi: a dot and three arcs fanning up from it; lit arcs = signal
    wifi(cr, w, h, {level = 3, off = false}) {
        const cx = w / 2, cy = h - 2;
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(1.9);
        [4.6, 8.4, 12.2].forEach((r, i) => {
            cr.setSourceRGBA(1, 1, 1, !off && level > i ? 1 : DIM);
            cr.arc(cx, cy, r, -Math.PI * 0.75, -Math.PI * 0.25);
            cr.stroke();
        });
        cr.setSourceRGBA(1, 1, 1, off ? DIM : 1);
        cr.arc(cx, cy, 1.7, 0, TAU);
        cr.fill();
        if (off) {   // disabled: a slash
            cr.setSourceRGBA(1, 1, 1, 0.9);
            cr.moveTo(2.5, 2.5);
            cr.lineTo(w - 2.5, h - 1.5);
            cr.stroke();
        }
    },

    // wired network: a socket with its contacts
    wired(cr, w, h) {
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.setLineWidth(1.6);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        roundRect(cr, 2.5, 3.5, w - 5, h - 8, 2.4);
        cr.stroke();
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (const x of [6.2, 9.5, 12.8]) {
            cr.moveTo(x, 6.5);
            cr.lineTo(x, 9.2);
        }
        cr.stroke();
        cr.moveTo(w / 2, h - 4.5);
        cr.lineTo(w / 2, h - 1.8);
        cr.stroke();
    },

    // speaker with 0-3 sound waves, or a cross when muted
    volume(cr, w, h, {level = 3, muted = false}) {
        const cy = h / 2;
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.setLineWidth(1.2);
        cr.moveTo(1.6, cy - 2.6);
        cr.lineTo(4.4, cy - 2.6);
        cr.lineTo(8.4, cy - 6);
        cr.lineTo(8.4, cy + 6);
        cr.lineTo(4.4, cy + 2.6);
        cr.lineTo(1.6, cy + 2.6);
        cr.closePath();
        cr.fillPreserve();
        cr.stroke();
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(1.8);
        if (muted) {
            cr.setSourceRGBA(1, 1, 1, 0.95);
            cr.moveTo(11.6, cy - 3.2);
            cr.lineTo(16.8, cy + 3.2);
            cr.moveTo(16.8, cy - 3.2);
            cr.lineTo(11.6, cy + 3.2);
            cr.stroke();
            return;
        }
        [3.6, 6.4, 9.2].forEach((r, i) => {
            cr.setSourceRGBA(1, 1, 1, level > i ? 1 : DIM);
            cr.arc(8.6, cy, r, -Math.PI * 0.27, Math.PI * 0.27);
            cr.stroke();
        });
    },

    // the Bluetooth rune
    bluetooth(cr, w, h) {
        const x = v => 1.2 + v * (w - 2.4), y = v => 1 + v * (h - 2);
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.setLineWidth(1.7);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.moveTo(x(0.02), y(0.3));
        cr.lineTo(x(1.0), y(0.72));
        cr.lineTo(x(0.5), y(1.0));
        cr.lineTo(x(0.5), y(0.0));
        cr.lineTo(x(1.0), y(0.28));
        cr.lineTo(x(0.02), y(0.7));
        cr.stroke();
    },

    // Do Not Disturb: a crescent moon (a disc with a second disc cut out)
    dnd(cr, w, h) {
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.arc(w / 2 - 0.5, h / 2, 6, 0, TAU);
        cr.fill();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.arc(w / 2 + 3.4, h / 2 - 2.8, 5.2, 0, TAU);
        cr.fill();
        cr.setOperator(Cairo.Operator.OVER);
    },

    // Keep awake: a small sun (disc + eight short rays)
    awake(cr, w, h) {
        const cx = w / 2, cy = h / 2;
        cr.setSourceRGBA(1, 1, 1, 1);
        cr.arc(cx, cy, 3.1, 0, TAU);
        cr.fill();
        cr.setLineWidth(1.3);
        cr.setLineCap(Cairo.LineCap.ROUND);
        for (let i = 0; i < 8; i++) {
            const a = i * TAU / 8;
            cr.moveTo(cx + Math.cos(a) * 5.0, cy + Math.sin(a) * 5.0);
            cr.lineTo(cx + Math.cos(a) * 6.6, cy + Math.sin(a) * 6.6);
            cr.stroke();
        }
    },

    // rounded body, rounded fill that follows the charge, small terminal
    battery(cr, w, h, {pct = 100, charging = false}) {
        const bodyW = w - 3.2, bodyH = 10, top = (h - bodyH) / 2;
        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 1, 1, 0.5);
        roundRect(cr, 0.5, top + 0.5, bodyW - 1, bodyH - 1, 3);
        cr.stroke();
        // terminal
        roundRect(cr, bodyW + 0.6, h / 2 - 1.9, 1.7, 3.8, 0.9);
        cr.fill();

        // fill: inset 2 px, never narrower than a round dot so low charge is still visible
        const inner = bodyW - 4;
        const fillW = Math.max(2.6, inner * Math.max(0, Math.min(100, pct)) / 100);
        const [r, g, b] = batteryColor(pct, charging);
        cr.setSourceRGBA(r, g, b, 1);
        roundRect(cr, 2, top + 2, fillW, bodyH - 4, 1.6);
        cr.fill();

        if (charging) {   // bolt cut into the fill
            const cx = bodyW / 2, cy = h / 2;
            cr.setOperator(Cairo.Operator.CLEAR);
            cr.moveTo(cx + 1.1, cy - 3.8);
            cr.lineTo(cx - 2.7, cy + 0.6);
            cr.lineTo(cx - 0.3, cy + 0.6);
            cr.lineTo(cx - 1.1, cy + 3.8);
            cr.lineTo(cx + 2.7, cy - 0.6);
            cr.lineTo(cx + 0.3, cy - 0.6);
            cr.closePath();
            cr.fill();
            cr.setOperator(Cairo.Operator.OVER);
        }
    },
};

/** Default widths (logical px) of each glyph at GLYPH_H. */
export const GLYPH_W = {wifi: 19, wired: 18, volume: 19, bluetooth: 11, dnd: 14, awake: 15, battery: 27};

export class Glyph {
    /** @param {'wifi'|'wired'|'volume'|'bluetooth'|'dnd'|'awake'|'battery'} kind */
    constructor(kind, state = {}) {
        this._kind = kind;
        this._state = state;
        this._dead = false;
        this.actor = new St.DrawingArea({style_class: 'di-glyph', width: GLYPH_W[kind], height: GLYPH_H});
        this.actor.connect('repaint', () => this._paint());
        this.actor.connect('destroy', () => {
            this._dead = true;
        });
    }

    /** Switch to another glyph kind (e.g. wifi -> wired) keeping the same actor. */
    setKind(kind) {
        if (kind === this._kind)
            return;
        this._kind = kind;
        this.actor.set_width(GLYPH_W[kind]);
        this.actor.queue_repaint();
    }

    /** Merge new state; repaints only if something changed. */
    set(state) {
        const next = {...this._state, ...state};
        if (JSON.stringify(next) === JSON.stringify(this._state))
            return;
        this._state = next;
        if (!this._dead)
            this.actor.queue_repaint();
    }

    _paint() {
        const cr = this.actor.get_context();
        try {
            const [w, h] = this.actor.get_surface_size();
            DRAW[this._kind](cr, w, h, this._state);
        } finally {
            cr.$dispose();
        }
    }
}
