// GSettings -> plain config snapshot. Islands are rebuilt when settings
// change (see extension.js), so nothing below needs to be live.
import Clutter from 'gi://Clutter';

import {themeFor} from './themes.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function readConfig(settings) {
    const accent = settings.get_string('accent-color');
    const theme = themeFor(settings.get_string('theme'));
    return {
        theme,
        centerEnabled: settings.get_boolean('center-enabled'),
        qsEnabled: settings.get_boolean('qs-enabled'),
        statsEnabled: settings.get_boolean('stats-enabled'),

        expandOnHover: settings.get_boolean('expand-on-hover'),
        hoverDelay: settings.get_int('hover-expand-delay'),
        leaveDelay: settings.get_int('leave-collapse-delay'),
        autoCollapse: settings.get_int('auto-collapse'),

        expandMs: settings.get_int('animation-duration'),
        expandMode: settings.get_boolean('spring')
            ? Clutter.AnimationMode.EASE_OUT_BACK
            : Clutter.AnimationMode.EASE_OUT_CUBIC,

        pollCompact: settings.get_int('poll-compact'),
        pollExpanded: settings.get_int('poll-expanded'),

        centerCompactModules: settings.get_strv('center-compact-modules'),
        centerModules: settings.get_strv('center-modules'),
        qsModules: settings.get_strv('qs-modules'),
        statsModules: settings.get_strv('stats-modules'),
        statsCompactModules: settings.get_strv('stats-compact-modules'),
        events: settings.get_strv('events'),

        accent: HEX.test(accent) ? accent : theme.accent,
        showSeconds: settings.get_boolean('show-seconds'),

        meetingMode: settings.get_boolean('meeting-mode'),
        autoPowerSaver: settings.get_boolean('auto-power-saver'),
        autoPowerSaverLevel: settings.get_int('auto-power-saver-level'),

        osdEnabled: settings.get_boolean('osd-enabled'),
        notificationPreview: settings.get_boolean('notification-preview'),
        screenshotPreview: settings.get_boolean('screenshot-preview'),
        notificationDuration: settings.get_int('notification-duration'),
        musicPopup: settings.get_boolean('music-popup'),
    };
}
