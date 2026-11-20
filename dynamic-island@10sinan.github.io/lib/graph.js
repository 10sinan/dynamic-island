// Small area graph drawn with Cairo (St.DrawingArea).
// Redraws only when asked (queue_repaint from the module's tick), and only
// while the island is open: no layout work, no timers of its own.
import Cairo from 'gi://cairo';
import St from 'gi://St';

function parse(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? m.slice(1).map(h => parseInt(h, 16) / 255) : [0.37, 0.9, 0.71];
}

export class Graph {
    /**
     * @param {object} o
     * @param {number} o.width
     * @param {number} o.height
     * @param {string} o.color            line / fill colour (#rrggbb)
     * @param {number} [o.seconds=60]     time window
     * @param {() => Array<{ago:number, v:number}>} o.source   returns the samples
     * @param {() => number} [o.max]      value mapped to the top (default 1)
     */
    constructor({width, height, color, seconds = 60, source, max = () => 1}) {
        this._rgb = parse(color);
        this._seconds = seconds;
        this._source = source;
        this._max = max;
        this._dead = false;
        this.actor = new St.DrawingArea({style_class: 'di-graph', width, height});
        this.actor.connect('repaint', () => this._paint());
        this.actor.connect('destroy', () => {
            this._dead = true;
        });
    }

    setColor(hex) {
        this._rgb = parse(hex);
        this.redraw();
    }

    redraw() {
        if (!this._dead)
            this.actor.queue_repaint();
    }

    _paint() {
        const cr = this.actor.get_context();
        try {
            const [w, h] = this.actor.get_surface_size();
            const [r, g, b] = this._rgb;
            const pad = 2;   // keeps the stroke inside the area

            // faint horizontal guides
            cr.setLineWidth(1);
            cr.setSourceRGBA(1, 1, 1, 0.07);
            for (const f of [0.25, 0.5, 0.75]) {
                const y = Math.round(h * f) + 0.5;
                cr.moveTo(0, y);
                cr.lineTo(w, y);
            }
            cr.stroke();

            const samples = this._source();
            if (samples.length < 2)
                return;
            const max = Math.max(1e-9, this._max());
            const span = this._seconds * 1000;
            const pts = samples.map(s => [
                w - (s.ago / span) * w,
                h - pad - Math.min(1, Math.max(0, s.v / max)) * (h - 2 * pad),
            ]);

            // filled area under the line
            cr.moveTo(pts[0][0], h);
            for (const [x, y] of pts)
                cr.lineTo(x, y);
            cr.lineTo(pts[pts.length - 1][0], h);
            cr.closePath();
            const grad = new Cairo.LinearGradient(0, 0, 0, h);
            grad.addColorStopRGBA(0, r, g, b, 0.45);
            grad.addColorStopRGBA(1, r, g, b, 0.02);
            cr.setSource(grad);
            cr.fill();

            // the line itself
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setLineWidth(1.6);
            cr.setSourceRGBA(r, g, b, 1);
            cr.moveTo(pts[0][0], pts[0][1]);
            for (const [x, y] of pts.slice(1))
                cr.lineTo(x, y);
            cr.stroke();
        } finally {
            cr.$dispose();
        }
    }
}
