// Matching an MPRIS player to its window. Pure functions (no GNOME imports),
// unit-tested with gjs. lib/windows.js applies them to the real windows.

const strip = s => String(s ?? '').toLowerCase().replace(/\.desktop$/, '');

/** Lowercase, drop accents and treat Turkish dotless ı as i: 'AYDIN' matches 'Aydın', 'Çay' matches 'cay'. */
export const fold = s => String(s ?? '').replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase()
    .replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Lowercase names that identify a player: desktop entry, identity, bus-name token. */
export function needlesFor({desktopEntry, identity, busName}) {
    // 'org.mpris.MediaPlayer2.chromium.instance123' -> 'chromium'
    const token = String(busName ?? '').replace('org.mpris.MediaPlayer2.', '').split('.')[0];
    const out = [];
    for (const raw of [desktopEntry, identity, token]) {
        const n = strip(raw).trim();
        if (n.length >= 3 && !out.includes(n))
            out.push(n);
    }
    return out;
}

/** Does an application (desktop id + display name) look like one of the needles? */
export function appMatches(needles, {id, name}) {
    const appId = strip(id), appName = String(name ?? '').toLowerCase();
    return needles.some(n => appId === n || appId.includes(n) || appName.includes(n) ||
        (appId.length >= 4 && n.includes(appId)));
}

/**
 * Choose the window that shows the video: a window whose title contains the
 * track title (a browser tab is titled after the video) wins; otherwise the
 * first window that is not minimized; otherwise the first.
 * @param {Array<{title: string, minimized: boolean}>} windows  most recently used first
 */
export function pickWindow(windows, trackTitle) {
    if (!windows.length)
        return null;
    const t = fold(trackTitle).trim();
    const visible = windows.filter(w => !w.minimized);
    const byTitle = t.length >= 3 ? windows.find(w => fold(w.title).includes(t)) : null;
    return byTitle ?? visible[0] ?? windows[0];
}
