// Colour helpers for album-art theming. Pure functions (unit-tested with gjs).

export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min)
        return {h: 0, s: 0, l};
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r)
        h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g)
        h = (b - r) / d + 2;
    else
        h = (r - g) / d + 4;
    return {h: h / 6, s, l};
}

export function hslToRgb(h, s, l) {
    if (s === 0) {
        const v = Math.round(l * 255);
        return {r: v, g: v, b: v};
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = t => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return {r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255)};
}

export const toHex = ({r, g, b}) =>
    `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Dominant colour of an RGB(A) pixel buffer: average weighted by
 * colourfulness, so a red cover with a white border is red, not pink.
 * Falls back to the plain average for grey images.
 */
export function dominantColor(pixels, channels, rowstride, width, height) {
    let wr = 0, wg = 0, wb = 0, wsum = 0;
    let ar = 0, ag = 0, ab = 0, n = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * rowstride + x * channels;
            if (channels === 4 && pixels[i + 3] < 128)
                continue;   // transparent
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            ar += r; ag += g; ab += b; n++;
            const {s, l} = rgbToHsl(r, g, b);
            const w = s * (1 - Math.abs(2 * l - 1)) ** 2 + 0.001;   // vivid, mid-lightness pixels count most
            wr += r * w; wg += g * w; wb += b * w; wsum += w;
        }
    }
    if (!n)
        return {r: 128, g: 128, b: 128};
    if (wsum < 0.05)   // (almost) grey
        return {r: Math.round(ar / n), g: Math.round(ag / n), b: Math.round(ab / n)};
    return {r: Math.round(wr / wsum), g: Math.round(wg / wsum), b: Math.round(wb / wsum)};
}

/** Bright, saturated variant that reads well on black (bars, progress, text). */
export function accentFrom(rgb) {
    const {h, s} = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const sat = s < 0.12 ? s : clamp(s, 0.5, 0.95);   // keep grey art grey
    return hslToRgb(h, sat, clamp(0.62, 0.55, 0.7));
}

/** Dark variant for the card background: same hue, low lightness. */
export function tintFrom(rgb, lightness = 0.17) {
    const {h, s} = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const sat = s < 0.12 ? s : clamp(s, 0.35, 0.8);
    return hslToRgb(h, sat, lightness);
}

/**
 * Two distinct colours from an image: the most vivid hue family, and the best
 * second one that is clearly a different hue. If the art has only one hue
 * (or is grey) the second colour is a shifted variant of the first, so a
 * two-colour gradient always looks intentional.
 * @returns {{primary: {r,g,b}, secondary: {r,g,b}}}
 */
export function palette(pixels, channels, rowstride, width, height) {
    const BINS = 12;
    const bins = Array.from({length: BINS}, () => ({w: 0, r: 0, g: 0, b: 0}));
    let ar = 0, ag = 0, ab = 0, n = 0, total = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * rowstride + x * channels;
            if (channels === 4 && pixels[i + 3] < 128)
                continue;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            ar += r; ag += g; ab += b; n++;
            const {h, s, l} = rgbToHsl(r, g, b);
            const w = s * (1 - Math.abs(2 * l - 1)) ** 2;
            if (w <= 0.0005)
                continue;
            const bin = bins[Math.min(BINS - 1, Math.floor(h * BINS))];
            bin.w += w; bin.r += r * w; bin.g += g * w; bin.b += b * w;
            total += w;
        }
    }
    if (!n)
        return {primary: {r: 128, g: 128, b: 128}, secondary: {r: 90, g: 90, b: 100}};
    const avg = {r: Math.round(ar / n), g: Math.round(ag / n), b: Math.round(ab / n)};
    if (total < 0.05) {   // (almost) grey: lighter / darker neighbours
        const {l} = rgbToHsl(avg.r, avg.g, avg.b);
        return {primary: avg, secondary: hslToRgb(0.6, 0.12, clamp(l > 0.5 ? l - 0.25 : l + 0.25, 0.1, 0.9))};
    }
    const colour = b => ({r: Math.round(b.r / b.w), g: Math.round(b.g / b.w), b: Math.round(b.b / b.w)});
    let pi = 0;
    bins.forEach((b, i) => {
        if (b.w > bins[pi].w)
            pi = i;
    });
    const primary = colour(bins[pi]);

    let si = -1;
    bins.forEach((b, i) => {
        const d = Math.min(Math.abs(i - pi), BINS - Math.abs(i - pi));   // circular hue distance in bins
        if (d >= 2 && b.w > bins[pi].w * 0.12 && (si < 0 || b.w > bins[si].w))
            si = i;
    });
    if (si >= 0)
        return {primary, secondary: colour(bins[si])};
    const {h, s, l} = rgbToHsl(primary.r, primary.g, primary.b);
    return {primary, secondary: hslToRgb((h + 0.08) % 1, clamp(s, 0.4, 0.9), clamp(l > 0.5 ? l - 0.12 : l + 0.15, 0.2, 0.8))};
}

/** Linear mix of two colours, t in [0, 1]. */
export function mix(a, b, t) {
    return {r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t)};
}

export const hexToRgb = hex => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? {r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16)} : {r: 94, g: 230, b: 181};
};

/**
 * Square RGB(A) pixel buffer -> RGBA bytes with rounded corners (anti-aliased
 * alpha). Used for album covers: St only clips rectangles, so the rounding
 * has to be part of the picture itself.
 * @returns {Uint8Array} px * px * 4 bytes, rowstride px * 4
 */
export function roundedRgba(pixels, channels, rowstride, px, radius) {
    const out = new Uint8Array(px * px * 4);
    const r = Math.min(radius, px / 2);
    for (let y = 0; y < px; y++) {
        for (let x = 0; x < px; x++) {
            const i = y * rowstride + x * channels;
            const o = (y * px + x) * 4;
            out[o] = pixels[i];
            out[o + 1] = pixels[i + 1];
            out[o + 2] = pixels[i + 2];
            let a = channels === 4 ? pixels[i + 3] : 255;
            // distance into the corner square, measured from the corner circle's centre
            const dx = x + 0.5 < r ? r - (x + 0.5) : x + 0.5 > px - r ? x + 0.5 - (px - r) : 0;
            const dy = y + 0.5 < r ? r - (y + 0.5) : y + 0.5 > px - r ? y + 0.5 - (px - r) : 0;
            if (dx > 0 && dy > 0)
                a = Math.round(a * clamp(r - Math.hypot(dx, dy) + 0.5, 0, 1));
            out[o + 3] = a;
        }
    }
    return out;
}
