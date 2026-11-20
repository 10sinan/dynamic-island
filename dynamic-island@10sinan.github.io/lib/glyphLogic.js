// Decisions behind the status glyphs (levels, colours). No GNOME imports, so
// they are unit-tested with plain gjs.

/** Wi-Fi signal strength 0..100 -> 0..3 lit arcs. */
export function wifiLevel(strength) {
    if (strength >= 67)
        return 3;
    if (strength >= 34)
        return 2;
    if (strength >= 5)
        return 1;
    return 0;
}

/** Volume fraction -> 1..3 sound waves (0 when muted). */
export function volumeLevel(frac, muted) {
    if (muted || frac <= 0)
        return 0;
    return frac < 0.34 ? 1 : frac < 0.67 ? 2 : 3;
}

/** Battery fill colour: green while charging, red at <= 20 %, white otherwise. */
export function batteryColor(pct, charging) {
    if (charging)
        return [0.19, 0.82, 0.35];
    if (pct <= 20)
        return [1, 0.27, 0.23];
    return [1, 1, 1];
}

