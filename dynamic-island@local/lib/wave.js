// Geometry for the wavy outline (pure maths, unit-tested).
//
// perimeterPoints() walks the border of a rounded rectangle at even steps and
// gives, for every point, the outward normal. The outline effect pushes each
// point out by waveOffset(): a sine travelling along the border.

/**
 * @param {number} w  width
 * @param {number} h  height
 * @param {number} r  corner radius (clamped to min(w, h) / 2)
 * @param {number} step  distance between points (px)
 * @returns {Array<{x, y, nx, ny, s}>}  s = distance along the border from the top-left straight
 */
export function perimeterPoints(w, h, r, step = 3) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const sw = w - 2 * r, sh = h - 2 * r, arc = Math.PI * r / 2;
    // segments clockwise from the top-left end of the top edge
    const segs = [
        {len: sw, at: t => ({x: r + t, y: 0, nx: 0, ny: -1})},
        {len: arc, at: t => corner(w - r, r, -Math.PI / 2 + t / Math.max(r, 1e-9))},
        {len: sh, at: t => ({x: w, y: r + t, nx: 1, ny: 0})},
        {len: arc, at: t => corner(w - r, h - r, t / Math.max(r, 1e-9))},
        {len: sw, at: t => ({x: w - r - t, y: h, nx: 0, ny: 1})},
        {len: arc, at: t => corner(r, h - r, Math.PI / 2 + t / Math.max(r, 1e-9))},
        {len: sh, at: t => ({x: 0, y: h - r - t, nx: -1, ny: 0})},
        {len: arc, at: t => corner(r, r, Math.PI + t / Math.max(r, 1e-9))},
    ];
    function corner(cx, cy, a) {
        const nx = Math.cos(a), ny = Math.sin(a);
        return {x: cx + nx * r, y: cy + ny * r, nx, ny};
    }
    const total = segs.reduce((a, s) => a + s.len, 0);
    if (total <= 0)
        return [];
    const n = Math.max(8, Math.round(total / step));
    const d = total / n;
    const out = [];
    let seg = 0, segStart = 0;
    for (let i = 0; i < n; i++) {
        const s = i * d;
        while (seg < segs.length - 1 && s > segStart + segs[seg].len) {
            segStart += segs[seg].len;
            seg++;
        }
        const p = segs[seg].at(Math.min(segs[seg].len, s - segStart));
        out.push({...p, s});
    }
    return out;
}

/** Outward offset of a point `s` px along the border. A whole number of waves fits the loop. */
export function waveOffset(s, total, phase, amp, wavelength) {
    const waves = Math.max(1, Math.round(total / wavelength));
    return amp * Math.sin(2 * Math.PI * (waves * s / total) - phase);
}

/** Total border length of a rounded rectangle. */
export function perimeterLength(w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    return 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
}
