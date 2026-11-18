// Finds the window of a media player (for the video preview). The matching
// rules are in lib/windowMatch.js; this file only asks the shell for the real
// applications and windows.
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {appMatches, needlesFor, pickWindow} from './windowMatch.js';

/**
 * @param {{desktopEntry?: string, identity?: string, busName?: string}} info  from the MPRIS player
 * @param {string} trackTitle   title of the current track / video
 * @returns {Meta.Window|null}
 */
export function findPlayerWindow(info, trackTitle) {
    const needles = needlesFor(info);
    if (!needles.length)
        return null;
    const windows = [];
    for (const app of Shell.AppSystem.get_default().get_running()) {
        if (!appMatches(needles, {id: app.get_id() ?? '', name: app.get_name() ?? ''}))
            continue;
        for (const w of app.get_windows()) {
            if (w.get_window_type() === Meta.WindowType.NORMAL)
                windows.push({w, title: w.get_title() ?? '', minimized: w.minimized});
        }
    }
    return pickWindow(windows, trackTitle)?.w ?? null;
}
